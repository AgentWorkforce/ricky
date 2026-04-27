import { workflow } from '@agent-relay/sdk/workflows';

async function main() {
  const result = await workflow('ricky-wave7-prove-local-byoh-spec-to-artifact-loop')
    .description('Prove the Ricky local/BYOH path from immediate CLI spec intake through normalization, generation, validation, and artifact-or-blocker return.')
    .pattern('dag')
    .channel('wf-ricky-wave7-local-spec-loop')
    .maxConcurrency(4)
    .timeout(3_600_000)
    .onError('retry', { maxRetries: 2, retryDelayMs: 10_000 })

    .agent('impl-codex', {
      cli: 'codex',
      role: 'Implements deterministic local spec-to-artifact proof helpers and tests using existing Ricky package seams.',
      retries: 2,
    })
    .agent('review-claude', {
      cli: 'claude',
      preset: 'reviewer',
      role: 'Reviews whether the proof demonstrates a real user-facing local loop instead of isolated module success.',
      retries: 1,
    })
    .agent('validator-claude', {
      cli: 'claude',
      preset: 'worker',
      role: 'Runs bounded fixes and validation reruns until the local loop proof is honest and passing.',
      retries: 2,
    })

    .step('prepare-artifacts', {
      type: 'deterministic',
      command: [
        'mkdir -p .workflow-artifacts/wave7-local-proof/prove-local-byoh-spec-to-artifact-loop',
        'mkdir -p packages/local/src/proof packages/cli/src/proof',
        'echo RICKY_WAVE7_LOCAL_SPEC_LOOP_READY',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })
    .step('read-local-cli-product-context', {
      type: 'deterministic',
      dependsOn: ['prepare-artifacts'],
      command: [
        'sed -n "1,260p" packages/local/src/entrypoint.ts',
        'printf "\n---\n\n"',
        'sed -n "1,260p" packages/local/src/entrypoint.test.ts',
        'printf "\n---\n\n"',
        'sed -n "1,260p" packages/cli/src/entrypoint/interactive-cli.ts',
        'printf "\n---\n\n"',
        'sed -n "1,260p" packages/product/src/generation/index.ts',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })
    .step('implement-local-spec-loop-proof', {
      agent: 'impl-codex',
      dependsOn: ['read-local-cli-product-context'],
      task: `Implement the proof slice only in these files:
- packages/local/src/proof/local-entrypoint-proof.ts
- packages/local/src/proof/local-entrypoint-proof.test.ts
- packages/local/src/entrypoint.test.ts
- packages/cli/src/entrypoint/interactive-cli.test.ts

Requirements:
- prove a local CLI spec can become a normalized request, generated artifact metadata, validator result, and user-facing response
- include a failure fixture for missing local prerequisites or missing spec material
- keep the runtime adapter deterministic; do not require live Cloud or external credentials
- make the proof artifact quality high enough that a human can tell whether Ricky is closer to testable after this slice`,
      verification: { type: 'file_exists', value: 'packages/local/src/proof/local-entrypoint-proof.ts' },
    })
    .step('proof-file-gate', {
      type: 'deterministic',
      dependsOn: ['implement-local-spec-loop-proof'],
      command: [
        'grep -Eq "normalized request|artifact|validator|blocker|local prerequisite|spec" packages/local/src/proof/local-entrypoint-proof.ts packages/local/src/proof/local-entrypoint-proof.test.ts packages/local/src/entrypoint.test.ts packages/cli/src/entrypoint/interactive-cli.test.ts',
        'echo LOCAL_SPEC_LOOP_PROOF_FILES_PRESENT',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })
    .step('initial-soft-validation', {
      type: 'deterministic',
      dependsOn: ['proof-file-gate'],
      command: 'npm run typecheck && npm test --workspace @ricky/local && npm test --workspace @ricky/cli && npm test --workspace @ricky/product',
      captureOutput: true,
      failOnError: false,
    })
    .step('review-local-loop', {
      agent: 'review-claude',
      dependsOn: ['initial-soft-validation'],
      task: `Review the local spec-to-artifact proof.

Focus:
- does it prove the actual user loop more than the current subsystem-only state?
- are blockers classified as setup/environment issues when appropriate?
- is the evidence understandable enough for manual retest confidence?

Write .workflow-artifacts/wave7-local-proof/prove-local-byoh-spec-to-artifact-loop/review-claude.md ending with REVIEW_CLAUDE_PASS or REVIEW_CLAUDE_FAIL.`,
      verification: { type: 'file_exists', value: '.workflow-artifacts/wave7-local-proof/prove-local-byoh-spec-to-artifact-loop/review-claude.md' },
    })
    .step('fix-loop', {
      agent: 'validator-claude',
      dependsOn: ['review-local-loop'],
      task: `Consume the review result and current validation output. Apply bounded fixes still needed for this proof slice, then rerun:
- npm run typecheck
- npm test --workspace @ricky/local
- npm test --workspace @ricky/cli
- npm test --workspace @ricky/product

Write .workflow-artifacts/wave7-local-proof/prove-local-byoh-spec-to-artifact-loop/fix-loop.md ending with LOCAL_SPEC_LOOP_FIX_COMPLETE.`,
      verification: { type: 'file_exists', value: '.workflow-artifacts/wave7-local-proof/prove-local-byoh-spec-to-artifact-loop/fix-loop.md' },
    })
    .step('final-hard-validation', {
      type: 'deterministic',
      dependsOn: ['fix-loop'],
      command: 'npm run typecheck && npm test --workspace @ricky/local && npm test --workspace @ricky/cli && npm test --workspace @ricky/product && npm test',
      captureOutput: true,
      failOnError: true,
    })
    .step('final-signoff', {
      type: 'deterministic',
      dependsOn: ['final-hard-validation'],
      command: [
        "cat <<'EOF' > .workflow-artifacts/wave7-local-proof/prove-local-byoh-spec-to-artifact-loop/signoff.md",
        '# Ricky local spec-to-artifact loop signoff',
        '',
        'Validation commands:',
        '- npm run typecheck',
        '- npm test --workspace @ricky/local',
        '- npm test --workspace @ricky/cli',
        '- npm test --workspace @ricky/product',
        '- npm test',
        '',
        'Expected proof truth:',
        '- local CLI spec journey reaches normalized request, artifact metadata, validator outcome, and user-facing response',
        '- missing prerequisites surface as setup blockers rather than opaque generation failure',
        '',
        'LOCAL_SPEC_LOOP_PROOF_COMPLETE',
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
