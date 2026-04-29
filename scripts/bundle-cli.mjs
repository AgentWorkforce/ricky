#!/usr/bin/env node
/**
 * Bundle the ricky CLI into a single self-contained ESM file at dist/ricky.js.
 *
 * The published @agentworkforce/ricky package can't rely on workspace symlinks
 * that only exist in the development checkout, so we bake @ricky/* sources in
 * via esbuild. Real npm dependencies (@agent-relay/*, @agent-assistant/*,
 * etc.) stay external — npm install resolves them.
 */

import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

function collectExternals() {
  const externals = new Set();
  const rootPkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));
  for (const name of Object.keys(rootPkg.dependencies ?? {})) externals.add(name);

  const workspacePkgs = ['shared', 'runtime', 'product', 'cloud', 'local', 'cli'];
  for (const ws of workspacePkgs) {
    const pkg = JSON.parse(readFileSync(join(repoRoot, 'packages', ws, 'package.json'), 'utf8'));
    for (const dep of Object.keys(pkg.dependencies ?? {})) {
      if (dep.startsWith('@ricky/')) continue;
      externals.add(dep);
    }
  }
  return Array.from(externals);
}

const externals = collectExternals();

await build({
  entryPoints: [join(repoRoot, 'packages/cli/src/bin/ricky.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outfile: join(repoRoot, 'dist/ricky.js'),
  external: externals,
  conditions: ['development'],
  resolveExtensions: ['.ts', '.tsx', '.mjs', '.js'],
  sourcemap: 'inline',
  logLevel: 'info',
});

console.log('Bundled ricky CLI →', join(repoRoot, 'dist/ricky.js'));
console.log('Externals (resolved at install time):', externals.join(', '));
