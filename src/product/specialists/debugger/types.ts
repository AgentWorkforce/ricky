import type {
  Confidence,
  EvidenceSignal,
  FailureClass,
  FailureClassification,
} from '../../../runtime/failure/types.js';
import type {
  RuntimePreflightIssue,
  RuntimePreflightResult,
} from '../../../runtime/diagnostics/index.js';
import type { WorkflowRunEvidence } from '../../../shared/models/workflow-evidence.js';

export interface DebuggerInput {
  evidence: WorkflowRunEvidence;
  classification?: FailureClassification;
  environmentPreflight?: RuntimePreflightResult;
  repairPolicy?: Partial<RepairPolicy>;
  analyzedAt?: string;
}

export interface RepairPolicy {
  allowDirectRepair: boolean;
  maxFilesTouch: number;
  directRepairBlocklist: FailureClass[];
  allowEnvironmentFixes: boolean;
  minimumDirectRepairConfidence: Confidence;
}

export const DEFAULT_REPAIR_POLICY: RepairPolicy = {
  allowDirectRepair: true,
  maxFilesTouch: 3,
  directRepairBlocklist: ['deadlock', 'unknown'],
  allowEnvironmentFixes: false,
  minimumDirectRepairConfidence: 'medium',
};

export type WorkflowCauseCategory =
  | 'missing_deterministic_gate'
  | 'wrong_pattern_choice'
  | 'oversized_agent_step'
  | 'missing_file_materialization'
  | 'brittle_grep_gate'
  | 'environment_prerequisite'
  | 'agent_drift'
  | 'step_contract_violation'
  | 'workflow_structure'
  | 'timeout_budget'
  | 'retry_exhaustion'
  | 'unknown';

export interface WorkflowCause {
  category: WorkflowCauseCategory;
  summary: string;
  affectedStepIds: string[];
  supportingSignals: EvidenceSignal[];
  confidence: Confidence;
  filesLikelyTouched: string[];
  ambiguousProductIntent: boolean;
}

export interface Diagnosis {
  primaryCause: WorkflowCause;
  secondaryCauses: WorkflowCause[];
  runtimeClassification: FailureClassification;
  explanation: string;
}

export type FixAction =
  | 'retry_step'
  | 'retry_with_smaller_scope'
  | 'fix_verification'
  | 'fix_step_task'
  | 'add_deterministic_gate'
  | 'add_missing_artifact'
  | 'replace_brittle_grep'
  | 'fix_environment'
  | 'replace_validation_command'
  | 'wait_for_active_run'
  | 'change_pattern'
  | 'restructure_workflow'
  | 'escalate'
  | 'abort';

export interface VerificationPlan {
  commands: string[];
  expectations: string[];
  deterministic: boolean;
}

export interface FixScope {
  targetStepIds: string[];
  filesLikelyTouched: string[];
  maxFilesToTouch: number;
  bounded: boolean;
  rationale: string;
}

export interface FixStep {
  action: FixAction;
  description: string;
  targetStepId: string | null;
  filesToTouch: string[];
  scope: FixScope;
  confidence: Confidence;
  verificationPlan: VerificationPlan;
}

export interface FixRecommendation {
  steps: FixStep[];
  directRepairEligible: boolean;
  directRepairRefusalReason?: string;
  preflightIssues?: RuntimePreflightIssue[];
  confidence: Confidence;
  scope: FixScope;
  summary: string;
}

export type RepairMode = 'direct' | 'guided' | 'manual';

export interface DebuggerResult {
  diagnosis: Diagnosis;
  recommendation: FixRecommendation;
  repairMode: RepairMode;
  summary: string;
  analyzedAt: string;
}
