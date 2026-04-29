// Re-export all shared evidence types as the single import path for consumers.
export type {
  VerificationType,
  StepStatus,
  RunStatus,
  WorkflowArtifactKind,
  WorkflowLogStream,
  CommandEvidence,
  VerificationResult,
  WorkflowArtifactReference,
  WorkflowLogReference,
  DeterministicGateResult,
  WorkflowRoutingEvidence,
  AgentNarrativeEvidence,
  WorkflowStepHistoryEntry,
  WorkflowRetryEvidence,
  WorkflowStepEvidence,
  WorkflowRunEvidence,
  EvidenceSummary,
} from '../../shared/models/workflow-evidence.js';

import type {
  AgentNarrativeEvidence,
  CommandEvidence,
  DeterministicGateResult,
  EvidenceSummary,
  RunStatus,
  StepStatus,
  VerificationResult,
  WorkflowArtifactReference,
  WorkflowLogReference,
  WorkflowRetryEvidence,
  WorkflowRoutingEvidence,
  WorkflowStepEvidence,
} from '../../shared/models/workflow-evidence.js';

export const STEP_STATUSES = [
  'pending',
  'running',
  'passed',
  'failed',
  'skipped',
  'cancelled',
  'timed_out',
] as const satisfies readonly StepStatus[];

export const RUN_STATUSES = [
  'pending',
  'running',
  'passed',
  'failed',
  'cancelled',
  'timed_out',
] as const satisfies readonly RunStatus[];

export const TERMINAL_STEP_STATUSES = [
  'passed',
  'failed',
  'skipped',
  'cancelled',
  'timed_out',
] as const satisfies readonly StepStatus[];

export const TERMINAL_RUN_STATUSES = [
  'passed',
  'failed',
  'cancelled',
  'timed_out',
] as const satisfies readonly RunStatus[];

export type TerminalStepStatus = (typeof TERMINAL_STEP_STATUSES)[number];
export type TerminalRunStatus = (typeof TERMINAL_RUN_STATUSES)[number];

export type EvidenceFailureKind =
  | 'none'
  | 'timeout'
  | 'cancelled'
  | 'routing'
  | 'deterministic_gate'
  | 'verification'
  | 'retry_exhaustion'
  | 'step_failed'
  | 'unknown';

export interface EvidenceCommandReference extends Partial<CommandEvidence> {
  source: 'verification' | 'deterministic_gate' | 'retry';
  stepId?: string;
  stepName?: string;
  gateName?: string;
  verificationType?: VerificationResult['type'];
  attempt?: number;
  status?: StepStatus;
  passed?: boolean;
  recordedAt?: string;
}

export interface EvidenceArtifactPath {
  path: string;
  kind?: WorkflowArtifactReference['kind'];
  description?: string;
  stepId?: string;
  stepName?: string;
  gateName?: string;
}

export interface EvidenceOutputSnippet {
  source: EvidenceCommandReference['source'] | 'log' | 'step_error';
  text: string;
  stream?: WorkflowLogReference['stream'];
  stepId?: string;
  stepName?: string;
  gateName?: string;
  attempt?: number;
  recordedAt?: string;
}

export interface DeterministicGateAudit {
  scope: 'run' | 'step';
  stepId?: string;
  stepName?: string;
  gateName: string;
  passed: boolean;
  command?: string;
  exitCode?: number;
  outputSnippets: EvidenceOutputSnippet[];
  verificationCount: number;
  failedVerificationMessages: string[];
  artifacts: EvidenceArtifactPath[];
  recordedAt: string;
}

export interface RoutingAuditRecord {
  scope: 'run' | 'step';
  stepId?: string;
  stepName?: string;
  abstractionName?: string;
  abstractionPath?: string;
  requestedRoute?: string;
  resolvedRoute?: string;
  routedBy?: string;
  reason?: string;
  recordedAt: string;
}

export interface NarrativeAuditRecord {
  scope: 'run' | 'step';
  stepId?: string;
  stepName?: string;
  agentRole?: string;
  summary: string;
  recordedAt: string;
}

export interface FixLoopAttemptEvidence {
  stepId: string;
  stepName?: string;
  attempt: number;
  status: StepStatus;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  error?: string;
  command?: string;
  exitCode?: number;
  outputSnippets: EvidenceOutputSnippet[];
  verificationCommands: EvidenceCommandReference[];
  artifacts: EvidenceArtifactPath[];
}

export interface EvidenceOutcome {
  runId: string;
  workflowName: string;
  status: RunStatus;
  terminal: boolean;
  passed: boolean;
  failureKind: EvidenceFailureKind;
  failureMessage?: string;
  failedStepIds: string[];
  timedOutStepIds: string[];
  cancelledStepIds: string[];
  pendingStepIds: string[];
  runningStepIds: string[];
  commands: EvidenceCommandReference[];
  outputSnippets: EvidenceOutputSnippet[];
  artifacts: EvidenceArtifactPath[];
  deterministicGates: DeterministicGateAudit[];
  fixLoopAttempts: FixLoopAttemptEvidence[];
  routing: RoutingAuditRecord[];
  narrative: NarrativeAuditRecord[];
  summary: EvidenceSummary;
}

export interface VerificationCaptureParams extends Partial<CommandEvidence> {
  type: VerificationResult['type'];
  passed: boolean;
  expected: string;
  actual: string;
  message?: string;
  recordedAt?: string;
}

export interface SimpleRetryEvent {
  kind: 'retry';
  attempt: number;
  status?: StepStatus;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  error?: string;
  command?: string;
  exitCode?: number;
  stdoutExcerpt?: string;
  stderrExcerpt?: string;
  outputExcerpt?: string;
  verifications?: VerificationResult[];
  artifacts?: WorkflowArtifactReference[];
}

export interface FullRetryEvent {
  kind: 'retry';
  retry: WorkflowRetryEvidence;
}

/** Events that can be appended to a step's evidence. */
export type StepEvent =
  | { kind: 'status_change'; status: StepStatus; message?: string; agentRole?: string }
  | { kind: 'verification'; result: VerificationResult }
  | { kind: 'deterministic_gate'; gate: DeterministicGateResult }
  | { kind: 'log'; ref: WorkflowLogReference }
  | { kind: 'artifact'; ref: WorkflowArtifactReference }
  | FullRetryEvent
  | SimpleRetryEvent
  | { kind: 'routing'; route: WorkflowRoutingEvidence }
  | { kind: 'narrative'; narrative: AgentNarrativeEvidence }
  | { kind: 'error'; message: string };

export type EvidenceBearingStep = Pick<
  WorkflowStepEvidence,
  | 'stepId'
  | 'stepName'
  | 'status'
  | 'verifications'
  | 'deterministicGates'
  | 'logs'
  | 'artifacts'
  | 'retries'
  | 'narrative'
  | 'routing'
  | 'error'
>;
