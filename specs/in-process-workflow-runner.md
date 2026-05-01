# Spec: Drop the `npx --no-install agent-relay run` subprocess for local execution

## Problem

Today's `LocalCoordinator` spawns the workflow via `npx --no-install agent-relay run <file>`. Three real costs:

1. **PATH/binary resolution failures.** Users who installed `@agentworkforce/ricky` globally but don't have `agent-relay` resolvable from the run cwd hit `MISSING_BINARY` blockers. The `--no-install` flag intentionally blocks npx's auto-install fallback, so any case where `agent-relay` isn't in `node_modules/.bin/` of the cwd fails.
2. **Cold-start cost.** `npx` adds ~1–2s of bin-resolution overhead per invocation. The workflow runner inside agent-relay (`runScriptWorkflow`) ultimately spawns `node --experimental-strip-types <file>` (or `tsx` fallback) anyway. We're just paying for the wrapper.
3. **Two sources of truth.** `agent-relay run` is the canonical script runner; `@agent-relay/sdk@6.0.4` exposes the same logic as `runScriptWorkflow` for direct import. Ricky calling the binary instead of the function is incidental, not architectural.

The end-state we want: ricky executes generated workflow files in-process via `node --experimental-strip-types <file>` (or `tsx` fallback), with `@agent-relay/sdk` resolved from the user's repo. No `agent-relay` binary required for the local-run path.

## Behavior we want

`DEFAULT_LOCAL_ROUTE` becomes a Node-based runner:

```ts
export const DEFAULT_LOCAL_ROUTE: ExecutionRoute = {
  command: 'node',
  baseArgs: ['--experimental-strip-types', '--no-warnings=ExperimentalWarning'],
};
```

`LocalCoordinator.launch()` uses the existing `CommandRunner` interface, so the spawn shape is unchanged — only the command + args are different. Generated workflow files import `@agent-relay/sdk/workflows`; Node's strip-types loader handles the TS, the SDK's `workflow().step(...)` runtime executes it.

For pre-22.6 Node, the route falls back to `tsx`. Detection is best-effort: try strip-types, on exit code 9 ("Invalid Argument", what older Node returns for an unknown flag) fall through to tsx. Same fallback ladder `runScriptWorkflow` already uses upstream.

## Required changes

### Code

- `src/local/entrypoint.ts`:
  - `DEFAULT_LOCAL_ROUTE`: swap `npx --no-install agent-relay run` for `node --experimental-strip-types --no-warnings=ExperimentalWarning`.
  - `precheckRuntimeLaunch()`: replace the `--no-install` package check with a `node_modules/@agent-relay/sdk/package.json` existence check (the workflow imports the SDK; we precheck that it resolves before spawning).
  - `commandString()`: keep current behavior (derives from route). Output naturally updates.
  - `runtime: ${cmd}` log output: also updates naturally.
  - User-facing `run_command` literals at lines 816 and 862 (`\`npx --no-install agent-relay run ${path}\``): **keep** — these document the alternative manual command for users who have agent-relay installed; the actual spawn no longer requires it.
- `src/runtime/local-coordinator.ts`: no change. The `CommandRunner` abstraction holds.

### Tests (~14 updates)

| File | Assertions to update |
|---|---|
| `src/local/entrypoint.test.ts` | `'uses DEFAULT_LOCAL_ROUTE with npx ...'` test (rename + update expected command/args). `'exports DEFAULT_LOCAL_ROUTE with deterministic shape'` (new shape). `runner.invocations[0].args.slice(0, 3)` → `slice(0, baseArgs.length)`. Several `command:` / `commands_invoked:` assertions referring to `npx --no-install agent-relay run <path>` → `node --experimental-strip-types --no-warnings=ExperimentalWarning <path>`. The MISSING_BINARY blocker test for `missing-environment.workflow.ts` needs new recovery-step expectations. The "logs include stage mode: run" assertion needs reordering review (some tests use `arrayContaining` that breaks with extra log lines). |
| `src/local/proof/local-entrypoint-proof.ts` | The `runtime-coordination-launch` proof case if it asserts the old route shape. |
| `src/surfaces/cli/cli/onboarding.ts` and `.test.ts` | Anywhere the user-facing onboarding text references `npx --no-install agent-relay run` — keep as is (still a valid manual command). |
| `src/surfaces/cli/cli/proof/external-cli-proof.test.ts` and `.ts` | The fixture spawn fixture installs a stub `agent-relay` binary in `node_modules/.bin/`. With the new route, the fixture should install nothing (node is already on PATH) but **must still install `@agent-relay/sdk` package.json fixture** so the precheck passes. |

### Dep + lockfile

- `package.json`: bump `@agent-relay/sdk` from `^5.0.0` to `^6.0.4` (the latest registry version that ships `runScriptWorkflow`-compatible workflow runtime). The bump is *minor for our purposes* because we're keeping the existing import shape (`@agent-relay/sdk/workflows`) — the change is the runtime behavior the SDK provides.

### Documentation

- `README.md`: if it documents how local execution works, update to reflect the new in-process spawn.

## Out of scope

- Importing `runScriptWorkflow` directly from `@agent-relay/sdk/workflows`. The SDK's runner inherits stdio, which doesn't fit the line-streaming `CommandRunner` interface ricky already has. Spawning Node directly with the same args runScriptWorkflow uses is functionally equivalent and preserves the existing log-capture machinery.
- Moving cloud execution off `runWorkflow()`. This spec is local-only; cloud already calls into `@agent-relay/cloud` programmatically.
- Restoring the workspace-package layout. Recent collapse-into-src work made the tree flat; this spec assumes that flat layout.
- Supporting `.py` workflow files. Ricky generates `.ts` only; if `.py` lands in scope later, mirror the SDK's python-runner ladder.

## Test plan

1. `npm test` — full suite green. The 14 test updates above are the expected churn.
2. `node --experimental-strip-types -e "1"` — sanity-check the local Node version.
3. End-to-end on a real generated workflow:
   ```
   node dist/ricky.js --mode local --spec-file specs/cli-version-from-package-json.md --run
   ```
   The artifact should generate AND execute without `agent-relay` on PATH; the spawn line in the runtime evidence should read `node --experimental-strip-types --no-warnings=ExperimentalWarning workflows/generated/<file>.ts`.

## Acceptance

- A user with `@agentworkforce/ricky` (and `@agent-relay/sdk` as a transitive dep) installed can run `ricky --mode local --spec-file <spec> --run` end-to-end without ever invoking `npx --no-install agent-relay`. Trace: precheck verifies `node_modules/@agent-relay/sdk/package.json` exists → `LocalCoordinator` spawns `node --experimental-strip-types <file>` → workflow executes → evidence records the actual spawn line.
- `MISSING_BINARY` blockers still fire for the right reasons (Node not on PATH, SDK not installed) but no longer for "agent-relay not on PATH".
- The user-facing `run_command` field in the response still says `npx --no-install agent-relay run <file>` as a valid alternative reproduction command.
- All 645 existing tests pass; the 14 updated tests cover the new route shape end-to-end.
