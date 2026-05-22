#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RUNNER="${AGENT_RELAY_BIN:-$HOME/.local/bin/agent-relay}"
DURATION_HOURS="${RICKY_OVERNIGHT_HOURS:-7}"
POLL_SECONDS="${RICKY_OVERNIGHT_POLL_SECONDS:-15}"
PASSES="${RICKY_OVERNIGHT_PASSES:-3}"
QUEUE_MODE="${RICKY_OVERNIGHT_QUEUE_MODE:-flight-safe}"
MAX_WORKFLOWS_PER_INVOCATION="${RICKY_OVERNIGHT_MAX_WORKFLOWS_PER_INVOCATION:-4}"
IDLE_TIMEOUT_SECONDS="${RICKY_OVERNIGHT_IDLE_TIMEOUT_SECONDS:-900}"
DEFAULT_MAX_WORKFLOWS_PER_INVOCATION=4
STATE_NAMESPACE_ROOT="$REPO_ROOT/.workflow-artifacts/state/overnight"
LEGACY_STATE_NAMESPACE_ROOT="$REPO_ROOT/.workflow-artifacts/overnight-state"
STATE_ROOT="${RICKY_OVERNIGHT_STATE_DIR:-$STATE_NAMESPACE_ROOT/$QUEUE_MODE}"
GLOBAL_STATE_ROOT="$(dirname "$STATE_ROOT")"
GLOBAL_LOCK_DIR="$GLOBAL_STATE_ROOT/active.lock"
GLOBAL_LOCK_FILE="$GLOBAL_LOCK_DIR/lock.env"
RESUME_FLAG="${1:-}"

if [[ "$RESUME_FLAG" == "--help" || "$RESUME_FLAG" == "-h" ]]; then
  cat <<'EOF'
Usage: scripts/run-ricky-overnight.sh [--resume]

Options:
  --resume  Restore the latest saved overnight checkpoint for the selected queue mode.
  -h, --help  Show this help text and exit.
EOF
  exit 0
fi

if [[ -n "$RESUME_FLAG" && "$RESUME_FLAG" != "--resume" ]]; then
  printf 'Unknown option: %s\n\n' "$RESUME_FLAG" >&2
  cat <<'EOF' >&2
Usage: scripts/run-ricky-overnight.sh [--resume]

Options:
  --resume  Restore the latest saved overnight checkpoint for the selected queue mode.
  -h, --help  Show this help text and exit.
EOF
  exit 2
fi

STAMP="$(date +%Y%m%d-%H%M%S)"
ARTIFACT_DIR="$REPO_ROOT/.workflow-artifacts/overnight-$STAMP"
LOG_FILE="$ARTIFACT_DIR/overnight.log"
STATUS_FILE="$ARTIFACT_DIR/status.txt"
SUMMARY_FILE="$ARTIFACT_DIR/summary.md"
LAST_COMMIT_FILE="$ARTIFACT_DIR/last-commit.txt"
QUEUE_FILE="$ARTIFACT_DIR/queue.txt"
FAILED_FILE="$ARTIFACT_DIR/failed.txt"
SKIPPED_FILE="$ARTIFACT_DIR/skipped.txt"
STALE_FILE="$ARTIFACT_DIR/stale.txt"
CHECKPOINT_FILE="$ARTIFACT_DIR/checkpoint.env"
STOP_FILE="$ARTIFACT_DIR/STOP"
STATE_FILE="$STATE_ROOT/checkpoint.env"
STATE_LOG="$STATE_ROOT/latest-run.txt"
LOCK_OWNER_PID=""
LOCK_OWNER_ARTIFACT_DIR=""
LOCK_OWNER_QUEUE_MODE=""
LOCK_OWNER_STATUS_FILE=""
LOCK_ACQUIRED="false"
QUARANTINED_RUNTIME_PATHS=()

mkdir -p "$ARTIFACT_DIR" "$STATE_ROOT" "$GLOBAL_STATE_ROOT"
: > "$LOG_FILE"
: > "$FAILED_FILE"
: > "$SKIPPED_FILE"
: > "$STALE_FILE"

if [[ -z "${RICKY_OVERNIGHT_STATE_DIR:-}" && -d "$LEGACY_STATE_NAMESPACE_ROOT/$QUEUE_MODE" && ! -e "$STATE_ROOT/checkpoint.env" ]]; then
  mkdir -p "$STATE_ROOT"
  cp -f "$LEGACY_STATE_NAMESPACE_ROOT/$QUEUE_MODE"/* "$STATE_ROOT"/ 2>/dev/null || true
fi

exec > >(tee -a "$LOG_FILE") 2>&1

START_EPOCH="$(date +%s)"
END_EPOCH="$(awk -v start="$START_EPOCH" -v hours="$DURATION_HOURS" 'BEGIN {
  if (hours !~ /^[0-9]+([.][0-9]+)?$/) {
    hours = 7
  }

  printf "%d", start + (hours * 3600)
}')"
INITIAL_GIT_HEAD=""
CURRENT_PASS=1
CURRENT_INDEX=0
WORKFLOWS_RUN=0
RUN_RESULT=""
STATUS_REASON=""
CURRENT_WORKFLOW=""
RUN_PID="$$"
RUN_PGID=""
SCRIPT_PGID="$(ps -o pgid= -p $$ 2>/dev/null | tr -d '[:space:]')"
RUNNER_START_PID=""
RUNNER_WAIT_PID=""
RUNNER_EXPECTS_DETACHED_PGID="false"
STATUS_MARKED="false"
RESTORED_ARTIFACT_DIR=""
RESTORED_QUEUE_FILE=""
RESTORED_CURRENT_INDEX=""
RESTORED_CURRENT_PASS=""
CLAUDE_RATE_LIMIT_PATTERNS=(
  "You've hit your limit"
  "/rate-limit-options"
  "What do you want to do?"
  "Stop and wait for limit to reset"
)

normalize_positive_integer() {
  local value="$1"
  local fallback="$2"

  if [[ "$value" =~ ^[0-9]+$ ]] && (( value > 0 )); then
    printf '%s\n' "$value"
    return 0
  fi

  printf '%s\n' "$fallback"
}

MAX_WORKFLOWS_PER_INVOCATION="$(normalize_positive_integer "$MAX_WORKFLOWS_PER_INVOCATION" "$DEFAULT_MAX_WORKFLOWS_PER_INVOCATION")"

artifact_runner_logs_show_success() {
  local artifact_dir="$1"
  local runner_log=""

  [[ -d "$artifact_dir" ]] || return 1

  for runner_log in "$artifact_dir"/runner-*.log; do
    [[ -f "$runner_log" ]] || continue
    if grep -Eq 'Workflow "[^"]+" — COMPLETED|\[agent-relay\] runScriptFile: runner .* completed exit=0' "$runner_log"; then
      return 0
    fi
  done

  return 1
}

artifact_runner_logs_show_failure() {
  local artifact_dir="$1"
  local runner_log=""

  [[ -d "$artifact_dir" ]] || return 1

  for runner_log in "$artifact_dir"/runner-*.log; do
    [[ -f "$runner_log" ]] || continue
    if grep -Eq '✗ .* — FAILED|\[workflow\] FAILED:|Command failed with exit code [1-9][0-9]*' "$runner_log"; then
      return 0
    fi
  done

  return 1
}

artifact_checkpoint_read_progress() {
  local artifact_dir="$1"
  local checkpoint_file="$artifact_dir/checkpoint.env"
  local current_index_ref="$2"
  local current_workflow_ref="$3"
  local current_index=""
  local current_workflow=""
  local key raw_value value

  [[ -d "$artifact_dir" ]] || return 1
  [[ -f "$checkpoint_file" ]] || return 1

  while IFS='=' read -r key raw_value; do
    [[ "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || continue
    value="$(printf '%b' "${raw_value//\\/\\\\}")"
    eval "value=$raw_value" 2>/dev/null || value="$raw_value"
    case "$key" in
      current_index) current_index="$value" ;;
      current_workflow) current_workflow="$value" ;;
    esac
  done < "$checkpoint_file"

  printf -v "$current_index_ref" '%s' "$current_index"
  printf -v "$current_workflow_ref" '%s' "$current_workflow"
}

artifact_checkpoint_indicates_queue_exhausted() {
  local artifact_dir="$1"
  local queue_file="$artifact_dir/queue.txt"
  local current_index=""
  local current_workflow=""
  local queue_total="0"

  [[ -d "$artifact_dir" ]] || return 1
  [[ -f "$queue_file" ]] || return 1
  artifact_checkpoint_read_progress "$artifact_dir" current_index current_workflow || return 1

  [[ "$current_index" =~ ^[0-9]+$ ]] || return 1
  queue_total="$(grep -cve '^[[:space:]]*$' "$queue_file" 2>/dev/null || echo 0)"
  [[ "$queue_total" =~ ^[0-9]+$ ]] || queue_total="0"

  [[ -z "$current_workflow" ]] || return 1
  (( current_index >= queue_total ))
}

artifact_checkpoint_has_active_workflow() {
  local artifact_dir="$1"
  local current_index=""
  local current_workflow=""

  artifact_checkpoint_read_progress "$artifact_dir" current_index current_workflow || return 1
  [[ -n "$current_workflow" ]]
}

artifact_active_workflow_runner_log_shows_success() {
  local artifact_dir="$1"
  local current_index=""
  local current_workflow=""
  local runner_log=""

  artifact_checkpoint_read_progress "$artifact_dir" current_index current_workflow || return 1
  [[ -n "$current_workflow" ]] || return 1

  runner_log="$artifact_dir/runner-$(basename "$current_workflow" .ts).log"
  [[ -f "$runner_log" ]] || return 1

  grep -Eq 'Workflow "[^"]+" — COMPLETED|\[agent-relay\] runScriptFile: runner .* completed exit=0' "$runner_log"
}

artifact_queue_exhausted_terminal_status() {
  local artifact_dir="$1"
  local failed_file="$artifact_dir/failed.txt"

  if [[ -s "$failed_file" ]]; then
    printf 'complete-with-failures\n'
  else
    printf 'complete\n'
  fi
}

clear_artifact_checkpoint() {
  local artifact_dir="$1"

  [[ -n "$artifact_dir" ]] || return 0
  rm -f "$artifact_dir/checkpoint.env"
}

clear_artifact_runner_pid() {
  local artifact_dir="$1"

  [[ -n "$artifact_dir" ]] || return 0
  rm -f "$artifact_dir/runner.pid"
}

restore_quarantined_runtime_state_for_artifact() {
  local artifact_dir="$1"
  local quarantine_root="$artifact_dir/runtime-state-quarantine"
  local entry=""
  local base=""
  local candidate=""

  [[ -d "$quarantine_root" ]] || return 0

  shopt -s nullglob
  for entry in "$quarantine_root"/*; do
    [[ -e "$entry" ]] || continue
    base="$(basename "$entry")"
    candidate=""

    case "$base" in
      agent-relay-*) candidate=".agent-relay" ;;
      relay-*) candidate=".relay" ;;
      trajectories-*) candidate=".trajectories" ;;
      *)
        log "leaving unknown quarantined runtime state in place: $entry"
        continue
        ;;
    esac

    if [[ ! -e "$candidate" ]]; then
      mv "$entry" "$candidate"
      log "restored quarantined runtime state from stale artifact: $entry -> $candidate"
      continue
    fi

    if [[ -d "$candidate" && -d "$entry" ]]; then
      mkdir -p "$candidate"
      cp -R "$entry"/. "$candidate"/
      rm -rf "$entry"
      log "merged quarantined runtime state from stale artifact: $entry -> $candidate"
      continue
    fi

    log "leaving quarantined runtime state in place because restore target already exists: $entry (target: $candidate)"
  done
  shopt -u nullglob
}

mark_artifact_stale_or_complete() {
  local artifact_dir="$1"
  local status_file="$artifact_dir/status.txt"
  local summary_file="$artifact_dir/summary.md"
  local resolved_status="stale"
  local resolved_reason="process exited unexpectedly"

  [[ -d "$artifact_dir" ]] || return 0

  if artifact_runner_logs_show_failure "$artifact_dir"; then
    resolved_status="failed"
    resolved_reason="runner failed before harness status flush"
  elif artifact_checkpoint_indicates_queue_exhausted "$artifact_dir"; then
    resolved_status="$(artifact_queue_exhausted_terminal_status "$artifact_dir")"
    resolved_reason="queue exhausted before harness status flush"
  elif artifact_runner_logs_show_success "$artifact_dir" && (
    artifact_checkpoint_indicates_queue_exhausted "$artifact_dir" ||
    (
      artifact_checkpoint_has_active_workflow "$artifact_dir" &&
      artifact_active_workflow_runner_log_shows_success "$artifact_dir"
    )
  ); then
    resolved_status="complete"
    resolved_reason="runner completed before harness status flush"
  fi

  printf '%s\n' "$resolved_status" > "$status_file"

  cat > "$summary_file" <<EOF
# Ricky overnight run

- status: $resolved_status
- reason: $resolved_reason
- artifact_dir: $artifact_dir
EOF

  clear_artifact_checkpoint "$artifact_dir"
}

reconcile_stale_state_dir() {
  local checkpoint_file="$1"
  local artifact_dir=""
  local queue_mode=""
  local current_pass=""
  local current_index=""
  local workflows_run=""
  local initial_git_head=""
  local current_workflow=""
  local run_pid=""
  local run_pgid=""
  local status_file=""
  local reconciled_status=""
  local key raw_value value

  [[ -f "$checkpoint_file" ]] || return 0

  while IFS='=' read -r key raw_value; do
    [[ "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || continue
    value="$(printf '%b' "${raw_value//\\/\\\\}")"
    eval "value=$raw_value" 2>/dev/null || value="$raw_value"
    case "$key" in
      queue_mode) queue_mode="$value" ;;
      current_pass) current_pass="$value" ;;
      current_index) current_index="$value" ;;
      workflows_run) workflows_run="$value" ;;
      artifact_dir) artifact_dir="$value" ;;
      initial_git_head) initial_git_head="$value" ;;
      current_workflow) current_workflow="$value" ;;
      run_pid) run_pid="$value" ;;
      run_pgid) run_pgid="$value" ;;
    esac
  done < "$checkpoint_file"

  [[ -n "$artifact_dir" ]] || return 0
  status_file="$artifact_dir/status.txt"

  if [[ -f "$status_file" ]] && grep -Eqx 'running|checkpointed' "$status_file"; then
    if ! is_pid_running "$run_pid" && ! is_process_group_running "$run_pgid"; then
      mark_artifact_stale_or_complete "$artifact_dir"
      restore_quarantined_runtime_state_for_artifact "$artifact_dir"
      reconciled_status="$(cat "$status_file" 2>/dev/null || true)"
      log "reconciled stale overnight state from $checkpoint_file -> $artifact_dir"

      if [[ "$reconciled_status" == "complete" && "$current_index" =~ ^[0-9]+$ ]]; then
        # A detached runner can finish successfully after the harness has already
        # persisted the current queue index but before the outer loop advances it.
        # When that happens, `current_workflow` may already be blank even though
        # the saved index still points at the just-finished workflow. Advance the
        # checkpoint on any reconciled successful artifact so resume does not
        # replay a workflow that already completed cleanly.
        cat > "$checkpoint_file" <<EOF
queue_mode=$(printf '%q' "$queue_mode")
current_pass=$(printf '%q' "$current_pass")
current_index=$(printf '%q' "$((current_index + 1))")
workflows_run=$(printf '%q' "$workflows_run")
artifact_dir=$(printf '%q' "$artifact_dir")
initial_git_head=$(printf '%q' "$initial_git_head")
current_workflow=''
run_pid=''
run_pgid=''
updated_at=$(printf '%q' "$(date '+%Y-%m-%dT%H:%M:%S%z')")
EOF
      else
        rm -f "$checkpoint_file"
      fi

      if [[ ! -f "$checkpoint_file" ]]; then
        rm -f "$(dirname "$checkpoint_file")/latest-run.txt"
      fi
    fi
  fi
}

iterate_known_state_dirs() {
  local state_dir=""
  local emitted_custom_state_dir="false"

  for state_dir in "$GLOBAL_STATE_ROOT"/*; do
    [[ -d "$state_dir" ]] || continue
    printf '%s\n' "$state_dir"
    if [[ "$state_dir" == "$STATE_ROOT" ]]; then
      emitted_custom_state_dir="true"
    fi
  done

  if [[ -d "$STATE_ROOT" && "$emitted_custom_state_dir" != "true" ]]; then
    printf '%s\n' "$STATE_ROOT"
  fi
}

iterate_known_artifact_checkpoints() {
  local checkpoint_file=""

  shopt -s nullglob
  for checkpoint_file in "$REPO_ROOT"/.workflow-artifacts/overnight-*/checkpoint.env; do
    [[ -f "$checkpoint_file" ]] || continue
    printf '%s\n' "$checkpoint_file"
  done
  shopt -u nullglob
}

