import { workflow } from '@agent-relay/sdk/workflows';

async function main() {
  const result = await workflow('ricky-wave8-close-local-execution-outcome-loop')
    .description('Resolve GitHub issue #3 by deciding and implementing the local post-generation contract: execute generated workflow or return a classified blocker with evidence.')
    .pattern('dag')
    .channel('wf-ricky-wave8-local-outcome-loop')
    .maxConcurrency(4)
    .timeout(3_600_000)
    .onError('retry', { maxRetries: 2, retryDelayMs: 10_000 })

    .agent('lead-claude', {
      cli: 'claude',
      preset: 'worker',
      role: 'Makes the product behavior decision and narrows the issue #3 contract before implementation.',
      retries: 1,
    })
    .agent('impl-codex', {
      cli: 'codex',
      preset: 'worker',
      role: 'Implements local execution outcome and classified blocker behavior using existing runtime and diagnostics seams.',
      retries: 2,
    })
    .agent('test-codex', {
      cli: 'codex',
      preset: 'worker',
      role: 'Adds success and blocker tests that exercise the generated artifact to runtime outcome loop.',
      retries: 2,
    })
    .agent('review-claude', {
      cli: 'claude',
      preset: 'reviewer',
      role: 'Reviews product truthfulness and evidence quality for the local outcome loop.',
      retries: 1,
    })

    .step('prepare-context', {
      type: 'deterministic',
      command: [
        'mkdir -p .workflow-artifacts/wave8-github-issues/close-local-execution-outcome-loop',
        'command -v gh >/dev/null 2>&1 && gh issue view 3 --json number,title,body,url > .workflow-artifacts/wave8-github-issues/close-local-execution-outcome-loop/issue-3.json || true',
        'sed -n "1,380p" packages/local/src/entrypoint.ts > .workflow-artifacts/wave8-github-issues/close-local-execution-outcome-loop/local-entrypoint.before.txt',
        'sed -n "1,320p" packages/runtime/src/local-coordinator.ts > .workflow-artifacts/wave8-github-issues/close-local-execution-outcome-loop/local-coordinator.before.txt',
        'sed -n "1,320p" packages/runtime/src/diagnostics/failure-diagnosis.ts > .workflow-artifacts/wave8-github-issues/close-local-execution-outcome-loop/failure-diagnosis.before.txt',
        'sed -n "1,320p" packages/cli/src/entrypoint/interactive-cli.ts > .workflow-artifacts/wave8-github-issues/close-local-execution-outcome-loop/interactive-cli.before.txt',
        'echo PREPARE_CONTEXT_OK',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })
    .step('decide-product-contract', {
      agent: 'lead-claude',
      dependsOn: ['prepare-context'],
      task: `For GitHub issue #3, write a concise product decision in .workflow-artifacts/wave8-github-issues/close-local-execution-outcome-loop/product-contract.md.

Choose one explicit behavior:
- stop-after-generation remains the default but an execution flag/mode continues into runtime, or
- local handoff continues into execution by default, or
- mode-controlled behavior separates artifact generation from execution.

The decision must include:
- user-facing output rules that distinguish artifact generation from execution result
- classified blocker behavior when runtime launch cannot proceed
- evidence fields to expose on success and failure
- non-goals for this slice

End with PRODUCT_CONTRACT_DECIDED.`,
      verification: { type: 'file_exists', value: '.workflow-artifacts/wave8-github-issues/close-local-execution-outcome-loop/product-contract.md' },
    })
    .step('product-contract-gate', {
      type: 'deterministic',
      dependsOn: ['decide-product-contract'],
      command: [
        'grep -F "PRODUCT_CONTRACT_DECIDED" .workflow-artifacts/wave8-github-issues/close-local-execution-outcome-loop/product-contract.md',
        'grep -Ei "generation|execution|blocker|evidence|mode|default" .workflow-artifacts/wave8-github-issues/close-local-execution-outcome-loop/product-contract.md',
        'echo PRODUCT_CONTRACT_GATE_OK',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })
    .step('implement-outcome-loop', {
      agent: 'impl-codex',
      dependsOn: ['product-contract-gate'],
      task: `Implement GitHub issue #3 according to this product contract:
{{steps.decide-product-contract.output}}

Acceptance contract:
- local mode can continue from generated artifact into runtime outcome when the chosen behavior says it should
- success returns concrete outcome/evidence, including command, workflow file, cwd, status, and stdout/stderr snippets where available
- runtime launch failure returns a classified blocker with actionable recovery guidance
- output clearly distinguishes "artifact generated" from "execution result"
- preserve the existing stop-after-generation behavior when the product contract keeps it as a supported mode

Likely files:
- packages/local/src/entrypoint.ts
- packages/runtime/src/local-coordinator.ts
- packages/runtime/src/evidence/capture.ts
- packages/runtime/src/diagnostics/failure-diagnosis.ts
- packages/cli/src/entrypoint/interactive-cli.ts
- shared model files if response contracts need typed evidence.`,
      verification: { type: 'exit_code', value: '0' },
    })
    .step('implement-outcome-tests', {
      agent: 'test-codex',
      dependsOn: ['implement-outcome-loop'],
      task: `Add tests for GitHub issue #3.

Required tests:
- generated artifact execution success path returns concrete outcome/evidence
- runtime failure path returns a classified blocker instead of vague recovery text
- user-facing CLI/interactive output distinguishes artifact generation from execution result
- stop-after-generation still returns artifact-only output if that remains in the product contract

Prefer deterministic fake coordinators and command runners. Do not require live provider credentials.`,
      verification: { type: 'exit_code', value: '0' },
    })
    .step('post-implementation-file-gate', {
      type: 'deterministic',
      dependsOn: ['implement-outcome-tests'],
      command: [
        'git diff --name-only > .workflow-artifacts/wave8-github-issues/close-local-execution-outcome-loop/changed-files.txt',
        'grep -Eq "packages/(local|runtime|cli|shared)/src/.+\\.(ts|test\\.ts)$" .workflow-artifacts/wave8-github-issues/close-local-execution-outcome-loop/changed-files.txt',
        'grep -R "execution result\\|runtime status\\|blocker\\|evidence\\|returnGeneratedArtifactOnly" packages/local/src packages/runtime/src packages/cli/src packages/shared/src >/dev/null',
        'echo POST_IMPLEMENTATION_FILE_GATE_OK',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })
    .step('run-targeted-tests', {
      type: 'deterministic',
      dependsOn: ['post-implementation-file-gate'],
      command: 'npm run typecheck && npx tsc --noEmit && npm test --workspace @ricky/runtime && npm test --workspace @ricky/local && npm test --workspace @ricky/cli',
      captureOutput: true,
      failOnError: false,
    })
    .step('fix-loop', {
      agent: 'impl-codex',
      dependsOn: ['run-targeted-tests'],
      task: `This is the 80-to-100 fix loop for issue #3. Fix any validation failure and rerun until all checks pass.

Validation output:
{{steps.run-targeted-tests.output}}

Commands to rerun:
- npm run typecheck
- npx tsc --noEmit
- npm test --workspace @ricky/runtime
- npm test --workspace @ricky/local
- npm test --workspace @ricky/cli

Write .workflow-artifacts/wave8-github-issues/close-local-execution-outcome-loop/fix-loop.md ending with LOCAL_OUTCOME_LOOP_FIX_COMPLETE.`,
      verification: { type: 'file_exists', value: '.workflow-artifacts/wave8-github-issues/close-local-execution-outcome-loop/fix-loop.md' },
    })
    .step('final-review', {
      agent: 'review-claude',
      dependsOn: ['fix-loop'],
      task: `Review issue #3 completion.

Confirm:
- behavior decision is explicit and reflected in tests
- success path returns evidence, not just an ok boolean
- blocker path is classified and actionable
- user-facing output does not blur generation and execution
- no product copy overclaims beyond the implemented contract

Write .workflow-artifacts/wave8-github-issues/close-local-execution-outcome-loop/final-review.md ending with FINAL_REVIEW_PASS or FINAL_REVIEW_FAIL.`,
      verification: { type: 'file_exists', value: '.workflow-artifacts/wave8-github-issues/close-local-execution-outcome-loop/final-review.md' },
    })
    .step('final-review-pass-gate', {
      type: 'deterministic',
      dependsOn: ['final-review'],
      command: 'grep -F "FINAL_REVIEW_PASS" .workflow-artifacts/wave8-github-issues/close-local-execution-outcome-loop/final-review.md',
      captureOutput: true,
      failOnError: true,
    })
    .step('final-hard-validation', {
      type: 'deterministic',
      dependsOn: ['final-review-pass-gate'],
      command: 'npm run typecheck && npx tsc --noEmit && npm test --workspace @ricky/runtime && npm test --workspace @ricky/local && npm test --workspace @ricky/cli && npm test',
      captureOutput: true,
      failOnError: true,
    })
    .step('signoff', {
      type: 'deterministic',
      dependsOn: ['final-hard-validation'],
      command: [
        "cat <<'EOF' > .workflow-artifacts/wave8-github-issues/close-local-execution-outcome-loop/signoff.md",
        '# GitHub issue #3 signoff',
        '',
        'Validation commands:',
        '- npm run typecheck',
        '- npx tsc --noEmit',
        '- npm test --workspace @ricky/runtime',
        '- npm test --workspace @ricky/local',
        '- npm test --workspace @ricky/cli',
        '- npm test',
        '',
        'Acceptance proof:',
        '- product behavior decision is explicit',
        '- execution success returns concrete outcome/evidence',
        '- execution blockers are classified with recovery guidance',
        '- user output distinguishes generated artifact from execution result',
        '',
        'LOCAL_EXECUTION_OUTCOME_LOOP_COMPLETE',
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
