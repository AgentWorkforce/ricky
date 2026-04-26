import type {
  AgentNarrativeEvidence,
  DeterministicGateResult,
  EvidenceSummary,
  RunStatus,
  StepEvent,
  StepStatus,
  VerificationResult,
  WorkflowArtifactReference,
  WorkflowLogReference,
  WorkflowRetryEvidence,
  WorkflowRoutingEvidence,
  WorkflowRunEvidence,
  WorkflowStepEvidence,
} from './types.js';

export interface CreateRunParams {
  runId: string;
  workflowId: string;
  workflowName: string;
  routing?: Omit<WorkflowRoutingEvidence, 'recordedAt'>;
}

export interface CreateStepParams {
  stepId: string;
  stepName: string;
  agentRole?: string;
  routing?: Omit<WorkflowRoutingEvidence, 'recordedAt'>;
}

export interface GateParams {
  gateName: string;
  verifications: VerificationResult[];
  command?: string;
  exitCode?: number;
  stdoutExcerpt?: string;
  stderrExcerpt?: string;
  outputExcerpt?: string;
  artifacts?: WorkflowArtifactReference[];
}

export interface RetryParams {
  attempt: number;
  status: StepStatus;
  startedAt?: string;
  completedAt?: string;
  error?: string;
  command?: string;
  exitCode?: number;
  stdoutExcerpt?: string;
  stderrExcerpt?: string;
  outputExcerpt?: string;
  verifications?: VerificationResult[];
  artifacts?: WorkflowArtifactReference[];
}

/** Create a fresh run evidence record in pending state. */
export function createRunEvidence(params: CreateRunParams): WorkflowRunEvidence {
  const startedAt = nowIso();
  return {
    runId: params.runId,
    workflowId: params.workflowId,
    workflowName: params.workflowName,
    status: 'pending',
    steps: [],
    startedAt,
    deterministicGates: [],
    artifacts: [],
    logs: [],
    narrative: [],
    routing: params.routing ? [{ ...params.routing, recordedAt: startedAt }] : [],
  };
}

/** Create a fresh step evidence record in pending state. */
export function createStepEvidence(params: CreateStepParams): WorkflowStepEvidence {
  const recordedAt = nowIso();
  return {
    stepId: params.stepId,
    stepName: params.stepName,
    status: 'pending',
    agentRole: params.agentRole,
    verifications: [],
    deterministicGates: [],
    logs: [],
    artifacts: [],
    history: [],
    retries: [],
    narrative: [],
    ...(params.routing ? { routing: { ...params.routing, recordedAt } } : {}),
  };
}

/** Append an event to a step, returning updated step evidence. */
export function appendStepEvent(
  step: WorkflowStepEvidence,
  event: StepEvent,
): WorkflowStepEvidence {
  const recordedAt = nowIso();

  switch (event.kind) {
    case 'status_change':
      return recordStepStatus(step, event.status, {
        at: recordedAt,
        message: event.message,
        agentRole: event.agentRole,
      });

    case 'verification':
      return {
        ...step,
        verifications: [...step.verifications, stampVerification(event.result, recordedAt)],
      };

    case 'deterministic_gate':
      return attachGateToStep(step, event.gate);

    case 'log':
      return {
        ...step,
        logs: [...step.logs, event.ref],
      };

    case 'artifact':
      return attachArtifact(step, event.ref);

    case 'retry':
      return {
        ...step,
        retries: [...step.retries, normalizeRetry(step, event, recordedAt)],
      };

    case 'routing':
      return {
        ...step,
        routing: stampRouting(event.route, recordedAt),
      };

    case 'narrative':
      return appendStepNarrative(step, event.narrative);

    case 'error':
      return {
        ...step,
        error: event.message,
      };
  }
}

/** Record a deterministic verification gate against the run, optionally against a step. */
export function recordDeterministicGate(
  run: WorkflowRunEvidence,
  gateName: string,
  verifications: VerificationResult[],
  stepId?: string,
): { gate: DeterministicGateResult; run: WorkflowRunEvidence } {
  const gate = createDeterministicGate({ gateName, verifications });
  const updatedSteps = stepId
    ? run.steps.map((step) => (step.stepId === stepId ? attachGateToStep(step, gate) : step))
    : run.steps;

  return {
    gate,
    run: {
      ...run,
      steps: updatedSteps,
      deterministicGates: [...run.deterministicGates, gate],
    },
  };
}

