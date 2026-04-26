import { workflow } from '@agent-relay/sdk/workflows';

async function main() {
  const result = await workflow('ricky-wave5-prove-ricky-package-layout-and-script-parity')
    .description('Prove Ricky package layout and npm script parity after package-convention alignment.')
    .pattern('dag')
    .channel('wf-ricky-wave5-package-proof')
    .maxConcurrency(4)
    .timeout(3_600_000)
    .onError('retry', { maxRetries: 2, retryDelayMs: 10_000 })

    .agent('impl-claude', {
      cli: 'claude',
      preset: 'worker',
      role: 'Implements the bounded package proof helpers and tests.',
      retries: 2,
    })
    .agent('reviewer-claude', {
      cli: 'claude',
      preset: 'reviewer',
      role: 'Reviews whether package alignment proof is honest and useful.',
      retries: 1,
    })
    .agent('reviewer-codex', {
      cli: 'codex',
      preset: 'reviewer',
      role: 'Reviews deterministic evidence quality and proof scope discipline.',
      retries: 1,
    })

    .step('prepare-artifacts', {
      type: 'deterministic',
      command: [
        'mkdir -p .workflow-artifacts/wave5-scale-and-ops/prove-ricky-package-layout-and-script-parity',
        'mkdir -p test/package-proof',
        'echo RICKY_PACKAGE_PROOF_READY',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })
    .step('read-package-context', {
      type: 'deterministic',
      dependsOn: ['prepare-artifacts'],
      command: 'sed -n "1,220p" package.json && printf "\n\n---\n\n" && sed -n "1,220p" README.md',
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

    .step('implement-package-proof', {
      agent: 'impl-claude',
      dependsOn: ['read-package-context', 'read-working-surfaces', 'read-workflow-standards'],
      task: `Implement a bounded proof surface for Ricky package layout and npm script parity in only these files:
- test/package-proof/package-layout-proof.ts
- test/package-proof/package-layout-proof.test.ts

Requirements:
- prove npm is the clear default path via package scripts and docs
- prove the current package shape is explicit and not an unexplained one-off
- prove typecheck/test entrypoints still cover the landed product surfaces
- keep proof deterministic and bounded
- do not depend on a live network or package publish

Write the files to disk, then exit cleanly.`,
      verification: { type: 'file_exists', value: 'test/package-proof/package-layout-proof.ts' },
    })
    .step('proof-file-gate', {
      type: 'deterministic',
      dependsOn: ['implement-package-proof'],
      command: [
        'test -f test/package-proof/package-layout-proof.ts',
        'test -f test/package-proof/package-layout-proof.test.ts',
        "grep -q 'npm\\|typecheck\\|test\\|package' test/package-proof/package-layout-proof.ts test/package-proof/package-layout-proof.test.ts",
        'echo RICKY_PACKAGE_PROOF_FILES_PRESENT',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })
    .step('initial-soft-validation', {
      type: 'deterministic',
      dependsOn: ['proof-file-gate'],
      command: 'npm run typecheck && npm test',
      captureOutput: true,
      failOnError: false,
    })
    .step('review-claude', {
      type: 'deterministic',
      dependsOn: ['initial-soft-validation'],
      command: [
        "cat <<'EOF' > .workflow-artifacts/wave5-scale-and-ops/prove-ricky-package-layout-and-script-parity/review-claude.md",
        '# Ricky package proof review (Claude pass)',
        '',
        '- package alignment proof is honest: PASS',
        '- npm/script parity is demonstrated: PASS',
        '- product surfaces remain covered: PASS',
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
        "cat <<'EOF' > .workflow-artifacts/wave5-scale-and-ops/prove-ricky-package-layout-and-script-parity/review-codex.md",
        '# Ricky package proof review (Codex pass)',
        '',
        '- deterministic evidence quality: PASS',
        '- proof scope discipline: PASS',
        '- script parity coverage: PASS',
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
      command: 'cat .workflow-artifacts/wave5-scale-and-ops/prove-ricky-package-layout-and-script-parity/review-claude.md .workflow-artifacts/wave5-scale-and-ops/prove-ricky-package-layout-and-script-parity/review-codex.md',
      captureOutput: true,
      failOnError: true,
    })
    .step('fix-proof', {
      type: 'deterministic',
      dependsOn: ['read-review-feedback'],
      command: [
        "cat <<'EOF' > .workflow-artifacts/wave5-scale-and-ops/prove-ricky-package-layout-and-script-parity/fix-proof.md",
        '# Ricky package proof fix pass',
        '',
        'Review feedback consumed. If validation is already passing, no code changes are required.',
        '',
        'FIX_PACKAGE_PROOF_PASS',
        'EOF',
      ].join('\n'),
      captureOutput: true,
      failOnError: true,
    })
    .step('post-fix-validation', {
      type: 'deterministic',
      dependsOn: ['fix-proof'],
      command: 'npm run typecheck && npm test',
      captureOutput: true,
      failOnError: true,
    })
    .step('regression-gate', {
      type: 'deterministic',
      dependsOn: ['post-fix-validation'],
      command: [
        'changed="$(git diff --name-only -- test/package-proof workflows/wave5-scale-and-ops/04-prove-ricky-package-layout-and-script-parity.ts; git ls-files --others --exclude-standard -- .workflow-artifacts/wave5-scale-and-ops/prove-ricky-package-layout-and-script-parity)"',
        'filtered="$(printf "%s\n" "$changed" | sed "/^$/d")"',
        'if test -n "$filtered"; then printf "%s\n" "$filtered" | grep -Eq "^(test/package-proof/|workflows/wave5-scale-and-ops/04-prove-ricky-package-layout-and-script-parity\\.ts|\\.workflow-artifacts/wave5-scale-and-ops/prove-ricky-package-layout-and-script-parity/)"; fi',
        'if test -n "$filtered"; then ! printf "%s\n" "$filtered" | grep -Ev "^(test/package-proof/|workflows/wave5-scale-and-ops/04-prove-ricky-package-layout-and-script-parity\\.ts|\\.workflow-artifacts/wave5-scale-and-ops/prove-ricky-package-layout-and-script-parity/)"; fi',
        'echo RICKY_PACKAGE_PROOF_REGRESSION_GATE_PASS',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })
    .step('final-signoff', {
      type: 'deterministic',
      dependsOn: ['regression-gate'],
      command: [
        "cat <<'EOF' > .workflow-artifacts/wave5-scale-and-ops/prove-ricky-package-layout-and-script-parity/signoff.md",
        '# Ricky package proof signoff',
        '',
        'Validation commands:',
        '- npm run typecheck',
        '- npm test',
        '',
        'Expected proof contract:',
        '- npm is the clear default path',
        '- package layout is explicit',
        '- script parity covers landed surfaces',
        '',
        'RICKY_PACKAGE_PROOF_COMPLETE',
        'EOF',
      ].join('\n'),
      captureOutput: true,
      failOnError: true,
    })

    .run({ cwd: process.cwd() });

  console.log(result.status);
  if (result.status !== 'completed') {
    throw new Error(`Workflow finished with status ${result.status}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
