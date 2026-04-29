import { describe, expect, it, vi } from 'vitest';

import { runWithAutoFix } from './auto-fix-loop.js';
import type { LocalClassifiedBlocker, LocalResponse } from './entrypoint.js';
import type { LocalInvocationRequest } from './request-normalizer.js';
import type { FailureClassification } from '../runtime/failure/types.js';
import type { DebuggerResult } from '../product/specialists/debugger/types.js';
import type { WorkflowRunEvidence } from '../shared/models/workflow-evidence.js';

const baseRequest: LocalInvocationRequest = {
  _normalized: true,
  source: 'cli',
  spec: 'run workflows/generated/foo.ts',
  mode: 'local',
  stageMode: 'run',
  invocationRoot: '/repo',
  metadata: {},
};

describe('runWithAutoFix', () => {
  it('returns single-attempt success without debugger or retry metadata', async () => {
    const runSingleAttempt = vi.fn().mockResolvedValue(successResponse('run-ok'));
    const debugWorkflowRun = vi.fn();

    const result = await runWithAutoFix(baseRequest, {
      maxAttempts: 3,
      runSingleAttempt,
      classifyFailure: fakeClassification,
      debugWorkflowRun,
    });

    expect(result.ok).toBe(true);
    expect(runSingleAttempt).toHaveBeenCalledTimes(1);
    expect(runSingleAttempt.mock.calls[0][0].retry).toBeUndefined();
    expect(debugWorkflowRun).not.toHaveBeenCalled();
    expect(result.auto_fix).toMatchObject({
      max_attempts: 3,
      final_status: 'ok',
      attempts: [{ attempt: 1, status: 'ok', run_id: 'run-ok' }],
    });
  });

  it('direct repair retries with start-from and previous-run-id', async () => {
    const runSingleAttempt = vi
      .fn()
      .mockResolvedValueOnce(blockerResponse('MISSING_BINARY', 'run-1', 'install-deps'))
      .mockResolvedValueOnce(successResponse('run-2'));
    const repairRunner = vi.fn().mockResolvedValue({ exitCode: 0 });

    const result = await runWithAutoFix(baseRequest, {
      maxAttempts: 3,
      runSingleAttempt,
      classifyFailure: fakeClassification,
      debugWorkflowRun: directDebugger,
      repairRunner,
    });

    expect(result.ok).toBe(true);
    expect(repairRunner).toHaveBeenCalledWith('npm install', '/repo');
    expect(runSingleAttempt).toHaveBeenCalledTimes(2);
    expect(runSingleAttempt.mock.calls[1][0].retry).toMatchObject({
      attempt: 2,
      maxAttempts: 3,
      previousRunId: 'run-1',
      retryOfRunId: 'run-1',
      startFromStep: 'install-deps',
    });
    expect(runSingleAttempt.mock.calls[1][0]).toMatchObject({
      source: 'workflow-artifact',
      specPath: 'workflows/generated/foo.ts',
      stageMode: 'run',
    });
  });

  it('repair failure escalates without retrying', async () => {
    const runSingleAttempt = vi.fn().mockResolvedValue(blockerResponse('MISSING_BINARY', 'run-1', 'install-deps'));

    const result = await runWithAutoFix(baseRequest, {
      maxAttempts: 3,
      runSingleAttempt,
      classifyFailure: fakeClassification,
      debugWorkflowRun: directDebugger,
      repairRunner: vi.fn().mockResolvedValue({ exitCode: 42 }),
    });

    expect(runSingleAttempt).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(false);
    expect(result.auto_fix?.attempts[0]).toMatchObject({
      applied_fix: { steps: ['npm install'], exit_code: 42 },
      fix_error: 'repair command failed: npm install',
    });
    expect(result.nextActions).toContain('npm install');
  });

  it('guided repairMode never retries', async () => {
    const runSingleAttempt = vi.fn().mockResolvedValue(blockerResponse('MISSING_ENV_VAR', 'run-1', 'runtime-launch'));

    const result = await runWithAutoFix(baseRequest, {
      maxAttempts: 3,
      runSingleAttempt,
      classifyFailure: fakeClassification,
      debugWorkflowRun: guidedDebugger,
    });

    expect(runSingleAttempt).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(false);
    expect(result.nextActions.join('\n')).toContain('Set TEST_TOKEN');
  });

  it('stops after max attempts exhaustion', async () => {
    const runSingleAttempt = vi
      .fn()
      .mockResolvedValueOnce(blockerResponse('NETWORK_TRANSIENT', 'run-1', 'step-a'))
      .mockResolvedValueOnce(blockerResponse('NETWORK_TRANSIENT', 'run-2', 'step-a'))
      .mockResolvedValueOnce(blockerResponse('NETWORK_TRANSIENT', 'run-3', 'step-a'));

    const result = await runWithAutoFix(baseRequest, {
      maxAttempts: 3,
      runSingleAttempt,
      classifyFailure: fakeClassification,
      debugWorkflowRun: directDebugger,
      sleep: vi.fn().mockResolvedValue(undefined),
    });

    expect(runSingleAttempt).toHaveBeenCalledTimes(3);
    expect(result.auto_fix).toMatchObject({
      max_attempts: 3,
      final_status: 'blocker',
    });
    expect(result.auto_fix?.attempts).toHaveLength(3);
  });

  it('retries without previous-run-id when the prior run id is missing', async () => {
    const runSingleAttempt = vi
      .fn()
      .mockResolvedValueOnce(blockerResponse('NETWORK_TRANSIENT', undefined, 'step-a'))
      .mockResolvedValueOnce(successResponse('run-2'));

    const result = await runWithAutoFix(baseRequest, {
      maxAttempts: 3,
      runSingleAttempt,
      classifyFailure: fakeClassification,
      debugWorkflowRun: directDebugger,
      sleep: vi.fn().mockResolvedValue(undefined),
    });

    expect(runSingleAttempt.mock.calls[1][0].retry).toMatchObject({
      attempt: 2,
      maxAttempts: 3,
      startFromStep: 'step-a',
    });
    expect(runSingleAttempt.mock.calls[1][0].retry.previousRunId).toBeUndefined();
    expect(result.warnings).toContain('Auto-fix retry could not resolve a previous run id; retrying without step-level resume.');
  });
});

