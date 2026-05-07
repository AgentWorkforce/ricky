/**
 * code-drift-repairer.ts
 *
 * Auto-fix path for "drift report" workflow failures — i.e. when a workflow
 * has *successfully* generated structured findings showing that target code
 * doesn't match an external reference (provider docs, schema, etc.) but the
 * workflow's final gate exits non-zero because drift exists.
 *
 * Distinct from workforce-persona-repairer:
 *   - workforce-persona-repairer: fixes the *workflow artifact itself*
 *     (treating the failure as a generation bug)
 *   - code-drift-repairer (this file): fixes the *target code* the workflow
 *     was inspecting (treating the failure as expected output that requires
 *     a follow-up code change before retry)
 *
 * Drift report schema (any file under .workflow-artifacts/**\/*-drift.json):
 *   {
 *     verdict: 'PASS' | 'DRIFT',
 *     findings: Array<{ severity: 'blocker'|'major'|'minor', axis: string, description: string }>,
 *     expected?: Record<string, unknown>,
 *     actual?: Record<string, unknown>,
 *     sources?: Record<string, string>,
 *     ...
 *   }
 *
 * Detection (in resolveCodeDriftTarget): convention-based + schema-validated
 * + freshness-checked. See auto-fix-loop.ts → resolveCodeDriftTarget.
 */

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';

import {
  defaultWorkforcePersonaResolver,
  WORKFORCE_PERSONA_INTENT_CANDIDATES,
  WorkforcePersonaWriterError,
  type WorkforcePersonaResolver,
  type WorkforcePersonaSendOptions,
} from '../product/generation/workforce-persona-writer.js';

export interface DriftFinding {
  severity: 'blocker' | 'major' | 'minor';
  axis: string;
  description: string;
}

export interface DriftReport {
  /** Path to the .json file on disk (absolute or cwd-relative). */
  filePath: string;
  /** Slug or identifier carried by the report (`r.slug` if present, else basename). */
  slug?: string;
  verdict: 'PASS' | 'DRIFT';
  findings: DriftFinding[];
  expected?: Record<string, unknown>;
  actual?: Record<string, unknown>;
  sources?: Record<string, string>;
  /**
   * Per-report opt-out for auto-fix. Auto-fix is ON by default — when a
   * workflow emits a drift report with `"autofix": false`, ricky records
   * the drift but does NOT dispatch a code-fix agent. Useful for
   * monitoring/audit workflows that want findings surfaced for human
   * triage rather than automated source edits.
   */
  autofix: boolean;
  /** Full parsed JSON for the agent prompt. */
  raw: Record<string, unknown>;
}

export interface CodeDriftTarget {
  /** Working directory the workflow ran in. */
  cwd: string;
  /** Reports with verdict === 'DRIFT' that contain at least one blocker or major finding. */
  reports: DriftReport[];
}

