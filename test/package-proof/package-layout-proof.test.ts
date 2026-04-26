import { describe, expect, it } from 'vitest';

import {
  evaluatePackageProof,
  evaluatePackageProofCase,
  getPackageProofCases,
  summarizePackageProof,
  type ProofCaseName,
} from './package-layout-proof';

describe('Ricky package layout and npm script parity proof', () => {
  it('proves all required package layout cases', () => {
    const summary = summarizePackageProof();

    expect(summary.passed).toBe(true);
    expect(summary.failures).toEqual([]);
  });

  it('covers every proof case required by the package contract', () => {
    const names = getPackageProofCases().map((proofCase) => proofCase.name);

    expect(names).toEqual([
      'npm-scripts-are-the-default-path',
      'start-script-invokes-cli-entrypoint',
      'typecheck-script-is-tsc-no-emit',
      'test-script-is-vitest-run',
      'package-is-private-and-unpublished',
      'engines-require-modern-node',
      'package-fields-are-explicit',
      'tsconfig-covers-product-surfaces',
      'vitest-config-covers-test-surface',
      'product-entrypoints-exist',
      'proof-surfaces-exist',
      'batch-and-overnight-scripts-use-bash',
    ]);
  });

  it('keeps evidence user-visible and non-empty', () => {
    const results = evaluatePackageProof();

    for (const result of results) {
      expect(result.evidence.length).toBeGreaterThan(0);
      expect(result.evidence[0].trim().length).toBeGreaterThan(0);
    }
  });

  // ---------------------------------------------------------------------------
  // npm is the default path — scripts and docs prove it
  // ---------------------------------------------------------------------------

  it.each([
    ['npm-scripts-are-the-default-path', ['scripts present: start, typecheck, test', 'no Makefile: true']],
    ['start-script-invokes-cli-entrypoint', ['src/commands/cli-main.ts', 'uses tsx: true']],
    ['typecheck-script-is-tsc-no-emit', ['tsc --noEmit', 'is exactly tsc --noEmit: true']],
    ['test-script-is-vitest-run', ['vitest run', 'is exactly vitest run: true']],
  ] satisfies Array<[ProofCaseName, string[]]>)(
    '%s proves npm is the clear default developer path',
    (name, expectedEvidence) => {
      const result = evaluatePackageProofCase(name);
      const evidence = result.evidence.join('\n');

      expect(result.passed).toBe(true);
      for (const expected of expectedEvidence) {
        expect(evidence).toContain(expected);
      }
    },
  );

  // ---------------------------------------------------------------------------
  // Package shape is explicit and intentional
  // ---------------------------------------------------------------------------

  it.each([
    ['package-is-private-and-unpublished', ['private: true', 'no publishConfig: true']],
    ['engines-require-modern-node', ['engines.node: >=20', 'requires >=20: true']],
    ['package-fields-are-explicit', ['name: ricky', 'AgentWorkforce', 'typescript', 'vitest']],
  ] satisfies Array<[ProofCaseName, string[]]>)(
    '%s proves package shape is explicit and not an unexplained one-off',
    (name, expectedEvidence) => {
      const result = evaluatePackageProofCase(name);
      const evidence = result.evidence.join('\n');

      expect(result.passed).toBe(true);
      for (const expected of expectedEvidence) {
        expect(evidence).toContain(expected);
      }
    },
  );

  // ---------------------------------------------------------------------------
  // Typecheck and test entrypoints cover landed surfaces
  // ---------------------------------------------------------------------------

  it.each([
    ['tsconfig-covers-product-surfaces', ['covers src/: true', 'covers workflows/: true', 'strict mode: true']],
    ['vitest-config-covers-test-surface', ['environment: node: true', 'globals: true', 'setup file referenced: true']],
    ['product-entrypoints-exist', ['all present: true']],
    ['proof-surfaces-exist', ['all present: true', 'proof pattern:']],
  ] satisfies Array<[ProofCaseName, string[]]>)(
    '%s proves typecheck/test entrypoints cover landed product surfaces',
    (name, expectedEvidence) => {
      const result = evaluatePackageProofCase(name);
      const evidence = result.evidence.join('\n');

      expect(result.passed).toBe(true);
      for (const expected of expectedEvidence) {
        expect(evidence).toContain(expected);
      }
    },
  );

  // ---------------------------------------------------------------------------
  // Orchestration scripts
  // ---------------------------------------------------------------------------

  it('proves batch and overnight scripts delegate through npm to bash', () => {
    const result = evaluatePackageProofCase('batch-and-overnight-scripts-use-bash');
    const evidence = result.evidence.join('\n');

    expect(result.passed).toBe(true);
    expect(evidence).toContain('bash scripts/');
    expect(evidence).toContain('batch .sh exists: true');
    expect(evidence).toContain('overnight .sh exists: true');
  });

  // ---------------------------------------------------------------------------
  // Determinism and boundedness
  // ---------------------------------------------------------------------------

  it('is fully deterministic — repeated evaluation yields identical results', () => {
    const first = evaluatePackageProof();
    const second = evaluatePackageProof();

    expect(first).toEqual(second);
  });

  it('completes in bounded time with no network dependency', () => {
    const start = performance.now();
    evaluatePackageProof();
    const elapsed = performance.now() - start;

    // All proof cases are filesystem reads — should complete in well under 1 second
    expect(elapsed).toBeLessThan(1000);
  });
});
