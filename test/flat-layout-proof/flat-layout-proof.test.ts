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

  it.each([
    [
      'flat-src-tree-exists',
      ['required src dirs: src/shared', 'src/surfaces/cli', 'all required flat src dirs have .ts files: true'],
    ],
    ['workspaces-removed', ['package.json has workspaces key: false']],
    ['single-package-manifest', ['package.json files found: 1', 'package.json file list: package.json']],
    [
      'single-tsconfig-covers-src',
      ['tsconfig.json files found: 1', 'only root tsconfig.json: true', 'root include references src: true', 'root compilerOptions.strict: true'],
    ],
    ['single-vitest-config', ['vitest.config.ts files found: 1', 'only root vitest.config.ts: true', 'picks up src/**/*.test.ts: true', 'contains legacy packages/ test globs: false']],
    [
      'no-cross-package-aliases',
      ['@ricky import specifiers under src: 0', 'package.json has file:../ references: false', 'surfaces use relative inner-layer imports only: true'],
    ],
    [
      'cli-bin-still-wired',
      ['package.json bin.ricky: ./dist/ricky.js', 'src/surfaces/cli/bin/ricky.ts exists: true', 'prepack builds the bundle: true'],
    ],
    ['legacy-packages-removed', ['packages/ exists: false', 'packages/ file count: 0']],
    ['surface-folder-shape', ['src/surfaces exists: true', 'src/surfaces/cli exists: true', 'future surfaces documented: slack/, web/, mac/']],
    [
      'layer-direction-by-folder',
      [
        'layer direction violations: 0',
        'checked rules: shared !-> runtime|product|cloud|local|surfaces; runtime !-> product|cloud|local|surfaces; product !-> cloud|local|surfaces; cloud/local !-> surfaces',
      ],
    ],
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

  it('is fully deterministic; repeated evaluation yields identical results', () => {
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
