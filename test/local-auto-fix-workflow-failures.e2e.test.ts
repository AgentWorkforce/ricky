import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { runLocal } from '../src/local/entrypoint.js';
import type { RawHandoff } from '../src/local/request-normalizer.js';

describe('local auto-fix workflow failure ladder', () => {
  it('repairs increasingly difficult deterministic workflow failures and resumes locally', async () => {
    const repo = await mkdtemp(join(tmpdir(), 'ricky-auto-fix-ladder-'));
    try {
      await mkdir(join(repo, 'workflows/generated'), { recursive: true });

      for (const testCase of workflowFailureCases()) {
        const artifactPath = `workflows/generated/${testCase.name}.ts`;
        await writeFile(join(repo, artifactPath), testCase.content, 'utf8');

        const result = await runLocal(localArtifactHandoff(artifactPath, repo));
        const repairedContent = await readFile(join(repo, artifactPath), 'utf8');

        expect(result.ok, testCase.name).toBe(true);
        expect(result.execution?.status, testCase.name).toBe('success');
        expect(result.auto_fix, testCase.name).toMatchObject({
          max_attempts: 3,
          final_status: 'ok',
          resumed: true,
          attempts: [
            {
              attempt: 1,
              status: 'blocker',
              blocker_code: 'INVALID_ARTIFACT',
              failed_step: testCase.failedStep,
              applied_fix: expect.objectContaining({
                mode: 'deterministic',
                artifact_path: artifactPath,
                summary: expect.stringContaining('bounded deterministic workflow repair'),
              }),
            },
            { attempt: 2, status: 'ok' },
          ],
        });
        expect(result.execution?.execution.command, testCase.name).toContain(`--start-from ${testCase.failedStep}`);
        expect(result.execution?.execution.command, testCase.name).toContain('--previous-run-id');
        for (const expected of testCase.expectedRepairs) {
          expect(repairedContent, testCase.name).toContain(expected);
        }
        for (const rejected of testCase.rejectedRepairs) {
          expect(repairedContent, testCase.name).not.toContain(rejected);
        }
      }
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  }, 60_000);
});

interface WorkflowFailureCase {
  name: string;
  failedStep: string;
  content: string;
  expectedRepairs: string[];
  rejectedRepairs: string[];
}

function localArtifactHandoff(artifactPath: string, repo: string): RawHandoff {
  return {
    source: 'workflow-artifact',
    artifactPath,
    invocationRoot: repo,
    mode: 'local',
    stageMode: 'run',
    autoFix: { maxAttempts: 3 },
  };
}

function workflowFailureCases(): WorkflowFailureCase[] {
  return [
    {
      name: '01-file-materialization-mismatch',
      failedStep: 'verify-file',
      content: workflowSource({
        workflowId: 'ricky-auto-fix-file-materialization',
        artifactDir: '.workflow-artifacts/local-auto-fix/file-materialization',
        steps: [
          `.step('prepare', {
      type: 'deterministic',
      command: \`mkdir -p \${artifactDir}\`,
      captureOutput: true,
      failOnError: true,
    })`,
          `.step('write-file', {
      type: 'deterministic',
      dependsOn: ['prepare'],
      command: \`printf '%s\\\\n' 'hello' > \${artifactDir}/actual.txt\`,
      captureOutput: true,
      failOnError: true,
    })`,
          `.step('verify-file', {
      type: 'deterministic',
      dependsOn: ['write-file'],
      command: \`test -f \${artifactDir}/expected.txt\`,
      captureOutput: true,
      failOnError: true,
    })`,
        ],
      }),
      expectedRepairs: ['test -f ${artifactDir}/actual.txt'],
      rejectedRepairs: ['test -f ${artifactDir}/expected.txt'],
    },
    {
      name: '02-output-sentinel-mismatch',
      failedStep: 'emit-done',
      content: workflowSource({
        workflowId: 'ricky-auto-fix-output-sentinel',
        artifactDir: '.workflow-artifacts/local-auto-fix/output-sentinel',
        steps: [
          `.step('prepare', {
      type: 'deterministic',
      command: \`mkdir -p \${artifactDir}\`,
      captureOutput: true,
      failOnError: true,
    })`,
          `.step('emit-done', {
      type: 'deterministic',
      dependsOn: ['prepare'],
      command: \`echo DONE\`,
      captureOutput: true,
      failOnError: true,
      verification: { type: 'output_contains', value: 'COMPLETE' },
    })`,
        ],
      }),
      expectedRepairs: ['command: `echo COMPLETE`'],
      rejectedRepairs: ['command: `echo DONE`'],
    },
    {
      name: '03-combined-file-output-template-mismatch',
      failedStep: 'verify-greeting',
      content: workflowSource({
        workflowId: 'ricky-auto-fix-combined-mismatches',
        artifactDir: '.workflow-artifacts/local-auto-fix/combined',
        steps: [
          `.step('prepare', {
      type: 'deterministic',
      command: \`mkdir -p \${artifactDir}\`,
      captureOutput: true,
      failOnError: true,
    })`,
          `.step('write-greeting', {
      type: 'deterministic',
      dependsOn: ['prepare'],
      command: \`printf '%s\\\\n' 'hello world' > \${artifactDir}/greeting.txt\`,
      captureOutput: true,
      failOnError: true,
    })`,
          `.step('verify-greeting', {
      type: 'deterministic',
      dependsOn: ['write-greeting'],
      command: \`test -f \${artifactDir}/hello.txt\`,
      captureOutput: true,
      failOnError: true,
    })`,
          `.step('emit-done', {
      type: 'deterministic',
      dependsOn: ['verify-greeting'],
      command: \`echo DONE\`,
      captureOutput: true,
      failOnError: true,
      verification: { type: 'output_contains', value: 'COMPLETE' },
    })`,
          `.step('summary', {
      type: 'deterministic',
      dependsOn: ['emit-done'],
      command: \`printf 'pipeline complete: %s\\\\n' '{{steps.write-message.output}}' > \${artifactDir}/summary.txt\`,
      captureOutput: true,
      failOnError: true,
    })`,
        ],
      }),
      expectedRepairs: [
        'test -f ${artifactDir}/greeting.txt',
        'command: `echo COMPLETE`',
        '{{steps.write-greeting.output}}',
      ],
      rejectedRepairs: [
        'test -f ${artifactDir}/hello.txt',
        'command: `echo DONE`',
        '{{steps.write-message.output}}',
      ],
    },
  ];
}

function workflowSource(input: { workflowId: string; artifactDir: string; steps: string[] }): string {
  return `import { workflow } from '@agent-relay/sdk/workflows';

const artifactDir = '${input.artifactDir}';

async function main() {
  const result = await workflow('${input.workflowId}')
    .description('Local Ricky auto-fix test workflow.')
    .pattern('pipeline')
    .channel('wf-${input.workflowId}')
    .maxConcurrency(1)
    .timeout(120_000)
    .onError('fail-fast')

    ${input.steps.join('\n\n    ')}

    .run({ cwd: process.cwd() });

  console.log(result.status);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
`;
}
