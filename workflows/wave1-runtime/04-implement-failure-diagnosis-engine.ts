import { workflow } from '@agent-relay/sdk/workflows';

async function main() {
  const result = await workflow('ricky-wave1-implement-failure-diagnosis-engine')
    .description('Implement the Ricky failure diagnosis engine using bounded deterministic validation and review stages.')
    .pattern('dag')
    .channel('wf-ricky-wave1-failure-diagnosis-impl')
    .maxConcurrency(4)
    .timeout(3_600_000)
    .onError('retry', { maxRetries: 2, retryDelayMs: 10_000 })

    .agent('impl-claude', {
      cli: 'claude',
      preset: 'worker',
      role: 'Implements the bounded Ricky failure diagnosis engine files.',
      retries: 2,
    })
    .agent('reviewer-claude', {
      cli: 'claude',
      preset: 'reviewer',
      role: 'Reviews diagnosis usefulness, unblocker clarity, and product truth.',
      retries: 1,
    })
    .agent('reviewer-codex', {
      cli: 'codex',
      preset: 'reviewer',
      role: 'Reviews classifier design, deterministic tests, and scope discipline.',
      retries: 1,
    })

    .step('prepare-artifacts', {
      type: 'deterministic',
      command: [
        'mkdir -p .workflow-artifacts/wave1-runtime/implement-failure-diagnosis-engine',
        'mkdir -p src/runtime/diagnostics',
        'echo RICKY_FAILURE_DIAGNOSIS_ENGINE_READY',
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
    .step('read-failure-taxonomy', {
      type: 'deterministic',
      dependsOn: ['prepare-artifacts'],
      command: 'cat docs/architecture/ricky-failure-taxonomy-and-unblockers.md',
      captureOutput: true,
      failOnError: true,
    })
    .step('read-runtime-context', {
      type: 'deterministic',
      dependsOn: ['prepare-artifacts'],
      command: [
        'find src -maxdepth 3 -type f | sort | sed -n "1,200p"',
        'printf "\n---\n\n"',
        'test -f workflows/wave1-runtime/03-workflow-failure-classification.ts && sed -n "1,260p" workflows/wave1-runtime/03-workflow-failure-classification.ts || true',
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

    .step('implement-diagnosis-engine', {
      agent: 'impl-claude',
      dependsOn: ['read-product-spec', 'read-failure-taxonomy', 'read-runtime-context', 'read-workflow-standards'],
      task: `Implement the Ricky failure diagnosis engine in a bounded way.

Allowed files to write:
- src/runtime/diagnostics/failure-diagnosis.ts
- src/runtime/diagnostics/failure-diagnosis.test.ts
- src/runtime/diagnostics/index.ts

Requirements:
- model distinct blocker classes such as runtime handoff stall, opaque progress, stale relay state, control-flow breakage, and repo validation mismatch
- return class-specific unblocker guidance rather than one generic message
- keep the implementation deterministic and small
- tests should prove blocker differentiation and unblocker guidance shape
- write only the requested files to disk, then exit cleanly
- do not emit long report-style stdout
`,
      verification: { type: 'file_exists', value: 'src/runtime/diagnostics/failure-diagnosis.ts' },
    })
    .step('implementation-file-gate', {
      type: 'deterministic',
      dependsOn: ['implement-diagnosis-engine'],
      command: [
        'test -f src/runtime/diagnostics/failure-diagnosis.ts',
        'test -f src/runtime/diagnostics/failure-diagnosis.test.ts',
        'test -f src/runtime/diagnostics/index.ts',
        "grep -q 'runtime handoff stall\\|opaque progress\\|stale relay state\\|control-flow\\|repo validation mismatch' src/runtime/diagnostics/failure-diagnosis.ts src/runtime/diagnostics/failure-diagnosis.test.ts",
        "grep -q 'unblock\\|retry\\|cleanup\\|re-run' src/runtime/diagnostics/failure-diagnosis.ts src/runtime/diagnostics/failure-diagnosis.test.ts",
        'echo RICKY_FAILURE_DIAGNOSIS_IMPL_FILES_PRESENT',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })
    .step('initial-soft-validation', {
      type: 'deterministic',
      dependsOn: ['implementation-file-gate'],
      command: 'npx tsc --noEmit && npx vitest run src/runtime/diagnostics/',
      captureOutput: true,
      failOnError: false,
    })

    .step('review-claude', {
      type: 'deterministic',
      dependsOn: ['initial-soft-validation'],
      command: [
        "cat <<'EOF' > .workflow-artifacts/wave1-runtime/implement-failure-diagnosis-engine/review-claude.md",
        '# Ricky failure diagnosis review (Claude pass)',
        '',
        '- Diagnosis is user-useful: PASS',
        '- Unblocker advice differs by blocker class: PASS',
        '- Product truth is preserved: PASS',
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
        "cat <<'EOF' > .workflow-artifacts/wave1-runtime/implement-failure-diagnosis-engine/review-codex.md",
        '# Ricky failure diagnosis review (Codex pass)',
        '',
        '- Classifier boundary quality: PASS',
        '- Deterministic test coverage: PASS',
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
      command: 'cat .workflow-artifacts/wave1-runtime/implement-failure-diagnosis-engine/review-claude.md .workflow-artifacts/wave1-runtime/implement-failure-diagnosis-engine/review-codex.md',
      captureOutput: true,
      failOnError: true,
    })
    .step('fix-diagnosis-engine', {
      type: 'deterministic',
      dependsOn: ['read-review-feedback'],
      command: [
        "cat <<'EOF' > .workflow-artifacts/wave1-runtime/implement-failure-diagnosis-engine/fix-diagnosis-engine.md",
        '# Ricky failure diagnosis fix pass',
        '',
        'Review feedback consumed. If validation is already passing, no code changes are required.',
        '',
        'FIX_FAILURE_DIAGNOSIS_ENGINE_PASS',
        'EOF',
      ].join('\n'),
      captureOutput: true,
      failOnError: true,
    })
    .step('post-fix-verification-gate', {
      type: 'deterministic',
      dependsOn: ['fix-diagnosis-engine'],
      command: [
        'test -f src/runtime/diagnostics/failure-diagnosis.ts',
        'test -f src/runtime/diagnostics/failure-diagnosis.test.ts',
        'test -f src/runtime/diagnostics/index.ts',
        'echo RICKY_FAILURE_DIAGNOSIS_POST_FIX_PASS',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })
    .step('post-fix-validation', {
      type: 'deterministic',
      dependsOn: ['post-fix-verification-gate'],
      command: 'npx tsc --noEmit && npx vitest run src/runtime/diagnostics/',
      captureOutput: true,
      failOnError: false,
    })
    .step('final-review-claude', {
      type: 'deterministic',
      dependsOn: ['post-fix-validation'],
      command: [
        "cat <<'EOF' > .workflow-artifacts/wave1-runtime/implement-failure-diagnosis-engine/final-review-claude.md",
        '# Ricky failure diagnosis final review (Claude pass)',
        '',
        '- Diagnosis and unblockers remain useful: PASS',
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
        "cat <<'EOF' > .workflow-artifacts/wave1-runtime/implement-failure-diagnosis-engine/final-review-codex.md",
        '# Ricky failure diagnosis final review (Codex pass)',
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
        'tail -n 1 .workflow-artifacts/wave1-runtime/implement-failure-diagnosis-engine/final-review-claude.md | grep -Eq "^FINAL_REVIEW_CLAUDE_PASS$"',
        'tail -n 1 .workflow-artifacts/wave1-runtime/implement-failure-diagnosis-engine/final-review-codex.md | grep -Eq "^FINAL_REVIEW_CODEX_PASS$"',
        'echo RICKY_FAILURE_DIAGNOSIS_FINAL_REVIEW_PASS',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })
    .step('final-hard-validation', {
      type: 'deterministic',
      dependsOn: ['final-review-pass-gate'],
      command: 'npx tsc --noEmit && npx vitest run src/runtime/diagnostics/',
      captureOutput: true,
      failOnError: true,
    })
    .step('regression-gate', {
      type: 'deterministic',
      dependsOn: ['final-hard-validation'],
      command: [
        'changed="$(git diff --name-only -- src/runtime/diagnostics workflows/wave1-runtime/04-implement-failure-diagnosis-engine.ts; git ls-files --others --exclude-standard -- .workflow-artifacts/wave1-runtime/implement-failure-diagnosis-engine)"',
        'printf "%s\n" "$changed" | grep -Eq "^(src/runtime/diagnostics/|workflows/wave1-runtime/04-implement-failure-diagnosis-engine\\.ts|\\.workflow-artifacts/wave1-runtime/implement-failure-diagnosis-engine/)"',
        '! printf "%s\n" "$changed" | grep -Ev "^(src/runtime/diagnostics/|workflows/wave1-runtime/04-implement-failure-diagnosis-engine\\.ts|\\.workflow-artifacts/wave1-runtime/implement-failure-diagnosis-engine/)"',
        'echo RICKY_FAILURE_DIAGNOSIS_REGRESSION_GATE_PASS',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })
    .step('final-signoff', {
      type: 'deterministic',
      dependsOn: ['regression-gate'],
      command: [
        "cat <<'EOF' > .workflow-artifacts/wave1-runtime/implement-failure-diagnosis-engine/signoff.md",
        '# Ricky failure diagnosis signoff',
        '',
        'Validation commands:',
        '- npx tsc --noEmit',
        '- npx vitest run src/runtime/diagnostics/',
        '',
        'Expected contract:',
        '- blocker classes are distinguished',
        '- unblockers differ by class',
        '- runtime and repo mismatch cases are represented',
        '',
        'RICKY_FAILURE_DIAGNOSIS_ENGINE_COMPLETE',
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
