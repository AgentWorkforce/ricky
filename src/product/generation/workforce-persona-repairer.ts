import { createHash } from 'node:crypto';

import {
  defaultWorkforcePersonaResolver,
  parsePersonaWorkflowResponse,
  WORKFORCE_PERSONA_INTENT_CANDIDATES,
  WorkforcePersonaWriterError,
  type ResolvedWorkforcePersonaContext,
  type WorkforcePersonaResolver,
  type WorkforcePersonaSendOptions,
  type WorkforcePersonaWriterMetadata,
} from './workforce-persona-writer.js';

export interface WorkforcePersonaRepairOptions {
  repoRoot: string;
  artifactPath: string;
  artifactContent: string;
  evidence: unknown;
  classification: unknown;
  debuggerResult: unknown;
  blocker?: unknown;
  failedStep?: string;
  previousRunId?: string;
  attempt: number;
  maxAttempts: number;
  timeoutSeconds?: number;
  installSkills?: boolean;
  installRoot?: string;
  tier?: string;
  env?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
  onProgress?: WorkforcePersonaSendOptions['onProgress'];
  personaIntentCandidates?: readonly string[];
  resolver?: WorkforcePersonaResolver;
}

export interface WorkforcePersonaRepairMetadata {
  personaId: string;
  tier: string;
  harness: string;
  model: string;
  promptDigest: string;
  warnings: string[];
  runId: string | null;
  source: ResolvedWorkforcePersonaContext['source'];
  selectedIntent: string;
  responseFormat: WorkforcePersonaWriterMetadata['responseFormat'];
  outputPath: string;
}

export interface WorkforcePersonaRepairResult {
  artifact: {
    content: string;
    metadata: Record<string, unknown>;
  };
  metadata: WorkforcePersonaRepairMetadata;
}

export async function repairWorkflowWithWorkforcePersona(
  options: WorkforcePersonaRepairOptions,
): Promise<WorkforcePersonaRepairResult> {
  const resolver = options.resolver ?? defaultWorkforcePersonaResolver;
  const resolved = await resolver(
    options.personaIntentCandidates ?? WORKFORCE_PERSONA_INTENT_CANDIDATES,
    personaResolverOptions(options),
  );
  const task = buildWorkflowRepairPersonaTask(options);
  const promptDigest = digest(task);
  const selection = resolved.context.selection;
  const run = resolved.context.sendMessage(task, {
    workingDirectory: options.repoRoot,
    name: `ricky-workflow-repair-${promptDigest.slice(0, 12)}`,
    timeoutSeconds: options.timeoutSeconds ?? selection.runtime.harnessSettings?.timeoutSeconds,
    installSkills: options.installSkills,
    env: options.env,
    signal: options.signal,
    onProgress: options.onProgress,
    inputs: {
      outputPath: options.artifactPath,
      failedStep: options.failedStep ?? '',
      previousRunId: options.previousRunId ?? '',
      attempt: options.attempt,
      maxAttempts: options.maxAttempts,
      promptDigest,
    },
  });

  const [result, runId] = await Promise.all([
    run,
    run.runId.catch(() => null),
  ]);
  if (result.status !== 'completed') {
    throw new WorkforcePersonaWriterError(
      `Workforce persona repair did not complete: ${result.status}.`,
      [...resolved.warnings, result.stderr].filter(Boolean),
    );
  }

  const parsed = parsePersonaWorkflowResponse(result.output, options.artifactPath);
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
      outputPath: options.artifactPath,
    },
  };
}

export function buildWorkflowRepairPersonaTask(options: WorkforcePersonaRepairOptions): string {
  const contract = {
    response: {
      preferred: 'JSON object',
      schema: {
        artifact: {
          path: options.artifactPath,
          language: 'typescript',
          content: 'Complete repaired Agent Relay workflow TypeScript source.',
        },
        metadata: {
          summary: 'Short description of the diagnosis and repair.',
          failedStep: options.failedStep ?? null,
          resumePlan: 'How the repaired workflow can resume with --start-from.',
          evidence: 'Deterministic validation expectations preserved or added.',
        },
      },
      fallback:
        'If JSON cannot be emitted, return a fenced ```ts artifact block plus a fenced ```json metadata block.',
    },
  };

  return [
    'Repair an Agent Relay workflow artifact for Ricky after a failed run.',
    '',
    'Your job is to diagnose the failure using the evidence below, patch the underlying workflow artifact, and return the full repaired artifact.',
    '',
    'Workflow artifact path:',
    options.artifactPath,
    '',
    'Current workflow artifact content:',
    '```ts',
    options.artifactContent.trimEnd(),
    '```',
    '',
    'Failure context:',
    safeJson({
      failedStep: options.failedStep,
      previousRunId: options.previousRunId,
      attempt: options.attempt,
      maxAttempts: options.maxAttempts,
      blocker: options.blocker,
      classification: options.classification,
      debuggerResult: options.debuggerResult,
      evidence: options.evidence,
    }),
    '',
    'Repair requirements:',
    '- Return the full repaired TypeScript workflow artifact, not a diff.',
    '- Preserve the artifact path and keep the workflow runnable from the same file.',
    '- Fix the workflow artifact itself; do not ask the user to run manual recovery unless the workflow cannot safely express the prerequisite.',
    '- Preserve or improve the 80-to-100 loop: implementation, deterministic validation, review, final hard gate, and signoff evidence.',
    '- Ensure the failed step can be resumed by Ricky using --start-from with the failed step id and the previous run id.',
    '- Keep side effects explicit and bounded. Do not commit, push, open PRs, or perform destructive file operations.',
    '- Prefer @agent-relay/sdk/workflows TypeScript workflows and keep .run({ cwd: process.cwd() }).',
    '',
    'Structured response contract:',
    JSON.stringify(contract, null, 2),
  ].join('\n');
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch (error) {
    return JSON.stringify({ error: error instanceof Error ? error.message : String(error) }, null, 2);
  }
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function personaResolverOptions(options: { tier?: string; installRoot?: string }): { tier?: string; installRoot?: string } {
  const resolved: { tier?: string; installRoot?: string } = {};
  if (options.tier) resolved.tier = options.tier;
  if (options.installRoot) resolved.installRoot = options.installRoot;
  return resolved;
}