iterate_running_artifact_dirs_without_checkpoints() {
  local artifact_dir=""
  local status_file=""

  shopt -s nullglob
  for artifact_dir in "$REPO_ROOT"/.workflow-artifacts/overnight-*; do
    [[ -d "$artifact_dir" ]] || continue
    [[ "$artifact_dir" == "$ARTIFACT_DIR" ]] && continue
    status_file="$artifact_dir/status.txt"
    [[ -f "$status_file" ]] || continue
    grep -Eqx 'running|checkpointed' "$status_file" || continue
    [[ ! -f "$artifact_dir/checkpoint.env" ]] || continue
    printf '%s\n' "$artifact_dir"
  done
  shopt -u nullglob
}

reconcile_stale_state_dirs() {
  local state_dir=""
  local checkpoint_file=""
  local artifact_dir=""

  while IFS= read -r state_dir; do
    [[ -d "$state_dir" ]] || continue
    reconcile_stale_state_dir "$state_dir/checkpoint.env"
  done < <(iterate_known_state_dirs)

  while IFS= read -r checkpoint_file; do
    [[ -f "$checkpoint_file" ]] || continue
    reconcile_stale_state_dir "$checkpoint_file"
  done < <(iterate_known_artifact_checkpoints)

  while IFS= read -r artifact_dir; do
    [[ -d "$artifact_dir" ]] || continue
    mark_artifact_stale_or_complete "$artifact_dir"
    restore_quarantined_runtime_state_for_artifact "$artifact_dir"
    log "reconciled orphaned overnight artifact without checkpoint -> $artifact_dir"
  done < <(iterate_running_artifact_dirs_without_checkpoints)
}

clear_all_state_checkpoints() {
  local state_dir=""
  while IFS= read -r state_dir; do
    [[ -d "$state_dir" ]] || continue
    rm -f "$state_dir/checkpoint.env" "$state_dir/latest-run.txt"
  done < <(iterate_known_state_dirs)
}

finalize_current_artifact_checkpoint() {
  clear_artifact_checkpoint "$ARTIFACT_DIR"
}

kill_process_group() {
  local pgid="$1"

  [[ -n "$pgid" ]] || return 0
  kill -TERM -- "-$pgid" 2>/dev/null || true
  sleep 1
  kill -0 -- "-$pgid" 2>/dev/null && kill -KILL -- "-$pgid" 2>/dev/null || true
}

release_global_lock() {
  [[ "$LOCK_ACQUIRED" == "true" ]] || return 0
  rm -f "$GLOBAL_LOCK_FILE"
  rmdir "$GLOBAL_LOCK_DIR" 2>/dev/null || true
  LOCK_ACQUIRED="false"
}

read_global_lock() {
  local key raw_value value

  LOCK_OWNER_PID=""
  LOCK_OWNER_ARTIFACT_DIR=""
  LOCK_OWNER_QUEUE_MODE=""
  LOCK_OWNER_STATUS_FILE=""

  [[ -f "$GLOBAL_LOCK_FILE" ]] || return 0

  while IFS='=' read -r key raw_value; do
    [[ "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || continue
    value="$(printf '%b' "${raw_value//\\/\\\\}")"
    eval "value=$raw_value" 2>/dev/null || value="$raw_value"
    case "$key" in
      pid) LOCK_OWNER_PID="$value" ;;
      artifact_dir) LOCK_OWNER_ARTIFACT_DIR="$value" ;;
      queue_mode) LOCK_OWNER_QUEUE_MODE="$value" ;;
      status_file) LOCK_OWNER_STATUS_FILE="$value" ;;
    esac
  done < "$GLOBAL_LOCK_FILE"
}

acquire_global_lock() {
  local other_pid=""

  read_global_lock
  other_pid="$LOCK_OWNER_PID"

  if [[ -n "$other_pid" && "$other_pid" != "$$" ]] && kill -0 "$other_pid" 2>/dev/null; then
    STATUS_REASON="another overnight harness is already running: ${LOCK_OWNER_ARTIFACT_DIR:-pid $other_pid} (queue mode: ${LOCK_OWNER_QUEUE_MODE:-unknown})"
    echo "blocked" > "$STATUS_FILE"
    cat > "$SUMMARY_FILE" <<EOF
# Ricky overnight run

- status: blocked
- reason: $STATUS_REASON
- artifact_dir: $ARTIFACT_DIR
EOF
    STATUS_MARKED="true"
    exit 0
  fi

  rm -rf "$GLOBAL_LOCK_DIR"
  mkdir -p "$GLOBAL_LOCK_DIR"
  cat > "$GLOBAL_LOCK_FILE" <<EOF
pid=$$
artifact_dir=$(printf '%q' "$ARTIFACT_DIR")
queue_mode=$(printf '%q' "$QUEUE_MODE")
status_file=$(printf '%q' "$STATUS_FILE")
EOF
  LOCK_ACQUIRED="true"
}

path_contains_tracked_files() {
  local candidate="$1"

  [[ -n "$candidate" ]] || return 1
  [[ -e "$candidate" ]] || return 1
  [[ -n "$(git ls-files -- "$candidate")" ]]
}

quarantine_repo_runtime_state() {
  local quarantine_root="$ARTIFACT_DIR/runtime-state-quarantine"
  local candidate=""
  local stamp="$(date +%Y%m%d-%H%M%S)"
  local destination=""

  for candidate in .agent-relay .relay .trajectories; do
    [[ -e "$candidate" ]] || continue
    if path_contains_tracked_files "$candidate"; then
      log "leaving repo runtime state in place because git tracks files under it: $candidate"
      continue
    fi
    mkdir -p "$quarantine_root"
    destination="$quarantine_root/${candidate#.}-$stamp"
    mv "$candidate" "$destination"
    QUARANTINED_RUNTIME_PATHS+=("$candidate:$destination")
    log "quarantined repo runtime state: $candidate -> $destination"
  done
}

restore_repo_runtime_state() {
  local entry=""
  local candidate=""
  local destination=""
  local idx=0

  for (( idx=${#QUARANTINED_RUNTIME_PATHS[@]}-1; idx>=0; idx-- )); do
    entry="${QUARANTINED_RUNTIME_PATHS[$idx]}"
    candidate="${entry%%:*}"
    destination="${entry#*:}"
    [[ -e "$destination" ]] || continue

    if [[ ! -e "$candidate" ]]; then
      mv "$destination" "$candidate"
      log "restored quarantined repo runtime state: $destination -> $candidate"
      continue
    fi

    if [[ -d "$candidate" && -d "$destination" ]]; then
      mkdir -p "$candidate"
      cp -R "$destination"/. "$candidate"/
      rm -rf "$destination"
      log "merged quarantined repo runtime state back into repo: $destination -> $candidate"
      continue
    fi

    log "leaving quarantined runtime state in place because restore target already exists: $destination (target: $candidate)"
  done
}

on_exit() {
  local exit_code="$?"

  if [[ -n "$RUN_PGID" && "$RUNNER_EXPECTS_DETACHED_PGID" != "true" ]]; then
    kill_process_group "$RUN_PGID"
  fi

  restore_repo_runtime_state

  if [[ "$STATUS_MARKED" != "true" ]]; then
    if [[ -f "$STATUS_FILE" ]] && grep -qx 'running' "$STATUS_FILE"; then
      local recovered_status=""

      if artifact_runner_logs_show_success "$ARTIFACT_DIR" && (
        artifact_checkpoint_indicates_queue_exhausted "$ARTIFACT_DIR" ||
        (
          artifact_checkpoint_has_active_workflow "$ARTIFACT_DIR" &&
          artifact_active_workflow_runner_log_shows_success "$ARTIFACT_DIR"
        )
      ); then
        STATUS_REASON="runner completed before harness status flush"
        recovered_status="complete"
      elif artifact_checkpoint_indicates_queue_exhausted "$ARTIFACT_DIR"; then
        STATUS_REASON="queue exhausted before harness status flush"
        recovered_status="$(artifact_queue_exhausted_terminal_status "$ARTIFACT_DIR")"
      else
        STATUS_REASON="process exited unexpectedly"
        recovered_status="stale"
      fi

      echo "$recovered_status" > "$STATUS_FILE"
      persist_checkpoint

      if [[ "$recovered_status" == "complete" || "$recovered_status" == "complete-with-failures" ]]; then
        clear_all_state_checkpoints
        finalize_current_artifact_checkpoint
      fi

      write_summary "$recovered_status"
    fi
  fi

  release_global_lock

  return "$exit_code"
}

trap on_exit EXIT

acquire_global_lock

append_generated_workflows_to_queue() {
  local generated_workflow=""

  for generated_workflow in workflows/generated/*.ts; do
    [[ -f "$generated_workflow" ]] || continue
    printf '%s\n' "$generated_workflow" >> "$QUEUE_FILE"
  done
}

APPEND_QUEUE_OMITTED_STALE=0

append_repo_workflows_to_queue() {
  local workflow_path=""

  APPEND_QUEUE_OMITTED_STALE=0

  while IFS= read -r workflow_path; do
    [[ -n "$workflow_path" ]] || continue

    if [[ -f "$workflow_path" ]] && workflow_has_stale_package_targets "$workflow_path"; then
      APPEND_QUEUE_OMITTED_STALE=$((APPEND_QUEUE_OMITTED_STALE + 1))
      printf '%s\n' "$workflow_path" >> "$STALE_FILE"
      log "omitting stale pre-package-split workflow from expanded queue: $workflow_path"
      continue
    fi

    printf '%s\n' "$workflow_path" >> "$QUEUE_FILE"
  done < <(find workflows -mindepth 2 -maxdepth 2 -type f -name '*.ts' \
    -path 'workflows/wave*/*' | sort)
}

write_queue() {
  case "$QUEUE_MODE" in
    minimal)
      cat > "$QUEUE_FILE" <<'EOF'
workflows/wave4-local-byoh/09-implement-cli-command-surface.ts
workflows/wave4-local-byoh/08-implement-interactive-cli-entrypoint.ts
workflows/wave1-runtime/04-implement-failure-diagnosis-engine.ts
workflows/wave1-runtime/05-prove-runtime-environment-orchestration-unblockers.ts
EOF
      ;;
    flight-safe)
      cat > "$QUEUE_FILE" <<'EOF'
workflows/wave10-agent-assistant-adoption/00-execute-agent-assistant-adoption-program.ts
workflows/wave11-flat-layout-collapse/01-collapse-packages-into-src.ts
workflows/wave12-simplified-workflow-cli/01-implement-and-prove-simplified-workflow-cli.ts
workflows/wave12-simplified-workflow-cli/02-prove-no-dead-end-cli.ts
EOF
      ;;
    expanded|*)
      : > "$QUEUE_FILE"
      append_repo_workflows_to_queue
      append_generated_workflows_to_queue
      ;;
  esac
}

