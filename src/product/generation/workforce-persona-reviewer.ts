import { createHash } from 'node:crypto';

import type { NormalizedWorkflowSpec } from '../spec-intake/types.js';
import {
  WorkforcePersonaWriterError,
  type WorkforcePersonaResolver,
  type WorkforcePersonaSendOptions,
} from './workforce-persona-writer.js';
import { createRickyLocalPersonaResolver } from './ricky-local-persona-resolver.js';

const DEFAULT_REVIEW_INTENT_CANDIDATES = ['review'] as const;

export type WorkforcePersonaReviewVerdict = 'pass' | 'fix' | 'block';

export type WorkforcePersonaReviewSeverity = 'critical' | 'important' | 'moderate';

export interface WorkforcePersonaReviewFix {
  severity: WorkforcePersonaReviewSeverity;
  area: string;
  finding: string;
  requestedChange: string;
}

export interface WorkforcePersonaReviewMetadata {
  personaId: string;
  tier: string;
  harness: string;
  model: string;
  selectedIntent: string;
  runId: string | null;
  warnings: string[];
  promptDigest: string;
}

export interface WorkforcePersonaReviewResult {
  verdict: WorkforcePersonaReviewVerdict;
  summary: string;
  fixes: WorkforcePersonaReviewFix[];
  raw: string;
  metadata: WorkforcePersonaReviewMetadata;
}

export interface WorkforcePersonaReviewOptions {
  repoRoot: string;
  outputPath: string;
  artifactContent: string;
  workflowName: string;
  tier?: string;
  timeoutSeconds?: number;
  installSkills?: boolean;
  installRoot?: string;
  env?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
  onProgress?: WorkforcePersonaSendOptions['onProgress'];
  resolver?: WorkforcePersonaResolver;
  personaIntentCandidates?: readonly string[];
}

/**
 * Runs a Workforce persona reviewer over a freshly generated workflow
 * artifact. The reviewer resolves through the same `agent-relay-workflow`
 * intent path as the writer, but targets the `review` intent at tier
 * `best` by default so the audit pass uses the deepest-reasoning Claude
 * persona available. The reviewer returns a structured verdict the
 * pipeline can act on (pass through, feed fixes back to the writer, or
 * block).
 */
export async function reviewWorkflowWithWorkforcePersona(
  spec: NormalizedWorkflowSpec,
  options: WorkforcePersonaReviewOptions,
): Promise<WorkforcePersonaReviewResult> {
  const resolver = options.resolver ?? createRickyLocalPersonaResolver();
  const intents = options.personaIntentCandidates ?? DEFAULT_REVIEW_INTENT_CANDIDATES;
  const tier = options.tier ?? 'best';

  const resolved = await resolver(intents, {
    tier,
    ...(options.installRoot !== undefined ? { installRoot: options.installRoot } : {}),
  });

  const task = buildReviewerTask(spec, options);
  const promptDigest = digest(task);
  const selection = resolved.context.selection;

  const run = resolved.context.sendMessage(task, {
    workingDirectory: options.repoRoot,
    name: `ricky-workflow-reviewer-${promptDigest.slice(0, 12)}`,
    timeoutSeconds: options.timeoutSeconds ?? selection.runtime.harnessSettings?.timeoutSeconds,
    installSkills: options.installSkills,
    mode: 'one-shot',
    responseFormat: 'structured-json-or-fenced-artifact',
    env: options.env,
    signal: options.signal,
    onProgress: options.onProgress,
    inputs: {
      outputPath: options.outputPath,
      workflowName: options.workflowName,
      promptDigest,
      mode: 'one-shot',
    },
  });

  const [result, runId] = await Promise.all([run, run.runId.catch(() => null)]);
  if (result.status !== 'completed') {
    throw new WorkforcePersonaWriterError(
      `Workforce persona reviewer did not complete: ${result.status}.`,
      [...resolved.warnings, result.stderr].filter(Boolean),
    );
  }

  const verdict = parseReviewerVerdict(result.output);
  return {
    ...verdict,
    raw: result.output,
    metadata: {
      personaId: selection.personaId,
      tier: selection.tier,
      harness: selection.runtime.harness,
      model: selection.runtime.model,
      selectedIntent: resolved.intent,
      runId: result.workflowRunId ?? runId,
      warnings: [...resolved.warnings],
      promptDigest,
    },
  };
}

