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
} from '../evidence/types.js';
import { summarizeEvidence } from '../evidence/capture.js';
import {
  type FailureClassification,
  type EvidenceSignal,
  type FailureClassifierInput,
  type PlainValidationSummary,
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
  /\bexec\s+failed/i,
  /no such file or directory/i,
  /out of memory/i,
  /cannot allocate memory/i,
  /network.*unreachable/i,
  /connection.*refused/i,
  /dns.*resolution.*failed/i,
  /\bMISSING_ENV_VAR\b/i,
  /\bmissing\s+(?:required\s+)?env(?:ironment)?(?:\s+var(?:iable)?)?\b/i,
  /\brequired\s+env(?:ironment)?\s+var(?:iable)?\b/i,
  /\benvironment\s+variable\b.*\bnot\s+set\b/i,
];

// ── Step overflow threshold ──────────────────────────────────────────

export const RETRY_OVERFLOW_THRESHOLD = 5;

// ── Public API ───────────────────────────────────────────────────────

/**
 * Classify a failure from full run evidence, a structured summary, or a
 * bootstrap plain-text validation summary.
 * Returns a classification even for passing runs (with failureClass 'unknown'
 * and a summary indicating no failure).
 */
export function classifyFailure(evidence: WorkflowRunEvidence): FailureClassification;
export function classifyFailure(summary: EvidenceSummary): FailureClassification;
export function classifyFailure(summary: PlainValidationSummary): FailureClassification;
export function classifyFailure(input: FailureClassifierInput): FailureClassification {
  if (typeof input === 'string') {
    return classifyFromPlainSummary(input);
  }

  if (isEvidenceSummary(input)) {
    return classifyFromSummaryOnly(input);
  }

  const summary = summarizeEvidence(input);
  return classifyWithFullEvidence(summary, input);
}

/**
 * Classify from an EvidenceSummary or plain validation summary, optionally
 * with full evidence for deeper signal extraction.
 */
