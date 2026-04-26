import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

import { LocalCoordinator } from './local-coordinator.js';
import type {
  CommandInvocation,
  CommandRunner,
  CommandRunnerOptions,
} from './types.js';

class ManualInvocation implements CommandInvocation {
  readonly stdoutHandlers: Array<(line: string) => void> = [];
  readonly stderrHandlers: Array<(line: string) => void> = [];
  readonly exitPromise: Promise<number>;
  killed = false;

  private resolveExit!: (code: number) => void;
  private rejectExit!: (err: unknown) => void;

  constructor() {
    this.exitPromise = new Promise<number>((resolve, reject) => {
      this.resolveExit = resolve;
      this.rejectExit = reject;
    });
  }

  onStdout(cb: (line: string) => void): void {
    this.stdoutHandlers.push(cb);
  }

  onStderr(cb: (line: string) => void): void {
    this.stderrHandlers.push(cb);
  }

  kill(): void {
    this.killed = true;
  }

  emitStdout(line: string): void {
    this.stdoutHandlers.forEach((cb) => cb(line));
  }

  emitStderr(line: string): void {
    this.stderrHandlers.forEach((cb) => cb(line));
  }

  complete(exitCode: number): void {
    this.resolveExit(exitCode);
  }

  fail(err: unknown): void {
    this.rejectExit(err);
  }
}

function createRunner() {
  const invocations: ManualInvocation[] = [];
  const run = vi.fn(
    (_command: string, _args: string[], _options: CommandRunnerOptions) => {
      const invocation = new ManualInvocation();
      invocations.push(invocation);
      return invocation;
    },
  );
  const runner: CommandRunner = { run };

  return { runner, run, invocations };
}