/** Build a deterministic gate record from command and verification evidence. */
export function createDeterministicGate(params: GateParams): DeterministicGateResult {
  const recordedAt = nowIso();
  return {
    gateName: params.gateName,
    passed: params.verifications.length > 0 && params.verifications.every((v) => v.passed),
    verifications: params.verifications.map((v) => stampVerification(v, recordedAt)),
    recordedAt,
    ...(params.command ? { command: params.command } : {}),
    ...(typeof params.exitCode === 'number' ? { exitCode: params.exitCode } : {}),
    ...(params.stdoutExcerpt ? { stdoutExcerpt: params.stdoutExcerpt } : {}),
    ...(params.stderrExcerpt ? { stderrExcerpt: params.stderrExcerpt } : {}),
    ...(params.outputExcerpt ? { outputExcerpt: params.outputExcerpt } : {}),
    ...(params.artifacts ? { artifacts: params.artifacts } : {}),
  };
}

/** Attach an artifact reference to a step. */
export function attachArtifact(
  step: WorkflowStepEvidence,
  artifact: WorkflowArtifactReference,
): WorkflowStepEvidence {
  return {
    ...step,
    artifacts: [...step.artifacts, artifact],
  };
}

/** Attach a log reference to the run. */
export function attachRunLog(
  run: WorkflowRunEvidence,
  log: WorkflowLogReference,
): WorkflowRunEvidence {
  return {
    ...run,
    logs: [...run.logs, log],
  };
}

/** Record a workflow abstraction or execution routing decision on the run. */
export function recordRoutingDecision(
  run: WorkflowRunEvidence,
  route: Omit<WorkflowRoutingEvidence, 'recordedAt'>,
): WorkflowRunEvidence {
  return {
    ...run,
    routing: [...run.routing, { ...route, recordedAt: nowIso() }],
  };
}

/** Append agent narrative output without mixing it into deterministic gates. */
export function appendRunNarrative(
  run: WorkflowRunEvidence,
  narrative: Omit<AgentNarrativeEvidence, 'recordedAt'>,
): WorkflowRunEvidence {
  return {
    ...run,
    narrative: [...run.narrative, { ...narrative, recordedAt: nowIso() }],
  };
}

/** Mark a step as complete with a terminal status. */
export function completeStep(
  step: WorkflowStepEvidence,
  status: StepStatus,
): WorkflowStepEvidence {
  const completedAt = nowIso();
  const startedAt = step.startedAt ?? completedAt;
  const durationMs = new Date(completedAt).getTime() - new Date(startedAt).getTime();

  return {
    ...recordStepStatus(step, status, { at: completedAt, agentRole: step.agentRole }),
    startedAt,
    completedAt,
    durationMs,
  };
}

/** Derive run status from step statuses and mark the run as complete. */
export function completeRun(run: WorkflowRunEvidence): WorkflowRunEvidence {
  const derivedStatus = deriveRunStatus(run.steps);

  // Only stamp completion metadata when the derived status is terminal.
  // A run with pending/running steps should not carry completedAt/durationMs
  // because downstream analytics uses those fields to distinguish active from
  // terminal runs.
  if (derivedStatus === 'running') {
    return {
      ...run,
      status: derivedStatus,
    };
  }

  const completedAt = nowIso();
  const durationMs = new Date(completedAt).getTime() - new Date(run.startedAt).getTime();

  return {
    ...run,
    status: derivedStatus,
    completedAt,
    durationMs,
  };
}