queue_count() {
  awk 'NF { count += 1 } END { print count + 0 }' "$QUEUE_FILE"
}

LAST_FILTER_REMOVED_TOTAL=0
LAST_FILTER_REMOVED_MISSING=0
LAST_FILTER_REMOVED_STALE=0
LAST_FILTER_REMOVED_SATISFIED=0
LAST_APPENDED_OMITTED_STALE=0
EXPANDED_PROBE_QUEUE_EXHAUSTED=false
EXPANDED_PROBE_REMOVED_TOTAL=0
EXPANDED_PROBE_REMOVED_MISSING=0
EXPANDED_PROBE_REMOVED_STALE=0
EXPANDED_PROBE_REMOVED_SATISFIED=0
EXPANDED_PROBE_APPENDED_OMITTED_STALE=0

prune_tracked_workflow_file_for_repo_state() {
  local workflow_file="$1"
  local filtered_file="${workflow_file}.filtered.tmp"
  local workflow_path=""

  [[ -f "$workflow_file" ]] || return 0
  : > "$filtered_file"

  while IFS= read -r workflow_path; do
    [[ -n "$workflow_path" ]] || continue

    if [[ ! -f "$workflow_path" ]]; then
      continue
    fi

    if workflow_has_stale_package_targets "$workflow_path"; then
      continue
    fi

    if workflow_is_already_satisfied "$workflow_path"; then
      continue
    fi

    printf '%s\n' "$workflow_path" >> "$filtered_file"
  done < "$workflow_file"

  mv "$filtered_file" "$workflow_file"
}

refresh_state_paths() {
  STATE_ROOT="${RICKY_OVERNIGHT_STATE_DIR:-$STATE_NAMESPACE_ROOT/$QUEUE_MODE}"
  STATE_FILE="$STATE_ROOT/checkpoint.env"
  STATE_LOG="$STATE_ROOT/latest-run.txt"
  mkdir -p "$STATE_ROOT"
}

filter_queue_for_repo_state() {
  local filtered_queue="$ARTIFACT_DIR/queue.filtered.tmp"
  local removed_count=0
  local removed_missing=0
  local removed_stale=0
  local removed_satisfied=0
  local workflow_path=""

  cp "$QUEUE_FILE" "$ARTIFACT_DIR/queue.raw.txt"
  : > "$filtered_queue"

  while IFS= read -r workflow_path; do
    [[ -n "$workflow_path" ]] || continue

    if [[ ! -f "$workflow_path" ]]; then
      log "dropping missing workflow from queue: $workflow_path"
      removed_count=$((removed_count + 1))
      removed_missing=$((removed_missing + 1))
      continue
    fi

    if workflow_has_stale_package_targets "$workflow_path"; then
      printf '%s\n' "$workflow_path" >> "$STALE_FILE"
      log "dropping stale pre-package-split workflow from queue: $workflow_path"
      removed_count=$((removed_count + 1))
      removed_stale=$((removed_stale + 1))
      continue
    fi

    if workflow_is_already_satisfied "$workflow_path"; then
      log "dropping already-satisfied workflow from queue: $workflow_path"
      removed_count=$((removed_count + 1))
      removed_satisfied=$((removed_satisfied + 1))
      continue
    fi

    printf '%s\n' "$workflow_path" >> "$filtered_queue"
  done < "$QUEUE_FILE"

  mv "$filtered_queue" "$QUEUE_FILE"
  prune_tracked_workflow_file_for_repo_state "$FAILED_FILE"
  prune_tracked_workflow_file_for_repo_state "$SKIPPED_FILE"
  LAST_FILTER_REMOVED_TOTAL="$removed_count"
  LAST_FILTER_REMOVED_MISSING="$removed_missing"
  LAST_FILTER_REMOVED_STALE="$removed_stale"
  LAST_FILTER_REMOVED_SATISFIED="$removed_satisfied"
  LAST_APPENDED_OMITTED_STALE="${APPEND_QUEUE_OMITTED_STALE:-0}"
  log "queue prepared with $(queue_count) actionable workflows (${removed_count} removed: stale=${removed_stale}, satisfied=${removed_satisfied}, missing=${removed_missing})"
}

fallback_to_expanded_queue_when_flight_safe_exhausted() {
  local original_queue_mode="$QUEUE_MODE"
  local expanded_queue_count=0

  EXPANDED_PROBE_QUEUE_EXHAUSTED=false
  EXPANDED_PROBE_REMOVED_TOTAL=0
  EXPANDED_PROBE_REMOVED_MISSING=0
  EXPANDED_PROBE_REMOVED_STALE=0
  EXPANDED_PROBE_REMOVED_SATISFIED=0
  EXPANDED_PROBE_APPENDED_OMITTED_STALE=0

  if [[ "$QUEUE_MODE" != "flight-safe" ]]; then
    return 0
  fi

  if (( $(queue_count) > 0 )); then
    return 0
  fi

  log "flight-safe queue is exhausted; probing expanded queue for remaining actionable workflows"
  QUEUE_MODE="expanded"
  refresh_state_paths
  write_queue
  filter_queue_for_repo_state
  expanded_queue_count="$(queue_count)"
  EXPANDED_PROBE_REMOVED_TOTAL="$LAST_FILTER_REMOVED_TOTAL"
  EXPANDED_PROBE_REMOVED_MISSING="$LAST_FILTER_REMOVED_MISSING"
  EXPANDED_PROBE_REMOVED_STALE="$LAST_FILTER_REMOVED_STALE"
  EXPANDED_PROBE_REMOVED_SATISFIED="$LAST_FILTER_REMOVED_SATISFIED"
  EXPANDED_PROBE_APPENDED_OMITTED_STALE="$LAST_APPENDED_OMITTED_STALE"

  if (( expanded_queue_count > 0 )); then
    log "promoting overnight queue mode to expanded for this invocation (${expanded_queue_count} actionable workflows remain)"
    return 0
  fi

  EXPANDED_PROBE_QUEUE_EXHAUSTED=true

  QUEUE_MODE="$original_queue_mode"
  refresh_state_paths
  write_queue
  filter_queue_for_repo_state
  log "expanded queue is also exhausted; keeping queue mode at $QUEUE_MODE"
}

log() {
  printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"
}

sync_repo_with_origin_main_if_safe() {
  local branch=""
  local ahead=0
  local behind=0

  branch="$(git branch --show-current 2>/dev/null || true)"
  if [[ "$branch" != "main" ]]; then
    log "skipping origin/main sync because current branch is ${branch:-detached}"
    return 0
  fi

  if [[ -n "$(git status --porcelain --untracked-files=no -- . ':(exclude)tmp/' ':(exclude).workflow-artifacts/' ':(exclude).trajectories/')" ]]; then
    log "skipping origin/main sync because repo has tracked local meaningful modifications"
    return 0
  fi

  if ! git fetch origin main:refs/remotes/origin/main >/dev/null 2>&1; then
    log "warning: failed to fetch origin/main before queue filtering"
    return 0
  fi

  read -r ahead behind < <(git rev-list --left-right --count HEAD...refs/remotes/origin/main)

  if (( ahead > 0 )); then
    log "skipping origin/main fast-forward because local main has ${ahead} unpushed commit(s)"
    return 0
  fi

  if (( behind == 0 )); then
    log "origin/main sync check: local main already current"
    return 0
  fi

  if git merge --ff-only origin/main >/dev/null 2>&1; then
    log "fast-forwarded local main to origin/main before queue filtering (${behind} commit(s))"
    return 0
  fi

  log "warning: failed to fast-forward local main to origin/main before queue filtering"
}

workflow_has_stale_package_targets() {
  local workflow_path="$1"

  case "$workflow_path" in
    workflows/wave11-flat-layout-collapse/01-collapse-packages-into-src.ts)
      return 1
      ;;
  esac

  grep -Eq "packages/cli/packages/cli/|packages/(shared|runtime|product|cloud|local|cli)/src/" "$workflow_path"
}

artifact_signoff_has_marker() {
  local signoff_path="$1"
  local marker="$2"

  [[ -f "$signoff_path" ]] && grep -q "$marker" "$signoff_path"
}

artifact_review_declares_pass() {
  local review_path="$1"
  local ready_marker="$2"

  [[ -f "$review_path" ]] \
    && grep -q "$ready_marker" "$review_path" \
    && grep -Eq '^(PASS|\*\*PASS\*\*)$' "$review_path" \
    && ! grep -Eq '^(FAIL|\*\*FAIL\*\*)$' "$review_path"
}

append_unique_lines_from_file() {
  local source_file="$1"
  local destination_file="$2"
  local line=""

  [[ -f "$source_file" ]] || return 0

  while IFS= read -r line; do
    [[ -n "$line" ]] || continue
    if [[ ! -f "$destination_file" ]] || ! grep -Fxq "$line" "$destination_file"; then
      printf '%s\n' "$line" >> "$destination_file"
    fi
  done < "$source_file"
}

remove_workflow_from_tracked_file() {
  local workflow_path="$1"
  local tracked_file="$2"
  local filtered_file="${tracked_file}.filtered.tmp"

  [[ -n "$workflow_path" && -f "$tracked_file" ]] || return 0

  grep -Fxv "$workflow_path" "$tracked_file" > "$filtered_file" || true
  mv "$filtered_file" "$tracked_file"
}

