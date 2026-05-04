# Spec: `ricky --version` reflects the installed package version

## Problem

`ricky --version` (or `-v`, or `version`) should print the version of the installed `@agentworkforce/ricky` package. This spec records the desired behavior and the acceptance contract for keeping the package version path truthful.

```
$ ricky --version
ricky 0.1.13
```

The default lives in `src/surfaces/cli/commands/cli-main.ts`:

```ts
if (parsed.command === 'version') {
  const version = deps.version ?? '0.0.0';
  return { exitCode: 0, output: [`ricky ${version}`] };
}
```

`CliMainDeps.version` exists for test injection, but the bin entry (`src/surfaces/cli/bin/ricky.ts`) calls `cliMain()` with no deps. In production, the CLI must resolve `package.json` instead of relying on the fallback.

## Why it matters

- Users filing issues report the wrong version, slowing diagnosis.
- After publishing 0.1.0 → 0.1.1 → … the CLI keeps lying.
- The published bin is the one users see; tests don't catch this because they inject a fake version.

## Behavior we want

`ricky --version` (and `-v`, `version`) prints `ricky <version>` where `<version>` is the `version` field of the package.json shipped with the installed package.

```
$ ricky --version
ricky 0.1.0
```

It must work in three contexts:

1. **Installed from npm** — bin runs from `<prefix>/lib/node_modules/@agentworkforce/ricky/dist/ricky.js`; `package.json` sits at `<that pkg root>/package.json`.
2. **Local dev via `npm start`** — runs from source via tsx; `package.json` is at the repo root.
3. **Tests** — `cliMain({ version: '9.9.9' })` still wins (the injectable `deps.version` override stays the highest-priority source).

## Resolution order

1. `deps.version` if provided (test seam — unchanged)
2. The `version` field from the package.json that ships with the installed package
3. Fallback: `'0.0.0'` (only reached if the file cannot be read or parsed)

## Implementation notes

- The cli-main module already has `import.meta.url`; use it to locate the package root: walk up from `dirname(fileURLToPath(import.meta.url))` until a `package.json` with `"name": "@agentworkforce/ricky"` is found, then read `version`. Stop at the filesystem root.
- Read synchronously is fine here — version lookup happens once per invocation and only on the version path.
- Cache the result at module scope so repeated calls don't hit the filesystem.
- Do not require a build step (e.g. don't bake the version in via codegen) — keeping the lookup runtime keeps `npm version` bumps + `prepack` flow simple.
- The bundled CLI is produced by `scripts/bundle-cli.mjs`; no separate `tsconfig.build.json` is required for this path.

## Test cases

Add to `src/surfaces/cli/commands/cli-main.test.ts`:

1. `cliMain({ argv: ['--version'], version: '9.9.9' })` → output `ricky 9.9.9` (existing override seam still works).
2. With no `version` injected, `cliMain({ argv: ['--version'] })` returns `ricky <X>` where `<X>` matches the `version` from the repo's own `package.json`. Read it in the test via `readFileSync` so the assertion stays in sync with future bumps.
3. When package.json lookup fails (mock the reader to throw), output falls back to `ricky 0.0.0` and exit code stays `0` — version display should never break the CLI.

## Out of scope

- Adding a `--verbose` / build-info flag (commit SHA, build date). Track separately if wanted.
- Aligning `npm start --version` output formatting with the bin output (already identical — `cliMain` is shared).
- Reflecting `@agent-relay/sdk` or other dep versions in the output.

## Acceptance

- `node dist/ricky.js --version` prints the version from `package.json`.
- All existing cli-main tests pass; the three new tests above pass.
- `package.json` version bumps automatically flow through to the CLI without any code edit.
