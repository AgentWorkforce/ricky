import {
  appendStepEvent,
  attachRunArtifact,
  attachRunLog,
  buildEvidenceOutcome,
  completeRun,
  completeStep,
  createRunEvidence,
  createVerificationResult,
  recordDeterministicGate,
  summarizeEvidence,
} from '../capture.js';
import type {
  EvidenceOutcome,
  VerificationResult,
  WorkflowRunEvidence,
  WorkflowStepEvidence,
} from '../types.js';
import { classifyFailure } from '../../failure/classifier.js';
import type { FailureClassification } from '../../failure/types.js';

export const RuntimeOutcomeCase = {
  Success: 'success',
  VerificationFailure: 'verification_failure',
  Timeout: 'timeout',
  RunnerEnvironmentFailure: 'runner_environment_failure',
} as const;

export type RuntimeOutcomeCase =
  (typeof RuntimeOutcomeCase)[keyof typeof RuntimeOutcomeCase];

export interface RuntimeOutcomeProof {
  caseName: RuntimeOutcomeCase;
  run: WorkflowRunEvidence;
  outcome: EvidenceOutcome;
  classification: FailureClassification;
}

export function runRuntimeOutcomeFixture(caseName: RuntimeOutcomeCase): RuntimeOutcomeProof {
  const run = completeFixture(caseName);

  return {
    caseName,
    run,
    outcome: buildEvidenceOutcome(run),
    classification: classifyFailure(run),
  };
}

export function runAllRuntimeOutcomeFixtures(): RuntimeOutcomeProof[] {
  return Object.values(RuntimeOutcomeCase).map(runRuntimeOutcomeFixture);
}

export function summaryShapeForProof(run: WorkflowRunEvidence): Record<string, unknown> {
  const summary = summarizeEvidence(run);

  return {
    runId: summary.runId,
    workflowName: summary.workflowName,
    runStatus: summary.runStatus,
    totalSteps: summary.totalSteps,
    passedSteps: summary.passedSteps,
    failedSteps: summary.failedSteps,
    timedOutSteps: summary.timedOutSteps,
    allVerificationsPassed: summary.allVerificationsPassed,
    allDeterministicGatesPassed: summary.allDeterministicGatesPassed,
    failedStepIds: summary.failedStepIds,
    firstError: summary.firstError,
    artifactCount: summary.artifactCount,
    retryCount: summary.retryCount,
    routeCount: summary.routeCount,
  };
}

function completeFixture(caseName: RuntimeOutcomeCase): WorkflowRunEvidence {
  switch (caseName) {
    case RuntimeOutcomeCase.Success:
      return successRun();
    case RuntimeOutcomeCase.VerificationFailure:
      return verificationFailureRun();
    case RuntimeOutcomeCase.Timeout:
      return timeoutRun();
    case RuntimeOutcomeCase.RunnerEnvironmentFailure:
      return runnerEnvironmentFailureRun();
  }
}

function baseRun(caseName: RuntimeOutcomeCase): WorkflowRunEvidence {
  return createRunEvidence({
    runId: `runtime-outcome-${caseName}`,
    workflowId: 'wf-runtime-outcome-proof',
    workflowName: 'runtime-outcome-proof',
    routing: {
      abstractionName: 'runtime-outcome-proof',
      abstractionPath: 'packages/runtime/src/evidence/proof/runtime-outcome-proof.ts',
      requestedRoute: 'local-fixture-runner',
      resolvedRoute: 'deterministic-runtime-fixture',
      routedBy: 'runtime-outcome-proof',
      reason: 'fixture-backed proof avoids live agent-relay dependency',
    },
  });
}

function startStep(
  stepId: string,
  stepName: string,
  stdoutExcerpt: string,
): WorkflowStepEvidence {
  return appendStepEvent(
    appendStepEvent(
      {
        stepId,
        stepName,
        status: 'pending',
        agentRole: 'fixture-runner',
        verifications: [],
        deterministicGates: [],
        logs: [],
        artifacts: [],
        history: [],
        retries: [],
        narrative: [],
      },
      { kind: 'status_change', status: 'running', message: `${stepName} started` },
    ),
    {
      kind: 'log',
      ref: { stream: 'stdout', excerpt: stdoutExcerpt },
    },
  );
}

