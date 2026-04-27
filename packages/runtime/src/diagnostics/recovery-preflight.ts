import type { ActiveRunSnapshot } from '../types.js';
import {
  diagnose,
  type BlockerClass,
  type DiagnosticSignal,
  type FailureTaxonomyCategory,
  type RecoveryRecommendation,
} from './failure-diagnosis.js';

export type PreflightIssueCode =
  | 'stale_relay_state'
  | 'missing_config'
  | 'unsupported_validation_command'
  | 'already_running'
  | 'repo_validation_mismatch';

export interface RelayStateObservation {
  path: string;
  present: boolean;
  stale?: boolean;
  ageMs?: number;
}

export interface RequiredConfigObservation {
  path: string;
  present: boolean;
  description?: string;
}

export interface ValidationCommandObservation {
  command: string;
  supported: boolean;
  reason?: string;
}

export interface RepoValidationObservation {
  command: string;
  meaningful: boolean;
  reason?: string;
}

export interface RuntimePreflightInput {
  cwd: string;
  requestedRunId?: string;
  requestedWorkflowFile?: string;
  relayState?: RelayStateObservation[];
  requiredConfig?: RequiredConfigObservation[];
  validationCommands?: ValidationCommandObservation[];
  repoValidation?: RepoValidationObservation;
  activeRuns?: ActiveRunSnapshot[];
}

export interface RuntimePreflightIssue {
  code: PreflightIssueCode;
  blockerClass: BlockerClass;
  taxonomyCategory: FailureTaxonomyCategory;
  blocking: boolean;
  message: string;
  recommendation: RecoveryRecommendation;
  operatorAction: string;
  rationale: string;
  /** Preflight never performs cleanup, repair, rollback, or launch side effects. */
  destructiveCleanupAllowed: false;
  evidence: unknown;
}

export interface RuntimePreflightResult {
  ok: boolean;
  issues: RuntimePreflightIssue[];
}

export function runRuntimePreflight(input: RuntimePreflightInput): RuntimePreflightResult {
  const issues: RuntimePreflightIssue[] = [];

  for (const relayState of input.relayState ?? []) {
    if (relayState.present && relayState.stale !== false) {
      issues.push(
        buildIssue({
          code: 'stale_relay_state',
          signal: {
            source: 'relay',
            message: `stale relay state detected at ${relayState.path}`,
            meta: { relayStale: true },
          },
          message: `Stale relay state is present at ${relayState.path}.`,
          evidence: relayState,
        }),
      );
    }
  }

  for (const config of input.requiredConfig ?? []) {
    if (!config.present) {
      issues.push(
        buildIssue({
          code: 'missing_config',
          signal: {
            source: 'config',
            message: `missing config ${config.path}`,
            meta: { missingConfig: true },
          },
          message: `${config.description ?? 'Required config'} is missing at ${config.path}.`,
          evidence: config,
        }),
      );
    }
  }

  for (const command of input.validationCommands ?? []) {
    if (!command.supported) {
      issues.push(
        buildIssue({
          code: 'unsupported_validation_command',
          signal: {
            source: 'validation-command',
            message: command.reason ?? `unsupported validation command: ${command.command}`,
            meta: { unsupportedValidationCommand: true },
          },
          message: `Validation command is unsupported in this repository: ${command.command}.`,
          evidence: command,
        }),
      );
    }
  }

  const activeRun = (input.activeRuns ?? []).find((run) => {
    const overlapsById = input.requestedRunId !== undefined && run.runId === input.requestedRunId;
    const overlapsByTarget =
      input.requestedWorkflowFile !== undefined &&
      run.workflowFile === input.requestedWorkflowFile &&
      run.cwd === input.cwd;
    return (run.status === 'running' || run.status === 'pending') && (overlapsById || overlapsByTarget);
  });
  if (activeRun) {
    issues.push(
      buildIssue({
        code: 'already_running',
        signal: {
          source: 'active-run',
          message: `run ${activeRun.runId} is already active`,
          meta: { alreadyRunning: true },
        },
        message: `Run ${activeRun.runId} is already active for this launch target.`,
        evidence: activeRun,
      }),
    );
  }

  if (input.repoValidation && !input.repoValidation.meaningful) {
    issues.push(
      buildIssue({
        code: 'repo_validation_mismatch',
        signal: {
          source: 'repo-validation',
          message: input.repoValidation.reason ?? `repo validation mismatch for ${input.repoValidation.command}`,
          meta: { repoMismatch: true },
        },
        message: `Repo validation command does not match this repository shape: ${input.repoValidation.command}.`,
        evidence: input.repoValidation,
      }),
    );
  }

  return { ok: issues.length === 0, issues };
}

function buildIssue(input: {
  code: PreflightIssueCode;
  signal: DiagnosticSignal;
  message: string;
  evidence: unknown;
}): RuntimePreflightIssue {
  const diagnosis = diagnose(input.signal);
  if (!diagnosis) {
    throw new Error(`No diagnosis rule for preflight issue "${input.code}"`);
  }

  return {
    code: input.code,
    blockerClass: diagnosis.blockerClass,
    taxonomyCategory: diagnosis.taxonomyCategory,
    blocking: !diagnosis.unblocker.recovery.rerunAllowed,
    message: input.message,
    recommendation: diagnosis.unblocker.recovery,
    operatorAction: diagnosis.unblocker.action,
    rationale: diagnosis.unblocker.rationale,
    destructiveCleanupAllowed: false,
    evidence: input.evidence,
  };
}
