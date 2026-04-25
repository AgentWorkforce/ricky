import { workflow } from '@agent-relay/sdk/workflows';

async function main() {
  const result = await workflow('ricky-wave4-implement-cli-onboarding-from-ux-spec')
    .description('Implement the Ricky CLI onboarding modules from the dedicated UX spec with deterministic tests and user-visible contracts.')
    .pattern('dag')
    .channel('wf-ricky-wave4-cli-onboarding-impl')
    .maxConcurrency(4)
    .timeout(3_600_000)
    .onError('retry', { maxRetries: 2, retryDelayMs: 10_000 })

    .agent('lead-claude', {
      cli: 'claude',
      preset: 'worker',
      role: 'Implementation lead who keeps the CLI onboarding behavior aligned with the Ricky UX spec and product truth.',
      retries: 1,
    })
    .agent('impl-primary-codex', {
      cli: 'codex',
      role: 'Primary implementer for Ricky CLI onboarding modules and exports.',
      retries: 2,
    })
    .agent('impl-tests-codex', {
      cli: 'codex',
      role: 'Test implementer for first-run, returning-user, local/BYOH, Cloud, handoff, and recovery-path contracts.',
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

    .step('lead-plan', {
      agent: 'lead-claude',
      dependsOn: ['read-ux-spec', 'read-product-spec', 'read-workflow-standards'],
      task: `Plan the Ricky CLI onboarding implementation from the UX spec.

Context inputs:
- UX spec:
{{steps.read-ux-spec.output}}
- Product spec:
{{steps.read-product-spec.output}}
- Workflow standards and rules:
{{steps.read-workflow-standards.output}}

Deliverables:
- src/cli/ascii-art.ts
- src/cli/welcome.ts
- src/cli/mode-selector.ts
- src/cli/onboarding.ts
- src/cli/index.ts
- src/cli/onboarding.test.ts

Non-goals:
- Do not implement a full CLI parser.
- Do not add live provider auth or network calls.
- Do not reduce local/BYOH to a secondary path.

Verification:
- Tests must prove first-run and returning-user behavior.
- Tests must prove local/BYOH and Cloud are both first-class.
- Tests must prove Google connect guidance and GitHub dashboard/Nango guidance.
- Tests must cover at least one recovery path.

Write .workflow-artifacts/wave4-local-byoh/implement-cli-onboarding-from-ux-spec/plan.md with concrete file-by-file guidance and test expectations. End with CLI_ONBOARDING_IMPL_PLAN_READY.`,
      verification: { type: 'file_exists', value: '.workflow-artifacts/wave4-local-byoh/implement-cli-onboarding-from-ux-spec/plan.md' },
    })

    .step('implement-cli-modules', {
      agent: 'impl-primary-codex',
      dependsOn: ['lead-plan'],
      task: `Implement the CLI onboarding modules from the UX spec.

Requirements:
- ascii-art.ts must support a recognizable full banner and a compact fallback.
- welcome.ts must support first-run framing and compact returning-user framing.
- mode-selector.ts must expose local/BYOH and Cloud as co-equal options.
- onboarding.ts must compose mode selection, guidance, handoff examples, and recovery text into deterministic output helpers.
- index.ts must export the public onboarding contract.

Non-goals:
- No live external calls.
- No speculative commands beyond source-backed guidance.
- No hidden dependency on Slack or web runtime.

Verification:
- Keep user-visible strings deterministic and easy to assert.
- Keep the module boundaries aligned with the UX spec.
- Stop after writing implementation files.`,
      verification: { type: 'file_exists', value: 'src/cli/onboarding.ts' },
    })
    .step('post-implementation-file-gate', {
      type: 'deterministic',
      dependsOn: ['implement-cli-modules'],
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
      task: `Implement deterministic tests for the CLI onboarding modules.

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
- tests should fail if Cloud guidance becomes fake or underspecified`,
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
