#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RUNNER="${AGENT_RELAY_BIN:-$HOME/.local/bin/agent-relay}"
DURATION_HOURS="${RICKY_OVERNIGHT_HOURS:-7}"
POLL_SECONDS="${RICKY_OVERNIGHT_POLL_SECONDS:-15}"
PASSES="${RICKY_OVERNIGHT_PASSES:-3}"
QUEUE_MODE="${RICKY_OVERNIGHT_QUEUE_MODE:-expanded}"
STAMP="$(date +%Y%m%d-%H%M%S)"
ARTIFACT_DIR="$REPO_ROOT/.workflow-artifacts/overnight-$STAMP"
LOG_FILE="$ARTIFACT_DIR/overnight.log"
STATUS_FILE="$ARTIFACT_DIR/status.txt"
SUMMARY_FILE="$ARTIFACT_DIR/summary.md"
LAST_COMMIT_FILE="$ARTIFACT_DIR/last-commit.txt"
QUEUE_FILE="$ARTIFACT_DIR/queue.txt"
FAILED_FILE="$ARTIFACT_DIR/failed.txt"
STOP_FILE="$ARTIFACT_DIR/STOP"

mkdir -p "$ARTIFACT_DIR"
: > "$LOG_FILE"
: > "$FAILED_FILE"

exec > >(tee -a "$LOG_FILE") 2>&1

START_EPOCH="$(date +%s)"
END_EPOCH="$((START_EPOCH + DURATION_HOURS * 3600))"

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
    expanded|*)
      cat > "$QUEUE_FILE" <<'EOF'
workflows/wave4-local-byoh/09-implement-cli-command-surface.ts
workflows/wave4-local-byoh/08-implement-interactive-cli-entrypoint.ts
workflows/wave4-local-byoh/06-implement-local-byoh-entrypoint.ts
workflows/wave4-local-byoh/07-prove-local-spec-handoff-and-artifact-return.ts
workflows/wave6-proof/11-prove-cli-surface-honesty-and-empty-handoff-recovery.ts
workflows/wave3-cloud-api/03-implement-ricky-cloud-generate-slice.ts
workflows/wave3-cloud-api/04-prove-cloud-connect-and-generate-happy-path.ts
workflows/wave1-runtime/04-implement-failure-diagnosis-engine.ts
workflows/wave1-runtime/05-prove-runtime-environment-orchestration-unblockers.ts
workflows/wave5-scale-and-ops/03-align-ricky-package-conventions.ts
workflows/wave5-scale-and-ops/04-prove-ricky-package-layout-and-script-parity.ts
workflows/wave0-foundation/02-toolchain-and-validation-foundation.ts
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

write_queue

if [[ ! -x "$RUNNER" ]]; then
  echo "ERROR: agent-relay runner not found at $RUNNER"
  exit 1
fi

cd "$REPO_ROOT"

echo "running" > "$STATUS_FILE"
git rev-parse HEAD > "$LAST_COMMIT_FILE"

log() {
  printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"
}

write_summary() {
  local status="$1"
  cat > "$SUMMARY_FILE" <<EOF
# Ricky overnight run

- status: $status
- started: $(date -r "$START_EPOCH" '+%Y-%m-%d %H:%M:%S %Z')
- current: $(date '+%Y-%m-%d %H:%M:%S %Z')
- duration_hours: $DURATION_HOURS
- passes: $PASSES
- queue_mode: $QUEUE_MODE
- artifact_dir: $ARTIFACT_DIR
- last_commit: $(cat "$LAST_COMMIT_FILE" 2>/dev/null || echo unknown)
- failed_workflows:
$(sed 's/^/  - /' "$FAILED_FILE" 2>/dev/null || true)
EOF
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

commit_if_clean_delta() {
  local workflow_path="$1"
  if git diff --quiet && [[ -z "$(git ls-files --others --exclude-standard -- ':!tmp/' ':!.workflow-artifacts/')" ]]; then
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

run_one() {
  local workflow_path="$1"
  log ">>> running $workflow_path"

  if ! "$RUNNER" run "$workflow_path"; then
    log "workflow exited non-zero: $workflow_path"
    echo "$workflow_path" >> "$FAILED_FILE"
    inspect_repo_changes

    if git diff --quiet && [[ -z "$(git ls-files --others --exclude-standard -- ':!tmp/' ':!.workflow-artifacts/')" ]]; then
      log "no useful repo changes after failure; stopping on uncertainty"
      echo "blocked" > "$STATUS_FILE"
      write_summary "blocked"
      return 1
    fi

    log "failure produced repo changes; validating before capture"
    commit_if_clean_delta "$workflow_path"
    return 0
  fi

  log "workflow completed: $workflow_path"
  commit_if_clean_delta "$workflow_path"
  return 0
}

for pass in $(seq 1 "$PASSES"); do
  log "starting overnight pass $pass/$PASSES"

  while IFS= read -r workflow_path; do
    [[ -z "$workflow_path" ]] && continue

    if [[ -f "$STOP_FILE" ]]; then
      log "stop file detected; ending overnight run"
      echo "stopped" > "$STATUS_FILE"
      write_summary "stopped"
      exit 0
    fi

    now="$(date +%s)"
    if (( now >= END_EPOCH )); then
      log "overnight duration reached"
      echo "complete" > "$STATUS_FILE"
      write_summary "complete"
      exit 0
    fi

    if ! run_one "$workflow_path"; then
      exit 1
    fi

    sleep "$POLL_SECONDS"
  done < "$QUEUE_FILE"
done

echo "complete" > "$STATUS_FILE"
write_summary "complete"
log "overnight queue finished"
