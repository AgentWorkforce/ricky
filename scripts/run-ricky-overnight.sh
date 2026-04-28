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
SCRIPT_PGID="$(ps -o pgid= -p $$ 2>/dev/null | tr -d '[:space:]')"
RUNNER_START_PID=""
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

mark_artifact_stale_or_complete() {
  local artifact_dir="$1"
  local status_file="$artifact_dir/status.txt"
  local summary_file="$artifact_dir/summary.md"
  local resolved_status="stale"
  local resolved_reason="process exited unexpectedly"

  [[ -d "$artifact_dir" ]] || return 0

  if artifact_runner_logs_show_success "$artifact_dir"; then
    resolved_status="complete"
    resolved_reason="runner completed before harness status flush"
  fi

  printf '%s\n' "$resolved_status" > "$status_file"

  if [[ ! -f "$summary_file" ]]; then
    cat > "$summary_file" <<EOF
# Ricky overnight run

- status: $resolved_status
- reason: $resolved_reason
- artifact_dir: $artifact_dir
EOF
  fi
}

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
workflows/wave5-scale-and-ops/05-split-ricky-into-workspace-packages.ts
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
  RUN_PGID=""
  if command -v ps >/dev/null 2>&1; then
    RUN_PGID="$(ps -o pgid= -p "$runner_pid" 2>/dev/null | tr -d '[:space:]')"
    if [[ -n "$SCRIPT_PGID" && "$RUN_PGID" == "$SCRIPT_PGID" ]]; then
      log "runner shares shell process group; disabling process-group tracking for stale detection"
      RUN_PGID=""
    fi
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

echo "running" > "$STATUS_FILE"
git rev-parse HEAD > "$LAST_COMMIT_FILE"
INITIAL_GIT_HEAD="$(cat "$LAST_COMMIT_FILE")"
restore_checkpoint
write_queue
filter_queue_for_repo_state
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
if [[ -f "$STATE_FILE" || -f "$CHECKPOINT_FILE" ]]; then
  rm -f "$STATE_FILE" "$CHECKPOINT_FILE"
  write_summary "$(cat "$STATUS_FILE")"
fi
log "overnight queue finished"
