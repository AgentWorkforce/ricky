import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  RuntimeOutcomeCase,
  runAllRuntimeOutcomeFixtures,
  runRuntimeOutcomeFixture,
  summaryShapeForProof,
} from './runtime-outcome-proof.js';
import { FailureClass, NextAction } from '../../failure/types.js';

const FIXED_NOW = new Date('2026-04-27T09:30:00.000Z');

beforeEach(() => {
  vi.useFakeTimers({ now: FIXED_NOW });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('runtime outcome proof fixtures', () => {
  it('covers every required runtime outcome class', () => {
    const cases = runAllRuntimeOutcomeFixtures().map((proof) => proof.caseName);

    expect(cases.sort()).toEqual([
      RuntimeOutcomeCase.RunnerEnvironmentFailure,
      RuntimeOutcomeCase.Success,
      RuntimeOutcomeCase.Timeout,
      RuntimeOutcomeCase.VerificationFailure,
    ].sort());
  });

  it('is deterministic and uses no live relay dependency', () => {
    const first = runAllRuntimeOutcomeFixtures();
    const second = runAllRuntimeOutcomeFixtures();

    expect(second).toEqual(first);
    for (const proof of first) {
      expect(proof.run.routing[0].resolvedRoute).toBe('deterministic-runtime-fixture');
      expect(proof.run.routing[0].reason).toContain('avoids live agent-relay dependency');
    }
  });

  it('captures a successful run with ids, events, gates, snippets, and summary shape', () => {
    const proof = runRuntimeOutcomeFixture(RuntimeOutcomeCase.Success);

    expect(proof.run.runId).toBe('runtime-outcome-success');
    expect(proof.outcome.runId).toBe(proof.run.runId);
    expect(proof.outcome.status).toBe('passed');
    expect(proof.outcome.passed).toBe(true);
    expect(proof.outcome.failureKind).toBe('none');
    expect(proof.classification.failureClass).toBe(FailureClass.Unknown);

    expect(proof.run.steps[0].history.map((event) => event.status)).toEqual([
      'running',
      'passed',
    ]);
    expect(proof.outcome.deterministicGates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          gateName: 'artifact-contract',
          passed: true,
          verificationCount: 1,
        }),
      ]),
    );
    expect(proof.outcome.outputSnippets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ stream: 'stdout', text: 'rendered artifact.md' }),
        expect.objectContaining({
          stream: 'stdout',
          text: 'artifact exists: artifacts/outcome.md',
        }),
      ]),
    );
    expect(summaryShapeForProof(proof.run)).toEqual({
      runId: 'runtime-outcome-success',
      workflowName: 'runtime-outcome-proof',
      runStatus: 'passed',
      totalSteps: 1,
      passedSteps: 1,
      failedSteps: 0,
      timedOutSteps: 0,
      allVerificationsPassed: true,
      allDeterministicGatesPassed: true,
      failedStepIds: [],
      firstError: undefined,
      artifactCount: 2,
      retryCount: 0,
      routeCount: 1,
    });
  });

  it('captures verification failure and maps it to the failure taxonomy', () => {
    const proof = runRuntimeOutcomeFixture(RuntimeOutcomeCase.VerificationFailure);

    expect(proof.run.runId).toBe('runtime-outcome-verification_failure');
    expect(proof.outcome.status).toBe('failed');
    expect(proof.outcome.failureKind).toBe('deterministic_gate');
    expect(proof.outcome.failureMessage).toBe('required completion marker missing');
    expect(proof.classification.failureClass).toBe(FailureClass.VerificationFailure);
    expect(proof.classification.nextAction).toBe(NextAction.FixAndRetry);

    expect(proof.run.steps[0].history.map((event) => event.status)).toEqual([
      'running',
      'failed',
    ]);
    expect(proof.outcome.deterministicGates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          gateName: 'completion-marker-gate',
          passed: false,
          failedVerificationMessages: ['required completion marker missing'],
        }),
      ]),
    );
    expect(proof.outcome.outputSnippets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ stream: 'stdout', text: 'candidate output missing marker' }),
        expect.objectContaining({ stream: 'stderr', text: 'pattern not found' }),
      ]),
    );
    expect(summaryShapeForProof(proof.run)).toEqual({
      runId: 'runtime-outcome-verification_failure',
      workflowName: 'runtime-outcome-proof',
      runStatus: 'failed',
      totalSteps: 1,
      passedSteps: 0,
      failedSteps: 1,
      timedOutSteps: 0,
      allVerificationsPassed: false,
      allDeterministicGatesPassed: false,
      failedStepIds: ['verify-contract'],
      firstError: 'required completion marker missing',
      artifactCount: 0,
      retryCount: 0,
      routeCount: 1,
    });
  });

  it('captures timeout outcome and maps it to timeout taxonomy', () => {
    const proof = runRuntimeOutcomeFixture(RuntimeOutcomeCase.Timeout);

    expect(proof.run.runId).toBe('runtime-outcome-timeout');
    expect(proof.outcome.status).toBe('timed_out');
    expect(proof.outcome.failureKind).toBe('timeout');
    expect(proof.outcome.timedOutStepIds).toEqual(['wait-for-runner']);
    expect(proof.classification.failureClass).toBe(FailureClass.Timeout);
    expect(proof.classification.nextAction).toBe(NextAction.Retry);

    expect(proof.run.steps[0].history.map((event) => event.status)).toEqual([
      'running',
      'timed_out',
    ]);
    expect(proof.outcome.deterministicGates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          gateName: 'runtime-time-budget',
          passed: false,
        }),
      ]),
    );
    expect(proof.outcome.outputSnippets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ stream: 'stderr', text: 'timed out after 30000ms' }),
      ]),
    );
    expect(summaryShapeForProof(proof.run)).toEqual({
      runId: 'runtime-outcome-timeout',
      workflowName: 'runtime-outcome-proof',
      runStatus: 'timed_out',
      totalSteps: 1,
      passedSteps: 0,
      failedSteps: 0,
      timedOutSteps: 1,
      allVerificationsPassed: false,
      allDeterministicGatesPassed: false,
      failedStepIds: ['wait-for-runner'],
      firstError: 'runner step timed out after 30000ms',
      artifactCount: 0,
      retryCount: 0,
      routeCount: 1,
    });
  });

  it('captures runner environment failure and maps it to environment taxonomy', () => {
    const proof = runRuntimeOutcomeFixture(RuntimeOutcomeCase.RunnerEnvironmentFailure);

    expect(proof.run.runId).toBe('runtime-outcome-runner_environment_failure');
    expect(proof.outcome.status).toBe('failed');
    expect(proof.outcome.failureKind).toBe('deterministic_gate');
    expect(proof.outcome.failureMessage).toBe('spawn fixture-runner ENOENT');
    expect(proof.classification.failureClass).toBe(FailureClass.EnvironmentError);
    expect(proof.classification.nextAction).toBe(NextAction.InvestigateEnvironment);
    expect(proof.classification.secondaryClasses).toContain(FailureClass.VerificationFailure);

    expect(proof.run.steps[0].history.map((event) => event.status)).toEqual([
      'running',
      'failed',
    ]);
    expect(proof.outcome.deterministicGates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          gateName: 'runner-launch-gate',
          passed: false,
        }),
      ]),
    );
    expect(proof.outcome.outputSnippets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ stream: 'system', text: 'command not found: fixture-runner' }),
        expect.objectContaining({ stream: 'stderr', text: 'spawn fixture-runner ENOENT' }),
      ]),
    );
    expect(summaryShapeForProof(proof.run)).toEqual({
      runId: 'runtime-outcome-runner_environment_failure',
      workflowName: 'runtime-outcome-proof',
      runStatus: 'failed',
      totalSteps: 1,
      passedSteps: 0,
      failedSteps: 1,
      timedOutSteps: 0,
      allVerificationsPassed: false,
      allDeterministicGatesPassed: false,
      failedStepIds: ['spawn-runner'],
      firstError: 'spawn fixture-runner ENOENT',
      artifactCount: 0,
      retryCount: 0,
      routeCount: 1,
    });
  });
});
