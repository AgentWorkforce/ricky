import {
  Confidence,
  type EvidenceSignal,
  FailureClass,
  type FailureClassification,
} from '../../../runtime/failure/types.js';
import type {
  DeterministicGateResult,
  VerificationResult,
  WorkflowRunEvidence,
  WorkflowStepEvidence,
} from '../../../shared/models/workflow-evidence.js';
import type { Diagnosis, WorkflowCause, WorkflowCauseCategory } from './types.js';

const RETRY_OVERFLOW_THRESHOLD = 5;

export function diagnose(
  classification: FailureClassification,
  evidence: WorkflowRunEvidence,
): Diagnosis {
  const primaryCategory = choosePrimaryCategory(classification, evidence);
  const primaryCause = buildCause(primaryCategory, classification, evidence);
  const secondaryCauses = detectSecondaryCauses(primaryCategory, classification, evidence);

  return {
    primaryCause,
    secondaryCauses,
    runtimeClassification: classification,
    explanation: explainDiagnosis(primaryCause, classification),
  };
}

function choosePrimaryCategory(
  classification: FailureClassification,
  evidence: WorkflowRunEvidence,
): WorkflowCauseCategory {
  if (classification.failureClass === FailureClass.VerificationFailure) {
    if (hasMissingFileEvidence(evidence)) return 'missing_file_materialization';
    if (hasBrittleGrepEvidence(evidence)) return 'brittle_grep_gate';
    if (hasMissingGateEvidence(classification, evidence)) return 'missing_deterministic_gate';
    return 'step_contract_violation';
  }

  if (classification.failureClass === FailureClass.AgentDrift) return 'agent_drift';
  if (classification.failureClass === FailureClass.EnvironmentError) return 'environment_prerequisite';
  if (classification.failureClass === FailureClass.Timeout) return 'timeout_budget';

  if (classification.failureClass === FailureClass.StepOverflow) {
    return retriesAreConcentrated(evidence) ? 'oversized_agent_step' : 'retry_exhaustion';
  }

  if (classification.failureClass === FailureClass.Deadlock) {
    return hasPatternChoiceEvidence(classification, evidence) ? 'wrong_pattern_choice' : 'workflow_structure';
  }

  if (classification.failureClass === FailureClass.Unknown) {
    if (hasMissingGateEvidence(classification, evidence)) return 'missing_deterministic_gate';
    if (hasPatternChoiceEvidence(classification, evidence)) return 'wrong_pattern_choice';
  }

  return 'unknown';
}

function detectSecondaryCauses(
  primaryCategory: WorkflowCauseCategory,
  classification: FailureClassification,
  evidence: WorkflowRunEvidence,
): WorkflowCause[] {
  const categories = new Set<WorkflowCauseCategory>();

  for (const secondary of classification.secondaryClasses) {
    categories.add(choosePrimaryCategory({ ...classification, failureClass: secondary, category: secondary }, evidence));
  }

  if (hasMissingFileEvidence(evidence)) categories.add('missing_file_materialization');
  if (hasBrittleGrepEvidence(evidence)) categories.add('brittle_grep_gate');
  if (hasMissingGateEvidence(classification, evidence)) categories.add('missing_deterministic_gate');
  if (hasEnvironmentEvidence(classification, evidence)) categories.add('environment_prerequisite');
  if (hasPatternChoiceEvidence(classification, evidence)) categories.add('wrong_pattern_choice');

  categories.delete(primaryCategory);
  return [...categories].map((category) => buildCause(category, classification, evidence));
}

function buildCause(
  category: WorkflowCauseCategory,
  classification: FailureClassification,
  evidence: WorkflowRunEvidence,
): WorkflowCause {
  const affectedStepIds = affectedStepsFor(category, classification, evidence);
  const filesLikelyTouched = likelyFilesFor(category, evidence);

  return {
    category,
    summary: summarizeCause(category, classification, affectedStepIds, filesLikelyTouched),
    affectedStepIds,
    supportingSignals: supportingSignalsFor(category, classification, evidence),
    confidence: confidenceFor(category, classification, evidence),
    filesLikelyTouched,
    ambiguousProductIntent: isAmbiguousProductIntent(category, filesLikelyTouched),
  };
}

