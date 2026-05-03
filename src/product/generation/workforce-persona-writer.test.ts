import { describe, expect, it } from 'vitest';

import type { NormalizedWorkflowSpec, RawSpecPayload } from '../spec-intake/types.js';
import { generate, generateWithWorkforcePersona } from './pipeline.js';
import type { WorkforcePersonaExecution, WorkforcePersonaResolver } from './workforce-persona-writer.js';
import {
  buildWorkflowPersonaTask,
  loadWorkforcePersonaModule,
  loadWorkforceSelectionModule,
  parsePersonaWorkflowResponse,
  resolveWorkforcePersonaContextWithModules,
  WORKFORCE_PERSONA_INTENT_CANDIDATES,
} from './workforce-persona-writer.js';

const RECEIVED_AT = '2026-04-30T00:00:00.000Z';

describe('workforce persona workflow writer', () => {
  it('builds the one-shot persona task with spec, mode, repo, standards, contract, constraints, and evidence rules', () => {
    const task = buildWorkflowPersonaTask(spec(), {
      workflowName: 'release-health',
      targetMode: 'local',
      repoRoot: '/repo',
      outputPath: 'workflows/generated/release-health.ts',
      relevantFiles: [{ path: 'src/product/generation/pipeline.ts', content: 'export function generate() {}' }],
    });

    expect(task).toContain('Normalized spec JSON');
    expect(task).toContain('"workflowName": "release-health"');
    expect(task).toContain('"targetMode": "local"');
    expect(task).toContain('"repoRoot": "/repo"');
    expect(task).toContain('Agent Relay workflow standards');
    expect(task).toContain('Matched Ricky generation skills');
    expect(task).toContain('80-to-100 fix loop');
    expect(task).toContain('deterministic sanity gate');
    expect(task).toContain('grep, rg, git grep');
    expect(task).toContain('Keep agent steps bounded');
    expect(task).toContain('Structured response contract');
    expect(task).toContain('fenced ```ts artifact block plus a fenced ```json metadata block');
    expect(task).toContain('Relevant file context');
    expect(task).toContain('Auto-fix and repair expectations');
    expect(task).toContain('Evidence rules');
    expect(task).toContain('IMPLEMENTATION_WORKFLOW_CONTRACT');
    expect(task).toContain('must edit source files');
    expect(task).toContain('Do not satisfy implementation specs by only writing plan.md');
    expect(task).toContain('Do not open an interactive Claude, Codex, or OpenCode terminal UI');
  });

  it('defaults to the Agent Relay workflow-writing persona when harness-kit exposes runnable APIs', async () => {
    const calls: string[] = [];
    const resolved = await resolveWorkforcePersonaContextWithModules(
      WORKFORCE_PERSONA_INTENT_CANDIDATES,
      { tier: 'best' },
      {
        source: 'package',
        warnings: [],
        module: {
          useRunnablePersona(intent) {
            calls.push(intent);
            return runnableContext({ personaId: intent });
          },
        },
      },
    );

    expect(calls[0]).toBe('agent-relay-workflow');
    expect(resolved.intent).toBe('agent-relay-workflow');
    expect(resolved.context.selection.personaId).toBe('agent-relay-workflow');
    expect(resolved.context.selection.runtime.harness).toMatch(/^(claude|codex|opencode)$/);
    expect(typeof resolved.context.sendMessage).toBe('function');
  });

  it('parses structured JSON persona output and validates metadata', () => {
    const parsed = parsePersonaWorkflowResponse(JSON.stringify({
      artifact: {
        path: 'workflows/generated/persona.ts',
        content: workflowSource(),
      },
      metadata: {
        workflowName: 'persona',
        agents: ['lead'],
      },
    }), 'workflows/generated/persona.ts');

    expect(parsed.responseFormat).toBe('structured-json');
    expect(parsed.content).toContain('workflow("persona")');
    expect(parsed.metadata).toMatchObject({ workflowName: 'persona' });
  });

  it('parses fenced TypeScript artifact plus JSON metadata fallback', () => {
    const parsed = parsePersonaWorkflowResponse([
      '```ts',
      workflowSource(),
      '```',
      '```json',
      JSON.stringify({ path: 'workflows/generated/persona.ts', workflowName: 'persona' }),
      '```',
    ].join('\n'), 'workflows/generated/persona.ts');

    expect(parsed.responseFormat).toBe('fenced-artifact');
    expect(parsed.content).toContain('.run({ cwd: process.cwd() })');
    expect(parsed.metadata).toMatchObject({ workflowName: 'persona' });
  });

  it('invokes the spawned harness non-interactively (no TUI flag, structured-response contract)', async () => {
    const base = generate({
      spec: spec({
        description: 'Implement a strict Agent Relay workflow with tests and review.',
        targetFiles: ['src/product/generation/pipeline.ts'],
      }),
      artifactPath: 'workflows/generated/non-interactive.ts',
    });
    expect(base.success).toBe(true);
    const sendMessageOptions: Array<Record<string, unknown>> = [];
    const resolver: WorkforcePersonaResolver = async () => ({
      source: 'package',
      intent: 'agent-relay-workflow',
      warnings: [],
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
              path: 'workflows/generated/non-interactive.ts',
              content: base.artifact!.content,
            },
            metadata: { workflowName: 'non-interactive' },
          }));
        },
      },
    });

    const result = await generateWithWorkforcePersona({
      spec: spec({
        description: 'Implement a strict Agent Relay workflow with tests and review.',
        targetFiles: ['src/product/generation/pipeline.ts'],
      }),
      artifactPath: 'workflows/generated/non-interactive.ts',
      workforcePersonaWriter: {
        repoRoot: '/repo',
        workflowName: 'non-interactive',
        targetMode: 'local',
        installSkills: false,
        resolver,
      },
    });

    expect(result.success).toBe(true);
    expect(sendMessageOptions).toHaveLength(1);
    const passed = sendMessageOptions[0];
    expect(passed.workingDirectory).toBe('/repo');
    expect(passed.installSkills).toBe(false);
    expect(passed.mode).toBe('one-shot');
    expect(passed.responseFormat).toBe('structured-json-or-fenced-artifact');
    // Non-interactive contract: no TUI / interactive flag set on sendMessage.
    expect(passed).not.toHaveProperty('tty');
    expect(passed).not.toHaveProperty('interactive');
    expect(passed).not.toHaveProperty('stdio');
    expect((passed.inputs as Record<string, unknown>).outputPath).toBe(
      'workflows/generated/non-interactive.ts',
    );
  });

  it('errors instead of writing a file when the harness returns malformed text', async () => {
    const resolver: WorkforcePersonaResolver = async () => ({
      source: 'package',
      intent: 'agent-relay-workflow',
      warnings: [],
      context: {
        selection: {
          personaId: 'agent-relay-workflow',
          tier: 'best',
          runtime: { harness: 'codex', model: 'codex/test' },
        },
        sendMessage() {
          return execution('not a workflow at all — no fences, no JSON, no workflow() call');
        },
      },
    });

    const result = await generateWithWorkforcePersona({
      spec: spec(),
      artifactPath: 'workflows/generated/malformed.ts',
      workforcePersonaWriter: {
        repoRoot: '/repo',
        workflowName: 'malformed',
        targetMode: 'local',
        resolver,
      },
    });

    expect(result.success).toBe(false);
    const errorText = result.validation.errors.join(' | ');
    expect(errorText).toMatch(/workflow|persona|fenced|structured/i);
  });

  it('runs pre-write validation and asks the persona to repair invalid workflow syntax before succeeding', async () => {
    const base = generate({
      spec: spec({
        description: 'Implement a strict Agent Relay workflow with tests and review.',
        targetFiles: ['src/product/generation/pipeline.ts'],
      }),
      artifactPath: 'workflows/generated/prewrite-repair.ts',
    });
    expect(base.success).toBe(true);
    const tasks: string[] = [];
    const resolver: WorkforcePersonaResolver = async () => ({
      source: 'package',
      intent: 'agent-relay-workflow',
      warnings: [],
      context: {
        selection: {
          personaId: 'agent-relay-workflow',
          tier: 'best',
          runtime: { harness: 'codex', model: 'codex/test' },
        },
        sendMessage(task) {
          tasks.push(task);
          const content = tasks.length === 1
            ? `${base.artifact!.content}\n}`
            : base.artifact!.content;
          return execution(personaResponse('workflows/generated/prewrite-repair.ts', content));
        },
      },
    });

    const result = await generateWithWorkforcePersona({
      spec: spec({
        description: 'Implement a strict Agent Relay workflow with tests and review.',
        targetFiles: ['src/product/generation/pipeline.ts'],
      }),
      artifactPath: 'workflows/generated/prewrite-repair.ts',
      workforcePersonaWriter: {
        repoRoot: '/repo',
        workflowName: 'prewrite-repair',
        targetMode: 'local',
        resolver,
      },
    });

    expect(result.success).toBe(true);
    expect(result.artifact?.content).toBe(base.artifact!.content);
    expect(tasks).toHaveLength(2);
    expect(tasks[1]).toContain('Ricky pre-write validation failed');
    expect(tasks[1]).toContain('Rendered artifact has unbalanced braces');
    expect(tasks[1]).toContain('Previous rejected artifact');
    expect(result.workforcePersona?.warnings).toContain(
      'Ricky pre-write validation repaired the Workforce persona artifact before writing.',
    );
  });

  it('falls back to Ricky deterministic rendering when persona pre-write repair is still invalid', async () => {
    const base = generate({
      spec: spec({
        description: 'Implement a strict Agent Relay workflow with tests and review.',
        targetFiles: ['src/product/generation/pipeline.ts'],
      }),
      artifactPath: 'workflows/generated/prewrite-fallback.ts',
    });
    expect(base.success).toBe(true);
    const resolver: WorkforcePersonaResolver = async () => ({
      source: 'package',
      intent: 'agent-relay-workflow',
      warnings: [],
      context: {
        selection: {
          personaId: 'agent-relay-workflow',
          tier: 'best',
          runtime: { harness: 'codex', model: 'codex/test' },
        },
        sendMessage() {
          return execution(personaResponse(
            'workflows/generated/prewrite-fallback.ts',
            `${base.artifact!.content}\n}`,
          ));
        },
      },
    });

    const result = await generateWithWorkforcePersona({
      spec: spec({
        description: 'Implement a strict Agent Relay workflow with tests and review.',
        targetFiles: ['src/product/generation/pipeline.ts'],
      }),
      artifactPath: 'workflows/generated/prewrite-fallback.ts',
      workforcePersonaWriter: {
        repoRoot: '/repo',
        workflowName: 'prewrite-fallback',
        targetMode: 'local',
        resolver,
      },
    });

    expect(result.success).toBe(true);
    expect(result.artifact?.content).toBe(base.artifact!.content);
    expect(result.validation.warnings.join('\n')).toContain('used Ricky deterministic renderer instead');
    expect(result.workforcePersona?.warnings.join('\n')).toContain('used Ricky deterministic renderer instead');
  });

  it('adapts harness-kit useRunnablePersona into the sendMessage context Ricky expects', async () => {
    const calls: Array<{ intent: string; options: Record<string, unknown> | undefined }> = [];
    const resolved = await resolveWorkforcePersonaContextWithModules(
      ['agent-relay-workflow'],
      { tier: 'best', installRoot: '/state/ricky/persona-skills' },
      {
        source: 'package',
        warnings: [],
        module: {
          useRunnablePersona(intent, options) {
            calls.push({ intent, options: options as Record<string, unknown> | undefined });
            return runnableContext();
          },
        },
      },
    );

    expect(resolved.source).toBe('package');
    expect(resolved.intent).toBe('agent-relay-workflow');
    expect(calls).toEqual([
      {
        intent: 'agent-relay-workflow',
        options: { tier: 'best', installRoot: '/state/ricky/persona-skills' },
      },
    ]);
    const result = await resolved.context.sendMessage('task');
    expect(result.status).toBe('completed');
  });

  it('uses workload-router only for selection metadata when harness-kit needs useRunnableSelection', async () => {
    const selections: unknown[] = [];
    const resolved = await resolveWorkforcePersonaContextWithModules(
      ['relay-orchestrator'],
      { installRoot: '/state/ricky/persona-skills' },
      {
        source: 'package',
        warnings: [],
        module: {
          useRunnableSelection(selection, options) {
            selections.push({ selection, options });
            return runnableContext({ personaId: 'relay-orchestrator' });
          },
        },
      },
      async () => ({
        source: 'package',
        warnings: [],
        module: {
          usePersona(intent) {
            return {
              selection: {
                personaId: intent,
                tier: 'best',
                runtime: { harness: 'claude', model: 'claude/test' },
                skills: [],
                rationale: 'test metadata',
              },
            };
          },
        },
      }),
    );

    expect(resolved.context.selection.personaId).toBe('relay-orchestrator');
    expect(selections).toHaveLength(1);
    expect(selections[0]).toMatchObject({
      selection: { personaId: 'relay-orchestrator' },
      options: { installRoot: '/state/ricky/persona-skills' },
    });
  });

  it('invokes the selected Workforce persona through runnable sendMessage and persists metadata', async () => {
    const base = generate({
      spec: spec({
        description: 'Implement a strict Agent Relay workflow with tests and review.',
        targetFiles: ['src/product/generation/pipeline.ts'],
      }),
      artifactPath: 'workflows/generated/workforce-writer.ts',
    });
    expect(base.success).toBe(true);

    const calls: Array<{ intents: readonly string[]; task: string }> = [];
    const resolver: WorkforcePersonaResolver = async (intents) => ({
      source: 'package',
      intent: 'agent-relay-workflow',
      warnings: ['resolver warning'],
      context: {
        selection: {
          personaId: 'agent-relay-workflow',
          tier: 'best',
          runtime: {
            harness: 'codex',
            model: 'openai-codex/gpt-5.3-codex',
            harnessSettings: { timeoutSeconds: 1200, reasoning: 'high' },
          },
        },
        sendMessage(task) {
          calls.push({ intents, task });
          return execution(JSON.stringify({
            artifact: {
              path: 'workflows/generated/workforce-writer.ts',
              content: base.artifact!.content,
            },
            metadata: {
              workflowName: 'workforce-writer',
              evidence: ['typecheck', 'tests'],
            },
          }));
        },
      },
    });

    const result = await generateWithWorkforcePersona({
      spec: spec({
        description: 'Implement a strict Agent Relay workflow with tests and review.',
        targetFiles: ['src/product/generation/pipeline.ts'],
      }),
      artifactPath: 'workflows/generated/workforce-writer.ts',
      workforcePersonaWriter: {
        repoRoot: '/repo',
        workflowName: 'workforce-writer',
        targetMode: 'local',
        resolver,
      },
    });

    expect(result.success).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].intents).toEqual(WORKFORCE_PERSONA_INTENT_CANDIDATES);
    expect(calls[0].task).toContain('"repoRoot": "/repo"');
    expect(calls[0].task).toContain('"outputPath": "workflows/generated/workforce-writer.ts"');
    expect(calls[0].task).toContain('"loadedSkills"');
    expect(calls[0].task).toContain('choosing-swarm-patterns');
    expect(calls[0].task).toContain('Quick Decision Framework');
    expect(result.workforcePersona).toMatchObject({
      personaId: 'agent-relay-workflow',
      tier: 'best',
      harness: 'codex',
      model: 'openai-codex/gpt-5.3-codex',
      runId: 'persona-run-001',
      source: 'package',
      selectedIntent: 'agent-relay-workflow',
      responseFormat: 'structured-json',
      outputPath: 'workflows/generated/workforce-writer.ts',
    });
    expect(result.workforcePersona?.promptDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(result.workforcePersona?.warnings).toEqual(['resolver warning']);
    expect(result.artifact?.content).toBe(base.artifact!.content);
  });

  it('uses a runnable usePersona(...).sendMessage seam when harness-kit is unavailable', async () => {
    const resolved = await resolveWorkforcePersonaContextWithModules(
      ['agent-relay-workflow'],
      { tier: 'best' },
      {
        source: 'package',
        warnings: ['harness-kit unavailable'],
        module: {},
      },
      async () => ({
        source: 'package',
        warnings: ['using packaged workload-router fallback'],
        module: {
          usePersona(intent, options) {
            return runnableContext({ personaId: intent, tier: options?.tier ?? 'minimum' });
          },
        },
      }),
    );

    expect(resolved.source).toBe('package');
    expect(resolved.intent).toBe('agent-relay-workflow');
    expect(resolved.context.selection).toMatchObject({
      personaId: 'agent-relay-workflow',
      tier: 'best',
    });
    expect(resolved.warnings).toEqual([
      'harness-kit unavailable',
      'using packaged workload-router fallback',
    ]);
    const result = await resolved.context.sendMessage('task');
    expect(result.status).toBe('completed');
  });

  it('preserves npm load failure wording when harness-kit cannot be imported', async () => {
    const failImport = async () => {
      throw new Error('simulated package load failure');
    };

    await expect(loadWorkforcePersonaModule(failImport)).rejects.toMatchObject({
      name: 'WorkforcePersonaWriterError',
      message: expect.stringContaining('@agentworkforce/harness-kit could not be loaded'),
      warnings: [expect.stringContaining('simulated package load failure')],
    });
  });

  it('preserves missing-export wording when harness-kit imports but lacks runnable APIs', async () => {
    const importWrongShape = async () => ({
      buildInteractiveSpec() {
        return {};
      },
    });

    await expect(loadWorkforcePersonaModule(importWrongShape)).rejects.toMatchObject({
      name: 'WorkforcePersonaWriterError',
      message: expect.stringContaining('does not expose the runnable persona API'),
      warnings: [expect.stringContaining('exports: buildInteractiveSpec')],
    });
  });

  it('preserves npm load failure wording when workload-router cannot be imported', async () => {
    const failImport = async () => {
      throw new Error('simulated router load failure');
    };

    await expect(loadWorkforceSelectionModule(failImport)).rejects.toMatchObject({
      name: 'WorkforcePersonaWriterError',
      message: expect.stringContaining('@agentworkforce/workload-router could not be loaded'),
      warnings: [expect.stringContaining('simulated router load failure')],
    });
  });

  it('preserves missing-export wording when workload-router imports but lacks usePersona', async () => {
    const importWrongShape = async () => ({
      resolvePersona() {
        return {};
      },
    });

    await expect(loadWorkforceSelectionModule(importWrongShape)).rejects.toMatchObject({
      name: 'WorkforcePersonaWriterError',
      message: expect.stringContaining('does not expose the persona selection API'),
      warnings: [expect.stringContaining('exports: resolvePersona')],
    });
  });
});

