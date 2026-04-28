import { describe, expect, it } from 'vitest';

import {
  evaluateCloudProof,
  evaluateCloudProofCase,
  getCloudProofCases,
  summarizeCloudProof,
  type ProofCaseName,
} from './cloud-generate-proof.js';

describe('Ricky Cloud generate proof', () => {
  it('proves all required Cloud generate cases', async () => {
    const summary = await summarizeCloudProof();

    expect(summary.passed).toBe(true);
    expect(summary.failures).toEqual([]);
  });

  it('covers every proof case required by the Cloud generate contract', () => {
    const names = getCloudProofCases().map((proofCase) => proofCase.name);

    expect(names).toEqual([
      'missing-auth-rejection',
      'missing-workspace-rejection',
      'missing-spec-rejection',
      'success-response-shape',
      'empty-executor-response',
      'auth-context-passthrough',
      'workspace-context-passthrough',
      'spec-and-options-passthrough',
      'stubbed-executor-honesty',
      'executor-error-path',
    ]);
  });

  it('keeps evidence user-visible and non-empty', async () => {
    const results = await evaluateCloudProof();

    for (const result of results) {
      expect(result.evidence.length).toBeGreaterThan(0);
      expect(result.evidence[0].trim().length).toBeGreaterThan(0);
    }
  });

  // ---------------------------------------------------------------------------
  // Validation proof — one case per required field
  // ---------------------------------------------------------------------------

  it.each([
    ['missing-auth-rejection', ['ok: false', 'status: 401', 'auth token']],
    ['missing-workspace-rejection', ['ok: false', 'status: 400', 'workspace ID']],
    ['missing-spec-rejection', ['ok: false', 'status: 400', 'spec']],
  ] satisfies Array<[ProofCaseName, string[]]>)(
    '%s proves validation rejects invalid requests',
    async (name, expectedEvidence) => {
      const result = await evaluateCloudProofCase(name);
      const evidence = result.evidence.join('\n');

      expect(result.passed).toBe(true);
      for (const expected of expectedEvidence) {
        expect(evidence).toContain(expected);
      }
    },
  );

  // ---------------------------------------------------------------------------
  // Response shape proof — success path contract
  // ---------------------------------------------------------------------------

  it.each([
    ['success-response-shape', ['ok: true', 'status: 200', 'artifact count: 1', 'out/workflow.ts', 'Assumed default region', 'deploy', 'requestId: ricky-cloud-proof-000']],
    ['empty-executor-response', ['ok: true', 'status: 200', 'artifacts: 0', 'warnings: 0', 'followUpActions: 0']],
  ] satisfies Array<[ProofCaseName, string[]]>)(
    '%s proves response contract shape is faithfully returned',
    async (name, expectedEvidence) => {
      const result = await evaluateCloudProofCase(name);
      const evidence = result.evidence.join('\n');

      expect(result.passed).toBe(true);
      for (const expected of expectedEvidence) {
        expect(evidence).toContain(expected);
      }
    },
  );

  // ---------------------------------------------------------------------------
  // Context passthrough proof — auth, workspace, spec
  // ---------------------------------------------------------------------------

  it.each([
    ['auth-context-passthrough', ['explicit-bearer-token', 'api-key']],
    ['workspace-context-passthrough', ['ws-prod-42', 'production']],
    ['spec-and-options-passthrough', ['deploy service', '/specs/deploy.md', 'both', 'dashboard']],
  ] satisfies Array<[ProofCaseName, string[]]>)(
    '%s proves explicit context reaches the executor',
    async (name, expectedEvidence) => {
      const result = await evaluateCloudProofCase(name);
      const evidence = result.evidence.join('\n');

      expect(result.passed).toBe(true);
      for (const expected of expectedEvidence) {
        expect(evidence).toContain(expected);
      }
    },
  );

  // ---------------------------------------------------------------------------
  // Honesty and error path proof
  // ---------------------------------------------------------------------------

  it('proves the stubbed executor is honest about being a stub', async () => {
    const result = await evaluateCloudProofCase('stubbed-executor-honesty');
    const evidence = result.evidence.join('\n');

    expect(result.passed).toBe(true);
    expect(evidence).toContain('ok: true');
    expect(evidence).toContain('warnings mention stub: true');
    expect(evidence).toContain('wire-runtime: true');
  });

  it('proves executor errors return actionable error response', async () => {
    const result = await evaluateCloudProofCase('executor-error-path');
    const evidence = result.evidence.join('\n');

    expect(result.passed).toBe(true);
    expect(evidence).toContain('ok: false');
    expect(evidence).toContain('status: 500');
    expect(evidence).toContain('Cloud runtime unavailable');
    expect(evidence).toContain('retry action present: true');
  });
});