export interface CodeDriftRepairOptions {
  target: CodeDriftTarget;
  attempt: number;
  maxAttempts: number;
  failedStep?: string;
  previousRunId?: string;
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

export interface CodeDriftRepairResult {
  applied: boolean;
  summary: string;
  /** The persona/agent run id, when the underlying harness exposes one. */
  runId?: string | null;
  /** Slugs whose findings were addressed; informational. */
  fixedSlugs?: string[];
  warnings?: string[];
}

/**
 * Severity threshold for which findings the repair agent is asked to fix.
 * Blockers are always fixed. Majors are included by default; the auto-fix
 * loop can override via `severityThreshold` in the future.
 */
const DEFAULT_SEVERITY_THRESHOLD: ReadonlyArray<DriftFinding['severity']> = ['blocker', 'major'];

const DEFAULT_TIER = 'best-value';

function actionableFindings(findings: DriftFinding[]): DriftFinding[] {
  const allowed = new Set(DEFAULT_SEVERITY_THRESHOLD);
  return findings.filter((f) => allowed.has(f.severity));
}

export async function repairCodeFromDriftArtifacts(
  options: CodeDriftRepairOptions,
): Promise<CodeDriftRepairResult> {
  const { target } = options;
  if (target.reports.length === 0) {
    return { applied: false, summary: 'No actionable drift reports.' };
  }

  const resolver = options.resolver ?? defaultWorkforcePersonaResolver;
  const resolved = await resolver(
    options.personaIntentCandidates ?? WORKFORCE_PERSONA_INTENT_CANDIDATES,
    {
      tier: options.tier ?? DEFAULT_TIER,
      ...(options.installRoot ? { installRoot: options.installRoot } : {}),
    },
  );

  const task = await buildCodeDriftRepairTask(target, options);
  const promptDigest = createHash('sha256').update(task).digest('hex');
  const selection = resolved.context.selection;

  const run = resolved.context.sendMessage(task, {
    workingDirectory: target.cwd,
    name: `ricky-code-drift-repair-${promptDigest.slice(0, 12)}`,
    timeoutSeconds: options.timeoutSeconds ?? selection.runtime.harnessSettings?.timeoutSeconds,
    installSkills: options.installSkills,
    env: options.env,
    signal: options.signal,
    onProgress: options.onProgress,
    inputs: {
      driftReportPaths: target.reports.map((r) => r.filePath).join(','),
      reportCount: target.reports.length,
      attempt: options.attempt,
      maxAttempts: options.maxAttempts,
      promptDigest,
    },
  });

  const [result, runId] = await Promise.all([run, run.runId.catch(() => null)]);
  if (result.status !== 'completed') {
    throw new WorkforcePersonaWriterError(
      `Code-drift repair did not complete: ${result.status}.`,
      [...resolved.warnings, result.stderr].filter(Boolean),
    );
  }

  // The agent edits files in place via its harness. We require a sentinel in
  // the response confirming completion. If the agent emitted a structured
  // response we accept that too (parsePersonaWorkflowResponse), but fall
  // back to a textual sentinel for harnesses that don't structure output.
  const completed = isCompletionAcknowledged(result.output);
  if (!completed) {
    throw new WorkforcePersonaWriterError(
      'Code-drift repair response did not include a CODE_DRIFT_REPAIR_COMPLETE marker.',
    );
  }

  return {
    applied: true,
    summary: extractRepairSummary(result.output) ?? `Applied fixes for ${target.reports.length} drift report(s).`,
    runId: result.workflowRunId ?? runId,
    fixedSlugs: target.reports.map((r) => r.slug ?? r.filePath),
    warnings: [...resolved.warnings],
  };
}

async function buildCodeDriftRepairTask(
  target: CodeDriftTarget,
  options: CodeDriftRepairOptions,
): Promise<string> {
  // Read package.json files near each affected source path so the agent has
  // package context when it patches; cheaply done by reading the package.json
  // co-located with the most-referenced file path.
  const reportSummaries = target.reports.map((r) => {
    const filtered = actionableFindings(r.findings);
    return {
      filePath: r.filePath,
      slug: r.slug ?? null,
      verdict: r.verdict,
      expected: r.expected,
      actual: r.actual,
      sources: r.sources,
      findings: filtered.map((f) => ({
        severity: f.severity,
        axis: f.axis,
        description: f.description,
      })),
    };
  });

  return [
    'Repair source code that has drifted from an external reference (provider docs, schema, etc.).',
    '',
    'A previous workflow step produced structured drift reports identifying specific issues in target code. Your job is to read each report, locate the offending source files, and apply minimal targeted fixes — then return a completion marker.',
    '',
    'Working directory:',
    target.cwd,
    '',
    'Drift reports to address (paths are relative to the working directory):',
    safeJson(reportSummaries),
    '',
    'Repair contract:',
    '- Address ALL findings whose severity is blocker or major. Skip minor findings unless they are trivial to bundle in.',
    '- Edit source files in place using your file-editing tools. Do not produce a patch for the user to apply manually.',
    '- For each blocker, the description usually pinpoints the file and the wrong value. Use that as your starting point; verify with a quick grep before editing.',
    '- After editing, run package-level type checks and tests where applicable (e.g. `cd packages/<slug> && npx tsc --noEmit -p tsconfig.json && npm test`) to confirm the fix compiles and passes tests. If a test fails, fix it.',
    '- Do not modify the workflow file itself. Do not modify the drift reports. Do not commit, push, or open PRs.',
    '- Do not introduce backward-incompatible API changes if a smaller compatible fix is possible (e.g. rename a constant + add a deprecated alias rather than break callers).',
    '- If two findings conflict (e.g. one says use header X, another says use header Y), apply the one with higher severity and document the rejected one in your summary.',
    '',
    'On completion, emit the literal sentinel line:',
    'CODE_DRIFT_REPAIR_COMPLETE',
    '',
    'Optionally precede the sentinel with a short summary of files changed (one line per file). Example:',
    '  packages/zendesk/src/webhook-normalizer.ts: header constant renamed; empty-body fallback added',
    '  CODE_DRIFT_REPAIR_COMPLETE',
    '',
    'Failure context:',
    safeJson({
      failedStep: options.failedStep,
      previousRunId: options.previousRunId,
      attempt: options.attempt,
      maxAttempts: options.maxAttempts,
    }),
  ].join('\n');
}

function isCompletionAcknowledged(output: string | undefined | null): boolean {
  if (!output) return false;
  return /^\s*CODE_DRIFT_REPAIR_COMPLETE\s*$/m.test(output);
}

function extractRepairSummary(output: string | undefined | null): string | undefined {
  if (!output) return undefined;
  // Take the lines immediately preceding the sentinel as the summary.
  const lines = output.split(/\r?\n/);
  const idx = lines.findIndex((line) => /^\s*CODE_DRIFT_REPAIR_COMPLETE\s*$/.test(line));
  if (idx < 0) return undefined;
  const back = lines
    .slice(Math.max(0, idx - 10), idx)
    .map((line) => line.trim())
    .filter(Boolean);
  if (back.length === 0) return undefined;
  return back.join(' ');
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch (error) {
    return JSON.stringify({ error: error instanceof Error ? error.message : String(error) }, null, 2);
  }
}

// ---------------------------------------------------------------------------
// Drift report discovery + schema validation
// ---------------------------------------------------------------------------

/**
 * Recursively scans `<cwd>/.workflow-artifacts/**` for `*-drift.json` files
 * created at or after `runStartTimeMs`, parses each, and returns the subset
 * that:
 *   1. Conform to the drift-report schema
 *   2. Have verdict === 'DRIFT'
 *   3. Contain at least one blocker- or major-severity finding
 *
 * Returns null if no actionable reports are found, signalling that the
 * caller should fall back to the regular workflow-repair path.
 */
export async function discoverDriftReports(
  cwd: string,
  runStartTimeMs: number,
): Promise<DriftReport[] | null> {
  const root = isAbsolute(cwd) ? cwd : resolve(process.cwd(), cwd);
  const artifactsDir = resolve(root, '.workflow-artifacts');

  let driftFiles: string[];
  try {
    driftFiles = await collectDriftJsonFiles(artifactsDir);
  } catch {
    return null;
  }

  const reports: DriftReport[] = [];
  for (const filePath of driftFiles) {
    try {
      const stat = await (await import('node:fs/promises')).stat(filePath);
      if (stat.mtimeMs < runStartTimeMs) continue;

      const raw = await readFile(filePath, 'utf8');
      const parsed: unknown = JSON.parse(raw);
      if (!isDriftReportShape(parsed)) continue;

      const parsedRecord = parsed as unknown as Record<string, unknown>;
      // Auto-fix is ON by default. The workflow can opt out by emitting
      // `"autofix": false` in the drift report. Any value other than the
      // exact boolean `false` is treated as "use the default" (ON), which
      // matches "fail-safe to the most useful behavior" — a workflow that
      // accidentally emits e.g. autofix:"no" still gets repaired.
      const autofixOptOut = parsedRecord.autofix === false;
      const report: DriftReport = {
        filePath,
        verdict: parsed.verdict,
        findings: Array.isArray(parsed.findings) ? (parsed.findings as DriftFinding[]) : [],
        autofix: !autofixOptOut,
        raw: parsedRecord,
      };
      const slugValue = parsedRecord.slug;
      if (typeof slugValue === 'string') {
        report.slug = slugValue;
      }
      const expectedValue = parsedRecord.expected;
      if (isPlainRecord(expectedValue)) {
        report.expected = expectedValue;
      }
      const actualValue = parsedRecord.actual;
      if (isPlainRecord(actualValue)) {
        report.actual = actualValue;
      }
      const sourcesValue = parsedRecord.sources;
      if (isPlainRecord(sourcesValue)) {
        report.sources = sourcesValue as Record<string, string>;
      }

      const actionable = actionableFindings(report.findings);
      // Skip reports the workflow opted out of, but only after parsing them
      // so that future telemetry/observability can still see the opt-out.
      if (report.verdict === 'DRIFT' && actionable.length > 0 && report.autofix) {
        reports.push(report);
      }
    } catch {
      // skip malformed files; do not let one bad file block the path
    }
  }

  return reports.length > 0 ? reports : null;
}

async function collectDriftJsonFiles(dir: string): Promise<string[]> {
  const fs = await import('node:fs/promises');
  const out: string[] = [];

  async function walk(current: string): Promise<void> {
    let entries: import('node:fs').Dirent[];
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = resolve(current, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile() && entry.name.endsWith('-drift.json')) {
        out.push(full);
      }
    }
  }

  await walk(dir);
  return out;
}

function isDriftReportShape(value: unknown): value is {
  verdict: 'PASS' | 'DRIFT';
  findings: DriftFinding[];
} {
  if (!isPlainRecord(value)) return false;
  const verdict = (value as { verdict?: unknown }).verdict;
  if (verdict !== 'PASS' && verdict !== 'DRIFT') return false;
  const findings = (value as { findings?: unknown }).findings;
  if (!Array.isArray(findings)) return false;
  // Every finding must have a valid severity AND non-empty string axis +
  // string description. Without the string checks, malformed JSON could
  // pass schema validation, get cast to DriftFinding[], and surface
  // `undefined` values in the agent's repair prompt.
  return findings.every((f) => {
    if (!isPlainRecord(f)) return false;
    const sev = (f as { severity?: unknown }).severity;
    if (sev !== 'blocker' && sev !== 'major' && sev !== 'minor') return false;
    const axis = (f as { axis?: unknown }).axis;
    const description = (f as { description?: unknown }).description;
    return (
      typeof axis === 'string' &&
      axis.trim().length > 0 &&
      typeof description === 'string' &&
      description.trim().length > 0
    );
  });
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
