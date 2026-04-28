import { Confidence } from '@ricky/runtime/failure/types';
import type {
  RuntimePreflightIssue,
  RuntimePreflightResult,
} from '@ricky/runtime/diagnostics/index';
import type {
  DeterministicGateResult,
  VerificationResult,
  WorkflowRunEvidence,
} from '@ricky/shared/models/workflow-evidence';
import {
  DEFAULT_REPAIR_POLICY,
  type Diagnosis,
  type FixAction,
  type FixRecommendation,
  type FixScope,
  type FixStep,
  type RepairPolicy,
  type VerificationPlan,
  type WorkflowCause,
} from './types.js';

export function recommendFix(
  diagnosis: Diagnosis,
  evidence: WorkflowRunEvidence,
  policy?: Partial<RepairPolicy>,
  environmentPreflight?: RuntimePreflightResult,
): FixRecommendation {
  const resolvedPolicy = resolvePolicy(policy);

  if (environmentPreflight && environmentPreflight.issues.length > 0) {
    return preflightRecommendation(environmentPreflight, resolvedPolicy);
  }

  const primary = diagnosis.primaryCause;
  const steps = buildFixSteps(primary, evidence, resolvedPolicy);
  const scope = mergeScope(steps, primary, resolvedPolicy);
  const confidence = recommendationConfidence(primary, steps);
  const provisional: FixRecommendation = {
    steps,
    directRepairEligible: false,
    confidence,
    scope,
    summary: summarizeRecommendation(primary, steps),
  };
  const eligibility = isDirectRepairEligible(provisional, resolvedPolicy, diagnosis);

  return {
    ...provisional,
    directRepairEligible: eligibility.eligible,
    ...(eligibility.reason ? { directRepairRefusalReason: eligibility.reason } : {}),
  };
}

export function isDirectRepairEligible(
  recommendation: FixRecommendation,
  policy: RepairPolicy,
  diagnosis?: Diagnosis,
): { eligible: boolean; reason?: string } {
  if (!policy.allowDirectRepair) {
    return { eligible: false, reason: 'Direct repair is disabled by policy.' };
  }

  if (recommendation.preflightIssues?.length) {
    return { eligible: false, reason: 'Preflight recommendations must be resolved before direct repair.' };
  }

  if (diagnosis && policy.directRepairBlocklist.includes(diagnosis.runtimeClassification.failureClass)) {
    return {
      eligible: false,
      reason: `Direct repair is blocked for ${diagnosis.runtimeClassification.failureClass} failures.`,
    };
  }

  if (confidenceRank(recommendation.confidence) < confidenceRank(policy.minimumDirectRepairConfidence)) {
    return { eligible: false, reason: 'Evidence confidence is too weak for direct repair.' };
  }

  if (recommendation.scope.filesLikelyTouched.length > policy.maxFilesTouch) {
    return {
      eligible: false,
      reason: `Likely repair scope touches ${recommendation.scope.filesLikelyTouched.length} files, above policy limit ${policy.maxFilesTouch}.`,
    };
  }

  if (!recommendation.scope.bounded) {
    return { eligible: false, reason: recommendation.scope.rationale };
  }

  if (recommendation.steps.length === 0) {
    return { eligible: false, reason: 'No bounded fix step is available.' };
  }

  if (recommendation.steps.some((step) => step.action === 'escalate' || step.action === 'abort')) {
    return { eligible: false, reason: 'Recommendation requires human escalation.' };
  }

  if (recommendation.steps.some((step) => step.action === 'fix_environment') && !policy.allowEnvironmentFixes) {
    return { eligible: false, reason: 'Environment changes are disabled by policy.' };
  }

  if (diagnosis?.primaryCause.ambiguousProductIntent) {
    return { eligible: false, reason: 'Product or user intent is ambiguous from the available evidence.' };
  }

  if (recommendation.steps.some((s) => !s.verificationPlan.deterministic || s.verificationPlan.commands.length === 0)) {
    return { eligible: false, reason: 'Direct repair requires deterministic verification with runnable commands.' };
  }

  return { eligible: true };
}

