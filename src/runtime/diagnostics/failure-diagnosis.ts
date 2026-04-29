/**
 * Failure Diagnosis Engine
 *
 * Classifies runtime blockers into distinct classes and returns
 * class-specific unblocker guidance. Deterministic, no side effects.
 */

// ── Blocker Classes ────────────────────────────────────────────────

export const BlockerClass = {
  RuntimeHandoffStall: 'runtime-handoff-stall',
  OpaqueProgress: 'opaque-progress',
  StaleRelayState: 'stale-relay-state',
  MissingConfig: 'missing-config',
  UnsupportedValidationCommand: 'unsupported-validation-command',
  AlreadyRunning: 'already-running',
  ControlFlowBreakage: 'control-flow-breakage',
  RepoValidationMismatch: 'repo-validation-mismatch',
} as const;

export type BlockerClass = (typeof BlockerClass)[keyof typeof BlockerClass];

export const FailureTaxonomyCategory = {
  AgentRuntimeHandoffStalled: 'agent_runtime.handoff_stalled',
  AgentRuntimeProgressOpaque: 'agent_runtime.progress_opaque',
  EnvironmentRelayStateContaminated: 'environment.relay_state_contaminated',
  EnvironmentMissingConfig: 'environment.missing_config',
  EnvironmentAlreadyRunning: 'environment.already_running',
  WorkflowStructureControlFlowInvalid: 'workflow_structure.control_flow_invalid',
  ValidationStrategyUnsupportedCommand: 'validation_strategy.unsupported_command',
  ValidationStrategyRepoMismatch: 'validation_strategy.repo_mismatch',
} as const;

export type FailureTaxonomyCategory =
  (typeof FailureTaxonomyCategory)[keyof typeof FailureTaxonomyCategory];

export const RecoveryDecision = {
  RestartRuntime: 'restart_runtime',
  ProbeBeforeRerun: 'probe_before_rerun',
  BlockRerun: 'block_rerun',
  ReplaceValidation: 'replace_validation',
  PatchWorkflowBeforeRerun: 'patch_workflow_before_rerun',
} as const;

export type RecoveryDecision = (typeof RecoveryDecision)[keyof typeof RecoveryDecision];

export const RerunMode = {
  None: 'none',
  StepRetry: 'step_retry',
  FullRerun: 'full_rerun',
  Resume: 'resume',
} as const;

export type RerunMode = (typeof RerunMode)[keyof typeof RerunMode];

// ── Signal shape fed into the engine ───────────────────────────────

export interface DiagnosticSignal {
  /** Which subsystem reported the failure */
  source: string;
  /** Free-form error message or description */
  message: string;
  /** Optional structured metadata from the runtime */
  meta?: Record<string, unknown>;
}

// ── Diagnosis result ───────────────────────────────────────────────

export interface Diagnosis {
  blockerClass: BlockerClass;
  /** Dotted category used by Ricky's product failure taxonomy. */
  taxonomyCategory: FailureTaxonomyCategory;
  /** Human-readable label for the blocker */
  label: string;
  /** Class-specific guidance on how to unblock */
  unblocker: UnblockerGuidance;
}

export interface UnblockerGuidance {
  /** Short imperative action the operator should take */
  action: string;
  /** Why this action resolves the blocker */
  rationale: string;
  /** Conservative rerun/restart decision aligned to taxonomy. */
  recovery: RecoveryRecommendation;
  /** If true, the action can be attempted automatically */
  automatable: boolean;
}

export interface RecoveryRecommendation {
  decision: RecoveryDecision;
  rerunMode: RerunMode;
  /** Whether Ricky may start another run without operator confirmation. */
  rerunAllowed: boolean;
  /** Whether the recommendation would require cleanup, writes, repair, or rollback. */
  requiresMutation: boolean;
  reason: string;
}

// ── Classification rules (order matters — first match wins) ───────

interface Rule {
  blockerClass: BlockerClass;
  taxonomyCategory: FailureTaxonomyCategory;
  label: string;
  match: (signal: DiagnosticSignal) => boolean;
  unblocker: UnblockerGuidance;
}

