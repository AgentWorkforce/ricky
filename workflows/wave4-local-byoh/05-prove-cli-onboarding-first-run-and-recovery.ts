import { workflow } from '@agent-relay/sdk/workflows';

async function main() {
  const result = await workflow('ricky-wave4-prove-cli-onboarding-first-run-and-recovery')
    .description('Prove the Ricky CLI onboarding experience end-to-end through deterministic first-run, returning-user, and recovery-path evidence.')
    .pattern('dag')
    .channel('wf-ricky-wave4-cli-onboarding-proof')
    .maxConcurrency(4)
    .timeout(3_600_000)
    .onError('retry', { maxRetries: 2, retryDelayMs: 10_000 })

    .agent('lead-claude', {
      cli: 'claude',
      preset: 'worker',
      role: 'Proof lead who keeps onboarding validation focused on user-visible behavior and honest recovery evidence.',
      retries: 1,
    })
    .agent('impl-proof-codex', {
      cli: 'codex',
      role: 'Implements proof harnesses, fixtures, and deterministic validation helpers for CLI onboarding output.',
      retries: 2,
    })
    .agent('reviewer-claude', {
      cli: 'claude',
      preset: 'reviewer',
      role: 'Reviews whether the proof actually demonstrates Ricky’s onboarding promises.',
      retries: 1,
    })
    .agent('reviewer-codex', {
      cli: 'codex',
      preset: 'reviewer',
      role: 'Reviews proof rigor, deterministic evidence quality, and scope discipline.',
      retries: 1,
    })
    .agent('validator-claude', {
      cli: 'claude',
      preset: 'worker',
      role: 'Runs the proof fix loop, final validation, and signoff for CLI onboarding proof.',
      retries: 2,
    })

    .step('prepare-artifacts', {
      type: 'deterministic',
      command: [
        'mkdir -p .workflow-artifacts/wave4-local-byoh/prove-cli-onboarding-first-run-and-recovery',
        'mkdir -p src/cli/proof',
        'echo CLI_ONBOARDING_PROOF_READY',
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
    .step('read-cli-implementation-context', {
      type: 'deterministic',
      dependsOn: ['prepare-artifacts'],
      command: "python3 - <<'PY'\nfrom pathlib import Path\nfor path in sorted(Path('src/cli').rglob('*')):\n    if path.is_file():\n        print(f'FILE: {path}')\n        print(path.read_text())\n        print('\n---\n')\nPY",
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

    .step('lead-plan', {
      agent: 'lead-claude',
      dependsOn: ['read-ux-spec', 'read-cli-implementation-context', 'read-workflow-standards'],
      task: `Plan the proof workflow for Ricky CLI onboarding.

Context inputs:
- UX spec:
{{steps.read-ux-spec.output}}
- CLI implementation context:
{{steps.read-cli-implementation-context.output}}
- Workflow standards and rules:
{{steps.read-workflow-standards.output}}

Deliverables:
- src/cli/proof/onboarding-proof.ts
- src/cli/proof/onboarding-proof.test.ts

Proof cases must include:
- first-run experience
- returning-user experience
- local/BYOH path visibility
- Cloud path visibility
- Google connect guidance
- GitHub dashboard/Nango guidance
- CLI or MCP handoff language
- at least one blocked or recovery path

Non-goals:
- Do not rely on screenshots or manual inspection only.
- Do not add network-dependent proof.
- Do not claim proof if the implementation modules do not exist yet.

Verification:
- The proof harness must generate deterministic evidence or assertions.
- The proof must compare behavior against the UX spec, not just test helper internals.
- If implementation is missing, the workflow should fail honestly or surface the blocker clearly.

Write .workflow-artifacts/wave4-local-byoh/prove-cli-onboarding-first-run-and-recovery/plan.md with concrete proof cases, expected evidence, and failure conditions. End with CLI_ONBOARDING_PROOF_PLAN_READY.`,
      verification: { type: 'file_exists', value: '.workflow-artifacts/wave4-local-byoh/prove-cli-onboarding-first-run-and-recovery/plan.md' },
    })

    .step('implement-proof-harness', {
      agent: 'impl-proof-codex',
      dependsOn: ['lead-plan'],
      task: `Implement the deterministic proof harness for Ricky CLI onboarding.

Deliverables:
- onboarding-proof.ts should expose helpers or evaluators that render or inspect onboarding outputs against proof cases.
- onboarding-proof.test.ts should assert first-run, returning-user, local/BYOH, Cloud, provider guidance, handoff, and recovery behavior.

Non-goals:
- Do not add flaky snapshots.
- Do not hide missing implementation behind fake mocks that prove nothing.
- Do not touch unrelated CLI files unless a tiny import fix is truly required.

Verification:
- Tests must prove the user-visible contract.
- If implementation files are missing, surface that honestly.
- Keep evidence deterministic and bounded.`,
      verification: { type: 'file_exists', value: 'src/cli/proof/onboarding-proof.test.ts' },
    })
    .step('post-proof-file-gate', {
      type: 'deterministic',
      dependsOn: ['implement-proof-harness'],
      command: [
        'test -f src/cli/proof/onboarding-proof.ts',
        'test -f src/cli/proof/onboarding-proof.test.ts',
        'grep -q "first-run\|returning\|local\|Cloud\|recovery" src/cli/proof/onboarding-proof.test.ts',
        'echo CLI_ONBOARDING_PROOF_FILES_PRESENT',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('initial-soft-validation', {
      type: 'deterministic',
      dependsOn: ['post-proof-file-gate'],
      command: 'npx tsc --noEmit && npx vitest run src/cli/proof/ src/cli/',
      captureOutput: true,
      failOnError: false,
    })

    .step('review-claude', {
      agent: 'reviewer-claude',
      dependsOn: ['initial-soft-validation'],
      task: `Review the Ricky CLI onboarding proof.

Focus:
- does it prove the onboarding promises instead of merely testing implementation trivia?
- does it include first-run, returning-user, local/BYOH, Cloud, and recovery behavior?
- does it fail honestly if implementation is absent or incomplete?

Write .workflow-artifacts/wave4-local-byoh/prove-cli-onboarding-first-run-and-recovery/review-claude.md ending with REVIEW_CLAUDE_PASS or REVIEW_CLAUDE_FAIL.`,
      verification: { type: 'file_exists', value: '.workflow-artifacts/wave4-local-byoh/prove-cli-onboarding-first-run-and-recovery/review-claude.md' },
    })
    .step('review-codex', {
      agent: 'reviewer-codex',
      dependsOn: ['initial-soft-validation'],
      task: `Review the Ricky CLI onboarding proof harness and tests.

Focus:
- deterministic evidence quality
- scope discipline
- proof coverage versus the UX spec
- honesty about missing implementation dependencies

Write .workflow-artifacts/wave4-local-byoh/prove-cli-onboarding-first-run-and-recovery/review-codex.md ending with REVIEW_CODEX_PASS or REVIEW_CODEX_FAIL.`,
      verification: { type: 'file_exists', value: '.workflow-artifacts/wave4-local-byoh/prove-cli-onboarding-first-run-and-recovery/review-codex.md' },
    })

    .step('read-review-feedback', {
      type: 'deterministic',
      dependsOn: ['review-claude', 'review-codex'],
      command: 'cat .workflow-artifacts/wave4-local-byoh/prove-cli-onboarding-first-run-and-recovery/review-claude.md .workflow-artifacts/wave4-local-byoh/prove-cli-onboarding-first-run-and-recovery/review-codex.md',
      captureOutput: true,
      failOnError: true,
    })
    .step('fix-proof-harness', {
      agent: 'validator-claude',
      dependsOn: ['read-review-feedback'],
      task: `Fix Ricky CLI onboarding proof issues from review feedback.

Review feedback:
{{steps.read-review-feedback.output}}

Rules:
- keep proof deterministic
- keep missing-implementation handling honest
- improve user-visible coverage where needed
- do not claim proof without evidence`,
      verification: { type: 'exit_code', value: '0' },
    })
    .step('post-fix-verification-gate', {
      type: 'deterministic',
      dependsOn: ['fix-proof-harness'],
      command: [
        'test -f src/cli/proof/onboarding-proof.ts',
        'test -f src/cli/proof/onboarding-proof.test.ts',
        'grep -q "first-run\|returning\|local\|Cloud\|recovery" src/cli/proof/onboarding-proof.test.ts',
        'echo CLI_ONBOARDING_PROOF_POST_FIX_GATE_PASS',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })
    .step('post-fix-validation', {
      type: 'deterministic',
      dependsOn: ['post-fix-verification-gate'],
      command: 'npx tsc --noEmit && npx vitest run src/cli/proof/ src/cli/',
      captureOutput: true,
      failOnError: false,
    })

    .step('final-review-claude', {
      agent: 'reviewer-claude',
      dependsOn: ['post-fix-validation'],
      task: `Re-review the Ricky CLI onboarding proof after fixes.

Confirm it now provides honest and useful evidence for first-run and recovery behavior.
Write .workflow-artifacts/wave4-local-byoh/prove-cli-onboarding-first-run-and-recovery/final-review-claude.md ending with FINAL_REVIEW_CLAUDE_PASS or FINAL_REVIEW_CLAUDE_FAIL.`,
      verification: { type: 'file_exists', value: '.workflow-artifacts/wave4-local-byoh/prove-cli-onboarding-first-run-and-recovery/final-review-claude.md' },
    })
    .step('final-review-codex', {
      agent: 'reviewer-codex',
      dependsOn: ['post-fix-validation'],
      task: `Re-review the Ricky CLI onboarding proof after fixes.

Confirm the proof harness is deterministic, bounded, and aligned with the UX spec.
Write .workflow-artifacts/wave4-local-byoh/prove-cli-onboarding-first-run-and-recovery/final-review-codex.md ending with FINAL_REVIEW_CODEX_PASS or FINAL_REVIEW_CODEX_FAIL.`,
      verification: { type: 'file_exists', value: '.workflow-artifacts/wave4-local-byoh/prove-cli-onboarding-first-run-and-recovery/final-review-codex.md' },
    })
    .step('final-review-pass-gate', {
      type: 'deterministic',
      dependsOn: ['final-review-claude', 'final-review-codex'],
      command: [
        'tail -n 1 .workflow-artifacts/wave4-local-byoh/prove-cli-onboarding-first-run-and-recovery/final-review-claude.md | grep -Eq "^FINAL_REVIEW_CLAUDE_PASS$"',
        'tail -n 1 .workflow-artifacts/wave4-local-byoh/prove-cli-onboarding-first-run-and-recovery/final-review-codex.md | grep -Eq "^FINAL_REVIEW_CODEX_PASS$"',
        'echo CLI_ONBOARDING_PROOF_FINAL_REVIEW_PASS',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })
    .step('final-hard-validation', {
      type: 'deterministic',
      dependsOn: ['final-review-pass-gate'],
      command: 'npx tsc --noEmit && npx vitest run src/cli/proof/ src/cli/',
      captureOutput: true,
      failOnError: true,
    })
    .step('regression-gate', {
      type: 'deterministic',
      dependsOn: ['final-hard-validation'],
      command: [
        'changed="$(git diff --name-only; git ls-files --others --exclude-standard)"',
        'printf "%s\n" "$changed" | grep -Eq "^(src/cli/|\.workflow-artifacts/)"',
        '! printf "%s\n" "$changed" | grep -Ev "^(src/cli/|\.workflow-artifacts/)"',
        'echo CLI_ONBOARDING_PROOF_REGRESSION_GATE_PASS',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })
    .step('final-signoff', {
      agent: 'validator-claude',
      dependsOn: ['regression-gate'],
      task: `Write .workflow-artifacts/wave4-local-byoh/prove-cli-onboarding-first-run-and-recovery/signoff.md.

Include proof cases covered, validation commands run, any missing implementation blockers, and remaining risks.
End with CLI_ONBOARDING_PROOF_COMPLETE.`,
      verification: { type: 'file_exists', value: '.workflow-artifacts/wave4-local-byoh/prove-cli-onboarding-first-run-and-recovery/signoff.md' },
    })

    .run({ cwd: process.cwd() });

  console.log(result.status);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
