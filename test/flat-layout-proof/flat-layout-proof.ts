/**
 * Ricky flat src layout proof surface.
 *
 * Proves the post-collapse package contract:
 * - source lives under src/{shared,runtime,product,cloud,local,surfaces/cli}
 * - the repo has a single package manifest, TypeScript config, and Vitest config
 * - package aliases and packages/* workspaces are removed
 * - layer direction is enforced by folder ownership with lightweight lexical scans
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

const REQUIRED_SRC_DIRS = ['src/shared', 'src/runtime', 'src/product', 'src/cloud', 'src/local', 'src/surfaces/cli'] as const;

const LAYER_RULES = [
  { owner: 'shared', forbidden: ['runtime', 'product', 'cloud', 'local', 'surfaces'] },
  { owner: 'runtime', forbidden: ['product', 'cloud', 'local', 'surfaces'] },
  { owner: 'product', forbidden: ['cloud', 'local', 'surfaces'] },
  { owner: 'cloud', forbidden: ['surfaces'] },
  { owner: 'local', forbidden: ['surfaces'] },
] as const;

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

function shouldSkipDirectory(repoPath: string): boolean {
  const parts = repoPath.split('/');
  return parts.includes('node_modules') || repoPath === '.git' || repoPath.startsWith('.git/') || repoPath.startsWith('.claude/worktrees/');
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

      if (entry.isDirectory()) {
        if (shouldSkipDirectory(repoPath)) {
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

function srcImportHits(): Array<{ file: string; specifier: string }> {
  return listTsFiles('src').flatMap((file) =>
    importSpecifiers(readText(file))
      .filter((specifier) => specifier.startsWith('@ricky/'))
      .map((specifier) => ({ file, specifier })),
  );
}

function packageJsonFiles(): string[] {
  return listFiles('.').filter((file) => file === 'package.json' || file.endsWith('/package.json'));
}

function tsconfigFiles(): string[] {
  return listFiles('.').filter((file) => file === 'tsconfig.json' || file.endsWith('/tsconfig.json'));
}

function vitestConfigFiles(): string[] {
  return listFiles('.').filter((file) => file === 'vitest.config.ts' || file.endsWith('/vitest.config.ts'));
}

function vitestConfigIncludesSrcTests(source: string): boolean {
  return /['"`]src\/\*\*\/\*\.test\.ts['"`]/.test(source);
}

function includeReferencesSrc(include: unknown): boolean {
  return Array.isArray(include) && include.some((entry) => typeof entry === 'string' && (entry === 'src' || entry.startsWith('src/')));
}

function tsconfigIncludeEntries(include: unknown): string[] {
  return Array.isArray(include) ? include.filter((entry): entry is string => typeof entry === 'string') : [];
}

function tsconfigIncludePathExists(entry: string): boolean {
  if (/[*?[\]{}]/.test(entry)) {
    return true;
  }

  return pathExists(entry);
}

function specifierTargetLayer(file: string, specifier: string): string | null {
  if (!specifier.startsWith('.')) {
    const absoluteSrcMatch = /^src\/([^/]+)/.exec(specifier);
    return absoluteSrcMatch?.[1] ?? null;
  }

  const resolved = normalize(join(dirname(file), specifier)).split(sep).join('/');
  const match = /^src\/([^/]+)/.exec(resolved);
  return match?.[1] ?? null;
}

function layerDirectionViolations(): Array<{ file: string; specifier: string; targetLayer: string }> {
  return LAYER_RULES.flatMap((rule) =>
    listTsFiles(`src/${rule.owner}`).flatMap((file) =>
      importSpecifiers(readText(file)).flatMap((specifier) => {
        const targetLayer = specifierTargetLayer(file, specifier);
        if (targetLayer && rule.forbidden.includes(targetLayer as never)) {
          return [{ file, specifier, targetLayer }];
        }
        return [];
      }),
    ),
  ).sort((left, right) => `${left.file}:${left.specifier}`.localeCompare(`${right.file}:${right.specifier}`));
}

export function getFlatLayoutProofCases(): FlatLayoutProofCase[] {
  const rootPkg = readJson<{
    workspaces?: unknown;
    bin?: unknown;
    scripts?: Record<string, unknown>;
    files?: unknown;
  }>('package.json');

  return [
    {
      name: 'flat-src-tree-exists',
      description: 'Every collapsed layer has a src folder with at least one TypeScript file.',
      evaluate: () => {
        const dirEvidence = REQUIRED_SRC_DIRS.map((srcDir) => ({
          srcDir,
          exists: directoryExists(srcDir),
          tsCount: listTsFiles(srcDir).length,
        }));
        const missing = dirEvidence.filter((entry) => !entry.exists || entry.tsCount === 0);

        return result(
          'flat-src-tree-exists',
          [missing.length === 0],
          [
            `required src dirs: ${REQUIRED_SRC_DIRS.join(', ')}`,
            `all required flat src dirs have .ts files: ${missing.length === 0}`,
            ...dirEvidence.map((entry) => `${entry.srcDir}: dir=${entry.exists}, ts files=${entry.tsCount}`),
          ],
          [],
          missing.map((entry) => `Missing flat source tree: ${entry.srcDir}`),
        );
      },
    },
    {
      name: 'workspaces-removed',
      description: 'The root manifest no longer declares npm workspaces.',
      evaluate: () => {
        const hasWorkspaces = Object.prototype.hasOwnProperty.call(rootPkg, 'workspaces');

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
      description: 'The repo has exactly one package.json, at the root.',
      evaluate: () => {
        const manifests = packageJsonFiles();
        const onlyRootManifest = manifests.length === 1 && manifests[0] === 'package.json';

        return result(
          'single-package-manifest',
          [onlyRootManifest],
          [`package.json files found: ${manifests.length}`, `package.json file list: ${manifests.join(', ') || '(none)'}`],
          [],
          onlyRootManifest ? [] : [`Expected only package.json at repo root, found: ${manifests.join(', ') || '(none)'}`],
        );
      },
    },
    {
      name: 'single-tsconfig-covers-src',
      description: 'The repo has one root tsconfig.json that includes src and enables strict mode.',
      evaluate: () => {
        const configs = tsconfigFiles();
        const rootTsconfig = fileExists('tsconfig.json')
          ? readJson<{
              include?: unknown;
              compilerOptions?: { strict?: unknown };
            }>('tsconfig.json')
          : {};
        const include = tsconfigIncludeEntries(rootTsconfig.include);
        const onlyRootTsconfig = configs.length === 1 && configs[0] === 'tsconfig.json';
        const includesSrc = includeReferencesSrc(rootTsconfig.include);
        const strictMode = rootTsconfig.compilerOptions?.strict === true;
        const legacyPackageIncludes = include.filter((entry) => entry === 'packages' || entry.startsWith('packages/'));
        const missingIncludes = include.filter((entry) => !tsconfigIncludePathExists(entry));
        const noLegacyPackageIncludes = legacyPackageIncludes.length === 0;
        const allLiteralIncludesExist = missingIncludes.length === 0;

        return result(
          'single-tsconfig-covers-src',
          [onlyRootTsconfig, includesSrc, strictMode, noLegacyPackageIncludes, allLiteralIncludesExist],
          [
            `tsconfig.json files found: ${configs.length}`,
            `only root tsconfig.json: ${onlyRootTsconfig}`,
            `root include references src: ${includesSrc}`,
            `root include references legacy packages paths: ${!noLegacyPackageIncludes}`,
            `root include missing literal paths: ${missingIncludes.join(', ') || '(none)'}`,
            `root include: ${JSON.stringify(include)}`,
            `root compilerOptions.strict: ${String(rootTsconfig.compilerOptions?.strict ?? '(missing)')}`,
          ],
          [],
          [
            ...(onlyRootTsconfig ? [] : [`Expected only root tsconfig.json, found: ${configs.join(', ') || '(none)'}`]),
            ...(includesSrc ? [] : ['Root tsconfig.json include does not reference src']),
            ...(strictMode ? [] : ['Root tsconfig.json does not enable compilerOptions.strict']),
            ...legacyPackageIncludes.map((entry) => `Root tsconfig.json still includes legacy package path: ${entry}`),
            ...missingIncludes.map((entry) => `Root tsconfig.json includes missing path: ${entry}`),
          ],
        );
      },
    },
    {
      name: 'single-vitest-config',
      description: 'The repo has one root Vitest config that discovers src tests and does not keep legacy packages/ test globs alive.',
      evaluate: () => {
        const configs = vitestConfigFiles();
        const configText = fileExists('vitest.config.ts') ? readText('vitest.config.ts') : '';
        const onlyRootConfig = configs.length === 1 && configs[0] === 'vitest.config.ts';
        const srcTestPattern = vitestConfigIncludesSrcTests(configText);
        const hasLegacyPackagesGlob = configText.includes('packages/');

        return result(
          'single-vitest-config',
          [onlyRootConfig, srcTestPattern, !hasLegacyPackagesGlob],
          [
            `vitest.config.ts files found: ${configs.length}`,
            `only root vitest.config.ts: ${onlyRootConfig}`,
            `picks up src/**/*.test.ts: ${srcTestPattern}`,
            `contains legacy packages/ test globs: ${hasLegacyPackagesGlob}`,
          ],
          [],
          [
            ...(onlyRootConfig ? [] : [`Expected only root vitest.config.ts, found: ${configs.join(', ') || '(none)'}`]),
            ...(srcTestPattern ? [] : ['Root Vitest config does not include src/**/*.test.ts']),
            ...(!hasLegacyPackagesGlob ? [] : ['Root Vitest config still includes legacy packages/ test globs']),
          ],
        );
      },
    },
    {
      name: 'no-cross-package-aliases',
      description: 'Flat source uses relative imports instead of @ricky aliases or file:../ package references.',
      evaluate: () => {
        const aliasHits = srcImportHits();
        const packageText = fileExists('package.json') ? readText('package.json') : '';
        const fileParentReferences = packageText.includes('file:../');

        return result(
          'no-cross-package-aliases',
          [aliasHits.length === 0, !fileParentReferences],
          [
            `@ricky import specifiers under src: ${aliasHits.length}`,
            `package.json has file:../ references: ${fileParentReferences}`,
            `surfaces use relative inner-layer imports only: ${aliasHits.length === 0}`,
          ],
          [],
          [
            ...aliasHits.map((hit) => `@ricky alias remains under src: ${hit.file} imports ${hit.specifier}`),
            ...(fileParentReferences ? ['Root package.json still references file:../'] : []),
          ],
        );
      },
    },
    {
      name: 'cli-bin-still-wired',
      description: 'The published ricky bin is a self-contained bundle of the flat CLI surface entrypoint.',
      evaluate: () => {
        const binTarget = packageBinTarget(rootPkg);
        const targetIsBundle = binTarget === './dist/ricky.js' || binTarget === 'dist/ricky.js';
        const bundlerScriptExists = fileExists('scripts/bundle-cli.mjs');
        const cliBinSourceExists = fileExists('src/surfaces/cli/bin/ricky.ts');
        const cliMainExists = fileExists('src/surfaces/cli/commands/cli-main.ts');
        const prepackBuildsBundle = typeof rootPkg.scripts?.prepack === 'string'
          && (rootPkg.scripts.prepack.includes('bundle') || rootPkg.scripts.prepack.includes('build'));
        const filesIncludesDist = Array.isArray(rootPkg.files) && rootPkg.files.includes('dist');
        const filesIncludesSkills = Array.isArray(rootPkg.files) && rootPkg.files.includes('.agents/skills');

        return result(
          'cli-bin-still-wired',
          [targetIsBundle, bundlerScriptExists, cliBinSourceExists, cliMainExists, prepackBuildsBundle, filesIncludesDist, filesIncludesSkills],
          [
            `package.json bin.ricky: ${binTarget || '(missing)'}`,
            `bundler script exists: ${bundlerScriptExists}`,
            `src/surfaces/cli/bin/ricky.ts exists: ${cliBinSourceExists}`,
            `src/surfaces/cli/commands/cli-main.ts exists: ${cliMainExists}`,
            `prepack builds the bundle: ${prepackBuildsBundle}`,
            `published files include dist: ${filesIncludesDist}`,
            `published files include .agents/skills: ${filesIncludesSkills}`,
          ],
          [],
          [
            ...(targetIsBundle ? [] : ['Root package.json bin.ricky does not map to ./dist/ricky.js']),
            ...(bundlerScriptExists ? [] : ['Missing scripts/bundle-cli.mjs']),
            ...(cliBinSourceExists ? [] : ['Missing src/surfaces/cli/bin/ricky.ts']),
            ...(cliMainExists ? [] : ['Missing src/surfaces/cli/commands/cli-main.ts']),
            ...(prepackBuildsBundle ? [] : ['prepack script does not run the bundle/build']),
            ...(filesIncludesDist ? [] : ['Root package.json files does not include dist']),
            ...(filesIncludesSkills ? [] : ['Root package.json files does not include .agents/skills']),
          ],
        );
      },
    },
    {
      name: 'legacy-packages-removed',
      description: 'The legacy packages/ workspace folder is fully removed.',
      evaluate: () => {
        const packagesExists = directoryExists('packages');
        const packageFiles = packagesExists ? listFiles('packages') : [];

        return result(
          'legacy-packages-removed',
          [!packagesExists],
          [
            `packages/ exists: ${packagesExists}`,
            `packages/ file count: ${packageFiles.length}`,
          ],
          [],
          !packagesExists
            ? []
            : [
                'packages/ directory still exists after the flat-layout collapse',
                ...packageFiles.map((file) => `legacy package file still present: ${file}`),
              ],
        );
      },
    },
    {
      name: 'surface-folder-shape',
      description: 'Surfaces live under src/surfaces, with CLI present and room for future surfaces.',
      evaluate: () => {
        const surfacesExists = directoryExists('src/surfaces');
        const cliSurfaceExists = directoryExists('src/surfaces/cli');

        return result(
          'surface-folder-shape',
          [surfacesExists, cliSurfaceExists],
          [
            `src/surfaces exists: ${surfacesExists}`,
            `src/surfaces/cli exists: ${cliSurfaceExists}`,
            'future surfaces documented: slack/, web/, mac/',
          ],
          [],
          [
            ...(surfacesExists ? [] : ['Missing src/surfaces folder']),
            ...(cliSurfaceExists ? [] : ['Missing src/surfaces/cli folder']),
          ],
        );
      },
    },
    {
      name: 'layer-direction-by-folder',
      description: 'Layer direction is enforced by folder ownership with a lightweight import scan.',
      evaluate: () => {
        const violations = layerDirectionViolations();

        return result(
          'layer-direction-by-folder',
          [violations.length === 0],
          [
            `layer direction violations: ${violations.length}`,
            'checked rules: shared !-> runtime|product|cloud|local|surfaces; runtime !-> product|cloud|local|surfaces; product !-> cloud|local|surfaces; cloud/local !-> surfaces',
            ...violations.map((hit) => `${hit.file}: imports ${hit.specifier} targeting src/${hit.targetLayer}`),
          ],
          [],
          violations.map((hit) => `Layer direction violation: ${hit.file} imports ${hit.specifier}`),
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
