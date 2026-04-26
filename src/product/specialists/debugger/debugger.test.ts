import { describe, expect, it } from 'vitest';

import {
  Confidence,
  FailureClass,
  NextAction,
  Severity,
  type FailureClassification,
} from '../../../runtime/failure/types.js';
import type {
  VerificationResult,
  WorkflowRunEvidence,
  WorkflowStepEvidence,
} from '../../../shared/models/workflow-evidence.js';
import { debugWorkflowRun } from './debugger.js';

const RECORDED_AT = '2026-04-26T00:00:00.000Z';

describe('debugWorkflowRun', () => {
  it('maps verification failures to deterministic gate repair with commands and bounded scope', () => {
    const result = debugWorkflowRun({
      classification: classification(FailureClass.VerificationFailure, {
        summary: 'Verification failed because no deterministic gate protected the generated workflow.',
      }),
      evidence: run({
        finalSignoffPath: 'workflows/generated/report-workflow.ts',
        steps: [
          step({
            stepId: 'verify-generated-workflow',
            verifications: [
              failingVerification({
                type: 'deterministic_gate',
                expected: 'workflow has deterministic final gate',
                actual: 'gate did not run',
                command: 'npx vitest run src/product/generation/pipeline.test.ts',
                message: 'deterministic gate evidence was not recorded for generated workflow',
              }),
            ],
          }),
        ],
      }),
    });

    expect(result.diagnosis.primaryCause.category).toBe('missing_deterministic_gate');
    expect(result.recommendation.steps[0]).toMatchObject({
      action: 'add_deterministic_gate',
      targetStepId: 'verify-generated-workflow',
      verificationPlan: {
        commands: ['npx vitest run src/product/generation/pipeline.test.ts'],
        deterministic: true,
      },
    });
    expect(result.recommendation.scope).toMatchObject({
      bounded: true,
      maxFilesToTouch: 3,
      filesLikelyTouched: ['workflows/generated/report-workflow.ts'],
    });
  });

  it('maps agent drift to scoped prompt repair instead of a blind rerun', () => {
    const result = debugWorkflowRun({
      classification: classification(FailureClass.AgentDrift, {
        summary: 'Agent changed unrelated code and skipped the requested generated workflow artifact.',
      }),
      evidence: run({
        finalSignoffPath: 'workflows/generated/release-workflow.ts',
        steps: [
          step({
            stepId: 'implement-generated-workflow',
            verifications: [
              failingVerification({
                expected: 'workflows/generated/release-workflow.ts contains final-review gate',
                actual: 'file has no final-review gate',
                command: 'rg "final-review" workflows/generated/release-workflow.ts',
              }),
            ],
          }),
        ],
      }),
    });

    expect(result.diagnosis.primaryCause.category).toBe('agent_drift');
    expect(result.recommendation.steps[0].action).toBe('fix_step_task');
    expect(result.recommendation.steps[0].action).not.toBe('retry_step');
    expect(result.recommendation.steps[0].description).toMatch(/step task contract/i);
    expect(result.recommendation.steps[0].verificationPlan.commands).toEqual([
      'rg "final-review" workflows/generated/release-workflow.ts',
    ]);
    expect(result.recommendation.scope.targetStepIds).toEqual(['implement-generated-workflow']);
    expect(result.recommendation.scope.filesLikelyTouched).toEqual([
      'workflows/generated/release-workflow.ts',
    ]);
  });

  it('turns missing file materialization into a file existence gate recommendation', () => {
    const result = debugWorkflowRun({
      classification: classification(FailureClass.VerificationFailure, {
        summary: 'Generated workflow verification failed because an expected file was not materialized.',
      }),
      evidence: run({
        steps: [
          step({
            stepId: 'materialize-generated-workflow',
            verifications: [
              failingVerification({
                type: 'file_exists',
                expected: 'workflows/generated/payment-workflow.ts exists',
                actual: 'missing file workflows/generated/payment-workflow.ts',
                command: 'test -e workflows/generated/payment-workflow.ts',
              }),
            ],
          }),
        ],
      }),
    });

    expect(result.diagnosis.primaryCause.category).toBe('missing_file_materialization');
    expect(result.recommendation.steps[0].action).toBe('add_missing_artifact');
    expect(result.recommendation.steps[0].verificationPlan).toMatchObject({
      commands: ["test -e 'workflows/generated/payment-workflow.ts'"],
      deterministic: true,
    });
    expect(result.recommendation.steps[0].verificationPlan.expectations).toContain(
      'workflows/generated/payment-workflow.ts exists and is referenced by workflow evidence.',
    );
    expect(result.recommendation.scope.filesLikelyTouched).toEqual([
      'workflows/generated/payment-workflow.ts',
    ]);
  });

  it('maps concentrated step overflow to a split-step recommendation', () => {
    const result = debugWorkflowRun({
      classification: classification(FailureClass.StepOverflow, {
        summary: 'One generated workflow implementation step exhausted retries.',
      }),
      evidence: run({
        finalSignoffPath: 'workflows/generated/large-workflow.ts',
        steps: [
          step({
            stepId: 'implement-large-workflow',
            retries: [1, 2, 3, 4, 5].map((attempt) => ({
              attempt,
              stepId: 'implement-large-workflow',
              status: 'failed',
              error: `attempt ${attempt} exceeded scope`,
            })),
            verifications: [
              failingVerification({
                expected: 'generated workflow validates',
                actual: 'step exceeded retry budget',
                command: 'npx tsc --noEmit',
              }),
            ],
          }),
        ],
      }),
    });

    expect(result.diagnosis.primaryCause.category).toBe('oversized_agent_step');
    expect(result.recommendation.steps[0].action).toBe('retry_with_smaller_scope');
    expect(result.recommendation.steps[0].description).toMatch(/split/i);
    expect(result.recommendation.steps[0].verificationPlan.commands).toEqual(['npx tsc --noEmit']);
    expect(result.recommendation.scope).toMatchObject({
      bounded: true,
      maxFilesToTouch: 3,
      targetStepIds: ['implement-large-workflow'],
    });
  });

  it('gives prerequisite guidance for environment errors and refuses direct repair', () => {
    const result = debugWorkflowRun({
      classification: classification(FailureClass.EnvironmentError, {
        summary: 'npx command not found while verifying the generated workflow.',
      }),
      evidence: run({
        steps: [
          step({
            stepId: 'verify-generated-workflow',
            error: 'command not found: npx',
            verifications: [
              failingVerification({
                expected: 'npx vitest exits 0',
                actual: 'command not found: npx',
                command: 'npx vitest run src/product/specialists/debugger/debugger.test.ts',
                stderrExcerpt: 'command not found: npx',
              }),
            ],
          }),
        ],
      }),
    });

    expect(result.diagnosis.primaryCause.category).toBe('environment_prerequisite');
    expect(result.recommendation.steps[0]).toMatchObject({
      action: 'fix_environment',
      verificationPlan: {
        commands: ['npx vitest run src/product/specialists/debugger/debugger.test.ts'],
        deterministic: true,
      },
    });
    expect(result.recommendation.steps[0].description).toMatch(/install|configure|prerequisite/i);
    expect(result.recommendation.directRepairEligible).toBe(false);
    expect(result.recommendation.directRepairRefusalReason).toMatch(/environment changes are disabled/i);
    expect(result.repairMode).toBe('guided');
  });

  it('returns manual review when evidence is weak or conflicting', () => {
    const result = debugWorkflowRun({
      classification: classification(FailureClass.Unknown, {
        confidence: Confidence.Low,
        summary: 'Conflicting relay notes do not identify a deterministic failing step or file.',
        signals: [
          {
            observation: 'Reviewer disagreed with the failed assertion, but no command or artifact path was recorded.',
            source: 'relay:review',
            strength: Confidence.Low,
          },
        ],
      }),
      evidence: run({
        deterministicGates: [
          {
            gateName: 'baseline-evidence-captured',
            passed: true,
            verifications: [],
            recordedAt: RECORDED_AT,
          },
        ],
        logs: [
          {
            stream: 'relay',
            excerpt: 'One note says rerun, another says product intent changed; no failing command was captured.',
          },
        ],
      }),
    });

    expect(result.diagnosis.primaryCause.category).toBe('unknown');
    expect(result.recommendation.steps[0].action).toBe('escalate');
    expect(result.recommendation.steps[0].description).toMatch(/collect more deterministic evidence/i);
    expect(result.recommendation.steps[0].verificationPlan).toMatchObject({
      commands: [],
      deterministic: false,
    });
    expect(result.recommendation.directRepairEligible).toBe(false);
    expect(result.recommendation.scope).toMatchObject({
      bounded: false,
      maxFilesToTouch: 3,
    });
    expect(result.repairMode).toBe('manual');
  });

  it('refuses direct repair for timeout with no deterministic verification commands', () => {
    const result = debugWorkflowRun({
      classification: classification(FailureClass.Timeout, {
        summary: 'Step timed out with no failing verification or gate command recorded.',
      }),
      evidence: run({
        steps: [
          step({
            stepId: 'slow-step',
            status: 'timed_out',
            verifications: [],
            deterministicGates: [],
          }),
        ],
      }),
    });

    expect(result.diagnosis.primaryCause.category).toBe('timeout_budget');
    expect(result.recommendation.steps[0].action).toBe('retry_step');
    expect(result.recommendation.steps[0].verificationPlan.deterministic).toBe(false);
    expect(result.recommendation.steps[0].verificationPlan.commands).toEqual([]);
    expect(result.recommendation.directRepairEligible).toBe(false);
    expect(result.recommendation.directRepairRefusalReason).toMatch(/deterministic verification/i);
    expect(result.repairMode).toBe('guided');
  });

  it('refuses direct repair when policy blocklist includes the failure class', () => {
    const result = debugWorkflowRun({
      classification: classification(FailureClass.Deadlock, {
        summary: 'Deadlock detected between step-a and step-b.',
        signals: [
          {
            observation: 'wrong pattern: pipeline should use dag',
            source: 'step:step-a',
            strength: Confidence.High,
          },
        ],
      }),
      evidence: run({
        steps: [
          step({ stepId: 'step-a' }),
          step({ stepId: 'step-b' }),
        ],
        routing: [
          {
            abstractionName: 'pipeline',
            requestedRoute: 'pipeline',
            resolvedRoute: 'pipeline',
            reason: 'pattern mismatch: requires dag',
            abstractionPath: 'workflows/deadlock-workflow.ts',
            recordedAt: RECORDED_AT,
          },
        ],
      }),
      repairPolicy: { directRepairBlocklist: ['deadlock'] },
    });

    expect(result.recommendation.directRepairEligible).toBe(false);
    expect(result.recommendation.directRepairRefusalReason).toMatch(/blocked for deadlock/i);
  });

  it('handles a passing run with no failure gracefully', () => {
    const result = debugWorkflowRun({
      classification: classification(FailureClass.Unknown, {
        confidence: Confidence.Low,
        summary: 'No failure detected.',
        signals: [],
      }),
      evidence: run({
        status: 'passed',
        steps: [
          step({
            stepId: 'step-ok',
            status: 'passed',
            verifications: [
              {
                type: 'exit_code',
                passed: true,
                expected: 'exit code 0',
                actual: 'exit code 0',
              },
            ],
          }),
        ],
      }),
    });

    expect(result.diagnosis.primaryCause.category).toBe('unknown');
    expect(result.recommendation.steps[0].action).toBe('escalate');
    expect(result.recommendation.directRepairEligible).toBe(false);
    expect(result.repairMode).toBe('manual');
  });

  it('uses injected analyzedAt for deterministic output', () => {
    const timestamp = '2026-01-15T12:00:00.000Z';
    const result = debugWorkflowRun({
      classification: classification(FailureClass.Unknown, {
        confidence: Confidence.Low,
        summary: 'Test determinism.',
      }),
      evidence: run({}),
      analyzedAt: timestamp,
    });

    expect(result.analyzedAt).toBe(timestamp);
  });

  it('refuses direct repair when allowDirectRepair is false', () => {
    const result = debugWorkflowRun({
      classification: classification(FailureClass.VerificationFailure, {
        summary: 'Verification failed.',
      }),
      evidence: run({
        finalSignoffPath: 'workflows/generated/test-workflow.ts',
        steps: [
          step({
            stepId: 'verify-step',
            verifications: [
              failingVerification({
                type: 'deterministic_gate',
                expected: 'gate passes',
                actual: 'gate failed',
                command: 'npx vitest run test.ts',
                message: 'deterministic gate missing',
              }),
            ],
          }),
        ],
      }),
      repairPolicy: { allowDirectRepair: false },
    });

    expect(result.recommendation.directRepairEligible).toBe(false);
    expect(result.recommendation.directRepairRefusalReason).toMatch(/disabled by policy/i);
  });
});

