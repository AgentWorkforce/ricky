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
      allowedDirtyScope: [
        'src/product/billing/api.ts',
        '.workflow-artifacts/wave99-billing/implement-billing-api/signoff.md',
      ],
      dependsOn: [],
      parallelizable: true,
      wave: 0,
      signoffArtifactPath:
        '.workflow-artifacts/wave99-billing/implement-billing-api/signoff.md',
      signoffMarker: 'RICKY_IMPLEMENT_BILLING_API_IMPLEMENTED',
      validationCommands: [
        'if [ -x ./node_modules/.bin/tsc ]; then ./node_modules/.bin/tsc --noEmit; elif [ "$(npm pkg get scripts.typecheck 2>/dev/null)" != "{}" ]; then npm run typecheck; else npx tsc --noEmit; fi',
      ],
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
          command:
            'if [ -x ./node_modules/.bin/tsc ]; then ./node_modules/.bin/tsc --noEmit; elif [ "$(npm pkg get scripts.typecheck 2>/dev/null)" != "{}" ]; then npm run typecheck; else npx tsc --noEmit; fi',
        }),
        expect.objectContaining({
          kind: 'dryrun_command',
          required: true,
          command: `agent-relay run --dry-run ${apiChild.workflowFilePath}`,
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

  it('promotes child-level ambiguities to the top-level plan', () => {
    const plan = planMasterExecution({
      title: 'Ambiguous dependency plan',
      description: 'A child references an unknown dependency.',
      desiredSlices: [
        {
          id: 'needs-missing',
          title: 'Needs missing dependency',
          targetFiles: ['src/needs.ts'],
          dependsOn: ['missing-child'],
        },
      ],
    });

    expect(children(plan)[0].ambiguous?.reason).toContain('Unknown dependency: missing-child.');
    expect(plan.ambiguous?.reason).toContain('Unknown dependency: missing-child.');
  });

  it('rejects empty and cyclic specs as ambiguous', () => {
    const emptyPlan = planMasterExecution({
      title: 'No safe slice',
      description: 'No desired slices or target files are available.',
    });

    expect(emptyPlan.children).toEqual([]);
    expect(emptyPlan.ambiguous?.reason).toContain('No desired slices or target files');

    const cyclicPlan = planMasterExecution({
      title: 'Cyclic dependency plan',
      description: 'Two slices depend on each other.',
      desiredSlices: [
        {
          id: 'first',
          title: 'First',
          targetFiles: ['src/first.ts'],
          dependsOn: ['second'],
        },
        {
          id: 'second',
          title: 'Second',
          targetFiles: ['src/second.ts'],
          dependsOn: ['first'],
        },
      ],
    });

    expect(cyclicPlan.ambiguous?.reason).toContain('Dependency cycle detected.');
    expect(cyclicPlan.children.some((plannedChild) => plannedChild.ambiguous?.reason.includes('Dependency cycle'))).toBe(
      true,
    );
  });

  it('returns stable child ids and workflow paths across identical inputs', () => {
    const input = {
      title: 'Stable executor rollout',
      description: 'The same spec should produce byte-stable execution plans.',
      wavePrefix: 'wave99-stable',
      desiredSlices: [
        {
          title: 'Runtime Policy',
          targetFiles: ['src/runtime/policy.ts'],
        },
        {
          title: 'Runtime Policy',
          targetFiles: ['src/runtime/policy.test.ts'],
        },
        {
          title: 'Telemetry Adapter',
          targetFiles: ['src/runtime/telemetry.ts'],
          dependsOn: ['runtime-policy'],
        },
      ],
    };

    const first = planMasterExecution(input);
    const second = planMasterExecution(input);

    expect(first).toEqual(second);
    expect(children(first).map((plannedChild) => plannedChild.id)).toEqual([
      'runtime-policy',
      'runtime-policy-2',
      'telemetry-adapter',
    ]);
    expect(children(first).map((plannedChild) => plannedChild.workflowFilePath)).toEqual([
      'workflows/wave99-stable/01-runtime-policy.ts',
      'workflows/wave99-stable/02-runtime-policy-2.ts',
      'workflows/wave99-stable/03-telemetry-adapter.ts',
    ]);
  });
});

