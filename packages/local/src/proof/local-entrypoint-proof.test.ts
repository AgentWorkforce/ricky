import { describe, expect, it } from 'vitest';

import {
  evaluateLocalProof,
  evaluateLocalProofCase,
  getLocalProofCases,
  summarizeLocalProof,
  type ProofCaseName,
} from './local-entrypoint-proof';

describe('Ricky local/BYOH entrypoint proof', () => {
  it('proves all required local entrypoint cases', async () => {
    const summary = await summarizeLocalProof();

    expect(summary.passed).toBe(true);
    expect(summary.failures).toEqual([]);
  });

  it('covers every proof case required by the local/BYOH contract', () => {
    const names = getLocalProofCases().map((proofCase) => proofCase.name);

    expect(names).toEqual([
      'cli-spec-handoff',
      'mcp-spec-handoff',
      'claude-structured-handoff',
      'workflow-artifact-handoff',
      'artifact-response-behavior',
      'log-response-behavior',
      'warning-response-behavior',
      'next-action-response-behavior',
      'local-runtime-coordination',
      'stubbed-runtime-seam-honesty',
      'error-path-normalization-failure',
      'cloud-mode-rejection',
    ]);
  });

  it('keeps evidence user-visible and non-empty', async () => {
    const results = await evaluateLocalProof();

    for (const result of results) {
      expect(result.evidence.length).toBeGreaterThan(0);
      expect(result.evidence[0].trim().length).toBeGreaterThan(0);
    }
  });

  // -------------------------------------------------------------------------
  // Spec handoff proof — one case per intake surface
  // -------------------------------------------------------------------------

  it.each([
    ['cli-spec-handoff', ['source: cli', 'spec: build a pipeline', 'mode: local', 'ok: true']],
    ['mcp-spec-handoff', ['source: mcp', 'spec: deploy service', 'toolCallId', 'ok: true']],
    ['claude-structured-handoff', ['source: claude', 'spec: run tests', 'conv-1', 'turn-5', 'ok: true']],
    ['workflow-artifact-handoff', ['source: workflow-artifact', '# Real Workflow Spec', '/artifacts/wf.md', 'ok: true']],
  ] satisfies Array<[ProofCaseName, string[]]>)(
    '%s proves spec reaches the executor with correct shape',
    async (name, expectedEvidence) => {
      const result = await evaluateLocalProofCase(name);
      const evidence = result.evidence.join('\n');

      expect(result.passed).toBe(true);
      for (const expected of expectedEvidence) {
        expect(evidence).toContain(expected);
      }
    },
  );

  // -------------------------------------------------------------------------
  // Response contract proof — artifact, log, warning, next-action
  // -------------------------------------------------------------------------

  it.each([
    ['artifact-response-behavior', ['artifact count: 1', 'path: out/workflow.ts', 'type: text/typescript']],
    ['log-response-behavior', ['log count: 2', '[gen] started', '[gen] complete']],
    ['warning-response-behavior', ['check permissions', 'entrypoint warning: true']],
    ['next-action-response-behavior', ['next-action count: 2', 'run the workflow', 'check output']],
  ] satisfies Array<[ProofCaseName, string[]]>)(
    '%s proves response contract field is faithfully returned',
    async (name, expectedEvidence) => {
      const result = await evaluateLocalProofCase(name);
      const evidence = result.evidence.join('\n');

      expect(result.passed).toBe(true);
      for (const expected of expectedEvidence) {
        expect(evidence).toContain(expected);
      }
    },
  );

  // -------------------------------------------------------------------------
  // Honesty and error path proof
  // -------------------------------------------------------------------------

  it('proves local runtime coordination is wired through injectable adapters', async () => {
    const result = await evaluateLocalProofCase('local-runtime-coordination');
    const evidence = result.evidence.join('\n');

    expect(result.passed).toBe(true);
    expect(evidence).toContain('ok: true');
    expect(evidence).toContain('artifact writes: 1');
    expect(evidence).toContain('runtime status: passed');
  });

  it('proves the local executor is a stubbed runtime seam and documents honest gaps', async () => {
    const result = await evaluateLocalProofCase('stubbed-runtime-seam-honesty');
    const evidence = result.evidence.join('\n');

    expect(result.passed).toBe(true);
    // The proof passes but explicitly documents what is NOT exercised
    expect(result.gaps.length).toBeGreaterThan(0);
    expect(result.gaps.some((g) => g.includes('agent-relay subprocess'))).toBe(true);
    expect(result.gaps.some((g) => g.includes('npx'))).toBe(true);
    expect(result.gaps.some((g) => g.includes('Filesystem'))).toBe(true);
    // Evidence includes the honest gap annotations
    expect(evidence).toContain('HONEST GAP');
    expect(evidence).toContain('injectable executor seam: true');
    expect(evidence).toContain('artifact writes via adapter: 1');
  });

  it('proves normalization failure returns actionable error response', async () => {
    const result = await evaluateLocalProofCase('error-path-normalization-failure');
    const evidence = result.evidence.join('\n');

    expect(result.passed).toBe(true);
    expect(evidence).toContain('ok: false');
    expect(evidence).toContain('ENOENT');
    expect(evidence).toContain('executor reached: false');
  });

  it('proves cloud mode is rejected on the local entrypoint', async () => {
    const result = await evaluateLocalProofCase('cloud-mode-rejection');
    const evidence = result.evidence.join('\n');

    expect(result.passed).toBe(true);
    expect(evidence).toContain('default executor ok: false');
    expect(evidence).toContain('local entrypoint: true');
  });
});
