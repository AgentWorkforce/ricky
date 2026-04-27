#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RUNNER="${AGENT_RELAY_BIN:-$HOME/.local/bin/agent-relay}"
DURATION_HOURS="${RICKY_OVERNIGHT_HOURS:-7}"
POLL_SECONDS="${RICKY_OVERNIGHT_POLL_SECONDS:-15}"
PASSES="${RICKY_OVERNIGHT_PASSES:-3}"
QUEUE_MODE="${RICKY_OVERNIGHT_QUEUE_MODE:-flight-safe}"
MAX_WORKFLOWS_PER_INVOCATION="${RICKY_OVERNIGHT_MAX_WORKFLOWS_PER_INVOCATION:-4}"
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
STATUS_MARKED="false"
CLAUDE_RATE_LIMIT_PATTERNS=(
  "You've hit your limit"
  "/rate-limit-options"
  "What do you want to do?"
  "Stop and wait for limit to reset"
)

on_exit() {
  local exit_code="$?"

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
workflows/wave0-foundation/03-shared-models-and-config.ts
workflows/wave1-runtime/01-local-run-coordinator.ts
workflows/wave1-runtime/02-workflow-evidence-model.ts
workflows/wave1-runtime/03-workflow-failure-classification.ts
workflows/wave1-runtime/04-implement-failure-diagnosis-engine.ts
workflows/wave1-runtime/05-prove-runtime-environment-orchestration-unblockers.ts
workflows/wave3-cloud-api/03-implement-ricky-cloud-generate-slice.ts
workflows/wave3-cloud-api/04-prove-cloud-connect-and-generate-happy-path.ts
workflows/wave4-local-byoh/01-cli-onboarding-and-welcome.ts
workflows/wave4-local-byoh/02-local-invocation-entrypoint.ts
workflows/wave4-local-byoh/03-cli-onboarding-ux-spec.ts
workflows/wave4-local-byoh/04-implement-cli-onboarding-from-ux-spec.ts
workflows/wave4-local-byoh/05-prove-cli-onboarding-first-run-and-recovery.ts
workflows/wave4-local-byoh/06-implement-local-byoh-entrypoint.ts
workflows/wave4-local-byoh/07-prove-local-spec-handoff-and-artifact-return.ts
workflows/wave4-local-byoh/08-implement-interactive-cli-entrypoint.ts
workflows/wave4-local-byoh/09-implement-cli-command-surface.ts
workflows/wave5-scale-and-ops/01-workflow-health-analytics.ts
workflows/wave5-scale-and-ops/02-next-wave-backlog-and-proof-plan.ts
workflows/wave5-scale-and-ops/03-align-ricky-package-conventions.ts
workflows/wave5-scale-and-ops/04-prove-ricky-package-layout-and-script-parity.ts
EOF
      ;;
    expanded|*)
      cat > "$QUEUE_FILE" <<'EOF'
workflows/wave4-local-byoh/09-implement-cli-command-surface.ts
workflows/wave4-local-byoh/08-implement-interactive-cli-entrypoint.ts
workflows/wave4-local-byoh/06-implement-local-byoh-entrypoint.ts
workflows/wave4-local-byoh/07-prove-local-spec-handoff-and-artifact-return.ts
workflows/wave3-cloud-api/03-implement-ricky-cloud-generate-slice.ts
workflows/wave3-cloud-api/04-prove-cloud-connect-and-generate-happy-path.ts
workflows/wave1-runtime/04-implement-failure-diagnosis-engine.ts
workflows/wave1-runtime/05-prove-runtime-environment-orchestration-unblockers.ts
workflows/wave5-scale-and-ops/03-align-ricky-package-conventions.ts
workflows/wave5-scale-and-ops/04-prove-ricky-package-layout-and-script-parity.ts
workflows/wave0-foundation/03-shared-models-and-config.ts
workflows/wave0-foundation/04-initial-architecture-docs.ts
workflows/wave1-runtime/01-local-run-coordinator.ts
workflows/wave1-runtime/02-workflow-evidence-model.ts
workflows/wave1-runtime/03-workflow-failure-classification.ts
workflows/wave2-product/01-workflow-spec-intake.ts
workflows/wave2-product/02-workflow-generation-pipeline.ts
workflows/wave2-product/03-workflow-debugger-specialist.ts
workflows/wave2-product/04-workflow-validator-specialist.ts
workflows/wave3-cloud-api/01-cloud-connect-and-auth.ts
workflows/wave3-cloud-api/02-generate-endpoint.ts
workflows/wave4-local-byoh/01-cli-onboarding-and-welcome.ts
workflows/wave4-local-byoh/02-local-invocation-entrypoint.ts
workflows/wave4-local-byoh/03-cli-onboarding-ux-spec.ts
workflows/wave4-local-byoh/04-implement-cli-onboarding-from-ux-spec.ts
workflows/wave4-local-byoh/05-prove-cli-onboarding-first-run-and-recovery.ts
workflows/wave5-scale-and-ops/01-workflow-health-analytics.ts
workflows/wave5-scale-and-ops/02-next-wave-backlog-and-proof-plan.ts
EOF
      ;;
  esac
}