describe('runMasterExecution', () => {
  it('escalates an empty plan instead of reporting complete', async () => {
    const emptyPlan = planMasterExecution({
      title: 'No safe slice',
      description: 'No desired slices or target files are available.',
    });
    expect(emptyPlan.children).toEqual([]);

    let invoked = false;
    const result = await runMasterExecution(emptyPlan, async () => {
      invoked = true;
      throw new Error('runner should not be invoked for an empty plan');
    });

    expect(invoked).toBe(false);
    expect(result.childResults).toEqual([]);
    expect(result.decision).toMatchObject({ kind: 'escalate' });
    expect(result.decision).not.toEqual({ kind: 'complete' });
  });

  it('runs every dependency wave only after the previous wave completed', async () => {
    const plan = planMasterExecution({
      title: 'Ordered rollout',
      description: 'Runtime and docs complete before telemetry starts.',
      desiredSlices: [
        { id: 'runtime', title: 'Runtime', targetFiles: ['src/runtime.ts'] },
        { id: 'docs', title: 'Docs', targetFiles: ['docs/runtime.md'] },
        {
          id: 'telemetry',
          title: 'Telemetry',
          targetFiles: ['src/telemetry.ts'],
          dependsOn: ['runtime'],
        },
      ],
    });
    const events: string[] = [];
    const controls = new Map<string, Deferred<void>>();

    const execution = runMasterExecution(
      plan,
      async (plannedChild: ChildWorkflowPlan, ctx: RunnerContext) => {
        events.push(`start:${plannedChild.id}`);
        const control = deferred<void>();
        controls.set(plannedChild.id, control);
        await control.promise;
        events.push(`finish:${plannedChild.id}`);
        return passedRun(plannedChild, ctx.attempt);
      },
      { maxConcurrency: 2 },
    );

    await waitUntil(() =>
      expect(events.filter((event) => event.startsWith('start:'))).toEqual(['start:runtime', 'start:docs']),
    );
    expect(events).not.toContain('start:telemetry');

    controls.get('runtime')?.resolve();
    await waitUntil(() => expect(events).toContain('finish:runtime'));
    expect(events).not.toContain('start:telemetry');

    controls.get('docs')?.resolve();
    await waitUntil(() => expect(events).toContain('start:telemetry'));
    controls.get('telemetry')?.resolve();

    const result = await execution;
    expect(result.decision).toEqual({ kind: 'complete' });
    expect(events.indexOf('start:telemetry')).toBeGreaterThan(events.indexOf('finish:runtime'));
    expect(events.indexOf('start:telemetry')).toBeGreaterThan(events.indexOf('finish:docs'));
  });

  it('enforces maxConcurrency while running independent children', async () => {
    const plan = planMasterExecution({
      title: 'Parallel product slices',
      description: 'Five independent slices can run in a bounded pool.',
      desiredSlices: [
        { id: 'slice-one', title: 'Slice one', targetFiles: ['src/a.ts'] },
        { id: 'slice-two', title: 'Slice two', targetFiles: ['src/b.ts'] },
        { id: 'slice-three', title: 'Slice three', targetFiles: ['src/c.ts'] },
        { id: 'slice-four', title: 'Slice four', targetFiles: ['src/d.ts'] },
        { id: 'slice-five', title: 'Slice five', targetFiles: ['src/e.ts'] },
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
    await waitUntil(() => expect(starts).toHaveLength(4));
    expect(peakConcurrency).toBe(2);

    controls.get('slice-three')?.resolve();
    await waitUntil(() => expect(starts).toHaveLength(5));
    expect(peakConcurrency).toBe(2);

    controls.get('slice-four')?.resolve();
    controls.get('slice-five')?.resolve();

    const result = await execution;
    expect(result.decision).toEqual({ kind: 'complete' });
    expect(runs(result).map((run: ChildWorkflowRunResult) => run.childId)).toEqual([
      'slice-one',
      'slice-two',
      'slice-three',
      'slice-four',
      'slice-five',
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

  it('classifies a failed child with more than four target files as split', async () => {
    const plan = planMasterExecution({
      title: 'Oversized implementation slice',
      description: 'A broad file scope should be split after failure.',
      desiredSlices: [
        {
          id: 'wide-slice',
          title: 'Wide slice',
          targetFiles: [
            'src/product/one.ts',
            'src/product/two.ts',
            'src/product/three.ts',
            'src/product/four.ts',
            'src/product/five.ts',
          ],
        },
      ],
    });
    const target = children(plan)[0];

    const result = await runMasterExecution(plan, async () =>
      failedRun(target, {
        signoffPresent: false,
        errorMessage: 'implementation slice exceeded reviewable scope',
      }),
    );

    expect(result.decision).toMatchObject({
      kind: 'split',
      childId: 'wide-slice',
    });
  });

  it('classifies a missing environment variable as blocked', async () => {
    const plan = singleChildPlan('Publish cloud workflow');
    const target = children(plan)[0];

    const result = await runMasterExecution(plan, async () =>
      blockedRun(target, 'MISSING_ENV_VAR: ANTHROPIC_API_KEY'),
    );

    expect(result.decision).toEqual({
      kind: 'blocked',
      childId: target.id,
      missing: ['ANTHROPIC_API_KEY'],
    });
  });

  it('classifies thrown missing environment errors as blocked', async () => {
    const plan = singleChildPlan('Publish cloud workflow');
    const target = children(plan)[0];

    const result = await runMasterExecution(plan, async () => {
      throw new Error('MISSING_ENV_VAR: ANTHROPIC_API_KEY');
    });

    expect(result.decision).toEqual({
      kind: 'blocked',
      childId: target.id,
      missing: ['ANTHROPIC_API_KEY'],
    });
    expect(runFor(result, target.id)).toMatchObject({
      status: 'blocked',
      blockedReason: 'MISSING_ENV_VAR: ANTHROPIC_API_KEY',
    });
  });

  it('converts resume signoff reader failures into a child result', async () => {
    const plan = singleChildPlan('Resume with unreadable signoff');
    const target = children(plan)[0];

    const result = await runMasterExecution(
      plan,
      async (plannedChild: ChildWorkflowPlan, ctx: RunnerContext) => passedRun(plannedChild, ctx.attempt),
      {
        resume: true,
        signoffArtifactReader: async () => {
          throw new Error('cannot read signoff');
        },
      },
    );

    expect(result.childResults).toHaveLength(1);
    expect(runFor(result, target.id)).toMatchObject({
      status: 'failed',
      errorMessage: 'cannot read signoff',
    });
  });

  it('does not duplicate cancelled children in continue mode', async () => {
    const plan = planMasterExecution({
      title: 'Continue after dependency failure',
      description: 'A failed upstream cancels downstream once.',
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
    const upstream = child(plan, 'upstream');

    const result = await runMasterExecution(
      plan,
      async () => failedRun(upstream, {
        signoffPresent: false,
        errorMessage: 'unit test failed',
      }),
      { failurePolicy: 'continue' },
    );

    expect(result.childResults.filter((run) => run.childId === 'downstream')).toHaveLength(1);
    expect(runFor(result, 'downstream').status).toBe('cancelled');
  });

  it('falls back to default bounded concurrency for non-finite maxConcurrency values', async () => {
    const plan = planMasterExecution({
      title: 'Non-finite concurrency',
      description: 'Concurrency should stay bounded.',
      desiredSlices: [
        { id: 'one', title: 'One', targetFiles: ['src/one.ts'] },
        { id: 'two', title: 'Two', targetFiles: ['src/two.ts'] },
        { id: 'three', title: 'Three', targetFiles: ['src/three.ts'] },
      ],
    });
    const controls = new Map<string, Deferred<void>>();
    const starts: string[] = [];

    const execution = runMasterExecution(
      plan,
      async (plannedChild: ChildWorkflowPlan, ctx: RunnerContext) => {
        starts.push(plannedChild.id);
        const control = deferred<void>();
        controls.set(plannedChild.id, control);
        await control.promise;
        return passedRun(plannedChild, ctx.attempt);
      },
      { maxConcurrency: Number.POSITIVE_INFINITY },
    );

    await waitUntil(() => expect(starts).toHaveLength(2));
    controls.get('one')?.resolve();
    controls.get('two')?.resolve();
    await waitUntil(() => expect(starts).toHaveLength(3));
    controls.get('three')?.resolve();

    const result = await execution;
    expect(result.decision).toEqual({ kind: 'complete' });
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

  it('ignores failing optional gates when required gates passed', async () => {
    const basePlan = singleChildPlan('Optional proof artifact');
    const target = children(basePlan)[0];
    const optionalGate: ChildWorkflowGate = {
      id: 'optional:notes',
      kind: 'dryrun_command',
      description: 'Optional notes gate.',
      required: false,
      command: 'npm run optional-proof',
    };
    const childWithOptionalGate: ChildWorkflowPlan = {
      ...target,
      gates: [...target.gates, optionalGate],
    };
    const plan: MasterExecutionPlan = {
      ...basePlan,
      children: [childWithOptionalGate],
    };

    const result = await runMasterExecution(plan, async (plannedChild: ChildWorkflowPlan, ctx: RunnerContext) =>
      passedRun(plannedChild, ctx.attempt, {
        gateResults: [
          ...passedGateResults(plannedChild.gates.filter((gate: ChildWorkflowGate) => gate.required)),
          {
            gateId: optionalGate.id,
            kind: optionalGate.kind,
            passed: false,
            detail: 'Optional command did not run.',
          },
        ],
      }),
    );

    expect(result.decision).toEqual({ kind: 'complete' });
    expect(runFor(result, childWithOptionalGate.id).evidence.gateResults).not.toContainEqual(
      expect.objectContaining({ gateId: optionalGate.id }),
    );
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
