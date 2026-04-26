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
  DeterministicGateResult,
  StepStatus,
  VerificationResult,
  WorkflowArtifactReference,
  WorkflowLogReference,
  WorkflowRetryEvidence,
  WorkflowRoutingEvidence,
} from '../../shared/models/workflow-evidence.js';

/** Events that can be appended to a step's evidence. */
export type StepEvent =
  | { kind: 'status_change'; status: StepStatus; message?: string; agentRole?: string }
  | { kind: 'verification'; result: VerificationResult }
  | { kind: 'deterministic_gate'; gate: DeterministicGateResult }
  | { kind: 'log'; ref: WorkflowLogReference }
  | { kind: 'artifact'; ref: WorkflowArtifactReference }
  | { kind: 'retry'; retry: WorkflowRetryEvidence }
  | { kind: 'retry'; attempt: number; error?: string }
  | { kind: 'routing'; route: WorkflowRoutingEvidence }
  | { kind: 'narrative'; narrative: AgentNarrativeEvidence }
  | { kind: 'error'; message: string };
