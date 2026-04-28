import { summarizeEvidence } from '../../runtime/evidence/capture.js';
import { classifyFailure } from '../../runtime/failure/classifier.js';
import { FailureClass, type FailureClassification } from '../../runtime/failure/types.js';
import type { SwarmPattern, WorkflowConfig } from '../../shared/models/workflow-config.js';
import type {
  DeterministicGateResult,
  VerificationResult,
  WorkflowRunEvidence,
  WorkflowStepEvidence,
} from '../../shared/models/workflow-evidence.js';
import type {
  FindingCategory,
  FindingSeverity,
  HealthAnalysisInput,
  HealthFinding,
  HealthReport,
  HealthSignal,
  WorkflowHealthSummary,
  WorkflowRunRecord,
  WorkflowShape,
} from './types.js';

const OVERSIZED_VERIFICATION_THRESHOLD = 10;
const OVERSIZED_RETRY_THRESHOLD = 5;
const RETRIES_PER_RUN_THRESHOLD = 2;
const TIMEOUT_RATE_THRESHOLD = 0.2;
const FLAKINESS_THRESHOLD = 0.5;
const EMPTY_ANALYSIS_TIME = '1970-01-01T00:00:00.000Z';

interface ClassifiedRun {
  record: WorkflowRunRecord;
  classification: FailureClassification;
  retryCount: number;
  durationMs: number | null;
  weakVerification: boolean;
  missingHardGate: boolean;
}

interface WorkflowBucket {
  workflowName: string;
  runs: ClassifiedRun[];
}

export function analyzeHealth(input: HealthAnalysisInput | WorkflowRunRecord[]): HealthReport {
  const normalized = Array.isArray(input) ? { runs: input } : input;
  const records = normalized.runs.filter((record) => isInsideWindow(record.evidence, normalized));
  const classifiedRuns = records.map(classifyRun).sort(compareClassifiedRuns);
  const buckets = groupByWorkflow(classifiedRuns);
  const summaries = buckets.map((bucket) => summarizeWorkflow(bucket)).sort(compareWorkflowSummary);
  const summaryByWorkflow = new Map(summaries.map((s) => [s.workflowName, s]));
  const findings = buckets.flatMap((bucket) => analyzeWorkflow(bucket, summaryByWorkflow.get(bucket.workflowName)!));
  const timeRange = getTimeRange(records.map((record) => record.evidence));

  findings.sort(compareFindings);

  return {
    analyzedAt: timeRange?.latest ?? EMPTY_ANALYSIS_TIME,
    totalRuns: records.length,
    totalWorkflows: summaries.length,
    timeRange,
    overallHealthScore: scoreHealth(findings),
    findings,
    perWorkflowSummary: summaries,
  };
}

function classifyRun(record: WorkflowRunRecord): ClassifiedRun {
  const summary = summarizeEvidence(record.evidence);

  return {
    record,
    classification: classifyFailure(record.evidence),
    retryCount: summary.retryCount,
    durationMs: summary.totalDurationMs ?? null,
    weakVerification: hasWeakVerification(record.evidence),
    missingHardGate: !hasHardGate(record.evidence),
  };
}

function analyzeWorkflow(bucket: WorkflowBucket, summary: WorkflowHealthSummary): HealthFinding[] {
  const findings: HealthFinding[] = [];

  findings.push(...failureDistributionFindings(bucket, summary));
  findings.push(...verificationFindings(bucket));
  findings.push(...oversizedStepFindings(bucket));
  findings.push(...patternChoiceFindings(bucket));
  findings.push(...rateFindings(bucket, summary));
  findings.push(...flakinessFindings(bucket, summary));
  findings.push(...durationOutlierFindings(bucket, summary));

  return findings;
}

