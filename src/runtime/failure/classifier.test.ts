import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { classifyFailure, classifyFromSummary } from './classifier.js';
import {
  createRunEvidence,
  createStepEvidence,
  appendStepEvent,
  completeStep,
  completeRun,
  recordDeterministicGate,
  summarizeEvidence,
} from '../evidence/capture.js';
import type { WorkflowRunEvidence, WorkflowStepEvidence, VerificationResult } from '../evidence/types.js';
import {
  type FailureClassification,
  FailureClass,
  Severity,
  Confidence,
  NextAction,
} from './types.js';

const FIXED_NOW = new Date('2026-04-26T10:00:00.000Z');

beforeEach(() => {
  vi.useFakeTimers({ now: FIXED_NOW });
});

afterEach(() => {
  vi.useRealTimers();
});

// ── Helpers ──────────────────────────────────────────────────────────

function makeRun(overrides?: Partial<Parameters<typeof createRunEvidence>[0]>): WorkflowRunEvidence {
  return createRunEvidence({
    runId: 'run-1',
    workflowId: 'wf-1',
    workflowName: 'test-workflow',
    ...overrides,
  });
}

function makeStep(overrides?: Partial<Parameters<typeof createStepEvidence>[0]>): WorkflowStepEvidence {
  return createStepEvidence({
    stepId: 'step-1',
    stepName: 'build',
    ...overrides,
  });
}

function passingVerification(overrides?: Partial<VerificationResult>): VerificationResult {
  return {
    type: 'exit_code',
    passed: true,
    expected: '0',
    actual: '0',
    ...overrides,
  };
}

function failingVerification(overrides?: Partial<VerificationResult>): VerificationResult {
  return {
    type: 'exit_code',
    passed: false,
    expected: '0',
    actual: '1',
    ...overrides,
  };
}

function addStepToRun(run: WorkflowRunEvidence, step: WorkflowStepEvidence): WorkflowRunEvidence {
  return { ...run, steps: [...run.steps, step] };
}

function expectClassificationSurface(
  result: FailureClassification,
  expected: {
    category: FailureClass;
    severity: Severity;
    confidence?: Confidence;
    nextAction: NextAction;
  },
): void {
  expect(result.category).toBe(expected.category);
  expect(result.failureClass).toBe(expected.category);
  expect(result.severity).toBe(expected.severity);
  if (expected.confidence) {
    expect(result.confidence).toBe(expected.confidence);
  } else {
    expect(result.confidence).toEqual(expect.any(String));
  }
  expect(result.nextAction).toBe(expected.nextAction);
}

// ── Timeout ──────────────────────────────────────────────────────────

describe('timeout classification', () => {
  it('classifies a run with timed_out status', () => {
    let run = makeRun();
    let step = makeStep();
    step = completeStep(step, 'timed_out');
    run = addStepToRun(run, step);
    run = completeRun(run);

    expect(run.status).toBe('timed_out');

    const result = classifyFailure(run);
    expectClassificationSurface(result, {
      category: FailureClass.Timeout,
      severity: Severity.Critical,
      confidence: Confidence.High,
      nextAction: NextAction.Retry,
    });
    expect(result.signals.length).toBeGreaterThan(0);
  });

  it('classifies when some steps timed out', () => {
    let run = makeRun();
    let step1 = makeStep({ stepId: 'step-1', stepName: 'build' });
    step1 = completeStep(step1, 'timed_out');
    let step2 = makeStep({ stepId: 'step-2', stepName: 'test' });
    step2 = completeStep(step2, 'passed');
    run = addStepToRun(addStepToRun(run, step1), step2);
    run = completeRun(run);

    const result = classifyFailure(run);
    expect(result.failureClass).toBe(FailureClass.Timeout);
    expect(result.severity).toBe(Severity.High);
  });
});

// ── Verification Failure ─────────────────────────────────────────────

