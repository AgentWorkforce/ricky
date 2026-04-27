import { workflow } from '@agent-relay/sdk/workflows';

async function main() {
  const result = await workflow('ricky-wave7-prove-runtime-execution-outcome-loop')
    .description('Prove Ricky runtime execution outcomes with a deterministic fixture-backed runner so success, verification failure, timeout, and environment blocker summaries are user-usable.')
    .pattern('dag')
    .channel('wf-ricky-wave7-runtime-outcome-proof')
    .maxConcurrency(4)
    .timeout(3_600_000)
    .onError('retry', { maxRetries: 2, retryDelayMs: 10_000 })

    .agent('impl-codex', {
      cli: 'codex',
      role: 'Implements fixture-backed runtime outcome proof helpers and tests without depending on live relay execution.',
      retries: 2,
    })
    .agent('review-claude', {
      cli: 'claude',
      preset: 'reviewer',
      role: 'Reviews whether outcome evidence is sufficient for future CLI, Cloud, and Slack presentation.',
      retries: 1,
    })

    .step('prepare-artifacts', {
      type: 'deterministic',
      command: [
        'mkdir -p .workflow-artifacts/wave7-runtime-proof/prove-runtime-execution-outcome-loop',
        'echo RICKY_WAVE7_RUNTIME_OUTCOME_READY',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })
    .step('read-runtime-context', {
      type: 'deterministic',
      dependsOn: ['prepare-artifacts'],
      command: [
        'sed -n "1,260p" packages/runtime/src/local-coordinator.ts',
        'printf "\n---\n\n"',
        'sed -n "1,260p" packages/runtime/src/diagnostics/failure-diagnosis.ts',
        'printf "\n---\n\n"',
        'sed -n "1,260p" packages/runtime/src/evidence/capture.ts',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })
    .step('implement-runtime-outcome-proof', {
      agent: 'impl-codex',
      dependsOn: ['read-runtime-context'],
      task: `Implement only bounded fixture-backed proof files needed for runtime outcome coverage. Favor package test/proof files under packages/runtime/src.

Requirements:
- prove success, verification failure, timeout, and runner/environment failure outcomes
- capture run id, step events, gate results, stdout/stderr snippets, and final summary shape
- map outcome summaries to the existing failure taxonomy where appropriate
- keep the runner deterministic; no live agent-relay dependency`,
      verification: { type: 'exit_code', value: '0' },
    })
    .step('initial-soft-validation', {
      type: 'deterministic',
      dependsOn: ['implement-runtime-outcome-proof'],
      command: 'npm run typecheck && npm test --workspace @ricky/runtime',
      captureOutput: true,
      failOnError: false,
    })
    .step('review-runtime-proof', {
      agent: 'review-claude',
      dependsOn: ['initial-soft-validation'],
      task: `Review the runtime outcome proof for evidence usefulness and honesty.
Write .workflow-artifacts/wave7-runtime-proof/prove-runtime-execution-outcome-loop/review-claude.md ending with REVIEW_CLAUDE_PASS or REVIEW_CLAUDE_FAIL.`,
      verification: { type: 'file_exists', value: '.workflow-artifacts/wave7-runtime-proof/prove-runtime-execution-outcome-loop/review-claude.md' },
    })
    .step('final-hard-validation', {
      type: 'deterministic',
      dependsOn: ['review-runtime-proof'],
      command: 'npm run typecheck && npm test --workspace @ricky/runtime',
      captureOutput: true,
      failOnError: true,
    })
    .step('final-signoff', {
      type: 'deterministic',
      dependsOn: ['final-hard-validation'],
      command: [
        "cat <<'EOF' > .workflow-artifacts/wave7-runtime-proof/prove-runtime-execution-outcome-loop/signoff.md",
        '# Ricky runtime execution outcome loop signoff',
        '',
        'Validation commands:',
        '- npm run typecheck',
        '- npm test --workspace @ricky/runtime',
        '',
        'Expected proof truth:',
        '- deterministic runtime outcome evidence exists for success, verification failure, timeout, and environment blocker classes',
        '',
        'RUNTIME_OUTCOME_PROOF_COMPLETE',
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