function summarizeWorkflow(bucket: WorkflowBucket): WorkflowHealthSummary {
  const runCount = bucket.runs.length;
  const passedRuns = bucket.runs.filter(({ record }) => record.evidence.status === 'passed').length;
  const timeoutRuns = bucket.runs.filter(({ record }) => isTimeoutRun(record.evidence)).length;
  const retryCount = bucket.runs.reduce((total, run) => total + run.retryCount, 0);
  const durations = bucket.runs
    .map((run) => run.durationMs)
    .filter((duration): duration is number => duration !== null)
    .sort((a, b) => a - b);
  const failureClassCounts = countFailureClasses(bucket.runs);
  const pattern = latestPattern(bucket.runs);

  return {
    workflowName: bucket.workflowName,
    runCount,
    passRate: runCount === 0 ? 1 : round(passedRuns / runCount),
    failureClassCounts,
    retryCount,
    retryRate: runCount === 0 ? 0 : round(retryCount / runCount),
    timeoutCount: timeoutRuns,
    timeoutRate: runCount === 0 ? 0 : round(timeoutRuns / runCount),
    avgDurationMs: durations.length === 0 ? null : Math.round(sum(durations) / durations.length),
    p95DurationMs: percentile(durations, 0.95),
    weakVerificationRunCount: bucket.runs.filter((run) => run.weakVerification).length,
    missingHardGateRunCount: bucket.runs.filter((run) => run.missingHardGate).length,
    oversizedStepCount: bucket.runs.reduce(
      (total, run) => total + run.record.evidence.steps.filter(isOversizedStep).length,
      0,
    ),
    hasHardGates: bucket.runs.some((run) => hasHardGate(run.record.evidence)),
    hasReviewStage: bucket.runs.some((run) => hasReviewStage(run.record.evidence)),
    flakinessScore: flakinessScore(bucket.runs),
    ...(pattern ? { pattern } : {}),
  };
}

function failureDistributionFindings(
  bucket: WorkflowBucket,
  summary: WorkflowHealthSummary,
): HealthFinding[] {
  const failedRuns = bucket.runs.filter(({ record }) => record.evidence.status !== 'passed');
  if (failedRuns.length === 0) {
    return [];
  }

  const dominant = Object.entries(summary.failureClassCounts).sort((a, b) => b[1] - a[1])[0];
  if (!dominant) {
    return [];
  }

  const [failureClass, count] = dominant as [FailureClass, number];
  return [
    finding('failure_distribution', severityForFailureRate(failedRuns.length / bucket.runs.length), bucket, {
      title: `${bucket.workflowName} fails mostly as ${failureClass}`,
      summary: `${count} of ${failedRuns.length} failed runs classify as ${failureClass}.`,
      affectedRunIds: failedRuns.map(({ record }) => record.evidence.runId),
      evidence: failedRuns
        .filter((run) => run.classification.failureClass === failureClass)
        .map((run) => ({
          source: 'failure-classifier',
          message: run.classification.summary,
          runId: run.record.evidence.runId,
        })),
      metric: {
        name: 'dominant_failure_class_count',
        value: count,
        unit: 'runs',
      },
    }),
  ];
}

