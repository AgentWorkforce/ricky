import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const fileMapPath = path.join(
  root,
  '.workflow-artifacts/wave11-flat-layout-collapse/collapse-packages-into-src/file-map.tsv',
);

const sourceFiles = readFileSync(fileMapPath, 'utf8')
  .trim()
  .split('\n')
  .map((line) => line.split('\t')[1])
  .filter(Boolean);

const layers = new Set(['shared', 'runtime', 'product', 'cloud', 'local']);

function toImportSpecifier(fromFile, targetFile) {
  const fromDir = path.dirname(path.join(root, fromFile));
  let specifier = path.relative(fromDir, path.join(root, targetFile)).replaceAll(path.sep, '/');
  specifier = specifier.replace(/\.(ts|tsx)$/, '.js');
  if (!specifier.startsWith('.')) {
    specifier = `./${specifier}`;
  }
  return specifier;
}

function resolveRickySpecifier(specifier) {
  const [, layer, subpath] = specifier.match(/^@ricky\/([^/]+)(?:\/(.+))?$/) ?? [];
  if (!layer || !layers.has(layer)) {
    return null;
  }

  if (!subpath) {
    return `src/${layer}/index.ts`;
  }

  return `src/${layer}/${subpath}.ts`;
}

function resolveSelfSpecifier(specifier) {
  if (specifier === '@agentworkforce/ricky') {
    return 'src/surfaces/cli/index.ts';
  }

  const [, subpath] = specifier.match(/^@agentworkforce\/ricky\/(.+)$/) ?? [];
  if (!subpath) {
    return null;
  }

  const exportTargets = new Map([
    ['cli', 'src/surfaces/cli/cli/index.ts'],
    ['commands', 'src/surfaces/cli/commands/index.ts'],
    ['entrypoint', 'src/surfaces/cli/entrypoint/index.ts'],
  ]);

  return exportTargets.get(subpath) ?? `src/surfaces/cli/${subpath}.ts`;
}

function resolveSpecifier(specifier) {
  if (specifier.startsWith('@ricky/')) {
    return resolveRickySpecifier(specifier);
  }

  if (specifier.startsWith('@agentworkforce/ricky')) {
    return resolveSelfSpecifier(specifier);
  }

  return null;
}

const importPattern =
  /(\bfrom\s*["']|\bimport\s*\(\s*["']|\brequire\s*\(\s*["'])(@ricky\/[^"']+|@agentworkforce\/ricky(?:\/[^"']+)?)(["'])/g;

let rewrittenFiles = 0;
let rewrittenSpecifiers = 0;

for (const sourceFile of sourceFiles) {
  const absolutePath = path.join(root, sourceFile);
  const before = readFileSync(absolutePath, 'utf8');
  let changed = false;

  const after = before.replace(importPattern, (match, prefix, specifier, suffix) => {
    const target = resolveSpecifier(specifier);
    if (!target) {
      return match;
    }

    changed = true;
    rewrittenSpecifiers += 1;
    return `${prefix}${toImportSpecifier(sourceFile, target)}${suffix}`;
  });

  if (changed) {
    writeFileSync(absolutePath, after);
    rewrittenFiles += 1;
  }
}

console.log(`Rewrote ${rewrittenSpecifiers} import specifiers in ${rewrittenFiles} files.`);
