/**
 * Ricky local/BYOH entrypoint.
 *
 * Ties together request normalization, spec intake, workflow generation,
 * and local runtime coordination. Returns artifacts, logs, warnings, and
 * suggested next actions — without routing through Cloud by default.
 */

import type { ArtifactReader, LocalInvocationRequest, RawHandoff } from './request-normalizer';
import { normalizeRequest } from './request-normalizer';
import { spawn } from 'node:child_process';
import { dirname, isAbsolute, resolve } from 'node:path';
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
      const cwd = options.cwd ?? process.cwd();
      const artifactWriter = options.artifactWriter ?? defaultArtifactWriter;
      const coordinator =
        options.coordinator ?? new LocalCoordinator(options.commandRunner ?? createProcessCommandRunner());

      logs.push(`[local] received spec from ${request.source}`);
      logs.push(`[local] mode: ${request.mode}`);

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
        return { ok: false, artifacts, logs, warnings, nextActions };
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
          return { ok: false, artifacts, logs, warnings, nextActions };
        }

        await artifactWriter.writeArtifact(artifact.artifactPath, artifact.content, cwd);
        logs.push(`[local] wrote workflow artifact: ${artifact.artifactPath}`);
      }

      const runTarget = artifact?.artifactPath ?? workflowFile;
      if (!runTarget) {
        warnings.push('No executable local workflow artifact was available.');
        nextActions.push('Provide a workflows/**/*.ts artifact or a generation spec that can produce one.');
        return { ok: false, artifacts, logs, warnings, nextActions };
      }

      const runResult = await coordinator.launch({
        workflowFile: runTarget,
        cwd,
        timeoutMs: options.timeoutMs,
        route: options.route ?? DEFAULT_LOCAL_ROUTE,
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

      if (runResult.status !== 'passed') {
        warnings.push(runResult.error ?? `Local workflow finished with status ${runResult.status}.`);
        nextActions.push('Inspect the local runtime logs and rerun after resolving the environment blocker.');
        return { ok: false, artifacts: dedupeArtifacts(artifacts), logs, warnings, nextActions };
      }

      nextActions.push('Inspect generated artifacts and local run evidence.');
      if (request.mode === 'both') {
        nextActions.push('After local validation, optionally promote to Cloud execution.');
      }

      return { ok: true, artifacts: dedupeArtifacts(artifacts), logs, warnings, nextActions };
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
  const { executor = options.localExecutor ? createLocalExecutor(options.localExecutor) : getDefaultExecutor(), artifactReader } = options;

  // Normalize
  let request: LocalInvocationRequest;
  try {
    request = isLocalInvocationRequest(handoff)
      ? { ...handoff, executionPreference: handoff.executionPreference ?? handoff.mode }
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
  return executor.execute(request);
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

  if (request.structuredSpec) {
    return {
      ...base,
      kind: 'structured_json',
      data: request.structuredSpec,
    };
  }

  if (request.source === 'workflow-artifact' && request.specPath && isExecutableWorkflowPath(request.specPath)) {
    return {
      ...base,
      kind: 'structured_json',
      data: {
        intent: 'execute',
        workflowFile: request.specPath,
        description: `execute ready artifact ${request.specPath}`,
      },
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
 * `free-form`, `structured`, and `workflow-artifact` intentionally fall through
 * to `'cli'` — they share intake routing behavior with CLI handoffs today.
 */
function sourceToSurface(source: LocalInvocationRequest['source']): InputSurface {
  if (source === 'mcp') return 'mcp';
  if (source === 'claude') return 'claude_handoff';
  if (source === 'cli') return 'cli';
  // free-form, structured, workflow-artifact → cli surface
  return 'cli';
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

function dedupeArtifacts(artifacts: LocalResponseArtifact[]): LocalResponseArtifact[] {
  const byPath = new Map<string, LocalResponseArtifact>();
  for (const artifact of artifacts) {
    byPath.set(artifact.path, { ...byPath.get(artifact.path), ...artifact });
  }
  return [...byPath.values()];
}
