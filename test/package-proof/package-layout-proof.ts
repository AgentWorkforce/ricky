/**
 * Ricky workspace package layout and npm script parity proof surface.
 *
 * Proves the user-visible package contract after the workspace split:
 * - npm workspaces are the clear bootstrap path
 * - package manifests and dependency direction match the migration spec
 * - typecheck/test/start entrypoints cover the workspace without relying on old src/*
 */

import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

export type ProofCaseName =
  | 'npm-workspaces-are-the-default-path'
  | 'root-start-delegates-to-cli-workspace'
  | 'workspace-typecheck-runs-packages-and-root'
  | 'workspace-test-runs-packages-and-root'
  | 'root-package-is-private-orchestrator'
  | 'engines-and-package-manager-are-explicit'
  | 'workspace-package-manifests-exist'
  | 'workspace-package-boundaries-match-spec'
  | 'package-dependency-directions-are-sane'
  | 'tsconfig-covers-workspace-surfaces'
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

const WORKSPACE_PACKAGES = ['shared', 'runtime', 'product', 'cloud', 'local', 'cli'] as const;

function repoRoot(): string {
  return resolve(__dirname, '../..');
}

function readJson<T extends Record<string, unknown>>(relPath: string): T {
  return JSON.parse(readFileSync(join(repoRoot(), relPath), 'utf-8')) as T;
}

