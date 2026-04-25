#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RUNNER="${AGENT_RELAY_BIN:-$HOME/.local/bin/agent-relay}"
MODE="${1:-help}"
DRY_FLAG="${2:-}"

if [[ ! -x "$RUNNER" ]]; then
  echo "error: agent-relay runner not found at $RUNNER" >&2
  exit 1
fi

run_workflow() {
  local workflow_path="$1"
  echo
  echo ">>> Running $workflow_path"
  if [[ "$DRY_FLAG" == "--dry-run" ]]; then
    "$RUNNER" run --dry-run "$workflow_path"
  else
    "$RUNNER" run "$workflow_path"
  fi
}

case "$MODE" in
  local)
    run_workflow "$REPO_ROOT/workflows/wave4-local-byoh/06-implement-local-byoh-entrypoint.ts"
    run_workflow "$REPO_ROOT/workflows/wave4-local-byoh/07-prove-local-spec-handoff-and-artifact-return.ts"
    ;;
  cloud)
    run_workflow "$REPO_ROOT/workflows/wave3-cloud-api/03-implement-ricky-cloud-generate-slice.ts"
    run_workflow "$REPO_ROOT/workflows/wave3-cloud-api/04-prove-cloud-connect-and-generate-happy-path.ts"
    ;;
  diagnosis)
    run_workflow "$REPO_ROOT/workflows/wave1-runtime/04-implement-failure-diagnosis-engine.ts"
    run_workflow "$REPO_ROOT/workflows/wave1-runtime/05-prove-runtime-environment-orchestration-unblockers.ts"
    ;;
  all)
    run_workflow "$REPO_ROOT/workflows/wave4-local-byoh/06-implement-local-byoh-entrypoint.ts"
    run_workflow "$REPO_ROOT/workflows/wave4-local-byoh/07-prove-local-spec-handoff-and-artifact-return.ts"
    run_workflow "$REPO_ROOT/workflows/wave3-cloud-api/03-implement-ricky-cloud-generate-slice.ts"
    run_workflow "$REPO_ROOT/workflows/wave3-cloud-api/04-prove-cloud-connect-and-generate-happy-path.ts"
    run_workflow "$REPO_ROOT/workflows/wave1-runtime/04-implement-failure-diagnosis-engine.ts"
    run_workflow "$REPO_ROOT/workflows/wave1-runtime/05-prove-runtime-environment-orchestration-unblockers.ts"
    ;;
  help|--help|-h|*)
    cat <<'EOF'
Usage:
  scripts/run-ricky-batch.sh <local|cloud|diagnosis|all> [--dry-run]

Examples:
  scripts/run-ricky-batch.sh local --dry-run
  scripts/run-ricky-batch.sh cloud
  scripts/run-ricky-batch.sh diagnosis --dry-run
EOF
    if [[ "$MODE" != "help" && "$MODE" != "--help" && "$MODE" != "-h" ]]; then
      exit 1
    fi
    ;;
esac