export function classifyFromSummary(summary: EvidenceSummary, evidence?: WorkflowRunEvidence): FailureClassification;
export function classifyFromSummary(summary: PlainValidationSummary): FailureClassification;
export function classifyFromSummary(
  summary: EvidenceSummary | PlainValidationSummary,
  evidence?: WorkflowRunEvidence,
): FailureClassification {
  if (typeof summary === 'string') {
    return classifyFromPlainSummary(summary);
  }

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
  if (isCleanPass(summary)) {
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
  if (detectEnvironmentError(summary, evidence, signals)) {
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
  if (isCleanPass(summary)) {
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

  // Environment errors from summary-only evidence
  if (summary.firstError && matchesEnvironmentPattern(summary.firstError)) {
    signals.push({
      observation: `First error matches environment pattern: ${truncate(summary.firstError, 120)}`,
      source: 'run-summary',
      strength: Confidence.High,
    });
    detected.push(FailureClass.EnvironmentError);
  }

  // Deadlock from summary (all non-terminal)
  if (
    summary.totalSteps > 0 &&
    summary.failedSteps === 0 &&
    summary.passedSteps === 0 &&
    summary.timedOutSteps === 0 &&
    summary.cancelledSteps === 0 &&
    summary.skippedSteps === 0 &&
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

// ── Internal classification from plain validation summary ────────────

function classifyFromPlainSummary(summaryText: PlainValidationSummary): FailureClassification {
  const text = summaryText.trim();
  const summary = summaryForPlainText(text);

  if (isPlainPass(text)) {
    return noFailure(summary);
  }

  const signals: EvidenceSignal[] = [];
  const detected: FailureClass[] = [];

  if (/\b(timed?\s*out|timeout|deadline|time budget|exceeded .*time)\b/i.test(text)) {
    signals.push(plainSignal(`Plain summary indicates timeout: ${truncate(text, 120)}`, Confidence.High));
    detected.push(FailureClass.Timeout);
  }

  if (matchesEnvironmentPattern(text) || /\b(missing env|MISSING_ENV_VAR|module not found|dependency missing)\b/i.test(text)) {
    signals.push(plainSignal(`Plain summary indicates environment error: ${truncate(text, 120)}`, Confidence.High));
    detected.push(FailureClass.EnvironmentError);
  }

  if (/\b(deadlock|stuck|no progress|no terminal progress|pending forever|running forever)\b/i.test(text)) {
    signals.push(plainSignal(`Plain summary indicates deadlock: ${truncate(text, 120)}`, Confidence.Medium));
    detected.push(FailureClass.Deadlock);
  }

  if (/\b(step overflow|retry budget|retries exhausted|max attempts|too many attempts|retry storm)\b/i.test(text)) {
    signals.push(plainSignal(`Plain summary indicates step overflow: ${truncate(text, 120)}`, Confidence.Medium));
    detected.push(FailureClass.StepOverflow);
  }

  if (/\b(agent drift|step contract|ignored instructions?|wrong file|out of scope|did not meet|didn't meet)\b/i.test(text)) {
    signals.push(plainSignal(`Plain summary indicates agent drift: ${truncate(text, 120)}`, Confidence.Medium));
    detected.push(FailureClass.AgentDrift);
  }

  if (/\b(verification failed|validation failed|deterministic gate failed|gate failed|typecheck failed|tests? failed|expected .* got|exit code [1-9])\b/i.test(text)) {
    signals.push(plainSignal(`Plain summary indicates verification failure: ${truncate(text, 120)}`, Confidence.Medium));
    detected.push(FailureClass.VerificationFailure);
  }

  if (/\b(mixed|multiple|conflicting)\s+(?:failures?|signals?|causes?)\b/i.test(text)) {
    signals.push(plainSignal(`Plain summary indicates mixed or conflicting failure evidence: ${truncate(text, 120)}`, Confidence.Low));
  }

  if (detected.length === 0) {
    return unknownFailure(summary, signals);
  }

  return buildClassification(detected[0], detected.slice(1), signals, summary);
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
  summary: EvidenceSummary,
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
    found = scanRetriesForEnvErrors(step, signals) || found;
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

  if (!found && summary.firstError && matchesEnvironmentPattern(summary.firstError)) {
    signals.push({
      observation: `Summary first error matches environment pattern: ${truncate(summary.firstError, 120)}`,
      source: 'run-summary',
      strength: Confidence.High,
    });
    found = true;
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
        source: `step-overflow:step:${step.stepId}`,
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
      source: 'step-overflow:run-summary',
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
    const hasVerificationSuccess = step.verifications.some((v) => v.passed);
    const hasGateSuccess = step.deterministicGates.some((gate) => gate.passed || gate.exitCode === 0);
    const hasRepeatedNarrativeWithoutProof =
      step.narrative.length >= 2 &&
      step.artifacts.length === 0 &&
      step.logs.length === 0 &&
      !hasVerificationSuccess &&
      !hasGateSuccess;

    if (hasPassingExecution && hasFailingVerification) {
      signals.push({
        observation: `Step "${step.stepName}" had successful execution but failed verification — agent produced output that didn't meet the step contract`,
        source: `step:${step.stepId}`,
        strength: Confidence.High,
      });
      found = true;
    } else if (hasRepeatedNarrativeWithoutProof) {
      signals.push({
        observation: `Step "${step.stepName}" repeated agent narrative without artifacts, logs, or verification success — likely step contract drift`,
        source: `step:${step.stepId}`,
        strength: Confidence.Medium,
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

function isEvidenceSummary(input: WorkflowRunEvidence | EvidenceSummary): input is EvidenceSummary {
  return (
    'runStatus' in input &&
    typeof input.totalSteps === 'number' &&
    typeof input.allVerificationsPassed === 'boolean' &&
    typeof input.allDeterministicGatesPassed === 'boolean'
  );
}

function matchesEnvironmentPattern(text: string): boolean {
  return ENV_ERROR_PATTERNS.some((pattern) => pattern.test(text));
}

function summaryForPlainText(text: string): EvidenceSummary {
  const passed = isPlainPass(text);
  const timedOut = /\b(timed?\s*out|timeout|deadline)\b/i.test(text);
  const failed = !passed && (timedOut || /\b(fail(?:ed|ure)?|error|deadlock|stuck|retry|overflow|denied|not found|missing)\b/i.test(text));

  return {
    runId: 'plain-summary',
    workflowName: 'plain validation summary',
    runStatus: timedOut ? 'timed_out' : passed ? 'passed' : failed ? 'failed' : 'failed',
    totalSteps: 1,
    passedSteps: passed ? 1 : 0,
    failedSteps: failed && !timedOut ? 1 : 0,
    skippedSteps: 0,
    cancelledSteps: 0,
    timedOutSteps: timedOut ? 1 : 0,
    pendingSteps: 0,
    runningSteps: 0,
    allVerificationsPassed: passed,
    allDeterministicGatesPassed: passed,
    failedStepIds: failed ? ['plain-summary'] : [],
    firstError: failed ? text : undefined,
    totalDurationMs: undefined,
    artifactCount: 0,
    retryCount: /\b(retry|retries|attempts?)\b/i.test(text) ? RETRY_OVERFLOW_THRESHOLD : 0,
    routeCount: 0,
  };
}

function isPlainPass(text: string): boolean {
  const reportsPass = /\b(pass(?:ed|ing)?|success(?:ful)?|all checks passed|no failures? detected|no failures?)\b/i.test(text);
  if (!reportsPass) return false;

  const withoutNegatedFailure = text
    .replace(/\bno failures?(?: detected)?\b/gi, '')
    .replace(/\bno errors?(?: detected)?\b/gi, '')
    .replace(/\bzero errors?\b/gi, '')
    .replace(/\b0 errors?\b/gi, '');
  return !/\b(fail(?:ed|ure)?|error|timed?\s*out|timeout|deadlock|stuck)\b/i.test(withoutNegatedFailure);
}

function plainSignal(observation: string, strength: Confidence): EvidenceSignal {
  return {
    observation,
    source: 'plain-summary',
    strength,
  };
}

function isCleanPass(summary: EvidenceSummary): boolean {
  return (
    summary.runStatus === 'passed' &&
    summary.failedSteps === 0 &&
    summary.timedOutSteps === 0 &&
    summary.cancelledSteps === 0 &&
    summary.pendingSteps === 0 &&
    summary.runningSteps === 0 &&
    summary.allVerificationsPassed &&
    summary.allDeterministicGatesPassed
  );
}

function scanGatesForEnvErrors(
  gates: DeterministicGateResult[],
  sourcePrefix: string,
  signals: EvidenceSignal[],
): boolean {
  let found = false;
  for (const gate of gates) {
    let foundInGateOutput = false;
    const texts = textFields(gate.stderrExcerpt, gate.stdoutExcerpt, gate.outputExcerpt);
    for (const text of texts) {
      if (matchesEnvironmentPattern(text)) {
        signals.push({
          observation: `Gate "${gate.gateName}" output matches environment error: ${truncate(text, 120)}`,
          source: `${sourcePrefix}/gate:${gate.gateName}`,
          strength: Confidence.High,
        });
        found = true;
        foundInGateOutput = true;
      }
    }

    if (!foundInGateOutput) {
      found = scanVerificationsForEnvErrors(
        gate.verifications,
        `${sourcePrefix}/gate:${gate.gateName}`,
        signals,
      ) || found;
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
    const texts = textFields(
      v.stderrExcerpt,
      v.stdoutExcerpt,
      v.outputExcerpt,
      v.message,
      v.actual,
    );
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

function scanRetriesForEnvErrors(
  step: WorkflowStepEvidence,
  signals: EvidenceSignal[],
): boolean {
  let found = false;
  for (const retry of step.retries) {
    const texts = textFields(
      retry.error,
      retry.stderrExcerpt,
      retry.stdoutExcerpt,
      retry.outputExcerpt,
    );
    for (const text of texts) {
      if (matchesEnvironmentPattern(text)) {
        signals.push({
          observation: `Retry ${retry.attempt} for step "${step.stepName}" matches environment error: ${truncate(text, 120)}`,
          source: `step:${step.stepId}/retry:${retry.attempt}`,
          strength: Confidence.High,
        });
        found = true;
      }
    }

    found = scanVerificationsForEnvErrors(
      retry.verifications ?? [],
      `step:${step.stepId}/retry:${retry.attempt}`,
      signals,
    ) || found;
  }
  return found;
}

function textFields(...values: Array<string | undefined>): string[] {
  return values.filter((value): value is string => Boolean(value));
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
  const normalizedSignals = uniqueSignals(signals);
  const normalizedSecondary = uniqueClasses(secondary).filter((failureClass) => failureClass !== primary);
  return {
    category: primary,
    failureClass: primary,
    severity: config.severity(summary),
    confidence: deriveConfidence(normalizedSignals),
    nextAction: config.nextAction,
    suggestedNextAction: config.nextAction,
    summary: config.summarize(summary),
    signals: normalizedSignals,
    matchedSignals: normalizedSignals,
    secondaryClasses: normalizedSecondary,
    isMixedFailure: normalizedSecondary.length > 0,
  };
}

function noFailure(summary: EvidenceSummary): FailureClassification {
  return {
    category: FailureClass.Unknown,
    failureClass: FailureClass.Unknown,
    severity: Severity.Low,
    confidence: Confidence.High,
    nextAction: NextAction.Retry,
    suggestedNextAction: NextAction.Retry,
    summary: `Run "${summary.workflowName}" passed with ${summary.totalSteps} steps — no failure detected`,
    signals: [],
    matchedSignals: [],
    secondaryClasses: [],
    isMixedFailure: false,
  };
}

function stillRunning(summary: EvidenceSummary): FailureClassification {
  return {
    category: FailureClass.Unknown,
    failureClass: FailureClass.Unknown,
    severity: Severity.Low,
    confidence: Confidence.Low,
    nextAction: NextAction.Retry,
    suggestedNextAction: NextAction.Retry,
    summary: `Run "${summary.workflowName}" is still in progress (${summary.runningSteps} running, ${summary.pendingSteps} pending)`,
    signals: [],
    matchedSignals: [],
    secondaryClasses: [],
    isMixedFailure: false,
  };
}

function unknownFailure(
  summary: EvidenceSummary,
  signals: EvidenceSignal[],
): FailureClassification {
  const normalizedSignals = uniqueSignals(signals);
  return {
    category: FailureClass.Unknown,
    failureClass: FailureClass.Unknown,
    severity: summary.failedSteps > 0 ? Severity.Medium : Severity.Low,
    confidence: Confidence.Low,
    nextAction: NextAction.Escalate,
    suggestedNextAction: NextAction.Escalate,
    summary: `Run "${summary.workflowName}" failed but no deterministic classification matched (${summary.failedSteps} failed steps)`,
    signals: normalizedSignals,
    matchedSignals: normalizedSignals,
    secondaryClasses: [],
    isMixedFailure: false,
  };
}

function deriveConfidence(signals: EvidenceSignal[]): Confidence {
  if (signals.length === 0) return Confidence.Low;
  const highCount = signals.filter((s) => s.strength === Confidence.High).length;
  if (highCount >= 2) return Confidence.High;
  if (highCount === 1) return Confidence.Medium;
  return Confidence.Low;
}

function uniqueClasses(classes: FailureClass[]): FailureClass[] {
  return Array.from(new Set(classes));
}

function uniqueSignals(signals: EvidenceSignal[]): EvidenceSignal[] {
  const seen = new Set<string>();
  const unique: EvidenceSignal[] = [];

  for (const signal of signals) {
    const key = `${signal.source}\0${signal.strength}\0${signal.observation}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(signal);
  }

  return unique;
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
