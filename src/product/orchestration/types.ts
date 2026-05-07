export type MasterChildStatus =
  | 'pending'
  | 'running'
  | 'passed'
  | 'failed'
  | 'skipped'
  | 'blocked'
  | 'cancelled';

export type MasterExecutorClassification =
  | 'complete'
  | 'retry'
  | 'repair'
  | 'split'
  | 'blocked'
  | 'escalate';

export type ChildWorkflowGateKind =
  | 'signoff_artifact'
  | 'marker_string'
  | 'changed_files'
  | 'test_command'
  | 'dryrun_command';

export interface PlannerInput {
  title: string;
  description: string;
  desiredSlices?: ReadonlyArray<PlannerDesiredSlice>;
  constraints?: PlannerConstraints;
  targetFiles?: readonly string[];
  wavePrefix?: string;
  workflowSlug?: string;
}

export interface PlannerDesiredSlice {
  id?: string;
  title: string;
  summary?: string;
  targetFiles?: readonly string[];
  dependsOn?: readonly string[];
  parallelizable?: boolean;
}

export interface PlannerConstraints {
  maxChildren?: number;
  requiredGateMarkers?: readonly string[];
  forbiddenPaths?: readonly string[];
}

export interface MasterExecutionPlan {
  title: string;
  description: string;
  wavePrefix: string;
  workflowSlug?: string;
  targetFiles: readonly string[];
  children: readonly ChildWorkflowPlan[];
  ambiguous?: { reason: string };
}

export interface ChildWorkflowGate {
  id: string;
  kind: ChildWorkflowGateKind;
  description: string;
  required: boolean;
  artifactPath?: string;
  marker?: string;
  fileScope?: readonly string[];
  command?: string;
}

export interface ChildWorkflowPlan {
  id: string;
  title: string;
  summary?: string;
  workflowFilePath: string;
  targetFiles: readonly string[];
  allowedDirtyScope: readonly string[];
  dependsOn: readonly string[];
  parallelizable: boolean;
  wave: number;
  gates: readonly ChildWorkflowGate[];
  signoffArtifactPath: string;
  signoffMarker: string;
  validationCommands: readonly string[];
  retryPolicy: {
    maxAttempts: number;
    backoffMs: number;
  };
  timeoutMs: number;
  escalationRules: readonly string[];
  ambiguous?: { reason: string };
}

export type ChildRunner = (
  child: ChildWorkflowPlan,
  ctx: {
    attempt: number;
    resume: boolean;
    abortSignal: AbortSignal;
  },
) => Promise<ChildWorkflowRunResult>;

export interface ChildWorkflowRunResult {
  childId: string;
  status: MasterChildStatus;
  attempt: number;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  evidence: {
    signoffPresent: boolean;
    markerPresent: boolean;
    changedFiles: readonly string[];
    gateResults: readonly ChildWorkflowGateResult[];
    rawNotes?: string;
  };
  blockedReason?: string;
  errorMessage?: string;
}

export interface ChildWorkflowGateResult {
  gateId: string;
  kind: ChildWorkflowGate['kind'];
  passed: boolean;
  detail?: string;
}

export type MasterExecutorDecision =
  | { kind: 'complete' }
  | { kind: 'retry'; childId: string; reason: string }
  | { kind: 'repair'; childId: string; reason: string }
  | { kind: 'split'; childId: string; reason: string }
  | { kind: 'blocked'; childId: string; missing: readonly string[] }
  | { kind: 'escalate'; childId?: string; reason: string };

export interface MasterExecutionResult {
  plan: MasterExecutionPlan;
  childResults: ReadonlyArray<ChildWorkflowRunResult>;
  decision: MasterExecutorDecision;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  resumed: boolean;
}

export interface MasterExecutorOptions {
  maxConcurrency: number;
  resume: boolean;
  failurePolicy: 'stop' | 'continue';
  signoffArtifactReader?: (path: string) => Promise<string | null>;
  now?: () => Date;
  logger?: (event: { kind: string; childId?: string; message: string }) => void;
}
