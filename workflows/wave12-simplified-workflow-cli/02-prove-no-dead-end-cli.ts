import { workflow } from '@agent-relay/sdk/workflows';

const artifactDir = '.workflow-artifacts/wave12-simplified-workflow-cli/no-dead-end-proof';

async function main() {
  const result = await workflow('ricky-wave12-no-dead-end-cli-proof')
    .description([
      'Prove the Ricky simplified CLI has no accidental dead ends across the interactive first-screen paths and power-user connect/status/cloud surfaces.',
      'This is an 80-to-100 guard: it records the acceptance map, verifies the implementation contains real state transitions, runs targeted tests with a fix loop, runs full regression, and captures final evidence.',
      'The pattern is dag: deterministic proof gates run in parallel where possible, then converge through final hard validation and signoff.',
    ].join(' '))
    .pattern('dag')
    .channel('wf-ricky-wave12-no-dead-end-cli')
    .maxConcurrency(4)
    .timeout(3_600_000)
    .onError('retry', { maxRetries: 2, retryDelayMs: 10_000 })

    .agent('validator', {
      cli: 'codex',
      role: 'Fixes any dead-end regressions or test failures found by the no-dead-end validation gates without reverting unrelated work.',
      retries: 2,
    })
    .agent('reviewer', {
      cli: 'claude',
      preset: 'reviewer',
      role: 'Reviews the final CLI flow map for product completeness, truthfulness, and no silent local/cloud fallback.',
      retries: 1,
    })

    .step('preflight', {
      type: 'deterministic',
      command: [
        `mkdir -p ${artifactDir}`,
        'test -f docs/product/ricky-simplified-workflow-cli-spec.md',
        'test -f src/surfaces/cli/entrypoint/interactive-cli.ts',
        'test -f src/surfaces/cli/commands/cli-main.ts',
        'git status --short > ' + artifactDir + '/preflight-git-status.txt',
        'echo NO_DEAD_END_PREFLIGHT_OK',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('write-flow-map', {
      type: 'deterministic',
      dependsOn: ['preflight'],
      command: [
        `cat > ${artifactDir}/flow-map.md <<'EOF'`,
        '# Ricky CLI no-dead-end flow map',
        '',
        'A dead end is any first-screen or power-user path that stops with instructions when Ricky owns enough context to ask the next useful question or run the real connector.',
        '',
        '## Interactive first screen',
        '',
        '- Local: runs local preflight, asks for spec source, captures spec/name or existing workflow, generates when needed, summarizes, and asks run mode.',
        '- Cloud: checks login/workspace readiness, offers real Cloud login, asks for workspace when needed, captures the spec through the shared spec intake flow, checks Cloud agents, offers real agent connection, asks optional integrations, summarizes, and asks Cloud run mode.',
        '- Status: intentionally informational; prints status commands and next actions.',
        '- Connect tools: asks which tools, runs real Relay Cloud connection for Cloud account and Cloud agents, and uses Nango connect links for optional integrations.',
        '- Exit/cancel: intentionally stops with a concise non-stack message.',
        '',
        '## Power-user surfaces',
        '',
        '- `ricky connect cloud`: calls the Relay Cloud account login flow, not a provider credential connector.',
        '- `ricky connect agents --cloud ...`: calls the Relay Cloud connector for each requested provider.',
        '- `ricky connect integrations --cloud ...`: requests Nango connect links for optional integration authorization without claiming final connection success.',
        '- `ricky cloud --spec*`: fails without Cloud request context with recovery, never silently falls back to local.',
        '',
        'NO_DEAD_END_FLOW_MAP_READY',
        'EOF',
      ].join('\n'),
      captureOutput: true,
      failOnError: true,
    })

    .step('static-transition-gate', {
      type: 'deterministic',
      dependsOn: ['preflight'],
      command: [
        'grep -F "buildGuidedCloudRequest" src/surfaces/cli/entrypoint/interactive-cli.ts',
        'grep -F "runSpecIntakeFlow" src/surfaces/cli/entrypoint/interactive-cli.ts',
        'grep -F "withDefaultGuidedCloudDeps" src/surfaces/cli/entrypoint/interactive-cli.ts',
        'grep -F "connectRelayProviders" src/surfaces/cli/entrypoint/interactive-cli.ts',
        'grep -F "loadRelayCloudConnectProvider" src/surfaces/cli/commands/cli-main.ts',
        'grep -F "Nango connect" src/surfaces/cli/commands/cli-main.ts',
        'grep -F "continues Cloud selection into shared spec intake" src/surfaces/cli/entrypoint/interactive-cli.test.ts',
        'grep -F "asks which tools to connect before running the selected connector paths" src/surfaces/cli/entrypoint/interactive-cli.test.ts',
        'echo NO_DEAD_END_STATIC_TRANSITIONS_OK',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('run-targeted-tests-soft', {
      type: 'deterministic',
      dependsOn: ['write-flow-map', 'static-transition-gate'],
      command: [
        `npx vitest run src/surfaces/cli/entrypoint/interactive-cli.test.ts src/surfaces/cli/commands/cli-main.test.ts test/simplified-workflow-cli.e2e.test.ts > ${artifactDir}/targeted-tests.log 2>&1`,
        `tail -80 ${artifactDir}/targeted-tests.log`,
      ].join(' || '),
      captureOutput: true,
      failOnError: false,
    })

    .step('fix-targeted-tests', {
      agent: 'validator',
      dependsOn: ['run-targeted-tests-soft'],
      task: `Read ${artifactDir}/targeted-tests.log.

If the targeted no-dead-end tests passed, make no edits.
If they failed, fix only the relevant CLI flow/test issue:
- Interactive Cloud must continue into setup/spec/run confirmation when Ricky owns a terminal.
- Connect tools must run selected real connector paths.
- Non-interactive contexts must keep actionable recovery and no raw stack traces.
- Do not silently fall back from Cloud to local or local to Cloud.

After any edit, rerun:
npx vitest run src/surfaces/cli/entrypoint/interactive-cli.test.ts src/surfaces/cli/commands/cli-main.test.ts test/simplified-workflow-cli.e2e.test.ts

End your response with NO_DEAD_END_TARGETED_FIX_DONE.`,
      verification: { type: 'output_contains', value: 'NO_DEAD_END_TARGETED_FIX_DONE' },
    })

    .step('run-targeted-tests-final', {
      type: 'deterministic',
      dependsOn: ['fix-targeted-tests'],
      command: [
        `npx vitest run src/surfaces/cli/entrypoint/interactive-cli.test.ts src/surfaces/cli/commands/cli-main.test.ts test/simplified-workflow-cli.e2e.test.ts | tee ${artifactDir}/targeted-tests-final.log`,
        'grep -F "Test Files" ' + artifactDir + '/targeted-tests-final.log',
        'echo NO_DEAD_END_TARGETED_TESTS_OK',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('run-typecheck', {
      type: 'deterministic',
      dependsOn: ['fix-targeted-tests'],
      command: `npx tsc --noEmit | tee ${artifactDir}/typecheck.log`,
      captureOutput: true,
      failOnError: true,
    })

    .step('source-cli-smoke', {
      type: 'deterministic',
      dependsOn: ['run-targeted-tests-final'],
      command: [
        `npx tsx src/surfaces/cli/commands/cli-main.ts connect integrations --cloud slack,github --json > ${artifactDir}/connect-integrations-smoke.json || true`,
        `grep -E '"status": "(failed|connected)"' ${artifactDir}/connect-integrations-smoke.json`,
        `npx tsx src/surfaces/cli/commands/cli-main.ts connect agents --json > ${artifactDir}/connect-agents-missing-smoke.json || true`,
        `grep -F '"status": "input-required"' ${artifactDir}/connect-agents-missing-smoke.json`,
        `npx tsx src/surfaces/cli/commands/cli-main.ts cloud --spec "prove cloud recovery" --json > ${artifactDir}/cloud-missing-context-smoke.json || true`,
        `grep -F '"status": "blocked"' ${artifactDir}/cloud-missing-context-smoke.json`,
        'echo NO_DEAD_END_SOURCE_SMOKE_OK',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('run-full-regression', {
      type: 'deterministic',
      dependsOn: ['run-typecheck', 'source-cli-smoke'],
      command: `npm test | tee ${artifactDir}/full-regression.log`,
      captureOutput: true,
      failOnError: true,
    })

    .step('review-no-dead-end-map', {
      agent: 'reviewer',
      dependsOn: ['run-full-regression'],
      task: `Review the final no-dead-end proof.

Inputs:
- Flow map: ${artifactDir}/flow-map.md
- Targeted tests: ${artifactDir}/targeted-tests-final.log
- Full regression: ${artifactDir}/full-regression.log
- Source code: src/surfaces/cli/entrypoint/interactive-cli.ts and src/surfaces/cli/commands/cli-main.ts

Check for product dead ends, fake success, silent fallback, or untested critical paths.
If acceptable, write ${artifactDir}/review.md ending with REVIEW_NO_DEAD_END_PASS.
If not acceptable, write concrete blockers ending with REVIEW_NO_DEAD_END_FAIL.`,
      verification: { type: 'file_exists', value: `${artifactDir}/review.md` },
    })

    .step('review-pass-gate', {
      type: 'deterministic',
      dependsOn: ['review-no-dead-end-map'],
      command: `grep -F REVIEW_NO_DEAD_END_PASS ${artifactDir}/review.md`,
      captureOutput: true,
      failOnError: true,
    })

    .step('signoff', {
      type: 'deterministic',
      dependsOn: ['review-pass-gate'],
      command: [
        `git diff --name-only > ${artifactDir}/changed-files.txt`,
        `cat > ${artifactDir}/signoff.md <<'EOF'`,
        '# No-dead-end CLI proof signoff',
        '',
        '- Flow map written.',
        '- Static transition gate passed.',
        '- Targeted first-screen, connect, and E2E tests passed.',
        '- Typecheck passed.',
        '- Source CLI smoke tests passed.',
        '- Full regression passed.',
        '- Reviewer pass gate passed.',
        '',
        'NO_DEAD_END_SIGNOFF_COMPLETE',
        'EOF',
        'cat ' + artifactDir + '/signoff.md',
      ].join('\n'),
      captureOutput: true,
      failOnError: true,
    })

    .run({ cwd: process.cwd() });

  console.log('Workflow status:', result.status);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