function buildFixSteps(
  cause: WorkflowCause,
  evidence: WorkflowRunEvidence,
  policy: RepairPolicy,
): FixStep[] {
  switch (cause.category) {
    case 'missing_deterministic_gate':
      return [
        fixStep(
          'add_deterministic_gate',
          'Add or restore a deterministic gate for the failed workflow path.',
          cause,
          policy,
          verificationFromFailedChecks(evidence, ['Run the restored deterministic gate and require a passing result.']),
        ),
      ];
    case 'wrong_pattern_choice':
      return [
        fixStep(
          'change_pattern',
          'Re-evaluate the workflow pattern and dependencies before regenerating or editing the workflow.',
          cause,
          policy,
          manualVerification('Pattern changes need review against the original product intent.'),
        ),
      ];
    case 'oversized_agent_step':
      return [
        fixStep(
          'retry_with_smaller_scope',
          'Split the oversized agent step into smaller bounded steps, then rerun the affected step path.',
          cause,
          policy,
          verificationFromFailedChecks(evidence, ['Rerun the affected step path with fewer retries and passing gates.']),
        ),
      ];
    case 'missing_file_materialization':
      return [
        fixStep(
          'add_missing_artifact',
          'Create or correctly route the missing file or artifact expected by the failed gate.',
          cause,
          policy,
          fileVerification(cause.filesLikelyTouched, evidence),
        ),
      ];
    case 'brittle_grep_gate':
      return [
        fixStep(
          'replace_brittle_grep',
          'Replace the brittle grep gate with a more targeted deterministic check for the artifact contract.',
          cause,
          policy,
          verificationFromFailedChecks(evidence, ['The replacement check passes and still fails on missing required content.']),
        ),
      ];
    case 'environment_prerequisite':
      return [
        fixStep(
          'fix_environment',
          'Install or configure the missing environment prerequisite, then rerun the failing command.',
          cause,
          policy,
          verificationFromFailedChecks(evidence, ['The original environment check exits successfully.']),
        ),
      ];
    case 'agent_drift':
      return [
        fixStep(
          'fix_step_task',
          'Tighten the step task contract so the agent produces the expected artifact and evidence.',
          cause,
          policy,
          verificationFromFailedChecks(evidence, ['The affected step output satisfies its deterministic checks.']),
        ),
      ];
    case 'step_contract_violation':
      return [
        fixStep(
          'fix_verification',
          'Align the step task and verification contract with the expected workflow output.',
          cause,
          policy,
          verificationFromFailedChecks(evidence, ['The failed verification passes without weakening product intent.']),
        ),
      ];
    case 'workflow_structure':
      return [
        fixStep(
          'restructure_workflow',
          'Review and restructure workflow dependencies before retrying.',
          cause,
          policy,
          manualVerification('Structural workflow changes need human review before execution.'),
        ),
      ];
    case 'timeout_budget':
      return [
        fixStep(
          'retry_step',
          'Retry the timed-out step with a smaller work unit or a justified timeout budget.',
          cause,
          policy,
          verificationFromFailedChecks(evidence, ['The timed-out path reaches a terminal passing state.']),
        ),
      ];
    case 'retry_exhaustion':
      return [
        fixStep(
          'escalate',
          'Escalate because retries are distributed and do not identify a bounded repair target.',
          cause,
          policy,
          manualVerification('A human must identify the failing intent before another repair attempt.'),
        ),
      ];
    case 'unknown':
      return [
        fixStep(
          'escalate',
          'Collect more deterministic evidence before attempting repair.',
          cause,
          policy,
          manualVerification('Add failure evidence, rerun classification, and verify a specific cause.'),
        ),
      ];
  }
}

function preflightRecommendation(
  preflight: RuntimePreflightResult,
  policy: RepairPolicy,
): FixRecommendation {
  const steps = preflight.issues.map((issue) => preflightStep(issue, policy));
  const blockingCount = preflight.issues.filter((issue) => issue.blocking).length;
  return {
    steps,
    directRepairEligible: false,
    directRepairRefusalReason: blockingCount > 0
      ? 'Environment preflight must be resolved before repair or rerun.'
      : 'Validation preflight recommendations must be reviewed before rerun.',
    preflightIssues: preflight.issues,
    confidence: Confidence.High,
    scope: {
      targetStepIds: [],
      filesLikelyTouched: [],
      maxFilesToTouch: policy.maxFilesTouch,
      bounded: true,
      rationale: 'Recovery scope is bounded to operator preflight recommendations; Ricky does not mutate cleanup or validation state here.',
    },
    summary: `Preflight found ${preflight.issues.length} recovery recommendation(s); resolve them before direct repair or rerun.`,
  };
}

function preflightStep(issue: RuntimePreflightIssue, policy: RepairPolicy): FixStep {
  return {
    action: actionForPreflightIssue(issue),
    description: issue.operatorAction,
    targetStepId: null,
    filesToTouch: [],
    scope: {
      targetStepIds: [],
      filesLikelyTouched: [],
      maxFilesToTouch: policy.maxFilesTouch,
      bounded: true,
      rationale: 'Preflight guidance is bounded and recommendation-only.',
    },
    confidence: Confidence.High,
    verificationPlan: {
      commands: [],
      expectations: [
        issue.rationale,
        `Taxonomy: ${issue.taxonomyCategory}; restart decision: ${issue.recommendation.decision}.`,
      ],
      deterministic: false,
    },
  };
}

function actionForPreflightIssue(issue: RuntimePreflightIssue): FixAction {
  switch (issue.code) {
    case 'already_running':
      return 'wait_for_active_run';
    case 'unsupported_validation_command':
    case 'repo_validation_mismatch':
      return 'replace_validation_command';
    case 'stale_relay_state':
    case 'missing_config':
      return 'fix_environment';
  }
}

function fixStep(
  action: FixAction,
  description: string,
  cause: WorkflowCause,
  policy: RepairPolicy,
  verificationPlan: VerificationPlan,
): FixStep {
  const scope = scopeFor(cause, policy);
  return {
    action,
    description,
    targetStepId: cause.affectedStepIds[0] ?? null,
    filesToTouch: scope.filesLikelyTouched,
    scope,
    confidence: cause.confidence,
    verificationPlan,
  };
}

