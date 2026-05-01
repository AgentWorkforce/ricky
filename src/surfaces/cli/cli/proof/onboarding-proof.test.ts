import { describe, expect, it } from 'vitest';

import {
  evaluateOnboardingProof,
  evaluateOnboardingProofCase,
  getOnboardingProofCases,
  summarizeOnboardingProof,
  type ProofCaseName,
} from './onboarding-proof.js';

describe('Ricky CLI onboarding proof', () => {
  it('proves all required onboarding cases', () => {
    const summary = summarizeOnboardingProof();

    expect(summary.passed).toBe(true);
    expect(summary.failures).toEqual([]);
  });

  it('covers every proof case required by the UX contract', () => {
    const names = getOnboardingProofCases().map((proofCase) => proofCase.name);

    expect(names).toEqual([
      'implementation-modules-present',
      'first-run-experience',
      'returning-user-compact-header',
      'local-byoh-path',
      'cloud-path',
      'google-connect-guidance',
      'github-dashboard-nango-guidance',
      'cli-mcp-handoff-language',
      'recovery-paths',
      'banner-suppression',
      'narrow-terminal-fallback',
      'default-journey',
      'local-journey',
      'setup-journey',
      'welcome-journey',
      'status-journey',
      'generate-journey',
      'fixture-inline-spec',
      'fixture-spec-file',
      'fixture-stdin',
      'fixture-missing-spec',
      'fixture-missing-file-recovery',
    ]);
  });

  it('keeps evidence user-visible and non-empty', () => {
    const results = evaluateOnboardingProof();

    for (const result of results) {
      expect(result.evidence.length).toBeGreaterThan(0);
      expect(result.evidence[0].trim().length).toBeGreaterThan(0);
    }
  });

  it.each([
    ['first-run-experience', ['Welcome to Ricky', 'Local / BYOH', 'Cloud', 'Recovery']],
    ['returning-user-compact-header', ['Ricky is ready', 'ricky · local mode · ready']],
    ['local-byoh-path', ['writes a workflow artifact into workflows/generated/ in your repo', 'No Cloud credentials required', 'Nothing is executed at this stage']],
    ['cloud-path', ['Cloud mode selected', 'AgentWorkforce Cloud', 'Cloud dashboard']],
    ['google-connect-guidance', ['npx agent-relay cloud connect google']],
    ['github-dashboard-nango-guidance', ['GitHub', 'Cloud dashboard']],
    ['cli-mcp-handoff-language', ['Give Ricky a spec', 'Generation does not execute']],
    ['recovery-paths', ['agent-relay is missing', 'Continue locally']],
    ['banner-suppression', ['quiet: suppressed', 'RICKY_BANNER=0: suppressed']],
    ['narrow-terminal-fallback', ['ricky · workflow reliability for AgentWorkforce']],
  ] satisfies Array<[ProofCaseName, string[]]>)('%s exposes bounded proof evidence', (name, expectedEvidence) => {
    const result = evaluateOnboardingProofCase(name);
    const evidence = result.evidence.join('\n');

    expect(result.passed).toBe(true);
    for (const expected of expectedEvidence) {
      expect(evidence).toContain(expected);
    }
  });

  // ---------------------------------------------------------------------------
  // Journey proof cases
  // ---------------------------------------------------------------------------

  describe('journey proof cases', () => {
    it.each([
      ['default-journey', ['command=run', 'ricky']],
      ['local-journey', ['mode=local', 'spec=build a workflow']],
      ['setup-journey', ['all 4 choices']],
      ['welcome-journey', ['Welcome to Ricky', 'Ricky is ready']],
      ['status-journey', ['local mode', 'cloud connected', 'cloud not connected']],
      ['generate-journey', ['generate a workflow for package checks']],
    ] satisfies Array<[ProofCaseName, string[]]>)('%s proves the journey contract', (name, expectedEvidence) => {
      const result = evaluateOnboardingProofCase(name);
      const evidence = result.evidence.join('\n');

      expect(result.passed).toBe(true);
      expect(result.failures).toEqual([]);
      for (const expected of expectedEvidence) {
        expect(evidence).toContain(expected);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Fixture proof cases
  // ---------------------------------------------------------------------------

  describe('fixture proof cases', () => {
    it.each([
      ['fixture-inline-spec', ['spec=hello world', 'spec=build a workflow']],
      ['fixture-spec-file', ['--spec-file', './spec.md', '--file alias']],
      ['fixture-stdin', ['stdin=true']],
      ['fixture-missing-spec', ['spec=undefined']],
      ['fixture-missing-file-recovery', ['--spec-file requires a value', '--file requires a value', '--spec requires a value']],
    ] satisfies Array<[ProofCaseName, string[]]>)('%s proves the fixture contract', (name, expectedEvidence) => {
      const result = evaluateOnboardingProofCase(name);
      const evidence = result.evidence.join('\n');

      expect(result.passed).toBe(true);
      expect(result.failures).toEqual([]);
      for (const expected of expectedEvidence) {
        expect(evidence).toContain(expected);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Proof artifact summary
  // ---------------------------------------------------------------------------

  describe('proof artifact summary', () => {
    it('produces a deterministic summary with no failures across all cases', () => {
      const summary = summarizeOnboardingProof();
      const results = evaluateOnboardingProof();

      expect(summary.passed).toBe(true);
      expect(summary.failures).toEqual([]);
      expect(results.length).toBe(22);
      expect(results.every((r) => r.passed)).toBe(true);
    });

    it('includes proof artifact metadata for every case', () => {
      const cases = getOnboardingProofCases();

      for (const proofCase of cases) {
        expect(proofCase.name).toBeTruthy();
        expect(proofCase.description).toBeTruthy();
        expect(proofCase.specSection).toBeTruthy();
        expect(typeof proofCase.evaluate).toBe('function');
      }
    });
  });
});