function readText(relPath: string): string {
  return readFileSync(join(repoRoot(), relPath), 'utf-8');
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

function packageJson(packageName: string): {
  name?: string;
  private?: boolean;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  exports?: unknown;
} {
  return readJson(`packages/${packageName}/package.json`);
}

export function getPackageProofCases(): PackageProofCase[] {
  const pkg = readJson<{
    name?: string;
    private?: boolean;
    packageManager?: string;
    engines?: Record<string, string>;
    scripts?: Record<string, string>;
    workspaces?: string[];
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  }>('package.json');
  const scripts = pkg.scripts ?? {};
  const workspaces = pkg.workspaces ?? [];

  return [
    {
      name: 'npm-workspaces-are-the-default-path',
      description: 'Root package.json declares npm workspaces and README documents npm install.',
      evaluate: () => {
        const expected = WORKSPACE_PACKAGES.map((name) => `packages/${name}`);
        const missing = expected.filter((workspace) => !workspaces.includes(workspace));
        const hasLockfile = fileExists('package-lock.json');
        const readme = readText('README.md');
        const readmeMentionsNpmInstall = readme.includes('npm install');
        const readmeMentionsWorkspaces = readme.includes('npm workspaces');

        return result(
          'npm-workspaces-are-the-default-path',
          [missing.length === 0, hasLockfile, readmeMentionsNpmInstall, readmeMentionsWorkspaces],
          [
            `workspaces: ${workspaces.join(', ')}`,
            `package-lock.json exists: ${hasLockfile}`,
            `README mentions npm install: ${readmeMentionsNpmInstall}`,
            `README mentions npm workspaces: ${readmeMentionsWorkspaces}`,
          ],
          [],
          missing.map((workspace) => `Missing workspace: ${workspace}`),
        );
      },
    },
    {
      name: 'root-start-delegates-to-cli-workspace',
      description: 'npm start remains the root user command and delegates to @ricky/cli.',
      evaluate: () => {
        const startScript = scripts.start ?? '';
        const delegatesToCli = startScript.includes('--workspace @ricky/cli');
        const cliStart = packageJson('cli').scripts?.start ?? '';
        const cliMainExists = fileExists('packages/cli/src/commands/cli-main.ts');

        return result(
          'root-start-delegates-to-cli-workspace',
          [delegatesToCli, cliStart.includes('src/commands/cli-main.ts'), cliMainExists],
          [
            `root start script: ${startScript}`,
            `delegates to @ricky/cli: ${delegatesToCli}`,
            `cli start script: ${cliStart}`,
            `cli-main exists: ${cliMainExists}`,
          ],
        );
      },
    },
    {
      name: 'workspace-typecheck-runs-packages-and-root',
      description: 'Root typecheck runs workspace package typechecks and root workflow/proof typechecking.',
      evaluate: () => {
        const typecheckScript = scripts.typecheck ?? '';
        const runsWorkspaces = typecheckScript.includes('--workspaces');
        const runsRootTsc = typecheckScript.includes('tsc --noEmit');
        const packageScripts = WORKSPACE_PACKAGES.map((name) => packageJson(name).scripts?.typecheck ?? '');
        const allPackagesHaveTypecheck = packageScripts.every((script) => script.includes('tsc -p tsconfig.json'));

        return result(
          'workspace-typecheck-runs-packages-and-root',
          [runsWorkspaces, runsRootTsc, allPackagesHaveTypecheck],
          [
            `typecheck script: ${typecheckScript}`,
            `runs workspaces: ${runsWorkspaces}`,
            `runs root tsc: ${runsRootTsc}`,
            `all packages have typecheck: ${allPackagesHaveTypecheck}`,
          ],
        );
      },
    },
    {
      name: 'workspace-test-runs-packages-and-root',
      description: 'Root test runs workspace package tests and root proof tests.',
      evaluate: () => {
        const testScript = scripts.test ?? '';
        const runsWorkspaces = testScript.includes('--workspaces');
        const runsRootTests = testScript.includes('vitest run test');
        const packageScripts = WORKSPACE_PACKAGES.map((name) => packageJson(name).scripts?.test ?? '');
        const allPackagesHaveTests = packageScripts.every((script) => script.includes('vitest run'));

        return result(
          'workspace-test-runs-packages-and-root',
          [runsWorkspaces, runsRootTests, allPackagesHaveTests],
          [
            `test script: ${testScript}`,
            `runs workspaces: ${runsWorkspaces}`,
            `runs root tests: ${runsRootTests}`,
            `all packages have test scripts: ${allPackagesHaveTests}`,
          ],
        );
      },
    },
    {
      name: 'root-package-is-private-orchestrator',
      description: 'Root package remains private and keeps product orchestration dependencies at the root.',
      evaluate: () => {
        const isPrivate = pkg.private === true;
        const rootHasAgentRelay = !!pkg.dependencies?.['@agent-relay/sdk'];
        const rootHasTypescript = !!pkg.devDependencies?.typescript;
        const rootHasVitest = !!pkg.devDependencies?.vitest;

        return result(
          'root-package-is-private-orchestrator',
          [isPrivate, rootHasAgentRelay, rootHasTypescript, rootHasVitest],
          [
            `private: ${isPrivate}`,
            `root has @agent-relay/sdk: ${rootHasAgentRelay}`,
            `root has typescript: ${rootHasTypescript}`,
            `root has vitest: ${rootHasVitest}`,
          ],
        );
      },
    },
    {
      name: 'engines-and-package-manager-are-explicit',
      description: 'Root package declares the Node engine and npm package manager used for the workspace.',
      evaluate: () => {
        const nodeEngine = pkg.engines?.node ?? '';
        const packageManager = pkg.packageManager ?? '';
        const requiresModernNode = nodeEngine === '>=20';
        const usesNpm = packageManager.startsWith('npm@');

        return result(
          'engines-and-package-manager-are-explicit',
          [requiresModernNode, usesNpm],
          [
            `engines.node: ${nodeEngine}`,
            `requires >=20: ${requiresModernNode}`,
            `packageManager: ${packageManager}`,
            `uses npm: ${usesNpm}`,
          ],
        );
      },
    },
    {
      name: 'workspace-package-manifests-exist',
      description: 'Every target package has a package.json and tsconfig.json.',
      evaluate: () => {
        const missing = WORKSPACE_PACKAGES.flatMap((name) =>
          [`packages/${name}/package.json`, `packages/${name}/tsconfig.json`].filter((file) => !fileExists(file)),
        );

        return result(
          'workspace-package-manifests-exist',
          [missing.length === 0],
          [
            `packages checked: ${WORKSPACE_PACKAGES.join(', ')}`,
            `all package manifests present: ${missing.length === 0}`,
          ],
          [],
          missing.map((file) => `Missing package file: ${file}`),
        );
      },
    },
    {
      name: 'workspace-package-boundaries-match-spec',
      description: 'Moved source directories match the six package responsibilities from the migration spec.',
      evaluate: () => {
        const requiredFiles = [
          'packages/shared/src/constants.ts',
          'packages/shared/src/models/workflow-config.ts',
          'packages/runtime/src/local-coordinator.ts',
          'packages/runtime/src/evidence/capture.ts',
          'packages/runtime/src/failure/classifier.ts',
          'packages/runtime/src/diagnostics/failure-diagnosis.ts',
          'packages/product/src/spec-intake/index.ts',
          'packages/product/src/generation/pipeline.ts',
          'packages/product/src/specialists/debugger/debugger.ts',
          'packages/product/src/specialists/validator/validator.ts',
          'packages/product/src/analytics/health-analyzer.ts',
          'packages/cloud/src/auth/request-validator.ts',
          'packages/cloud/src/api/generate-endpoint.ts',
          'packages/local/src/entrypoint.ts',
          'packages/local/src/request-normalizer.ts',
          'packages/cli/src/cli/onboarding.ts',
          'packages/cli/src/commands/cli-main.ts',
          'packages/cli/src/entrypoint/interactive-cli.ts',
        ];
        const missing = requiredFiles.filter((file) => !fileExists(file));
        const oldSrcRemoved = !fileExists('src');

        return result(
          'workspace-package-boundaries-match-spec',
          [missing.length === 0, oldSrcRemoved],
          [
            `required moved files checked: ${requiredFiles.length}`,
            `all moved files present: ${missing.length === 0}`,
            `old src removed: ${oldSrcRemoved}`,
          ],
          [],
          missing.map((file) => `Missing moved source file: ${file}`),
        );
      },
    },
    {
      name: 'package-dependency-directions-are-sane',
      description: 'Package dependencies point upward from shared/runtime/product into composition packages only.',
      evaluate: () => {
        const deps = Object.fromEntries(
          WORKSPACE_PACKAGES.map((name) => [name, Object.keys(packageJson(name).dependencies ?? {})]),
        ) as Record<(typeof WORKSPACE_PACKAGES)[number], string[]>;

        const sharedHasNoDeps = deps.shared.length === 0;
        const runtimeOnlyShared = JSON.stringify(deps.runtime) === JSON.stringify(['@ricky/shared']);
        const productDeps = deps.product.sort().join(',');
        const productOnlyLower = productDeps === '@ricky/runtime,@ricky/shared';
        const cliDependsOnComposition = deps.cli.includes('@ricky/local') && deps.cli.includes('@ricky/cloud');

        return result(
          'package-dependency-directions-are-sane',
          [sharedHasNoDeps, runtimeOnlyShared, productOnlyLower, cliDependsOnComposition],
          [
            `shared deps: ${deps.shared.join(', ') || '(none)'}`,
            `runtime deps: ${deps.runtime.join(', ')}`,
            `product deps: ${productDeps}`,
            `cli depends on local/cloud: ${cliDependsOnComposition}`,
          ],
        );
      },
    },
    {
      name: 'tsconfig-covers-workspace-surfaces',
      description: 'Root tsconfig covers packages, workflows, root tests, and Vitest config.',
      evaluate: () => {
        const tsconfig = readJson<{ include?: string[]; extends?: string }>('tsconfig.json');
        const base = readJson<{ compilerOptions?: Record<string, unknown> }>('tsconfig.base.json');
        const include = tsconfig.include ?? [];
        const coversPackages = include.some((pattern) => pattern.startsWith('packages/'));
        const coversWorkflows = include.some((pattern) => pattern.startsWith('workflows/'));
        const coversTests = include.some((pattern) => pattern.startsWith('test/'));
        const coversVitestConfig = include.includes('vitest.config.ts');
        const strict = base.compilerOptions?.strict === true;
        const hasRickyPaths = JSON.stringify(base.compilerOptions?.paths ?? {}).includes('@ricky/runtime');

        return result(
          'tsconfig-covers-workspace-surfaces',
          [coversPackages, coversWorkflows, coversTests, coversVitestConfig, strict, hasRickyPaths],
          [
            `include: ${JSON.stringify(include)}`,
            `covers packages/: ${coversPackages}`,
            `covers workflows/: ${coversWorkflows}`,
            `covers test/: ${coversTests}`,
            `covers vitest.config.ts: ${coversVitestConfig}`,
            `strict mode: ${strict}`,
            `has @ricky paths: ${hasRickyPaths}`,
          ],
        );
      },
    },
    {
      name: 'vitest-config-covers-test-surface',
      description: 'Vitest config keeps node globals and points setup at the moved root test setup.',
      evaluate: () => {
        const configText = readText('vitest.config.ts');
        const setupExists = fileExists('test/setup.ts');
        const hasNodeEnv = configText.includes("environment: 'node'");
        const hasGlobals = configText.includes('globals: true');
        const hasSetup = configText.includes('test/setup.ts');

        return result(
          'vitest-config-covers-test-surface',
          [setupExists, hasNodeEnv, hasGlobals, hasSetup],
          [
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
      description: 'All landed package entrypoints exist on disk.',
      evaluate: () => {
        const entrypoints = [
          'packages/shared/src/index.ts',
          'packages/runtime/src/index.ts',
          'packages/product/src/index.ts',
          'packages/cloud/src/index.ts',
          'packages/local/src/index.ts',
          'packages/cli/src/index.ts',
          'packages/cli/src/commands/cli-main.ts',
          'packages/cli/src/entrypoint/interactive-cli.ts',
          'packages/local/src/entrypoint.ts',
          'packages/cloud/src/api/generate-endpoint.ts',
          'packages/runtime/src/diagnostics/failure-diagnosis.ts',
        ];
        const missing = entrypoints.filter((file) => !fileExists(file));

        return result(
          'product-entrypoints-exist',
          [missing.length === 0],
          [`entrypoints checked: ${entrypoints.length}`, `all present: ${missing.length === 0}`],
          [],
          missing.map((file) => `Missing product entrypoint: ${file}`),
        );
      },
    },
    {
      name: 'proof-surfaces-exist',
      description: 'Moved product proof files remain co-located with their owning package surfaces.',
      evaluate: () => {
        const proofPairs = [
          ['packages/cli/src/cli/proof/onboarding-proof.ts', 'packages/cli/src/cli/proof/onboarding-proof.test.ts'],
          ['packages/local/src/proof/local-entrypoint-proof.ts', 'packages/local/src/proof/local-entrypoint-proof.test.ts'],
          ['packages/cloud/src/api/proof/cloud-generate-proof.ts', 'packages/cloud/src/api/proof/cloud-generate-proof.test.ts'],
          [
            'packages/runtime/src/diagnostics/proof/unblocker-proof.ts',
            'packages/runtime/src/diagnostics/proof/unblocker-proof.test.ts',
          ],
        ];
        const missing = proofPairs.flatMap(([proof, test]) => [proof, test].filter((file) => !fileExists(file)));

        return result(
          'proof-surfaces-exist',
          [missing.length === 0],
          [
            `proof pairs checked: ${proofPairs.length}`,
            `all present: ${missing.length === 0}`,
            `proof pattern: packages/<package>/src/**/proof/<name>-proof.ts + .test.ts`,
          ],
          [],
          missing.map((file) => `Missing proof file: ${file}`),
        );
      },
    },
    {
      name: 'batch-and-overnight-scripts-use-bash',
      description: 'batch and overnight scripts remain root-owned workflow program assets.',
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
  const failures = results.flatMap((proofResult) =>
    proofResult.passed ? [] : [`${proofResult.name}: ${proofResult.failures.join('; ') || 'contract assertion failed'}`],
  );
  const gaps = results.flatMap((proofResult) => proofResult.gaps.map((gap) => `${proofResult.name}: ${gap}`));

  return {
    passed: failures.length === 0,
    failures,
    gaps,
  };
}
