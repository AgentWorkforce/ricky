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
STATE_ROOT="${RICKY_OVERNIGHT_STATE_DIR:-$REPO_ROOT/.workflow-artifacts/overnight-state/$QUEUE_MODE}"
GLOBAL_STATE_ROOT="$REPO_ROOT/.workflow-artifacts/overnight-state"
GLOBAL_LOCK_DIR="$GLOBAL_STATE_ROOT/active.lock"
GLOBAL_LOCK_FILE="$GLOBAL_LOCK_DIR/lock.env"
RESUME_FLAG="${1:-}"
STAMP="$(date +%Y%m%d-%H%M%S)"
ARTIFACT_DIR="$REPO_ROOT/.workflow-artifacts/overnight-$STAMP"
LOG_FILE="$ARTIFACT_DIR/overnight.log"
STATUS_FILE="$ARTIFACT_DIR/status.txt"
SUMMARY_FILE="$ARTIFACT_DIR/summary.md"
LAST_COMMIT_FILE="$ARTIFACT_DIR/last-commit.txt"
QUEUE_FILE="$ARTIFACT_DIR/queue.txt"
FAILED_FILE="$ARTIFACT_DIR/failed.txt"
SKIPPED_FILE="$ARTIFACT_DIR/skipped.txt"
CHECKPOINT_FILE="$ARTIFACT_DIR/checkpoint.env"
STOP_FILE="$ARTIFACT_DIR/STOP"
STATE_FILE="$STATE_ROOT/checkpoint.env"
STATE_LOG="$STATE_ROOT/latest-run.txt"
LOCK_OWNER_PID=""
LOCK_OWNER_ARTIFACT_DIR=""
LOCK_OWNER_QUEUE_MODE=""
LOCK_OWNER_STATUS_FILE=""
LOCK_ACQUIRED="false"

mkdir -p "$ARTIFACT_DIR" "$STATE_ROOT" "$GLOBAL_STATE_ROOT"
: > "$LOG_FILE"
: > "$FAILED_FILE"
: > "$SKIPPED_FILE"

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
  elif artifact_runner_logs_show_success "$artifact_dir"; then
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

  if [[ -f "$status_file" ]] && grep -qx 'running' "$status_file"; then
    if ! is_pid_running "$run_pid" && ! is_process_group_running "$run_pgid"; then
      mark_artifact_stale_or_complete "$artifact_dir"
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