function affectedStepsFor(
  category: WorkflowCauseCategory,
  classification: FailureClassification,
  evidence: WorkflowRunEvidence,
): string[] {
  const ids = new Set<string>();

  for (const signal of classification.signals) {
    const id = parseStepId(signal.source);
    if (id) ids.add(id);
  }

  for (const step of evidence.steps) {
    if (step.status === 'failed' || step.status === 'timed_out') ids.add(step.stepId);

    if (category === 'missing_file_materialization' && step.verifications.some(isMissingFileVerification)) {
      ids.add(step.stepId);
    }
    if (category === 'brittle_grep_gate' && stepHasBrittleGrep(step)) ids.add(step.stepId);
    if (category === 'oversized_agent_step' && step.retries.length >= RETRY_OVERFLOW_THRESHOLD) {
      ids.add(step.stepId);
    }
    if (category === 'agent_drift' && step.status === 'failed' && step.verifications.some((v) => !v.passed)) {
      ids.add(step.stepId);
    }
  }

  return [...ids].sort();
}

function supportingSignalsFor(
  category: WorkflowCauseCategory,
  classification: FailureClassification,
  evidence: WorkflowRunEvidence,
): EvidenceSignal[] {
  const signals = [...classification.signals];

  for (const { step, verification } of failedVerifications(evidence)) {
    if (category === 'missing_file_materialization' && isMissingFileVerification(verification)) {
      signals.push(signal(`Missing file or artifact: ${verification.expected}`, `step:${step.stepId}`, Confidence.High));
    }
    if (category === 'brittle_grep_gate' && textOfVerification(verification).includes('grep')) {
      signals.push(signal('A grep-based gate failed; the check may be too brittle for the intended artifact.', `step:${step.stepId}`, Confidence.Medium));
    }
  }

  for (const { step, gate } of failedGates(evidence)) {
    const source = step ? `step:${step.stepId}/gate:${gate.gateName}` : `gate:${gate.gateName}`;
    if (category === 'brittle_grep_gate' && textOfGate(gate).includes('grep')) {
      signals.push(signal(`Grep gate "${gate.gateName}" failed.`, source, Confidence.Medium));
    }
    if (category === 'missing_deterministic_gate' && /deterministic|gate/i.test(gate.gateName)) {
      signals.push(signal(`Deterministic gate "${gate.gateName}" failed.`, source, Confidence.High));
    }
  }

  if (category === 'missing_deterministic_gate' && allGates(evidence).length === 0) {
    signals.push(signal('No deterministic gate evidence was recorded for the failed run.', 'run-level', Confidence.Medium));
  }

  return dedupeSignals(signals);
}

function confidenceFor(
  category: WorkflowCauseCategory,
  classification: FailureClassification,
  evidence: WorkflowRunEvidence,
): Confidence {
  if (category === 'unknown') return Confidence.Low;
  if (category === 'wrong_pattern_choice' && !hasPatternChoiceEvidence(classification, evidence)) return Confidence.Low;
  if (category === 'brittle_grep_gate') return hasBrittleGrepEvidence(evidence) ? Confidence.Medium : Confidence.Low;
  if (category === 'missing_deterministic_gate' && allGates(evidence).length === 0) return Confidence.Medium;
  if (category === 'missing_file_materialization' && hasMissingFileEvidence(evidence)) return Confidence.High;
  if (category === 'oversized_agent_step' && retriesAreConcentrated(evidence)) return Confidence.High;
  return classification.confidence;
}

function summarizeCause(
  category: WorkflowCauseCategory,
  classification: FailureClassification,
  affectedStepIds: string[],
  filesLikelyTouched: string[],
): string {
  const stepText = affectedStepIds.length > 0 ? ` Affected steps: ${affectedStepIds.join(', ')}.` : '';
  const fileText = filesLikelyTouched.length > 0 ? ` Likely files: ${filesLikelyTouched.join(', ')}.` : '';

  switch (category) {
    case 'missing_deterministic_gate':
      return `The workflow lacks usable deterministic gate evidence for the failed path.${stepText}`;
    case 'wrong_pattern_choice':
      return `The selected workflow pattern appears mismatched to the dependency or coordination shape.${stepText}`;
    case 'oversized_agent_step':
      return `One agent step appears too broad and exhausted retries before converging.${stepText}`;
    case 'missing_file_materialization':
      return `A required file or artifact was not materialized.${stepText}${fileText}`;
    case 'brittle_grep_gate':
      return `A grep-based deterministic gate failed and may be too brittle for the artifact shape.${stepText}`;
    case 'environment_prerequisite':
      return `The run failed on an environment prerequisite such as a missing command, permission, or dependency.${stepText}`;
    case 'agent_drift':
      return `An agent completed work that did not satisfy the step contract.${stepText}${fileText}`;
    case 'step_contract_violation':
      return `The step output violated its deterministic verification contract.${stepText}${fileText}`;
    case 'workflow_structure':
      return `The workflow structure blocked progress and needs human review.${stepText}`;
    case 'timeout_budget':
      return `The run or step exceeded its execution time budget.${stepText}`;
    case 'retry_exhaustion':
      return `Retries were exhausted without a concentrated single-step cause.${stepText}`;
    case 'unknown':
      return classification.summary;
  }
}

