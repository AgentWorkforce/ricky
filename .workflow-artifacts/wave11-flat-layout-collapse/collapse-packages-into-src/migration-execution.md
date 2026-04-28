# Collapse packages into src migration execution

## Moves

Moved every path listed in `file-map.tsv` from `packages/*/src/**` into the flat root `src/` tree using `git mv` so file history is preserved. The completed mapping contains 97 source and test files:

- `packages/shared/src/**` -> `src/shared/**`
- `packages/runtime/src/**` -> `src/runtime/**`
- `packages/product/src/**` -> `src/product/**`
- `packages/cloud/src/**` -> `src/cloud/**`
- `packages/local/src/**` -> `src/local/**`
- `packages/cli/src/**` -> `src/surfaces/cli/**`

The CLI shim was also preserved by moving `packages/cli/bin/ricky` to `bin/ricky`, because there was no pre-existing root `bin/ricky` in this worktree and the root manifest now owns the bin entry.

## Import codemod

Added `.workflow-artifacts/wave11-flat-layout-collapse/collapse-packages-into-src/codemod.mjs` as the reproducible import rewrite tool. The codemod walks moved TypeScript files under `src/`, resolves package-style specifiers against the new flat source tree, and rewrites them to relative `.js` specifiers that point at the corresponding `.ts` or `.tsx` source files.

The rewrite covers:

- `@ricky/shared`, `@ricky/runtime`, `@ricky/product`, `@ricky/cloud`, and `@ricky/local` to the new layer `index.ts` files.
- `@ricky/<layer>/<subpath>` to the matching file or directory index under `src/<layer>/`.
- `@agentworkforce/ricky` self-imports from the CLI surface, if present.
- Extensionless relative imports inside moved source files, normalized for the new NodeNext root TypeScript config.

The codemod rewrote 52 moved files. A post-rewrite check found no remaining `@ricky/(shared|runtime|product|cloud|local)` import aliases under `src/`.

## Root package and config

Resolved the CLI start entrypoint from `packages/cli/package.json`:

```text
packages/cli scripts.start: tsx src/commands/cli-main.ts
flat root scripts.start: tsx src/surfaces/cli/commands/cli-main.ts
```

Updated root `package.json` to:

- Set `"name"` to `"@agentworkforce/ricky"`.
- Keep `"private": true`, root `engines`, and root `packageManager`.
- Keep the CLI bin as `"bin": { "ricky": "./bin/ricky" }`.
- Drop `workspaces`.
- Replace scripts with root flat-layout commands.
- Merge runtime dependencies from the package manifests while removing every local `file:../` package dependency.

Updated root `tsconfig.json` to a single strict NodeNext ES2022 project with `include` set to `["src", "test", "workflows", "scripts"]`. Removed the obsolete root `tsconfig.base.json` so the repository has one root TypeScript config surface.

Updated root `vitest.config.ts` to include `src/**/*.test.ts` and `test/**/*.test.ts`.

Ran `npm install` once after the manifest change. `npm install` left stale extraneous workspace records in `package-lock.json`, so those obsolete `packages/{shared,runtime,product,cloud,local,cli}` lockfile entries were pruned from the regenerated lockfile.

## Deletions

Deleted the obsolete package layout:

- Removed the full `packages/` tree after source files and the CLI shim were moved out.
- Removed all per-package `package.json` and `tsconfig.json` files.
- Removed `packages/cli/src/proof/cli-proof-artifact.md` with the deleted package tree.
- Removed `test/package-proof/package-layout-proof.ts`.
- Removed `test/package-proof/package-layout-proof.test.ts`.

## Verification performed

Performed migration-scope checks only; tests were intentionally not run because this step explicitly delegates test execution to the next gate.

- Confirmed all 97 old paths from `file-map.tsv` no longer exist.
- Confirmed all 97 new paths from `file-map.tsv` exist.
- Confirmed `packages/` no longer exists.
- Confirmed `test/package-proof/` no longer exists.
- Confirmed root `package.json` has no `workspaces` field and no local `file:../` dependencies.
- Confirmed `package-lock.json` has no stale `packages/*` workspace entries and no `@ricky/*` local package entries.

## Deviations

- Moved `packages/cli/bin/ricky` to `bin/ricky` even though it was not listed in `file-map.tsv`, because the plan requires the root package to keep `bin.ricky` and deleting `packages/` would otherwise remove the only CLI shim.
- Removed root `tsconfig.base.json` in addition to per-package configs, because the requested result is a single root TypeScript config.
- Pruned stale package workspace entries from `package-lock.json` after the required `npm install`, because npm marked them extraneous but left them in the lockfile.

MIGRATION_EXECUTED
