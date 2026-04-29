import { describe, it, expect } from 'vitest';
import {
  RecoveryDecision,
} from '../failure-diagnosis.js';
import {
  UnblockerDomain,
  canonicalCases,
  diagnoseCanonical,
  allBlockerClasses,
  domainOf,
  domainMap,
  casesForDomain,
  recoveryDecisionsForDomain,
} from './unblocker-proof.js';

// ── Domain coverage ───────────────────────────────────────────────

describe('unblocker-proof: domain coverage', () => {
  it('every BlockerClass is mapped to exactly one domain', () => {
    for (const cls of allBlockerClasses()) {
      const domain = domainOf(cls);
      expect(domain, `BlockerClass "${cls}" has no domain mapping`).toBeDefined();
    }
  });

  it('domainMap covers no unknown blocker classes', () => {
    const known = new Set(allBlockerClasses());
    for (const [cls] of domainMap) {
      expect(known.has(cls), `domainMap contains unknown class "${cls}"`).toBe(true);
    }
  });

  it('all operational domains are represented', () => {
    const domains = new Set(domainMap.values());
    expect(domains).toContain(UnblockerDomain.Runtime);
    expect(domains).toContain(UnblockerDomain.Environment);
    expect(domains).toContain(UnblockerDomain.Orchestration);
    expect(domains).toContain(UnblockerDomain.ValidationStrategy);
  });

  it('canonical cases cover every blocker class exactly once', () => {
    const covered = canonicalCases.map((c) => c.blockerClass);
    const all = allBlockerClasses();
    expect(covered.sort()).toEqual([...all].sort());
  });
});

// ── Runtime blockers ──────────────────────────────────────────────

describe('unblocker-proof: runtime blockers', () => {
  const runtimeCases = canonicalCases.filter(
    (c) => c.domain === UnblockerDomain.Runtime,
  );

  it('has at least one runtime blocker case', () => {
    expect(runtimeCases.length).toBeGreaterThan(0);
  });

  it.each(runtimeCases.map((c) => [c.blockerClass, c] as const))(
    '%s diagnoses via the engine and returns guidance',
    (_label, c) => {
      const d = diagnoseCanonical(c);
      expect(d).not.toBeNull();
      expect(d!.blockerClass).toBe(c.blockerClass);
      expect(d!.unblocker.action).toBeTruthy();
      expect(d!.unblocker.rationale).toBeTruthy();
    },
  );
});

// ── Environment blockers ──────────────────────────────────────────

describe('unblocker-proof: environment blockers', () => {
  const envCases = canonicalCases.filter(
    (c) => c.domain === UnblockerDomain.Environment,
  );

  it('has at least one environment blocker case', () => {
    expect(envCases.length).toBeGreaterThan(0);
  });

  it.each(envCases.map((c) => [c.blockerClass, c] as const))(
    '%s diagnoses via the engine and returns guidance',
    (_label, c) => {
      const d = diagnoseCanonical(c);
      expect(d).not.toBeNull();
      expect(d!.blockerClass).toBe(c.blockerClass);
      expect(d!.unblocker.action).toBeTruthy();
      expect(d!.unblocker.rationale).toBeTruthy();
    },
  );
});

// ── Orchestration blockers ────────────────────────────────────────

describe('unblocker-proof: orchestration blockers', () => {
  const orchCases = canonicalCases.filter(
    (c) => c.domain === UnblockerDomain.Orchestration,
  );

  it('has at least one orchestration blocker case', () => {
    expect(orchCases.length).toBeGreaterThan(0);
  });

  it.each(orchCases.map((c) => [c.blockerClass, c] as const))(
    '%s diagnoses via the engine and returns guidance',
    (_label, c) => {
      const d = diagnoseCanonical(c);
      expect(d).not.toBeNull();
      expect(d!.blockerClass).toBe(c.blockerClass);
      expect(d!.unblocker.action).toBeTruthy();
      expect(d!.unblocker.rationale).toBeTruthy();
    },
  );
});

// ── Validation strategy blockers ─────────────────────────────────

describe('unblocker-proof: validation strategy blockers', () => {
  const vsCases = canonicalCases.filter(
    (c) => c.domain === UnblockerDomain.ValidationStrategy,
  );

  it('has at least one validation strategy blocker case', () => {
    expect(vsCases.length).toBeGreaterThan(0);
  });

  it.each(vsCases.map((c) => [c.blockerClass, c] as const))(
    '%s diagnoses via the engine and returns guidance',
    (_label, c) => {
      const d = diagnoseCanonical(c);
      expect(d).not.toBeNull();
      expect(d!.blockerClass).toBe(c.blockerClass);
      expect(d!.unblocker.action).toBeTruthy();
      expect(d!.unblocker.rationale).toBeTruthy();
    },
  );
});

