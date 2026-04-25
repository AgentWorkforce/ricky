import { workflow } from '@agent-relay/sdk/workflows';

async function main() {
  const result = await workflow('ricky-wave4-implement-cli-onboarding-from-ux-spec')
    .description('Implement the Ricky CLI onboarding modules from the dedicated UX spec with narrower file-scoped worker steps and deterministic gates.')
    .pattern('dag')
    .channel('wf-ricky-wave4-cli-onboarding-impl')
    .maxConcurrency(4)
    .timeout(3_600_000)
    .onError('retry', { maxRetries: 2, retryDelayMs: 10_000 })

    .agent('impl-primary-codex', {
      cli: 'codex',
      preset: 'worker',
      role: 'Primary implementer for tightly bounded CLI onboarding file edits.',
      retries: 2,
    })
    .agent('impl-tests-codex', {
      cli: 'codex',
      preset: 'worker',
      role: 'Test implementer for deterministic onboarding test coverage.',
      retries: 2,
    })
    .agent('reviewer-claude', {
      cli: 'claude',
      preset: 'reviewer',
      role: 'Reviews onboarding UX fidelity, product truth, and user-facing clarity.',
      retries: 1,
    })
    .agent('reviewer-codex', {
      cli: 'codex',
      preset: 'reviewer',
      role: 'Reviews code quality, test coverage, and deterministic contract shape.',
      retries: 1,
    })
    .agent('validator-claude', {
      cli: 'claude',
      preset: 'worker',
      role: 'Runs the implementation fix loop, post-fix validation, and final signoff.',
      retries: 2,
    })

    .step('prepare-artifacts', {
      type: 'deterministic',
      command: [
        'mkdir -p .workflow-artifacts/wave4-local-byoh/implement-cli-onboarding-from-ux-spec',
        'mkdir -p src/cli',
        'echo CLI_ONBOARDING_IMPL_READY',
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
    .step('read-product-spec', {
      type: 'deterministic',
      dependsOn: ['prepare-artifacts'],
      command: 'cat SPEC.md',
      captureOutput: true,
      failOnError: true,
    })
    .step('read-workflow-standards', {
      type: 'deterministic',
      dependsOn: ['prepare-artifacts'],
      command: 'cat docs/workflows/WORKFLOW_STANDARDS.md && printf "\n\n---\n\n" && cat workflows/shared/WORKFLOW_AUTHORING_RULES.md',
      captureOutput: true,
      failOnError: true,
    })

    .step('write-ascii-art', {
      agent: 'impl-primary-codex',
      dependsOn: ['read-ux-spec', 'read-product-spec', 'read-workflow-standards'],
      task: `Edit only src/cli/ascii-art.ts.

Requirements:
- Support a recognizable full banner and a compact fallback.
- Export deterministic banner rendering helpers.
- Keep banner visibility logic pure and testable.
- Do not modify any other file.
- Write the file to disk, then exit cleanly.`,
      verification: { type: 'file_exists', value: 'src/cli/ascii-art.ts' },
    })
    .step('verify-ascii-art', {
      type: 'deterministic',
      dependsOn: ['write-ascii-art'],
      command: [
        'test -f src/cli/ascii-art.ts',
        'grep -q "banner\|compact\|show" src/cli/ascii-art.ts',
        'echo CLI_ASCII_ART_READY',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('write-welcome', {
      agent: 'impl-primary-codex',
      dependsOn: ['verify-ascii-art'],
      task: `Edit only src/cli/welcome.ts.

Requirements:
- Support first-run framing and compact returning-user framing.
- Keep the copy warm, deterministic, and aligned with the UX spec.
- Do not modify any other file.
- Write the file to disk, then exit cleanly.`,
      verification: { type: 'file_exists', value: 'src/cli/welcome.ts' },
    })
    .step('verify-welcome', {
      type: 'deterministic',
      dependsOn: ['write-welcome'],
      command: [
        'test -f src/cli/welcome.ts',
        'grep -q "firstRun\|Ricky" src/cli/welcome.ts',
        'echo CLI_WELCOME_READY',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('write-mode-selector', {
      agent: 'impl-primary-codex',
      dependsOn: ['verify-welcome'],
      task: `Edit only src/cli/mode-selector.ts.

Requirements:
- Expose local/BYOH and Cloud as co-equal options.
- Keep the descriptions concise and user-facing.
- Do not modify any other file.
- Write the file to disk, then exit cleanly.`,
      verification: { type: 'file_exists', value: 'src/cli/mode-selector.ts' },
    })
    .step('verify-mode-selector', {
      type: 'deterministic',
      dependsOn: ['write-mode-selector'],
      command: [
        'test -f src/cli/mode-selector.ts',
        'grep -q "local\|BYOH" src/cli/mode-selector.ts',
        'grep -q "Cloud" src/cli/mode-selector.ts',
        'echo CLI_MODE_SELECTOR_READY',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('write-onboarding-and-index', {
      agent: 'impl-primary-codex',
      dependsOn: ['verify-mode-selector'],
      task: `Edit only these two files:
- src/cli/onboarding.ts
- src/cli/index.ts

Requirements:
- onboarding.ts must compose banner, welcome, mode selection, Cloud guidance, handoff guidance, and recovery guidance into deterministic output helpers.
- index.ts must export the public onboarding contract.
- Use docs/product/ricky-cli-onboarding-ux-spec.md as the source of truth.
- Do not modify any other file.
- Write both files to disk, then exit cleanly.`,
      verification: { type: 'file_exists', value: 'src/cli/onboarding.ts' },
    })
    .step('post-implementation-file-gate', {
      type: 'deterministic',
      dependsOn: ['write-onboarding-and-index'],
      command: [
        'test -f src/cli/ascii-art.ts',
        'test -f src/cli/welcome.ts',
        'test -f src/cli/mode-selector.ts',
        'test -f src/cli/onboarding.ts',
        'test -f src/cli/index.ts',
        'grep -q "local\|BYOH" src/cli/mode-selector.ts src/cli/onboarding.ts',
        'grep -q "Cloud" src/cli/mode-selector.ts src/cli/onboarding.ts',
        'grep -q "agent-relay cloud connect google\|cloud connect google" src/cli/onboarding.ts',
        'grep -q "GitHub\|dashboard\|Nango" src/cli/onboarding.ts',
        'echo CLI_ONBOARDING_IMPL_FILES_PRESENT',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('implement-cli-tests', {
      agent: 'impl-tests-codex',
      dependsOn: ['post-implementation-file-gate'],
      task: `Edit only src/cli/onboarding.test.ts.

Coverage must include:
- first-run output
- returning-user output
- local/BYOH visibility
- Cloud visibility
- Google connect guidance
- GitHub dashboard/Nango guidance
- Claude or MCP handoff wording
- at least one recovery path

Non-goals:
- no snapshot bloat
- no shell-specific or network-dependent tests

Verification:
- tests should fail if local/BYOH disappears
- tests should fail if Cloud guidance becomes fake or underspecified
- Write only the requested test file to disk, then exit cleanly.`,
      verification: { type: 'file_exists', value: 'src/cli/onboarding.test.ts' },
    })
    .step('post-test-file-gate', {
      type: 'deterministic',
      dependsOn: ['implement-cli-tests'],
      command: [
        'test -f src/cli/onboarding.test.ts',
        'grep -q "local\|BYOH" src/cli/onboarding.test.ts',
        'grep -q "Cloud" src/cli/onboarding.test.ts',
        'grep -q "cloud connect google\|agent-relay cloud connect google" src/cli/onboarding.test.ts',
        'grep -q "GitHub\|Nango\|dashboard" src/cli/onboarding.test.ts',
        'grep -q "recovery\|missing\|blocked" src/cli/onboarding.test.ts src/cli/onboarding.ts',
        'changed="$(git diff --name-only -- src/cli; git ls-files --others --exclude-standard -- src/cli)" && printf "%s\n" "$changed" | grep -Eq "^src/cli/"',
        'echo CLI_ONBOARDING_IMPL_TESTS_PRESENT',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('initial-soft-validation', {
      type: 'deterministic',
      dependsOn: ['post-test-file-gate'],
      command: 'npx tsc --noEmit && npx vitest run src/cli/',
      captureOutput: true,
      failOnError: false,
    })

    .step('review-claude', {
      agent: 'reviewer-claude',
      dependsOn: ['initial-soft-validation'],
      task: `Review the implemented Ricky CLI onboarding behavior.

Focus:
- fidelity to the UX spec
- warm but truthful copy
- local/BYOH and Cloud parity
- handoff and recovery coverage

Write .workflow-artifacts/wave4-local-byoh/implement-cli-onboarding-from-ux-spec/review-claude.md ending with REVIEW_CLAUDE_PASS or REVIEW_CLAUDE_FAIL.`,
      verification: { type: 'file_exists', value: '.workflow-artifacts/wave4-local-byoh/implement-cli-onboarding-from-ux-spec/review-claude.md' },
    })
    .step('review-codex', {
      agent: 'reviewer-codex',
      dependsOn: ['initial-soft-validation'],
      task: `Review the implemented Ricky CLI onboarding code and tests.

Focus:
- deterministic contracts
- module boundary quality
- test coverage and clarity
- no fake command or URL guidance

Write .workflow-artifacts/wave4-local-byoh/implement-cli-onboarding-from-ux-spec/review-codex.md ending with REVIEW_CODEX_PASS or REVIEW_CODEX_FAIL.`,
      verification: { type: 'file_exists', value: '.workflow-artifacts/wave4-local-byoh/implement-cli-onboarding-from-ux-spec/review-codex.md' },
    })

    .step('read-review-feedback', {
      type: 'deterministic',
      dependsOn: ['review-claude', 'review-codex'],
      command: 'cat .workflow-artifacts/wave4-local-byoh/implement-cli-onboarding-from-ux-spec/review-claude.md .workflow-artifacts/wave4-local-byoh/implement-cli-onboarding-from-ux-spec/review-codex.md',
      captureOutput: true,
      failOnError: true,
    })
    .step('fix-cli-onboarding', {
      agent: 'validator-claude',
      dependsOn: ['read-review-feedback'],
      task: `Fix Ricky CLI onboarding issues from review feedback.

Review feedback:
{{steps.read-review-feedback.output}}

Rules:
- keep tests aligned with user-visible behavior
- preserve local/BYOH and Cloud parity
- preserve recovery-path coverage
- do not add live external dependencies`,
      verification: { type: 'exit_code', value: '0' },
    })
    .step('post-fix-verification-gate', {
      type: 'deterministic',
      dependsOn: ['fix-cli-onboarding'],
      command: [
        'test -f src/cli/ascii-art.ts',
        'test -f src/cli/welcome.ts',
        'test -f src/cli/mode-selector.ts',
        'test -f src/cli/onboarding.ts',
        'test -f src/cli/onboarding.test.ts',
        'grep -q "local\|BYOH" src/cli/onboarding.ts src/cli/onboarding.test.ts',
        'grep -q "Cloud" src/cli/onboarding.ts src/cli/onboarding.test.ts',
        'echo CLI_ONBOARDING_IMPL_POST_FIX_GATE_PASS',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })
    .step('post-fix-validation', {
      type: 'deterministic',
      dependsOn: ['post-fix-verification-gate'],
      command: 'npx tsc --noEmit && npx vitest run src/cli/',
      captureOutput: true,
      failOnError: false,
    })

    .step('final-review-claude', {
      agent: 'reviewer-claude',
      dependsOn: ['post-fix-validation'],
      task: `Re-review the Ricky CLI onboarding implementation after fixes.

Confirm the UX spec is now implemented faithfully and clearly.
Write .workflow-artifacts/wave4-local-byoh/implement-cli-onboarding-from-ux-spec/final-review-claude.md ending with FINAL_REVIEW_CLAUDE_PASS or FINAL_REVIEW_CLAUDE_FAIL.`,
      verification: { type: 'file_exists', value: '.workflow-artifacts/wave4-local-byoh/implement-cli-onboarding-from-ux-spec/final-review-claude.md' },
    })
    .step('final-review-codex', {
      agent: 'reviewer-codex',
      dependsOn: ['post-fix-validation'],
      task: `Re-review the Ricky CLI onboarding implementation after fixes.

Confirm the modules and tests are deterministic, honest, and implementation-ready for final proof work.
Write .workflow-artifacts/wave4-local-byoh/implement-cli-onboarding-from-ux-spec/final-review-codex.md ending with FINAL_REVIEW_CODEX_PASS or FINAL_REVIEW_CODEX_FAIL.`,
      verification: { type: 'file_exists', value: '.workflow-artifacts/wave4-local-byoh/implement-cli-onboarding-from-ux-spec/final-review-codex.md' },
    })
    .step('final-review-pass-gate', {
      type: 'deterministic',
      dependsOn: ['final-review-claude', 'final-review-codex'],
      command: [
        'tail -n 1 .workflow-artifacts/wave4-local-byoh/implement-cli-onboarding-from-ux-spec/final-review-claude.md | grep -Eq "^FINAL_REVIEW_CLAUDE_PASS$"',
        'tail -n 1 .workflow-artifacts/wave4-local-byoh/implement-cli-onboarding-from-ux-spec/final-review-codex.md | grep -Eq "^FINAL_REVIEW_CODEX_PASS$"',
        'echo CLI_ONBOARDING_IMPL_FINAL_REVIEW_PASS',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })
    .step('final-hard-validation', {
      type: 'deterministic',
      dependsOn: ['final-review-pass-gate'],
      command: 'npx tsc --noEmit && npx vitest run src/cli/',
      captureOutput: true,
      failOnError: true,
    })
    .step('regression-gate', {
      type: 'deterministic',
      dependsOn: ['final-hard-validation'],
      command: [
        'changed="$(git diff --name-only; git ls-files --others --exclude-standard)"',
        'printf "%s\n" "$changed" | grep -Eq "^(src/cli/|\.workflow-artifacts/)"',
        '! printf "%s\n" "$changed" | grep -Ev "^(src/cli/|\.workflow-artifacts/)"',
        'echo CLI_ONBOARDING_IMPL_REGRESSION_GATE_PASS',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })
    .step('final-signoff', {
      agent: 'validator-claude',
      dependsOn: ['regression-gate'],
      task: `Write .workflow-artifacts/wave4-local-byoh/implement-cli-onboarding-from-ux-spec/signoff.md.

Include files changed, validation commands run, review verdicts, and remaining risks.
End with CLI_ONBOARDING_IMPL_COMPLETE.`,
      verification: { type: 'file_exists', value: '.workflow-artifacts/wave4-local-byoh/implement-cli-onboarding-from-ux-spec/signoff.md' },
    })

    .run({ cwd: process.cwd() });

  console.log(result.status);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