function explainDiagnosis(cause: WorkflowCause, classification: FailureClassification): string {
  return `Runtime classified the run as ${classification.failureClass}; debugger mapped it to ${cause.category}. ${cause.summary}`;
}

function likelyFilesFor(category: WorkflowCauseCategory, evidence: WorkflowRunEvidence): string[] {
  const files = new Set<string>();

  for (const { verification } of failedVerifications(evidence)) {
    if (
      category === 'missing_file_materialization' ||
      category === 'brittle_grep_gate' ||
      category === 'step_contract_violation' ||
      category === 'agent_drift'
    ) {
      extractPaths(rawTextOfVerification(verification)).forEach((path) => files.add(path));
    }
  }

  for (const { gate } of failedGates(evidence)) {
    if (
      category === 'missing_deterministic_gate' ||
      category === 'brittle_grep_gate' ||
      category === 'step_contract_violation'
    ) {
      extractPaths(rawTextOfGate(gate)).forEach((path) => files.add(path));
    }
  }

  for (const artifact of [...evidence.artifacts, ...evidence.steps.flatMap((step) => step.artifacts)]) {
    if (artifact.path) files.add(artifact.path);
  }

  for (const route of evidence.routing) {
    if (route.abstractionPath && (category === 'wrong_pattern_choice' || category === 'workflow_structure')) {
      files.add(route.abstractionPath);
    }
  }

  if (evidence.finalSignoffPath && category !== 'environment_prerequisite') {
    files.add(evidence.finalSignoffPath);
  }

  return [...files].sort();
}

function isAmbiguousProductIntent(category: WorkflowCauseCategory, filesLikelyTouched: string[]): boolean {
  return category === 'wrong_pattern_choice' || category === 'workflow_structure' || category === 'unknown' ||
    (category !== 'timeout_budget' && category !== 'environment_prerequisite' && filesLikelyTouched.length === 0);
}

function hasMissingFileEvidence(evidence: WorkflowRunEvidence): boolean {
  return failedVerifications(evidence).some(({ verification }) => isMissingFileVerification(verification)) ||
    failedGates(evidence).some(({ gate }) => /file|artifact|materializ|missing/i.test(textOfGate(gate)));
}

function hasBrittleGrepEvidence(evidence: WorkflowRunEvidence): boolean {
  return failedVerifications(evidence).some(({ verification }) => textOfVerification(verification).includes('grep')) ||
    failedGates(evidence).some(({ gate }) => textOfGate(gate).includes('grep'));
}

function hasMissingGateEvidence(
  classification: FailureClassification,
  evidence: WorkflowRunEvidence,
): boolean {
  const gates = allGates(evidence);
  return gates.length === 0 && evidence.status !== 'passed' ||
    classification.signals.some((s) => /deterministic.*gate.*missing|gate.*missing|no deterministic/i.test(s.observation)) ||
    failedVerifications(evidence).some(({ verification }) =>
      verification.type === 'deterministic_gate' && /missing|not found|absent/i.test(textOfVerification(verification)),
    );
}

function hasPatternChoiceEvidence(
  classification: FailureClassification,
  evidence: WorkflowRunEvidence,
): boolean {
  const text = [
    classification.summary,
    ...classification.signals.map((s) => `${s.observation} ${s.source}`),
    ...evidence.routing.map((r) => `${r.abstractionName ?? ''} ${r.requestedRoute ?? ''} ${r.resolvedRoute ?? ''} ${r.reason ?? ''}`),
    ...evidence.logs.map((l) => l.excerpt ?? ''),
  ].join('\n').toLowerCase();

  return /wrong pattern|pattern mismatch|pattern_mismatch|pattern choice|pattern override|selected pattern.*(?:mismatch|wrong|insufficient)|pipeline.*(?:parallel|dependency|fan.?out)|supervisor.*(?:parallel|dependency|fan.?out)|requires dag|should use dag|circular dependency/.test(text);
}

