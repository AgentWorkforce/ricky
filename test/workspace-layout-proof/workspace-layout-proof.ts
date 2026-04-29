/**
 * Ricky workspace layout proof surface.
 *
 * Proves the package split contract from docs/architecture/ricky-package-split-migration-spec.md:
 * - root is a private npm workspace orchestrator
 * - source lives under packages/{shared,runtime,product,cloud,local,cli}/src
 * - workspace package dependencies point in the intended direction
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, normalize, relative, resolve, sep } from 'node:path';

export type WorkspaceLayoutProofCaseName =
  | 'workspace-packages-exist'
  | 'workspace-manager-truthful'
  | 'package-manifests-complete'
  | 'typescript-config-covers-workspace'
  | 'vitest-config-covers-workspace'
  | 'cli-bin-still-wired'
  | 'package-boundaries-by-manifest'
  | 'no-old-src-product-tree';

export interface WorkspaceLayoutProofCase {
  name: WorkspaceLayoutProofCaseName;
  description: string;
  evaluate: () => WorkspaceLayoutProofResult;
}

export interface WorkspaceLayoutProofResult {
  name: string;
  passed: boolean;
  evidence: string[];
  gaps: string[];
  failures: string[];
}

export interface WorkspaceLayoutProofSummary {
  passed: boolean;
  failures: string[];
  gaps: string[];
}

const PACKAGE_NAMES = ['shared', 'runtime', 'product', 'cloud', 'local', 'cli'] as const;

const EXPECTED_DEPS: Record<(typeof PACKAGE_NAMES)[number], readonly string[]> = {
  shared: [],
  runtime: ['@ricky/shared'],
  product: ['@ricky/shared', '@ricky/runtime'],
  cloud: [],
  local: ['@ricky/product', '@ricky/runtime', '@ricky/shared'],
  cli: ['@ricky/cloud', '@ricky/local', '@ricky/runtime'],
};

function repoRoot(): string {
  return resolve(__dirname, '../..');
}

function toRepoPath(absPath: string): string {
  return normalize(relative(repoRoot(), absPath)).split(sep).join('/');
}

function readJson<T extends Record<string, unknown>>(relPath: string): T {
  return JSON.parse(readFileSync(join(repoRoot(), relPath), 'utf-8')) as T;
}

function readText(relPath: string): string {
  return readFileSync(join(repoRoot(), relPath), 'utf-8');
}

function pathExists(relPath: string): boolean {
  return existsSync(join(repoRoot(), relPath));
}

function directoryExists(relPath: string): boolean {
  const absPath = join(repoRoot(), relPath);
  return existsSync(absPath) && statSync(absPath).isDirectory();
}

function fileExists(relPath: string): boolean {
  const absPath = join(repoRoot(), relPath);
  return existsSync(absPath) && statSync(absPath).isFile();
}

function listFiles(relPath = '.'): string[] {
  const start = join(repoRoot(), relPath);

  if (!existsSync(start)) {
    return [];
  }

  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const absPath = join(dir, entry.name);
      const repoPath = toRepoPath(absPath);
      const parts = repoPath.split('/');

      if (entry.isDirectory()) {
        if (parts.includes('node_modules') || parts.includes('dist') || parts.includes('.claude')) {
          continue;
        }
        walk(absPath);
        continue;
      }

      if (entry.isFile()) {
        files.push(repoPath);
      }
    }
  };

  walk(start);
  return files.sort();
}

function listTsFiles(relPath: string): string[] {
  return listFiles(relPath).filter((file) => file.endsWith('.ts'));
}

function result(
  name: WorkspaceLayoutProofCaseName,
  checks: boolean[],
  evidence: string[],
  gaps: string[] = [],
  failures: string[] = [],
): WorkspaceLayoutProofResult {
  return {
    name,
    passed: checks.every(Boolean) && failures.length === 0,
    evidence,
    gaps,
    failures,
  };
}

function dependencies(pkg: Record<string, unknown>): Record<string, string> {
  return {
    ...((pkg.dependencies as Record<string, string> | undefined) ?? {}),
    ...((pkg.devDependencies as Record<string, string> | undefined) ?? {}),
  };
}

function packageBinTarget(pkg: { bin?: unknown }): string {
  if (typeof pkg.bin === 'string') {
    return pkg.bin;
  }

  if (pkg.bin && typeof pkg.bin === 'object') {
    const bins = pkg.bin as Record<string, unknown>;
    return typeof bins.ricky === 'string' ? bins.ricky : '';
  }

  return '';
}

function conditionalExportTarget(pkg: { exports?: unknown }, subpath: string, condition: string): string {
  if (!pkg.exports || typeof pkg.exports !== 'object') {
    return '';
  }

  const exportsMap = pkg.exports as Record<string, unknown>;
  const exportEntry = exportsMap[subpath];
  if (!exportEntry || typeof exportEntry !== 'object') {
    return '';
  }

  const conditions = exportEntry as Record<string, unknown>;
  const target = conditions[condition];
  return typeof target === 'string' ? target : '';
}

function importSpecifiers(source: string): string[] {
  const specifiers: string[] = [];
  const importExportPattern = /\b(?:import|export)\s+(?:type\s+)?(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/g;
  const dynamicImportPattern = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  const requirePattern = /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

  for (const pattern of [importExportPattern, dynamicImportPattern, requirePattern]) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(source))) {
      specifiers.push(match[1]);
    }
  }

  return specifiers;
}

function workspaceImports(relPath: string): Array<{ file: string; specifier: string }> {
  return listTsFiles(relPath).flatMap((file) => {
    const source = readText(file);
    return importSpecifiers(source)
      .filter((specifier) => specifier.startsWith('@ricky/'))
      .map((specifier) => ({ file, specifier }));
  });
}

export function getWorkspaceLayoutProofCases(): WorkspaceLayoutProofCase[] {
  const rootPkg = readJson<{
    name?: unknown;
    private?: unknown;
    workspaces?: unknown;
    packageManager?: unknown;
    bin?: unknown;
    scripts?: Record<string, unknown>;
    files?: unknown;
  }>('package.json');

  return [
    {
      name: 'workspace-packages-exist',
      description: 'Every target package has source files in packages/*/src.',
      evaluate: () => {
        const packageEvidence = PACKAGE_NAMES.map((name) => {
          const srcPath = `packages/${name}/src`;
          return {
            name,
            packageDir: directoryExists(`packages/${name}`),
            srcDir: directoryExists(srcPath),
            tsCount: listTsFiles(srcPath).length,
          };
        });
        const missing = packageEvidence.filter((entry) => !entry.packageDir || !entry.srcDir || entry.tsCount === 0);

        return result(
          'workspace-packages-exist',
          [missing.length === 0],
          [
            `required packages: ${PACKAGE_NAMES.map((name) => `packages/${name}`).join(', ')}`,
            `all required package src dirs have .ts files: ${missing.length === 0}`,
            ...packageEvidence.map(
              (entry) =>
                `packages/${entry.name}: package dir=${entry.packageDir}, src dir=${entry.srcDir}, ts files=${entry.tsCount}`,
            ),
          ],
          [],
          missing.map((entry) => `Missing package source tree: packages/${entry.name}/src`),
        );
      },
    },
    {
      name: 'workspace-manager-truthful',
      description: 'The private root package declares npm workspaces, package manager, and lockfile state.',
      evaluate: () => {
        const workspaces = Array.isArray(rootPkg.workspaces) ? rootPkg.workspaces : [];
        const hasPackagesGlob = workspaces.includes('packages/*');
        const packageName = rootPkg.name === '@agentworkforce/ricky';
        const privateRoot = rootPkg.private === true;
        const npmManager = typeof rootPkg.packageManager === 'string' && rootPkg.packageManager.startsWith('npm@');
        const lockfileExists = fileExists('package-lock.json');

        return result(
          'workspace-manager-truthful',
          [packageName, hasPackagesGlob, privateRoot, npmManager, lockfileExists],
          [
            `package.json name: ${String(rootPkg.name ?? '(missing)')}`,
            `package.json workspaces: ${JSON.stringify(workspaces)}`,
            `root private: ${privateRoot}`,
            `packageManager: ${String(rootPkg.packageManager ?? '(missing)')}`,
            `package-lock.json exists: ${lockfileExists}`,
          ],
          [],
          [
            ...(packageName ? [] : ['Root package name is not @agentworkforce/ricky']),
            ...(hasPackagesGlob ? [] : ['Root package.json does not include packages/* workspaces']),
            ...(privateRoot ? [] : ['Root package is not private']),
            ...(npmManager ? [] : ['Root packageManager is not npm@...']),
            ...(lockfileExists ? [] : ['Missing package-lock.json']),
          ],
        );
      },
    },
    {
      name: 'package-manifests-complete',
      description: 'Every workspace package has package.json identity, exports, and validation scripts.',
      evaluate: () => {
        const manifests = PACKAGE_NAMES.map((name) => {
          const relPath = `packages/${name}/package.json`;
          const exists = fileExists(relPath);
          const pkg = exists
            ? readJson<{
                name?: unknown;
                main?: unknown;
                types?: unknown;
                bin?: unknown;
                exports?: unknown;
                scripts?: Record<string, string>;
              }>(relPath)
            : {};
          const rootImportTarget = conditionalExportTarget(pkg, '.', 'import');
          const rootDevelopmentTarget = conditionalExportTarget(pkg, '.', 'development');
          const subpathImportTarget = conditionalExportTarget(pkg, './*', 'import');
          const subpathDevelopmentTarget = conditionalExportTarget(pkg, './*', 'development');
          const cliBinTarget = packageBinTarget(pkg);

          const hasWildcardSubpathExports =
            subpathImportTarget === './dist/*.js' && subpathDevelopmentTarget === './src/*.ts';
          const hasExplicitCliSubpathExports =
            name === 'cli' &&
            ['cli', 'commands', 'entrypoint'].every((subpath) => {
              const importTarget = conditionalExportTarget(pkg, `./${subpath}`, 'import');
              const developmentTarget = conditionalExportTarget(pkg, `./${subpath}`, 'development');
              return importTarget === `./dist/${subpath}/index.js` && developmentTarget === `./src/${subpath}/index.ts`;
            });

          return {
            name,
            exists,
            correctName: pkg.name === `@ricky/${name}`,
            mainUsesDist: pkg.main === './dist/index.js',
            typesUseDist: pkg.types === './dist/index.d.ts',
            rootExportUsesDist: rootImportTarget === './dist/index.js',
            rootExportHasSourceMode: rootDevelopmentTarget === './src/index.ts',
            subpathExportUsesDist: hasWildcardSubpathExports || hasExplicitCliSubpathExports,
            subpathExportHasSourceMode: hasWildcardSubpathExports || hasExplicitCliSubpathExports,
            cliBinUsesDist: name !== 'cli' || cliBinTarget === './dist/bin/ricky.js',
            hasTypecheck: typeof pkg.scripts?.typecheck === 'string',
            hasTest: typeof pkg.scripts?.test === 'string',
          };
        });
        const failures = manifests.filter(
          (entry) =>
            !entry.exists ||
            !entry.correctName ||
            !entry.mainUsesDist ||
            !entry.typesUseDist ||
            !entry.rootExportUsesDist ||
            !entry.rootExportHasSourceMode ||
            !entry.subpathExportUsesDist ||
            !entry.subpathExportHasSourceMode ||
            !entry.cliBinUsesDist ||
            !entry.hasTypecheck ||
            !entry.hasTest,
        );

        return result(
          'package-manifests-complete',
          [failures.length === 0],
          [
            `workspace package manifests checked: ${manifests.length}`,
            ...manifests.map(
              (entry) =>
                `packages/${entry.name}/package.json: exists=${entry.exists}, name ok=${entry.correctName}, main dist=${entry.mainUsesDist}, types dist=${entry.typesUseDist}, root export dist=${entry.rootExportUsesDist}, source mode=${entry.rootExportHasSourceMode}, subpath export dist=${entry.subpathExportUsesDist}, subpath source mode=${entry.subpathExportHasSourceMode}, cli bin dist=${entry.cliBinUsesDist}, typecheck=${entry.hasTypecheck}, test=${entry.hasTest}`,
            ),
          ],
          [],
          failures.map((entry) => `Incomplete package manifest: packages/${entry.name}/package.json`),
        );
      },
    },
    {
      name: 'typescript-config-covers-workspace',
      description: 'Root and package TypeScript configs cover package source and root workflow assets.',
      evaluate: () => {
        const rootTsconfig = readJson<{ include?: string[]; references?: Array<{ path: string }> }>('tsconfig.json');
        const hasBase = fileExists('tsconfig.base.json');
        const references = (rootTsconfig.references ?? []).map((entry) => entry.path);
        const packageTsconfigs = PACKAGE_NAMES.map((name) => `packages/${name}/tsconfig.json`);
        const allPackageTsconfigsExist = packageTsconfigs.every(fileExists);
        const allPackageBuildTsconfigsExist = PACKAGE_NAMES.every((name) => fileExists(`packages/${name}/tsconfig.build.json`));
        const referencesPackages = PACKAGE_NAMES.every((name) => references.includes(`./packages/${name}`));
        const include = rootTsconfig.include ?? [];
        const includesRootAssets = include.includes('test/**/*.ts') && include.includes('workflows/**/*.ts');

        return result(
          'typescript-config-covers-workspace',
          [hasBase, allPackageTsconfigsExist, allPackageBuildTsconfigsExist, referencesPackages, includesRootAssets],
          [
            `tsconfig.base.json exists: ${hasBase}`,
            `package tsconfig.json files exist: ${allPackageTsconfigsExist}`,
            `package tsconfig.build.json files exist: ${allPackageBuildTsconfigsExist}`,
            `root references packages: ${referencesPackages}`,
            `root include: ${JSON.stringify(include)}`,
          ],
          [],
          [
            ...(hasBase ? [] : ['Missing tsconfig.base.json']),
            ...(allPackageTsconfigsExist ? [] : packageTsconfigs.filter((relPath) => !fileExists(relPath)).map((relPath) => `Missing ${relPath}`)),
            ...(allPackageBuildTsconfigsExist
              ? []
              : PACKAGE_NAMES.filter((name) => !fileExists(`packages/${name}/tsconfig.build.json`)).map(
                  (name) => `Missing packages/${name}/tsconfig.build.json`,
                )),
            ...(referencesPackages ? [] : ['Root tsconfig does not reference every workspace package']),
            ...(includesRootAssets ? [] : ['Root tsconfig does not include root tests and workflows']),
          ],
        );
      },
    },
    {
      name: 'vitest-config-covers-workspace',
      description: 'Root Vitest config discovers package tests and root proof tests.',
      evaluate: () => {
        const configText = readText('vitest.config.ts');
        const packagePattern = configText.includes('packages/*/src/**/*.test.ts');
        const rootPattern = configText.includes('test/**/*.test.ts');
        const onlyRootConfig = listFiles('.').filter((file) => file === 'vitest.config.ts' || file.endsWith('/vitest.config.ts')).length === 1;

        return result(
          'vitest-config-covers-workspace',
          [packagePattern, rootPattern, onlyRootConfig],
          [
            `picks up packages/*/src/**/*.test.ts: ${packagePattern}`,
            `picks up test/**/*.test.ts: ${rootPattern}`,
            `only root vitest.config.ts: ${onlyRootConfig}`,
          ],
          [],
          [
            ...(packagePattern ? [] : ['Root Vitest config does not include package tests']),
            ...(rootPattern ? [] : ['Root Vitest config does not include root proof tests']),
            ...(onlyRootConfig ? [] : ['Unexpected package-level Vitest config found']),
          ],
        );
      },
    },
    {
      name: 'cli-bin-still-wired',
      description: 'The published ricky bin is a self-contained bundle of the CLI workspace source entrypoint.',
      evaluate: () => {
        const binTarget = packageBinTarget(rootPkg);
        const targetIsBundle = binTarget === './dist/ricky.js' || binTarget === 'dist/ricky.js';
        const bundlerScriptExists = fileExists('scripts/bundle-cli.mjs');
        const packageBinExists = fileExists('packages/cli/src/bin/ricky.ts');
        const cliMainExists = fileExists('packages/cli/src/commands/cli-main.ts');
        const prepackBuildsBundle = typeof rootPkg.scripts?.prepack === 'string'
          && rootPkg.scripts.prepack.includes('bundle');
        const filesIncludesDist = Array.isArray(rootPkg.files) && rootPkg.files.includes('dist');

        return result(
          'cli-bin-still-wired',
          [targetIsBundle, bundlerScriptExists, packageBinExists, cliMainExists, prepackBuildsBundle, filesIncludesDist],
          [
            `package.json bin.ricky: ${binTarget || '(missing)'}`,
            `bundler script exists: ${bundlerScriptExists}`,
            `packages/cli/src/bin/ricky.ts exists: ${packageBinExists}`,
            `packages/cli/src/commands/cli-main.ts exists: ${cliMainExists}`,
            `prepack bundles the CLI: ${prepackBuildsBundle}`,
            `published files include dist: ${filesIncludesDist}`,
          ],
          [],
          [
            ...(targetIsBundle ? [] : ['Root package.json bin.ricky does not map to ./dist/ricky.js']),
            ...(bundlerScriptExists ? [] : ['Missing scripts/bundle-cli.mjs']),
            ...(packageBinExists ? [] : ['Missing packages/cli/src/bin/ricky.ts']),
            ...(cliMainExists ? [] : ['Missing packages/cli/src/commands/cli-main.ts']),
            ...(prepackBuildsBundle ? [] : ['prepack script does not run the bundler']),
            ...(filesIncludesDist ? [] : ['Root package.json files does not include dist']),
          ],
        );
      },
    },
    {
      name: 'package-boundaries-by-manifest',
      description: 'Package manifests preserve the intended dependency directions.',
      evaluate: () => {
        const packageEvidence = PACKAGE_NAMES.map((name) => {
          const pkg = readJson<Record<string, unknown>>(`packages/${name}/package.json`);
          const deps = dependencies(pkg);
          const rickyDeps = Object.keys(deps).filter((dep) => dep.startsWith('@ricky/')).sort();
          const expected = [...EXPECTED_DEPS[name]].sort();
          return {
            name,
            rickyDeps,
            expected,
            matchesExpected: JSON.stringify(rickyDeps) === JSON.stringify(expected),
          };
        });
        const mismatches = packageEvidence.filter((entry) => !entry.matchesExpected);

        return result(
          'package-boundaries-by-manifest',
          [mismatches.length === 0],
          [
            `workspace dependency mismatches: ${mismatches.length}`,
            ...packageEvidence.map(
              (entry) =>
                `@ricky/${entry.name}: deps=${entry.rickyDeps.join(', ') || '(none)'}, expected=${entry.expected.join(', ') || '(none)'}`,
            ),
          ],
          [],
          mismatches.map((entry) => `Unexpected @ricky deps for @ricky/${entry.name}`),
        );
      },
    },
    {
      name: 'no-old-src-product-tree',
      description: 'The previous root src product tree is gone, and package imports use @ricky boundaries.',
      evaluate: () => {
        const srcExists = pathExists('src');
        const imports = PACKAGE_NAMES.flatMap((name) => workspaceImports(`packages/${name}/src`));
        const oldSrcImportHits = imports.filter((entry) => entry.specifier.includes('src/'));

        return result(
          'no-old-src-product-tree',
          [!srcExists, oldSrcImportHits.length === 0],
          [
            `root src/ exists: ${srcExists}`,
            `@ricky imports scanned: ${imports.length}`,
            `old src import hits: ${oldSrcImportHits.length}`,
          ],
          [],
          [
            ...(srcExists ? ['Root src/ tree still exists'] : []),
            ...oldSrcImportHits.map((hit) => `Old src import remains: ${hit.file} imports ${hit.specifier}`),
          ],
        );
      },
    },
  ];
}

export function evaluateWorkspaceLayoutProof(): WorkspaceLayoutProofResult[] {
  return getWorkspaceLayoutProofCases().map((proofCase) => proofCase.evaluate());
}

export function evaluateWorkspaceLayoutProofCase(name: WorkspaceLayoutProofCaseName): WorkspaceLayoutProofResult {
  const proofCase = getWorkspaceLayoutProofCases().find((candidate) => candidate.name === name);
  if (!proofCase) {
    throw new Error(`Unknown workspace layout proof case: ${name}`);
  }
  return proofCase.evaluate();
}

export function summarizeWorkspaceLayoutProof(): WorkspaceLayoutProofSummary {
  const results = evaluateWorkspaceLayoutProof();
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