workflow_is_already_satisfied() {
  local workflow_path="$1"

  case "$workflow_path" in
    workflows/wave1-runtime/02-workflow-evidence-model.ts)
      artifact_signoff_has_marker \
        .workflow-artifacts/wave1-runtime/workflow-evidence-model/signoff.md \
        'WORKFLOW_EVIDENCE_MODEL_COMPLETE' \
        && artifact_signoff_has_marker \
        .workflow-artifacts/wave1-runtime/workflow-evidence-model/final-review-claude.md \
        'FINAL_REVIEW_CLAUDE_PASS' \
        && artifact_signoff_has_marker \
        .workflow-artifacts/wave1-runtime/workflow-evidence-model/final-review-codex.md \
        'FINAL_REVIEW_CODEX_PASS'
      ;;
    workflows/wave1-runtime/04-implement-failure-diagnosis-engine.ts)
      artifact_signoff_has_marker \
        .workflow-artifacts/wave1-runtime/implement-failure-diagnosis-engine/signoff.md \
        'RICKY_FAILURE_DIAGNOSIS_ENGINE_COMPLETE'
      ;;
    workflows/wave1-runtime/01-local-run-coordinator.ts)
      artifact_signoff_has_marker \
        .workflow-artifacts/wave1-runtime/local-run-coordinator/signoff.md \
        'LOCAL_COORDINATOR_WORKFLOW_COMPLETE' \
        && artifact_signoff_has_marker \
        .workflow-artifacts/wave1-runtime/local-run-coordinator/final-review-claude.md \
        'FINAL_REVIEW_CLAUDE_PASS' \
        && artifact_signoff_has_marker \
        .workflow-artifacts/wave1-runtime/local-run-coordinator/final-review-codex.md \
        'FINAL_REVIEW_CODEX_PASS' \
        && npm run typecheck >/dev/null \
        && npx vitest run src/runtime/local-coordinator.test.ts >/dev/null
      ;;
    workflows/wave1-runtime/03-workflow-failure-classification.ts)
      artifact_signoff_has_marker \
        .workflow-artifacts/wave1-runtime/workflow-failure-classification/signoff.md \
        'WORKFLOW_FAILURE_CLASSIFICATION_COMPLETE' \
        && artifact_signoff_has_marker \
        .workflow-artifacts/wave1-runtime/workflow-failure-classification/final-review-claude.md \
        'FINAL_REVIEW_CLAUDE_PASS' \
        && artifact_signoff_has_marker \
        .workflow-artifacts/wave1-runtime/workflow-failure-classification/final-review-codex.md \
        'FINAL_REVIEW_CODEX_PASS' \
        && npm run typecheck >/dev/null \
        && npx vitest run src/runtime/failure/classifier.test.ts >/dev/null
      ;;
    workflows/wave2-product/04-workflow-validator-specialist.ts)
      artifact_signoff_has_marker \
        .workflow-artifacts/wave2-product/workflow-validator-specialist/signoff.md \
        'WORKFLOW_VALIDATOR_SPECIALIST_COMPLETE' \
        && artifact_signoff_has_marker \
        .workflow-artifacts/wave2-product/workflow-validator-specialist/final-review-claude.md \
        'FINAL_REVIEW_CLAUDE_PASS' \
        && artifact_signoff_has_marker \
        .workflow-artifacts/wave2-product/workflow-validator-specialist/final-review-codex.md \
        'FINAL_REVIEW_CODEX_PASS' \
        && npm run typecheck >/dev/null \
        && npx vitest run src/product/specialists/validator/ >/dev/null
      ;;
    workflows/wave1-runtime/05-prove-runtime-environment-orchestration-unblockers.ts)
      artifact_signoff_has_marker \
        .workflow-artifacts/wave1-runtime/prove-runtime-environment-orchestration-unblockers/signoff.md \
        'RICKY_FAILURE_UNBLOCKER_PROOF_COMPLETE'
      ;;
    workflows/wave4-local-byoh/07-prove-local-spec-handoff-and-artifact-return.ts)
      artifact_signoff_has_marker \
        .workflow-artifacts/wave4-local-byoh/prove-local-spec-handoff-and-artifact-return/signoff.md \
        'LOCAL_BYOH_PROOF_COMPLETE' \
        && git cat-file -e HEAD:src/local/proof/local-entrypoint-proof.ts 2>/dev/null \
        && git cat-file -e HEAD:src/local/proof/local-entrypoint-proof.test.ts 2>/dev/null \
        && npx vitest run src/local/proof/local-entrypoint-proof.test.ts >/dev/null
      ;;
    workflows/wave5-scale-and-ops/01-workflow-health-analytics.ts)
      artifact_signoff_has_marker \
        .workflow-artifacts/wave5-scale-and-ops/workflow-health-analytics/signoff.md \
        'HEALTH_ANALYTICS_WORKFLOW_COMPLETE' \
        && artifact_signoff_has_marker \
        .workflow-artifacts/wave5-scale-and-ops/workflow-health-analytics/final-review-claude.md \
        'FINAL_REVIEW_CLAUDE_PASS' \
        && artifact_signoff_has_marker \
        .workflow-artifacts/wave5-scale-and-ops/workflow-health-analytics/final-review-codex.md \
        'FINAL_REVIEW_CODEX_PASS' \
        && git cat-file -e HEAD:src/product/analytics/health-analyzer.ts 2>/dev/null \
        && git cat-file -e HEAD:src/product/analytics/digest-generator.ts 2>/dev/null \
        && git cat-file -e HEAD:src/product/analytics/types.ts 2>/dev/null \
        && git cat-file -e HEAD:src/product/analytics/health-analyzer.test.ts 2>/dev/null \
        && git cat-file -e HEAD:src/product/analytics/index.ts 2>/dev/null \
        && npm run typecheck >/dev/null \
        && npx vitest run src/product/analytics/health-analyzer.test.ts >/dev/null
      ;;
    workflows/wave4-local-byoh/03-cli-onboarding-ux-spec.ts)
      git cat-file -e HEAD:docs/product/ricky-cli-onboarding-ux-spec.md 2>/dev/null \
        && test -f .workflow-artifacts/wave4-local-byoh/cli-onboarding-ux-spec/plan.md \
        && grep -q 'CLI_UX_SPEC_PLAN_READY' .workflow-artifacts/wave4-local-byoh/cli-onboarding-ux-spec/plan.md
      ;;
    workflows/wave5-scale-and-ops/03-align-ricky-package-conventions.ts)
      test -f package.json \
        && grep -q '"typecheck"' package.json \
        && grep -q '"test"' package.json \
        && ! grep -q 'prpm install @prpm/self-improving' package.json \
        && test -f tsconfig.json \
        && grep -q '"exclude"' tsconfig.json \
        && test -f vitest.config.ts \
        && grep -q '.workflow-artifacts/\*\*' vitest.config.ts \
        && grep -q '.agent-relay/\*\*' vitest.config.ts \
        && test -f .gitignore \
        && grep -q '^dist/$' .gitignore \
        && grep -q '^\.workflow-artifacts/$' .gitignore \
        && grep -q '^\.agent-relay/$' .gitignore \
        && test -f README.md \
        && grep -q 'Ricky is a single-package npm repo' README.md
      ;;
    workflows/wave5-scale-and-ops/04-prove-ricky-package-layout-and-script-parity.ts)
      git cat-file -e HEAD:test/package-proof/package-layout-proof.ts 2>/dev/null \
        && git cat-file -e HEAD:test/package-proof/package-layout-proof.test.ts 2>/dev/null \
        && npm run typecheck >/dev/null \
        && npm test >/dev/null
      ;;
    workflows/wave6-proof/01-close-first-wave-signoff-and-blockers.ts)
      test -f .workflow-artifacts/wave6-proof/close-first-wave-signoff-and-blockers/closure-summary.md \
        && grep -Eq 'Result:\*\* 16/16 SIGNED_OFF, 0 BLOCKED|\*\*Result:\*\* 16/16 SIGNED_OFF, 0 BLOCKED' .workflow-artifacts/wave6-proof/close-first-wave-signoff-and-blockers/closure-summary.md
      ;;
    workflows/wave7-cli-proof/01-implement-cli-ux-spec-conformance.ts)
      artifact_signoff_has_marker \
        .workflow-artifacts/wave7-cli-proof/implement-cli-ux-spec-conformance/signoff.md \
        'CLI_UX_CONFORMANCE_COMPLETE'
      ;;
    workflows/wave7-cli-proof/02-prove-cli-onboarding-command-journeys.ts)
      artifact_signoff_has_marker \
        .workflow-artifacts/wave7-cli-proof/prove-cli-onboarding-command-journeys/signoff.md \
        'CLI_COMMAND_JOURNEY_PROOF_COMPLETE'
      ;;
    workflows/wave7-local-proof/03-prove-local-byoh-spec-to-artifact-loop.ts)
      artifact_signoff_has_marker \
        .workflow-artifacts/wave7-local-proof/prove-local-byoh-spec-to-artifact-loop/signoff.md \
        'LOCAL_SPEC_LOOP_PROOF_COMPLETE'
      ;;
    workflows/wave7-runtime-proof/05-prove-runtime-execution-outcome-loop.ts)
      artifact_signoff_has_marker \
        .workflow-artifacts/wave7-runtime-proof/prove-runtime-execution-outcome-loop/signoff.md \
        'RUNTIME_OUTCOME_PROOF_COMPLETE'
      ;;
    workflows/wave7-recovery/06-implement-environment-recovery-unblockers.ts)
      artifact_signoff_has_marker \
        .workflow-artifacts/wave7-recovery/implement-environment-recovery-unblockers/signoff.md \
        'RECOVERY_UNBLOCKERS_COMPLETE'
      ;;
    workflows/wave7-analytics-proof/07-prove-proof-loop-analytics-feedback.ts)
      artifact_signoff_has_marker \
        .workflow-artifacts/wave7-analytics-proof/prove-proof-loop-analytics-feedback/signoff.md \
        'ANALYTICS_FEEDBACK_COMPLETE'
      ;;
    workflows/wave8-github-issues/01-fix-cli-artifact-path-and-caller-root.ts)
      artifact_signoff_has_marker \
        .workflow-artifacts/wave8-github-issues/fix-cli-artifact-path-and-caller-root/signoff.md \
        'PATH_ROOT_ISSUES_COMPLETE'
      ;;
    workflows/wave8-github-issues/02-prove-external-repo-cli-generation.ts)
      artifact_signoff_has_marker \
        .workflow-artifacts/wave8-github-issues/prove-external-repo-cli-generation/signoff.md \
        'EXTERNAL_REPO_CLI_PROOF_COMPLETE'
      ;;
    workflows/wave8-github-issues/03-close-local-execution-outcome-loop.ts)
      artifact_signoff_has_marker \
        .workflow-artifacts/wave8-github-issues/close-local-execution-outcome-loop/signoff.md \
        'LOCAL_EXECUTION_OUTCOME_LOOP_COMPLETE'
      ;;
    workflows/wave8-github-issues/04-tighten-onboarding-readiness-copy-and-checklist.ts)
      artifact_signoff_has_marker \
        .workflow-artifacts/wave8-github-issues/tighten-onboarding-readiness-copy-and-checklist/signoff.md \
        'READINESS_COPY_AND_CHECKLIST_COMPLETE'
      ;;
    workflows/wave8-github-issues/05-prove-skill-embedding-boundary.ts)
      artifact_signoff_has_marker \
        .workflow-artifacts/wave8-github-issues/prove-skill-embedding-boundary/signoff.md \
        'SKILL_EMBEDDING_BOUNDARY_COMPLETE'
      ;;
    workflows/wave8-github-issues/06-close-local-run-product-loop.ts)
      artifact_signoff_has_marker \
        .workflow-artifacts/wave8-github-issues/close-local-run-product-loop/signoff.md \
        'RICKY_WAVE8_LOCAL_RUN_PRODUCT_LOOP_SIGNOFF'
      ;;
    workflows/wave9-agent-assistant/01-audit-ricky-agent-assistant-usage.ts)
      artifact_signoff_has_marker \
        .workflow-artifacts/wave9-agent-assistant/audit-ricky-agent-assistant-usage/signoff.md \
        'RICKY_AGENT_ASSISTANT_AUDIT_COMPLETE'
      ;;
    workflows/wave9-agent-assistant/02-define-ricky-agent-assistant-boundary.ts)
      artifact_signoff_has_marker \
        .workflow-artifacts/wave9-agent-assistant/define-ricky-agent-assistant-boundary/signoff.md \
        'RICKY_AGENT_ASSISTANT_BOUNDARY_COMPLETE'
      ;;
    workflows/wave9-agent-assistant/03-evaluate-local-execution-contract-for-reuse.ts)
      artifact_signoff_has_marker \
        .workflow-artifacts/wave9-agent-assistant/evaluate-local-execution-contract-for-reuse/signoff.md \
        'RICKY_LOCAL_CONTRACT_REUSE_EVALUATION_COMPLETE'
      ;;
    workflows/wave10-agent-assistant-adoption/00-execute-agent-assistant-adoption-program.ts)
      artifact_signoff_has_marker \
        .workflow-artifacts/wave10-agent-assistant-adoption/executor/signoff.md \
        'WAVE10_AGENT_ASSISTANT_EXECUTOR_COMPLETE'
      ;;
    workflows/wave10-agent-assistant-adoption/01-verify-and-close-wave9-docs.ts)
      artifact_signoff_has_marker \
        .workflow-artifacts/wave10-agent-assistant-adoption/verify-and-close-wave9-docs/signoff.md \
        'WAVE9_AGENT_ASSISTANT_DOC_ISSUES_COMPLETE'
      ;;
    workflows/wave10-agent-assistant-adoption/02-adopt-request-turn-context-adapter.ts)
      git cat-file -e HEAD:src/local/assistant-turn-context-adapter.ts 2>/dev/null \
        && git cat-file -e HEAD:src/local/assistant-turn-context-adapter.test.ts 2>/dev/null \
        && git cat-file -e HEAD:src/local/entrypoint-turn-context-resilience.test.ts 2>/dev/null \
        && grep -q '@agent-assistant/turn-context' src/local/assistant-turn-context-adapter.ts \
        && grep -q 'assembleRickyTurnContext' src/local/entrypoint.ts \
        && npm run typecheck >/dev/null \
        && npx vitest run src/local/assistant-turn-context-adapter.test.ts src/local/entrypoint-turn-context-resilience.test.ts >/dev/null
      ;;
    workflows/wave10-agent-assistant-adoption/03-prove-live-product-path.ts)
      artifact_signoff_has_marker \
        .workflow-artifacts/wave10-agent-assistant-adoption/prove-live-product-path/signoff.md \
        'RICKY_AGENT_ASSISTANT_ADOPTION_LIVE_PROOF_COMPLETE' \
        && artifact_signoff_has_marker \
        .workflow-artifacts/wave10-agent-assistant-adoption/prove-live-product-path/final-review.md \
        'FINAL_REVIEW_PASS' \
        && test -f .workflow-artifacts/wave10-agent-assistant-adoption/prove-live-product-path/adapter-runtime-smoke.json \
        && test -f .workflow-artifacts/wave10-agent-assistant-adoption/prove-live-product-path/external-generate.json \
        && test -f .workflow-artifacts/wave10-agent-assistant-adoption/prove-live-product-path/external-generate-and-run.json \
        && npm run typecheck >/dev/null \
        && npx vitest run src/local src/surfaces/cli >/dev/null
      ;;
    workflows/wave10-agent-assistant-adoption/04-close-agent-assistant-handoff-issue.ts)
      artifact_signoff_has_marker \
        .workflow-artifacts/wave10-agent-assistant-adoption/close-agent-assistant-handoff-issue/signoff.md \
        'RICKY_AGENT_ASSISTANT_HANDOFF_COMPLETE'
      ;;
    workflows/wave3-cloud-api/01-cloud-connect-and-auth.ts)
      artifact_signoff_has_marker \
        .workflow-artifacts/wave3-cloud-api/cloud-connect-and-auth/signoff.md \
        'CLOUD_AUTH_WORKFLOW_COMPLETE' \
        && artifact_signoff_has_marker \
        .workflow-artifacts/wave3-cloud-api/cloud-connect-and-auth/final-review-claude.md \
        'FINAL_REVIEW_CLAUDE_PASS' \
        && artifact_signoff_has_marker \
        .workflow-artifacts/wave3-cloud-api/cloud-connect-and-auth/final-review-codex.md \
        'FINAL_REVIEW_CODEX_PASS' \
        && npm run typecheck >/dev/null \
        && npx vitest run src/cloud/auth/ >/dev/null
      ;;
    workflows/wave3-cloud-api/02-generate-endpoint.ts)
      artifact_signoff_has_marker \
        .workflow-artifacts/wave3-cloud-api/generate-endpoint/signoff.md \
        'GENERATE_ENDPOINT_WORKFLOW_COMPLETE' \
        && artifact_signoff_has_marker \
        .workflow-artifacts/wave3-cloud-api/generate-endpoint/final-review-claude.md \
        'FINAL_REVIEW_CLAUDE_PASS' \
        && artifact_signoff_has_marker \
        .workflow-artifacts/wave3-cloud-api/generate-endpoint/final-review-codex.md \
        'FINAL_REVIEW_CODEX_PASS' \
        && npm run typecheck >/dev/null \
        && npx vitest run src/cloud/api/proof/cloud-generate-proof.test.ts src/cloud/api/generate-endpoint.test.ts >/dev/null
      ;;
    workflows/wave3-cloud-api/03-implement-ricky-cloud-generate-slice.ts)
      artifact_signoff_has_marker \
        .workflow-artifacts/wave3-cloud-api/implement-ricky-cloud-generate-slice/signoff.md \
        'RICKY_CLOUD_GENERATE_SLICE_COMPLETE' \
        && artifact_signoff_has_marker \
        .workflow-artifacts/wave3-cloud-api/implement-ricky-cloud-generate-slice/final-review-claude.md \
        'FINAL_REVIEW_CLAUDE_PASS' \
        && artifact_signoff_has_marker \
        .workflow-artifacts/wave3-cloud-api/implement-ricky-cloud-generate-slice/final-review-codex.md \
        'FINAL_REVIEW_CODEX_PASS' \
        && npm run typecheck >/dev/null \
        && npx vitest run src/cloud/api/proof/cloud-generate-proof.test.ts src/cloud/api/generate-endpoint.test.ts >/dev/null
      ;;
    workflows/wave3-cloud-api/04-prove-cloud-connect-and-generate-happy-path.ts)
      artifact_signoff_has_marker \
        .workflow-artifacts/wave3-cloud-api/prove-cloud-connect-and-generate-happy-path/signoff.md \
        'RICKY_CLOUD_PROOF_COMPLETE' \
        && artifact_signoff_has_marker \
        .workflow-artifacts/wave3-cloud-api/prove-cloud-connect-and-generate-happy-path/final-review-claude.md \
        'FINAL_REVIEW_CLAUDE_PASS' \
        && artifact_signoff_has_marker \
        .workflow-artifacts/wave3-cloud-api/prove-cloud-connect-and-generate-happy-path/final-review-codex.md \
        'FINAL_REVIEW_CODEX_PASS' \
        && npm run typecheck >/dev/null \
        && npx vitest run src/cloud/auth/ src/cloud/api/proof/cloud-generate-proof.test.ts src/cloud/api/generate-endpoint.test.ts >/dev/null
      ;;
    workflows/wave4-local-byoh/01-cli-onboarding-and-welcome.ts)
      artifact_signoff_has_marker \
        .workflow-artifacts/wave4-local-byoh/cli-onboarding-and-welcome/signoff.md \
        'CLI_ONBOARDING_WORKFLOW_COMPLETE'
      ;;
    workflows/wave0-foundation/01-repo-standards-and-conventions.ts)
      artifact_signoff_has_marker \
        .workflow-artifacts/wave0-foundation/repo-standards/signoff.md \
        'W0_REPO_STANDARDS_WORKFLOW_COMPLETE' \
        && artifact_signoff_has_marker \
        .workflow-artifacts/wave0-foundation/repo-standards/final-review.md \
        'REVIEW_REPO_STANDARDS_PASS' \
        && test -f AGENTS.md \
        && test -f CLAUDE.md \
        && test -f workflows/README.md \
        && test -f workflows/shared/WORKFLOW_AUTHORING_RULES.md \
        && grep -Eiq 'workflow standards|deterministic gates|wave' AGENTS.md \
        && grep -Eiq 'workflow standards|deterministic gates|wave' CLAUDE.md \
        && grep -Eiq 'wf-ricky|deterministic|review' workflows/README.md \
        && grep -Eq 'Must-do|Must-not' workflows/shared/WORKFLOW_AUTHORING_RULES.md
      ;;
    workflows/wave0-foundation/02-toolchain-and-validation-foundation.ts)
      test -f package.json \
        && test -f tsconfig.json \
        && test -f vitest.config.ts \
        && test -f test/setup.ts \
        && grep -q '"typecheck"' package.json \
        && grep -q '"test"' package.json \
        && grep -q 'typescript' package.json \
        && grep -q 'vitest' package.json \
        && npm run typecheck >/dev/null \
        && npm test >/dev/null
      ;;
    workflows/wave4-local-byoh/02-local-invocation-entrypoint.ts)
      artifact_signoff_has_marker \
        .workflow-artifacts/wave4-local-byoh/local-invocation-entrypoint/signoff.md \
        'LOCAL_ENTRYPOINT_WORKFLOW_COMPLETE' \
        && artifact_signoff_has_marker \
        .workflow-artifacts/wave4-local-byoh/local-invocation-entrypoint/final-review-claude.md \
        'FINAL_REVIEW_CLAUDE_PASS' \
        && artifact_signoff_has_marker \
        .workflow-artifacts/wave4-local-byoh/local-invocation-entrypoint/final-review-codex.md \
        'FINAL_REVIEW_CODEX_PASS' \
        && git cat-file -e HEAD:src/local/entrypoint.ts 2>/dev/null \
        && git cat-file -e HEAD:src/local/entrypoint.test.ts 2>/dev/null \
        && git cat-file -e HEAD:src/local/proof/local-entrypoint-proof.test.ts 2>/dev/null \
        && npm run typecheck >/dev/null \
        && npx vitest run src/local/entrypoint.test.ts src/local/proof/local-entrypoint-proof.test.ts src/local/entrypoint-turn-context-resilience.test.ts >/dev/null
      ;;
    workflows/wave4-local-byoh/04-implement-cli-onboarding-from-ux-spec.ts)
      artifact_signoff_has_marker \
        .workflow-artifacts/wave4-local-byoh/implement-cli-onboarding-from-ux-spec/signoff.md \
        'CLI_ONBOARDING_IMPL_COMPLETE'
      ;;
    workflows/wave4-local-byoh/06-implement-local-byoh-entrypoint.ts)
      artifact_signoff_has_marker \
        .workflow-artifacts/wave4-local-byoh/implement-local-byoh-entrypoint/signoff.md \
        'LOCAL_BYOH_ENTRYPOINT_COMPLETE'
      ;;
    workflows/wave0-foundation/04-initial-architecture-docs.ts)
      artifact_signoff_has_marker \
        .workflow-artifacts/wave0-foundation/architecture-docs/signoff.md \
        'W0_ARCHITECTURE_DOCS_WORKFLOW_COMPLETE'
      ;;
    workflows/wave2-product/01-workflow-spec-intake.ts)
      artifact_signoff_has_marker \
        .workflow-artifacts/wave2-product/workflow-spec-intake/signoff.md \
        'WORKFLOW_SPEC_INTAKE_COMPLETE' \
        && artifact_signoff_has_marker \
        .workflow-artifacts/wave2-product/workflow-spec-intake/final-review-claude.md \
        'FINAL_REVIEW_CLAUDE_PASS' \
        && artifact_signoff_has_marker \
        .workflow-artifacts/wave2-product/workflow-spec-intake/final-review-codex.md \
        'FINAL_REVIEW_CODEX_PASS' \
        && npm run typecheck >/dev/null \
        && npx vitest run src/product/spec-intake/ >/dev/null
      ;;
    workflows/wave2-product/02-workflow-generation-pipeline.ts)
      artifact_signoff_has_marker \
        .workflow-artifacts/wave2-product/workflow-generation-pipeline/fix-loop.md \
        'GENERATION_PIPELINE_FIX_LOOP_COMPLETE' \
        && artifact_signoff_has_marker \
        .workflow-artifacts/wave2-product/workflow-generation-pipeline/final-review-claude.md \
        'FINAL_REVIEW_CLAUDE_PASS' \
        && artifact_signoff_has_marker \
        .workflow-artifacts/wave2-product/workflow-generation-pipeline/final-review-codex.md \
        'FINAL_REVIEW_CODEX_PASS'
      ;;
    workflows/wave2-product/03-workflow-debugger-specialist.ts)
      artifact_signoff_has_marker \
        .workflow-artifacts/wave2-product/workflow-debugger-specialist/fix-loop.md \
        'DEBUGGER_SPECIALIST_FIX_LOOP_COMPLETE' \
        && artifact_signoff_has_marker \
        .workflow-artifacts/wave2-product/workflow-debugger-specialist/final-review-claude.md \
        'FINAL_REVIEW_CLAUDE_PASS' \
        && artifact_signoff_has_marker \
        .workflow-artifacts/wave2-product/workflow-debugger-specialist/final-review-codex.md \
        'FINAL_REVIEW_CODEX_PASS'
      ;;
    workflows/wave4-local-byoh/08-implement-interactive-cli-entrypoint.ts)
      git cat-file -e HEAD:src/surfaces/cli/entrypoint/interactive-cli.ts 2>/dev/null \
        && git cat-file -e HEAD:src/surfaces/cli/entrypoint/interactive-cli.test.ts 2>/dev/null \
        && git cat-file -e HEAD:src/surfaces/cli/entrypoint/index.ts 2>/dev/null \
        && grep -Eq 'runOnboarding|runLocal|handleCloudGenerate|diagnose' src/surfaces/cli/entrypoint/interactive-cli.ts
      ;;
    workflows/wave4-local-byoh/09-implement-cli-command-surface.ts)
      git cat-file -e HEAD:src/surfaces/cli/commands/cli-main.ts 2>/dev/null \
        && git cat-file -e HEAD:src/surfaces/cli/commands/cli-main.test.ts 2>/dev/null \
        && git cat-file -e HEAD:src/surfaces/cli/commands/index.ts 2>/dev/null \
        && grep -Eq 'help|mode|interactive|runInteractiveCli' src/surfaces/cli/commands/cli-main.ts src/surfaces/cli/commands/cli-main.test.ts \
        && grep -q '"bin"' package.json \
        && grep -q '"start"' package.json \
        && npm run typecheck >/dev/null \
        && npx vitest run src/surfaces/cli/commands/cli-main.test.ts src/surfaces/cli/entrypoint/interactive-cli.test.ts >/dev/null
      ;;
    workflows/wave11-flat-layout-collapse/01-collapse-packages-into-src.ts)
      git cat-file -e HEAD:test/flat-layout-proof/flat-layout-proof.ts 2>/dev/null \
        && git cat-file -e HEAD:test/flat-layout-proof/flat-layout-proof.test.ts 2>/dev/null \
        && git cat-file -e HEAD:src/shared/index.ts 2>/dev/null \
        && git cat-file -e HEAD:src/runtime/index.ts 2>/dev/null \
        && git cat-file -e HEAD:src/product/index.ts 2>/dev/null \
        && git cat-file -e HEAD:src/cloud/index.ts 2>/dev/null \
        && git cat-file -e HEAD:src/local/index.ts 2>/dev/null \
        && git cat-file -e HEAD:src/surfaces/cli/index.ts 2>/dev/null \
        && ! git ls-tree -r --name-only HEAD packages | grep -q . \
        && ! grep -q '"workspaces"' package.json \
        && ! grep -q 'packages/' vitest.config.ts
      ;;
    workflows/wave12-simplified-workflow-cli/01-implement-and-prove-simplified-workflow-cli.ts)
      artifact_signoff_has_marker \
        .workflow-artifacts/wave12-simplified-workflow-cli/implement-and-prove/signoff.md \
        'SIMPLIFIED_WORKFLOW_CLI_100_PERCENT_COMPLETE' \
      || {
        artifact_signoff_has_marker \
          .workflow-artifacts/wave12-simplified-workflow-cli/no-dead-end-proof/signoff.md \
          'NO_DEAD_END_SIGNOFF_COMPLETE' \
        && git cat-file -e HEAD:src/surfaces/cli/prompts/index.ts 2>/dev/null \
        && git cat-file -e HEAD:src/surfaces/cli/flows/local-workflow-flow.ts 2>/dev/null \
        && git cat-file -e HEAD:src/surfaces/cli/flows/cloud-workflow-flow.ts 2>/dev/null \
        && git cat-file -e HEAD:src/surfaces/cli/flows/power-user-parser.ts 2>/dev/null \
        && git cat-file -e HEAD:src/product/generation/workforce-persona-writer.ts 2>/dev/null \
        && git cat-file -e HEAD:src/surfaces/cli/entrypoint/interactive-cli.test.ts 2>/dev/null \
        && git cat-file -e HEAD:src/surfaces/cli/commands/cli-main.test.ts 2>/dev/null \
        && git cat-file -e HEAD:test/simplified-workflow-cli.e2e.test.ts 2>/dev/null \
        && grep -q '"@inquirer/prompts"' package.json
      }
      ;;
    workflows/wave12-simplified-workflow-cli/02-prove-no-dead-end-cli.ts)
      artifact_signoff_has_marker \
        .workflow-artifacts/wave12-simplified-workflow-cli/no-dead-end-proof/signoff.md \
        'NO_DEAD_END_SIGNOFF_COMPLETE'
      ;;
    workflows/wave13-master-executor/01-implement-master-executor-planner.ts)
      artifact_signoff_has_marker \
        .workflow-artifacts/wave13-master-executor/implement-master-executor/signoff.md \
        'RICKY_MASTER_EXECUTOR_IMPLEMENTED' \
        && artifact_review_declares_pass \
        .workflow-artifacts/wave13-master-executor/implement-master-executor/review-claude.md \
        'RICKY_MASTER_EXECUTOR_CLAUDE_REVIEW_READY' \
        && artifact_review_declares_pass \
        .workflow-artifacts/wave13-master-executor/implement-master-executor/review-codex.md \
        'RICKY_MASTER_EXECUTOR_CODEX_REVIEW_READY' \
        && test -f src/product/orchestration/types.ts \
        && test -f src/product/orchestration/planner.ts \
        && test -f src/product/orchestration/master-executor.ts \
        && test -f src/product/orchestration/index.ts \
        && test -f src/product/orchestration/master-executor.test.ts \
        && grep -q "export \* as orchestration from './orchestration/index.js'" src/product/index.ts \
        && npm run typecheck >/dev/null \
        && npx vitest run src/product/orchestration/master-executor.test.ts >/dev/null
      ;;
    workflows/generated/ricky-i-want-to-clean-up-the-codebase-to-remove-outdat.ts)
      artifact_signoff_has_marker \
        .workflow-artifacts/generated/i-want-to-clean-up-the-codebase-to-remove-outdat/signoff.md \
        'GENERATED_WORKFLOW_READY' \
        && git cat-file -e HEAD:test/flat-layout-proof/flat-layout-proof.ts 2>/dev/null \
        && git cat-file -e HEAD:test/flat-layout-proof/flat-layout-proof.test.ts 2>/dev/null \
        && grep -q 'obsolete workspace-split artifacts checked:' test/flat-layout-proof/flat-layout-proof.ts \
        && grep -q 'active references to obsolete workspace-split artifacts:' test/flat-layout-proof/flat-layout-proof.ts
      ;;
    *)
      return 1
      ;;
  esac
}

