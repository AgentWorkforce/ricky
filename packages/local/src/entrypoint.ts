/**
 * Ricky local/BYOH entrypoint.
 *
 * Ties together request normalization, spec intake, workflow generation,
 * and local runtime coordination. Returns artifacts, logs, warnings, and
 * suggested next actions — without routing through Cloud by default.
 */

import type { ArtifactReader, LocalInvocationRequest, LocalStageMode, RawHandoff } from './request-normalizer';
import { normalizeRequest } from './request-normalizer';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { delimiter, dirname, isAbsolute, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';

import { generate } from '@ricky/product/generation/index';
import type { GenerationResult, RenderedArtifact } from '@ricky/product/generation/index';
import { intake } from '@ricky/product/spec-intake/index';
import type { ExecutionPreference, InputSurface, RawSpecPayload, RouteTarget } from '@ricky/product/spec-intake/index';
import { LocalCoordinator } from '@ricky/runtime/local-coordinator';
import type {
  CommandInvocation,
  CommandRunner,
  CommandRunnerOptions,
  CoordinatorResult,
  ExecutionRoute,
  RunRequest,
} from '@ricky/runtime/types';

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
}

export type LocalBlockerCode =
  | 'MISSING_ENV_VAR'
  | 'MISSING_BINARY'
  | 'INVALID_ARTIFACT'
  | 'UNSUPPORTED_RUNTIME'
  | 'CREDENTIALS_REJECTED'
  | 'WORKDIR_DIRTY'
  | 'NETWORK_UNREACHABLE';

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
}

// ---------------------------------------------------------------------------
// Execution adapter — injectable seam for generation + runtime coordination
// ---------------------------------------------------------------------------

/**
 * The executor is the seam between the entrypoint and actual work.
 * Inject a fake in tests; wire the real agent-relay runtime in production.
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
  /** When true, stop after writing/generated artifact and return it without launching local runtime. */
  returnGeneratedArtifactOnly?: boolean;
}

/**
 * Default execution route for local runtime coordination.
 * Uses `npx --no-install` to ensure the CLI is resolved from the project
 * dependency tree rather than silently fetched from the registry.
 */
