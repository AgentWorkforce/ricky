import { createHash } from 'node:crypto';

import { fromMarkdown } from 'mdast-util-from-markdown';
import type { Code, Node, Parent, Root } from 'mdast';

import type { NormalizedWorkflowSpec } from '../spec-intake/types.js';
import {
  dumpPersonaDebug,
  WorkforcePersonaWriterError,
  type WorkforcePersonaResolver,
  type WorkforcePersonaSendOptions,
} from './workforce-persona-writer.js';
import { createRickyLocalPersonaResolver } from './ricky-local-persona-resolver.js';

const DEFAULT_REVIEW_INTENT_CANDIDATES = ['review'] as const;

/**
 * Reviewer verdict values.
 *
 * - `pass`: artifact approved; pipeline ships the writer's output as-is.
 * - `fix`: artifact has actionable fixes; pipeline feeds them back into one
 *   writer repair attempt.
 * - `block`: artifact is fundamentally wrong; pipeline keeps the writer's
 *   output and records the verdict in metadata for the operator.
 * - `error`: the reviewer pass itself failed (resolver error, harness
 *   timeout, parser exception). Distinct from `block` so downstream
 *   automation does not misread "the reviewer crashed" as "the reviewer
 *   reviewed and approved." Only ever produced by the pipeline catch path,
 *   never emitted by the reviewer persona itself.
 */
export type WorkforcePersonaReviewVerdict = 'pass' | 'fix' | 'block' | 'error';

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
  const dumpDebug = (reason: 'noncompletion' | 'parse-error' | 'no-content' | 'success') =>
    dumpPersonaDebug({
      kind: 'reviewer',
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
      `Workforce persona reviewer did not complete: ${result.status}.`,
      [...resolved.warnings, result.stderr].filter(Boolean),
    );
  }

  const verdict = parseReviewerVerdict(result.output);
  // Reviewer's parser never throws — an unparseable response degrades to a
  // `block` verdict with the canned summary below. Detect that exact
  // synthetic case so dumps land in the parse-error directory only when
  // the parser actually fell through (not for a legitimate `block` from
  // the model).
  const synthesizedBlockSummary = 'Reviewer response did not contain a parseable verdict JSON; treating as block.';
  await dumpDebug(verdict.summary === synthesizedBlockSummary ? 'parse-error' : 'success');
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
 * Extracts the reviewer verdict from the persona response.
 *
 * Resolution order, picked to favor the model's final-line answer over any
 * earlier draft work:
 * 1. Walk the response as Markdown via `mdast-util-from-markdown` and collect
 *    every fenced ` ```json ` code block. Try the LAST block first, then
 *    earlier blocks — Sonnet has been observed to emit one or more draft
 *    verdict JSONs followed by its final verdict, and the final block is
 *    what the persona system prompt says is authoritative.
 * 2. If no fenced block carried a valid verdict, scan the raw text from the
 *    end looking for the last balanced `{ ... }` object. This catches
 *    "prose plus unfenced JSON on the final line."
 * 3. Direct-parse the entire trimmed output as a JSON object. This catches
 *    the strict-contract case where the model returned only `{ ... }`.
 *
 * Falls back to `verdict: 'block'` with a canned summary when no candidate
 * carries a recognized verdict so the pipeline can record an auditable
 * failure rather than crashing or silently approving.
 *
 * Why mdast rather than a regex over raw text: `output.match(/```json[…]```/)`
 * picks the first match and can match across nested fences inside the
 * inlined workflow source the reviewer is auditing. The CLAUDE.md
 * "grammar-aware parsers, not regex" rule applies directly here — see the
 * `markdown-target-files.ts` precedent for the same pattern.
 */
export function parseReviewerVerdict(output: string): {
  verdict: WorkforcePersonaReviewVerdict;
  summary: string;
  fixes: WorkforcePersonaReviewFix[];
} {
  const fencedCandidates = extractFencedJsonBlocksLastFirst(output);
  for (const candidate of fencedCandidates) {
    const verdict = toVerdict(candidate);
    if (verdict) return verdict;
  }

  const trailing = extractTrailingJsonObject(output);
  if (trailing) {
    const verdict = toVerdict(trailing);
    if (verdict) return verdict;
  }

  const direct = safeParse(output.trim());
  if (direct) {
    const verdict = toVerdict(direct);
    if (verdict) return verdict;
  }

  return {
    verdict: 'block',
    summary: 'Reviewer response did not contain a parseable verdict JSON; treating as block.',
    fixes: [],
  };
}

function toVerdict(
  candidate: Record<string, unknown>,
): { verdict: WorkforcePersonaReviewVerdict; summary: string; fixes: WorkforcePersonaReviewFix[] } | null {
  const verdict = candidate.verdict;
  // Reviewer-persona vocabulary only — `'error'` is reserved for the
  // pipeline catch path on the reviewer-pass-itself-crashed channel.
  if (verdict !== 'pass' && verdict !== 'fix' && verdict !== 'block') return null;
  const summary = typeof candidate.summary === 'string' ? candidate.summary : '';
  const fixes = Array.isArray(candidate.fixes)
    ? candidate.fixes.flatMap((entry: unknown) => normalizeFix(entry))
    : [];
  return { verdict, summary, fixes };
}

/**
 * Returns the parsed contents of every fenced ` ```json ` block in the
 * response, ordered LAST-block-first so callers can prefer the model's
 * final answer over earlier drafts. Walks the mdast tree rather than
 * regex-matching raw text so fenced blocks nested inside the workflow
 * source the reviewer is auditing do not get confused with verdict
 * blocks.
 */
export function extractFencedJsonBlocksLastFirst(output: string): Record<string, unknown>[] {
  let tree: Root;
  try {
    tree = fromMarkdown(output);
  } catch {
    return [];
  }
  const blocks: Record<string, unknown>[] = [];
  walkMdast(tree, (node) => {
    if (node.type !== 'code') return;
    const code = node as Code;
    if (typeof code.lang !== 'string') return;
    if (code.lang.toLowerCase() !== 'json') return;
    const parsed = safeParse(code.value);
    if (parsed) blocks.push(parsed);
  });
  return blocks.reverse();
}

function walkMdast(node: Node, visit: (node: Node) => void): void {
  visit(node);
  const parent = node as Partial<Parent>;
  if (!Array.isArray(parent.children)) return;
  for (const child of parent.children) walkMdast(child, visit);
}

function extractTrailingJsonObject(output: string): Record<string, unknown> | null {
  const trimmed = output.trim();
  // Walk back from the end looking for a balanced object so we honor the
  // reviewer's "JSON on the final line" contract even when there are no
  // fences at all (e.g. when the model returned the verdict as raw JSON
  // appended after prose, or when fences were unbalanced and so missed
  // by the mdast parser).
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
