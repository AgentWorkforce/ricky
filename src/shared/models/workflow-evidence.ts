export type VerificationType =
  | 'exit_code'
  | 'file_exists'
  | 'output_contains'
  | 'artifact_exists'
  | 'deterministic_gate'
  | 'routing_assertion'
  | 'custom';

export type StepStatus =
  | 'pending'
  | 'running'
  | 'passed'
  | 'failed'
  | 'skipped'
  | 'cancelled'
  | 'timed_out';

export type RunStatus =
  | 'pending'
  | 'running'
  | 'passed'
  | 'failed'
  | 'cancelled'
  | 'timed_out';

export type WorkflowArtifactKind = 'file' | 'directory' | 'report' | 'log' | 'other';

export type WorkflowLogStream = 'stdout' | 'stderr' | 'relay' | 'system';

export interface CommandEvidence {
  command: string;
  exitCode?: number;
  stdoutExcerpt?: string;
  stderrExcerpt?: string;
  outputExcerpt?: string;
}

export interface VerificationResult extends Partial<CommandEvidence> {
  type: VerificationType;
  passed: boolean;
  expected: string;
  actual: string;
  message?: string;
  recordedAt?: string;
}

export interface WorkflowArtifactReference {
  path: string;
  kind?: WorkflowArtifactKind;
  description?: string;
  metadata?: Record<string, unknown>;
}

export interface WorkflowLogReference {
  path?: string;
  channel?: string;
  messageId?: string;
  stream?: WorkflowLogStream;
  excerpt?: string;
}

export interface DeterministicGateResult extends Partial<CommandEvidence> {
  gateName: string;
  passed: boolean;
  verifications: VerificationResult[];
  artifacts?: WorkflowArtifactReference[];
  recordedAt: string;
}

export interface WorkflowRoutingEvidence {
  abstractionName?: string;
  abstractionPath?: string;
  requestedRoute?: string;
  resolvedRoute?: string;
  routedBy?: string;
  reason?: string;
  recordedAt: string;
}

export interface AgentNarrativeEvidence {
  agentRole?: string;
  summary: string;
  recordedAt: string;
}

export interface WorkflowStepHistoryEntry {
  status: StepStatus;
  at: string;
  message?: string;
  agentRole?: string;
}

export interface WorkflowRetryEvidence extends Partial<CommandEvidence> {
  attempt: number;
  stepId: string;
  status: StepStatus;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  error?: string;
  verifications?: VerificationResult[];
  artifacts?: WorkflowArtifactReference[];
}

export interface WorkflowStepEvidence {
  stepId: string;
  stepName: string;
  status: StepStatus;
  agentRole?: string;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  verifications: VerificationResult[];
  deterministicGates: DeterministicGateResult[];
  logs: WorkflowLogReference[];
  artifacts: WorkflowArtifactReference[];
  history: WorkflowStepHistoryEntry[];
  retries: WorkflowRetryEvidence[];
  narrative: AgentNarrativeEvidence[];
  routing?: WorkflowRoutingEvidence;
  error?: string;
  retryOf?: string;
}

export interface WorkflowRunEvidence {
  runId: string;
  workflowId: string;
  workflowName: string;
  status: RunStatus;
  steps: WorkflowStepEvidence[];
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  deterministicGates: DeterministicGateResult[];
  artifacts: WorkflowArtifactReference[];
  logs: WorkflowLogReference[];
  narrative: AgentNarrativeEvidence[];
  routing: WorkflowRoutingEvidence[];
  finalSignoffPath?: string;
}

/** Condensed digest of a WorkflowRunEvidence record. */
export interface EvidenceSummary {
  runId: string;
  workflowName: string;
  runStatus: RunStatus;
  totalSteps: number;
  passedSteps: number;
  failedSteps: number;
  skippedSteps: number;
  cancelledSteps: number;
  timedOutSteps: number;
  pendingSteps: number;
  runningSteps: number;
  allVerificationsPassed: boolean;
  allDeterministicGatesPassed: boolean;
  failedStepIds: string[];
  firstError: string | undefined;
  totalDurationMs: number | undefined;
  artifactCount: number;
  retryCount: number;
  routeCount: number;
}
