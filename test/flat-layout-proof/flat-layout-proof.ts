/**
 * Ricky flat src layout proof surface.
 *
 * Proves the post-collapse contract for the single-package src/ layout:
 * - root package/config files are the only package management surface
 * - source lives under src/<layer> with src/surfaces/cli for the CLI
 * - legacy package aliases and packages/ workspaces are gone
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, normalize, relative, resolve, sep } from 'node:path';

export type FlatLayoutProofCaseName =
  | 'flat-src-tree-exists'
  | 'workspaces-removed'
  | 'single-package-manifest'
  | 'single-tsconfig-covers-src'
  | 'single-vitest-config'
  | 'no-cross-package-aliases'
  | 'cli-bin-still-wired'
  | 'legacy-packages-removed'
  | 'surface-folder-shape'
  | 'layer-direction-by-folder';

export interface FlatLayoutProofCase {
  name: FlatLayoutProofCaseName;
  description: string;
  evaluate: () => FlatLayoutProofResult;
}

export interface FlatLayoutProofResult {
  name: string;
  passed: boolean;
  evidence: string[];
  gaps: string[];
  failures: string[];
}

export interface FlatLayoutProofSummary {
  passed: boolean;
  failures: string[];
  gaps: string[];
}

const REQUIRED_SRC_DIRS = ['shared', 'runtime', 'product', 'cloud', 'local', 'surfaces/cli'] as const;
const IGNORED_PACKAGE_FILE_DIRS = new Set(['node_modules']);
const SURFACE_PLACEHOLDER_DIRS = ['slack', 'web', 'mac'] as const;

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

function listFiles(relPath = '.', ignoredDirs: Set<string> = new Set()): string[] {
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
        if (parts.includes('node_modules')) {
          continue;
        }
        if (repoPath === '.claude/worktrees' || repoPath.startsWith('.claude/worktrees/')) {
          continue;
        }
        if (ignoredDirs.has(entry.name)) {
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
  name: FlatLayoutProofCaseName,
  checks: boolean[],
  evidence: string[],
  gaps: string[] = [],
  failures: string[] = [],
): FlatLayoutProofResult {
  return {
    name,
    passed: checks.every(Boolean) && failures.length === 0,
    evidence,
    gaps,
    failures,
  };
}

function tsconfigStrictMode(tsconfig: { extends?: string; compilerOptions?: Record<string, unknown> }): boolean {
  if (tsconfig.compilerOptions?.strict === true) {
    return true;
  }

  if (!tsconfig.extends) {
    return false;
  }

  const basePath = tsconfig.extends.startsWith('.') ? tsconfig.extends : `./${tsconfig.extends}`;
  const baseConfigPath = basePath.endsWith('.json') ? basePath : `${basePath}.json`;

  if (!fileExists(baseConfigPath)) {
    return false;
  }

  const baseConfig = readJson<{ compilerOptions?: Record<string, unknown> }>(baseConfigPath);
  return baseConfig.compilerOptions?.strict === true;
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

function resolvesIntoLayer(file: string, specifier: string, disallowedLayers: readonly string[]): string | undefined {
  if (!specifier.startsWith('.')) {
    return undefined;
  }

  const candidate = normalize(join(dirname(file), specifier)).split(sep).join('/');
  return disallowedLayers.find((layer) => candidate === `src/${layer}` || candidate.startsWith(`src/${layer}/`));
}

function disallowedLayerImports(files: string[], disallowedLayers: readonly string[]): string[] {
  return files.flatMap((file) => {
    const source = readText(file);
    return importSpecifiers(source)
      .map((specifier) => ({ specifier, layer: resolvesIntoLayer(file, specifier, disallowedLayers) }))
      .filter((entry): entry is { specifier: string; layer: string } => entry.layer !== undefined)
      .map((entry) => `${file} imports ${entry.specifier} into src/${entry.layer}`);
  });
}

export function getFlatLayoutProofCases(): FlatLayoutProofCase[] {
  const pkg = readJson<{
    workspaces?: unknown;
    bin?: unknown;
  }>('package.json');

  return [
    {
      name: 'flat-src-tree-exists',
      description: 'The collapsed src tree has every required top-level layer and a CLI surface with TypeScript files.',
      evaluate: () => {
        const required = REQUIRED_SRC_DIRS.map((dir) => {
          const relPath = `src/${dir}`;
          const exists = directoryExists(relPath);
          const tsFiles = listTsFiles(relPath);
          return { relPath, exists, tsCount: tsFiles.length };
        });
        const missing = required.filter((entry) => !entry.exists || entry.tsCount === 0);

        return result(
          'flat-src-tree-exists',
          [missing.length === 0],
          [
            `required src dirs: ${REQUIRED_SRC_DIRS.map((dir) => `src/${dir}`).join(', ')}`,
            `all required src dirs have .ts files: ${missing.length === 0}`,
            ...required.map((entry) => `${entry.relPath}: exists=${entry.exists}, ts files=${entry.tsCount}`),
          ],
          [],
          missing.map((entry) => `Missing flat source directory or .ts file: ${entry.relPath}`),
        );
      },
    },
    {
      name: 'workspaces-removed',
      description: 'Root package.json no longer declares npm workspaces.',
      evaluate: () => {
        const hasWorkspaces = Object.prototype.hasOwnProperty.call(pkg, 'workspaces');

        return result(
          'workspaces-removed',
          [!hasWorkspaces],
          [`package.json has workspaces key: ${hasWorkspaces}`],
          [],
          hasWorkspaces ? ['Root package.json still declares workspaces'] : [],
        );
      },
    },
    {
      name: 'single-package-manifest',
      description: 'Only the repository root package.json remains outside ignored generated/worktree directories.',
      evaluate: () => {
        const manifests = listFiles('.', IGNORED_PACKAGE_FILE_DIRS).filter((file) => file === 'package.json' || file.endsWith('/package.json'));
        const onlyRoot = manifests.length === 1 && manifests[0] === 'package.json';

        return result(
          'single-package-manifest',
          [onlyRoot],
          [`package.json files: ${manifests.join(', ') || '(none)'}`, `only root package.json: ${onlyRoot}`],
          [],
          onlyRoot ? [] : manifests.filter((file) => file !== 'package.json').map((file) => `Unexpected package manifest: ${file}`),
        );
      },
    },
    {
      name: 'single-tsconfig-covers-src',
      description: 'The root tsconfig is the only tsconfig and it covers src with strict mode enabled.',
      evaluate: () => {
        const tsconfigs = listFiles('.', IGNORED_PACKAGE_FILE_DIRS).filter((file) => file === 'tsconfig.json' || file.endsWith('/tsconfig.json'));
        const tsconfig = readJson<{ include?: string[]; extends?: string; compilerOptions?: Record<string, unknown> }>('tsconfig.json');
        const include = tsconfig.include ?? [];
        const referencesSrc = include.some((pattern) => pattern === 'src' || pattern.startsWith('src/') || pattern.includes('src/**/*.ts'));
        const strict = tsconfigStrictMode(tsconfig);
        const onlyRoot = tsconfigs.length === 1 && tsconfigs[0] === 'tsconfig.json';

        return result(
          'single-tsconfig-covers-src',
          [onlyRoot, referencesSrc, strict],
          [
            `tsconfig.json files: ${tsconfigs.join(', ') || '(none)'}`,
            `only root tsconfig.json: ${onlyRoot}`,
            `include: ${JSON.stringify(include)}`,
            `include references src: ${referencesSrc}`,
            `strict mode: ${strict}`,
          ],
          [],
          [
            ...tsconfigs.filter((file) => file !== 'tsconfig.json').map((file) => `Unexpected tsconfig: ${file}`),
            ...(referencesSrc ? [] : ['Root tsconfig include does not reference src']),
            ...(strict ? [] : ['Strict mode is not enabled']),
          ],
        );
      },
    },
    {
      name: 'single-vitest-config',
      description: 'The root Vitest config is the only Vitest config and includes src/**/*.test.ts.',
      evaluate: () => {
        const configs = listFiles('.', IGNORED_PACKAGE_FILE_DIRS).filter(
          (file) => file === 'vitest.config.ts' || file.endsWith('/vitest.config.ts'),
        );
        const configText = readText('vitest.config.ts');
        const onlyRoot = configs.length === 1 && configs[0] === 'vitest.config.ts';
        const picksUpSrcTests =
          configText.includes('src/**/*.test.ts') ||
          configText.includes('"src/**/*.test.ts"') ||
          configText.includes("'src/**/*.test.ts'");

        return result(
          'single-vitest-config',
          [onlyRoot, picksUpSrcTests],
          [
            `vitest.config.ts files: ${configs.join(', ') || '(none)'}`,
            `only root vitest.config.ts: ${onlyRoot}`,
            `picks up src/**/*.test.ts: ${picksUpSrcTests}`,
          ],
          [],
          [
            ...configs.filter((file) => file !== 'vitest.config.ts').map((file) => `Unexpected Vitest config: ${file}`),
            ...(picksUpSrcTests ? [] : ['Root Vitest config does not include src/**/*.test.ts']),
          ],
        );
      },
    },
    {
      name: 'no-cross-package-aliases',
      description: 'Collapsed src imports no longer use @ricky/* aliases and package.json has no file:../ references.',
      evaluate: () => {
        const srcFiles = listTsFiles('src');
        const aliasHits = srcFiles.flatMap((file) => {
          const source = readText(file);
          return importSpecifiers(source)
            .filter((specifier) => specifier.startsWith('@ricky/'))
            .map((specifier) => `${file} imports ${specifier}`);
        });
        const packageText = readText('package.json');
        const hasFileParentReference = packageText.includes('file:../');

        return result(
          'no-cross-package-aliases',
          [aliasHits.length === 0, !hasFileParentReference],
          [
            `src files scanned: ${srcFiles.length}`,
            `@ricky/* import specifiers under src: ${aliasHits.length}`,
            `package.json has file:../ references: ${hasFileParentReference}`,
            'surface dependencies use relative paths only: true when alias count is 0',
          ],
          [],
          [
            ...aliasHits.map((hit) => `Legacy alias remains: ${hit}`),
            ...(hasFileParentReference ? ['package.json still contains file:../'] : []),
          ],
        );
      },
    },
    {
      name: 'cli-bin-still-wired',
      description: 'The ricky bin shim remains wired to the flat src/surfaces/cli entrypoint.',
      evaluate: () => {
        const binExists = fileExists('bin/ricky');
        const binTarget = packageBinTarget(pkg);
        const mapsRicky = binTarget.length > 0;
        const shimText = binExists ? readText('bin/ricky') : '';
        const resolvesToFlatCli = shimText.includes('src/surfaces/cli/');

        return result(
          'cli-bin-still-wired',
          [binExists, mapsRicky, resolvesToFlatCli],
          [
            `bin/ricky exists: ${binExists}`,
            `package.json bin.ricky: ${binTarget || '(missing)'}`,
            `bin shim resolves to src/surfaces/cli/: ${resolvesToFlatCli}`,
          ],
          [],
          [
            ...(binExists ? [] : ['Missing bin/ricky']),
            ...(mapsRicky ? [] : ['Root package.json bin does not map ricky']),
            ...(resolvesToFlatCli ? [] : ['bin/ricky does not resolve to src/surfaces/cli/<entrypoint>']),
          ],
        );
      },
    },
    {
      name: 'legacy-packages-removed',
      description: 'The legacy packages/ workspace directory is absent or empty.',
      evaluate: () => {
        const packagesExists = directoryExists('packages');
        const packageFiles = listFiles('packages');
        const removed = !packagesExists || packageFiles.length === 0;

        return result(
          'legacy-packages-removed',
          [removed],
          [`packages/ exists: ${packagesExists}`, `packages/ file count: ${packageFiles.length}`],
          [],
          removed ? [] : packageFiles.map((file) => `Legacy packages/ file remains: ${file}`),
        );
      },
    },
    {
      name: 'surface-folder-shape',
      description: 'src/surfaces is the documented home for CLI now and slack/web/mac later.',
      evaluate: () => {
        const surfacesExists = directoryExists('src/surfaces');
        const cliExists = directoryExists('src/surfaces/cli');
        const placeholders = SURFACE_PLACEHOLDER_DIRS.map((dir) => `src/surfaces/${dir}`).join(', ');

        return result(
          'surface-folder-shape',
          [surfacesExists, cliExists],
          [
            `src/surfaces exists: ${surfacesExists}`,
            `src/surfaces/cli exists: ${cliExists}`,
            `future surface homes documented: ${placeholders}`,
          ],
          [],
          [
            ...(surfacesExists ? [] : ['Missing src/surfaces']),
            ...(cliExists ? [] : ['Missing src/surfaces/cli']),
          ],
        );
      },
    },
    {
      name: 'layer-direction-by-folder',
      description: 'A lightweight lexical scan keeps lower src layers from importing higher folders.',
      evaluate: () => {
        const sharedViolations = disallowedLayerImports(listTsFiles('src/shared'), [
          'runtime',
          'product',
          'cloud',
          'local',
          'surfaces',
        ]);
        const runtimeViolations = disallowedLayerImports(listTsFiles('src/runtime'), ['product', 'cloud', 'local', 'surfaces']);
        const productViolations = disallowedLayerImports(listTsFiles('src/product'), ['cloud', 'local', 'surfaces']);
        const cloudLocalViolations = disallowedLayerImports([...listTsFiles('src/cloud'), ...listTsFiles('src/local')], [
          'surfaces',
        ]);
        const violations = [...sharedViolations, ...runtimeViolations, ...productViolations, ...cloudLocalViolations];
        const scannedFiles = [
          ...listTsFiles('src/shared'),
          ...listTsFiles('src/runtime'),
          ...listTsFiles('src/product'),
          ...listTsFiles('src/cloud'),
          ...listTsFiles('src/local'),
        ];

        return result(
          'layer-direction-by-folder',
          [violations.length === 0],
          [
            `layer files scanned: ${scannedFiles.length}`,
            `shared upward imports: ${sharedViolations.length}`,
            `runtime upward imports: ${runtimeViolations.length}`,
            `product upward imports: ${productViolations.length}`,
            `cloud/local surface imports: ${cloudLocalViolations.length}`,
            `layer direction violations: ${violations.length}`,
          ],
          [],
          violations.map((violation) => `Layer direction violation: ${violation}`),
        );
      },
    },
  ];
}

export function evaluateFlatLayoutProof(): FlatLayoutProofResult[] {
  return getFlatLayoutProofCases().map((proofCase) => proofCase.evaluate());
}

export function evaluateFlatLayoutProofCase(name: FlatLayoutProofCaseName): FlatLayoutProofResult {
  const proofCase = getFlatLayoutProofCases().find((candidate) => candidate.name === name);
  if (!proofCase) {
    throw new Error(`Unknown flat layout proof case: ${name}`);
  }
  return proofCase.evaluate();
}

export function summarizeFlatLayoutProof(): FlatLayoutProofSummary {
  const results = evaluateFlatLayoutProof();
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
