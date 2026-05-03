/**
 * Ricky local/BYOH entrypoint.
 *
 * Ties together request normalization, spec intake, workflow generation,
 * and local runtime coordination. Returns artifacts, logs, warnings, and
 * suggested next actions — without routing through Cloud by default.
 */

import type { ArtifactReader, LocalInvocationRequest, LocalStageMode, RawHandoff } from './request-normalizer.js';
import { assembleRickyTurnContext } from './assistant-turn-context-adapter.js';
import { normalizeRequest } from './request-normalizer.js';
import type { TurnContextAssembly } from '@agent-assistant/turn-context';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { delimiter, dirname, isAbsolute, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';

import { runWithAutoFix } from './auto-fix-loop.js';
import { generate, generateWithWorkforcePersona } from '../product/generation/index.js';
import type { GenerationInput, GenerationResult, RenderedArtifact } from '../product/generation/index.js';
import { intake } from '../product/spec-intake/index.js';
import type { ExecutionPreference, InputSurface, RawSpecPayload, RouteTarget } from '../product/spec-intake/index.js';
import { defaultRepoDetector, type RepoDetector } from '../product/spec-intake/detect-current-repo.js';
import { LocalCoordinator } from '../runtime/local-coordinator.js';
import { DEFAULT_RUN_TIMEOUT_MS } from '../shared/constants.js';
import { localRunArtifactDir, localRunStateRoot } from '../shared/state-paths.js';
import type {
  CommandInvocation,
  CommandInvocationSummary,
  CommandRunner,
  CommandRunnerOptions,
  CoordinatorResult,
  ExecutionRoute,
  LifecycleEvent,
  LogSnippet,
  RunRequest,
  RunRetryMetadata,
  RunStatus,
} from '../runtime/types.js';

const requireFromHere = createRequire(import.meta.url);

// ---------------------------------------------------------------------------
// Local response contract
// ---------------------------------------------------------------------------

export interface LocalResponseArtifact {
  /** Path to the generated or consumed artifact (may be relative or absolute). */
  path: string;
  /** MIME type hint (e.g. 'text/typescript', 'application/json'). */
  type?: string;
  /** Artifact content when available inline. */
  content?: string;
}

export type LocalGenerationStatus = 'ok' | 'error';
export type LocalExecutionStatus = 'success' | 'blocker' | 'error';

export interface LocalAssistantTurnContextDecision {
  assistant_id: string;
  turn_id: string;
  adapter: string;
  package: string;
  context_blocks: string[];
  enrichment_ids: string[];
}

export interface LocalGenerationStageResult {
  stage: 'generate';
  status: LocalGenerationStatus;
  artifact?: {
    path: string;
    workflow_id: string;
    spec_digest: string;
  };
  next?: {
    run_command: string;
    run_mode_hint: string;
  };
  error?: string;
  decisions?: {
    skill_matches?: unknown;
    tool_selection?: unknown;
    refinement?: unknown;
    workforce_persona?: unknown;
    assistant_turn_context?: LocalAssistantTurnContextDecision;
  };
}

export type LocalBlockerCode =
  | 'MISSING_ENV_VAR'
  | 'MISSING_BINARY'
  | 'INVALID_ARTIFACT'
  | 'UNSUPPORTED_RUNTIME'
  | 'CREDENTIALS_REJECTED'
  | 'WORKDIR_DIRTY'
  | 'NETWORK_UNREACHABLE'
  | 'NETWORK_TRANSIENT';

export type LocalBlockerCategory =
  | 'environment'
  | 'credentials'
  | 'dependency'
  | 'workflow_invalid'
  | 'resource'
  | 'unsupported';

export interface LocalClassifiedBlocker {
  code: LocalBlockerCode;
  category: LocalBlockerCategory;
  message: string;
  detected_at: string;
  detected_during: 'precheck' | 'launch' | 'step_setup';
  recovery: {
    actionable: boolean;
    steps: string[];
    docs_url?: string;
  };
  context: {
    missing: string[];
    found: string[];
  };
}

export interface LocalExecutionEvidence {
  outcome_summary: string;
  artifacts_produced?: Array<{ path: string; kind: string; bytes: number }>;
  failed_step?: { id: string; name: string };
  exit_code?: number | null;
  logs: {
    stdout_path?: string;
    stderr_path?: string;
    tail?: string[];
    truncated: boolean;
  };
  side_effects: {
    files_written: string[];
    commands_invoked: string[];
    network_calls?: Array<{ host: string; status_code: number }>;
  };
  assertions: Array<{ name: string; status: 'pass' | 'fail' | 'skipped'; detail: string }>;
  workflow_steps?: Array<{ id: string; name: string; status: 'pass' | 'fail' | 'skipped'; duration_ms: number }>;
}

export interface LocalExecutionStageResult {
  stage: 'execute';
  status: LocalExecutionStatus;
  execution: {
    workflow_id: string;
    artifact_path: string;
    command: string;
    workflow_file: string;
    cwd: string;
    started_at: string;
    finished_at: string;
    duration_ms: number;
    steps_completed: number;
    steps_total: number;
    run_id?: string;
  };
  evidence?: LocalExecutionEvidence;
  blocker?: LocalClassifiedBlocker;
}

export interface LocalResponse {
  /** Whether the local invocation succeeded. */
  ok: boolean;
  /** Generated or consumed artifacts. */
  artifacts: LocalResponseArtifact[];
  /** Structured log entries from the local run. */
  logs: string[];
  /** Non-fatal warnings surfaced during execution. */
  warnings: string[];
  /** Suggested next actions for the user. */
  nextActions: string[];
  /** Stage 1 result: artifact generation or artifact selection. */
  generation?: LocalGenerationStageResult;
  /** Stage 2 result: populated only when run behavior was requested. */
  execution?: LocalExecutionStageResult;
  /** Process-oriented exit code: 0 success, 2 blocker, 1 error. */
  exitCode?: 0 | 1 | 2;
  /** Auto-fix loop metadata when --auto-fix/--repair was requested. */
  auto_fix?: {
    max_attempts: number;
    attempts: Array<Record<string, unknown>>;
    final_status: 'ok' | 'blocker' | 'error';
    run_id?: string;
    resumed?: boolean;
    escalation?: {
      summary: string;
      log_tail: string[];
      options: Array<{
        label: string;
        description: string;
        command?: string;
      }>;
    };
  };
}

// ---------------------------------------------------------------------------
// Execution adapter — injectable seam for generation + runtime coordination
// ---------------------------------------------------------------------------

/**
 * The executor is the seam between the entrypoint and actual work.
 * Inject a fake in tests; wire the Relay SDK workflow runner in production.
 */
export interface LocalExecutor {
  /**
   * Run the local workflow generation and execution pipeline.
   * Receives the normalized request and returns the local response contract.
   */
  execute(request: LocalInvocationRequest): Promise<LocalResponse>;
}

// ---------------------------------------------------------------------------
// Local execution dependencies
// ---------------------------------------------------------------------------

export interface ArtifactWriter {
  writeArtifact(path: string, content: string, cwd: string): Promise<void>;
}

/**
 * Structural interface for the coordinator dependency.
 * Captures only the `launch` method that the local executor actually uses,
 * so external adapters can satisfy the contract without extending the
 * concrete `LocalCoordinator` class.
 */
export interface CoordinatorLauncher {
  launch(request: RunRequest): Promise<CoordinatorResult>;
}

export interface LocalExecutorOptions {
  cwd?: string;
  timeoutMs?: number;
  commandRunner?: CommandRunner;
  coordinator?: CoordinatorLauncher;
  artifactWriter?: ArtifactWriter;
  /** Override the default execution route for the local runtime. */
  route?: ExecutionRoute;
  /** Override the SDK-backed script workflow runner used by the default local route. */
  scriptWorkflowRunner?: ScriptWorkflowRunner;
  /** When true, stop after writing/generated artifact and return it without launching local runtime. */
  returnGeneratedArtifactOnly?: boolean;
  /** When true, persist generator metadata sidecars beside workflow runtime artifacts. Defaults to false. */
  persistGenerationMetadataArtifacts?: boolean;
  /** Optional Workforce persona writer integration for generated workflow artifacts. */
  workforcePersonaWriter?: false | Omit<
    NonNullable<GenerationInput['workforcePersonaWriter']>,
    'repoRoot' | 'targetMode' | 'outputPath'
  >;
  /** Concise phase updates for foreground CLI progress indicators. */
  onProgress?: (message: string) => void;
  /** Foreground workflow runtime output stream, separate from Ricky progress. */
  onRuntimeOutput?: (stream: 'stdout' | 'stderr', line: string) => void;
}

export interface ScriptWorkflowRunnerOptions {
  cwd: string;
  env?: Record<string, string>;
  timeoutMs?: number;
  startFrom?: string;
  previousRunId?: string;
  resume?: string;
  onStdout?: (line: string) => void;
  onStderr?: (line: string) => void;
}

export type ScriptWorkflowRunner = (workflowFile: string, options: ScriptWorkflowRunnerOptions) => Promise<unknown>;

/**
 * Default execution route for local runtime coordination. This names the
 * programmatic SDK script runner rather than the agent-relay CLI binary.
 */
export const DEFAULT_LOCAL_ROUTE: ExecutionRoute = {
  command: '@agent-relay/sdk/workflows',
  baseArgs: ['runScriptWorkflow'],
};

const defaultArtifactWriter: ArtifactWriter = {
  async writeArtifact(path: string, content: string, cwd: string): Promise<void> {
    const { mkdir, writeFile } = await import('node:fs/promises');
    const resolved = isAbsolute(path) ? path : resolve(cwd, path);
    await mkdir(dirname(resolved), { recursive: true });
    await writeFile(resolved, content, 'utf8');
  },
};

export function createProcessCommandRunner(): CommandRunner {
  return {
    run(command: string, args: string[], options: CommandRunnerOptions): CommandInvocation {
      const stdoutHandlers: Array<(line: string) => void> = [];
      const stderrHandlers: Array<(line: string) => void> = [];
      const child = spawn(command, args, {
        cwd: options.cwd,
        env: { ...process.env, ...(options.env ?? {}) },
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      if (child.stdout) {
        createInterface({ input: child.stdout }).on('line', (line) => {
          stdoutHandlers.forEach((handler) => handler(line));
        });
      }

      if (child.stderr) {
        createInterface({ input: child.stderr }).on('line', (line) => {
          stderrHandlers.forEach((handler) => handler(line));
        });
      }

      return {
        exitPromise: new Promise<number>((resolve, reject) => {
          child.once('error', reject);
          child.once('exit', (code, signal) => {
            if (code !== null) {
              resolve(code);
              return;
            }
            reject(new Error(`process exited from signal ${signal ?? 'unknown'}`));
          });
        }),
        onStdout(cb: (line: string) => void): void {
          stdoutHandlers.push(cb);
        },
        onStderr(cb: (line: string) => void): void {
          stderrHandlers.push(cb);
        },
        kill(): void {
          child.kill();
        },
      };
    },
  };
}

class SdkScriptWorkflowCoordinator implements CoordinatorLauncher {
  constructor(
    private readonly runner: ScriptWorkflowRunner,
    private readonly onRuntimeOutput?: (stream: 'stdout' | 'stderr', line: string) => void,
  ) {}

  async launch(request: RunRequest): Promise<CoordinatorResult> {
    const runId = request.runId ?? cryptoRunId();
    const startedMs = Date.now();
    const startedAt = new Date(startedMs).toISOString();
    const stdout: string[] = [];
    const stderr: string[] = [];
    const events: LifecycleEvent[] = [];
    const retry = normalizeCoordinatorRetry(request.retry);
    const invocation = buildSdkInvocationSummary(request);
    const snippetLimit = request.logSnippetLineLimit ?? 40;
    let status: RunStatus = 'running';

    const emit = (kind: LifecycleEvent['kind'], message?: string, data?: Record<string, unknown>): void => {
      events.push({
        kind,
        runId,
        timestamp: new Date().toISOString(),
        status,
        message,
        data,
      });
    };

    emit('started', 'SDK script workflow started', { workflowFile: request.workflowFile, cwd: request.cwd });

    try {
      const runnerResult = await withTimeout(
        this.runner(request.workflowFile, {
          cwd: request.cwd,
          env: request.env,
          timeoutMs: request.timeoutMs,
          startFrom: retry.startFromStep,
          previousRunId: retry.previousRunId,
          onStdout: (line) => {
            stdout.push(line);
            this.onRuntimeOutput?.('stdout', line);
            emit('stdout', line, { stream: 'stdout' });
          },
          onStderr: (line) => {
            stderr.push(line);
            this.onRuntimeOutput?.('stderr', line);
            emit('stderr', line, { stream: 'stderr' });
          },
        }),
        request.timeoutMs ?? DEFAULT_RUN_TIMEOUT_MS,
      );
      const reportedFailure =
        failureFromScriptWorkflowResult(runnerResult) ?? failureFromScriptWorkflowOutput(stdout, stderr);
      if (reportedFailure) {
        throw new Error(reportedFailure);
      }
      status = 'passed';
      emit('completed', 'SDK script workflow completed', { exitCode: 0 });
      return coordinatorResultFromSdkRun({
        request,
        runId,
        status,
        exitCode: 0,
        startedAt,
        startedMs,
        stdout,
        stderr,
        events,
        retry,
        invocation,
        snippetLimit,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      status = message.startsWith('timed out after ') ? 'timed_out' : 'failed';
      stderr.push(message);
      emit(status === 'timed_out' ? 'timeout' : 'error', message, { error: message });
      return coordinatorResultFromSdkRun({
        request,
        runId,
        status,
        exitCode: null,
        startedAt,
        startedMs,
        stdout,
        stderr,
        events,
        retry,
        invocation,
        snippetLimit,
        error: message,
      });
    }
  }
}

function cryptoRunId(): string {
  return randomUUID();
}

function normalizeCoordinatorRetry(retry: Partial<RunRetryMetadata> | undefined): RunRetryMetadata {
  return {
    attempt: retry?.attempt ?? 1,
    ...(retry?.maxAttempts !== undefined ? { maxAttempts: retry.maxAttempts } : {}),
    ...(retry?.retryOfRunId ? { retryOfRunId: retry.retryOfRunId } : {}),
    ...(retry?.previousRunId ? { previousRunId: retry.previousRunId } : {}),
    ...(retry?.startFromStep ? { startFromStep: retry.startFromStep } : {}),
    ...(retry?.reason ? { reason: retry.reason } : {}),
    ...(retry?.backoffMs !== undefined ? { backoffMs: retry.backoffMs } : {}),
  };
}

function failureFromScriptWorkflowResult(result: unknown): string | undefined {
  if (!result || typeof result !== 'object') return undefined;

  const record = result as Record<string, unknown>;
  if (record.ok === false) return workflowResultFailureMessage(record, 'ok=false');
  if (record.success === false) return workflowResultFailureMessage(record, 'success=false');

  const status = stringValue(record.status ?? record.state ?? record.outcome)?.toLowerCase();
  if (status && ['failed', 'failure', 'blocked', 'blocker', 'error', 'cancelled', 'canceled', 'timed_out', 'timeout'].includes(status)) {
    return workflowResultFailureMessage(record, status);
  }

  const exitCode = numberValue(record.exitCode ?? record.exit_code);
  if (exitCode !== undefined && exitCode !== 0) {
    return workflowResultFailureMessage(record, `exit code ${exitCode}`);
  }

  return undefined;
}

function failureFromScriptWorkflowOutput(stdout: string[], stderr: string[]): string | undefined {
  const failureLine = [...stdout, ...stderr].find((line) => {
    const clean = stripAnsi(line).trim();
    return (
      /^\[workflow\]\s+FAILED:/i.test(clean) ||
      /^FAILED:/i.test(clean) ||
      /\bFAILED:\s+Command failed/i.test(clean)
    );
  });
  if (!failureLine) return undefined;
  return `Workflow runtime reported failure despite a zero process exit: ${stripAnsi(failureLine).trim()}`;
}

function workflowResultFailureMessage(record: Record<string, unknown>, reason: string): string {
  const detail = stringValue(record.error ?? record.message ?? record.summary ?? record.outcome_summary);
  return `Workflow runtime reported ${reason}${detail ? `: ${detail}` : ''}`;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function stripAnsi(value: string): string {
  return value.replace(/\u001B\[[0-9;]*m/g, '');
}

function buildSdkInvocationSummary(request: RunRequest): CommandInvocationSummary {
  const route = request.route ?? DEFAULT_LOCAL_ROUTE;
  const retry = normalizeCoordinatorRetry(request.retry);
  const retryArgs = [
    ...(retry.startFromStep ? ['--start-from', retry.startFromStep] : []),
    ...(retry.previousRunId ? ['--previous-run-id', retry.previousRunId] : []),
  ];
  return {
    command: route.command ?? DEFAULT_LOCAL_ROUTE.command!,
    args: [
      ...(route.baseArgs ?? DEFAULT_LOCAL_ROUTE.baseArgs ?? []),
      request.workflowFile,
      ...retryArgs,
      ...(request.extraArgs ?? []),
    ],
    cwd: request.cwd,
    ...(request.env ? { env: request.env } : {}),
  };
}

function coordinatorResultFromSdkRun(params: {
  request: RunRequest;
  runId: string;
  status: RunStatus;
  exitCode: number | null;
  startedAt: string;
  startedMs: number;
  stdout: string[];
  stderr: string[];
  events: LifecycleEvent[];
  retry: RunRetryMetadata;
  invocation: CommandInvocationSummary;
  snippetLimit: number;
  error?: string;
}): CoordinatorResult {
  const completedMs = Date.now();
  const completedAt = new Date(completedMs).toISOString();
  return {
    runId: params.runId,
    workflowFile: params.request.workflowFile,
    cwd: params.request.cwd,
    status: params.status,
    exitCode: params.exitCode,
    startedAt: params.startedAt,
    completedAt,
    endedAt: completedAt,
    durationMs: Math.max(0, completedMs - params.startedMs),
    stdout: params.stdout,
    stderr: params.stderr,
    stdoutSnippet: buildLocalSnippet(params.stdout, params.snippetLimit),
    stderrSnippet: buildLocalSnippet(params.stderr, params.snippetLimit),
    events: params.events,
    retry: params.retry,
    invocation: params.invocation,
    metadata: params.request.metadata,
    ...(params.error ? { error: params.error } : {}),
  };
}

function buildLocalSnippet(lines: string[], maxLines: number): LogSnippet {
  return {
    lines: lines.slice(Math.max(0, lines.length - maxLines)),
    totalLines: lines.length,
    maxLines,
    truncated: lines.length > maxLines,
  };
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<T>((_, reject) => {
    timeout = setTimeout(() => reject(new Error(`timed out after ${timeoutMs}ms`)), timeoutMs);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeout) clearTimeout(timeout);
  });
}

export function createSdkScriptWorkflowRunner(): ScriptWorkflowRunner {
  return async (workflowFile, options) => {
    const absoluteWorkflowFile = isAbsolute(workflowFile) ? workflowFile : resolve(options.cwd, workflowFile);
    const runtime = await resolveWorkflowSdkRuntime(options.cwd);
    if (!runtime) {
      throw new Error('Runtime dependency is unavailable: @agent-relay/sdk/workflows runtime.');
    }
    await runScriptWorkflowCompat(absoluteWorkflowFile, options);
  };
}

interface WorkflowSdkRuntime {
  entryPath: string;
  source: 'target-repo' | 'ricky-package';
}

async function withCapturedProcessOutput<T>(
  options: Pick<ScriptWorkflowRunnerOptions, 'onStdout' | 'onStderr'>,
  fn: () => Promise<T>,
): Promise<T> {
  const originalStdoutWrite = process.stdout.write;
  const originalStderrWrite = process.stderr.write;
  let stdoutBuffer = '';
  let stderrBuffer = '';

  const capture = (chunk: unknown, stream: 'stdout' | 'stderr'): void => {
    const text = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
    const emit = stream === 'stdout' ? options.onStdout : options.onStderr;
    if (!emit) return;

    const combined = (stream === 'stdout' ? stdoutBuffer : stderrBuffer) + text;
    const lines = combined.split(/\r?\n/);
    const remainder = lines.pop() ?? '';
    if (stream === 'stdout') {
      stdoutBuffer = remainder;
    } else {
      stderrBuffer = remainder;
    }
    for (const line of lines) emit(line);
  };

  process.stdout.write = function writeStdout(
    this: NodeJS.WriteStream,
    chunk: Uint8Array | string,
    encodingOrCallback?: BufferEncoding | ((error?: Error | null) => void),
    callback?: (error?: Error | null) => void,
  ): boolean {
    capture(chunk, 'stdout');
    return originalStdoutWrite.call(this, chunk, encodingOrCallback as BufferEncoding, callback);
  } as typeof process.stdout.write;

  process.stderr.write = function writeStderr(
    this: NodeJS.WriteStream,
    chunk: Uint8Array | string,
    encodingOrCallback?: BufferEncoding | ((error?: Error | null) => void),
    callback?: (error?: Error | null) => void,
  ): boolean {
    capture(chunk, 'stderr');
    return originalStderrWrite.call(this, chunk, encodingOrCallback as BufferEncoding, callback);
  } as typeof process.stderr.write;

  try {
    return await fn();
  } finally {
    process.stdout.write = originalStdoutWrite;
    process.stderr.write = originalStderrWrite;
    if (stdoutBuffer) options.onStdout?.(stdoutBuffer);
    if (stderrBuffer) options.onStderr?.(stderrBuffer);
  }
}

async function resolveWorkflowSdkRuntime(cwd: string): Promise<WorkflowSdkRuntime | null> {
  const { access } = await import('node:fs/promises');
  const targetRequire = createRequire(resolve(cwd, 'package.json'));
  try {
    const entryPath = targetRequire.resolve('@agent-relay/sdk/workflows');
    await access(entryPath);
    return { entryPath, source: 'target-repo' };
  } catch {
    // Fall through to Ricky's own installed SDK dependency.
  }

  try {
    const entryPath = requireFromHere.resolve('@agent-relay/sdk/workflows');
    await access(entryPath);
    return { entryPath, source: 'ricky-package' };
  } catch {
    return null;
  }
}

async function withProcessContext<T>(
  cwd: string,
  env: Record<string, string> | undefined,
  fn: () => Promise<T>,
): Promise<T> {
  const previousCwd = process.cwd();
  const previousEnv = new Map<string, string | undefined>();
  try {
    process.chdir(cwd);
    for (const [key, value] of Object.entries(env ?? {})) {
      previousEnv.set(key, process.env[key]);
      process.env[key] = value;
    }
    return await fn();
  } finally {
    for (const [key, value] of previousEnv) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    process.chdir(previousCwd);
  }
}

async function runScriptWorkflowCompat(workflowFile: string, options: ScriptWorkflowRunnerOptions): Promise<void> {
  const { access } = await import('node:fs/promises');
  try {
    await access(workflowFile);
  } catch {
    throw new Error(`File not found: ${workflowFile}`);
  }

  const ext = workflowFile.slice(workflowFile.lastIndexOf('.')).toLowerCase();
  if (ext === '.ts' || ext === '.tsx' || ext === '.mts' || ext === '.cts') {
    await runFirstAvailableScriptRunner([
      { label: 'node --experimental-strip-types', command: process.execPath, args: ['--experimental-strip-types', '--no-warnings=ExperimentalWarning', workflowFile] },
      { label: 'tsx', command: 'tsx', args: [workflowFile] },
      { label: 'npx tsx', command: 'npx', args: ['tsx', workflowFile] },
    ], options);
    return;
  }
  if (ext === '.js' || ext === '.mjs' || ext === '.cjs') {
    await runFirstAvailableScriptRunner([
      { label: 'node', command: process.execPath, args: [workflowFile] },
    ], options);
    return;
  }
  if (ext === '.py') {
    await runFirstAvailableScriptRunner([
      { label: 'python3', command: 'python3', args: [workflowFile] },
      { label: 'python', command: 'python', args: [workflowFile] },
    ], options);
    return;
  }
  throw new Error(`Unsupported file type: ${ext}. Use .ts, .tsx, .js, or .py`);
}

async function runFirstAvailableScriptRunner(
  runners: Array<{ label: string; command: string; args: string[] }>,
  options: ScriptWorkflowRunnerOptions,
): Promise<void> {
  let lastError: Error | undefined;
  for (const runner of runners) {
    try {
      await runScriptProcess(runner.command, runner.args, runner.label, options);
      return;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      if ((err as Error & { code?: string }).code === 'ENOENT') {
        lastError = err;
        continue;
      }
      if (runner.label === 'node --experimental-strip-types' && /exited with code 9\b/.test(err.message)) {
        lastError = err;
        continue;
      }
      throw err;
    }
  }
  throw lastError ?? new Error('No compatible workflow script runner is available.');
}

async function runScriptProcess(
  command: string,
  args: string[],
  label: string,
  options: ScriptWorkflowRunnerOptions,
): Promise<void> {
  const sdkNodeOptions = await workflowSdkLoaderNodeOption(options.cwd);
  const env = {
    ...process.env,
    ...(options.env ?? {}),
    ...(sdkNodeOptions ? { NODE_OPTIONS: [process.env.NODE_OPTIONS, options.env?.NODE_OPTIONS, sdkNodeOptions].filter(Boolean).join(' ') } : {}),
    ...(options.startFrom ? { START_FROM: options.startFrom } : {}),
    ...(options.previousRunId ? { PREVIOUS_RUN_ID: options.previousRunId } : {}),
    ...(options.resume ? { RESUME_RUN_ID: options.resume } : {}),
  };

  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.once('error', reject);
    if (child.stdout) {
      createInterface({ input: child.stdout }).on('line', (line) => options.onStdout?.(line));
    }
    if (child.stderr) {
      createInterface({ input: child.stderr }).on('line', (line) => options.onStderr?.(line));
    }
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolvePromise();
        return;
      }
      if (code === null) {
        reject(new Error(`${label} exited from signal ${signal ?? 'unknown'}`));
        return;
      }
      reject(new Error(`${label} exited with code ${code}`));
    });
  });
}

async function workflowSdkLoaderNodeOption(cwd: string): Promise<string | undefined> {
  const runtime = await resolveWorkflowSdkRuntime(cwd);
  if (!runtime) return undefined;

  const { mkdir, writeFile } = await import('node:fs/promises');
  const loaderPath = join(localRunStateRoot(cwd), 'sdk-runtime-loader.mjs');
  const runtimeUrl = pathToFileURL(runtime.entryPath).href;
  const loaderSource = [
    `const sdkWorkflowsUrl = ${JSON.stringify(runtimeUrl)};`,
    'export async function resolve(specifier, context, nextResolve) {',
    "  if (specifier === '@agent-relay/sdk/workflows') {",
    '    return { url: sdkWorkflowsUrl, shortCircuit: true };',
    '  }',
    '  return nextResolve(specifier, context);',
    '}',
    '',
  ].join('\n');
  await mkdir(dirname(loaderPath), { recursive: true });
  await writeFile(loaderPath, loaderSource, 'utf8');
  return `--experimental-loader=${pathToFileURL(loaderPath).href}`;
}

export function createLocalExecutor(options: LocalExecutorOptions = {}): LocalExecutor {
  return {
    async execute(request: LocalInvocationRequest): Promise<LocalResponse> {
      const artifacts: LocalResponseArtifact[] = [];
      const logs: string[] = [];
      const warnings: string[] = [];
      const nextActions: string[] = [];
      const cwd = request.invocationRoot ?? options.cwd ?? process.cwd();
      const onProgress = options.onProgress;
      const artifactWriter = options.artifactWriter ?? defaultArtifactWriter;
      const coordinator =
        options.coordinator ??
        (options.commandRunner || options.route
          ? new LocalCoordinator(options.commandRunner ?? createProcessCommandRunner())
          : new SdkScriptWorkflowCoordinator(options.scriptWorkflowRunner ?? createSdkScriptWorkflowRunner(), options.onRuntimeOutput));
      const stageMode = resolveStageMode(request.stageMode, options.returnGeneratedArtifactOnly);
      const includeStageContract = true;
      const specDigest = digestSpec(request.spec);
      let generationStage: LocalGenerationStageResult | undefined;

      const assistantTurnContext = await observeRickyTurnContext(request, logs);

      logs.push(`[local] received spec from ${request.source}`);
      logs.push(`[local] mode: ${request.mode}`);
      logs.push(`[local] stage mode: ${stageMode}`);

      if (request.specPath) {
        logs.push(`[local] spec path: ${request.specPath}`);
      }

      if (request.mode === 'cloud') {
        warnings.push(
          'Cloud mode was requested but this is the local/BYOH entrypoint. ' +
            'Use the Cloud API surface for hosted execution.',
        );
        nextActions.push('Switch to Cloud API or re-invoke with mode=local.');
        return { ok: false, artifacts, logs, warnings, nextActions };
      }

      const intakeResult = intake(toRawSpecPayload(request));
      logs.push(`[local] spec intake route: ${intakeResult.routing?.target ?? 'none'}`);

      warnings.push(...intakeResult.parseWarnings);
      warnings.push(...intakeResult.validationIssues.map((issue) => `${issue.field}: ${issue.message}`));

      if (!intakeResult.routing || intakeResult.routing.target === 'clarify' || !intakeResult.success) {
        if (intakeResult.routing?.suggestedFollowUp) nextActions.push(intakeResult.routing.suggestedFollowUp);
        nextActions.push('Clarify the local workflow request and retry.');
        generationStage = {
          stage: 'generate',
          status: 'error',
          error: warnings[0] ?? 'Spec intake could not produce an executable workflow artifact.',
          ...decisionsForAssistantTurnContext(assistantTurnContext),
        };
        return { ok: false, artifacts, logs, warnings, nextActions, ...stageResponse(includeStageContract, generationStage, undefined, 1) };
      }

      const workflowFile = workflowFileForRoute(
        request,
        intakeResult.routing.target,
        intakeResult.routing.normalizedSpec.desiredAction.workflowFileHint,
      );
      let artifact: RenderedArtifact | null = null;
      let generationResult: GenerationResult | null = null;

      if (intakeResult.routing.target === 'generate' || !workflowFile) {
        const executionPreference: ExecutionPreference = request.mode === 'both' ? 'auto' : 'local';
        const normalizedSpec = {
          ...intakeResult.routing.normalizedSpec,
          executionPreference,
        };
        const workforcePersonaWriter = resolveWorkforcePersonaWriterOptions(request, options, cwd, executionPreference);
        const generationInput: GenerationInput = {
          spec: normalizedSpec,
          dryRunEnabled: true,
          artifactPath: artifactPathOverrideFor(request),
          refine: request.refine,
          ...(workforcePersonaWriter ? { workforcePersonaWriter } : {}),
        };
        onProgress?.('ricky is writing the workflow...');
        generationResult = generationInput.workforcePersonaWriter
          ? await generateWithWorkforcePersona(generationInput)
          : generate(generationInput);
        artifact = generationResult.artifact;

        logs.push(`[local] workflow generation: ${generationResult.success ? 'passed' : 'failed'}`);
        logs.push(`[local] selected pattern: ${generationResult.patternDecision.pattern}`);
        if (generationResult.workforcePersona) {
          logs.push(`[local] workforce persona writer: ${generationResult.workforcePersona.personaId}@${generationResult.workforcePersona.tier}`);
        }
        warnings.push(...generationResult.validation.warnings);

        if (artifact) {
          artifacts.push({
            path: artifact.artifactPath,
            type: 'text/typescript',
            content: artifact.content,
          });
        }

        if (!generationResult.success || !artifact) {
          warnings.push(...generationResult.validation.errors);
          nextActions.push('Fix the generated workflow validation errors before local execution.');
          generationStage = createGenerationStage(
            'error',
            artifact,
            specDigest,
            generationResult.validation.errors[0],
            generationResult,
            assistantTurnContext,
          );
          return { ok: false, artifacts, logs, warnings, nextActions, ...stageResponse(includeStageContract, generationStage, undefined, 1) };
        }

        await artifactWriter.writeArtifact(artifact.artifactPath, artifact.content, cwd);
        if (options.persistGenerationMetadataArtifacts === true) {
          await writeGenerationMetadataArtifacts(generationResult, artifactWriter, cwd);
        }
        logs.push(`[local] wrote workflow artifact: ${artifact.artifactPath}`);
        generationStage = createGenerationStage('ok', artifact, specDigest, undefined, generationResult, assistantTurnContext);
      }

      const runTarget = artifact?.artifactPath ?? workflowFile;
      if (!runTarget) {
        warnings.push('No executable local workflow artifact was available.');
        nextActions.push('Provide a workflows/**/*.ts artifact or a generation spec that can produce one.');
        generationStage = {
          stage: 'generate',
          status: 'error',
          error: 'No executable local workflow artifact was available.',
          ...decisionsForAssistantTurnContext(assistantTurnContext),
        };
        return { ok: false, artifacts, logs, warnings, nextActions, ...stageResponse(includeStageContract, generationStage, undefined, 1) };
      }

      if (!generationStage) {
        generationStage = createArtifactReferenceGenerationStage(runTarget, request.requestId, specDigest, assistantTurnContext);
      }

      if (stageMode === 'generate') {
        if (!artifact) {
          artifacts.push({
            path: runTarget,
            type: 'text/typescript',
          });
        }
        logs.push('[local] runtime launch skipped: returning generated artifact only');
        nextActions.push(`Run the generated workflow locally: ${localRunCommand(runTarget)}`);
        nextActions.push('Inspect the generated workflow artifact and choose whether to run it locally.');
        return {
          ok: true,
          artifacts: dedupeArtifacts(artifacts),
          logs,
          warnings,
          nextActions,
          ...stageResponse(includeStageContract, generationStage, undefined, 0),
        };
      }

      const route = await resolveLocalRuntimeRoute(cwd, options.route ?? DEFAULT_LOCAL_ROUTE, options);
      const workflowId = artifact?.workflowId ?? generationStage.artifact?.workflow_id ?? workflowIdForPath(runTarget);
      const precheckBlocker = await precheckRuntimeLaunch(runTarget, cwd, route, options);
      if (precheckBlocker) {
        const execution = createBlockerExecutionStage({
          workflowId,
          artifactPath: runTarget,
          cwd,
          route,
          blocker: precheckBlocker,
        });
        warnings.push(precheckBlocker.message);
        nextActions.push(...precheckBlocker.recovery.steps);
        return {
          ok: false,
          artifacts: dedupeArtifacts(artifacts),
          logs,
          warnings,
          nextActions,
          ...stageResponse(includeStageContract, generationStage, execution, 2),
        };
      }

      const runtimeRunIdFile = runtimeRunIdFilePath(cwd, workflowId);
      await ensureParentDir(runtimeRunIdFile);
      if (request.metadata.autoFixProgressOwner !== true) {
        onProgress?.(request.retry?.startFromStep
          ? `Running workflow from ${request.retry.startFromStep}...`
          : 'Running workflow...');
      }
      const runResult = await coordinator.launch({
        workflowFile: runTarget,
        cwd,
        timeoutMs: options.timeoutMs,
        route,
        env: { AGENT_RELAY_RUN_ID_FILE: runtimeRunIdFile },
        ...stableRunIdFor(request),
        retry: request.retry,
        metadata: {
          requestId: intakeResult.requestId,
          source: request.source,
          route: intakeResult.routing.target,
          generatedWorkflowId: artifact?.workflowId,
          ...(assistantTurnContext ? { assistantTurnContext } : {}),
        },
      });

      logs.push(...mapCoordinatorLogs(runResult));
      artifacts.push({
        path: runTarget,
        type: 'text/typescript',
        ...(artifact ? { content: artifact.content } : {}),
      });
      const runtimeRunId = await resolveRuntimeRunId(runtimeRunIdFile, runResult.stderr);
      const execution = await createExecutionStageFromCoordinatorResult(
        runResult,
        workflowId,
        artifact?.content,
        artifact?.artifactPath,
        runtimeRunId,
      );

      if (runResult.status !== 'passed') {
        warnings.push(execution.blocker?.message ?? runResult.error ?? `Local workflow finished with status ${runResult.status}.`);
        nextActions.push(...(execution.blocker?.recovery.steps ?? ['Inspect the local runtime logs and resolve the classified blocker.']));
        return {
          ok: false,
          artifacts: dedupeArtifacts(artifacts),
          logs,
          warnings,
          nextActions,
          ...stageResponse(includeStageContract, generationStage, execution, execution.blocker ? 2 : 1),
        };
      }

      nextActions.push('Inspect generated artifacts and local run evidence.');
      if (request.mode === 'both') {
        nextActions.push('After local validation, optionally promote to Cloud execution.');
      }

      return {
        ok: true,
        artifacts: dedupeArtifacts(artifacts),
        logs,
        warnings,
        nextActions,
        ...stageResponse(includeStageContract, generationStage, execution, 0),
      };
    },
  };
}

async function observeRickyTurnContext(
  request: LocalInvocationRequest,
  logs: string[],
): Promise<LocalAssistantTurnContextDecision | undefined> {
  try {
    return summarizeRickyTurnContext(await assembleRickyTurnContext(request));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logs.push(`[local] turn context adapter skipped: ${message}`);
    return undefined;
  }
}

/**
 * Lazily-initialized default executor. Deferred to first use so that
 * importing this module does not spawn a `LocalCoordinator` (and its
 * underlying `createProcessCommandRunner()`) as an import side-effect.
 */
let _defaultExecutor: LocalExecutor | null = null;

export function getDefaultExecutor(): LocalExecutor {
  if (!_defaultExecutor) {
    _defaultExecutor = createLocalExecutor();
  }
  return _defaultExecutor;
}

/**
 * Reset the lazily-initialized default executor. Intended for test isolation
 * where a previous test may have constructed the singleton with stale options.
 * Production code should not need to call this.
 */
export function resetDefaultExecutor(): void {
  _defaultExecutor = null;
}

// ---------------------------------------------------------------------------
// Entrypoint options
// ---------------------------------------------------------------------------

export interface LocalEntrypointOptions {
  executor?: LocalExecutor;
  artifactReader?: ArtifactReader;
  localExecutor?: LocalExecutorOptions;
  onProgress?: (message: string) => void;
  onRuntimeOutput?: (stream: 'stdout' | 'stderr', line: string) => void;
}

export type LocalEntrypointInput = RawHandoff | LocalInvocationRequest;

// ---------------------------------------------------------------------------
// Entrypoint
// ---------------------------------------------------------------------------

/**
 * Main local/BYOH entrypoint.
 *
 * 1. Normalizes the raw handoff into a LocalInvocationRequest.
 * 2. Validates that the request is suitable for local execution.
 * 3. Delegates to the executor for generation + runtime coordination.
 * 4. Returns the unified local response contract.
 */
export async function runLocal(
  handoff: LocalEntrypointInput,
  options: LocalEntrypointOptions = {},
): Promise<LocalResponse> {
  const { executor, artifactReader, localExecutor, onProgress, onRuntimeOutput } = options;

  // Normalize
  let request: LocalInvocationRequest;
  try {
    request = isLocalInvocationRequest(handoff)
      ? handoff
      : await normalizeRequest(handoff, artifactReader);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const isMissingFile = /\bENOENT\b/.test(message) || /no such file/i.test(message);
    return {
      ok: false,
      artifacts: [],
      logs: [`[local] normalization failed: ${message}`],
      warnings: [
        `Failed to normalize handoff from source '${handoff.source}': ${message}`,
      ],
      nextActions: [
        isMissingFile
          ? 'Confirm the artifact path exists and rerun the command.'
          : 'Check the spec content or artifact path and retry.',
      ],
    };
  }

  const resolvedExecutor =
    executor ??
    (localExecutor || onProgress || onRuntimeOutput
      ? createLocalExecutor({
          ...(localExecutor ?? {}),
          cwd: localExecutor?.cwd ?? request.invocationRoot,
          ...(onProgress ? { onProgress } : {}),
          ...(onRuntimeOutput ? { onRuntimeOutput } : {}),
        })
      : getDefaultExecutor());

  // Validate: local/BYOH entrypoint should not silently route to Cloud.
  if (request.mode === 'cloud') {
    return {
      ok: false,
      artifacts: [],
      logs: [`[local] rejected cloud-only request from ${request.source}`],
      warnings: [
        'This is the local/BYOH entrypoint. Cloud-only requests should use the Cloud API surface.',
      ],
      nextActions: ['Use the Cloud API surface or re-invoke with mode=local.'],
    };
  }

  if (request.autoFix && request.autoFix.maxAttempts > 0) {
    return runWithAutoFix(request, {
      maxAttempts: request.autoFix.maxAttempts,
      ...(onProgress ? { onProgress } : {}),
      runSingleAttempt: (attemptRequest) =>
        resolvedExecutor.execute({
          ...attemptRequest,
          autoFix: undefined,
          metadata: {
            ...attemptRequest.metadata,
            autoFixProgressOwner: true,
          },
        }),
    });
  }

  // Execute
  return resolvedExecutor.execute(request);
}

function isLocalInvocationRequest(input: LocalEntrypointInput): input is LocalInvocationRequest {
  return (
    typeof input === 'object' &&
    input !== null &&
    '_normalized' in input &&
    input._normalized === true
  );
}

function toRawSpecPayload(
  request: LocalInvocationRequest,
  repoDetector: RepoDetector = defaultRepoDetector,
): RawSpecPayload {
  const receivedAt = new Date().toISOString();
  const cwd = request.invocationRoot ?? process.cwd();
  const detectedRepo = repoDetector.detect(cwd);
  const repoDefault = detectedRepo ? { targetRepo: detectedRepo } : {};
  const base = {
    surface: sourceToSurface(request.source),
    receivedAt,
    requestId: request.requestId,
    metadata: {
      ...request.metadata,
      mode: request.mode,
      specPath: request.specPath,
      refine: request.refine,
      sourceMetadata: request.sourceMetadata,
    },
  };

  if (request.source === 'mcp') {
    return {
      ...base,
      kind: 'mcp',
      toolName: typeof request.metadata.toolName === 'string' ? request.metadata.toolName : 'ricky.generate',
      arguments: { ...repoDefault, ...(request.structuredSpec ?? { spec: request.spec }), ...(request.refine ? { refine: request.refine } : {}) },
    };
  }

  if (request.specPath && isExecutableWorkflowPath(request.specPath)) {
    return {
      ...base,
      kind: 'structured_json',
      data: {
        intent: 'execute',
        workflowFile: request.specPath,
        description: request.spec.trim() || `execute ready artifact ${request.specPath}`,
        ...repoDefault,
      },
    };
  }

  if (request.structuredSpec) {
    return {
      ...base,
      kind: 'structured_json',
      data: { ...repoDefault, ...request.structuredSpec, ...(request.refine ? { refine: request.refine } : {}) },
    };
  }

  // Explicit CLI description handoff — the user handed over prose, not a
  // workflow path. Bypass the keyword-based intent classifier (which
  // over-fires on words like "run" / "execute" that appear naturally in
  // feature specs) and route straight to generate. Only applies when the
  // spec text contains no workflow file reference; otherwise the spec is
  // a "run X" request and the natural-language classifier handles it.
  if (request.source === 'cli' && !mentionsWorkflowFile(request.spec)) {
    return {
      ...base,
      kind: 'structured_json',
      data: {
        intent: 'generate',
        description: request.spec,
        ...(request.refine ? { refine: request.refine } : {}),
        ...repoDefault,
      },
    };
  }

  return {
    ...base,
    kind: 'natural_language',
    text: request.spec,
  };
}

const WORKFLOW_FILE_PATTERN = /\bworkflows\/[\w./-]+\.(?:ts|js)\b|\b[\w./-]+\.workflow\.(?:ts|js|yaml|yml)\b/i;

function mentionsWorkflowFile(text: string): boolean {
  return WORKFLOW_FILE_PATTERN.test(text);
}

/**
 * Map handoff source to spec-intake surface.
 * `free-form`, `structured`, and `workflow-artifact` share intake routing
 * behavior with CLI handoffs today, so they map explicitly to `'cli'`.
 */
function sourceToSurface(source: LocalInvocationRequest['source']): InputSurface {
  switch (source) {
    case 'mcp':
      return 'mcp';
    case 'claude':
      return 'claude_handoff';
    case 'cli':
    case 'free-form':
    case 'structured':
    case 'workflow-artifact':
      return 'cli';
  }
}

function stableRunIdFor(request: LocalInvocationRequest): Pick<RunRequest, 'runId'> {
  const fromMetadata = request.metadata.rickyRunId ?? request.metadata.runId;
  if (typeof fromMetadata === 'string' && fromMetadata.trim()) return { runId: fromMetadata };
  return request.requestId ? { runId: request.requestId } : {};
}

function resolveWorkforcePersonaWriterOptions(
  request: LocalInvocationRequest,
  options: LocalExecutorOptions,
  cwd: string,
  executionPreference: ExecutionPreference,
): GenerationInput['workforcePersonaWriter'] | undefined {
  if (options.workforcePersonaWriter === false) return undefined;
  const requestedByMetadata = request.metadata.workflowWriter === 'workforce' || request.metadata.workflow_writer === 'workforce';
  if (!options.workforcePersonaWriter && !requestedByMetadata) return undefined;

  return {
    ...(options.workforcePersonaWriter || {}),
    repoRoot: cwd,
    targetMode: executionPreference === 'cloud' ? 'cloud' : 'local',
    installRoot: join(localRunStateRoot(cwd), 'workforce-persona-skills'),
  };
}

function workflowFileForRoute(
  request: LocalInvocationRequest,
  route: RouteTarget,
  workflowFileHint?: string,
): string | null {
  if (request.specPath && isExecutableWorkflowPath(request.specPath)) return request.specPath;
  if (route !== 'execute') return null;

  const candidate = request.structuredSpec?.workflowFile ?? request.structuredSpec?.workflowPath;
  if (typeof candidate === 'string' && isExecutableWorkflowPath(candidate)) return candidate;
  return workflowFileHint && isExecutableWorkflowPath(workflowFileHint) ? workflowFileHint : null;
}

function artifactPathOverrideFor(request: LocalInvocationRequest): string | undefined {
  const candidate =
    request.structuredSpec?.artifactPath ??
    request.structuredSpec?.workflowArtifactPath ??
    request.structuredSpec?.outputPath;
  return typeof candidate === 'string' && candidate.trim() ? candidate : undefined;
}

function isExecutableWorkflowPath(path: string): boolean {
  return /(?:^|\/)workflows\/.+\.(?:ts|js)$|\.workflow\.(?:ts|js|yaml|yml)$/i.test(path);
}

function mapCoordinatorLogs(result: CoordinatorResult): string[] {
  return [
    `[local] runtime status: ${result.status}`,
    `[local] runtime command: ${result.invocation.command} ${result.invocation.args.join(' ')}`,
    ...result.stdout.map((line) => `[stdout] ${line}`),
    ...result.stderr.map((line) => `[stderr] ${line}`),
  ];
}

function stageResponse(
  include: boolean,
  generation: LocalGenerationStageResult | undefined,
  execution: LocalExecutionStageResult | undefined,
  exitCode: 0 | 1 | 2,
): Pick<LocalResponse, 'generation' | 'execution' | 'exitCode'> {
  if (!include) return {};
  return {
    ...(generation ? { generation } : {}),
    ...(execution ? { execution } : {}),
    exitCode,
  };
}

function resolveStageMode(
  requestStageMode: LocalStageMode | undefined,
  returnGeneratedArtifactOnly: boolean | undefined,
): 'generate' | 'run' {
  if (returnGeneratedArtifactOnly === true) return 'generate';
  const normalized = normalizeStageMode(requestStageMode);
  if (returnGeneratedArtifactOnly === false) return normalized ?? 'run';
  return normalized ?? 'generate';
}

function normalizeStageMode(stageMode: LocalStageMode | undefined): 'generate' | 'run' | undefined {
  if (stageMode === 'generate-and-run') return 'run';
  return stageMode;
}

function createGenerationStage(
  status: LocalGenerationStatus,
  artifact: RenderedArtifact | null,
  specDigest: string,
  error?: string,
  generationResult?: GenerationResult,
  assistantTurnContext?: LocalAssistantTurnContextDecision,
): LocalGenerationStageResult {
  return {
    stage: 'generate',
    status,
    ...(artifact
      ? {
          artifact: {
            path: artifact.artifactPath,
            workflow_id: artifact.workflowId,
            spec_digest: specDigest,
          },
        }
      : {}),
    ...(status === 'ok' && artifact
      ? {
          next: {
            run_command: localRunCommand(artifact.artifactPath),
            run_mode_hint: `ricky run ${artifact.artifactPath}`,
          },
        }
      : {}),
    ...(error ? { error } : {}),
    ...(generationResult
      ? {
          decisions: {
            skill_matches: generationResult.skillContext.matches,
            tool_selection: generationResult.toolSelection.selections,
            ...(generationResult.refinement ? { refinement: generationResult.refinement } : {}),
            ...(generationResult.workforcePersona ? { workforce_persona: generationResult.workforcePersona } : {}),
            ...(assistantTurnContext ? { assistant_turn_context: assistantTurnContext } : {}),
          },
        }
      : decisionsForAssistantTurnContext(assistantTurnContext)),
  };
}

async function writeGenerationMetadataArtifacts(
  generationResult: GenerationResult,
  artifactWriter: ArtifactWriter,
  cwd: string,
): Promise<void> {
  const artifact = generationResult.artifact;
  if (!artifact) return;
  await artifactWriter.writeArtifact(`${artifact.artifactsDir}/skill-matches.json`, `${JSON.stringify(generationResult.skillContext.matches, null, 2)}\n`, cwd);
  await artifactWriter.writeArtifact(`${artifact.artifactsDir}/tool-selection.json`, `${JSON.stringify(generationResult.toolSelection.selections, null, 2)}\n`, cwd);
  if (generationResult.refinement) {
    await artifactWriter.writeArtifact(`${artifact.artifactsDir}/refinement.json`, `${JSON.stringify(generationResult.refinement, null, 2)}\n`, cwd);
  }
  if (generationResult.workforcePersona) {
    await artifactWriter.writeArtifact(`${artifact.artifactsDir}/workforce-persona.json`, `${JSON.stringify(generationResult.workforcePersona, null, 2)}\n`, cwd);
  }
}

function createArtifactReferenceGenerationStage(
  artifactPath: string,
  requestId: string | undefined,
  specDigest: string,
  assistantTurnContext?: LocalAssistantTurnContextDecision,
): LocalGenerationStageResult {
  return {
    stage: 'generate',
    status: 'ok',
    artifact: {
      path: artifactPath,
      workflow_id: requestId ?? workflowIdForPath(artifactPath),
      spec_digest: specDigest,
    },
    next: {
      run_command: localRunCommand(artifactPath),
      run_mode_hint: `ricky run ${artifactPath}`,
    },
    ...decisionsForAssistantTurnContext(assistantTurnContext),
  };
}

function decisionsForAssistantTurnContext(
  assistantTurnContext: LocalAssistantTurnContextDecision | undefined,
): Pick<LocalGenerationStageResult, 'decisions'> {
  if (!assistantTurnContext) return {};
  return {
    decisions: {
      assistant_turn_context: assistantTurnContext,
    },
  };
}

function summarizeRickyTurnContext(assembly: TurnContextAssembly): LocalAssistantTurnContextDecision {
  const metadata = assembly.metadata as { adapter?: { name?: unknown; package?: unknown } } | undefined;
  return {
    assistant_id: assembly.assistantId,
    turn_id: assembly.turnId,
    adapter: typeof metadata?.adapter?.name === 'string' ? metadata.adapter.name : 'unknown',
    package: typeof metadata?.adapter?.package === 'string' ? metadata.adapter.package : '@agent-assistant/turn-context',
    context_blocks: assembly.context.blocks.map((block) => block.id),
    enrichment_ids: [...assembly.provenance.usedEnrichmentIds],
  };
}

function localRunCommand(artifactPath: string): string {
  return `ricky run ${artifactPath}`;
}

function digestSpec(spec: string): string {
  return createHash('sha256').update(spec).digest('hex');
}

function workflowIdForPath(path: string): string {
  return `wf-${digestSpec(path).slice(0, 12)}`;
}

async function precheckRuntimeLaunch(
  artifactPath: string,
  cwd: string,
  route: ExecutionRoute,
  options: LocalExecutorOptions,
): Promise<LocalClassifiedBlocker | null> {
  if (options.commandRunner || options.coordinator) {
    return null;
  }

  const { access } = await import('node:fs/promises');
  const resolvedArtifact = isAbsolute(artifactPath) ? artifactPath : resolve(cwd, artifactPath);
  try {
    await access(resolvedArtifact);
  } catch {
    return blocker({
      code: 'INVALID_ARTIFACT',
      category: 'workflow_invalid',
      detectedDuring: 'precheck',
      message: `Workflow artifact is not readable at ${resolvedArtifact}.`,
      missing: [resolvedArtifact],
      found: [],
      steps: [`test -f ${shellQuote(resolvedArtifact)}`, `ricky run ${shellQuote(artifactPath)}`],
    });
  }

  const command = route.command ?? 'agent-relay';
  if (command === DEFAULT_LOCAL_ROUTE.command) {
    if (options.scriptWorkflowRunner) return null;
    const runtime = await resolveWorkflowSdkRuntime(cwd);
    if (runtime) return null;
    return blocker({
      code: 'MISSING_BINARY',
      category: 'dependency',
      detectedDuring: 'precheck',
      message: 'Runtime dependency is unavailable: @agent-relay/sdk/workflows runtime.',
      missing: ['@agent-relay/sdk/workflows runtime'],
      found: [`cwd=${cwd}`],
      steps: [
        'Install Ricky with its @agent-relay/sdk dependency available.',
        'Run npm install in the Ricky package if using a linked development checkout.',
        localRunCommand(artifactPath),
      ],
    });
  }

  const executable = await findExecutable(command);
  if (!executable) {
    return blocker({
      code: 'MISSING_BINARY',
      category: 'dependency',
      detectedDuring: 'precheck',
      message: `Runtime command "${command}" is not available on PATH.`,
      missing: [command],
      found: [`PATH=${process.env.PATH ?? ''}`],
      steps: [`command -v ${shellQuote(command)}`, 'npm install'],
    });
  }

  const baseArgs = route.baseArgs ?? [];
  const noInstallIndex = baseArgs.indexOf('--no-install');
  const npxPackage = command === 'npx' && noInstallIndex !== -1 ? baseArgs[noInstallIndex + 1] : undefined;
  if (npxPackage) {
    const localBin = resolve(cwd, 'node_modules', '.bin', npxPackage);
    try {
      await access(localBin);
    } catch {
      return blocker({
        code: 'MISSING_BINARY',
        category: 'dependency',
        detectedDuring: 'precheck',
        message: `Runtime package "${npxPackage}" is not installed in this workspace.`,
        missing: [localBin],
        found: [executable],
        steps: [
          'npm install',
          `test -x ${shellQuote(localBin)}`,
          `npx --no-install ${shellQuote(npxPackage)} run ${shellQuote(artifactPath)}`,
        ],
      });
    }
  }

  return null;
}

async function resolveLocalRuntimeRoute(
  cwd: string,
  route: ExecutionRoute,
  options: LocalExecutorOptions,
): Promise<ExecutionRoute> {
  if (options.commandRunner || options.coordinator) return route;

  const command = route.command ?? 'agent-relay';
  const baseArgs = route.baseArgs ?? [];
  const npxPackage = command === 'npx' ? npxNoInstallPackage(baseArgs) : undefined;
  if (npxPackage !== 'agent-relay') return route;

  const localBin = resolve(cwd, 'node_modules', '.bin', npxPackage);
  if (await isExecutable(localBin)) return route;

  const pathExecutable = await findExecutable(npxPackage);
  if (!pathExecutable) return route;

  return { command: npxPackage, baseArgs: ['run'] };
}

async function isExecutable(path: string): Promise<boolean> {
  const { access } = await import('node:fs/promises');
  const { constants } = await import('node:fs');
  try {
    await access(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function blocker(params: {
  code: LocalBlockerCode;
  category: LocalBlockerCategory;
  detectedDuring: LocalClassifiedBlocker['detected_during'];
  message: string;
  missing: string[];
  found: string[];
  steps: string[];
}): LocalClassifiedBlocker {
  return {
    code: params.code,
    category: params.category,
    message: params.message,
    detected_at: new Date().toISOString(),
    detected_during: params.detectedDuring,
    recovery: {
      actionable: params.steps.length > 0,
      steps: params.steps,
    },
    context: {
      missing: params.missing,
      found: params.found,
    },
  };
}

async function findExecutable(command: string): Promise<string | null> {
  const { access } = await import('node:fs/promises');
  const { constants } = await import('node:fs');

  if (command.includes('/')) {
    try {
      await access(command, constants.X_OK);
      return command;
    } catch {
      return null;
    }
  }

  for (const pathEntry of (process.env.PATH ?? '').split(delimiter)) {
    if (!pathEntry) continue;
    const candidate = join(pathEntry, command);
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Continue searching PATH.
    }
  }
  return null;
}

function createBlockerExecutionStage(params: {
  workflowId: string;
  artifactPath: string;
  cwd: string;
  route: ExecutionRoute;
  blocker: LocalClassifiedBlocker;
}): LocalExecutionStageResult {
  const detectedAt = params.blocker.detected_at;
  const command = commandString(params.route, params.artifactPath);
  return {
    stage: 'execute',
    status: 'blocker',
    execution: {
      workflow_id: params.workflowId,
      artifact_path: params.artifactPath,
      command,
      workflow_file: params.artifactPath,
      cwd: params.cwd,
      started_at: detectedAt,
      finished_at: detectedAt,
      duration_ms: 0,
      steps_completed: 0,
      steps_total: 1,
    },
    blocker: params.blocker,
    evidence: {
      outcome_summary: params.blocker.message,
      failed_step: { id: 'runtime-precheck', name: 'Local runtime precheck' },
      exit_code: null,
      logs: {
        tail: [params.blocker.message],
        truncated: false,
      },
      side_effects: {
        files_written: [],
        commands_invoked: [command],
      },
      assertions: [
        {
          name: 'runtime_precheck',
          status: 'fail',
          detail: params.blocker.message,
        },
      ],
    },
  };
}

async function createExecutionStageFromCoordinatorResult(
  result: CoordinatorResult,
  workflowId: string,
  generatedContent: string | undefined,
  generatedArtifactPath: string | undefined,
  runtimeRunId: string | undefined,
): Promise<LocalExecutionStageResult> {
  const status: LocalExecutionStatus = result.status === 'passed' ? 'success' : 'blocker';
  const logs = await writeRuntimeLogs(result);
  const command = `${result.invocation.command} ${result.invocation.args.join(' ')}`;
  const classifiedBlocker = status === 'blocker' ? classifyCoordinatorBlocker(result, command) : undefined;
  const artifactBytes = generatedContent
    ? Buffer.byteLength(generatedContent, 'utf8')
    : await artifactSize(result.workflowFile, result.cwd);
  const artifactsProduced = [
    {
      path: generatedArtifactPath ?? result.workflowFile,
      kind: 'workflow',
      bytes: artifactBytes,
    },
  ];
  const filesWritten = [
    ...(generatedArtifactPath ? [generatedArtifactPath] : []),
    ...(logs.stdout_path ? [logs.stdout_path] : []),
    ...(logs.stderr_path ? [logs.stderr_path] : []),
  ];
  const stepStatus = status === 'success' ? 'pass' : 'fail';
  const outcome = status === 'success'
    ? `Workflow ${result.workflowFile} completed successfully with ${result.stdout.length} stdout line(s) and ${result.stderr.length} stderr line(s).`
    : `Workflow ${result.workflowFile} was blocked during local runtime execution: ${classifiedBlocker?.message ?? result.error ?? result.status}.`;

  return {
    stage: 'execute',
    status,
    execution: {
      workflow_id: workflowId,
      artifact_path: result.workflowFile,
      command,
      workflow_file: result.workflowFile,
      cwd: result.cwd,
      started_at: result.startedAt,
      finished_at: result.completedAt,
      duration_ms: result.durationMs,
      steps_completed: status === 'success' ? 1 : 0,
      steps_total: 1,
      ...(runtimeRunId ? { run_id: runtimeRunId } : {}),
    },
    ...(classifiedBlocker ? { blocker: classifiedBlocker } : {}),
    evidence: {
      outcome_summary: outcome,
      ...(status === 'success' ? { artifacts_produced: artifactsProduced } : {}),
      ...(status === 'blocker' ? { failed_step: { id: 'runtime-launch', name: 'Local runtime execution' } } : {}),
      ...(status === 'blocker' ? { exit_code: result.exitCode } : {}),
      logs,
      side_effects: {
        files_written: filesWritten,
        commands_invoked: [command],
        ...(status === 'success' ? { network_calls: [] } : {}),
      },
      assertions: [
        {
          name: 'runtime_exit_code',
          status: stepStatus,
          detail: result.exitCode === 0 ? 'Runtime exited with code 0.' : `Runtime exit code: ${result.exitCode ?? 'unknown'}.`,
        },
      ],
      ...(status === 'success'
        ? {
            workflow_steps: [
              {
                id: 'runtime-launch',
                name: 'Local runtime execution',
                status: stepStatus,
                duration_ms: result.durationMs,
              },
            ],
          }
        : {}),
    },
  };
}

function runtimeRunIdFilePath(cwd: string, workflowId: string): string {
  return join(localRunStateRoot(cwd), `${workflowId}-run-id.txt`);
}

async function ensureParentDir(path: string): Promise<void> {
  const { mkdir } = await import('node:fs/promises');
  try {
    await mkdir(dirname(path), { recursive: true });
  } catch {
    // Runtime execution can still proceed; stderr parsing remains a run-id fallback.
  }
}

async function resolveRuntimeRunId(runIdFilePath: string, stderr: string[]): Promise<string | undefined> {
  const { readFile } = await import('node:fs/promises');
  try {
    const fromFile = (await readFile(runIdFilePath, 'utf8')).trim();
    if (fromFile) return fromFile;
  } catch {
    // Fall through to stderr parsing.
  }

  const stderrText = stderr.join('\n');
  return parseRunId(stderrText);
}

function parseRunId(text: string): string | undefined {
  const match = text.match(/\bRun ID:\s*([^\s]+)/i);
  return match?.[1];
}

function classifyCoordinatorBlocker(
  result: CoordinatorResult,
  command: string,
): LocalClassifiedBlocker {
  const signal = firstRuntimeSignal(result);
  const combined = [result.error, ...result.stderr, ...result.stdout].filter(Boolean).join('\n');
  const runtimePackage = npxNoInstallPackage(result.invocation.args);

  if (/Workflow runtime reported failure despite a zero process exit|\[workflow\]\s+FAILED:/i.test(combined)) {
    return blocker({
      code: 'INVALID_ARTIFACT',
      category: 'workflow_invalid',
      detectedDuring: 'launch',
      message: `Workflow reported a failed run: ${signal}.`,
      missing: ['passing workflow run'],
      found: [`cwd=${result.cwd}`, `status=${result.status}`],
      steps: ['Inspect the captured workflow logs.', command],
    });
  }

  if (result.exitCode === 127 || /(?:command not found|enoent|not found)/i.test(combined)) {
    const isSdkScriptRoute = result.invocation.command === DEFAULT_LOCAL_ROUTE.command;
    return blocker({
      code: 'MISSING_BINARY',
      category: 'dependency',
      detectedDuring: 'launch',
      message: `Runtime dependency is unavailable: ${signal}.`,
      missing: [runtimePackage ?? (isSdkScriptRoute ? '@agent-relay/sdk/workflows runtime' : result.invocation.command)],
      found: [`cwd=${result.cwd}`],
      steps: [
        'npm install',
        runtimePackage
          ? `npx --no-install ${shellQuote(runtimePackage)} run ${shellQuote(result.workflowFile)}`
          : isSdkScriptRoute
            ? localRunCommand(result.workflowFile)
          : `command -v ${shellQuote(result.invocation.command)}`,
      ],
    });
  }

  const missingEnvVars = extractMissingEnvVars(combined);
  if (missingEnvVars.length > 0 || /(?:missing|required).*(?:env|environment)|not set/i.test(combined)) {
    return blocker({
      code: 'MISSING_ENV_VAR',
      category: 'environment',
      detectedDuring: 'launch',
      message: `Required runtime environment is missing: ${signal}.`,
      missing: missingEnvVars.length > 0 ? missingEnvVars : ['required environment variable'],
      found: [`cwd=${result.cwd}`],
      steps: missingEnvVars.length > 0
        ? missingEnvVars.map((name) => `export ${name}=...`)
        : ['Set the required environment variables and rerun the workflow.'],
    });
  }

  if (/(?:credential|auth|unauthorized|forbidden|token|api key)/i.test(combined)) {
    return blocker({
      code: 'CREDENTIALS_REJECTED',
      category: 'credentials',
      detectedDuring: 'launch',
      message: `Runtime credentials were rejected: ${signal}.`,
      missing: ['valid runtime credentials'],
      found: [`cwd=${result.cwd}`],
      steps: ['Refresh local provider credentials.', command],
    });
  }

  if (/(?:working tree|workdir|worktree|git status).*(?:dirty|uncommitted|modified)|(?:dirty|uncommitted).*(?:working tree|workdir|worktree)/i.test(combined)) {
    return blocker({
      code: 'WORKDIR_DIRTY',
      category: 'resource',
      detectedDuring: 'launch',
      message: `Runtime requires a clean working directory: ${signal}.`,
      missing: ['clean working directory'],
      found: [`cwd=${result.cwd}`],
      steps: ['Review local changes with git status --short.', 'Commit, stash, or move unrelated changes before rerunning.', command],
    });
  }

  if (/(?:econnrefused|enotfound|network|timeout|timed out|dns)/i.test(combined)) {
    return blocker({
      code: 'NETWORK_UNREACHABLE',
      category: 'resource',
      detectedDuring: 'launch',
      message: `Runtime network dependency is unreachable: ${signal}.`,
      missing: ['reachable network dependency'],
      found: [`cwd=${result.cwd}`],
      steps: ['Check local network connectivity and service availability.', command],
    });
  }

  return blocker({
    code: 'UNSUPPORTED_RUNTIME',
    category: 'unsupported',
    detectedDuring: 'launch',
    message: `Local runtime could not execute the workflow: ${signal}.`,
    missing: ['supported local runtime execution'],
    found: [`status=${result.status}`, `exitCode=${result.exitCode ?? 'unknown'}`],
    steps: ['Inspect the captured stdout/stderr logs.', command],
  });
}

function firstRuntimeSignal(result: CoordinatorResult): string {
  return result.error ?? result.stderr[0] ?? result.stdout[0] ?? `status ${result.status}`;
}

function npxNoInstallPackage(args: string[]): string | undefined {
  const noInstallIndex = args.indexOf('--no-install');
  if (noInstallIndex === -1) return undefined;
  return args[noInstallIndex + 1];
}

function extractMissingEnvVars(text: string): string[] {
  const names = new Set<string>();
  for (const match of text.matchAll(/\b([A-Z][A-Z0-9_]{2,})\b/g)) {
    const name = match[1];
    if (['ENOENT', 'PATH'].includes(name)) continue;
    names.add(name);
  }
  return [...names];
}

async function writeRuntimeLogs(result: CoordinatorResult): Promise<LocalExecutionEvidence['logs']> {
  // Use the coordinator-reported cwd (already the invocation root captured at
  // the CLI boundary). Log capture is Ricky state, so keep it outside the
  // target repo by default and key it by the repo path.
  const base = localRunArtifactDir(result.cwd ?? process.cwd(), result.runId);
  const { mkdir, writeFile } = await import('node:fs/promises');
  const stdoutPath = join(base, 'stdout.log');
  const stderrPath = join(base, 'stderr.log');

  try {
    await mkdir(base, { recursive: true });
    await writeFile(stdoutPath, `${result.stdout.join('\n')}${result.stdout.length ? '\n' : ''}`, 'utf8');
    await writeFile(stderrPath, `${result.stderr.join('\n')}${result.stderr.length ? '\n' : ''}`, 'utf8');
    return {
      stdout_path: stdoutPath,
      stderr_path: stderrPath,
      tail: [...result.stdoutSnippet.lines, ...result.stderrSnippet.lines],
      truncated: result.stdoutSnippet.truncated || result.stderrSnippet.truncated,
    };
  } catch {
    return {
      tail: [...result.stdoutSnippet.lines, ...result.stderrSnippet.lines],
      truncated: result.stdoutSnippet.truncated || result.stderrSnippet.truncated,
    };
  }
}

async function artifactSize(path: string, cwd: string): Promise<number> {
  const { stat } = await import('node:fs/promises');
  const resolved = isAbsolute(path) ? path : resolve(cwd, path);
  try {
    return (await stat(resolved)).size;
  } catch {
    return 0;
  }
}

function commandString(route: ExecutionRoute, workflowFile: string): string {
  const command = route.command ?? 'agent-relay';
  const args = [...(route.baseArgs ?? ['run']), workflowFile];
  return `${command} ${args.join(' ')}`;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

/**
 * Deduplicate artifacts by path. When two artifacts share a path, prefer the
 * entry that carries content and/or a more specific type rather than blindly
 * spreading (which would let a later content-less reference overwrite an
 * earlier content-carrying entry).
 */
function dedupeArtifacts(artifacts: LocalResponseArtifact[]): LocalResponseArtifact[] {
  const byPath = new Map<string, LocalResponseArtifact>();
  for (const artifact of artifacts) {
    const existing = byPath.get(artifact.path);
    if (!existing) {
      byPath.set(artifact.path, { ...artifact });
      continue;
    }
    // Merge: prefer defined values over undefined, and prefer content-carrying
    // entries to avoid overwriting content with undefined.
    byPath.set(artifact.path, {
      path: artifact.path,
      type: artifact.type ?? existing.type,
      content: artifact.content ?? existing.content,
    });
  }
  return [...byPath.values()];
}