describe('verification failure classification', () => {
  it('classifies when deterministic gates fail', () => {
    let run = makeRun();
    let step = makeStep();
    step = appendStepEvent(step, {
      kind: 'verification',
      result: failingVerification(),
    });
    step = completeStep(step, 'failed');
    run = addStepToRun(run, step);

    const gateResult = recordDeterministicGate(
      run,
      'typecheck',
      [failingVerification({ type: 'exit_code', expected: '0', actual: '1' })],
      'step-1',
    );
    run = gateResult.run;
    run = completeRun(run);

    const result = classifyFailure(run);
    expectClassificationSurface(result, {
      category: FailureClass.VerificationFailure,
      severity: Severity.High,
      confidence: Confidence.High,
      nextAction: NextAction.FixAndRetry,
    });
    expect(result.signals.some((s) => s.observation.includes('Gate'))).toBe(true);
  });

  it('classifies when step verifications fail', () => {
    let run = makeRun();
    let step = makeStep();
    step = appendStepEvent(step, {
      kind: 'verification',
      result: failingVerification({
        type: 'file_exists',
        expected: 'src/output.ts',
        actual: 'missing',
      }),
    });
    step = completeStep(step, 'failed');
    run = addStepToRun(run, step);
    run = completeRun(run);

    const result = classifyFailure(run);
    expect(result.failureClass).toBe(FailureClass.VerificationFailure);
  });
});

// ── Agent Drift ──────────────────────────────────────────────────────

describe('agent drift classification', () => {
  it('classifies repeated agent narrative without file or test changes as drift', () => {
    let run = makeRun();
    let step = makeStep();

    step = appendStepEvent(step, {
      kind: 'narrative',
      narrative: {
        agentRole: 'impl-primary',
        summary: 'Working on the requested edit; reviewing files now.',
        recordedAt: FIXED_NOW.toISOString(),
      },
    });
    step = appendStepEvent(step, {
      kind: 'narrative',
      narrative: {
        agentRole: 'impl-primary',
        summary: 'Still working through the same approach; no files changed yet.',
        recordedAt: FIXED_NOW.toISOString(),
      },
    });

    step = appendStepEvent(step, {
      kind: 'verification',
      result: failingVerification({
        type: 'file_exists',
        expected: 'src/feature.ts',
        actual: 'missing',
        message: 'Expected implementation artifact was not created after repeated agent updates',
        exitCode: 0,
      }),
    });

    step = completeStep(step, 'failed');
    run = addStepToRun(run, step);
    run = completeRun(run);

    const result = classifyFailure(run);
    expectClassificationSurface(result, {
      category: FailureClass.AgentDrift,
      severity: Severity.Medium,
      confidence: Confidence.High,
      nextAction: NextAction.FixAndRetry,
    });
    expect(step.artifacts).toHaveLength(0);
    expect(step.logs).toHaveLength(0);
    expect(step.narrative).toHaveLength(2);
    expect(result.signals.some((s) => s.observation.includes('step contract'))).toBe(true);
    expect(result.secondaryClasses).toContain(FailureClass.VerificationFailure);
  });

  it('classifies drift when exit code 0 but verification failed', () => {
    let run = makeRun();
    let step = makeStep();

    // Gate with exit code 0 (agent ran fine)
    step = appendStepEvent(step, {
      kind: 'deterministic_gate',
      gate: {
        gateName: 'execution-check',
        passed: true,
        verifications: [passingVerification()],
        exitCode: 0,
        recordedAt: FIXED_NOW.toISOString(),
      },
    });

    // But a separate verification failed
    step = appendStepEvent(step, {
      kind: 'verification',
      result: failingVerification({
        type: 'output_contains',
        expected: 'SUCCESS',
        actual: 'PARTIAL_OUTPUT',
      }),
    });

    step = completeStep(step, 'failed');
    run = addStepToRun(run, step);
    run = completeRun(run);

    const result = classifyFailure(run);
    expect(result.failureClass).toBe(FailureClass.AgentDrift);
  });
});

// ── Environment Error ────────────────────────────────────────────────

