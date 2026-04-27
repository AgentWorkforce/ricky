import { workflow } from '@agent-relay/sdk/workflows';

async function main() {
  const result = await workflow('ricky-wave8-prove-skill-embedding-boundary')
    .description('Resolve GitHub issue #5 by documenting and proving Ricky generation-time skill loading without overclaiming deeper runtime skill embodiment.')
    .pattern('dag')
    .channel('wf-ricky-wave8-skill-boundary')
    .maxConcurrency(4)
    .timeout(3_600_000)
    .onError('retry', { maxRetries: 2, retryDelayMs: 10_000 })

    .agent('impl-codex', {
      cli: 'codex',
      preset: 'worker',
      role: 'Implements explicit generation-time skill application proof and docs boundary for Ricky skills.',
      retries: 2,
    })
    .agent('review-claude', {
      cli: 'claude',
      preset: 'reviewer',
      role: 'Reviews whether the skill boundary is honest and avoids future-runtime overclaims.',
      retries: 1,
    })

    .step('prepare-context', {
      type: 'deterministic',
      command: [
        'mkdir -p .workflow-artifacts/wave8-github-issues/prove-skill-embedding-boundary',
        'gh issue view 5 --json number,title,body,url > .workflow-artifacts/wave8-github-issues/prove-skill-embedding-boundary/issue-5.json',
        'sed -n "1,260p" packages/product/src/generation/skill-loader.ts > .workflow-artifacts/wave8-github-issues/prove-skill-embedding-boundary/skill-loader.before.txt',
        'sed -n "1,320p" packages/product/src/generation/pipeline.ts > .workflow-artifacts/wave8-github-issues/prove-skill-embedding-boundary/pipeline.before.txt',
        'sed -n "1,360p" packages/product/src/generation/template-renderer.ts > .workflow-artifacts/wave8-github-issues/prove-skill-embedding-boundary/template-renderer.before.txt',
        'sed -n "1,320p" packages/product/src/generation/pipeline.test.ts > .workflow-artifacts/wave8-github-issues/prove-skill-embedding-boundary/pipeline-test.before.txt',
        'echo PREPARE_CONTEXT_OK',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })
    .step('implement-skill-boundary-proof', {
      agent: 'impl-codex',
      dependsOn: ['prepare-context'],
      task: `Resolve GitHub issue #5.

Acceptance contract:
- prove which skills are loaded for generation, including writing-agent-relay-workflows and relay-80-100-workflow
- prove when those skills are applied: generation-time selection/loading/rendering, not deeper runtime embodiment
- generated workflow output should include observable evidence that selected skills affected the workflow contract, validation gates, or metadata
- docs must distinguish current generation-time behavior from future richer runtime skill execution
- product copy must not imply skills are embodied by agents at runtime unless tests prove that path

Likely files:
- packages/product/src/generation/skill-loader.ts
- packages/product/src/generation/template-renderer.ts
- packages/product/src/generation/pipeline.test.ts
- packages/product/src/generation/types.ts if explicit evidence fields are needed
- docs/product/ricky-skill-embedding-boundary.md`,
      verification: { type: 'file_exists', value: 'docs/product/ricky-skill-embedding-boundary.md' },
    })
    .step('post-implementation-file-gate', {
      type: 'deterministic',
      dependsOn: ['implement-skill-boundary-proof'],
      command: [
        'git diff --name-only > .workflow-artifacts/wave8-github-issues/prove-skill-embedding-boundary/changed-files.txt',
        'grep -F "docs/product/ricky-skill-embedding-boundary.md" .workflow-artifacts/wave8-github-issues/prove-skill-embedding-boundary/changed-files.txt',
        'grep -Eq "packages/product/src/generation/.+\\.(ts|test\\.ts)$" .workflow-artifacts/wave8-github-issues/prove-skill-embedding-boundary/changed-files.txt',
        'grep -F "writing-agent-relay-workflows" docs/product/ricky-skill-embedding-boundary.md packages/product/src/generation/pipeline.test.ts',
        'grep -F "relay-80-100-workflow" docs/product/ricky-skill-embedding-boundary.md packages/product/src/generation/pipeline.test.ts',
        'grep -Ei "generation-time|runtime|future|boundary|overclaim" docs/product/ricky-skill-embedding-boundary.md',
        'echo POST_IMPLEMENTATION_FILE_GATE_OK',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })
    .step('run-skill-tests', {
      type: 'deterministic',
      dependsOn: ['post-implementation-file-gate'],
      command: 'npm run typecheck && npx tsc --noEmit && npm test --workspace @ricky/product',
      captureOutput: true,
      failOnError: false,
    })
    .step('fix-loop', {
      agent: 'impl-codex',
      dependsOn: ['run-skill-tests'],
      task: `This is the 80-to-100 fix loop for issue #5. Fix validation failures or proof gaps and rerun until green.

Validation output:
{{steps.run-skill-tests.output}}

Commands to rerun:
- npm run typecheck
- npx tsc --noEmit
- npm test --workspace @ricky/product

Write .workflow-artifacts/wave8-github-issues/prove-skill-embedding-boundary/fix-loop.md ending with SKILL_BOUNDARY_FIX_LOOP_COMPLETE.`,
      verification: { type: 'file_exists', value: '.workflow-artifacts/wave8-github-issues/prove-skill-embedding-boundary/fix-loop.md' },
    })
    .step('generated-output-proof', {
      type: 'deterministic',
      dependsOn: ['fix-loop'],
      command: [
        'npm test --workspace @ricky/product -- packages/product/src/generation/pipeline.test.ts > .workflow-artifacts/wave8-github-issues/prove-skill-embedding-boundary/generated-output-proof.txt 2>&1',
        'grep -F "writing-agent-relay-workflows" .workflow-artifacts/wave8-github-issues/prove-skill-embedding-boundary/generated-output-proof.txt docs/product/ricky-skill-embedding-boundary.md packages/product/src/generation/pipeline.test.ts',
        'grep -F "relay-80-100-workflow" .workflow-artifacts/wave8-github-issues/prove-skill-embedding-boundary/generated-output-proof.txt docs/product/ricky-skill-embedding-boundary.md packages/product/src/generation/pipeline.test.ts',
        'echo GENERATED_OUTPUT_PROOF_OK',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })
    .step('final-review', {
      agent: 'review-claude',
      dependsOn: ['generated-output-proof'],
      task: `Review issue #5 completion.

Confirm:
- docs accurately state which skills are loaded and when they apply
- tests prove generation output is influenced by applicable skills
- docs and generated output avoid claiming runtime skill embodiment beyond current code
- future work is labeled as future or partial

Write .workflow-artifacts/wave8-github-issues/prove-skill-embedding-boundary/final-review.md ending with FINAL_REVIEW_PASS or FINAL_REVIEW_FAIL.`,
      verification: { type: 'file_exists', value: '.workflow-artifacts/wave8-github-issues/prove-skill-embedding-boundary/final-review.md' },
    })
    .step('final-review-pass-gate', {
      type: 'deterministic',
      dependsOn: ['final-review'],
      command: 'grep -F "FINAL_REVIEW_PASS" .workflow-artifacts/wave8-github-issues/prove-skill-embedding-boundary/final-review.md',
      captureOutput: true,
      failOnError: true,
    })
    .step('final-hard-validation', {
      type: 'deterministic',
      dependsOn: ['final-review-pass-gate'],
      command: 'npm run typecheck && npx tsc --noEmit && npm test --workspace @ricky/product && npm test',
      captureOutput: true,
      failOnError: true,
    })
    .step('signoff', {
      type: 'deterministic',
      dependsOn: ['final-hard-validation'],
      command: [
        "cat <<'EOF' > .workflow-artifacts/wave8-github-issues/prove-skill-embedding-boundary/signoff.md",
        '# GitHub issue #5 signoff',
        '',
        'Validation commands:',
        '- npm run typecheck',
        '- npx tsc --noEmit',
        '- npm test --workspace @ricky/product',
        '- npm test',
        '',
        'Acceptance proof:',
        '- generation-time skill loading is explicit and tested',
        '- writing-agent-relay-workflows and relay-80-100-workflow boundaries are documented',
        '- docs avoid runtime skill embodiment overclaims',
        '',
        'SKILL_EMBEDDING_BOUNDARY_COMPLETE',
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
