/**
 * Deterministic Failure Classifier
 *
 * Maps WorkflowRunEvidence and EvidenceSummary to actionable failure
 * categories. No LLM interpretation — purely rule-based.
 */

import type {
  EvidenceSummary,
  WorkflowRunEvidence,
  WorkflowStepEvidence,
  DeterministicGateResult,
  VerificationResult,
} from '@ricky/shared/models/workflow-evidence';
import { summarizeEvidence } from '../evidence/capture.js';
import {
  type FailureClassification,
  type EvidenceSignal,
  FailureClass,
  Severity,
  Confidence,
  NextAction,
} from './types.js';

// ── Environment error patterns ───────────────────────────────────────

const ENV_ERROR_PATTERNS: readonly RegExp[] = [
  /ENOENT/i,
  /EACCES/i,
  /EPERM/i,
  /ENOMEM/i,
  /OOMKilled/i,
  /ETIMEDOUT/i,
  /ECONNREFUSED/i,
  /ENOTFOUND/i,
  /permission denied/i,
  /command not found/i,
  /spawn\s+\S+\s+ENOENT/i,
  /exec.*failed/i,
  /no such file or directory/i,
  /out of memory/i,
  /cannot allocate memory/i,
  /network.*unreachable/i,
  /connection.*refused/i,
  /dns.*resolution.*failed/i,
];

// ── Step overflow threshold ──────────────────────────────────────────

const RETRY_OVERFLOW_THRESHOLD = 5;

// ── Public API ───────────────────────────────────────────────────────

/**
 * Classify a failure from full run evidence.
 * Returns a classification even for passing runs (with failureClass 'unknown'
 * and a summary indicating no failure).
 */
export function classifyFailure(evidence: WorkflowRunEvidence): FailureClassification {
  const summary = summarizeEvidence(evidence);
  return classifyWithFullEvidence(summary, evidence);
}

/**
 * Classify from an EvidenceSummary, optionally with full evidence for
 * deeper signal extraction.
 */
export function classifyFromSummary(
  summary: EvidenceSummary,
  evidence?: WorkflowRunEvidence,
): FailureClassification {
  if (evidence) {
    return classifyWithFullEvidence(summary, evidence);
  }
  return classifyFromSummaryOnly(summary);
}

// ── Internal classification with full evidence ───────────────────────

function classifyWithFullEvidence(
  summary: EvidenceSummary,
  evidence: WorkflowRunEvidence,
): FailureClassification {
  // No failure — run passed
  if (summary.runStatus === 'passed' && summary.failedSteps === 0 && summary.timedOutSteps === 0) {
    return noFailure(summary);
  }

  // Still running — not classifiable yet
  if (summary.runStatus === 'running' || summary.runStatus === 'pending') {
    return stillRunning(summary);
  }

  const signals: EvidenceSignal[] = [];
  const detected: FailureClass[] = [];

  // 1. Timeout detection
  if (detectTimeout(summary, evidence, signals)) {
    detected.push(FailureClass.Timeout);
  }

  // 2. Environment error detection
  if (detectEnvironmentError(evidence, signals)) {
    detected.push(FailureClass.EnvironmentError);
  }

  // 3. Deadlock detection
  if (detectDeadlock(summary, signals)) {
    detected.push(FailureClass.Deadlock);
  }

  // 4. Step overflow detection
  if (detectStepOverflow(summary, evidence, signals)) {
    detected.push(FailureClass.StepOverflow);
  }

  // 5. Agent drift detection
  if (detectAgentDrift(evidence, signals)) {
    detected.push(FailureClass.AgentDrift);
  }

  // 6. Verification failure detection
  if (detectVerificationFailure(summary, evidence, signals)) {
    detected.push(FailureClass.VerificationFailure);
  }

  // Pick primary class (first detected wins by priority order)
  if (detected.length === 0) {
    return unknownFailure(summary, signals);
  }

  const primary = detected[0];
  const secondary = detected.slice(1);

  return buildClassification(primary, secondary, signals, summary);
}

// ── Internal classification from summary only ────────────────────────

