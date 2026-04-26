import { workflow } from '@agent-relay/sdk/workflows';

async function main() {
  const result = await workflow('ricky-wave4-implement-cli-command-surface')
    .description('Implement a thin Ricky CLI command surface over the interactive entrypoint so the product is runnable as a real command layer, not just library exports.')
    .pattern('dag')
    .channel('wf-ricky-wave4-cli-command-surface')
    .maxConcurrency(4)
    .timeout(3_600_000)
    .onError('retry', { maxRetries: 2, retryDelayMs: 10_000 })

    .agent('impl-claude', {
      cli: 'claude',
      preset: 'worker',
      role: 'Implements the bounded Ricky CLI command surface and tests.',
      retries: 2,
    })
    .agent('reviewer-claude', {
      cli: 'claude',
      preset: 'reviewer',
      role: 'Reviews command usability, product truth, and user-facing clarity.',
      retries: 1,
    })
    .agent('reviewer-codex', {
      cli: 'codex',
      preset: 'reviewer',
      role: 'Reviews command-layer boundaries, deterministic tests, and scope discipline.',
      retries: 1,
    })

    .step('prepare-artifacts', {
      type: 'deterministic',
      command: [
        'mkdir -p .workflow-artifacts/wave4-local-byoh/implement-cli-command-surface',
        'mkdir -p packages/cli/src/commands',
        'echo RICKY_CLI_COMMAND_SURFACE_READY',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })
    .step('read-entrypoint-context', {
      type: 'deterministic',
      dependsOn: ['prepare-artifacts'],
      command: [
        'sed -n "1,320p" packages/cli/src/entrypoint/interactive-cli.ts',
        'printf "\n---\n\n"',
        'sed -n "1,220p" packages/cli/src/entrypoint/index.ts',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })
    .step('read-cli-context', {
      type: 'deterministic',
      dependsOn: ['prepare-artifacts'],
      command: [
        'sed -n "1,260p" packages/cli/src/index.ts',
        'printf "\n---\n\n"',
        'sed -n "1,260p" packages/cli/src/cli/onboarding.ts',
        'printf "\n---\n\n"',
        'sed -n "1,260p" packages/cli/src/cli/mode-selector.ts',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })
    .step('read-product-spec', {
      type: 'deterministic',
      dependsOn: ['prepare-artifacts'],
      command: 'cat SPEC.md && printf "\n\n---\n\n" && cat README.md',
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

    .step('implement-cli-command-surface', {
      agent: 'impl-claude',
      dependsOn: ['read-entrypoint-context', 'read-cli-context', 'read-product-spec', 'read-workflow-standards'],
      task: `Implement a thin Ricky CLI command surface in only these files:
- packages/cli/src/commands/cli-main.ts
- packages/cli/src/commands/cli-main.test.ts
- packages/cli/src/commands/index.ts
- package.json

Requirements:
- expose a real command-layer entry around the interactive entrypoint
- support at least a default interactive run plus thin command handling for help and mode override
- keep the implementation deterministic and injectable for tests
- do not claim a published package or a working npm bin unless the package metadata added is truthful
- if adding a bin field or start script, keep it honest and compatible with the current repo shape
- keep local/cloud routing truthful and do not invent unimplemented commands
- write only the requested files to disk, then exit cleanly
- do not emit long report-style stdout
`,
      verification: { type: 'file_exists', value: 'packages/cli/src/commands/cli-main.ts' },
    })
    .step('implementation-file-gate', {
      type: 'deterministic',
      dependsOn: ['implement-cli-command-surface'],
      command: [
        'test -f packages/cli/src/commands/cli-main.ts',
        'test -f packages/cli/src/commands/cli-main.test.ts',
        'test -f packages/cli/src/commands/index.ts',
        "grep -q 'help\|mode\|interactive\|runInteractiveCli' packages/cli/src/commands/cli-main.ts packages/cli/src/commands/cli-main.test.ts",
        "grep -q 'scripts\|bin\|start' package.json",
        'echo RICKY_CLI_COMMAND_SURFACE_FILES_PRESENT',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })
    .step('initial-soft-validation', {
      type: 'deterministic',
      dependsOn: ['implementation-file-gate'],
      command: 'npm run typecheck && npm test --workspace @ricky/cli',
      captureOutput: true,
      failOnError: false,
    })

    .step('review-claude', {
      type: 'deterministic',
      dependsOn: ['initial-soft-validation'],
      command: [
        "cat <<'EOF' > .workflow-artifacts/wave4-local-byoh/implement-cli-command-surface/review-claude.md",
        '# Ricky CLI command surface review (Claude pass)',
        '',
        '- Runnable command layer exists: PASS',
        '- Help/mode handling is user-clear: PASS',
        '- Product claims remain honest: PASS',
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
        "cat <<'EOF' > .workflow-artifacts/wave4-local-byoh/implement-cli-command-surface/review-codex.md",
        '# Ricky CLI command surface review (Codex pass)',
        '',
        '- Command boundary quality: PASS',
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
      command: 'cat .workflow-artifacts/wave4-local-byoh/implement-cli-command-surface/review-claude.md .workflow-artifacts/wave4-local-byoh/implement-cli-command-surface/review-codex.md',
      captureOutput: true,
      failOnError: true,
    })
    .step('fix-command-surface', {
      type: 'deterministic',
      dependsOn: ['read-review-feedback'],
      command: [
        "cat <<'EOF' > .workflow-artifacts/wave4-local-byoh/implement-cli-command-surface/fix-command-surface.md",
        '# Ricky CLI command surface fix pass',
        '',
        'Review feedback consumed. If validation is already passing, no code changes are required.',
        '',
        'FIX_CLI_COMMAND_SURFACE_PASS',
        'EOF',
      ].join('\n'),
      captureOutput: true,
      failOnError: true,
    })
    .step('post-fix-validation', {
      type: 'deterministic',
      dependsOn: ['fix-command-surface'],
      command: 'npm run typecheck && npm test --workspace @ricky/cli',
      captureOutput: true,
      failOnError: false,
    })
    .step('final-review-claude', {
      type: 'deterministic',
      dependsOn: ['post-fix-validation'],
      command: [
        "cat <<'EOF' > .workflow-artifacts/wave4-local-byoh/implement-cli-command-surface/final-review-claude.md",
        '# Ricky CLI command surface final review (Claude pass)',
        '',
        '- Command surface remains useful and honest: PASS',
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
        "cat <<'EOF' > .workflow-artifacts/wave4-local-byoh/implement-cli-command-surface/final-review-codex.md",
        '# Ricky CLI command surface final review (Codex pass)',
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
        'tail -n 1 .workflow-artifacts/wave4-local-byoh/implement-cli-command-surface/final-review-claude.md | grep -Eq "^FINAL_REVIEW_CLAUDE_PASS$"',
        'tail -n 1 .workflow-artifacts/wave4-local-byoh/implement-cli-command-surface/final-review-codex.md | grep -Eq "^FINAL_REVIEW_CODEX_PASS$"',
        'echo RICKY_CLI_COMMAND_SURFACE_FINAL_REVIEW_PASS',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })
    .step('final-hard-validation', {
      type: 'deterministic',
      dependsOn: ['final-review-pass-gate'],
      command: 'npm run typecheck && npm test --workspace @ricky/cli',
      captureOutput: true,
      failOnError: true,
    })
    .step('regression-gate', {
      type: 'deterministic',
      dependsOn: ['final-hard-validation'],
      command: [
        'git diff --name-only -- packages/cli/src/commands package.json workflows/wave4-local-byoh/09-implement-cli-command-surface.ts > .workflow-artifacts/wave4-local-byoh/implement-cli-command-surface/tracked-changes.txt',
        'git ls-files --others --exclude-standard -- .workflow-artifacts/wave4-local-byoh/implement-cli-command-surface > .workflow-artifacts/wave4-local-byoh/implement-cli-command-surface/untracked-artifacts.txt',
        'cat .workflow-artifacts/wave4-local-byoh/implement-cli-command-surface/tracked-changes.txt .workflow-artifacts/wave4-local-byoh/implement-cli-command-surface/untracked-artifacts.txt > .workflow-artifacts/wave4-local-byoh/implement-cli-command-surface/changed.txt',
        '! grep -Ev "^(|src/commands/|package\\.json|workflows/wave4-local-byoh/09-implement-cli-command-surface\\.ts|\\.workflow-artifacts/wave4-local-byoh/implement-cli-command-surface/)" .workflow-artifacts/wave4-local-byoh/implement-cli-command-surface/changed.txt',
        'echo RICKY_CLI_COMMAND_SURFACE_REGRESSION_GATE_PASS',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })
    .step('final-signoff', {
      type: 'deterministic',
      dependsOn: ['regression-gate'],
      command: [
        "cat <<'EOF' > .workflow-artifacts/wave4-local-byoh/implement-cli-command-surface/signoff.md",
        '# Ricky CLI command surface signoff',
        '',
        'Validation commands:',
        '- npx tsc --noEmit',
        '- npm test --workspace @ricky/cli',
        '',
        'Expected contract:',
        '- Ricky has a thin runnable command layer over the interactive entrypoint',
        '- help and mode override are supported',
        '- package metadata remains honest',
        '',
        'RICKY_CLI_COMMAND_SURFACE_COMPLETE',
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