function verificationFindings(bucket: WorkflowBucket): HealthFinding[] {
  const findings: HealthFinding[] = [];
  const weakRuns = bucket.runs.filter((run) => run.weakVerification);
  const missingHardGateRuns = bucket.runs.filter((run) => run.missingHardGate);

  if (weakRuns.length > 0) {
    findings.push(
      finding('weak_verification', weakRuns.length === bucket.runs.length ? 'high' : 'medium', bucket, {
        title: `${bucket.workflowName} has weak deterministic verification`,
        summary: `${weakRuns.length} of ${bucket.runs.length} runs have multi-step evidence without deterministic gates.`,
        affectedRunIds: weakRuns.map(({ record }) => record.evidence.runId),
        evidence: weakRuns.map(({ record }) => ({
          source: 'deterministic-gates',
          message: `${record.evidence.steps.length} steps and no deterministic gates were recorded.`,
          runId: record.evidence.runId,
          value: 0,
          threshold: 1,
        })),
        metric: {
          name: 'weak_verification_runs',
          value: weakRuns.length,
          unit: 'runs',
          threshold: 0,
        },
      }),
    );
  }

  if (missingHardGateRuns.length > 0) {
    findings.push(
      finding(
        'missing_hard_gate',
        missingHardGateRuns.length === bucket.runs.length ? 'high' : 'medium',
        bucket,
        {
          title: `${bucket.workflowName} lacks final hard gates`,
          summary: `${missingHardGateRuns.length} of ${bucket.runs.length} runs lack an exit_code or file_exists hard gate.`,
          affectedRunIds: missingHardGateRuns.map(({ record }) => record.evidence.runId),
          evidence: missingHardGateRuns.map(({ record }) => ({
            source: 'verification-types',
            message: `No passing or failing file_exists/exit_code verification was found in run ${record.evidence.runId}.`,
            runId: record.evidence.runId,
          })),
          metric: {
            name: 'missing_hard_gate_runs',
            value: missingHardGateRuns.length,
            unit: 'runs',
            threshold: 0,
          },
        },
      ),
    );
  }

  return findings;
}

function oversizedStepFindings(bucket: WorkflowBucket): HealthFinding[] {
  const signals: HealthSignal[] = [];
  const affectedRunIds = new Set<string>();

  for (const { record } of bucket.runs) {
    for (const step of record.evidence.steps) {
      if (!isOversizedStep(step)) continue;
      affectedRunIds.add(record.evidence.runId);
      signals.push({
        source: `step:${step.stepId}`,
        message: `${step.stepName} has ${totalVerificationCount(step)} verifications and ${step.retries.length} retries.`,
        runId: record.evidence.runId,
        stepId: step.stepId,
        value: Math.max(totalVerificationCount(step), step.retries.length),
        threshold:
          totalVerificationCount(step) > OVERSIZED_VERIFICATION_THRESHOLD
            ? OVERSIZED_VERIFICATION_THRESHOLD
            : OVERSIZED_RETRY_THRESHOLD,
      });
    }
  }

  if (signals.length === 0) {
    return [];
  }

  return [
    finding('oversized_step', signals.length > 1 ? 'high' : 'medium', bucket, {
      title: `${bucket.workflowName} has oversized steps`,
      summary: `${signals.length} step instances exceed verification or retry size thresholds.`,
      affectedRunIds: [...affectedRunIds],
      evidence: signals,
      metric: {
        name: 'oversized_step_instances',
        value: signals.length,
        unit: 'steps',
        threshold: 0,
      },
    }),
  ];
}