function buildReviewerTask(spec: NormalizedWorkflowSpec, options: WorkforcePersonaReviewOptions): string {
  const verdictContract = {
    response: {
      preferred: 'JSON object on the final line of the response',
      schema: {
        verdict: '"pass" | "fix" | "block"',
        summary: 'One-paragraph verdict rationale.',
        fixes:
          'Array of { severity: "critical" | "important" | "moderate", area: string, finding: string, requestedChange: string }. Empty when verdict is "pass".',
      },
    },
  };

  return [
    'Audit the freshly generated Agent Relay workflow artifact below against the original normalized spec.',
    'Run as a non-interactive one-shot persona invocation. Return only the response contract.',
    '',
    'Normalized spec JSON:',
    JSON.stringify(spec, null, 2),
    '',
    `Generated workflow artifact path: ${options.outputPath}`,
    `Generated workflow name: ${options.workflowName}`,
    '',
    'Generated workflow source:',
    '```ts',
    options.artifactContent,
    '```',
    '',
    'Audit checklist:',
    '- Decompose by the spec\'s explicit `## Track <Letter>` or numbered section headings rather than inferred subtopics.',
    '- Swarm pattern must match the spec\'s Merge DAG. Parallel branches must fan out, not serialize.',
    '- Per-child review/fix loop must be nested inside each child workflow when the spec asks for it.',
    '- Dedicated `wf-ricky-*` channel, named agents, deterministic gates, file_exists gate, typecheck/test gates, git diff gate.',
    '- `onError` `retryDelayMs` must be >= 10000 for retried steps.',
    '- Preflight-skip any PRs the spec marks as already merged.',
    '- Spec must be referenced by path, not inlined verbatim into `.description()`.',
    '- GitHub primitive PR shipping steps included when the spec requires shipping; omitted when planning-only.',
    '- No branch/commit/PR side effects during persona generation itself.',
    '- Every declared target file appears in implementation steps. No non-goal is touched.',
    '',
    'Response contract:',
    JSON.stringify(verdictContract, null, 2),
  ].join('\n');
}

/**
 * Extracts the reviewer verdict from the persona response. Accepts the
 * verdict JSON either on its own (the response is a JSON object) or as
 * the last fenced ` ```json ` block, or as the last balanced JSON object
 * in the response. Falls back to `block` with a synthetic summary when no
 * verdict can be parsed.
 */
export function parseReviewerVerdict(output: string): {
  verdict: WorkforcePersonaReviewVerdict;
  summary: string;
  fixes: WorkforcePersonaReviewFix[];
} {
  const candidates = [
    extractFencedJson(output),
    extractTrailingJsonObject(output),
    safeParse(output.trim()),
  ];

  for (const candidate of candidates) {
    if (!candidate) continue;
    const verdict = candidate.verdict;
    if (verdict !== 'pass' && verdict !== 'fix' && verdict !== 'block') continue;
    const summary = typeof candidate.summary === 'string' ? candidate.summary : '';
    const fixes = Array.isArray(candidate.fixes)
      ? candidate.fixes.flatMap((entry: unknown) => normalizeFix(entry))
      : [];
    return { verdict, summary, fixes };
  }

  return {
    verdict: 'block',
    summary: 'Reviewer response did not contain a parseable verdict JSON; treating as block.',
    fixes: [],
  };
}

function extractFencedJson(output: string): Record<string, unknown> | null {
  const match = output.match(/```json\s*([\s\S]*?)```/i);
  if (!match) return null;
  return safeParse(match[1].trim());
}

function extractTrailingJsonObject(output: string): Record<string, unknown> | null {
  const trimmed = output.trim();
  // Walk back from the end looking for a balanced object.
  let depth = 0;
  let endIndex = -1;
  for (let i = trimmed.length - 1; i >= 0; i -= 1) {
    const ch = trimmed[i];
    if (ch === '}') {
      if (endIndex === -1) endIndex = i;
      depth += 1;
    } else if (ch === '{') {
      depth -= 1;
      if (depth === 0 && endIndex !== -1) {
        const slice = trimmed.slice(i, endIndex + 1);
        return safeParse(slice);
      }
    }
  }
  return null;
}

function safeParse(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function normalizeFix(entry: unknown): WorkforcePersonaReviewFix[] {
  if (!entry || typeof entry !== 'object') return [];
  const record = entry as Partial<Record<keyof WorkforcePersonaReviewFix, unknown>>;
  const severity = record.severity;
  if (severity !== 'critical' && severity !== 'important' && severity !== 'moderate') return [];
  if (typeof record.area !== 'string' || typeof record.finding !== 'string' || typeof record.requestedChange !== 'string') {
    return [];
  }
  return [{
    severity,
    area: record.area,
    finding: record.finding,
    requestedChange: record.requestedChange,
  }];
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/**
 * Renders a flat list of fix strings suitable for feeding back into the
 * writer's `validationFeedback.errors` channel. Each line carries the
 * severity prefix so the writer can prioritise inside the repair attempt.
 */
export function renderReviewFixesForWriter(review: WorkforcePersonaReviewResult): string[] {
  return review.fixes.map(
    (fix) => `[${fix.severity}] ${fix.area}: ${fix.finding} — ${fix.requestedChange}`,
  );
}
