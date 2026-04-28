#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const sourceRoots = process.argv.slice(2);
const roots = sourceRoots.length > 0 ? sourceRoots : ['src'];
const rickyLayers = new Set(['shared', 'runtime', 'product', 'cloud', 'local']);
const sourceExts = ['.ts', '.tsx'];

function toPosix(filePath) {
  return filePath.split(path.sep).join('/');
}

function withoutTsExtension(filePath) {
  return filePath.replace(/\.(ts|tsx)$/u, '');
}

function stripImportExtension(specifier) {
  return specifier.replace(/\.(js|ts|tsx)$/u, '');
}

function candidateFiles(basePath) {
  return [
    ...sourceExts.map((ext) => `${basePath}${ext}`),
    ...sourceExts.map((ext) => path.join(basePath, `index${ext}`)),
  ];
}

function resolveExisting(candidates, originalSpecifier, importerPath) {
  const match = candidates.find((candidate) => existsSync(candidate));
  if (!match) {
    const relativeImporter = toPosix(path.relative(repoRoot, importerPath));
    const displayCandidates = candidates.map((candidate) => toPosix(path.relative(repoRoot, candidate))).join(', ');
    throw new Error(`Could not resolve ${originalSpecifier} from ${relativeImporter}; tried ${displayCandidates}`);
  }
  return match;
}

function toRelativeJsSpecifier(importerPath, targetPath) {
  const importerDir = path.dirname(importerPath);
  let relative = toPosix(path.relative(importerDir, withoutTsExtension(targetPath)));
  if (!relative.startsWith('.')) {
    relative = `./${relative}`;
  }
  return `${relative}.js`;
}

function resolveRickyAlias(specifier, importerPath) {
  const raw = specifier.slice('@ricky/'.length);
  const [layer, ...restParts] = raw.split('/');
  if (!rickyLayers.has(layer)) {
    return null;
  }

  const rest = stripImportExtension(restParts.join('/'));
  const base = rest
    ? path.join(repoRoot, 'src', layer, rest)
    : path.join(repoRoot, 'src', layer, 'index');
  const target = resolveExisting(candidateFiles(base), specifier, importerPath);
  return toRelativeJsSpecifier(importerPath, target);
}

function resolveSelfAlias(specifier, importerPath) {
  if (!toPosix(path.relative(repoRoot, importerPath)).startsWith('src/surfaces/cli/')) {
    return null;
  }

  if (specifier === '@agentworkforce/ricky') {
    const target = resolveExisting(
      candidateFiles(path.join(repoRoot, 'src', 'surfaces', 'cli', 'index')),
      specifier,
      importerPath,
    );
    return toRelativeJsSpecifier(importerPath, target);
  }

  if (!specifier.startsWith('@agentworkforce/ricky/')) {
    return null;
  }

  const rest = stripImportExtension(specifier.slice('@agentworkforce/ricky/'.length));
  const target = resolveExisting(candidateFiles(path.join(repoRoot, 'src', rest)), specifier, importerPath);
  return toRelativeJsSpecifier(importerPath, target);
}

function resolveRelativeSpecifier(specifier, importerPath) {
  if (!specifier.startsWith('.')) {
    return null;
  }

  const parsed = path.posix.parse(specifier);
  if (parsed.ext) {
    return null;
  }

  const base = path.resolve(path.dirname(importerPath), specifier);
  const target = resolveExisting(candidateFiles(base), specifier, importerPath);
  return toRelativeJsSpecifier(importerPath, target);
}

function rewriteSpecifier(specifier, importerPath) {
  if (specifier === '@ricky/shared' || specifier === '@ricky/runtime' || specifier === '@ricky/product' || specifier === '@ricky/cloud' || specifier === '@ricky/local') {
    const layer = specifier.slice('@ricky/'.length);
    const target = resolveExisting(
      candidateFiles(path.join(repoRoot, 'src', layer, 'index')),
      specifier,
      importerPath,
    );
    return toRelativeJsSpecifier(importerPath, target);
  }

  if (specifier.startsWith('@ricky/')) {
    return resolveRickyAlias(specifier, importerPath);
  }

  if (specifier.startsWith('@agentworkforce/ricky')) {
    return resolveSelfAlias(specifier, importerPath);
  }

  return resolveRelativeSpecifier(specifier, importerPath);
}

function rewriteFile(filePath) {
  const original = readFileSync(filePath, 'utf8');
  let changed = false;

  const replaceSpecifier = (fullMatch, prefix, specifier, suffix) => {
    const replacement = rewriteSpecifier(specifier, filePath);
    if (!replacement || replacement === specifier) {
      return fullMatch;
    }
    changed = true;
    return `${prefix}${replacement}${suffix}`;
  };

  let next = original.replace(
    /(\bfrom\s*['"]|import\s*\(\s*['"]|require\s*\(\s*['"])([^'"]+)(['"])/gu,
    replaceSpecifier,
  );
  next = next.replace(/(\bimport\s*['"])([^'"]+)(['"])/gu, replaceSpecifier);

  if (changed) {
    writeFileSync(filePath, next);
    return true;
  }
  return false;
}

function walk(root) {
  const absoluteRoot = path.resolve(repoRoot, root);
  if (!existsSync(absoluteRoot)) {
    return [];
  }

  const files = [];
  for (const entry of readdirSync(absoluteRoot)) {
    const absoluteEntry = path.join(absoluteRoot, entry);
    const stats = statSync(absoluteEntry);
    if (stats.isDirectory()) {
      files.push(...walk(absoluteEntry));
    } else if (stats.isFile() && /\.(ts|tsx)$/u.test(entry)) {
      files.push(absoluteEntry);
    }
  }
  return files;
}

const changedFiles = roots.flatMap(walk).filter(rewriteFile).map((filePath) => toPosix(path.relative(repoRoot, filePath)));
for (const changedFile of changedFiles) {
  console.log(changedFile);
}
console.log(`Rewrote ${changedFiles.length} file(s).`);
