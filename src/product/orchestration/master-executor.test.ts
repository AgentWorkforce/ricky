import { describe, expect, it } from 'vitest';

import {
  planMasterExecution,
  runMasterExecution,
  type ChildRunner,
  type ChildWorkflowPlan,
  type ChildWorkflowRunResult,
  type ChildWorkflowGate,
  type MasterExecutionPlan,
} from './index.js';

const STARTED_AT = '2026-05-07T10:00:00.000Z';
const COMPLETED_AT = '2026-05-07T10:00:01.000Z';

interface RunnerContext {
  attempt: number;
  resume: boolean;
  abortSignal: AbortSignal;
}

describe('planMasterExecution', () => {
  it('decomposes a spec into stable child workflow plans with default 80-to-100 gates', () => {
    const plan = planMasterExecution({
      title: 'Ship billing automation',
      description: 'Split billing API, tests, and docs into bounded execution slices.',
      wavePrefix: 'wave99-billing',
      desiredSlices: [
        {
          title: 'Implement billing API',
          targetFiles: ['src/product/billing/api.ts'],
        },
        {
          id: 'billing-tests',
          title: 'Add billing tests',
          targetFiles: ['src/product/billing/api.test.ts'],
          dependsOn: ['implement-billing-api'],
        },
        {
          title: 'Document billing rollout',
          targetFiles: ['docs/product/billing-rollout.md'],
        },
      ],
    });

    expect(children(plan).map((plannedChild: ChildWorkflowPlan) => plannedChild.id)).toEqual([
      'implement-billing-api',
      'document-billing-rollout',
      'billing-tests',
    ]);
    expect(children(plan).map((plannedChild: ChildWorkflowPlan) => plannedChild.workflowFilePath)).toEqual([
      'workflows/wave99-billing/01-implement-billing-api.ts',
      'workflows/wave99-billing/02-document-billing-rollout.ts',
      'workflows/wave99-billing/03-billing-tests.ts',
    ]);

    const apiChild = child(plan, 'implement-billing-api');
    expect(apiChild).toMatchObject({
      title: 'Implement billing API',
      targetFiles: ['src/product/billing/api.ts'],
      allowedDirtyScope: ['src/product/billing/api.ts'],
      dependsOn: [],
      parallelizable: true,
      wave: 0,
      signoffArtifactPath:
        '.workflow-artifacts/wave99-billing/implement-billing-api/signoff.md',
      signoffMarker: 'RICKY_IMPLEMENT_BILLING_API_IMPLEMENTED',
      validationCommands: ['npm run typecheck'],
      retryPolicy: { maxAttempts: 2, backoffMs: 1000 },
    });
    expect(apiChild.gates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'signoff_artifact',
          required: true,
          artifactPath: apiChild.signoffArtifactPath,
        }),
        expect.objectContaining({
          kind: 'marker_string',
          required: true,
          marker: apiChild.signoffMarker,
        }),
        expect.objectContaining({
          kind: 'changed_files',
          required: true,
          fileScope: ['src/product/billing/api.ts'],
        }),
        expect.objectContaining({
          kind: 'test_command',
          required: true,
          command: 'npm run typecheck',
        }),
      ]),
    );

    const testsChild = child(plan, 'billing-tests');
    expect(testsChild.dependsOn).toEqual(['implement-billing-api']);
    expect(testsChild.wave).toBe(1);
  });

  it('assigns dependency waves and preserves topological child ordering', () => {
    const plan = planMasterExecution({
      title: 'Coordinate runtime rollout',
      description: 'Runtime policy gates telemetry and insight work.',
      desiredSlices: [
        { id: 'runtime-policy', title: 'Runtime policy', targetFiles: ['src/runtime/policy.ts'] },
        {
          id: 'telemetry',
          title: 'Telemetry',
          targetFiles: ['src/runtime/telemetry.ts'],
          dependsOn: ['runtime-policy'],
        },
        {
          id: 'insights',
          title: 'Insights',
          targetFiles: ['src/product/insights.ts'],
          dependsOn: ['telemetry'],
        },
        { id: 'docs', title: 'Docs', targetFiles: ['docs/runtime-rollout.md'] },
      ],
    });

    expect(children(plan).map((plannedChild: ChildWorkflowPlan) => [plannedChild.id, plannedChild.wave])).toEqual([
      ['runtime-policy', 0],
      ['docs', 0],
      ['telemetry', 1],
      ['insights', 2],
    ]);
  });
});

