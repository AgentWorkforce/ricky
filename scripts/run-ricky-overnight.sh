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

mkdir -p "$ARTIFACT_DIR" "$STATE_ROOT"
: > "$LOG_FILE"
: > "$FAILED_FILE"
: > "$SKIPPED_FILE"

exec > >(tee -a "$LOG_FILE") 2>&1

START_EPOCH="$(date +%s)"
END_EPOCH="$((START_EPOCH + DURATION_HOURS * 3600))"
INITIAL_GIT_HEAD=""
CURRENT_PASS=1
CURRENT_INDEX=0
WORKFLOWS_RUN=0
RUN_RESULT=""
STATUS_REASON=""
CURRENT_WORKFLOW=""
RUN_PID="$$"
RUN_PGID=""
RUNNER_START_PID=""
STATUS_MARKED="false"
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

kill_process_group() {
  local pgid="$1"

  [[ -n "$pgid" ]] || return 0
  kill -TERM -- "-$pgid" 2>/dev/null || true
  sleep 1
  kill -0 -- "-$pgid" 2>/dev/null && kill -KILL -- "-$pgid" 2>/dev/null || true
}

on_exit() {
  local exit_code="$?"

  if [[ -n "$RUN_PGID" ]]; then
    kill_process_group "$RUN_PGID"
  fi

  if [[ "$STATUS_MARKED" == "true" ]]; then
    return "$exit_code"
  fi

  if [[ -f "$STATUS_FILE" ]] && grep -qx 'running' "$STATUS_FILE"; then
    STATUS_REASON="process exited unexpectedly"
    echo "stale" > "$STATUS_FILE"
    persist_checkpoint
    write_summary "stale"
  fi

  return "$exit_code"
}

trap on_exit EXIT

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
EOF
      ;;
    expanded|*)
      cat > "$QUEUE_FILE" <<'EOF'
workflows/wave5-scale-and-ops/05-split-ricky-into-workspace-packages.ts
workflows/wave6-proof/01-close-first-wave-signoff-and-blockers.ts
workflows/wave7-cli-proof/01-implement-cli-ux-spec-conformance.ts
workflows/wave7-cli-proof/02-prove-cli-onboarding-command-journeys.ts
workflows/wave7-local-proof/03-prove-local-byoh-spec-to-artifact-loop.ts
workflows/wave7-runtime-proof/05-prove-runtime-execution-outcome-loop.ts
workflows/wave7-recovery/06-implement-environment-recovery-unblockers.ts
workflows/wave7-analytics-proof/07-prove-proof-loop-analytics-feedback.ts
workflows/wave0-foundation/04-initial-architecture-docs.ts
workflows/wave1-runtime/04-implement-failure-diagnosis-engine.ts
workflows/wave1-runtime/05-prove-runtime-environment-orchestration-unblockers.ts
workflows/wave2-product/02-workflow-generation-pipeline.ts
workflows/wave3-cloud-api/01-cloud-connect-and-auth.ts
workflows/wave3-cloud-api/03-implement-ricky-cloud-generate-slice.ts
workflows/wave3-cloud-api/04-prove-cloud-connect-and-generate-happy-path.ts
workflows/wave4-local-byoh/01-cli-onboarding-and-welcome.ts
workflows/wave4-local-byoh/04-implement-cli-onboarding-from-ux-spec.ts
workflows/wave4-local-byoh/06-implement-local-byoh-entrypoint.ts
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

log() {
  printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"
}

workflow_has_stale_package_targets() {
  local workflow_path="$1"

  grep -Eq "packages/cli/packages/cli/|(^|[^[:alnum:]_/])src/(shared|runtime|product|cloud|local|cli)/" "$workflow_path"
}

artifact_signoff_has_marker() {
  local signoff_path="$1"
  local marker="$2"

  [[ -f "$signoff_path" ]] && grep -q "$marker" "$signoff_path"
}

workflow_is_already_satisfied() {
  local workflow_path="$1"

  case "$workflow_path" in
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

restore_checkpoint() {
  if [[ "$RESUME_FLAG" != "--resume" ]]; then
    return 0
  fi
  if [[ ! -f "$STATE_FILE" ]]; then
    log "resume requested but no checkpoint exists for queue mode $QUEUE_MODE"
    return 0
  fi

  log "restoring checkpoint from $STATE_FILE"

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
  done < "$STATE_FILE"

  local previous_artifact_dir="${restored_artifact_dir:-}"
  local previous_status_file=""
  local previous_pid="${restored_run_pid:-}"
  local previous_pgid="${restored_run_pgid:-}"
  if [[ -n "$previous_artifact_dir" ]]; then
    previous_status_file="$previous_artifact_dir/status.txt"
  fi
  if [[ -n "$previous_status_file" && -f "$previous_status_file" ]] && grep -qx 'running' "$previous_status_file"; then
    if ! is_pid_running "$previous_pid" && ! is_process_group_running "$previous_pgid"; then
      printf '%s\n' 'stale' > "$previous_status_file"
      log "marked stale prior overnight artifact: $previous_artifact_dir"
    fi
  fi

  if [[ -n "$restored_queue_mode" ]]; then
    QUEUE_MODE="$restored_queue_mode"
  fi
  CURRENT_PASS="${restored_current_pass:-1}"
  CURRENT_INDEX="${restored_current_index:-0}"
  # `workflows_run` is an invocation-local chunk counter. Restoring it across
  # `--resume` causes a fresh invocation to immediately checkpoint again once it
  # reaches the prior chunk limit, without running the next queued workflow.
  WORKFLOWS_RUN=0
  CURRENT_WORKFLOW="${restored_current_workflow:-}"
  INITIAL_GIT_HEAD="${restored_initial_git_head:-}"
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
  local output_file="$1"
  local now_epoch="$2"
  local last_modified=""

  [[ -f "$output_file" ]] || return 1

  last_modified="$(stat -f '%m' "$output_file" 2>/dev/null || echo 0)"
  [[ "$last_modified" =~ ^[0-9]+$ ]] || last_modified=0

  (( now_epoch - last_modified >= IDLE_TIMEOUT_SECONDS ))
}

start_runner() {
  local workflow_path="$1"
  local runner_output="$2"

  if command -v setsid >/dev/null 2>&1; then
    setsid "$RUNNER" run "$workflow_path" > >(tee -a "$runner_output") 2>&1 &
  else
    log "setsid unavailable; launching runner without detached process-group isolation" >&2
    "$RUNNER" run "$workflow_path" > >(tee -a "$runner_output") 2>&1 &
  fi

  RUNNER_START_PID="$!"
}

run_one() {
  local workflow_path="$1"
  local runner_output=""
  local runner_pid=""
  local runner_exit="0"
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
  RUN_PGID=""
  if command -v ps >/dev/null 2>&1; then
    RUN_PGID="$(ps -o pgid= -p "$runner_pid" 2>/dev/null | tr -d '[:space:]')"
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

    if runner_output_idle_for_too_long "$runner_output" "$(date +%s)"; then
      log "workflow runner went idle without new output for ${IDLE_TIMEOUT_SECONDS}s: $workflow_path"
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

echo "running" > "$STATUS_FILE"
git rev-parse HEAD > "$LAST_COMMIT_FILE"
INITIAL_GIT_HEAD="$(cat "$LAST_COMMIT_FILE")"
restore_checkpoint
write_queue
filter_queue_for_repo_state
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
if [[ -f "$STATE_FILE" ]]; then
  rm -f "$STATE_FILE"
  write_summary "$(cat "$STATUS_FILE")"
fi
log "overnight queue finished"
