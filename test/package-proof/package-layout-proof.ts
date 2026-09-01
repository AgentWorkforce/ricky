/**
 * Ricky package layout and npm-default proof surface.
 *
 * Proves the post-collapse package contract from a different angle than
 * `test/flat-layout-proof/`:
 *
 * - npm is the clear default path via package manifest, runtime pinning, and README prose
 * - the package shape is explicit and fully documented, not an unexplained one-off
 * - typecheck/test entrypoints still cover the landed product surfaces
 *
 * The proof is fully deterministic, bounded, and never touches the network or
 * the npm registry. It only reads files already on disk.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, normalize, relative, resolve, sep } from 'node:path';

export type PackageLayoutProofCaseName =
  | 'npm-default-package-manifest'
  | 'npm-default-runtime-pinning'
  | 'npm-default-readme-prose'
  | 'package-shape-required-fields'
  | 'package-script-allowlist'
  | 'package-script-readme-parity'
  | 'bin-points-to-published-bundle'
  | 'typecheck-config-covers-surfaces'
  | 'vitest-config-covers-surfaces'
  | 'no-live-network-or-publish-dependency';

export interface PackageLayoutProofCase {
  name: PackageLayoutProofCaseName;
  description: string;
  evaluate: () => PackageLayoutProofResult;
}

export interface PackageLayoutProofResult {
  name: string;
  passed: boolean;
  evidence: string[];
  gaps: string[];
  failures: string[];
}

export interface PackageLayoutProofSummary {
  passed: boolean;
  failures: string[];
  gaps: string[];
}

interface PackageManifest {
  name?: unknown;
  version?: unknown;
  description?: unknown;
  license?: unknown;
  type?: unknown;
  main?: unknown;
  types?: unknown;
  exports?: unknown;
  engines?: { node?: unknown };
  packageManager?: unknown;
  bin?: unknown;
  files?: unknown;
  publishConfig?: { access?: unknown };
  scripts?: Record<string, unknown>;
  workspaces?: unknown;
  private?: unknown;
  dependencies?: Record<string, unknown>;
  devDependencies?: Record<string, unknown>;
  optionalDependencies?: Record<string, unknown>;
  peerDependencies?: Record<string, unknown>;
}

const REQUIRED_PRODUCT_SURFACES = [
  'src/shared',
  'src/runtime',
  'src/product',
  'src/cloud',
  'src/local',
  'src/surfaces/cli',
] as const;

// Surfaces that carry their own runtime test files under src/.
// `src/shared` is intentionally pure data/config; coverage lives via the layers
// that consume it, so we do not require an in-tree test file for it here.
const SURFACES_WITH_IN_TREE_TESTS = [
  'src/runtime',
  'src/product',
  'src/cloud',
  'src/local',
  'src/surfaces/cli',
] as const;

const REQUIRED_PACKAGE_SCRIPTS = [
  'clean',
  'bundle',
  'build',
  'typecheck',
  'test',
  'premerge',
  'start',
  'dev',
  'evals',
  'evals:compile',
  'evals:provider',
  'evals:opencode',
  'evals:list',
  'evals:summary',
  'evals:compare',
  'batch',
  'overnight',
  'prepack',
] as const;

const REQUIRED_TSCONFIG_INCLUDES = ['src', 'test', 'workflows', 'scripts'] as const;

const REQUIRED_VITEST_GLOBS = ['src/**/*.test.ts', 'test/**/*.test.ts'] as const;

const ALTERNATIVE_LOCKFILES = ['yarn.lock', 'pnpm-lock.yaml', 'bun.lockb', 'bun.lock'] as const;

function repoRoot(): string {
  return resolve(__dirname, '../..');
}

function toRepoPath(absPath: string): string {
  return normalize(relative(repoRoot(), absPath)).split(sep).join('/');
}

function readJson<T>(relPath: string): T {
  return JSON.parse(readFileSync(join(repoRoot(), relPath), 'utf-8')) as T;
}

function readText(relPath: string): string {
  return readFileSync(join(repoRoot(), relPath), 'utf-8');
}

