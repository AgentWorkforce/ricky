export type VerificationType = 'exit_code' | 'file_exists' | 'output_contains' | 'custom';

export interface VerificationResult {
  type: VerificationType;
  passed: boolean;
  expected: string;
  actual: string;
  command?: string;
  message?: string;
}

export type StepStatus = 'pending' | 'running' | 'passed' | 'failed' | 'skipped' | 'timed_out';

export type RunStatus = 'pending' | 'running' | 'passed' | 'failed' | 'timed_out';

export type WorkflowArtifactKind = 'file' | 'directory' | 'report' | 'other';

export interface WorkflowArtifactReference {
  path: string;
  kind?: WorkflowArtifactKind;
  description?: string;
  metadata?: Record<string, unknown>;
}

export type WorkflowLogStream = 'stdout' | 'stderr' | 'relay' | 'system';

export interface WorkflowLogReference {
  path?: string;
  channel?: string;
  messageId?: string;
  stream?: WorkflowLogStream;
  excerpt?: string;
}

export interface WorkflowStepHistoryEntry {
  status: StepStatus;
  at: string;
  message?: string;
  agentRole?: string;
}

export interface WorkflowRetryEvidence {
  attempt: number;
  stepId: string;
  status: StepStatus;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  error?: string;
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
  logs: WorkflowLogReference[];
  artifacts: WorkflowArtifactReference[];
  history?: WorkflowStepHistoryEntry[];
  retries?: WorkflowRetryEvidence[];
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
  artifacts?: WorkflowArtifactReference[];
  logs?: WorkflowLogReference[];
  finalSignoffPath?: string;
}