describe('environment error classification', () => {
  it('classifies ENOENT errors', () => {
    let run = makeRun();
    let step = makeStep();
    step = appendStepEvent(step, {
      kind: 'error',
      message: 'spawn npx ENOENT',
    });
    step = completeStep(step, 'failed');
    run = addStepToRun(run, step);
    run = completeRun(run);

    const result = classifyFailure(run);
    expectClassificationSurface(result, {
      category: FailureClass.EnvironmentError,
      severity: Severity.High,
      confidence: Confidence.Medium,
      nextAction: NextAction.InvestigateEnvironment,
    });
  });

  it('classifies missing command, tool, or dependency output as environment error', () => {
    let run = makeRun();
    let step = makeStep();

    step = appendStepEvent(step, {
      kind: 'deterministic_gate',
      gate: {
        gateName: 'deterministic-tooling',
        passed: false,
        verifications: [
          failingVerification({
            type: 'custom',
            expected: 'workflow-debugger command output',
            actual: '',
            command: 'workflow-debugger classify --run run-1',
            stderrExcerpt: 'workflow-debugger: command not found',
            message: 'Missing command/tool/dependency output',
          }),
        ],
        command: 'workflow-debugger classify --run run-1',
        stderrExcerpt: 'workflow-debugger: command not found',
        recordedAt: FIXED_NOW.toISOString(),
      },
    });
    step = completeStep(step, 'failed');
    run = addStepToRun(run, step);
    run = completeRun(run);

    const result = classifyFailure(run);
    expectClassificationSurface(result, {
      category: FailureClass.EnvironmentError,
      severity: Severity.High,
      confidence: Confidence.High,
      nextAction: NextAction.InvestigateEnvironment,
    });
    expect(result.signals.map((s) => s.observation).join('\n')).toContain('command not found');
    expect(result.secondaryClasses).toContain(FailureClass.VerificationFailure);
  });

  it('classifies permission denied in gate stderr', () => {
    let run = makeRun();
    let step = makeStep();
    step = completeStep(step, 'failed');
    run = addStepToRun(run, step);

    const gateResult = recordDeterministicGate(
      run,
      'npm-install',
      [failingVerification()],
      'step-1',
    );
    run = gateResult.run;
    // Manually add stderr to the gate
    const gateIdx = run.deterministicGates.length - 1;
    run.deterministicGates[gateIdx] = {
      ...run.deterministicGates[gateIdx],
      stderrExcerpt: 'Error: EACCES: permission denied, open /usr/local/lib/node_modules',
    };
    run = completeRun(run);

    const result = classifyFailure(run);
    expect(result.failureClass).toBe(FailureClass.EnvironmentError);
  });

  it('classifies OOM errors', () => {
    let run = makeRun();
    let step = makeStep();
    step = appendStepEvent(step, {
      kind: 'error',
      message: 'FATAL ERROR: CALL_AND_RETRY_LAST Allocation failed - JavaScript heap out of memory',
    });
    step = appendStepEvent(step, {
      kind: 'verification',
      result: failingVerification({
        message: 'Process OOMKilled',
      }),
    });
    step = completeStep(step, 'failed');
    run = addStepToRun(run, step);
    run = completeRun(run);

    const result = classifyFailure(run);
    expect(result.failureClass).toBe(FailureClass.EnvironmentError);
  });

  it('classifies network errors', () => {
    let run = makeRun();
    let step = makeStep();
    step = appendStepEvent(step, {
      kind: 'error',
      message: 'Error: getaddrinfo ENOTFOUND registry.npmjs.org',
    });
    step = completeStep(step, 'failed');
    run = addStepToRun(run, step);
    run = completeRun(run);

    const result = classifyFailure(run);
    expect(result.failureClass).toBe(FailureClass.EnvironmentError);
  });
});

// ── Deadlock ─────────────────────────────────────────────────────────

describe('deadlock classification', () => {
  it('classifies no progress across bounded waits as deadlock', () => {
    let run = makeRun();

    let step1 = makeStep({ stepId: 'step-1', stepName: 'agent-a' });
    step1 = appendStepEvent(step1, {
      kind: 'status_change',
      status: 'running',
      message: 'bounded wait 1 started',
    });
    step1 = appendStepEvent(step1, {
      kind: 'status_change',
      status: 'running',
      message: 'bounded wait 2 still running with no output',
    });

    let step2 = makeStep({ stepId: 'step-2', stepName: 'agent-b' });
    step2 = appendStepEvent(step2, {
      kind: 'status_change',
      status: 'pending',
      message: 'blocked behind agent-a after bounded wait',
    });

    run = addStepToRun(addStepToRun(run, step1), step2);

    run = { ...run, status: 'failed' };

    const result = classifyFailure(run);
    expectClassificationSurface(result, {
      category: FailureClass.Deadlock,
      severity: Severity.Critical,
      confidence: Confidence.Low,
      nextAction: NextAction.Abort,
    });
    expect(step1.history).toHaveLength(2);
    expect(step2.history).toHaveLength(1);
    expect(result.signals).toHaveLength(1);
    expect(result.signals[0]?.observation).toContain('non-terminal');
  });
});

