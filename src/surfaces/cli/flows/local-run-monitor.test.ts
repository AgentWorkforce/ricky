import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it, vi } from 'vitest';

import type { LocalResponse } from '../../../local/entrypoint.js';
import { startLocalRunMonitor, withSafeRunOptions } from './local-run-monitor.js';

describe('local run monitor', () => {
  it('persists state, logs, fixes, evidence, generated artifacts, and a reattach command', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'ricky-run-monitor-'));
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
          command: 'npx --no-install agent-relay run workflows/generated/release-health.ts',
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
            commands_invoked: ['npx --no-install agent-relay run workflows/generated/release-health.ts'],
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
        mode: 'background',
        handoff: {
          source: 'workflow-artifact',
          artifactPath: 'workflows/generated/release-health.ts',
          invocationRoot: cwd,
        },
        runLocalFn,
        runIdFactory: () => 'fixture-run-id',
      });

      expect(state.runId).toBe('fixture-run-id');
      expect(state.statePath).toBe(`${cwd}/.workflow-artifacts/ricky-local-runs/fixture-run-id/state.json`);
      expect(state.logPath).toBe(`${cwd}/.workflow-artifacts/ricky-local-runs/fixture-run-id/run.log`);
      expect(state.evidencePath).toBe(`${cwd}/.workflow-artifacts/ricky-local-runs/fixture-run-id/evidence.json`);
      expect(state.fixesPath).toBe(`${cwd}/.workflow-artifacts/ricky-local-runs/fixture-run-id/fixes.json`);
      expect(state.reattachCommand).toBe('ricky status --run fixture-run-id');
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it('announces the running state before awaiting the local run result', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'ricky-monitor-started-'));
    const events: string[] = [];
    const response: LocalResponse = {
      ok: true,
      artifacts: [],
      logs: [],
      warnings: [],
      nextActions: [],
    };
    const runLocalFn = vi.fn(async () => {
      events.push('runLocal');
      return response;
    });

    try {
      await startLocalRunMonitor({
        cwd,
        artifactPath: 'workflows/generated/release-health.ts',
        mode: 'background',
        handoff: {
          source: 'workflow-artifact',
          artifactPath: 'workflows/generated/release-health.ts',
          invocationRoot: cwd,
        },
        runLocalFn,
        runIdFactory: () => 'announce-run-id',
        onMonitorStarted: (state) => {
          events.push(`started:${state.runId}:${state.status}:${state.reattachCommand}`);
        },
      });

      expect(events).toEqual([
        'started:announce-run-id:running:ricky status --run announce-run-id',
        'runLocal',
      ]);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
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
