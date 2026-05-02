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
export const DEFAULT_WORKFORCE_PERSONA_TIER = 'best';

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
  sendMessage(task: string, options?: WorkforcePersonaSendOptions): WorkforcePersonaExecution;
}

export interface WorkforcePersonaModule {
  useRunnablePersona?: (intent: string, options?: WorkforceRunnablePersonaOptions) => WorkforcePersonaContext;
  useRunnableSelection?: (selection: unknown, options?: WorkforceRunnableSelectionOptions) => WorkforcePersonaContext;
}

export interface WorkforceSelectionModule {
  usePersona(intent: string, options?: WorkforceSelectionOptions): { selection: unknown };
}

export interface WorkforceSelectionOptions {
  tier?: string;
  profile?: unknown;
  profileId?: string;
  installRoot?: string;
}

export interface WorkforceRunnablePersonaOptions extends WorkforceSelectionOptions {
  harness?: string;
  commandOverrides?: Record<string, string>;
}

export interface WorkforceRunnableSelectionOptions {
  harness?: string;
  installRoot?: string;
  commandOverrides?: Record<string, string>;
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
  installRoot?: string;
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
  options: { tier?: string; installRoot?: string },
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
  const resolved = await resolver(
    options.personaIntentCandidates ?? WORKFORCE_PERSONA_INTENT_CANDIDATES,
    personaResolverOptions(options),
  );
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
  options: { tier?: string; installRoot?: string } = {},
): Promise<ResolvedWorkforcePersonaContext> {
  const moduleResult = await loadWorkforcePersonaModule();
  return resolveWorkforcePersonaContextWithModules(intents, options, moduleResult);
}

