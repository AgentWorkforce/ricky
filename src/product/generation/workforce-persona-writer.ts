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
  usePersona(intent: string, options?: { tier?: string; profileId?: string }): WorkforcePersonaContext;
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
  const moduleResult = await loadWorkforcePersonaModule();
  const warnings: string[] = [...moduleResult.warnings];

  for (const intent of intents) {
    try {
      const context = moduleResult.module.usePersona(intent, options.tier ? { tier: options.tier } : undefined);
      if (isUsablePersonaContext(context)) {
        return { source: moduleResult.source, intent, context, warnings };
      }
      warnings.push(`Workforce usePersona(${intent}) returned an unusable context.`);
    } catch (error) {
      warnings.push(`Workforce usePersona(${intent}) failed: ${errorMessage(error)}`);
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
    const packageName = '@agentworkforce/workload-router';
    const module = await import(packageName) as WorkforcePersonaModule;
    if (typeof module.usePersona === 'function') return { module, source: 'package', warnings };
    warnings.push('@agentworkforce/workload-router did not export usePersona().');
  } catch (error) {
    warnings.push(`Package Workforce router unavailable: ${errorMessage(error)}`);
  }

  for (const candidate of await localWorkforceModuleCandidates()) {
    try {
      await access(candidate);
      const module = await import(pathToFileURL(candidate).href) as WorkforcePersonaModule;
      if (typeof module.usePersona === 'function') {
        return { module, source: 'local-dev', warnings };
      }
      warnings.push(`Local Workforce router at ${candidate} did not export usePersona().`);
    } catch (error) {
      warnings.push(`Local Workforce router unavailable at ${candidate}: ${errorMessage(error)}`);
    }
  }

  throw new WorkforcePersonaWriterError(
    'Workforce workload-router is unavailable. Install @agentworkforce/workload-router or build ../workforce/packages/workload-router.',
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
      relevantFiles: input.relevantFiles,
    }, null, 2),
    '',
    'Agent Relay workflow standards:',
    '- Prefer TypeScript workflows using @agent-relay/sdk/workflows.',
    '- Use a dedicated workflow channel, not general.',
    '- Include explicit agents, step dependencies, deterministic gates, review stages, and final signoff.',
    '- Include an 80-to-100 fix loop: implement, validate, review, fix, final review, hard validation.',
    '- Verification must include typecheck/test commands when relevant plus git-diff evidence.',
    '- Run with an explicit cwd: .run({ cwd: process.cwd() }).',
    '',
    'Constraints:',
    '- Produce only the workflow artifact and metadata contract.',
    '- Do not commit, push, open PRs, or perform destructive file operations.',
    '- Do not open an interactive Claude, Codex, or OpenCode terminal UI.',
    '- Keep generated runtime-agent prompts model-agnostic.',
    '- Side effects must be explicit in the workflow and verified with evidence.',
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

async function localWorkforceModuleCandidates(): Promise<string[]> {
  const here = dirname(fileURLToPath(import.meta.url));
  const repoRoot = resolve(here, '../../../..');
  const siblingWorkforce = resolve(repoRoot, '../workforce/packages/workload-router');
  return [
    join(siblingWorkforce, 'dist/index.js'),
    join(siblingWorkforce, 'src/index.ts'),
  ];
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
