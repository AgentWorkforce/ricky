import { workflow } from '@agent-relay/sdk/workflows';

async function main() {
  const result = await workflow('ricky-debug-codex-worker-runtime')
    .description('Minimal reproducer for Ricky live Codex worker execution and completion behavior.')
    .pattern('dag')
    .channel('wf-ricky-debug-codex-worker-runtime')
    .maxConcurrency(2)
    .timeout(900_000)
    .onError('retry', { maxRetries: 0, retryDelayMs: 1_000 })

    .agent('impl-codex', {
      cli: 'codex',
      preset: 'worker',
      role: 'Minimal bounded file-writing worker for runtime diagnosis.',
      retries: 1,
    })

    .step('prepare-artifacts', {
      type: 'deterministic',
      command: [
        'mkdir -p .workflow-artifacts/runtime-debug',
        'mkdir -p tmp/runtime-debug',
        'rm -f tmp/runtime-debug/codex-worker-output.txt',
        'echo RUNTIME_DEBUG_READY',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })
    .step('codex-write-file', {
      agent: 'impl-codex',
      dependsOn: ['prepare-artifacts'],
      task: `Write exactly one file to disk at tmp/runtime-debug/codex-worker-output.txt.

File contents must be exactly:
CODEx_WORKER_RUNTIME_OK

Rules:
- Write only that one file.
- Do not modify any other files.
- Do not print long explanations.
- After writing the file, exit cleanly.`,
      verification: { type: 'file_exists', value: 'tmp/runtime-debug/codex-worker-output.txt' },
    })
    .step('verify-file-contents', {
      type: 'deterministic',
      dependsOn: ['codex-write-file'],
      command: 'test -f tmp/runtime-debug/codex-worker-output.txt && grep -qx "CODEx_WORKER_RUNTIME_OK" tmp/runtime-debug/codex-worker-output.txt && echo RUNTIME_DEBUG_FILE_OK',
      captureOutput: true,
      failOnError: true,
    })
    .step('final-signoff', {
      type: 'deterministic',
      dependsOn: ['verify-file-contents'],
      command: 'printf "runtime debug complete\n" > .workflow-artifacts/runtime-debug/signoff.txt && echo RUNTIME_DEBUG_COMPLETE',
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
