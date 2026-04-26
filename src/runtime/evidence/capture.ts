import type {
  AgentNarrativeEvidence,
  DeterministicGateResult,
  DeterministicGateAudit,
  EvidenceArtifactPath,
  EvidenceCommandReference,
  EvidenceFailureKind,
  EvidenceOutputSnippet,
  EvidenceOutcome,
  EvidenceSummary,
  FixLoopAttemptEvidence,
  NarrativeAuditRecord,
  RoutingAuditRecord,
  RunStatus,
  StepEvent,
  StepStatus,
  VerificationCaptureParams,
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

export interface CompleteRunParams {
  status?: RunStatus;
  finalSignoffPath?: string;
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

/** Create a verification record with command evidence and a timestamp. */
export function createVerificationResult(params: VerificationCaptureParams): VerificationResult {
  return stampVerification(params, params.recordedAt ?? nowIso());
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

/** Attach an artifact reference produced at run scope. */
export function attachRunArtifact(
  run: WorkflowRunEvidence,
  artifact: WorkflowArtifactReference,
): WorkflowRunEvidence {
  return {
    ...run,
    artifacts: [...run.artifacts, artifact],
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
export function completeRun(
  run: WorkflowRunEvidence,
  params: CompleteRunParams = {},
): WorkflowRunEvidence {
  const derivedStatus = params.status ?? deriveRunStatus(run.steps);

  // Only stamp completion metadata when the derived status is terminal.
  // A run with pending/running steps should not carry completedAt/durationMs
  // because downstream analytics uses those fields to distinguish active from
  // terminal runs.
  if (derivedStatus === 'running' || derivedStatus === 'pending') {
    return {
      ...run,
      status: derivedStatus,
      ...(params.finalSignoffPath ? { finalSignoffPath: params.finalSignoffPath } : {}),
    };
  }

  const completedAt = nowIso();
  const durationMs = new Date(completedAt).getTime() - new Date(run.startedAt).getTime();

  return {
    ...run,
    status: derivedStatus,
    completedAt,
    durationMs,
    ...(params.finalSignoffPath ? { finalSignoffPath: params.finalSignoffPath } : {}),
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

/** Build the structured runtime view used for reports, fix loops, and audit trails. */
export function buildEvidenceOutcome(run: WorkflowRunEvidence): EvidenceOutcome {
  const summary = summarizeEvidence(run);
  const deterministicGates = auditDeterministicGates(run);
  const commands = collectEvidenceCommands(run);
  const outputSnippets = collectOutputSnippets(run);
  const artifacts = collectArtifactPaths(run);
  const fixLoopAttempts = collectFixLoopAttempts(run);
  const routing = auditRoutingEvidence(run);
  const narrative = auditNarrativeEvidence(run);

  return {
    runId: run.runId,
    workflowName: run.workflowName,
    status: run.status,
    terminal: isTerminalRunStatus(run.status),
    passed: run.status === 'passed',
    failureKind: classifyEvidenceFailureKind(run, summary, deterministicGates),
    failureMessage: firstFailureMessage(run, deterministicGates),
    failedStepIds: summary.failedStepIds,
    timedOutStepIds: stepIdsWithStatus(run, 'timed_out'),
    cancelledStepIds: stepIdsWithStatus(run, 'cancelled'),
    pendingStepIds: stepIdsWithStatus(run, 'pending'),
    runningStepIds: stepIdsWithStatus(run, 'running'),
    commands,
    outputSnippets,
    artifacts,
    deterministicGates,
    fixLoopAttempts,
    routing,
    narrative,
    summary,
  };
}

/** Collect verification, gate, and retry commands with exit codes and snippets. */
export function collectEvidenceCommands(run: WorkflowRunEvidence): EvidenceCommandReference[] {
  const commands: EvidenceCommandReference[] = [];

  for (const gate of run.deterministicGates) {
    if (hasCommandEvidence(gate)) {
      commands.push(commandFromGate(gate));
    }
  }

  for (const step of run.steps) {
    for (const verification of step.verifications) {
      if (hasCommandEvidence(verification)) {
        commands.push(commandFromVerification(verification, step));
      }
    }

    for (const gate of step.deterministicGates) {
      if (hasCommandEvidence(gate)) {
        commands.push(commandFromGate(gate, step));
      }
    }

    for (const retry of step.retries) {
      if (hasCommandEvidence(retry)) {
        commands.push(commandFromRetry(retry, step));
      }
    }
  }

  return commands;
}

/** Collect produced artifact paths from run, step, and deterministic gate evidence. */
export function collectArtifactPaths(run: WorkflowRunEvidence): EvidenceArtifactPath[] {
  return [
    ...run.artifacts.map((artifact) => artifactPath(artifact)),
    ...run.deterministicGates.flatMap((gate) =>
      (gate.artifacts ?? []).map((artifact) => artifactPath(artifact, undefined, gate.gateName)),
    ),
    ...run.steps.flatMap((step) => [
      ...step.artifacts.map((artifact) => artifactPath(artifact, step)),
      ...step.deterministicGates.flatMap((gate) =>
        (gate.artifacts ?? []).map((artifact) => artifactPath(artifact, step, gate.gateName)),
      ),
      ...step.retries.flatMap((retry) =>
        (retry.artifacts ?? []).map((artifact) => artifactPath(artifact, step)),
      ),
    ]),
  ];
}

/** Collect retry attempts as fix-loop evidence with commands, outputs, and artifacts intact. */
export function collectFixLoopAttempts(run: WorkflowRunEvidence): FixLoopAttemptEvidence[] {
  return run.steps.flatMap((step) =>
    step.retries.map((retry) => ({
      stepId: retry.stepId || step.stepId,
      stepName: step.stepName,
      attempt: retry.attempt,
      status: retry.status,
      startedAt: retry.startedAt,
      completedAt: retry.completedAt,
      durationMs: retry.durationMs,
      error: retry.error,
      command: retry.command,
      exitCode: retry.exitCode,
      outputSnippets: snippetsFromCommand(retry, {
        source: 'retry',
        stepId: retry.stepId || step.stepId,
        stepName: step.stepName,
        attempt: retry.attempt,
      }),
      verificationCommands: (retry.verifications ?? [])
        .filter(hasCommandEvidence)
        .map((verification) => commandFromVerification(verification, step, retry.attempt)),
      artifacts: (retry.artifacts ?? []).map((artifact) => artifactPath(artifact, step)),
    })),
  );
}

/** Audit deterministic gates independently from narrative agent output. */
export function auditDeterministicGates(run: WorkflowRunEvidence): DeterministicGateAudit[] {
  return [
    ...run.deterministicGates.map((gate) => gateAudit(gate, 'run')),
    ...run.steps.flatMap((step) =>
      step.deterministicGates.map((gate) => gateAudit(gate, 'step', step)),
    ),
  ];
}

/** Audit workflow abstraction and execution routing decisions. */
export function auditRoutingEvidence(run: WorkflowRunEvidence): RoutingAuditRecord[] {
  return [
    ...run.routing.map((route) => routingAudit(route, 'run')),
    ...run.steps.flatMap((step) =>
      step.routing ? [routingAudit(step.routing, 'step', step)] : [],
    ),
  ];
}

/** Audit narrative separately so reports can include it without trusting it as a gate. */
export function auditNarrativeEvidence(run: WorkflowRunEvidence): NarrativeAuditRecord[] {
  return [
    ...run.narrative.map((narrative) => narrativeAudit(narrative, 'run')),
    ...run.steps.flatMap((step) =>
      step.narrative.map((narrative) => narrativeAudit(narrative, 'step', step)),
    ),
  ];
}

/** Collect relevant command, log, and step error snippets for reporting. */
export function collectOutputSnippets(run: WorkflowRunEvidence): EvidenceOutputSnippet[] {
  return [
    ...snippetsFromLogs(run.logs),
    ...run.deterministicGates.flatMap((gate) =>
      snippetsFromCommand(gate, { source: 'deterministic_gate', gateName: gate.gateName }),
    ),
    ...run.steps.flatMap((step) => [
      ...(step.error ? [{
        source: 'step_error' as const,
        text: step.error,
        stepId: step.stepId,
        stepName: step.stepName,
      }] : []),
      ...snippetsFromLogs(step.logs, step),
      ...step.verifications.flatMap((verification) =>
        snippetsFromCommand(verification, {
          source: 'verification',
          stepId: step.stepId,
          stepName: step.stepName,
          recordedAt: verification.recordedAt,
        }),
      ),
      ...step.deterministicGates.flatMap((gate) =>
        snippetsFromCommand(gate, {
          source: 'deterministic_gate',
          stepId: step.stepId,
          stepName: step.stepName,
          gateName: gate.gateName,
          recordedAt: gate.recordedAt,
        }),
      ),
      ...step.retries.flatMap((retry) =>
        snippetsFromCommand(retry, {
          source: 'retry',
          stepId: retry.stepId || step.stepId,
          stepName: step.stepName,
          attempt: retry.attempt,
        }),
      ),
    ]),
  ];
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

function classifyEvidenceFailureKind(
  run: WorkflowRunEvidence,
  summary: EvidenceSummary,
  gates: DeterministicGateAudit[],
): EvidenceFailureKind {
  if (run.status === 'passed') return 'none';
  if (run.status === 'pending' || run.status === 'running') return 'unknown';
  if (run.status === 'timed_out' || summary.timedOutSteps > 0) return 'timeout';
  if (run.status === 'cancelled' || summary.cancelledSteps > 0) return 'cancelled';
  if (hasFailedRoutingAssertion(run)) return 'routing';
  if (gates.some((gate) => !gate.passed)) return 'deterministic_gate';
  if (!summary.allVerificationsPassed) return 'verification';
  if (summary.retryCount >= 5) return 'retry_exhaustion';
  if (summary.failedSteps > 0) return 'step_failed';
  return 'unknown';
}

function firstFailureMessage(
  run: WorkflowRunEvidence,
  gates: DeterministicGateAudit[],
): string | undefined {
  for (const step of run.steps) {
    if (step.error) return step.error;
  }

  for (const gate of gates) {
    const message = gate.failedVerificationMessages[0];
    if (message) return message;
  }

  for (const step of run.steps) {
    const failed = step.verifications.find((verification) => !verification.passed);
    if (failed?.message) return failed.message;
  }

  return undefined;
}

function hasFailedRoutingAssertion(run: WorkflowRunEvidence): boolean {
  return run.steps.some((step) =>
    step.verifications.some((verification) =>
      verification.type === 'routing_assertion' && !verification.passed,
    ) || step.deterministicGates.some((gate) =>
      gate.verifications.some((verification) =>
        verification.type === 'routing_assertion' && !verification.passed,
      ),
    ),
  ) || run.deterministicGates.some((gate) =>
    gate.verifications.some((verification) =>
      verification.type === 'routing_assertion' && !verification.passed,
    ),
  );
}

function stepIdsWithStatus(run: WorkflowRunEvidence, status: StepStatus): string[] {
  return run.steps.filter((step) => step.status === status).map((step) => step.stepId);
}

function isTerminalRunStatus(status: RunStatus): boolean {
  return status !== 'pending' && status !== 'running';
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
    status: event.status ?? step.status,
    startedAt: event.startedAt ?? step.startedAt,
    completedAt: event.completedAt ?? recordedAt,
    durationMs: event.durationMs,
    error: event.error,
    command: event.command,
    exitCode: event.exitCode,
    stdoutExcerpt: event.stdoutExcerpt,
    stderrExcerpt: event.stderrExcerpt,
    outputExcerpt: event.outputExcerpt,
    verifications: event.verifications?.map((verification) =>
      stampVerification(verification, recordedAt),
    ),
    artifacts: event.artifacts,
  };
}

function hasCommandEvidence(
  evidence: Partial<{
    command: string;
    exitCode: number;
    stdoutExcerpt: string;
    stderrExcerpt: string;
    outputExcerpt: string;
  }>,
): boolean {
  return Boolean(
    evidence.command ||
      typeof evidence.exitCode === 'number' ||
      evidence.stdoutExcerpt ||
      evidence.stderrExcerpt ||
      evidence.outputExcerpt,
  );
}

function commandFromVerification(
  verification: VerificationResult,
  step: WorkflowStepEvidence,
  attempt?: number,
): EvidenceCommandReference {
  return {
    source: 'verification',
    stepId: step.stepId,
    stepName: step.stepName,
    verificationType: verification.type,
    attempt,
    passed: verification.passed,
    recordedAt: verification.recordedAt,
    command: verification.command,
    exitCode: verification.exitCode,
    stdoutExcerpt: verification.stdoutExcerpt,
    stderrExcerpt: verification.stderrExcerpt,
    outputExcerpt: verification.outputExcerpt,
  };
}

function commandFromGate(
  gate: DeterministicGateResult,
  step?: WorkflowStepEvidence,
): EvidenceCommandReference {
  return {
    source: 'deterministic_gate',
    stepId: step?.stepId,
    stepName: step?.stepName,
    gateName: gate.gateName,
    passed: gate.passed,
    recordedAt: gate.recordedAt,
    command: gate.command,
    exitCode: gate.exitCode,
    stdoutExcerpt: gate.stdoutExcerpt,
    stderrExcerpt: gate.stderrExcerpt,
    outputExcerpt: gate.outputExcerpt,
  };
}

function commandFromRetry(
  retry: WorkflowRetryEvidence,
  step: WorkflowStepEvidence,
): EvidenceCommandReference {
  return {
    source: 'retry',
    stepId: retry.stepId || step.stepId,
    stepName: step.stepName,
    attempt: retry.attempt,
    status: retry.status,
    command: retry.command,
    exitCode: retry.exitCode,
    stdoutExcerpt: retry.stdoutExcerpt,
    stderrExcerpt: retry.stderrExcerpt,
    outputExcerpt: retry.outputExcerpt,
  };
}

function artifactPath(
  artifact: WorkflowArtifactReference,
  step?: WorkflowStepEvidence,
  gateName?: string,
): EvidenceArtifactPath {
  return {
    path: artifact.path,
    kind: artifact.kind,
    description: artifact.description,
    stepId: step?.stepId,
    stepName: step?.stepName,
    gateName,
  };
}

function gateAudit(
  gate: DeterministicGateResult,
  scope: 'run' | 'step',
  step?: WorkflowStepEvidence,
): DeterministicGateAudit {
  return {
    scope,
    stepId: step?.stepId,
    stepName: step?.stepName,
    gateName: gate.gateName,
    passed: gate.passed,
    command: gate.command,
    exitCode: gate.exitCode,
    outputSnippets: snippetsFromCommand(gate, {
      source: 'deterministic_gate',
      stepId: step?.stepId,
      stepName: step?.stepName,
      gateName: gate.gateName,
      recordedAt: gate.recordedAt,
    }),
    verificationCount: gate.verifications.length,
    failedVerificationMessages: gate.verifications
      .filter((verification) => !verification.passed)
      .map((verification) => verification.message ?? verification.actual)
      .filter((message): message is string => Boolean(message)),
    artifacts: (gate.artifacts ?? []).map((artifact) => artifactPath(artifact, step, gate.gateName)),
    recordedAt: gate.recordedAt,
  };
}

function routingAudit(
  route: WorkflowRoutingEvidence,
  scope: 'run' | 'step',
  step?: WorkflowStepEvidence,
): RoutingAuditRecord {
  return {
    scope,
    stepId: step?.stepId,
    stepName: step?.stepName,
    abstractionName: route.abstractionName,
    abstractionPath: route.abstractionPath,
    requestedRoute: route.requestedRoute,
    resolvedRoute: route.resolvedRoute,
    routedBy: route.routedBy,
    reason: route.reason,
    recordedAt: route.recordedAt,
  };
}

function narrativeAudit(
  narrative: AgentNarrativeEvidence,
  scope: 'run' | 'step',
  step?: WorkflowStepEvidence,
): NarrativeAuditRecord {
  return {
    scope,
    stepId: step?.stepId,
    stepName: step?.stepName,
    agentRole: narrative.agentRole,
    summary: narrative.summary,
    recordedAt: narrative.recordedAt,
  };
}

function snippetsFromLogs(
  logs: WorkflowLogReference[],
  step?: WorkflowStepEvidence,
): EvidenceOutputSnippet[] {
  return logs.flatMap((log) =>
    log.excerpt
      ? [{
          source: 'log' as const,
          text: log.excerpt,
          stream: log.stream,
          stepId: step?.stepId,
          stepName: step?.stepName,
        }]
      : [],
  );
}

function snippetsFromCommand(
  command: Partial<{
    stdoutExcerpt: string;
    stderrExcerpt: string;
    outputExcerpt: string;
  }>,
  base: Omit<EvidenceOutputSnippet, 'text'>,
): EvidenceOutputSnippet[] {
  return [
    command.stdoutExcerpt
      ? { ...base, text: command.stdoutExcerpt, stream: 'stdout' as const }
      : undefined,
    command.stderrExcerpt
      ? { ...base, text: command.stderrExcerpt, stream: 'stderr' as const }
      : undefined,
    command.outputExcerpt
      ? { ...base, text: command.outputExcerpt }
      : undefined,
  ].filter((snippet): snippet is EvidenceOutputSnippet => Boolean(snippet));
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