function classifyFromSummaryOnly(summary: EvidenceSummary): FailureClassification {
  if (summary.runStatus === 'passed' && summary.failedSteps === 0 && summary.timedOutSteps === 0) {
    return noFailure(summary);
  }

  if (summary.runStatus === 'running' || summary.runStatus === 'pending') {
    return stillRunning(summary);
  }

  const signals: EvidenceSignal[] = [];
  const detected: FailureClass[] = [];

  // Timeout from summary
  if (summary.runStatus === 'timed_out' || summary.timedOutSteps > 0) {
    signals.push({
      observation: `Run status: ${summary.runStatus}, timed out steps: ${summary.timedOutSteps}`,
      source: 'run-summary',
      strength: Confidence.High,
    });
    detected.push(FailureClass.Timeout);
  }

  // Deadlock from summary (all non-terminal)
  if (
    summary.totalSteps > 0 &&
    summary.failedSteps === 0 &&
    summary.passedSteps === 0 &&
    summary.timedOutSteps === 0 &&
    summary.cancelledSteps === 0 &&
    (summary.pendingSteps > 0 || summary.runningSteps > 0) &&
    summary.runStatus === 'failed'
  ) {
    signals.push({
      observation: `All ${summary.totalSteps} steps stuck in pending/running with failed run status`,
      source: 'run-summary',
      strength: Confidence.Medium,
    });
    detected.push(FailureClass.Deadlock);
  }

  // Step overflow from summary
  if (summary.retryCount >= RETRY_OVERFLOW_THRESHOLD && summary.totalSteps > 0) {
    signals.push({
      observation: `${summary.retryCount} retries across ${summary.totalSteps} steps`,
      source: 'run-summary',
      strength: Confidence.Medium,
    });
    detected.push(FailureClass.StepOverflow);
  }

  // Verification failure from summary
  if (!summary.allVerificationsPassed || !summary.allDeterministicGatesPassed) {
    signals.push({
      observation: `Verifications passed: ${summary.allVerificationsPassed}, gates passed: ${summary.allDeterministicGatesPassed}`,
      source: 'run-summary',
      strength: Confidence.Medium,
    });
    detected.push(FailureClass.VerificationFailure);
  }

  if (detected.length === 0) {
    return unknownFailure(summary, signals);
  }

  const primary = detected[0];
  const secondary = detected.slice(1);
  return buildClassification(primary, secondary, signals, summary);
}

// ── Detection functions ──────────────────────────────────────────────

function detectTimeout(
  summary: EvidenceSummary,
  evidence: WorkflowRunEvidence,
  signals: EvidenceSignal[],
): boolean {
  let found = false;

  if (evidence.status === 'timed_out') {
    signals.push({
      observation: 'Run status is timed_out',
      source: 'run-level',
      strength: Confidence.High,
    });
    found = true;
  }

  for (const step of evidence.steps) {
    if (step.status === 'timed_out') {
      signals.push({
        observation: `Step "${step.stepName}" timed out`,
        source: `step:${step.stepId}`,
        strength: Confidence.High,
      });
      found = true;
    }
  }

  if (!found && summary.timedOutSteps > 0) {
    signals.push({
      observation: `${summary.timedOutSteps} steps timed out (from summary)`,
      source: 'run-summary',
      strength: Confidence.High,
    });
    found = true;
  }

  return found;
}

