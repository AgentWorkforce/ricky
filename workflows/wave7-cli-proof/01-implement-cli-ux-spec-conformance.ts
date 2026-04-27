import { workflow } from '@agent-relay/sdk/workflows';

async function main() {
  const result = await workflow('ricky-wave7-implement-cli-ux-spec-conformance')
    .description('Make Ricky CLI UX truthful and testable by wiring real generate/setup/status behavior around the existing local/BYOH intake path and honest command output.')
    .pattern('dag')
    .channel('wf-ricky-wave7-cli-ux-conformance')
    .maxConcurrency(4)
    .timeout(3_600_000)
    .onError('retry', { maxRetries: 2, retryDelayMs: 10_000 })

    .agent('impl-codex', {
      cli: 'codex',
      role: 'Implements the real CLI command/flag follow-through against the UX spec using existing Ricky package seams.',
      retries: 2,
    })
    .agent('tests-codex', {
      cli: 'codex',
      role: 'Adds bounded parser, dispatcher, and handoff-routing tests for command truthfulness.',
      retries: 2,
    })
    .agent('review-claude', {
      cli: 'claude',
      preset: 'reviewer',
      role: 'Reviews whether the user-facing CLI surface becomes honest, immediate, and testable without fake commands.',
      retries: 1,
    })
    .agent('validator-claude', {
      cli: 'claude',
      preset: 'worker',
      role: 'Runs the 80-to-100 validation loop and applies bounded fixes if CLI conformance is still underproved.',
      retries: 2,
    })

    .step('prepare-artifacts', {
      type: 'deterministic',
      command: [
        'mkdir -p .workflow-artifacts/wave7-cli-proof/implement-cli-ux-spec-conformance',
        'echo RICKY_WAVE7_CLI_UX_READY',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })
    .step('read-ux-spec', {
      type: 'deterministic',
      dependsOn: ['prepare-artifacts'],
      command: 'cat docs/product/ricky-cli-onboarding-ux-spec.md',
      captureOutput: true,
      failOnError: true,
    })
    .step('read-cli-surface', {
      type: 'deterministic',
      dependsOn: ['prepare-artifacts'],
      command: [
        'sed -n "1,260p" packages/cli/src/commands/cli-main.ts',
        'printf "\n---\n\n"',
        'sed -n "1,260p" packages/cli/src/commands/cli-main.test.ts',
        'printf "\n---\n\n"',
        'sed -n "1,260p" packages/cli/src/cli/onboarding.ts',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })
    .step('read-local-intake-surface', {
      type: 'deterministic',
      dependsOn: ['prepare-artifacts'],
      command: [
        'sed -n "1,260p" packages/local/src/request-normalizer.ts',
        'printf "\n---\n\n"',
        'sed -n "1,260p" packages/local/src/entrypoint.ts',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })
    .step('read-authoring-rules', {
      type: 'deterministic',
      dependsOn: ['prepare-artifacts'],
      command: 'cat docs/workflows/WORKFLOW_STANDARDS.md && printf "\n\n---\n\n" && cat workflows/shared/WORKFLOW_AUTHORING_RULES.md',
      captureOutput: true,
      failOnError: true,
    })

    .step('implement-cli-ux-conformance', {
      agent: 'impl-codex',
      dependsOn: ['read-ux-spec', 'read-cli-surface', 'read-local-intake-surface', 'read-authoring-rules'],
      task: `Implement only the minimum real CLI UX follow-through needed to make Ricky testable after onboarding.

Write or update only these files:
- packages/cli/src/commands/cli-main.ts
- packages/cli/src/entrypoint/interactive-cli.ts
- packages/cli/src/cli/onboarding.ts
- packages/cli/src/cli/mode-selector.ts

Before code edits, write .workflow-artifacts/wave7-cli-proof/implement-cli-ux-spec-conformance/plan.md ending with CLI_UX_CONFORMANCE_PLAN_READY.

Requirements:
- local mode must accept immediate inline/file/stdin spec handoff instead of stopping at rerun-later guidance
- any newly surfaced CLI commands or flags must be real and testable, not aspirational
- generate/setup/status/welcome behavior may be partial, but help output must remain truthful to whatever actually works after this slice
- use the existing local/BYOH normalization path instead of inventing a parallel handoff parser
- user-visible failures must return structured blocker or recovery guidance, not empty fallthrough
- preserve Cloud guidance truthfully; do not invent provider flows

Non-goals:
- do not fake published-bin semantics
- do not add Slack/web/MCP product surfaces beyond truthful CLI/local reuse
- do not claim full live runtime proof from this implementation alone

Exit after writing files to disk cleanly.`,
      verification: { type: 'file_exists', value: 'packages/cli/src/entrypoint/interactive-cli.ts' },
    })
    .step('plan-gate', {
      type: 'deterministic',
      dependsOn: ['implement-cli-ux-conformance'],
      command: [
        'test -f .workflow-artifacts/wave7-cli-proof/implement-cli-ux-spec-conformance/plan.md',
        'tail -n 1 .workflow-artifacts/wave7-cli-proof/implement-cli-ux-spec-conformance/plan.md | grep -Eq "^CLI_UX_CONFORMANCE_PLAN_READY$"',
        'echo CLI_UX_CONFORMANCE_PLAN_VERIFIED',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })
    .step('implementation-file-gate', {
      type: 'deterministic',
      dependsOn: ['implement-cli-ux-conformance', 'plan-gate'],
      command: [
        'test -f packages/cli/src/commands/cli-main.ts',
        'test -f packages/cli/src/entrypoint/interactive-cli.ts',
        'grep -Eq "spec|stdin|file|handoff|local" packages/cli/src/commands/cli-main.ts packages/cli/src/entrypoint/interactive-cli.ts',
        'echo CLI_UX_CONFORMANCE_FILES_PRESENT',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })
    .step('implement-cli-ux-tests', {
      agent: 'tests-codex',
      dependsOn: ['implementation-file-gate'],
      task: `Add or tighten tests only in these files:
- packages/cli/src/commands/cli-main.test.ts
- packages/cli/src/entrypoint/interactive-cli.test.ts
- packages/cli/src/cli/onboarding.test.ts

Requirements:
- prove the exact local journey: npm start -- --mode local accepts a real spec instead of ending at rerun-later guidance
- cover inline spec, missing spec/file blocker, and honest help output
- keep tests deterministic and injectable
- assertions must be user-journey focused, not implementation trivia`,
      verification: { type: 'file_exists', value: 'packages/cli/src/commands/cli-main.test.ts' },
    })
    .step('test-file-gate', {
      type: 'deterministic',
      dependsOn: ['implement-cli-ux-tests'],
      command: [
        'grep -Eq "mode local|inline spec|stdin|missing spec|help output|handoff" packages/cli/src/commands/cli-main.test.ts packages/cli/src/entrypoint/interactive-cli.test.ts packages/cli/src/cli/onboarding.test.ts',
        'echo CLI_UX_CONFORMANCE_TESTS_PRESENT',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })
    .step('initial-soft-validation', {
      type: 'deterministic',
      dependsOn: ['test-file-gate'],
      command: 'npm run typecheck && npm test --workspace @ricky/cli',
      captureOutput: true,
      failOnError: false,
    })
    .step('review-cli-ux', {
      agent: 'review-claude',
      dependsOn: ['initial-soft-validation'],
      task: `Review this CLI UX conformance slice.

Focus:
- does Ricky stop advertising rerun-later in the immediate local journey?
- is help output truthful about what currently works?
- are missing-spec and missing-file failures concrete and calm?
- does the implementation reuse local intake truth instead of inventing a parallel path?

Write .workflow-artifacts/wave7-cli-proof/implement-cli-ux-spec-conformance/review-claude.md ending with REVIEW_CLAUDE_PASS or REVIEW_CLAUDE_FAIL.`,
      verification: { type: 'file_exists', value: '.workflow-artifacts/wave7-cli-proof/implement-cli-ux-spec-conformance/review-claude.md' },
    })
    .step('fix-loop', {
      agent: 'validator-claude',
      dependsOn: ['review-cli-ux'],
      task: `Consume the review artifact and the current validation output. Apply only bounded fixes still needed for this slice in the existing file set.

Then rerun:
- npm run typecheck
- npm test --workspace @ricky/cli

Write .workflow-artifacts/wave7-cli-proof/implement-cli-ux-spec-conformance/fix-loop.md ending with CLI_UX_FIX_LOOP_COMPLETE.`,
      verification: { type: 'file_exists', value: '.workflow-artifacts/wave7-cli-proof/implement-cli-ux-spec-conformance/fix-loop.md' },
    })
    .step('post-fix-validation', {
      type: 'deterministic',
      dependsOn: ['fix-loop'],
      command: 'npm run typecheck && npm test --workspace @ricky/cli',
      captureOutput: true,
      failOnError: false,
    })
    .step('final-hard-validation', {
      type: 'deterministic',
      dependsOn: ['post-fix-validation'],
      command: 'npm run typecheck && npm test --workspace @ricky/cli && npm start -- --help',
      captureOutput: true,
      failOnError: true,
    })
    .step('regression-gate', {
      type: 'deterministic',
      dependsOn: ['final-hard-validation'],
      command: [
        'changed="$(git diff --name-only -- packages/cli/src/commands/cli-main.ts packages/cli/src/commands/cli-main.test.ts packages/cli/src/entrypoint/interactive-cli.ts packages/cli/src/entrypoint/interactive-cli.test.ts packages/cli/src/cli/onboarding.ts packages/cli/src/cli/onboarding.test.ts packages/cli/src/cli/mode-selector.ts workflows/wave7-cli-proof/01-implement-cli-ux-spec-conformance.ts; git ls-files --others --exclude-standard -- .workflow-artifacts/wave7-cli-proof/implement-cli-ux-spec-conformance)"',
        'printf "%s\n" "$changed" | grep -Eq "^(packages/cli/src/commands/cli-main\.ts|packages/cli/src/commands/cli-main\.test\.ts|packages/cli/src/entrypoint/interactive-cli\.ts|packages/cli/src/entrypoint/interactive-cli\.test\.ts|packages/cli/src/cli/onboarding\.ts|packages/cli/src/cli/onboarding\.test\.ts|packages/cli/src/cli/mode-selector\.ts|workflows/wave7-cli-proof/01-implement-cli-ux-spec-conformance\.ts|\.workflow-artifacts/wave7-cli-proof/implement-cli-ux-spec-conformance/)"',
        '! printf "%s\n" "$changed" | grep -Ev "^(packages/cli/src/commands/cli-main\.ts|packages/cli/src/commands/cli-main\.test\.ts|packages/cli/src/entrypoint/interactive-cli\.ts|packages/cli/src/entrypoint/interactive-cli\.test\.ts|packages/cli/src/cli/onboarding\.ts|packages/cli/src/cli/onboarding\.test\.ts|packages/cli/src/cli/mode-selector\.ts|workflows/wave7-cli-proof/01-implement-cli-ux-spec-conformance\.ts|\.workflow-artifacts/wave7-cli-proof/implement-cli-ux-spec-conformance/)"',
        'echo CLI_UX_CONFORMANCE_REGRESSION_PASS',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })
    .step('final-signoff', {
      type: 'deterministic',
      dependsOn: ['regression-gate'],
      command: [
        "cat <<'EOF' > .workflow-artifacts/wave7-cli-proof/implement-cli-ux-spec-conformance/signoff.md",
        '# Ricky CLI UX spec conformance signoff',
        '',
        'Validation commands:',
        '- npm run typecheck',
        '- npm test --workspace @ricky/cli',
        '- npm start -- --help',
        '',
        'Expected slice truth:',
        '- local mode no longer dead-ends at rerun-later guidance for immediate spec intake',
        '- help output is truthful to current working commands',
        '- missing-spec failures return recovery guidance',
        '',
        'CLI_UX_CONFORMANCE_COMPLETE',
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
