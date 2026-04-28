import { describe, expect, it } from 'vitest';

import {
  evaluateFlatLayoutProof,
  evaluateFlatLayoutProofCase,
  getFlatLayoutProofCases,
  summarizeFlatLayoutProof,
  type FlatLayoutProofCaseName,
} from './flat-layout-proof.js';

describe('Ricky flat src layout proof', () => {
  it('all cases pass', () => {
    const summary = summarizeFlatLayoutProof();

    expect(summary.passed).toBe(true);
    expect(summary.failures).toEqual([]);
  });

  it('covers every proof case required by the flat src contract', () => {
    const names = getFlatLayoutProofCases().map((proofCase) => proofCase.name);

    expect(names).toEqual([
      'flat-src-tree-exists',
      'workspaces-removed',
      'single-package-manifest',
      'single-tsconfig-covers-src',
      'single-vitest-config',
      'no-cross-package-aliases',
      'cli-bin-still-wired',
      'legacy-packages-removed',
      'surface-folder-shape',
      'layer-direction-by-folder',
    ]);
  });

  it('keeps evidence user-visible and non-empty', () => {
    const results = evaluateFlatLayoutProof();

    for (const result of results) {
      expect(result.evidence.length).toBeGreaterThan(0);
      expect(result.evidence[0].trim().length).toBeGreaterThan(0);
    }
  });

  it.each([
    ['flat-src-tree-exists', ['required src dirs: src/shared', 'src/surfaces/cli', 'all required src dirs have .ts files: true']],
    ['workspaces-removed', ['package.json has workspaces key: false']],
    ['single-package-manifest', ['package.json files: package.json', 'only root package.json: true']],
    ['single-tsconfig-covers-src', ['only root tsconfig.json: true', 'include references src: true', 'strict mode: true']],
    ['single-vitest-config', ['only root vitest.config.ts: true', 'picks up src/**/*.test.ts: true']],
    [
      'no-cross-package-aliases',
      ['@ricky/* import specifiers under src: 0', 'package.json has file:../ references: false'],
    ],
    ['cli-bin-still-wired', ['bin/ricky exists: true', 'package.json bin.ricky:', 'src/surfaces/cli/: true']],
    ['legacy-packages-removed', ['packages/ exists: false', 'packages/ file count: 0']],
    ['surface-folder-shape', ['src/surfaces exists: true', 'src/surfaces/cli exists: true', 'future surface homes documented: src/surfaces/slack']],
    ['layer-direction-by-folder', ['layer direction violations: 0']],
  ] satisfies Array<[FlatLayoutProofCaseName, string[]]>)(
    '%s proves the flat src contract with visible evidence',
    (name, expectedEvidence) => {
      const result = evaluateFlatLayoutProofCase(name);
      const evidence = result.evidence.join('\n');

      expect(result.passed).toBe(true);
      for (const expected of expectedEvidence) {
        expect(evidence).toContain(expected);
      }
    },
  );

  it('is fully deterministic — repeated evaluation yields identical results', () => {
    const first = evaluateFlatLayoutProof();
    const second = evaluateFlatLayoutProof();

    expect(first).toEqual(second);
  });

  it('completes in bounded time with no network dependency', () => {
    const start = performance.now();
    evaluateFlatLayoutProof();
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(1000);
  });
});
