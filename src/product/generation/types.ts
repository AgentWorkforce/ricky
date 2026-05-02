import type { ExecutionPreference, NormalizedWorkflowSpec } from '../spec-intake/types.js';
import type { SwarmPattern } from '../../shared/models/workflow-config.js';
import type { VerificationType } from '../../shared/models/workflow-evidence.js';

export type GenerationRiskLevel = 'low' | 'medium' | 'high';

export type GenerationIssueSeverity = 'error' | 'warning' | 'info';

export type GenerationIssueStage =
  | 'pattern_selection'
  | 'skill_loading'
  | 'tool_selection'
  | 'template_resolution'
  | 'rendering'
  | 'validation'
  | 'refinement'
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
  refine?: false | { model?: string };
  workforcePersonaWriter?: false | {
    repoRoot?: string;
    workflowName?: string;
    targetMode?: WorkflowExecutionTarget;
    relevantFiles?: Array<{ path: string; content?: string }>;
    timeoutSeconds?: number;
    installSkills?: boolean;
    installRoot?: string;
    tier?: string;
    personaIntentCandidates?: readonly string[];
    resolver?: import('./workforce-persona-writer.js').WorkforcePersonaResolver;
  };
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
  confidence?: number;
  matchReason?: string;
  preferredRunner?: ToolRunner;
  preferredModel?: string;
}

export interface SkillMatchEvidence {
  trigger: string;
  source: 'description' | 'keyword' | 'filename' | 'fallback' | 'override';
  detail: string;
}

export interface SkillMatch {
  id: string;
  name: string;
  path: string;
  confidence: number;
  reason: string;
  evidence: SkillMatchEvidence[];
  updatedAt?: string;
  preferredRunner?: ToolRunner;
  preferredModel?: string;
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
  matches: SkillMatch[];
  issues: GenerationIssue[];
}

export type ToolRunner = 'claude' | 'codex' | 'cursor' | 'opencode' | '@agent-relay/sdk';

export interface ToolSelection {
  stepId: string;
  agent: string;
  runner: ToolRunner;
  model?: string;
  concurrency: number;
  rule: string;
}

export interface ToolSelectionContext {
  selections: ToolSelection[];
  defaultRunner: ToolRunner;
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
  environmentalPrerequisite?: string;
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
  skillMatches: SkillMatch[];
  toolSelections: ToolSelection[];
  artifactsDir: string;
}

export interface RefinementMetadata {
  model: string;
  input_tokens: number;
  output_tokens: number;
  edited_regions: string[];
  diff_size: number;
  validator_passed: boolean;
  applied: boolean;
  warning?: string;
}

export interface WorkforcePersonaGenerationMetadata {
  personaId: string;
  tier: string;
  harness: string;
  model: string;
  promptDigest: string;
  warnings: string[];
  runId: string | null;
  source: 'package' | 'local-dev';
  selectedIntent: string;
  responseFormat: 'structured-json' | 'fenced-artifact';
  outputPath: string;
  promptInputs: {
    workflowName: string;
    targetMode: WorkflowExecutionTarget;
    repoRoot: string;
    relevantFileCount: number;
  };
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
  toolSelection: ToolSelectionContext;
  refinement: RefinementMetadata | null;
  workforcePersona: WorkforcePersonaGenerationMetadata | null;
  validation: GenerationValidationResult;
  dryRunCommand: string | null;
  deterministicValidationCommands: string[];
  plannedChecks: PlannedCheck[];
  executionRoute: WorkflowExecutionRoute;
  generatedAt: string;
}
