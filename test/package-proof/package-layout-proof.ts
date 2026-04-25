/**
 * Ricky package layout and npm script parity proof surface.
 *
 * Proves the user-visible contract of the package shape:
 * - npm is the clear default path via package scripts and docs
 * - The current package shape is explicit and not an unexplained one-off
 * - typecheck/test entrypoints still cover the landed product surfaces
 *
 * Each proof case is deterministic and bounded — no network, no publish,
 * no non-determinism. Evidence is structural facts about the package layout.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';

// ---------------------------------------------------------------------------
// Proof types
// ---------------------------------------------------------------------------

export type ProofCaseName =
  | 'npm-scripts-are-the-default-path'
  | 'start-script-invokes-cli-entrypoint'
  | 'typecheck-script-is-tsc-no-emit'
  | 'test-script-is-vitest-run'
  | 'package-is-private-and-unpublished'
  | 'engines-require-modern-node'
  | 'package-fields-are-explicit'
  | 'tsconfig-covers-product-surfaces'
  | 'vitest-config-covers-test-surface'
  | 'product-entrypoints-exist'
  | 'proof-surfaces-exist'
  | 'batch-and-overnight-scripts-use-bash';

export interface PackageProofCase {
  name: ProofCaseName;
  description: string;
  evaluate: () => PackageProofResult;
}

export interface PackageProofResult {
  name: string;
  passed: boolean;
  evidence: string[];
  gaps: string[];
  failures: string[];
}

export interface PackageProofSummary {
  passed: boolean;
  failures: string[];
  gaps: string[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function repoRoot(): string {
  return resolve(__dirname, '../..');
}

function readJson(relPath: string): Record<string, unknown> {
  const abs = join(repoRoot(), relPath);
  return JSON.parse(readFileSync(abs, 'utf-8')) as Record<string, unknown>;
}

function fileExists(relPath: string): boolean {
  return existsSync(join(repoRoot(), relPath));
}

function result(
  name: ProofCaseName,
  checks: boolean[],
  evidence: string[],
  gaps: string[] = [],
  failures: string[] = [],
): PackageProofResult {
  return {
    name,
    passed: checks.every(Boolean) && failures.length === 0,
    evidence,
    gaps,
    failures,
  };
}

// ---------------------------------------------------------------------------
// Proof cases
// ---------------------------------------------------------------------------

export function getPackageProofCases(): PackageProofCase[] {
  const pkg = readJson('package.json') as {
    name?: string;
    private?: boolean;
    version?: string;
    description?: string;
    engines?: Record<string, string>;
    scripts?: Record<string, string>;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    bin?: unknown;
    main?: unknown;
    module?: unknown;
    types?: unknown;
    exports?: unknown;
    files?: unknown;
    publishConfig?: unknown;
  };

  const scripts = pkg.scripts ?? {};

  return [
    {
      name: 'npm-scripts-are-the-default-path',
      description:
        'npm run start/typecheck/test are the primary developer commands — ' +
        'no Makefile, no custom runner binary, no undocumented shell alias required.',
      evaluate: () => {
        const requiredScripts = ['start', 'typecheck', 'test'];
        const missing = requiredScripts.filter((s) => !(s in scripts));
        const noMakefile = !fileExists('Makefile');
        const noBinField = pkg.bin === undefined;

        return result(
          'npm-scripts-are-the-default-path',
          [missing.length === 0, noMakefile, noBinField],
          [
            `scripts present: ${requiredScripts.join(', ')}`,
            `no Makefile: ${noMakefile}`,
            `no bin field (private pkg): ${noBinField}`,
          ],
          [],
          missing.map((s) => `Missing required npm script: ${s}`),
        );
      },
    },
    {
      name: 'start-script-invokes-cli-entrypoint',
      description:
        'npm start runs the CLI entrypoint via ts-node — the user path is `npm start`, not a raw ts-node invocation.',
      evaluate: () => {
        const startScript = scripts.start ?? '';
        const pointsToCliMain = startScript.includes('src/commands/cli-main.ts');
        const usesNpxTsNode = startScript.includes('npx ts-node');

        return result(
          'start-script-invokes-cli-entrypoint',
          [pointsToCliMain, usesNpxTsNode],
          [
            `start script: ${startScript}`,
            `targets cli-main.ts: ${pointsToCliMain}`,
            `uses npx ts-node: ${usesNpxTsNode}`,
          ],
        );
      },
    },
    {
      name: 'typecheck-script-is-tsc-no-emit',
      description:
        'npm run typecheck runs tsc --noEmit — no build step, no emit, just type verification.',
      evaluate: () => {
        const typecheckScript = scripts.typecheck ?? '';
        const isTscNoEmit = typecheckScript === 'tsc --noEmit';

        return result(
          'typecheck-script-is-tsc-no-emit',
          [isTscNoEmit],
          [`typecheck script: ${typecheckScript}`, `is exactly tsc --noEmit: ${isTscNoEmit}`],
        );
      },
    },
    {
      name: 'test-script-is-vitest-run',
      description:
        'npm test runs vitest run — single-pass, deterministic, no watch mode by default.',
      evaluate: () => {
        const testScript = scripts.test ?? '';
        const isVitestRun = testScript === 'vitest run';

        return result(
          'test-script-is-vitest-run',
          [isVitestRun],
          [`test script: ${testScript}`, `is exactly vitest run: ${isVitestRun}`],
        );
      },
    },
    {
      name: 'package-is-private-and-unpublished',
      description:
        'Package is private:true with no publish-related fields — this is a product, not a library.',
      evaluate: () => {
        const isPrivate = pkg.private === true;
        const noPublishConfig = pkg.publishConfig === undefined;
        const noFiles = pkg.files === undefined;
        const noMain = pkg.main === undefined;
        const noModule = pkg.module === undefined;
        const noTypes = pkg.types === undefined;
        const noExports = pkg.exports === undefined;

        return result(
          'package-is-private-and-unpublished',
          [isPrivate, noPublishConfig, noFiles, noMain, noModule, noTypes, noExports],
          [
            `private: ${isPrivate}`,
            `no publishConfig: ${noPublishConfig}`,
            `no files field: ${noFiles}`,
            `no main: ${noMain}`,
            `no module: ${noModule}`,
            `no types: ${noTypes}`,
            `no exports: ${noExports}`,
          ],
        );
      },
    },
    {
      name: 'engines-require-modern-node',
      description:
        'engines.node constrains to >=20 — the package declares its Node requirement explicitly.',
      evaluate: () => {
        const nodeEngine = pkg.engines?.node ?? '';
        const requiresModern = nodeEngine === '>=20';

        return result(
          'engines-require-modern-node',
          [requiresModern],
          [`engines.node: ${nodeEngine}`, `requires >=20: ${requiresModern}`],
        );
      },
    },
    {
      name: 'package-fields-are-explicit',
      description:
        'name, version, and description are set — the package shape is intentional, not a leftover npm init.',
      evaluate: () => {
        const hasName = pkg.name === 'ricky';
        const hasVersion = typeof pkg.version === 'string' && pkg.version.length > 0;
        const hasDescription =
          typeof pkg.description === 'string' && pkg.description.includes('AgentWorkforce');
        const hasDeps = typeof pkg.dependencies === 'object' && pkg.dependencies !== null;
        const hasDevDeps = typeof pkg.devDependencies === 'object' && pkg.devDependencies !== null;
        const devDepsIncludeTypeScript = !!pkg.devDependencies?.typescript;
        const devDepsIncludeVitest = !!pkg.devDependencies?.vitest;

        return result(
          'package-fields-are-explicit',
          [hasName, hasVersion, hasDescription, hasDeps, hasDevDeps, devDepsIncludeTypeScript, devDepsIncludeVitest],
          [
            `name: ${pkg.name}`,
            `version: ${pkg.version}`,
            `description mentions AgentWorkforce: ${hasDescription}`,
            `has dependencies: ${hasDeps}`,
            `devDependencies include typescript: ${devDepsIncludeTypeScript}`,
            `devDependencies include vitest: ${devDepsIncludeVitest}`,
          ],
        );
      },
    },
    {
      name: 'tsconfig-covers-product-surfaces',
      description:
        'tsconfig.json include patterns cover src/ and workflows/ — typecheck reaches all product code.',
      evaluate: () => {
        const tsconfig = readJson('tsconfig.json') as {
          include?: string[];
          compilerOptions?: Record<string, unknown>;
        };
        const include = tsconfig.include ?? [];
        const coversSrc = include.some((p) => p.startsWith('src/'));
        const coversWorkflows = include.some((p) => p.startsWith('workflows/'));
        const coversVitestConfig = include.includes('vitest.config.ts');
        const strict = tsconfig.compilerOptions?.strict === true;

        return result(
          'tsconfig-covers-product-surfaces',
          [coversSrc, coversWorkflows, coversVitestConfig, strict],
          [
            `include: ${JSON.stringify(include)}`,
            `covers src/: ${coversSrc}`,
            `covers workflows/: ${coversWorkflows}`,
            `covers vitest.config.ts: ${coversVitestConfig}`,
            `strict mode: ${strict}`,
          ],
        );
      },
    },
    {
      name: 'vitest-config-covers-test-surface',
      description:
        'vitest.config.ts configures node environment, globals, and setup — test runner is deterministic.',
      evaluate: () => {
        const vitestConfigExists = fileExists('vitest.config.ts');
        const setupExists = fileExists('src/test/setup.ts');

        // Read vitest config as text to verify key settings
        let configText = '';
        if (vitestConfigExists) {
          configText = readFileSync(join(repoRoot(), 'vitest.config.ts'), 'utf-8');
        }
        const hasNodeEnv = configText.includes("environment: 'node'");
        const hasGlobals = configText.includes('globals: true');
        const hasSetup = configText.includes('src/test/setup.ts');

        return result(
          'vitest-config-covers-test-surface',
          [vitestConfigExists, setupExists, hasNodeEnv, hasGlobals, hasSetup],
          [
            `vitest.config.ts exists: ${vitestConfigExists}`,
            `setup file exists: ${setupExists}`,
            `environment: node: ${hasNodeEnv}`,
            `globals: true: ${hasGlobals}`,
            `setup file referenced: ${hasSetup}`,
          ],
        );
      },
    },
    {
      name: 'product-entrypoints-exist',
      description:
        'All landed product entrypoints exist on disk — typecheck and test actually reach real code.',
      evaluate: () => {
        const entrypoints = [
          'src/commands/cli-main.ts',
          'src/entrypoint/interactive-cli.ts',
          'src/cli/index.ts',
          'src/cli/onboarding.ts',
          'src/cli/ascii-art.ts',
          'src/cli/welcome.ts',
          'src/cli/mode-selector.ts',
          'src/local/entrypoint.ts',
          'src/local/request-normalizer.ts',
          'src/cloud/api/generate-endpoint.ts',
          'src/runtime/diagnostics/failure-diagnosis.ts',
        ];

        const missing = entrypoints.filter((f) => !fileExists(f));

        return result(
          'product-entrypoints-exist',
          [missing.length === 0],
          [
            `entrypoints checked: ${entrypoints.length}`,
            `all present: ${missing.length === 0}`,
          ],
          [],
          missing.map((f) => `Missing product entrypoint: ${f}`),
        );
      },
    },
    {
      name: 'proof-surfaces-exist',
      description:
        'Each landed product surface has a co-located proof — the proof pattern is consistent, not ad-hoc.',
      evaluate: () => {
        const proofPairs = [
          ['src/cli/proof/onboarding-proof.ts', 'src/cli/proof/onboarding-proof.test.ts'],
          ['src/local/proof/local-entrypoint-proof.ts', 'src/local/proof/local-entrypoint-proof.test.ts'],
          ['src/cloud/api/proof/cloud-generate-proof.ts', 'src/cloud/api/proof/cloud-generate-proof.test.ts'],
          ['src/runtime/diagnostics/proof/unblocker-proof.ts', 'src/runtime/diagnostics/proof/unblocker-proof.test.ts'],
        ];

        const missing: string[] = [];
        for (const [proof, test] of proofPairs) {
          if (!fileExists(proof)) missing.push(proof);
          if (!fileExists(test)) missing.push(test);
        }

        return result(
          'proof-surfaces-exist',
          [missing.length === 0],
          [
            `proof pairs checked: ${proofPairs.length}`,
            `all present: ${missing.length === 0}`,
            `proof pattern: src/<surface>/proof/<name>-proof.ts + .test.ts`,
          ],
          [],
          missing.map((f) => `Missing proof file: ${f}`),
        );
      },
    },
    {
      name: 'batch-and-overnight-scripts-use-bash',
      description:
        'batch and overnight scripts delegate to bash — npm is the entry, bash is the orchestrator.',
      evaluate: () => {
        const batchScript = scripts.batch ?? '';
        const overnightScript = scripts.overnight ?? '';
        const batchUsesBash = batchScript.startsWith('bash scripts/');
        const overnightUsesBash = overnightScript.startsWith('bash scripts/');
        const batchShExists = fileExists('scripts/run-ricky-batch.sh');
        const overnightShExists = fileExists('scripts/run-ricky-overnight.sh');

        return result(
          'batch-and-overnight-scripts-use-bash',
          [batchUsesBash, overnightUsesBash, batchShExists, overnightShExists],
          [
            `batch script: ${batchScript}`,
            `overnight script: ${overnightScript}`,
            `batch .sh exists: ${batchShExists}`,
            `overnight .sh exists: ${overnightShExists}`,
          ],
        );
      },
    },
  ];
}

// ---------------------------------------------------------------------------
// Evaluation API
// ---------------------------------------------------------------------------

export function evaluatePackageProof(): PackageProofResult[] {
  return getPackageProofCases().map((proofCase) => proofCase.evaluate());
}

export function evaluatePackageProofCase(name: ProofCaseName): PackageProofResult {
  const proofCase = getPackageProofCases().find((candidate) => candidate.name === name);
  if (!proofCase) {
    throw new Error(`Unknown package proof case: ${name}`);
  }
  return proofCase.evaluate();
}

export function summarizePackageProof(): PackageProofSummary {
  const results = evaluatePackageProof();
  const failures = results.flatMap((r) =>
    r.passed ? [] : [`${r.name}: ${r.failures.join('; ') || 'contract assertion failed'}`],
  );
  const gaps = results.flatMap((r) => r.gaps.map((gap) => `${r.name}: ${gap}`));

  return {
    passed: failures.length === 0,
    failures,
    gaps,
  };
}