queue_count() {
  awk 'NF { count += 1 } END { print count + 0 }' "$QUEUE_FILE"
}

log() {
  printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"
}

workflow_has_stale_package_targets() {
  local workflow_path="$1"

  grep -Eq "packages/cli/packages/cli/|(^|[^[:alnum:]_])src/(shared|runtime|product|cloud|local|cli)/" "$workflow_path"
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
    *)
      return 1
      ;;
  esac
}

is_pid_running() {
  local pid="$1"

  [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null
}

persist_checkpoint() {
  cat > "$CHECKPOINT_FILE" <<EOF
queue_mode=$QUEUE_MODE
current_pass=$CURRENT_PASS
current_index=$CURRENT_INDEX
workflows_run=$WORKFLOWS_RUN
artifact_dir=$ARTIFACT_DIR
initial_git_head=$INITIAL_GIT_HEAD
current_workflow=$CURRENT_WORKFLOW
run_pid=$RUN_PID
updated_at=$(date '+%Y-%m-%dT%H:%M:%S%z')
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
  source "$STATE_FILE"

  local previous_artifact_dir="${artifact_dir:-}"
  local previous_status_file=""
  local previous_pid="${run_pid:-}"
  if [[ -n "$previous_artifact_dir" ]]; then
    previous_status_file="$previous_artifact_dir/status.txt"
  fi
  if [[ -n "$previous_status_file" && -f "$previous_status_file" ]] && grep -qx 'running' "$previous_status_file"; then
    if ! is_pid_running "$previous_pid"; then
      printf '%s\n' 'stale' > "$previous_status_file"
      log "marked stale prior overnight artifact: $previous_artifact_dir"
    fi
  fi

  CURRENT_PASS="${current_pass:-1}"
  CURRENT_INDEX="${current_index:-0}"
  INITIAL_GIT_HEAD="${initial_git_head:-}"
}

write_summary() {
  local status="$1"
  local queue_total
  queue_total="$(queue_count)"
  cat > "$SUMMARY_FILE" <<EOF
# Ricky overnight run

- status: $status
- reason: ${STATUS_REASON:-n/a}
- started: $(date -r "$START_EPOCH" '+%Y-%m-%d %H:%M:%S %Z')
- current: $(date '+%Y-%m-%d %H:%M:%S %Z')
- duration_hours: $DURATION_HOURS
- passes: $PASSES
- queue_mode: $QUEUE_MODE
- max_workflows_per_invocation: $MAX_WORKFLOWS_PER_INVOCATION
- queue_total: $queue_total
- current_pass: $CURRENT_PASS
- current_index: $CURRENT_INDEX
- workflows_run_this_invocation: $WORKFLOWS_RUN
- artifact_dir: $ARTIFACT_DIR
- checkpoint_file: $STATE_FILE
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

  "$RUNNER" run "$workflow_path" > >(tee -a "$runner_output") 2>&1 &
  runner_pid=$!
  RUN_PID="$runner_pid"
  persist_checkpoint

  while is_pid_running "$runner_pid"; do
    if workflow_hit_claude_rate_limit "$runner_output"; then
      log "workflow blocked by Claude rate limit prompt: $workflow_path"
      kill "$runner_pid" 2>/dev/null || true
      wait "$runner_pid" 2>/dev/null || true
      echo "$workflow_path" >> "$FAILED_FILE"
      inspect_repo_changes
      mark_status "blocked" "claude rate limit prompt: $workflow_path"
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
  persist_checkpoint

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

write_queue

if [[ ! -x "$RUNNER" ]]; then
  echo "ERROR: agent-relay runner not found at $RUNNER"
  exit 1
fi

cd "$REPO_ROOT"

echo "running" > "$STATUS_FILE"
git rev-parse HEAD > "$LAST_COMMIT_FILE"
INITIAL_GIT_HEAD="$(cat "$LAST_COMMIT_FILE")"
restore_checkpoint
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
  CURRENT_PASS="$pass"
  local_start_index=0
  if (( pass == CURRENT_PASS )); then
    local_start_index="$CURRENT_INDEX"
  fi

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

if [[ -s "$FAILED_FILE" ]]; then
  mark_status "complete-with-failures" "queue finished with failed workflows"
else
  mark_status "complete" "queue finished"
fi
rm -f "$STATE_FILE"
log "overnight queue finished"
