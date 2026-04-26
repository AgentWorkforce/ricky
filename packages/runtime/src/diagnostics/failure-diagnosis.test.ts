import { describe, it, expect } from 'vitest';
import {
  BlockerClass,
  diagnose,
  diagnoseBatch,
  type Diagnosis,
  type DiagnosticSignal,
} from './failure-diagnosis.js';

// ── Helpers ────────────────────────────────────────────────────────

function expectDiagnosis(
  signal: DiagnosticSignal,
  expectedClass: string,
): Diagnosis {
  const d = diagnose(signal);
  expect(d).not.toBeNull();
  expect(d!.blockerClass).toBe(expectedClass);
  expect(d!.label).toBeTruthy();
  expect(d!.unblocker).toBeDefined();
  expect(d!.unblocker.action).toBeTruthy();
  expect(d!.unblocker.rationale).toBeTruthy();
  expect(typeof d!.unblocker.automatable).toBe('boolean');
  return d!;
}

// ── Blocker differentiation ────────────────────────────────────────

describe('failure-diagnosis: blocker differentiation', () => {
  it('classifies handoff stall by message', () => {
    expectDiagnosis(
      { source: 'runtime', message: 'handoff stalled waiting for ack' },
      BlockerClass.RuntimeHandoffStall,
    );
  });

  it('classifies handoff stall by source', () => {
    expectDiagnosis(
      { source: 'handoff', message: 'unspecified error' },
      BlockerClass.RuntimeHandoffStall,
    );
  });

  it('classifies handoff stall by meta flag', () => {
    expectDiagnosis(
      { source: 'unknown', message: 'error', meta: { handoffStalled: true } },
      BlockerClass.RuntimeHandoffStall,
    );
  });

  it('classifies opaque progress by message', () => {
    expectDiagnosis(
      { source: 'runtime', message: 'no progress reported in 30s' },
      BlockerClass.OpaqueProgress,
    );
  });

  it('classifies opaque progress by source', () => {
    expectDiagnosis(
      { source: 'progress-monitor', message: 'timeout' },
      BlockerClass.OpaqueProgress,
    );
  });

  it('classifies stale relay state by message', () => {
    expectDiagnosis(
      { source: 'runtime', message: 'relay state is stale, last sync 5m ago' },
      BlockerClass.StaleRelayState,
    );
  });

  it('classifies stale relay state by source', () => {
    expectDiagnosis(
      { source: 'relay', message: 'sync failure' },
      BlockerClass.StaleRelayState,
    );
  });

  it('classifies control-flow breakage by message', () => {
    expectDiagnosis(
      { source: 'runtime', message: 'unexpected branch taken in control flow' },
      BlockerClass.ControlFlowBreakage,
    );
  });

  it('classifies control-flow breakage by meta flag', () => {
    expectDiagnosis(
      { source: 'x', message: 'err', meta: { controlFlowBroken: true } },
      BlockerClass.ControlFlowBreakage,
    );
  });

  it('classifies repo validation mismatch by message', () => {
    expectDiagnosis(
      { source: 'ci', message: 'repo validation mismatch on schema v2' },
      BlockerClass.RepoValidationMismatch,
    );
  });

  it('classifies repo validation mismatch by source', () => {
    expectDiagnosis(
      { source: 'repo-validation', message: 'check failed' },
      BlockerClass.RepoValidationMismatch,
    );
  });

  it('returns null for unknown signals', () => {
    const d = diagnose({ source: 'foo', message: 'everything is fine' });
    expect(d).toBeNull();
  });
});

// ── Unblocker guidance shape ───────────────────────────────────────

describe('failure-diagnosis: unblocker guidance shape', () => {
  const allClasses: { class: string; signal: DiagnosticSignal }[] = [
    {
      class: BlockerClass.RuntimeHandoffStall,
      signal: { source: 'handoff', message: 'stall' },
    },
    {
      class: BlockerClass.OpaqueProgress,
      signal: { source: 'progress-monitor', message: 'opaque' },
    },
    {
      class: BlockerClass.StaleRelayState,
      signal: { source: 'relay', message: 'stale' },
    },
    {
      class: BlockerClass.ControlFlowBreakage,
      signal: { source: 'control-flow', message: 'break' },
    },
    {
      class: BlockerClass.RepoValidationMismatch,
      signal: { source: 'repo-validation', message: 'mismatch' },
    },
  ];

  it('each blocker class produces distinct unblocker action text', () => {
    const actions = allClasses.map((c) => {
      const d = diagnose(c.signal);
      expect(d).not.toBeNull();
      return d!.unblocker.action;
    });

    // All actions should be unique strings
    const unique = new Set(actions);
    expect(unique.size).toBe(allClasses.length);
  });

  it('each blocker class produces distinct rationale text', () => {
    const rationales = allClasses.map((c) => {
      const d = diagnose(c.signal);
      return d!.unblocker.rationale;
    });
    const unique = new Set(rationales);
    expect(unique.size).toBe(allClasses.length);
  });

  it('control-flow breakage is not automatable', () => {
    const d = diagnose({ source: 'control-flow', message: 'break' });
    expect(d!.unblocker.automatable).toBe(false);
  });

  it('handoff stall is automatable', () => {
    const d = diagnose({ source: 'handoff', message: 'stall' });
    expect(d!.unblocker.automatable).toBe(true);
  });
});

// ── Batch diagnosis ────────────────────────────────────────────────

describe('failure-diagnosis: diagnoseBatch', () => {
  it('returns diagnoses only for matching signals', () => {
    const signals: DiagnosticSignal[] = [
      { source: 'handoff', message: 'stall' },
      { source: 'nope', message: 'all good' },
      { source: 'relay', message: 'stale' },
    ];
    const results = diagnoseBatch(signals);
    expect(results).toHaveLength(2);
    expect(results[0].blockerClass).toBe(BlockerClass.RuntimeHandoffStall);
    expect(results[1].blockerClass).toBe(BlockerClass.StaleRelayState);
  });

  it('returns empty array when no signals match', () => {
    const results = diagnoseBatch([
      { source: 'ok', message: 'nothing wrong' },
    ]);
    expect(results).toHaveLength(0);
  });
});

// ── Determinism ────────────────────────────────────────────────────

describe('failure-diagnosis: determinism', () => {
  it('returns identical results across repeated calls', () => {
    const signal: DiagnosticSignal = {
      source: 'runtime',
      message: 'handoff stalled',
    };
    const a = diagnose(signal);
    const b = diagnose(signal);
    expect(a).toEqual(b);
  });
});
