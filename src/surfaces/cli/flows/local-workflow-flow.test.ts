import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { tmpdir } from 'node:os';
import { describe, expect, it, vi } from 'vitest';

import type { LocalResponse } from '../../../local/entrypoint.js';
import { PromptCancelledError } from '../prompts/index.js';
import { createInquirerLocalWorkflowPrompts, runLocalPreflight, runLocalWorkflowFlow } from './local-workflow-flow.js';

vi.mock('@inquirer/prompts', () => {
  return {
    select: vi.fn(),
    input: vi.fn(),
    editor: vi.fn(),
  };
});

async function makeRepo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'ricky-local-flow-'));
  await mkdir(join(dir, '.git'), { recursive: true });
  await mkdir(join(dir, 'node_modules/.bin'), { recursive: true });
  await mkdir(join(dir, 'docs/product'), { recursive: true });
  await mkdir(join(dir, '.ricky'), { recursive: true });
  await mkdir(join(dir, 'workflows/generated'), { recursive: true });
  await writeFile(join(dir, 'package.json'), JSON.stringify({ packageManager: 'npm@11.11.0' }), 'utf8');
  await writeFile(join(dir, 'SPEC.md'), '# Local spec\n', 'utf8');
  await writeFile(join(dir, '.ricky/config.json'), '{}\n', 'utf8');
  await writeFile(join(dir, 'workflows/generated/existing.ts'), 'workflow("existing")\n', 'utf8');
  await writeFile(join(dir, 'node_modules/.bin/agent-relay'), '#!/bin/sh\n', 'utf8');
  await chmod(join(dir, 'node_modules/.bin/agent-relay'), 0o755);
  return dir;
}

describe('guided local prompt cancellation normalization', () => {
  it('translates inquirer ExitPromptError into PromptCancelledError on every guided prompt', async () => {
    const { select, input, editor } = await import('@inquirer/prompts');
    const exitError = Object.assign(new Error('user pressed ctrl+c'), { name: 'ExitPromptError' });
    const abortError = Object.assign(new Error('aborted'), { name: 'AbortPromptError' });
    (select as unknown as { mockRejectedValueOnce: (e: unknown) => void }).mockRejectedValueOnce(exitError);
    (input as unknown as { mockRejectedValueOnce: (e: unknown) => void }).mockRejectedValueOnce(abortError);
    (editor as unknown as { mockRejectedValueOnce: (e: unknown) => void }).mockRejectedValueOnce(exitError);

    const prompts = createInquirerLocalWorkflowPrompts();
    await expect(prompts.selectSpecSource({ suggestions: [] })).rejects.toBeInstanceOf(PromptCancelledError);
    await expect(prompts.inputSpecFilePath({ suggestions: [] })).rejects.toBeInstanceOf(PromptCancelledError);
    await expect(prompts.editSpec({ initialValue: '', message: 'spec' })).rejects.toBeInstanceOf(PromptCancelledError);
  });

  it('prints the generated spec and workflow summary before approval prompts', async () => {
    const { select } = await import('@inquirer/prompts');
    const mockedSelect = select as unknown as {
      mockResolvedValueOnce: (value: unknown) => unknown;
    };
    mockedSelect.mockResolvedValueOnce('approve');
    mockedSelect.mockResolvedValueOnce('not-now');

    const output = new PassThrough();
    let rendered = '';
    output.on('data', (chunk) => {
      rendered += chunk.toString('utf8');
    });

    const prompts = createInquirerLocalWorkflowPrompts({ output });
    await prompts.approveGeneratedSpec({
      goal: 'verify release health',
      spec: 'Goal: verify release health\n\nSafety:\n- Pause before commits.',
    });
    await prompts.confirmRun({
      summary: {
        artifactPath: 'workflows/generated/release-health.ts',
        goal: 'verify release health',
        agents: [{ name: 'codex', job: 'Run checks' }],
        jobs: ['codex: Run checks'],
        plan: ['Generate workflow artifact workflows/generated/release-health.ts.'],
        desiredOutcome: 'Local run with evidence.',
        sideEffects: ['Write workflow artifact workflows/generated/release-health.ts'],
        missingLocalBlockers: ['agent-relay: install dependencies'],
        command: 'ricky run workflows/generated/release-health.ts',
      },
    });

    expect(rendered).toContain('Generated spec');
    expect(rendered).toContain('Goal: verify release health');
    expect(rendered).toContain('Ricky wrote: workflows/generated/release-health.ts');
    expect(rendered).toContain('Agents');
    expect(rendered).toContain('Missing local blockers');
    expect(rendered).toContain('Run command: ricky run workflows/generated/release-health.ts');
  });
});