describe('runMasterExecution', () => {
  it('enforces maxConcurrency while running independent children', async () => {
    const plan = planMasterExecution({
      title: 'Parallel product slices',
      description: 'Four independent slices can run in a bounded pool.',
      desiredSlices: [
        { id: 'slice-one', title: 'Slice one', targetFiles: ['src/a.ts'] },
        { id: 'slice-two', title: 'Slice two', targetFiles: ['src/b.ts'] },
        { id: 'slice-three', title: 'Slice three', targetFiles: ['src/c.ts'] },
        { id: 'slice-four', title: 'Slice four', targetFiles: ['src/d.ts'] },
      ],
    });
    const controls = new Map<string, Deferred<void>>();
    const starts: string[] = [];
    let inFlight = 0;
    let peakConcurrency = 0;

    const runner: ChildRunner = async (plannedChild: ChildWorkflowPlan, ctx: RunnerContext) => {
      starts.push(plannedChild.id);
      inFlight += 1;
      peakConcurrency = Math.max(peakConcurrency, inFlight);
      const control = deferred<void>();
      controls.set(plannedChild.id, control);
      await control.promise;
      inFlight -= 1;
      return passedRun(plannedChild, ctx.attempt);
    };

    const execution = runMasterExecution(plan, runner, { maxConcurrency: 2 });

    await waitUntil(() => expect(starts).toHaveLength(2));
    expect(peakConcurrency).toBe(2);
    expect(starts).toEqual(['slice-one', 'slice-two']);

    controls.get('slice-one')?.resolve();
    await waitUntil(() => expect(starts).toHaveLength(3));
    expect(peakConcurrency).toBe(2);

    controls.get('slice-two')?.resolve();
    controls.get('slice-three')?.resolve();
    await waitUntil(() => expect(starts).toHaveLength(4));
    controls.get('slice-four')?.resolve();

    const result = await execution;
    expect(result.decision).toEqual({ kind: 'complete' });
    expect(runs(result).map((run: ChildWorkflowRunResult) => run.childId)).toEqual([
      'slice-one',
      'slice-two',
      'slice-three',
      'slice-four',
    ]);
  });

  it('skips signed-off children during resume without invoking the runner', async () => {
    const plan = planMasterExecution({
      title: 'Resume existing work',
      description: 'One child already has a signoff marker on disk.',
      desiredSlices: [
        { id: 'already-done', title: 'Already done', targetFiles: ['src/done.ts'] },
        { id: 'still-needed', title: 'Still needed', targetFiles: ['src/needed.ts'] },
      ],
    });
    const invoked: string[] = [];
    const signedOffChild = child(plan, 'already-done');

    const result = await runMasterExecution(
      plan,
      async (plannedChild: ChildWorkflowPlan, ctx: RunnerContext) => {
        invoked.push(plannedChild.id);
        return passedRun(plannedChild, ctx.attempt);
      },
      {
        resume: true,
        signoffArtifactReader: async (artifactPath: string) =>
          artifactPath === signedOffChild.signoffArtifactPath
            ? `previous signoff\n${signedOffChild.signoffMarker}\n`
            : null,
      },
    );

    expect(invoked).toEqual(['still-needed']);
    expect(runFor(result, 'already-done')).toMatchObject({
      childId: 'already-done',
      status: 'skipped',
      evidence: {
        signoffPresent: true,
        markerPresent: true,
      },
    });
    expect(runFor(result, 'already-done').evidence.gateResults).toEqual(
      signedOffChild.gates
        .filter((gate: ChildWorkflowGate) => gate.required)
        .map((gate: ChildWorkflowGate) => ({ gateId: gate.id, kind: gate.kind, passed: true })),
    );
    expect(result.decision).toEqual({ kind: 'complete' });
    expect(result.resumed).toBe(true);
  });

  it('classifies a failed child inside its retry budget as retry', async () => {
    const plan = singleChildPlan('Implement repairable slice');
    const target = children(plan)[0];

    const result = await runMasterExecution(plan, async () =>
      failedRun(target, {
        signoffPresent: false,
        errorMessage: 'unit test failed before signoff artifact was written',
      }),
    );

    expect(result.decision).toMatchObject({
      kind: 'retry',
      childId: target.id,
    });
    expect(result.childResults).toHaveLength(1);
    expect(result.childResults[0]).toMatchObject({
      childId: target.id,
      status: 'failed',
      evidence: { signoffPresent: false },
    });
  });

  it('classifies a missing environment variable as blocked', async () => {
    const plan = singleChildPlan('Publish cloud workflow');
    const target = children(plan)[0];

    const result = await runMasterExecution(plan, async () =>
      blockedRun(target, 'MISSING_ENV_VAR: GITHUB_TOKEN'),
    );

    expect(result.decision).toEqual({
      kind: 'blocked',
      childId: target.id,
      missing: ['GITHUB_TOKEN'],
    });
  });

  it('only completes when every required gate for every required child passes', async () => {
    const plan = planMasterExecution({
      title: 'Gate final completion',
      description: 'Two children must both pass required evidence gates.',
      desiredSlices: [
        { id: 'source-change', title: 'Source change', targetFiles: ['src/source.ts'] },
        {
          id: 'test-change',
          title: 'Test change',
          targetFiles: ['src/source.test.ts'],
          dependsOn: ['source-change'],
        },
      ],
    });

    const complete = await runMasterExecution(plan, async (plannedChild: ChildWorkflowPlan, ctx: RunnerContext) =>
      passedRun(plannedChild, ctx.attempt),
    );

    expect(complete.decision).toEqual({ kind: 'complete' });

    const incomplete = await runMasterExecution(plan, async (plannedChild: ChildWorkflowPlan, ctx: RunnerContext) => {
      if (plannedChild.id === 'test-change') {
        return passedRun(plannedChild, ctx.attempt, {
          markerPresent: false,
          gateResults: plannedChild.gates.map((gate: ChildWorkflowGate) => ({
            gateId: gate.id,
            kind: gate.kind,
            passed: gate.kind !== 'marker_string',
            detail: gate.kind === 'marker_string' ? 'required marker missing' : undefined,
          })),
        });
      }

      return passedRun(plannedChild, ctx.attempt);
    });

    expect(incomplete.decision).not.toEqual({ kind: 'complete' });
    expect(runFor(incomplete, 'test-change').evidence).toMatchObject({
      signoffPresent: true,
      markerPresent: false,
    });
  });

  it('does not invoke a dependent child when an upstream required gate failed', async () => {
    const plan = planMasterExecution({
      title: 'Gate-aware dependency block',
      description: 'Upstream returns passed status but a required gate failed.',
      desiredSlices: [
        { id: 'upstream', title: 'Upstream', targetFiles: ['src/up.ts'] },
        {
          id: 'downstream',
          title: 'Downstream',
          targetFiles: ['src/down.ts'],
          dependsOn: ['upstream'],
        },
      ],
    });
    const invoked: string[] = [];

    const result = await runMasterExecution(plan, async (plannedChild: ChildWorkflowPlan, ctx: RunnerContext) => {
      invoked.push(plannedChild.id);
      if (plannedChild.id === 'upstream') {
        return passedRun(plannedChild, ctx.attempt, {
          markerPresent: false,
          gateResults: plannedChild.gates.map((gate: ChildWorkflowGate) => ({
            gateId: gate.id,
            kind: gate.kind,
            passed: gate.kind !== 'marker_string',
            detail: gate.kind === 'marker_string' ? 'upstream marker missing' : undefined,
          })),
        });
      }
      return passedRun(plannedChild, ctx.attempt);
    });

    expect(invoked).toEqual(['upstream']);
    expect(runFor(result, 'downstream').status).toBe('cancelled');
    expect(result.decision).not.toEqual({ kind: 'complete' });
  });

  it('runs same-wave non-parallelizable children serially with no overlap', async () => {
    const plan = planMasterExecution({
      title: 'Non-parallelizable scheduling',
      description: 'Two children share a file, so the second one must run alone.',
      desiredSlices: [
        { id: 'first', title: 'First', targetFiles: ['src/shared.ts'] },
        { id: 'second', title: 'Second', targetFiles: ['src/shared.ts'] },
      ],
    });
    expect(child(plan, 'first').parallelizable).toBe(true);
    expect(child(plan, 'second').parallelizable).toBe(false);
    expect(child(plan, 'first').wave).toBe(child(plan, 'second').wave);

    const controls = new Map<string, Deferred<void>>();
    const starts: string[] = [];
    let inFlight = 0;
    let peakConcurrency = 0;

    const runner: ChildRunner = async (plannedChild: ChildWorkflowPlan, ctx: RunnerContext) => {
      starts.push(plannedChild.id);
      inFlight += 1;
      peakConcurrency = Math.max(peakConcurrency, inFlight);
      const control = deferred<void>();
      controls.set(plannedChild.id, control);
      await control.promise;
      inFlight -= 1;
      return passedRun(plannedChild, ctx.attempt);
    };

    const execution = runMasterExecution(plan, runner, { maxConcurrency: 4 });

    await waitUntil(() => expect(starts).toHaveLength(1));
    expect(starts).toEqual(['first']);
    expect(peakConcurrency).toBe(1);

    controls.get('first')?.resolve();
    await waitUntil(() => expect(starts).toHaveLength(2));
    expect(starts).toEqual(['first', 'second']);
    expect(peakConcurrency).toBe(1);

    controls.get('second')?.resolve();
    const result = await execution;
    expect(result.decision).toEqual({ kind: 'complete' });
  });

  it('preserves distinct required gates of the same kind via stable gate ids', async () => {
    const plan = planMasterExecution({
      title: 'Duplicate-kind gate identity',
      description: 'requiredGateMarkers add extra marker_string gates that must merge by id.',
      desiredSlices: [
        { id: 'with-extra-markers', title: 'With markers', targetFiles: ['src/x.ts'] },
      ],
      constraints: { requiredGateMarkers: ['EXTRA_MARKER_A', 'EXTRA_MARKER_B'] },
    });
    const target = children(plan)[0];
    const markerGates = target.gates.filter((gate: ChildWorkflowGate) => gate.kind === 'marker_string');
    expect(markerGates.length).toBeGreaterThanOrEqual(3);
    expect(new Set(markerGates.map((gate: ChildWorkflowGate) => gate.id)).size).toBe(markerGates.length);

    const result = await runMasterExecution(plan, async (plannedChild: ChildWorkflowPlan, ctx: RunnerContext) => ({
      childId: plannedChild.id,
      status: 'passed' as const,
      attempt: ctx.attempt,
      startedAt: STARTED_AT,
      completedAt: COMPLETED_AT,
      durationMs: 1000,
      evidence: {
        signoffPresent: true,
        markerPresent: true,
        changedFiles: plannedChild.targetFiles,
        gateResults: plannedChild.gates.map((gate: ChildWorkflowGate) => ({
          gateId: gate.id,
          kind: gate.kind,
          passed: gate.id !== 'marker_string:EXTRA_MARKER_B',
          detail:
            gate.id === 'marker_string:EXTRA_MARKER_B'
              ? 'second extra marker not yet observed'
              : undefined,
        })),
      },
    }));

    const merged = runFor(result, target.id).evidence.gateResults;
    const markerResults = merged.filter((gateResult) => gateResult.kind === 'marker_string');
    expect(markerResults.length).toBeGreaterThanOrEqual(3);
    expect(merged.find((gateResult) => gateResult.gateId === 'marker_string:EXTRA_MARKER_A')?.passed).toBe(true);
    expect(merged.find((gateResult) => gateResult.gateId === 'marker_string:EXTRA_MARKER_B')?.passed).toBe(false);
    expect(result.decision).not.toEqual({ kind: 'complete' });
  });
});