function patternChoiceFindings(bucket: WorkflowBucket): HealthFinding[] {
  const findings: HealthFinding[] = [];
  const latestRun = bucket.runs.at(-1);
  if (!latestRun?.record.config?.pattern) {
    return findings;
  }

  const pattern = latestRun.record.config.pattern;
  const shape = latestRun.record.workflowShape ?? shapeFromMetadata(latestRun.record.config);
  const failureClasses = bucket.runs.map((run) => run.classification.failureClass);
  const deadlockCount = failureClasses.filter((failureClass) => failureClass === FailureClass.Deadlock).length;

  const independentSteps = shape?.steps.filter((step) => (step.dependsOn ?? []).length === 0).length ?? 0;
  const dependencyEdges =
    shape?.steps.reduce((total, step) => total + (step.dependsOn?.length ?? 0), 0) ?? null;

  if (pattern === 'pipeline' && shape && independentSteps > 5) {
    findings.push(
      patternFinding(bucket, pattern, 'medium', {
        summary: `${independentSteps} steps have no dependencies while the workflow uses pipeline.`,
        evidence: [
          {
            source: 'workflow-shape',
            message: `Pipeline pattern serializes ${independentSteps} independent steps; dag would preserve dependency intent.`,
            value: independentSteps,
            threshold: 5,
          },
        ],
      }),
    );
  }

  if (pattern === 'dag' && shape && shape.steps.length > 2 && dependencyEdges === shape.steps.length - 1) {
    findings.push(
      patternFinding(bucket, pattern, 'low', {
        summary: `${shape.steps.length} steps form a linear dependency chain while the workflow uses dag.`,
        evidence: [
          {
            source: 'workflow-shape',
            message: `All dependencies form a single chain; pipeline would be simpler for this shape.`,
            value: dependencyEdges,
            threshold: shape.steps.length - 1,
          },
        ],
      }),
    );
  }

  if (deadlockCount >= 2 && pattern !== 'pipeline') {
    findings.push(
      patternFinding(bucket, pattern, 'high', {
        summary: `${deadlockCount} runs classified as deadlock under ${pattern}.`,
        evidence: bucket.runs
          .filter((run) => run.classification.failureClass === FailureClass.Deadlock)
          .map((run) => ({
            source: 'failure-classifier',
            message: run.classification.summary,
            runId: run.record.evidence.runId,
          })),
      }),
    );
  }

  return findings;
}

function rateFindings(bucket: WorkflowBucket, summary: WorkflowHealthSummary): HealthFinding[] {
  const findings: HealthFinding[] = [];

  if (summary.retryRate > RETRIES_PER_RUN_THRESHOLD) {
    findings.push(
      finding('retry_rate', summary.retryRate > RETRIES_PER_RUN_THRESHOLD * 2 ? 'high' : 'medium', bucket, {
        title: `${bucket.workflowName} has excessive retries`,
        summary: `${summary.retryCount} retries across ${summary.runCount} runs (${summary.retryRate} per run).`,
        affectedRunIds: bucket.runs
          .filter((run) => run.retryCount > 0)
          .map(({ record }) => record.evidence.runId),
        evidence: bucket.runs
          .filter((run) => run.retryCount > 0)
          .map((run) => ({
            source: 'retry-evidence',
            message: `${run.retryCount} retries recorded in run ${run.record.evidence.runId}.`,
            runId: run.record.evidence.runId,
            value: run.retryCount,
            threshold: RETRIES_PER_RUN_THRESHOLD,
          })),
        metric: {
          name: 'retries_per_run',
          value: summary.retryRate,
          unit: 'retries/run',
          threshold: RETRIES_PER_RUN_THRESHOLD,
        },
      }),
    );
  }

  if (summary.timeoutRate > TIMEOUT_RATE_THRESHOLD) {
    findings.push(
      finding('timeout_rate', summary.timeoutRate >= 0.5 ? 'high' : 'medium', bucket, {
        title: `${bucket.workflowName} times out repeatedly`,
        summary: `${summary.timeoutCount} of ${summary.runCount} runs timed out (${toPercent(summary.timeoutRate)}).`,
        affectedRunIds: bucket.runs
          .filter(({ record }) => isTimeoutRun(record.evidence))
          .map(({ record }) => record.evidence.runId),
        evidence: bucket.runs
          .filter(({ record }) => isTimeoutRun(record.evidence))
          .map(({ record }) => ({
            source: 'run-status',
            message: `Run ${record.evidence.runId} status is ${record.evidence.status}.`,
            runId: record.evidence.runId,
            value: 1,
            threshold: TIMEOUT_RATE_THRESHOLD,
          })),
        metric: {
          name: 'timeout_rate',
          value: summary.timeoutRate,
          unit: 'ratio',
          threshold: TIMEOUT_RATE_THRESHOLD,
        },
      }),
    );
  }

  return findings;
}

