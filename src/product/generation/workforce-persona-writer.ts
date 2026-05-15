import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';

import type { ClarificationQuestion, ClarificationRequest, NormalizedWorkflowSpec } from '../spec-intake/types.js';
import type { RenderedArtifact, SkillContext, WorkflowExecutionTarget } from './types.js';

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
  sendMessage(task: string, options?: WorkforcePersonaSendOptions): WorkforcePersonaExecution;
}

export interface WorkforcePersonaModule {
  useRunnablePersona?: (intent: string, options?: WorkforceRunnablePersonaOptions) => WorkforcePersonaContext;
  useRunnableSelection?: (selection: unknown, options?: WorkforceRunnableSelectionOptions) => WorkforcePersonaContext;
}

export interface WorkforceSelectionModule {
  usePersona(intent: string, options?: WorkforceSelectionOptions): unknown;
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
  mode?: 'one-shot';
  responseFormat?: 'structured-json-or-fenced-artifact';
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
  /** Absolute path to the source spec file when known. The writer task references it so the persona can Read the spec instead of receiving it inline. */
  specPath?: string;
  env?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
  onProgress?: (chunk: { stream: 'stdout' | 'stderr'; text: string }) => void;
  personaIntentCandidates?: readonly string[];
  resolver?: WorkforcePersonaResolver;
  skillContext?: SkillContext;
  validationFeedback?: WorkforcePersonaValidationFeedback;
}

export interface WorkforcePersonaValidationFeedback {
  errors: string[];
  previousContent: string;
  previousAttempts?: WorkforcePersonaPrewriteRepairAttempt[];
}

export interface WorkforcePersonaPrewriteRepairAttempt {
  attempt: number;
  requestedFixes: string[];
  returnedErrors: string[];
}

export interface WorkforcePersonaWriterMetadata {
  personaId: string;
  tier: string;
  harness: string;
  model: string;
  promptDigest: string;
  warnings: string[];
  runId: string | null;
  source: 'package';
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

export interface PersonaResponseParseOptions {
  repoRoot?: string;
  readFileText?: (path: string) => string;
  /**
   * Optional `Date.now()`-style ms timestamp captured *before* the writer
   * subprocess was spawned. When set, the parser's "stdout was truncated
   * but a file exists on disk at expectedPath" fallback only fires for a
   * file whose mtime is newer than this — i.e. one this writer call
   * produced — so the parser cannot accidentally accept a stale leftover
   * artifact from a prior attempt as the current writer's output.
   *
   * Without this timestamp the parser treats the file as untrusted and
   * skips the disk fallback (preserving prior behavior).
   */
  writerInvokedAtMs?: number;
  /**
   * Optional stat-by-path used by the disk fallback. Defaults to
   * `fs.statSync(path)` swallowing ENOENT to `undefined`. Override for
   * deterministic tests of the freshness check without touching the real
   * filesystem.
   */
  statFile?: (path: string) => { mtimeMs: number } | undefined;
}

export interface ResolvedWorkforcePersonaContext {
  source: 'package';
  intent: string;
  context: WorkforcePersonaContext;
  warnings: string[];
}

export type WorkforcePersonaResolver = (
  intents: readonly string[],
  options: { tier?: string; installRoot?: string },
) => Promise<ResolvedWorkforcePersonaContext>;

type WorkforcePackageImporter = (packageName: string) => Promise<object>;

export class WorkforcePersonaWriterError extends Error {
  readonly warnings: string[];

  constructor(message: string, warnings: string[] = []) {
    super(message);
    this.name = 'WorkforcePersonaWriterError';
    this.warnings = warnings;
  }
}

export class WorkforcePersonaClarificationError extends WorkforcePersonaWriterError {
  readonly questions: ClarificationQuestion[];

  constructor(questions: ClarificationQuestion[], warnings: string[] = []) {
    super(
      `Workforce persona needs clarification before workflow generation: ${questions.map((question) => question.question).join(' | ')}`,
      warnings,
    );
    this.name = 'WorkforcePersonaClarificationError';
    this.questions = questions;
  }
}

interface ParsedPersonaResponse {
  content?: string;
  metadata: Record<string, unknown>;
  responseFormat: WorkforcePersonaWriterMetadata['responseFormat'] | 'needs-clarification';
  clarification?: ClarificationRequest;
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
    skillContext: options.skillContext,
    validationFeedback: options.validationFeedback,
    ...(options.specPath ? { specPath: options.specPath } : {}),
  });
  const promptDigest = digest(task);
  const selection = resolved.context.selection;
  // Pin "writer invoked at" immediately before the spawn so the parser's
  // disk fallback can prove a file at outputPath was actually written by
  // THIS sendMessage window (mtime > this timestamp) rather than left
  // over from a prior attempt. Capturing earlier — e.g. before the
  // resolver and task-builder awaits — opens a multi-second window in
  // which a stale leftover could falsely satisfy the freshness check.
  const writerInvokedAtMs = Date.now();
  // Normalize the timeout once before threading it into both
  // `sendMessage` (harness-kit subprocess timeout) and the outer watchdog
  // so they're guaranteed to run on the same schedule. If the configured
  // value is missing, zero, or negative, harness-kit otherwise disables
  // its internal timeout entirely (see harness-kit/dist/runner.js:
  // `options.timeoutSeconds && options.timeoutSeconds > 0 ? setTimeout(...) : undefined`)
  // — and a watchdog firing on a fallback window while the subprocess has
  // no inner timeout at all is exactly the divergence coderabbit flagged.
  const configuredTimeoutSeconds = options.timeoutSeconds ?? selection.runtime.harnessSettings?.timeoutSeconds;
  const effectiveTimeoutSeconds = typeof configuredTimeoutSeconds === 'number' && configuredTimeoutSeconds > 0
    ? configuredTimeoutSeconds
    : WRITER_DEFAULT_WATCHDOG_SECONDS;
  const run = resolved.context.sendMessage(task, {
    workingDirectory: options.repoRoot,
    name: `ricky-workflow-writer-${promptDigest.slice(0, 12)}`,
    timeoutSeconds: effectiveTimeoutSeconds,
    installSkills: options.installSkills,
    mode: 'one-shot',
    responseFormat: 'structured-json-or-fenced-artifact',
    env: mergedPersonaEnv(selection.env, options.env),
    signal: options.signal,
    onProgress: options.onProgress,
    inputs: {
      outputPath: options.outputPath,
      workflowName,
      targetMode: options.targetMode,
      promptDigest,
      mode: 'one-shot',
    },
  });

  // Defense-in-depth watchdog around the harness-kit await. Observed in
  // production (2026-05-15): claude subprocess exited cleanly after the
  // harness-kit timeoutSeconds expired and SIGTERM/SIGKILL fired, but the
  // subprocess's stdio pipe stayed half-open with buffered bytes, and the
  // harness-kit `finish()` resolution never landed on its `exit` handler.
  // Ricky's `await Promise.all([run, run.runId])` then hung indefinitely
  // (60+ minutes with 0% CPU, FD 4/5 = PIPE waiting on a dead writer).
  // The watchdog forces a settle at `timeoutSeconds + grace`, calling
  // `run.cancel()` to release any subprocess handles the runner still owns
  // and throwing a WorkforcePersonaWriterError so the caller can move on
  // instead of blocking the master script forever.
  const [result, runId] = await waitForWriterWithWatchdog(run, effectiveTimeoutSeconds, resolved.warnings);
  const dumpDebug = (reason: 'noncompletion' | 'parse-error' | 'no-content' | 'success') =>
    dumpPersonaDebug({
      kind: 'writer',
      reason,
      repoRoot: options.repoRoot,
      promptDigest,
      task,
      result,
      selection,
      resolved,
      outputPath: options.outputPath,
    });

  if (result.status !== 'completed') {
    await dumpDebug('noncompletion');
    throw new WorkforcePersonaWriterError(
      `Workforce persona writer did not complete: ${result.status}.`,
      [...resolved.warnings, result.stderr].filter(Boolean),
    );
  }

  let parsed: ParsedPersonaResponse;
  try {
    parsed = parsePersonaWorkflowResponse(result.output, options.outputPath, {
      repoRoot: options.repoRoot,
      writerInvokedAtMs: writerInvokedAtMs,
    });
  } catch (error) {
    await dumpDebug('parse-error');
    throw error;
  }
  if (parsed.clarification) {
    throw new WorkforcePersonaClarificationError(parsed.clarification.questions, resolved.warnings);
  }
  if (!parsed.content) {
    await dumpDebug('no-content');
    throw new WorkforcePersonaWriterError('Workforce persona response did not include workflow artifact content.');
  }
  await dumpDebug('success');
  const responseFormat = parsed.responseFormat as WorkforcePersonaWriterMetadata['responseFormat'];
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
      responseFormat,
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
  let moduleResult: {
    module: WorkforcePersonaModule;
    source: 'package';
    warnings: string[];
  };
  try {
    moduleResult = await loadWorkforcePersonaModule();
  } catch (error) {
    const writerError = error instanceof WorkforcePersonaWriterError ? error : null;
    moduleResult = {
      module: {},
      source: 'package',
      warnings: [
        ...(writerError?.warnings ?? []),
        `Workforce harness-kit unavailable; trying usePersona(...).sendMessage() seam: ${errorMessage(error)}`,
      ],
    };
  }
  return resolveWorkforcePersonaContextWithModules(intents, options, moduleResult);
}

