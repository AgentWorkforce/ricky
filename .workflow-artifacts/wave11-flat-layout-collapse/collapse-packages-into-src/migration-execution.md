# Collapse packages into src migration execution

## Moves

Moved every path listed in `file-map.tsv` from `packages/*/src/**` into the flat root `src/` tree using `git mv` so file history is preserved. The completed mapping contains 108 source and test files:

- `packages/shared/src/**` -> `src/shared/**`
- `packages/runtime/src/**` -> `src/runtime/**`
- `packages/product/src/**` -> `src/product/**`
- `packages/cloud/src/**` -> `src/cloud/**`
- `packages/local/src/**` -> `src/local/**`
- `packages/cli/src/**` -> `src/surfaces/cli/**`

No `git mv` fallback was needed for mapped files.

## Import codemod

Added `.workflow-artifacts/wave11-flat-layout-collapse/collapse-packages-into-src/codemod.mjs` as the reproducible import rewrite tool. The codemod reads `file-map.tsv`, walks the moved target files, resolves package-style specifiers against the new flat source tree, and rewrites them to relative `.js` specifiers that point at the corresponding TypeScript source files under NodeNext.

The rewrite covers:

- `@ricky/shared`, `@ricky/runtime`, `@ricky/product`, `@ricky/cloud`, and `@ricky/local` to the new layer `index.ts` files.
- `@ricky/<layer>/<subpath>` to the matching file under `src/<layer>/`.
- `@agentworkforce/ricky` self-imports from the CLI surface, if present.

The codemod rewrote 76 import specifiers in 33 moved files. A post-rewrite check found no remaining `@ricky/*` or `@agentworkforce/ricky` import specifiers under `src/`.

## Root package and config

Resolved the CLI start entrypoint from `packages/cli/package.json`:

```text
packages/cli scripts.start: tsx --conditions=development src/commands/cli-main.ts
flat root scripts.start: tsx src/surfaces/cli/commands/cli-main.ts
```

Updated root `package.json` to:

- Set `"name"` to `"@agentworkforce/ricky"`.
- Keep `"private": true`, root `engines`, and root `packageManager`.
- Set `"bin": { "ricky": "./bin/ricky" }`.
- Drop `workspaces`.
- Replace scripts with the required flat-layout commands.
- Merge external dependencies from the package manifests while removing internal `@ricky/*` workspace dependencies and any `file:../` references.

Created `bin/ricky` because no tracked root shim existed. The shim resolves to `src/surfaces/cli/bin/ricky.ts`, which delegates to the migrated CLI command entrypoint.

Updated root `tsconfig.json` to a single strict NodeNext ES2022 project with `include` set to `["src", "test", "workflows", "scripts"]`. Removed obsolete root `tsconfig.base.json`, root `tsconfig.build.json`, and every per-package TypeScript config.

Updated root `vitest.config.ts` to include `src/**/*.test.ts` and `test/**/*.test.ts`.

Ran `npm install` once after the manifest change. `npm install` left stale extraneous workspace package records in `package-lock.json`, so those obsolete `packages/{shared,runtime,product,cloud,local,cli}` lockfile entries were pruned from the regenerated lockfile.

## Deletions

Deleted the obsolete package layout:

- Removed the full `packages/` tree after mapped files were moved out.
- Removed all per-package `package.json`, `tsconfig.json`, and `tsconfig.build.json` files.
- Removed `test/workspace-layout-proof/`, the tracked legacy workspace-layout proof in this checkout.
- Confirmed `test/package-proof/` does not exist.

## Verification performed

Performed migration-scope checks only; tests were intentionally not run because this step explicitly delegates test execution to the next gate.

- Confirmed all 108 old paths from `file-map.tsv` no longer exist.
- Confirmed all 108 new paths from `file-map.tsv` exist.
- Confirmed no moved source import uses `@ricky/*` or `@agentworkforce/ricky`.
- Confirmed `packages/`, `test/package-proof/`, and `test/workspace-layout-proof/` no longer contain files.
- Confirmed root `package.json` has no `workspaces` field and no `file:../` dependencies.
- Confirmed `package-lock.json` has no stale `packages/*` workspace entries and no `node_modules/@ricky/*` entries.

## Deviations

- Created a new root `bin/ricky` shim instead of moving `packages/cli/bin/ricky`, because this worktree had no tracked `packages/cli/bin/ricky`; the mapped CLI bin source was `packages/cli/src/bin/ricky.ts`.
- Removed `test/workspace-layout-proof/` as the obsolete proof replacement for the plan's `test/package-proof/` name. The wave workflow identifies the workspace-layout evaluator as the current package-layout proof shape, and `test/flat-layout-proof/` is the replacement.
- Removed root `tsconfig.base.json` and `tsconfig.build.json` in addition to per-package configs, because the requested result is a single root TypeScript config.
- Pruned stale package workspace entries from `package-lock.json` after the required `npm install`, because npm marked them extraneous but left them in the lockfile.

MIGRATION_EXECUTED