/** Produce a condensed summary from run evidence. */
export function summarizeEvidence(run: WorkflowRunEvidence): EvidenceSummary {
  const counts: Record<StepStatus, number> = {
    pending: 0,
    running: 0,
    passed: 0,
    failed: 0,
    skipped: 0,
    cancelled: 0,
    timed_out: 0,
  };
  const failedStepIds: string[] = [];
  let firstError: string | undefined;
  let artifactCount = run.artifacts.length;
  let retryCount = 0;

  for (const step of run.steps) {
    counts[step.status] += 1;
    artifactCount += step.artifacts.length;
    retryCount += step.retries.length;

    if (step.status === 'failed' || step.status === 'timed_out' || step.status === 'cancelled') {
      failedStepIds.push(step.stepId);
      firstError ??= step.error;
    }
  }

  return {
    runId: run.runId,
    workflowName: run.workflowName,
    runStatus: run.status,
    totalSteps: run.steps.length,
    passedSteps: counts.passed,
    failedSteps: counts.failed,
    skippedSteps: counts.skipped,
    cancelledSteps: counts.cancelled,
    timedOutSteps: counts.timed_out,
    pendingSteps: counts.pending,
    runningSteps: counts.running,
    allVerificationsPassed: allVerificationsPassed(run),
    allDeterministicGatesPassed: allDeterministicGatesPassed(run),
    failedStepIds,
    firstError,
    totalDurationMs: run.durationMs,
    artifactCount,
    retryCount,
    routeCount: run.routing.length + run.steps.filter((step) => step.routing).length,
  };
}

function appendStepNarrative(
  step: WorkflowStepEvidence,
  narrative: AgentNarrativeEvidence,
): WorkflowStepEvidence {
  return {
    ...step,
    narrative: [...step.narrative, stampNarrative(narrative, nowIso())],
  };
}

function attachGateToStep(
  step: WorkflowStepEvidence,
  gate: DeterministicGateResult,
): WorkflowStepEvidence {
  return {
    ...step,
    deterministicGates: [...step.deterministicGates, gate],
    verifications: [...step.verifications, ...gate.verifications],
    artifacts: [...step.artifacts, ...(gate.artifacts ?? [])],
  };
}

function deriveRunStatus(steps: WorkflowStepEvidence[]): RunStatus {
  if (steps.length === 0) return 'passed';

  const statuses = steps.map((step) => step.status);

  if (statuses.some((status) => status === 'timed_out')) return 'timed_out';
  if (statuses.some((status) => status === 'cancelled')) return 'cancelled';
  if (statuses.some((status) => status === 'failed')) return 'failed';
  if (statuses.some((status) => status === 'running')) return 'running';
  if (statuses.some((status) => status === 'pending')) return 'running';

  return 'passed';
}

function recordStepStatus(
  step: WorkflowStepEvidence,
  status: StepStatus,
  params: { at: string; message?: string; agentRole?: string },
): WorkflowStepEvidence {
  return {
    ...step,
    status,
    ...(status === 'running' && !step.startedAt ? { startedAt: params.at } : {}),
    history: [
      ...step.history,
      {
        status,
        at: params.at,
        ...(params.message ? { message: params.message } : {}),
        agentRole: params.agentRole ?? step.agentRole,
      },
    ],
  };
}

function normalizeRetry(
  step: WorkflowStepEvidence,
  event: Extract<StepEvent, { kind: 'retry' }>,
  recordedAt: string,
): WorkflowRetryEvidence {
  if ('retry' in event) {
    return {
      ...event.retry,
      stepId: event.retry.stepId || step.stepId,
    };
  }

  return {
    attempt: event.attempt,
    stepId: step.stepId,
    status: step.status,
    startedAt: step.startedAt,
    completedAt: recordedAt,
    error: event.error,
  };
}

function stampVerification(result: VerificationResult, recordedAt: string): VerificationResult {
  return {
    ...result,
    recordedAt: result.recordedAt ?? recordedAt,
  };
}

function stampRouting(
  route: WorkflowRoutingEvidence,
  recordedAt: string,
): WorkflowRoutingEvidence {
  return {
    ...route,
    recordedAt: route.recordedAt ?? recordedAt,
  };
}

function stampNarrative(
  narrative: AgentNarrativeEvidence,
  recordedAt: string,
): AgentNarrativeEvidence {
  return {
    ...narrative,
    recordedAt: narrative.recordedAt ?? recordedAt,
  };
}

function allVerificationsPassed(run: WorkflowRunEvidence): boolean {
  return run.steps.every((step) => step.verifications.every((verification) => verification.passed));
}

function allDeterministicGatesPassed(run: WorkflowRunEvidence): boolean {
  return [
    ...run.deterministicGates,
    ...run.steps.flatMap((step) => step.deterministicGates),
  ].every((gate) => gate.passed);
}

function nowIso(): string {
  return new Date().toISOString();
}
