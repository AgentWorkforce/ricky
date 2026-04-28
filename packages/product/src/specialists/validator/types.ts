import type {
  FailureTaxonomyCategory,
  RecoveryRecommendation,
} from '@ricky/runtime/diagnostics/failure-diagnosis';

export type FindingSeverity = 'error' | 'warning' | 'info';

export interface FindingLocation {
  path?: string;
  line?: number;
  column?: number;
  snippet?: string;
}

export interface CommandResult {
  command: string;
  exitCode: number;
  stdout?: string;
  stderr?: string;
  durationMs?: number;
}

export type StructuralCheckName =
  | 'workflow_factory'
  | 'relay_shape'
  | 'dedicated_channel'
  | 'explicit_pattern'
  | 'max_concurrency'
  | 'timeout'
  | 'deterministic_steps'
  | 'deterministic_gates'
  | 'review_stage'
  | 'deliverables'
  | 'non_goals'
  | 'verification_language'
  | 'initial_soft_gate'
  | 'final_hard_gate'
  | 'eighty_to_hundred_loop'
  | 'build_typecheck_test_gate'
  | 'regression_gate'
  | 'run_cwd'
  | 'stale_prefix_review_gate'
  | 'regression_allowlist_scope';

export interface StructuralFinding {
  check: StructuralCheckName;
  passed: boolean;
  severity: FindingSeverity;
  message: string;
  blocking: boolean;
  location?: FindingLocation;
  path?: string;
  fixHint?: string;
}

export type ProofLoopPhase =
  | 'initial_soft_run'
  | 'fix_loop'
  | 'final_gate'
  | 'build_typecheck_gate'
  | 'regression_gate';

export interface ProofLoopStep {
  phase: ProofLoopPhase;
  passed: boolean;
  severity: FindingSeverity;
  blocking: boolean;
  message: string;
  commandResult?: CommandResult;
  recovery?: ValidationRecovery;
  fixHint?: string;
}

export interface ValidationRecovery {
  taxonomyCategory: FailureTaxonomyCategory;
  recommendation: RecoveryRecommendation;
  operatorAction: string;
  rationale: string;
}

export interface ProofLoopConfig {
  requireDryRun: boolean;
  requireBuild: boolean;
  requireTest: boolean;
  requireRegression: boolean;
  maxFixAttempts: number;
}

export const DEFAULT_PROOF_LOOP_CONFIG: ProofLoopConfig = {
  requireDryRun: true,
  requireBuild: true,
  requireTest: false,
  requireRegression: true,
  maxFixAttempts: 3,
};

export interface ValidatorInput {
  workflowText: string;
  workflowId: string;
  workflowName: string;
  workflowPath?: string;
  dryRunResult?: CommandResult;
  finalDryRunResult?: CommandResult;
  buildResult?: CommandResult;
  testResult?: CommandResult;
  regressionResults?: CommandResult[];
  fixAttempts?: number;
  proofLoopConfig?: Partial<ProofLoopConfig>;
  validatedAt?: string;
}

export type SignoffVerdict = 'approved' | 'conditional' | 'rejected';

export interface ValidatorResult {
  workflowId: string;
  workflowName: string;
  structuralFindings: StructuralFinding[];
  proofLoopSteps: ProofLoopStep[];
  signoff: SignoffVerdict;
  ready: boolean;
  summary: string;
  allStructuralChecksPassed: boolean;
  allProofLoopStepsPassed: boolean;
  blockingFindings: StructuralFinding[];
  warningFindings: StructuralFinding[];
  blockingProofSteps: ProofLoopStep[];
  warningProofSteps: ProofLoopStep[];
  validatedAt: string;
}
