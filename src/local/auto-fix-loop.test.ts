import { mkdtemp, mkdir, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { repairWorkflowDeterministically, resolveSafeResumeAnchor, runWithAutoFix } from './auto-fix-loop.js';
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

  it('passes failed repair history into the next workflow repair attempt', async () => {
    const runSingleAttempt = vi
      .fn()
      .mockResolvedValueOnce(blockerResponse('MISSING_ENV_VAR', 'run-1', 'install-deps'))
      .mockResolvedValueOnce(blockerResponse('MISSING_ENV_VAR', 'run-2', 'install-deps'))
      .mockResolvedValueOnce(successResponse('run-3'));
    const workflowRepairer = vi
      .fn()
      .mockResolvedValueOnce(workflowRepair('first repaired workflow'))
      .mockResolvedValueOnce(workflowRepair('second repaired workflow'));

    const result = await runWithAutoFix(baseRequest, {
      maxAttempts: 4,
      runSingleAttempt,
      classifyFailure: fakeClassification,
      debugWorkflowRun: guidedDebugger,
      workflowRepairer,
      artifactWriter: vi.fn().mockResolvedValue(undefined),
    });

    expect(result.ok).toBe(true);
    expect(workflowRepairer).toHaveBeenCalledTimes(2);
    expect(workflowRepairer.mock.calls[0][0].previousAttempts).toEqual([]);
    expect(workflowRepairer.mock.calls[1][0].previousAttempts).toEqual([
      expect.objectContaining({
        attempt: 1,
        repairedArtifactPath: 'workflows/generated/foo.ts',
        repairSummary: 'persona patched the workflow',
        repairMode: 'workforce-persona',
        personaRunId: 'persona-run-1',
        retryAttempt: 2,
        outcome: expect.objectContaining({
          status: 'blocker',
          failedStep: 'install-deps',
          blockerCode: 'MISSING_ENV_VAR',
          runId: 'run-2',
          debuggerSummary: 'Set TEST_TOKEN before retrying.',
        }),
      }),
    ]);
  });

  it('emits concise foreground progress during repair and retry', async () => {
    const progress: string[] = [];
    const runSingleAttempt = vi
      .fn()
      .mockResolvedValueOnce(blockerResponse('MISSING_BINARY', 'run-1', 'install-deps'))
      .mockResolvedValueOnce(successResponse('run-2'));

    await runWithAutoFix(baseRequest, {
      maxAttempts: 3,
      runSingleAttempt,
      classifyFailure: fakeClassification,
      debugWorkflowRun: directDebugger,
      workflowRepairer: vi.fn().mockResolvedValue(workflowRepair('repaired workflow')),
      artifactWriter: vi.fn().mockResolvedValue(undefined),
      onProgress: (message) => progress.push(message),
    });

    expect(progress).toEqual([
      'Running workflow (attempt 1/3)...',
      'Ricky is fixing the workflow...',
      'Retrying workflow from install-deps...',
      'Running workflow (attempt 2/3)...',
    ]);
  });

  it('extracts SDK workflow failed-step evidence from log tails for repair and resume', async () => {
    const runSingleAttempt = vi
      .fn()
      .mockResolvedValueOnce(sdkRuntimeBlockerResponse())
      .mockResolvedValueOnce(successResponse('run-2'));
    const workflowRepairer = vi.fn().mockResolvedValue(workflowRepair('repaired workflow'));

    const result = await runWithAutoFix(baseRequest, {
      maxAttempts: 2,
      runSingleAttempt,
      workflowRepairer,
      artifactWriter: vi.fn().mockResolvedValue(undefined),
    });

    expect(result.ok).toBe(true);
    expect(workflowRepairer).toHaveBeenCalledWith(expect.objectContaining({
      failedStep: 'verify-greeting',
      runId: 'relay-run-123',
      classification: expect.objectContaining({
        failureClass: 'verification_failure',
      }),
      debuggerResult: expect.objectContaining({
        summary: expect.stringContaining('required file or artifact was not materialized'),
      }),
    }));
    expect(workflowRepairer.mock.calls[0][0].evidence.steps).toEqual(expect.arrayContaining([
      expect.objectContaining({
        stepId: 'verify-greeting',
        status: 'failed',
        verifications: [expect.objectContaining({
          type: 'file_exists',
          passed: false,
          expected: '.workflow-artifacts/demo-auto-fix/broken-greeting/hello.txt',
          command: 'test -f .workflow-artifacts/demo-auto-fix/broken-greeting/hello.txt',
        })],
      }),
      expect.objectContaining({
        stepId: 'emit-done',
        status: 'skipped',
      }),
    ]));
    expect(runSingleAttempt.mock.calls[1][0].retry).toMatchObject({
      previousRunId: 'relay-run-123',
      retryOfRunId: 'relay-run-123',
      startFromStep: 'verify-greeting',
    });
  });

  it('deterministically repairs generated lead-plan marker gates and resumes from the failed gate', async () => {
    const firstFailure = leadPlanMarkerBlockerResponse();
    const runSingleAttempt = vi
      .fn()
      .mockResolvedValueOnce(firstFailure)
      .mockResolvedValueOnce(successResponse('run-2'));
    const artifactWriter = vi.fn().mockResolvedValue(undefined);

    const result = await runWithAutoFix(baseRequest, {
      maxAttempts: 2,
      runSingleAttempt,
      artifactWriter,
    });

    expect(result.ok).toBe(true);
    expect(artifactWriter).toHaveBeenCalledWith(
      'workflows/generated/lead-plan-marker.ts',
      expect.stringContaining("appendLeadPlanSection('Non-goals'"),
      '/repo',
    );
    expect(artifactWriter).toHaveBeenCalledWith(
      'workflows/generated/lead-plan-marker.ts',
      expect.stringContaining('Local execution must run through Agent Relay using the generated workflow artifact.'),
      '/repo',
    );
    const repairedContent = artifactWriter.mock.calls.find(([path]) => path === 'workflows/generated/lead-plan-marker.ts')?.[1] as string;
    expect(repairedContent).toContain('readyMarkerIndex = body.lastIndexOf(readyMarker)');
    expect(repairedContent).toContain("body.slice(0, readyMarkerIndex).trimEnd() + section + '\\n\\n' + body.slice(readyMarkerIndex)");
    expect(repairedContent).not.toContain("body.replace(/\\n*GENERATION_LEAD_PLAN_READY\\s*$");
    expect(runSingleAttempt.mock.calls[1][0]).toMatchObject({
      source: 'workflow-artifact',
      specPath: 'workflows/generated/lead-plan-marker.ts',
      stageMode: 'run',
      retry: {
        attempt: 2,
        maxAttempts: 2,
        previousRunId: 'lead-plan-run-1',
        retryOfRunId: 'lead-plan-run-1',
        startFromStep: 'lead-plan-gate',
      },
    });
    expect(result.auto_fix?.attempts[0]).toMatchObject({
      status: 'blocker',
      blocker_code: 'INVALID_ARTIFACT',
      failed_step: 'lead-plan-gate',
      applied_fix: {
        mode: 'deterministic',
        artifact_path: 'workflows/generated/lead-plan-marker.ts',
        summary: expect.stringContaining('lead-plan-gate append missing required plan markers'),
      },
    });
  });

  it('deterministically repairs bounded workflow artifact mismatches when persona repair is unavailable', async () => {
    const response = sdkRuntimeBlockerResponse();
    const runSingleAttempt = vi.fn().mockResolvedValueOnce(response);
    let capturedEvidence: WorkflowRunEvidence | undefined;
    const workflowRepairer = vi.fn((input) => {
      capturedEvidence = input.evidence;
      return Promise.resolve({
        applied: false,
        summary: 'stop after evidence capture',
      });
    });

    await runWithAutoFix(baseRequest, {
      maxAttempts: 2,
      runSingleAttempt,
      workflowRepairer,
    });

    expect(capturedEvidence).toBeDefined();
    const repair = repairWorkflowDeterministically({
      artifactPath: 'workflows/generated/broken-greeting.ts',
      artifactContent: brokenDemoWorkflowContent(),
      evidence: capturedEvidence!,
    }, new Error('No Workforce persona could be resolved'));

    expect(repair).toMatchObject({
      applied: true,
      artifactPath: 'workflows/generated/broken-greeting.ts',
      mode: 'deterministic',
      summary: expect.stringContaining('bounded deterministic workflow repair'),
      warnings: [expect.stringContaining('Workforce persona repair unavailable')],
    });
    expect(repair?.content).toContain('test -f ${artifactDir}/greeting.txt');
    expect(repair?.content).toContain('command: `echo COMPLETE`');
    expect(repair?.content).toContain('{{steps.write-greeting.output}}');
    expect(repair?.content).not.toContain(`${demoArtifactDir()}/hello.txt`);
    expect(repair?.content).not.toContain('command: `echo DONE`');
    expect(repair?.content).not.toContain('{{steps.write-message.output}}');
  });

  it('deterministically splits timed-out agent steps and resumes from the failed step', async () => {
    const firstFailure = agentTimeoutBlockerResponse();
    const runSingleAttempt = vi
      .fn()
      .mockResolvedValueOnce(firstFailure)
      .mockResolvedValueOnce(successResponse('timeout-run-2'));
    const artifactWriter = vi.fn().mockResolvedValue(undefined);

    const result = await runWithAutoFix({
      ...baseRequest,
      source: 'workflow-artifact',
      spec: agentTimeoutWorkflowContent(),
      specPath: 'workflows/generated/webapp-review.ts',
    }, {
      maxAttempts: 2,
      runSingleAttempt,
      artifactWriter,
    });

    expect(result.ok).toBe(true);
    expect(artifactWriter).toHaveBeenCalledTimes(1);
    const repaired = String(artifactWriter.mock.calls[0][1]);
    expect(repaired).toContain("RICKY_TIMEOUT_REPAIR");
    expect(repaired).toContain(".step('implement-tests-timeout-continuation'");
    expect(repaired).toContain("dependsOn: ['implement-tests']");
    expect(repaired).toContain("dependsOn: ['implement-tests-timeout-continuation']");
    expect(repaired).toContain('IMPLEMENT_TESTS_TIMEOUT_CONTINUATION_DONE');
    // Regression: the handoff filename must not embed the continuation step's
    // literal name. The SDK's detectLeadWorkerDeadlock validator substring-
    // matches downstream step names inside the lead's task and refuses to run
    // the workflow when it hits. See timeoutContinuationPath().
    expect(repaired).toContain('implement-tests-handoff.md');
    expect(repaired).not.toContain('implement-tests-timeout-continuation.md');
    expect(result.auto_fix?.attempts[0]).toMatchObject({
      blocker_code: 'INVALID_ARTIFACT',
      failed_step: 'implement-tests',
      applied_fix: {
        mode: 'deterministic',
        artifact_path: 'workflows/generated/webapp-review.ts',
        summary: expect.stringContaining('split timed-out agent step implement-tests'),
      },
    });
    expect(runSingleAttempt.mock.calls[1][0].retry).toMatchObject({
      attempt: 2,
      previousRunId: 'timeout-run-1',
      retryOfRunId: 'timeout-run-1',
      startFromStep: 'implement-tests',
    });
  });

  it('uses step-specific timeout evidence and preserves comma-containing timeout expressions', () => {
    const repair = repairWorkflowDeterministically({
      artifactPath: 'workflows/generated/webapp-review.ts',
      artifactContent: agentTimeoutWorkflowContent('Math.min(MAX_TIMEOUT, 900_000)'),
      evidence: timeoutRepairEvidenceWithEarlierNonTimeoutFailure(),
    });

    expect(repair).toMatchObject({
      applied: true,
      summary: expect.stringContaining('split timed-out agent step implement-tests'),
    });
    expect(repair?.content).toContain(".step('implement-tests-timeout-continuation'");
    expect(repair?.content).not.toContain(".step('run-focused-validation-timeout-continuation'");
    expect(repair?.content).toContain('timeoutMs: Math.min(MAX_TIMEOUT, 900_000)');
    expect(repair?.content).toContain("dependsOn: ['implement-tests-timeout-continuation']");
  });

  it('deterministically repairs bare git diff manifest gates to include untracked files', () => {
    const repair = repairWorkflowDeterministically({
      artifactPath: 'workflows/generated/cloud-autofix.ts',
      artifactContent: bareGitDiffManifestWorkflowContent(),
      evidence: gitDiffManifestFailureEvidence(),
    });

    expect(repair).toMatchObject({
      applied: true,
      mode: 'deterministic',
      summary: expect.stringContaining('expanded git diff pipe gates to include untracked files'),
    });
    expect(repair?.content).toContain(
      'NON_TRANSIENT=$({ git diff --name-only; git ls-files --others --exclude-standard; } | sort -u | rg -v',
    );
    expect(repair?.content).toContain(
      '`GIT_DIFF_TMP=$(mktemp) && { git diff --name-only; git ls-files --others --exclude-standard; } | sort -u > "$GIT_DIFF_TMP" && mv "$GIT_DIFF_TMP" ${FINAL_DIFF_FILES}`',
    );
    expect(repair?.content).not.toContain('NON_TRANSIENT=$(git diff --name-only | rg -v');
  });

  it('deterministically hardens sentinel-guarded rehydration so corrupt artifacts get regenerated on retry', () => {
    const repair = repairWorkflowDeterministically({
      artifactPath: 'workflows/generated/sentinel-rehydration.ts',
      artifactContent: sentinelGuardedRehydrationWorkflowContent(),
      evidence: sentinelGuardedRehydrationFailureEvidence(),
    });

    expect(repair).toMatchObject({
      applied: true,
      mode: 'deterministic',
      summary: expect.stringContaining("hardened sentinel-guarded rehydration for '${artifactDir}/final-review-claude.md'"),
    });
    expect(repair?.summary).toContain('marker: final_review_claude_pass');
    expect(repair?.content).toContain(
      `if [ ! -f '\${artifactDir}/final-review-claude.md' ] || ! tail -n 1 '\${artifactDir}/final-review-claude.md' | tr -d '[:space:]' | grep -qE '^final_review_claude_pass$'; then`,
    );
    expect(repair?.content).toContain(
      `if [ ! -f '\${artifactDir}/final-review-codex.md' ] || ! tail -n 1 '\${artifactDir}/final-review-codex.md' | tr -d '[:space:]' | grep -qE '^final_review_codex_pass$'; then`,
    );
    expect(repair?.content).not.toMatch(
      /if \[ ! -f '\$\{artifactDir\}\/final-review-claude\.md' \]; then/,
    );
  });

  it('deterministically repairs generated master child runs that disabled nested auto-fix', () => {
    const repair = repairWorkflowDeterministically({
      artifactPath: 'workflows/generated/master.ts',
      artifactContent: legacyMasterWorkflowContent(),
      evidence: sdkRuntimeBlockerEvidence('run-update-config-2'),
    });

    expect(repair).toMatchObject({
      applied: true,
      mode: 'deterministic',
      summary: expect.stringContaining('allowed nested child workflows to use Ricky auto-fix'),
    });
    expect(repair?.summary).toContain('replaced fail-fast error handling with repair-aware retry');
    expect(repair?.content).toContain("ricky run 'workflows/generated/child.ts' --foreground");
    expect(repair?.content).not.toContain('--no-auto-fix');
    expect(repair?.content).toContain(".onError('retry', { maxRetries: 2, retryDelayMs: 1000, repairAgent: \"master-lead\", repairRetries: 2 })");
  });

  it('deterministically makes generated child final validation non-terminal', () => {
    const repair = repairWorkflowDeterministically({
      artifactPath: 'workflows/generated/child.ts',
      artifactContent: legacyChildWorkflowContent(),
      evidence: sdkRuntimeBlockerEvidence('final-hard-validation'),
    });

    expect(repair).toMatchObject({
      applied: true,
      mode: 'deterministic',
      summary: expect.stringContaining('generated child final validation non-terminal'),
    });
    expect(repair?.content).toContain('.step("final-hard-validation"');
    expect(repair?.content).toContain('failOnError: false');
  });

  it('skips sentinel-guard hardening when no later tail-grep check references the same path and marker', () => {
    const repair = repairWorkflowDeterministically({
      artifactPath: 'workflows/generated/sentinel-no-check.ts',
      artifactContent: sentinelGuardedRehydrationWithoutTailCheckContent(),
      evidence: sentinelGuardedRehydrationFailureEvidence(),
    });

    expect(repair).toBeNull();
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
          command: 'ricky run workflows/generated/foo.ts --foreground --no-auto-fix',
        }),
        expect.objectContaining({
          label: 'Check run status and saved logs',
        }),
      ]),
    });
    expect(result.nextActions.join('\n')).toContain('Direct repair is available.');
  });

  it('retries instead of stopping when the workflow repair provider throws', async () => {
    const runSingleAttempt = vi
      .fn()
      .mockResolvedValueOnce(blockerResponse('INVALID_ARTIFACT', 'run-1', 'final-hard-validation'))
      .mockResolvedValueOnce(successResponse('run-2'));
    const workflowRepairer = vi.fn().mockRejectedValue(new Error('structured artifact missing'));

    const result = await runWithAutoFix(baseRequest, {
      maxAttempts: 3,
      runSingleAttempt,
      classifyFailure: fakeClassification,
      debugWorkflowRun: guidedDebugger,
      workflowRepairer,
      artifactWriter: vi.fn().mockResolvedValue(undefined),
    });

    expect(result.ok).toBe(true);
    expect(workflowRepairer).toHaveBeenCalledTimes(1);
    expect(runSingleAttempt).toHaveBeenCalledTimes(2);
    expect(runSingleAttempt.mock.calls[1][0].retry).toMatchObject({
      attempt: 2,
      maxAttempts: 3,
      previousRunId: 'run-1',
      retryOfRunId: 'run-1',
      startFromStep: 'final-hard-validation',
    });
    expect(result.auto_fix?.attempts[0]).toMatchObject({
      fix_error: 'structured artifact missing',
      warning: expect.stringContaining('Workflow repair provider failed; retrying without an artifact rewrite'),
    });
    expect(result.warnings).toEqual(expect.arrayContaining([
      expect.stringContaining('Workflow repair provider failed; retrying without an artifact rewrite'),
    ]));
  });

  it('uses the persona repair path even when the debugger recommends guided repair', async () => {
    const runSingleAttempt = vi
      .fn()
      .mockResolvedValueOnce(blockerResponse('INVALID_ARTIFACT', 'run-1', 'install-deps'))
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

  it('repairs missing environment prerequisites in the workflow artifact before retrying', async () => {
    const runSingleAttempt = vi
      .fn()
      .mockResolvedValueOnce(blockerResponse('MISSING_ENV_VAR', 'run-1', 'install-deps'))
      .mockResolvedValueOnce(successResponse('run-2'));
    const workflowRepairer = vi.fn().mockResolvedValue(workflowRepair('repaired env workflow'));

    const result = await runWithAutoFix(baseRequest, {
      maxAttempts: 7,
      runSingleAttempt,
      classifyFailure: fakeClassification,
      debugWorkflowRun: guidedDebugger,
      workflowRepairer,
      artifactWriter: vi.fn().mockResolvedValue(undefined),
    });

    expect(runSingleAttempt).toHaveBeenCalledTimes(2);
    expect(workflowRepairer).toHaveBeenCalledWith(expect.objectContaining({
      failedStep: 'install-deps',
      runId: 'run-1',
      response: expect.objectContaining({
        execution: expect.objectContaining({
          blocker: expect.objectContaining({ code: 'MISSING_ENV_VAR' }),
        }),
      }),
    }));
    expect(runSingleAttempt.mock.calls[1][0].retry).toMatchObject({
      previousRunId: 'run-1',
      retryOfRunId: 'run-1',
      startFromStep: 'install-deps',
    });
    expect(result.ok).toBe(true);
    expect(result.auto_fix).toMatchObject({
      max_attempts: 7,
      final_status: 'ok',
      attempts: [
        expect.objectContaining({
          attempt: 1,
          blocker_code: 'MISSING_ENV_VAR',
          applied_fix: expect.objectContaining({
            mode: 'workforce-persona',
            summary: 'persona patched the workflow',
          }),
        }),
        expect.objectContaining({ attempt: 2, status: 'ok', run_id: 'run-2' }),
      ],
    });
  });

  it('deterministically adds env loading and fast assertions for missing env failures', () => {
    const repair = repairWorkflowDeterministically({
      artifactPath: 'workflows/generated/foo.ts',
      artifactContent: workflowContent(),
      evidence: missingEnvEvidence(),
      response: blockerResponse('MISSING_ENV_VAR', 'run-1', 'runtime-launch'),
    });

    expect(repair).toMatchObject({
      applied: true,
      mode: 'deterministic',
      summary: expect.stringContaining('repo-local .env loader'),
    });
    expect(repair?.content).toContain('RICKY_WORKFLOW_ENV_LOADER');
    expect(repair?.content).toContain("import * as rickyWorkflowFs from 'node:fs';");
    expect(repair?.content).toContain("import * as rickyWorkflowPath from 'node:path';");
    expect(repair?.content).toContain('loadRickyWorkflowEnv();');
    expect(repair?.content).toContain('assertRickyWorkflowEnv(["TEST_TOKEN"]);');
    expect(repair?.content).toContain('MISSING_ENV_VAR:');
  });

  it('does not convert ambient provider credentials into workflow-start blockers', () => {
    const repair = repairWorkflowDeterministically({
      artifactPath: 'workflows/generated/foo.ts',
      artifactContent: workflowContent(),
      evidence: missingEnvEvidence('OPENAI_API_KEY'),
    });

    expect(repair).toMatchObject({
      applied: true,
      mode: 'deterministic',
      summary: expect.stringContaining('ambient BYOH/runtime vars as optional: OPENAI_API_KEY'),
    });
    expect(repair?.content).toContain('RICKY_WORKFLOW_ENV_LOADER');
    expect(repair?.content).toContain('loadRickyWorkflowEnv();');
    expect(repair?.content).not.toContain('assertRickyWorkflowEnv(["OPENAI_API_KEY"]);');
  });

  it('relaxes over-broad shell REQUIRED_VARS preflights for ambient BYOH/runtime vars', () => {
    const overBroadPreflight = [
      "import { workflow } from '@agent-relay/sdk/workflows';",
      '',
      'async function main() {',
      "  await workflow('foo')",
      "    .step('preflight', {",
      "      type: 'deterministic',",
      '      command: `set -euo pipefail',
      'REQUIRED_VARS=(OPENAI_API_KEY ANTHROPIC_API_KEY NANGO_SECRET_KEY DATABASE_URL JWT_SECRET)',
      'for VAR in "${REQUIRED_VARS[@]}"; do',
      '  if [ -z "${!VAR+x}" ]; then',
      '    echo "MISSING_ENV_VAR: $VAR"',
      '    exit 1',
      '  fi',
      'done`,',
      '      captureOutput: true,',
      '      failOnError: true,',
      '    })',
      '    .run({ cwd: process.cwd() });',
      '}',
    ].join('\n');

    const repair = repairWorkflowDeterministically({
      artifactPath: 'workflows/generated/foo.ts',
      artifactContent: overBroadPreflight,
      evidence: missingEnvEvidence('OPENAI_API_KEY'),
    });

    expect(repair?.applied).toBe(true);
    expect(repair?.content).toContain('OPTIONAL_VARS=(OPENAI_API_KEY ANTHROPIC_API_KEY NANGO_SECRET_KEY DATABASE_URL JWT_SECRET)');
    expect(repair?.content).toContain('for VAR in "${OPTIONAL_VARS[@]}"; do');
    expect(repair?.content).toContain('OPTIONAL_ENV_VAR_NOT_SET: $VAR');
    expect(repair?.content).not.toContain('REQUIRED_VARS=(OPENAI_API_KEY');
    expect(repair?.content).not.toContain('MISSING_ENV_VAR: $VAR');
    expect(repair?.content).not.toContain('    exit 1');
  });

  // Regression: assertRickyWorkflowEnv used to throw at module-load time
  // unconditionally, before the SDK had a chance to honour --start-from.
  // That made resuming with --start-from impossible if the resumed step
  // didn't actually need the missing env var (the upstream-only step did,
  // but it was being skipped). The injected helper now warns-and-continues
  // when process.env.START_FROM is set so resumed steps can run and any
  // step that genuinely needs a missing value still fails with its own
  // signal at the point of use.
  it('injects an env-assert helper that honors START_FROM for --start-from resumes', () => {
    const repair = repairWorkflowDeterministically({
      artifactPath: 'workflows/generated/foo.ts',
      artifactContent: workflowContent(),
      evidence: missingEnvEvidence(),
      response: blockerResponse('MISSING_ENV_VAR', 'run-1', 'runtime-launch'),
    });

    expect(repair?.applied).toBe(true);
    // Resume signal acknowledged.
    expect(repair?.content).toContain('process.env.START_FROM');
    // Warn-and-continue path uses console.warn rather than throwing so the
    // SDK can proceed to the resumed step.
    expect(repair?.content).toMatch(/console\.warn\([^)]*Skipping env-var assertion/);
    expect(repair?.content).toMatch(/--start-from active/);
    // The non-resume path still throws fast — preserves the original
    // contract for first-run invocations.
    expect(repair?.content).toContain('throw new Error(`MISSING_ENV_VAR:');
  });

  // Regression: when a master-rendered workflow embeds a `node --input-type=module`
  // HEREDOC inside a .step({ command: ... }) string, the embedded shell text
  // contains the literal substring `from 'node:fs'`. The previous import-detection
  // used `content.includes("from 'node:fs'")`, which the embedded string fooled
  // — Ricky then injected `loadRickyWorkflowEnv` (which references
  // `rickyWorkflowFs` and `rickyWorkflowPath`) without adding the
  // `import * as rickyWorkflowFs from 'node:fs'` alias at module top level. The
  // resulting workflow ReferenceError'd at module load and Auto-fix burned
  // 7/7 attempts on UNSUPPORTED_RUNTIME at runtime-launch. Detection must
  // match an actual top-level `import * as <alias> from '<module>'` line.
  it('adds the rickyWorkflow* alias imports even when the workflow embeds `from \'node:fs\'` inside a .step command HEREDOC', () => {
    const masterRenderedContentWithEmbeddedImports = [
      "import { workflow } from '@agent-relay/sdk/workflows';",
      '',
      '// RICKY_MASTER_EXECUTOR_WORKFLOW',
      'async function main() {',
      '  await workflow("ricky-master")',
      '    .step("materialize-children", {',
      '      type: "deterministic",',
      // Mirrors master-workflow-renderer.ts:138-149 — the master renderer emits
      // a node --input-type=module HEREDOC as a string inside a step command.
      // That string literally contains `from \'node:fs\'` and `from \'node:path\'`.
      '      command: "node --input-type=module <<\'NODE\'\\nimport { mkdirSync, writeFileSync } from \'node:fs\';\\nimport { dirname } from \'node:path\';\\nNODE",',
      '      captureOutput: true,',
      '      failOnError: true,',
      '    })',
      '    .run({ cwd: process.cwd() });',
      '}',
    ].join('\n');

    const repair = repairWorkflowDeterministically({
      artifactPath: 'workflows/generated/master.ts',
      artifactContent: masterRenderedContentWithEmbeddedImports,
      evidence: missingEnvEvidence(),
      response: blockerResponse('MISSING_ENV_VAR', 'run-1', 'runtime-launch'),
    });

    expect(repair?.applied).toBe(true);
    // Aliases must be added at module top level despite the embedded
    // HEREDOC string containing `from 'node:fs'` / `from 'node:path'`.
    expect(repair?.content).toMatch(/^import \* as rickyWorkflowFs from 'node:fs';/m);
    expect(repair?.content).toMatch(/^import \* as rickyWorkflowPath from 'node:path';/m);
    expect(repair?.content).toContain('RICKY_WORKFLOW_ENV_LOADER');
    // The HEREDOC is preserved unchanged.
    expect(repair?.content).toContain("import { mkdirSync, writeFileSync } from 'node:fs';");
  });

  it('recognizes already-present rickyWorkflow* alias imports declared via multi-line statement and skips re-injection', () => {
    // Multi-line import shapes are not handled by line-anchored regex/preamble
    // checks but are trivially correct under an AST walk. If the AST detection
    // misses the existing import, the injection logic would add a duplicate
    // alias, which TypeScript's strip-types loader rejects with
    // SyntaxError: Identifier 'rickyWorkflowFs' has already been declared.
    const contentWithMultiLineExistingAlias = [
      "import { workflow } from '@agent-relay/sdk/workflows';",
      "import * as",
      '  rickyWorkflowFs',
      "  from 'node:fs';",
      "import * as rickyWorkflowPath from 'node:path';",
      '',
      '// RICKY_WORKFLOW_ENV_LOADER',
      'function loadRickyWorkflowEnv() { /* already injected */ }',
      '',
      'async function main() {',
      '  loadRickyWorkflowEnv();',
      '  await workflow("foo").run({ cwd: process.cwd() });',
      '}',
    ].join('\n');

    const repair = repairWorkflowDeterministically({
      artifactPath: 'workflows/generated/already-injected.ts',
      artifactContent: contentWithMultiLineExistingAlias,
      evidence: missingEnvEvidence(),
      response: blockerResponse('MISSING_ENV_VAR', 'run-1', 'runtime-launch'),
    });

    // No second `import * as rickyWorkflowFs` statement should appear.
    const fsAliasMatches = (repair?.content ?? contentWithMultiLineExistingAlias)
      .match(/import\s+\*\s+as\s+rickyWorkflowFs\b/g);
    expect(fsAliasMatches).toHaveLength(1);
    const pathAliasMatches = (repair?.content ?? contentWithMultiLineExistingAlias)
      .match(/import\s+\*\s+as\s+rickyWorkflowPath\b/g);
    expect(pathAliasMatches).toHaveLength(1);
  });

  it('routes semantic workflow failures to persona repair instead of deterministic repair', async () => {
    const artifactPath = 'workflows/demo-persona-repair/semantic-contract.ts';
    const artifactContent = await readFile(new URL('../../workflows/demo-persona-repair/semantic-contract.ts', import.meta.url), 'utf8');
    const firstFailure = semanticContractBlockerResponse(artifactPath, artifactContent);
    const deterministicRepair = repairWorkflowDeterministically({
      artifactPath,
      artifactContent,
      evidence: semanticContractEvidence(firstFailure),
    });
    expect(deterministicRepair).toBeNull();

    const runSingleAttempt = vi
      .fn()
      .mockResolvedValueOnce(firstFailure)
      .mockResolvedValueOnce(successResponse('semantic-run-2'));
    const workflowRepairer = vi.fn().mockResolvedValue({
      ...workflowRepair(artifactContent.replace("status: 'draft', approvals: 0", "status: 'ready', approvals: 1")),
      artifactPath,
      summary: 'persona repaired semantic contract state',
      runId: 'persona-semantic-run-1',
    });

    const result = await runWithAutoFix({
      ...baseRequest,
      source: 'workflow-artifact',
      spec: artifactContent,
      specPath: artifactPath,
    }, {
      maxAttempts: 2,
      runSingleAttempt,
      workflowRepairer,
      artifactWriter: vi.fn().mockResolvedValue(undefined),
    });

    expect(result.ok).toBe(true);
    expect(workflowRepairer).toHaveBeenCalledWith(expect.objectContaining({
      artifactPath,
      artifactContent,
      failedStep: 'verify-contract-ready',
      classification: expect.objectContaining({
        failureClass: 'verification_failure',
      }),
    }));
    expect(result.auto_fix?.attempts[0]).toMatchObject({
      status: 'blocker',
      blocker_code: 'INVALID_ARTIFACT',
      failed_step: 'verify-contract-ready',
      applied_fix: {
        mode: 'workforce-persona',
        artifact_path: artifactPath,
        summary: 'persona repaired semantic contract state',
        persona_run_id: 'persona-semantic-run-1',
      },
    });
    expect(runSingleAttempt.mock.calls[1][0].retry).toMatchObject({
      attempt: 2,
      previousRunId: 'semantic-run-1',
      retryOfRunId: 'semantic-run-1',
      startFromStep: 'verify-contract-ready',
    });
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

  it.each([
    ['runtime-launch'],
    ['local-runtime'],
    ['runtime-precheck'],
  ])('does not forward synthetic stage id %s as startFromStep on retry', async (syntheticId) => {
    const runSingleAttempt = vi
      .fn()
      .mockResolvedValueOnce(blockerResponse('MISSING_ENV_VAR', 'run-1', syntheticId))
      .mockResolvedValueOnce(successResponse('run-2'));
    const workflowRepairer = vi.fn().mockResolvedValue(workflowRepair('repaired workflow'));

    const result = await runWithAutoFix(baseRequest, {
      maxAttempts: 3,
      runSingleAttempt,
      classifyFailure: fakeClassification,
      debugWorkflowRun: directDebugger,
      workflowRepairer,
      artifactWriter: vi.fn().mockResolvedValue(undefined),
    });

    expect(result.ok).toBe(true);
    expect(runSingleAttempt).toHaveBeenCalledTimes(2);
    expect(runSingleAttempt.mock.calls[1][0].retry).toMatchObject({
      attempt: 2,
      previousRunId: 'run-1',
    });
    expect(runSingleAttempt.mock.calls[1][0].retry.startFromStep).toBeUndefined();
    expect(workflowRepairer.mock.calls[0][0].failedStep).toBeUndefined();
  });

  it('escalates instead of restarting from scratch when the prior attempt already completed real steps', async () => {
    // Regression for the "router loop" bug seen on the proactive-runtime
    // M2/M3 chain runs: signoff-r1 emitted SIGNOFF: COMPLETE, downstream
    // fix-r2 or final gates failed, but no concrete failedStep was parsed
    // from evidence. Ricky used to retry without --start-from, which the
    // SDK treats as a fresh run, re-spawning all impl-* tracks (hours of
    // duplicated work). The new policy is: refuse the restart, escalate.
    const runSingleAttempt = vi
      .fn()
      .mockResolvedValueOnce(expensiveWorkBlockerResponse('run-1'));
    const workflowRepairer = vi.fn().mockResolvedValue(workflowRepair('repaired workflow'));

    const result = await runWithAutoFix(baseRequest, {
      maxAttempts: 3,
      runSingleAttempt,
      classifyFailure: fakeClassification,
      debugWorkflowRun: directDebugger,
      workflowRepairer,
      artifactWriter: vi.fn().mockResolvedValue(undefined),
    });

    expect(result.ok).toBe(false);
    expect(runSingleAttempt).toHaveBeenCalledTimes(1);
    expect(result.auto_fix?.final_status).not.toBe('ok');
    expect(result.warnings.some((w) => w.includes('would have restarted the workflow from scratch'))).toBe(true);
    expect(result.auto_fix?.escalation).toBeDefined();
  });

  it('uses runtime completed-step count when log-tail step evidence is truncated', async () => {
    const response = expensiveWorkBlockerResponse('run-1');
    expect(response.execution?.evidence?.logs.tail).toEqual([
      '[workflow] FAILED: run aborted (no per-step failure record)',
    ]);

    const runSingleAttempt = vi.fn().mockResolvedValueOnce(response);

    const result = await runWithAutoFix(baseRequest, {
      maxAttempts: 3,
      runSingleAttempt,
      classifyFailure: fakeClassification,
      debugWorkflowRun: directDebugger,
      workflowRepairer: vi.fn().mockResolvedValue(workflowRepair('repaired workflow')),
      artifactWriter: vi.fn().mockResolvedValue(undefined),
    });

    expect(runSingleAttempt).toHaveBeenCalledTimes(1);
    expect(result.warnings.some((w) => w.includes('would have restarted the workflow from scratch'))).toBe(true);
  });

  it('does not emit missing-run-id retry warning when full restart is refused', async () => {
    const runSingleAttempt = vi
      .fn()
      .mockResolvedValueOnce(expensiveWorkBlockerResponse(undefined));

    const result = await runWithAutoFix(baseRequest, {
      maxAttempts: 3,
      runSingleAttempt,
      classifyFailure: fakeClassification,
      debugWorkflowRun: directDebugger,
      workflowRepairer: vi.fn().mockResolvedValue(workflowRepair('repaired workflow')),
      artifactWriter: vi.fn().mockResolvedValue(undefined),
    });

    expect(runSingleAttempt).toHaveBeenCalledTimes(1);
    expect(result.warnings).toEqual(expect.arrayContaining([
      expect.stringContaining('would have restarted the workflow from scratch'),
    ]));
    expect(result.warnings).not.toContain('Auto-fix retry could not resolve a previous run id; retrying without step-level resume.');
  });

  it('refuses code-drift root restart when prior real steps completed and no resume anchor exists', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'ricky-drift-restart-'));
    try {
      const artifactsDir = join(cwd, '.workflow-artifacts');
      await mkdir(artifactsDir, { recursive: true });
      const driftReportPath = join(artifactsDir, 'target-drift.json');
      await writeFile(driftReportPath, JSON.stringify({
        verdict: 'DRIFT',
        findings: [{
          severity: 'blocker',
          axis: 'runtime',
          description: 'Target code drifted from expected behavior.',
        }],
      }));
      const future = new Date(Date.now() + 5_000);
      await utimes(driftReportPath, future, future);

      const response = expensiveWorkBlockerResponse('run-1');
      response.execution!.execution.cwd = cwd;
      const runSingleAttempt = vi.fn().mockResolvedValueOnce(response);
      const codeDriftRepairer = vi.fn().mockResolvedValue({
        applied: true,
        summary: 'patched target code',
      });

      const result = await runWithAutoFix(baseRequest, {
        maxAttempts: 3,
        runSingleAttempt,
        classifyFailure: fakeClassification,
        debugWorkflowRun: directDebugger,
        workflowRepairer: vi.fn().mockResolvedValue(workflowRepair('workflow repair should not run')),
        codeDriftRepairer,
        artifactWriter: vi.fn().mockResolvedValue(undefined),
      });

      expect(codeDriftRepairer).toHaveBeenCalledTimes(1);
      expect(runSingleAttempt).toHaveBeenCalledTimes(1);
      expect(result.auto_fix?.attempts[0]).toMatchObject({
        applied_fix: {
          mode: 'code-drift',
          summary: 'patched target code',
        },
        fix_error: expect.stringContaining('would have restarted the workflow from scratch'),
      });
      expect(result.warnings).toEqual(expect.arrayContaining([
        expect.stringContaining('would have restarted the workflow from scratch'),
      ]));
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it('allows full restart when RICKY_AUTO_FIX_ALLOW_FULL_RESTART=1 even after expensive work completed', async () => {
    const previousEnv = process.env.RICKY_AUTO_FIX_ALLOW_FULL_RESTART;
    process.env.RICKY_AUTO_FIX_ALLOW_FULL_RESTART = '1';
    try {
      const runSingleAttempt = vi
        .fn()
        .mockResolvedValueOnce(expensiveWorkBlockerResponse('run-1'))
        .mockResolvedValueOnce(successResponse('run-2'));
      const workflowRepairer = vi.fn().mockResolvedValue(workflowRepair('repaired workflow'));

      const result = await runWithAutoFix(baseRequest, {
        maxAttempts: 3,
        runSingleAttempt,
        classifyFailure: fakeClassification,
        debugWorkflowRun: directDebugger,
        workflowRepairer,
        artifactWriter: vi.fn().mockResolvedValue(undefined),
      });

      expect(result.ok).toBe(true);
      expect(runSingleAttempt).toHaveBeenCalledTimes(2);
      expect(runSingleAttempt.mock.calls[1][0].retry.startFromStep).toBeUndefined();
    } finally {
      if (previousEnv === undefined) delete process.env.RICKY_AUTO_FIX_ALLOW_FULL_RESTART;
      else process.env.RICKY_AUTO_FIX_ALLOW_FULL_RESTART = previousEnv;
    }
  });

  it('does not treat a non-executable --spec-file path as a workflow artifact to repair', async () => {
    // Regression: when `ricky --spec-file docs/foo.md` failed at the intake
    // stage (e.g. unresolved clarification questions), `resolveArtifactPath`
    // used to fall back to `request.specPath`, which pointed at the source
    // spec markdown. Auto-fix then handed the markdown to the workflow
    // repairer, re-fed the "repaired" content as source=workflow-artifact,
    // and looped 7× while the natural-language intent detector misrouted the
    // spec body to debug. With no executable workflow path available, there
    // is nothing to repair and auto-fix should bail on attempt 1.
    const specFileRequest: LocalInvocationRequest = {
      ...baseRequest,
      spec: '# Some markdown spec\n\nUnresolved question?',
      specPath: 'docs/some-spec.md',
    };
    const runSingleAttempt = vi.fn().mockResolvedValueOnce(generationOnlyFailureResponse());
    const workflowRepairer = vi.fn().mockResolvedValue(workflowRepair('should-not-run'));
    const artifactWriter = vi.fn().mockResolvedValue(undefined);

    const result = await runWithAutoFix(specFileRequest, {
      maxAttempts: 7,
      runSingleAttempt,
      classifyFailure: fakeClassification,
      debugWorkflowRun: directDebugger,
      workflowRepairer,
      artifactWriter,
    });

    expect(runSingleAttempt).toHaveBeenCalledTimes(1);
    expect(workflowRepairer).not.toHaveBeenCalled();
    expect(artifactWriter).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    expect(result.auto_fix?.attempts).toHaveLength(1);
  });

});

describe('isSyntheticStageId', () => {
  it('matches the runtime-launch / local-runtime / runtime-precheck labels', async () => {
    const { isSyntheticStageId, SYNTHETIC_LOCAL_STAGE_IDS } = await import('./synthetic-step-ids.js');
    expect(isSyntheticStageId('runtime-launch')).toBe(true);
    expect(isSyntheticStageId('local-runtime')).toBe(true);
    expect(isSyntheticStageId('runtime-precheck')).toBe(true);
    expect(SYNTHETIC_LOCAL_STAGE_IDS.size).toBe(3);
  });

  it('does not match real workflow step ids', async () => {
    const { isSyntheticStageId } = await import('./synthetic-step-ids.js');
    expect(isSyntheticStageId('install-deps')).toBe(false);
    expect(isSyntheticStageId('aggregate-drift')).toBe(false);
    expect(isSyntheticStageId(undefined)).toBe(false);
    expect(isSyntheticStageId('')).toBe(false);
  });
});

describe('resolveSafeResumeAnchor', () => {
  // Mirrors the generated child-workflow shape that caused the
  // final-review-pass-gate infinite-retry loop: agent steps produce review
  // artifacts, then a deterministic gate greps them.
  const reviewGateWorkflow = `import { workflow } from '@agent-relay/sdk/workflows';
const wf = workflow('child')
  .step("prepare-context", { type: "deterministic", command: "echo prep" })
  .step("implement-slice", { agent: "impl-codex", dependsOn: ["prepare-context"], task: "do work" })
  .step("review-claude", { agent: "reviewer-claude", dependsOn: ["implement-slice"], task: "review" })
  .step("final-fix-codex", { agent: "validator-codex", dependsOn: ["review-claude"], task: "final fix" })
  .step("final-review-pass-gate", { type: "deterministic", dependsOn: ["final-fix-codex"], command: "grep -F MARKER artifact.md" })
  .step("final-signoff", { type: "deterministic", dependsOn: ["final-review-pass-gate"], command: "echo done" });
`;

  it('moves the anchor off a deterministic gate to its nearest upstream agent producer', () => {
    expect(resolveSafeResumeAnchor('final-review-pass-gate', reviewGateWorkflow)).toBe('final-fix-codex');
  });

  it('leaves an agent step as its own resume anchor', () => {
    expect(resolveSafeResumeAnchor('review-claude', reviewGateWorkflow)).toBe('review-claude');
  });

  it('keeps the anchor when the failed step is the gate but the chain is purely deterministic', () => {
    const deterministicOnly = `import { workflow } from '@agent-relay/sdk/workflows';
const wf = workflow('det')
  .step("build", { type: "deterministic", command: "make" })
  .step("verify", { type: "deterministic", dependsOn: ["build"], command: "test -f out" });
`;
    expect(resolveSafeResumeAnchor('verify', deterministicOnly)).toBe('verify');
  });

  it('returns the failed step unchanged when content is missing or unparseable', () => {
    expect(resolveSafeResumeAnchor('final-review-pass-gate', undefined)).toBe('final-review-pass-gate');
    expect(resolveSafeResumeAnchor('final-review-pass-gate', '')).toBe('final-review-pass-gate');
    expect(resolveSafeResumeAnchor(undefined, reviewGateWorkflow)).toBeUndefined();
  });

  it('returns the failed step unchanged when it is not a known step', () => {
    expect(resolveSafeResumeAnchor('does-not-exist', reviewGateWorkflow)).toBe('does-not-exist');
  });

  it('does not treat step ids embedded in shell command HEREDOCs as real steps', () => {
    // The grep below references "final-review-pass-gate" inside a command
    // string; the AST keeps string-literal contents inert so it is not
    // mistaken for a step definition.
    const withHeredoc = `import { workflow } from '@agent-relay/sdk/workflows';
const wf = workflow('child')
  .step("implement", { agent: "impl-codex", task: "work" })
  .step("gate", { type: "deterministic", dependsOn: ["implement"], command: "echo .step(\\"final-review-pass-gate\\", {}) && grep MARKER f" });
`;
    expect(resolveSafeResumeAnchor('gate', withHeredoc)).toBe('implement');
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

function generationOnlyFailureResponse(): LocalResponse {
  return {
    ok: false,
    artifacts: [],
    logs: [],
    warnings: ['routing: Spec has unresolved workflow authoring questions'],
    nextActions: ['Clarify the local workflow request and retry.'],
    generation: {
      stage: 'generate',
      status: 'needs_clarification',
      error: 'routing: Spec has unresolved workflow authoring questions',
    },
    exitCode: 2,
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

/**
 * Models the proactive-runtime "router loop" symptom: many real (non-synthetic)
 * workflow steps completed in the prior attempt, but the run still failed and
 * no concrete failed_step was parsed from evidence.
 */
function expensiveWorkBlockerResponse(runId: string | undefined): LocalResponse {
  const blocker: LocalClassifiedBlocker = {
    code: 'INVALID_ARTIFACT',
    category: 'workflow_invalid',
    message: 'Workflow runtime reported failure but Ricky could not identify which step failed.',
    detected_at: '2026-05-12T00:00:00.000Z',
    detected_during: 'launch',
    recovery: {
      actionable: true,
      steps: ['Inspect the captured workflow logs to identify the failed step.'],
    },
    context: { missing: [], found: [] },
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
      execution: {
        ...execution(runId),
        steps_completed: 5,
        steps_total: 7,
      },
      blocker,
      evidence: {
        outcome_summary: blocker.message,
        // No failed_step field — this is the trigger condition.
        logs: {
          tail: ['[workflow] FAILED: run aborted (no per-step failure record)'],
          truncated: true,
        },
        side_effects: { files_written: [], commands_invoked: [] },
        assertions: [{ name: 'runtime_exit_code', status: 'fail', detail: blocker.message }],
      },
    },
    exitCode: 2,
  };
}

function sdkRuntimeBlockerResponse(): LocalResponse {
  const blocker: LocalClassifiedBlocker = {
    code: 'INVALID_ARTIFACT',
    category: 'workflow_invalid',
    message: 'Workflow reported a failed run: Workflow runtime reported failure despite a zero process exit: ✗ verify-greeting — FAILED: Command failed with exit code 1.',
    detected_at: '2026-04-28T00:00:00.000Z',
    detected_during: 'launch',
    recovery: {
      actionable: true,
      steps: ['Inspect the captured workflow logs.'],
    },
    context: {
      missing: [],
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
      execution: execution(undefined),
      blocker,
      evidence: {
        outcome_summary: blocker.message,
        logs: {
          tail: [
            '[workflow 00:00] Starting workflow "ricky-demo-broken-greeting-workflow" (5 steps)',
            '[workflow] run relay-run-123',
            '[workflow 00:00] Executing 5 steps (pattern: pipeline)',
            '  ● prepare — started',
            '[workflow 00:00] [prepare] Running: mkdir -p .workflow-artifacts/demo-auto-fix/broken-greeting',
            '  ✓ prepare — completed',
            '  ● write-greeting — started',
            "[workflow 00:00] [write-greeting] Running: printf '%s\\n' 'hello world' > .workflow-artifacts/demo-auto-fix/broken-greeting/greeting.txt",
            '  ✓ write-greeting — completed',
            '  ● verify-greeting — started',
            '[workflow 00:00] [verify-greeting] Running: test -f .workflow-artifacts/demo-auto-fix/broken-greeting/hello.txt',
            '[workflow 00:00] [verify-greeting] Command failed (exit code 1)',
            '  ✗ verify-greeting — FAILED: Command failed with exit code 1',
            '  ○ emit-done — skipped',
            '  ○ summary — skipped',
            '[workflow] FAILED: Step "verify-greeting" failed: Step "verify-greeting" failed: Command failed with exit code 1',
          ],
          truncated: false,
        },
        side_effects: { files_written: [], commands_invoked: [] },
        assertions: [{ name: 'runtime_exit_code', status: 'fail', detail: blocker.message }],
      },
    },
    exitCode: 2,
  };
}

function leadPlanMarkerBlockerResponse(): LocalResponse {
  const artifactPath = 'workflows/generated/lead-plan-marker.ts';
  const blocker: LocalClassifiedBlocker = {
    code: 'INVALID_ARTIFACT',
    category: 'workflow_invalid',
    message: 'Workflow reported a failed run: lead plan missing required marker: Non-goals.',
    detected_at: '2026-04-28T00:00:00.000Z',
    detected_during: 'launch',
    recovery: {
      actionable: true,
      steps: ['Inspect the captured workflow logs.'],
    },
    context: {
      missing: ['Non-goals'],
      found: ['lead-plan.md', 'GENERATION_LEAD_PLAN_READY'],
    },
  };
  return {
    ok: false,
    artifacts: [{ path: artifactPath, content: leadPlanMarkerWorkflowContent() }],
    logs: [],
    warnings: [blocker.message],
    nextActions: [...blocker.recovery.steps],
    generation: {
      stage: 'generate',
      status: 'ok',
      artifact: { path: artifactPath, workflow_id: 'wf-lead-plan-marker', spec_digest: 'lead-plan-marker' },
    },
    execution: {
      stage: 'execute',
      status: 'blocker',
      execution: {
        ...execution('lead-plan-run-1'),
        artifact_path: artifactPath,
        workflow_file: artifactPath,
      },
      blocker,
      evidence: {
        outcome_summary: blocker.message,
        logs: {
          tail: [
            '[workflow 00:00] Starting workflow "ricky-lead-plan-marker-workflow" (3 steps)',
            '[workflow] run lead-plan-run-1',
            '  ● lead-plan — started',
            '  ✓ lead-plan — completed',
            '  ● lead-plan-gate — started',
            "[workflow 00:00] [lead-plan-gate] Running: node <<'NODE'",
            '[workflow 00:00] [lead-plan-gate] Command failed (exit code 1)',
            "Error: lead plan missing required marker: Non-goals",
            '  ✗ lead-plan-gate — FAILED: Command failed with exit code 1',
            '[workflow] FAILED: Step "lead-plan-gate" failed: Command failed with exit code 1',
          ],
          truncated: false,
        },
        side_effects: { files_written: [], commands_invoked: [] },
        assertions: [{ name: 'runtime_exit_code', status: 'fail', detail: blocker.message }],
      },
    },
    exitCode: 2,
  };
}

function semanticContractBlockerResponse(artifactPath: string, artifactContent: string): LocalResponse {
  const blocker: LocalClassifiedBlocker = {
    code: 'INVALID_ARTIFACT',
    category: 'workflow_invalid',
    message: 'Workflow reported a failed run: verify-contract-ready failed the semantic contract readiness check.',
    detected_at: '2026-04-28T00:00:00.000Z',
    detected_during: 'launch',
    recovery: {
      actionable: true,
      steps: ['Ask the Workforce persona to repair the workflow artifact.'],
    },
    context: {
      missing: [],
      found: [],
    },
  };
  return {
    ok: false,
    artifacts: [{ path: artifactPath, content: artifactContent }],
    logs: [],
    warnings: [blocker.message],
    nextActions: [...blocker.recovery.steps],
    generation: {
      stage: 'generate',
      status: 'ok',
      artifact: { path: artifactPath, workflow_id: 'wf-semantic-contract', spec_digest: 'semantic' },
    },
    execution: {
      stage: 'execute',
      status: 'blocker',
      execution: {
        ...execution('semantic-run-1'),
        artifact_path: artifactPath,
        workflow_file: artifactPath,
      },
      blocker,
      evidence: {
        outcome_summary: blocker.message,
        logs: {
          tail: [
            '[workflow 00:00] Starting workflow "ricky-demo-persona-repair-semantic-contract" (3 steps)',
            '[workflow] run semantic-run-1',
            '[workflow 00:00] Executing 3 steps (pattern: pipeline)',
            '  ● prepare-contract — started',
            '[workflow 00:00] [prepare-contract] Running: mkdir -p .workflow-artifacts/demo-persona-repair/semantic-contract',
            '  ✓ prepare-contract — completed',
            '  ● write-contract — started',
            '[workflow 00:00] [write-contract] Running: node -e "...write draft contract..."',
            '  ✓ write-contract — completed',
            '  ● verify-contract-ready — started',
            '[workflow 00:00] [verify-contract-ready] Running: node -e "...verify contract ready..."',
            '[workflow 00:00] [verify-contract-ready] Output:',
            '```',
            'contract must be ready with at least one approval; got status=draft, approvals=0',
            '```',
            '[workflow 00:00] [verify-contract-ready] Command failed (exit code 1)',
            '  ✗ verify-contract-ready — FAILED: Command failed with exit code 1',
            '[workflow] FAILED: Step "verify-contract-ready" failed: Command failed with exit code 1',
          ],
          truncated: false,
        },
        side_effects: { files_written: ['.workflow-artifacts/demo-persona-repair/semantic-contract/contract.json'], commands_invoked: [] },
        assertions: [{ name: 'runtime_exit_code', status: 'fail', detail: blocker.message }],
      },
    },
    exitCode: 2,
  };
}

function agentTimeoutBlockerResponse(): LocalResponse {
  const blocker: LocalClassifiedBlocker = {
    code: 'INVALID_ARTIFACT',
    category: 'workflow_invalid',
    message: 'Workflow reported a failed run: Step "implement-tests" failed after 2 retries: The operation was aborted due to timeout.',
    detected_at: '2026-04-28T00:00:00.000Z',
    detected_during: 'launch',
    recovery: {
      actionable: true,
      steps: ['Inspect the timed-out agent step and split the work.'],
    },
    context: {
      missing: ['completed agent step'],
      found: ['step=implement-tests', 'reason=timeout'],
    },
  };
  return {
    ok: false,
    artifacts: [{ path: 'workflows/generated/webapp-review.ts', content: agentTimeoutWorkflowContent() }],
    logs: [],
    warnings: [blocker.message],
    nextActions: [...blocker.recovery.steps],
    generation: {
      stage: 'generate',
      status: 'ok',
      artifact: { path: 'workflows/generated/webapp-review.ts', workflow_id: 'wf-timeout', spec_digest: 'timeout' },
    },
    execution: {
      stage: 'execute',
      status: 'blocker',
      execution: {
        ...execution('timeout-run-1'),
        artifact_path: 'workflows/generated/webapp-review.ts',
        workflow_file: 'workflows/generated/webapp-review.ts',
      },
      blocker,
      evidence: {
        outcome_summary: blocker.message,
        logs: {
          tail: [
            '[workflow 161:26] [implement-tests] Started (owner: test-impl, specialist: test-impl)',
            '  ↻ implement-tests — retrying (attempt 1)',
            '[workflow 163:36] [implement-tests] Started (owner: test-impl, specialist: test-impl)',
            '  ↻ implement-tests — retrying (attempt 2)',
            '[workflow 165:46] [implement-tests] Started (owner: test-impl, specialist: test-impl)',
            '  ✗ implement-tests — FAILED: The operation was aborted due to timeout',
            '[workflow] FAILED: Step "implement-tests" failed: Step "implement-tests" failed after 2 retries: The operation was aborted due to timeout',
          ],
          truncated: false,
        },
        side_effects: { files_written: [], commands_invoked: [] },
        assertions: [{ name: 'runtime_exit_code', status: 'fail', detail: blocker.message }],
      },
    },
    exitCode: 2,
  };
}

function timeoutRepairEvidenceWithEarlierNonTimeoutFailure(): WorkflowRunEvidence {
  return {
    runId: 'timeout-run-1',
    workflowId: 'wf-timeout',
    workflowName: 'ricky-webapp-review',
    status: 'failed',
    startedAt: '2026-04-28T00:00:00.000Z',
    completedAt: '2026-04-28T00:10:00.000Z',
    steps: [
      {
        stepId: 'run-focused-validation',
        stepName: 'run-focused-validation',
        status: 'failed',
        startedAt: '2026-04-28T00:00:00.000Z',
        completedAt: '2026-04-28T00:00:10.000Z',
        error: 'Command failed with exit code 1',
        verifications: [{
          type: 'exit_code',
          passed: false,
          expected: '0',
          actual: '1',
          message: 'Command failed with exit code 1',
        }],
        deterministicGates: [],
        logs: [{ stream: 'stdout', excerpt: '[workflow] [run-focused-validation] Command failed (exit code 1)' }],
        artifacts: [],
        history: [],
        retries: [],
        narrative: [],
      },
      {
        stepId: 'implement-tests',
        stepName: 'implement-tests',
        status: 'failed',
        startedAt: '2026-04-28T00:00:00.000Z',
        completedAt: '2026-04-28T00:10:00.000Z',
        error: 'The operation was aborted due to timeout',
        verifications: [],
        deterministicGates: [],
        logs: [{ stream: 'stdout', excerpt: '  ✗ implement-tests — FAILED: The operation was aborted due to timeout' }],
        artifacts: [],
        history: [],
        retries: [],
        narrative: [],
      },
    ],
    deterministicGates: [],
    artifacts: [{ path: 'workflows/generated/webapp-review.ts', kind: 'file' }],
    logs: [
      { stream: 'stderr', excerpt: '  ✗ implement-tests — FAILED: The operation was aborted due to timeout' },
      { stream: 'stderr', excerpt: '[workflow] FAILED: Step "implement-tests" failed after 2 retries: The operation was aborted due to timeout' },
    ],
    narrative: [],
    routing: [],
  };
}

function semanticContractEvidence(response: LocalResponse): WorkflowRunEvidence {
  return {
    runId: response.execution?.execution.run_id ?? 'semantic-run-1',
    workflowId: 'wf-semantic-contract',
    workflowName: 'ricky-demo-persona-repair-semantic-contract',
    status: 'failed',
    startedAt: '2026-04-28T00:00:00.000Z',
    completedAt: '2026-04-28T00:00:01.000Z',
    steps: [
      {
        stepId: 'verify-contract-ready',
        stepName: 'verify-contract-ready',
        status: 'failed',
        startedAt: '2026-04-28T00:00:00.000Z',
        completedAt: '2026-04-28T00:00:01.000Z',
        verifications: [{
          type: 'exit_code',
          passed: false,
          expected: '0',
          actual: '1',
          message: 'contract must be ready with at least one approval; got status=draft, approvals=0',
          command: 'node -e "...verify contract ready..."',
          exitCode: 1,
        }],
        deterministicGates: [],
        logs: response.execution?.evidence?.logs.tail?.map((excerpt) => ({ stream: 'stdout' as const, excerpt })) ?? [],
        artifacts: [{ path: 'workflows/demo-persona-repair/semantic-contract.ts', kind: 'file' }],
        history: [],
        retries: [],
        narrative: [],
      },
    ],
    deterministicGates: [],
    artifacts: [{ path: 'workflows/demo-persona-repair/semantic-contract.ts', kind: 'file' }],
    logs: [],
    narrative: [],
    routing: [],
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

function legacyMasterWorkflowContent(): string {
  return [
    "import { workflow } from '@agent-relay/sdk/workflows';",
    '',
    '// RICKY_MASTER_EXECUTOR_WORKFLOW',
    'async function main() {',
    '  await workflow("ricky-master")',
    '    .onError(\'fail-fast\')',
    '    .step("run-child", {',
    '      type: "deterministic",',
    '      command: "set -e\\nricky run \'workflows/generated/child.ts\' --foreground --no-auto-fix\\ntest -f \'.workflow-artifacts/child/signoff.md\'",',
    '      captureOutput: true,',
    '      failOnError: true,',
    '    })',
    '    .run({ cwd: process.cwd() });',
    '}',
  ].join('\n');
}

function legacyChildWorkflowContent(): string {
  return [
    "import { workflow } from '@agent-relay/sdk/workflows';",
    '',
    'async function main() {',
    '  await workflow("ricky-child-update-config-2")',
    '    .step("final-hard-validation", {',
    '      type: "deterministic",',
    '      dependsOn: ["fix-loop"],',
    '      command: "set -e\\nnpm run typecheck\\ngit diff --name-only",',
    '      captureOutput: true,',
    '      failOnError: true,',
    '    })',
    '    .step("final-signoff", {',
    '      type: "deterministic",',
    '      dependsOn: ["final-hard-validation"],',
    '      command: "test -s .workflow-artifacts/generated/child/signoff.md",',
    '      captureOutput: true,',
    '      failOnError: true,',
    '    })',
    '    .run({ cwd: process.cwd() });',
    '}',
  ].join('\n');
}

function sdkRuntimeBlockerEvidence(failedStep: string): WorkflowRunEvidence {
  return {
    runId: 'run-1',
    workflowId: 'wf-1',
    workflowName: 'ricky-master',
    status: 'failed',
    startedAt: '2026-04-28T00:00:00.000Z',
    completedAt: '2026-04-28T00:00:01.000Z',
    steps: [
      {
        stepId: failedStep,
        stepName: failedStep,
        status: 'failed',
        startedAt: '2026-04-28T00:00:00.000Z',
        completedAt: '2026-04-28T00:00:01.000Z',
        error: `Step "${failedStep}" failed: Command failed with exit code 2`,
        verifications: [],
        deterministicGates: [],
        logs: [{ stream: 'stdout', excerpt: `✗ ${failedStep} — FAILED: Command failed with exit code 2` }],
        artifacts: [],
        retries: [],
        narrative: [],
        history: [],
      },
    ],
    deterministicGates: [],
    logs: [{ stream: 'stdout', excerpt: `INVALID_ARTIFACT at ${failedStep}` }],
    artifacts: [],
    narrative: [],
    routing: [],
  };
}

function leadPlanMarkerWorkflowContent(): string {
  return [
    "import { workflow } from '@agent-relay/sdk/workflows';",
    '',
    "workflow('lead-plan-marker')",
    "  .step('lead-plan', {",
    "    agent: 'lead-claude',",
    "    task: 'Write the lead plan.',",
    '  })',
    '  .step("lead-plan-gate", {',
    "    type: 'deterministic',",
    '    dependsOn: ["lead-plan"],',
    '    command: "node <<\'NODE\'\\nconst fs = require(\'node:fs\');\\nconst leadPlanPath = \\".workflow-artifacts/generated/lead-plan-marker/lead-plan.md\\";\\nconst body = fs.readFileSync(leadPlanPath, \'utf8\');\\nif (!body.includes(\'GENERATION_LEAD_PLAN_READY\')) throw new Error(\'lead plan missing required marker: GENERATION_LEAD_PLAN_READY\');\\nif (!/non-goals?/i.test(body)) throw new Error(\'lead plan missing required marker: Non-goals\');\\nconst hasRoutingContract = /Routing contract/i.test(body) || /Local execution must run through Agent Relay/i.test(body) || /Run local execution through the generated Agent Relay workflow artifact/i.test(body) || /routes local execution through the generated Agent Relay artifact/i.test(body) || /Use the generated Agent Relay workflow artifact/i.test(body);\\nif (!hasRoutingContract) throw new Error(\'lead plan missing required marker: Routing contract\');\\nconst hasImplementationContract = /Implementation contract/i.test(body) || /This is an implementation spec/i.test(body);\\nif (!hasImplementationContract) throw new Error(\'lead plan missing required marker: Implementation contract\');\\nconsole.log(\'LEAD_PLAN_GATE_OK\');\\nNODE",',
    '    captureOutput: true,',
    '    failOnError: true,',
    '  })',
    '  .run({ cwd: process.cwd() });',
    '',
  ].join('\n');
}

function missingEnvEvidence(name = 'TEST_TOKEN'): WorkflowRunEvidence {
  return {
    runId: 'run-1',
    workflowId: 'wf-1',
    workflowName: 'foo',
    status: 'failed',
    startedAt: '2026-04-28T00:00:00.000Z',
    completedAt: '2026-04-28T00:00:01.000Z',
    steps: [
      {
        stepId: 'runtime-launch',
        stepName: 'runtime-launch',
        status: 'failed',
        startedAt: '2026-04-28T00:00:00.000Z',
        completedAt: '2026-04-28T00:00:01.000Z',
        error: `MISSING_ENV_VAR: ${name}`,
        verifications: [],
        deterministicGates: [],
        logs: [{ stream: 'stderr', excerpt: `MISSING_ENV_VAR: ${name}` }],
        artifacts: [],
        history: [],
        retries: [],
        narrative: [],
      },
    ],
    deterministicGates: [],
    artifacts: [{ path: 'workflows/generated/foo.ts', kind: 'file' }],
    logs: [{ stream: 'stderr', excerpt: `MISSING_ENV_VAR: ${name}` }],
    narrative: [],
    routing: [],
  };
}

function demoArtifactDir(): string {
  return '.workflow-artifacts/demo-auto-fix/broken-greeting';
}

function brokenDemoWorkflowContent(): string {
  const artifactDir = demoArtifactDir();
  return `
import { workflow } from '@agent-relay/sdk/workflows';

const artifactDir = '${artifactDir}';

workflow('ricky-demo-broken-greeting')
  .step('prepare', {
    type: 'deterministic',
    command: \`mkdir -p \${artifactDir}\`,
    failOnError: true,
  })
  .step('write-greeting', {
    type: 'deterministic',
    dependsOn: ['prepare'],
    command: \`printf '%s\\n' 'hello world' > \${artifactDir}/greeting.txt\`,
    failOnError: true,
  })
  .step('verify-greeting', {
    type: 'deterministic',
    dependsOn: ['write-greeting'],
    command: \`test -f \${artifactDir}/hello.txt\`,
    failOnError: true,
  })
  .step('emit-done', {
    type: 'deterministic',
    dependsOn: ['verify-greeting'],
    command: \`echo DONE\`,
    failOnError: true,
    verification: { type: 'output_contains', value: 'COMPLETE' },
  })
  .step('summary', {
    type: 'deterministic',
    dependsOn: ['emit-done'],
    command: \`printf 'pipeline complete: %s\\n' '{{steps.write-message.output}}' > \${artifactDir}/summary.txt\`,
    failOnError: true,
  })
  .run({ cwd: process.cwd() });
`;
}

function agentTimeoutWorkflowContent(timeoutExpression = 'AGENT_STEP_TIMEOUT_MS'): string {
  return `
import { workflow } from '@agent-relay/sdk/workflows';

const ARTIFACT_DIR = 'workflows/generated/.ricky-webapp-review';
const MAX_TIMEOUT = 1_800_000;
const AGENT_STEP_TIMEOUT_MS = Number.parseInt(process.env.RICKY_AGENT_STEP_TIMEOUT_MS ?? '300000', 10);

workflow('ricky-webapp-review')
  .agent('test-impl', {
    cli: 'codex',
    preset: 'worker',
    role: 'Test implementer and fixer.',
    retries: 2,
    timeoutMs: AGENT_STEP_TIMEOUT_MS,
  })
  .step('verify-surfaces-and-webapp', {
    type: 'deterministic',
    command: 'echo SURFACES_VERIFIED',
    failOnError: true,
  })
  .step('implement-tests', {
    agent: 'test-impl',
    dependsOn: ['verify-surfaces-and-webapp'],
    timeoutMs: ${timeoutExpression},
    task: \`Add and update tests for the implemented deep review flow.

Required coverage:
- readiness gate states,
- intent idempotency,
- runtime election,
- review-workspace routes,
- Slack and Telegram retrigger handoff,
- webapp queued/blocked/running/completed states,
- workflow dispatch/writeback contract.

Run focused tests while editing. Write \${ARTIFACT_DIR}/tests-summary.md ending with TESTS_IMPLEMENTED.\`,
    verification: { type: 'file_exists', value: \`\${ARTIFACT_DIR}/tests-summary.md\` },
  })
  .step('run-focused-validation', {
    type: 'deterministic',
    dependsOn: ['implement-tests'],
    command: 'npm test',
    captureOutput: true,
    failOnError: true,
  })
  .run({ cwd: process.cwd() });
`;
}

function bareGitDiffManifestWorkflowContent(): string {
  return `
import { workflow } from '@agent-relay/sdk/workflows';

const OUTPUT_MANIFEST = 'artifacts/ricky/output-manifest.txt';
const FINAL_DIFF_FILES = 'artifacts/ricky/final-diff-files.txt';

workflow('cloud-autofix')
  .step('verify-non-empty-implementation-diff', {
    type: 'deterministic',
    command: [
      'set -e',
      'NON_TRANSIENT=$(git diff --name-only | rg -v "^(patches/|artifacts/|docs/.*plan\\\\.md$|.*output-manifest\\\\.txt$)" || true)',
      'if [ -z "$NON_TRANSIENT" ]; then echo "EMPTY_IMPLEMENTATION_DIFF"; exit 1; fi',
      \`printf "%s\\\\n" "$NON_TRANSIENT" > \${OUTPUT_MANIFEST}\`,
      \`cat \${OUTPUT_MANIFEST}\`,
      \`rg -n "^(packages/web/app/api/v1/ricky/runs/|packages/web/lib/ricky/)" \${OUTPUT_MANIFEST} >/dev/null\`,
    ].join(' && '),
    captureOutput: true,
    failOnError: true,
  })
  .step('final-signoff', {
    type: 'deterministic',
    dependsOn: ['verify-non-empty-implementation-diff'],
    command: [
      'set -e',
      \`git diff --name-only > \${FINAL_DIFF_FILES}\`,
      \`test -s \${FINAL_DIFF_FILES}\`,
    ].join(' && '),
    failOnError: true,
  })
  .run({ cwd: process.cwd() });
`;
}

function gitDiffManifestFailureEvidence(): WorkflowRunEvidence {
  return {
    runId: 'diff-run-1',
    workflowId: 'wf-cloud-autofix',
    workflowName: 'cloud-autofix',
    status: 'failed',
    startedAt: '2026-05-03T00:00:00.000Z',
    completedAt: '2026-05-03T00:03:23.000Z',
    steps: [{
      stepId: 'verify-non-empty-implementation-diff',
      stepName: 'verify-non-empty-implementation-diff',
      status: 'failed',
      startedAt: '2026-05-03T00:03:23.000Z',
      completedAt: '2026-05-03T00:03:24.000Z',
      error: 'Command failed with exit code 1',
      verifications: [{
        type: 'exit_code',
        passed: false,
        expected: '0',
        actual: '1',
        message: 'Command failed with exit code 1',
        command: 'NON_TRANSIENT=$(git diff --name-only | rg -v "^(patches/|artifacts/|docs/.*plan\\.md$|.*output-manifest\\.txt$)" || true)',
        exitCode: 1,
      }],
      deterministicGates: [],
      logs: [{
        stream: 'stdout',
        excerpt: [
          'packages/core/src/bootstrap/launcher.ts',
          'packages/web/app/api/v1/workflows/run/route.ts',
          'tests/workflow-run-route.test.ts',
        ].join('\n'),
      }],
      artifacts: [],
      history: [],
      retries: [],
      narrative: [],
    }],
    deterministicGates: [],
    artifacts: [{ path: 'workflows/generated/cloud-autofix.ts', kind: 'file' }],
    logs: [{
      stream: 'stderr',
      excerpt: '[workflow] FAILED: Step "verify-non-empty-implementation-diff" failed: Command failed with exit code 1',
    }],
    narrative: [],
    routing: [],
  };
}

function sentinelGuardedRehydrationWorkflowContent(): string {
  return [
    "import { workflow } from '@agent-relay/sdk/workflows';",
    '',
    "const artifactDir = '.workflow-artifacts/generated/example';",
    '',
    "workflow('sentinel-rehydration')",
    "  .step('final-review-pass-gate', {",
    "    type: 'deterministic',",
    '    command: `set -euo pipefail',
    "mkdir -p '${artifactDir}'",
    "if [ ! -f '${artifactDir}/final-review-claude.md' ]; then",
    "  cat > '${artifactDir}/final-review-claude.md' <<'EOF'",
    'Final review summary (claude)',
    '- some content',
    'final_review_claude_pass',
    'EOF',
    'fi',
    "if [ ! -f '${artifactDir}/final-review-codex.md' ]; then",
    "  cat > '${artifactDir}/final-review-codex.md' <<'EOF'",
    'Final review summary (codex)',
    '- some content',
    'final_review_codex_pass',
    'EOF',
    'fi',
    "tail -n 1 '${artifactDir}/final-review-claude.md' | tr -d '[:space:]' | grep -E '^final_review_claude_pass$'",
    "tail -n 1 '${artifactDir}/final-review-codex.md' | tr -d '[:space:]' | grep -E '^final_review_codex_pass$'`,",
    '    captureOutput: true,',
    '    failOnError: true,',
    '  })',
    '  .run({ cwd: process.cwd() });',
    '',
  ].join('\n');
}

function sentinelGuardedRehydrationWithoutTailCheckContent(): string {
  return [
    "import { workflow } from '@agent-relay/sdk/workflows';",
    '',
    "const artifactDir = '.workflow-artifacts/generated/example';",
    '',
    "workflow('sentinel-no-check')",
    "  .step('seed-readme', {",
    "    type: 'deterministic',",
    '    command: `set -euo pipefail',
    "mkdir -p '${artifactDir}'",
    "if [ ! -f '${artifactDir}/readme.md' ]; then",
    "  cat > '${artifactDir}/readme.md' <<'EOF'",
    'Seeded readme content',
    'readme_seeded',
    'EOF',
    'fi',
    "test -f '${artifactDir}/readme.md'`,",
    '    captureOutput: true,',
    '    failOnError: true,',
    '  })',
    '  .run({ cwd: process.cwd() });',
    '',
  ].join('\n');
}

function sentinelGuardedRehydrationFailureEvidence(): WorkflowRunEvidence {
  return {
    runId: 'sentinel-run-1',
    workflowId: 'wf-sentinel-rehydration',
    workflowName: 'sentinel-rehydration',
    status: 'failed',
    startedAt: '2026-05-04T00:00:00.000Z',
    completedAt: '2026-05-04T00:00:08.000Z',
    steps: [{
      stepId: 'final-review-pass-gate',
      stepName: 'final-review-pass-gate',
      status: 'failed',
      startedAt: '2026-05-04T00:00:07.000Z',
      completedAt: '2026-05-04T00:00:08.000Z',
      error: 'Command failed with exit code 1',
      verifications: [{
        type: 'exit_code',
        passed: false,
        expected: '0',
        actual: '1',
        message: 'Command failed with exit code 1',
        command: "tail -n 1 '.workflow-artifacts/generated/example/final-review-claude.md' | tr -d '[:space:]' | grep -E '^final_review_claude_pass$'",
        exitCode: 1,
      }],
      deterministicGates: [],
      logs: [],
      artifacts: [],
      history: [],
      retries: [],
      narrative: [],
    }],
    deterministicGates: [],
    artifacts: [{ path: 'workflows/generated/sentinel-rehydration.ts', kind: 'file' }],
    logs: [{
      stream: 'stderr',
      excerpt: '[workflow] FAILED: Step "final-review-pass-gate" failed: Command failed with exit code 1',
    }],
    narrative: [],
    routing: [],
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