function flakinessFindings(bucket: WorkflowBucket, summary: WorkflowHealthSummary): HealthFinding[] {
  if (bucket.runs.length < 3 || summary.flakinessScore <= FLAKINESS_THRESHOLD) {
    return [];
  }

  return [
    finding('flaky_workflow', summary.flakinessScore >= 0.8 ? 'high' : 'medium', bucket, {
      title: `${bucket.workflowName} alternates pass and fail outcomes`,
      summary: `Run outcomes changed state across ${toPercent(summary.flakinessScore)} of adjacent runs.`,
      affectedRunIds: bucket.runs.map(({ record }) => record.evidence.runId),
      evidence: adjacentTransitions(bucket.runs).map((transition) => ({
        source: 'run-sequence',
        message: `${transition.previous.runId}:${transition.previous.status} -> ${transition.next.runId}:${transition.next.status}`,
        runId: transition.next.runId,
      })),
      metric: {
        name: 'flakiness_score',
        value: summary.flakinessScore,
        unit: 'ratio',
        threshold: FLAKINESS_THRESHOLD,
      },
    }),
  ];
}

function durationOutlierFindings(
  bucket: WorkflowBucket,
  summary: WorkflowHealthSummary,
): HealthFinding[] {
  const runsWithDurations = bucket.runs.filter((run) => run.durationMs !== null);
  if (runsWithDurations.length < 3) {
    return [];
  }

  const outliers = runsWithDurations
    .map((run) => {
      const peerDurations = runsWithDurations
        .filter((peer) => peer !== run)
        .map((peer) => peer.durationMs)
        .filter((duration): duration is number => duration !== null)
        .sort((a, b) => a - b);
      const peerP95 = percentile(peerDurations, 0.95);
      return { run, peerP95 };
    })
    .filter(({ run, peerP95 }) => peerP95 !== null && peerP95 > 0 && run.durationMs! > peerP95 * 2);

  if (outliers.length === 0) {
    return [];
  }

  return [
    finding('duration_outlier', 'low', bucket, {
      title: `${bucket.workflowName} has duration outliers`,
      summary: `${outliers.length} runs took more than 2x the peer p95 duration.`,
      affectedRunIds: outliers.map(({ run }) => run.record.evidence.runId),
      evidence: outliers.map(({ run, peerP95 }) => ({
        source: 'run-duration',
        message: `Run ${run.record.evidence.runId} took ${run.durationMs}ms vs peer p95 ${peerP95}ms.`,
        runId: run.record.evidence.runId,
        value: run.durationMs ?? undefined,
        threshold: peerP95 ?? undefined,
      })),
      metric: {
        name: 'duration_outlier_count',
        value: outliers.length,
        unit: 'runs',
        threshold: 0,
      },
    }),
  ];
}

function patternFinding(
  bucket: WorkflowBucket,
  pattern: SwarmPattern,
  severity: FindingSeverity,
  details: { summary: string; evidence: HealthSignal[] },
): HealthFinding {
  return finding('pattern_choice', severity, bucket, {
    title: `${bucket.workflowName} has a questionable ${pattern} pattern choice`,
    summary: details.summary,
    affectedRunIds: bucket.runs.map(({ record }) => record.evidence.runId),
    evidence: details.evidence,
  });
}

function finding(
  category: FindingCategory,
  severity: FindingSeverity,
  bucket: WorkflowBucket,
  details: Omit<HealthFinding, 'id' | 'category' | 'severity' | 'workflowName'>,
): HealthFinding {
  return {
    id: `${slug(bucket.workflowName)}.${category}.${hash([details.summary, ...details.affectedRunIds])}`,
    category,
    severity,
    workflowName: bucket.workflowName,
    ...details,
  };
}

function hasWeakVerification(evidence: WorkflowRunEvidence): boolean {
  if (evidence.steps.length <= 1) {
    return false;
  }

  return allGates(evidence).length === 0;
}

function hasHardGate(evidence: WorkflowRunEvidence): boolean {
  return allVerifications(evidence).some(
    (verification) => verification.type === 'exit_code' || verification.type === 'file_exists',
  );
}

