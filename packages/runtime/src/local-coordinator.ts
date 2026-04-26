import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';

import { DEFAULT_RUN_TIMEOUT_MS } from '@ricky/shared/constants.js';
import type { RunStatus } from '@ricky/shared/models/workflow-evidence.js';
import type {
  ActiveRunSnapshot,
  CommandInvocation,
  CommandInvocationSummary,
  CommandRunner,
  CoordinatorResult,
  LifecycleEvent,
  LogSnippet,
  RunRequest,
  RunRetryMetadata,
} from './types.js';

const DEFAULT_COMMAND = 'agent-relay';
const DEFAULT_BASE_ARGS = ['run'] as const;
const DEFAULT_SNIPPET_LINE_LIMIT = 40;

interface ActiveRunState {
  runId: string;
  workflowFile: string;
  cwd: string;
  status: RunStatus;
  startedAt: string;
  startedMs: number;
  retry: RunRetryMetadata;
  invocationSummary: CommandInvocationSummary;
  metadata?: Record<string, unknown>;
  invocation?: CommandInvocation;
  cancel: () => void;
}

interface TerminalOutcome {
  status: RunStatus;
  exitCode: number | null;
  eventKind: 'completed' | 'timeout' | 'cancelled' | 'error';
  message: string;
  error?: string;
  data?: Record<string, unknown>;
}

export class LocalCoordinator {
  private readonly emitter = new EventEmitter();
  private readonly activeRuns = new Map<string, ActiveRunState>();

  constructor(private readonly runner: CommandRunner) {}

  async launch(request: RunRequest): Promise<CoordinatorResult> {
    const runId = request.runId ?? randomUUID();

    if (this.activeRuns.has(runId)) {
      throw new Error(`Duplicate runId: "${runId}" is already active`);
    }

    const startedMs = Date.now();
    const startedAt = new Date(startedMs).toISOString();
    const stdout: string[] = [];
    const stderr: string[] = [];
    const events: LifecycleEvent[] = [];
    const retry = normalizeRetry(request.retry);
    const invocationSummary = buildInvocationSummary(request);
    const snippetLimit = request.logSnippetLineLimit ?? DEFAULT_SNIPPET_LINE_LIMIT;
    const timeoutMs = request.timeoutMs ?? DEFAULT_RUN_TIMEOUT_MS;
    let status: RunStatus = 'pending';
    let settled = false;
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    let resolveResult: (result: CoordinatorResult) => void;

    const resultPromise = new Promise<CoordinatorResult>((resolve) => {
      resolveResult = resolve;
    });

    const emit = (
      kind: LifecycleEvent['kind'],
      message?: string,
      data?: Record<string, unknown>,
    ): LifecycleEvent => {
      const event: LifecycleEvent = {
        kind,
        runId,
        timestamp: new Date().toISOString(),
        status,
        message,
        data,
      };
      events.push(event);
      this.emitter.emit('lifecycle', event);
      return event;
    };

    const transition = (nextStatus: RunStatus, message: string): void => {
      if (status === nextStatus) return;
      const previousStatus = status;
      status = nextStatus;
      const activeState = this.activeRuns.get(runId);
      if (activeState) activeState.status = nextStatus;
      emit('status_change', message, { previousStatus, status: nextStatus });
    };

    const finish = (outcome: TerminalOutcome): void => {
      if (settled) return;
      settled = true;
      if (timeoutHandle) clearTimeout(timeoutHandle);

      transition(outcome.status, outcome.message);
      emit(outcome.eventKind, outcome.message, {
        exitCode: outcome.exitCode,
        error: outcome.error,
        ...outcome.data,
      });

      const completedMs = Date.now();
      const completedAt = new Date(completedMs).toISOString();
      this.activeRuns.delete(runId);

      resolveResult({
        runId,
        workflowFile: request.workflowFile,
        cwd: request.cwd,
        status: outcome.status,
        exitCode: outcome.exitCode,
        startedAt,
        completedAt,
        endedAt: completedAt,
        durationMs: Math.max(0, completedMs - startedMs),
        stdout,
        stderr,
        stdoutSnippet: buildSnippet(stdout, snippetLimit),
        stderrSnippet: buildSnippet(stderr, snippetLimit),
        events,
        retry,
        invocation: invocationSummary,
        metadata: request.metadata,
        error: outcome.error,
      });
    };

    const state: ActiveRunState = {
      runId,
      workflowFile: request.workflowFile,
      cwd: request.cwd,
      status,
      startedAt,
      startedMs,
      retry,
      invocationSummary,
      metadata: request.metadata,
      cancel: () => {
        if (settled) return;
        state.invocation?.kill();
        finish({
          status: 'failed',
          exitCode: null,
          eventKind: 'cancelled',
          message: 'Run cancelled',
          error: 'cancelled',
        });
      },
    };
    this.activeRuns.set(runId, state);

    emit('started', 'Run started', {
      workflowFile: request.workflowFile,
      cwd: request.cwd,
      invocation: invocationSummary,
      retry,
      metadata: request.metadata,
    });
    transition('running', 'Run entered running state');
    state.status = status;

    try {
      const invocation = this.runner.run(invocationSummary.command, invocationSummary.args, {
        cwd: invocationSummary.cwd,
        env: invocationSummary.env,
      });
      state.invocation = invocation;

      invocation.onStdout((line) => {
        if (settled) return;
        stdout.push(line);
        emit('stdout', line, { stream: 'stdout' });
      });

      invocation.onStderr((line) => {
        if (settled) return;
        stderr.push(line);
        emit('stderr', line, { stream: 'stderr' });
      });

      timeoutHandle = setTimeout(() => {
        if (settled) return;
        invocation.kill();
        finish({
          status: 'timed_out',
          exitCode: null,
          eventKind: 'timeout',
          message: `Run timed out after ${timeoutMs}ms`,
          error: `timed out after ${timeoutMs}ms`,
          data: { timeoutMs },
        });
      }, timeoutMs);

      void invocation.exitPromise.then(
        (exitCode) => {
          finish({
            status: exitCode === 0 ? 'passed' : 'failed',
            exitCode,
            eventKind: 'completed',
            message:
              exitCode === 0
                ? 'Run completed successfully'
                : `Run completed with exit code ${exitCode}`,
            error: exitCode === 0 ? undefined : `exited with code ${exitCode}`,
          });
        },
        (err: unknown) => {
          const message = errorMessage(err);
          finish({
            status: 'failed',
            exitCode: null,
            eventKind: 'error',
            message,
            error: message,
          });
        },
      );
    } catch (err) {
      const message = errorMessage(err);
      finish({
        status: 'failed',
        exitCode: null,
        eventKind: 'error',
        message,
        error: message,
      });
    }

    return resultPromise;
  }