function singleChildPlan(title: string): MasterExecutionPlan {
  return planMasterExecution({
    title,
    description: 'A single child plan for focused executor classification.',
    desiredSlices: [{ title, targetFiles: ['src/product/example.ts'] }],
  });
}

function child(plan: MasterExecutionPlan, childId: string): ChildWorkflowPlan {
  const plannedChild = children(plan).find((candidate: ChildWorkflowPlan) => candidate.id === childId);
  if (!plannedChild) {
    throw new Error(`Missing child ${childId}`);
  }

  return plannedChild;
}

function runFor(
  result: Awaited<ReturnType<typeof runMasterExecution>>,
  childId: string,
): ChildWorkflowRunResult {
  const run = runs(result).find((candidate: ChildWorkflowRunResult) => candidate.childId === childId);
  if (!run) {
    throw new Error(`Missing run ${childId}`);
  }

  return run;
}

function passedRun(
  childPlan: ChildWorkflowPlan,
  attempt: number,
  evidenceOverrides: Partial<ChildWorkflowRunResult['evidence']> = {},
): ChildWorkflowRunResult {
  return {
    childId: childPlan.id,
    status: 'passed',
    attempt,
    startedAt: STARTED_AT,
    completedAt: COMPLETED_AT,
    durationMs: 1000,
    evidence: {
      signoffPresent: true,
      markerPresent: true,
      changedFiles: childPlan.targetFiles,
      gateResults: passedGateResults(childPlan.gates),
      ...evidenceOverrides,
    },
  };
}

