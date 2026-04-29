import { describe, expect, it } from 'vitest';

import {
  evaluateWorkspaceLayoutProof,
  evaluateWorkspaceLayoutProofCase,
  getWorkspaceLayoutProofCases,
  summarizeWorkspaceLayoutProof,
  type WorkspaceLayoutProofCaseName,
} from './workspace-layout-proof.js';

describe('Ricky workspace layout proof', () => {
  it('all cases pass', () => {
    const summary = summarizeWorkspaceLayoutProof();

    expect(summary.passed).toBe(true);
    expect(summary.failures).toEqual([]);
  });

  it('covers every proof case required by the workspace package contract', () => {
    const names = getWorkspaceLayoutProofCases().map((proofCase) => proofCase.name);

    expect(names).toEqual([
      'workspace-packages-exist',
      'workspace-manager-truthful',
      'package-manifests-complete',
      'typescript-config-covers-workspace',
      'vitest-config-covers-workspace',
      'cli-bin-still-wired',
      'package-boundaries-by-manifest',
      'no-old-src-product-tree',
    ]);
  });

  it('keeps evidence user-visible and non-empty', () => {
    const results = evaluateWorkspaceLayoutProof();

    for (const result of results) {
      expect(result.evidence.length).toBeGreaterThan(0);
      expect(result.evidence[0].trim().length).toBeGreaterThan(0);
    }
  });

  it.each([
    ['workspace-packages-exist', ['required packages: packages/shared', 'packages/cli', 'all required package src dirs have .ts files: true']],
    [
      'workspace-manager-truthful',
      ['package.json name: @agentworkforce/ricky', 'package.json workspaces: ["packages/*"]', 'root publishable: true', 'package-lock.json exists: true'],
    ],
    ['package-manifests-complete', ['workspace package manifests checked: 6', 'packages/shared/package.json: exists=true']],
    ['typescript-config-covers-workspace', ['tsconfig.base.json exists: true', 'root references packages: true']],
    ['vitest-config-covers-workspace', ['picks up packages/*/src/**/*.test.ts: true', 'picks up test/**/*.test.ts: true']],
    ['cli-bin-still-wired', ['package.json bin.ricky: ./dist/ricky.js', 'packages/cli/src/bin/ricky.ts exists: true', 'prepack bundles the CLI: true']],
    ['package-boundaries-by-manifest', ['workspace dependency mismatches: 0']],
    ['no-old-src-product-tree', ['root src/ exists: false']],
  ] satisfies Array<[WorkspaceLayoutProofCaseName, string[]]>)(
    '%s proves the workspace contract with visible evidence',
    (name, expectedEvidence) => {
      const result = evaluateWorkspaceLayoutProofCase(name);
      const evidence = result.evidence.join('\n');

      expect(result.passed).toBe(true);
      for (const expected of expectedEvidence) {
        expect(evidence).toContain(expected);
      }
    },
  );

  it('is fully deterministic; repeated evaluation yields identical results', () => {
    const first = evaluateWorkspaceLayoutProof();
    const second = evaluateWorkspaceLayoutProof();

    expect(first).toEqual(second);
  });

  it('completes in bounded time with no network dependency', () => {
    const start = performance.now();
    evaluateWorkspaceLayoutProof();
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(1000);
  });
});