  on(event: 'lifecycle', cb: (event: LifecycleEvent) => void): void {
    this.emitter.on(event, cb);
  }

  off(event: 'lifecycle', cb: (event: LifecycleEvent) => void): void {
    this.emitter.off(event, cb);
  }

  async *monitor(runId?: string): AsyncIterable<LifecycleEvent> {
    // If a specific runId was requested but is not active, terminate immediately
    // to prevent the caller from hanging on a run that will never emit events.
    if (runId !== undefined && !this.activeRuns.has(runId)) {
      return;
    }

    const queue: LifecycleEvent[] = [];
    const monitoredRunIds = runId ? new Set([runId]) : new Set(this.activeRuns.keys());
    let wake: (() => void) | undefined;
    let complete = monitoredRunIds.size === 0;

    const listener = (event: LifecycleEvent): void => {
      if (!monitoredRunIds.has(event.runId)) return;
      queue.push(event);
      if (isTerminalEvent(event)) {
        monitoredRunIds.delete(event.runId);
        complete = monitoredRunIds.size === 0;
      }
      wake?.();
      wake = undefined;
    };

    this.on('lifecycle', listener);
    try {
      while (!complete || queue.length > 0) {
        if (queue.length === 0) {
          await new Promise<void>((resolve) => {
            wake = resolve;
          });
          continue;
        }
        const event = queue.shift();
        if (event) yield event;
      }
    } finally {
      this.off('lifecycle', listener);
    }
  }

  cancel(runId: string): void {
    this.activeRuns.get(runId)?.cancel();
  }

  getActiveRun(runId: string): ActiveRunSnapshot | undefined {
    const state = this.activeRuns.get(runId);
    if (!state) return undefined;
    return snapshot(state);
  }

  listActiveRuns(): ActiveRunSnapshot[] {
    return [...this.activeRuns.values()].map(snapshot);
  }
}

function buildInvocationSummary(request: RunRequest): CommandInvocationSummary {
  const command = request.route?.command ?? DEFAULT_COMMAND;
  const baseArgs = request.route?.baseArgs ?? [...DEFAULT_BASE_ARGS];
  return {
    command,
    args: [...baseArgs, request.workflowFile, ...(request.extraArgs ?? [])],
    cwd: request.cwd,
    env: request.env,
  };
}

function normalizeRetry(retry: RunRequest['retry']): RunRetryMetadata {
  return {
    attempt: retry?.attempt ?? 1,
    maxAttempts: retry?.maxAttempts,
    retryOfRunId: retry?.retryOfRunId,
    previousRunId: retry?.previousRunId,
    reason: retry?.reason,
    backoffMs: retry?.backoffMs,
  };
}

function buildSnippet(lines: string[], maxLines: number): LogSnippet {
  const normalizedMax = Math.max(0, maxLines);
  return {
    lines: normalizedMax === 0 ? [] : lines.slice(-normalizedMax),
    totalLines: lines.length,
    maxLines: normalizedMax,
    truncated: lines.length > normalizedMax,
  };
}

function isTerminalEvent(event: LifecycleEvent): boolean {
  return (
    event.kind === 'completed' ||
    event.kind === 'timeout' ||
    event.kind === 'cancelled' ||
    event.kind === 'error'
  );
}

function snapshot(state: ActiveRunState): ActiveRunSnapshot {
  return {
    runId: state.runId,
    workflowFile: state.workflowFile,
    cwd: state.cwd,
    status: state.status,
    startedAt: state.startedAt,
    retry: state.retry,
    invocation: state.invocationSummary,
    metadata: state.metadata,
  };
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
