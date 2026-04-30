#!/usr/bin/env node
/**
 * Bundle the ricky CLI into a single self-contained ESM file at dist/ricky.js.
 *
 * The published @agentworkforce/ricky package ships a precompiled bundle so
 * global installs work without a separate tsc pass and without devDeps like
 * tsx. Real npm dependencies stay external (resolved at install time);
 * everything from src/ is inlined.
 */

import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

const rootPkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));
const externals = Object.keys(rootPkg.dependencies ?? {});

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

console.log('Bundled ricky CLI →', join(repoRoot, 'dist/ricky.js'));
console.log('Externals (resolved at install time):', externals.join(', '));