export async function resolveWorkforcePersonaContextWithModules(
  intents: readonly string[],
  options: { tier?: string; installRoot?: string },
  moduleResult: {
    module: WorkforcePersonaModule;
    source: 'package';
    warnings: string[];
  },
  loadSelectionModule: () => Promise<{
    module: WorkforceSelectionModule;
    source: 'package';
    warnings: string[];
  }> = loadWorkforceSelectionModule,
): Promise<ResolvedWorkforcePersonaContext> {
  const warnings: string[] = [...moduleResult.warnings];

  for (const intent of intents) {
    if (typeof moduleResult.module.useRunnableSelection === 'function') {
      const selectionModule = await loadSelectionModule();
      warnings.push(...selectionModule.warnings);
      try {
        const selected = selectionModule.module.usePersona(intent, metadataSelectionOptions(options));
        if (isUsablePersonaContext(selected)) {
          return {
            source: 'package',
            intent,
            context: selected,
            warnings,
          };
        }
        const selectedSelection = selectionFromPersonaResult(selected);
        const context = moduleResult.module.useRunnableSelection(
          selectedSelection,
          runnableSelectionOptions(options, selectedSelection),
        );
        if (isUsablePersonaContext(context)) {
          return {
            source: 'package',
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
      const context = selectionModule.module.usePersona(intent, runnableSelectionFallbackOptions(options));
      if (isUsablePersonaContext(context)) {
        return {
          source: selectionModule.source,
          intent,
          context,
          warnings,
        };
      }
      if (selectionFromPersonaResult(context)) {
        warnings.push(`Workforce usePersona(${intent}) resolved metadata but did not provide a runnable sendMessage API.`);
        continue;
      }
      warnings.push(`Workforce usePersona(${intent}) returned unusable selection metadata.`);
    } catch (error) {
      const retry = retryWithoutInstallRoot(error, options);
      if (retry) {
        warnings.push(retry.warning);
        try {
          const selectionModule = await loadSelectionModule();
          warnings.push(...selectionModule.warnings);
          const context = selectionModule.module.usePersona(intent, metadataSelectionOptions(options));
          if (isUsablePersonaContext(context)) {
            return {
              source: selectionModule.source,
              intent,
              context,
              warnings,
            };
          }
          if (selectionFromPersonaResult(context)) {
            warnings.push(`Workforce usePersona(${intent}) without installRoot resolved metadata but did not provide a runnable sendMessage API.`);
            continue;
          }
          warnings.push(`Workforce usePersona(${intent}) without installRoot returned unusable selection metadata.`);
        } catch (retryError) {
          warnings.push(`Workforce usePersona(${intent}) without installRoot failed: ${errorMessage(retryError)}`);
        }
      } else {
        warnings.push(`Workforce selection metadata for ${intent} failed: ${errorMessage(error)}`);
      }
    }
  }

  throw new WorkforcePersonaWriterError(
    `No Workforce persona could be resolved for workflow authoring intents: ${intents.join(', ')}.`,
    warnings,
  );
}

export async function loadWorkforcePersonaModule(importPackage: WorkforcePackageImporter = importWorkforcePackage): Promise<{
  module: WorkforcePersonaModule;
  source: 'package';
  warnings: string[];
}> {
  const warnings: string[] = [];
  let importFailure: string | undefined;
  try {
    const packageName = '@agentworkforce/harness-kit';
    const module = await importPackage(packageName) as WorkforcePersonaModule;
    if (isRunnablePersonaModule(module)) return { module, source: 'package', warnings };
    warnings.push(`@agentworkforce/harness-kit did not export useRunnablePersona() or useRunnableSelection(); exports: ${moduleExports(module)}.`);
  } catch (error) {
    importFailure = errorMessage(error);
    warnings.push(`Package Workforce harness-kit unavailable: ${importFailure}`);
  }

  throw new WorkforcePersonaWriterError(
    workforcePersonaModuleLoadError(importFailure),
    warnings,
  );
}

export async function loadWorkforceSelectionModule(importPackage: WorkforcePackageImporter = importWorkforcePackage): Promise<{
  module: WorkforceSelectionModule;
  source: 'package';
  warnings: string[];
}> {
  const warnings: string[] = [];
  let importFailure: string | undefined;
  try {
    const packageName = '@agentworkforce/workload-router';
    const module = await importPackage(packageName) as WorkforceSelectionModule;
    if (typeof module.usePersona === 'function') return { module, source: 'package', warnings };
    warnings.push(`@agentworkforce/workload-router did not export usePersona(); exports: ${moduleExports(module)}.`);
  } catch (error) {
    importFailure = errorMessage(error);
    warnings.push(`Package Workforce router unavailable: ${importFailure}`);
  }

  throw new WorkforcePersonaWriterError(
    workforceSelectionModuleLoadError(importFailure),
    warnings,
  );
}

/**
 * Soft caps for the persona writer task body. The total task size is the
 * sum of these caps plus the boilerplate prose; under default values the
 * task body is well under 200 KB even for the largest specs we have seen
 * (1.5 MB raw payload, 81 relevant files, ~600 KB validation feedback).
 *
 * The hard cap on description (`MAX_DESCRIPTION_BYTES`) is the one that
 * matters most because the raw spec text is the dominant cost for natural-
 * language specs; everything else is bounded by per-item caps.
 */
const MAX_DESCRIPTION_BYTES = 32 * 1024;
const MAX_TARGET_CONTEXT_BYTES = 8 * 1024;
const MAX_RELEVANT_FILE_BYTES = 8 * 1024;
const MAX_RELEVANT_FILES_TOTAL_BYTES = 96 * 1024;
const MAX_VALIDATION_FEEDBACK_PREVIOUS_BYTES = 16 * 1024;
const MAX_POLICY_FILE_BYTES = 24 * 1024;

const RICKY_WORKFLOW_POLICY_FILES = [
  'docs/workflows/WORKFLOW_STANDARDS.md',
  'workflows/shared/WORKFLOW_AUTHORING_RULES.md',
  'workflows/meta/spec/generated-workflow-template.md',
] as const;

export function buildWorkflowPersonaTask(
  spec: NormalizedWorkflowSpec,
  input: {
    workflowName: string;
    targetMode: WorkflowExecutionTarget;
    repoRoot: string;
    outputPath: string;
    relevantFiles: Array<{ path: string; content?: string }>;
    skillContext?: SkillContext;
    validationFeedback?: WorkforcePersonaValidationFeedback;
    specPath?: string;
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
        needs_clarification: {
          status: 'needs_clarification',
          reason: 'Why the workflow cannot be authored safely from the current spec.',
          questions: 'Array of { id, question, reason, blocking, defaultAssumption? } items for Ricky to ask the user.',
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

  const summarizedSpec = summarizeSpecForPersona(spec);
  const summarizedRelevantFiles = summarizeRelevantFilesForPersona(input.relevantFiles);
  const rickyPolicyContext = renderRickyWorkflowPolicyContext(input.repoRoot);

  const specReference =
    input.specPath && summarizedSpec.descriptionTruncated
      ? [
          `Spec source file (read it directly when you need more detail than the summary below): ${input.specPath}`,
          `The summarized spec below truncates description and target context for prompt size. Read the spec file for full content.`,
          '',
        ]
      : input.specPath
        ? [`Spec source file (full content is also included below): ${input.specPath}`, '']
        : [];

  return [
    'Write an Agent Relay workflow artifact for Ricky.',
    'Run as a non-interactive one-shot persona invocation. Return only the response contract.',
    'If the normalized spec has blocking ambiguity or open questions, return needs_clarification with targeted user-facing questions instead of guessing.',
    '',
    ...specReference,
    'Normalized spec JSON (description/targetContext truncated when oversized; raw spec payload elided):',
    JSON.stringify(summarizedSpec.spec, null, 2),
    '',
    `Workflow name: ${input.workflowName}`,
    `Target mode: ${input.targetMode}`,
    `Repo root: ${input.repoRoot}`,
    `Output path: ${input.outputPath}`,
    '',
    'Workflow generation inputs:',
    JSON.stringify({
      workflowName: input.workflowName,
      targetMode: input.targetMode,
      repoRoot: input.repoRoot,
      outputPath: input.outputPath,
      ...(input.specPath ? { specPath: input.specPath } : {}),
    }, null, 2),
    '',
    `Relevant file context (${summarizedRelevantFiles.includedCount} of ${input.relevantFiles.length} files; per-file content truncated above ${MAX_RELEVANT_FILE_BYTES} bytes):`,
    safeJson(summarizedRelevantFiles.files),
    '',
    'Ricky repo-local workflow policy context:',
    rickyPolicyContext,
    '',
    'Matched Ricky generation skills:',
    renderSkillContextForPersona(input.skillContext),
    '',
    ...renderValidationFeedbackForPersona(input.validationFeedback),
    'Agent Relay workflow standards:',
    '- Prefer TypeScript workflows using @agent-relay/sdk/workflows.',
    '- Choose `.pattern(...)` from the normalized spec and matched skill context: pipeline for linear stages, supervisor for coordinated review/hand-off, or dag for parallel branches and gated fan-out. When `choosing-swarm-patterns` is matched, use its decision framework before authoring tasks.',
    '- Use a dedicated workflow channel, not general.',
    '- Include explicit agents, step dependencies, deterministic gates, review stages, and final signoff.',
    '- Include an 80-to-100 fix loop: implement, validate, review, fix, final review, hard validation.',
    '- Include a real deterministic sanity gate over produced files using POSIX grep, git grep, or an equivalent inline assertion that exits non-zero when expected content/state is missing.',
    '- If using rg, guard it with command -v rg and provide a grep or git grep fallback because ripgrep is not guaranteed to be installed.',
    '- Keep agent steps bounded: split broad implementation or test-writing work into multiple sequential/fan-out steps with deterministic gates between them instead of one large step that can exhaust retries by timeout.',
    '- Before calling `.run(...)`, load repo-local `.env.local` and `.env` values into `process.env` without overwriting existing shell exports, so local BYOH runs inherit common project configuration. If the workflow requires named env vars, add a fast deterministic preflight/assertion that prints `MISSING_ENV_VAR: NAME` before long-running agent steps.',
    '- Verification must include typecheck/test commands when relevant plus git-diff evidence; diff/manifest gates must combine git diff --name-only with git ls-files --others --exclude-standard so newly-created files are visible.',
    '- Run with an explicit cwd: .run({ cwd: process.cwd() }).',
    '- Preserve Agent Relay workflow authoring rules: deterministic gates are evidence, agents do production work, and every generated workflow must be locally dry-runnable.',
    '- Include the literal marker IMPLEMENTATION_WORKFLOW_CONTRACT in implementation workflows.',
    '- When the normalized spec asks to implement product/backend/webapp/runtime behavior, the workflow must edit source files, add or update tests, require a non-empty diff outside transient artifact directories, and report a PR URL or explicit result status.',
    '- Do not satisfy implementation specs by only writing plan.md, mapping.json, output-manifest.txt, or other planning artifacts.',
    '',
    'Constraints:',
    '- Produce only the workflow artifact and metadata contract.',
    '- Do not create, edit, or write outputPath directly; Ricky writes the returned artifact after parsing artifact.content.',
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

function renderRickyWorkflowPolicyContext(repoRoot: string): string {
  return RICKY_WORKFLOW_POLICY_FILES.map((path) => {
    const absolute = resolve(repoRoot, path);
    const content = safeReadPolicyFile(absolute);
    return content
      ? `# ${path}\n${content}`
      : `# ${path}\nMISSING: Ricky workflow policy file was not found at ${absolute}.`;
  }).join('\n\n');
}

function safeReadPolicyFile(path: string): string | null {
  try {
    return truncateText(readFileSync(path, 'utf8'), MAX_POLICY_FILE_BYTES).text;
  } catch {
    return null;
  }
}

function renderValidationFeedbackForPersona(
  feedback: WorkforcePersonaValidationFeedback | undefined,
): string[] {
  if (!feedback) return [];
  const trimmedPreviousContent = truncateText(
    feedback.previousContent,
    MAX_VALIDATION_FEEDBACK_PREVIOUS_BYTES,
  );
  return [
    'Ricky pre-write validation failed on your previous artifact.',
    'Fix every validation issue before returning the complete replacement artifact.',
    '',
    'Validation errors:',
    safeJson(feedback.errors),
    '',
    ...(feedback.previousAttempts && feedback.previousAttempts.length > 0
      ? [
          'Previous pre-write repair attempts that still failed:',
          safeJson(feedback.previousAttempts),
          '',
          'Use those failed repair attempts as negative evidence. Do not repeat the same fix unless the current validation errors prove it was incomplete.',
          '',
        ]
      : []),
    'Previous rejected artifact (truncated when oversized):',
    '```ts',
    trimmedPreviousContent.text.trimEnd(),
    '```',
    '',
  ];
}

interface SummarizedSpec {
  spec: NormalizedWorkflowSpec;
  descriptionTruncated: boolean;
}

/**
 * Produces a writer-task-ready clone of the normalized spec with the
 * raw spec payload elided (it duplicates `description`) and `description`
 * + `targetContext` truncated when oversized. Keeps every structured
 * field intact — target files, constraints, evidence requirements, and
 * acceptance gates are short and are what the persona actually needs to
 * decompose the workflow.
 */
export function summarizeSpecForPersona(spec: NormalizedWorkflowSpec): SummarizedSpec {
  const description = truncateText(spec.description, MAX_DESCRIPTION_BYTES);
  const targetContext =
    typeof spec.targetContext === 'string'
      ? truncateText(spec.targetContext, MAX_TARGET_CONTEXT_BYTES)
      : null;

  const elidedSourceSpec = {
    ...spec.sourceSpec,
    description: '<<elided: see top-level description field>>',
    rawPayload: elideRawPayload(spec.sourceSpec.rawPayload),
  };

  // `desiredAction.summary` and `desiredAction.specText` typically duplicate
  // the top-level description (see request-normalizer.ts); when the user
  // passes `--spec-file <large.md>` they grow to the same multi-hundred-KB
  // size as the spec text. `summary` keeps a short cap because the persona
  // task lists it separately; `specText` is elided entirely because every
  // byte of it duplicates `description` for natural-language specs.
  const SUMMARY_CAP_BYTES = 4 * 1024;
  const desiredActionSummary = truncateText(spec.desiredAction.summary, SUMMARY_CAP_BYTES);
  const desiredActionSpecTextElided = typeof spec.desiredAction.specText === 'string';

  const summarized: NormalizedWorkflowSpec = {
    ...spec,
    description: description.text,
    targetContext: targetContext ? targetContext.text : spec.targetContext,
    desiredAction: {
      ...spec.desiredAction,
      summary: desiredActionSummary.text,
      ...(desiredActionSpecTextElided
        ? { specText: '<<elided: duplicates description>>' }
        : {}),
    },
    sourceSpec: elidedSourceSpec,
  };

  return {
    spec: summarized,
    descriptionTruncated:
      description.truncated ||
      (targetContext?.truncated ?? false) ||
      desiredActionSummary.truncated,
  };
}

type RawSpecPayload = NormalizedWorkflowSpec['sourceSpec']['rawPayload'];

function elideRawPayload(rawPayload: RawSpecPayload): RawSpecPayload {
  // The raw payload duplicates the spec description on every natural-language
  // input and adds nothing the persona can act on that the normalized spec
  // does not already carry; replace its long fields with elision markers so
  // the kind/surface/requestId metadata stays readable.
  switch (rawPayload.kind) {
    case 'natural_language':
      return {
        ...rawPayload,
        text: rawPayloadElisionMarker(rawPayload.text),
      };
    case 'structured_json':
      return {
        ...rawPayload,
        data: { '<<elided>>': 'see normalized spec fields' },
      };
    case 'mcp':
      return {
        ...rawPayload,
        arguments: { '<<elided>>': 'see normalized spec fields' },
      };
    default:
      return rawPayload;
  }
}

function rawPayloadElisionMarker(text: string): string {
  const size = Buffer.byteLength(text, 'utf8');
  return `<<elided ${size} bytes of raw spec text — see top-level description and structured spec fields>>`;
}

interface SummarizedRelevantFiles {
  files: Array<{ path: string; content: string | null; bytesOmitted?: number; omitted?: true }>;
  includedCount: number;
}

/**
 * Caps the total byte budget of inlined relevant-file contents. Files past
 * the budget are listed as path-only entries so the persona still sees the
 * full list, and any individual file body is truncated at
 * `MAX_RELEVANT_FILE_BYTES`.
 */
export function summarizeRelevantFilesForPersona(
  relevantFiles: Array<{ path: string; content?: string }>,
): SummarizedRelevantFiles {
  let totalBytes = 0;
  let includedCount = 0;
  const files: SummarizedRelevantFiles['files'] = [];
  for (const file of relevantFiles) {
    if (!file.content) {
      files.push({ path: file.path, content: null });
      continue;
    }
    if (totalBytes >= MAX_RELEVANT_FILES_TOTAL_BYTES) {
      files.push({ path: file.path, content: null, omitted: true });
      continue;
    }
    const remaining = MAX_RELEVANT_FILES_TOTAL_BYTES - totalBytes;
    const perFileBudget = Math.min(MAX_RELEVANT_FILE_BYTES, remaining);
    const trimmed = truncateText(file.content, perFileBudget);
    totalBytes += Buffer.byteLength(trimmed.text, 'utf8');
    includedCount += 1;
    files.push({
      path: file.path,
      content: trimmed.text,
      ...(trimmed.truncated ? { bytesOmitted: trimmed.bytesOmitted } : {}),
    });
  }
  return { files, includedCount };
}

interface TruncationResult {
  text: string;
  truncated: boolean;
  bytesOmitted: number;
}

function truncateText(value: string, maxBytes: number): TruncationResult {
  const buffer = Buffer.from(value, 'utf8');
  if (buffer.byteLength <= maxBytes) {
    return { text: value, truncated: false, bytesOmitted: 0 };
  }
  const omitted = buffer.byteLength - maxBytes;
  // Slice on a code-point boundary by re-decoding the trimmed buffer.
  const headBytes = Math.floor(maxBytes * 0.75);
  const tailBytes = maxBytes - headBytes;
  const head = buffer.subarray(0, headBytes).toString('utf8');
  const tail = buffer.subarray(buffer.byteLength - tailBytes).toString('utf8');
  return {
    text: `${head}\n\n<<truncated ${omitted} bytes>>\n\n${tail}`,
    truncated: true,
    bytesOmitted: omitted,
  };
}

function renderSkillContextForPersona(skillContext: SkillContext | undefined): string {
  if (!skillContext || skillContext.matches.length === 0) return 'No Ricky generation skills were matched.';

  const summaries = skillContext.matches.map((match) => ({
    id: match.id,
    confidence: match.confidence,
    reason: match.reason,
    evidence: match.evidence.map((item) => `${item.source}:${item.trigger}`),
  }));
  const choosingSwarm = skillContext.matches.find((match) => match.id === 'choosing-swarm-patterns');
  const choosingSwarmContent = choosingSwarm?.path ? safeReadSkillText(choosingSwarm.path) : null;

  return [
    safeJson({
      loadedSkills: skillContext.applicableSkillNames,
      matches: summaries,
    }),
    choosingSwarmContent
      ? [
          '',
          '# choosing-swarm-patterns',
          'Use this generation-time skill context to choose the workflow shape before writing steps:',
          choosingSwarmContent,
        ].join('\n')
      : '',
  ].filter(Boolean).join('\n');
}

export function parsePersonaWorkflowResponse(
  output: string,
  expectedPath: string,
  options: PersonaResponseParseOptions = {},
): ParsedPersonaResponse {
  const directJson = parseJsonObject(output);
  if (directJson) {
    const clarification = parseClarificationResponse(directJson);
    if (clarification) return { metadata: {}, responseFormat: 'needs-clarification', clarification };
    return validateStructuredResponse(directJson, expectedPath, 'structured-json', options);
  }

  const jsonFence = fencedBlock(output, 'json');
  if (jsonFence) {
    const metadataJson = parseJsonObject(jsonFence);
    const tsFence = fencedBlock(output, 'ts') ?? fencedBlock(output, 'typescript');
    const clarification = metadataJson ? parseClarificationResponse(metadataJson) : null;
    if (clarification) return { metadata: {}, responseFormat: 'needs-clarification', clarification };
    if (metadataJson && tsFence) {
      return validateFencedResponse(tsFence, metadataJson, expectedPath);
    }
    if (metadataJson) {
      return validateStructuredResponse(metadataJson, expectedPath, 'structured-json', options);
    }
  }

  const tsFence = fencedBlock(output, 'ts') ?? fencedBlock(output, 'typescript');
  const metadataFence = fencedBlock(output, 'metadata');
  const metadata = metadataFence ? parseJsonObject(metadataFence) : null;
  if (tsFence && metadata) {
    return validateFencedResponse(tsFence, metadata, expectedPath);
  }

  // Tolerant fallback: Claude Sonnet has been observed to emit a prose
  // preamble plus a ```json opening fence without a matching closing fence,
  // which defeats both the direct-JSON and fenced-block matchers above. As
  // a last resort, walk the response looking for the first balanced JSON
  // object and treat that as the structured response. Picks up:
  //   - "preamble text\n```json\n{ ... }"   (unclosed fence)
  //   - "preamble text\n{ ... }"            (no fence at all)
  //   - "{ ... }\ntrailing prose"           (trailing prose after JSON)
  const embedded = extractFirstBalancedJsonObject(output);
  if (embedded) {
    const clarification = parseClarificationResponse(embedded);
    if (clarification) return { metadata: {}, responseFormat: 'needs-clarification', clarification };
    return validateStructuredResponse(embedded, expectedPath, 'structured-json', options);
  }

  // Last-resort disk fallback. claude --print buffers a full response then
  // returns; for large workflow artifacts the LLM's max_output_tokens cap
  // kicks in and the JSON gets cut off mid-emit (observed: 38KB of valid
  // JSON ending at `"language": "typescript",` with no closing braces). In
  // that case the writer typically *did* succeed at writing the workflow
  // source to disk via the Write tool — there's just no parseable stdout
  // wrapper for the parser to read. Trust the file on disk only when (a)
  // the caller provided `writerInvokedAtMs` so we can prove the file is
  // fresh, and (b) the file's mtime is strictly after that timestamp.
  const recovered = recoverArtifactFromTruncatedOutput(expectedPath, options);
  if (recovered) {
    try {
      validateArtifactContent(recovered);
      return {
        content: recovered,
        metadata: { recoveredFromDisk: true, reason: 'stdout-truncated-or-unparseable' },
        responseFormat: 'structured-json',
      };
    } catch {
      // Recovered content failed structural validation; fall through to
      // the original parser-failure error so the caller sees the real
      // truncation symptom rather than a misleading "no workflow()" error.
    }
  }

  throw new WorkforcePersonaWriterError(
    'Workforce persona response must be structured JSON or include fenced TypeScript artifact and JSON metadata blocks.',
  );
}

/**
 * Reads the artifact from disk as a last-resort fallback when the writer's
 * stdout could not be parsed. Only fires when the caller pinned a
 * `writerInvokedAtMs` timestamp AND the file at `expectedPath` was modified
 * strictly after it — proving the file is the current writer's output, not
 * a stale leftover from a prior attempt.
 */
function recoverArtifactFromTruncatedOutput(
  expectedPath: string,
  options: PersonaResponseParseOptions,
): string | undefined {
  if (!options.repoRoot || options.writerInvokedAtMs === undefined) return undefined;
  const expectedResolved = isAbsolute(expectedPath)
    ? expectedPath
    : resolve(options.repoRoot, expectedPath);

  const statFn = options.statFile ?? defaultStatFile;
  const stat = statFn(expectedResolved);
  if (!stat) return undefined;
  if (stat.mtimeMs <= options.writerInvokedAtMs) return undefined;

  try {
    return options.readFileText?.(expectedResolved) ?? readFileSync(expectedResolved, 'utf8');
  } catch {
    return undefined;
  }
}

function defaultStatFile(path: string): { mtimeMs: number } | undefined {
  try {
    const stats = statSync(path);
    return { mtimeMs: stats.mtimeMs };
  } catch {
    return undefined;
  }
}

/**
 * Walks `text` looking for the first top-level balanced `{ ... }` object
 * and parses it. String literals (including nested escape sequences) and
 * the brace-tracking are handled inline so the scanner is not confused by
 * a `}` that appears inside a JSON string value (e.g. the embedded
 * TypeScript source the writer returns inside `artifact.content`).
 *
 * Returns the parsed object or `null` when no balanced object exists or
 * the candidate substring is not valid JSON.
 */
export function extractFirstBalancedJsonObject(text: string): Record<string, unknown> | null {
  for (let start = 0; start < text.length; start += 1) {
    if (text[start] !== '{') continue;
    let depth = 0;
    let inString = false;
    let escape = false;
    for (let i = start; i < text.length; i += 1) {
      const ch = text[i];
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === '\\') {
        if (inString) escape = true;
        continue;
      }
      if (ch === '"') {
        inString = !inString;
        continue;
      }
      if (inString) continue;
      if (ch === '{') depth += 1;
      else if (ch === '}') {
        depth -= 1;
        if (depth === 0) {
          const candidate = text.slice(start, i + 1);
          const parsed = parseJsonObject(candidate);
          if (parsed) return parsed;
          break; // Candidate did not parse; resume scan from the next `{`.
        }
      }
    }
  }
  return null;
}

function parseClarificationResponse(value: Record<string, unknown>): ClarificationRequest | null {
  const raw = isRecord(value.needs_clarification)
    ? value.needs_clarification
    : value.status === 'needs_clarification'
      ? value
      : null;
  if (!raw) return null;

  const rawQuestions = Array.isArray(raw.questions) ? raw.questions : [];
  const questions = rawQuestions
    .map(parseClarificationQuestion)
    .filter((question): question is ClarificationQuestion => question !== null);
  if (questions.length === 0) {
    throw new WorkforcePersonaWriterError('Workforce persona needs_clarification response must include at least one question.');
  }

  return {
    status: 'needs_clarification',
    reason: typeof raw.reason === 'string' && raw.reason.trim()
      ? raw.reason.trim()
      : 'The workflow spec has blocking ambiguity.',
    questions,
  };
}

function parseClarificationQuestion(value: unknown): ClarificationQuestion | null {
  if (!isRecord(value)) return null;
  const question = typeof value.question === 'string' ? value.question.trim() : '';
  if (!question) return null;
  const id = typeof value.id === 'string' && value.id.trim()
    ? value.id.trim()
    : question.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'clarification';

  return {
    id,
    question,
    reason: typeof value.reason === 'string' && value.reason.trim()
      ? value.reason.trim()
      : 'The persona could not safely author the workflow without this answer.',
    blocking: typeof value.blocking === 'boolean' ? value.blocking : true,
    ...(typeof value.defaultAssumption === 'string' && value.defaultAssumption.trim()
      ? { defaultAssumption: value.defaultAssumption.trim() }
      : {}),
  };
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
  options: PersonaResponseParseOptions,
): ParsedPersonaResponse {
  const artifact = isRecord(value.artifact) ? value.artifact : value;
  const artifactPath = artifact.path;
  const inlineContent = artifact.content;
  const recoveredContent = recoverExpectedArtifactContent(artifactPath, expectedPath, options);
  const content = typeof inlineContent === 'string' && inlineContent.trim().length > 0
    ? inlineContent
    : recoveredContent;
  if (typeof content !== 'string' || content.trim().length === 0) {
    throw new WorkforcePersonaWriterError('Workforce persona structured response is missing artifact.content.');
  }

  if (typeof artifactPath === 'string' && artifactPath !== expectedPath) {
    throw new WorkforcePersonaWriterError(
      `Workforce persona artifact path ${artifactPath} did not match expected output path ${expectedPath}.`,
    );
  }
  try {
    validateArtifactContent(content);
  } catch (error) {
    if (!recoveredContent || content === recoveredContent) throw error;
    validateArtifactContent(recoveredContent);
    const metadata = isRecord(value.metadata) ? value.metadata : {};
    validateMetadata(metadata);
    return { content: recoveredContent, metadata, responseFormat };
  }

  const metadata = isRecord(value.metadata) ? value.metadata : {};
  validateMetadata(metadata);
  return { content, metadata, responseFormat };
}

function recoverExpectedArtifactContent(
  artifactPath: unknown,
  expectedPath: string,
  options: PersonaResponseParseOptions,
): string | undefined {
  if (!options.repoRoot || typeof artifactPath !== 'string' || artifactPath !== expectedPath) {
    return undefined;
  }
  const expectedResolved = isAbsolute(expectedPath)
    ? expectedPath
    : resolve(options.repoRoot, expectedPath);
  const artifactResolved = isAbsolute(artifactPath)
    ? artifactPath
    : resolve(options.repoRoot, artifactPath);
  if (artifactResolved !== expectedResolved) return undefined;

  try {
    return options.readFileText?.(artifactResolved) ?? readFileSync(artifactResolved, 'utf8');
  } catch {
    return undefined;
  }
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
}

export function hasExplicitWorkflowRunCwd(content: string): boolean {
  const executableCode = maskTypeScriptStringsAndComments(content);
  return /\.run\s*\(\s*\{[\s\S]*?\bcwd\s*:\s*process\.cwd\s*\(\s*\)[\s\S]*?\}\s*\)/.test(executableCode);
}

function maskTypeScriptStringsAndComments(content: string): string {
  let masked = '';
  let index = 0;

  while (index < content.length) {
    const char = content[index];
    const next = content[index + 1];

    if (char === '"' || char === "'" || char === '`') {
      const quote = char;
      masked += ' ';
      index += 1;
      let escaped = false;
      while (index < content.length) {
        const current = content[index];
        masked += current === '\n' || current === '\r' ? current : ' ';
        index += 1;
        if (escaped) {
          escaped = false;
          continue;
        }
        if (current === '\\') {
          escaped = true;
          continue;
        }
        if (current === quote) break;
      }
      continue;
    }

    if (char === '/' && next === '/') {
      masked += '  ';
      index += 2;
      while (index < content.length && content[index] !== '\n') {
        masked += ' ';
        index += 1;
      }
      continue;
    }

    if (char === '/' && next === '*') {
      masked += '  ';
      index += 2;
      while (index < content.length) {
        const current = content[index];
        const following = content[index + 1];
        masked += current === '\n' || current === '\r' ? current : ' ';
        index += 1;
        if (current === '*' && following === '/') {
          masked += ' ';
          index += 1;
          break;
        }
      }
      continue;
    }

    masked += char;
    index += 1;
  }

  return masked;
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

function isRunnablePersonaModule(value: WorkforcePersonaModule): boolean {
  return (
    typeof value.useRunnablePersona === 'function' ||
    typeof value.useRunnableSelection === 'function'
  );
}

function workforcePersonaModuleLoadError(importFailure: string | undefined): string {
  if (importFailure) {
    return [
      '@agentworkforce/harness-kit could not be loaded from the installed npm dependencies.',
      'Try reinstalling @agentworkforce/ricky (`npm install` in this project).',
      'Ricky only resolves npm packages for Workforce persona execution; local ../workforce checkouts are intentionally ignored.',
    ].join(' ');
  }
  return [
    '@agentworkforce/harness-kit is installed but does not expose the runnable persona API Ricky needs.',
    'Install a published npm version that exports useRunnablePersona() or useRunnableSelection().',
    'Ricky only resolves npm packages for Workforce persona execution; local ../workforce checkouts are intentionally ignored.',
  ].join(' ');
}

function workforceSelectionModuleLoadError(importFailure: string | undefined): string {
  if (importFailure) {
    return [
      '@agentworkforce/workload-router could not be loaded from the installed npm dependencies.',
      'Try reinstalling @agentworkforce/ricky (`npm install` in this project).',
      'Ricky only resolves npm packages for Workforce persona selection; local ../workforce checkouts are intentionally ignored.',
    ].join(' ');
  }
  return [
    '@agentworkforce/workload-router is installed but does not expose the persona selection API Ricky needs.',
    'Install a published npm version that exports usePersona().',
    'Ricky only resolves npm packages for Workforce persona selection; local ../workforce checkouts are intentionally ignored.',
  ].join(' ');
}

function moduleExports(value: object): string {
  const exports = Object.keys(value).sort();
  return exports.length > 0 ? exports.join(', ') : 'none';
}

async function importWorkforcePackage(packageName: string): Promise<object> {
  return await import(packageName) as object;
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

function metadataSelectionOptions(
  options: { tier?: string; installRoot?: string },
): WorkforceSelectionOptions | undefined {
  const resolved: WorkforceSelectionOptions = {};
  if (options.tier) resolved.tier = options.tier;
  return Object.keys(resolved).length > 0 ? resolved : undefined;
}

function runnableSelectionFallbackOptions(
  options: { tier?: string; installRoot?: string },
): WorkforceSelectionOptions | undefined {
  const resolved: WorkforceSelectionOptions = {};
  if (options.tier) resolved.tier = options.tier;
  if (options.installRoot) resolved.installRoot = options.installRoot;
  return Object.keys(resolved).length > 0 ? resolved : undefined;
}

function selectionFromPersonaResult(value: unknown): unknown {
  if (!isRecord(value)) return null;
  return isRecord(value.selection) ? value.selection : null;
}

function personaResolverOptions(options: { tier?: string; installRoot?: string }): { tier?: string; installRoot?: string } {
  const resolved: { tier?: string; installRoot?: string } = {};
  if (options.tier) resolved.tier = options.tier;
  if (options.installRoot) resolved.installRoot = options.installRoot;
  return resolved;
}

function mergedPersonaEnv(
  personaEnv: Record<string, string> | undefined,
  callerEnv: NodeJS.ProcessEnv | undefined,
): NodeJS.ProcessEnv | undefined {
  if (!personaEnv && !callerEnv) return undefined;
  return {
    ...(personaEnv ?? {}),
    ...(callerEnv ?? {}),
  };
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

function safeReadSkillText(path: string): string {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return 'UNAVAILABLE_SKILL_CONTENT';
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Default grace window (seconds) added on top of the harness-kit
 * subprocess timeout before ricky's outer watchdog fires. Has to absorb
 * harness-kit's SIGTERM → SIGKILL window plus the final pipe-drain — but
 * not so much that an actually-hung writer holds up a multi-spec run for
 * an hour. 90s has handled every observed harness-kit-timely settle case
 * in testing while still releasing within ~1.5 min of a true pipe-hang.
 */
const WRITER_WATCHDOG_GRACE_SECONDS = 90;

/**
 * Default total watchdog window (seconds) when no harness-level
 * `timeoutSeconds` was configured. Picked to be generous enough for the
 * largest writer task observed in production (~45-50 min on `best-value`
 * tier with claude-sonnet-4-6 on the cloud MCP cloud-spawn split) plus
 * the standard grace. Callers that already pass `timeoutSeconds` (the
 * common case) get watchdog = `timeoutSeconds + WRITER_WATCHDOG_GRACE_SECONDS`,
 * so this fallback only applies when the persona forgot to declare a
 * timeout.
 */
const WRITER_DEFAULT_WATCHDOG_SECONDS = 60 * 60;

/**
 * Awaits the harness-kit writer execution with a watchdog so a stuck
 * subprocess settle path can't hang the caller indefinitely.
 *
 * Background — production hang on 2026-05-15:
 * - claude writer subprocess ran to its harness-kit-declared timeout
 *   (3600s), got SIGTERM, then SIGKILL.
 * - The subprocess exited (gone from `ps`) but its stdio pipe stayed
 *   half-open with ~16 KB of buffered bytes. harness-kit's `finish()`
 *   resolution never fired because its `exit` handler was waiting on a
 *   `stdout` close that never came.
 * - Ricky's `await Promise.all([run, run.runId])` then hung at 0% CPU
 *   for an additional 60+ minutes with FD 4/5 = PIPE, blocking the
 *   master script from advancing to the next spec.
 *
 * This watchdog forces a settle at `timeoutSeconds + grace`. If it
 * fires, `run.cancel()` is invoked first so any subprocess handles the
 * runner still owns get released, then a WorkforcePersonaWriterError is
 * raised so the master loop can move on rather than block forever.
 *
 * The watchdog is opt-out by design: every caller already passes
 * `timeoutSeconds` via the persona's `harnessSettings`, so the watchdog
 * fires at most `grace` seconds after the harness-kit-internal timeout
 * was supposed to land. The happy path (writer settles before its own
 * timeout) clears the watchdog timer in the `finally` block and never
 * pays any wall-clock cost.
 */
export async function waitForWriterWithWatchdog<R extends Promise<unknown> & { runId: Promise<string | null>; cancel?: () => void }>(
  run: R,
  timeoutSeconds: number | undefined,
  resolverWarnings: string[],
): Promise<[Awaited<R>, string | null]> {
  const effectiveTimeoutSeconds = typeof timeoutSeconds === 'number' && timeoutSeconds > 0
    ? timeoutSeconds
    : WRITER_DEFAULT_WATCHDOG_SECONDS;
  const watchdogMs = (effectiveTimeoutSeconds + WRITER_WATCHDOG_GRACE_SECONDS) * 1000;

  let watchdogTimer: ReturnType<typeof setTimeout> | undefined;
  let watchdogFired = false;

  const watchdog = new Promise<never>((_, reject) => {
    watchdogTimer = setTimeout(() => {
      watchdogFired = true;
      try {
        run.cancel?.();
      } catch {
        // Best-effort — release the subprocess handle if the runner
        // exposes one; failures here cannot stop the throw below.
      }
      reject(
        new WorkforcePersonaWriterError(
          `Workforce persona writer did not settle within ${effectiveTimeoutSeconds + WRITER_WATCHDOG_GRACE_SECONDS}s (declared timeout ${effectiveTimeoutSeconds}s + watchdog grace ${WRITER_WATCHDOG_GRACE_SECONDS}s). The harness-kit subprocess likely exited but left its stdio pipe half-open; aborting to avoid an indefinite wait.`,
          resolverWarnings,
        ),
      );
    }, watchdogMs);
    // Don't keep the event loop alive just for the watchdog; if the
    // process is exiting for unrelated reasons the watchdog is moot.
    watchdogTimer.unref?.();
  });

  // `run.runId` is optional metadata downstream (`result.workflowRunId ??
  // runId`), but the original `Promise.all([run, run.runId.catch(...)])`
  // shape blocked on BOTH sides — so a writer that resolves successfully
  // but whose runId promise never settles would still hang here until the
  // watchdog fired, even though the result is already in hand. Race the
  // runId against the run's own resolution so a completed run forces
  // runId to yield `null` immediately when the runId side is stuck.
  const runIdOrNull = Promise.race<string | null>([
    run.runId.catch(() => null),
    run.then(() => null, () => null),
  ]);

  try {
    const settled = await Promise.race([
      Promise.all([run, runIdOrNull]),
      watchdog,
    ]);
    return settled as [Awaited<R>, string | null];
  } finally {
    if (watchdogTimer && !watchdogFired) {
      clearTimeout(watchdogTimer);
    }
  }
}

export interface PersonaDebugDumpInput {
  /** Which persona pass produced the output — keeps writer and reviewer dumps separate on disk. */
  kind: 'writer' | 'reviewer';
  /** Coarse reason for the dump so the operator can tell parse failures from non-completions at a glance. */
  reason: 'noncompletion' | 'parse-error' | 'no-content' | 'success';
  repoRoot: string;
  /** SHA-256 digest of the task prompt, used as the dump directory name so repeated runs against the same prompt overwrite a single entry. */
  promptDigest: string;
  /** The full task prompt that was sent to the harness; written so the operator can replay the spawn outside Ricky. */
  task: string;
  result: WorkforcePersonaExecutionResult;
  selection: WorkforcePersonaSelection;
  resolved: ResolvedWorkforcePersonaContext;
  /** Artifact path Ricky asked the persona to produce; recorded in the dump metadata for cross-referencing with the run state. */
  outputPath: string;
}

/**
 * Persists the raw persona output, the prompt that produced it, and the
 * selection metadata under `<repoRoot>/.workflow-artifacts/ricky-persona-debug/`
 * so operators can inspect what a Workforce persona actually returned when
 * the parser rejected it (or when explicit debug capture is requested via
 * `RICKY_PERSONA_DEBUG=1`).
 *
 * - On every failure path (`noncompletion` / `parse-error` / `no-content`)
 *   the dump is always written so failed runs are self-debuggable.
 * - On the `success` path the dump only runs when `RICKY_PERSONA_DEBUG=1`
 *   is set, so green production runs do not litter the artifact tree.
 *
 * Dump layout (one directory per `(kind, promptDigest)` pair):
 * - `output.raw.txt`   — the persona's stdout as captured by harness-kit
 * - `task.prompt.txt`  — the task body that was sent to the persona
 * - `meta.json`        — selection, status, exit code, stderr, durationMs
 *
 * Failures inside this helper are swallowed and surfaced through stderr —
 * the dump is debugging telemetry; it must never mask the original
 * writer/reviewer error.
 */
export async function dumpPersonaDebug(input: PersonaDebugDumpInput): Promise<void> {
  if (input.reason === 'success' && process.env.RICKY_PERSONA_DEBUG !== '1') {
    return;
  }
  try {
    const dir = join(
      input.repoRoot,
      '.workflow-artifacts',
      'ricky-persona-debug',
      input.kind,
      `${input.promptDigest.slice(0, 16)}-${input.reason}`,
    );
    await mkdir(dir, { recursive: true });
    await Promise.all([
      writeFile(join(dir, 'output.raw.txt'), input.result.output ?? '', 'utf8'),
      writeFile(join(dir, 'task.prompt.txt'), input.task, 'utf8'),
      writeFile(
        join(dir, 'meta.json'),
        JSON.stringify(
          {
            kind: input.kind,
            reason: input.reason,
            outputPath: input.outputPath,
            selection: {
              personaId: input.selection.personaId,
              tier: input.selection.tier,
              harness: input.selection.runtime.harness,
              model: input.selection.runtime.model,
            },
            result: {
              status: input.result.status,
              exitCode: input.result.exitCode,
              durationMs: input.result.durationMs,
              workflowRunId: input.result.workflowRunId,
              stepName: input.result.stepName,
              stderr: input.result.stderr,
            },
            resolverIntent: input.resolved.intent,
            resolverWarnings: input.resolved.warnings,
            promptDigest: input.promptDigest,
            recordedAt: new Date().toISOString(),
          },
          null,
          2,
        ),
        'utf8',
      ),
    ]);
    if (process.env.RICKY_PERSONA_DEBUG_VERBOSE === '1' || input.reason !== 'success') {
      // Surface the dump location so the operator can find it without
      // grepping the artifacts tree; success dumps are silent unless
      // explicitly opted into via the verbose flag.
      // eslint-disable-next-line no-console
      console.error(`[ricky] persona ${input.kind} debug dump → ${dir}`);
    }
  } catch (error) {
    if (process.env.RICKY_PERSONA_DEBUG_VERBOSE === '1') {
      // Dump failures are typically permission/path issues in tests and other
      // non-real-repo callers. Stay quiet unless the operator explicitly
      // asked for verbose debug telemetry.
      // eslint-disable-next-line no-console
      console.error(`[ricky] failed to persist persona debug dump: ${errorMessage(error)}`);
    }
  }
}
