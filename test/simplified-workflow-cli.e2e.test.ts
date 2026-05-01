import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { tmpdir } from 'node:os';
import { describe, expect, it, vi } from 'vitest';

import type { CloudGenerateRequest } from '../src/cloud/api/request-types.js';
import type { RawHandoff } from '../src/local/request-normalizer.js';
import type { LocalResponse } from '../src/local/entrypoint.js';
import { runOnboarding } from '../src/surfaces/cli/cli/onboarding.js';
import { cliMain } from '../src/surfaces/cli/commands/cli-main.js';
import { runInteractiveCli } from '../src/surfaces/cli/entrypoint/interactive-cli.js';
import type { CloudReadinessSnapshot } from '../src/surfaces/cli/flows/cloud-workflow-flow.js';
import { runLocalWorkflowFlow } from '../src/surfaces/cli/flows/local-workflow-flow.js';

describe('simplified workflow CLI E2E paths', () => {
  it('handles prompt cancellation, Ctrl+C, and Abort-style exits without a stack trace', async () => {
    const promptShell = {
      selectFirstScreen: vi.fn().mockRejectedValue(
        Object.assign(new Error('User pressed Ctrl+C'), { name: 'ExitPromptError' }),
      ),
    };

    const result = await runOnboarding({
      output: new PassThrough(),
      isTTY: true,
      configStore: configStore(),
      promptShell,
    });

    expect(result.mode).toBe('exit');
    expect(result.output).toContain('Cancelled.');
    expect(result.output).not.toContain('ExitPromptError');
    expect(result.output).not.toContain('User pressed Ctrl+C');
  });

  it('covers spec file, editor spec flow, goal-to-spec flow, and existing workflow flow', async () => {
    const repo = await makeRepo();
    const captures: Array<{
      source: 'spec-file' | 'editor' | 'goal' | 'workflow-artifact';
      workflowName: string;
      specIncludes: string;
    }> = [];

    try {
      for (const source of ['spec-file', 'editor', 'goal', 'workflow-artifact'] as const) {
        const runLocalFn = vi.fn().mockImplementation(async (handoff: RawHandoff) => {
          captures.push({
            source,
            workflowName: String(
              handoff.source === 'cli'
                ? (handoff.spec as { workflowName?: string }).workflowName ?? handoff.cliMetadata?.workflowName
                : handoff.metadata?.workflowName,
            ),
            specIncludes: handoff.source === 'cli'
              ? JSON.stringify(handoff.spec)
              : handoff.source === 'workflow-artifact'
                ? handoff.artifactPath
                : '',
          });
          return localResponse(source);
        });

        const result = await runLocalWorkflowFlow({
          cwd: repo,
          runLocalFn,
          prompts: {
            selectSpecSource: async () => source,
            inputSpecFilePath: async () => 'SPEC.md',
            editSpec: async ({ initialValue }) => initialValue
              ? `${initialValue}\nEdited before generation.`
              : 'Generate an editor-authored workflow.',
            inputWorkflowName: async ({ defaultName }) => `${defaultName}-verified`,
            inputGoal: async () => 'verify release health before packaging',
            inputGoalClarification: async () => 'Run tests and typecheck.',
            approveGeneratedSpec: async () => 'edit',
            inputWorkflowArtifactPath: async () => 'workflows/generated/existing.ts',
            confirmRun: async () => 'edit-first',
          },
        });

        expect(result.confirmation).toBe('edit-first');
        expect(result.run).toBeUndefined();
        expect(result.monitoredRun).toBeUndefined();
        if (source === 'workflow-artifact') {
          expect(runLocalFn).not.toHaveBeenCalled();
          expect(result.capture.artifactPath).toBe('workflows/generated/existing.ts');
        } else {
          expect(runLocalFn).toHaveBeenCalledTimes(1);
          expect(result.summary.command).toContain('ricky run --artifact');
        }
      }

      expect(captures.map((capture) => capture.source)).toEqual(['spec-file', 'editor', 'goal']);
      expect(captures[0].specIncludes).toContain('Spec file flow');
      expect(captures[1].specIncludes).toContain('editor-authored workflow');
      expect(captures[2].specIncludes).toContain('Edited before generation');
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });

  it('covers local run confirmation: background, foreground, not now, and edit first', async () => {
    const repo = await makeRepo();
    const stateHome = join(repo, '.ricky-state');
    vi.stubEnv('RICKY_STATE_HOME', stateHome);

    try {
      const confirmations = ['background', 'foreground', 'not-now', 'edit-first'] as const;
      for (const confirmation of confirmations) {
        const runLocalFn = vi.fn().mockImplementation(async (handoff: RawHandoff) => (
          handoff.stageMode === 'run' || handoff.source === 'workflow-artifact'
            ? executedLocalResponse({ cwd: repo, runId: `run-${confirmation}` })
            : localResponse(confirmation)
        ));

        const result = await runLocalWorkflowFlow({
          cwd: repo,
          runLocalFn,
          autoFixAttempts: 7,
          prompts: {
            selectSpecSource: async () => 'editor',
            inputSpecFilePath: async () => 'SPEC.md',
            editSpec: async () => `Generate a ${confirmation} workflow.`,
            inputWorkflowName: async () => `Release ${confirmation}`,
            inputGoal: async () => 'verify release',
            approveGeneratedSpec: async () => 'approve',
            inputWorkflowArtifactPath: async () => 'workflows/generated/release.ts',
            confirmRun: async () => confirmation,
          },
        });

        expect(result.confirmation).toBe(confirmation);
        expect(result.summary.sideEffects.join('\n')).toContain('non-destructive auto-fixes');

        if (confirmation === 'background') {
          expect(result.monitoredRun?.status).toBe('completed');
          expect(result.monitoredRun?.logPath).toContain(`${stateHome}/ricky/local-runs/`);
          expect(result.monitoredRun?.evidencePath).toContain('evidence.json');
          expect(result.monitoredRun?.reattachCommand).toMatch(/^ricky status --run /);
          await expect(readFile(result.monitoredRun!.logPath, 'utf8')).resolves.toContain('generated');
          await expect(readFile(result.monitoredRun!.evidencePath, 'utf8')).resolves.toContain(
            'Workflow completed successfully with deterministic evidence.',
          );
          await expect(readFile(result.monitoredRun!.evidencePath, 'utf8')).resolves.toContain('final summary: passed');
          expect(runLocalFn.mock.calls[1][0].autoFix).toEqual({ maxAttempts: 7 });
        } else if (confirmation === 'foreground') {
          expect(result.run?.execution?.status).toBe('success');
          expect(result.run?.execution?.evidence?.logs.stdout_path).toContain('stdout.log');
        } else {
          expect(result.run).toBeUndefined();
          expect(result.monitoredRun).toBeUndefined();
          expect(runLocalFn).toHaveBeenCalledTimes(1);
        }
      }
    } finally {
      vi.unstubAllEnvs();
      await rm(repo, { recursive: true, force: true });
    }
  });

  it('recovers Cloud login, missing agents, and optional integration skip with re-checks', async () => {
    const snapshots = [
      readiness({ login: false, agents: false }),
      readiness({ login: true, agents: false }),
      readiness({ login: true, agents: true }),
    ];
    const checkCloudReadiness = vi.fn().mockImplementation(async () => snapshots.shift()!);
    const recoverCloudLogin = vi.fn().mockResolvedValue(undefined);
    const connectCloudAgents = vi.fn().mockResolvedValue(undefined);
    const selectOptionalCloudIntegrations = vi.fn().mockResolvedValue({ action: 'skip-all' as const });
    const confirmCloudRun = vi.fn().mockResolvedValue({ action: 'run-and-monitor' as const });
    const generate = vi.fn().mockResolvedValue({
      artifacts: [{ path: 'cloud/workflow.ts', type: 'text/typescript' }],
      warnings: [],
      followUpActions: [],
      runReceipt: {
        runId: 'cloud-run-1',
        status: 'generated',
        receiptUrl: 'https://cloud.agentworkforce.test/runs/cloud-run-1',
      },
    });

    const result = await runInteractiveCli({
      onboard: vi.fn().mockResolvedValue(onboarding('cloud')),
      cloudRequest: cloudRequest(
        'Post to Slack, read GitHub context, update Notion, and create a Linear task.',
      ),
      checkCloudReadiness,
      recoverCloudLogin,
      promptMissingCloudAgents: vi.fn().mockResolvedValue({ action: 'choose' as const, agents: ['codex' as const] }),
      connectCloudAgents,
      selectOptionalCloudIntegrations,
      confirmCloudRun,
      cloudExecutor: { generate },
    });

    expect(result.ok).toBe(true);
    expect(recoverCloudLogin).toHaveBeenCalledWith(expect.objectContaining({
      missing: ['account', 'credentials'],
    }));
    expect(connectCloudAgents).toHaveBeenCalledWith(['codex']);
    expect(checkCloudReadiness).toHaveBeenCalledTimes(3);
    expect(selectOptionalCloudIntegrations).toHaveBeenCalledWith(expect.objectContaining({
      missingIntegrations: ['slack', 'github', 'notion', 'linear'],
      relevantIntegrations: ['slack', 'github', 'notion', 'linear'],
    }));
    expect(confirmCloudRun).toHaveBeenCalledWith(expect.objectContaining({
      availableAgents: ['codex'],
    }));
    expect(result.guidance.join('\n')).toContain('Slack was skipped');
    expect(result.guidance.join('\n')).toContain('GitHub was skipped');
    expect(result.guidance.join('\n')).toContain('Notion was skipped');
    expect(result.guidance.join('\n')).toContain('Linear was skipped');
    expect(generate.mock.calls[0][0].body.metadata.cloudReadiness.availableAgents).toEqual(['codex']);
  });

  it('covers power-user --json, --yes safety limits, --quiet, --verbose, status, and connect commands', async () => {
    const runner = vi.fn().mockResolvedValue({
      ok: true,
      mode: 'local',
      onboarding: onboarding('local'),
      diagnoses: [],
      guidance: [],
      localResult: executedLocalResponse({ cwd: '/repo', runId: 'local-run-1' }),
    });

    const json = await cliMain({
      argv: ['local', '--spec', 'build a workflow', '--name', 'release-health', '--json'],
      runInteractive: runner,
    });
    const quietYes = await cliMain({
      argv: ['local', '--spec', 'build a workflow', '--run', '--yes', '--quiet', '--verbose'],
      runInteractive: runner,
    });
    const status = await cliMain({
      argv: ['status', '--json'],
      cwd: '/repo',
      runInteractive: runner,
      readCloudAuth: vi.fn().mockResolvedValue(null),
    });
    const connect = await cliMain({
      argv: ['connect', 'integrations', '--cloud', 'slack,github', '--quiet'],
      runInteractive: runner,
      connectCloudIntegrations: vi.fn().mockResolvedValue([
        { integration: 'slack', status: 'link-opened', url: 'https://nango.example/slack' },
        { integration: 'github', status: 'link-opened', url: 'https://nango.example/github' },
      ]),
    });

    expect(json.exitCode).toBe(0);
    expect(JSON.parse(json.output.join('\n'))).toMatchObject({
      mode: 'local',
      workflowName: 'release-health',
      workflowPath: 'workflows/generated/release-health.ts',
      runId: 'local-run-1',
      status: 'success',
      evidencePath: '/repo/.workflow-artifacts/ricky-local-runs/local-run-1/stdout.log',
      warnings: [],
      nextActions: expect.any(Array),
    });
    expect(quietYes.output).toEqual(['Ricky local: release-health run success.']);
    expect(runner.mock.calls[1][0].handoff.cliMetadata).toMatchObject({
      yes: 'non-destructive-confirmations-only',
    });
    expect(JSON.parse(status.output.join('\n'))).toMatchObject({
      local: { repo: '/repo' },
      nextActions: expect.arrayContaining(['ricky connect cloud']),
    });
    expect(connect.output).toEqual(['Ricky connect integrations: connected.']);
  });

  it('prints non-interactive recovery text without raw stack traces', async () => {
    const missingSpec = await cliMain({ argv: ['--spec'] });
    const missingCloud = await cliMain({
      argv: ['cloud', '--spec', 'build a workflow', '--verbose'],
      onboard: vi.fn().mockResolvedValue(onboarding('cloud')),
    });

    expect(missingSpec.exitCode).toBe(1);
    expect(missingSpec.output.join('\n')).toContain('--spec requires a value.');
    expect(missingSpec.output.join('\n')).not.toMatch(/Error:\s+at|stack/i);
    expect(missingCloud.exitCode).toBe(1);
    expect(missingCloud.output.join('\n')).toContain('ricky connect cloud');
    expect(missingCloud.output.join('\n')).not.toMatch(/at .*\.ts:\d+|TypeError|ReferenceError/);
  });
});

async function makeRepo(): Promise<string> {
  const repo = await mkdtemp(join(tmpdir(), 'ricky-simplified-e2e-'));
  await mkdir(join(repo, '.git'), { recursive: true });
  await mkdir(join(repo, '.ricky'), { recursive: true });
  await mkdir(join(repo, 'docs/product'), { recursive: true });
  await mkdir(join(repo, 'node_modules/.bin'), { recursive: true });
  await mkdir(join(repo, 'workflows/generated'), { recursive: true });
  await writeFile(join(repo, 'package.json'), JSON.stringify({ packageManager: 'npm@11.11.0' }), 'utf8');
  await writeFile(join(repo, '.ricky/config.json'), '{}\n', 'utf8');
  await writeFile(join(repo, 'SPEC.md'), 'Spec file flow: generate release health workflow.\n', 'utf8');
  await writeFile(join(repo, 'workflows/generated/existing.ts'), 'workflow("existing")\n', 'utf8');
  await writeFile(join(repo, 'node_modules/.bin/agent-relay'), '#!/bin/sh\n', 'utf8');
  await chmod(join(repo, 'node_modules/.bin/agent-relay'), 0o755);
  return repo;
}

function onboarding(mode: 'local' | 'cloud' | 'both') {
  return {
    mode,
    firstRun: false,
    bannerShown: false,
    output: `mode=${mode}`,
  };
}

function localResponse(label: string): LocalResponse {
  return {
    ok: true,
    artifacts: [{
      path: 'workflows/generated/release-health.ts',
      type: 'text/typescript',
      content: `workflow("${label}").agent("codex", { role: "Run deterministic checks" })`,
    }],
    logs: ['generated'],
    warnings: [],
    nextActions: ['Run later'],
    generation: {
      stage: 'generate',
      status: 'ok',
      artifact: {
        path: 'workflows/generated/release-health.ts',
        workflow_id: 'wf-release-health',
        spec_digest: 'digest-release-health',
      },
      next: {
        run_command: 'ricky run --artifact workflows/generated/release-health.ts',
        run_mode_hint: 'ricky run --artifact workflows/generated/release-health.ts',
      },
    },
    exitCode: 0,
  };
}

function executedLocalResponse(options: { cwd: string; runId: string }): LocalResponse {
  const stdout = `${options.cwd}/.workflow-artifacts/ricky-local-runs/${options.runId}/stdout.log`;
  const stderr = `${options.cwd}/.workflow-artifacts/ricky-local-runs/${options.runId}/stderr.log`;
  return {
    ...localResponse('executed'),
    nextActions: ['Inspect generated artifacts and local run evidence.'],
    execution: {
      stage: 'execute',
      status: 'success',
      execution: {
        workflow_id: 'wf-release-health',
        artifact_path: 'workflows/generated/release-health.ts',
        command: '@agent-relay/sdk/workflows runScriptWorkflow workflows/generated/release-health.ts',
        workflow_file: 'workflows/generated/release-health.ts',
        cwd: options.cwd,
        started_at: '2026-04-30T00:00:00.000Z',
        finished_at: '2026-04-30T00:00:01.000Z',
        duration_ms: 1000,
        steps_completed: 1,
        steps_total: 1,
        run_id: options.runId,
      },
      evidence: {
        outcome_summary: 'Workflow completed successfully with deterministic evidence.',
        artifacts_produced: [{ path: 'workflows/generated/release-health.ts', kind: 'workflow', bytes: 128 }],
        logs: {
          stdout_path: stdout,
          stderr_path: stderr,
          tail: ['final summary: passed'],
          truncated: false,
        },
        side_effects: {
          files_written: ['workflows/generated/release-health.ts', stdout, stderr],
          commands_invoked: ['@agent-relay/sdk/workflows runScriptWorkflow workflows/generated/release-health.ts'],
          network_calls: [],
        },
        assertions: [{ name: 'runtime_exit_code', status: 'pass', detail: 'Runtime exited with code 0.' }],
        workflow_steps: [{ id: 'runtime-launch', name: 'Local runtime execution', status: 'pass', duration_ms: 1000 }],
      },
    },
    exitCode: 0,
  };
}

function readiness(options: { login: boolean; agents: boolean }): CloudReadinessSnapshot {
  return {
    account: { connected: options.login },
    credentials: { connected: options.login },
    workspace: { connected: true },
    agents: {
      claude: { connected: false, capable: false },
      codex: { connected: options.agents, capable: options.agents },
      opencode: { connected: false, capable: false },
      gemini: { connected: false, capable: false },
    },
    integrations: {
      slack: { connected: false },
      github: { connected: false },
      notion: { connected: false },
      linear: { connected: false },
    },
  };
}

function cloudRequest(spec: string): CloudGenerateRequest {
  return {
    auth: { token: 'token-123' },
    workspace: { workspaceId: 'workspace-1' },
    body: {
      spec,
      mode: 'cloud',
      metadata: {},
    },
  };
}

function configStore() {
  return {
    readProjectConfig: vi.fn().mockResolvedValue(null),
    readGlobalConfig: vi.fn().mockResolvedValue(null),
    writeProjectConfig: vi.fn().mockResolvedValue(undefined),
  };
}
