import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

import { LocalCoordinator } from './local-coordinator.js';
import type {
  CommandInvocation,
  CommandRunner,
  CommandRunnerOptions,
  LifecycleEvent,
} from './types.js';

class ManualInvocation implements CommandInvocation {
  readonly stdoutHandlers: Array<(line: string) => void> = [];
  readonly stderrHandlers: Array<(line: string) => void> = [];
  readonly exitPromise: Promise<number | null>;
  killed = false;

  private resolveExit!: (code: number | null) => void;
  private rejectExit!: (err: unknown) => void;

  constructor() {
    this.exitPromise = new Promise<number | null>((resolve, reject) => {
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

  complete(exitCode: number | null): void {
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
    const { runner, run, invocations } = createRunner();
    const coordinator = new LocalCoordinator(runner);
    const lifecycleEvents: LifecycleEvent[] = [];
    coordinator.on('lifecycle', (event) => lifecycleEvents.push(event));

    const resultPromise = coordinator.launch({
      runId: 'run-success',
      workflowFile: 'workflow.yaml',
      cwd: '/repo',
      timeoutMs: 5_000,
    });

    expect(coordinator.getActiveRun('run-success')).toMatchObject({
      runId: 'run-success',
      workflowFile: 'workflow.yaml',
      cwd: '/repo',
      status: 'running',
      invocation: {
        command: 'agent-relay',
        args: ['run', 'workflow.yaml'],
        cwd: '/repo',
      },
      retry: { attempt: 1 },
    });
    expect(coordinator.listActiveRuns()).toHaveLength(1);
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith('agent-relay', ['run', 'workflow.yaml'], {
      cwd: '/repo',
      env: undefined,
    });

    invocations[0].complete(0);
    const result = await resultPromise;

    expect(result.status).toBe('passed');
    expect(result.exitCode).toBe(0);
    expect(coordinator.getActiveRun('run-success')).toBeUndefined();
    expect(lifecycleEvents).toEqual(result.events);
    expect(result.events.map((event) => event.kind)).toEqual([
      'started',
      'status_change',
      'status_change',
      'completed',
    ]);
    expect(result.events.map((event) => event.status)).toEqual([
      'pending',
      'running',
      'passed',
      'passed',
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
    expect(result.invocation).toMatchObject({
      command: 'agent-relay',
      args: ['run', 'workflow.yaml'],
      cwd: '/repo',
    });
    expect(result.stdout).toEqual([]);
    expect(result.stderr).toEqual([]);
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
    expect(coordinator.getActiveRun('run-failed')).toMatchObject({
      status: 'running',
      invocation: {
        command: 'agent-relay',
        args: ['run', 'workflow.yaml'],
        cwd: '/repo',
      },
    });
    invocations[0].complete(12);
    const result = await resultPromise;

    expect(result.status).toBe('failed');
    expect(result.exitCode).toBe(12);
    expect(result.error).toBe('exited with code 12');
    expect(coordinator.getActiveRun('run-failed')).toBeUndefined();
    expect(result.stderr).toEqual(['fatal: missing token']);
    expect(result.stderrSnippet).toMatchObject({
      lines: ['fatal: missing token'],
      totalLines: 1,
      truncated: false,
    });
    expect(result.events).toContainEqual(
      expect.objectContaining({
        kind: 'status_change',
        status: 'failed',
        data: { previousStatus: 'running', status: 'failed' },
      }),
    );
    expect(result.events.at(-1)).toMatchObject({
      kind: 'completed',
      status: 'failed',
      data: { exitCode: 12, error: 'exited with code 12' },
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

    invocations[0].emitStdout('still working');
    invocations[0].emitStderr('waiting on worker');
    await vi.advanceTimersByTimeAsync(25);
    const result = await resultPromise;

    expect(invocations[0].killed).toBe(true);
    expect(result.status).toBe('timed_out');
    expect(result.exitCode).toBeNull();
    expect(result.error).toBe('timed out after 25ms');
    expect(result.stdout).toEqual(['still working']);
    expect(result.stderr).toEqual(['waiting on worker']);
    expect(result.events.map((event) => event.kind)).toEqual([
      'started',
      'status_change',
      'stdout',
      'stderr',
      'status_change',
      'timeout',
    ]);
    expect(result.events).toContainEqual(
      expect.objectContaining({
        kind: 'status_change',
        status: 'timed_out',
        data: { previousStatus: 'running', status: 'timed_out' },
      }),
    );
    expect(result.events.at(-1)).toMatchObject({
      kind: 'timeout',
      status: 'timed_out',
      data: { exitCode: null, timeoutMs: 25 },
    });
    expect(coordinator.getActiveRun('run-timeout')).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);

    invocations[0].complete(0);
    await Promise.resolve();
    expect(result.status).toBe('timed_out');
  });

  it('keeps timeout evidence stable when a killed command rejects later', async () => {
    const { runner, invocations } = createRunner();
    const coordinator = new LocalCoordinator(runner);

    const resultPromise = coordinator.launch({
      runId: 'run-timeout-late-reject',
      workflowFile: 'workflow.yaml',
      cwd: '/repo',
      timeoutMs: 25,
    });

    invocations[0].emitStdout('before timeout');
    await vi.advanceTimersByTimeAsync(25);
    const result = await resultPromise;

    expect(invocations[0].killed).toBe(true);
    expect(result.status).toBe('timed_out');
    expect(result.exitCode).toBeNull();
    expect(result.error).toBe('timed out after 25ms');
    expect(result.stdout).toEqual(['before timeout']);
    expect(result.events.at(-1)).toMatchObject({
      kind: 'timeout',
      status: 'timed_out',
      data: { exitCode: null, timeoutMs: 25 },
    });

    invocations[0].fail(new Error('process rejected after timeout'));
    await Promise.resolve();

    expect(result.status).toBe('timed_out');
    expect(result.error).toBe('timed out after 25ms');
    expect(result.events.at(-1)).toMatchObject({
      kind: 'timeout',
      status: 'timed_out',
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
    expect(result.status).toBe('cancelled');
    expect(result.exitCode).toBeNull();
    expect(result.error).toBe('cancelled');
    expect(result.events.map((event) => event.kind)).toEqual([
      'started',
      'status_change',
      'status_change',
      'cancelled',
    ]);
    expect(result.events.at(-1)).toMatchObject({
      kind: 'cancelled',
      status: 'cancelled',
      data: { exitCode: null, error: 'cancelled' },
    });
    expect(coordinator.getActiveRun('run-cancelled')).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);

    invocations[0].complete(0);
    await Promise.resolve();
    expect(result.error).toBe('cancelled');
  });

  it('preserves pre-cancel output and lifecycle evidence when a run is aborted', async () => {
    const { runner, invocations } = createRunner();
    const coordinator = new LocalCoordinator(runner);

    const resultPromise = coordinator.launch({
      runId: 'run-cancel-evidence',
      workflowFile: 'workflow.yaml',
      cwd: '/repo',
      timeoutMs: 5_000,
    });

    invocations[0].emitStdout('step started');
    invocations[0].emitStderr('waiting for reviewer');
    coordinator.cancel('run-cancel-evidence');
    const result = await resultPromise;

    expect(result.status).toBe('cancelled');
    expect(result.exitCode).toBeNull();
    expect(result.stdout).toEqual(['step started']);
    expect(result.stderr).toEqual(['waiting for reviewer']);
    expect(result.events.map((event) => event.kind)).toEqual([
      'started',
      'status_change',
      'stdout',
      'stderr',
      'status_change',
      'cancelled',
    ]);
    expect(result.events).toContainEqual(
      expect.objectContaining({
        kind: 'stdout',
        status: 'running',
        message: 'step started',
      }),
    );
    expect(result.events).toContainEqual(
      expect.objectContaining({
        kind: 'stderr',
        status: 'running',
        message: 'waiting for reviewer',
      }),
    );
    expect(result.events.at(-1)).toMatchObject({
      kind: 'cancelled',
      status: 'cancelled',
      data: { exitCode: null, error: 'cancelled' },
    });

    invocations[0].emitStdout('late output');
    invocations[0].emitStderr('late error');
    invocations[0].complete(0);
    await Promise.resolve();

    expect(result.stdout).toEqual(['step started']);
    expect(result.stderr).toEqual(['waiting for reviewer']);
    expect(result.events.map((event) => event.kind)).toEqual([
      'started',
      'status_change',
      'stdout',
      'stderr',
      'status_change',
      'cancelled',
    ]);
  });

  it('cancels during startup without invoking the injected command runner', async () => {
    const { runner, run } = createRunner();
    const coordinator = new LocalCoordinator(runner);

    coordinator.on('lifecycle', (event) => {
      if (event.kind === 'started') {
        coordinator.cancel(event.runId);
      }
    });

    const result = await coordinator.launch({
      runId: 'run-cancel-before-spawn',
      workflowFile: 'workflow.yaml',
      cwd: '/repo',
      timeoutMs: 5_000,
    });

    expect(run).not.toHaveBeenCalled();
    expect(result.status).toBe('cancelled');
    expect(result.exitCode).toBeNull();
    expect(result.error).toBe('cancelled');
    expect(result.events.map((event) => event.kind)).toEqual([
      'started',
      'status_change',
      'cancelled',
    ]);
    expect(result.events.at(-1)).toMatchObject({
      kind: 'cancelled',
      status: 'cancelled',
      data: { exitCode: null, error: 'cancelled' },
    });
    expect(coordinator.getActiveRun('run-cancel-before-spawn')).toBeUndefined();
  });

  it('captures stdout, stderr, lifecycle events, snippets, and metadata as evidence', async () => {
    const { runner, invocations } = createRunner();
    const coordinator = new LocalCoordinator(runner);
    const lifecycleEvents: LifecycleEvent[] = [];
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

    expect(lifecycleEvents).toEqual(result.events);
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
    expect(result.events[0]).toMatchObject({
      kind: 'started',
      runId: 'run-evidence',
      status: 'pending',
      data: {
        workflowFile: 'workflow.yaml',
        cwd: '/repo',
        invocation: {
          command: 'agent-relay',
          args: ['run', 'workflow.yaml'],
          cwd: '/repo',
        },
        retry: {
          attempt: 2,
          maxAttempts: 3,
          reason: 'transient failure',
        },
        metadata: { workflowId: 'wf-local' },
      },
    });
    expect(result.events).toContainEqual(
      expect.objectContaining({
        kind: 'stdout',
        message: 'second out',
        data: { stream: 'stdout' },
      }),
    );
    expect(result.events).toContainEqual(
      expect.objectContaining({
        kind: 'stderr',
        message: 'second err',
        data: { stream: 'stderr' },
      }),
    );
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
    expect(cancelledResult.status).toBe('cancelled');
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

  it('settles and clears active state even when a lifecycle listener throws', async () => {
    const { runner, invocations } = createRunner();
    const coordinator = new LocalCoordinator(runner);
    const stableListener = vi.fn();

    coordinator.on('lifecycle', (event) => {
      if (event.kind === 'completed') {
        throw new Error('observer failed during completion');
      }
    });
    coordinator.on('lifecycle', stableListener);

    const resultPromise = coordinator.launch({
      runId: 'run-listener-throw',
      workflowFile: 'workflow.yaml',
      cwd: '/repo',
      timeoutMs: 5_000,
    });

    invocations[0].complete(0);
    const result = await resultPromise;

    expect(result.status).toBe('passed');
    expect(result.exitCode).toBe(0);
    expect(coordinator.getActiveRun('run-listener-throw')).toBeUndefined();
    expect(stableListener).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: 'run-listener-throw',
        kind: 'completed',
        status: 'passed',
      }),
    );
    expect(result.events.at(-1)).toMatchObject({
      kind: 'completed',
      status: 'passed',
      data: { exitCode: 0 },
    });
  });

  it('routes the default agent-relay command through the injected runner', async () => {
    const { runner, run, invocations } = createRunner();
    const coordinator = new LocalCoordinator(runner);

    const resultPromise = coordinator.launch({
      runId: 'run-default-route',
      workflowFile: 'workflow.yaml',
      cwd: '/repo',
      timeoutMs: 5_000,
      extraArgs: ['--json'],
      env: { RELAYCAST_WORKSPACE: 'test' },
    });

    expect(invocations).toHaveLength(1);
    expect(run).toHaveBeenCalledWith('agent-relay', ['run', 'workflow.yaml', '--json'], {
      cwd: '/repo',
      env: { RELAYCAST_WORKSPACE: 'test' },
    });

    invocations[0].complete(0);
    const result = await resultPromise;

    expect(result.status).toBe('passed');
    expect(result.invocation).toEqual({
      command: 'agent-relay',
      args: ['run', 'workflow.yaml', '--json'],
      cwd: '/repo',
      env: { RELAYCAST_WORKSPACE: 'test' },
    });
  });

  it('threads retry resume metadata into agent-relay args', async () => {
    const { runner, run, invocations } = createRunner();
    const coordinator = new LocalCoordinator(runner);

    const resultPromise = coordinator.launch({
      runId: 'run-retry',
      workflowFile: 'workflow.yaml',
      cwd: '/repo',
      timeoutMs: 5_000,
      retry: {
        attempt: 2,
        maxAttempts: 3,
        previousRunId: 'run-previous',
        startFromStep: 'failed-step',
      },
    });

    invocations[0].complete(0);
    const result = await resultPromise;

    expect(run).toHaveBeenCalledWith(
      'agent-relay',
      ['run', 'workflow.yaml', '--start-from', 'failed-step', '--previous-run-id', 'run-previous'],
      { cwd: '/repo', env: undefined },
    );
    expect(result.retry).toMatchObject({
      attempt: 2,
      maxAttempts: 3,
      previousRunId: 'run-previous',
      startFromStep: 'failed-step',
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

  it('does not require a real agent-relay process when the runner is injected', async () => {
    const invocation = new ManualInvocation();
    const run = vi.fn(
      (command: string, args: string[], options: CommandRunnerOptions): CommandInvocation => {
        expect(command).toBe('agent-relay');
        expect(args).toEqual(['run', 'generated/no-real-process.yaml']);
        expect(options).toEqual({ cwd: '/repo', env: undefined });
        return invocation;
      },
    );
    const coordinator = new LocalCoordinator({ run });

    const resultPromise = coordinator.launch({
      runId: 'run-without-real-agent-relay',
      workflowFile: 'generated/no-real-process.yaml',
      cwd: '/repo',
      timeoutMs: 5_000,
    });

    expect(run).toHaveBeenCalledTimes(1);
    expect(coordinator.getActiveRun('run-without-real-agent-relay')).toMatchObject({
      status: 'running',
      invocation: {
        command: 'agent-relay',
        args: ['run', 'generated/no-real-process.yaml'],
        cwd: '/repo',
      },
    });

    invocation.emitStdout('unit runner captured stdout');
    invocation.emitStderr('unit runner captured stderr');
    invocation.complete(0);
    const result = await resultPromise;

    expect(result.status).toBe('passed');
    expect(result.invocation).toEqual({
      command: 'agent-relay',
      args: ['run', 'generated/no-real-process.yaml'],
      cwd: '/repo',
    });
    expect(result.stdout).toEqual(['unit runner captured stdout']);
    expect(result.stderr).toEqual(['unit runner captured stderr']);
    expect(result.events.map((event) => event.kind)).toEqual([
      'started',
      'status_change',
      'stdout',
      'stderr',
      'status_change',
      'completed',
    ]);
    expect(result.events).toContainEqual(
      expect.objectContaining({
        kind: 'stdout',
        status: 'running',
        message: 'unit runner captured stdout',
      }),
    );
    expect(result.events).toContainEqual(
      expect.objectContaining({
        kind: 'stderr',
        status: 'running',
        message: 'unit runner captured stderr',
      }),
    );
  });

  it('keeps running, output, failure, and runner-boundary evidence on the public result contract', async () => {
    const { runner, run, invocations } = createRunner();
    const coordinator = new LocalCoordinator(runner);
    const lifecycleEvents: LifecycleEvent[] = [];
    coordinator.on('lifecycle', (event) => lifecycleEvents.push(event));

    const resultPromise = coordinator.launch({
      runId: 'run-focused-contract',
      workflowFile: 'generated/focused-workflow.yaml',
      cwd: '/repo',
      timeoutMs: 5_000,
      extraArgs: ['--json'],
      env: { RELAYCAST_WORKSPACE: 'unit-test' },
      metadata: { workflowId: 'focused-workflow' },
    });

    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith(
      'agent-relay',
      ['run', 'generated/focused-workflow.yaml', '--json'],
      { cwd: '/repo', env: { RELAYCAST_WORKSPACE: 'unit-test' } },
    );
    expect(coordinator.getActiveRun('run-focused-contract')).toMatchObject({
      runId: 'run-focused-contract',
      status: 'running',
      invocation: {
        command: 'agent-relay',
        args: ['run', 'generated/focused-workflow.yaml', '--json'],
        cwd: '/repo',
        env: { RELAYCAST_WORKSPACE: 'unit-test' },
      },
      metadata: { workflowId: 'focused-workflow' },
    });

    invocations[0].emitStdout('{"event":"workflow.started"}');
    invocations[0].emitStderr('step failed: review');
    invocations[0].complete(9);
    const result = await resultPromise;

    expect(lifecycleEvents).toEqual(result.events);
    expect(result.status).toBe('failed');
    expect(result.exitCode).toBe(9);
    expect(result.error).toBe('exited with code 9');
    expect(result.invocation).toEqual({
      command: 'agent-relay',
      args: ['run', 'generated/focused-workflow.yaml', '--json'],
      cwd: '/repo',
      env: { RELAYCAST_WORKSPACE: 'unit-test' },
    });
    expect(result.metadata).toEqual({ workflowId: 'focused-workflow' });
    expect(result.stdout).toEqual(['{"event":"workflow.started"}']);
    expect(result.stderr).toEqual(['step failed: review']);
    expect(result.stderrSnippet).toMatchObject({
      lines: ['step failed: review'],
      totalLines: 1,
      truncated: false,
    });
    expect(result.events.map((event) => event.kind)).toEqual([
      'started',
      'status_change',
      'stdout',
      'stderr',
      'status_change',
      'completed',
    ]);
    expect(result.events.at(-1)).toMatchObject({
      kind: 'completed',
      status: 'failed',
      data: { exitCode: 9, error: 'exited with code 9' },
    });
    expect(coordinator.getActiveRun('run-focused-contract')).toBeUndefined();
  });

  it('handles exitPromise resolving to null (signal termination)', async () => {
    const { runner, invocations } = createRunner();
    const coordinator = new LocalCoordinator(runner);

    const resultPromise = coordinator.launch({
      runId: 'run-null-exit',
      workflowFile: 'workflow.yaml',
      cwd: '/repo',
      timeoutMs: 5_000,
    });

    invocations[0].complete(null);
    const result = await resultPromise;

    expect(result.status).toBe('failed');
    expect(result.exitCode).toBeNull();
    expect(result.error).toBe('exited without an exit code');
    expect(result.events.at(-1)).toMatchObject({
      kind: 'completed',
      status: 'failed',
      message: 'Run completed without an exit code',
    });
  });

  it('captures kill error during cancellation without throwing', async () => {
    const invocation = new ManualInvocation();
    invocation.kill = () => {
      throw new Error('ESRCH: process already exited');
    };
    const run = vi.fn((): CommandInvocation => invocation);
    const coordinator = new LocalCoordinator({ run });

    const resultPromise = coordinator.launch({
      runId: 'run-kill-error',
      workflowFile: 'workflow.yaml',
      cwd: '/repo',
      timeoutMs: 5_000,
    });

    coordinator.cancel('run-kill-error');
    const result = await resultPromise;

    expect(result.status).toBe('cancelled');
    expect(result.events.at(-1)).toMatchObject({
      kind: 'cancelled',
      data: expect.objectContaining({
        killError: 'ESRCH: process already exited',
      }),
    });
  });

  it('captures kill error during timeout without throwing', async () => {
    const invocation = new ManualInvocation();
    invocation.kill = () => {
      throw new Error('EPERM: operation not permitted');
    };
    const run = vi.fn((): CommandInvocation => invocation);
    const coordinator = new LocalCoordinator({ run });

    const resultPromise = coordinator.launch({
      runId: 'run-kill-timeout-error',
      workflowFile: 'workflow.yaml',
      cwd: '/repo',
      timeoutMs: 25,
    });

    await vi.advanceTimersByTimeAsync(25);
    const result = await resultPromise;

    expect(result.status).toBe('timed_out');
    expect(result.events.at(-1)).toMatchObject({
      kind: 'timeout',
      data: expect.objectContaining({
        killError: 'EPERM: operation not permitted',
      }),
    });
  });

  it('keeps generated workflow launches behind the injected runner boundary', async () => {
    const invocation = new ManualInvocation();
    const run = vi.fn(
      (command: string, args: string[], options: CommandRunnerOptions): CommandInvocation => {
        expect(command).toBe('agent-relay');
        expect(args).toEqual(['run', 'generated/workflow.yaml', '--json']);
        expect(options).toEqual({
          cwd: '/repo',
          env: { RELAYCAST_WORKSPACE: 'unit-test' },
        });
        return invocation;
      },
    );
    const coordinator = new LocalCoordinator({ run });

    const resultPromise = coordinator.launch({
      runId: 'run-generated-boundary',
      workflowFile: 'generated/workflow.yaml',
      cwd: '/repo',
      timeoutMs: 5_000,
      extraArgs: ['--json'],
      env: { RELAYCAST_WORKSPACE: 'unit-test' },
      metadata: { source: 'generated-workflow' },
    });

    expect(run).toHaveBeenCalledTimes(1);
    expect(coordinator.getActiveRun('run-generated-boundary')).toMatchObject({
      status: 'running',
      invocation: {
        command: 'agent-relay',
        args: ['run', 'generated/workflow.yaml', '--json'],
        cwd: '/repo',
        env: { RELAYCAST_WORKSPACE: 'unit-test' },
      },
      metadata: { source: 'generated-workflow' },
    });

    invocation.emitStdout('generated workflow started');
    invocation.emitStderr('generated workflow warning');
    invocation.complete(0);
    const result = await resultPromise;

    expect(result.status).toBe('passed');
    expect(result.invocation.command).toBe('agent-relay');
    expect(result.invocation.args).toEqual(['run', 'generated/workflow.yaml', '--json']);
    expect(result.metadata).toEqual({ source: 'generated-workflow' });
    expect(result.stdout).toEqual(['generated workflow started']);
    expect(result.stderr).toEqual(['generated workflow warning']);
    expect(result.events).toContainEqual(
      expect.objectContaining({
        kind: 'stdout',
        status: 'running',
        message: 'generated workflow started',
      }),
    );
    expect(result.events).toContainEqual(
      expect.objectContaining({
        kind: 'stderr',
        status: 'running',
        message: 'generated workflow warning',
      }),
    );
  });

  it('records generated workflow active and terminal evidence through only the injected runner', async () => {
    const { runner, run, invocations } = createRunner();
    const coordinator = new LocalCoordinator(runner);

    const resultPromise = coordinator.launch({
      runId: 'run-generated-injected-evidence',
      workflowFile: 'generated/evidence-workflow.yaml',
      cwd: '/repo',
      timeoutMs: 5_000,
      extraArgs: ['--json'],
      env: { RELAYCAST_WORKSPACE: 'unit-test' },
      metadata: { workflowId: 'generated-evidence-workflow' },
    });

    expect(run).toHaveBeenCalledTimes(1);
    expect(invocations).toHaveLength(1);
    expect(coordinator.getActiveRun('run-generated-injected-evidence')).toMatchObject({
      status: 'running',
      invocation: {
        command: 'agent-relay',
        args: ['run', 'generated/evidence-workflow.yaml', '--json'],
        cwd: '/repo',
        env: { RELAYCAST_WORKSPACE: 'unit-test' },
      },
      metadata: { workflowId: 'generated-evidence-workflow' },
    });

    invocations[0].emitStdout('{"event":"started"}');
    invocations[0].emitStderr('debug warning');
    invocations[0].complete(0);
    const result = await resultPromise;

    expect(result.status).toBe('passed');
    expect(result.exitCode).toBe(0);
    expect(result.invocation).toEqual({
      command: 'agent-relay',
      args: ['run', 'generated/evidence-workflow.yaml', '--json'],
      cwd: '/repo',
      env: { RELAYCAST_WORKSPACE: 'unit-test' },
    });
    expect(result.stdout).toEqual(['{"event":"started"}']);
    expect(result.stderr).toEqual(['debug warning']);
    expect(result.metadata).toEqual({ workflowId: 'generated-evidence-workflow' });
    expect(result.events.map((event) => event.kind)).toEqual([
      'started',
      'status_change',
      'stdout',
      'stderr',
      'status_change',
      'completed',
    ]);
  });

  it('returns failed generated workflow evidence through the injected runner for debugger analysis', async () => {
    const { runner, run, invocations } = createRunner();
    const coordinator = new LocalCoordinator(runner);
    const lifecycleEvents: LifecycleEvent[] = [];
    coordinator.on('lifecycle', (event) => lifecycleEvents.push(event));

    const resultPromise = coordinator.launch({
      runId: 'run-generated-debug-failure',
      workflowFile: 'generated/debug-target.yaml',
      cwd: '/repo',
      timeoutMs: 5_000,
      extraArgs: ['--json'],
      env: { RELAYCAST_WORKSPACE: 'unit-test' },
      metadata: { workflowId: 'generated-debug-target', source: 'generated-workflow' },
    });

    expect(run).toHaveBeenCalledWith(
      'agent-relay',
      ['run', 'generated/debug-target.yaml', '--json'],
      { cwd: '/repo', env: { RELAYCAST_WORKSPACE: 'unit-test' } },
    );

    invocations[0].emitStdout('{"step":"prepare","status":"running"}');
    invocations[0].emitStderr('MISSING_ENV_VAR: RELAYCAST_WORKSPACE');
    invocations[0].complete(2);
    const result = await resultPromise;

    expect(lifecycleEvents).toEqual(result.events);
    expect(result.status).toBe('failed');
    expect(result.exitCode).toBe(2);
    expect(result.error).toBe('exited with code 2');
    expect(result.invocation).toEqual({
      command: 'agent-relay',
      args: ['run', 'generated/debug-target.yaml', '--json'],
      cwd: '/repo',
      env: { RELAYCAST_WORKSPACE: 'unit-test' },
    });
    expect(result.metadata).toEqual({
      workflowId: 'generated-debug-target',
      source: 'generated-workflow',
    });
    expect(result.stdout).toEqual(['{"step":"prepare","status":"running"}']);
    expect(result.stderr).toEqual(['MISSING_ENV_VAR: RELAYCAST_WORKSPACE']);
    expect(result.stderrSnippet).toMatchObject({
      lines: ['MISSING_ENV_VAR: RELAYCAST_WORKSPACE'],
      totalLines: 1,
      truncated: false,
    });
    expect(result.events).toContainEqual(
      expect.objectContaining({
        kind: 'stdout',
        status: 'running',
        message: '{"step":"prepare","status":"running"}',
      }),
    );
    expect(result.events).toContainEqual(
      expect.objectContaining({
        kind: 'stderr',
        status: 'running',
        message: 'MISSING_ENV_VAR: RELAYCAST_WORKSPACE',
      }),
    );
    expect(result.events.at(-1)).toMatchObject({
      kind: 'completed',
      status: 'failed',
      data: { exitCode: 2, error: 'exited with code 2' },
    });
  });

  it('records injected generated workflow lifecycle evidence from running to failed completion', async () => {
    const { runner, run, invocations } = createRunner();
    const coordinator = new LocalCoordinator(runner);

    const resultPromise = coordinator.launch({
      runId: 'run-generated-lifecycle-evidence',
      workflowFile: 'generated/lifecycle-workflow.yaml',
      cwd: '/repo',
      timeoutMs: 5_000,
      extraArgs: ['--json'],
      metadata: { workflowId: 'generated-lifecycle-workflow' },
    });

    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith(
      'agent-relay',
      ['run', 'generated/lifecycle-workflow.yaml', '--json'],
      { cwd: '/repo', env: undefined },
    );
    expect(coordinator.getActiveRun('run-generated-lifecycle-evidence')).toMatchObject({
      status: 'running',
      invocation: {
        command: 'agent-relay',
        args: ['run', 'generated/lifecycle-workflow.yaml', '--json'],
        cwd: '/repo',
      },
      metadata: { workflowId: 'generated-lifecycle-workflow' },
    });

    invocations[0].emitStdout('{"event":"step.started","step":"prepare"}');
    invocations[0].emitStderr('prepare failed');
    invocations[0].complete(7);
    const result = await resultPromise;

    expect(result.status).toBe('failed');
    expect(result.exitCode).toBe(7);
    expect(result.error).toBe('exited with code 7');
    expect(result.stdout).toEqual(['{"event":"step.started","step":"prepare"}']);
    expect(result.stderr).toEqual(['prepare failed']);
    expect(result.invocation).toEqual({
      command: 'agent-relay',
      args: ['run', 'generated/lifecycle-workflow.yaml', '--json'],
      cwd: '/repo',
    });
    expect(result.events.map((event) => event.kind)).toEqual([
      'started',
      'status_change',
      'stdout',
      'stderr',
      'status_change',
      'completed',
    ]);
    expect(result.events.at(-1)).toMatchObject({
      kind: 'completed',
      status: 'failed',
      data: { exitCode: 7, error: 'exited with code 7' },
    });
    expect(coordinator.getActiveRun('run-generated-lifecycle-evidence')).toBeUndefined();
  });

  it('does not invoke the runner when a lifecycle observer cancels during pre-spawn events', async () => {
    const { runner, run, invocations } = createRunner();
    const coordinator = new LocalCoordinator(runner);

    // Observer cancels the run as soon as the 'started' event fires — before runner.run().
    coordinator.on('lifecycle', (event) => {
      if (event.kind === 'started') {
        coordinator.cancel(event.runId);
      }
    });

    const result = await coordinator.launch({
      runId: 'run-pre-spawn-cancel',
      workflowFile: 'workflow.yaml',
      cwd: '/repo',
      timeoutMs: 5_000,
    });

    // The runner must never have been called.
    expect(run).not.toHaveBeenCalled();
    expect(invocations).toHaveLength(0);

    // Result is cancelled with no post-terminal events.
    expect(result.status).toBe('cancelled');
    expect(result.exitCode).toBeNull();
    expect(result.error).toBe('cancelled');
    expect(coordinator.getActiveRun('run-pre-spawn-cancel')).toBeUndefined();

    // Event sequence: started (pending), status_change (pending→cancelled), cancelled.
    // No 'running' transition should appear because cancel happened before transition('running').
    expect(result.events.map((e) => e.kind)).toEqual([
      'started',
      'status_change',
      'cancelled',
    ]);
    expect(result.events[1]).toMatchObject({
      kind: 'status_change',
      data: { previousStatus: 'pending', status: 'cancelled' },
    });

    // The last event must be the terminal cancelled event.
    expect(result.events.at(-1)).toMatchObject({
      kind: 'cancelled',
      status: 'cancelled',
    });

    // Verify no timer is left pending by advancing time — should not change result.
    await vi.advanceTimersByTimeAsync(10_000);
    expect(result.status).toBe('cancelled');
  });

  it('normalizes invalid timeoutMs values to the default timeout', async () => {
    const { runner, invocations } = createRunner();
    const coordinator = new LocalCoordinator(runner);

    // NaN should not cause an immediate timeout — it should fall back to the default
    const resultPromise = coordinator.launch({
      runId: 'run-nan-timeout',
      workflowFile: 'workflow.yaml',
      cwd: '/repo',
      timeoutMs: NaN,
    });

    // If NaN were used directly, setTimeout(fn, NaN) fires immediately.
    // With normalization, the run should still be active after launch.
    expect(coordinator.getActiveRun('run-nan-timeout')?.status).toBe('running');

    invocations[0].complete(0);
    const result = await resultPromise;
    expect(result.status).toBe('passed');
  });
});