describe('LocalCoordinator', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-26T10:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('records running then completed status for a successful workflow launch', async () => {
    const { runner, invocations } = createRunner();
    const coordinator = new LocalCoordinator(runner);

    const resultPromise = coordinator.launch({
      runId: 'run-success',
      workflowFile: 'workflow.yaml',
      cwd: '/repo',
      timeoutMs: 5_000,
    });

    expect(coordinator.getActiveRun('run-success')?.status).toBe('running');
    expect(coordinator.listActiveRuns()).toHaveLength(1);

    invocations[0].complete(0);
    const result = await resultPromise;

    expect(result.status).toBe('passed');
    expect(result.exitCode).toBe(0);
    expect(coordinator.getActiveRun('run-success')).toBeUndefined();
    expect(result.events.map((event) => event.kind)).toEqual([
      'started',
      'status_change',
      'status_change',
      'completed',
    ]);
    expect(result.events[1]).toMatchObject({
      kind: 'status_change',
      status: 'running',
      data: { previousStatus: 'pending', status: 'running' },
    });
    expect(result.events.at(-1)).toMatchObject({
      kind: 'completed',
      status: 'passed',
      data: { exitCode: 0 },
    });
  });

  it('records failed status, exit code, and stderr for a failed command', async () => {
    const { runner, invocations } = createRunner();
    const coordinator = new LocalCoordinator(runner);

    const resultPromise = coordinator.launch({
      runId: 'run-failed',
      workflowFile: 'workflow.yaml',
      cwd: '/repo',
      timeoutMs: 5_000,
    });

    invocations[0].emitStderr('fatal: missing token');
    invocations[0].complete(12);
    const result = await resultPromise;

    expect(result.status).toBe('failed');
    expect(result.exitCode).toBe(12);
    expect(result.error).toBe('exited with code 12');
    expect(result.stderr).toEqual(['fatal: missing token']);
    expect(result.stderrSnippet).toMatchObject({
      lines: ['fatal: missing token'],
      totalLines: 1,
      truncated: false,
    });
    expect(result.events).toContainEqual(
      expect.objectContaining({
        kind: 'stderr',
        status: 'running',
        message: 'fatal: missing token',
        data: { stream: 'stderr' },
      }),
    );
  });

  it('times out stalled commands without waiting on wall-clock time', async () => {
    const { runner, invocations } = createRunner();
    const coordinator = new LocalCoordinator(runner);

    const resultPromise = coordinator.launch({
      runId: 'run-timeout',
      workflowFile: 'workflow.yaml',
      cwd: '/repo',
      timeoutMs: 25,
    });

    await vi.advanceTimersByTimeAsync(25);
    const result = await resultPromise;

    expect(invocations[0].killed).toBe(true);
    expect(result.status).toBe('timed_out');
    expect(result.exitCode).toBeNull();
    expect(result.error).toBe('timed out after 25ms');
    expect(result.events.at(-1)).toMatchObject({
      kind: 'timeout',
      status: 'timed_out',
      data: { exitCode: null, timeoutMs: 25 },
    });
  });

  it('cancels active commands without hanging the test suite', async () => {
    const { runner, invocations } = createRunner();
    const coordinator = new LocalCoordinator(runner);

    const resultPromise = coordinator.launch({
      runId: 'run-cancelled',
      workflowFile: 'workflow.yaml',
      cwd: '/repo',
      timeoutMs: 5_000,
    });

    coordinator.cancel('run-cancelled');
    const result = await resultPromise;

    expect(invocations[0].killed).toBe(true);
    expect(result.status).toBe('failed');
    expect(result.exitCode).toBeNull();
    expect(result.error).toBe('cancelled');
    expect(result.events.at(-1)).toMatchObject({
      kind: 'cancelled',
      status: 'failed',
      data: { exitCode: null, error: 'cancelled' },
    });
  });

  it('captures stdout, stderr, lifecycle events, snippets, and metadata as evidence', async () => {
    const { runner, invocations } = createRunner();
    const coordinator = new LocalCoordinator(runner);
    const lifecycleEvents: unknown[] = [];
    coordinator.on('lifecycle', (event) => lifecycleEvents.push(event));

    const resultPromise = coordinator.launch({
      runId: 'run-evidence',
      workflowFile: 'workflow.yaml',
      cwd: '/repo',
      timeoutMs: 5_000,
      logSnippetLineLimit: 1,
      retry: { attempt: 2, maxAttempts: 3, reason: 'transient failure' },
      metadata: { workflowId: 'wf-local' },
    });

    invocations[0].emitStdout('first out');
    invocations[0].emitStdout('second out');
    invocations[0].emitStderr('first err');
    invocations[0].emitStderr('second err');
    invocations[0].complete(0);
    const result = await resultPromise;

    expect(lifecycleEvents).toHaveLength(result.events.length);
    expect(result.stdout).toEqual(['first out', 'second out']);
    expect(result.stderr).toEqual(['first err', 'second err']);
    expect(result.stdoutSnippet).toEqual({
      lines: ['second out'],
      totalLines: 2,
      maxLines: 1,
      truncated: true,
    });
    expect(result.stderrSnippet).toEqual({
      lines: ['second err'],
      totalLines: 2,
      maxLines: 1,
      truncated: true,
    });
    expect(result.retry).toMatchObject({
      attempt: 2,
      maxAttempts: 3,
      reason: 'transient failure',
    });
    expect(result.metadata).toEqual({ workflowId: 'wf-local' });
    expect(result.events.map((event) => event.kind)).toEqual([
      'started',
      'status_change',
      'stdout',
      'stdout',
      'stderr',
      'stderr',
      'status_change',
      'completed',
    ]);
  });

  it('rejects duplicate runId when a run with that id is already active', async () => {
    const { runner, invocations } = createRunner();
    const coordinator = new LocalCoordinator(runner);

    const first = coordinator.launch({
      runId: 'dup-id',
      workflowFile: 'workflow.yaml',
      cwd: '/repo',
      timeoutMs: 5_000,
    });

    await expect(
      coordinator.launch({
        runId: 'dup-id',
        workflowFile: 'workflow.yaml',
        cwd: '/repo',
        timeoutMs: 5_000,
      }),
    ).rejects.toThrow('Duplicate runId: "dup-id" is already active');

    // First run is still tracked and can complete normally
    invocations[0].complete(0);
    const result = await first;
    expect(result.status).toBe('passed');
    expect(coordinator.getActiveRun('dup-id')).toBeUndefined();
  });

  it('tracks concurrent launches with different runIds independently', async () => {
    const { runner, invocations } = createRunner();
    const coordinator = new LocalCoordinator(runner);

    const first = coordinator.launch({
      runId: 'run-a',
      workflowFile: 'a.yaml',
      cwd: '/repo',
      timeoutMs: 5_000,
    });
    const second = coordinator.launch({
      runId: 'run-b',
      workflowFile: 'b.yaml',
      cwd: '/repo',
      timeoutMs: 5_000,
    });

    expect(coordinator.listActiveRuns()).toHaveLength(2);

    // Complete run-b first
    invocations[1].complete(0);
    const resultB = await second;
    expect(resultB.runId).toBe('run-b');
    expect(resultB.status).toBe('passed');
    expect(coordinator.listActiveRuns()).toHaveLength(1);
    expect(coordinator.getActiveRun('run-a')?.status).toBe('running');

    // Complete run-a
    invocations[0].complete(1);
    const resultA = await first;
    expect(resultA.runId).toBe('run-a');
    expect(resultA.status).toBe('failed');
    expect(coordinator.listActiveRuns()).toHaveLength(0);
  });

  it('cancelling one run does not affect another active run', async () => {
    const { runner, invocations } = createRunner();
    const coordinator = new LocalCoordinator(runner);

    const first = coordinator.launch({
      runId: 'keep-alive',
      workflowFile: 'a.yaml',
      cwd: '/repo',
      timeoutMs: 5_000,
    });
    const second = coordinator.launch({
      runId: 'cancel-me',
      workflowFile: 'b.yaml',
      cwd: '/repo',
      timeoutMs: 5_000,
    });

    coordinator.cancel('cancel-me');
    const cancelledResult = await second;
    expect(cancelledResult.status).toBe('failed');
    expect(cancelledResult.error).toBe('cancelled');

    // The other run is still active and can complete
    expect(coordinator.getActiveRun('keep-alive')?.status).toBe('running');
    invocations[0].complete(0);
    const keptResult = await first;
    expect(keptResult.status).toBe('passed');
  });

  it('monitor() terminates immediately for an unknown runId', async () => {
    const { runner } = createRunner();
    const coordinator = new LocalCoordinator(runner);

    const events: unknown[] = [];
    for await (const event of coordinator.monitor('nonexistent')) {
      events.push(event);
    }
    expect(events).toHaveLength(0);
  });

  it('monitor() receives lifecycle events and terminates on completion', async () => {
    const { runner, invocations } = createRunner();
    const coordinator = new LocalCoordinator(runner);

    const launchPromise = coordinator.launch({
      runId: 'mon-run',
      workflowFile: 'workflow.yaml',
      cwd: '/repo',
      timeoutMs: 5_000,
    });

    const monitoredEvents: Array<{ kind: string }> = [];
    const monitorDone = (async () => {
      for await (const event of coordinator.monitor('mon-run')) {
        monitoredEvents.push({ kind: event.kind });
      }
    })();

    invocations[0].emitStdout('hello');
    invocations[0].complete(0);
    await launchPromise;
    await monitorDone;

    const kinds = monitoredEvents.map((e) => e.kind);
    expect(kinds).toContain('stdout');
    expect(kinds).toContain('completed');
  });

  it('handles runner.run() throwing synchronously', async () => {
    const runner: CommandRunner = {
      run: () => {
        throw new Error('spawn failed');
      },
    };
    const coordinator = new LocalCoordinator(runner);

    const result = await coordinator.launch({
      runId: 'run-throw',
      workflowFile: 'workflow.yaml',
      cwd: '/repo',
      timeoutMs: 5_000,
    });

    expect(result.status).toBe('failed');
    expect(result.exitCode).toBeNull();
    expect(result.error).toBe('spawn failed');
    expect(result.events.at(-1)).toMatchObject({
      kind: 'error',
      status: 'failed',
    });
  });

  it('handles exitPromise rejection', async () => {
    const { runner, invocations } = createRunner();
    const coordinator = new LocalCoordinator(runner);

    const resultPromise = coordinator.launch({
      runId: 'run-reject',
      workflowFile: 'workflow.yaml',
      cwd: '/repo',
      timeoutMs: 5_000,
    });

    invocations[0].fail(new Error('process crashed'));
    const result = await resultPromise;

    expect(result.status).toBe('failed');
    expect(result.exitCode).toBeNull();
    expect(result.error).toBe('process crashed');
    expect(result.events.at(-1)).toMatchObject({
      kind: 'error',
      status: 'failed',
    });
  });

  it('uses injected command runner instead of invoking agent-relay directly', async () => {
    const { runner, run, invocations } = createRunner();
    const coordinator = new LocalCoordinator(runner);

    const resultPromise = coordinator.launch({
      runId: 'run-injected',
      workflowFile: 'workflow.yaml',
      cwd: '/repo',
      timeoutMs: 5_000,
      extraArgs: ['--json'],
      env: { RELAYCAST_WORKSPACE: 'test' },
      route: { command: 'fake-runtime', baseArgs: ['execute', '--local'] },
    });

    invocations[0].complete(0);
    const result = await resultPromise;

    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith(
      'fake-runtime',
      ['execute', '--local', 'workflow.yaml', '--json'],
      { cwd: '/repo', env: { RELAYCAST_WORKSPACE: 'test' } },
    );
    expect(result.invocation).toEqual({
      command: 'fake-runtime',
      args: ['execute', '--local', 'workflow.yaml', '--json'],
      cwd: '/repo',
      env: { RELAYCAST_WORKSPACE: 'test' },
    });
  });
});