function failedRun(
  childPlan: ChildWorkflowPlan,
  overrides: {
    signoffPresent: boolean;
    errorMessage: string;
  },
): ChildWorkflowRunResult {
  return {
    childId: childPlan.id,
    status: 'failed',
    attempt: 1,
    startedAt: STARTED_AT,
    completedAt: COMPLETED_AT,
    durationMs: 1000,
    evidence: {
      signoffPresent: overrides.signoffPresent,
      markerPresent: false,
      changedFiles: [],
      gateResults: childPlan.gates.map((gate: ChildWorkflowGate) => ({
        gateId: gate.id,
        kind: gate.kind,
        passed: false,
        detail: 'gate did not pass',
      })),
    },
    errorMessage: overrides.errorMessage,
  };
}

function blockedRun(childPlan: ChildWorkflowPlan, blockedReason: string): ChildWorkflowRunResult {
  return {
    childId: childPlan.id,
    status: 'blocked',
    attempt: 1,
    startedAt: STARTED_AT,
    completedAt: COMPLETED_AT,
    durationMs: 1000,
    evidence: {
      signoffPresent: false,
      markerPresent: false,
      changedFiles: [],
      gateResults: childPlan.gates.map((gate: ChildWorkflowGate) => ({
        gateId: gate.id,
        kind: gate.kind,
        passed: false,
        detail: blockedReason,
      })),
    },
    blockedReason,
  };
}

function passedGateResults(
  gates: readonly ChildWorkflowGate[],
): ChildWorkflowRunResult['evidence']['gateResults'] {
  return gates.map((gate: ChildWorkflowGate) => ({ gateId: gate.id, kind: gate.kind, passed: true }));
}

function children(plan: MasterExecutionPlan): readonly ChildWorkflowPlan[] {
  return plan.children;
}

function runs(result: Awaited<ReturnType<typeof runMasterExecution>>): readonly ChildWorkflowRunResult[] {
  return result.childResults;
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve: Deferred<T>['resolve'] = () => undefined;
  let reject: Deferred<T>['reject'] = () => undefined;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });

  return { promise, resolve, reject };
}

async function waitUntil(assertion: () => void, timeoutMs = 1000): Promise<void> {
  const startedAt = Date.now();
  let lastError: unknown;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  if (lastError instanceof Error) {
    throw lastError;
  }

  throw new Error('Timed out waiting for assertion.');
}
