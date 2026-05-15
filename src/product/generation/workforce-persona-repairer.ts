import { createHash } from 'node:crypto';

import {
  defaultWorkforcePersonaResolver,
  hasExplicitWorkflowRunCwd,
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
  previousAttempts?: WorkforcePersonaRepairAttempt[];
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

export interface WorkforcePersonaRepairAttempt {
  attempt: number;
  repairedArtifactPath: string;
  repairSummary: string;
  repairMode: string;
  personaRunId?: string;
  retryAttempt: number;
  outcome: {
    status: 'failed' | 'blocker' | 'error';
    failedStep?: string;
    blockerCode?: string;
    runId?: string;
    classification?: unknown;
    debuggerSummary?: string;
  };
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
  if (parsed.clarification || !parsed.content) {
    throw new WorkforcePersonaWriterError('Workforce persona repair response must include a repaired workflow artifact.');
  }
  if (!hasExplicitWorkflowRunCwd(parsed.content)) {
    throw new WorkforcePersonaWriterError('Workforce persona repair artifact must run with explicit cwd.');
  }
  const intentRegressions = detectWorkflowIntentRegressions(options.artifactContent, parsed.content);
  if (intentRegressions.length > 0) {
    throw new WorkforcePersonaWriterError(
      `Workforce persona repair regressed workflow intent: ${intentRegressions.join('; ')}.`,
      [`Original workflow declared work that the repair removed. See diagnostic above for specifics.`],
    );
  }
  const responseFormat = parsed.responseFormat as 'structured-json' | 'fenced-artifact';
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
    'Previous repair attempts that did not resolve the workflow:',
    safeJson(options.previousAttempts ?? []),
    '',
    'Repair requirements:',
    '- Return only the final response object or fallback fenced artifact blocks. Do not echo the schema, do not return a patch, and do not describe the patch outside metadata.',
    '- Return the full repaired TypeScript workflow artifact, not a diff.',
    '- Preserve the artifact path and keep the workflow runnable from the same file.',
    '- Fix the workflow artifact itself; do not ask the user to run manual recovery unless the workflow cannot safely express the prerequisite.',
    '- Treat previous repair attempts as negative evidence: account for why they did not resolve the next run, and do not repeat the same repair strategy unless the new evidence proves it was incomplete.',
    '- For MISSING_ENV_VAR failures, first make the workflow load repo-local `.env.local` and `.env` without overwriting shell exports, then add a fast `MISSING_ENV_VAR: NAME` assertion for known required variables before long-running agent steps. Do not fabricate secret values.',
    '- Preserve or improve the 80-to-100 loop: implementation, deterministic validation, review, final hard gate, and signoff evidence.',
    '- Ensure the failed step can be resumed by Ricky using --start-from with the failed step id and the previous run id.',
    '- Preserve original workflow intent. You are repairing one failing step — not rewriting the workflow. If the input declares `createGitHubStep`/`GitHubStepExecutor`/`@agent-relay/github-primitive`, child workflow invocations, named agents, or PR-shipping steps, those MUST remain in the repaired artifact. Do not collapse the workflow to a 2-3 step "minimal" or "repair-safe master" placeholder; a structurally valid workflow that no longer does the original work is a regression, not a repair.',
    '- Constraint on YOUR runtime side-effects (the repair agent, not the workflow being repaired): do not commit, push, open PRs, or perform destructive file operations during repair generation. This does NOT mean the workflow you emit should stop using `@agent-relay/github-primitive` or `createGitHubStep` — those are step declarations that run later when Ricky executes the workflow, which is the entire point.',
    '- Prefer @agent-relay/sdk/workflows TypeScript workflows and keep .run({ cwd: process.cwd() }).',
    '',
    'Structured response contract:',
    JSON.stringify(contract, null, 2),
  ].join('\n');
}

/**
 * Returns a list of human-readable regression descriptions when the repaired
 * artifact has removed PR-shipping or substantive structure that the original
 * workflow declared. Empty array means "no regression detected" — repair is
 * safe to apply.
 *
 * Heuristics (all gate on what the ORIGINAL declared; we never add a new
 * requirement):
 * - PR-shipping primitives: if the original imported or invoked
 *   `@agent-relay/github-primitive`, `GitHubStepExecutor`, or
 *   `createGitHubStep`, those must remain present in the repair. Stripping
 *   them turns a "ship the PR" workflow into a no-op stub, which is the
 *   exact regression this guard exists to prevent.
 * - Step count collapse: if the original had `N >= 4` `.step(...)` calls,
 *   the repair must keep at least `ceil(N / 2)`. A 20-step workflow
 *   "repaired" into 3 placeholder steps is overwhelmingly likely to be a
 *   misdiagnosis (the LLM bailed out and emitted a minimal scaffold) rather
 *   than a legitimate fix.
 * - Builder usage: the original's `workflow(...)` invocation must remain;
 *   a repair that replaces it with a different builder pattern is by
 *   definition rewriting, not repairing.
 *
 * These are intentionally conservative — a healthy repair will trivially
 * satisfy all three. They only fire on the failure mode this PR addresses
 * (the LLM "simplifies" the workflow into a placeholder).
 */
export function detectWorkflowIntentRegressions(
  originalContent: string,
  repairedContent: string,
): string[] {
  const regressions: string[] = [];

  const githubPrimitiveMarkers = [
    '@agent-relay/github-primitive',
    'GitHubStepExecutor',
    'createGitHubStep',
  ];
  for (const marker of githubPrimitiveMarkers) {
    if (originalContent.includes(marker) && !repairedContent.includes(marker)) {
      regressions.push(
        `original declared "${marker}" but the repair removed it. PR-shipping primitives must survive repair.`,
      );
    }
  }

  const originalStepCount = countStepInvocations(originalContent);
  const repairedStepCount = countStepInvocations(repairedContent);
  if (originalStepCount >= 4) {
    const floor = Math.ceil(originalStepCount / 2);
    if (repairedStepCount < floor) {
      regressions.push(
        `step count collapsed from ${originalStepCount} to ${repairedStepCount} (below the ${floor} minimum). Repair appears to be a placeholder scaffold rather than a fix.`,
      );
    }
  }

  if (originalContent.includes('workflow(') && !repairedContent.includes('workflow(')) {
    regressions.push('original used `workflow(...)` builder but the repair removed it.');
  }

  return regressions;
}

function countStepInvocations(content: string): number {
  // Matches the `.step("name", ...)` chain calls produced by the
  // @agent-relay/sdk/workflows builder. The dot anchor avoids matching
  // arbitrary `step(` usage outside the builder chain.
  const matches = content.match(/\.step\(\s*['"]/g);
  return matches ? matches.length : 0;
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

const DEFAULT_WORKFORCE_PERSONA_REPAIR_TIER = 'best-value';

function personaResolverOptions(options: { tier?: string; installRoot?: string; attempt?: number }): { tier?: string; installRoot?: string } {
  const baseTier = options.tier ?? DEFAULT_WORKFORCE_PERSONA_REPAIR_TIER;
  const resolved: { tier?: string; installRoot?: string } = {
    tier: options.attempt !== undefined && options.attempt > 3 ? 'best' : baseTier,
  };
  if (options.installRoot) resolved.installRoot = options.installRoot;
  return resolved;
}
