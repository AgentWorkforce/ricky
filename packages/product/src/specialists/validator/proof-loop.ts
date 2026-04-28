import { diagnose } from '@ricky/runtime/diagnostics/failure-diagnosis';
import type { CommandResult, ProofLoopConfig, ProofLoopStep, ValidationRecovery } from './types.js';

export interface ProofLoopInput {
  dryRunResult?: CommandResult;
  finalDryRunResult?: CommandResult;
  buildResult?: CommandResult;
  testResult?: CommandResult;
  regressionResults?: CommandResult[];
  fixAttempts?: number;
  config: ProofLoopConfig;
}

export function evaluateProofLoop(input: ProofLoopInput): ProofLoopStep[] {
  const initialSoftRun = evaluateInitialSoftRun(input.dryRunResult, input.config.requireDryRun);
  const fixLoop = evaluateFixLoop(input.dryRunResult, input.fixAttempts, input.config.maxFixAttempts);
  const finalGate = evaluateFinalGate(input.finalDryRunResult, input.dryRunResult, input.config.requireDryRun);
  const buildGate = evaluateBuildGate(input.buildResult, input.config.requireBuild);
  const regressionGate = evaluateRegressionGate(input.testResult, input.regressionResults, input.config);

  return [initialSoftRun, fixLoop, finalGate, buildGate, regressionGate];
}

function evaluateInitialSoftRun(result: CommandResult | undefined, required: boolean): ProofLoopStep {
  if (!result) {
    return step({
      phase: 'initial_soft_run',
      passed: !required,
      blocking: required,
      severity: required ? 'error' : 'warning',
      message: required
        ? 'Initial soft dry-run result is missing; validator cannot prove the first 80-to-100 pass.'
        : 'Initial soft dry-run result was not provided.',
      fixHint: 'Provide the captured initial dry-run or validation command result with failOnError: false.',
    });
  }

  return step({
    phase: 'initial_soft_run',
    passed: true,
    blocking: false,
    severity: result.exitCode === 0 ? 'info' : 'warning',
    commandResult: result,
    recovery: result.exitCode === 0 ? undefined : deriveValidationRecovery(result),
    message: result.exitCode === 0
      ? 'Initial soft run completed without reported failures.'
      : 'Initial soft run found issues; this is allowed only if the fix loop and final hard gate pass.',
    fixHint: 'Use the soft-run output as fix-loop input.',
  });
}

function evaluateFixLoop(result: CommandResult | undefined, fixAttempts: number | undefined, maxFixAttempts: number): ProofLoopStep {
  if (!result) {
    return step({
      phase: 'fix_loop',
      passed: false,
      blocking: true,
      severity: 'error',
      message: 'Fix loop cannot be modeled without initial soft-run evidence.',
      fixHint: 'Capture initial soft-run output before fix-loop evaluation.',
    });
  }

  const attempts = fixAttempts ?? (result.exitCode === 0 ? 0 : 1);
  if (attempts > maxFixAttempts) {
    return step({
      phase: 'fix_loop',
      passed: false,
      blocking: true,
      severity: 'error',
      commandResult: result,
      message: `Fix loop exceeded max attempts (${attempts}/${maxFixAttempts}).`,
      fixHint: 'Escalate or narrow the workflow scope before another fix attempt.',
    });
  }

  if (result.exitCode !== 0 && attempts === 0) {
    return step({
      phase: 'fix_loop',
      passed: false,
      blocking: true,
      severity: 'error',
      commandResult: result,
      message: 'Soft run failed but no fix attempts were made; at least one fix attempt is required.',
      fixHint: 'Set fixAttempts >= 1 or provide post-fix evidence showing the issues were addressed.',
    });
  }

  return step({
    phase: 'fix_loop',
    passed: true,
    blocking: false,
    severity: result.exitCode === 0 ? 'info' : 'warning',
    commandResult: result,
    message: result.exitCode === 0
      ? 'No fix loop was needed after the soft run.'
      : `Fix loop modeled from soft-run failures with ${attempts} attempt(s).`,
    fixHint: 'Proceed only if post-fix validation and final hard gates pass.',
  });
}