function successRun(): WorkflowRunEvidence {
  let run = baseRun(RuntimeOutcomeCase.Success);
  let step = startStep('render-artifact', 'render artifact', 'rendered artifact.md');

  const verification = passingVerification({
    type: 'artifact_exists',
    expected: 'artifacts/outcome.md',
    actual: 'artifacts/outcome.md',
    command: 'test -f artifacts/outcome.md',
    exitCode: 0,
    stdoutExcerpt: 'artifact exists: artifacts/outcome.md',
  });

  run = { ...run, steps: [step] };
  run = recordDeterministicGate(run, 'artifact-contract', [verification], step.stepId).run;
  step = run.steps[0];
  step = appendStepEvent(step, {
    kind: 'artifact',
    ref: { path: 'artifacts/outcome.md', kind: 'report', description: 'fixture output' },
  });
  step = completeStep(step, 'passed');

  run = {
    ...run,
    steps: [step],
  };
  run = attachRunArtifact(run, {
    path: 'artifacts/outcome-summary.json',
    kind: 'report',
    description: 'runtime outcome summary',
  });

  return completeRun(run, { finalSignoffPath: 'artifacts/outcome.md' });
}

function verificationFailureRun(): WorkflowRunEvidence {
  let run = baseRun(RuntimeOutcomeCase.VerificationFailure);
  let step = startStep('verify-contract', 'verify contract', 'generated candidate output');

  const verification = failingVerification({
    type: 'output_contains',
    expected: 'RUNTIME_OUTCOME_PROOF_COMPLETE',
    actual: 'candidate output missing marker',
    message: 'required completion marker missing',
    command: 'rg RUNTIME_OUTCOME_PROOF_COMPLETE artifacts/outcome.md',
    exitCode: 1,
    stdoutExcerpt: 'candidate output missing marker',
    stderrExcerpt: 'pattern not found',
  });

  run = { ...run, steps: [step] };
  run = recordDeterministicGate(run, 'completion-marker-gate', [verification], step.stepId).run;
  step = run.steps[0];
  step = appendStepEvent(step, {
    kind: 'error',
    message: 'required completion marker missing',
  });
  step = completeStep(step, 'failed');

  return completeRun({ ...run, steps: [step] });
}

function timeoutRun(): WorkflowRunEvidence {
  let run = baseRun(RuntimeOutcomeCase.Timeout);
  let step = startStep('wait-for-runner', 'wait for runner', 'runner accepted step');

  const verification = failingVerification({
    type: 'exit_code',
    expected: 'completed before 30000ms',
    actual: 'timed out after 30000ms',
    message: 'runner step timed out',
    command: 'fixture-runner wait-for-runner --timeout 30000',
    exitCode: 124,
    stderrExcerpt: 'timed out after 30000ms',
  });

  run = { ...run, steps: [step] };
  run = recordDeterministicGate(run, 'runtime-time-budget', [verification], step.stepId).run;
  step = run.steps[0];
  step = appendStepEvent(step, {
    kind: 'error',
    message: 'runner step timed out after 30000ms',
  });
  step = completeStep(step, 'timed_out');

  return completeRun({ ...run, steps: [step] });
}

function runnerEnvironmentFailureRun(): WorkflowRunEvidence {
  let run = baseRun(RuntimeOutcomeCase.RunnerEnvironmentFailure);
  let step = startStep('spawn-runner', 'spawn runner', 'preparing fixture runner');

  const verification = failingVerification({
    type: 'exit_code',
    expected: '0',
    actual: 'ENOENT',
    message: 'spawn fixture-runner ENOENT',
    command: 'fixture-runner execute runtime-outcome',
    exitCode: 127,
    stderrExcerpt: 'spawn fixture-runner ENOENT',
  });

  step = appendStepEvent(step, {
    kind: 'log',
    ref: { stream: 'stderr', excerpt: 'spawn fixture-runner ENOENT' },
  });
  run = attachRunLog({ ...run, steps: [step] }, {
    stream: 'system',
    excerpt: 'command not found: fixture-runner',
  });
  run = recordDeterministicGate(run, 'runner-launch-gate', [verification], step.stepId).run;
  step = run.steps[0];
  step = appendStepEvent(step, {
    kind: 'error',
    message: 'spawn fixture-runner ENOENT',
  });
  step = completeStep(step, 'failed');

  return completeRun({ ...run, steps: [step] });
}

function passingVerification(overrides: Partial<VerificationResult>): VerificationResult {
  return createVerificationResult({
    type: 'exit_code',
    passed: true,
    expected: '0',
    actual: '0',
    ...overrides,
  });
}

function failingVerification(overrides: Partial<VerificationResult>): VerificationResult {
  return createVerificationResult({
    type: 'exit_code',
    passed: false,
    expected: '0',
    actual: '1',
    ...overrides,
  });
}
