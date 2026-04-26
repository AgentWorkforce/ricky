import { evaluateProofLoop } from './proof-loop.js';
import { runStructuralChecks } from './structural-checks.js';
import { DEFAULT_PROOF_LOOP_CONFIG, type SignoffVerdict, type ValidatorInput, type ValidatorResult } from './types.js';

export function validateWorkflow(input: ValidatorInput): ValidatorResult {
  const structuralFindings = runStructuralChecks(input.workflowText);
  const proofLoopConfig = { ...DEFAULT_PROOF_LOOP_CONFIG, ...input.proofLoopConfig };
  const proofLoopSteps = evaluateProofLoop({
    dryRunResult: input.dryRunResult,
    finalDryRunResult: input.finalDryRunResult,
    buildResult: input.buildResult,
    testResult: input.testResult,
    regressionResults: input.regressionResults,
    fixAttempts: input.fixAttempts,
    config: proofLoopConfig,
  });

  const blockingFindings = structuralFindings.filter((finding) => !finding.passed && finding.blocking);
  const warningFindings = structuralFindings.filter((finding) => !finding.passed && finding.severity === 'warning');
  const blockingProofSteps = proofLoopSteps.filter((step) => !step.passed && step.blocking);
  const warningProofSteps = proofLoopSteps.filter((step) => step.severity === 'warning');
  const allStructuralChecksPassed = blockingFindings.length === 0;
  const allProofLoopStepsPassed = blockingProofSteps.length === 0;
  const hasDeterministicVerification = structuralFindings
    .filter((finding) => finding.check === 'deterministic_steps' || finding.check === 'deterministic_gates' || finding.check === 'verification_language' || finding.check === 'initial_soft_gate' || finding.check === 'final_hard_gate')
    .every((finding) => finding.passed);
  const totalWarnings = warningFindings.length + warningProofSteps.length;
  const signoff = deriveSignoff({
    allStructuralChecksPassed,
    allProofLoopStepsPassed,
    hasWarnings: totalWarnings > 0,
    hasDeterministicVerification,
  });

  return {
    workflowId: input.workflowId,
    workflowName: input.workflowName,
    structuralFindings,
    proofLoopSteps,
    signoff,
    ready: signoff === 'approved',
    summary: summarize(signoff, blockingFindings.length, blockingProofSteps.length, totalWarnings),
    allStructuralChecksPassed,
    allProofLoopStepsPassed,
    blockingFindings,
    warningFindings,
    blockingProofSteps,
    warningProofSteps,
    validatedAt: input.validatedAt ?? new Date().toISOString(),
  };
}

function deriveSignoff(input: {
  allStructuralChecksPassed: boolean;
  allProofLoopStepsPassed: boolean;
  hasWarnings: boolean;
  hasDeterministicVerification: boolean;
}): SignoffVerdict {
  if (!input.allStructuralChecksPassed || !input.allProofLoopStepsPassed || !input.hasDeterministicVerification) {
    return 'rejected';
  }

  if (input.hasWarnings) {
    return 'conditional';
  }

  return 'approved';
}

function summarize(
  signoff: SignoffVerdict,
  structuralBlockers: number,
  proofBlockers: number,
  warnings: number,
): string {
  if (signoff === 'approved') {
    return 'Workflow validator approved signoff: structural checks, deterministic verification, proof loop, build/typecheck, and regression gates passed.';
  }

  if (signoff === 'conditional') {
    return `Workflow validator returned conditional signoff with ${warnings} warning(s); ready status is withheld until warnings are reviewed.`;
  }

  return `Workflow validator rejected signoff: ${structuralBlockers} structural blocker(s), ${proofBlockers} proof-loop blocker(s), and ${warnings} warning(s).`;
}