export async function resolveWorkforcePersonaContextWithModules(
  intents: readonly string[],
  options: { tier?: string; installRoot?: string },
  moduleResult: {
    module: WorkforcePersonaModule;
    source: 'package' | 'local-dev';
    warnings: string[];
  },
  loadSelectionModule: () => Promise<{
    module: WorkforceSelectionModule;
    source: 'package' | 'local-dev';
    warnings: string[];
  }> = loadWorkforceSelectionModule,
): Promise<ResolvedWorkforcePersonaContext> {
  const warnings: string[] = [...moduleResult.warnings];

  for (const intent of intents) {
    if (typeof moduleResult.module.useRunnableSelection === 'function') {
      const selectionModule = await loadSelectionModule();
      warnings.push(...selectionModule.warnings);
      try {
        const selected = selectionModule.module.usePersona(intent, selectionOptions({ tier: options.tier }));
        const context = moduleResult.module.useRunnableSelection(
          selected.selection,
          runnableSelectionOptions(options, selected.selection),
        );
        if (isUsablePersonaContext(context)) {
          return {
            source: moduleResult.source === 'local-dev' || selectionModule.source === 'local-dev'
              ? 'local-dev'
              : 'package',
            intent,
            context,
            warnings,
          };
        }
        warnings.push(`Workforce useRunnableSelection(${intent}) returned an unusable context.`);
      } catch (error) {
        warnings.push(`Workforce useRunnableSelection(${intent}) failed: ${errorMessage(error)}`);
      }
    }

    if (typeof moduleResult.module.useRunnablePersona === 'function') {
      try {
        const context = moduleResult.module.useRunnablePersona(
          intent,
          runnablePersonaOptions(options),
        );
        if (isUsablePersonaContext(context)) {
          return { source: moduleResult.source, intent, context, warnings };
        }
        warnings.push(`Workforce useRunnablePersona(${intent}) returned an unusable context.`);
      } catch (error) {
        const retry = retryWithoutInstallRoot(error, options);
        if (retry) {
          warnings.push(retry.warning);
          try {
            const context = moduleResult.module.useRunnablePersona?.(
              intent,
              runnablePersonaOptions({ tier: options.tier }),
            );
            if (isUsablePersonaContext(context)) {
              return { source: moduleResult.source, intent, context, warnings };
            }
            warnings.push(`Workforce useRunnablePersona(${intent}) without installRoot returned an unusable context.`);
          } catch (retryError) {
            warnings.push(`Workforce useRunnablePersona(${intent}) without installRoot failed: ${errorMessage(retryError)}`);
          }
        } else {
          warnings.push(`Workforce useRunnablePersona(${intent}) failed: ${errorMessage(error)}`);
        }
      }
    }

    try {
      const selectionModule = await loadSelectionModule();
      warnings.push(...selectionModule.warnings);
      const context = selectionModule.module.usePersona(intent, selectionOptions({ tier: options.tier }));
      if (isRecord(context) && isRecord(context.selection)) {
        warnings.push(`Workforce usePersona(${intent}) resolved metadata but did not provide a runnable sendMessage API.`);
        continue;
      }
      warnings.push(`Workforce usePersona(${intent}) returned unusable selection metadata.`);
    } catch (error) {
      warnings.push(`Workforce selection metadata for ${intent} failed: ${errorMessage(error)}`);
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
  const warnings: string[] = [];
  try {
    const packageName = '@agentworkforce/harness-kit';
    const module = await import(packageName) as WorkforcePersonaModule;
    if (isRunnablePersonaModule(module)) return { module, source: 'package', warnings };
    warnings.push('@agentworkforce/harness-kit did not export useRunnablePersona() or useRunnableSelection().');
  } catch (error) {
    warnings.push(`Package Workforce harness-kit unavailable: ${errorMessage(error)}`);
  }

  for (const candidate of await localWorkforceHarnessKitModuleCandidates()) {
    try {
      await access(candidate);
      const module = await import(pathToFileURL(candidate).href) as WorkforcePersonaModule;
      if (isRunnablePersonaModule(module)) {
        return { module, source: 'local-dev', warnings };
      }
      warnings.push(`Local Workforce harness-kit at ${candidate} did not export runnable persona APIs.`);
    } catch (error) {
      warnings.push(`Local Workforce harness-kit unavailable at ${candidate}: ${errorMessage(error)}`);
    }
  }

  throw new WorkforcePersonaWriterError(
    [
      '@agentworkforce/harness-kit is bundled as a Ricky dependency but could not be loaded.',
      'Try reinstalling @agentworkforce/ricky (`npm install` in this project).',
      'If you develop Ricky locally with a sibling ../workforce clone, publish or link that harness-kit.',
    ].join(' '),
    warnings,
  );
}

export async function loadWorkforceSelectionModule(): Promise<{
  module: WorkforceSelectionModule;
  source: 'package' | 'local-dev';
  warnings: string[];
}> {
  const warnings: string[] = [];
  try {
    const packageName = '@agentworkforce/workload-router';
    const module = await import(packageName) as WorkforceSelectionModule;
    if (typeof module.usePersona === 'function') return { module, source: 'package', warnings };
    warnings.push('@agentworkforce/workload-router did not export usePersona().');
  } catch (error) {
    warnings.push(`Package Workforce router unavailable: ${errorMessage(error)}`);
  }

  for (const candidate of await localWorkforceRouterModuleCandidates()) {
    try {
      await access(candidate);
      const module = await import(pathToFileURL(candidate).href) as WorkforceSelectionModule;
      if (typeof module.usePersona === 'function') {
        return { module, source: 'local-dev', warnings };
      }
      warnings.push(`Local Workforce router at ${candidate} did not export usePersona().`);
    } catch (error) {
      warnings.push(`Local Workforce router unavailable at ${candidate}: ${errorMessage(error)}`);
    }
  }

  throw new WorkforcePersonaWriterError(
    [
      '@agentworkforce/workload-router is bundled as a Ricky dependency but could not be loaded.',
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

async function localWorkforceHarnessKitModuleCandidates(): Promise<string[]> {
  const here = dirname(fileURLToPath(import.meta.url));
  const repoRoot = resolve(here, '../../..');
  const siblingWorkforce = resolve(repoRoot, '../workforce/packages/harness-kit');
  return [
    join(siblingWorkforce, 'dist/index.js'),
    join(siblingWorkforce, 'src/index.ts'),
  ];
}

async function localWorkforceRouterModuleCandidates(): Promise<string[]> {
  const here = dirname(fileURLToPath(import.meta.url));
  const repoRoot = resolve(here, '../../..');
  const siblingWorkforce = resolve(repoRoot, '../workforce/packages/workload-router');
  return [
    join(siblingWorkforce, 'dist/index.js'),
    join(siblingWorkforce, 'src/index.ts'),
  ];
}

function isRunnablePersonaModule(value: WorkforcePersonaModule): boolean {
  return (
    typeof value.useRunnablePersona === 'function' ||
    typeof value.useRunnableSelection === 'function'
  );
}

function runnablePersonaOptions(
  options: { tier?: string; installRoot?: string },
): WorkforceRunnablePersonaOptions | undefined {
  const resolved: WorkforceRunnablePersonaOptions = {};
  if (options.tier) resolved.tier = options.tier;
  if (options.installRoot) resolved.installRoot = options.installRoot;
  return Object.keys(resolved).length > 0 ? resolved : undefined;
}

function runnableSelectionOptions(
  options: { installRoot?: string },
  selection: unknown,
): WorkforceRunnableSelectionOptions | undefined {
  return options.installRoot && selectionHarness(selection) === 'claude'
    ? { installRoot: options.installRoot }
    : undefined;
}

function selectionOptions(
  options: { tier?: string; installRoot?: string },
): WorkforceSelectionOptions | undefined {
  const resolved: WorkforceSelectionOptions = {};
  if (options.tier) resolved.tier = options.tier;
  if (options.installRoot) resolved.installRoot = options.installRoot;
  return Object.keys(resolved).length > 0 ? resolved : undefined;
}

function personaResolverOptions(options: { tier?: string; installRoot?: string }): { tier?: string; installRoot?: string } {
  const resolved: { tier?: string; installRoot?: string } = { tier: options.tier ?? DEFAULT_WORKFORCE_PERSONA_TIER };
  if (options.installRoot) resolved.installRoot = options.installRoot;
  return resolved;
}

function retryWithoutInstallRoot(
  error: unknown,
  options: { installRoot?: string },
): { warning: string } | null {
  if (!options.installRoot) return null;
  if (!/installRoot is only supported for the claude harness/i.test(errorMessage(error))) return null;
  return {
    warning: 'Workforce persona selected a non-claude harness; retrying runnable context without installRoot.',
  };
}

function selectionHarness(selection: unknown): string | undefined {
  if (!isRecord(selection)) return undefined;
  const runtime = selection.runtime;
  if (!isRecord(runtime)) return undefined;
  return typeof runtime.harness === 'string' ? runtime.harness : undefined;
}

function isUsablePersonaContext(value: unknown): value is WorkforcePersonaContext {
  return (
    isRecord(value) &&
    isRecord(value.selection) &&
    typeof value.selection.personaId === 'string' &&
    typeof value.selection.tier === 'string' &&
    isRecord(value.selection.runtime) &&
    typeof value.selection.runtime.harness === 'string' &&
    typeof value.selection.runtime.model === 'string' &&
    typeof value.sendMessage === 'function'
  );
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(text.trim()) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
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

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch (error) {
    return JSON.stringify({ error: errorMessage(error) }, null, 2);
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
