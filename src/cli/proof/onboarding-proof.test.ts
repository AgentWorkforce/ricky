import { describe, expect, it } from 'vitest';

import {
  evaluateOnboardingProof,
  evaluateOnboardingProofCase,
  getOnboardingProofCases,
  summarizeOnboardingProof,
  type ProofCaseName,
} from './onboarding-proof';

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
    ['local-byoh-path', ['generate workflows into your local repo', 'No Cloud credentials required']],
    ['cloud-path', ['Cloud mode selected', 'AgentWorkforce Cloud', 'Cloud dashboard']],
    ['google-connect-guidance', ['npx agent-relay cloud connect google']],
    ['github-dashboard-nango-guidance', ['GitHub', 'Cloud dashboard']],
    ['cli-mcp-handoff-language', ['Claude', 'CLI', 'MCP', 'ricky.generate']],
    ['recovery-paths', ['agent-relay is missing', 'continue in local mode']],
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
});