// ── Step Overflow ────────────────────────────────────────────────────

describe('step overflow classification', () => {
  it('classifies when retries exceed threshold', () => {
    let run = makeRun();
    let step = makeStep();

    // Add many retries
    for (let i = 1; i <= 6; i++) {
      step = appendStepEvent(step, {
        kind: 'retry',
        retry: {
          attempt: i,
          stepId: 'step-1',
          status: 'failed',
          error: `Attempt ${i} failed`,
          startedAt: FIXED_NOW.toISOString(),
          completedAt: FIXED_NOW.toISOString(),
        },
      });
    }

    step = completeStep(step, 'failed');
    run = addStepToRun(run, step);
    run = completeRun(run);

    const result = classifyFailure(run);
    expectClassificationSurface(result, {
      category: FailureClass.StepOverflow,
      severity: Severity.Medium,
      confidence: Confidence.Medium,
      nextAction: NextAction.Escalate,
    });
  });

  it('classifies overflow across multiple steps', () => {
    let run = makeRun();

    for (let s = 1; s <= 2; s++) {
      let step = makeStep({ stepId: `step-${s}`, stepName: `task-${s}` });
      for (let i = 1; i <= 3; i++) {
        step = appendStepEvent(step, {
          kind: 'retry',
          retry: {
            attempt: i,
            stepId: `step-${s}`,
            status: 'failed',
            startedAt: FIXED_NOW.toISOString(),
            completedAt: FIXED_NOW.toISOString(),
          },
        });
      }
      step = completeStep(step, 'failed');
      run = addStepToRun(run, step);
    }

    run = completeRun(run);

    const result = classifyFailure(run);
    expect(result.failureClass).toBe(FailureClass.StepOverflow);
  });
});

// ── Unknown / Mixed Cases ────────────────────────────────────────────

describe('unknown and mixed classification', () => {
  it('returns unknown for empty run (no steps)', () => {
    let run = makeRun();
    run = completeRun(run);

    // Empty run completes as passed
    const result = classifyFailure(run);
    expect(result.failureClass).toBe(FailureClass.Unknown);
    expect(result.summary).toContain('passed');
  });

  it('returns no-failure for a fully passing run', () => {
    let run = makeRun();
    let step = makeStep();
    step = appendStepEvent(step, {
      kind: 'verification',
      result: passingVerification(),
    });
    step = completeStep(step, 'passed');
    run = addStepToRun(run, step);
    run = completeRun(run);

    const result = classifyFailure(run);
    expect(result.failureClass).toBe(FailureClass.Unknown);
    expect(result.summary).toContain('no failure detected');
    expect(result.severity).toBe(Severity.Low);
    expect(result.confidence).toBe(Confidence.High);
  });

  it('classifies a failed run with no matching signals as unknown', () => {
    let run = makeRun();
    let step = makeStep();
    step = completeStep(step, 'failed');
    run = addStepToRun(run, step);
    run = completeRun(run);

    const result = classifyFailure(run);
    // Failed step with no verifications, no errors, no gates — just failed
    expect(result.failureClass).toBe(FailureClass.Unknown);
    expect(result.nextAction).toBe(NextAction.Escalate);
  });

  it('picks highest priority when timeout + environment error both match', () => {
    let run = makeRun();
    let step = makeStep();
    step = appendStepEvent(step, {
      kind: 'error',
      message: 'spawn npx ENOENT',
    });
    step = completeStep(step, 'timed_out');
    run = addStepToRun(run, step);
    run = completeRun(run);

    const result = classifyFailure(run);
    // Timeout is higher priority than environment error
    expect(result.failureClass).toBe(FailureClass.Timeout);
    expect(result.secondaryClasses).toContain(FailureClass.EnvironmentError);
  });

  it('preserves confidence and matched signals for mixed environment and verification failures', () => {
    let run = makeRun();
    let step = makeStep();

    step = appendStepEvent(step, {
      kind: 'error',
      message: 'Error: ENOENT: no such file or directory',
    });

    step = appendStepEvent(step, {
      kind: 'verification',
      result: failingVerification(),
    });

    step = completeStep(step, 'failed');
    run = addStepToRun(run, step);
    run = completeRun(run);

    const result = classifyFailure(run);
    expectClassificationSurface(result, {
      category: FailureClass.EnvironmentError,
      severity: Severity.High,
      confidence: Confidence.High,
      nextAction: NextAction.InvestigateEnvironment,
    });
    expect(result.secondaryClasses).toEqual([FailureClass.VerificationFailure]);
    expect(result.signals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: 'step:step-1',
          strength: Confidence.High,
        }),
        expect.objectContaining({
          source: 'step:step-1',
          strength: Confidence.High,
        }),
      ]),
    );
    expect(result.signals.map((s) => s.observation).join('\n')).toContain('ENOENT');
    expect(result.signals.map((s) => s.observation).join('\n')).toContain('Verification');
  });

  it('preserves low confidence for weak summary-only deadlock signals', () => {
    let run = makeRun();
    let step = makeStep();
    step = appendStepEvent(step, {
      kind: 'status_change',
      status: 'running',
    });
    run = addStepToRun(run, step);
    run = { ...run, status: 'failed' };

    const summary = summarizeEvidence(run);
    const result = classifyFromSummary(summary);

    expectClassificationSurface(result, {
      category: FailureClass.Deadlock,
      severity: Severity.Critical,
      confidence: Confidence.Low,
      nextAction: NextAction.Abort,
    });
    expect(result.signals).toEqual([
      expect.objectContaining({
        source: 'run-summary',
        strength: Confidence.Medium,
      }),
    ]);
  });
});

