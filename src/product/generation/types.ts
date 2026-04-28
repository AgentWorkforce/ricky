import type { ExecutionPreference, NormalizedWorkflowSpec } from '../spec-intake/types.js';
import type { SwarmPattern } from '../../shared/models/workflow-config.js';
import type { VerificationType } from '../../shared/models/workflow-evidence.js';

export type GenerationRiskLevel = 'low' | 'medium' | 'high';

export type GenerationIssueSeverity = 'error' | 'warning' | 'info';

export type GenerationIssueStage =
  | 'pattern_selection'
  | 'skill_loading'
  | 'template_resolution'
  | 'rendering'
  | 'validation'
  | 'routing';

export type PlannedCheckStage = 'dry_run' | 'pre_review' | 'post_fix' | 'final' | 'regression';

export type WorkflowExecutionTarget = 'local' | 'cloud';

export type SkillApplicationStage = 'generation_selection' | 'generation_loading' | 'generation_rendering';

export type SkillApplicationEffect = 'workflow_contract' | 'validation_gates' | 'metadata';

export interface GenerationIssue {
  severity: GenerationIssueSeverity;
  stage: GenerationIssueStage;
  code: string;
  message: string;
  field?: string;
  fixHint?: string;
  blocking: boolean;
}

export interface GenerationInput {
  spec: NormalizedWorkflowSpec;
  patternOverride?: SwarmPattern;
  skillOverrides?: string[];
  templateOverride?: string;
  dryRunEnabled?: boolean;
  artifactPath?: string;
}

export interface PatternDecision {
  pattern: SwarmPattern;
  reason: string;
  specSignals: string[];
  riskLevel: GenerationRiskLevel;
  overrideUsed: boolean;
}

export interface SkillDescriptor {
  name: string;
  path: string;
  loaded: boolean;
  applicable: boolean;
  prerequisitesMet: boolean;
  missingPrerequisites: string[];
}

export interface TemplateDescriptor {
  name: string;
  path: string;
  loaded: boolean;
  missingPrerequisites: string[];
}

export interface SkillApplicationEvidence {
  skillName: string;
  stage: SkillApplicationStage;
  effect: SkillApplicationEffect;
  behavior: 'generation_time_only';
  runtimeEmbodiment: false;
  evidence: string;
}

export interface SkillContext {
  skills: SkillDescriptor[];
  templates: TemplateDescriptor[];
  loadWarnings: string[];
  applicableSkillNames: string[];
  applicationEvidence: SkillApplicationEvidence[];
  issues: GenerationIssue[];
}

export interface WorkflowTask {
  id: string;
  name: string;
  agentRole: string;
  description: string;
  dependsOn: string[];
}

export interface DeterministicGate {
  name: string;
  command: string;
  verificationType: VerificationType;
  failOnError: boolean;
  dependsOn: string[];
  stage: PlannedCheckStage;
}

export interface PlannedCheck {
  name: string;
  command: string;
  verificationType: VerificationType;
  failOnError: boolean;
  stage: PlannedCheckStage;
}

export interface RenderedArtifact {
  fileName: string;
  artifactPath: string;
  workflowId: string;
  content: string;
  pattern: SwarmPattern;
  channel: string;
  taskCount: number;
  gateCount: number;
  tasks: WorkflowTask[];
  gates: DeterministicGate[];
  skillApplicationEvidence: SkillApplicationEvidence[];
}

export interface GenerationValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  issues: GenerationIssue[];
  hasDeterministicGates: boolean;
  hasReviewStage: boolean;
}

export interface WorkflowExecutionRoute {
  requestedPreference: ExecutionPreference;
  resolvedTarget: WorkflowExecutionTarget;
  invocationSurface: NormalizedWorkflowSpec['providerContext']['surface'];
  artifactDelivery: 'return_artifact' | 'write_local_file' | 'cloud_artifact';
  runnerCommand: string;
  reason: string;
}

export interface GenerationResult {
  success: boolean;
  artifact: RenderedArtifact | null;
  patternDecision: PatternDecision;
  skillContext: SkillContext;
  validation: GenerationValidationResult;
  dryRunCommand: string | null;
  deterministicValidationCommands: string[];
  plannedChecks: PlannedCheck[];
  executionRoute: WorkflowExecutionRoute;
  generatedAt: string;
}
