#!/usr/bin/env node
/**
 * Bundle the ricky CLI into a single self-contained ESM file at dist/ricky.js
 * and the public SDK into dist/index.js.
 *
 * The published @agentworkforce/ricky package ships a precompiled bundle so
 * global installs work without a separate tsc pass and without devDeps like
 * tsx. Real npm dependencies stay external (resolved at install time);
 * everything from src/ is inlined.
 */

import { build } from 'esbuild';
import { readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

const rootPkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));
const externals = Object.keys(rootPkg.dependencies ?? {});

rmSync(join(repoRoot, 'dist'), { recursive: true, force: true });

await build({
  entryPoints: [join(repoRoot, 'src/surfaces/cli/bin/ricky.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outfile: join(repoRoot, 'dist/ricky.js'),
  external: externals,
  resolveExtensions: ['.ts', '.tsx', '.mjs', '.js'],
  sourcemap: 'inline',
  logLevel: 'info',
});

await build({
  entryPoints: [join(repoRoot, 'src/sdk/index.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outfile: join(repoRoot, 'dist/index.js'),
  external: externals,
  resolveExtensions: ['.ts', '.tsx', '.mjs', '.js'],
  sourcemap: 'inline',
  logLevel: 'info',
});

emitDeclarations();

console.log('Bundled ricky CLI →', join(repoRoot, 'dist/ricky.js'));
console.log('Bundled Ricky SDK →', join(repoRoot, 'dist/index.js'));
console.log('Externals (resolved at install time):', externals.join(', '));

function emitDeclarations() {
  const configPath = ts.findConfigFile(repoRoot, ts.sys.fileExists, 'tsconfig.json');
  if (!configPath) {
    throw new Error('Could not find tsconfig.json for declaration emit.');
  }

  const parsedConfig = ts.parseJsonConfigFileContent(
    ts.readConfigFile(configPath, ts.sys.readFile).config,
    ts.sys,
    repoRoot,
    {
      declaration: true,
      declarationMap: false,
      emitDeclarationOnly: true,
      noEmit: false,
      outDir: join(repoRoot, 'dist'),
      rootDir: join(repoRoot, 'src'),
      sourceMap: false,
    },
    configPath,
  );

  const srcRoot = join(repoRoot, 'src');
  const sourceFiles = ts.sys
    .readDirectory(srcRoot, ['.ts'], undefined, undefined)
    .filter((file) => !file.endsWith('.test.ts'));
  const program = ts.createProgram(sourceFiles, parsedConfig.options);
  const emit = program.emit();
  const diagnostics = ts
    .getPreEmitDiagnostics(program)
    .concat(emit.diagnostics)
    .filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error);

  if (diagnostics.length > 0) {
    throw new Error(ts.formatDiagnosticsWithColorAndContext(diagnostics, {
      getCanonicalFileName: (fileName) => fileName,
      getCurrentDirectory: () => repoRoot,
      getNewLine: () => '\n',
    }));
  }
}
