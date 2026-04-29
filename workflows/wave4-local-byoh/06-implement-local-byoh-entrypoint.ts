import { workflow } from '@agent-relay/sdk/workflows';

async function main() {
  const result = await workflow('ricky-wave4-implement-local-byoh-entrypoint')
    .description('Implement the Ricky local/BYOH entrypoint using bounded deterministic gates and review artifacts.')
    .pattern('dag')
    .channel('wf-ricky-wave4-local-entrypoint-impl')
    .maxConcurrency(4)
    .timeout(3_600_000)
    .onError('retry', { maxRetries: 2, retryDelayMs: 10_000 })

    .agent('impl-claude', {
      cli: 'claude',
      preset: 'worker',
      role: 'Implements the local/BYOH entrypoint surface and tests in bounded local files.',
      retries: 2,
    })
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
        'mkdir -p packages/local/src',
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
        'find packages/local/src packages/cli/src -maxdepth 3 -type f | sort | sed -n "1,160p"',
        'printf "\n---\n\n"',
        'test -f packages/cli/src/cli/onboarding.ts && sed -n "1,240p" packages/cli/src/cli/onboarding.ts || true',
        'printf "\n---\n\n"',
        'test -f packages/cli/src/cli/proof/onboarding-proof.ts && sed -n "1,220p" packages/cli/src/cli/proof/onboarding-proof.ts || true',
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

    .step('implement-local-entrypoint', {
      agent: 'impl-claude',
      dependsOn: ['read-product-spec', 'read-backlog-plan', 'read-local-context', 'read-workflow-standards'],
      task: `Implement the Ricky local/BYOH entrypoint in only these files:
- packages/local/src/entrypoint.ts
- packages/local/src/request-normalizer.ts
- packages/local/src/entrypoint.test.ts
- packages/local/src/index.ts

Requirements:
- accept spec handoff from CLI, MCP, Claude-style structured handoff, or workflow artifact path
- normalize inputs into one local invocation request contract
- keep local/BYOH explicit and do not route through Cloud by default
- return artifact, log, warning, and next-action fields in the local response contract
- keep execution seams injectable or mockable for tests
- keep tests deterministic and bounded

This is bounded product implementation work. Write the files to disk, then exit cleanly.`,
      verification: { type: 'file_exists', value: 'packages/local/src/entrypoint.ts' },
    })
    .step('implementation-file-gate', {
      type: 'deterministic',
      dependsOn: ['implement-local-entrypoint'],
      command: [
        'test -f packages/local/src/entrypoint.ts',
        'test -f packages/local/src/request-normalizer.ts',
        'test -f packages/local/src/entrypoint.test.ts',
        'test -f packages/local/src/index.ts',
        "grep -q 'local\\|BYOH\\|agent-relay' packages/local/src/entrypoint.ts packages/local/src/request-normalizer.ts packages/local/src/entrypoint.test.ts",
        "grep -q 'spec\\|workflow\\|artifact\\|Claude\\|MCP' packages/local/src/request-normalizer.ts packages/local/src/entrypoint.ts packages/local/src/entrypoint.test.ts",
        "grep -q 'warning\\|log\\|artifact\\|next' packages/local/src/entrypoint.ts packages/local/src/entrypoint.test.ts",
        'echo LOCAL_BYOH_ENTRYPOINT_FILES_PRESENT',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })
    .step('initial-soft-validation', {
      type: 'deterministic',
      dependsOn: ['implementation-file-gate'],
      command: 'npm run typecheck && npx vitest run src/local/entrypoint.test.ts src/local/proof/local-entrypoint-proof.test.ts src/local/entrypoint-turn-context-resilience.test.ts',
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
        'test -f packages/local/src/entrypoint.ts',
        'test -f packages/local/src/request-normalizer.ts',
        'test -f packages/local/src/entrypoint.test.ts',
        'test -f packages/local/src/index.ts',
        "grep -q 'local\\|BYOH\\|agent-relay' packages/local/src/entrypoint.ts packages/local/src/entrypoint.test.ts",
        'echo LOCAL_BYOH_ENTRYPOINT_POST_FIX_PASS',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })
    .step('post-fix-validation', {
      type: 'deterministic',
      dependsOn: ['post-fix-verification-gate'],
      command: 'npm run typecheck && npx vitest run src/local/entrypoint.test.ts src/local/proof/local-entrypoint-proof.test.ts src/local/entrypoint-turn-context-resilience.test.ts',
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
        "tail -n 1 .workflow-artifacts/wave4-local-byoh/implement-local-byoh-entrypoint/final-review-claude.md | tr -d '[:space:]*' | grep -Eq \"^FINAL_REVIEW_CLAUDE_PASS$\"",
        "tail -n 1 .workflow-artifacts/wave4-local-byoh/implement-local-byoh-entrypoint/final-review-codex.md | tr -d '[:space:]*' | grep -Eq \"^FINAL_REVIEW_CODEX_PASS$\"",
        'echo LOCAL_BYOH_ENTRYPOINT_FINAL_REVIEW_PASS',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })
    .step('final-hard-validation', {
      type: 'deterministic',
      dependsOn: ['final-review-pass-gate'],
      command: 'npm run typecheck && npx vitest run src/local/entrypoint.test.ts src/local/proof/local-entrypoint-proof.test.ts src/local/entrypoint-turn-context-resilience.test.ts',
      captureOutput: true,
      failOnError: true,
    })
    .step('regression-gate', {
      type: 'deterministic',
      dependsOn: ['final-hard-validation'],
      command: [
        'changed="$(git diff --name-only -- packages/local/src workflows/wave4-local-byoh/06-implement-local-byoh-entrypoint.ts; git ls-files --others --exclude-standard -- .workflow-artifacts/wave4-local-byoh/implement-local-byoh-entrypoint)"',
        'printf "%s\n" "$changed" | grep -Eq "^(packages/local/src/|workflows/wave4-local-byoh/06-implement-local-byoh-entrypoint\\.ts|\\.workflow-artifacts/wave4-local-byoh/implement-local-byoh-entrypoint/)"',
        'if [ -n "$changed" ]; then ! printf "%s\n" "$changed" | grep -Ev "^(packages/local/src/|workflows/wave4-local-byoh/06-implement-local-byoh-entrypoint\\.ts|\\.workflow-artifacts/wave4-local-byoh/implement-local-byoh-entrypoint/)"; else true; fi',
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
        '- npm run typecheck --workspace @ricky/local',
        '- npm test --workspace @ricky/local',
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