function runnableContext(overrides: Partial<{
  personaId: string;
  tier: string;
  harness: string;
  model: string;
}> = {}) {
  return {
    selection: {
      personaId: overrides.personaId ?? 'agent-relay-workflow',
      tier: overrides.tier ?? 'best',
      runtime: {
        harness: overrides.harness ?? 'codex',
        model: overrides.model ?? 'codex/test',
      },
    },
    sendMessage() {
      return execution(JSON.stringify({
        artifact: {
          path: 'workflows/generated/persona.ts',
          content: workflowSource(),
        },
        metadata: { workflowName: 'persona' },
      }));
    },
  };
}

function execution(output: string): WorkforcePersonaExecution {
  const promise = Promise.resolve({
    status: 'completed' as const,
    output,
    stderr: '',
    exitCode: 0,
    durationMs: 42,
    workflowRunId: 'persona-run-001',
    stepName: 'agent-relay-workflow',
  }) as WorkforcePersonaExecution;
  Object.defineProperty(promise, 'runId', { value: Promise.resolve('persona-run-001') });
  promise.cancel = () => {};
  return promise;
}

function personaResponse(path: string, content: string): string {
  return JSON.stringify({
    artifact: {
      path,
      content,
    },
    metadata: { workflowName: path.split('/').pop()?.replace(/\.ts$/, '') },
  });
}

