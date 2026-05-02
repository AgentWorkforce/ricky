import { createHash } from 'node:crypto';
import { access, readFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import type { NormalizedWorkflowSpec } from '../spec-intake/types.js';
import type { RenderedArtifact, WorkflowExecutionTarget } from './types.js';

export const WORKFORCE_PERSONA_INTENT_CANDIDATES = [
  'agent-relay-workflow',
  'relay-orchestrator',
  'persona-authoring',
  'opencode-workflow-correctness',
  'architecture-plan',
  'documentation',
] as const;

export interface WorkforcePersonaRuntime {
  harness: string;
  model: string;
  systemPrompt?: string;
  harnessSettings?: {
    reasoning?: string;
    timeoutSeconds?: number;
  };
}

export interface WorkforcePersonaSelection {
  personaId: string;
  tier: string;
  runtime: WorkforcePersonaRuntime;
  rationale?: string;
  skills?: Array<{ id: string; source: string; description: string }>;
  env?: Record<string, string>;
}

export interface WorkforcePersonaExecutionResult {
  status: 'completed' | 'failed' | 'cancelled' | 'timeout';
  output: string;
  stderr: string;
  exitCode: number | null;
  durationMs: number;
  workflowRunId?: string;
  stepName?: string;
}

export interface WorkforcePersonaExecution extends Promise<WorkforcePersonaExecutionResult> {
  cancel(reason?: string): void;
  readonly runId: Promise<string>;
}

export interface WorkforcePersonaContext {
  selection: WorkforcePersonaSelection;
  install?: {
    command?: readonly string[];
    commandString?: string;
    cleanupCommand?: readonly string[];
    cleanupCommandString?: string;
  };
  sendMessage(task: string, options?: WorkforcePersonaSendOptions): WorkforcePersonaExecution;
}

export interface WorkforcePersonaModule {
  usePersona?: (intent: string, options?: { tier?: string; profile?: string; profileId?: string }) => unknown;
  useSelection?: (selection: unknown, options?: { harness?: string }) => unknown;
  resolvePersona?: (intent: string, profile?: unknown) => unknown;
  resolvePersonaByTier?: (intent: string, tier?: string) => unknown;
  PERSONA_INTENTS?: readonly string[];
}

export interface WorkforcePersonaSendOptions {
  workingDirectory?: string;
  name?: string;
  timeoutSeconds?: number;
  inputs?: Record<string, string | number | boolean>;
  installSkills?: boolean;
  env?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
  onProgress?: (chunk: { stream: 'stdout' | 'stderr'; text: string }) => void;
}

export interface WorkforcePersonaWriterOptions {
  repoRoot: string;
  workflowName?: string;
  targetMode: WorkflowExecutionTarget;
  outputPath: string;
  relevantFiles?: Array<{ path: string; content?: string }>;
  timeoutSeconds?: number;
  installSkills?: boolean;
  tier?: string;
  env?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
  onProgress?: (chunk: { stream: 'stdout' | 'stderr'; text: string }) => void;
  personaIntentCandidates?: readonly string[];
  resolver?: WorkforcePersonaResolver;
}

export interface WorkforcePersonaWriterMetadata {
  personaId: string;
  tier: string;
  harness: string;
  model: string;
  promptDigest: string;
  warnings: string[];
  runId: string | null;
  source: 'package' | 'local-dev';
  selectedIntent: string;
  responseFormat: 'structured-json' | 'fenced-artifact';
  outputPath: string;
  promptInputs: {
    workflowName: string;
    targetMode: WorkflowExecutionTarget;
    repoRoot: string;
    relevantFileCount: number;
  };
}

export interface WorkforcePersonaWriterResult {
  artifact: {
    content: string;
    metadata: Record<string, unknown>;
  };
  metadata: WorkforcePersonaWriterMetadata;
}

export interface ResolvedWorkforcePersonaContext {
  source: 'package' | 'local-dev';
  intent: string;
  context: WorkforcePersonaContext;
  warnings: string[];
}

export type WorkforcePersonaResolver = (
  intents: readonly string[],
  options: { tier?: string },
) => Promise<ResolvedWorkforcePersonaContext>;

export class WorkforcePersonaWriterError extends Error {
  readonly warnings: string[];

  constructor(message: string, warnings: string[] = []) {
    super(message);
    this.name = 'WorkforcePersonaWriterError';
    this.warnings = warnings;
  }
}

interface ParsedPersonaResponse {
  content: string;
  metadata: Record<string, unknown>;
  responseFormat: WorkforcePersonaWriterMetadata['responseFormat'];
}

export async function writeWorkflowWithWorkforcePersona(
  spec: NormalizedWorkflowSpec,
  options: WorkforcePersonaWriterOptions,
): Promise<WorkforcePersonaWriterResult> {
  const workflowName = options.workflowName ?? workflowNameFromOutputPath(options.outputPath);
  const relevantFiles = await resolveRelevantFiles(options.repoRoot, spec, options.relevantFiles);
  const resolver = options.resolver ?? defaultWorkforcePersonaResolver;
  const resolved = await resolver(options.personaIntentCandidates ?? WORKFORCE_PERSONA_INTENT_CANDIDATES, {
    tier: options.tier,
  });
  const task = buildWorkflowPersonaTask(spec, {
    workflowName,
    targetMode: options.targetMode,
    repoRoot: options.repoRoot,
    outputPath: options.outputPath,
    relevantFiles,
  });
  const promptDigest = digest(task);
  const selection = resolved.context.selection;
  const run = resolved.context.sendMessage(task, {
    workingDirectory: options.repoRoot,
    name: `ricky-workflow-writer-${promptDigest.slice(0, 12)}`,
    timeoutSeconds: options.timeoutSeconds ?? selection.runtime.harnessSettings?.timeoutSeconds,
    installSkills: options.installSkills,
    env: options.env,
    signal: options.signal,
    onProgress: options.onProgress,
    inputs: {
      outputPath: options.outputPath,
      workflowName,
      targetMode: options.targetMode,
      promptDigest,
    },
  });

  const [result, runId] = await Promise.all([
    run,
    run.runId.catch(() => null),
  ]);
  if (result.status !== 'completed') {
    throw new WorkforcePersonaWriterError(
      `Workforce persona writer did not complete: ${result.status}.`,
      [...resolved.warnings, result.stderr].filter(Boolean),
    );
  }

  const parsed = parsePersonaWorkflowResponse(result.output, options.outputPath);
  return {
    artifact: {
      content: parsed.content,
      metadata: parsed.metadata,
    },
    metadata: {
      personaId: selection.personaId,
      tier: selection.tier,
      harness: selection.runtime.harness,
      model: selection.runtime.model,
      promptDigest,
      warnings: [...resolved.warnings],
      runId: result.workflowRunId ?? runId,
      source: resolved.source,
      selectedIntent: resolved.intent,
      responseFormat: parsed.responseFormat,
      outputPath: options.outputPath,
      promptInputs: {
        workflowName,
        targetMode: options.targetMode,
        repoRoot: options.repoRoot,
        relevantFileCount: relevantFiles.length,
      },
    },
  };
}

export async function defaultWorkforcePersonaResolver(
  intents: readonly string[],
  options: { tier?: string } = {},
): Promise<ResolvedWorkforcePersonaContext> {
  const moduleResults = await loadWorkforcePersonaModules();
  const warnings: string[] = moduleResults.flatMap((moduleResult) => moduleResult.warnings);

  for (const intent of intents) {
    for (const moduleResult of moduleResults) {
      try {
        const context = resolvePersonaContext(moduleResult.module, intent, options);
        if (context) {
          return { source: moduleResult.source, intent, context, warnings };
        }
        warnings.push(`Workforce persona router did not expose a usable ${intent} context.`);
      } catch (error) {
        warnings.push(`Workforce persona resolution for ${intent} failed: ${errorMessage(error)}`);
      }
    }
  }

  throw new WorkforcePersonaWriterError(
    `No Workforce persona could be resolved for workflow authoring intents: ${intents.join(', ')}.`,
    warnings,
  );
}

export async function loadWorkforcePersonaModule(): Promise<{
  module: WorkforcePersonaModule;
  source: 'package' | 'local-dev';
  warnings: string[];
}> {
  const modules = await loadWorkforcePersonaModules();
  return modules[0];
}

async function loadWorkforcePersonaModules(): Promise<Array<{
  module: WorkforcePersonaModule;
  source: 'package' | 'local-dev';
  warnings: string[];
}>> {
  const warnings: string[] = [];
  const modules: Array<{
    module: WorkforcePersonaModule;
    source: 'package' | 'local-dev';
    warnings: string[];
  }> = [];

  for (const candidate of await localWorkforceModuleCandidates()) {
    try {
      await access(candidate);
      const module = await import(pathToFileURL(candidate).href) as WorkforcePersonaModule;
      if (isWorkforcePersonaModule(module)) {
        modules.push({ module, source: 'local-dev', warnings: [] });
      } else {
        warnings.push(`Local Workforce router at ${candidate} did not export persona resolver functions.`);
      }
    } catch (error) {
      warnings.push(`Local Workforce router unavailable at ${candidate}: ${errorMessage(error)}`);
    }
  }

  try {
    const packageName = '@agentworkforce/workload-router';
    const module = await import(packageName) as WorkforcePersonaModule;
    if (isWorkforcePersonaModule(module)) {
      modules.push({ module, source: 'package', warnings });
    } else {
      warnings.push('@agentworkforce/workload-router did not export persona resolver functions.');
    }
  } catch (error) {
    warnings.push(`Package Workforce router unavailable: ${errorMessage(error)}`);
  }

  if (modules.length > 0) {
    if (warnings.length > 0) {
      modules[0].warnings.push(...warnings);
    }
    return modules;
  }

  throw new WorkforcePersonaWriterError(
    [
      '@agentworkforce/workload-router is bundled as a Ricky dependency but no usable Workforce persona router could be loaded.',
      'Try reinstalling @agentworkforce/ricky (`npm install` in this project).',
      'If you develop Ricky locally with a sibling ../workforce clone, publish or link that workload-router.',
    ].join(' '),
    warnings,
  );
}

export function buildWorkflowPersonaTask(
  spec: NormalizedWorkflowSpec,
  input: {
    workflowName: string;
    targetMode: WorkflowExecutionTarget;
    repoRoot: string;
    outputPath: string;
    relevantFiles: Array<{ path: string; content?: string }>;
  },
): string {
  const contract = {
    response: {
      preferred: 'JSON object',
      schema: {
        artifact: {
          path: input.outputPath,
          language: 'typescript',
          content: 'Complete Agent Relay workflow TypeScript source.',
        },
        metadata: {
          workflowName: input.workflowName,
          targetMode: input.targetMode,
          summary: 'Short workflow purpose.',
          agents: 'Array of agent ids and responsibilities.',
          evidence: 'Array of deterministic evidence rules included in the workflow.',
        },
      },
      fallback:
        'If JSON cannot be emitted, return a fenced ```ts artifact block plus a fenced ```json metadata block.',
    },
  };

  return [
    'Write an Agent Relay workflow artifact for Ricky.',
    '',
    'Normalized spec JSON:',
    JSON.stringify(spec, null, 2),
    '',
    'Workflow generation inputs:',
    JSON.stringify({
      workflowName: input.workflowName,
      targetMode: input.targetMode,
      repoRoot: input.repoRoot,
      outputPath: input.outputPath,
    }, null, 2),
    '',
    'Relevant file context:',
    safeJson(input.relevantFiles.map((file) => ({
      path: file.path,
      content: file.content ?? null,
    }))),
    '',
    'Agent Relay workflow standards:',
    '- Prefer TypeScript workflows using @agent-relay/sdk/workflows.',
    '- Choose `.pattern(...)` from the normalized spec: pipeline (linear stages), supervisor (coordinated review/hand-off), or dag (parallel branches, gated fan-out). Prefer dag when multiple independent workstreams, critical evidence, or high risk; pipeline for simple linear work; supervisor when a lead must gate subordinate steps.',
    '- Use a dedicated workflow channel, not general.',
    '- Include explicit agents, step dependencies, deterministic gates, review stages, and final signoff.',
    '- Include an 80-to-100 fix loop: implement, validate, review, fix, final review, hard validation.',
    '- Verification must include typecheck/test commands when relevant plus git-diff evidence.',
    '- Run with an explicit cwd: .run({ cwd: process.cwd() }).',
    '- Preserve Agent Relay workflow authoring rules: deterministic gates are evidence, agents do production work, and every generated workflow must be locally dry-runnable.',
    '',
    'Constraints:',
    '- Produce only the workflow artifact and metadata contract.',
    '- Do not commit, push, open PRs, or perform destructive file operations.',
    '- Do not open an interactive Claude, Codex, or OpenCode terminal UI.',
    '- Keep generated runtime-agent prompts model-agnostic.',
    '- Side effects must be explicit in the workflow and verified with evidence.',
    '- Respect target mode: local workflows must run from this repository; cloud workflows must keep Cloud handoff prerequisites explicit.',
    '',
    'Auto-fix and repair expectations:',
    '- Include a fix/retry path that can use failure evidence from a previous run.',
    '- Include an explicit final hard validation after any fix loop.',
    '- Avoid workflows that require a human to manually edit files between implementation and validation.',
    '',
    'Evidence rules:',
    '- Every implementation step must be followed by deterministic validation or review evidence.',
    '- Final success requires a hard gate, regression evidence, and a signed final summary.',
    '- If target files are unknown, require an output manifest and validate each listed file.',
    '',
    'Structured response contract:',
    JSON.stringify(contract, null, 2),
  ].join('\n');
}

export function parsePersonaWorkflowResponse(output: string, expectedPath: string): ParsedPersonaResponse {
  const directJson = parseJsonObject(output);
  if (directJson) {
    return validateStructuredResponse(directJson, expectedPath, 'structured-json');
  }

  const jsonFence = fencedBlock(output, 'json');
  if (jsonFence) {
    const metadataJson = parseJsonObject(jsonFence);
    const tsFence = fencedBlock(output, 'ts') ?? fencedBlock(output, 'typescript');
    if (metadataJson && tsFence) {
      return validateFencedResponse(tsFence, metadataJson, expectedPath);
    }
    if (metadataJson) {
      return validateStructuredResponse(metadataJson, expectedPath, 'structured-json');
    }
  }

  const tsFence = fencedBlock(output, 'ts') ?? fencedBlock(output, 'typescript');
  const metadataFence = fencedBlock(output, 'metadata');
  const metadata = metadataFence ? parseJsonObject(metadataFence) : null;
  if (tsFence && metadata) {
    return validateFencedResponse(tsFence, metadata, expectedPath);
  }

  throw new WorkforcePersonaWriterError(
    'Workforce persona response must be structured JSON or include fenced TypeScript artifact and JSON metadata blocks.',
  );
}

export function applyPersonaArtifactToRenderedArtifact(
  base: RenderedArtifact,
  personaResult: WorkforcePersonaWriterResult,
): RenderedArtifact {
  return {
    ...base,
    content: personaResult.artifact.content,
  };
}

function validateStructuredResponse(
  value: Record<string, unknown>,
  expectedPath: string,
  responseFormat: WorkforcePersonaWriterMetadata['responseFormat'],
): ParsedPersonaResponse {
  const artifact = isRecord(value.artifact) ? value.artifact : value;
  const content = artifact.content;
  if (typeof content !== 'string' || content.trim().length === 0) {
    throw new WorkforcePersonaWriterError('Workforce persona structured response is missing artifact.content.');
  }
  validateArtifactContent(content);

  const artifactPath = artifact.path;
  if (typeof artifactPath === 'string' && artifactPath !== expectedPath) {
    throw new WorkforcePersonaWriterError(
      `Workforce persona artifact path ${artifactPath} did not match expected output path ${expectedPath}.`,
    );
  }

  const metadata = isRecord(value.metadata) ? value.metadata : {};
  validateMetadata(metadata);
  return { content, metadata, responseFormat };
}

function validateFencedResponse(
  artifactContent: string,
  metadata: Record<string, unknown>,
  expectedPath: string,
): ParsedPersonaResponse {
  validateArtifactContent(artifactContent);
  validateMetadata(metadata);
  const artifactPath = metadata.path ?? metadata.outputPath ?? metadata.artifactPath;
  if (typeof artifactPath === 'string' && artifactPath !== expectedPath) {
    throw new WorkforcePersonaWriterError(
      `Workforce persona fenced metadata path ${artifactPath} did not match expected output path ${expectedPath}.`,
    );
  }
  return {
    content: artifactContent.trimEnd() + '\n',
    metadata,
    responseFormat: 'fenced-artifact',
  };
}

function validateArtifactContent(content: string): void {
  if (!/\bworkflow\(/.test(content)) {
    throw new WorkforcePersonaWriterError('Workforce persona artifact does not call workflow().');
  }
  if (!/\.run\(\{ cwd: process\.cwd\(\) \}\)/.test(content)) {
    throw new WorkforcePersonaWriterError('Workforce persona artifact must run with explicit cwd.');
  }
}

function validateMetadata(metadata: Record<string, unknown>): void {
  if (Object.keys(metadata).length === 0) {
    throw new WorkforcePersonaWriterError('Workforce persona response metadata block is required.');
  }
  const hasPurpose = ['workflowName', 'summary', 'goal'].some((key) => typeof metadata[key] === 'string' && metadata[key].trim());
  if (!hasPurpose) {
    throw new WorkforcePersonaWriterError('Workforce persona response metadata must include workflowName, summary, or goal.');
  }
}

async function resolveRelevantFiles(
  repoRoot: string,
  spec: NormalizedWorkflowSpec,
  provided: Array<{ path: string; content?: string }> | undefined,
): Promise<Array<{ path: string; content?: string }>> {
  if (provided) return provided;
  const files = spec.targetFiles.slice(0, 8);
  const contexts: Array<{ path: string; content?: string }> = [];
  for (const path of files) {
    try {
      const absolute = isAbsolute(path) ? path : resolve(repoRoot, path);
      const content = await readFile(absolute, 'utf8');
      contexts.push({ path, content: content.slice(0, 12_000) });
    } catch {
      contexts.push({ path });
    }
  }
  return contexts;
}

async function localWorkforceModuleCandidates(): Promise<string[]> {
  const here = dirname(fileURLToPath(import.meta.url));
  const repoRoot = resolve(here, '../../../..');
  const siblingWorkforce = resolve(repoRoot, '../workforce/packages/workload-router');
  return [
    join(siblingWorkforce, 'dist/index.js'),
    join(siblingWorkforce, 'src/index.ts'),
  ];
}

function isWorkforcePersonaModule(value: unknown): value is WorkforcePersonaModule {
  return (
    isRecord(value) &&
    (
      typeof value.usePersona === 'function' ||
      typeof value.resolvePersona === 'function' ||
      typeof value.resolvePersonaByTier === 'function'
    )
  );
}

function resolvePersonaContext(
  module: WorkforcePersonaModule,
  intent: string,
  options: { tier?: string },
): WorkforcePersonaContext | null {
  if (module.PERSONA_INTENTS && !module.PERSONA_INTENTS.includes(intent)) {
    return null;
  }

  if (typeof module.usePersona === 'function') {
    const value = module.usePersona(intent, options.tier ? { tier: options.tier } : undefined);
    const context = normalizePersonaContext(value);
    if (context) return context;
  }

  if (options.tier && typeof module.resolvePersonaByTier === 'function') {
    const selection = module.resolvePersonaByTier(intent, options.tier);
    const context = normalizePersonaContext(
      typeof module.useSelection === 'function' ? module.useSelection(selection) : { selection },
    );
    if (context) return context;
  }

  if (typeof module.resolvePersona === 'function') {
    const selection = module.resolvePersona(intent);
    const context = normalizePersonaContext(
      typeof module.useSelection === 'function' ? module.useSelection(selection) : { selection },
    );
    if (context) return context;
  }

  return null;
}

function normalizePersonaContext(value: unknown): WorkforcePersonaContext | null {
  if (isUsablePersonaContext(value)) return value;
  if (!isRecord(value) || !isPersonaSelection(value.selection)) return null;
  const install = isRecord(value.install) ? value.install : undefined;
  return {
    selection: value.selection,
    ...(install ? {
      install: {
        command: readonlyStringArray(install.command),
        commandString: typeof install.commandString === 'string' ? install.commandString : undefined,
        cleanupCommand: readonlyStringArray(install.cleanupCommand),
        cleanupCommandString: typeof install.cleanupCommandString === 'string' ? install.cleanupCommandString : undefined,
      },
    } : {}),
    sendMessage(task, options) {
      return runPersonaWithHarness(value.selection as WorkforcePersonaSelection, task, options, install);
    },
  };
}

function isUsablePersonaContext(value: unknown): value is WorkforcePersonaContext {
  return (
    isRecord(value) &&
    isPersonaSelection(value.selection) &&
    typeof value.sendMessage === 'function'
  );
}

function isPersonaSelection(value: unknown): value is WorkforcePersonaSelection {
  return (
    isRecord(value) &&
    typeof value.personaId === 'string' &&
    typeof value.tier === 'string' &&
    isRecord(value.runtime) &&
    typeof value.runtime.harness === 'string' &&
    typeof value.runtime.model === 'string'
  );
}

function runPersonaWithHarness(
  selection: WorkforcePersonaSelection,
  task: string,
  options: WorkforcePersonaSendOptions | undefined,
  install: Record<string, unknown> | undefined,
): WorkforcePersonaExecution {
  const startedAt = Date.now();
  const timeoutSeconds = options?.timeoutSeconds ?? selection.runtime.harnessSettings?.timeoutSeconds ?? 1200;
  const runName = options?.name ?? `ricky-workforce-${selection.personaId}-${digest(task).slice(0, 12)}`;
  const runId = Promise.resolve(runName);
  let cancelledReason: string | undefined;

  const promise = (async (): Promise<WorkforcePersonaExecutionResult> => {
    if (options?.signal?.aborted) {
      return {
        status: 'cancelled',
        output: '',
        stderr: 'Workforce persona run was cancelled before start.',
        exitCode: null,
        durationMs: Date.now() - startedAt,
        workflowRunId: await runId,
      };
    }

    const runner = await createHarnessCliRunner(selection.runtime.harness);
    const prompt = buildHarnessPrompt(selection, task, install);
    const result = await runner.run({
      prompt,
      timeoutMs: timeoutSeconds * 1000,
      cwd: options?.workingDirectory,
      env: {
        ...process.env,
        ...(selection.env ?? {}),
        ...(options?.env ?? {}),
      },
      model: selection.runtime.model,
    });

    const workflowRunId = await runId;
    if (cancelledReason) {
      return {
        status: 'cancelled',
        output: '',
        stderr: cancelledReason,
        exitCode: null,
        durationMs: Date.now() - startedAt,
        workflowRunId,
      };
    }

    if (result.status === 'failed') {
      return {
        status: result.error.toLowerCase().includes('timeout') ? 'timeout' : 'failed',
        output: '',
        stderr: [result.error, result.stderr].filter(Boolean).join('\n'),
        exitCode: result.exitCode ?? null,
        durationMs: Date.now() - startedAt,
        workflowRunId,
      };
    }

    return {
      status: 'completed',
      output: result.text,
      stderr: '',
      exitCode: 0,
      durationMs: Date.now() - startedAt,
      workflowRunId,
    };
  })() as WorkforcePersonaExecution;

  Object.defineProperty(promise, 'runId', { value: runId });
  promise.cancel = (reason?: string) => {
    cancelledReason = reason ?? 'Workforce persona run cancelled.';
  };
  return promise;
}

async function createHarnessCliRunner(harness: string): Promise<{
  run(input: {
    prompt: string;
    timeoutMs: number;
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    model?: string;
  }): Promise<
    | { status: 'completed'; text: string; metadata?: Record<string, unknown> }
    | { status: 'failed'; error: string; stderr?: string; exitCode?: number }
  >;
}> {
  const workerBridge = await import('@agent-assistant/harness/worker-bridge');
  switch (harness) {
    case 'claude':
      return workerBridge.createClaudeCliRunner();
    case 'codex':
      return workerBridge.createCodexCliRunner();
    case 'opencode':
      return workerBridge.createOpenCodeCliRunner();
    default:
      throw new WorkforcePersonaWriterError(`Unsupported Workforce persona harness: ${harness}.`);
  }
}

function buildHarnessPrompt(
  selection: WorkforcePersonaSelection,
  task: string,
  install: Record<string, unknown> | undefined,
): string {
  const systemPrompt = selection.runtime.systemPrompt?.trim();
  const skills = selection.skills?.length ? safeJson(selection.skills) : '[]';
  const installPlan = install ? safeJson({
    command: readonlyStringArray(install.command),
    commandString: typeof install.commandString === 'string' ? install.commandString : undefined,
    cleanupCommand: readonlyStringArray(install.cleanupCommand),
    cleanupCommandString: typeof install.cleanupCommandString === 'string' ? install.cleanupCommandString : undefined,
  }) : '{}';
  return [
    systemPrompt ? `Persona system prompt:\n${systemPrompt}` : null,
    `Persona id: ${selection.personaId}`,
    `Persona tier: ${selection.tier}`,
    `Harness: ${selection.runtime.harness}`,
    `Model: ${selection.runtime.model}`,
    '',
    'Run mode: non-interactive one-shot. Return only the requested structured artifact response. Do not launch an interactive TUI.',
    '',
    'Persona skills:',
    skills,
    '',
    'Skill install plan metadata:',
    installPlan,
    '',
    task,
  ].filter((part): part is string => part !== null).join('\n');
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(text.trim()) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function safeJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function readonlyStringArray(value: unknown): readonly string[] | undefined {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string') ? value : undefined;
}

function fencedBlock(text: string, language: string): string | null {
  const pattern = new RegExp('```' + language + '\\s*\\n([\\s\\S]*?)\\n```', 'i');
  return pattern.exec(text)?.[1] ?? null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function workflowNameFromOutputPath(path: string): string {
  const file = path.split('/').pop() ?? 'generated-workflow.ts';
  return file.replace(/\.(workflow\.)?(ts|js|yaml|yml)$/i, '') || 'generated-workflow';
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