// ── Recovery recommendations are domain-appropriate ──────────────

describe('unblocker-proof: recovery recommendations by domain', () => {
  it('runtime domain allows step retry or probe (no block)', () => {
    const decisions = recoveryDecisionsForDomain(UnblockerDomain.Runtime);
    for (const d of decisions) {
      expect([
        RecoveryDecision.RestartRuntime,
        RecoveryDecision.ProbeBeforeRerun,
      ]).toContain(d);
    }
  });

  it('environment domain blocks rerun or requires mutation', () => {
    const cases = casesForDomain(UnblockerDomain.Environment);
    for (const c of cases) {
      const diag = diagnoseCanonical(c)!;
      const rec = diag.unblocker.recovery;
      // environment blockers either block rerun or require mutation
      expect(
        rec.rerunAllowed === false || rec.requiresMutation === true,
      ).toBe(true);
    }
  });

  it('orchestration domain requires workflow patch before rerun', () => {
    const decisions = recoveryDecisionsForDomain(UnblockerDomain.Orchestration);
    for (const d of decisions) {
      expect(d).toBe(RecoveryDecision.PatchWorkflowBeforeRerun);
    }
  });

  it('validation strategy domain recommends replacing the validation gate', () => {
    const decisions = recoveryDecisionsForDomain(UnblockerDomain.ValidationStrategy);
    for (const d of decisions) {
      expect(d).toBe(RecoveryDecision.ReplaceValidation);
    }
  });
});

// ── Taxonomy category alignment ──────────────────────────────────

describe('unblocker-proof: taxonomy categories align with domains', () => {
  it('runtime cases use agent_runtime taxonomy prefix', () => {
    for (const c of casesForDomain(UnblockerDomain.Runtime)) {
      const d = diagnoseCanonical(c)!;
      expect(d.taxonomyCategory).toMatch(/^agent_runtime\./);
    }
  });

  it('environment cases use environment taxonomy prefix', () => {
    for (const c of casesForDomain(UnblockerDomain.Environment)) {
      const d = diagnoseCanonical(c)!;
      expect(d.taxonomyCategory).toMatch(/^environment\./);
    }
  });

  it('orchestration cases use workflow_structure taxonomy prefix', () => {
    for (const c of casesForDomain(UnblockerDomain.Orchestration)) {
      const d = diagnoseCanonical(c)!;
      expect(d.taxonomyCategory).toMatch(/^workflow_structure\./);
    }
  });

  it('validation strategy cases use validation_strategy taxonomy prefix', () => {
    for (const c of casesForDomain(UnblockerDomain.ValidationStrategy)) {
      const d = diagnoseCanonical(c)!;
      expect(d.taxonomyCategory).toMatch(/^validation_strategy\./);
    }
  });
});

// ── Guidance differentiation ──────────────────────────────────────

describe('unblocker-proof: guidance differs by blocker class', () => {
  it('no two blocker classes share the same unblocker action', () => {
    const actions = canonicalCases.map((c) => {
      const d = diagnoseCanonical(c);
      expect(d).not.toBeNull();
      return d!.unblocker.action;
    });
    expect(new Set(actions).size).toBe(canonicalCases.length);
  });

  it('no two blocker classes share the same unblocker rationale', () => {
    const rationales = canonicalCases.map((c) => {
      const d = diagnoseCanonical(c);
      return d!.unblocker.rationale;
    });
    expect(new Set(rationales).size).toBe(canonicalCases.length);
  });

  it('guidance across domains is distinct (cross-domain check)', () => {
    const byDomain = new Map<string, string[]>();
    for (const c of canonicalCases) {
      const d = diagnoseCanonical(c)!;
      const list = byDomain.get(c.domain) ?? [];
      list.push(d.unblocker.action);
      byDomain.set(c.domain, list);
    }

    // Flatten all actions and confirm global uniqueness
    const allActions = [...byDomain.values()].flat();
    expect(new Set(allActions).size).toBe(allActions.length);
  });
});

// ── Determinism ───────────────────────────────────────────────────

describe('unblocker-proof: determinism', () => {
  it('repeated diagnosis of every canonical case yields identical results', () => {
    for (const c of canonicalCases) {
      const a = diagnoseCanonical(c);
      const b = diagnoseCanonical(c);
      expect(a).toEqual(b);
    }
  });
});
