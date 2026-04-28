import { describe, expect, it } from 'vitest';

import { FailureClass } from '../../runtime/failure/types.js';
import type {
  DeterministicGateResult,
  RunStatus,
  VerificationResult,
  VerificationType,
  WorkflowRunEvidence,
  WorkflowStepEvidence,
} from '../../shared/models/workflow-evidence.js';
import { generateDigest } from './digest-generator.js';
import { analyzeHealth } from './health-analyzer.js';
import type { WorkflowRunRecord } from './types.js';

const START = '2026-04-26T00:00:00.000Z';

describe('workflow health analytics', () => {
  it('returns a deterministic empty report', () => {
    const report = analyzeHealth({ runs: [] });
    const digest = generateDigest(report);

    expect(report).toMatchObject({
      analyzedAt: '1970-01-01T00:00:00.000Z',
      totalRuns: 0,
      totalWorkflows: 0,
      timeRange: null,
      overallHealthScore: 100,
      findings: [],
      perWorkflowSummary: [],
    });
    expect(digest).toMatchObject({
      generatedAt: '1970-01-01T00:00:00.000Z',
      topLineStatus: 'healthy',
      healthScore: 100,
      findings: [],
      recommendations: [],
      report: expect.objectContaining({
        totalRuns: 0,
        totalWorkflows: 0,
        timeRange: null,
      }),
    });
    expect(digest.topLineSummary).toBe(
      'Health score 100: no workflow health findings across 0 analyzed runs.',
    );
  });

  it('summarizes healthy passing history without findings', () => {
    const report = analyzeHealth({
      runs: [
        record(run({ runId: 'run-1', durationMs: 100 })),
        record(run({ runId: 'run-2', durationMs: 120 })),
        record(run({ runId: 'run-3', durationMs: 90 })),
      ],
    });

    expect(report.totalRuns).toBe(3);
    expect(report.overallHealthScore).toBe(100);
    expect(report.findings).toEqual([]);
    expect(report.perWorkflowSummary[0]).toMatchObject({
      workflowName: 'release-health',
      runCount: 3,
      passRate: 1,
      retryRate: 0,
      timeoutRate: 0,
      hasHardGates: true,
    });
  });

  it('counts failure classes and emits concrete failure distribution findings', () => {
    const report = analyzeHealth({
      runs: [
        record(run({ runId: 'timeout-1', status: 'timed_out', stepStatus: 'timed_out' })),
        record(run({ runId: 'timeout-2', status: 'timed_out', stepStatus: 'timed_out' })),
        record(
          run({
            runId: 'verify-1',
            status: 'failed',
            verifications: [verification({ passed: false, actual: 'missing report.md' })],
          }),
        ),
        record(
          run({
            runId: 'env-1',
            status: 'failed',
            stepStatus: 'failed',
            error: 'ENOENT: command not found',
          }),
        ),
      ],
    });

    expect(report.perWorkflowSummary[0].failureClassCounts).toMatchObject({
      [FailureClass.Timeout]: 2,
      [FailureClass.VerificationFailure]: 1,
      [FailureClass.EnvironmentError]: 1,
    });
    expect(report.perWorkflowSummary[0]).toMatchObject({
      runCount: 4,
      passRate: 0,
      timeoutCount: 2,
      timeoutRate: 0.5,
    });

    const distribution = findFinding(report, 'failure_distribution');
    expect(distribution).toMatchObject({
      severity: 'critical',
      affectedRunIds: ['env-1', 'timeout-1', 'timeout-2', 'verify-1'],
      metric: {
        name: 'dominant_failure_class_count',
        value: 2,
        unit: 'runs',
      },
    });
    expect(distribution.summary).toBe('2 of 4 failed runs classify as timeout.');
    expect(distribution.evidence).toEqual([
      expect.objectContaining({ source: 'failure-classifier', runId: 'timeout-1' }),
      expect.objectContaining({ source: 'failure-classifier', runId: 'timeout-2' }),
    ]);
  });

  it('detects weak verification, missing hard gates, oversized steps, retries, and timeouts', () => {
    const report = analyzeHealth({
      runs: [
        record(
          run({
            runId: 'weak-1',
            status: 'failed',
            steps: [
              step({ stepId: 'build', verifications: [] }),
              step({ stepId: 'check', verifications: [] }),
            ],
          }),
        ),
        record(
          run({
            runId: 'oversized-1',
            status: 'failed',
            stepStatus: 'failed',
            retries: 7,
            verifications: Array.from({ length: 12 }, (_, index) =>
              verification({ expected: `check ${index}`, actual: `failed ${index}`, passed: false }),
            ),
          }),
        ),
        record(run({ runId: 'timeout-1', status: 'timed_out', stepStatus: 'timed_out' })),
      ],
    });

    const categories = report.findings.map((finding) => finding.category);
    expect(categories).toContain('weak_verification');
    expect(categories).toContain('missing_hard_gate');
    expect(categories).toContain('oversized_step');
    expect(categories).toContain('retry_rate');
    expect(categories).toContain('timeout_rate');

    expect(report.perWorkflowSummary[0]).toMatchObject({
      runCount: 3,
      retryCount: 7,
      retryRate: 2.333,
      timeoutCount: 1,
      timeoutRate: 0.333,
      weakVerificationRunCount: 1,
      missingHardGateRunCount: 1,
      oversizedStepCount: 1,
    });

    expect(findFinding(report, 'weak_verification')).toMatchObject({
      affectedRunIds: ['weak-1'],
      metric: { name: 'weak_verification_runs', value: 1, threshold: 0 },
      evidence: [
        expect.objectContaining({
          source: 'deterministic-gates',
          runId: 'weak-1',
          value: 0,
          threshold: 1,
        }),
      ],
    });
    expect(findFinding(report, 'missing_hard_gate')).toMatchObject({
      affectedRunIds: ['weak-1'],
      metric: { name: 'missing_hard_gate_runs', value: 1, threshold: 0 },
    });
    expect(findFinding(report, 'oversized_step')).toMatchObject({
      affectedRunIds: ['oversized-1'],
      metric: { name: 'oversized_step_instances', value: 1, threshold: 0 },
      evidence: [
        expect.objectContaining({
          source: 'step:main',
          runId: 'oversized-1',
          stepId: 'main',
          value: 12,
          threshold: 10,
        }),
      ],
    });
    expect(findFinding(report, 'retry_rate')).toMatchObject({
      affectedRunIds: ['oversized-1'],
      metric: { name: 'retries_per_run', value: 2.333, threshold: 2 },
      evidence: [expect.objectContaining({ runId: 'oversized-1', value: 7, threshold: 2 })],
    });
    expect(findFinding(report, 'timeout_rate')).toMatchObject({
      affectedRunIds: ['timeout-1'],
      metric: { name: 'timeout_rate', value: 0.333, threshold: 0.2 },
      evidence: [expect.objectContaining({ runId: 'timeout-1', value: 1, threshold: 0.2 })],
    });
  });

  it('detects pattern-choice warnings from structured workflow shape', () => {
    const report = analyzeHealth({
      runs: [
        record(run({ runId: 'shape-1' }), {
          config: { pattern: 'pipeline' },
          workflowShape: {
            steps: Array.from({ length: 6 }, (_, index) => ({ id: `independent-${index}` })),
          },
        }),
      ],
    });

    expect(report.findings).toEqual([
      expect.objectContaining({
        category: 'pattern_choice',
        workflowName: 'release-health',
        summary: expect.stringContaining('6 steps have no dependencies'),
        affectedRunIds: ['shape-1'],
        evidence: [
          expect.objectContaining({
            source: 'workflow-shape',
            value: 6,
            threshold: 5,
          }),
        ],
      }),
    ]);
  });

  it('detects flaky workflows and duration outliers', () => {
    const report = analyzeHealth({
      runs: [
        record(run({ runId: 'r1', status: 'passed', startedAt: '2026-04-26T00:00:01.000Z', durationMs: 100 })),
        record(run({ runId: 'r2', status: 'failed', startedAt: '2026-04-26T00:00:02.000Z', durationMs: 110 })),
        record(run({ runId: 'r3', status: 'passed', startedAt: '2026-04-26T00:00:03.000Z', durationMs: 105 })),
        record(run({ runId: 'r4', status: 'failed', startedAt: '2026-04-26T00:00:04.000Z', durationMs: 1000 })),
      ],
    });

    expect(report.findings.map((finding) => finding.category)).toContain('flaky_workflow');
    expect(report.findings.map((finding) => finding.category)).toContain('duration_outlier');
    expect(report.perWorkflowSummary[0].flakinessScore).toBe(1);
  });

  it('handles single-run history without crashing on flakiness or duration outlier', () => {
    const report = analyzeHealth({
      runs: [record(run({ runId: 'solo-1', durationMs: 500 }))],
    });

    expect(report.totalRuns).toBe(1);
    expect(report.totalWorkflows).toBe(1);
    expect(report.perWorkflowSummary[0]).toMatchObject({
      runCount: 1,
      passRate: 1,
      flakinessScore: 0,
    });
    // Flakiness requires >=3 runs, duration outlier requires >=3 runs
    expect(report.findings.map((f) => f.category)).not.toContain('flaky_workflow');
    expect(report.findings.map((f) => f.category)).not.toContain('duration_outlier');
  });

  it('filters runs by time window using since/until', () => {
    const report = analyzeHealth({
      runs: [
        record(run({ runId: 'before', startedAt: '2026-04-20T00:00:00.000Z', completedAt: '2026-04-20T00:01:00.000Z' })),
        record(run({ runId: 'inside', startedAt: '2026-04-25T00:00:00.000Z', completedAt: '2026-04-25T00:01:00.000Z' })),
        record(run({ runId: 'after', startedAt: '2026-04-28T00:00:00.000Z', completedAt: '2026-04-28T00:01:00.000Z' })),
      ],
      since: '2026-04-24T00:00:00.000Z',
      until: '2026-04-26T00:00:00.000Z',
    });

    expect(report.totalRuns).toBe(1);
    expect(report.perWorkflowSummary[0].runCount).toBe(1);
  });

  it('falls back to startedAt when completedAt is missing for time filtering', () => {
    const evidence = run({ runId: 'no-completed', startedAt: '2026-04-25T00:00:00.000Z' });
    // Remove completedAt to trigger fallback path
    delete (evidence as Partial<typeof evidence>).completedAt;

    const report = analyzeHealth({
      runs: [record(evidence)],
      since: '2026-04-24T00:00:00.000Z',
      until: '2026-04-26T00:00:00.000Z',
    });

    expect(report.totalRuns).toBe(1);
  });

  it('respects exact threshold boundaries for oversized steps', () => {
    // Exactly at threshold (10 verifications) — should NOT be oversized
    const atThreshold = analyzeHealth({
      runs: [
        record(
          run({
            runId: 'at-10',
            status: 'failed',
            verifications: Array.from({ length: 10 }, (_, i) =>
              verification({ expected: `check ${i}`, actual: `ok ${i}`, passed: true }),
            ),
          }),
        ),
      ],
    });
    expect(atThreshold.findings.map((f) => f.category)).not.toContain('oversized_step');

    // Just above threshold (11 verifications) — should be oversized
    const aboveThreshold = analyzeHealth({
      runs: [
        record(
          run({
            runId: 'at-11',
            status: 'failed',
            verifications: Array.from({ length: 11 }, (_, i) =>
              verification({ expected: `check ${i}`, actual: `ok ${i}`, passed: true }),
            ),
          }),
        ),
      ],
    });
    expect(aboveThreshold.findings.map((f) => f.category)).toContain('oversized_step');
  });

  it('respects exact threshold boundary for retry oversized steps (5 retries)', () => {
    // At threshold (5 retries) — NOT oversized
    const atRetryThreshold = analyzeHealth({
      runs: [record(run({ runId: 'r5', status: 'failed', retries: 5 }))],
    });
    expect(atRetryThreshold.findings.map((f) => f.category)).not.toContain('oversized_step');

    // Above threshold (6 retries) — oversized
    const aboveRetryThreshold = analyzeHealth({
      runs: [record(run({ runId: 'r6', status: 'failed', retries: 6 }))],
    });
    expect(aboveRetryThreshold.findings.map((f) => f.category)).toContain('oversized_step');
  });

  it('respects exact retry rate threshold boundary (2 retries per run)', () => {
    const atThreshold = analyzeHealth({
      runs: [
        record(run({ runId: 'retry-1', status: 'failed', retries: 2 })),
        record(run({ runId: 'retry-2', status: 'failed', retries: 2 })),
      ],
    });
    expect(atThreshold.perWorkflowSummary[0].retryRate).toBe(2);
    expect(atThreshold.findings.map((f) => f.category)).not.toContain('retry_rate');
  });

  it('respects exact timeout rate threshold boundary (0.2)', () => {
    // Exactly at threshold: 1/5 = 0.2 — NOT above threshold
    const atThreshold = analyzeHealth({
      runs: [
        record(run({ runId: 't1', status: 'timed_out', stepStatus: 'timed_out' })),
        record(run({ runId: 'p1' })),
        record(run({ runId: 'p2' })),
        record(run({ runId: 'p3' })),
        record(run({ runId: 'p4' })),
      ],
    });
    expect(atThreshold.findings.map((f) => f.category)).not.toContain('timeout_rate');
  });

  it('respects exact flakiness threshold boundary (0.5)', () => {
    // 3 runs, 1 transition out of 2 pairs = 0.5 — NOT above threshold
    const atThreshold = analyzeHealth({
      runs: [
        record(run({ runId: 'a1', status: 'passed', startedAt: '2026-04-26T00:00:01.000Z' })),
        record(run({ runId: 'a2', status: 'failed', startedAt: '2026-04-26T00:00:02.000Z' })),
        record(run({ runId: 'a3', status: 'failed', startedAt: '2026-04-26T00:00:03.000Z' })),
      ],
    });
    expect(atThreshold.findings.map((f) => f.category)).not.toContain('flaky_workflow');
  });

  it('sorts multiple workflow summaries deterministically by name', () => {
    const report = analyzeHealth({
      runs: [
        record(run({ runId: 'z1', workflowName: 'zebra-deploy', workflowId: 'wf-zebra' })),
        record(run({ runId: 'a1', workflowName: 'alpha-build', workflowId: 'wf-alpha' })),
        record(run({ runId: 'm1', workflowName: 'mid-test', workflowId: 'wf-mid' })),
      ],
    });

    expect(report.perWorkflowSummary.map((s) => s.workflowName)).toEqual([
      'alpha-build',
      'mid-test',
      'zebra-deploy',
    ]);
  });

  it('derives workflow shape from config metadata', () => {
    const report = analyzeHealth({
      runs: [
        record(run({ runId: 'meta-1' }), {
          config: {
            pattern: 'pipeline',
            metadata: {
              workflowShape: {
                steps: Array.from({ length: 7 }, (_, i) => ({ id: `s-${i}` })),
              },
            },
          },
        }),
      ],
    });

    expect(report.findings).toEqual([
      expect.objectContaining({
        category: 'pattern_choice',
        evidence: [expect.objectContaining({ value: 7, threshold: 5 })],
      }),
    ]);
  });

  it('detects dag linear-chain pattern warning', () => {
    const report = analyzeHealth({
      runs: [
        record(run({ runId: 'dag-linear-1' }), {
          config: { pattern: 'dag' },
          workflowShape: {
            steps: [
              { id: 's1' },
              { id: 's2', dependsOn: ['s1'] },
              { id: 's3', dependsOn: ['s2'] },
            ],
          },
        }),
      ],
    });

    const patternFinding = report.findings.find((f) => f.category === 'pattern_choice');
    expect(patternFinding).toBeDefined();
    expect(patternFinding!.severity).toBe('low');
    expect(patternFinding!.summary).toContain('linear dependency chain');
    expect(patternFinding!.evidence[0]).toMatchObject({
      source: 'workflow-shape',
      value: 2,
      threshold: 2,
    });
  });

  it('detects repeated deadlocks under non-pipeline pattern', () => {
    // Deadlock requires: run status 'failed', steps all non-terminal (pending/running)
    const deadlockRun = (runId: string) =>
      run({
        runId,
        status: 'failed',
        steps: [
          step({ stepId: 'agent-a', status: 'pending' }),
          step({ stepId: 'agent-b', status: 'pending' }),
        ],
      });

    const report = analyzeHealth({
      runs: [
        record(deadlockRun('dl-1'), { config: { pattern: 'dag' } }),
        record(deadlockRun('dl-2'), { config: { pattern: 'dag' } }),
      ],
    });

    const patternFinding = report.findings.find(
      (f) => f.category === 'pattern_choice' && f.summary.includes('deadlock'),
    );
    expect(patternFinding).toBeDefined();
    expect(patternFinding!.severity).toBe('high');
    expect(patternFinding!.evidence.length).toBe(2);
  });

  it('deduplicates digest recommendations for same workflow and category', () => {
    // Create a scenario where weak_verification and missing_hard_gate both fire
    // for the same workflow — they are different categories so each gets its own recommendation.
    // But if we had two pattern_choice findings for the same workflow, they should merge.
    const report = analyzeHealth({
      runs: [
        record(
          run({
            runId: 'weak-1',
            status: 'failed',
            steps: [
              step({ stepId: 'build', verifications: [] }),
              step({ stepId: 'check', verifications: [] }),
            ],
          }),
        ),
      ],
    });

    const digest = generateDigest(report);
    // weak_verification and missing_hard_gate are different categories → separate recommendations
    const weakRec = digest.recommendations.filter((r) => r.title.includes('verification'));
    const gateRec = digest.recommendations.filter((r) => r.title.includes('hard gate'));
    expect(weakRec.length).toBe(1);
    expect(gateRec.length).toBe(1);
    // Each recommendation references exactly one finding
    expect(weakRec[0].relatedFindings.length).toBe(1);
    expect(gateRec[0].relatedFindings.length).toBe(1);
  });

  it('merges digest recommendations when multiple findings share the same workflow and category', () => {
    // DAG with a linear chain shape AND repeated deadlocks → two pattern_choice findings
    const deadlockRun = (runId: string) =>
      run({
        runId,
        status: 'failed',
        steps: [
          step({ stepId: 'agent-a', status: 'pending' }),
          step({ stepId: 'agent-b', status: 'pending' }),
          step({ stepId: 'agent-c', status: 'pending' }),
        ],
      });

    const report = analyzeHealth({
      runs: [
        record(deadlockRun('dl-1'), {
          config: { pattern: 'dag' },
          workflowShape: {
            steps: [
              { id: 'agent-a' },
              { id: 'agent-b', dependsOn: ['agent-a'] },
              { id: 'agent-c', dependsOn: ['agent-b'] },
            ],
          },
        }),
        record(deadlockRun('dl-2'), {
          config: { pattern: 'dag' },
          workflowShape: {
            steps: [
              { id: 'agent-a' },
              { id: 'agent-b', dependsOn: ['agent-a'] },
              { id: 'agent-c', dependsOn: ['agent-b'] },
            ],
          },
        }),
      ],
    });

    // Both DAG linear chain and deadlock findings should be pattern_choice
    const patternFindings = report.findings.filter((f) => f.category === 'pattern_choice');
    expect(patternFindings.length).toBe(2);

    const digest = generateDigest(report);
    // Two same-category same-workflow findings should merge into one recommendation
    const patternRecs = digest.recommendations.filter((r) => r.title.includes('pattern'));
    expect(patternRecs.length).toBe(1);
    // Merged recommendation references both findings
    expect(patternRecs[0].relatedFindings.length).toBe(2);
    expect(patternRecs[0].relatedFindings).toContain(patternFindings[0].id);
    expect(patternRecs[0].relatedFindings).toContain(patternFindings[1].id);
    // Merged description combines both summaries
    expect(patternRecs[0].description).toContain('linear dependency chain');
    expect(patternRecs[0].description).toContain('deadlock');
    // Priority should be immediate (highest severity among the merged findings is high from deadlock)
    expect(patternRecs[0].priority).toBe('immediate');
  });

  it('generates structured digest findings with evidence and recommended actions', () => {
    const report = analyzeHealth({
      runs: [
        record(
          run({
            runId: 'weak-1',
            status: 'failed',
            steps: [
              step({ stepId: 'implement', verifications: [] }),
              step({ stepId: 'verify', verifications: [] }),
            ],
          }),
        ),
      ],
    });

    const digest = generateDigest(report);

    expect(digest.generatedAt).toBe(report.analyzedAt);
    expect(digest.topLineStatus).toBe('unhealthy');
    expect(digest.topLineSummary).toContain('Signal:');
    expect(digest.report).toBe(report);

    const weakVerification = digest.findings.find((finding) => finding.category === 'weak_verification');
    expect(weakVerification).toMatchObject({
      severity: 'high',
      workflowName: 'release-health',
      evidence: [
        expect.objectContaining({
          source: 'deterministic-gates',
          runId: 'weak-1',
        }),
      ],
      recommendedAction: expect.stringContaining('Signal: 2 steps and no deterministic gates were recorded.'),
    });

    const recommendation = digest.recommendations.find((item) =>
      item.relatedFindings.includes(weakVerification!.id),
    );
    expect(recommendation).toMatchObject({
      priority: 'immediate',
      workflowNames: ['release-health'],
      suggestedAction: weakVerification!.recommendedAction,
    });
    expect(recommendation!.relatedFindings).toEqual([weakVerification!.id]);
    expect(recommendation!.description).toBe(weakVerification!.summary);
    expect(recommendation!.suggestedAction).toContain(weakVerification!.evidence[0].message);
  });

  it('ties every digest recommendation to concrete finding evidence', () => {
    const report = analyzeHealth({
      runs: [
        record(
          run({
            runId: 'weak-1',
            status: 'failed',
            startedAt: '2026-04-26T00:00:01.000Z',
            steps: [
              step({ stepId: 'build', verifications: [] }),
              step({ stepId: 'check', verifications: [] }),
            ],
          }),
        ),
        record(
          run({
            runId: 'oversized-1',
            status: 'failed',
            startedAt: '2026-04-26T00:00:02.000Z',
            stepStatus: 'failed',
            retries: 12,
            verifications: Array.from({ length: 12 }, (_, index) =>
              verification({ expected: `check ${index}`, actual: `failed ${index}`, passed: false }),
            ),
          }),
        ),
        record(run({ runId: 'timeout-1', status: 'timed_out', stepStatus: 'timed_out' })),
        record(run({ runId: 'timeout-2', status: 'timed_out', stepStatus: 'timed_out' })),
        record(run({ runId: 'timeout-3', status: 'timed_out', stepStatus: 'timed_out' })),
      ],
    });

    const digest = generateDigest(report);

    expect(digest.findings.map((finding) => finding.category)).toEqual([
      'failure_distribution',
      'timeout_rate',
      'missing_hard_gate',
      'oversized_step',
      'retry_rate',
      'weak_verification',
    ]);
    expect(digest.recommendations).toHaveLength(digest.findings.length);

    for (const finding of digest.findings) {
      const recommendation = digest.recommendations.find((item) =>
        item.relatedFindings.includes(finding.id),
      );

      expect(recommendation).toBeDefined();
      expect(recommendation).toMatchObject({
        workflowNames: [finding.workflowName],
        suggestedAction: finding.recommendedAction,
      });
      expect(recommendation!.description).toBe(finding.summary);
      expect(recommendation!.suggestedAction).toContain(finding.evidence[0].message);
      expect(recommendation!.suggestedAction).toContain(finding.workflowName);
    }
  });
});

