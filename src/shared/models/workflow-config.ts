export type WorkflowExecutionMode = 'local' | 'cloud' | 'both';

export type SwarmPattern = 'supervisor' | 'dag' | 'pipeline';

export type OnErrorStrategy = 'fail' | 'continue' | 'retry';

export type ValidationPolicyMode = 'strict' | 'standard' | 'permissive';

export interface WorkflowValidationPolicy {
  mode: ValidationPolicyMode;
  requireFileExistsGate: boolean;
  requireTypecheck: boolean;
  requireReview: boolean;
  allowUntrackedFiles: boolean;
}

export interface WorkflowTimeoutSettings {
  runTimeoutMs: number;
  stepTimeoutMs?: number;
}

export type RetryableStepStatus = 'failed' | 'timed_out';

export interface WorkflowRetrySettings {
  maxAttempts: number;
  backoffMs: number;
  retryOn: RetryableStepStatus[];
}

export interface TeamMember {
  role: string;
  model?: string;
  description?: string;
}

export interface WorkflowConfig {
  workflowId: string;
  workflowName: string;
  mode: WorkflowExecutionMode;
  channel: string;
  pattern: SwarmPattern;
  team: TeamMember[];
  maxConcurrency: number;
  timeout: WorkflowTimeoutSettings;
  retry: WorkflowRetrySettings;
  validation: WorkflowValidationPolicy;
  onError: OnErrorStrategy;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export type RickyWorkflowConfig = WorkflowConfig;

export interface WorkflowFileTarget {
  path: string;
  description?: string;
  tracked: boolean;
}

export interface WorkflowSpec {
  config: WorkflowConfig;
  description: string;
  fileTargets: WorkflowFileTarget[];
  nonGoals: string[];
  verificationCommands: string[];
}

export type RickyWorkflowSpec = WorkflowSpec;