function workflowSource(): string {
  return [
    'import { workflow } from "@agent-relay/sdk/workflows";',
    '',
    'async function main() {',
    '  await workflow("persona")',
    '    .description("Persona generated workflow")',
    '    .pattern("pipeline")',
    '    .channel("wf-ricky-persona")',
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

function spec(overrides: { description?: string; targetFiles?: string[] } = {}): NormalizedWorkflowSpec {
  const description = overrides.description ?? 'Generate a workflow for deterministic product work.';
  const rawPayload: RawSpecPayload = {
    kind: 'natural_language',
    surface: 'cli',
    receivedAt: RECEIVED_AT,
    requestId: 'workforce-writer-test',
    text: description,
  };
  const providerContext = {
    surface: 'cli' as const,
    requestId: rawPayload.requestId,
    metadata: {},
  };
  const targetFiles = overrides.targetFiles ?? ['src/product/generation/workforce-persona-writer.ts'];
  return {
    intent: 'generate',
    description,
    targetRepo: null,
    targetContext: null,
    targetFiles,
    desiredAction: {
      kind: 'generate',
      summary: description,
      specText: description,
      targetFiles,
    },
    constraints: [{ constraint: 'Must include deterministic validation.', category: 'quality' }],
    evidenceRequirements: [{ requirement: 'Record typecheck and tests.', verificationType: 'output_contains' }],
    requiredEvidence: [{ requirement: 'Record typecheck and tests.', verificationType: 'output_contains' }],
    acceptanceGates: [{ gate: 'npx tsc --noEmit', kind: 'deterministic' }],
    acceptanceCriteria: [{ gate: 'npx tsc --noEmit', kind: 'deterministic' }],
    providerContext,
    sourceSpec: {
      surface: 'cli',
      intent: { primary: 'generate', signals: ['test fixture'] },
      description,
      targetRepo: undefined,
      targetContext: undefined,
      targetFiles,
      constraints: ['Must include deterministic validation.'],
      evidenceRequirements: ['Record typecheck and tests.'],
      acceptanceGates: ['npx tsc --noEmit'],
      providerContext,
      rawPayload,
      parseConfidence: 'high',
      parseWarnings: [],
    },
    executionPreference: 'auto',
  };
}