function hasReviewStage(evidence: WorkflowRunEvidence): boolean {
  return evidence.steps.some((step) =>
    [step.stepId, step.stepName, step.agentRole ?? ''].some((value) => /review|signoff/i.test(value)),
  );
}

function isOversizedStep(step: WorkflowStepEvidence): boolean {
  return (
    totalVerificationCount(step) > OVERSIZED_VERIFICATION_THRESHOLD ||
    step.retries.length > OVERSIZED_RETRY_THRESHOLD
  );
}

function totalVerificationCount(step: WorkflowStepEvidence): number {
  return (
    step.verifications.length +
    step.deterministicGates.reduce((total, gate) => total + gate.verifications.length, 0)
  );
}

function allGates(evidence: WorkflowRunEvidence): DeterministicGateResult[] {
  return [...evidence.deterministicGates, ...evidence.steps.flatMap((step) => step.deterministicGates)];
}

function allVerifications(evidence: WorkflowRunEvidence): VerificationResult[] {
  return [
    ...evidence.steps.flatMap((step) => step.verifications),
    ...allGates(evidence).flatMap((gate) => gate.verifications),
  ];
}

function isTimeoutRun(evidence: WorkflowRunEvidence): boolean {
  return evidence.status === 'timed_out' || evidence.steps.some((step) => step.status === 'timed_out');
}

function countFailureClasses(runs: ClassifiedRun[]): Partial<Record<FailureClass, number>> {
  const counts: Partial<Record<FailureClass, number>> = {};

  for (const run of runs) {
    if (run.record.evidence.status === 'passed') continue;
    const failureClass = run.classification.failureClass;
    counts[failureClass] = (counts[failureClass] ?? 0) + 1;
  }

  return sortRecord(counts);
}

function latestPattern(runs: ClassifiedRun[]): SwarmPattern | undefined {
  for (let i = runs.length - 1; i >= 0; i--) {
    if (runs[i].record.config?.pattern) {
      return runs[i].record.config!.pattern;
    }
  }
  return undefined;
}

function flakinessScore(runs: ClassifiedRun[]): number {
  if (runs.length < 2) {
    return 0;
  }

  return round(adjacentTransitions(runs).length / (runs.length - 1));
}

function adjacentTransitions(runs: ClassifiedRun[]): Array<{
  previous: { runId: string; status: string };
  next: { runId: string; status: string };
}> {
  const transitions = [];

  for (let index = 1; index < runs.length; index += 1) {
    const previous = runs[index - 1].record.evidence;
    const next = runs[index].record.evidence;
    const previousPassed = previous.status === 'passed';
    const nextPassed = next.status === 'passed';

    if (previousPassed !== nextPassed) {
      transitions.push({
        previous: { runId: previous.runId, status: previous.status },
        next: { runId: next.runId, status: next.status },
      });
    }
  }

  return transitions;
}

function shapeFromMetadata(config?: Partial<WorkflowConfig>): WorkflowShape | undefined {
  const metadata = config?.metadata;
  const candidate = metadata?.workflowShape ?? metadata?.shape;
  if (!isWorkflowShape(candidate)) {
    return undefined;
  }
  return candidate;
}

function isWorkflowShape(value: unknown): value is WorkflowShape {
  if (!value || typeof value !== 'object' || !('steps' in value)) {
    return false;
  }

  const steps = (value as { steps: unknown }).steps;
  return Array.isArray(steps) && steps.every(isWorkflowShapeStep);
}

function isWorkflowShapeStep(value: unknown): value is WorkflowShape['steps'][number] {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const step = value as { id?: unknown; dependsOn?: unknown };
  return (
    typeof step.id === 'string' &&
    (step.dependsOn === undefined ||
      (Array.isArray(step.dependsOn) &&
        step.dependsOn.every((dependency) => typeof dependency === 'string')))
  );
}