function detectEnvironmentError(
  evidence: WorkflowRunEvidence,
  signals: EvidenceSignal[],
): boolean {
  let found = false;

  // Scan step errors
  for (const step of evidence.steps) {
    if (step.error && matchesEnvironmentPattern(step.error)) {
      signals.push({
        observation: `Step "${step.stepName}" error matches environment pattern: ${truncate(step.error, 120)}`,
        source: `step:${step.stepId}`,
        strength: Confidence.High,
      });
      found = true;
    }

    // Scan gate and verification stderr/stdout excerpts
    found = scanGatesForEnvErrors(step.deterministicGates, `step:${step.stepId}`, signals) || found;
    found = scanVerificationsForEnvErrors(step.verifications, `step:${step.stepId}`, signals) || found;
  }

  // Scan step log excerpts
  for (const step of evidence.steps) {
    for (const log of step.logs) {
      if (log.excerpt && matchesEnvironmentPattern(log.excerpt)) {
        signals.push({
          observation: `Step "${step.stepName}" log excerpt matches environment error: ${truncate(log.excerpt, 120)}`,
          source: `step:${step.stepId}/log`,
          strength: Confidence.High,
        });
        found = true;
      }
    }
  }

  // Scan run-level gates
  found = scanGatesForEnvErrors(evidence.deterministicGates, 'run-level', signals) || found;

  // Scan run-level log excerpts
  for (const log of evidence.logs) {
    if (log.excerpt && matchesEnvironmentPattern(log.excerpt)) {
      signals.push({
        observation: `Run log excerpt matches environment error: ${truncate(log.excerpt, 120)}`,
        source: 'run-level/log',
        strength: Confidence.High,
      });
      found = true;
    }
  }

  return found;
}

function detectDeadlock(summary: EvidenceSummary, signals: EvidenceSignal[]): boolean {
  // Deadlock: steps exist, none are terminal, run is in a terminal failed state.
  // Require runStatus === 'failed' to align with the summary-only path and
  // avoid mis-classifying cancelled runs as deadlocked.
  if (
    summary.runStatus === 'failed' &&
    summary.totalSteps > 0 &&
    summary.passedSteps === 0 &&
    summary.failedSteps === 0 &&
    summary.timedOutSteps === 0 &&
    summary.cancelledSteps === 0 &&
    summary.skippedSteps === 0 &&
    (summary.pendingSteps > 0 || summary.runningSteps > 0)
  ) {
    signals.push({
      observation: `All ${summary.totalSteps} steps are non-terminal (${summary.pendingSteps} pending, ${summary.runningSteps} running) — likely deadlock`,
      source: 'run-summary',
      strength: Confidence.Medium,
    });
    return true;
  }

  return false;
}

function detectStepOverflow(
  summary: EvidenceSummary,
  evidence: WorkflowRunEvidence,
  signals: EvidenceSignal[],
): boolean {
  if (summary.retryCount < RETRY_OVERFLOW_THRESHOLD) {
    return false;
  }

  // Track whether we added a step-level retry signal locally
  let addedStepSignal = false;

  // Find which steps have excessive retries
  for (const step of evidence.steps) {
    if (step.retries.length >= RETRY_OVERFLOW_THRESHOLD) {
      signals.push({
        observation: `Step "${step.stepName}" has ${step.retries.length} retries`,
        source: `step:${step.stepId}`,
        strength: Confidence.High,
      });
      addedStepSignal = true;
    }
  }

  // Only add the distributed retry summary signal if we didn't add any
  // step-level retry signal. This avoids depending on unrelated earlier
  // signals in the shared array.
  if (!addedStepSignal) {
    signals.push({
      observation: `${summary.retryCount} total retries across ${summary.totalSteps} steps exceeds threshold of ${RETRY_OVERFLOW_THRESHOLD}`,
      source: 'run-summary',
      strength: Confidence.Medium,
    });
  }

  return true;
}

function detectAgentDrift(
  evidence: WorkflowRunEvidence,
  signals: EvidenceSignal[],
): boolean {
  let found = false;

  for (const step of evidence.steps) {
    if (step.status !== 'failed') continue;

    // Agent drift: the agent ran (gates/verifications have exit code 0 or agent produced output)
    // but verifications still failed
    const hasPassingExecution = stepHasPassingExecution(step);
    const hasFailingVerification = step.verifications.some((v) => !v.passed);

    if (hasPassingExecution && hasFailingVerification) {
      signals.push({
        observation: `Step "${step.stepName}" had successful execution but failed verification — agent produced output that didn't meet the step contract`,
        source: `step:${step.stepId}`,
        strength: Confidence.High,
      });
      found = true;
    }
  }

  return found;
}

