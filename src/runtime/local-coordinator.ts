import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';

import { DEFAULT_RUN_TIMEOUT_MS } from '../shared/constants.js';
import type { RunStatus } from '../shared/models/workflow-evidence.js';
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
    const timeoutMs = normalizeTimeout(request.timeoutMs);
    let status: RunStatus = 'pending';
    let settled = false;
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    let resolveResult: (result: CoordinatorResult) => void;

    const resultPromise = new Promise<CoordinatorResult>((resolve) => {
      resolveResult = resolve;
    });

    const notifyLifecycleObservers = (event: LifecycleEvent): void => {
      for (const listener of this.emitter.listeners('lifecycle')) {
        try {
          (listener as (event: LifecycleEvent) => void)(event);
        } catch {
          // Observer failures must not break coordinator settlement or leak active state.
        }
      }
    };

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
      notifyLifecycleObservers(event);
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
        const killError = state.invocation ? killInvocation(state.invocation) : undefined;
        finish({
          status: 'cancelled',
          exitCode: null,
          eventKind: 'cancelled',
          message: 'Run cancelled',
          error: 'cancelled',
          data: killError ? { killError } : undefined,
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

    // A lifecycle observer may have cancelled the run during the started
    // notification above. If the run is already settled, skip spawning.
    if (settled) return resultPromise;

    transition('running', 'Run entered running state');
    state.status = status;

    // Re-check after the running transition — an observer may cancel here too.
    if (settled) return resultPromise;

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
        const killError = killInvocation(invocation);
        finish({
          status: 'timed_out',
          exitCode: null,
          eventKind: 'timeout',
          message: `Run timed out after ${timeoutMs}ms`,
          error: `timed out after ${timeoutMs}ms`,
          data: { timeoutMs, ...(killError ? { killError } : {}) },
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
                : exitCode === null
                  ? 'Run completed without an exit code'
                  : `Run completed with exit code ${exitCode}`,
            error: exitCode === 0 ? undefined : exitErrorMessage(exitCode),
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
  const baseArgs = request.route?.baseArgs ? [...request.route.baseArgs] : [...DEFAULT_BASE_ARGS];
  return {
    command,
    args: [
      ...baseArgs,
      request.workflowFile,
      ...retryResumeArgs(request.retry),
      ...(request.extraArgs ? [...request.extraArgs] : []),
    ],
    cwd: request.cwd,
    env: request.env ? { ...request.env } : undefined,
  };
}

function retryResumeArgs(retry: RunRequest['retry']): string[] {
  const args: string[] = [];
  if (retry?.startFromStep) args.push('--start-from', retry.startFromStep);
  if (retry?.previousRunId) args.push('--previous-run-id', retry.previousRunId);
  return args;
}

function normalizeTimeout(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return DEFAULT_RUN_TIMEOUT_MS;
  return Math.floor(value);
}

function normalizeRetry(retry: RunRequest['retry']): RunRetryMetadata {
  return {
    attempt: normalizeAttempt(retry?.attempt),
    maxAttempts: retry?.maxAttempts,
    retryOfRunId: retry?.retryOfRunId,
    previousRunId: retry?.previousRunId,
    startFromStep: retry?.startFromStep,
    reason: retry?.reason,
    backoffMs: retry?.backoffMs,
  };
}

function normalizeAttempt(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value) || value < 1) return 1;
  return Math.floor(value);
}

function buildSnippet(lines: string[], maxLines: number): LogSnippet {
  const normalizedMax = Number.isFinite(maxLines) ? Math.max(0, Math.floor(maxLines)) : DEFAULT_SNIPPET_LINE_LIMIT;
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
    retry: cloneRetry(state.retry),
    invocation: cloneInvocationSummary(state.invocationSummary),
    metadata: cloneMetadata(state.metadata),
  };
}

function cloneRetry(retry: RunRetryMetadata): RunRetryMetadata {
  return { ...retry };
}

function cloneInvocationSummary(invocation: CommandInvocationSummary): CommandInvocationSummary {
  return {
    command: invocation.command,
    args: [...invocation.args],
    cwd: invocation.cwd,
    env: invocation.env ? { ...invocation.env } : undefined,
  };
}

function cloneMetadata(metadata: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  return metadata ? { ...metadata } : undefined;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function exitErrorMessage(exitCode: number | null): string {
  return exitCode === null ? 'exited without an exit code' : `exited with code ${exitCode}`;
}

function killInvocation(invocation: CommandInvocation): string | undefined {
  try {
    invocation.kill();
    return undefined;
  } catch (err) {
    return errorMessage(err);
  }
}
