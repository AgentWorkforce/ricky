import { renderOnboarding, renderCloudGuidance, renderHandoffGuidance, renderRecoveryGuidance } from '../index';

export interface ProofCaseResult {
  name: string;
  passed: boolean;
  evidence: string[];
}

export function evaluateOnboardingProof(): ProofCaseResult[] {
  const firstRun = renderOnboarding({ isFirstRun: true, isTTY: true });
  const returning = renderOnboarding({ isFirstRun: false, isTTY: true });
  const blocked = renderRecoveryGuidance('agent-relay is missing');
  const cloud = renderCloudGuidance();
  const handoff = renderHandoffGuidance();

  return [
    {
      name: 'first-run-banner-and-welcome',
      passed: firstRun.includes('RRRR') && firstRun.includes('Ricky helps you generate, debug, recover, and run workflows.'),
      evidence: [firstRun],
    },
    {
      name: 'returning-user-compact-flow',
      passed: !returning.includes('RRRR') && returning.includes('Ricky is ready.'),
      evidence: [returning],
    },
    {
      name: 'local-and-cloud-parity',
      passed: firstRun.includes('Local / BYOH') && firstRun.includes('Cloud'),
      evidence: [firstRun],
    },
    {
      name: 'real-cloud-guidance',
      passed:
        cloud.includes('npx agent-relay cloud connect google') &&
        cloud.includes('Cloud dashboard / Nango-backed connection flow') &&
        !cloud.includes('fake') &&
        !cloud.includes('github/connect/local'),
      evidence: [cloud],
    },
    {
      name: 'handoff-language',
      passed: handoff.includes('Claude') && handoff.includes('MCP') && handoff.includes('Hand Ricky the spec directly.'),
      evidence: [handoff],
    },
    {
      name: 'recovery-path',
      passed: blocked.includes('agent-relay is missing') && blocked.includes('continue with Cloud setup instead'),
      evidence: [blocked],
    },
  ];
}

export function summarizeOnboardingProof(): { passed: boolean; failures: string[] } {
  const results = evaluateOnboardingProof();
  const failures = results.filter((result) => !result.passed).map((result) => result.name);

  return {
    passed: failures.length === 0,
    failures,
  };
}