function evaluateFinalGate(finalResult: CommandResult | undefined, initialResult: CommandResult | undefined, required: boolean): ProofLoopStep {
  if (!finalResult && initialResult && required) {
    return step({
      phase: 'final_gate',
      passed: false,
      blocking: true,
      severity: 'error',
      message: 'Final hard gate requires distinct post-fix evidence; cannot reuse the initial soft-run result.',
      fixHint: 'Provide a separate finalDryRunResult captured after fixes, not the initial dryRunResult.',
    });
  }

  const result = finalResult;
  if (!result) {
    return step({
      phase: 'final_gate',
      passed: !required,
      blocking: required,
      severity: required ? 'error' : 'warning',
      message: required
        ? 'Final hard gate result is missing.'
        : 'Final hard gate result was not provided.',
      fixHint: 'Provide the final post-fix dry-run/validation result captured from a failOnError: true gate.',
    });
  }

  return step({
    phase: 'final_gate',
    passed: result.exitCode === 0,
    blocking: result.exitCode !== 0,
    severity: result.exitCode === 0 ? 'info' : 'error',
    commandResult: result,
    recovery: result.exitCode === 0 ? undefined : deriveValidationRecovery(result),
    message: result.exitCode === 0
      ? 'Final hard gate passed.'
      : 'Final hard gate failed.',
    fixHint: 'Fix final hard-gate failures before signoff can become ready.',
  });
}

function evaluateBuildGate(result: CommandResult | undefined, required: boolean): ProofLoopStep {
  if (!result) {
    return step({
      phase: 'build_typecheck_gate',
      passed: !required,
      blocking: required,
      severity: required ? 'error' : 'warning',
      message: required
        ? 'Build/typecheck gate result is missing.'
        : 'Build/typecheck gate result was not provided.',
      fixHint: 'Provide a captured build or typecheck result such as npx tsc --noEmit.',
    });
  }

  return step({
    phase: 'build_typecheck_gate',
    passed: result.exitCode === 0,
    blocking: result.exitCode !== 0,
    severity: result.exitCode === 0 ? 'info' : 'error',
    commandResult: result,
    recovery: result.exitCode === 0 ? undefined : deriveValidationRecovery(result),
    message: result.exitCode === 0
      ? 'Build/typecheck gate passed.'
      : 'Build/typecheck gate failed.',
    fixHint: 'Resolve build/typecheck failures before signoff.',
  });
}

function evaluateRegressionGate(
  testResult: CommandResult | undefined,
  regressionResults: CommandResult[] | undefined,
  config: ProofLoopConfig,
): ProofLoopStep {
  const results = [...(testResult ? [testResult] : []), ...(regressionResults ?? [])];
  if (results.length === 0) {
    const required = config.requireTest || config.requireRegression;
    return step({
      phase: 'regression_gate',
      passed: !required,
      blocking: required,
      severity: required ? 'error' : 'warning',
      message: required
        ? 'Regression gate result is missing.'
        : 'No regression checks were provided.',
      fixHint: 'Provide captured test/regression command results scoped to declared workflow targets.',
    });
  }

  const failed = results.find((result) => result.exitCode !== 0);
  return step({
    phase: 'regression_gate',
    passed: !failed,
    blocking: Boolean(failed),
    severity: failed ? 'error' : 'info',
    commandResult: failed ?? results[0],
    recovery: failed ? deriveValidationRecovery(failed) : undefined,
    message: failed
      ? `Regression gate failed: ${failed.command}.`
      : 'Regression gate passed.',
    fixHint: 'Fix regression failures and rerun the scoped regression gate before signoff.',
  });
}

function step(input: ProofLoopStep): ProofLoopStep {
  return input;
}

function deriveValidationRecovery(result: CommandResult): ValidationRecovery | undefined {
  const text = [result.command, result.stdout, result.stderr].filter(Boolean).join('\n');
  const signal = unsupportedValidationCommand(text)
    ? {
        source: 'validation-command',
        message: text,
        meta: { unsupportedValidationCommand: true },
      }
    : repoValidationMismatch(text)
      ? {
          source: 'repo-validation',
          message: text,
          meta: { repoMismatch: true },
        }
      : undefined;

  if (!signal) return undefined;

  const diagnosis = diagnose(signal);
  if (!diagnosis) return undefined;

  return {
    taxonomyCategory: diagnosis.taxonomyCategory,
    recommendation: diagnosis.unblocker.recovery,
    operatorAction: diagnosis.unblocker.action,
    rationale: diagnosis.unblocker.rationale,
  };
}

function unsupportedValidationCommand(text: string): boolean {
  return /unsupported.*validation|validation.*unsupported|unknown option|missing script|command not found|npm ERR! missing script/i.test(text);
}

function repoValidationMismatch(text: string): boolean {
  return /repo.*validation.*mismatch|validation.*repo.*mismatch|not meaningful|not configured|no inputs were found|cannot find.*tsconfig|tsconfig.*not found|root tsconfig/i.test(text);
}
