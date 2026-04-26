import { describe, it, expect } from 'vitest';
import {
  diagnose,
  diagnoseBatch,
  type DiagnosisInput,
  type BlockerClass,
} from './failure-diagnosis';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function inputOf(errorMessage: string): DiagnosisInput {
  return { errorMessage };
}

// ---------------------------------------------------------------------------
// Blocker differentiation
// ---------------------------------------------------------------------------

describe('diagnose — blocker classification', () => {
  it('classifies handoff stall', () => {
    const r = diagnose(inputOf('agent handoff stalled waiting for response'));
    expect(r.guidance.blockerClass).toBe('runtime-handoff-stall');
  });

  it('classifies handoff timeout variant', () => {
    const r = diagnose(inputOf('handoff timeout after 30s'));
    expect(r.guidance.blockerClass).toBe('runtime-handoff-stall');
  });

  it('classifies opaque progress', () => {
    const r = diagnose(inputOf('opaque progress — no status available'));
    expect(r.guidance.blockerClass).toBe('opaque-progress');
  });

  it('classifies opaque status variant', () => {
    const r = diagnose(inputOf('task has opaque status, cannot determine state'));
    expect(r.guidance.blockerClass).toBe('opaque-progress');
  });

  it('classifies stale relay state', () => {
    const r = diagnose(inputOf('stale relay state detected'));
    expect(r.guidance.blockerClass).toBe('stale-relay-state');
  });

  it('classifies relay expired variant', () => {
    const r = diagnose(inputOf('relay cache is stale after TTL'));
    expect(r.guidance.blockerClass).toBe('stale-relay-state');
  });

  it('classifies control flow breakage', () => {
    const r = diagnose(inputOf('control flow broken at node 7'));
    expect(r.guidance.blockerClass).toBe('control-flow-breakage');
  });

  it('classifies control-flow corrupt variant', () => {
    const r = diagnose(inputOf('control-flow corrupt after exception'));
    expect(r.guidance.blockerClass).toBe('control-flow-breakage');
  });

  it('classifies repo validation mismatch', () => {
    const r = diagnose(inputOf('repo validation mismatch on commit abc123'));
    expect(r.guidance.blockerClass).toBe('repo-validation-mismatch');
  });

  it('classifies repo integrity variant', () => {
    const r = diagnose(inputOf('repo integrity check failed'));
    expect(r.guidance.blockerClass).toBe('repo-validation-mismatch');
  });

  it('falls back to control-flow-breakage for unknown errors', () => {
    const r = diagnose(inputOf('something completely unexpected happened'));
    expect(r.guidance.blockerClass).toBe('control-flow-breakage');
    expect(r.guidance.automatable).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Unblocker guidance shape
// ---------------------------------------------------------------------------

describe('diagnose — unblocker guidance shape', () => {
  const ALL_CLASSES: BlockerClass[] = [
    'runtime-handoff-stall',
    'opaque-progress',
    'stale-relay-state',
    'control-flow-breakage',
    'repo-validation-mismatch',
  ];

  const SAMPLES: Record<BlockerClass, string> = {
    'runtime-handoff-stall': 'handoff stalled',
    'opaque-progress': 'opaque progress detected',
    'stale-relay-state': 'stale relay state',
    'control-flow-breakage': 'control flow broken',
    'repo-validation-mismatch': 'repo validation mismatch',
  };

  for (const cls of ALL_CLASSES) {
    it(`guidance for ${cls} has required fields`, () => {
      const r = diagnose(inputOf(SAMPLES[cls]));
      expect(r.guidance).toHaveProperty('blockerClass', cls);
      expect(typeof r.guidance.automatable).toBe('boolean');
      expect(typeof r.guidance.summary).toBe('string');
      expect(r.guidance.summary.length).toBeGreaterThan(0);
      expect(Array.isArray(r.guidance.steps)).toBe(true);
      expect(r.guidance.steps.length).toBeGreaterThan(0);
    });
  }

  it('control-flow-breakage is not automatable', () => {
    const r = diagnose(inputOf('control flow broken'));
    expect(r.guidance.automatable).toBe(false);
  });

  it('runtime-handoff-stall is automatable', () => {
    const r = diagnose(inputOf('handoff stalled'));
    expect(r.guidance.automatable).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Batch diagnosis
// ---------------------------------------------------------------------------

describe('diagnoseBatch', () => {
  it('returns results in input order', () => {
    const inputs: DiagnosisInput[] = [
      inputOf('handoff stalled'),
      inputOf('opaque progress detected'),
      inputOf('stale relay state'),
    ];
    const results = diagnoseBatch(inputs);
    expect(results).toHaveLength(3);
    expect(results[0].guidance.blockerClass).toBe('runtime-handoff-stall');
    expect(results[1].guidance.blockerClass).toBe('opaque-progress');
    expect(results[2].guidance.blockerClass).toBe('stale-relay-state');
  });

  it('handles empty batch', () => {
    expect(diagnoseBatch([])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

describe('determinism', () => {
  it('same input always produces the same output', () => {
    const input = inputOf('handoff timeout after 30s');
    const a = diagnose(input);
    const b = diagnose(input);
    expect(a).toEqual(b);
  });

  it('input object is preserved in result', () => {
    const input = inputOf('stale relay state');
    const r = diagnose(input);
    expect(r.input).toBe(input);
  });
});