export const DEFAULT_LOCAL_ROUTE: ExecutionRoute = {
  command: 'npx',
  baseArgs: ['--no-install', 'agent-relay', 'run'],
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

export function createLocalExecutor(options: LocalExecutorOptions = {}): LocalExecutor {
  return {
    async execute(request: LocalInvocationRequest): Promise<LocalResponse> {
      const artifacts: LocalResponseArtifact[] = [];
      const logs: string[] = [];
      const warnings: string[] = [];
      const nextActions: string[] = [];
      const cwd = request.invocationRoot ?? options.cwd ?? process.cwd();
      const artifactWriter = options.artifactWriter ?? defaultArtifactWriter;
      const coordinator =
        options.coordinator ?? new LocalCoordinator(options.commandRunner ?? createProcessCommandRunner());
      const stageMode = resolveStageMode(request.stageMode, options.returnGeneratedArtifactOnly);
      const includeStageContract = true;
      const specDigest = digestSpec(request.spec);
      let generationStage: LocalGenerationStageResult | undefined;

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
        generationResult = generate({
          spec: normalizedSpec,
          dryRunEnabled: true,
        });
        artifact = generationResult.artifact;

        logs.push(`[local] workflow generation: ${generationResult.success ? 'passed' : 'failed'}`);
        logs.push(`[local] selected pattern: ${generationResult.patternDecision.pattern}`);
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
          generationStage = createGenerationStage('error', artifact, specDigest, generationResult.validation.errors[0]);
          return { ok: false, artifacts, logs, warnings, nextActions, ...stageResponse(includeStageContract, generationStage, undefined, 1) };
        }

        await artifactWriter.writeArtifact(artifact.artifactPath, artifact.content, cwd);
        logs.push(`[local] wrote workflow artifact: ${artifact.artifactPath}`);
        generationStage = createGenerationStage('ok', artifact, specDigest);
      }

      const runTarget = artifact?.artifactPath ?? workflowFile;
      if (!runTarget) {
        warnings.push('No executable local workflow artifact was available.');
        nextActions.push('Provide a workflows/**/*.ts artifact or a generation spec that can produce one.');
        generationStage = {
          stage: 'generate',
          status: 'error',
          error: 'No executable local workflow artifact was available.',
        };
        return { ok: false, artifacts, logs, warnings, nextActions, ...stageResponse(includeStageContract, generationStage, undefined, 1) };
      }

      if (!generationStage) {
        generationStage = createArtifactReferenceGenerationStage(runTarget, request.requestId, specDigest);
      }

      if (stageMode === 'generate') {
        if (!artifact) {
          artifacts.push({
            path: runTarget,
            type: 'text/typescript',
          });
        }
        logs.push('[local] runtime launch skipped: returning generated artifact only');
        nextActions.push(`Run the generated workflow locally: npx --no-install agent-relay run ${runTarget}`);
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

      const route = options.route ?? DEFAULT_LOCAL_ROUTE;
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

      const runResult = await coordinator.launch({
        workflowFile: runTarget,
        cwd,
        timeoutMs: options.timeoutMs,
        route,
        metadata: {
          requestId: intakeResult.requestId,
          source: request.source,
          route: intakeResult.routing.target,
          generatedWorkflowId: artifact?.workflowId,
        },
      });

      logs.push(...mapCoordinatorLogs(runResult));
      artifacts.push({
        path: runTarget,
        type: 'text/typescript',
        ...(artifact ? { content: artifact.content } : {}),
      });
      const execution = await createExecutionStageFromCoordinatorResult(
        runResult,
        workflowId,
        artifact?.content,
        artifact?.artifactPath,
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
  const { executor, artifactReader, localExecutor } = options;

  // Normalize
  let request: LocalInvocationRequest;
  try {
    request = isLocalInvocationRequest(handoff)
      ? handoff
      : await normalizeRequest(handoff, artifactReader);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      artifacts: [],
      logs: [`[local] normalization failed: ${message}`],
      warnings: [`Failed to normalize handoff from source '${handoff.source}'.`],
      nextActions: ['Check the spec content or artifact path and retry.'],
    };
  }

  const resolvedExecutor =
    executor ??
    (localExecutor
      ? createLocalExecutor({
          ...localExecutor,
          cwd: localExecutor.cwd ?? request.invocationRoot,
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

function toRawSpecPayload(request: LocalInvocationRequest): RawSpecPayload {
  const receivedAt = new Date().toISOString();
  const base = {
    surface: sourceToSurface(request.source),
    receivedAt,
    requestId: request.requestId,
    metadata: {
      ...request.metadata,
      mode: request.mode,
      specPath: request.specPath,
      sourceMetadata: request.sourceMetadata,
    },
  };

  if (request.source === 'mcp') {
    return {
      ...base,
      kind: 'mcp',
      toolName: typeof request.metadata.toolName === 'string' ? request.metadata.toolName : 'ricky.generate',
      arguments: request.structuredSpec ?? { spec: request.spec },
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
      },
    };
  }

  if (request.structuredSpec) {
    return {
      ...base,
      kind: 'structured_json',
      data: request.structuredSpec,
    };
  }

  return {
    ...base,
    kind: 'natural_language',
    text: request.spec,
  };
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
            run_command: `npx --no-install agent-relay run ${artifact.artifactPath}`,
            run_mode_hint: `ricky run --artifact ${artifact.artifactPath}`,
          },
        }
      : {}),
    ...(error ? { error } : {}),
  };
}

function createArtifactReferenceGenerationStage(
  artifactPath: string,
  requestId: string | undefined,
  specDigest: string,
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
      run_command: `npx --no-install agent-relay run ${artifactPath}`,
      run_mode_hint: `ricky run --artifact ${artifactPath}`,
    },
  };
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

function classifyCoordinatorBlocker(
  result: CoordinatorResult,
  command: string,
): LocalClassifiedBlocker {
  const signal = firstRuntimeSignal(result);
  const combined = [result.error, ...result.stderr, ...result.stdout].filter(Boolean).join('\n');
  const runtimePackage = npxNoInstallPackage(result.invocation.args);

  if (result.exitCode === 127 || /(?:command not found|enoent|not found)/i.test(combined)) {
    return blocker({
      code: 'MISSING_BINARY',
      category: 'dependency',
      detectedDuring: 'launch',
      message: `Runtime dependency is unavailable: ${signal}.`,
      missing: [runtimePackage ?? result.invocation.command],
      found: [`cwd=${result.cwd}`],
      steps: [
        'npm install',
        runtimePackage
          ? `npx --no-install ${shellQuote(runtimePackage)} run ${shellQuote(result.workflowFile)}`
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
  const base = resolve(process.cwd(), '.workflow-artifacts', 'ricky-local-runs', result.runId);
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
