import { workflow } from '@agent-relay/sdk/workflows';

const artifactRoot = '.workflow-artifacts/generated/package-checks';

async function main() {
  const result = await workflow('ricky-package-checks')
    .description('Run Ricky package health checks across the monorepo: workspace typecheck followed by workspace and smoke tests.')
    .pattern('pipeline')
    .channel('wf-ricky-package-checks')
    .maxConcurrency(1)
    .timeout(1_800_000)
    .onError('fail-fast')

    .step('prepare-package-check-context', {
      type: 'deterministic',
      command: [
        'repo_root="$(git rev-parse --show-toplevel)"',
        `mkdir -p "$repo_root/${artifactRoot}"`,
        `printf '%s\\n' 'routing=local|cloud|mcp' 'cwd=$repo_root' 'typecheck=npm run typecheck' 'test=npm run test' > "$repo_root/${artifactRoot}/routing.txt"`,
        `printf '%s\\n' '@ricky/shared' '@ricky/runtime' '@ricky/product' '@ricky/cloud' '@ricky/local' '@ricky/cli' > "$repo_root/${artifactRoot}/packages.txt"`,
        'echo PACKAGE_CHECK_CONTEXT_READY',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('package-script-gate', {
      type: 'deterministic',
      dependsOn: ['prepare-package-check-context'],
      command: [
        'repo_root="$(git rev-parse --show-toplevel)"',
        'cd "$repo_root"',
        'test -f package.json',
        'node -e "const fs=require(\'fs\'); const root=JSON.parse(fs.readFileSync(\'package.json\', \'utf8\')); if (!root.scripts?.typecheck || !root.scripts?.test) process.exit(1); for (const workspace of root.workspaces) { const pkg=JSON.parse(fs.readFileSync(workspace + \'/package.json\', \'utf8\')); if (!pkg.scripts?.typecheck || !pkg.scripts?.test) process.exit(1); }"',
        'echo PACKAGE_CHECK_SCRIPTS_PRESENT',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('typecheck-packages', {
      type: 'deterministic',
      dependsOn: ['package-script-gate'],
      command: [
        'repo_root="$(git rev-parse --show-toplevel)"',
        `mkdir -p "$repo_root/${artifactRoot}"`,
        'cd "$repo_root"',
        `npm run typecheck > "${artifactRoot}/typecheck.log" 2>&1`,
        `printf '%s\\n' 'TYPECHECK_PASS' > "${artifactRoot}/typecheck.status"`,
        'echo TYPECHECK_PASS',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('test-packages', {
      type: 'deterministic',
      dependsOn: ['typecheck-packages'],
      command: [
        'repo_root="$(git rev-parse --show-toplevel)"',
        `mkdir -p "$repo_root/${artifactRoot}"`,
        'cd "$repo_root"',
        `npm run test > "${artifactRoot}/test.log" 2>&1`,
        `printf '%s\\n' 'TEST_PASS' > "${artifactRoot}/test.status"`,
        'echo TEST_PASS',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('package-check-signoff', {
      type: 'deterministic',
      dependsOn: ['test-packages'],
      command: [
        'repo_root="$(git rev-parse --show-toplevel)"',
        `mkdir -p "$repo_root/${artifactRoot}"`,
        `test -f "$repo_root/${artifactRoot}/typecheck.status"`,
        `test -f "$repo_root/${artifactRoot}/test.status"`,
        `grep -qx 'TYPECHECK_PASS' "$repo_root/${artifactRoot}/typecheck.status"`,
        `grep -qx 'TEST_PASS' "$repo_root/${artifactRoot}/test.status"`,
        `printf '%s\\n' '# Package Checks Signoff' '' 'Commands:' '- npm run typecheck' '- npm run test' '' 'Evidence:' "- ${artifactRoot}/typecheck.log" "- ${artifactRoot}/test.log" '' 'PACKAGE_CHECKS_READY' > "$repo_root/${artifactRoot}/signoff.md"`,
        'echo PACKAGE_CHECKS_READY',
      ].join(' && '),
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
