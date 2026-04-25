import { describe, expect, it } from 'vitest';

import { evaluateOnboardingProof, summarizeOnboardingProof } from './onboarding-proof';

describe('Ricky CLI onboarding proof', () => {
  it('proves all required onboarding cases', () => {
    const summary = summarizeOnboardingProof();

    expect(summary.passed).toBe(true);
    expect(summary.failures).toEqual([]);
  });

  it('covers first-run, returning-user, parity, guidance, handoff, and recovery cases', () => {
    const results = evaluateOnboardingProof();
    const names = results.map((result) => result.name);

    expect(names).toEqual([
      'first-run-banner-and-welcome',
      'returning-user-compact-flow',
      'local-and-cloud-parity',
      'real-cloud-guidance',
      'handoff-language',
      'recovery-path',
    ]);

    expect(results.every((result) => result.passed)).toBe(true);
  });

  it('keeps evidence user-visible and non-empty', () => {
    const results = evaluateOnboardingProof();

    for (const result of results) {
      expect(result.evidence.length).toBeGreaterThan(0);
      expect(result.evidence[0].trim().length).toBeGreaterThan(0);
    }
  });
});
