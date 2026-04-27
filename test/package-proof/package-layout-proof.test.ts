import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  evaluatePackageProof,
  evaluatePackageProofCase,
  getPackageProofCases,
  summarizePackageProof,
  type ProofCaseName,
} from './package-layout-proof';

describe('Ricky workspace package layout and npm script parity proof', () => {
  it('proves all required workspace package layout cases', () => {
    const summary = summarizePackageProof();

    expect(summary.passed).toBe(true);
    expect(summary.failures).toEqual([]);
  });

  it('covers every proof case required by the workspace package contract', () => {
    const names = getPackageProofCases().map((proofCase) => proofCase.name);

    expect(names).toEqual([
      'npm-workspaces-are-the-default-path',
      'root-start-delegates-to-cli-workspace',
      'workspace-typecheck-runs-packages-and-root',
      'workspace-test-runs-packages-and-root',
      'root-package-is-private-orchestrator',
      'engines-and-package-manager-are-explicit',
      'workspace-package-manifests-exist',
      'workspace-package-boundaries-match-spec',
      'package-dependency-directions-are-sane',
      'tsconfig-covers-workspace-surfaces',
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

  it.each([
    ['npm-workspaces-are-the-default-path', ['packages/shared', 'package-lock.json exists: true']],
    ['root-start-delegates-to-cli-workspace', ['--workspace @ricky/cli', 'cli-main exists: true']],
    ['workspace-typecheck-runs-packages-and-root', ['runs workspaces: true', 'all packages have typecheck: true']],
    ['workspace-test-runs-packages-and-root', ['runs workspaces: true', 'all packages have test scripts: true']],
  ] satisfies Array<[ProofCaseName, string[]]>)(
    '%s proves npm workspace developer commands',
    (name, expectedEvidence) => {
      const result = evaluatePackageProofCase(name);
      const evidence = result.evidence.join('\n');

      expect(result.passed).toBe(true);
      for (const expected of expectedEvidence) {
        expect(evidence).toContain(expected);
      }
    },
  );

  it.each([
    ['root-package-is-private-orchestrator', ['private: true', 'root has @agent-relay/sdk: true']],
    ['engines-and-package-manager-are-explicit', ['requires >=20: true', 'uses npm: true']],
    ['workspace-package-manifests-exist', ['all package manifests present: true']],
    ['workspace-package-boundaries-match-spec', ['old src removed: true']],
    ['package-dependency-directions-are-sane', ['shared deps: (none)', 'cli depends on local/cloud: true']],
  ] satisfies Array<[ProofCaseName, string[]]>)(
    '%s proves package shape and dependency direction',
    (name, expectedEvidence) => {
      const result = evaluatePackageProofCase(name);
      const evidence = result.evidence.join('\n');

      expect(result.passed).toBe(true);
      for (const expected of expectedEvidence) {
        expect(evidence).toContain(expected);
      }
    },
  );

  it.each([
    ['tsconfig-covers-workspace-surfaces', ['covers packages/: true', 'covers workflows/: true', 'strict mode: true']],
    ['vitest-config-covers-test-surface', ['environment: node: true', 'setup file referenced: true']],
    ['product-entrypoints-exist', ['all present: true']],
    ['proof-surfaces-exist', ['all present: true', 'proof pattern: packages/<package>/src']],
  ] satisfies Array<[ProofCaseName, string[]]>)(
    '%s proves validation reaches migrated surfaces',
    (name, expectedEvidence) => {
      const result = evaluatePackageProofCase(name);
      const evidence = result.evidence.join('\n');

      expect(result.passed).toBe(true);
      for (const expected of expectedEvidence) {
        expect(evidence).toContain(expected);
      }
    },
  );

  it('proves batch and overnight scripts remain root workflow assets', () => {
    const result = evaluatePackageProofCase('batch-and-overnight-scripts-use-bash');
    const evidence = result.evidence.join('\n');

    expect(result.passed).toBe(true);
    expect(evidence).toContain('bash scripts/');
    expect(evidence).toContain('batch .sh exists: true');
    expect(evidence).toContain('overnight .sh exists: true');
  });

  it('keeps the overnight harness restart-safe and chunk-bounded', () => {
    const script = readFileSync('scripts/run-ricky-overnight.sh', 'utf8');

    expect(script).toContain('RICKY_OVERNIGHT_MAX_WORKFLOWS_PER_INVOCATION');
    expect(script).toContain('normalize_positive_integer()');
    expect(script).toContain('DEFAULT_MAX_WORKFLOWS_PER_INVOCATION=4');
    expect(script).toContain('MAX_WORKFLOWS_PER_INVOCATION="$(normalize_positive_integer');
    expect(script).toContain('RICKY_OVERNIGHT_STATE_DIR');
    expect(script).toContain('restore_checkpoint()');
    expect(script).toContain('persist_checkpoint()');
    expect(script).toContain("queue_mode=$(printf '%q' \"$QUEUE_MODE\")");
    expect(script).toContain("while IFS='=' read -r key raw_value;");
    expect(script).toContain("run_pid=$(printf '%q' \"$RUN_PID\")");
    expect(script).toContain("printf '%s\\n' 'stale' > \"$previous_status_file\"");
    expect(script).toContain('CURRENT_WORKFLOW="$workflow_path"');
    expect(script).toContain('start_runner()');
    expect(script).toContain('setsid unavailable; launching runner without detached process-group isolation');
    expect(script).toContain('workflow runner failed to start');
    expect(script).toContain('skipping missing workflow');
    expect(script).toContain('RUN_RESULT="skipped"');
    expect(script).toContain('RUNNER_START_PID=""');
    expect(script).toContain('RUNNER_START_PID="$!"');
    expect(script).not.toContain('runner_pid="$(start_runner');
    expect(script).toContain('if [[ "$RUN_RESULT" == "ran" ]]');
    expect(script).toContain('checkpointed');
    expect(script).toContain('workflows/wave5-scale-and-ops/04-prove-ricky-package-layout-and-script-parity.ts)');
    expect(script).toContain("git cat-file -e HEAD:test/package-proof/package-layout-proof.ts 2>/dev/null");
    expect(script).toContain('npm run typecheck >/dev/null');
    expect(script).toContain('npm test >/dev/null');
  });

  it('is fully deterministic — repeated evaluation yields identical results', () => {
    const first = evaluatePackageProof();
    const second = evaluatePackageProof();

    expect(first).toEqual(second);
  });

  it('completes in bounded time with no network dependency', () => {
    const start = performance.now();
    evaluatePackageProof();
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(1000);
  });
});