function successResponse(runId: string): LocalResponse {
  return {
    ok: true,
    artifacts: [{ path: 'workflows/generated/foo.ts' }],
    logs: [],
    warnings: [],
    nextActions: [],
    generation: {
      stage: 'generate',
      status: 'ok',
      artifact: { path: 'workflows/generated/foo.ts', workflow_id: 'wf-1', spec_digest: 'abc' },
    },
    execution: {
      stage: 'execute',
      status: 'success',
      execution: execution(runId),
    },
    exitCode: 0,
  };
}

function blockerResponse(code: LocalClassifiedBlocker['code'], runId: string | undefined, failedStep: string): LocalResponse {
  const blocker: LocalClassifiedBlocker = {
    code,
    category: code === 'MISSING_BINARY' ? 'dependency' : code === 'MISSING_ENV_VAR' ? 'environment' : 'resource',
    message: `${code} blocked the run`,
    detected_at: '2026-04-28T00:00:00.000Z',
    detected_during: 'launch',
    recovery: {
      actionable: true,
      steps: code === 'MISSING_BINARY' ? ['npm install'] : ['Set TEST_TOKEN'],
    },
    context: {
      missing: code === 'MISSING_BINARY' ? ['node'] : ['TEST_TOKEN'],
      found: [],
    },
  };
  return {
    ok: false,
    artifacts: [{ path: 'workflows/generated/foo.ts' }],
    logs: [],
    warnings: [blocker.message],
    nextActions: [...blocker.recovery.steps],
    generation: {
      stage: 'generate',
      status: 'ok',
      artifact: { path: 'workflows/generated/foo.ts', workflow_id: 'wf-1', spec_digest: 'abc' },
    },
    execution: {
      stage: 'execute',
      status: 'blocker',
      execution: execution(runId),
      blocker,
      evidence: {
        outcome_summary: blocker.message,
        failed_step: { id: failedStep, name: failedStep },
        exit_code: 1,
        logs: { tail: [], truncated: false },
        side_effects: { files_written: [], commands_invoked: [] },
        assertions: [{ name: 'runtime_exit_code', status: 'fail', detail: blocker.message }],
      },
    },
    exitCode: 2,
  };
}

function execution(runId: string | undefined): NonNullable<LocalResponse['execution']>['execution'] {
  return {
    workflow_id: 'wf-1',
    artifact_path: 'workflows/generated/foo.ts',
    command: 'agent-relay run workflows/generated/foo.ts',
    workflow_file: 'workflows/generated/foo.ts',
    cwd: '/repo',
    started_at: '2026-04-28T00:00:00.000Z',
    finished_at: '2026-04-28T00:00:01.000Z',
    duration_ms: 1000,
    steps_completed: 0,
    steps_total: 1,
    ...(runId ? { run_id: runId } : {}),
  };
}

function fakeClassification(_evidence: WorkflowRunEvidence): FailureClassification {
  return {
    category: 'environment_error',
    failureClass: 'environment_error',
    severity: 'medium',
    confidence: 'high',
    nextAction: 'fix_and_retry',
    summary: 'classified',
    signals: [],
    secondaryClasses: [],
  };
}

function directDebugger(): DebuggerResult {
  return debuggerResult('direct');
}

function guidedDebugger(): DebuggerResult {
  return debuggerResult('guided');
}

function debuggerResult(repairMode: DebuggerResult['repairMode']): DebuggerResult {
  return {
    repairMode,
    summary: repairMode === 'guided' ? 'Set TEST_TOKEN before retrying.' : 'Direct repair is available.',
    analyzedAt: '2026-04-28T00:00:00.000Z',
    diagnosis: {
      primaryCause: {
        category: 'environment_prerequisite',
        summary: 'environment issue',
        affectedStepIds: [],
        supportingSignals: [],
        confidence: 'high',
        filesLikelyTouched: [],
        ambiguousProductIntent: false,
      },
      secondaryCauses: [],
      runtimeClassification: fakeClassification({} as WorkflowRunEvidence),
      explanation: 'environment issue',
    },
    recommendation: {
      directRepairEligible: repairMode === 'direct',
      confidence: 'high',
      summary: 'repair recommendation',
      scope: {
        targetStepIds: [],
        filesLikelyTouched: [],
        maxFilesToTouch: 0,
        bounded: true,
        rationale: 'test',
      },
      steps: [
        {
          action: 'fix_environment',
          description: 'Set TEST_TOKEN',
          targetStepId: null,
          filesToTouch: [],
          confidence: 'high',
          scope: {
            targetStepIds: [],
            filesLikelyTouched: [],
            maxFilesToTouch: 0,
            bounded: true,
            rationale: 'test',
          },
          verificationPlan: {
            commands: [],
            expectations: [],
            deterministic: true,
          },
        },
      ],
    },
  };
}
