// Demo workflow with three obvious mistakes for Ricky's auto-fix loop to repair.
//
// Run it attached so you can watch the failure -> repair -> resume cycle:
//
//   ricky run workflows/demo-auto-fix/broken-greeting.ts --foreground
//
// Mistakes baked in (each one fails at runtime so Ricky has clear evidence):
//   1) write-greeting writes greeting.txt, but verify-greeting checks for hello.txt (file_exists mismatch)
//   2) emit-done echoes "DONE" but its verification expects output_contains "COMPLETE" (wrong sentinel)
//   3) summary uses {{steps.write-greeting.output}} for a step that doesn't exist (write-greeting is the real id)

import { workflow } from '@agent-relay/sdk/workflows';

const artifactDir = '.workflow-artifacts/demo-auto-fix/broken-greeting';

async function main() {
  const result = await workflow('ricky-demo-broken-greeting')
    .description('Deliberately broken demo workflow for exercising Ricky auto-fix.')
    .pattern('pipeline')
    .channel('wf-ricky-demo-broken-greeting')
    .maxConcurrency(1)
    .timeout(120_000)
    .onError('fail-fast')

    .step('prepare', {
      type: 'deterministic',
      command: `mkdir -p ${artifactDir}`,
      captureOutput: true,
      failOnError: true,
    })

    // Mistake 1: writes greeting.txt, but verify-greeting tests for hello.txt.
    .step('write-greeting', {
      type: 'deterministic',
      dependsOn: ['prepare'],
      command: `printf '%s\\n' 'hello world' > ${artifactDir}/greeting.txt`,
      captureOutput: true,
      failOnError: true,
    })

    .step('verify-greeting', {
      type: 'deterministic',
      dependsOn: ['write-greeting'],
      command: `test -f ${artifactDir}/greeting.txt`,
      captureOutput: true,
      failOnError: true,
    })

    // Mistake 2: emits "DONE" but verification expects "COMPLETE".
    .step('emit-done', {
      type: 'deterministic',
      dependsOn: ['verify-greeting'],
      command: `echo COMPLETE`,
      captureOutput: true,
      failOnError: true,
      verification: { type: 'output_contains', value: 'COMPLETE' },
    })

    // Mistake 3: references {{steps.write-greeting.output}} but the step is named write-greeting.
    .step('summary', {
      type: 'deterministic',
      dependsOn: ['emit-done'],
      command: `printf 'pipeline complete: %s\\n' '{{steps.write-greeting.output}}' > ${artifactDir}/summary.txt`,
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
