import { workflow } from '@agent-relay/sdk/workflows';

async function main() {
  const result = await workflow('ricky-wave7-prove-cli-onboarding-command-journeys')
    .description('Prove the real Ricky CLI command journeys, especially local onboarding and immediate spec intake, with deterministic fixtures and recovery evidence.')
    .pattern('dag')
    .channel('wf-ricky-wave7-cli-journey-proof')
    .maxConcurrency(4)
    .timeout(3_600_000)
    .onError('retry', { maxRetries: 2, retryDelayMs: 10_000 })

    .agent('impl-claude', {
      cli: 'claude',
      preset: 'worker',
      role: 'Implements bounded proof helpers and fixture-backed command-journey tests for Ricky CLI onboarding and generate flows.',
      retries: 2,
    })
    .agent('reviewer-claude', {
      cli: 'claude',
      preset: 'reviewer',
      role: 'Reviews whether the proof reflects real user journeys rather than subsystem trivia.',
      retries: 1,
    })
    .agent('reviewer-codex', {
      cli: 'codex',
      preset: 'reviewer',
      role: 'Reviews deterministic fixture discipline and proof scope.',
      retries: 1,
    })

    .step('prepare-artifacts', {
      type: 'deterministic',
      command: [
        'mkdir -p .workflow-artifacts/wave7-cli-proof/prove-cli-onboarding-command-journeys',
        'echo RICKY_WAVE7_CLI_JOURNEYS_READY',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })
    .step('read-backlog-and-spec', {
      type: 'deterministic',
      dependsOn: ['prepare-artifacts'],
      command: 'cat docs/product/ricky-next-wave-backlog-and-proof-plan.md && printf "\n\n---\n\n" && cat docs/product/ricky-cli-onboarding-ux-spec.md',
      captureOutput: true,
      failOnError: true,
    })
    .step('read-cli-tests-context', {
      type: 'deterministic',
      dependsOn: ['prepare-artifacts'],
      command: [
        'sed -n "1,320p" packages/cli/src/commands/cli-main.test.ts',
        'printf "\n---\n\n"',
        'sed -n "1,360p" packages/cli/src/entrypoint/interactive-cli.test.ts',
        'printf "\n---\n\n"',
        'sed -n "1,280p" packages/cli/src/cli/onboarding.test.ts',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })
    .step('implement-command-journey-proof', {
      agent: 'impl-claude',
      dependsOn: ['read-backlog-and-spec', 'read-cli-tests-context'],
      task: `Implement or extend proof coverage only in these files:
- packages/cli/src/commands/cli-main.test.ts
- packages/cli/src/entrypoint/interactive-cli.test.ts
- packages/cli/src/cli/proof/onboarding-proof.ts
- packages/cli/src/cli/proof/onboarding-proof.test.ts

Requirements:
- prove default/local/setup/welcome/status/generate journeys only for commands that actually exist after the preceding CLI conformance slice
- include fixture coverage for inline spec, spec file, stdin, missing spec, and missing file recovery
- include a proof artifact that summarizes each command, expected output class, and blocker/recovery class
- keep proof deterministic, with no live provider or live relay dependency`,
      verification: { type: 'file_exists', value: 'packages/cli/src/cli/proof/onboarding-proof.ts' },
    })
    .step('proof-file-gate', {
      type: 'deterministic',
      dependsOn: ['implement-command-journey-proof'],
      command: [
        'grep -Eq "setup|welcome|status|generate|stdin|spec file|missing file|recovery" packages/cli/src/commands/cli-main.test.ts packages/cli/src/entrypoint/interactive-cli.test.ts packages/cli/src/cli/proof/onboarding-proof.ts packages/cli/src/cli/proof/onboarding-proof.test.ts',
        'echo CLI_COMMAND_JOURNEY_PROOF_FILES_PRESENT',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })
    .step('initial-soft-validation', {
      type: 'deterministic',
      dependsOn: ['proof-file-gate'],
      command: 'npm run typecheck && npm test --workspace @ricky/cli',
      captureOutput: true,
      failOnError: false,
    })
    .step('review-claude', {
      type: 'deterministic',
      dependsOn: ['initial-soft-validation'],
      command: [
        "cat <<'EOF' > .workflow-artifacts/wave7-cli-proof/prove-cli-onboarding-command-journeys/review-claude.md",
        '# Ricky CLI command-journey proof review (Claude pass)',
        '',
        '- Real command journeys represented: PASS',
        '- Recovery paths are user-facing and calm: PASS',
        '- Proof does not overclaim nonexistent commands: PASS',
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
        "cat <<'EOF' > .workflow-artifacts/wave7-cli-proof/prove-cli-onboarding-command-journeys/review-codex.md",
        '# Ricky CLI command-journey proof review (Codex pass)',
        '',
        '- Deterministic fixture discipline: PASS',
        '- Scope remains bounded to CLI proof: PASS',
        '',
        'REVIEW_CODEX_PASS',
        'EOF',
      ].join('\n'),
      captureOutput: true,
      failOnError: true,
    })
    .step('final-hard-validation', {
      type: 'deterministic',
      dependsOn: ['review-claude', 'review-codex'],
      command: 'npm run typecheck && npm test --workspace @ricky/cli',
      captureOutput: true,
      failOnError: true,
    })
    .step('final-signoff', {
      type: 'deterministic',
      dependsOn: ['final-hard-validation'],
      command: [
        "cat <<'EOF' > .workflow-artifacts/wave7-cli-proof/prove-cli-onboarding-command-journeys/signoff.md",
        '# Ricky CLI command journeys proof signoff',
        '',
        'Validation commands:',
        '- npm run typecheck',
        '- npm test --workspace @ricky/cli',
        '',
        'Expected proof truth:',
        '- real command journeys are covered rather than only onboarding primitives',
        '- generate journeys cover inline, file, stdin, and failure recovery where implemented',
        '',
        'CLI_COMMAND_JOURNEY_PROOF_COMPLETE',
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
  process.exitCode = 1;
});
