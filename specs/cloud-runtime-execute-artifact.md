# Spec: Wire `ricky run <artifact> --cloud` to the real Cloud runtime

## Problem

`ricky run <artifact> --cloud` parses correctly (PR #60 added the shorthand) and the CLI builds a structured `intent: 'execute'` Cloud request with the workflow path. But the request never leaves the CLI process: `runInteractiveCli` invokes `handleCloudGenerate(request, { executor: deps.cloudExecutor })`, and the default `cloudExecutor` is a stub at `src/cloud/api/generate-endpoint.ts:61` that returns:

```
Warning: Cloud generate stub: received spec (115 chars) for workspace <id>.
Assumption: runtime-not-wired — The Cloud generation runtime is not wired yet, so no workflow artifacts were produced.
Follow-up: wire-runtime — Connect the real Cloud generation runtime to replace this stub.
```

The Cloud-side endpoint that should be called already exists in `AgentWorkforce/cloud`:
- `POST /api/v1/ricky/runs` — start a Ricky run from a workflow artifact, body type `CreateRickyRunRequest`
- `GET  /api/v1/ricky/runs/[rickyRunId]` — run status
- `GET  /api/v1/ricky/runs/[rickyRunId]/events` — SSE/event stream
- `POST /api/v1/ricky/runs/[rickyRunId]/cancel` — cancel
- `POST /api/v1/ricky/runs/[rickyRunId]/gates/[gateId]/resolve` — gate resolution

This spec wires the CLI's "execute artifact in Cloud" path through to those endpoints.

End state: a user runs `ricky run workflows/foo.ts --cloud` and gets back a Cloud run id, a status URL, and (when stdout is a TTY) a streamed event tail until the run reaches a terminal state.

## Architecture: where things live

Same split as Linear and the future Slack surface:

- **Cloud (`AgentWorkforce/cloud`)** — already implemented in PR #412 base. Owns `rickyRunSupervisor`, the run store, agent availability snapshot, repair router, evidence builder, gate resolution, SSE events. Nothing in this spec adds endpoints; it consumes the existing ones.
- **Ricky OSS (`AgentWorkforce/ricky`, this repo)** — adds an HTTP-based `CloudExecutor` that translates a `CloudGenerateRequest` (`intent: 'execute'`, `workflowPath`, `workforce-persona` opt-ins, `autoFix` policy) into a `CreateRickyRunRequest` and POSTs it. Also adds the polling/streaming surface so the CLI can show progress.

The stub `defaultCloudExecutor` stays as the test seam and as the fallback when no Cloud auth is reachable — the new HTTP executor is what gets wired by default when auth is present.

## Behavior we want

### Happy path

1. User runs `ricky run workflows/release.ts --cloud` from a repo where they're authenticated to Cloud.
2. CLI parses → `{ command:'run', mode:'cloud', artifact, runRequested:true }`.
3. CLI reads the artifact file (`fs.readFile`) and computes its `fileType` (matches the Cloud-side `WorkflowFileType` enum: `ts`, `mjs`, `cjs`, `js`).
4. CLI builds a `CreateRickyRunRequest`:
   ```ts
   {
     workflow: <file source>,           // string contents of the artifact
     fileType: 'ts',
     sourceFileType: 'ts',              // currently same as fileType
     workflowPath: 'workflows/release.ts',
     autoFix: { ...policyFromCli },     // existing cloudRickyAutoFixPolicyFor()
     notification: { surface: 'none' }, // CLI does not subscribe via webhook/Slack
   }
   ```
5. POSTs to `${cloudBase}/api/v1/ricky/runs` with `Authorization: Bearer <token>` and `Content-Type: application/json`. `cloudBase` resolves from (in order): `RICKY_CLOUD_BASE_URL` env var, `AGENTWORKFORCE_CLOUD_BASE_URL` env var, the `cloudBaseUrl` field on the stored Cloud auth record, and finally the published default `https://cloud.agentworkforce.com`.
6. Cloud responds `201 Created` with `{ rickyRunId, status: 'queued' }` (per `CreateRickyRunResponse` shape — verify against `../cloud/packages/web/lib/ricky/types.ts`).
7. CLI prints the run id, the status URL, and (when `process.stdout.isTTY`) tails `GET /api/v1/ricky/runs/:id/events` until status reaches `succeeded`, `failed`, or `cancelled`.
8. CLI exit code mirrors the terminal status (0 for `succeeded`, 1 for the rest).

### Auth missing

The existing `CloudPowerUserSetupError` flow already handles "no token / no workspace" before the executor runs. The new HTTP executor must NOT silently fall back to the stub when a token exists but the request is rejected — surface the HTTP error verbatim.

### File too large / binary artifact

Cloud's `CreateRickyRunRequest` accepts an alternative `s3CodeKey` instead of inline `workflow`. Out of scope for this spec — if the artifact is over a threshold (say 256 KiB), error with a clear "artifact exceeds inline upload size; s3 upload not yet wired" message and link to the follow-up.

### Cancellation

`Ctrl-C` while tailing should POST `/runs/:id/cancel` with the current run id and exit non-zero. Reuses the existing CLI signal handling in `runInteractiveCli`.

### Run id resume

`ricky status --run <id>` (already implemented) must work for runs created by this path. Verify the new HTTP executor returns a run id in the same shape that `runStatus` consumes.

## Surface contracts (Ricky OSS)

### New: `src/cloud/api/http-cloud-executor.ts`

Implements `CloudExecutor`. Key surface:

```ts
export interface HttpCloudExecutorOptions {
  /** Override base URL for tests / staging. */
  baseUrl?: string;
  /** Injectable fetch for tests. Defaults to globalThis.fetch. */
  fetch?: typeof fetch;
  /** Resolve absolute artifact path → file contents + fileType. */
  readArtifact?: (path: string) => Promise<{ contents: string; fileType: WorkflowFileType }>;
  /** Optional event-stream consumer for live tailing. */
  onEvent?: (event: RickyRunEvent) => void;
  /** Maximum inline artifact size before erroring. */
  maxInlineBytes?: number;
}

export function createHttpCloudExecutor(options?: HttpCloudExecutorOptions): CloudExecutor;
```

The executor only handles requests where `request.body.spec.kind === 'structured'` and `request.body.spec.document.intent === 'execute'`. For any other shape (i.e. spec-text → generate path), it returns the same `runtime-not-wired` warning the stub returns today. That keeps this PR scoped to the run-artifact path.

### Updated: `src/surfaces/cli/commands/cli-main.ts`

Currently, `runInteractiveCli` falls through to `defaultCloudExecutor` when `deps.cloudExecutor` is undefined. After this PR, the CLI default for power-user invocations becomes the HTTP executor (built from the resolved auth token + base URL). Tests inject the stub or a fake executor as before.

The wiring point is the `interactiveDeps` builder around `cli-main.ts:1669`:

```ts
const interactiveDeps: InteractiveCliDeps = {
  ...deps,
  cwd: resolveInvocationRoot(deps.cwd),
  cloudExecutor: deps.cloudExecutor ?? createHttpCloudExecutor({ baseUrl: cloudBaseUrl }),
  ...
};
```

### Updated: response shape mapping

The Cloud `runs` endpoint returns `{ rickyRunId, status }`. `CloudGenerateResult` expects `{ artifacts, warnings, runReceipt, ... }`. The HTTP executor maps:
- `rickyRunId` → `runReceipt.runId`
- `status: 'queued' | 'running' | 'succeeded' | ...` → `runReceipt.status`
- The artifact source we sent → `artifacts: [{ kind: 'workflow', path, contents }]` so the existing renderer can show "Artifact: <path>".

### New: `src/cloud/api/ricky-run-types.ts`

Mirror the relevant Cloud-side types for type safety in the CLI without depending on `../cloud` workspace. Document the source of truth comment pointing at `../cloud/packages/web/lib/ricky/types.ts`. Keep it minimal — `CreateRickyRunRequest`, `CreateRickyRunResponse`, `RickyRunStatus`, `RickyRunEvent`. When Cloud changes these, this file is the single place to update.

## CLI additions (Ricky OSS)

No new flags. The existing `--cloud` shorthand and existing `--no-run` / `--background` flags are already wired through `parsed.mode === 'cloud'`.

Two render changes on the `ricky` summary path:

- When the run id is returned, render `Run id: <rickyRunId>` and `Status: ${status}` as their own lines (the existing renderer prints `Workflow id` only for the generate path).
- When tailing, render each event as a single line in the existing `[workflow HH:MM]` format, matching local-run output. On terminal states, append a final summary line and the explicit follow-up command (`ricky status --run <id>`).

## Telemetry

Reuse the existing CLI metadata (`cliMetadataFor`) — no new fields. The Cloud server already records `cli.handoff` etc.

## Out of scope

- **Spec-text → Cloud generate path.** Today `ricky --mode cloud --spec "..."` also routes to the stub. Wiring that requires a Cloud-side generate endpoint, which doesn't exist yet. Tracking issue lives in the `wire-runtime` follow-up the stub already prints; this spec does not address it.
- **Inline `s3CodeKey` upload for large artifacts.** Surface the limit error and defer.
- **Linear / Slack ingress launching runs.** Those surfaces have their own webhook flows in Cloud and don't go through the CLI.
- **Auto-fix loop on the Cloud side.** The `autoFix` policy is already part of the request body — the supervisor on the Cloud side honors it. This spec only forwards the policy.
- **Cancellation UX beyond the simple `Ctrl-C → POST /cancel` path.** No interactive "are you sure" prompt.

## Test plan

- Unit: `src/cloud/api/http-cloud-executor.test.ts` — fake `fetch` covering:
  - Happy 201 with run id; result maps to `runReceipt.runId` and `runReceipt.status`.
  - 401 / 403 → bounded error, no fallback.
  - 5xx → bounded error with retry hint.
  - Non-execute intents pass through to the stub fallback.
  - Artifact path read failure → bounded error.
- Integration (`src/cloud/api/proof/cloud-execute-proof.test.ts` mirroring `cloud-generate-proof.test.ts`): full CLI flow `ricky run <artifact> --cloud` against a fake Cloud server (e.g. `msw` or a mock fetch) — asserts request shape (matches `CreateRickyRunRequest` JSON schema), response handling, render output.
- E2E (manual, gated): a smoke test against staging Cloud — out of scope for the automated suite but enumerated here so the implementor remembers to capture proof in the PR description.

## Acceptance gates

The implementation workflow generated from this spec MUST satisfy:

- `npm run typecheck` clean.
- `npm test` clean (sans pre-existing flakes documented in the PR).
- A real CLI invocation `ricky run workflows/<existing-artifact>.ts --cloud --json` returns a JSON object with a non-empty `runReceipt.runId` field when run with valid Cloud auth, and an actionable error when run without.
- The probe used in PR #61 (`.workflow-artifacts/clarifications-proof/`-style harness) is extended with a `cloud-execute` directory containing the request shape captured against the fake server.
- `defaultCloudExecutor` stays in place for tests but the production path no longer uses it for `intent: 'execute'`.

## Open questions for the implementor

1. **Inline artifact size threshold.** The Cloud-side endpoint hasn't published a hard limit. Pick `256 KiB` for now and document; raise a follow-up to align with whatever the supervisor enforces.
2. **`cloudBaseUrl` resolution order.** Confirm that the stored Cloud auth record (`StoredAuth`) in this repo has a `cloudBaseUrl` field. If not, drop step 3 of the resolution chain in §Behavior and rely on env vars + the published default.
3. **`fileType` detection.** The current artifact paths are `.ts`. Keep it permissive — accept `ts | mjs | cjs | js` and reject otherwise. Confirm the Cloud `WorkflowFileType` enum matches.
4. **Run-id printing format.** Match the existing local-run printing convention exactly (look at `cli-main.ts:1858+` rendering for local runs and mirror it).
5. **SSE vs polling for events.** The Cloud endpoint exposes an event stream; the CLI's existing local-run tailing uses polling. Pick SSE if the runtime supports `EventSource`-style streaming over fetch in Node 22 (which it does); otherwise fall back to a 1-second poll on `GET /runs/:id`.

## Related

- PR #60 — adds the `ricky run <artifact> --cloud` shorthand parser.
- `specs/linear-integration.md` — same architectural split (Cloud owns the runtime; Ricky OSS owns the CLI/contracts).
- The stub at `src/cloud/api/generate-endpoint.ts:61` will be untouched by this PR; only the *production wiring* changes so the stub is no longer the default path for `intent: 'execute'`.
