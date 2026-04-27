import { workflow } from '@agent-relay/sdk/workflows';

async function main() {
  const result = await workflow('ricky-wave8-prove-external-repo-cli-generation')
    .description('Prove GitHub issue #6: installed or linked Ricky CLI invoked from a separate repo writes repo-relative workflow artifacts and truthful follow-up commands.')
    .pattern('dag')
    .channel('wf-ricky-wave8-external-cli-proof')
    .maxConcurrency(4)
    .timeout(3_600_000)
    .onError('retry', { maxRetries: 2, retryDelayMs: 10_000 })

    .agent('impl-codex', {
      cli: 'codex',
      preset: 'worker',
      role: 'Implements external-repo CLI proof fixtures and any missing CLI packaging/link seams.',
      retries: 2,
    })
    .agent('review-claude', {
      cli: 'claude',
      preset: 'reviewer',
      role: 'Reviews whether the proof represents a real user invoking Ricky from outside the Ricky repo.',
      retries: 1,
    })

    .step('prepare-context', {
      type: 'deterministic',
      command: [
        'mkdir -p .workflow-artifacts/wave8-github-issues/prove-external-repo-cli-generation',
        'gh issue view 6 --json number,title,body,url > .workflow-artifacts/wave8-github-issues/prove-external-repo-cli-generation/issue-6.json',
        'cat package.json > .workflow-artifacts/wave8-github-issues/prove-external-repo-cli-generation/root-package.json',
        'cat packages/cli/package.json > .workflow-artifacts/wave8-github-issues/prove-external-repo-cli-generation/cli-package.json',
        'sed -n "1,300p" packages/cli/src/commands/cli-main.test.ts > .workflow-artifacts/wave8-github-issues/prove-external-repo-cli-generation/cli-main-test.before.txt',
        'echo PREPARE_CONTEXT_OK',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })
    .step('implement-external-repo-proof', {
      agent: 'impl-codex',
      dependsOn: ['prepare-context'],
      task: `Implement GitHub issue #6 as an automated proof.

Acceptance contract:
- prove Ricky can be invoked from a separate repo using an installed or linked CLI path available in this monorepo
- generate a workflow into that separate repo at workflows/generated/...
- assert the printed Artifact path exists relative to the external repo
- assert the printed Next command works against that same file path, at least via dry-run or a deterministic local runner fixture
- make this product-facing readiness evidence, not only an internal package unit test

Likely files:
- packages/cli/src/commands/cli-main.test.ts
- packages/cli/src/entrypoint/interactive-cli.test.ts
- packages/cli/src/cli/proof/onboarding-proof.ts or a new external CLI proof helper under packages/cli/src/cli/proof/
- docs/product/ricky-next-wave-backlog-and-proof-plan.md if readiness proof inventory needs updating

Use mkdtemp external repos and injected runners when possible. If a linked binary is not currently exposed, document and implement the narrow packaging seam needed for local proof.`,
      verification: { type: 'exit_code', value: '0' },
    })
    .step('post-implementation-file-gate', {
      type: 'deterministic',
      dependsOn: ['implement-external-repo-proof'],
      command: [
        'git diff --name-only > .workflow-artifacts/wave8-github-issues/prove-external-repo-cli-generation/changed-files.txt',
        'grep -Eq "packages/cli/src/.+\\.(ts|test\\.ts)$|docs/product/.+\\.md$|package\\.json|packages/cli/package\\.json" .workflow-artifacts/wave8-github-issues/prove-external-repo-cli-generation/changed-files.txt',
        'grep -R "external repo\\|separate repo\\|INIT_CWD\\|workflows/generated\\|agent-relay run" packages/cli/src docs/product package.json packages/cli/package.json >/dev/null',
        'echo POST_IMPLEMENTATION_FILE_GATE_OK',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })
    .step('run-proof-tests', {
      type: 'deterministic',
      dependsOn: ['post-implementation-file-gate'],
      command: 'npm run typecheck && npx tsc --noEmit && npm test --workspace @ricky/cli',
      captureOutput: true,
      failOnError: false,
    })
    .step('fix-loop', {
      agent: 'impl-codex',
      dependsOn: ['run-proof-tests'],
      task: `This is the 80-to-100 fix loop for issue #6. Fix every failure in the proof test output and rerun until green.

Validation output:
{{steps.run-proof-tests.output}}

Commands to rerun:
- npm run typecheck
- npx tsc --noEmit
- npm test --workspace @ricky/cli

Write .workflow-artifacts/wave8-github-issues/prove-external-repo-cli-generation/fix-loop.md ending with EXTERNAL_REPO_PROOF_FIX_LOOP_COMPLETE.`,
      verification: { type: 'file_exists', value: '.workflow-artifacts/wave8-github-issues/prove-external-repo-cli-generation/fix-loop.md' },
    })
    .step('external-repo-smoke', {
      type: 'deterministic',
      dependsOn: ['fix-loop'],
      command: [
        'TMP_REPO=$(mktemp -d)',
        'trap "rm -rf $TMP_REPO" EXIT',
        'INIT_CWD="$TMP_REPO" npm start -- --mode local --spec "generate a workflow for external package checks" > .workflow-artifacts/wave8-github-issues/prove-external-repo-cli-generation/external-repo-smoke.txt 2>&1',
        'ARTIFACT=$(grep -Eo "workflows/generated/[^ ]+\\.ts" .workflow-artifacts/wave8-github-issues/prove-external-repo-cli-generation/external-repo-smoke.txt | head -1)',
        'test -n "$ARTIFACT"',
        'test -f "$TMP_REPO/$ARTIFACT"',
        'grep -F "npx --no-install agent-relay run $ARTIFACT" .workflow-artifacts/wave8-github-issues/prove-external-repo-cli-generation/external-repo-smoke.txt',
        'npx agent-relay run --dry-run "$TMP_REPO/$ARTIFACT" > .workflow-artifacts/wave8-github-issues/prove-external-repo-cli-generation/external-repo-dry-run.txt 2>&1',
        'echo EXTERNAL_REPO_SMOKE_OK',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })
    .step('final-review', {
      agent: 'review-claude',
      dependsOn: ['external-repo-smoke'],
      task: `Review issue #6 proof quality.

Confirm:
- the test/proof invokes Ricky from outside the Ricky repo
- artifact path output, file existence, and follow-up command all refer to the same external repo file
- proof is product-facing readiness evidence
- no live provider credentials are required

Write .workflow-artifacts/wave8-github-issues/prove-external-repo-cli-generation/final-review.md ending with FINAL_REVIEW_PASS or FINAL_REVIEW_FAIL.`,
      verification: { type: 'file_exists', value: '.workflow-artifacts/wave8-github-issues/prove-external-repo-cli-generation/final-review.md' },
    })
    .step('final-review-pass-gate', {
      type: 'deterministic',
      dependsOn: ['final-review'],
      command: 'grep -F "FINAL_REVIEW_PASS" .workflow-artifacts/wave8-github-issues/prove-external-repo-cli-generation/final-review.md',
      captureOutput: true,
      failOnError: true,
    })
    .step('final-hard-validation', {
      type: 'deterministic',
      dependsOn: ['final-review-pass-gate'],
      command: 'npm run typecheck && npx tsc --noEmit && npm test --workspace @ricky/cli && npm test',
      captureOutput: true,
      failOnError: true,
    })
    .step('signoff', {
      type: 'deterministic',
      dependsOn: ['final-hard-validation'],
      command: [
        "cat <<'EOF' > .workflow-artifacts/wave8-github-issues/prove-external-repo-cli-generation/signoff.md",
        '# GitHub issue #6 signoff',
        '',
        'Validation commands:',
        '- npm run typecheck',
        '- npx tsc --noEmit',
        '- npm test --workspace @ricky/cli',
        '- npm test',
        '- external repo smoke with agent-relay dry-run',
        '',
        'Acceptance proof:',
        '- installed or linked CLI-style invocation from another repo writes a repo-relative workflow',
        '- generated file exists where Ricky says it exists',
        '- next command targets that same file',
        '',
        'EXTERNAL_REPO_CLI_PROOF_COMPLETE',
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
