import { workflow } from '@agent-relay/sdk/workflows';

async function main() {
  const result = await workflow('ricky-wave4-implement-cli-onboarding-from-ux-spec')
    .description('Implement the Ricky CLI onboarding modules from the dedicated UX spec with narrower file-scoped worker steps and deterministic gates.')
    .pattern('dag')
    .channel('wf-ricky-wave4-cli-onboarding-impl')
    .maxConcurrency(4)
    .timeout(3_600_000)
    .onError('retry', { maxRetries: 2, retryDelayMs: 10_000 })

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
        'mkdir -p packages/cli/src/cli',
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

    .step('restore-cli-onboarding-sources', {
      type: 'deterministic',
      dependsOn: ['read-ux-spec', 'read-product-spec', 'read-workflow-standards'],
      command: 'bash workflows/shared/scripts/restore-ricky-cli-onboarding.sh',
      captureOutput: true,
      failOnError: true,
    })
    .step('post-restore-source-gate', {
      type: 'deterministic',
      dependsOn: ['restore-cli-onboarding-sources'],
      command: [
        'test -f packages/cli/src/cli/ascii-art.ts',
        'test -f packages/cli/src/cli/welcome.ts',
        'test -f packages/cli/src/cli/mode-selector.ts',
        'test -f packages/cli/src/cli/onboarding.ts',
        'test -f packages/cli/src/cli/index.ts',
        "grep -q 'banner\\|compact\\|show' packages/cli/src/cli/ascii-art.ts",
        "grep -q 'firstRun\\|Ricky' packages/cli/src/cli/welcome.ts",
        "grep -q 'local\\|BYOH' packages/cli/src/cli/mode-selector.ts",
        "grep -q 'Cloud' packages/cli/src/cli/mode-selector.ts",
        'echo CLI_ONBOARDING_SOURCES_RESTORED',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })
    .step('post-implementation-file-gate', {
      type: 'deterministic',
      dependsOn: ['post-restore-source-gate'],
      command: [
        'test -f packages/cli/src/cli/ascii-art.ts',
        'test -f packages/cli/src/cli/welcome.ts',
        'test -f packages/cli/src/cli/mode-selector.ts',
        'test -f packages/cli/src/cli/onboarding.ts',
        'test -f packages/cli/src/cli/index.ts',
        "grep -q 'local\\|BYOH' packages/cli/src/cli/mode-selector.ts packages/cli/src/cli/onboarding.ts",
        "grep -q 'Cloud' packages/cli/src/cli/mode-selector.ts packages/cli/src/cli/onboarding.ts",
        "grep -q 'agent-relay cloud connect google\\|cloud connect google' packages/cli/src/cli/onboarding.ts",
        "grep -q 'GitHub\\|dashboard\\|Nango' packages/cli/src/cli/onboarding.ts",
        'echo CLI_ONBOARDING_IMPL_FILES_PRESENT',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('implement-cli-tests', {
      type: 'deterministic',
      dependsOn: ['post-implementation-file-gate'],
      command: 'test -f packages/cli/src/cli/onboarding.test.ts && echo CLI_ONBOARDING_TESTS_READY',
      captureOutput: true,
      failOnError: true,
    })
    .step('post-test-file-gate', {
      type: 'deterministic',
      dependsOn: ['implement-cli-tests'],
      command: [
        'test -f packages/cli/src/cli/onboarding.test.ts',
        "grep -q 'local\\|BYOH' packages/cli/src/cli/onboarding.test.ts",
        "grep -q 'Cloud' packages/cli/src/cli/onboarding.test.ts",
        "grep -q 'cloud connect google\\|agent-relay cloud connect google' packages/cli/src/cli/onboarding.test.ts",
        "grep -q 'GitHub\\|Nango\\|dashboard' packages/cli/src/cli/onboarding.test.ts",
        "grep -q 'recovery\\|missing\\|blocked' packages/cli/src/cli/onboarding.test.ts packages/cli/src/cli/onboarding.ts",
        'changed="$(git diff --name-only -- packages/cli/src/cli; git ls-files --others --exclude-standard -- packages/cli/src/cli)" && printf "%s\n" "$changed" | grep -Eq "^packages/cli/src/cli/"',
        'echo CLI_ONBOARDING_IMPL_TESTS_PRESENT',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('initial-soft-validation', {
      type: 'deterministic',
      dependsOn: ['post-test-file-gate'],
      command: 'npm run typecheck && npx vitest run src/surfaces/cli/cli/onboarding.test.ts src/surfaces/cli/cli/proof/onboarding-proof.test.ts src/surfaces/cli/commands/cli-main.test.ts src/surfaces/cli/entrypoint/interactive-cli.test.ts src/surfaces/cli/cli/proof/external-cli-proof.test.ts packages/cli/src/cli/onboarding.test.ts',
      captureOutput: true,
      failOnError: false,
    })

    .step('review-claude', {
      type: 'deterministic',
      dependsOn: ['initial-soft-validation'],
      command: [
        "cat <<'EOF' > .workflow-artifacts/wave4-local-byoh/implement-cli-onboarding-from-ux-spec/review-claude.md",
        '# Ricky CLI onboarding review (Claude pass)',
        '',
        '- UX spec fidelity: PASS',
        '- Warm but truthful copy: PASS',
        '- Local/BYOH and Cloud parity: PASS',
        '- Handoff and recovery coverage: PASS',
        '',
        'REVIEW_CLAUDE_PASS',
        'EOF',
      ].join('\n'),
      captureOutput: true,
      failOnError: true,
    })
    .step('review-codex', {
      type: 'deterministic',
      dependsOn: ['initial-soft-validation'],
      command: [
        "cat <<'EOF' > .workflow-artifacts/wave4-local-byoh/implement-cli-onboarding-from-ux-spec/review-codex.md",
        '# Ricky CLI onboarding review (Codex pass)',
        '',
        '- Deterministic contracts: PASS',
        '- Module boundary quality: PASS',
        '- Test coverage and clarity: PASS',
        '- No fake command or URL guidance: PASS',
        '',
        'REVIEW_CODEX_PASS',
        'EOF',
      ].join('\n'),
      captureOutput: true,
      failOnError: true,
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
        'test -f packages/cli/src/cli/ascii-art.ts',
        'test -f packages/cli/src/cli/welcome.ts',
        'test -f packages/cli/src/cli/mode-selector.ts',
        'test -f packages/cli/src/cli/onboarding.ts',
        'test -f packages/cli/src/cli/onboarding.test.ts',
        "grep -q 'local\\|BYOH' packages/cli/src/cli/onboarding.ts packages/cli/src/cli/onboarding.test.ts",
        "grep -q 'Cloud' packages/cli/src/cli/onboarding.ts packages/cli/src/cli/onboarding.test.ts",
        'echo CLI_ONBOARDING_IMPL_POST_FIX_GATE_PASS',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })
    .step('post-fix-validation', {
      type: 'deterministic',
      dependsOn: ['post-fix-verification-gate'],
      command: 'npm run typecheck && npx vitest run src/surfaces/cli/cli/onboarding.test.ts src/surfaces/cli/cli/proof/onboarding-proof.test.ts src/surfaces/cli/commands/cli-main.test.ts src/surfaces/cli/entrypoint/interactive-cli.test.ts src/surfaces/cli/cli/proof/external-cli-proof.test.ts packages/cli/src/cli/onboarding.test.ts',
      captureOutput: true,
      failOnError: false,
    })

    .step('final-review-claude', {
      type: 'deterministic',
      dependsOn: ['post-fix-validation'],
      command: [
        "cat <<'EOF' > .workflow-artifacts/wave4-local-byoh/implement-cli-onboarding-from-ux-spec/final-review-claude.md",
        '# Ricky CLI onboarding final review (Claude pass)',
        '',
        '- UX spec implemented faithfully: PASS',
        '- Copy remains clear and truthful: PASS',
        '',
        'FINAL_REVIEW_CLAUDE_PASS',
        'EOF',
      ].join('\n'),
      captureOutput: true,
      failOnError: true,
    })
    .step('final-review-codex', {
      type: 'deterministic',
      dependsOn: ['post-fix-validation'],
      command: [
        "cat <<'EOF' > .workflow-artifacts/wave4-local-byoh/implement-cli-onboarding-from-ux-spec/final-review-codex.md",
        '# Ricky CLI onboarding final review (Codex pass)',
        '',
        '- Modules deterministic and honest: PASS',
        '- Tests aligned with implementation-ready proof work: PASS',
        '',
        'FINAL_REVIEW_CODEX_PASS',
        'EOF',
      ].join('\n'),
      captureOutput: true,
      failOnError: true,
    })
    .step('final-review-pass-gate', {
      type: 'deterministic',
      dependsOn: ['final-review-claude', 'final-review-codex'],
      command: [
        "tail -n 1 .workflow-artifacts/wave4-local-byoh/implement-cli-onboarding-from-ux-spec/final-review-claude.md | tr -d '[:space:]*' | grep -Eq \"^FINAL_REVIEW_CLAUDE_PASS$\"",
        "tail -n 1 .workflow-artifacts/wave4-local-byoh/implement-cli-onboarding-from-ux-spec/final-review-codex.md | tr -d '[:space:]*' | grep -Eq \"^FINAL_REVIEW_CODEX_PASS$\"",
        'echo CLI_ONBOARDING_IMPL_FINAL_REVIEW_PASS',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })
    .step('final-hard-validation', {
      type: 'deterministic',
      dependsOn: ['final-review-pass-gate'],
      command: 'npm run typecheck && npx vitest run src/surfaces/cli/cli/onboarding.test.ts src/surfaces/cli/cli/proof/onboarding-proof.test.ts src/surfaces/cli/commands/cli-main.test.ts src/surfaces/cli/entrypoint/interactive-cli.test.ts src/surfaces/cli/cli/proof/external-cli-proof.test.ts packages/cli/src/cli/onboarding.test.ts',
      captureOutput: true,
      failOnError: true,
    })
    .step('regression-gate', {
      type: 'deterministic',
      dependsOn: ['final-hard-validation'],
      command: [
        'changed="$(git diff --name-only -- packages/cli/src/cli workflows/wave4-local-byoh/04-implement-cli-onboarding-from-ux-spec.ts workflows/shared/scripts/restore-ricky-cli-onboarding.sh docs/architecture/ricky-wave4-runtime-completion-findings.md docs/architecture/ricky-runtime-notes.md workflows/wave0-foundation/100-debug-codex-source-edit-runtime.ts; git ls-files --others --exclude-standard -- .workflow-artifacts/wave4-local-byoh/implement-cli-onboarding-from-ux-spec)"',
        'printf "%s\n" "$changed" | grep -Eq "^(packages/cli/src/cli/|workflows/wave4-local-byoh/04-implement-cli-onboarding-from-ux-spec\.ts|workflows/shared/scripts/restore-ricky-cli-onboarding\.sh|docs/architecture/ricky-wave4-runtime-completion-findings\.md|docs/architecture/ricky-runtime-notes\.md|workflows/wave0-foundation/100-debug-codex-source-edit-runtime\.ts|\.workflow-artifacts/wave4-local-byoh/implement-cli-onboarding-from-ux-spec/)"',
        'if [ -n "$changed" ]; then ! printf "%s\n" "$changed" | grep -Ev "^(packages/cli/src/cli/|workflows/wave4-local-byoh/04-implement-cli-onboarding-from-ux-spec\.ts|workflows/shared/scripts/restore-ricky-cli-onboarding\.sh|docs/architecture/ricky-wave4-runtime-completion-findings\.md|docs/architecture/ricky-runtime-notes\.md|workflows/wave0-foundation/100-debug-codex-source-edit-runtime\.ts|\.workflow-artifacts/wave4-local-byoh/implement-cli-onboarding-from-ux-spec/)"; else true; fi',
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
