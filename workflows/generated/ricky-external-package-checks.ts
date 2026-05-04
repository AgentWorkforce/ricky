import { workflow } from '@agent-relay/sdk/workflows';

const artifactDir = '.workflow-artifacts/generated/generate-a-workflow-for-external-package-checks';
const workflowPath = 'workflows/generated/ricky-external-package-checks.ts';

async function main() {
  const result = await workflow('ricky-external-package-checks')
    .description('Check external package health by validating the installed dependency tree, TypeScript compatibility, and the existing Vitest suite.')
    .pattern('pipeline')
    .channel('wf-ricky-external-package-checks')
    .maxConcurrency(1)
    .timeout(3_600_000)
    .onError('fail-fast')

    .agent('package-auditor', {
      cli: 'codex',
      preset: 'worker',
      role: 'Reads package metadata and summarizes the purpose and pinned range for each external dependency.',
      retries: 1,
    })
    .agent('signoff-writer', {
      cli: 'claude',
      preset: 'worker',
      role: 'Compiles package-check evidence into a concise signoff report with routing and residual risks.',
      retries: 1,
    })

    .step('prepare-context', {
      type: 'deterministic',
      command: [
        `mkdir -p '${artifactDir}'`,
        `printf '%s\\n' 'Local: npx tsx ${workflowPath}' 'Cloud: ricky cloud --workflow ${workflowPath} --run' 'MCP: invoke workflow ricky-external-package-checks through the relay broker' > '${artifactDir}/routing.txt'`,
        `node --input-type=module -e "import { readFileSync, writeFileSync } from 'node:fs'; const pkg = JSON.parse(readFileSync('package.json', 'utf8')); const inventory = { runtime: pkg.dependencies ?? {}, development: pkg.devDependencies ?? {} }; writeFileSync('${artifactDir}/external-package-inventory.json', JSON.stringify(inventory, null, 2) + '\\n'); console.log('EXTERNAL_PACKAGE_INVENTORY_READY');"`,
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('dep-tree-check', {
      type: 'deterministic',
      dependsOn: ['prepare-context'],
      command: `bash -lc 'set -o pipefail; npm ls 2>&1 | tee "${artifactDir}/dep-tree.log"; status=$?; printf "exit_code=%s\\n" "$status" > "${artifactDir}/dep-tree.status"; echo DEP_TREE_CHECKED; exit "$status"'`,
      captureOutput: true,
      failOnError: true,
    })

    .step('typecheck', {
      type: 'deterministic',
      dependsOn: ['dep-tree-check'],
      command: `bash -lc 'set -o pipefail; npx tsc --noEmit 2>&1 | tee "${artifactDir}/typecheck.log"; status=$?; printf "exit_code=%s\\n" "$status" > "${artifactDir}/typecheck.status"; echo TYPECHECK_CHECKED; exit "$status"'`,
      captureOutput: true,
      failOnError: true,
    })

    .step('test-suite', {
      type: 'deterministic',
      dependsOn: ['typecheck'],
      command: `bash -lc 'set -o pipefail; npx vitest run 2>&1 | tee "${artifactDir}/test.log"; status=$?; printf "exit_code=%s\\n" "$status" > "${artifactDir}/test.status"; echo TEST_SUITE_CHECKED; exit "$status"'`,
      captureOutput: true,
      failOnError: true,
    })

    .step('package-audit', {
      agent: 'package-auditor',
      dependsOn: ['test-suite'],
      task: `Audit the current external package inventory for Ricky.

Inputs:
- package.json
- ${artifactDir}/external-package-inventory.json
- ${artifactDir}/dep-tree.log

Write ${artifactDir}/packages.txt.

Include one concise line per runtime and development dependency with:
- package name
- version range from package.json
- why Ricky appears to use it

Dependencies in scope:
- Runtime: @agent-assistant/turn-context, @agent-relay/cloud, @agent-relay/sdk, @agentworkforce/harness-kit, @agentworkforce/workload-router, @inquirer/prompts, ora, ssh2
- Development: @types/node, esbuild, tsx, typescript, vitest

End the file with PACKAGE_AUDIT_COMPLETE.`,
      verification: { type: 'file_exists', value: `${artifactDir}/packages.txt` },
    })

    .step('audit-gate', {
      type: 'deterministic',
      dependsOn: ['package-audit'],
      command: [
        `bash -lc 'set -euo pipefail`,
        `grep -Fq "PACKAGE_AUDIT_COMPLETE" "${artifactDir}/packages.txt"`,
        `echo "Marker PACKAGE_AUDIT_COMPLETE found"`,
        // Derive required package names from the inventory and verify each appears
        `for pkg in $(node -e "const inv = JSON.parse(require(\\\"fs\\\").readFileSync(\\\"${artifactDir}/external-package-inventory.json\\\",\\\"utf8\\\")); Object.keys({...inv.runtime,...inv.development}).forEach(n=>console.log(n))"); do grep -Fq -- "$pkg" "${artifactDir}/packages.txt" || { echo "MISSING: $pkg"; exit 1; }; done`,
        `echo AUDIT_GATE_PASSED'`,
      ].join('\n'),
      captureOutput: true,
      failOnError: true,
    })

    .step('signoff', {
      agent: 'signoff-writer',
      dependsOn: ['audit-gate'],
      task: `Compile the external package check signoff.

Inputs:
- ${artifactDir}/routing.txt
- ${artifactDir}/external-package-inventory.json
- ${artifactDir}/dep-tree.status and ${artifactDir}/dep-tree.log
- ${artifactDir}/typecheck.status and ${artifactDir}/typecheck.log
- ${artifactDir}/test.status and ${artifactDir}/test.log
- ${artifactDir}/packages.txt

Write ${artifactDir}/signoff.md with:
- local, cloud, and MCP execution routing
- dependency tree result
- typecheck result
- Vitest result
- package audit summary
- remaining risks or environmental blockers

End the file with EXTERNAL_PACKAGE_CHECKS_READY.`,
      verification: { type: 'file_exists', value: `${artifactDir}/signoff.md` },
    })

    .step('signoff-gate', {
      type: 'deterministic',
      dependsOn: ['signoff'],
      command: [
        `bash -lc 'set -euo pipefail`,
        `grep -Fq "EXTERNAL_PACKAGE_CHECKS_READY" "${artifactDir}/signoff.md"`,
        `echo "Marker EXTERNAL_PACKAGE_CHECKS_READY found"`,
        `grep -Fq "exit_code=0" "${artifactDir}/dep-tree.status"`,
        `grep -Fq "exit_code=0" "${artifactDir}/typecheck.status"`,
        `grep -Fq "exit_code=0" "${artifactDir}/test.status"`,
        `echo "All status files report exit_code=0"`,
        `echo SIGNOFF_GATE_PASSED'`,
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
