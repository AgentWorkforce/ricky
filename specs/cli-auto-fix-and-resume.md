# Spec: `ricky run --auto-fix` — diagnose, repair, and resume on failure

## Problem

Currently `ricky run --artifact <path>` coordinates the workflow through the Agent Relay SDK runtime and reports back. On failure, the user gets a classified blocker (MISSING_BINARY, INVALID_ARTIFACT, etc.) and a list of recovery steps — but they should not have to diagnose the workflow artifact, patch it, then re-invoke the run with `--start-from <step> --previous-run-id <runId>` themselves.

That's the part Ricky should automate. The pieces already exist, but nothing wires them into a closed loop:

- `runtime/failure/classifier.ts` classifies failures by category.
- `product/specialists/debugger/debugger.ts` exposes `debugWorkflowRun(evidence)` returning a diagnosis + fix recommendation + a `repairMode` of `'direct' | 'guided' | 'manual'`.
- `LocalCoordinator` already accepts `retry: { previousRunId, retryOfRunId, attempt, reason }` and threads `--start-from` / `--previous-run-id` into the spawn args.
- `agent-relay run` writes a run-id file (`AGENT_RELAY_RUN_ID_FILE` env) and supports `--start-from <step> --previous-run-id <id>`.

What's missing is the orchestrator that ties them.

## Behavior we want

Auto-fix is on by default whenever Ricky actually runs a local workflow, whether the run is foreground or background. Users can still disable it explicitly with `--no-auto-fix`; `--auto-fix=N` controls the bounded retry budget.

Default-on is intentional. `--no-auto-fix` is the opt-out. Do not change this default without updating this spec and the parser/help/tests that enforce it.

```
ricky run --artifact workflows/generated/foo.ts --auto-fix
ricky run --artifact workflows/generated/foo.ts --auto-fix=5     # max 5 attempts
ricky --mode local --spec-file my.md --run --auto-fix             # composes with --run
```

Default attempts: **7**. `--auto-fix` with no value → 7. `--auto-fix=N` → N attempts (1–10 clamped). Generation-only flows do not enter auto-fix because no workflow has run yet.

Loop semantics on each iteration:

1. Run the workflow (first attempt: from the start; subsequent attempts: with `--start-from <failed-step> --previous-run-id <prev-run-id>`).
2. On success → print summary, exit 0.
3. On failure → call `classifyFailure(evidence)` then `debugWorkflowRun({ evidence, classification })` to get `repairMode` + a recommendation.
4. Resolve the failed workflow artifact, then ask the Workforce workflow persona to diagnose the evidence and return a full repaired workflow artifact.
5. Write the repaired artifact back to the same workflow path, then loop with `--start-from <failed-step> --previous-run-id <prev-run-id>` metadata. The foreground response and background monitor keep one Ricky tracking run id so the user can follow progress without caring that a repair/resume happened underneath.
6. If the persona repair cannot produce a safe repaired artifact, print the diagnosis + recommendation and exit non-zero.
7. After the configured max attempts → print all attempt summaries, the final blocker, and exit 2.

The loop is default-on for run flows. `--no-auto-fix` preserves one-attempt behavior for users who want to inspect failures manually.

## Auto-applicable fixes

The primary repair path is workflow-artifact repair by the Workforce workflow persona. The persona receives the artifact content, failed step, previous run id, classified blocker, debugger diagnosis, and run evidence. It must return the complete repaired TypeScript artifact and metadata; Ricky writes only that workflow artifact and resumes.

A small direct fallback remains only when Ricky cannot resolve a workflow artifact to patch. That fallback is intentionally narrow:

| Failure class      | Auto-applied fix                                        | Verification                                          |
|--------------------|---------------------------------------------------------|-------------------------------------------------------|
| `MISSING_BINARY`   | Run the `steps` from the blocker (`npm install`, etc.) | Re-check `node_modules/.bin/<pkg>` or `command -v`    |
| `NETWORK_TRANSIENT`| No edit — straight retry with backoff                  | (none — retry is the verification)                    |

Everything with a resolvable workflow artifact goes through the Workforce workflow persona first, including failures that the debugger classifies as guided/manual. Ricky does not silently edit arbitrary repository files during auto-fix; the intended mutable surface is the underlying workflow artifact.

## Failed-step + previous-run-id resolution

`agent-relay run --start-from X --previous-run-id Y` skips predecessors of step `X` and reuses cached outputs from run `Y`. To call it, Ricky needs both values from the *previous* attempt:

