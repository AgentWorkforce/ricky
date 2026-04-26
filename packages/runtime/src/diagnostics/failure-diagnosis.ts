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
  ControlFlowBreakage: 'control-flow-breakage',
  RepoValidationMismatch: 'repo-validation-mismatch',
} as const;

export type BlockerClass = (typeof BlockerClass)[keyof typeof BlockerClass];

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
  /** If true, the action can be attempted automatically */
  automatable: boolean;
}

// ── Classification rules (order matters — first match wins) ───────

interface Rule {
  blockerClass: BlockerClass;
  label: string;
  match: (signal: DiagnosticSignal) => boolean;
  unblocker: UnblockerGuidance;
}

const rules: readonly Rule[] = [
  {
    blockerClass: BlockerClass.RuntimeHandoffStall,
    label: 'Runtime handoff stall',
    match: (s) =>
      /handoff.*(stall|timeout|hung)/i.test(s.message) ||
      s.source === 'handoff' ||
      s.meta?.handoffStalled === true,
    unblocker: {
      action: 'Restart the target runtime and re-initiate the handoff sequence',
      rationale:
        'The handoff between runtimes has stalled, likely due to the target not acknowledging within the expected window.',
      automatable: true,
    },
  },
  {
    blockerClass: BlockerClass.OpaqueProgress,
    label: 'Opaque progress',
    match: (s) =>
      /opaque|no.progress|progress.unknown|unreadable.state/i.test(s.message) ||
      s.source === 'progress-monitor' ||
      s.meta?.progressOpaque === true,
    unblocker: {
      action: 'Inject a progress probe and wait for an explicit status heartbeat',
      rationale:
        'The runtime is running but its progress is not observable. A probe forces it to surface state.',
      automatable: true,
    },
  },
  {
    blockerClass: BlockerClass.StaleRelayState,
    label: 'Stale relay state',
    match: (s) =>
      /stale.*relay|relay.*stale|relay.*outdated|relay.*expired/i.test(s.message) ||
      s.source === 'relay' ||
      s.meta?.relayStale === true,
    unblocker: {
      action: 'Invalidate the relay cache and request a fresh state snapshot from the source',
      rationale:
        'Relay state has drifted from the source of truth. Continuing on stale state risks cascading errors.',
      automatable: true,
    },
  },
  {
    blockerClass: BlockerClass.ControlFlowBreakage,
    label: 'Control-flow breakage',
    match: (s) =>
      /control.flow|unreachable|dead.branch|unexpected.branch|branch.miss/i.test(s.message) ||
      s.source === 'control-flow' ||
      s.meta?.controlFlowBroken === true,
    unblocker: {
      action: 'Roll back to the last known-good checkpoint and replay from there',
      rationale:
        'An unexpected branch was taken in the control graph. Replay from a checkpoint avoids propagating the broken path.',
      automatable: false,
    },
  },
  {
    blockerClass: BlockerClass.RepoValidationMismatch,
    label: 'Repo validation mismatch',
    match: (s) =>
      /repo.*valid|validation.*mismatch|schema.*mismatch|integrity.*fail/i.test(s.message) ||
      s.source === 'repo-validation' ||
      s.meta?.repoMismatch === true,
    unblocker: {
      action: 'Re-run repo validation with --repair flag to reconcile the mismatch',
      rationale:
        'The repo state does not match expected validation constraints. Repair reconciles without a full reset.',
      automatable: true,
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
