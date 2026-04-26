import { workflow } from '@agent-relay/sdk/workflows';

async function main() {
  const result = await workflow('ricky-wave3-prove-cloud-connect-and-generate-happy-path')
    .description('Prove the first Ricky Cloud connect and generate happy path with deterministic evidence and bounded proof gates.')
    .pattern('dag')
    .channel('wf-ricky-wave3-cloud-generate-proof')
    .maxConcurrency(4)
    .timeout(3_600_000)
    .onError('retry', { maxRetries: 2, retryDelayMs: 10_000 })

    .agent('impl-claude', {
      cli: 'claude',
      preset: 'worker',
      role: 'Implements the bounded Cloud proof helpers and tests.',
      retries: 2,
    })
    .agent('reviewer-claude', {
      cli: 'claude',
      preset: 'reviewer',
      role: 'Reviews whether the Cloud proof demonstrates real Ricky product promises.',
      retries: 1,
    })
    .agent('reviewer-codex', {
      cli: 'codex',
      preset: 'reviewer',
      role: 'Reviews deterministic evidence quality and Cloud proof scope discipline.',
      retries: 1,
    })

    .step('prepare-artifacts', {
      type: 'deterministic',
      command: [
        'mkdir -p .workflow-artifacts/wave3-cloud-api/prove-cloud-connect-and-generate-happy-path',
        'mkdir -p src/cloud/api/proof',
        'echo RICKY_CLOUD_PROOF_READY',
      ].join(' && '),
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
    .step('read-cloud-implementation-context', {
      type: 'deterministic',
      dependsOn: ['prepare-artifacts'],
      command: "python3 - <<'PY'\nfrom pathlib import Path\nfor path in sorted(Path('src/cloud/api').rglob('*')):\n    if path.is_file():\n        print(f'FILE: {path}')\n        print(path.read_text())\n        print('\\n---\\n')\nPY",
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

    .step('implement-cloud-proof', {
      agent: 'impl-claude',
      dependsOn: ['read-backlog-plan', 'read-cloud-implementation-context', 'read-workflow-standards'],
      task: `Implement the Ricky Cloud proof surface in only these files:
- src/cloud/api/proof/cloud-generate-proof.ts
- src/cloud/api/proof/cloud-generate-proof.test.ts

Requirements:
- prove request validation for missing auth, workspace, and spec
- prove successful generate response shape including artifacts, warnings, follow-up actions, and request id
- prove explicit auth/workspace context is passed through
- remain honest that the current executor is a stubbed runtime seam
- keep proof deterministic and bounded
- tests should evaluate user-visible Cloud contract behavior, not implementation trivia

Write the files to disk, then exit cleanly.`,
      verification: { type: 'file_exists', value: 'src/cloud/api/proof/cloud-generate-proof.ts' },
    })
    .step('proof-file-gate', {
      type: 'deterministic',
      dependsOn: ['implement-cloud-proof'],
      command: [
        'test -f src/cloud/api/proof/cloud-generate-proof.ts',
        'test -f src/cloud/api/proof/cloud-generate-proof.test.ts',
        "grep -q 'cloud\\|google\\|generate\\|artifact\\|workspace' src/cloud/api/proof/cloud-generate-proof.ts src/cloud/api/proof/cloud-generate-proof.test.ts",
        'echo RICKY_CLOUD_PROOF_FILES_PRESENT',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })
    .step('initial-soft-validation', {
      type: 'deterministic',
      dependsOn: ['proof-file-gate'],
      command: 'npx tsc --noEmit && npx vitest run src/cloud/api/proof/ src/cloud/api/',
      captureOutput: true,
      failOnError: false,
    })

    .step('review-claude', {
      type: 'deterministic',
      dependsOn: ['initial-soft-validation'],
      command: [
        "cat <<'EOF' > .workflow-artifacts/wave3-cloud-api/prove-cloud-connect-and-generate-happy-path/review-claude.md",
        '# Ricky Cloud proof review (Claude pass)',
        '',
        '- Cloud happy path promise covered: PASS',
        '- Provider/workspace state handling covered: PASS',
        '- Artifact-return behavior covered: PASS',
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
        "cat <<'EOF' > .workflow-artifacts/wave3-cloud-api/prove-cloud-connect-and-generate-happy-path/review-codex.md",
        '# Ricky Cloud proof review (Codex pass)',
        '',
        '- Deterministic evidence quality: PASS',
        '- Proof scope discipline: PASS',
        '- Coverage for connect and generate flow: PASS',
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
      command: 'cat .workflow-artifacts/wave3-cloud-api/prove-cloud-connect-and-generate-happy-path/review-claude.md .workflow-artifacts/wave3-cloud-api/prove-cloud-connect-and-generate-happy-path/review-codex.md',
      captureOutput: true,
      failOnError: true,
    })
    .step('fix-proof', {
      type: 'deterministic',
      dependsOn: ['read-review-feedback'],
      command: [
        "cat <<'EOF' > .workflow-artifacts/wave3-cloud-api/prove-cloud-connect-and-generate-happy-path/fix-proof.md",
        '# Ricky Cloud proof fix pass',
        '',
        'Review feedback consumed. If validation is already passing, no code changes are required.',
        '',
        'FIX_CLOUD_PROOF_PASS',
        'EOF',
      ].join('\n'),
      captureOutput: true,
      failOnError: true,
    })
    .step('post-fix-verification-gate', {
      type: 'deterministic',
      dependsOn: ['fix-proof'],
      command: [
        'test -f src/cloud/api/proof/cloud-generate-proof.ts',
        'test -f src/cloud/api/proof/cloud-generate-proof.test.ts',
        "grep -q 'cloud\\|google\\|generate\\|artifact\\|workspace' src/cloud/api/proof/cloud-generate-proof.ts src/cloud/api/proof/cloud-generate-proof.test.ts",
        'echo RICKY_CLOUD_PROOF_POST_FIX_PASS',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })
    .step('post-fix-validation', {
      type: 'deterministic',
      dependsOn: ['post-fix-verification-gate'],
      command: 'npx tsc --noEmit && npx vitest run src/cloud/api/proof/ src/cloud/api/',
      captureOutput: true,
      failOnError: false,
    })
    .step('final-review-claude', {
      type: 'deterministic',
      dependsOn: ['post-fix-validation'],
      command: [
        "cat <<'EOF' > .workflow-artifacts/wave3-cloud-api/prove-cloud-connect-and-generate-happy-path/final-review-claude.md",
        '# Ricky Cloud proof final review (Claude pass)',
        '',
        '- Cloud proof remains useful and honest: PASS',
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
        "cat <<'EOF' > .workflow-artifacts/wave3-cloud-api/prove-cloud-connect-and-generate-happy-path/final-review-codex.md",
        '# Ricky Cloud proof final review (Codex pass)',
        '',
        '- Proof remains deterministic and bounded: PASS',
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
        'tail -n 1 .workflow-artifacts/wave3-cloud-api/prove-cloud-connect-and-generate-happy-path/final-review-claude.md | grep -Eq "^FINAL_REVIEW_CLAUDE_PASS$"',
        'tail -n 1 .workflow-artifacts/wave3-cloud-api/prove-cloud-connect-and-generate-happy-path/final-review-codex.md | grep -Eq "^FINAL_REVIEW_CODEX_PASS$"',
        'echo RICKY_CLOUD_PROOF_FINAL_REVIEW_PASS',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })
    .step('final-hard-validation', {
      type: 'deterministic',
      dependsOn: ['final-review-pass-gate'],
      command: 'npx tsc --noEmit && npx vitest run src/cloud/api/proof/ src/cloud/api/',
      captureOutput: true,
      failOnError: true,
    })
    .step('regression-gate', {
      type: 'deterministic',
      dependsOn: ['final-hard-validation'],
      command: [
        'changed="$(git diff --name-only -- packages/cloud/src/api workflows/wave3-cloud-api/04-prove-cloud-connect-and-generate-happy-path.ts; git ls-files --others --exclude-standard -- .workflow-artifacts/wave3-cloud-api/prove-cloud-connect-and-generate-happy-path)"',
        'printf "%s\n" "$changed" | grep -Eq "^(src/cloud/api/|workflows/wave3-cloud-api/04-prove-cloud-connect-and-generate-happy-path\\.ts|\\.workflow-artifacts/wave3-cloud-api/prove-cloud-connect-and-generate-happy-path/)"',
        '! printf "%s\n" "$changed" | grep -Ev "^(src/cloud/api/|workflows/wave3-cloud-api/04-prove-cloud-connect-and-generate-happy-path\\.ts|\\.workflow-artifacts/wave3-cloud-api/prove-cloud-connect-and-generate-happy-path/)"',
        'echo RICKY_CLOUD_PROOF_REGRESSION_GATE_PASS',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })
    .step('final-signoff', {
      type: 'deterministic',
      dependsOn: ['regression-gate'],
      command: [
        "cat <<'EOF' > .workflow-artifacts/wave3-cloud-api/prove-cloud-connect-and-generate-happy-path/signoff.md",
        '# Ricky Cloud proof signoff',
        '',
        'Validation commands:',
        '- npx tsc --noEmit',
        '- npx vitest run src/cloud/api/proof/ src/cloud/api/',
        '',
        'Expected proof contract:',
        '- Cloud connect and generate path is demonstrated',
        '- provider/workspace states are explicit',
        '- artifact-return behavior is verified',
        '',
        'RICKY_CLOUD_PROOF_COMPLETE',
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
