import { describe, expect, it } from 'vitest';

import {
  evaluatePackageLayoutProof,
  evaluatePackageLayoutProofCase,
  getPackageLayoutProofCases,
  summarizePackageLayoutProof,
  type PackageLayoutProofCaseName,
} from './package-layout-proof.js';

describe('Ricky package layout and npm-default proof', () => {
  it('all cases pass', () => {
    const summary = summarizePackageLayoutProof();

    expect(summary.passed).toBe(true);
    expect(summary.failures).toEqual([]);
  });

  it('covers every proof case required by the package layout contract', () => {
    const names = getPackageLayoutProofCases().map((proofCase) => proofCase.name);

    expect(names).toEqual([
      'npm-default-package-manifest',
      'npm-default-runtime-pinning',
      'npm-default-readme-prose',
      'package-shape-required-fields',
      'package-script-allowlist',
      'package-script-readme-parity',
      'bin-points-to-published-bundle',
      'typecheck-config-covers-surfaces',
      'vitest-config-covers-surfaces',
      'no-live-network-or-publish-dependency',
    ]);
  });

  it.each([
    [
      'npm-default-package-manifest',
      [
        'package.json packageManager: npm@',
        'package.json workspaces declared: false',
        'package-lock.json present: true',
        'alternative lockfiles present: (none)',
      ],
    ],
    [
      'npm-default-runtime-pinning',
      [
        '.npmrc exists: true',
        '.nvmrc exists: true',
        '.npmrc declares engine-strict=true: true',
      ],
    ],
    [
      'npm-default-readme-prose',
      [
        'README mentions all of [npm install, npm run build, npm test, npm start]: true',
        'README states npm is the default/only path: true',
      ],
    ],
    [
      'package-shape-required-fields',
      [
        'package.json name: @agentworkforce/ricky',
        'package.json type: module',
        'package.json files is non-empty array: true',
        'package.json publishConfig.access: public',
        'package.json bin.ricky present: true',
        'package.json file: protocol deps: (none)',
      ],
    ],
    [
      'package-script-allowlist',
      [
        'required scripts: batch, build, bundle, clean, dev, overnight, prepack, start, test, typecheck',
        'missing required scripts: (none)',
        'unexpected extra scripts: (none)',
      ],
    ],
    [
      'package-script-readme-parity',
      [
        'undocumented scripts: (none)',
      ],
    ],
    [
      'bin-points-to-published-bundle',
      [
        'package.json bin.ricky: ./dist/ricky.js',
        'published files include dist: true',
        'scripts/bundle-cli.mjs exists: true',
        'src/surfaces/cli/bin/ricky.ts exists: true',
        'src/surfaces/cli/commands/cli-main.ts exists: true',
      ],
    ],
    [
      'typecheck-config-covers-surfaces',
      [
        'missing tsconfig include entries: (none)',
        'tsconfig include directories missing on disk: (none)',
        'compilerOptions.strict: true',
        'landed product surfaces present: 6/6',
      ],
    ],
    [
      'vitest-config-covers-surfaces',
      [
        'missing required vitest globs: (none)',
        'vitest test.environment is node: true',
        'vitest declares setupFiles: true',
      ],
    ],
    [
      'no-live-network-or-publish-dependency',
      [
        'network module imports in proof: (none)',
        'child_process imports in proof: (none)',
        'unexpected imports in proof: (none)',
      ],
    ],
  ] satisfies Array<[PackageLayoutProofCaseName, string[]]>)(
    '%s proves the package layout contract with visible evidence',
    (name, expectedEvidence) => {
      const proofResult = evaluatePackageLayoutProofCase(name);
      const evidence = proofResult.evidence.join('\n');

      expect(proofResult.passed).toBe(true);
      for (const expected of expectedEvidence) {
        expect(evidence).toContain(expected);
      }
    },
  );

  it('is fully deterministic; repeated evaluation yields identical results', () => {
    const first = evaluatePackageLayoutProof();
    const second = evaluatePackageLayoutProof();

    expect(first).toEqual(second);
  });

  it('completes in bounded time with no live network dependency', () => {
    const start = performance.now();
    evaluatePackageLayoutProof();
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(2000);
  });
});