function classification(
  failureClass: FailureClass,
  overrides: Partial<FailureClassification> = {},
): FailureClassification {
  return {
    category: failureClass,
    failureClass,
    severity: Severity.High,
    confidence: Confidence.High,
    nextAction: NextAction.FixAndRetry,
    summary: `${failureClass} fixture`,
    signals: [],
    secondaryClasses: [],
    ...overrides,
  };
}

function run(overrides: Partial<WorkflowRunEvidence> = {}): WorkflowRunEvidence {
  return {
    runId: 'run-1',
    workflowId: 'wf-generated-1',
    workflowName: 'generated workflow recovery',
    status: 'failed',
    steps: [],
    startedAt: RECORDED_AT,
    completedAt: RECORDED_AT,
    deterministicGates: [],
    artifacts: [],
    logs: [],
    narrative: [],
    routing: [],
    ...overrides,
  };
}

function step(overrides: Partial<WorkflowStepEvidence> = {}): WorkflowStepEvidence {
  return {
    stepId: 'step-1',
    stepName: 'generated workflow step',
    status: 'failed',
    startedAt: RECORDED_AT,
    completedAt: RECORDED_AT,
    verifications: [],
    deterministicGates: [],
    logs: [],
    artifacts: [],
    history: [],
    retries: [],
    narrative: [],
    ...overrides,
  };
}

function failingVerification(overrides: Partial<VerificationResult> = {}): VerificationResult {
  return {
    type: 'exit_code',
    passed: false,
    expected: 'exit code 0',
    actual: 'exit code 1',
    ...overrides,
  };
}
