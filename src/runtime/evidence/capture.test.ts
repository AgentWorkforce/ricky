import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createRunEvidence,
  createStepEvidence,
  appendStepEvent,
  recordDeterministicGate,
  createDeterministicGate,
  attachArtifact,
  attachRunLog,
  recordRoutingDecision,
  appendRunNarrative,
  completeStep,
  completeRun,
  summarizeEvidence,
} from './capture.js';
import type { VerificationResult, WorkflowStepEvidence } from './types.js';

const FIXED_NOW = new Date('2026-04-26T10:00:00.000Z');

beforeEach(() => {
  vi.useFakeTimers({ now: FIXED_NOW });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('createRunEvidence', () => {
  it('creates a pending run with empty steps', () => {
    const run = createRunEvidence({
      runId: 'run-1',
      workflowId: 'wf-1',
      workflowName: 'test-workflow',
    });

    expect(run.runId).toBe('run-1');
    expect(run.workflowId).toBe('wf-1');
    expect(run.workflowName).toBe('test-workflow');
    expect(run.status).toBe('pending');
    expect(run.steps).toEqual([]);
    expect(run.startedAt).toBeDefined();
    expect(run.completedAt).toBeUndefined();
  });
});

describe('createStepEvidence', () => {
  it('creates a pending step with empty collections', () => {
    const step = createStepEvidence({
      stepId: 'step-1',
      stepName: 'build',
      agentRole: 'impl-primary',
    });

    expect(step.stepId).toBe('step-1');
    expect(step.stepName).toBe('build');
    expect(step.status).toBe('pending');
    expect(step.agentRole).toBe('impl-primary');
    expect(step.verifications).toEqual([]);
    expect(step.logs).toEqual([]);
    expect(step.artifacts).toEqual([]);
    expect(step.history).toEqual([]);
    expect(step.retries).toEqual([]);
  });

  it('creates a step without an agent role', () => {
    const step = createStepEvidence({ stepId: 's-2', stepName: 'lint' });
    expect(step.agentRole).toBeUndefined();
  });
});

describe('appendStepEvent — status transitions', () => {
  let step: WorkflowStepEvidence;

  beforeEach(() => {
    step = createStepEvidence({ stepId: 'step-1', stepName: 'build' });
  });

  it('transitions to running and records startedAt', () => {
    const updated = appendStepEvent(step, { kind: 'status_change', status: 'running' });
    expect(updated.status).toBe('running');
    expect(updated.startedAt).toBeDefined();
    expect(updated.history).toHaveLength(1);
    expect(updated.history![0].status).toBe('running');
  });

  it('builds history through multiple transitions', () => {
    let s = appendStepEvent(step, { kind: 'status_change', status: 'running' });
    s = appendStepEvent(s, { kind: 'status_change', status: 'failed', message: 'timeout' });
    expect(s.history).toHaveLength(2);
    expect(s.history![0].status).toBe('running');
    expect(s.history![1].status).toBe('failed');
    expect(s.history![1].message).toBe('timeout');
  });

  it('does not overwrite startedAt on subsequent status changes', () => {
    const running = appendStepEvent(step, { kind: 'status_change', status: 'running' });
    const startedAt = running.startedAt;
    vi.advanceTimersByTime(5000);
    const failed = appendStepEvent(running, { kind: 'status_change', status: 'failed' });
    expect(failed.startedAt).toBe(startedAt);
  });

  it('does not mutate the original step', () => {
    const updated = appendStepEvent(step, { kind: 'status_change', status: 'running' });
    expect(step.status).toBe('pending');
    expect(step.history).toEqual([]);
    expect(updated.status).toBe('running');
  });
});

describe('appendStepEvent — verification capture', () => {
  it('accumulates verification results', () => {
    let step = createStepEvidence({ stepId: 's-1', stepName: 'verify' });

    const v1: VerificationResult = {
      type: 'exit_code',
      passed: true,
      expected: '0',
      actual: '0',
    };
    const v2: VerificationResult = {
      type: 'file_exists',
      passed: false,
      expected: 'src/output.ts',
      actual: '',
      message: 'file not found',
    };

    step = appendStepEvent(step, { kind: 'verification', result: v1 });
    step = appendStepEvent(step, { kind: 'verification', result: v2 });

    expect(step.verifications).toHaveLength(2);
    expect(step.verifications[0].passed).toBe(true);
    expect(step.verifications[1].passed).toBe(false);
    expect(step.verifications[1].message).toBe('file not found');
  });
});

describe('appendStepEvent — log references', () => {
  it('appends log references to the step', () => {
    let step = createStepEvidence({ stepId: 's-1', stepName: 'run' });

    step = appendStepEvent(step, {
      kind: 'log',
      ref: { stream: 'stdout', excerpt: 'build OK' },
    });
    step = appendStepEvent(step, {
      kind: 'log',
      ref: { stream: 'stderr', excerpt: 'warning: unused var' },
    });

    expect(step.logs).toHaveLength(2);
    expect(step.logs[0].stream).toBe('stdout');
    expect(step.logs[1].excerpt).toBe('warning: unused var');
  });
});

describe('appendStepEvent — artifact references', () => {
  it('appends artifact references via event', () => {
    let step = createStepEvidence({ stepId: 's-1', stepName: 'gen' });

    step = appendStepEvent(step, {
      kind: 'artifact',
      ref: { path: 'dist/bundle.js', kind: 'file', description: 'output bundle' },
    });

    expect(step.artifacts).toHaveLength(1);
    expect(step.artifacts[0].path).toBe('dist/bundle.js');
  });
});

describe('appendStepEvent — retry history', () => {
  it('records retry attempts with error context', () => {
    let step = createStepEvidence({ stepId: 's-1', stepName: 'flaky' });
    step = appendStepEvent(step, { kind: 'status_change', status: 'running' });
    step = appendStepEvent(step, { kind: 'status_change', status: 'failed' });

    step = appendStepEvent(step, { kind: 'retry', attempt: 1, error: 'exit code 1' });
    step = appendStepEvent(step, { kind: 'retry', attempt: 2 });

    expect(step.retries).toHaveLength(2);
    expect(step.retries![0].attempt).toBe(1);
    expect(step.retries![0].error).toBe('exit code 1');
    expect(step.retries![0].stepId).toBe('s-1');
    expect(step.retries![1].attempt).toBe(2);
    expect(step.retries![1].error).toBeUndefined();
  });
});

describe('appendStepEvent — error', () => {
  it('sets the error field on the step', () => {
    let step = createStepEvidence({ stepId: 's-1', stepName: 'crash' });
    step = appendStepEvent(step, { kind: 'error', message: 'segfault' });
    expect(step.error).toBe('segfault');
  });
});

describe('attachArtifact', () => {
  it('adds an artifact reference to a step', () => {
    const step = createStepEvidence({ stepId: 's-1', stepName: 'build' });
    const updated = attachArtifact(step, { path: 'report.md', kind: 'report' });

    expect(updated.artifacts).toHaveLength(1);
    expect(updated.artifacts[0].path).toBe('report.md');
    expect(step.artifacts).toHaveLength(0); // original not mutated
  });
});

describe('recordDeterministicGate', () => {
  it('returns a passing gate when all verifications pass', () => {
    const run = createRunEvidence({ runId: 'r-1', workflowId: 'wf-1', workflowName: 'test' });
    const step = createStepEvidence({ stepId: 's-1', stepName: 'gate-step' });
    const runWithStep = { ...run, steps: [step] };

    const verifications: VerificationResult[] = [
      { type: 'exit_code', passed: true, expected: '0', actual: '0' },
      { type: 'file_exists', passed: true, expected: 'src/index.ts', actual: 'src/index.ts' },
    ];

    const { gate, run: updatedRun } = recordDeterministicGate(
      runWithStep, 'typecheck-gate', verifications, 's-1',
    );

    expect(gate.passed).toBe(true);
    expect(gate.gateName).toBe('typecheck-gate');
    expect(gate.verifications).toHaveLength(2);
    expect(gate.recordedAt).toBeDefined();

    // Verifications attached to the step
    expect(updatedRun.steps[0].verifications).toHaveLength(2);
  });

  it('returns a failing gate when any verification fails', () => {
    const run = createRunEvidence({ runId: 'r-1', workflowId: 'wf-1', workflowName: 'test' });

    const verifications: VerificationResult[] = [
      { type: 'exit_code', passed: true, expected: '0', actual: '0' },
      { type: 'file_exists', passed: false, expected: 'missing.ts', actual: '' },
    ];

    const { gate } = recordDeterministicGate(run, 'file-gate', verifications);

    expect(gate.passed).toBe(false);
  });

  it('returns a failing gate when no verifications are provided', () => {
    const run = createRunEvidence({ runId: 'r-1', workflowId: 'wf-1', workflowName: 'test' });
    const { gate } = recordDeterministicGate(run, 'empty-gate', []);
    expect(gate.passed).toBe(false);
  });
});

describe('completeStep', () => {
  it('marks a step as passed with completedAt and durationMs', () => {
    let step = createStepEvidence({ stepId: 's-1', stepName: 'build' });
    step = appendStepEvent(step, { kind: 'status_change', status: 'running' });

    vi.advanceTimersByTime(3000);

    const completed = completeStep(step, 'passed');
    expect(completed.status).toBe('passed');
    expect(completed.completedAt).toBeDefined();
    expect(completed.durationMs).toBeGreaterThanOrEqual(0);
    // History should record the completion
    expect(completed.history!.at(-1)!.status).toBe('passed');
  });

  it('marks a step as failed', () => {
    const step = createStepEvidence({ stepId: 's-1', stepName: 'test' });
    const completed = completeStep(step, 'failed');
    expect(completed.status).toBe('failed');
    expect(completed.completedAt).toBeDefined();
  });
});

describe('completeRun', () => {
  it('derives passed when all steps passed or skipped', () => {
    const run = createRunEvidence({ runId: 'r-1', workflowId: 'wf-1', workflowName: 'test' });
    const s1 = completeStep(
      createStepEvidence({ stepId: 's-1', stepName: 'a' }), 'passed',
    );
    const s2 = completeStep(
      createStepEvidence({ stepId: 's-2', stepName: 'b' }), 'skipped',
    );
    const completed = completeRun({ ...run, steps: [s1, s2] });
    expect(completed.status).toBe('passed');
    expect(completed.completedAt).toBeDefined();
    expect(completed.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('derives failed when any step failed', () => {
    const run = createRunEvidence({ runId: 'r-1', workflowId: 'wf-1', workflowName: 'test' });
    const s1 = completeStep(
      createStepEvidence({ stepId: 's-1', stepName: 'a' }), 'passed',
    );
    const s2 = completeStep(
      createStepEvidence({ stepId: 's-2', stepName: 'b' }), 'failed',
    );
    const completed = completeRun({ ...run, steps: [s1, s2] });
    expect(completed.status).toBe('failed');
  });

  it('derives timed_out when any step timed out', () => {
    const run = createRunEvidence({ runId: 'r-1', workflowId: 'wf-1', workflowName: 'test' });
    const s1 = completeStep(
      createStepEvidence({ stepId: 's-1', stepName: 'a' }), 'timed_out',
    );
    const s2 = completeStep(
      createStepEvidence({ stepId: 's-2', stepName: 'b' }), 'failed',
    );
    // timed_out takes priority over failed
    const completed = completeRun({ ...run, steps: [s1, s2] });
    expect(completed.status).toBe('timed_out');
  });

  it('derives passed for empty step list', () => {
    const run = createRunEvidence({ runId: 'r-1', workflowId: 'wf-1', workflowName: 'test' });
    const completed = completeRun(run);
    expect(completed.status).toBe('passed');
  });
});

describe('summarizeEvidence', () => {
  it('produces correct counts and metadata', () => {
    const run = createRunEvidence({ runId: 'r-1', workflowId: 'wf-1', workflowName: 'test' });

    let s1 = createStepEvidence({ stepId: 's-1', stepName: 'build' });
    s1 = appendStepEvent(s1, {
      kind: 'verification',
      result: { type: 'exit_code', passed: true, expected: '0', actual: '0' },
    });
    s1 = attachArtifact(s1, { path: 'dist/out.js', kind: 'file' });
    s1 = completeStep(s1, 'passed');

    let s2 = createStepEvidence({ stepId: 's-2', stepName: 'test' });
    s2 = appendStepEvent(s2, { kind: 'error', message: 'assertion failed' });
    s2 = appendStepEvent(s2, {
      kind: 'verification',
      result: { type: 'exit_code', passed: false, expected: '0', actual: '1' },
    });
    s2 = completeStep(s2, 'failed');

    const s3 = completeStep(
      createStepEvidence({ stepId: 's-3', stepName: 'deploy' }), 'skipped',
    );

    const completed = completeRun({ ...run, steps: [s1, s2, s3] });
    const summary = summarizeEvidence(completed);

    expect(summary.runId).toBe('r-1');
    expect(summary.workflowName).toBe('test');
    expect(summary.runStatus).toBe('failed');
    expect(summary.totalSteps).toBe(3);
    expect(summary.passedSteps).toBe(1);
    expect(summary.failedSteps).toBe(1);
    expect(summary.skippedSteps).toBe(1);
    expect(summary.timedOutSteps).toBe(0);
    expect(summary.pendingSteps).toBe(0);
    expect(summary.runningSteps).toBe(0);
    expect(summary.allVerificationsPassed).toBe(false);
    expect(summary.failedStepIds).toEqual(['s-2']);
    expect(summary.firstError).toBe('assertion failed');
    expect(summary.totalDurationMs).toBeGreaterThanOrEqual(0);
    expect(summary.artifactCount).toBe(1);
  });

  it('reports allVerificationsPassed when all verifications pass', () => {
    const run = createRunEvidence({ runId: 'r-1', workflowId: 'wf-1', workflowName: 'ok' });
    let s1 = createStepEvidence({ stepId: 's-1', stepName: 'check' });
    s1 = appendStepEvent(s1, {
      kind: 'verification',
      result: { type: 'exit_code', passed: true, expected: '0', actual: '0' },
    });
    s1 = completeStep(s1, 'passed');

    const completed = completeRun({ ...run, steps: [s1] });
    const summary = summarizeEvidence(completed);
    expect(summary.allVerificationsPassed).toBe(true);
  });

  it('includes run-level artifacts in artifact count', () => {
    const run = createRunEvidence({ runId: 'r-1', workflowId: 'wf-1', workflowName: 'test' });
    const completed = completeRun({
      ...run,
      artifacts: [{ path: 'signoff.md', kind: 'report' }],
    });
    const summary = summarizeEvidence(completed);
    expect(summary.artifactCount).toBe(1);
  });

  it('counts cancelled and timed_out steps correctly', () => {
    const run = createRunEvidence({ runId: 'r-1', workflowId: 'wf-1', workflowName: 'test' });
    const s1 = completeStep(createStepEvidence({ stepId: 's-1', stepName: 'a' }), 'cancelled');
    const s2 = completeStep(createStepEvidence({ stepId: 's-2', stepName: 'b' }), 'timed_out');
    const s3 = completeStep(createStepEvidence({ stepId: 's-3', stepName: 'c' }), 'passed');
    const completed = completeRun({ ...run, steps: [s1, s2, s3] });
    const summary = summarizeEvidence(completed);

    expect(summary.cancelledSteps).toBe(1);
    expect(summary.timedOutSteps).toBe(1);
    expect(summary.passedSteps).toBe(1);
    expect(summary.failedStepIds).toEqual(['s-1', 's-2']);
    expect(summary.runStatus).toBe('timed_out');
  });

  it('reports allDeterministicGatesPassed across run and step gates', () => {
    const run = createRunEvidence({ runId: 'r-1', workflowId: 'wf-1', workflowName: 'test' });
    const step = createStepEvidence({ stepId: 's-1', stepName: 'gate-step' });
    const runWithStep = { ...run, steps: [step] };

    const { run: r2 } = recordDeterministicGate(
      runWithStep, 'pass-gate',
      [{ type: 'exit_code' as const, passed: true, expected: '0', actual: '0' }],
      's-1',
    );

    const completed = completeRun(r2);
    const summary = summarizeEvidence(completed);
    expect(summary.allDeterministicGatesPassed).toBe(true);
  });

  it('reports allVerificationsPassed as true when no verifications exist', () => {
    const run = createRunEvidence({ runId: 'r-1', workflowId: 'wf-1', workflowName: 'test' });
    const s1 = completeStep(createStepEvidence({ stepId: 's-1', stepName: 'a' }), 'passed');
    const completed = completeRun({ ...run, steps: [s1] });
    const summary = summarizeEvidence(completed);
    expect(summary.allVerificationsPassed).toBe(true);
  });

  it('reports allDeterministicGatesPassed as true when no gates exist', () => {
    const run = createRunEvidence({ runId: 'r-1', workflowId: 'wf-1', workflowName: 'test' });
    const completed = completeRun(run);
    const summary = summarizeEvidence(completed);
    expect(summary.allDeterministicGatesPassed).toBe(true);
  });
});

describe('completeRun — non-terminal step guard', () => {
  it('does not stamp completedAt when a step is still running', () => {
    const run = createRunEvidence({ runId: 'r-1', workflowId: 'wf-1', workflowName: 'test' });
    const s1 = appendStepEvent(
      createStepEvidence({ stepId: 's-1', stepName: 'a' }),
      { kind: 'status_change', status: 'running' },
    );
    const s2 = completeStep(createStepEvidence({ stepId: 's-2', stepName: 'b' }), 'passed');

    const result = completeRun({ ...run, steps: [s1, s2] });
    expect(result.status).toBe('running');
    expect(result.completedAt).toBeUndefined();
    expect(result.durationMs).toBeUndefined();
  });

  it('does not stamp completedAt when a step is still pending', () => {
    const run = createRunEvidence({ runId: 'r-1', workflowId: 'wf-1', workflowName: 'test' });
    const s1 = createStepEvidence({ stepId: 's-1', stepName: 'a' }); // pending
    const s2 = completeStep(createStepEvidence({ stepId: 's-2', stepName: 'b' }), 'passed');

    const result = completeRun({ ...run, steps: [s1, s2] });
    expect(result.status).toBe('running');
    expect(result.completedAt).toBeUndefined();
    expect(result.durationMs).toBeUndefined();
  });
});

describe('createDeterministicGate', () => {
  it('creates a gate with command evidence', () => {
    const gate = createDeterministicGate({
      gateName: 'tsc-gate',
      verifications: [
        { type: 'exit_code', passed: true, expected: '0', actual: '0' },
      ],
      command: 'npx tsc --noEmit',
      exitCode: 0,
      stdoutExcerpt: '',
      stderrExcerpt: '',
    });

    expect(gate.gateName).toBe('tsc-gate');
    expect(gate.passed).toBe(true);
    expect(gate.command).toBe('npx tsc --noEmit');
    expect(gate.exitCode).toBe(0);
    expect(gate.recordedAt).toBeDefined();
  });
});

describe('attachRunLog', () => {
  it('appends a log reference to the run', () => {
    const run = createRunEvidence({ runId: 'r-1', workflowId: 'wf-1', workflowName: 'test' });
    const updated = attachRunLog(run, { stream: 'stdout', excerpt: 'build OK' });
    expect(updated.logs).toHaveLength(1);
    expect(updated.logs[0].stream).toBe('stdout');
    expect(run.logs).toHaveLength(0); // original not mutated
  });
});

describe('recordRoutingDecision', () => {
  it('appends a routing decision to the run', () => {
    const run = createRunEvidence({ runId: 'r-1', workflowId: 'wf-1', workflowName: 'test' });
    const updated = recordRoutingDecision(run, {
      abstractionName: 'build-strategy',
      resolvedRoute: 'incremental',
      routedBy: 'coordinator',
      reason: 'cache hit',
    });
    expect(updated.routing).toHaveLength(1);
    expect(updated.routing[0].resolvedRoute).toBe('incremental');
    expect(updated.routing[0].recordedAt).toBeDefined();
    expect(run.routing).toHaveLength(0); // original not mutated
  });
});

describe('appendRunNarrative', () => {
  it('appends a narrative to the run', () => {
    const run = createRunEvidence({ runId: 'r-1', workflowId: 'wf-1', workflowName: 'test' });
    const updated = appendRunNarrative(run, {
      agentRole: 'coordinator',
      summary: 'All steps passed.',
    });
    expect(updated.narrative).toHaveLength(1);
    expect(updated.narrative[0].summary).toBe('All steps passed.');
    expect(updated.narrative[0].recordedAt).toBeDefined();
    expect(run.narrative).toHaveLength(0); // original not mutated
  });
});

describe('appendStepEvent — routing and narrative', () => {
  it('sets routing on a step', () => {
    let step = createStepEvidence({ stepId: 's-1', stepName: 'route' });
    step = appendStepEvent(step, {
      kind: 'routing',
      route: {
        abstractionName: 'deploy',
        resolvedRoute: 'blue-green',
        recordedAt: '2026-04-26T10:00:00.000Z',
      },
    });
    expect(step.routing).toBeDefined();
    expect(step.routing!.resolvedRoute).toBe('blue-green');
  });

  it('appends narrative to a step', () => {
    let step = createStepEvidence({ stepId: 's-1', stepName: 'narrate' });
    step = appendStepEvent(step, {
      kind: 'narrative',
      narrative: {
        agentRole: 'impl',
        summary: 'Build completed successfully.',
        recordedAt: '2026-04-26T10:00:00.000Z',
      },
    });
    expect(step.narrative).toHaveLength(1);
    expect(step.narrative[0].summary).toBe('Build completed successfully.');
  });
});

describe('appendStepEvent — full retry object', () => {
  it('records a full WorkflowRetryEvidence via the retry event', () => {
    let step = createStepEvidence({ stepId: 's-1', stepName: 'retry-full' });
    step = appendStepEvent(step, {
      kind: 'retry',
      retry: {
        attempt: 1,
        stepId: 's-1',
        status: 'failed',
        error: 'timeout',
        command: 'npm test',
        exitCode: 1,
      },
    });
    expect(step.retries).toHaveLength(1);
    expect(step.retries[0].attempt).toBe(1);
    expect(step.retries[0].command).toBe('npm test');
    expect(step.retries[0].error).toBe('timeout');
  });
});

describe('createRunEvidence — with routing', () => {
  it('creates a run with initial routing decision', () => {
    const run = createRunEvidence({
      runId: 'r-1',
      workflowId: 'wf-1',
      workflowName: 'test',
      routing: {
        abstractionName: 'entry',
        resolvedRoute: 'fast-path',
      },
    });
    expect(run.routing).toHaveLength(1);
    expect(run.routing[0].resolvedRoute).toBe('fast-path');
    expect(run.routing[0].recordedAt).toBeDefined();
  });
});

describe('createStepEvidence — with routing', () => {
  it('creates a step with initial routing', () => {
    const step = createStepEvidence({
      stepId: 's-1',
      stepName: 'routed',
      routing: {
        abstractionName: 'strategy',
        resolvedRoute: 'parallel',
      },
    });
    expect(step.routing).toBeDefined();
    expect(step.routing!.resolvedRoute).toBe('parallel');
    expect(step.routing!.recordedAt).toBeDefined();
  });
});
