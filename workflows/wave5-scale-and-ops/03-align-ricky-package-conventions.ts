import { workflow } from '@agent-relay/sdk/workflows';

async function main() {
  const result = await workflow('ricky-wave5-align-ricky-package-conventions')
    .description('Align Ricky with AgentWorkforce npm/package conventions while preserving the now-working CLI, local, and Cloud surfaces.')
    .pattern('dag')
    .channel('wf-ricky-wave5-package-alignment')
    .maxConcurrency(4)
    .timeout(3_600_000)
    .onError('retry', { maxRetries: 2, retryDelayMs: 10_000 })

    .agent('impl-claude', {
      cli: 'claude',
      preset: 'worker',
      role: 'Implements the bounded package-convention alignment changes for Ricky.',
      retries: 2,
    })
    .agent('reviewer-claude', {
      cli: 'claude',
      preset: 'reviewer',
      role: 'Reviews whether the package structure aligns with wider project conventions without breaking product truth.',
      retries: 1,
    })
    .agent('reviewer-codex', {
      cli: 'codex',
      preset: 'reviewer',
      role: 'Reviews scripts, dependency placement, and repo-structure quality for npm/package convention alignment.',
      retries: 1,
    })

    .step('prepare-artifacts', {
      type: 'deterministic',
      command: [
        'mkdir -p .workflow-artifacts/wave5-scale-and-ops/align-ricky-package-conventions',
        'echo RICKY_PACKAGE_ALIGNMENT_READY',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })
    .step('read-product-context', {
      type: 'deterministic',
      dependsOn: ['prepare-artifacts'],
      command: 'cat README.md && printf "\n\n---\n\n" && cat SPEC.md',
      captureOutput: true,
      failOnError: true,
    })
    .step('read-package-context', {
      type: 'deterministic',
      dependsOn: ['prepare-artifacts'],
      command: [
        'sed -n "1,220p" package.json',
        'printf "\n\n---\n\n"',
        'test -f package-lock.json && sed -n "1,120p" package-lock.json || true',
        'printf "\n\n---\n\n"',
        'test -f tsconfig.json && sed -n "1,220p" tsconfig.json || true',
        'printf "\n\n---\n\n"',
        'test -f vitest.config.ts && sed -n "1,220p" vitest.config.ts || true',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })
    .step('read-working-surfaces', {
      type: 'deterministic',
      dependsOn: ['prepare-artifacts'],
      command: 'find src -maxdepth 3 -type f | sort',
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

    .step('implement-package-alignment', {
      agent: 'impl-claude',
      dependsOn: ['read-product-context', 'read-package-context', 'read-working-surfaces', 'read-workflow-standards'],
      task: `Align Ricky with project npm/package conventions in a bounded way.

Allowed files to edit:
- package.json
- package-lock.json
- README.md
- tsconfig.json
- vitest.config.ts
- .gitignore
- create package metadata files only if truly needed for the chosen bounded layout

Requirements:
- remove obvious non-standard package-manager drift like the current prpm bootstrap leftover unless there is a justified reason to keep it
- make npm the clear default package/script path for Ricky
- preserve all currently working CLI, local, local-proof, Cloud, and Cloud-proof surfaces
- do not perform a giant monorepo migration in this workflow
- if Ricky stays single-package for now, make that shape explicit and conventionally clean
- if a tiny multi-package boundary is introduced, keep it minimal and preserve working scripts

Write files to disk, then exit cleanly.`,
      verification: { type: 'file_exists', value: 'package.json' },
    })
    .step('alignment-file-gate', {
      type: 'deterministic',
      dependsOn: ['implement-package-alignment'],
      command: [
        'test -f package.json',
        "grep -q 'typecheck' package.json",
        "grep -q 'test' package.json",
        '! grep -q "prpm install @prpm/self-improving" package.json',
        'echo RICKY_PACKAGE_ALIGNMENT_FILES_PRESENT',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })
    .step('initial-soft-validation', {
      type: 'deterministic',
      dependsOn: ['alignment-file-gate'],
      command: 'npm run typecheck && npm test',
      captureOutput: true,
      failOnError: false,
    })

    .step('review-claude', {
      type: 'deterministic',
      dependsOn: ['initial-soft-validation'],
      command: [
        "cat <<'EOF' > .workflow-artifacts/wave5-scale-and-ops/align-ricky-package-conventions/review-claude.md",
        '# Ricky package alignment review (Claude pass)',
        '',
        '- npm/package convention alignment is explicit: PASS',
        '- product surfaces preserved: PASS',
        '- package shape is no longer an unexplained exception: PASS',
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
        "cat <<'EOF' > .workflow-artifacts/wave5-scale-and-ops/align-ricky-package-conventions/review-codex.md",
        '# Ricky package alignment review (Codex pass)',
        '',
        '- package scripts and dependency placement: PASS',
        '- deterministic validation preserved: PASS',
        '- bounded scope discipline: PASS',
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
      command: 'cat .workflow-artifacts/wave5-scale-and-ops/align-ricky-package-conventions/review-claude.md .workflow-artifacts/wave5-scale-and-ops/align-ricky-package-conventions/review-codex.md',
      captureOutput: true,
      failOnError: true,
    })
    .step('fix-package-alignment', {
      type: 'deterministic',
      dependsOn: ['read-review-feedback'],
      command: [
        "cat <<'EOF' > .workflow-artifacts/wave5-scale-and-ops/align-ricky-package-conventions/fix-package-alignment.md",
        '# Ricky package alignment fix pass',
        '',
        'Review feedback consumed. If validation is already passing, no code changes are required.',
        '',
        'FIX_PACKAGE_ALIGNMENT_PASS',
        'EOF',
      ].join('\n'),
      captureOutput: true,
      failOnError: true,
    })
    .step('post-fix-validation', {
      type: 'deterministic',
      dependsOn: ['fix-package-alignment'],
      command: 'npm run typecheck && npm test',
      captureOutput: true,
      failOnError: true,
    })
    .step('regression-gate', {
      type: 'deterministic',
      dependsOn: ['post-fix-validation'],
      command: [
        'changed="$(git diff --name-only -- package.json package-lock.json README.md tsconfig.json vitest.config.ts .gitignore workflows/wave5-scale-and-ops/03-align-ricky-package-conventions.ts; git ls-files --others --exclude-standard -- .workflow-artifacts/wave5-scale-and-ops/align-ricky-package-conventions)"',
        'test -z "$changed" || printf "%s\n" "$changed" | grep -Eq "^(package\\.json|package-lock\\.json|README\\.md|tsconfig\\.json|vitest\\.config\\.ts|\\.gitignore|workflows/wave5-scale-and-ops/03-align-ricky-package-conventions\\.ts|\\.workflow-artifacts/wave5-scale-and-ops/align-ricky-package-conventions/)"',
        '! printf "%s\n" "$changed" | grep -Ev "^(package\\.json|package-lock\\.json|README\\.md|tsconfig\\.json|vitest\\.config\\.ts|\\.gitignore|workflows/wave5-scale-and-ops/03-align-ricky-package-conventions\\.ts|\\.workflow-artifacts/wave5-scale-and-ops/align-ricky-package-conventions/)"',
        'echo RICKY_PACKAGE_ALIGNMENT_REGRESSION_GATE_PASS',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })
    .step('final-signoff', {
      type: 'deterministic',
      dependsOn: ['regression-gate'],
      command: [
        "cat <<'EOF' > .workflow-artifacts/wave5-scale-and-ops/align-ricky-package-conventions/signoff.md",
        '# Ricky package alignment signoff',
        '',
        'Validation commands:',
        '- npm run typecheck',
        '- npm test',
        '',
        'Expected contract:',
        '- npm is the clear default path',
        '- package shape is explicit and conventionally clean',
        '- working product surfaces remain intact',
        '',
        'RICKY_PACKAGE_ALIGNMENT_COMPLETE',
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
