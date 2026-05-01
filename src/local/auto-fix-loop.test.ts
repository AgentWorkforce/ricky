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

  it('repairs the workflow with the Workforce persona and resumes with start-from and previous-run-id', async () => {
    const runSingleAttempt = vi
      .fn()
      .mockResolvedValueOnce(blockerResponse('MISSING_BINARY', 'run-1', 'install-deps'))
      .mockResolvedValueOnce(successResponse('run-2'));
    const workflowRepairer = vi.fn().mockResolvedValue(workflowRepair('repaired workflow'));
    const artifactWriter = vi.fn().mockResolvedValue(undefined);

    const result = await runWithAutoFix(baseRequest, {
      maxAttempts: 3,
      runSingleAttempt,
      classifyFailure: fakeClassification,
      debugWorkflowRun: directDebugger,
      workflowRepairer,
      artifactWriter,
    });

    expect(result.ok).toBe(true);
    expect(workflowRepairer).toHaveBeenCalledWith(expect.objectContaining({
      artifactPath: 'workflows/generated/foo.ts',
      artifactContent: expect.stringContaining('workflow'),
      failedStep: 'install-deps',
      runId: 'run-1',
    }));
    expect(artifactWriter).toHaveBeenCalledWith('workflows/generated/foo.ts', 'repaired workflow', '/repo');
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
      spec: 'repaired workflow',
      stageMode: 'run',
    });
    expect(result.auto_fix?.attempts[0]).toMatchObject({
      applied_fix: {
        mode: 'workforce-persona',
        artifact_path: 'workflows/generated/foo.ts',
        summary: 'persona patched the workflow',
      },
    });
  });

  it('persona repair failure escalates without retrying', async () => {
    const runSingleAttempt = vi.fn().mockResolvedValue(blockerResponse('MISSING_BINARY', 'run-1', 'install-deps'));

    const result = await runWithAutoFix(baseRequest, {
      maxAttempts: 3,
      runSingleAttempt,
      classifyFailure: fakeClassification,
      debugWorkflowRun: directDebugger,
      workflowRepairer: vi.fn().mockResolvedValue({
        applied: false,
        summary: 'persona could not safely patch the workflow',
      }),
    });

    expect(runSingleAttempt).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(false);
    expect(result.auto_fix?.attempts[0]).toMatchObject({
      fix_error: 'persona could not safely patch the workflow',
    });
    expect(result.auto_fix?.escalation).toMatchObject({
      summary: expect.stringContaining('could not choose one safe automatic fix'),
      log_tail: expect.arrayContaining(['MISSING_BINARY log tail']),
      options: expect.arrayContaining([
        expect.objectContaining({
          label: 'Open the workflow and retry',
          command: 'ricky run --artifact workflows/generated/foo.ts --foreground --no-auto-fix',
        }),
        expect.objectContaining({
          label: 'Check run status and saved logs',
        }),
      ]),
    });
    expect(result.nextActions.join('\n')).toContain('Direct repair is available.');
  });

  it('uses the persona repair path even when the debugger recommends guided repair', async () => {
    const runSingleAttempt = vi
      .fn()
      .mockResolvedValueOnce(blockerResponse('MISSING_ENV_VAR', 'run-1', 'runtime-launch'))
      .mockResolvedValueOnce(successResponse('run-2'));
    const workflowRepairer = vi.fn().mockResolvedValue(workflowRepair('guided repair workflow'));

    const result = await runWithAutoFix(baseRequest, {
      maxAttempts: 3,
      runSingleAttempt,
      classifyFailure: fakeClassification,
      debugWorkflowRun: guidedDebugger,
      workflowRepairer,
      artifactWriter: vi.fn().mockResolvedValue(undefined),
    });

    expect(runSingleAttempt).toHaveBeenCalledTimes(2);
    expect(workflowRepairer).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(true);
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
      workflowRepairer: vi.fn().mockResolvedValue(workflowRepair('still broken')),
      artifactWriter: vi.fn().mockResolvedValue(undefined),
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
      workflowRepairer: vi.fn().mockResolvedValue(workflowRepair('retry without prior run')),
      artifactWriter: vi.fn().mockResolvedValue(undefined),
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
    artifacts: [{ path: 'workflows/generated/foo.ts', content: workflowContent() }],
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
    artifacts: [{ path: 'workflows/generated/foo.ts', content: workflowContent() }],
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
        logs: { tail: [`${code} log tail`], truncated: false },
        side_effects: { files_written: [], commands_invoked: [] },
        assertions: [{ name: 'runtime_exit_code', status: 'fail', detail: blocker.message }],
      },
    },
    exitCode: 2,
  };
}

function workflowRepair(content: string) {
  return {
    applied: true,
    artifactPath: 'workflows/generated/foo.ts',
    content,
    summary: 'persona patched the workflow',
    warnings: [],
    runId: 'persona-run-1',
  };
}

function workflowContent(): string {
  return 'import { workflow } from "@agent-relay/sdk/workflows";\nworkflow("foo").run({ cwd: process.cwd() });\n';
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