function pathExists(relPath: string): boolean {
  return existsSync(join(repoRoot(), relPath));
}

function fileExists(relPath: string): boolean {
  const abs = join(repoRoot(), relPath);
  return existsSync(abs) && statSync(abs).isFile();
}

function directoryExists(relPath: string): boolean {
  const abs = join(repoRoot(), relPath);
  return existsSync(abs) && statSync(abs).isDirectory();
}

function shouldSkipDirectory(repoPath: string): boolean {
  const parts = repoPath.split('/');
  return (
    parts.includes('node_modules')
    || repoPath === '.git'
    || repoPath.startsWith('.git/')
    || repoPath.startsWith('.agent-relay/')
    || repoPath.startsWith('.agent-relay.stale.')
    || repoPath.startsWith('.relay/')
    || repoPath.startsWith('.claude/worktrees/')
    || repoPath.startsWith('.workflow-artifacts/')
    || repoPath.startsWith('.trajectories/')
    || repoPath.startsWith('dist/')
    || repoPath.startsWith('tmp/')
  );
}

function listFiles(relPath: string): string[] {
  const start = join(repoRoot(), relPath);
  if (!existsSync(start)) {
    return [];
  }
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const abs = join(dir, entry.name);
      const repoPath = toRepoPath(abs);
      if (entry.isDirectory()) {
        if (shouldSkipDirectory(repoPath)) {
          continue;
        }
        walk(abs);
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

function listTestFiles(relPath: string): string[] {
  return listFiles(relPath).filter((file) => file.endsWith('.test.ts'));
}

function result(
  name: PackageLayoutProofCaseName,
  checks: boolean[],
  evidence: string[],
  gaps: string[] = [],
  failures: string[] = [],
): PackageLayoutProofResult {
  return {
    name,
    passed: checks.every(Boolean) && failures.length === 0,
    evidence,
    gaps,
    failures,
  };
}

function packageBinTarget(pkg: PackageManifest): string {
  if (typeof pkg.bin === 'string') {
    return pkg.bin;
  }
  if (pkg.bin && typeof pkg.bin === 'object') {
    const bins = pkg.bin as Record<string, unknown>;
    return typeof bins.ricky === 'string' ? bins.ricky : '';
  }
  return '';
}

function depsHaveFileProtocol(pkg: PackageManifest): string[] {
  const sections = [pkg.dependencies, pkg.devDependencies, pkg.optionalDependencies, pkg.peerDependencies];
  const hits: string[] = [];
  for (const section of sections) {
    if (!section) {
      continue;
    }
    for (const [name, version] of Object.entries(section)) {
      if (typeof version === 'string' && version.startsWith('file:')) {
        hits.push(`${name}@${version}`);
      }
    }
  }
  return hits;
}

function vitestIncludeArray(source: string): string[] {
  // Pull the include: [ ... ] block in vitest.config.ts and return its string entries.
  const match = /include\s*:\s*\[([\s\S]*?)\]/.exec(source);
  if (!match) {
    return [];
  }
  const literal = /['"`]([^'"`]+)['"`]/g;
  const entries: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = literal.exec(match[1]))) {
    entries.push(m[1]);
  }
  return entries;
}

function readmeMentionsAll(source: string, fragments: readonly string[]): string[] {
  return fragments.filter((fragment) => !source.includes(fragment));
}

export function getPackageLayoutProofCases(): PackageLayoutProofCase[] {
  const rootPkg = readJson<PackageManifest>('package.json');
  const readmeText = fileExists('README.md') ? readText('README.md') : '';
  const tsconfigText = fileExists('tsconfig.json') ? readText('tsconfig.json') : '';
  const vitestConfigText = fileExists('vitest.config.ts') ? readText('vitest.config.ts') : '';

  return [
    {
      name: 'npm-default-package-manifest',
      description: 'package.json declares npm as the package manager and ships no workspaces or alternative lockfiles.',
      evaluate: () => {
        const packageManager = typeof rootPkg.packageManager === 'string' ? rootPkg.packageManager : '';
        const declaresNpm = packageManager.startsWith('npm@');
        const enginesNode = typeof rootPkg.engines?.node === 'string' ? rootPkg.engines.node : '';
        const enginesPinNode = enginesNode.length > 0 && /\d/.test(enginesNode);
        const hasWorkspaces = Object.prototype.hasOwnProperty.call(rootPkg, 'workspaces');
        const altLockfilesPresent = ALTERNATIVE_LOCKFILES.filter((file) => fileExists(file));
        const hasNpmLockfile = fileExists('package-lock.json');

        return result(
          'npm-default-package-manifest',
          [declaresNpm, enginesPinNode, !hasWorkspaces, altLockfilesPresent.length === 0, hasNpmLockfile],
          [
            `package.json packageManager: ${packageManager || '(missing)'}`,
            `package.json engines.node: ${enginesNode || '(missing)'}`,
            `package.json workspaces declared: ${hasWorkspaces}`,
            `package-lock.json present: ${hasNpmLockfile}`,
            `alternative lockfiles present: ${altLockfilesPresent.join(', ') || '(none)'}`,
          ],
          [],
          [
            ...(declaresNpm ? [] : [`packageManager does not pin npm: ${packageManager || '(missing)'}`]),
            ...(enginesPinNode ? [] : [`engines.node does not pin a Node version: ${enginesNode || '(missing)'}`]),
            ...(hasWorkspaces ? ['package.json declares workspaces; expected single-package npm repo'] : []),
            ...altLockfilesPresent.map((file) => `Alternative lockfile present, breaks npm-as-default: ${file}`),
            ...(hasNpmLockfile ? [] : ['Missing package-lock.json; npm install is not reproducible']),
          ],
        );
      },
    },
    {
      name: 'npm-default-runtime-pinning',
      description: '.npmrc and .nvmrc pin the runtime so npm install is the only supported on-ramp.',
      evaluate: () => {
        const npmrcExists = fileExists('.npmrc');
        const nvmrcExists = fileExists('.nvmrc');
        const npmrcText = npmrcExists ? readText('.npmrc') : '';
        const nvmrcText = nvmrcExists ? readText('.nvmrc') : '';
        const engineStrict = /^\s*engine-strict\s*=\s*true\s*$/m.test(npmrcText);
        const nvmHasNodeMajor = /^\s*\d+(?:\.\d+){0,2}\s*$/.test(nvmrcText.trim());

        return result(
          'npm-default-runtime-pinning',
          [npmrcExists, nvmrcExists, engineStrict, nvmHasNodeMajor],
          [
            `.npmrc exists: ${npmrcExists}`,
            `.nvmrc exists: ${nvmrcExists}`,
            `.npmrc declares engine-strict=true: ${engineStrict}`,
            `.nvmrc value: ${nvmrcText.trim() || '(empty)'}`,
          ],
          [],
          [
            ...(npmrcExists ? [] : ['Missing .npmrc; npm engine pinning is not enforced']),
            ...(nvmrcExists ? [] : ['Missing .nvmrc; node version is not pinned for nvm users']),
            ...(engineStrict ? [] : ['.npmrc does not set engine-strict=true']),
            ...(nvmHasNodeMajor ? [] : [`.nvmrc does not contain a numeric Node version: ${nvmrcText.trim() || '(empty)'}`]),
          ],
        );
      },
    },
    {
      name: 'npm-default-readme-prose',
      description: 'README documents the npm-only on-ramp explicitly.',
      evaluate: () => {
        const requiredCommands = ['npm install', 'npm run build', 'npm test', 'npm start'];
        const missingCommands = readmeMentionsAll(readmeText, requiredCommands);
        const declaresNpmAsDefault = readmeText.includes('npm is the only supported package and script surface')
          || readmeText.includes('npm is the default and only path');
        const mentionsNoYarnPnpm = readmeText.includes('Yarn') || readmeText.includes('yarn')
          ? readmeText.includes('no Yarn') || readmeText.includes('No Yarn') || readmeText.includes('There is no Yarn')
          : true;

        return result(
          'npm-default-readme-prose',
          [missingCommands.length === 0, declaresNpmAsDefault, mentionsNoYarnPnpm],
          [
            `README mentions all of [${requiredCommands.join(', ')}]: ${missingCommands.length === 0}`,
            `README states npm is the default/only path: ${declaresNpmAsDefault}`,
            `README does not silently leave Yarn/pnpm as an option: ${mentionsNoYarnPnpm}`,
          ],
          [],
          [
            ...missingCommands.map((cmd) => `README is missing canonical npm command: ${cmd}`),
            ...(declaresNpmAsDefault ? [] : ['README does not explicitly state that npm is the default/only path']),
            ...(mentionsNoYarnPnpm ? [] : ['README references Yarn/pnpm without disowning them as supported on-ramps']),
          ],
        );
      },
    },
    {
      name: 'package-shape-required-fields',
      description: 'package.json declares a complete, intentional shape for a published single-package repo.',
      evaluate: () => {
        const requiredStrings: Array<[keyof PackageManifest, unknown]> = [
          ['name', rootPkg.name],
          ['version', rootPkg.version],
          ['description', rootPkg.description],
          ['license', rootPkg.license],
          ['type', rootPkg.type],
        ];
        const stringIssues = requiredStrings.flatMap(([field, value]) =>
          typeof value === 'string' && value.length > 0 ? [] : [`Missing or empty package.json field: ${field}`],
        );
        const filesIsArray = Array.isArray(rootPkg.files) && rootPkg.files.length > 0;
        const rootExport = rootPkg.exports && typeof rootPkg.exports === 'object'
          ? (rootPkg.exports as Record<string, unknown>)['.']
          : undefined;
        const rootExportRecord = rootExport && typeof rootExport === 'object'
          ? rootExport as Record<string, unknown>
          : {};
        const rootExportImport = rootExportRecord.import;
        const rootExportTypes = rootExportRecord.types;
        const hasSdkMain = rootPkg.main === './dist/index.js';
        const hasSdkTypes = rootPkg.types === './dist/sdk/index.d.ts';
        const hasSdkRootExport = rootExportImport === './dist/index.js' && rootExportTypes === './dist/sdk/index.d.ts';
        const publishAccess = rootPkg.publishConfig?.access;
        const hasPublishAccess = publishAccess === 'public' || publishAccess === 'restricted';
        const hasBin = packageBinTarget(rootPkg).length > 0;
        const isModule = rootPkg.type === 'module';
        const isPrivate = rootPkg.private === true;
        const fileProtocolDeps = depsHaveFileProtocol(rootPkg);
        const noFileProtocolDeps = fileProtocolDeps.length === 0;

        return result(
          'package-shape-required-fields',
          [
            stringIssues.length === 0,
            filesIsArray,
            hasSdkMain,
            hasSdkTypes,
            hasSdkRootExport,
            hasPublishAccess,
            hasBin,
            isModule,
            !isPrivate,
            noFileProtocolDeps,
          ],
          [
            `package.json name: ${typeof rootPkg.name === 'string' ? rootPkg.name : '(missing)'}`,
            `package.json version: ${typeof rootPkg.version === 'string' ? rootPkg.version : '(missing)'}`,
            `package.json license: ${typeof rootPkg.license === 'string' ? rootPkg.license : '(missing)'}`,
            `package.json type: ${typeof rootPkg.type === 'string' ? rootPkg.type : '(missing)'}`,
            `package.json exports["."].import: ${typeof rootExportImport === 'string' ? rootExportImport : '(missing)'}`,
            `package.json exports["."].types: ${typeof rootExportTypes === 'string' ? rootExportTypes : '(missing)'}`,
            `package.json main: ${typeof rootPkg.main === 'string' ? rootPkg.main : '(missing)'}`,
            `package.json types: ${typeof rootPkg.types === 'string' ? rootPkg.types : '(missing)'}`,
            `package.json files is non-empty array: ${filesIsArray}`,
            `package.json publishConfig.access: ${typeof publishAccess === 'string' ? publishAccess : '(missing)'}`,
            `package.json bin.ricky present: ${hasBin}`,
            `package.json type === "module": ${isModule}`,
            `package.json private: ${rootPkg.private === undefined ? '(unset)' : String(rootPkg.private)}`,
            `package.json file: protocol deps: ${fileProtocolDeps.join(', ') || '(none)'}`,
          ],
          [],
          [
            ...stringIssues,
            ...(filesIsArray ? [] : ['package.json files is missing or empty']),
            ...(hasSdkMain ? [] : ['package.json main does not point at ./dist/index.js']),
            ...(hasSdkTypes ? [] : ['package.json types does not point at ./dist/sdk/index.d.ts']),
            ...(hasSdkRootExport ? [] : ['package.json exports["."] does not expose the SDK import and types targets']),
            ...(hasPublishAccess ? [] : ['package.json publishConfig.access is missing or unrecognized']),
            ...(hasBin ? [] : ['package.json bin.ricky is missing']),
            ...(isModule ? [] : ['package.json type is not "module"']),
            ...(isPrivate ? ['package.json declares private: true; this is a published package'] : []),
            ...fileProtocolDeps.map((dep) => `package.json declares file: protocol dep, breaks publish path: ${dep}`),
          ],
        );
      },
    },
    {
      name: 'package-script-allowlist',
      description: 'package.json scripts match a known canonical set; no surprise scripts have been introduced.',
      evaluate: () => {
        const scripts = rootPkg.scripts ?? {};
        const declared = Object.keys(scripts).sort();
        const required = [...REQUIRED_PACKAGE_SCRIPTS].sort();
        const missing = required.filter((name) => typeof scripts[name] !== 'string' || (scripts[name] as string).length === 0);
        const extra = declared.filter((name) => !required.includes(name as (typeof REQUIRED_PACKAGE_SCRIPTS)[number]));
        const premerge = typeof scripts.premerge === 'string' ? scripts.premerge : '';
        const premergeDelegatesToScript = premerge === 'node scripts/run-premerge.mjs';
        const premergeScript = premergeDelegatesToScript && fileExists('scripts/run-premerge.mjs')
          ? readText('scripts/run-premerge.mjs')
          : '';
        const premergeEvidence = premergeDelegatesToScript ? premergeScript : premerge;
        const premergeRunsTypecheck = premergeEvidence.includes('npm run typecheck')
          || premergeEvidence.includes('./node_modules/.bin/tsc')
          || premergeEvidence.includes("label: 'typecheck'");
        const premergeRunsFullSuite = premergeEvidence.includes('npm test')
          || premergeEvidence.includes('./node_modules/.bin/vitest')
          || premergeEvidence.includes("label: 'full-test-suite'");
        const premergeRunsAutoFixLadder = premergeEvidence.includes('test/local-auto-fix-workflow-failures.e2e.test.ts')
          || premergeEvidence.includes("label: 'local-auto-fix-ladder-e2e'");

        return result(
          'package-script-allowlist',
          [
            missing.length === 0,
            extra.length === 0,
            premergeRunsTypecheck,
            premergeRunsFullSuite,
            premergeRunsAutoFixLadder,
          ],
          [
            `required scripts: ${required.join(', ')}`,
            `declared scripts: ${declared.join(', ')}`,
            `missing required scripts: ${missing.join(', ') || '(none)'}`,
            `unexpected extra scripts: ${extra.join(', ') || '(none)'}`,
            `package.json scripts.premerge: ${premerge || '(missing)'}`,
            `premerge runs typecheck: ${premergeRunsTypecheck}`,
            `premerge runs full test suite: ${premergeRunsFullSuite}`,
            `premerge runs local auto-fix ladder e2e: ${premergeRunsAutoFixLadder}`,
          ],
          [],
          [
            ...missing.map((name) => `Missing required npm script: ${name}`),
            ...extra.map((name) => `Unexpected npm script not in canonical allowlist: ${name}`),
            ...(premergeRunsTypecheck ? [] : ['package.json scripts.premerge does not run typecheck via npm run typecheck or direct tsc']),
            ...(premergeRunsFullSuite ? [] : ['package.json scripts.premerge does not run the full suite via npm test or direct vitest']),
            ...(premergeRunsAutoFixLadder ? [] : ['package.json scripts.premerge does not run the local auto-fix workflow ladder e2e']),
          ],
        );
      },
    },
    {
      name: 'package-script-readme-parity',
      description: 'Every required npm script is mentioned by name in README so the docs match the manifest.',
      evaluate: () => {
        const undocumented = REQUIRED_PACKAGE_SCRIPTS.filter((script) => {
          const runForm = `npm run ${script}`;
          const verbForm = script === 'test' ? 'npm test' : script === 'start' ? 'npm start' : runForm;
          return !readmeText.includes(runForm) && !readmeText.includes(verbForm);
        });

        return result(
          'package-script-readme-parity',
          [undocumented.length === 0],
          [
            `required scripts checked for README mention: ${REQUIRED_PACKAGE_SCRIPTS.length}`,
            `undocumented scripts: ${undocumented.join(', ') || '(none)'}`,
          ],
          [],
          undocumented.map((script) => `Required npm script is not mentioned in README: ${script}`),
        );
      },
    },
    {
      name: 'bin-points-to-published-bundle',
      description: 'The published `ricky` bin points at dist/ricky.js, prepack runs the bundler, and dist is in `files`.',
      evaluate: () => {
        const binTarget = packageBinTarget(rootPkg);
        const targetIsBundle = binTarget === './dist/ricky.js' || binTarget === 'dist/ricky.js';
        const prepack = typeof rootPkg.scripts?.prepack === 'string' ? rootPkg.scripts.prepack : '';
        const prepackBuilds = prepack.includes('build') || prepack.includes('bundle');
        const filesIncludesDist = Array.isArray(rootPkg.files) && rootPkg.files.includes('dist');
        const bundlerScriptExists = fileExists('scripts/bundle-cli.mjs');
        const sdkSourceExists = fileExists('src/sdk/index.ts');
        const cliBinSourceExists = fileExists('src/surfaces/cli/bin/ricky.ts');
        const cliMainExists = fileExists('src/surfaces/cli/commands/cli-main.ts');

        return result(
          'bin-points-to-published-bundle',
          [targetIsBundle, prepackBuilds, filesIncludesDist, bundlerScriptExists, sdkSourceExists, cliBinSourceExists, cliMainExists],
          [
            `package.json bin.ricky: ${binTarget || '(missing)'}`,
            `package.json scripts.prepack: ${prepack || '(missing)'}`,
            `published files include dist: ${filesIncludesDist}`,
            `scripts/bundle-cli.mjs exists: ${bundlerScriptExists}`,
            `src/sdk/index.ts exists: ${sdkSourceExists}`,
            `src/surfaces/cli/bin/ricky.ts exists: ${cliBinSourceExists}`,
            `src/surfaces/cli/commands/cli-main.ts exists: ${cliMainExists}`,
          ],
          [],
          [
            ...(targetIsBundle ? [] : ['package.json bin.ricky does not point at ./dist/ricky.js']),
            ...(prepackBuilds ? [] : ['package.json scripts.prepack does not run the bundle/build']),
            ...(filesIncludesDist ? [] : ['package.json files does not include dist']),
            ...(bundlerScriptExists ? [] : ['Missing scripts/bundle-cli.mjs; bundle path is broken']),
            ...(sdkSourceExists ? [] : ['Missing src/sdk/index.ts; SDK package source is gone']),
            ...(cliBinSourceExists ? [] : ['Missing src/surfaces/cli/bin/ricky.ts; CLI bin source is gone']),
            ...(cliMainExists ? [] : ['Missing src/surfaces/cli/commands/cli-main.ts; CLI main entry is gone']),
          ],
        );
      },
    },
    {
      name: 'typecheck-config-covers-surfaces',
      description: 'tsconfig.json includes src, test, workflows, and scripts so typecheck reaches every landed product surface.',
      evaluate: () => {
        const tsconfig = fileExists('tsconfig.json')
          ? readJson<{ include?: unknown; compilerOptions?: { strict?: unknown } }>('tsconfig.json')
          : {};
        const include = Array.isArray(tsconfig.include)
          ? tsconfig.include.filter((entry): entry is string => typeof entry === 'string')
          : [];
        const missingRequired = REQUIRED_TSCONFIG_INCLUDES.filter((entry) => !include.includes(entry));
        const includedSurfacesOnDisk = REQUIRED_TSCONFIG_INCLUDES.filter((entry) => directoryExists(entry));
        const missingOnDisk = REQUIRED_TSCONFIG_INCLUDES.filter((entry) => !directoryExists(entry));
        const strict = tsconfig.compilerOptions?.strict === true;
        const missingProductSurfacesOnDisk = REQUIRED_PRODUCT_SURFACES.filter((surface) => !directoryExists(surface));

        return result(
          'typecheck-config-covers-surfaces',
          [
            missingRequired.length === 0,
            missingOnDisk.length === 0,
            strict,
            missingProductSurfacesOnDisk.length === 0,
          ],
          [
            `tsconfig include entries: ${include.join(', ') || '(none)'}`,
            `required tsconfig include entries present: ${REQUIRED_TSCONFIG_INCLUDES.length - missingRequired.length}/${REQUIRED_TSCONFIG_INCLUDES.length}`,
            `missing tsconfig include entries: ${missingRequired.join(', ') || '(none)'}`,
            `tsconfig include directories that exist on disk: ${includedSurfacesOnDisk.join(', ')}`,
            `tsconfig include directories missing on disk: ${missingOnDisk.join(', ') || '(none)'}`,
            `compilerOptions.strict: ${String(tsconfig.compilerOptions?.strict ?? '(missing)')}`,
            `landed product surfaces present: ${(REQUIRED_PRODUCT_SURFACES.length - missingProductSurfacesOnDisk.length)}/${REQUIRED_PRODUCT_SURFACES.length}`,
            `tsconfig text length: ${tsconfigText.length}`,
          ],
          [],
          [
            ...missingRequired.map((entry) => `tsconfig include is missing required entry: ${entry}`),
            ...missingOnDisk.map((entry) => `tsconfig include entry does not exist on disk: ${entry}`),
            ...(strict ? [] : ['tsconfig compilerOptions.strict is not true']),
            ...missingProductSurfacesOnDisk.map((surface) => `Landed product surface missing on disk: ${surface}`),
          ],
        );
      },
    },
    {
      name: 'vitest-config-covers-surfaces',
      description: 'vitest.config.ts globs reach src/ and test/ tests, and product surfaces with in-tree tests are actually matched.',
      evaluate: () => {
        const include = vitestIncludeArray(vitestConfigText);
        const missingGlobs = REQUIRED_VITEST_GLOBS.filter((glob) => !include.includes(glob));
        const surfaceTestCounts = SURFACES_WITH_IN_TREE_TESTS.map((surface) => ({
          surface,
          testCount: listTestFiles(surface).length,
        }));
        const surfacesWithoutTests = surfaceTestCounts.filter((entry) => entry.testCount === 0);
        const repoTestDirCount = listTestFiles('test').length;
        const usesNodeEnv = /environment\s*:\s*['"`]node['"`]/.test(vitestConfigText);
        const declaresSetupFiles = /setupFiles\s*:\s*\[/.test(vitestConfigText);

        return result(
          'vitest-config-covers-surfaces',
          [
            missingGlobs.length === 0,
            surfacesWithoutTests.length === 0,
            repoTestDirCount > 0,
            usesNodeEnv,
            declaresSetupFiles,
          ],
          [
            `vitest include entries: ${include.join(', ') || '(none)'}`,
            `required vitest globs: ${REQUIRED_VITEST_GLOBS.join(', ')}`,
            `missing required vitest globs: ${missingGlobs.join(', ') || '(none)'}`,
            ...surfaceTestCounts.map((entry) => `${entry.surface}: ${entry.testCount} *.test.ts file(s)`),
            `repo-level test/ *.test.ts file count: ${repoTestDirCount}`,
            `vitest test.environment is node: ${usesNodeEnv}`,
            `vitest declares setupFiles: ${declaresSetupFiles}`,
          ],
          [],
          [
            ...missingGlobs.map((glob) => `vitest include is missing required glob: ${glob}`),
            ...surfacesWithoutTests.map((entry) => `Landed product surface has no *.test.ts file under itself: ${entry.surface}`),
            ...(repoTestDirCount > 0 ? [] : ['Repo-level test/ directory has no *.test.ts files']),
            ...(usesNodeEnv ? [] : ['vitest test.environment is not "node"']),
            ...(declaresSetupFiles ? [] : ['vitest config does not declare setupFiles']),
          ],
        );
      },
    },
    {
      name: 'no-live-network-or-publish-dependency',
      description: 'The proof imports only on-disk filesystem helpers and asserts the bundle is on disk for proof and packing.',
      evaluate: () => {
        const proofSourcePath = 'test/package-proof/package-layout-proof.ts';
        const proofText = fileExists(proofSourcePath) ? readText(proofSourcePath) : '';
        const importPattern = /\bimport\s+(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/g;
        const requirePattern = /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
        const importedSpecifiers = new Set<string>();
        let match: RegExpExecArray | null;
        while ((match = importPattern.exec(proofText))) {
          importedSpecifiers.add(match[1]);
        }
        while ((match = requirePattern.exec(proofText))) {
          importedSpecifiers.add(match[1]);
        }
        const networkModules = ['node:http', 'node:https', 'node:net', 'node:dgram', 'node:tls', 'node:dns'];
        const childProcessModules = ['node:child_process', 'child_process'];
        const importedNetworkModules = networkModules.filter((mod) => importedSpecifiers.has(mod));
        const importedChildProcess = childProcessModules.filter((mod) => importedSpecifiers.has(mod));
        const allowedImports = new Set(['node:fs', 'node:path']);
        const unexpectedImports = [...importedSpecifiers].filter((specifier) => !allowedImports.has(specifier));
        const distBundleExists = fileExists('dist/ricky.js');
        const bundlerScriptExists = fileExists('scripts/bundle-cli.mjs');

        return result(
          'no-live-network-or-publish-dependency',
          [
            importedNetworkModules.length === 0,
            importedChildProcess.length === 0,
            unexpectedImports.length === 0,
            distBundleExists || bundlerScriptExists,
          ],
          [
            `proof source path: ${proofSourcePath}`,
            `proof source imported specifiers: ${[...importedSpecifiers].sort().join(', ') || '(none)'}`,
            `network module imports in proof: ${importedNetworkModules.join(', ') || '(none)'}`,
            `child_process imports in proof: ${importedChildProcess.join(', ') || '(none)'}`,
            `unexpected imports in proof: ${unexpectedImports.join(', ') || '(none)'}`,
            `dist/ricky.js exists on disk: ${distBundleExists}`,
            `scripts/bundle-cli.mjs exists on disk: ${bundlerScriptExists}`,
          ],
          [],
          [
            ...importedNetworkModules.map((specifier) => `Proof imports network module: ${specifier}`),
            ...importedChildProcess.map((specifier) => `Proof imports child_process module: ${specifier}`),
            ...unexpectedImports.map((specifier) => `Proof imports unexpected module: ${specifier}`),
            ...(distBundleExists || bundlerScriptExists ? [] : ['Neither dist/ricky.js nor scripts/bundle-cli.mjs exist; bundle path is unproveable']),
          ],
        );
      },
    },
  ];
}

export function evaluatePackageLayoutProof(): PackageLayoutProofResult[] {
  return getPackageLayoutProofCases().map((proofCase) => proofCase.evaluate());
}

export function evaluatePackageLayoutProofCase(name: PackageLayoutProofCaseName): PackageLayoutProofResult {
  const proofCase = getPackageLayoutProofCases().find((candidate) => candidate.name === name);
  if (!proofCase) {
    throw new Error(`Unknown package layout proof case: ${name}`);
  }
  return proofCase.evaluate();
}

export function summarizePackageLayoutProof(): PackageLayoutProofSummary {
  const results = evaluatePackageLayoutProof();
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
