import { workflow } from '@agent-relay/sdk/workflows';

async function main() {
  const result = await workflow('ricky-wave8-fix-cli-artifact-path-and-caller-root')
    .description('Fix and prove GitHub issues #1 and #2: Ricky must preserve the caller repo root and write generated workflow artifacts to the exact path it prints.')
    .pattern('dag')
    .channel('wf-ricky-wave8-path-root')
    .maxConcurrency(4)
    .timeout(3_600_000)
    .onError('retry', { maxRetries: 2, retryDelayMs: 10_000 })

    .agent('impl-codex', {
      cli: 'codex',
      preset: 'worker',
      role: 'Implements caller-root propagation and artifact path fixes across the CLI, interactive entrypoint, and local executor.',
      retries: 2,
    })
    .agent('test-claude', {
      cli: 'claude',
      preset: 'worker',
      role: 'Adds deterministic tests proving the printed artifact path, written file, and next command all agree.',
      retries: 2,
    })
    .agent('review-codex', {
      cli: 'codex',
      preset: 'reviewer',
      role: 'Reviews the implementation for path truthfulness, repo-root semantics, and regression risk.',
      retries: 1,
    })

    .step('prepare-context', {
      type: 'deterministic',
      command: [
        'mkdir -p .workflow-artifacts/wave8-github-issues/fix-cli-artifact-path-and-caller-root',
        'printf "%s\\n" "Issue #1: fix generated workflow artifact path mismatch in interactive/local CLI" "Summary: Ricky prints workflows/generated/... but current CLI path can write under packages/cli/workflows/generated/..." "Acceptance: printed artifact path matches disk, next npx --no-install agent-relay run command points to that file, no packages/cli/workflows/generated write for repo-root contract." > .workflow-artifacts/wave8-github-issues/fix-cli-artifact-path-and-caller-root/issue-1.md',
        'printf "%s\\n" "Issue #2: preserve caller repo root through CLI to interactive to local generation path" "Summary: real invocation cwd/caller repo root must survive CLI, interactive entrypoint, and local executor handoff." "Acceptance: generated workflow writes use caller repo root, reported paths and run commands are relative to that same repo, tests prove root propagation." > .workflow-artifacts/wave8-github-issues/fix-cli-artifact-path-and-caller-root/issue-2.md',
        'sed -n "1,280p" packages/cli/src/commands/cli-main.ts > .workflow-artifacts/wave8-github-issues/fix-cli-artifact-path-and-caller-root/cli-main.before.txt',
        'sed -n "1,320p" packages/cli/src/entrypoint/interactive-cli.ts > .workflow-artifacts/wave8-github-issues/fix-cli-artifact-path-and-caller-root/interactive-cli.before.txt',
        'sed -n "1,360p" packages/local/src/entrypoint.ts > .workflow-artifacts/wave8-github-issues/fix-cli-artifact-path-and-caller-root/local-entrypoint.before.txt',
        'echo PREPARE_CONTEXT_OK',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })
    .step('reproduce-path-mismatch', {
      type: 'deterministic',
      dependsOn: ['prepare-context'],
      command: [
        'OUT=.workflow-artifacts/wave8-github-issues/fix-cli-artifact-path-and-caller-root/repro-output.txt',
        'REPO_ROOT=$(pwd)',
        'TMP_REPO=$(mktemp -d)',
        'trap "rm -rf $TMP_REPO" EXIT',
        '(cd "$TMP_REPO" && "$REPO_ROOT/node_modules/.bin/tsx" "$REPO_ROOT/packages/cli/src/commands/cli-main.ts" --mode local --spec "generate a workflow for package checks") > "$OUT" 2>&1 || true',
        'ARTIFACT=$(sed -n "s/.*Artifact: //p" "$OUT" | head -1)',
        'if test -n "$ARTIFACT" && test -f "$TMP_REPO/$ARTIFACT"; then echo "REPRO_CURRENTLY_PASSING"; else echo "REPRO_CONFIRMED_MISSING_REPO_ROOT_ARTIFACT"; fi',
        'if test -n "$ARTIFACT" && test -d "$REPO_ROOT/packages/cli/$(dirname "$ARTIFACT")"; then find "$REPO_ROOT/packages/cli/$(dirname "$ARTIFACT")" -type f > .workflow-artifacts/wave8-github-issues/fix-cli-artifact-path-and-caller-root/package-cli-generated-files.txt; fi',
      ].join(' && '),
      captureOutput: true,
      failOnError: false,
    })
    .step('implement-root-propagation', {
      agent: 'impl-codex',
      dependsOn: ['prepare-context', 'reproduce-path-mismatch'],
      task: `Fix GitHub issues #1 and #2.

Acceptance contract:
- capture the real invocation root at the CLI boundary, preferring the caller repo / INIT_CWD when available
- pass that root through cliMain -> runInteractiveCli -> runLocal/createLocalExecutor without losing it
- write generated workflows relative to the caller repo root, not packages/cli
- print the same relative artifact path that actually exists on disk
- keep the suggested npx --no-install agent-relay run command aligned to that existing file
- do not write packages/cli/workflows/generated when the user-facing contract says workflows/generated

Likely files:
- packages/cli/src/commands/cli-main.ts
- packages/cli/src/entrypoint/interactive-cli.ts
- packages/local/src/entrypoint.ts
- packages/local/src/request-normalizer.ts if request metadata needs the invocation root

Use the existing injectable seams rather than introducing global mutable state.`,
      verification: { type: 'exit_code', value: '0' },
    })
    .step('implement-root-tests', {
      agent: 'test-claude',
      dependsOn: ['implement-root-propagation'],
      task: `Add regression coverage for issues #1 and #2.

Required proofs:
- cliMain passes the invocation root through to the interactive runner for inline spec, spec-file, and stdin handoff where applicable
- runInteractiveCli default local executor writes into the caller repo root
- runLocal/createLocalExecutor writes artifact content under the supplied cwd
- printed Artifact path exists relative to that same cwd
- printed Next command points to the same existing artifact path
- no packages/cli/workflows/generated artifact appears for this scenario

Prefer deterministic temp directories and injected readers/runners. Do not require a live provider or live relay runtime.`,
      verification: { type: 'exit_code', value: '0' },
    })
    .step('post-implementation-file-gate', {
      type: 'deterministic',
      dependsOn: ['implement-root-tests'],
      command: [
        'git diff --name-only > .workflow-artifacts/wave8-github-issues/fix-cli-artifact-path-and-caller-root/changed-files.txt',
        'grep -Eq "packages/(cli|local)/src/.+\\.(ts|test\\.ts)$" .workflow-artifacts/wave8-github-issues/fix-cli-artifact-path-and-caller-root/changed-files.txt',
        'grep -R "INIT_CWD\\|cwd\\|Artifact:\\|npx --no-install agent-relay run" packages/cli/src packages/local/src >/dev/null',
        'echo POST_IMPLEMENTATION_FILE_GATE_OK',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })
    .step('run-targeted-tests', {
      type: 'deterministic',
      dependsOn: ['post-implementation-file-gate'],
      command: 'npm run typecheck && npx tsc --noEmit && npm test --workspace @ricky/local && npm test --workspace @ricky/cli',
      captureOutput: true,
      failOnError: false,
    })
    .step('fix-loop', {
      agent: 'impl-codex',
      dependsOn: ['run-targeted-tests'],
      task: `This is the 80-to-100 fix loop. Review the targeted validation output and fix any failures until all checks pass.

Validation output:
{{steps.run-targeted-tests.output}}

Commands to rerun until green:
- npm run typecheck
- npx tsc --noEmit
- npm test --workspace @ricky/local
- npm test --workspace @ricky/cli

Write .workflow-artifacts/wave8-github-issues/fix-cli-artifact-path-and-caller-root/fix-loop.md ending with PATH_ROOT_FIX_LOOP_COMPLETE.`,
      verification: { type: 'file_exists', value: '.workflow-artifacts/wave8-github-issues/fix-cli-artifact-path-and-caller-root/fix-loop.md' },
    })
    .step('external-path-smoke', {
      type: 'deterministic',
      dependsOn: ['fix-loop'],
      command: [
        'OUT=.workflow-artifacts/wave8-github-issues/fix-cli-artifact-path-and-caller-root/external-path-smoke.txt',
        'REPO_ROOT=$(pwd)',
        'TMP_REPO=$(mktemp -d)',
        'trap "rm -rf $TMP_REPO" EXIT',
        '(cd "$TMP_REPO" && "$REPO_ROOT/node_modules/.bin/tsx" "$REPO_ROOT/packages/cli/src/commands/cli-main.ts" --mode local --spec "generate a workflow for package checks") > "$OUT" 2>&1 || (cat "$OUT"; exit 1)',
        'ARTIFACT=$(sed -n "s/.*Artifact: //p" "$OUT" | head -1)',
        'test -n "$ARTIFACT" || (echo "Missing Artifact line"; cat "$OUT"; exit 1)',
        'echo "reported artifact: $ARTIFACT"',
        'test -f "$TMP_REPO/$ARTIFACT" || (echo "Missing reported artifact under caller repo: $TMP_REPO/$ARTIFACT"; find "$TMP_REPO" -maxdepth 4 -type f | sort; cat "$OUT"; exit 1)',
        'test ! -e "packages/cli/$ARTIFACT" || (echo "Artifact was incorrectly written under packages/cli/$ARTIFACT"; exit 1)',
        'grep -F "agent-relay run $ARTIFACT" "$OUT" || (echo "Next command does not target reported artifact $ARTIFACT"; cat "$OUT"; exit 1)',
        'echo EXTERNAL_PATH_SMOKE_OK',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })
    .step('final-review', {
      agent: 'review-codex',
      dependsOn: ['external-path-smoke'],
      task: `Review the final diff for issues #1 and #2.

Confirm:
- caller repo root is preserved through the real CLI/local path
- generated artifact path, actual file location, and next command agree
- tests would fail on the old packages/cli/workflows/generated behavior
- docs/comments do not overstate behavior

Write .workflow-artifacts/wave8-github-issues/fix-cli-artifact-path-and-caller-root/final-review.md ending with FINAL_REVIEW_PASS or FINAL_REVIEW_FAIL.`,
      verification: { type: 'file_exists', value: '.workflow-artifacts/wave8-github-issues/fix-cli-artifact-path-and-caller-root/final-review.md' },
    })
    .step('final-review-pass-gate', {
      type: 'deterministic',
      dependsOn: ['final-review'],
      command: 'grep -F "FINAL_REVIEW_PASS" .workflow-artifacts/wave8-github-issues/fix-cli-artifact-path-and-caller-root/final-review.md',
      captureOutput: true,
      failOnError: true,
    })
    .step('final-hard-validation', {
      type: 'deterministic',
      dependsOn: ['final-review-pass-gate'],
      command: 'npm run typecheck && npx tsc --noEmit && npm test --workspace @ricky/local && npm test --workspace @ricky/cli && npm test',
      captureOutput: true,
      failOnError: true,
    })
    .step('signoff', {
      type: 'deterministic',
      dependsOn: ['final-hard-validation'],
      command: [
        "cat <<'EOF' > .workflow-artifacts/wave8-github-issues/fix-cli-artifact-path-and-caller-root/signoff.md",
        '# GitHub issues #1 and #2 signoff',
        '',
        'Validation commands:',
        '- npm run typecheck',
        '- npx tsc --noEmit',
        '- npm test --workspace @ricky/local',
        '- npm test --workspace @ricky/cli',
        '- npm test',
        '',
        'Acceptance proof:',
        '- reported artifact path matches an existing file in the caller repo',
        '- suggested next command references that same file',
        '- no generated workflow is written under packages/cli/workflows/generated for the repo-root contract',
        '',
        'PATH_ROOT_ISSUES_COMPLETE',
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
