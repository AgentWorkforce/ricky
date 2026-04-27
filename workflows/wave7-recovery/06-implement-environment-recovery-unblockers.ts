import { workflow } from '@agent-relay/sdk/workflows';

async function main() {
  const result = await workflow('ricky-wave7-implement-environment-recovery-unblockers')
    .description('Implement Ricky environment recovery preflights and unblocker decisions so stale relay state and unsafe reruns are surfaced before operators waste time.')
    .pattern('dag')
    .channel('wf-ricky-wave7-recovery-unblockers')
    .maxConcurrency(4)
    .timeout(3_600_000)
    .onError('retry', { maxRetries: 2, retryDelayMs: 10_000 })

    .agent('impl-codex', {
      cli: 'codex',
      role: 'Implements preflight checks and conservative environment recovery recommendations within Ricky runtime/product seams.',
      retries: 2,
    })
    .agent('review-claude', {
      cli: 'claude',
      preset: 'reviewer',
      role: 'Reviews safety, taxonomy fit, and operator usefulness of recovery recommendations.',
      retries: 1,
    })

    .step('prepare-artifacts', {
      type: 'deterministic',
      command: [
        'mkdir -p .workflow-artifacts/wave7-recovery/implement-environment-recovery-unblockers',
        'echo RICKY_WAVE7_RECOVERY_READY',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })
    .step('read-runtime-product-context', {
      type: 'deterministic',
      dependsOn: ['prepare-artifacts'],
      command: [
        'sed -n "1,260p" packages/runtime/src/diagnostics/failure-diagnosis.ts',
        'printf "\n---\n\n"',
        'sed -n "1,260p" packages/product/src/validator/index.ts',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })
    .step('implement-recovery-unblockers', {
      agent: 'impl-codex',
      dependsOn: ['read-runtime-product-context'],
      task: `Implement bounded environment preflight and recovery recommendation coverage in the existing Ricky runtime/product testable seams.

Requirements:
- cover stale relay state, missing config, unsupported validation commands, already-running state, and repo validation mismatch
- recommend before mutating; keep destructive cleanup out of scope
- align restart/rerun decisions to current failure taxonomy categories`,
      verification: { type: 'exit_code', value: '0' },
    })
    .step('final-hard-validation', {
      type: 'deterministic',
      dependsOn: ['implement-recovery-unblockers'],
      command: 'npm run typecheck && npm test --workspace @ricky/runtime && npm test --workspace @ricky/product',
      captureOutput: true,
      failOnError: true,
    })
    .step('final-signoff', {
      type: 'deterministic',
      dependsOn: ['final-hard-validation'],
      command: [
        "cat <<'EOF' > .workflow-artifacts/wave7-recovery/implement-environment-recovery-unblockers/signoff.md",
        '# Ricky environment recovery unblockers signoff',
        '',
        'Validation commands:',
        '- npm run typecheck',
        '- npm test --workspace @ricky/runtime',
        '- npm test --workspace @ricky/product',
        '',
        'Expected slice truth:',
        '- environment blockers are detected conservatively before wasteful reruns',
        '- restart/rerun decisions map to Ricky taxonomy classes',
        '',
        'RECOVERY_UNBLOCKERS_COMPLETE',
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