describe('local workflow flow', () => {
  it('preflights repo root, package manager, local tools, config, and spec locations', async () => {
    const repo = await makeRepo();
    try {
      const preflight = await runLocalPreflight(join(repo, 'docs/product'));

      expect(preflight.repoRoot).toBe(repo);
      expect(preflight.packageManager).toBe('npm');
      expect(preflight.checks).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: 'agent-relay', status: 'found' }),
        expect.objectContaining({ id: 'claude' }),
        expect.objectContaining({ id: 'codex' }),
        expect.objectContaining({ id: 'opencode' }),
        expect.objectContaining({ id: 'gemini' }),
        expect.objectContaining({ id: '.ricky/config.json', status: 'found' }),
      ]));
      expect(preflight.specLocations).toEqual(expect.arrayContaining([
        { path: 'SPEC.md', kind: 'file' },
        { path: 'docs/product', kind: 'directory' },
      ]));
      expect(preflight.workflowArtifacts).toContain('workflows/generated/existing.ts');
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });

  it('generates through the local pipeline seam, summarizes, and supports not-now confirmation', async () => {
    const repo = await makeRepo();
    const localResponse: LocalResponse = {
      ok: true,
      artifacts: [{
        path: 'workflows/generated/release-health.ts',
        type: 'text/typescript',
        content: "workflow('release').agent('codex', { role: 'Run local checks' })",
      }],
      logs: ['generated'],
      warnings: [],
      nextActions: ['Run later'],
      generation: {
        stage: 'generate',
        status: 'ok',
        artifact: {
          path: 'workflows/generated/release-health.ts',
          workflow_id: 'wf-release',
          spec_digest: 'digest',
        },
        next: {
          run_command: 'ricky run workflows/generated/release-health.ts',
          run_mode_hint: 'ricky run workflows/generated/release-health.ts',
        },
      },
      exitCode: 0,
    };
    const runLocalFn = vi.fn().mockResolvedValue(localResponse);

    try {
      const result = await runLocalWorkflowFlow({
        cwd: repo,
        runLocalFn,
        prompts: {
          selectSpecSource: async () => 'editor',
          inputSpecFilePath: async () => 'SPEC.md',
          editSpec: async () => 'Verify release health across build, typecheck, and tests.',
          inputWorkflowName: async () => 'Release Health',
          inputGoal: async () => 'verify release health',
          approveGeneratedSpec: async () => 'approve',
          inputWorkflowArtifactPath: async () => 'workflows/generated/release-health.ts',
          confirmRun: async () => 'not-now',
        },
      });

      expect(runLocalFn).toHaveBeenCalledTimes(1);
      expect(runLocalFn).toHaveBeenCalledWith(expect.objectContaining({
        source: 'cli',
        spec: expect.objectContaining({
          workflowName: 'release-health',
          artifactPath: 'workflows/generated/release-health.ts',
        }),
      }), undefined);
      expect(result.confirmation).toBe('not-now');
      expect(result.summary.artifactPath).toBe('workflows/generated/release-health.ts');
      expect(result.summary.agents).toEqual([{ name: 'codex', job: 'Run local checks' }]);
      expect(result.command).toBe('ricky run workflows/generated/release-health.ts');
      expect(result.run).toBeUndefined();
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });

  it('stops before run confirmation when guided generation fails', async () => {
    const repo = await makeRepo();
    const failedGeneration: LocalResponse = {
      ok: false,
      artifacts: [{
        path: 'workflows/generated/docs-audit.ts',
        type: 'text/typescript',
        content: "workflow('docs-audit')",
      }],
      logs: ['[local] workflow generation: failed'],
      warnings: ['Workforce persona writer did not complete: failed.'],
      nextActions: ['Fix the Workforce persona response contract before local execution.'],
      generation: {
        stage: 'generate',
        status: 'error',
        artifact: {
          path: 'workflows/generated/docs-audit.ts',
          workflow_id: 'ricky-docs-audit',
          spec_digest: 'digest-docs',
        },
        error: 'WORKFORCE_PERSONA_WRITER_FAILED',
        decisions: {
          workforce_persona: {
            personaId: 'unresolved',
            tier: 'unknown',
            harness: 'unknown',
            model: 'unknown',
          },
        },
      },
      exitCode: 1,
    };
    const runLocalFn = vi.fn().mockResolvedValue(failedGeneration);
    const confirmRun = vi.fn();

    try {
      const result = await runLocalWorkflowFlow({
        cwd: repo,
        runLocalFn,
        prompts: {
          selectSpecSource: async () => 'goal',
          inputSpecFilePath: async () => 'SPEC.md',
          editSpec: async () => 'unused',
          inputWorkflowName: async () => 'docs-audit',
          inputGoal: async () => 'audit docs for OSS readiness',
          approveGeneratedSpec: async () => 'approve',
          inputWorkflowArtifactPath: async () => 'workflows/generated/docs-audit.ts',
          confirmRun,
        },
      });

      expect(runLocalFn).toHaveBeenCalledTimes(1);
      expect(confirmRun).not.toHaveBeenCalled();
      expect(result.generation).toBe(failedGeneration);
      expect(result.run).toBeUndefined();
      expect(result.monitoredRun).toBeUndefined();
      expect(result.confirmation).toBeUndefined();
      expect(result.command).toBe('ricky run workflows/generated/docs-audit.ts');
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });

  it('runs an existing workflow artifact directly through the foreground confirmation path', async () => {
    const repo = await makeRepo();
    const runResponse: LocalResponse = {
      ok: true,
      artifacts: [{ path: 'workflows/generated/existing.ts', type: 'text/typescript' }],
      logs: ['run passed'],
      warnings: [],
      nextActions: ['Inspect evidence'],
      execution: {
        stage: 'execute',
        status: 'success',
        execution: {
          workflow_id: 'wf-existing',
          artifact_path: 'workflows/generated/existing.ts',
          command: '@agent-relay/sdk/workflows runScriptWorkflow workflows/generated/existing.ts',
          workflow_file: 'workflows/generated/existing.ts',
          cwd: repo,
          started_at: '2026-04-30T00:00:00.000Z',
          finished_at: '2026-04-30T00:00:01.000Z',
          duration_ms: 1000,
          steps_completed: 1,
          steps_total: 1,
          run_id: 'foreground-existing',
        },
        evidence: {
          outcome_summary: 'final summary: existing workflow passed',
          logs: { stdout_path: `${repo}/.workflow-artifacts/ricky-local-runs/foreground-existing/stdout.log`, truncated: false },
          side_effects: {
            files_written: ['.workflow-artifacts/ricky-local-runs/foreground-existing/stdout.log'],
            commands_invoked: ['@agent-relay/sdk/workflows runScriptWorkflow workflows/generated/existing.ts'],
          },
          assertions: [{ name: 'runtime_exit_code', status: 'pass', detail: '0' }],
        },
      },
      exitCode: 0,
    };
    const runLocalFn = vi.fn().mockResolvedValue(runResponse);

    try {
      const result = await runLocalWorkflowFlow({
        cwd: repo,
        runLocalFn,
        prompts: {
          selectSpecSource: async () => 'workflow-artifact',
          inputSpecFilePath: async () => 'SPEC.md',
          editSpec: async () => 'unused',
          inputWorkflowName: async () => 'unused',
          inputGoal: async () => 'unused',
          approveGeneratedSpec: async () => 'approve',
          inputWorkflowArtifactPath: async () => 'workflows/generated/existing.ts',
          confirmRun: async () => 'foreground',
        },
      });

      expect(runLocalFn).toHaveBeenCalledTimes(1);
      expect(runLocalFn).toHaveBeenCalledWith(expect.objectContaining({
        source: 'workflow-artifact',
        artifactPath: 'workflows/generated/existing.ts',
        stageMode: 'run',
      }), undefined);
      expect(result.generation).toBeUndefined();
      expect(result.confirmation).toBe('foreground');
      expect(result.run?.execution?.evidence?.outcome_summary).toContain('final summary');
      expect(result.runSummary).toMatchObject({
        outcome: 'final summary: existing workflow passed',
        changedFiles: [
          '.workflow-artifacts/ricky-local-runs/foreground-existing/stdout.log',
          'workflows/generated/existing.ts',
        ],
        evidencePath: `${repo}/.workflow-artifacts/ricky-local-runs/foreground-existing/stdout.log`,
        nextCommand: 'ricky run workflows/generated/existing.ts',
      });
      expect(result.command).toBe('ricky run workflows/generated/existing.ts');
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });

  it('starts a background monitored run with persisted state paths and a reattach command', async () => {
    const repo = await makeRepo();
    const localResponse: LocalResponse = {
      ok: true,
      artifacts: [{
        path: 'workflows/generated/background.ts',
        type: 'text/typescript',
        content: "workflow('background').agent('codex', { role: 'Run background checks' })",
      }],
      logs: ['generated'],
      warnings: [],
      nextActions: [],
      generation: {
        stage: 'generate',
        status: 'ok',
        artifact: {
          path: 'workflows/generated/background.ts',
          workflow_id: 'wf-background',
          spec_digest: 'digest',
        },
      },
      exitCode: 0,
    };
    const runLocalFn = vi.fn().mockResolvedValue(localResponse);

    try {
      const result = await runLocalWorkflowFlow({
        cwd: repo,
        runLocalFn,
        prompts: {
          selectSpecSource: async () => 'editor',
          inputSpecFilePath: async () => 'SPEC.md',
          editSpec: async () => 'Verify background monitoring.',
          inputWorkflowName: async () => 'Background',
          inputGoal: async () => 'verify background monitoring',
          approveGeneratedSpec: async () => 'approve',
          inputWorkflowArtifactPath: async () => 'unused',
          confirmRun: async () => 'background',
        },
      });

      expect(result.confirmation).toBe('background');
      expect(result.monitoredRun).toMatchObject({
        status: 'running',
        artifactPath: 'workflows/generated/background.ts',
        reattachCommand: `ricky status --run ${result.monitoredRun?.runId}`,
      });
      expect(result.monitoredRun?.artifactDir).toContain(`${repo}/.workflow-artifacts/ricky-local-runs/`);
      expect(result.monitoredRun?.evidencePath).toContain('/evidence.json');
      expect(result.runSummary).toMatchObject({
        outcome: 'Background run running.',
        evidencePath: result.monitoredRun?.evidencePath,
        nextCommand: result.monitoredRun?.reattachCommand,
      });
      await vi.waitFor(async () => {
        expect(JSON.parse(await readFile(result.monitoredRun!.statePath, 'utf8'))).toMatchObject({
          status: 'completed',
        });
      });
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });
});