// ── classifyFromSummary ──────────────────────────────────────────────

describe('classifyFromSummary', () => {
  it('classifies from summary only (no full evidence)', () => {
    let run = makeRun();
    let step = makeStep();
    step = completeStep(step, 'timed_out');
    run = addStepToRun(run, step);
    run = completeRun(run);

    const summary = summarizeEvidence(run);
    const result = classifyFromSummary(summary);
    expect(result.failureClass).toBe(FailureClass.Timeout);
  });

  it('classifies from summary with full evidence for deeper analysis', () => {
    let run = makeRun();
    let step = makeStep();
    step = appendStepEvent(step, {
      kind: 'error',
      message: 'ECONNREFUSED 127.0.0.1:5432',
    });
    step = completeStep(step, 'failed');
    run = addStepToRun(run, step);
    run = completeRun(run);

    const summary = summarizeEvidence(run);
    const result = classifyFromSummary(summary, run);
    expect(result.failureClass).toBe(FailureClass.EnvironmentError);
  });

  it('handles passing run from summary', () => {
    let run = makeRun();
    let step = makeStep();
    step = completeStep(step, 'passed');
    run = addStepToRun(run, step);
    run = completeRun(run);

    const summary = summarizeEvidence(run);
    const result = classifyFromSummary(summary);
    expect(result.summary).toContain('no failure detected');
  });
});

// ── Edge-case fixes (Codex review) ─────────────────────────────────

describe('agent drift vs verification failure boundary', () => {
  it('classifies failed verification with one narrative as verification_failure, not drift', () => {
    let run = makeRun();
    let step = makeStep();

    // Single narrative entry — should NOT be enough for drift
    step = appendStepEvent(step, {
      kind: 'narrative',
      narrative: {
        agentRole: 'impl-primary',
        summary: 'Starting work on the task.',
        recordedAt: FIXED_NOW.toISOString(),
      },
    });

    step = appendStepEvent(step, {
      kind: 'verification',
      result: failingVerification({
        type: 'file_exists',
        expected: 'src/output.ts',
        actual: 'missing',
      }),
    });

    step = completeStep(step, 'failed');
    run = addStepToRun(run, step);
    run = completeRun(run);

    const result = classifyFailure(run);
    expect(result.failureClass).toBe(FailureClass.VerificationFailure);
    expect(result.failureClass).not.toBe(FailureClass.AgentDrift);
  });
});

