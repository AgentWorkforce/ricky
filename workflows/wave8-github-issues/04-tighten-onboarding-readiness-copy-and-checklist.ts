import { workflow } from '@agent-relay/sdk/workflows';

async function main() {
  const result = await workflow('ricky-wave8-tighten-onboarding-readiness-copy-and-checklist')
    .description('Resolve GitHub issues #4 and #7 by making onboarding/readiness messaging truthful and adding a cofounder-facing interactive readiness checklist.')
    .pattern('dag')
    .channel('wf-ricky-wave8-readiness-copy')
    .maxConcurrency(4)
    .timeout(3_600_000)
    .onError('retry', { maxRetries: 2, retryDelayMs: 10_000 })

    .agent('writer-claude', {
      cli: 'claude',
      preset: 'worker',
      role: 'Tightens user-facing copy and writes the cofounder readiness checklist without overclaiming current behavior.',
      retries: 2,
    })
    .agent('test-codex', {
      cli: 'codex',
      preset: 'worker',
      role: 'Updates snapshot/string tests for truthful onboarding, recovery, and readiness messaging.',
      retries: 2,
    })
    .agent('review-codex', {
      cli: 'codex',
      preset: 'reviewer',
      role: 'Reviews product truthfulness and test coverage for issues #4 and #7.',
      retries: 1,
    })

    .step('prepare-context', {
      type: 'deterministic',
      command: [
        'mkdir -p .workflow-artifacts/wave8-github-issues/tighten-onboarding-readiness-copy-and-checklist',
        'gh issue view 4 --json number,title,body,url > .workflow-artifacts/wave8-github-issues/tighten-onboarding-readiness-copy-and-checklist/issue-4.json',
        'gh issue view 7 --json number,title,body,url > .workflow-artifacts/wave8-github-issues/tighten-onboarding-readiness-copy-and-checklist/issue-7.json',
        'sed -n "1,360p" packages/cli/src/cli/onboarding.ts > .workflow-artifacts/wave8-github-issues/tighten-onboarding-readiness-copy-and-checklist/onboarding.before.txt',
        'sed -n "1,320p" packages/cli/src/commands/cli-main.ts > .workflow-artifacts/wave8-github-issues/tighten-onboarding-readiness-copy-and-checklist/cli-main.before.txt',
        'sed -n "1,320p" packages/cli/src/entrypoint/interactive-cli.ts > .workflow-artifacts/wave8-github-issues/tighten-onboarding-readiness-copy-and-checklist/interactive-cli.before.txt',
        'ls docs/product > .workflow-artifacts/wave8-github-issues/tighten-onboarding-readiness-copy-and-checklist/docs-product.before.txt',
        'echo PREPARE_CONTEXT_OK',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })
    .step('tighten-copy-and-checklist', {
      agent: 'writer-claude',
      dependsOn: ['prepare-context'],
      task: `Resolve GitHub issues #4 and #7.

Deliverables:
- tighten first-run, help, local handoff, and recovery copy so it does not imply more execution depth than Ricky currently proves
- local mode messaging must distinguish artifact generation/return from execution result
- recovery guidance must be concrete and current
- add a short cofounder-facing readiness checklist in repo docs, tuned to interactive/local onboarding and live testing

Suggested doc path:
- docs/product/ricky-cofounder-interactive-readiness-checklist.md

Keep the checklist practical and test-session oriented:
- first-run onboarding clarity
- local mode selection clarity
- spec handoff works immediately
- generated artifact appears where promised
- next command points to a real file
- recovery guidance is truthful when something fails
- execution-vs-generation distinction is understandable`,
      verification: { type: 'file_exists', value: 'docs/product/ricky-cofounder-interactive-readiness-checklist.md' },
    })
    .step('add-copy-tests', {
      agent: 'test-codex',
      dependsOn: ['tighten-copy-and-checklist'],
      task: `Add or update deterministic tests for issues #4 and #7.

Required coverage:
- help/onboarding copy does not promise automatic execution if the current path only returns artifacts
- local handoff output distinguishes generated artifact from execution result
- recovery guidance names real supported inputs: --spec, --spec-file, --stdin
- cofounder checklist doc contains the readiness areas from issue #7

Likely files:
- packages/cli/src/cli/onboarding.test.ts
- packages/cli/src/commands/cli-main.test.ts
- packages/cli/src/entrypoint/interactive-cli.test.ts
- docs/product/ricky-cofounder-interactive-readiness-checklist.md`,
      verification: { type: 'exit_code', value: '0' },
    })
    .step('post-implementation-file-gate', {
      type: 'deterministic',
      dependsOn: ['add-copy-tests'],
      command: [
        'git diff --name-only > .workflow-artifacts/wave8-github-issues/tighten-onboarding-readiness-copy-and-checklist/changed-files.txt',
        'grep -F "docs/product/ricky-cofounder-interactive-readiness-checklist.md" .workflow-artifacts/wave8-github-issues/tighten-onboarding-readiness-copy-and-checklist/changed-files.txt',
        'grep -Eq "packages/cli/src/.+\\.(ts|test\\.ts)$" .workflow-artifacts/wave8-github-issues/tighten-onboarding-readiness-copy-and-checklist/changed-files.txt',
        'grep -Ei "first-run|local mode|spec handoff|generated artifact|next command|recovery|execution|generation" docs/product/ricky-cofounder-interactive-readiness-checklist.md',
        'grep -R "artifact generation\\|execution result\\|--spec-file\\|--stdin" packages/cli/src docs/product/ricky-cofounder-interactive-readiness-checklist.md >/dev/null',
        'echo POST_IMPLEMENTATION_FILE_GATE_OK',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })
    .step('run-copy-tests', {
      type: 'deterministic',
      dependsOn: ['post-implementation-file-gate'],
      command: 'npm run typecheck && npx tsc --noEmit && npm test --workspace @ricky/cli',
      captureOutput: true,
      failOnError: false,
    })
    .step('fix-loop', {
      agent: 'writer-claude',
      dependsOn: ['run-copy-tests'],
      task: `This is the 80-to-100 fix loop for issues #4 and #7. Fix test failures or copy gaps and rerun until green.

Validation output:
{{steps.run-copy-tests.output}}

Commands to rerun:
- npm run typecheck
- npx tsc --noEmit
- npm test --workspace @ricky/cli

Write .workflow-artifacts/wave8-github-issues/tighten-onboarding-readiness-copy-and-checklist/fix-loop.md ending with READINESS_COPY_FIX_LOOP_COMPLETE.`,
      verification: { type: 'file_exists', value: '.workflow-artifacts/wave8-github-issues/tighten-onboarding-readiness-copy-and-checklist/fix-loop.md' },
    })
    .step('final-review', {
      agent: 'review-codex',
      dependsOn: ['fix-loop'],
      task: `Review issues #4 and #7 completion.

Confirm:
- no visible CLI/help/onboarding copy overclaims execution depth
- local handoff language distinguishes artifact return from runtime execution
- recovery guidance is concrete and matches implemented flags
- checklist is short, cofounder-facing, and usable during live testing

Write .workflow-artifacts/wave8-github-issues/tighten-onboarding-readiness-copy-and-checklist/final-review.md ending with FINAL_REVIEW_PASS or FINAL_REVIEW_FAIL.`,
      verification: { type: 'file_exists', value: '.workflow-artifacts/wave8-github-issues/tighten-onboarding-readiness-copy-and-checklist/final-review.md' },
    })
    .step('final-review-pass-gate', {
      type: 'deterministic',
      dependsOn: ['final-review'],
      command: 'grep -F "FINAL_REVIEW_PASS" .workflow-artifacts/wave8-github-issues/tighten-onboarding-readiness-copy-and-checklist/final-review.md',
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
        "cat <<'EOF' > .workflow-artifacts/wave8-github-issues/tighten-onboarding-readiness-copy-and-checklist/signoff.md",
        '# GitHub issues #4 and #7 signoff',
        '',
        'Validation commands:',
        '- npm run typecheck',
        '- npx tsc --noEmit',
        '- npm test --workspace @ricky/cli',
        '- npm test',
        '',
        'Acceptance proof:',
        '- first-run and interactive copy are truthful about current execution depth',
        '- local mode messaging separates artifact generation from execution result',
        '- recovery guidance is current',
        '- cofounder readiness checklist exists and is live-test usable',
        '',
        'READINESS_COPY_AND_CHECKLIST_COMPLETE',
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