function detectVerificationFailure(
  summary: EvidenceSummary,
  evidence: WorkflowRunEvidence,
  signals: EvidenceSignal[],
): boolean {
  let found = false;

  if (!summary.allDeterministicGatesPassed) {
    const failedGates = [
      ...evidence.deterministicGates.filter((g) => !g.passed),
      ...evidence.steps.flatMap((s) => s.deterministicGates.filter((g) => !g.passed)),
    ];

    for (const gate of failedGates) {
      signals.push({
        observation: `Gate "${gate.gateName}" failed`,
        source: `gate:${gate.gateName}`,
        strength: Confidence.High,
      });
      found = true;
    }
  }

  if (!summary.allVerificationsPassed) {
    const failedVerifications = evidence.steps.flatMap((s) =>
      s.verifications.filter((v) => !v.passed).map((v) => ({ step: s, verification: v })),
    );

    for (const { step, verification } of failedVerifications) {
      signals.push({
        observation: `Verification "${verification.type}" failed in step "${step.stepName}": expected ${truncate(verification.expected, 60)}, got ${truncate(verification.actual, 60)}`,
        source: `step:${step.stepId}`,
        strength: Confidence.High,
      });
      found = true;
    }
  }

  return found;
}

// ── Helper functions ─────────────────────────────────────────────────

function matchesEnvironmentPattern(text: string): boolean {
  return ENV_ERROR_PATTERNS.some((pattern) => pattern.test(text));
}

function scanGatesForEnvErrors(
  gates: DeterministicGateResult[],
  sourcePrefix: string,
  signals: EvidenceSignal[],
): boolean {
  let found = false;
  for (const gate of gates) {
    const texts = [gate.stderrExcerpt, gate.stdoutExcerpt, gate.outputExcerpt].filter(Boolean) as string[];
    for (const text of texts) {
      if (matchesEnvironmentPattern(text)) {
        signals.push({
          observation: `Gate "${gate.gateName}" output matches environment error: ${truncate(text, 120)}`,
          source: `${sourcePrefix}/gate:${gate.gateName}`,
          strength: Confidence.High,
        });
        found = true;
      }
    }
  }
  return found;
}

function scanVerificationsForEnvErrors(
  verifications: VerificationResult[],
  sourcePrefix: string,
  signals: EvidenceSignal[],
): boolean {
  let found = false;
  for (const v of verifications) {
    const texts = [v.stderrExcerpt, v.stdoutExcerpt, v.outputExcerpt, v.message].filter(Boolean) as string[];
    for (const text of texts) {
      if (matchesEnvironmentPattern(text)) {
        signals.push({
          observation: `Verification output matches environment error: ${truncate(text, 120)}`,
          source: `${sourcePrefix}/verification:${v.type}`,
          strength: Confidence.Medium,
        });
        found = true;
      }
    }
  }
  return found;
}

function stepHasPassingExecution(step: WorkflowStepEvidence): boolean {
  // Check if any gate or verification had a successful exit code (0)
  for (const gate of step.deterministicGates) {
    if (gate.exitCode === 0) return true;
  }
  for (const v of step.verifications) {
    if (v.exitCode === 0) return true;
  }
  // Narrative alone is not sufficient — require repeated narrative (2+)
  // to distinguish drift from ordinary verification failures with a
  // single progress update.
  if (step.narrative.length >= 2) return true;
  return false;
}

function truncate(s: string, maxLen: number): string {
  if (s.length <= maxLen) return s;
  return s.slice(0, maxLen - 3) + '...';
}

// ── Classification builders ──────────────────────────────────────────

function buildClassification(
  primary: FailureClass,
  secondary: FailureClass[],
  signals: EvidenceSignal[],
  summary: EvidenceSummary,
): FailureClassification {
  const config = CLASS_CONFIG[primary];
  return {
    category: primary,
    failureClass: primary,
    severity: config.severity(summary),
    confidence: deriveConfidence(signals),
    nextAction: config.nextAction,
    summary: config.summarize(summary),
    signals,
    secondaryClasses: secondary,
  };
}

function noFailure(summary: EvidenceSummary): FailureClassification {
  return {
    category: FailureClass.Unknown,
    failureClass: FailureClass.Unknown,
    severity: Severity.Low,
    confidence: Confidence.High,
    nextAction: NextAction.Retry,
    summary: `Run "${summary.workflowName}" passed with ${summary.totalSteps} steps — no failure detected`,
    signals: [],
    secondaryClasses: [],
  };
}

