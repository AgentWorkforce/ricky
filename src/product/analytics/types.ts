import type { FailureClass } from '../../runtime/failure/types.js';
import type { SwarmPattern, WorkflowConfig } from '../../shared/models/workflow-config.js';
import type { WorkflowRunEvidence } from '../../shared/models/workflow-evidence.js';

export interface WorkflowShapeStep {
  id: string;
  name?: string;
  dependsOn?: string[];
}

export interface WorkflowShape {
  steps: WorkflowShapeStep[];
}

export interface WorkflowRunRecord {
  evidence: WorkflowRunEvidence;
  config?: Partial<WorkflowConfig>;
  workflowShape?: WorkflowShape;
}

export interface HealthAnalysisInput {
  runs: WorkflowRunRecord[];
  since?: string;
  until?: string;
}

export type FindingCategory =
  | 'failure_distribution'
  | 'retry_rate'
  | 'timeout_rate'
  | 'weak_verification'
  | 'missing_hard_gate'
  | 'oversized_step'
  | 'pattern_choice'
  | 'flaky_workflow'
  | 'duration_outlier';

export type FindingSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export interface HealthMetric {
  name: string;
  value: number;
  unit: string;
  threshold?: number;
}

export interface HealthSignal {
  source: string;
  message: string;
  runId?: string;
  stepId?: string;
  value?: number;
  threshold?: number;
}

export interface HealthFinding {
  id: string;
  category: FindingCategory;
  severity: FindingSeverity;
  workflowName: string;
  title: string;
  summary: string;
  affectedRunIds: string[];
  evidence: HealthSignal[];
  metric?: HealthMetric;
}

export interface WorkflowHealthSummary {
  workflowName: string;
  runCount: number;
  passRate: number;
  failureClassCounts: Partial<Record<FailureClass, number>>;
  retryCount: number;
  retryRate: number;
  timeoutCount: number;
  timeoutRate: number;
  avgDurationMs: number | null;
  p95DurationMs: number | null;
  weakVerificationRunCount: number;
  missingHardGateRunCount: number;
  oversizedStepCount: number;
  hasHardGates: boolean;
  hasReviewStage: boolean;
  flakinessScore: number;
  pattern?: SwarmPattern;
}

export interface HealthReport {
  analyzedAt: string;
  totalRuns: number;
  totalWorkflows: number;
  timeRange: {
    earliest: string;
    latest: string;
  } | null;
  overallHealthScore: number;
  findings: HealthFinding[];
  perWorkflowSummary: WorkflowHealthSummary[];
}

export type RecommendationPriority = 'immediate' | 'soon' | 'backlog';

export interface Recommendation {
  id: string;
  priority: RecommendationPriority;
  title: string;
  description: string;
  relatedFindings: string[];
  workflowNames: string[];
  suggestedAction: string;
}

export interface DigestFinding {
  id: string;
  category: FindingCategory;
  severity: FindingSeverity;
  workflowName: string;
  summary: string;
  evidence: HealthSignal[];
  recommendedAction: string;
}

export interface HealthDigest {
  generatedAt: string;
  topLineStatus: 'healthy' | 'degraded' | 'unhealthy';
  topLineSummary: string;
  healthScore: number;
  findings: DigestFinding[];
  recommendations: Recommendation[];
  report: HealthReport;
}