function findFinding(report: ReturnType<typeof analyzeHealth>, category: string) {
  const finding = report.findings.find((candidate) => candidate.category === category);
  expect(finding).toBeDefined();
  return finding!;
}

function record(
  evidence: WorkflowRunEvidence,
  extras: Omit<WorkflowRunRecord, 'evidence'> = {},
): WorkflowRunRecord {
  return { evidence, ...extras };
}

function run(
  overrides: Partial<WorkflowRunEvidence> & {
    stepStatus?: WorkflowStepEvidence['status'];
    verifications?: VerificationResult[];
    retries?: number;
    error?: string;
  } = {},
): WorkflowRunEvidence {
  const defaultStep = step({
    status: overrides.stepStatus ?? (overrides.status === 'failed' ? 'failed' : 'passed'),
    verifications: overrides.verifications ?? [verification()],
    deterministicGates:
      overrides.verifications === undefined
        ? [
            gate({
              verifications: [verification({ type: 'exit_code' })],
            }),
          ]
        : [],
    retries: Array.from({ length: overrides.retries ?? 0 }, (_, index) => ({
      attempt: index + 1,
      stepId: 'main',
      status: 'failed',
      error: `retry ${index + 1}`,
    })),
    error: overrides.error,
  });

  return {
    runId: overrides.runId ?? 'run-1',
    workflowId: overrides.workflowId ?? 'wf-release-health',
    workflowName: overrides.workflowName ?? 'release-health',
    status: overrides.status ?? 'passed',
    startedAt: overrides.startedAt ?? START,
    completedAt: overrides.completedAt ?? '2026-04-26T00:01:00.000Z',
    durationMs: overrides.durationMs ?? 100,
    steps: overrides.steps ?? [defaultStep],
    deterministicGates: overrides.deterministicGates ?? [],
    artifacts: overrides.artifacts ?? [],
    logs: overrides.logs ?? [],
    narrative: overrides.narrative ?? [],
    routing: overrides.routing ?? [],
    finalSignoffPath: overrides.finalSignoffPath,
  };
}

