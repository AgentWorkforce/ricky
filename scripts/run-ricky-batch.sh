#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MODE="${1:-help}"
DRY_FLAG="${2:-}"

RUNNER_LABEL=""
RUNNER_KIND=""
RUNNER_PREFIX=()

runner_works() {
  local candidate="$1"
  [[ -n "$candidate" ]] || return 1
  [[ -x "$candidate" ]] || return 1
  "$candidate" run --help >/dev/null 2>&1
}

resolve_runner() {
  local configured_runner="${AGENT_RELAY_BIN:-}"
  local path_runner="$(command -v agent-relay 2>/dev/null || true)"
  local legacy_runner="$HOME/.local/bin/agent-relay"

  if runner_works "$configured_runner"; then
    RUNNER_LABEL="$configured_runner"
    RUNNER_KIND="cli"
    RUNNER_PREFIX=("$configured_runner")
    return 0
  fi

  if runner_works "$path_runner"; then
    RUNNER_LABEL="$path_runner"
    RUNNER_KIND="cli"
    RUNNER_PREFIX=("$path_runner")
    return 0
  fi

  if runner_works "$legacy_runner"; then
    RUNNER_LABEL="$legacy_runner"
    RUNNER_KIND="cli"
    RUNNER_PREFIX=("$legacy_runner")
    return 0
  fi

  if node --input-type=module -e "await import('@agent-relay/sdk/workflows')" >/dev/null 2>&1; then
    RUNNER_LABEL="@agent-relay/sdk/workflows runScriptWorkflow"
    RUNNER_KIND="sdk"
    RUNNER_PREFIX=(node --input-type=module -e "import { runScriptWorkflow } from '@agent-relay/sdk/workflows'; const args = process.argv.slice(1); const dryRun = args[0] === '--dry-run'; const filePath = dryRun ? args[1] : args[0]; if (!filePath) throw new Error('workflow path required'); await runScriptWorkflow(filePath, { dryRun });" --)
    return 0
  fi

  echo "error: no usable workflow runner found. Tried AGENT_RELAY_BIN, agent-relay on PATH, $legacy_runner, and local @agent-relay/sdk/workflows runtime." >&2
  if [[ -n "$path_runner" ]]; then
    echo "note: PATH resolves agent-relay to $path_runner, but it does not support 'run' here." >&2
  fi
  return 1
}

resolve_runner

run_workflow() {
  local workflow_path="$1"
  echo
  echo ">>> Running $workflow_path"
  if [[ "$RUNNER_KIND" == "sdk" ]]; then
    if [[ "$DRY_FLAG" == "--dry-run" ]]; then
      "${RUNNER_PREFIX[@]}" --dry-run "$workflow_path"
    else
      "${RUNNER_PREFIX[@]}" "$workflow_path"
    fi
    return
  fi

  if [[ "$DRY_FLAG" == "--dry-run" ]]; then
    "${RUNNER_PREFIX[@]}" run --dry-run "$workflow_path"
  else
    "${RUNNER_PREFIX[@]}" run "$workflow_path"
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