reconcile_stale_state_dirs() {
  local state_dir=""
  for state_dir in "$REPO_ROOT"/.workflow-artifacts/overnight-state/*; do
    [[ -d "$state_dir" ]] || continue
    reconcile_stale_state_dir "$state_dir/checkpoint.env"
  done
}

clear_all_state_checkpoints() {
  local state_dir=""
  for state_dir in "$REPO_ROOT"/.workflow-artifacts/overnight-state/*; do
    [[ -d "$state_dir" ]] || continue
    rm -f "$state_dir/checkpoint.env" "$state_dir/latest-run.txt"
  done
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

quarantine_repo_runtime_state() {
  local quarantine_root="$ARTIFACT_DIR/runtime-state-quarantine"
  local candidate=""
  local stamp="$(date +%Y%m%d-%H%M%S)"
  local destination=""

  for candidate in .agent-relay .relay .trajectories; do
    [[ -e "$candidate" ]] || continue
    mkdir -p "$quarantine_root"
    destination="$quarantine_root/${candidate#.}-$stamp"
    mv "$candidate" "$destination"
    log "quarantined repo runtime state: $candidate -> $destination"
  done
}

on_exit() {
  local exit_code="$?"

  if [[ -n "$RUN_PGID" ]]; then
    kill_process_group "$RUN_PGID"
  fi

  if [[ "$STATUS_MARKED" != "true" ]]; then
    if [[ -f "$STATUS_FILE" ]] && grep -qx 'running' "$STATUS_FILE"; then
      if artifact_runner_logs_show_success "$ARTIFACT_DIR"; then
        STATUS_REASON="runner completed before harness status flush"
        echo "complete" > "$STATUS_FILE"
        persist_checkpoint
        write_summary "complete"
      else
        STATUS_REASON="process exited unexpectedly"
        echo "stale" > "$STATUS_FILE"
        persist_checkpoint
        write_summary "stale"
      fi
    fi
  fi

  release_global_lock

  return "$exit_code"
}

trap on_exit EXIT

acquire_global_lock

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
workflows/wave6-proof/01-close-first-wave-signoff-and-blockers.ts
workflows/wave7-cli-proof/01-implement-cli-ux-spec-conformance.ts
workflows/wave7-cli-proof/02-prove-cli-onboarding-command-journeys.ts
workflows/wave7-local-proof/03-prove-local-byoh-spec-to-artifact-loop.ts
workflows/wave7-runtime-proof/05-prove-runtime-execution-outcome-loop.ts
workflows/wave7-recovery/06-implement-environment-recovery-unblockers.ts
workflows/wave7-analytics-proof/07-prove-proof-loop-analytics-feedback.ts
workflows/wave8-github-issues/01-fix-cli-artifact-path-and-caller-root.ts
workflows/wave8-github-issues/02-prove-external-repo-cli-generation.ts
workflows/wave8-github-issues/03-close-local-execution-outcome-loop.ts
workflows/wave8-github-issues/04-tighten-onboarding-readiness-copy-and-checklist.ts
workflows/wave8-github-issues/05-prove-skill-embedding-boundary.ts
workflows/wave8-github-issues/06-close-local-run-product-loop.ts
workflows/wave9-agent-assistant/01-audit-ricky-agent-assistant-usage.ts
workflows/wave9-agent-assistant/02-define-ricky-agent-assistant-boundary.ts
workflows/wave9-agent-assistant/03-evaluate-local-execution-contract-for-reuse.ts
workflows/wave10-agent-assistant-adoption/00-execute-agent-assistant-adoption-program.ts
EOF
      ;;
    expanded|*)
      cat > "$QUEUE_FILE" <<'EOF'
workflows/wave6-proof/01-close-first-wave-signoff-and-blockers.ts
workflows/wave7-cli-proof/01-implement-cli-ux-spec-conformance.ts
workflows/wave7-cli-proof/02-prove-cli-onboarding-command-journeys.ts
workflows/wave7-local-proof/03-prove-local-byoh-spec-to-artifact-loop.ts
workflows/wave7-runtime-proof/05-prove-runtime-execution-outcome-loop.ts
workflows/wave7-recovery/06-implement-environment-recovery-unblockers.ts
workflows/wave7-analytics-proof/07-prove-proof-loop-analytics-feedback.ts
workflows/wave8-github-issues/01-fix-cli-artifact-path-and-caller-root.ts
workflows/wave8-github-issues/02-prove-external-repo-cli-generation.ts
workflows/wave8-github-issues/03-close-local-execution-outcome-loop.ts
workflows/wave8-github-issues/04-tighten-onboarding-readiness-copy-and-checklist.ts
workflows/wave8-github-issues/05-prove-skill-embedding-boundary.ts
workflows/wave8-github-issues/06-close-local-run-product-loop.ts
workflows/wave9-agent-assistant/01-audit-ricky-agent-assistant-usage.ts
workflows/wave9-agent-assistant/02-define-ricky-agent-assistant-boundary.ts
workflows/wave9-agent-assistant/03-evaluate-local-execution-contract-for-reuse.ts
workflows/wave10-agent-assistant-adoption/00-execute-agent-assistant-adoption-program.ts
workflows/wave11-flat-layout-collapse/01-collapse-packages-into-src.ts
workflows/wave0-foundation/04-initial-architecture-docs.ts
workflows/wave1-runtime/04-implement-failure-diagnosis-engine.ts
workflows/wave1-runtime/05-prove-runtime-environment-orchestration-unblockers.ts
workflows/wave2-product/02-workflow-generation-pipeline.ts
workflows/wave3-cloud-api/01-cloud-connect-and-auth.ts
workflows/wave3-cloud-api/03-implement-ricky-cloud-generate-slice.ts
workflows/wave3-cloud-api/04-prove-cloud-connect-and-generate-happy-path.ts
workflows/wave4-local-byoh/08-implement-interactive-cli-entrypoint.ts
EOF
      ;;
  esac
}

queue_count() {
  awk 'NF { count += 1 } END { print count + 0 }' "$QUEUE_FILE"
}

filter_queue_for_repo_state() {
  local filtered_queue="$ARTIFACT_DIR/queue.filtered.tmp"
  local removed_count=0
  local workflow_path=""

  cp "$QUEUE_FILE" "$ARTIFACT_DIR/queue.raw.txt"
  : > "$filtered_queue"

  while IFS= read -r workflow_path; do
    [[ -n "$workflow_path" ]] || continue

    if [[ ! -f "$workflow_path" ]]; then
      log "dropping missing workflow from queue: $workflow_path"
      removed_count=$((removed_count + 1))
      continue
    fi

    if workflow_has_stale_package_targets "$workflow_path"; then
      log "dropping stale pre-package-split workflow from queue: $workflow_path"
      removed_count=$((removed_count + 1))
      continue
    fi

    if workflow_is_already_satisfied "$workflow_path"; then
      log "dropping already-satisfied workflow from queue: $workflow_path"
      removed_count=$((removed_count + 1))
      continue
    fi

    printf '%s\n' "$workflow_path" >> "$filtered_queue"
  done < "$QUEUE_FILE"

  mv "$filtered_queue" "$QUEUE_FILE"
  log "queue prepared with $(queue_count) actionable workflows (${removed_count} removed)"
}

fallback_to_expanded_queue_when_flight_safe_exhausted() {
  local original_queue_mode="$QUEUE_MODE"
  local expanded_queue_count=0

  if [[ "$QUEUE_MODE" != "flight-safe" ]]; then
    return 0
  fi

  if (( $(queue_count) > 0 )); then
    return 0
  fi

  log "flight-safe queue is exhausted; probing expanded queue for remaining actionable workflows"
  QUEUE_MODE="expanded"
  write_queue
  filter_queue_for_repo_state
  expanded_queue_count="$(queue_count)"

  if (( expanded_queue_count > 0 )); then
    log "promoting overnight queue mode to expanded for this invocation (${expanded_queue_count} actionable workflows remain)"
    return 0
  fi

  QUEUE_MODE="$original_queue_mode"
  write_queue
  filter_queue_for_repo_state
  log "expanded queue is also exhausted; keeping queue mode at $QUEUE_MODE"
}

log() {
  printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"
}

workflow_has_stale_package_targets() {
  local workflow_path="$1"

  grep -Eq "packages/cli/packages/cli/|packages/(shared|runtime|product|cloud|local|cli)/src/" "$workflow_path"
}

artifact_signoff_has_marker() {
  local signoff_path="$1"
  local marker="$2"

  [[ -f "$signoff_path" ]] && grep -q "$marker" "$signoff_path"
}

workflow_is_already_satisfied() {
  local workflow_path="$1"

  case "$workflow_path" in
    workflows/wave1-runtime/04-implement-failure-diagnosis-engine.ts)
      artifact_signoff_has_marker \
        .workflow-artifacts/wave1-runtime/implement-failure-diagnosis-engine/signoff.md \
        'RICKY_FAILURE_DIAGNOSIS_ENGINE_COMPLETE'
      ;;
    workflows/wave1-runtime/05-prove-runtime-environment-orchestration-unblockers.ts)
      artifact_signoff_has_marker \
        .workflow-artifacts/wave1-runtime/prove-runtime-environment-orchestration-unblockers/signoff.md \
        'RICKY_FAILURE_UNBLOCKER_PROOF_COMPLETE'
      ;;
    workflows/wave4-local-byoh/07-prove-local-spec-handoff-and-artifact-return.ts)
      git cat-file -e HEAD:packages/local/src/proof/local-entrypoint-proof.ts 2>/dev/null \
        && git cat-file -e HEAD:packages/local/src/proof/local-entrypoint-proof.test.ts 2>/dev/null
      ;;
    workflows/wave5-scale-and-ops/01-workflow-health-analytics.ts)
      git cat-file -e HEAD:packages/product/src/analytics/health-analyzer.ts 2>/dev/null \
        && git cat-file -e HEAD:packages/product/src/analytics/digest-generator.ts 2>/dev/null \
        && git cat-file -e HEAD:packages/product/src/analytics/types.ts 2>/dev/null \
        && git cat-file -e HEAD:packages/product/src/analytics/health-analyzer.test.ts 2>/dev/null \
        && git cat-file -e HEAD:packages/product/src/analytics/index.ts 2>/dev/null
      ;;
    workflows/wave5-scale-and-ops/02-next-wave-backlog-and-proof-plan.ts)
      git cat-file -e HEAD:docs/product/ricky-next-wave-backlog-and-proof-plan.md 2>/dev/null \
        && grep -Eqi "(first[- ]wave|current first[- ]wave status|current status|workflow files|current first[- ]wave buildout)" docs/product/ricky-next-wave-backlog-and-proof-plan.md \
        && grep -Eqi "(CLI|banner|onboarding)" docs/product/ricky-next-wave-backlog-and-proof-plan.md \
        && grep -Eqi "(proof|80-to-100|validation)" docs/product/ricky-next-wave-backlog-and-proof-plan.md \
        && grep -Eqi "(local|BYOH)" docs/product/ricky-next-wave-backlog-and-proof-plan.md \
        && grep -Eqi "(Cloud)" docs/product/ricky-next-wave-backlog-and-proof-plan.md \
        && grep -Eqi "(failure|recovery|unblock)" docs/product/ricky-next-wave-backlog-and-proof-plan.md \
        && grep -Eqi "(priority|sequence|dependency)" docs/product/ricky-next-wave-backlog-and-proof-plan.md
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
        && test -d packages/shared \
        && test -d packages/runtime \
        && test -d packages/product \
        && test -d packages/cloud \
        && test -d packages/local \
        && test -d packages/cli
      ;;
    workflows/wave5-scale-and-ops/04-prove-ricky-package-layout-and-script-parity.ts)
      git cat-file -e HEAD:test/package-proof/package-layout-proof.ts 2>/dev/null \
        && git cat-file -e HEAD:test/package-proof/package-layout-proof.test.ts 2>/dev/null \
        && npm run typecheck >/dev/null \
        && npm test >/dev/null
      ;;
    workflows/wave5-scale-and-ops/05-split-ricky-into-workspace-packages.ts)
      artifact_signoff_has_marker \
        .workflow-artifacts/wave6-proof/close-first-wave-signoff-and-blockers/per-workflow/wave5-scale-and-ops__05-split-ricky-into-workspace-packages/signoff.md \
        'SIGNED_OFF'
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
    workflows/wave4-local-byoh/01-cli-onboarding-and-welcome.ts)
      artifact_signoff_has_marker \
        .workflow-artifacts/wave4-local-byoh/cli-onboarding-and-welcome/signoff.md \
        'CLI_ONBOARDING_WORKFLOW_COMPLETE'
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
    workflows/wave4-local-byoh/08-implement-interactive-cli-entrypoint.ts)
      git cat-file -e HEAD:src/surfaces/cli/entrypoint/interactive-cli.ts 2>/dev/null \
        && git cat-file -e HEAD:src/surfaces/cli/entrypoint/interactive-cli.test.ts 2>/dev/null \
        && git cat-file -e HEAD:src/surfaces/cli/entrypoint/index.ts 2>/dev/null \
        && grep -Eq 'runOnboarding|runLocal|handleCloudGenerate|diagnose' src/surfaces/cli/entrypoint/interactive-cli.ts
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
        && ! git cat-file -e HEAD:packages/shared/package.json 2>/dev/null \
        && ! git cat-file -e HEAD:packages/runtime/package.json 2>/dev/null \
        && ! git cat-file -e HEAD:packages/product/package.json 2>/dev/null \
        && ! git cat-file -e HEAD:packages/cloud/package.json 2>/dev/null \
        && ! git cat-file -e HEAD:packages/local/package.json 2>/dev/null \
        && ! git cat-file -e HEAD:packages/cli/package.json 2>/dev/null \
        && ! grep -q '"workspaces"' package.json
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
  local candidate_epoch="0"

  if [[ -f "$fallback_state_file" ]]; then
    printf '%s\n' "$fallback_state_file"
    return 0
  fi

  for candidate in "$REPO_ROOT"/.workflow-artifacts/overnight-state/*/checkpoint.env; do
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

  if [[ -n "$newest_file" ]]; then
    log "resume requested with no $QUEUE_MODE checkpoint; using latest checkpoint $newest_file" >&2
    printf '%s\n' "$newest_file"
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
  local previous_pid="${restored_run_pid:-}"
  local previous_pgid="${restored_run_pgid:-}"
  if [[ -n "$previous_artifact_dir" ]]; then
    previous_status_file="$previous_artifact_dir/status.txt"
  fi
  if [[ -n "$previous_status_file" && -f "$previous_status_file" ]] && grep -qx 'running' "$previous_status_file"; then
    if ! is_pid_running "$previous_pid" && ! is_process_group_running "$previous_pgid"; then
      mark_artifact_stale_or_complete "$previous_artifact_dir"
      log "reconciled prior overnight artifact with no live process: $previous_artifact_dir"
    fi
  fi

  if [[ -n "$restored_queue_mode" ]]; then
    QUEUE_MODE="$restored_queue_mode"
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
  tail -n +"$start_line" "$RESTORED_QUEUE_FILE" > "$resumed_queue"
  mv "$resumed_queue" "$QUEUE_FILE"
  filter_queue_for_repo_state

  CURRENT_PASS="${RESTORED_CURRENT_PASS:-1}"
  CURRENT_INDEX=0

  log "resumed remaining queue from prior artifact: $RESTORED_QUEUE_FILE (starting at saved index $restored_index)"
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
- failed_workflows:
$(sed 's/^/  - /' "$FAILED_FILE" 2>/dev/null || true)
- skipped_workflows:
$(sed 's/^/  - /' "$SKIPPED_FILE" 2>/dev/null || true)
EOF
}