function step(overrides: Partial<WorkflowStepEvidence> = {}): WorkflowStepEvidence {
  return {
    stepId: overrides.stepId ?? 'main',
    stepName: overrides.stepName ?? overrides.stepId ?? 'Main',
    status: overrides.status ?? 'passed',
    startedAt: overrides.startedAt ?? START,
    completedAt: overrides.completedAt ?? '2026-04-26T00:01:00.000Z',
    durationMs: overrides.durationMs ?? 100,
    verifications: overrides.verifications ?? [verification()],
    deterministicGates: overrides.deterministicGates ?? [],
    logs: overrides.logs ?? [],
    artifacts: overrides.artifacts ?? [],
    history: overrides.history ?? [],
    retries: overrides.retries ?? [],
    narrative: overrides.narrative ?? [],
    agentRole: overrides.agentRole,
    routing: overrides.routing,
    error: overrides.error,
    retryOf: overrides.retryOf,
  };
}

function gate(overrides: Partial<DeterministicGateResult> = {}): DeterministicGateResult {
  return {
    gateName: overrides.gateName ?? 'typecheck',
    passed: overrides.passed ?? true,
    verifications: overrides.verifications ?? [verification({ type: 'exit_code' })],
    recordedAt: overrides.recordedAt ?? START,
    command: overrides.command,
    exitCode: overrides.exitCode,
    stdoutExcerpt: overrides.stdoutExcerpt,
    stderrExcerpt: overrides.stderrExcerpt,
    outputExcerpt: overrides.outputExcerpt,
    artifacts: overrides.artifacts,
  };
}

function verification(
  overrides: Partial<VerificationResult> & { type?: VerificationType; status?: RunStatus } = {},
): VerificationResult {
  return {
    type: overrides.type ?? 'exit_code',
    passed: overrides.passed ?? true,
    expected: overrides.expected ?? 'command exits 0',
    actual: overrides.actual ?? 'command exited 0',
    message: overrides.message,
    recordedAt: overrides.recordedAt ?? START,
    command: overrides.command,
    exitCode: overrides.exitCode,
    stdoutExcerpt: overrides.stdoutExcerpt,
    stderrExcerpt: overrides.stderrExcerpt,
    outputExcerpt: overrides.outputExcerpt,
  };
}
