/**
 * Unblocker Proof Surface
 *
 * Maps the diagnosis engine's blocker classes into three operational
 * domains — runtime, environment, orchestration — and exposes a
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
} as const;

export type UnblockerDomain =
  (typeof UnblockerDomain)[keyof typeof UnblockerDomain];

// ── Domain ↔ BlockerClass mapping (single source of truth) ───────

export const domainMap: ReadonlyMap<string, UnblockerDomain> = new Map([
  [BlockerClass.RuntimeHandoffStall, UnblockerDomain.Runtime],
  [BlockerClass.OpaqueProgress, UnblockerDomain.Runtime],
  [BlockerClass.RepoValidationMismatch, UnblockerDomain.Environment],
  [BlockerClass.StaleRelayState, UnblockerDomain.Orchestration],
  [BlockerClass.ControlFlowBreakage, UnblockerDomain.Orchestration],
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
    blockerClass: BlockerClass.RepoValidationMismatch,
    domain: UnblockerDomain.Environment,
    signal: { source: 'repo-validation', message: 'validation mismatch' },
  },
  {
    blockerClass: BlockerClass.StaleRelayState,
    domain: UnblockerDomain.Orchestration,
    signal: { source: 'relay', message: 'relay stale' },
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
