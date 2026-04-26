/**
 * Workflow Failure Classification Types
 *
 * Defines failure classes, severity, confidence, evidence signals,
 * and recommended next-action hints for deterministic failure triage.
 */

// ── Failure Classes ──────────────────────────────────────────────────

export const FailureClass = {
  Timeout: 'timeout',
  VerificationFailure: 'verification_failure',
  AgentDrift: 'agent_drift',
  EnvironmentError: 'environment_error',
  Deadlock: 'deadlock',
  StepOverflow: 'step_overflow',
  Unknown: 'unknown',
} as const;

export type FailureClass = (typeof FailureClass)[keyof typeof FailureClass];

// ── Severity ─────────────────────────────────────────────────────────

export const Severity = {
  Critical: 'critical',
  High: 'high',
  Medium: 'medium',
  Low: 'low',
} as const;

export type Severity = (typeof Severity)[keyof typeof Severity];

// ── Confidence ───────────────────────────────────────────────────────

export const Confidence = {
  High: 'high',
  Medium: 'medium',
  Low: 'low',
} as const;

export type Confidence = (typeof Confidence)[keyof typeof Confidence];

// ── Next-Action Hints ────────────────────────────────────────────────

export const NextAction = {
  Retry: 'retry',
  FixAndRetry: 'fix_and_retry',
  Escalate: 'escalate',
  InvestigateEnvironment: 'investigate_environment',
  Abort: 'abort',
} as const;

export type NextAction = (typeof NextAction)[keyof typeof NextAction];

// ── Evidence Signal ──────────────────────────────────────────────────

export interface EvidenceSignal {
  /** What was observed */
  observation: string;
  /** Where the signal came from (step id, gate name, run-level) */
  source: string;
  /** How strongly this signal supports the classification */
  strength: Confidence;
}

// ── Classification Result ────────────────────────────────────────────

export interface FailureClassification {
  /** Primary failure category */
  category: FailureClass;
  /** Primary failure class */
  failureClass: FailureClass;
  /** How severe the failure is */
  severity: Severity;
  /** How confident the classifier is in this classification */
  confidence: Confidence;
  /** Recommended next action */
  nextAction: NextAction;
  /** Human-readable summary of the failure */
  summary: string;
  /** Evidence signals that contributed to this classification */
  signals: EvidenceSignal[];
  /** Secondary failure classes detected (if any) */
  secondaryClasses: FailureClass[];
}