is_pid_running() {
  local pid="$1"

  [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null
}

is_process_group_running() {
  local pgid="$1"

  [[ -n "$pgid" ]] && kill -0 -- "-$pgid" 2>/dev/null
}

persist_checkpoint() {
  cat > "$CHECKPOINT_FILE" <<EOF
queue_mode=$(printf '%q' "$QUEUE_MODE")
current_pass=$(printf '%q' "$CURRENT_PASS")
current_index=$(printf '%q' "$CURRENT_INDEX")
workflows_run=$(printf '%q' "$WORKFLOWS_RUN")
artifact_dir=$(printf '%q' "$ARTIFACT_DIR")
initial_git_head=$(printf '%q' "$INITIAL_GIT_HEAD")
current_workflow=$(printf '%q' "$CURRENT_WORKFLOW")
run_pid=$(printf '%q' "$RUN_PID")
run_pgid=$(printf '%q' "$RUN_PGID")
updated_at=$(printf '%q' "$(date '+%Y-%m-%dT%H:%M:%S%z')")
EOF
  cp "$CHECKPOINT_FILE" "$STATE_FILE"
  printf '%s\n' "$ARTIFACT_DIR" > "$STATE_LOG"
}

resolve_resume_checkpoint_file() {
  local fallback_state_file="$STATE_FILE"
  local candidate=""
  local newest_file=""
  local newest_epoch="0"
  local fallback_queue_mode=""
  local candidate_epoch="0"

  if [[ -f "$fallback_state_file" ]]; then
    fallback_queue_mode="$(awk -F= '/^queue_mode=/{print $2; exit}' "$fallback_state_file" 2>/dev/null || true)"
    fallback_queue_mode="${fallback_queue_mode//\'/}"
    fallback_queue_mode="${fallback_queue_mode//\"/}"
  fi

  for candidate in "$GLOBAL_STATE_ROOT"/*/checkpoint.env; do
    [[ -f "$candidate" ]] || continue
    candidate_epoch="$(stat -f '%m' "$candidate" 2>/dev/null || printf '0')"
    if [[ ! "$candidate_epoch" =~ ^[0-9]+$ ]]; then
      candidate_epoch="0"
    fi
    if (( candidate_epoch >= newest_epoch )); then
      newest_epoch="$candidate_epoch"
      newest_file="$candidate"
    fi
  done

  if [[ -f "$fallback_state_file" && "$fallback_queue_mode" == "$QUEUE_MODE" && "$fallback_state_file" == "$newest_file" ]]; then
    printf '%s\n' "$fallback_state_file"
    return 0
  fi

  if [[ -f "$fallback_state_file" && "$fallback_queue_mode" == "$QUEUE_MODE" && -z "$newest_file" ]]; then
    printf '%s\n' "$fallback_state_file"
    return 0
  fi

  if [[ -n "$newest_file" && "$newest_file" != "$fallback_state_file" ]]; then
    if [[ -f "$fallback_state_file" ]]; then
      if [[ -n "$fallback_queue_mode" && "$fallback_queue_mode" != "$QUEUE_MODE" ]]; then
        log "resume requested for $QUEUE_MODE but checkpoint state has migrated to $fallback_queue_mode; using latest checkpoint $newest_file instead of mismatched $fallback_state_file" >&2
      else
        log "resume requested for $QUEUE_MODE but a newer checkpoint exists; using latest checkpoint $newest_file instead of stale $fallback_state_file" >&2
      fi
    else
      log "resume requested with no $QUEUE_MODE checkpoint; using latest checkpoint $newest_file" >&2
    fi
    printf '%s\n' "$newest_file"
    return 0
  fi

  if [[ -f "$fallback_state_file" ]]; then
    printf '%s\n' "$fallback_state_file"
    return 0
  fi

  return 1
}

restore_checkpoint() {
  local resume_checkpoint_file=""

  if [[ "$RESUME_FLAG" != "--resume" ]]; then
    return 0
  fi

  if ! resume_checkpoint_file="$(resolve_resume_checkpoint_file)"; then
    log "resume requested but no checkpoint exists for queue mode $QUEUE_MODE"
    return 0
  fi

  log "restoring checkpoint from $resume_checkpoint_file"

  local restored_queue_mode=""
  local restored_current_pass=""
  local restored_current_index=""
  local restored_workflows_run=""
  local restored_artifact_dir=""
  local restored_initial_git_head=""
  local restored_current_workflow=""
  local restored_run_pid=""
  local restored_run_pgid=""

  while IFS='=' read -r key raw_value; do
    [[ "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || continue
    value="$(printf '%b' "${raw_value//\\/\\\\}")"
    eval "value=$raw_value" 2>/dev/null || value="$raw_value"
    case "$key" in
      queue_mode) restored_queue_mode="$value" ;;
      current_pass) restored_current_pass="$value" ;;
      current_index) restored_current_index="$value" ;;
      workflows_run) restored_workflows_run="$value" ;;
      artifact_dir) restored_artifact_dir="$value" ;;
      initial_git_head) restored_initial_git_head="$value" ;;
      current_workflow) restored_current_workflow="$value" ;;
      run_pid) restored_run_pid="$value" ;;
      run_pgid) restored_run_pgid="$value" ;;
    esac
  done < "$resume_checkpoint_file"

  local previous_artifact_dir="${restored_artifact_dir:-}"
  local previous_status_file=""
  local previous_failed_file=""
  local previous_skipped_file=""
  local previous_pid="${restored_run_pid:-}"
  local previous_pgid="${restored_run_pgid:-}"
  if [[ -n "$previous_artifact_dir" ]]; then
    previous_status_file="$previous_artifact_dir/status.txt"
    previous_failed_file="$previous_artifact_dir/failed.txt"
    previous_skipped_file="$previous_artifact_dir/skipped.txt"
  fi
  append_unique_lines_from_file "$previous_failed_file" "$FAILED_FILE"
  append_unique_lines_from_file "$previous_skipped_file" "$SKIPPED_FILE"
  if [[ -n "$previous_status_file" && -f "$previous_status_file" ]] && grep -Eqx 'running|checkpointed' "$previous_status_file"; then
    if ! is_pid_running "$previous_pid" && ! is_process_group_running "$previous_pgid"; then
      mark_artifact_stale_or_complete "$previous_artifact_dir"
      restore_quarantined_runtime_state_for_artifact "$previous_artifact_dir"
      log "reconciled prior overnight artifact with no live process: $previous_artifact_dir"
    fi
  fi

  if [[ -n "$restored_queue_mode" ]]; then
    QUEUE_MODE="$restored_queue_mode"
    refresh_state_paths
  fi
  CURRENT_PASS="${restored_current_pass:-1}"
  CURRENT_INDEX="${restored_current_index:-0}"
  RESTORED_CURRENT_PASS="$CURRENT_PASS"
  RESTORED_CURRENT_INDEX="$CURRENT_INDEX"
  RESTORED_ARTIFACT_DIR="${previous_artifact_dir:-}"
  RESTORED_QUEUE_FILE=""
  if [[ -n "$RESTORED_ARTIFACT_DIR" ]]; then
    RESTORED_QUEUE_FILE="$RESTORED_ARTIFACT_DIR/queue.txt"
  fi
  # `workflows_run` is an invocation-local chunk counter. Restoring it across
  # `--resume` causes a fresh invocation to immediately checkpoint again once it
  # reaches the prior chunk limit, without running the next queued workflow.
  WORKFLOWS_RUN=0
  CURRENT_WORKFLOW="${restored_current_workflow:-}"
  INITIAL_GIT_HEAD="${restored_initial_git_head:-}"
}

resume_remaining_queue_from_checkpoint() {
  if [[ "$RESUME_FLAG" != "--resume" ]]; then
    return 0
  fi

  if (( $(queue_count) == 0 )); then
    log "skipping checkpoint queue resume because the freshly prepared queue is empty"
    return 0
  fi

  if [[ -z "$RESTORED_QUEUE_FILE" || ! -f "$RESTORED_QUEUE_FILE" ]]; then
    return 0
  fi

  local restored_index="${RESTORED_CURRENT_INDEX:-0}"
  if [[ ! "$restored_index" =~ ^[0-9]+$ ]] || (( restored_index < 0 )); then
    restored_index=0
  fi

  local start_line="$((restored_index + 1))"
  local resumed_queue="$ARTIFACT_DIR/queue.resumed.tmp"
  local merged_queue="$ARTIFACT_DIR/queue.merged.tmp"
  local current_queue_snapshot="$ARTIFACT_DIR/queue.current.tmp"
  cp "$QUEUE_FILE" "$current_queue_snapshot"
  tail -n +"$start_line" "$RESTORED_QUEUE_FILE" > "$resumed_queue"
  cat "$resumed_queue" "$current_queue_snapshot" | awk 'NF && !seen[$0]++' > "$merged_queue"
  mv "$merged_queue" "$QUEUE_FILE"
  rm -f "$resumed_queue" "$current_queue_snapshot"
  filter_queue_for_repo_state

  CURRENT_PASS="${RESTORED_CURRENT_PASS:-1}"
  CURRENT_INDEX=0

  log "resumed remaining queue from prior artifact and merged with freshly prepared queue: $RESTORED_QUEUE_FILE (starting at saved index $restored_index)"
}

write_summary() {
  local status="$1"
  local queue_total elapsed_seconds elapsed_hours summary_checkpoint_file
  queue_total="$(queue_count)"
  elapsed_seconds="$(( $(date +%s) - START_EPOCH ))"
  elapsed_hours="$(awk -v seconds="$elapsed_seconds" 'BEGIN { printf "%.2f", seconds / 3600 }')"
  summary_checkpoint_file="$STATE_FILE"
  if [[ ! -f "$summary_checkpoint_file" ]]; then
    summary_checkpoint_file="cleared on completion"
  fi
  cat > "$SUMMARY_FILE" <<EOF
# Ricky overnight run

- status: $status
- reason: ${STATUS_REASON:-n/a}
- started: $(date -r "$START_EPOCH" '+%Y-%m-%d %H:%M:%S %Z')
- current: $(date '+%Y-%m-%d %H:%M:%S %Z')
- duration_hours: $elapsed_hours
- elapsed_seconds: $elapsed_seconds
- configured_duration_hours: $DURATION_HOURS
- passes: $PASSES
- queue_mode: $QUEUE_MODE
- max_workflows_per_invocation: $MAX_WORKFLOWS_PER_INVOCATION
- queue_total: $queue_total
- current_pass: $CURRENT_PASS
- current_index: $CURRENT_INDEX
- workflows_run_this_invocation: $WORKFLOWS_RUN
- artifact_dir: $ARTIFACT_DIR
- checkpoint_file: $summary_checkpoint_file
- last_commit: $(cat "$LAST_COMMIT_FILE" 2>/dev/null || echo unknown)
- queue_filter_removed_total: ${LAST_FILTER_REMOVED_TOTAL:-0}
- queue_filter_removed_stale: ${LAST_FILTER_REMOVED_STALE:-0}
- queue_filter_removed_satisfied: ${LAST_FILTER_REMOVED_SATISFIED:-0}
- queue_filter_removed_missing: ${LAST_FILTER_REMOVED_MISSING:-0}
- queue_append_omitted_stale: ${LAST_APPENDED_OMITTED_STALE:-0}
- stale_workflows:
$(sort -u "$STALE_FILE" 2>/dev/null | sed 's/^/  - /' || true)
- failed_workflows:
$(sed 's/^/  - /' "$FAILED_FILE" 2>/dev/null || true)
- skipped_workflows:
$(sed 's/^/  - /' "$SKIPPED_FILE" 2>/dev/null || true)
EOF
}

prune_empty_artifact_marker_files() {
  local marker_file=""

  for marker_file in "$FAILED_FILE" "$SKIPPED_FILE" "$STALE_FILE"; do
    [[ -f "$marker_file" && ! -s "$marker_file" ]] && rm -f "$marker_file"
  done
}

mark_status() {
  local status="$1"
  STATUS_REASON="${2:-}"
  echo "$status" > "$STATUS_FILE"
  STATUS_MARKED="true"
  persist_checkpoint
  write_summary "$status"
  prune_empty_artifact_marker_files
}

validate_repo() {
  log "running repo validation"
  npm run typecheck
  npm test
}

capture_meaningful_git_status() {
  git status --short -- . ':(exclude)tmp/' ':(exclude).workflow-artifacts/' ':(exclude).trajectories/'
}

capture_meaningful_git_diff_stat() {
  git diff --stat -- . ':(exclude)tmp/' ':(exclude).workflow-artifacts/' ':(exclude).trajectories/' || true
}

meaningful_tracked_delta_exists() {
  ! git diff --quiet -- . ':(exclude)tmp/' ':(exclude).workflow-artifacts/' ':(exclude).trajectories/'
}

meaningful_untracked_delta_exists() {
  [[ -n "$(git ls-files --others --exclude-standard -- ':!tmp/' ':!.workflow-artifacts/' ':!.trajectories/')" ]]
}

inspect_repo_changes() {
  log "capturing repo status"
  capture_meaningful_git_status > "$ARTIFACT_DIR/git-status.txt"
  capture_meaningful_git_diff_stat > "$ARTIFACT_DIR/git-diff-stat.txt"

  if [[ -s "$ARTIFACT_DIR/git-status.txt" ]]; then
    cat "$ARTIFACT_DIR/git-status.txt"
  fi

  if [[ -s "$ARTIFACT_DIR/git-diff-stat.txt" ]]; then
    cat "$ARTIFACT_DIR/git-diff-stat.txt"
  fi
}

repo_has_captured_head_delta() {
  local baseline=""
  local current_head=""

  if [[ -f "$LAST_COMMIT_FILE" ]]; then
    baseline="$(cat "$LAST_COMMIT_FILE" 2>/dev/null || true)"
  fi

  if [[ -z "$baseline" ]]; then
    baseline="$INITIAL_GIT_HEAD"
  fi

  current_head="$(git rev-parse HEAD 2>/dev/null || true)"
  [[ -n "$baseline" && -n "$current_head" && "$current_head" != "$baseline" ]]
}

repo_has_meaningful_delta() {
  meaningful_tracked_delta_exists || meaningful_untracked_delta_exists || repo_has_captured_head_delta
}

commit_if_clean_delta() {
  local workflow_path="$1"
  local push_output_file="$ARTIFACT_DIR/git-push.txt"
  local ahead="0"
  local behind="0"

  if ! repo_has_meaningful_delta; then
    log "no tracked/untracked repo delta after $workflow_path"
    return 0
  fi

  validate_repo

  local short
  local head_advanced="false"
  short="$(basename "$workflow_path" .ts)"
  if repo_has_captured_head_delta; then
    head_advanced="true"
  fi

  if meaningful_tracked_delta_exists || meaningful_untracked_delta_exists; then
    git add -A ':!tmp/' ':!.workflow-artifacts/' ':!.trajectories/'
    git commit -m "chore(overnight): capture $short progress" || true
  elif [[ "$head_advanced" == "true" ]]; then
    log "repo HEAD already advanced during $workflow_path; capturing committed state"
  fi

  : > "$push_output_file"
  if ! git push origin main >"$push_output_file" 2>&1; then
    cat "$push_output_file" >&2 || true
    git fetch origin main:refs/remotes/origin/main >/dev/null 2>&1 || true
    if git show-ref --verify --quiet refs/remotes/origin/main; then
      read -r ahead behind < <(git rev-list --left-right --count HEAD...refs/remotes/origin/main)
      log "push rejected after $workflow_path; local main diverged from origin/main (ahead=${ahead}, behind=${behind})"
    else
      log "push rejected after $workflow_path; unable to read refs/remotes/origin/main for divergence details"
    fi
    inspect_repo_changes
    return 1
  fi

  git rev-parse HEAD > "$LAST_COMMIT_FILE"
  inspect_repo_changes
}

workflow_hit_claude_rate_limit() {
  local output_file="$1"
  local pattern

  [[ -f "$output_file" ]] || return 1

  for pattern in "${CLAUDE_RATE_LIMIT_PATTERNS[@]}"; do
    if grep -Fq "$pattern" "$output_file"; then
      return 0
    fi
  done

  return 1
}

workflow_log_shows_failure() {
  local output_file="$1"

  [[ -f "$output_file" ]] || return 1

  grep -Eq '^\[workflow\] FAILED:| ✗ .*— FAILED:|OWNER_DECISION: FAIL|FINAL_DECISION: FAIL' "$output_file"
}

runner_output_idle_for_too_long() {
  local last_progress_epoch="$1"
  local now_epoch="$2"

  (( now_epoch - last_progress_epoch >= IDLE_TIMEOUT_SECONDS ))
}

runner_output_has_meaningful_progress() {
  local output_file="$1"
  local previous_size="$2"
  local current_size="$3"
  local chunk=""

  [[ -f "$output_file" ]] || return 1
  (( current_size > previous_size )) || return 1

  chunk="$(tail -c +$((previous_size + 1)) "$output_file" 2>/dev/null || true)"
  [[ -n "$chunk" ]] || return 1

  printf '%s' "$chunk" | grep -Ev '^[[:space:]]*$|^\[workflow [0-9:]+\] \[[^]]+\] still running \([0-9]+s\)$' | grep -q .
}

runner_output_size() {
  local output_file="$1"

  [[ -f "$output_file" ]] || {
    echo 0
    return 0
  }

  wc -c < "$output_file" | tr -d '[:space:]'
}

start_runner() {
  local workflow_path="$1"
  local runner_output="$2"
  local runner_pid_file="$ARTIFACT_DIR/runner.pid"
  local launched_pid=""

  RUNNER_EXPECTS_DETACHED_PGID="false"
  RUNNER_WAIT_PID=""
  rm -f "$runner_pid_file"

  if command -v setsid >/dev/null 2>&1; then
    RUNNER_EXPECTS_DETACHED_PGID="true"
    setsid "$RUNNER" run "$workflow_path" > >(tee -a "$runner_output") 2>&1 &
    RUNNER_START_PID="$!"
    RUNNER_WAIT_PID="$RUNNER_START_PID"
    return 0
  elif command -v python3 >/dev/null 2>&1; then
    RUNNER_EXPECTS_DETACHED_PGID="true"
    log "setsid unavailable; detaching runner via python3 subprocess fallback" >&2
    python3 - "$RUNNER" "$workflow_path" "$runner_output" "$runner_pid_file" <<'PY' &
import subprocess
import sys

runner, workflow_path, runner_output, runner_pid_file = sys.argv[1:5]
with open(runner_output, 'ab', buffering=0) as stream:
    proc = subprocess.Popen(
        [runner, 'run', workflow_path],
        stdin=subprocess.DEVNULL,
        stdout=stream,
        stderr=subprocess.STDOUT,
        start_new_session=True,
        close_fds=True,
    )
with open(runner_pid_file, 'w', encoding='utf-8') as handle:
    handle.write(f"{proc.pid}\n")
raise SystemExit(proc.wait())
PY
    RUNNER_WAIT_PID="$!"
  elif command -v perl >/dev/null 2>&1; then
    RUNNER_EXPECTS_DETACHED_PGID="true"
    log "setsid unavailable; detaching runner via perl subprocess fallback" >&2
    perl -e 'use strict; use warnings; use POSIX qw(setsid); my ($runner, $workflow, $output, $pidfile) = @ARGV; my $pid = fork(); die "fork: $!" unless defined $pid; if ($pid == 0) { setsid() or die "setsid: $!"; open STDIN, q{<}, q{/dev/null} or die "stdin: $!"; open my $fh, q{>>}, $output or die "open $output: $!"; open STDOUT, q{>&}, $fh or die "dup stdout: $!"; open STDERR, q{>&}, $fh or die "dup stderr: $!"; exec {$runner} $runner, q{run}, $workflow or die "exec $runner: $!"; } open my $pidfh, q{>}, $pidfile or die "open $pidfile: $!"; print {$pidfh} "$pid\n"; close $pidfh or die "close $pidfile: $!"; waitpid($pid, 0); exit($? >> 8);' "$RUNNER" "$workflow_path" "$runner_output" "$runner_pid_file" &
    RUNNER_WAIT_PID="$!"
  else
    log "setsid unavailable and no python3/perl fallback found; launching runner without detached process-group isolation" >&2
    "$RUNNER" run "$workflow_path" > >(tee -a "$runner_output") 2>&1 &
    RUNNER_START_PID="$!"
    RUNNER_WAIT_PID="$RUNNER_START_PID"
    return 0
  fi

  local pid_wait_attempt="0"
  while [[ ! -s "$runner_pid_file" && "$pid_wait_attempt" -lt 20 ]]; do
    sleep 0.1
    pid_wait_attempt="$((pid_wait_attempt + 1))"
  done

  if [[ -f "$runner_pid_file" ]]; then
    launched_pid="$(tr -d '[:space:]' < "$runner_pid_file")"
  fi

  if [[ -z "$launched_pid" ]]; then
    log "detached runner launcher did not record a child pid" >&2
    RUNNER_START_PID=""
    return 1
  fi

  RUNNER_START_PID="$launched_pid"
  [[ -n "$RUNNER_WAIT_PID" ]] || RUNNER_WAIT_PID="$RUNNER_START_PID"
}

resolve_runner_pgid() {
  local runner_pid="$1"
  local attempts="0"
  local candidate=""

  command -v ps >/dev/null 2>&1 || return 0

  while is_pid_running "$runner_pid"; do
    candidate="$(ps -o pgid= -p "$runner_pid" 2>/dev/null | tr -d '[:space:]')"
    if [[ -n "$candidate" ]]; then
      if [[ "$RUNNER_EXPECTS_DETACHED_PGID" != "true" ]]; then
        printf '%s\n' "$candidate"
        return 0
      fi
      if [[ -z "$SCRIPT_PGID" || "$candidate" != "$SCRIPT_PGID" ]]; then
        printf '%s\n' "$candidate"
        return 0
      fi
    fi
    attempts=$((attempts + 1))
    (( attempts >= 10 )) && break
    sleep 0.2
  done

  if [[ -n "$candidate" ]]; then
    printf '%s\n' "$candidate"
  fi
}

extract_declared_workflow_name() {
  local workflow_path="$1"
  python3 - "$workflow_path" <<'PY'
import re
import sys

path = sys.argv[1]
with open(path, 'r', encoding='utf-8') as fh:
    text = fh.read()
match = re.search(r"workflow\(\s*['\"]([^'\"]+)['\"]\s*\)", text)
if match:
    print(match.group(1))
PY
}

workflow_runs_line_count() {
  local runs_file=".agent-relay/workflow-runs.jsonl"
  [[ -f "$runs_file" ]] || {
    printf '0\n'
    return 0
  }
  wc -l < "$runs_file" | tr -d '[:space:]'
}

latest_runtime_workflow_name_after_line() {
  local start_line="${1:-0}"
  local runs_file=".agent-relay/workflow-runs.jsonl"
  [[ -f "$runs_file" ]] || return 0
  python3 - "$runs_file" "$start_line" <<'PY'
import json
import sys

path = sys.argv[1]
start_line = int(sys.argv[2])
latest = ''
with open(path, 'r', encoding='utf-8') as fh:
    for line_number, line in enumerate(fh, start=1):
        if line_number <= start_line:
            continue
        line = line.strip()
        if not line:
            continue
        try:
            row = json.loads(line)
        except json.JSONDecodeError:
            continue
        if row.get('kind') != 'run':
            continue
        workflow_name = ((row.get('row') or {}).get('workflowName')) or ''
        if workflow_name:
            latest = workflow_name
if latest:
    print(latest)
PY
}

runner_output_declares_expected_workflow() {
  local runner_output="$1"
  local expected_workflow_name="$2"

  [[ -n "$expected_workflow_name" && -f "$runner_output" ]] || return 1

  grep -Fq "Starting workflow \"$expected_workflow_name-workflow\"" "$runner_output" || \
    grep -Fq "Starting workflow \"$expected_workflow_name\"" "$runner_output" || \
    grep -Fq "Workflow \"$expected_workflow_name-workflow\"" "$runner_output" || \
    grep -Fq "Workflow \"$expected_workflow_name\"" "$runner_output"
}

runner_executed_unexpected_workflow() {
  local workflow_path="$1"
  local runs_start_line="${2:-0}"
  local runner_output="${3:-}"
  local expected_workflow_name=""
  local actual_workflow_name=""

  expected_workflow_name="$(extract_declared_workflow_name "$workflow_path")"

  [[ -n "$expected_workflow_name" ]] || return 1
  if runner_output_declares_expected_workflow "$runner_output" "$expected_workflow_name"; then
    return 1
  fi

  actual_workflow_name="$(latest_runtime_workflow_name_after_line "$runs_start_line")"

  [[ -n "$actual_workflow_name" ]] || return 1
  if [[ "$expected_workflow_name" == "$actual_workflow_name" || "$actual_workflow_name" == "$expected_workflow_name-workflow" ]]; then
    return 1
  fi

  log "runner workflow identity mismatch: expected $expected_workflow_name but runtime executed $actual_workflow_name"
  return 0
}

run_one() {
  local workflow_path="$1"
  local runner_output=""
  local runner_pid=""
  local runner_exit="0"
  local last_progress_epoch="$(date +%s)"
  local last_output_epoch="$last_progress_epoch"
  local last_observed_size="0"
  local current_output_size="0"
  local workflow_runs_start_line="0"
  RUN_RESULT="ran"
  CURRENT_WORKFLOW="$workflow_path"
  persist_checkpoint
  log ">>> running $workflow_path"

  if [[ ! -f "$workflow_path" ]]; then
    log "skipping missing workflow: $workflow_path"
    echo "$workflow_path" >> "$SKIPPED_FILE"
    RUN_RESULT="skipped"
    CURRENT_WORKFLOW=""
    persist_checkpoint
    return 0
  fi

  if workflow_has_stale_package_targets "$workflow_path"; then
    log "skipping stale pre-package-split workflow: $workflow_path"
    printf '%s\n' "$workflow_path" >> "$STALE_FILE"
    echo "$workflow_path" >> "$SKIPPED_FILE"
    RUN_RESULT="skipped"
    CURRENT_WORKFLOW=""
    persist_checkpoint
    return 0
  fi

  if workflow_is_already_satisfied "$workflow_path"; then
    log "skipping already-satisfied workflow: $workflow_path"
    echo "$workflow_path" >> "$SKIPPED_FILE"
    RUN_RESULT="skipped"
    CURRENT_WORKFLOW=""
    persist_checkpoint
    return 0
  fi

  runner_output="$ARTIFACT_DIR/runner-$(basename "$workflow_path" .ts).log"
  : > "$runner_output"
  workflow_runs_start_line="$(workflow_runs_line_count)"

  start_runner "$workflow_path" "$runner_output"
  runner_pid="$RUNNER_START_PID"
  RUN_PID="$runner_pid"
  RUN_PGID="$(resolve_runner_pgid "$runner_pid")"
  if [[ -n "$SCRIPT_PGID" && -n "$RUN_PGID" && "$RUN_PGID" == "$SCRIPT_PGID" ]]; then
    log "runner shares shell process group; disabling process-group tracking for stale detection"
    RUN_PGID=""
  fi
  persist_checkpoint

  if ! is_pid_running "$runner_pid"; then
    log "workflow runner failed to start: $workflow_path"
    echo "$workflow_path" >> "$FAILED_FILE"
    inspect_repo_changes
    mark_status "blocked" "runner failed to start: $workflow_path"
    CURRENT_WORKFLOW=""
    persist_checkpoint
    return 1
  fi

  last_observed_size="$(runner_output_size "$runner_output")"

  while is_pid_running "$runner_pid"; do
    if workflow_hit_claude_rate_limit "$runner_output"; then
      log "workflow blocked by Claude rate limit prompt: $workflow_path"
      kill_process_group "$RUN_PGID"
      wait "$runner_pid" 2>/dev/null || true
      echo "$workflow_path" >> "$FAILED_FILE"
      inspect_repo_changes
      mark_status "blocked" "claude rate limit prompt: $workflow_path"
      CURRENT_WORKFLOW=""
      persist_checkpoint
      return 1
    fi

    current_output_size="$(runner_output_size "$runner_output")"
    if (( current_output_size > last_observed_size )); then
      last_output_epoch="$(date +%s)"
    fi
    if runner_output_has_meaningful_progress "$runner_output" "$last_observed_size" "$current_output_size"; then
      last_progress_epoch="$last_output_epoch"
    fi
    last_observed_size="$current_output_size"

    if runner_output_idle_for_too_long "$last_progress_epoch" "$(date +%s)"; then
      log "workflow runner produced no meaningful progress for ${IDLE_TIMEOUT_SECONDS}s: $workflow_path"
      kill_process_group "$RUN_PGID"
      wait "$runner_pid" 2>/dev/null || true
      echo "$workflow_path" >> "$FAILED_FILE"
      inspect_repo_changes

      if repo_has_meaningful_delta; then
        log "idle workflow produced repo changes; validating before capture"
        if ! commit_if_clean_delta "$workflow_path"; then
          mark_status "blocked" "push rejected after idle workflow delta capture: $workflow_path"
          CURRENT_WORKFLOW=""
          persist_checkpoint
          return 1
        fi
        remove_workflow_from_tracked_file "$workflow_path" "$FAILED_FILE"
        CURRENT_WORKFLOW=""
        persist_checkpoint
        return 0
      fi

      mark_status "blocked" "runner idle with no repo delta: $workflow_path"
      CURRENT_WORKFLOW=""
      persist_checkpoint
      return 1
    fi

    sleep "$POLL_SECONDS"
  done

  if ! wait "${RUNNER_WAIT_PID:-$runner_pid}"; then
    runner_exit=$?
  fi
  clear_artifact_runner_pid "$ARTIFACT_DIR"
  RUN_PID="$$"
  RUN_PGID=""
  persist_checkpoint

  if runner_executed_unexpected_workflow "$workflow_path" "$workflow_runs_start_line" "$runner_output"; then
    echo "$workflow_path" >> "$FAILED_FILE"
    inspect_repo_changes
    mark_status "blocked" "runner workflow identity mismatch: $workflow_path"
    CURRENT_WORKFLOW=""
    persist_checkpoint
    return 1
  fi

  if workflow_hit_claude_rate_limit "$runner_output"; then
    log "workflow blocked by Claude rate limit prompt after runner exit: $workflow_path"
    echo "$workflow_path" >> "$FAILED_FILE"
    inspect_repo_changes
    mark_status "blocked" "claude rate limit prompt: $workflow_path"
    CURRENT_WORKFLOW=""
    persist_checkpoint
    return 1
  fi

  if [[ "$runner_exit" != "0" ]] || workflow_log_shows_failure "$runner_output"; then
    if [[ "$runner_exit" != "0" ]]; then
      log "workflow exited non-zero: $workflow_path"
    else
      log "workflow reported failure in logs despite zero exit: $workflow_path"
    fi
    echo "$workflow_path" >> "$FAILED_FILE"
    inspect_repo_changes

    if ! repo_has_meaningful_delta; then
      log "no useful repo changes after failure; stopping on uncertainty"
      mark_status "blocked" "failed without repo delta: $workflow_path"
      CURRENT_WORKFLOW=""
      persist_checkpoint
      return 1
    fi

    log "failure produced repo changes; validating before capture"
    if ! commit_if_clean_delta "$workflow_path"; then
      mark_status "blocked" "push rejected after failed workflow delta capture: $workflow_path"
      CURRENT_WORKFLOW=""
      persist_checkpoint
      return 1
    fi
    remove_workflow_from_tracked_file "$workflow_path" "$FAILED_FILE"
    CURRENT_WORKFLOW=""
    persist_checkpoint
    return 0
  fi

  log "workflow completed: $workflow_path"
  if ! commit_if_clean_delta "$workflow_path"; then
    mark_status "blocked" "push rejected after workflow delta capture: $workflow_path"
    CURRENT_WORKFLOW=""
    persist_checkpoint
    return 1
  fi
  remove_workflow_from_tracked_file "$workflow_path" "$FAILED_FILE"
  CURRENT_WORKFLOW=""
  persist_checkpoint
  return 0
}

should_stop_before_next_workflow() {
  local now
  now="$(date +%s)"

  if [[ -f "$STOP_FILE" ]]; then
    mark_status "stopped" "stop file detected"
    return 0
  fi

  if (( now >= END_EPOCH )); then
    mark_status "complete" "duration reached"
    return 0
  fi

  if (( WORKFLOWS_RUN >= MAX_WORKFLOWS_PER_INVOCATION )); then
    mark_status "checkpointed" "workflow chunk limit reached"
    return 0
  fi

  return 1
}

if [[ ! -x "$RUNNER" ]]; then
  echo "ERROR: agent-relay runner not found at $RUNNER"
  exit 1
fi

cd "$REPO_ROOT"
reconcile_stale_state_dirs
sync_repo_with_origin_main_if_safe
quarantine_repo_runtime_state

echo "running" > "$STATUS_FILE"
git rev-parse HEAD > "$LAST_COMMIT_FILE"
INITIAL_GIT_HEAD="$(cat "$LAST_COMMIT_FILE")"
restore_checkpoint
# A resumed invocation may restore an older checkpoint baseline after we've
# already synced local main to origin/main for this fresh run. Reset the
# invocation baseline to the current repo head so queue-exhausted summaries and
# any no-op runs report truthful commit state for this invocation.
git rev-parse HEAD > "$LAST_COMMIT_FILE"
INITIAL_GIT_HEAD="$(cat "$LAST_COMMIT_FILE")"
write_queue
filter_queue_for_repo_state
fallback_to_expanded_queue_when_flight_safe_exhausted
resume_remaining_queue_from_checkpoint
persist_checkpoint

QUEUE_ITEMS=()
while IFS= read -r workflow_line; do
  QUEUE_ITEMS+=("$workflow_line")
done < "$QUEUE_FILE"
QUEUE_TOTAL="${#QUEUE_ITEMS[@]}"

if (( QUEUE_TOTAL == 0 )); then
  effective_removed_missing="$LAST_FILTER_REMOVED_MISSING"
  effective_removed_stale="$LAST_FILTER_REMOVED_STALE"
  effective_removed_satisfied="$LAST_FILTER_REMOVED_SATISFIED"
  effective_removed_total="$LAST_FILTER_REMOVED_TOTAL"
  effective_omitted_stale="${LAST_APPENDED_OMITTED_STALE:-0}"

  if [[ "$EXPANDED_PROBE_QUEUE_EXHAUSTED" == "true" ]]; then
    effective_removed_missing="$EXPANDED_PROBE_REMOVED_MISSING"
    effective_removed_stale="$EXPANDED_PROBE_REMOVED_STALE"
    effective_removed_satisfied="$EXPANDED_PROBE_REMOVED_SATISFIED"
    effective_removed_total="$EXPANDED_PROBE_REMOVED_TOTAL"
    effective_omitted_stale="${EXPANDED_PROBE_APPENDED_OMITTED_STALE:-0}"
    LAST_FILTER_REMOVED_MISSING="$effective_removed_missing"
    LAST_FILTER_REMOVED_STALE="$effective_removed_stale"
    LAST_FILTER_REMOVED_SATISFIED="$effective_removed_satisfied"
    LAST_FILTER_REMOVED_TOTAL="$effective_removed_total"
    LAST_APPENDED_OMITTED_STALE="$effective_omitted_stale"
  fi

  effective_removed_stale=$((effective_removed_stale + effective_omitted_stale))
  effective_removed_total=$((effective_removed_total + effective_omitted_stale))
  LAST_FILTER_REMOVED_STALE="$effective_removed_stale"
  LAST_FILTER_REMOVED_TOTAL="$effective_removed_total"

  CURRENT_PASS="$PASSES"
  CURRENT_INDEX=0
  CURRENT_WORKFLOW=""
  persist_checkpoint

  if [[ -s "$FAILED_FILE" ]]; then
    mark_status "complete-with-failures" "restored checkpoint contained failed workflows; queue is now exhausted after repo-state filtering"
  elif (( effective_removed_missing > 0 )); then
    mark_status "blocked" "queue exhausted because remaining workflows are missing: stale=${effective_removed_stale}, satisfied=${effective_removed_satisfied}, missing=${effective_removed_missing}"
  elif (( effective_removed_stale > 0 )); then
    mark_status "blocked" "queue exhausted because remaining workflows are migration-blocked stale workflows: stale=${effective_removed_stale}, satisfied=${effective_removed_satisfied}, missing=${effective_removed_missing}"
  else
    mark_status "complete" "queue exhausted with no actionable workflows after repo-state filtering"
  fi

  clear_all_state_checkpoints
  finalize_current_artifact_checkpoint
  write_summary "$(cat "$STATUS_FILE")"
  log "overnight queue finished without actionable workflows"
  exit 0
fi

SHOULD_FINALIZE_AND_EXIT="false"

for (( pass = CURRENT_PASS; pass <= PASSES; pass++ )); do
  local_start_index="$CURRENT_INDEX"
  if (( pass > CURRENT_PASS )); then
    local_start_index=0
  fi
  CURRENT_PASS="$pass"

  log "starting overnight pass $pass/$PASSES at queue index $local_start_index"

  for (( idx = local_start_index; idx < QUEUE_TOTAL; idx++ )); do
    CURRENT_INDEX="$idx"
    persist_checkpoint

    if should_stop_before_next_workflow; then
      SHOULD_FINALIZE_AND_EXIT="true"
      break 2
    fi

    workflow_path="${QUEUE_ITEMS[$idx]}"
    if [[ -z "$workflow_path" ]]; then
      continue
    fi

    if ! run_one "$workflow_path"; then
      exit 1
    fi

    if [[ "$RUN_RESULT" == "ran" ]]; then
      WORKFLOWS_RUN="$((WORKFLOWS_RUN + 1))"
    fi
    CURRENT_INDEX="$((idx + 1))"
    persist_checkpoint
    sleep "$POLL_SECONDS"
  done

  CURRENT_INDEX=0
  persist_checkpoint

done

if [[ "$SHOULD_FINALIZE_AND_EXIT" == "true" ]]; then
  clear_all_state_checkpoints
  finalize_current_artifact_checkpoint
  write_summary "$(cat "$STATUS_FILE")"
  log "overnight queue finalized after stop condition"
  exit 0
fi

CURRENT_PASS="$PASSES"
CURRENT_INDEX="$QUEUE_TOTAL"
CURRENT_WORKFLOW=""
persist_checkpoint

if [[ -s "$FAILED_FILE" ]]; then
  mark_status "complete-with-failures" "queue finished with failed workflows"
else
  mark_status "complete" "queue finished"
fi
clear_all_state_checkpoints
finalize_current_artifact_checkpoint
write_summary "$(cat "$STATUS_FILE")"
log "overnight queue finished"
