import { workflow } from '@agent-relay/sdk/workflows';

async function main() {
  const result = await workflow('ricky-wave8-close-local-run-product-loop')
    .description('Close the remaining Ricky local interactive execution loop by proving the current --run and ricky run artifact journeys and tightening any truthful blocker/output gaps that remain.')
    .pattern('dag')
    .channel('wf-ricky-wave8-local-run-product-loop')
    .agent('impl-codex', {
      cli: 'codex',
      preset: 'worker',
      role: 'Tightens Ricky local execution output and blocker behavior against the current product contract.',
      retries: 1,
    })
    .step('inspect-current-surface', {
      type: 'deterministic',
      command: [
        'mkdir -p .workflow-artifacts/wave8-github-issues/close-local-run-product-loop',
        'sed -n "1,260p" packages/cli/src/commands/cli-main.ts > .workflow-artifacts/wave8-github-issues/close-local-run-product-loop/cli-main.txt',
        'sed -n "1,260p" packages/cli/src/entrypoint/interactive-cli.ts > .workflow-artifacts/wave8-github-issues/close-local-run-product-loop/interactive-cli.txt',
        'sed -n "1,360p" packages/local/src/entrypoint.ts > .workflow-artifacts/wave8-github-issues/close-local-run-product-loop/local-entrypoint.txt',
        'echo INSPECT_CURRENT_SURFACE_OK',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })
    .step('prove-local-run-journeys', {
      type: 'deterministic',
      dependsOn: ['inspect-current-surface'],
      command: [
        'npm run typecheck',
        'npm test --workspace @ricky/local --workspace @ricky/cli',
        'node -e "console.log(\'LOCAL_RUN_PRODUCT_LOOP_PROOF_READY\')"',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })
    .step('signoff', {
      agent: 'impl-codex',
      dependsOn: ['prove-local-run-journeys'],
      task: `Write a short signoff at .workflow-artifacts/wave8-github-issues/close-local-run-product-loop/signoff.md summarizing whether the current --run and ricky run artifact journeys now meet the product contract for truthful execution vs blocker handling. End the file with RICKY_WAVE8_LOCAL_RUN_PRODUCT_LOOP_SIGNOFF.`,
      verification: { type: 'file_exists', value: '.workflow-artifacts/wave8-github-issues/close-local-run-product-loop/signoff.md' },
    })
    .run({ cwd: process.cwd() });

  if (!result || result.status !== 'completed') {
    process.exitCode = 1;
  }
}

void main();