function stillRunning(summary: EvidenceSummary): FailureClassification {
  return {
    category: FailureClass.Unknown,
    failureClass: FailureClass.Unknown,
    severity: Severity.Low,
    confidence: Confidence.Low,
    nextAction: NextAction.Retry,
    summary: `Run "${summary.workflowName}" is still in progress (${summary.runningSteps} running, ${summary.pendingSteps} pending)`,
    signals: [],
    secondaryClasses: [],
  };
}

function unknownFailure(
  summary: EvidenceSummary,
  signals: EvidenceSignal[],
): FailureClassification {
  return {
    category: FailureClass.Unknown,
    failureClass: FailureClass.Unknown,
    severity: summary.failedSteps > 0 ? Severity.Medium : Severity.Low,
    confidence: Confidence.Low,
    nextAction: NextAction.Escalate,
    summary: `Run "${summary.workflowName}" failed but no deterministic classification matched (${summary.failedSteps} failed steps)`,
    signals,
    secondaryClasses: [],
  };
}

function deriveConfidence(signals: EvidenceSignal[]): Confidence {
  if (signals.length === 0) return Confidence.Low;
  const highCount = signals.filter((s) => s.strength === Confidence.High).length;
  if (highCount >= 2) return Confidence.High;
  if (highCount === 1) return Confidence.Medium;
  return Confidence.Low;
}

// ── Per-class configuration ──────────────────────────────────────────

interface ClassConfig {
  severity: (summary: EvidenceSummary) => Severity;
  nextAction: NextAction;
  summarize: (summary: EvidenceSummary) => string;
}

const CLASS_CONFIG: Record<FailureClass, ClassConfig> = {
  [FailureClass.Timeout]: {
    severity: (s) => (s.timedOutSteps > s.totalSteps / 2 ? Severity.Critical : Severity.High),
    nextAction: NextAction.Retry,
    summarize: (s) =>
      `Run "${s.workflowName}" timed out — ${s.timedOutSteps} of ${s.totalSteps} steps exceeded time budget`,
  },

  [FailureClass.VerificationFailure]: {
    severity: (s) =>
      s.failedSteps > s.totalSteps / 2 ? Severity.High : Severity.Medium,
    nextAction: NextAction.FixAndRetry,
    summarize: (s) =>
      `Run "${s.workflowName}" failed verification — ${s.failedSteps} steps failed deterministic checks`,
  },

  [FailureClass.AgentDrift]: {
    severity: () => Severity.Medium,
    nextAction: NextAction.FixAndRetry,
    summarize: (s) =>
      `Run "${s.workflowName}" experienced agent drift — agent output did not meet step contracts`,
  },

  [FailureClass.EnvironmentError]: {
    severity: () => Severity.High,
    nextAction: NextAction.InvestigateEnvironment,
    summarize: (s) =>
      `Run "${s.workflowName}" hit an environment/infrastructure error`,
  },

  [FailureClass.Deadlock]: {
    severity: () => Severity.Critical,
    nextAction: NextAction.Abort,
    summarize: (s) =>
      `Run "${s.workflowName}" is deadlocked — ${s.pendingSteps + s.runningSteps} steps stuck with no terminal progress`,
  },

  [FailureClass.StepOverflow]: {
    severity: (s) => (s.retryCount >= RETRY_OVERFLOW_THRESHOLD * 2 ? Severity.High : Severity.Medium),
    nextAction: NextAction.Escalate,
    summarize: (s) =>
      `Run "${s.workflowName}" exhausted retry budget — ${s.retryCount} retries across ${s.totalSteps} steps`,
  },

  [FailureClass.Unknown]: {
    severity: (s) => (s.failedSteps > 0 ? Severity.Medium : Severity.Low),
    nextAction: NextAction.Escalate,
    summarize: (s) =>
      `Run "${s.workflowName}" failed but no deterministic classification matched (${s.failedSteps} failed steps)`,
  },
};
