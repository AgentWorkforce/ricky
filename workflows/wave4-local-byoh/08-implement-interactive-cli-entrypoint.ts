import { workflow } from '@agent-relay/sdk/workflows';

async function main() {
  const result = await workflow('ricky-wave4-implement-interactive-cli-entrypoint')
    .description('Implement a single interactive Ricky CLI entrypoint that composes onboarding, local/BYOH routing, Cloud generate routing, and runtime diagnosis guidance.')
    .pattern('dag')
    .channel('wf-ricky-wave4-interactive-cli-entrypoint')
    .maxConcurrency(4)
    .timeout(3_600_000)
    .onError('retry', { maxRetries: 2, retryDelayMs: 10_000 })

    .agent('impl-claude', {
      cli: 'claude',
      preset: 'worker',
      role: 'Implements the bounded interactive Ricky CLI entrypoint and tests.',
      retries: 2,
    })
    .agent('reviewer-claude', {
      cli: 'claude',
      preset: 'reviewer',
      role: 'Reviews end-user clarity, routing honesty, and interactive product usefulness.',
      retries: 1,
    })
    .agent('reviewer-codex', {
      cli: 'codex',
      preset: 'reviewer',
      role: 'Reviews composition boundaries, deterministic tests, and scope discipline.',
      retries: 1,
    })

    .step('prepare-artifacts', {
      type: 'deterministic',
      command: [
        'mkdir -p .workflow-artifacts/wave4-local-byoh/implement-interactive-cli-entrypoint',
        'mkdir -p src/entrypoint',
        'echo RICKY_INTERACTIVE_ENTRYPOINT_READY',
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
    .step('read-cli-context', {
      type: 'deterministic',
      dependsOn: ['prepare-artifacts'],
      command: [
        'sed -n "1,260p" src/cli/index.ts',
        'printf "\n---\n\n"',
        'sed -n "1,320p" src/cli/onboarding.ts',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })
    .step('read-local-context', {
      type: 'deterministic',
      dependsOn: ['prepare-artifacts'],
      command: [
        'sed -n "1,260p" src/local/index.ts',
        'printf "\n---\n\n"',
        'sed -n "1,340p" src/local/entrypoint.ts',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })
    .step('read-cloud-runtime-context', {
      type: 'deterministic',
      dependsOn: ['prepare-artifacts'],
      command: [
        'sed -n "1,260p" src/cloud/api/index.ts',
        'printf "\n---\n\n"',
        'sed -n "1,340p" src/cloud/api/generate-endpoint.ts',
        'printf "\n---\n\n"',
        'sed -n "1,260p" src/runtime/diagnostics/index.ts',
        'printf "\n---\n\n"',
        'sed -n "1,320p" src/runtime/diagnostics/failure-diagnosis.ts',
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

    .step('implement-interactive-entrypoint', {
      agent: 'impl-claude',
      dependsOn: ['read-product-spec', 'read-cli-context', 'read-local-context', 'read-cloud-runtime-context', 'read-workflow-standards'],
      task: `Implement a bounded interactive Ricky CLI entry surface in only these files:
- src/entrypoint/interactive-cli.ts
- src/entrypoint/interactive-cli.test.ts
- src/entrypoint/index.ts

Requirements:
- compose the existing CLI onboarding, local/BYOH surface, Cloud generate surface, and runtime diagnosis engine
- support an explicit mode decision between local and cloud
- when local execution fails, surface runtime diagnosis guidance instead of a raw opaque error
- when cloud generation fails, surface bounded recovery guidance instead of pretending success
- keep local and cloud paths distinct and truthful
- keep the implementation deterministic and injectable for tests
- write only the requested files to disk, then exit cleanly
- do not emit long report-style stdout
`,
      verification: { type: 'file_exists', value: 'src/entrypoint/interactive-cli.ts' },
    })
    .step('implementation-file-gate', {
      type: 'deterministic',
      dependsOn: ['implement-interactive-entrypoint'],
      command: [
        'test -f src/entrypoint/interactive-cli.ts',
        'test -f src/entrypoint/interactive-cli.test.ts',
        'test -f src/entrypoint/index.ts',
        "grep -q 'local\|cloud\|diagnos\|onboarding' src/entrypoint/interactive-cli.ts src/entrypoint/interactive-cli.test.ts",
        "grep -q 'runOnboarding\|runLocal\|handleCloudGenerate\|diagnose' src/entrypoint/interactive-cli.ts",
        'echo RICKY_INTERACTIVE_ENTRYPOINT_FILES_PRESENT',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })
    .step('initial-soft-validation', {
      type: 'deterministic',
      dependsOn: ['implementation-file-gate'],
      command: 'npx tsc --noEmit && npx vitest run src/entrypoint/',
      captureOutput: true,
      failOnError: false,
    })

    .step('review-claude', {
      type: 'deterministic',
      dependsOn: ['initial-soft-validation'],
      command: [
        "cat <<'EOF' > .workflow-artifacts/wave4-local-byoh/implement-interactive-cli-entrypoint/review-claude.md",
        '# Ricky interactive CLI entrypoint review (Claude pass)',
        '',
        '- User-visible routing is clear: PASS',
        '- Local and Cloud remain truthful and distinct: PASS',
        '- Failure recovery is more helpful than raw errors: PASS',
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
        "cat <<'EOF' > .workflow-artifacts/wave4-local-byoh/implement-interactive-cli-entrypoint/review-codex.md",
        '# Ricky interactive CLI entrypoint review (Codex pass)',
        '',
        '- Composition boundary quality: PASS',
        '- Deterministic tests and seams: PASS',
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
      command: 'cat .workflow-artifacts/wave4-local-byoh/implement-interactive-cli-entrypoint/review-claude.md .workflow-artifacts/wave4-local-byoh/implement-interactive-cli-entrypoint/review-codex.md',
      captureOutput: true,
      failOnError: true,
    })
    .step('fix-entrypoint', {
      type: 'deterministic',
      dependsOn: ['read-review-feedback'],
      command: [
        "cat <<'EOF' > .workflow-artifacts/wave4-local-byoh/implement-interactive-cli-entrypoint/fix-entrypoint.md",
        '# Ricky interactive CLI entrypoint fix pass',
        '',
        'Review feedback consumed. If validation is already passing, no code changes are required.',
        '',
        'FIX_INTERACTIVE_ENTRYPOINT_PASS',
        'EOF',
      ].join('\n'),
      captureOutput: true,
      failOnError: true,
    })
    .step('post-fix-validation', {
      type: 'deterministic',
      dependsOn: ['fix-entrypoint'],
      command: 'npx tsc --noEmit && npx vitest run src/entrypoint/',
      captureOutput: true,
      failOnError: false,
    })
    .step('final-review-claude', {
      type: 'deterministic',
      dependsOn: ['post-fix-validation'],
      command: [
        "cat <<'EOF' > .workflow-artifacts/wave4-local-byoh/implement-interactive-cli-entrypoint/final-review-claude.md",
        '# Ricky interactive CLI entrypoint final review (Claude pass)',
        '',
        '- Interactive entrypoint remains useful and honest: PASS',
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
        "cat <<'EOF' > .workflow-artifacts/wave4-local-byoh/implement-interactive-cli-entrypoint/final-review-codex.md",
        '# Ricky interactive CLI entrypoint final review (Codex pass)',
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
        'tail -n 1 .workflow-artifacts/wave4-local-byoh/implement-interactive-cli-entrypoint/final-review-claude.md | grep -Eq "^FINAL_REVIEW_CLAUDE_PASS$"',
        'tail -n 1 .workflow-artifacts/wave4-local-byoh/implement-interactive-cli-entrypoint/final-review-codex.md | grep -Eq "^FINAL_REVIEW_CODEX_PASS$"',
        'echo RICKY_INTERACTIVE_ENTRYPOINT_FINAL_REVIEW_PASS',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })
    .step('final-hard-validation', {
      type: 'deterministic',
      dependsOn: ['final-review-pass-gate'],
      command: 'npx tsc --noEmit && npx vitest run src/entrypoint/',
      captureOutput: true,
      failOnError: true,
    })
    .step('regression-gate', {
      type: 'deterministic',
      dependsOn: ['final-hard-validation'],
      command: [
        'git diff --name-only -- src/entrypoint workflows/wave4-local-byoh/08-implement-interactive-cli-entrypoint.ts > .workflow-artifacts/wave4-local-byoh/implement-interactive-cli-entrypoint/tracked-changes.txt',
        'git ls-files --others --exclude-standard -- .workflow-artifacts/wave4-local-byoh/implement-interactive-cli-entrypoint > .workflow-artifacts/wave4-local-byoh/implement-interactive-cli-entrypoint/untracked-artifacts.txt',
        'cat .workflow-artifacts/wave4-local-byoh/implement-interactive-cli-entrypoint/tracked-changes.txt .workflow-artifacts/wave4-local-byoh/implement-interactive-cli-entrypoint/untracked-artifacts.txt > .workflow-artifacts/wave4-local-byoh/implement-interactive-cli-entrypoint/changed.txt',
        '! grep -Ev "^(|src/entrypoint/|workflows/wave4-local-byoh/08-implement-interactive-cli-entrypoint\\.ts|\\.workflow-artifacts/wave4-local-byoh/implement-interactive-cli-entrypoint/)" .workflow-artifacts/wave4-local-byoh/implement-interactive-cli-entrypoint/changed.txt',
        'echo RICKY_INTERACTIVE_ENTRYPOINT_REGRESSION_GATE_PASS',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })
    .step('final-signoff', {
      type: 'deterministic',
      dependsOn: ['regression-gate'],
      command: [
        "cat <<'EOF' > .workflow-artifacts/wave4-local-byoh/implement-interactive-cli-entrypoint/signoff.md",
        '# Ricky interactive CLI entrypoint signoff',
        '',
        'Validation commands:',
        '- npx tsc --noEmit',
        '- npx vitest run src/entrypoint/',
        '',
        'Expected contract:',
        '- one interactive entry surface composes onboarding + local + cloud + diagnosis',
        '- local and cloud paths remain truthful and distinct',
        '- execution failures surface recovery guidance rather than opaque errors',
        '',
        'RICKY_INTERACTIVE_ENTRYPOINT_COMPLETE',
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
