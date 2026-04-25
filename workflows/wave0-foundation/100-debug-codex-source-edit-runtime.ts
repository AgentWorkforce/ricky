import { workflow } from '@agent-relay/sdk/workflows';

async function main() {
  const result = await workflow('ricky-debug-codex-source-edit-runtime')
    .description('Minimal reproducer for Ricky live Codex worker completion behavior when editing an existing source file.')
    .pattern('dag')
    .channel('wf-ricky-debug-codex-source-edit-runtime')
    .maxConcurrency(2)
    .timeout(900_000)
    .onError('retry', { maxRetries: 0, retryDelayMs: 1_000 })

    .agent('impl-codex', {
      cli: 'codex',
      preset: 'worker',
      role: 'Minimal bounded existing-source-file editor for runtime diagnosis.',
      retries: 1,
    })

    .step('prepare-artifacts', {
      type: 'deterministic',
      command: [
        'mkdir -p .workflow-artifacts/runtime-debug',
        'mkdir -p tmp/runtime-debug',
        `printf "export const SOURCE_EDIT_MARKER = 'BEFORE';\\n" > tmp/runtime-debug/source-edit-target.ts`,
        'echo SOURCE_EDIT_DEBUG_READY',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })
    .step('codex-edit-existing-file', {
      agent: 'impl-codex',
      dependsOn: ['prepare-artifacts'],
      task: `Edit only tmp/runtime-debug/source-edit-target.ts.

Change the file so it contains exactly:
export const SOURCE_EDIT_MARKER = 'AFTER';

Rules:
- Edit only that one existing file.
- Do not modify any other files.
- This is a file-writing step, not a report-writing step.
- Do not print a long stdout deliverable.
- After editing the file, emit at most a short one-line completion note and exit immediately.`,
      verification: { type: 'file_exists', value: 'tmp/runtime-debug/source-edit-target.ts' },
    })
    .step('verify-file-contents', {
      type: 'deterministic',
      dependsOn: ['codex-edit-existing-file'],
      command: "test -f tmp/runtime-debug/source-edit-target.ts && grep -qx \"export const SOURCE_EDIT_MARKER = 'AFTER';\" tmp/runtime-debug/source-edit-target.ts && echo SOURCE_EDIT_DEBUG_FILE_OK",
      captureOutput: true,
      failOnError: true,
    })
    .step('final-signoff', {
      type: 'deterministic',
      dependsOn: ['verify-file-contents'],
      command: 'printf "source edit runtime debug complete\n" > .workflow-artifacts/runtime-debug/source-edit-signoff.txt && echo SOURCE_EDIT_DEBUG_COMPLETE',
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
