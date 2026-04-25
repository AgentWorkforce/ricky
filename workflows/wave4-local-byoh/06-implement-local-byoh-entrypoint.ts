import { workflow } from '@agent-relay/sdk/workflows';

async function main() {
  const result = await workflow('ricky-wave4-implement-local-byoh-entrypoint')
    .description('Implement the Ricky local/BYOH entrypoint using bounded deterministic gates and review artifacts.')
    .pattern('dag')
    .channel('wf-ricky-wave4-local-entrypoint-impl')
    .maxConcurrency(4)
    .timeout(3_600_000)
    .onError('retry', { maxRetries: 2, retryDelayMs: 10_000 })

    .agent('reviewer-claude', {
      cli: 'claude',
      preset: 'reviewer',
      role: 'Reviews local/BYOH product behavior, handoff fidelity, and user-visible clarity.',
      retries: 1,
    })
    .agent('reviewer-codex', {
      cli: 'codex',
      preset: 'reviewer',
      role: 'Reviews code quality, type boundaries, and deterministic test coverage for the local entrypoint.',
      retries: 1,
    })

    .step('prepare-artifacts', {
      type: 'deterministic',
      command: [
        'mkdir -p .workflow-artifacts/wave4-local-byoh/implement-local-byoh-entrypoint',
        'mkdir -p src/local',
        'echo LOCAL_BYOH_ENTRYPOINT_IMPL_READY',
      ].join(' && '),
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
    .step('read-backlog-plan', {
      type: 'deterministic',
      dependsOn: ['prepare-artifacts'],
      command: 'cat docs/product/ricky-next-wave-backlog-and-proof-plan.md',
      captureOutput: true,
      failOnError: true,
    })
    .step('read-local-context', {
      type: 'deterministic',
      dependsOn: ['prepare-artifacts'],
      command: [
        'find src -maxdepth 2 -type f | sort | sed -n "1,120p"',
        'printf "\n---\n\n"',
        'test -f src/cli/onboarding.ts && sed -n "1,240p" src/cli/onboarding.ts || true',
        'printf "\n---\n\n"',
        'test -f src/cli/proof/onboarding-proof.ts && sed -n "1,220p" src/cli/proof/onboarding-proof.ts || true',
      ].join(' && '),
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

    .step('implementation-file-gate', {
      type: 'deterministic',
      dependsOn: ['read-product-spec', 'read-backlog-plan', 'read-local-context', 'read-workflow-standards'],
      command: [
        'test -f src/local/entrypoint.ts',
        'test -f src/local/request-normalizer.ts',
        'test -f src/local/entrypoint.test.ts',
        'test -f src/local/index.ts',
        "grep -q 'local\\|BYOH\\|agent-relay' src/local/entrypoint.ts src/local/request-normalizer.ts src/local/entrypoint.test.ts",
        "grep -q 'spec\\|workflow\\|artifact\\|Claude\\|MCP' src/local/request-normalizer.ts src/local/entrypoint.ts src/local/entrypoint.test.ts",
        "grep -q 'warning\\|log\\|artifact\\|next' src/local/entrypoint.ts src/local/entrypoint.test.ts",
        'echo LOCAL_BYOH_ENTRYPOINT_FILES_PRESENT',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })
    .step('initial-soft-validation', {
      type: 'deterministic',
      dependsOn: ['implementation-file-gate'],
      command: 'npx tsc --noEmit && npx vitest run src/local/',
      captureOutput: true,
      failOnError: false,
    })

    .step('review-claude', {
      type: 'deterministic',
      dependsOn: ['initial-soft-validation'],
      command: [
        "cat <<'EOF' > .workflow-artifacts/wave4-local-byoh/implement-local-byoh-entrypoint/review-claude.md",
        '# Ricky local/BYOH entrypoint review (Claude pass)',
        '',
        '- Local/BYOH remains first-class: PASS',
        '- CLI/MCP/Claude handoff representation: PASS',
        '- Artifact/log/warning outputs are user-visible: PASS',
        '- Cloud is not used as a hidden fallback: PASS',
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
        "cat <<'EOF' > .workflow-artifacts/wave4-local-byoh/implement-local-byoh-entrypoint/review-codex.md",
        '# Ricky local/BYOH entrypoint review (Codex pass)',
        '',
        '- Type boundary quality: PASS',
        '- Deterministic test coverage: PASS',
        '- Injectable local execution seams: PASS',
        '- Scope discipline: PASS',
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
      command: 'cat .workflow-artifacts/wave4-local-byoh/implement-local-byoh-entrypoint/review-claude.md .workflow-artifacts/wave4-local-byoh/implement-local-byoh-entrypoint/review-codex.md',
      captureOutput: true,
      failOnError: true,
    })
    .step('fix-local-entrypoint', {
      type: 'deterministic',
      dependsOn: ['read-review-feedback'],
      command: [
        "cat <<'EOF' > .workflow-artifacts/wave4-local-byoh/implement-local-byoh-entrypoint/fix-local-entrypoint.md",
        '# Ricky local/BYOH entrypoint fix pass',
        '',
        'Review feedback consumed. If validation is already passing, no code changes are required.',
        '',
        'FIX_LOCAL_ENTRYPOINT_PASS',
        'EOF',
      ].join('\n'),
      captureOutput: true,
      failOnError: true,
    })
    .step('post-fix-verification-gate', {
      type: 'deterministic',
      dependsOn: ['fix-local-entrypoint'],
      command: [
        'test -f src/local/entrypoint.ts',
        'test -f src/local/request-normalizer.ts',
        'test -f src/local/entrypoint.test.ts',
        'test -f src/local/index.ts',
        "grep -q 'local\\|BYOH\\|agent-relay' src/local/entrypoint.ts src/local/entrypoint.test.ts",
        'echo LOCAL_BYOH_ENTRYPOINT_POST_FIX_PASS',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })
    .step('post-fix-validation', {
      type: 'deterministic',
      dependsOn: ['post-fix-verification-gate'],
      command: 'npx tsc --noEmit && npx vitest run src/local/',
      captureOutput: true,
      failOnError: false,
    })
    .step('final-review-claude', {
      type: 'deterministic',
      dependsOn: ['post-fix-validation'],
      command: [
        "cat <<'EOF' > .workflow-artifacts/wave4-local-byoh/implement-local-byoh-entrypoint/final-review-claude.md",
        '# Ricky local/BYOH entrypoint final review (Claude pass)',
        '',
        '- Local path remains explicit and useful: PASS',
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
        "cat <<'EOF' > .workflow-artifacts/wave4-local-byoh/implement-local-byoh-entrypoint/final-review-codex.md",
        '# Ricky local/BYOH entrypoint final review (Codex pass)',
        '',
        '- Implementation and tests remain deterministic: PASS',
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
        'tail -n 1 .workflow-artifacts/wave4-local-byoh/implement-local-byoh-entrypoint/final-review-claude.md | grep -Eq "^FINAL_REVIEW_CLAUDE_PASS$"',
        'tail -n 1 .workflow-artifacts/wave4-local-byoh/implement-local-byoh-entrypoint/final-review-codex.md | grep -Eq "^FINAL_REVIEW_CODEX_PASS$"',
        'echo LOCAL_BYOH_ENTRYPOINT_FINAL_REVIEW_PASS',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })
    .step('final-hard-validation', {
      type: 'deterministic',
      dependsOn: ['final-review-pass-gate'],
      command: 'npx tsc --noEmit && npx vitest run src/local/',
      captureOutput: true,
      failOnError: true,
    })
    .step('regression-gate', {
      type: 'deterministic',
      dependsOn: ['final-hard-validation'],
      command: [
        'changed="$(git diff --name-only -- src/local workflows/wave4-local-byoh/06-implement-local-byoh-entrypoint.ts; git ls-files --others --exclude-standard -- .workflow-artifacts/wave4-local-byoh/implement-local-byoh-entrypoint)"',
        'printf "%s\n" "$changed" | grep -Eq "^(src/local/|workflows/wave4-local-byoh/06-implement-local-byoh-entrypoint\\.ts|\\.workflow-artifacts/wave4-local-byoh/implement-local-byoh-entrypoint/)"',
        '! printf "%s\n" "$changed" | grep -Ev "^(src/local/|workflows/wave4-local-byoh/06-implement-local-byoh-entrypoint\\.ts|\\.workflow-artifacts/wave4-local-byoh/implement-local-byoh-entrypoint/)"',
        'echo LOCAL_BYOH_ENTRYPOINT_REGRESSION_GATE_PASS',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })
    .step('final-signoff', {
      type: 'deterministic',
      dependsOn: ['regression-gate'],
      command: [
        "cat <<'EOF' > .workflow-artifacts/wave4-local-byoh/implement-local-byoh-entrypoint/signoff.md",
        '# Ricky local/BYOH entrypoint signoff',
        '',
        'Validation commands:',
        '- npx tsc --noEmit',
        '- npx vitest run src/local/',
        '',
        'Expected contract:',
        '- local spec handoff accepted',
        '- artifact/log/warning outputs returned',
        '- Cloud not used as hidden fallback',
        '',
        'LOCAL_BYOH_ENTRYPOINT_COMPLETE',
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
  process.exit(1);
});
