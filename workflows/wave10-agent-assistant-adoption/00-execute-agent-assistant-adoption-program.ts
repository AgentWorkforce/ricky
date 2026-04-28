import { workflow } from '@agent-relay/sdk/workflows';

const artifactDir = '.workflow-artifacts/wave10-agent-assistant-adoption/executor';

async function main() {
  const result = await workflow('ricky-wave10-execute-agent-assistant-adoption-program')
    .description('Execute the full wave10 Ricky agent-assistant adoption program either sequentially or as a parallel wave with explicit dependency barriers.')
    .pattern('pipeline')
    .channel('wf-ricky-wave10-agent-assistant-executor')
    .maxConcurrency(2)
    .timeout(14_400_000)
    .onError('retry', { maxRetries: 1, retryDelayMs: 10_000 })

    .step('preflight', {
      type: 'deterministic',
      command: [
        `DIR=${artifactDir}`,
        'mkdir -p "$DIR"',
        'MODE="${WAVE10_EXECUTION_MODE:-parallel}"',
        'case "$MODE" in parallel|sequential) ;; *) echo "ERROR: WAVE10_EXECUTION_MODE must be parallel or sequential"; exit 1 ;; esac',
        'test -f workflows/wave10-agent-assistant-adoption/01-verify-and-close-wave9-docs.ts',
        'test -f workflows/wave10-agent-assistant-adoption/02-adopt-request-turn-context-adapter.ts',
        'test -f workflows/wave10-agent-assistant-adoption/03-prove-live-product-path.ts',
        'test -f workflows/wave10-agent-assistant-adoption/04-close-agent-assistant-handoff-issue.ts',
        'npx tsc --noEmit',
        'gh auth status >/dev/null 2>&1 || { echo "ERROR: gh CLI must be authenticated because child workflows close GitHub issues"; exit 1; }',
        'printf "mode=%s\\n" "$MODE" > "$DIR/execution-mode.txt"',
        'echo EXECUTOR_PREFLIGHT_OK',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })
    .step('execute-wave10-program', {
      type: 'deterministic',
      dependsOn: ['preflight'],
      command: [
        "/bin/bash <<'EXECUTOR'",
        'set -euo pipefail',
        `DIR=${artifactDir}`,
        'mkdir -p "$DIR"',
        'MODE="${WAVE10_EXECUTION_MODE:-parallel}"',
        '',
        'run_workflow() {',
        '  local name="$1"',
        '  local file="$2"',
        '  local signoff="$3"',
        '  local marker="$4"',
        '  local log="$DIR/$name.log"',
        '  if [ -f "$signoff" ] && grep -F "$marker" "$signoff" >/dev/null 2>&1; then',
        '    echo "[$name] skipping; signoff already contains $marker"',
        '    echo "0" > "$DIR/$name.exit"',
        '    return 0',
        '  fi',
        '  echo "[$name] starting $file"',
        '  set +e',
        '  npx tsx "$file" 2>&1 | tee "$log"',
        '  local status=${PIPESTATUS[0]}',
        '  set -e',
        '  if grep -F "[workflow] FAILED:" "$log" >/dev/null 2>&1; then',
        '    status=1',
        '  fi',
        '  if ! grep -F "[workflow] completed" "$log" >/dev/null 2>&1; then',
        '    status=1',
        '  fi',
        '  echo "$status" > "$DIR/$name.exit"',
        '  if [ "$status" -ne 0 ]; then',
        '    echo "[$name] failed with exit $status"',
        '    exit "$status"',
        '  fi',
        '  echo "[$name] complete"',
        '}',
        '',
        'wait_for_pid() {',
        '  local pid="$1"',
        '  local name="$2"',
        '  if ! wait "$pid"; then',
        '    echo "[$name] failed"',
        '    return 1',
        '  fi',
        '}',
        '',
        'if [ "$MODE" = "sequential" ]; then',
        '  run_workflow "01-verify-and-close-wave9-docs" "workflows/wave10-agent-assistant-adoption/01-verify-and-close-wave9-docs.ts" ".workflow-artifacts/wave10-agent-assistant-adoption/verify-and-close-wave9-docs/signoff.md" "WAVE9_AGENT_ASSISTANT_DOC_ISSUES_COMPLETE"',
        '  run_workflow "02-adopt-request-turn-context-adapter" "workflows/wave10-agent-assistant-adoption/02-adopt-request-turn-context-adapter.ts" ".workflow-artifacts/wave10-agent-assistant-adoption/adopt-request-turn-context-adapter/signoff.md" "RICKY_TURN_CONTEXT_ADOPTION_IMPLEMENTED"',
        '  run_workflow "03-prove-live-product-path" "workflows/wave10-agent-assistant-adoption/03-prove-live-product-path.ts" ".workflow-artifacts/wave10-agent-assistant-adoption/prove-live-product-path/signoff.md" "RICKY_AGENT_ASSISTANT_ADOPTION_LIVE_PROOF_COMPLETE"',
        '  run_workflow "04-close-agent-assistant-handoff-issue" "workflows/wave10-agent-assistant-adoption/04-close-agent-assistant-handoff-issue.ts" ".workflow-artifacts/wave10-agent-assistant-adoption/close-agent-assistant-handoff-issue/signoff.md" "RICKY_AGENT_ASSISTANT_HANDOFF_COMPLETE"',
        'else',
        '  run_workflow "01-verify-and-close-wave9-docs" "workflows/wave10-agent-assistant-adoption/01-verify-and-close-wave9-docs.ts" ".workflow-artifacts/wave10-agent-assistant-adoption/verify-and-close-wave9-docs/signoff.md" "WAVE9_AGENT_ASSISTANT_DOC_ISSUES_COMPLETE" &',
        '  pid_docs=$!',
        '  run_workflow "02-adopt-request-turn-context-adapter" "workflows/wave10-agent-assistant-adoption/02-adopt-request-turn-context-adapter.ts" ".workflow-artifacts/wave10-agent-assistant-adoption/adopt-request-turn-context-adapter/signoff.md" "RICKY_TURN_CONTEXT_ADOPTION_IMPLEMENTED" &',
        '  pid_adoption=$!',
        '  wait_for_pid "$pid_docs" "01-verify-and-close-wave9-docs"',
        '  wait_for_pid "$pid_adoption" "02-adopt-request-turn-context-adapter"',
        '  run_workflow "03-prove-live-product-path" "workflows/wave10-agent-assistant-adoption/03-prove-live-product-path.ts" ".workflow-artifacts/wave10-agent-assistant-adoption/prove-live-product-path/signoff.md" "RICKY_AGENT_ASSISTANT_ADOPTION_LIVE_PROOF_COMPLETE"',
        '  run_workflow "04-close-agent-assistant-handoff-issue" "workflows/wave10-agent-assistant-adoption/04-close-agent-assistant-handoff-issue.ts" ".workflow-artifacts/wave10-agent-assistant-adoption/close-agent-assistant-handoff-issue/signoff.md" "RICKY_AGENT_ASSISTANT_HANDOFF_COMPLETE"',
        'fi',
        '',
        'echo WAVE10_AGENT_ASSISTANT_EXECUTION_COMPLETE',
        'EXECUTOR',
      ].join('\n'),
      captureOutput: true,
      failOnError: true,
    })
    .step('verify-child-signoffs', {
      type: 'deterministic',
      dependsOn: ['execute-wave10-program'],
      command: [
        `DIR=${artifactDir}`,
        'grep -F "WAVE9_AGENT_ASSISTANT_DOC_ISSUES_COMPLETE" .workflow-artifacts/wave10-agent-assistant-adoption/verify-and-close-wave9-docs/signoff.md',
        'grep -F "RICKY_TURN_CONTEXT_ADOPTION_IMPLEMENTED" .workflow-artifacts/wave10-agent-assistant-adoption/adopt-request-turn-context-adapter/signoff.md',
        'grep -F "RICKY_AGENT_ASSISTANT_ADOPTION_LIVE_PROOF_COMPLETE" .workflow-artifacts/wave10-agent-assistant-adoption/prove-live-product-path/signoff.md',
        'grep -F "RICKY_AGENT_ASSISTANT_HANDOFF_COMPLETE" .workflow-artifacts/wave10-agent-assistant-adoption/close-agent-assistant-handoff-issue/signoff.md',
        'for issue in 9 10 11 12 13 14; do test "$(gh issue view "$issue" --json state --jq .state)" = "CLOSED"; done',
        'npm test',
        'echo EXECUTOR_CHILD_SIGNOFFS_VERIFIED',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })
    .step('signoff', {
      type: 'deterministic',
      dependsOn: ['verify-child-signoffs'],
      command: [
        `DIR=${artifactDir}`,
        "cat > \"$DIR/signoff.md\" <<'EOF'",
        '# Wave10 agent-assistant adoption executor signoff',
        '',
        'Execution modes:',
        '- default: WAVE10_EXECUTION_MODE=parallel',
        '- strict: WAVE10_EXECUTION_MODE=sequential',
        '',
        'Parallel ordering:',
        '- 01 and 02 run concurrently',
        '- 03 runs after 01 and 02 finish',
        '- 04 runs after 03 finishes',
        '',
        'Validation:',
        '- child workflow signoffs verified',
        '- issues #9, #10, #11, #12, #13, and #14 verified closed',
        '- npm test passed after program execution',
        '',
        'WAVE10_AGENT_ASSISTANT_EXECUTOR_COMPLETE',
        'EOF',
      ].join('\n'),
      captureOutput: true,
      failOnError: true,
    })

    .run({ cwd: process.cwd() });

  console.log(result.status);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
