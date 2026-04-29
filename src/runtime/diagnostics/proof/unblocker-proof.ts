/**
 * Unblocker Proof Surface
 *
 * Maps the diagnosis engine's blocker classes into operational
 * domains — runtime, environment, orchestration, validation strategy — and exposes a
 * bounded proof API that downstream tests use to verify:
 *
 *   1. Every blocker class belongs to exactly one domain.
 *   2. Unblocker guidance is class-specific (no two classes share guidance).
 *   3. The mapping is exhaustive over BlockerClass.
 *
 * This module contains zero classification logic of its own — it
 * delegates entirely to the diagnosis engine and merely projects
 * its output into domain buckets.
 */

import {
  BlockerClass,
  diagnose,
  type Diagnosis,
  type DiagnosticSignal,
} from '../failure-diagnosis.js';

// ── Domain taxonomy ───────────────────────────────────────────────

export const UnblockerDomain = {
  Runtime: 'runtime',
  Environment: 'environment',
  Orchestration: 'orchestration',
  ValidationStrategy: 'validation_strategy',
} as const;

export type UnblockerDomain =
  (typeof UnblockerDomain)[keyof typeof UnblockerDomain];

// ── Domain ↔ BlockerClass mapping (single source of truth) ───────

export const domainMap: ReadonlyMap<string, UnblockerDomain> = new Map([
  [BlockerClass.RuntimeHandoffStall, UnblockerDomain.Runtime],
  [BlockerClass.OpaqueProgress, UnblockerDomain.Runtime],
  [BlockerClass.StaleRelayState, UnblockerDomain.Environment],
  [BlockerClass.MissingConfig, UnblockerDomain.Environment],
  [BlockerClass.AlreadyRunning, UnblockerDomain.Environment],
  [BlockerClass.ControlFlowBreakage, UnblockerDomain.Orchestration],
  [BlockerClass.UnsupportedValidationCommand, UnblockerDomain.ValidationStrategy],
  [BlockerClass.RepoValidationMismatch, UnblockerDomain.ValidationStrategy],
]);

// ── Canonical signals (one per blocker class) ─────────────────────

export interface CanonicalCase {
  blockerClass: string;
  domain: UnblockerDomain;
  signal: DiagnosticSignal;
}

/**
 * Deterministic set of canonical signals — exactly one per blocker class.
 * Tests iterate this to prove coverage without inventing ad-hoc signals.
 */
export const canonicalCases: readonly CanonicalCase[] = [
  {
    blockerClass: BlockerClass.RuntimeHandoffStall,
    domain: UnblockerDomain.Runtime,
    signal: { source: 'handoff', message: 'handoff stalled' },
  },
  {
    blockerClass: BlockerClass.OpaqueProgress,
    domain: UnblockerDomain.Runtime,
    signal: { source: 'progress-monitor', message: 'no progress' },
  },
  {
    blockerClass: BlockerClass.StaleRelayState,
    domain: UnblockerDomain.Environment,
    signal: { source: 'relay', message: 'relay stale' },
  },
  {
    blockerClass: BlockerClass.MissingConfig,
    domain: UnblockerDomain.Environment,
    signal: { source: 'config', message: 'missing config' },
  },
  {
    blockerClass: BlockerClass.UnsupportedValidationCommand,
    domain: UnblockerDomain.ValidationStrategy,
    signal: { source: 'validation-command', message: 'unsupported validation' },
  },
  {
    blockerClass: BlockerClass.AlreadyRunning,
    domain: UnblockerDomain.Environment,
    signal: { source: 'active-run', message: 'already running' },
  },
  {
    blockerClass: BlockerClass.RepoValidationMismatch,
    domain: UnblockerDomain.ValidationStrategy,
    signal: { source: 'repo-validation', message: 'validation mismatch' },
  },
  {
    blockerClass: BlockerClass.ControlFlowBreakage,
    domain: UnblockerDomain.Orchestration,
    signal: { source: 'control-flow', message: 'control flow broken' },
  },
];

// ── Proof helpers ─────────────────────────────────────────────────

/** Diagnose a canonical case via the real engine. */
export function diagnoseCanonical(c: CanonicalCase): Diagnosis | null {
  return diagnose(c.signal);
}

/** Return all blocker-class string values defined in BlockerClass. */
export function allBlockerClasses(): string[] {
  return Object.values(BlockerClass);
}

/** Return the domain for a given blocker class, or undefined if unmapped. */
export function domainOf(blockerClass: string): UnblockerDomain | undefined {
  return domainMap.get(blockerClass);
}

/** Return canonical cases filtered to a given domain. */
export function casesForDomain(domain: UnblockerDomain): readonly CanonicalCase[] {
  return canonicalCases.filter((c) => c.domain === domain);
}

/** Return the set of distinct recovery decisions across a domain's canonical cases. */
export function recoveryDecisionsForDomain(domain: UnblockerDomain): string[] {
  return casesForDomain(domain).map((c) => {
    const d = diagnose(c.signal);
    return d!.unblocker.recovery.decision;
  });
}
