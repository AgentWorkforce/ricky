import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

import type { LocalResponse } from '../../../local/entrypoint.js';
import { localRunStateRoot, startLocalRunMonitor, withSafeRunOptions } from './local-run-monitor.js';

describe('local run monitor', () => {
  it('persists state, logs, fixes, evidence, generated artifacts, and a reattach command for foreground runs', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'ricky-run-monitor-'));
    const stateRoot = join(cwd, '.ricky-state');
    const response: LocalResponse = {
      ok: true,
      artifacts: [{ path: 'workflows/generated/release-health.ts', content: 'workflow("x")' }],
      logs: ['run started', 'run passed'],
      warnings: [],
      nextActions: [],
      execution: {
        stage: 'execute',
        status: 'success',
        execution: {
          workflow_id: 'wf-release',
          artifact_path: 'workflows/generated/release-health.ts',
          command: '@agent-relay/sdk/workflows runScriptWorkflow workflows/generated/release-health.ts',
          workflow_file: 'workflows/generated/release-health.ts',
          cwd,
          started_at: '2026-01-01T00:00:00.000Z',
          finished_at: '2026-01-01T00:00:01.000Z',
          duration_ms: 1000,
          steps_completed: 1,
          steps_total: 1,
          run_id: 'relay-run-1',
        },
        evidence: {
          outcome_summary: 'passed',
          logs: { tail: ['ok'], truncated: false },
          side_effects: {
            files_written: ['workflows/generated/release-health.ts'],
            commands_invoked: ['@agent-relay/sdk/workflows runScriptWorkflow workflows/generated/release-health.ts'],
          },
          assertions: [{ name: 'exit', status: 'pass', detail: '0' }],
        },
      },
    };
    const runLocalFn = vi.fn().mockResolvedValue(response);

    try {
      const state = await startLocalRunMonitor({
        cwd,
        artifactPath: 'workflows/generated/release-health.ts',
        mode: 'foreground',
        handoff: {
          source: 'workflow-artifact',
          artifactPath: 'workflows/generated/release-health.ts',
          invocationRoot: cwd,
        },
        runLocalFn,
        stateRoot,
      });

      expect(state.status).toBe('completed');
      expect(state.reattachCommand).toBe(`ricky status --run ${state.runId}`);
      await expect(access(state.statePath)).resolves.toBeUndefined();
      await expect(access(state.logPath)).resolves.toBeUndefined();
      await expect(access(state.evidencePath)).resolves.toBeUndefined();
      await expect(access(state.fixesPath)).resolves.toBeUndefined();
      expect(await readFile(state.logPath, 'utf8')).toContain('run passed');
      expect(await readFile(join(state.artifactDir, 'generated-artifacts', 'workflows__generated__release-health.ts'), 'utf8')).toContain('workflow("x")');
      expect(runLocalFn.mock.calls[0][0]).toMatchObject({
        stageMode: 'run',
        autoFix: { maxAttempts: 3 },
        metadata: {
          autoFixPolicy: 'bounded-safe-only',
          destructiveActionsApproved: false,
          commitsApproved: false,
        },
      });
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it('uses an injected runIdFactory so state, log, evidence, and reattach paths are deterministic', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'ricky-deterministic-runid-'));
    const stateRoot = join(cwd, '.ricky-state');
    const response: LocalResponse = {
      ok: true,
      artifacts: [{ path: 'workflows/generated/release-health.ts', content: 'workflow("x")' }],
      logs: [],
      warnings: [],
      nextActions: [],
    };
    const runLocalFn = vi.fn().mockResolvedValue(response);

    try {
      const state = await startLocalRunMonitor({
        cwd,
        artifactPath: 'workflows/generated/release-health.ts',
        mode: 'foreground',
        handoff: {
          source: 'workflow-artifact',
          artifactPath: 'workflows/generated/release-health.ts',
          invocationRoot: cwd,
        },
        runLocalFn,
        stateRoot,
        runIdFactory: () => 'fixture-run-id',
      });

      expect(state.runId).toBe('fixture-run-id');
      expect(state.statePath).toBe(`${stateRoot}/fixture-run-id/state.json`);
      expect(state.logPath).toBe(`${stateRoot}/fixture-run-id/run.log`);
      expect(state.evidencePath).toBe(`${stateRoot}/fixture-run-id/evidence.json`);
      expect(state.fixesPath).toBe(`${stateRoot}/fixture-run-id/fixes.json`);
      expect(state.reattachCommand).toBe('ricky status --run fixture-run-id');
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it('announces the running state before awaiting the local run result', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'ricky-monitor-started-'));
    const stateRoot = join(cwd, '.ricky-state');
    const events: string[] = [];
    const response: LocalResponse = {
      ok: true,
      artifacts: [],
      logs: [],
      warnings: [],
      nextActions: [],
    };
    let resolveRun: ((response: LocalResponse) => void) | undefined;
    const runLocalFn = vi.fn(async () => {
      events.push('runLocal');
      return new Promise<LocalResponse>((resolve) => {
        resolveRun = resolve;
      });
    });

    try {
      const state = await startLocalRunMonitor({
        cwd,
        artifactPath: 'workflows/generated/release-health.ts',
        mode: 'background',
        handoff: {
          source: 'workflow-artifact',
          artifactPath: 'workflows/generated/release-health.ts',
          invocationRoot: cwd,
        },
        runLocalFn,
        stateRoot,
        runIdFactory: () => 'announce-run-id',
        onMonitorStarted: (state) => {
          events.push(`started:${state.runId}:${state.status}:${state.reattachCommand}`);
        },
      });

      expect(state).toMatchObject({
        runId: 'announce-run-id',
        status: 'running',
        reattachCommand: 'ricky status --run announce-run-id',
        logPath: `${stateRoot}/announce-run-id/run.log`,
        evidencePath: `${stateRoot}/announce-run-id/evidence.json`,
        fixesPath: `${stateRoot}/announce-run-id/fixes.json`,
      });
      expect(events).toEqual([
        'started:announce-run-id:running:ricky status --run announce-run-id',
        'runLocal',
      ]);
      expect(JSON.parse(await readFile(state.statePath, 'utf8'))).toMatchObject({
        runId: 'announce-run-id',
        status: 'running',
        reattachCommand: 'ricky status --run announce-run-id',
      });

      resolveRun?.(response);
      await vi.waitFor(async () => {
        expect(JSON.parse(await readFile(state.statePath, 'utf8'))).toMatchObject({
          runId: 'announce-run-id',
          status: 'completed',
        });
      });
      await expect(access(state.logPath)).resolves.toBeUndefined();
      await expect(access(state.evidencePath)).resolves.toBeUndefined();
      await expect(access(state.fixesPath)).resolves.toBeUndefined();
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it('persists failed state when background artifact persistence fails after the run resolves', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'ricky-monitor-persist-failure-'));
    const stateRoot = join(cwd, '.ricky-state');
    const response: LocalResponse = {
      ok: true,
      artifacts: [{ path: 'a'.repeat(300), content: 'workflow("too-long")' }],
      logs: ['run resolved before artifact copy failed'],
      warnings: [],
      nextActions: [],
      execution: {
        stage: 'execute',
        status: 'success',
        execution: {
          workflow_id: 'wf-too-long',
          artifact_path: 'workflows/generated/too-long.ts',
          command: '@agent-relay/sdk/workflows runScriptWorkflow workflows/generated/too-long.ts',
          workflow_file: 'workflows/generated/too-long.ts',
          cwd,
          started_at: '2026-01-01T00:00:00.000Z',
          finished_at: '2026-01-01T00:00:01.000Z',
          duration_ms: 1000,
          steps_completed: 1,
          steps_total: 1,
          run_id: 'relay-run-too-long',
        },
        evidence: {
          outcome_summary: 'resolved before copy failure',
          logs: { tail: ['ok'], truncated: false },
          side_effects: {
            files_written: [],
            commands_invoked: [],
          },
          assertions: [{ name: 'exit', status: 'pass', detail: '0' }],
        },
      },
    };
    const runLocalFn = vi.fn().mockResolvedValue(response);

    try {
      const state = await startLocalRunMonitor({
        cwd,
        artifactPath: 'workflows/generated/release-health.ts',
        mode: 'background',
        handoff: {
          source: 'workflow-artifact',
          artifactPath: 'workflows/generated/release-health.ts',
          invocationRoot: cwd,
        },
        runLocalFn,
        stateRoot,
        runIdFactory: () => 'post-run-copy-failure',
      });

      expect(state.status).toBe('running');
      await vi.waitFor(async () => {
        const persisted = JSON.parse(await readFile(state.statePath, 'utf8'));
        expect(persisted).toMatchObject({
          runId: 'post-run-copy-failure',
          status: 'failed',
          response: { ok: false, exitCode: 1 },
        });
      });
      await expect(readFile(state.logPath, 'utf8')).resolves.toMatch(/ENAMETOOLONG|too long|name too long/i);
      await expect(readFile(state.evidencePath, 'utf8')).resolves.toMatch(/ENAMETOOLONG|too long|name too long/i);
      await expect(readFile(state.fixesPath, 'utf8')).resolves.toContain('"attempts": []');
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it('exposes background monitor progress across subprocess status checks', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'ricky-monitor-subprocess-'));
    const stateHome = join(cwd, '.ricky-state-home');
    const harnessPath = join(cwd, 'background-monitor-harness.mjs');
    const monitorUrl = pathToFileURL(join(process.cwd(), 'src/surfaces/cli/flows/local-run-monitor.ts')).href;
    await writeFile(harnessPath, `
      import { startLocalRunMonitor } from ${JSON.stringify(monitorUrl)};
      const state = await startLocalRunMonitor({
        cwd: process.env.REPO_UNDER_TEST,
        artifactPath: 'workflows/generated/release-health.ts',
        mode: 'background',
        handoff: {
          source: 'workflow-artifact',
          artifactPath: 'workflows/generated/release-health.ts',
          invocationRoot: process.env.REPO_UNDER_TEST,
        },
        runIdFactory: () => 'subprocess-background-run',
        runLocalFn: async () => {
          await new Promise((resolve) => setTimeout(resolve, 1000));
          return {
            ok: true,
            artifacts: [],
            logs: ['subprocess run completed'],
            warnings: [],
            nextActions: [],
            execution: {
              stage: 'execute',
              status: 'success',
              execution: {
                workflow_id: 'wf-subprocess',
                artifact_path: 'workflows/generated/release-health.ts',
                command: 'fixture',
                workflow_file: 'workflows/generated/release-health.ts',
                cwd: process.env.REPO_UNDER_TEST,
                started_at: '2026-01-01T00:00:00.000Z',
                finished_at: '2026-01-01T00:00:01.000Z',
                duration_ms: 1000,
                steps_completed: 1,
                steps_total: 1,
                run_id: 'relay-subprocess',
              },
              evidence: {
                outcome_summary: 'subprocess completed',
                logs: { tail: ['ok'], truncated: false },
                side_effects: { files_written: [], commands_invoked: [] },
                assertions: [{ name: 'exit', status: 'pass', detail: '0' }],
              },
            },
          };
        },
      });
      console.log(JSON.stringify({ runId: state.runId, status: state.status, reattachCommand: state.reattachCommand }));
    `, 'utf8');

    const child = spawn(process.execPath, ['--import', 'tsx', harnessPath], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        REPO_UNDER_TEST: cwd,
        RICKY_STATE_HOME: stateHome,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    try {
      const started = JSON.parse(await firstStdoutLine(child, 5000)) as {
        runId: string;
        status: string;
        reattachCommand: string;
      };
      expect(started).toEqual({
        runId: 'subprocess-background-run',
        status: 'running',
        reattachCommand: 'ricky status --run subprocess-background-run',
      });

      const runningStatus = await readRunStatusInSubprocess(cwd, stateHome, started.runId);
      expect(runningStatus.status).toBe('running');

      await waitForExit(child, 5000);
      expect(child.exitCode).toBe(0);

      const completedStatus = await readRunStatusInSubprocess(cwd, stateHome, started.runId);
      expect(completedStatus).toMatchObject({
        runId: 'subprocess-background-run',
        status: 'completed',
        response: { ok: true },
      });
    } finally {
      if (child.exitCode === null) child.kill('SIGKILL');
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it('defaults run state outside the repo under a repo-keyed state directory', () => {
    const cwd = '/workspace/customer-repo';
    const stateRoot = localRunStateRoot(cwd, { RICKY_STATE_HOME: '/tmp/ricky-state' });

    expect(stateRoot).toMatch(/^\/tmp\/ricky-state\/ricky\/local-runs\/[a-f0-9]{12}$/);
    expect(stateRoot).not.toContain('/workspace/customer-repo');
  });

  it('clamps auto-fix attempts and never approves destructive actions or commits', () => {
    const handoff = withSafeRunOptions({
      source: 'cli',
      spec: 'fix tests',
    }, 99);

    expect(handoff.autoFix).toEqual({ maxAttempts: 10 });
    expect(handoff.metadata).toMatchObject({
      destructiveActionsApproved: false,
      commitsApproved: false,
    });
  });
});

async function firstStdoutLine(child: ReturnType<typeof spawn>, timeoutMs: number): Promise<string> {
  if (!child.stdout) throw new Error('child stdout was not piped');
  const lines = createInterface({ input: child.stdout });
  try {
    const line = await Promise.race([
      once(lines, 'line').then(([value]) => String(value)),
      timeout(timeoutMs, 'Timed out waiting for subprocess monitor output.'),
    ]);
    return line;
  } finally {
    lines.close();
  }
}

async function readRunStatusInSubprocess(cwd: string, stateHome: string, runId: string): Promise<Record<string, unknown>> {
  const cliMainUrl = pathToFileURL(join(process.cwd(), 'src/surfaces/cli/commands/cli-main.ts')).href;
  const code = `
    import { cliMain } from ${JSON.stringify(cliMainUrl)};
    const result = await cliMain({
      argv: ['status', '--run', process.env.RUN_ID, '--json'],
      cwd: process.env.REPO_UNDER_TEST,
    });
    console.log(result.output.join('\\n'));
    process.exit(result.exitCode);
  `;
  const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '--eval', code], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      REPO_UNDER_TEST: cwd,
      RICKY_STATE_HOME: stateHome,
      RUN_ID: runId,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout?.setEncoding('utf8');
  child.stderr?.setEncoding('utf8');
  child.stdout?.on('data', (chunk) => {
    stdout += chunk;
  });
  child.stderr?.on('data', (chunk) => {
    stderr += chunk;
  });

  await waitForExit(child, 5000);
  if (child.exitCode !== 0) {
    throw new Error(`status subprocess failed with ${child.exitCode}: ${stderr}`);
  }
  return JSON.parse(stdout) as Record<string, unknown>;
}

async function waitForExit(child: ReturnType<typeof spawn>, timeoutMs: number): Promise<void> {
  await Promise.race([
    once(child, 'exit').then(() => undefined),
    timeout(timeoutMs, 'Timed out waiting for subprocess exit.'),
  ]);
}

async function timeout(ms: number, message: string): Promise<never> {
  await new Promise((resolve) => setTimeout(resolve, ms));
  throw new Error(message);
}
