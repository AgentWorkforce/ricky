import type { RunStatus } from '../shared/models/workflow-evidence.js';

export type { RunStatus } from '../shared/models/workflow-evidence.js';

export type LifecycleEventKind =
  | 'started'
  | 'stdout'
  | 'stderr'
  | 'status_change'
  | 'completed'
  | 'timeout'
  | 'cancelled'
  | 'error';

export interface RunRetryMetadata {
  /** One-based attempt number for this run. */
  attempt: number;
  /** Caller-declared retry budget when known. */
  maxAttempts?: number;
  /** Run id this execution retries, if any. */
  retryOfRunId?: string;
  /** Most recent failed/timed-out run id, if different from retryOfRunId. */
  previousRunId?: string;
  /** Human-readable reason the retry was scheduled. */
  reason?: string;
  /** Delay applied before this attempt, in milliseconds. */
  backoffMs?: number;
}

export interface ExecutionRoute {
  /** Underlying executable. Defaults to agent-relay. */
  command?: string;
  /** Arguments before the workflow file. Defaults to ['run']. */
  baseArgs?: string[];
}

export interface RunRequest {
  /** Unique id for this run. Generated when omitted. */
  runId?: string;
  /** Path to the workflow file to execute. */
  workflowFile: string;
  /** Working directory for the underlying runtime. */
  cwd: string;
  /** Timeout override in milliseconds. */
  timeoutMs?: number;
  /** Extra CLI/runtime arguments after the workflow path. */
  extraArgs?: string[];
  /** Environment variable overrides for the runner. */
  env?: Record<string, string>;
  /** Optional route override for non-default local runtime adapters. */
  route?: ExecutionRoute;
  /** Retry/attempt context supplied by the orchestrating layer. */
  retry?: Partial<RunRetryMetadata>;
  /** Maximum number of lines kept in stdoutSnippet/stderrSnippet. */
  logSnippetLineLimit?: number;
  /** Caller-owned metadata carried through events and results. */
  metadata?: Record<string, unknown>;
}

export interface LifecycleEvent {
  kind: LifecycleEventKind;
  runId: string;
  timestamp: string;
  status?: RunStatus;
  message?: string;
  data?: Record<string, unknown>;
}

export interface CommandRunnerOptions {
  cwd: string;
  env?: Record<string, string>;
}

export interface CommandInvocation {
  /** Resolves with the process exit code when the runtime exits. */
  exitPromise: Promise<number>;
  /** Subscribe to stdout lines from the runtime. */
  onStdout: (cb: (line: string) => void) => void;
  /** Subscribe to stderr lines from the runtime. */
  onStderr: (cb: (line: string) => void) => void;
  /** Stop the runtime; used for explicit cancellation and timeouts. */
  kill: () => void;
}

export interface CommandRunner {
  run(command: string, args: string[], options: CommandRunnerOptions): CommandInvocation;
}

export interface CommandInvocationSummary {
  command: string;
  args: string[];
  cwd: string;
  env?: Record<string, string>;
}

export interface LogSnippet {
  lines: string[];
  totalLines: number;
  maxLines: number;
  truncated: boolean;
}

export interface CoordinatorResult {
  runId: string;
  workflowFile: string;
  cwd: string;
  status: RunStatus;
  exitCode: number | null;
  startedAt: string;
  completedAt: string;
  /** Alias for consumers that model run lifecycle as start/end. */
  endedAt: string;
  durationMs: number;
  stdout: string[];
  stderr: string[];
  stdoutSnippet: LogSnippet;
  stderrSnippet: LogSnippet;
  events: LifecycleEvent[];
  retry: RunRetryMetadata;
  invocation: CommandInvocationSummary;
  metadata?: Record<string, unknown>;
  error?: string;
}

export interface ActiveRunSnapshot {
  runId: string;
  workflowFile: string;
  cwd: string;
  status: RunStatus;
  startedAt: string;
  retry: RunRetryMetadata;
  invocation: CommandInvocationSummary;
  metadata?: Record<string, unknown>;
}