function scopeFor(cause: WorkflowCause, policy: RepairPolicy): FixScope {
  const files = [...new Set(cause.filesLikelyTouched)].sort();
  const allowsNoFileRepair = cause.category === 'timeout_budget' || cause.category === 'environment_prerequisite';
  const bounded = !cause.ambiguousProductIntent &&
    files.length <= policy.maxFilesTouch &&
    (files.length > 0 || allowsNoFileRepair);

  return {
    targetStepIds: cause.affectedStepIds,
    filesLikelyTouched: files,
    maxFilesToTouch: policy.maxFilesTouch,
    bounded,
    rationale: bounded
      ? `Repair scope is bounded to ${files.length} likely file(s).`
      : 'Repair scope is not bounded enough for direct repair.',
  };
}

function mergeScope(steps: FixStep[], cause: WorkflowCause, policy: RepairPolicy): FixScope {
  if (steps.length === 0) return scopeFor(cause, policy);
  const files = [...new Set(steps.flatMap((step) => step.scope.filesLikelyTouched))].sort();
  const stepIds = [...new Set(steps.flatMap((step) => step.scope.targetStepIds))].sort();
  const bounded = steps.every((step) => step.scope.bounded) && files.length <= policy.maxFilesTouch;
  return {
    targetStepIds: stepIds,
    filesLikelyTouched: files,
    maxFilesToTouch: policy.maxFilesTouch,
    bounded,
    rationale: bounded
      ? `Repair scope is bounded to ${files.length} likely file(s).`
      : 'Combined repair scope is too broad or ambiguous for direct repair.',
  };
}

function verificationFromFailedChecks(
  evidence: WorkflowRunEvidence,
  fallbackExpectations: string[],
): VerificationPlan {
  const commands = [
    ...failedVerifications(evidence).map((verification) => verification.command),
    ...failedGates(evidence).map((gate) => gate.command),
    ...failedRetryVerifications(evidence).map((verification) => verification.command),
    ...failedRetryCommands(evidence),
  ].filter((command): command is string => Boolean(command));

  return {
    commands: [...new Set(commands)],
    expectations: fallbackExpectations,
    deterministic: commands.length > 0,
  };
}

function fileVerification(files: string[], evidence: WorkflowRunEvidence): VerificationPlan {
  const commands = files.length > 0
    ? files.map((file) => `test -e ${shellQuote(file)}`)
    : verificationFromFailedChecks(evidence, []).commands;

  return {
    commands,
    expectations: files.length > 0
      ? files.map((file) => `${file} exists and is referenced by workflow evidence.`)
      : ['The missing artifact path is identified and then checked deterministically.'],
    deterministic: commands.length > 0,
  };
}

function manualVerification(expectation: string): VerificationPlan {
  return {
    commands: [],
    expectations: [expectation],
    deterministic: false,
  };
}

function recommendationConfidence(cause: WorkflowCause, steps: FixStep[]): Confidence {
  if (steps.some((step) => step.action === 'escalate' || step.action === 'abort')) return Confidence.Low;
  return cause.confidence;
}

function summarizeRecommendation(cause: WorkflowCause, steps: FixStep[]): string {
  if (steps.length === 0) return `No fix is available for ${cause.category}.`;
  return `${steps[0].description} Direct repair requires bounded scope and sufficient evidence.`;
}

function resolvePolicy(policy?: Partial<RepairPolicy>): RepairPolicy {
  return {
    ...DEFAULT_REPAIR_POLICY,
    ...policy,
    directRepairBlocklist: policy?.directRepairBlocklist ?? DEFAULT_REPAIR_POLICY.directRepairBlocklist,
  };
}

function failedVerifications(evidence: WorkflowRunEvidence): VerificationResult[] {
  return evidence.steps.flatMap((step) => step.verifications.filter((verification) => !verification.passed));
}

function failedRetryVerifications(evidence: WorkflowRunEvidence): VerificationResult[] {
  return evidence.steps.flatMap((step) =>
    step.retries.flatMap((retry) =>
      (retry.verifications ?? []).filter((verification) => !verification.passed),
    ),
  );
}

function failedRetryCommands(evidence: WorkflowRunEvidence): string[] {
  return evidence.steps.flatMap((step) =>
    step.retries
      .filter((retry) => retry.status === 'failed' || retry.status === 'timed_out')
      .map((retry) => retry.command)
      .filter((command): command is string => Boolean(command)),
  );
}

function failedGates(evidence: WorkflowRunEvidence): DeterministicGateResult[] {
  return [
    ...evidence.deterministicGates.filter((gate) => !gate.passed),
    ...evidence.steps.flatMap((step) => step.deterministicGates.filter((gate) => !gate.passed)),
  ];
}

function confidenceRank(confidence: Confidence): number {
  if (confidence === Confidence.High) return 3;
  if (confidence === Confidence.Medium) return 2;
  return 1;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}