function hasEnvironmentEvidence(
  classification: FailureClassification,
  evidence: WorkflowRunEvidence,
): boolean {
  const text = [
    classification.summary,
    ...classification.signals.map((s) => s.observation),
    ...evidence.steps.map((step) => step.error ?? ''),
    ...evidence.logs.map((log) => log.excerpt ?? ''),
  ].join('\n');

  return /ENOENT|EACCES|EPERM|command not found|permission denied|no such file or directory|ECONNREFUSED|ENOTFOUND/i.test(text);
}

function retriesAreConcentrated(evidence: WorkflowRunEvidence): boolean {
  return evidence.steps.some((step) => step.retries.length >= RETRY_OVERFLOW_THRESHOLD);
}

function stepHasBrittleGrep(step: WorkflowStepEvidence): boolean {
  return step.verifications.some((v) => !v.passed && textOfVerification(v).includes('grep')) ||
    step.deterministicGates.some((g) => !g.passed && textOfGate(g).includes('grep'));
}

function isMissingFileVerification(verification: VerificationResult): boolean {
  if (!verification.passed && (verification.type === 'file_exists' || verification.type === 'artifact_exists')) {
    return true;
  }
  return !verification.passed && /file|artifact|materializ|not found|no such file|missing/i.test(textOfVerification(verification));
}

function failedVerifications(
  evidence: WorkflowRunEvidence,
): Array<{ step: WorkflowStepEvidence; verification: VerificationResult }> {
  return evidence.steps.flatMap((step) =>
    step.verifications.filter((verification) => !verification.passed).map((verification) => ({ step, verification })),
  );
}

function failedGates(
  evidence: WorkflowRunEvidence,
): Array<{ step: WorkflowStepEvidence | null; gate: DeterministicGateResult }> {
  return [
    ...evidence.deterministicGates.filter((gate) => !gate.passed).map((gate) => ({ step: null, gate })),
    ...evidence.steps.flatMap((step) =>
      step.deterministicGates.filter((gate) => !gate.passed).map((gate) => ({ step, gate })),
    ),
  ];
}

function allGates(evidence: WorkflowRunEvidence): DeterministicGateResult[] {
  return [...evidence.deterministicGates, ...evidence.steps.flatMap((step) => step.deterministicGates)];
}

function textOfVerification(verification: VerificationResult): string {
  return rawTextOfVerification(verification).toLowerCase();
}

function rawTextOfVerification(verification: VerificationResult): string {
  return [
    verification.type,
    verification.expected,
    verification.actual,
    verification.message,
    verification.command,
    verification.stdoutExcerpt,
    verification.stderrExcerpt,
    verification.outputExcerpt,
  ].filter(Boolean).join('\n');
}

function textOfGate(gate: DeterministicGateResult): string {
  return rawTextOfGate(gate).toLowerCase();
}

function rawTextOfGate(gate: DeterministicGateResult): string {
  return [
    gate.gateName,
    gate.command,
    gate.stdoutExcerpt,
    gate.stderrExcerpt,
    gate.outputExcerpt,
    ...gate.verifications.map(rawTextOfVerification),
  ].filter(Boolean).join('\n');
}

function parseStepId(source: string): string | null {
  const match = /^step:([^/\s]+)/.exec(source);
  return match?.[1] ?? null;
}

function signal(observation: string, source: string, strength: Confidence): EvidenceSignal {
  return { observation, source, strength };
}

function dedupeSignals(signals: EvidenceSignal[]): EvidenceSignal[] {
  const seen = new Set<string>();
  return signals.filter((item) => {
    const key = `${item.source}:${item.observation}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function extractPaths(text: string): string[] {
  const matches = text.match(/(?:\.{1,2}\/|\/|[\w.-]+\/)[\w./@-]+\.[A-Za-z0-9]+/g) ?? [];
  return [...new Set(matches.map((match) => match.replace(/[),.;:'"]+$/g, '')))];
}