describe('deadlock with cancelled run status', () => {
  it('does not classify cancelled run with pending steps as deadlock', () => {
    let run = makeRun();
    let step = makeStep();
    step = appendStepEvent(step, {
      kind: 'status_change',
      status: 'pending',
    });
    run = addStepToRun(run, step);

    // Cancelled run, not failed — should not be deadlock
    run = { ...run, status: 'cancelled' as const };

    const result = classifyFailure(run);
    expect(result.failureClass).not.toBe(FailureClass.Deadlock);
  });

  it('classifies failed run with pending steps as deadlock', () => {
    let run = makeRun();
    let step = makeStep();
    step = appendStepEvent(step, {
      kind: 'status_change',
      status: 'running',
    });
    run = addStepToRun(run, step);
    run = { ...run, status: 'failed' as const };

    const result = classifyFailure(run);
    expect(result.failureClass).toBe(FailureClass.Deadlock);
  });
});

describe('step overflow signal independence', () => {
  it('emits retry-specific signal even when earlier environment signal contains retries text', () => {
    let run = makeRun();

    // Step 1: environment error with "retries" in the text
    let step1 = makeStep({ stepId: 'step-1', stepName: 'setup' });
    step1 = appendStepEvent(step1, {
      kind: 'error',
      message: 'ENOENT: failed after retries exhausted',
    });
    step1 = completeStep(step1, 'failed');

    // Step 2: has retries that exceed threshold (distributed across steps)
    let step2 = makeStep({ stepId: 'step-2', stepName: 'build' });
    for (let i = 1; i <= 3; i++) {
      step2 = appendStepEvent(step2, {
        kind: 'retry',
        retry: {
          attempt: i,
          stepId: 'step-2',
          status: 'failed',
          startedAt: FIXED_NOW.toISOString(),
          completedAt: FIXED_NOW.toISOString(),
        },
      });
    }

    // Step 3: more retries
    let step3 = makeStep({ stepId: 'step-3', stepName: 'test' });
    for (let i = 1; i <= 3; i++) {
      step3 = appendStepEvent(step3, {
        kind: 'retry',
        retry: {
          attempt: i,
          stepId: 'step-3',
          status: 'failed',
          startedAt: FIXED_NOW.toISOString(),
          completedAt: FIXED_NOW.toISOString(),
        },
      });
    }
    step2 = completeStep(step2, 'failed');
    step3 = completeStep(step3, 'failed');
    run = addStepToRun(addStepToRun(addStepToRun(run, step1), step2), step3);
    run = completeRun(run);

    const result = classifyFailure(run);
    // Environment error is higher priority, but step overflow should be secondary
    expect(result.secondaryClasses).toContain(FailureClass.StepOverflow);
    // Verify the overflow signal is specific to retries, not borrowed from env
    const overflowSignals = result.signals.filter(
      (s) => s.observation.includes('retries across') || s.observation.includes('retries'),
    );
    expect(overflowSignals.length).toBeGreaterThan(0);
  });
});

describe('environment error from log excerpts', () => {
  it('detects ENOENT in step log excerpt', () => {
    let run = makeRun();
    let step = makeStep();
    // No step.error — only the log excerpt has the env error
    step = { ...step, logs: [{ stream: 'stderr' as const, excerpt: 'Error: ENOENT: no such file or directory, open /tmp/missing.txt' }] };
    step = completeStep(step, 'failed');
    run = addStepToRun(run, step);
    run = completeRun(run);

    const result = classifyFailure(run);
    expect(result.failureClass).toBe(FailureClass.EnvironmentError);
    expect(result.signals.some((s) => s.source.includes('log'))).toBe(true);
  });

  it('detects connection refused in run-level log excerpt', () => {
    let run = makeRun();
    let step = makeStep();
    step = completeStep(step, 'failed');
    run = addStepToRun(run, step);
    run = { ...run, logs: [{ stream: 'stderr' as const, excerpt: 'ECONNREFUSED 127.0.0.1:5432' }] };
    run = completeRun(run);

    const result = classifyFailure(run);
    expect(result.failureClass).toBe(FailureClass.EnvironmentError);
    expect(result.signals.some((s) => s.source === 'run-level/log')).toBe(true);
  });

  it('detects permission denied in step log excerpt', () => {
    let run = makeRun();
    let step = makeStep();
    step = { ...step, logs: [{ stream: 'stderr' as const, excerpt: 'EACCES: permission denied, mkdir /root/protected' }] };
    step = completeStep(step, 'failed');
    run = addStepToRun(run, step);
    run = completeRun(run);

    const result = classifyFailure(run);
    expect(result.failureClass).toBe(FailureClass.EnvironmentError);
  });
});
