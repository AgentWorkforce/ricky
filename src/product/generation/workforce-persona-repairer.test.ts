import { describe, expect, it } from 'vitest';

import type { WorkforcePersonaExecution, WorkforcePersonaResolver } from './workforce-persona-writer.js';
import { buildWorkflowRepairPersonaTask, repairWorkflowWithWorkforcePersona } from './workforce-persona-repairer.js';

describe('workforce persona workflow repairer', () => {
  it('builds a repair task with artifact content, failure evidence, resume details, and response contract', () => {
    const task = buildWorkflowRepairPersonaTask({
      repoRoot: '/repo',
      artifactPath: 'workflows/generated/failing.ts',
      artifactContent: workflowSource('before'),
      evidence: { runId: 'relay-run-1', status: 'failed' },
      classification: { failureClass: 'environment_error' },
      debuggerResult: { repairMode: 'guided', summary: 'missing setup' },
      blocker: { code: 'MISSING_ENV_VAR' },
      failedStep: 'install-deps',
      previousRunId: 'relay-run-1',
      attempt: 1,
      maxAttempts: 3,
    });

    expect(task).toContain('Repair an Agent Relay workflow artifact for Ricky');
    expect(task).toContain('workflows/generated/failing.ts');
    expect(task).toContain('workflow("before")');
    expect(task).toContain('"failedStep": "install-deps"');
    expect(task).toContain('"previousRunId": "relay-run-1"');
    expect(task).toContain('--start-from');
    expect(task).toContain('Structured response contract');
    expect(task).toContain('Do not echo the schema, do not return a patch');
  });

  it('invokes the workflow persona and returns a full repaired artifact', async () => {
    const sendMessageOptions: Array<Record<string, unknown>> = [];
    const resolverOptions: Array<Record<string, unknown>> = [];
    const resolver: WorkforcePersonaResolver = async (_intents, options) => {
      resolverOptions.push(options);
      return {
        source: 'package',
        intent: 'agent-relay-workflow',
        warnings: ['resolver warning'],
        context: {
          selection: {
            personaId: 'agent-relay-workflow',
            tier: 'best',
            runtime: { harness: 'codex', model: 'codex/test' },
          },
          sendMessage(_task, options) {
            sendMessageOptions.push((options ?? {}) as Record<string, unknown>);
            return execution(JSON.stringify({
              artifact: {
                path: 'workflows/generated/failing.ts',
                content: workflowSource('after'),
              },
              metadata: {
                summary: 'patched failing setup step',
                failedStep: 'install-deps',
              },
            }));
          },
        },
      };
    };

    const result = await repairWorkflowWithWorkforcePersona({
      repoRoot: '/repo',
      artifactPath: 'workflows/generated/failing.ts',
      artifactContent: workflowSource('before'),
      evidence: { runId: 'relay-run-1', status: 'failed' },
      classification: { failureClass: 'environment_error' },
      debuggerResult: { repairMode: 'guided', summary: 'missing setup' },
      failedStep: 'install-deps',
      previousRunId: 'relay-run-1',
      attempt: 1,
      maxAttempts: 3,
      installSkills: false,
      installRoot: '/state/ricky/persona-repair-skills',
      resolver,
    });

    expect(result.artifact.content).toContain('workflow("after")');
    expect(result.artifact.metadata).toMatchObject({ summary: 'patched failing setup step' });
    expect(result.metadata).toMatchObject({
      personaId: 'agent-relay-workflow',
      selectedIntent: 'agent-relay-workflow',
      runId: 'persona-repair-run-1',
      warnings: ['resolver warning'],
    });
    expect(sendMessageOptions[0]).toMatchObject({
      workingDirectory: '/repo',
      installSkills: false,
      inputs: {
        outputPath: 'workflows/generated/failing.ts',
        failedStep: 'install-deps',
        previousRunId: 'relay-run-1',
        attempt: 1,
        maxAttempts: 3,
      },
    });
    expect(resolverOptions).toEqual([{ tier: 'best', installRoot: '/state/ricky/persona-repair-skills' }]);
  });
});

function execution(output: string): WorkforcePersonaExecution {
  const promise = Promise.resolve({
    status: 'completed' as const,
    output,
    stderr: '',
    exitCode: 0,
    durationMs: 42,
    workflowRunId: 'persona-repair-run-1',
    stepName: 'agent-relay-workflow',
  }) as WorkforcePersonaExecution;
  Object.defineProperty(promise, 'runId', { value: Promise.resolve('persona-repair-run-1') });
  promise.cancel = () => {};
  return promise;
}

function workflowSource(name: string): string {
  return [
    'import { workflow } from "@agent-relay/sdk/workflows";',
    '',
    'async function main() {',
    `  await workflow("${name}")`,
    '    .description("Persona repaired workflow")',
    '    .pattern("pipeline")',
    '    .channel("wf-ricky-repair")',
    '    .step("verify", { type: "deterministic", command: "echo ok", verification: { type: "exit_code" } })',
    '    .run({ cwd: process.cwd() });',
    '}',
    '',
    'main().catch((error) => {',
    '  console.error(error);',
    '  process.exitCode = 1;',
    '});',
    '',
  ].join('\n');
}