const rules: readonly Rule[] = [
  {
    blockerClass: BlockerClass.RuntimeHandoffStall,
    taxonomyCategory: FailureTaxonomyCategory.AgentRuntimeHandoffStalled,
    label: 'Runtime handoff stall',
    match: (s) =>
      /handoff.*(stall|timeout|hung)/i.test(s.message) ||
      s.source === 'handoff' ||
      s.meta?.handoffStalled === true,
    unblocker: {
      action: 'Restart the stalled runtime step with a narrower handoff contract',
      rationale:
        'The handoff between runtimes has stalled, likely due to the target not acknowledging within the expected window.',
      recovery: {
        decision: RecoveryDecision.RestartRuntime,
        rerunMode: RerunMode.StepRetry,
        rerunAllowed: true,
        requiresMutation: false,
        reason: 'Agent-runtime stalls can be retried at the affected step after the stalled process is no longer active.',
      },
      automatable: true,
    },
  },
  {
    blockerClass: BlockerClass.OpaqueProgress,
    taxonomyCategory: FailureTaxonomyCategory.AgentRuntimeProgressOpaque,
    label: 'Opaque progress',
    match: (s) =>
      /opaque|no.progress|progress.unknown|unreadable.state/i.test(s.message) ||
      s.source === 'progress-monitor' ||
      s.meta?.progressOpaque === true,
    unblocker: {
      action: 'Inject a progress probe and wait for an explicit status heartbeat',
      rationale:
        'The runtime is running but its progress is not observable. A probe forces it to surface state.',
      recovery: {
        decision: RecoveryDecision.ProbeBeforeRerun,
        rerunMode: RerunMode.None,
        rerunAllowed: false,
        requiresMutation: false,
        reason: 'Progress opacity needs observation before Ricky can distinguish live work from a stalled run.',
      },
      automatable: true,
    },
  },
  {
    blockerClass: BlockerClass.StaleRelayState,
    taxonomyCategory: FailureTaxonomyCategory.EnvironmentRelayStateContaminated,
    label: 'Stale relay state',
    match: (s) =>
      /stale.*relay|relay.*stale|relay.*outdated|relay.*expired/i.test(s.message) ||
      s.source === 'relay' ||
      s.meta?.relayStale === true,
    unblocker: {
      action: 'Recommend operator-approved relay state quarantine or an isolated clean workspace before rerun',
      rationale:
        'Relay state has drifted from the source of truth. Continuing on stale state risks cascading errors, while automatic cleanup could destroy useful evidence.',
      recovery: {
        decision: RecoveryDecision.BlockRerun,
        rerunMode: RerunMode.None,
        rerunAllowed: false,
        requiresMutation: true,
        reason: 'A clean rerun first needs explicit approval to quarantine or isolate stale relay state.',
      },
      automatable: false,
    },
  },
  {
    blockerClass: BlockerClass.MissingConfig,
    taxonomyCategory: FailureTaxonomyCategory.EnvironmentMissingConfig,
    label: 'Missing runtime config',
    match: (s) =>
      /missing.*config|config.*missing|has not been configured|configuration.*required/i.test(s.message) ||
      s.source === 'config' ||
      s.meta?.missingConfig === true,
    unblocker: {
      action: 'Create or select the required Ricky configuration before launch',
      rationale:
        'The runtime cannot launch safely without knowing the intended local or workspace configuration.',
      recovery: {
        decision: RecoveryDecision.BlockRerun,
        rerunMode: RerunMode.None,
        rerunAllowed: false,
        requiresMutation: true,
        reason: 'Configuration must be supplied explicitly before a rerun can be meaningful.',
      },
      automatable: false,
    },
  },
  {
    blockerClass: BlockerClass.UnsupportedValidationCommand,
    taxonomyCategory: FailureTaxonomyCategory.ValidationStrategyUnsupportedCommand,
    label: 'Unsupported validation command',
    match: (s) =>
      /unsupported.*validation|validation.*unsupported|validation.*command|unknown option|missing script/i.test(s.message) ||
      s.source === 'validation-command' ||
      s.meta?.unsupportedValidationCommand === true,
    unblocker: {
      action: 'Replace the unsupported gate with a repo-supported targeted validation command',
      rationale:
        'A rerun using a command the repo cannot execute creates false failure evidence instead of proving the workflow.',
      recovery: {
        decision: RecoveryDecision.ReplaceValidation,
        rerunMode: RerunMode.FullRerun,
        rerunAllowed: true,
        requiresMutation: false,
        reason: 'The next rerun should use a truthful validation command, not the unsupported gate.',
      },
      automatable: false,
    },
  },
  {
    blockerClass: BlockerClass.AlreadyRunning,
    taxonomyCategory: FailureTaxonomyCategory.EnvironmentAlreadyRunning,
    label: 'Run already active',
    match: (s) =>
      /already.*running|already.*active|duplicate run|mid-run|active run/i.test(s.message) ||
      s.source === 'active-run' ||
      s.meta?.alreadyRunning === true,
    unblocker: {
      action: 'Monitor the active run or wait for it to finish before starting another run',
      rationale:
        'Launching a second run over the same workspace or run id can mix evidence and make recovery decisions unsafe.',
      recovery: {
        decision: RecoveryDecision.BlockRerun,
        rerunMode: RerunMode.None,
        rerunAllowed: false,
        requiresMutation: false,
        reason: 'An active run must reach a terminal state before Ricky starts an overlapping rerun.',
      },
      automatable: true,
    },
  },
  {
    blockerClass: BlockerClass.ControlFlowBreakage,
    taxonomyCategory: FailureTaxonomyCategory.WorkflowStructureControlFlowInvalid,
    label: 'Control-flow breakage',
    match: (s) =>
      /control.flow|unreachable|dead.branch|unexpected.branch|branch.miss/i.test(s.message) ||
      s.source === 'control-flow' ||
      s.meta?.controlFlowBroken === true,
    unblocker: {
      action: 'Patch the workflow control graph before any rerun',
      rationale:
        'An unexpected branch was taken in the control graph. Rerunning the same graph would reproduce the orchestration fault.',
      recovery: {
        decision: RecoveryDecision.PatchWorkflowBeforeRerun,
        rerunMode: RerunMode.None,
        rerunAllowed: false,
        requiresMutation: true,
        reason: 'The workflow structure must be repaired before rerun authority is safe.',
      },
      automatable: false,
    },
  },
  {
    blockerClass: BlockerClass.RepoValidationMismatch,
    taxonomyCategory: FailureTaxonomyCategory.ValidationStrategyRepoMismatch,
    label: 'Repo validation mismatch',
    match: (s) =>
      /repo.*valid|validation.*mismatch|schema.*mismatch|integrity.*fail/i.test(s.message) ||
      s.source === 'repo-validation' ||
      s.meta?.repoMismatch === true,
    unblocker: {
      action: 'Switch to a truthful targeted validation gate that matches the repository shape',
      rationale:
        'The repo state does not match the assumed validation strategy. A repair command would mutate state before proving the right gate.',
      recovery: {
        decision: RecoveryDecision.ReplaceValidation,
        rerunMode: RerunMode.FullRerun,
        rerunAllowed: true,
        requiresMutation: false,
        reason: 'A rerun is useful only after replacing the mismatched repo-wide gate with targeted validation.',
      },
      automatable: false,
    },
  },
] as const;

// ── Public API ─────────────────────────────────────────────────────

/**
 * Diagnose a single signal and return a typed Diagnosis.
 * Returns `null` when the signal does not match any known blocker class.
 */
export function diagnose(signal: DiagnosticSignal): Diagnosis | null {
  for (const rule of rules) {
    if (rule.match(signal)) {
      return {
        blockerClass: rule.blockerClass,
        taxonomyCategory: rule.taxonomyCategory,
        label: rule.label,
        unblocker: rule.unblocker,
      };
    }
  }
  return null;
}

/**
 * Diagnose a batch of signals. Returns one Diagnosis per matched signal
 * (unmatched signals are silently dropped).
 */
export function diagnoseBatch(signals: DiagnosticSignal[]): Diagnosis[] {
  const results: Diagnosis[] = [];
  for (const signal of signals) {
    const d = diagnose(signal);
    if (d) results.push(d);
  }
  return results;
}