- **Failed step**: extracted from `evidence.steps[]` — the first step with `status: 'failed'`. If no step granularity is reported (e.g. process crashed before any step started), `--start-from` is omitted and we just retry the whole run with `--previous-run-id`.
- **Previous run id**: read from the run-id file the prior `agent-relay run` wrote (`AGENT_RELAY_RUN_ID_FILE`), or parsed from the `Run ID:` line agent-relay prints to stderr on failure. The runtime already passes the env var; Ricky just needs to read the file (or parse stderr) when it fires.

If neither source yields a run id, retry without `--previous-run-id` (full re-run) and warn that step-level resume wasn't possible.

## CLI surface changes

- Flag in `parseArgs` (`src/surfaces/cli/commands/cli-main.ts`): `--auto-fix[=N]` / `--no-auto-fix`. Parses to `parsed.autoFix?: number` where the default for run flows is 3 and `undefined` means disabled.
- Threaded through the CLI handoff into `LocalInvocationRequest` (extend the type with an `autoFix?: { maxAttempts: number }` field — coexists with the existing `stageMode`).
- New top-level orchestrator function in `src/local/auto-fix-loop.ts` (or co-located in `entrypoint.ts` if small enough):
  ```ts
  async function runWithAutoFix(
    request: LocalInvocationRequest,
    options: { maxAttempts: number; ... },
  ): Promise<LocalResponse>
  ```
  This wraps the existing single-attempt path. When the response is a failure with a repairable workflow artifact, it calls the Workforce workflow persona, writes the repaired artifact, captures the run-id, and re-invokes with `retry` metadata populated.

The existing single-attempt path stays available when `autoFix` is unset, primarily through `--no-auto-fix` or non-run flows.

## Output shape

For each attempt, the loop emits a labeled section:

```
attempt 1/7:
  status: blocker (MISSING_BINARY)
  applied fix: npm install
  fix outcome: ok
attempt 2/7:
  status: ok
  duration: 14.2s
```

The final exit message summarizes: `Auto-fix: ok after 2/7 attempt(s).` or `Auto-fix: blocker after 7/7 attempt(s). Final blocker: ...`.

When `--json` is set, the response includes:
```json
{
  "auto_fix": {
    "max_attempts": 7,
    "attempts": [
      { "attempt": 1, "status": "blocker", "blocker_code": "MISSING_BINARY", "applied_fix": { "mode": "workforce-persona", "artifact_path": "workflows/generated/foo.ts" } },
      { "attempt": 2, "status": "ok", "run_id": "..." }
    ],
    "final_status": "ok",
    "run_id": "ricky-local-...",
    "resumed": true
  }
}
```

## Test cases

Unit tests in `src/local/auto-fix-loop.test.ts`:

1. **Single-attempt success bypasses the loop** — first run returns `ok`, no debugger call, no retry args.
2. **Persona repair retries with start-from + previous-run-id** — first attempt blocks, the Workforce workflow persona returns a repaired artifact, Ricky writes it, and the second attempt is invoked with `retry.previousRunId` and the failed step.
3. **Repair failure escalates** — persona repair cannot produce a safe artifact. Loop stops, exit non-zero, user gets the diagnosis and recovery steps.
4. **Guided repairMode still repairs** — debugger says guided, but a workflow artifact exists, so Ricky asks the persona to patch and retries.
5. **Max attempts exhaustion** — seven blockers in a row, all with directly-repairable fixes that don't actually help. Loop stops at attempt 7 with all attempt summaries.
6. **Run id missing from prior attempt** — second attempt invoked without `--previous-run-id` and a warning logged.
7. **`--auto-fix=0` is treated as `--no-auto-fix`** (or rejected with a parse error — pick one and document).
8. **`--auto-fix` composes with `--run` after `--spec-file`** — generate, then enter the loop on the first run.

End-to-end (manual, not automated): generate a workflow that fails on first run, run it normally, observe Ricky call the Workforce workflow persona, patch the workflow artifact, and resume from the failed step under the same Ricky tracking run id.

## Out of scope

- Arbitrary repository code edits as auto-fixes. The workflow artifact is the mutable repair surface.
- Persistent state across CLI invocations. The loop is per-invocation.
- Concurrent retry of independent steps. Sequential only.
- Cloud execution. This is local/BYOH only; cloud has its own retry semantics via `agent-relay cloud run`.

## Acceptance

- `ricky run --artifact <path> --auto-fix` succeeds on a workflow that fails the first attempt with a `MISSING_BINARY` blocker and is fixable by `npm install`.
- Same command with `--auto-fix=1` runs once, blocker reported, no retry.
- Same command with `--no-auto-fix` preserves the single-attempt behavior for users who want failures surfaced immediately.
- All existing `runLocal` tests still pass — the loop is a wrapper, not a replacement.
- `ricky --help` documents the flag.