function groupByWorkflow(runs: ClassifiedRun[]): WorkflowBucket[] {
  const groups = new Map<string, ClassifiedRun[]>();

  for (const run of runs) {
    const workflowName = run.record.evidence.workflowName;
    const group = groups.get(workflowName) ?? [];
    group.push(run);
    groups.set(workflowName, group);
  }

  return [...groups.entries()]
    .map(([workflowName, groupedRuns]) => ({ workflowName, runs: groupedRuns }))
    .sort((a, b) => a.workflowName.localeCompare(b.workflowName));
}

function isInsideWindow(record: WorkflowRunEvidence, input: HealthAnalysisInput): boolean {
  const timestamp = new Date(record.completedAt ?? record.startedAt).getTime();
  const since = input.since ? new Date(input.since).getTime() : Number.NEGATIVE_INFINITY;
  const until = input.until ? new Date(input.until).getTime() : Number.POSITIVE_INFINITY;

  return timestamp >= since && timestamp <= until;
}

function getTimeRange(records: WorkflowRunEvidence[]): HealthReport['timeRange'] {
  if (records.length === 0) {
    return null;
  }

  const timestamps = records
    .flatMap((record) => [record.startedAt, record.completedAt])
    .filter((timestamp): timestamp is string => Boolean(timestamp))
    .sort();

  return {
    earliest: timestamps[0],
    latest: timestamps[timestamps.length - 1],
  };
}

function scoreHealth(findings: HealthFinding[]): number {
  const penalties: Record<FindingSeverity, number> = {
    critical: 35,
    high: 20,
    medium: 10,
    low: 4,
    info: 1,
  };

  return Math.max(
    0,
    100 - findings.reduce((total, finding) => total + penalties[finding.severity], 0),
  );
}

function severityForFailureRate(rate: number): FindingSeverity {
  if (rate >= 0.8) return 'critical';
  if (rate >= 0.5) return 'high';
  if (rate >= 0.2) return 'medium';
  return 'low';
}

function percentile(values: number[], percentileValue: number): number | null {
  if (values.length === 0) {
    return null;
  }

  const index = Math.ceil(values.length * percentileValue) - 1;
  return values[Math.min(Math.max(index, 0), values.length - 1)];
}

function compareClassifiedRuns(a: ClassifiedRun, b: ClassifiedRun): number {
  return (
    a.record.evidence.workflowName.localeCompare(b.record.evidence.workflowName) ||
    a.record.evidence.startedAt.localeCompare(b.record.evidence.startedAt) ||
    a.record.evidence.runId.localeCompare(b.record.evidence.runId)
  );
}

function compareWorkflowSummary(a: WorkflowHealthSummary, b: WorkflowHealthSummary): number {
  return a.workflowName.localeCompare(b.workflowName);
}

function compareFindings(a: HealthFinding, b: HealthFinding): number {
  return (
    severityRank(a.severity) - severityRank(b.severity) ||
    a.workflowName.localeCompare(b.workflowName) ||
    a.category.localeCompare(b.category) ||
    a.id.localeCompare(b.id)
  );
}

function severityRank(severity: FindingSeverity): number {
  const rank: Record<FindingSeverity, number> = {
    critical: 0,
    high: 1,
    medium: 2,
    low: 3,
    info: 4,
  };
  return rank[severity];
}

function sortRecord<T extends string>(record: Partial<Record<T, number>>): Partial<Record<T, number>> {
  return Object.fromEntries(Object.entries(record).sort(([a], [b]) => a.localeCompare(b))) as Partial<
    Record<T, number>
  >;
}

function hash(parts: string[]): string {
  const joined = parts.join('|');
  let value = 0;

  for (let index = 0; index < joined.length; index += 1) {
    value = (value * 31 + joined.charCodeAt(index)) >>> 0;
  }

  return value.toString(36);
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'workflow';
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function toPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}
