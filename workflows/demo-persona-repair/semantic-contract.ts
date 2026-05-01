// Demo workflow for exercising Ricky's Workforce persona repair path.
//
// This failure is intentionally semantic rather than syntactic or a simple
// file/output mismatch. Ricky's bounded deterministic repairer should leave it
// alone, so auto-fix must delegate the artifact repair to a Workforce persona.
//
// Local manual run:
//   npx tsx src/surfaces/cli/commands/cli-main.ts run \
//     workflows/demo-persona-repair/semantic-contract.ts \
//     --foreground

import { workflow } from '@agent-relay/sdk/workflows';

const artifactDir = '.workflow-artifacts/demo-persona-repair/semantic-contract';

async function main() {
  const result = await workflow('ricky-demo-persona-repair-semantic-contract')
    .description('Deliberately broken workflow that requires persona-level semantic repair.')
    .pattern('pipeline')
    .channel('wf-ricky-demo-persona-repair')
    .maxConcurrency(1)
    .timeout(120_000)
    .onError('fail-fast')

    .step('prepare-contract', {
      type: 'deterministic',
      command: `mkdir -p ${artifactDir}`,
      captureOutput: true,
      failOnError: true,
    })

    .step('write-contract', {
      type: 'deterministic',
      dependsOn: ['prepare-contract'],
      command: [
        'node',
        '-e',
        JSON.stringify([
          "const { mkdirSync, writeFileSync } = require('node:fs');",
          `mkdirSync(${JSON.stringify(artifactDir)}, { recursive: true });`,
          `writeFileSync(${JSON.stringify(`${artifactDir}/contract.json`)}, JSON.stringify({ status: 'draft', approvals: 0 }, null, 2));`,
        ].join(' ')),
      ].join(' '),
      captureOutput: true,
      failOnError: true,
    })

    .step('verify-contract-ready', {
      type: 'deterministic',
      dependsOn: ['write-contract'],
      command: [
        'node',
        '-e',
        JSON.stringify([
          "const { readFileSync } = require('node:fs');",
          `const contract = JSON.parse(readFileSync(${JSON.stringify(`${artifactDir}/contract.json`)}, 'utf8'));`,
          "if (contract.status !== 'ready' || contract.approvals < 1) {",
          "  console.error('contract must be ready with at least one approval; got status=' + contract.status + ', approvals=' + contract.approvals);",
          '  process.exit(1);',
          '}',
          "console.log('contract ready');",
        ].join(' ')),
      ].join(' '),
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
