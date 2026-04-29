import { workflow } from '@agent-relay/sdk/workflows';

async function main() {
  const result = await workflow('ricky-wave4-cli-onboarding-and-welcome')
    .description('Implement Ricky CLI onboarding with ASCII welcome, local/BYOH versus Cloud mode selection, and provider connection guidance.')
    .pattern('dag')
    .channel('wf-ricky-wave4-cli-onboarding')
    .maxConcurrency(4)
    .timeout(3_600_000)
    .onError('retry', { maxRetries: 2, retryDelayMs: 10_000 })

    .agent('lead-claude', {
      cli: 'claude',
      interactive: false,
      role: 'CLI onboarding lead who keeps the first-run experience aligned with Ricky local/BYOH and Cloud product requirements.',
      retries: 1,
    })
    .agent('impl-primary-codex', {
      cli: 'codex',
      role: 'Primary implementer for CLI welcome, onboarding, mode selector, ASCII art, and exports.',
      retries: 2,
    })
    .agent('impl-tests-codex', {
      cli: 'codex',
      role: 'Test implementer for user-visible onboarding text, mode selection contracts, and provider guidance.',
      retries: 2,
    })
    .agent('reviewer-claude', {
      cli: 'claude',
      preset: 'reviewer',
      role: 'Product reviewer for onboarding clarity, first-class local/BYOH treatment, and Cloud connect guidance.',
      retries: 1,
    })
    .agent('reviewer-codex', {
      cli: 'codex',
      preset: 'reviewer',
      role: 'Code reviewer for CLI contract quality, deterministic checks, and test coverage.',
      retries: 1,
    })
    .agent('validator-claude', {
      cli: 'claude',
      preset: 'worker',
      role: 'Validation owner who verifies user-visible CLI proof and final regression gates.',
      retries: 2,
    })

    .step('prepare-artifacts', {
      type: 'deterministic',
      command: [
        'mkdir -p .workflow-artifacts/wave4-local-byoh/cli-onboarding-and-welcome',
        'mkdir -p packages/cli/src/cli',
        'echo RICKY_WAVE4_CLI_ONBOARDING_READY',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })
    .step('read-workflow-standards', {
      type: 'deterministic',
      dependsOn: ['prepare-artifacts'],
      command: 'cat docs/workflows/WORKFLOW_STANDARDS.md',
      captureOutput: true,
      failOnError: true,
    })
    .step('read-authoring-rules', {
      type: 'deterministic',
      dependsOn: ['prepare-artifacts'],
      command: 'cat workflows/shared/WORKFLOW_AUTHORING_RULES.md',
      captureOutput: true,
      failOnError: true,
    })
    .step('read-generated-template', {
      type: 'deterministic',
      dependsOn: ['prepare-artifacts'],
      command: 'cat workflows/meta/spec/generated-workflow-template.md',
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

    .step('lead-plan', {
      agent: 'lead-claude',
      dependsOn: ['read-workflow-standards', 'read-authoring-rules', 'read-generated-template', 'read-product-spec'],
      task: `Plan the Ricky CLI onboarding implementation.

Context inputs:
- docs/workflows/WORKFLOW_STANDARDS.md:
{{steps.read-workflow-standards.output}}
- workflows/shared/WORKFLOW_AUTHORING_RULES.md:
{{steps.read-authoring-rules.output}}
- workflows/meta/spec/generated-workflow-template.md:
{{steps.read-generated-template.output}}
- SPEC.md:
{{steps.read-product-spec.output}}

Deliverables:
- packages/cli/src/cli/welcome.ts
- packages/cli/src/cli/onboarding.ts
- packages/cli/src/cli/mode-selector.ts
- packages/cli/src/cli/ascii-art.ts
- packages/cli/src/cli/onboarding.test.ts
- packages/cli/src/cli/index.ts

Non-goals:
- Do not implement the full CLI command parser.
- Do not implement Cloud API handlers.
- Do not reduce local/BYOH mode to a secondary path.

Verification:
- The rendered welcome must include recognizable Ricky ASCII/logo text or exported ASCII art.
- Mode selection must include local/BYOH and Cloud as co-equal options.
- Provider guidance must include npx agent-relay cloud connect google and GitHub Cloud dashboard/Nango guidance.
- Tests must assert user-visible onboarding output, not only internal state.
- Post-edit gates must run after implementation and tests.

Commit/PR boundary:
- Keep changes scoped to src/cli unless a tiny shared type is required.

Write .workflow-artifacts/wave4-local-byoh/cli-onboarding-and-welcome/plan.md ending with CLI_ONBOARDING_PLAN_READY.`,
      verification: { type: 'file_exists', value: '.workflow-artifacts/wave4-local-byoh/cli-onboarding-and-welcome/plan.md' },
    })

    .step('implement-cli-onboarding', {
      agent: 'impl-primary-codex',
      dependsOn: ['lead-plan'],
      task: `Implement Ricky CLI onboarding.

Deliverables:
- ascii-art.ts should export a stable ASCII-art welcome inspired by the Ricky logo.
- mode-selector.ts should expose local/BYOH and Cloud choices as first-class modes with concise descriptions and next actions.
- welcome.ts should render the first-run welcome text.
- onboarding.ts should compose welcome, mode selection, provider connect guidance, and next useful action.
- index.ts should export the public CLI onboarding contract.

Non-goals:
- Do not add interactive TTY dependencies unless already present.
- Do not call live Cloud provider setup.
- Do not make the CLI Cloud-only.

Verification:
- Keep output deterministic for tests.
- Make user-visible strings assertable.
- Include direct CLI and MCP handoff wording where useful, but keep it concise.`,
      verification: { type: 'file_exists', value: 'packages/cli/src/cli/onboarding.ts' },
    })
    .step('post-implementation-file-gate', {
      type: 'deterministic',
      dependsOn: ['implement-cli-onboarding'],
      command: [
        'test -f packages/cli/src/cli/welcome.ts',
        'test -f packages/cli/src/cli/onboarding.ts',
        'test -f packages/cli/src/cli/mode-selector.ts',
        'test -f packages/cli/src/cli/ascii-art.ts',
        'test -f packages/cli/src/cli/index.ts',
        'grep -q "local\\|BYOH" packages/cli/src/cli/mode-selector.ts packages/cli/src/cli/onboarding.ts',
        'grep -q "Cloud" packages/cli/src/cli/mode-selector.ts packages/cli/src/cli/onboarding.ts',
        'grep -q "cloud connect google\\|agent-relay cloud connect" packages/cli/src/cli/onboarding.ts packages/cli/src/cli/mode-selector.ts',
        'grep -q "ascii\\|Ricky\\|welcome" packages/cli/src/cli/ascii-art.ts packages/cli/src/cli/welcome.ts',
        'echo CLI_ONBOARDING_IMPLEMENTATION_FILES_PRESENT',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('implement-cli-tests', {
      agent: 'impl-tests-codex',
      dependsOn: ['post-implementation-file-gate'],
      task: `Add tests for Ricky CLI onboarding.

Deliverables:
- packages/cli/src/cli/onboarding.test.ts should assert the rendered welcome, local/BYOH mode, Cloud mode, Google connect command, GitHub dashboard/Nango guidance, and at least one next-action contract.

Non-goals:
- Do not test terminal colors or shell-specific behavior.
- Do not require network or provider auth.

Verification:
- Tests must prove user-visible onboarding text and mode options.
- Tests must fail if local/BYOH disappears or is subordinated to Cloud.`,
      verification: { type: 'file_exists', value: 'packages/cli/src/cli/onboarding.test.ts' },
    })
    .step('post-test-file-gate', {
      type: 'deterministic',
      dependsOn: ['implement-cli-tests'],
      command: [
        'test -f packages/cli/src/cli/onboarding.test.ts',
        'grep -q "local\\|BYOH" packages/cli/src/cli/onboarding.test.ts packages/cli/src/cli/mode-selector.ts',
        'grep -q "Cloud" packages/cli/src/cli/onboarding.test.ts packages/cli/src/cli/mode-selector.ts',
        'grep -q "cloud connect google\\|agent-relay cloud connect" packages/cli/src/cli/onboarding.test.ts packages/cli/src/cli/onboarding.ts',
        'grep -q "GitHub\\|Nango\\|dashboard" packages/cli/src/cli/onboarding.test.ts packages/cli/src/cli/onboarding.ts',
        'changed="$(git diff --name-only -- packages/cli/src/cli; git ls-files --others --exclude-standard -- packages/cli/src/cli)" && printf "%s\n" "$changed" | grep -Eq "^packages/cli/src/cli/"',
        'echo CLI_ONBOARDING_TEST_FILES_PRESENT',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('initial-soft-validation', {
      type: 'deterministic',
      dependsOn: ['post-test-file-gate'],
      command: 'npm run typecheck --workspace @ricky/cli && npm test --workspace @ricky/cli',
      captureOutput: true,
      failOnError: false,
    })

    .step('review-cli-claude', {
      agent: 'reviewer-claude',
      dependsOn: ['initial-soft-validation'],
      task: `Review the Ricky CLI onboarding experience.

Focus:
- Local/BYOH and Cloud are co-equal.
- First-run output explains next useful actions without becoming documentation-heavy.
- Google connect command and GitHub dashboard/Nango guidance match the product spec.
- User-visible proof is present in tests.

Write .workflow-artifacts/wave4-local-byoh/cli-onboarding-and-welcome/review-claude.md ending with REVIEW_CLAUDE_PASS or REVIEW_CLAUDE_FAIL.`,
      verification: { type: 'file_exists', value: '.workflow-artifacts/wave4-local-byoh/cli-onboarding-and-welcome/review-claude.md' },
    })
    .step('review-cli-codex', {
      agent: 'reviewer-codex',
      dependsOn: ['initial-soft-validation'],
      task: `Review the CLI onboarding code and tests.

Focus:
- Deterministic rendering contracts.
- Test coverage for user-visible strings and modes.
- Export shape.
- Avoiding unnecessary dependencies.

Write .workflow-artifacts/wave4-local-byoh/cli-onboarding-and-welcome/review-codex.md ending with REVIEW_CODEX_PASS or REVIEW_CODEX_FAIL.`,
      verification: { type: 'file_exists', value: '.workflow-artifacts/wave4-local-byoh/cli-onboarding-and-welcome/review-codex.md' },
    })

    .step('read-review-feedback', {
      type: 'deterministic',
      dependsOn: ['review-cli-claude', 'review-cli-codex'],
      command: 'cat .workflow-artifacts/wave4-local-byoh/cli-onboarding-and-welcome/review-claude.md .workflow-artifacts/wave4-local-byoh/cli-onboarding-and-welcome/review-codex.md',
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
- Keep local/BYOH first-class.
- Preserve user-visible Google and GitHub guidance contracts.
- Update tests for any behavior changes.
- Keep the implementation deterministic and easy to test.`,
      verification: { type: 'exit_code', value: '0' },
    })
    .step('post-fix-verification-gate', {
      type: 'deterministic',
      dependsOn: ['fix-cli-onboarding'],
      command: [
        'test -f packages/cli/src/cli/welcome.ts',
        'test -f packages/cli/src/cli/onboarding.ts',
        'test -f packages/cli/src/cli/mode-selector.ts',
        'test -f packages/cli/src/cli/ascii-art.ts',
        'test -f packages/cli/src/cli/onboarding.test.ts',
        'test -f packages/cli/src/cli/index.ts',
        'grep -q "local\\|BYOH" packages/cli/src/cli/onboarding.ts packages/cli/src/cli/mode-selector.ts packages/cli/src/cli/onboarding.test.ts',
        'grep -q "cloud connect google\\|agent-relay cloud connect" packages/cli/src/cli/onboarding.ts packages/cli/src/cli/onboarding.test.ts',
        'grep -q "GitHub\\|Nango\\|dashboard" packages/cli/src/cli/onboarding.ts packages/cli/src/cli/onboarding.test.ts',
        'echo CLI_ONBOARDING_POST_FIX_GATE_PASS',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })
    .step('post-fix-validation', {
      type: 'deterministic',
      dependsOn: ['post-fix-verification-gate'],
      command: 'npm run typecheck --workspace @ricky/cli && npm test --workspace @ricky/cli',
      captureOutput: true,
      failOnError: false,
    })

    .step('final-review-cli-claude', {
      agent: 'reviewer-claude',
      dependsOn: ['post-fix-validation'],
      task: `Re-review the Ricky CLI onboarding experience after fixes and post-fix validation.

Read packages/cli/src/cli/ source and tests, and post-fix validation output:
{{steps.post-fix-validation.output}}

Confirm prior review findings are fixed or explicitly non-blocking. Re-check that local/BYOH and Cloud are co-equal, first-run output is clear, Google/GitHub guidance matches product spec, and user-visible proof is in tests.

Write .workflow-artifacts/wave4-local-byoh/cli-onboarding-and-welcome/final-review-claude.md ending with FINAL_REVIEW_CLAUDE_PASS or FINAL_REVIEW_CLAUDE_FAIL.`,
      verification: { type: 'file_exists', value: '.workflow-artifacts/wave4-local-byoh/cli-onboarding-and-welcome/final-review-claude.md' },
    })
    .step('final-review-cli-codex', {
      agent: 'reviewer-codex',
      dependsOn: ['post-fix-validation'],
      task: `Re-review the CLI onboarding code and tests after fixes.

Read packages/cli/src/cli/ source and tests, and post-fix validation output:
{{steps.post-fix-validation.output}}

Confirm deterministic rendering contracts, test coverage for user-visible strings and modes, export shape, and minimal dependencies are ready for final hard gates.

Write .workflow-artifacts/wave4-local-byoh/cli-onboarding-and-welcome/final-review-codex.md ending with FINAL_REVIEW_CODEX_PASS or FINAL_REVIEW_CODEX_FAIL.`,
      verification: { type: 'file_exists', value: '.workflow-artifacts/wave4-local-byoh/cli-onboarding-and-welcome/final-review-codex.md' },
    })

    .step('final-review-pass-gate', {
      type: 'deterministic',
      dependsOn: ['final-review-cli-claude', 'final-review-cli-codex'],
      command: [
        "tail -n 1 .workflow-artifacts/wave4-local-byoh/cli-onboarding-and-welcome/final-review-claude.md | tr -d '[:space:]*' | grep -Eq \"^FINAL_REVIEW_CLAUDE_PASS$\"",
        "tail -n 1 .workflow-artifacts/wave4-local-byoh/cli-onboarding-and-welcome/final-review-codex.md | tr -d '[:space:]*' | grep -Eq \"^FINAL_REVIEW_CODEX_PASS$\"",
        'echo CLI_ONBOARDING_FINAL_REVIEW_PASS',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })
    .step('final-hard-validation', {
      type: 'deterministic',
      dependsOn: ['final-review-pass-gate'],
      command: 'npm run typecheck --workspace @ricky/cli && npm test --workspace @ricky/cli',
      captureOutput: true,
      failOnError: true,
    })
    .step('regression-gate', {
      type: 'deterministic',
      dependsOn: ['final-hard-validation'],
      command: [
        'npx tsc --noEmit',
        'changed="$(git diff --name-only -- packages/cli/src/cli packages/cli/package.json workflows/wave4-local-byoh/01-cli-onboarding-and-welcome.ts; git ls-files --others --exclude-standard -- .workflow-artifacts/wave4-local-byoh/cli-onboarding-and-welcome)"',
        'printf "%s\\n" "$changed" | grep -Eq "^(packages/cli/src/cli/|packages/cli/package\\.json|workflows/wave4-local-byoh/01-cli-onboarding-and-welcome\\.ts|\\.workflow-artifacts/wave4-local-byoh/cli-onboarding-and-welcome/)"',
        'if [ -n "$changed" ]; then ! printf "%s\\n" "$changed" | grep -Ev "^(packages/cli/src/cli/|packages/cli/package\\.json|workflows/wave4-local-byoh/01-cli-onboarding-and-welcome\\.ts|\\.workflow-artifacts/wave4-local-byoh/cli-onboarding-and-welcome/)"; else true; fi',
        'echo CLI_ONBOARDING_REGRESSION_GATE_PASS',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })
    .step('final-signoff', {
      agent: 'validator-claude',
      dependsOn: ['regression-gate'],
      task: `Write .workflow-artifacts/wave4-local-byoh/cli-onboarding-and-welcome/signoff.md.

Include files changed, user-visible contracts checked, validation commands, and remaining risks.
End with CLI_ONBOARDING_WORKFLOW_COMPLETE.`,
      verification: { type: 'file_exists', value: '.workflow-artifacts/wave4-local-byoh/cli-onboarding-and-welcome/signoff.md' },
    })

    .run({ cwd: process.cwd() });

  console.log(result.status);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