mark_status() {
  local status="$1"
  STATUS_REASON="${2:-}"
  echo "$status" > "$STATUS_FILE"
  STATUS_MARKED="true"
  persist_checkpoint
  write_summary "$status"
}

validate_repo() {
  log "running repo validation"
  npm run typecheck
  npm test
}

inspect_repo_changes() {
  log "capturing repo status"
  git status --short | tee "$ARTIFACT_DIR/git-status.txt"
  git diff --stat > "$ARTIFACT_DIR/git-diff-stat.txt" || true
}

repo_has_meaningful_delta() {
  ! git diff --quiet || [[ -n "$(git ls-files --others --exclude-standard -- ':!tmp/' ':!.workflow-artifacts/')" ]]
}

commit_if_clean_delta() {
  local workflow_path="$1"
  if ! repo_has_meaningful_delta; then
    log "no tracked/untracked repo delta after $workflow_path"
    return 0
  fi

  validate_repo

  local short
  short="$(basename "$workflow_path" .ts)"
  git add -A ':!tmp/' ':!.workflow-artifacts/'
  git commit -m "chore(overnight): capture $short progress" || true
  git push origin main || true
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

  RUNNER_EXPECTS_DETACHED_PGID="false"

  if command -v setsid >/dev/null 2>&1; then
    RUNNER_EXPECTS_DETACHED_PGID="true"
    setsid "$RUNNER" run "$workflow_path" > >(tee -a "$runner_output") 2>&1 &
  elif command -v python3 >/dev/null 2>&1; then
    RUNNER_EXPECTS_DETACHED_PGID="true"
    log "setsid unavailable; detaching runner via python3 setsid fallback" >&2
    python3 - "$RUNNER" "$workflow_path" "$runner_output" <<'PY' &
import os
import sys

runner, workflow_path, runner_output = sys.argv[1:4]
os.setsid()
stream = os.open(runner_output, os.O_WRONLY | os.O_APPEND | os.O_CREAT, 0o644)
os.dup2(stream, 1)
os.dup2(stream, 2)
os.close(stream)
os.execvp(runner, [runner, 'run', workflow_path])
PY
  elif command -v perl >/dev/null 2>&1; then
    RUNNER_EXPECTS_DETACHED_PGID="true"
    log "setsid unavailable; detaching runner via perl setsid fallback" >&2
    perl -e 'use POSIX qw(setsid); my ($runner, $workflow, $output) = @ARGV; open my $fh, q{>>}, $output or die "open $output: $!"; setsid() or die "setsid: $!"; open STDOUT, q{>&}, $fh or die "dup stdout: $!"; open STDERR, q{>&}, $fh or die "dup stderr: $!"; exec {$runner} $runner, q{run}, $workflow or die "exec $runner: $!";' "$RUNNER" "$workflow_path" "$runner_output" &
  else
    log "setsid unavailable and no python3/perl fallback found; launching runner without detached process-group isolation" >&2
    "$RUNNER" run "$workflow_path" > >(tee -a "$runner_output") 2>&1 &
  fi

  RUNNER_START_PID="$!"
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

run_one() {
  local workflow_path="$1"
  local runner_output=""
  local runner_pid=""
  local runner_exit="0"
  local last_progress_epoch="$(date +%s)"
  local last_observed_size="0"
  local current_output_size="0"
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
    if runner_output_has_meaningful_progress "$runner_output" "$last_observed_size" "$current_output_size"; then
      last_progress_epoch="$(date +%s)"
    fi
    last_observed_size="$current_output_size"

    if runner_output_idle_for_too_long "$last_progress_epoch" "$(date +%s)"; then
      log "workflow runner went idle without meaningful progress for ${IDLE_TIMEOUT_SECONDS}s: $workflow_path"
      kill_process_group "$RUN_PGID"
      wait "$runner_pid" 2>/dev/null || true
      echo "$workflow_path" >> "$FAILED_FILE"
      inspect_repo_changes

      if repo_has_meaningful_delta; then
        log "idle workflow produced repo changes; validating before capture"
        commit_if_clean_delta "$workflow_path"
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

  if ! wait "$runner_pid"; then
    runner_exit=$?
  fi
  RUN_PID="$$"
  RUN_PGID=""
  persist_checkpoint

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
    commit_if_clean_delta "$workflow_path"
    CURRENT_WORKFLOW=""
    persist_checkpoint
    return 0
  fi

  log "workflow completed: $workflow_path"
  commit_if_clean_delta "$workflow_path"
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
quarantine_repo_runtime_state
reconcile_stale_state_dirs

echo "running" > "$STATUS_FILE"
git rev-parse HEAD > "$LAST_COMMIT_FILE"
INITIAL_GIT_HEAD="$(cat "$LAST_COMMIT_FILE")"
restore_checkpoint
write_queue
filter_queue_for_repo_state
fallback_to_expanded_queue_when_flight_safe_exhausted
resume_remaining_queue_from_checkpoint
if [[ -z "$INITIAL_GIT_HEAD" ]]; then
  INITIAL_GIT_HEAD="$(cat "$LAST_COMMIT_FILE")"
fi
persist_checkpoint

QUEUE_ITEMS=()
while IFS= read -r workflow_line; do
  QUEUE_ITEMS+=("$workflow_line")
done < "$QUEUE_FILE"
QUEUE_TOTAL="${#QUEUE_ITEMS[@]}"

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
      exit 0
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
write_summary "$(cat "$STATUS_FILE")"
log "overnight queue finished"
