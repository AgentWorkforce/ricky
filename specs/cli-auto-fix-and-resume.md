# Spec: `ricky run --auto-fix` — diagnose, repair, and resume on failure

## Problem

Today `ricky run --artifact <path>` shells out to `agent-relay run <path>` and reports back. On failure, the user gets a classified blocker (MISSING_BINARY, INVALID_ARTIFACT, etc.) and a list of recovery steps — but they have to run those recovery steps by hand, then re-invoke `agent-relay run --start-from <step> --previous-run-id <runId>` themselves.

That's the part Ricky should automate. The pieces already exist, but nothing wires them into a closed loop:

- `runtime/failure/classifier.ts` classifies failures by category.
- `product/specialists/debugger/debugger.ts` exposes `debugWorkflowRun(evidence)` returning a diagnosis + fix recommendation + a `repairMode` of `'direct' | 'guided' | 'manual'`.
- `LocalCoordinator` already accepts `retry: { previousRunId, retryOfRunId, attempt, reason }` and threads `--start-from` / `--previous-run-id` into the spawn args.
- `agent-relay run` writes a run-id file (`AGENT_RELAY_RUN_ID_FILE` env) and supports `--start-from <step> --previous-run-id <id>`.

What's missing is the orchestrator that ties them.

## Behavior we want

A new opt-in flag: `--auto-fix` (alias `--repair`).

```
ricky run --artifact workflows/generated/foo.ts --auto-fix
ricky run --artifact workflows/generated/foo.ts --auto-fix=5     # max 5 attempts
ricky --mode local --spec-file my.md --run --auto-fix             # composes with --run
```

Default attempts: **3**. `--auto-fix` with no value → 3. `--auto-fix=N` → N attempts (1–10 clamped).

Loop semantics on each iteration:

1. Run the workflow (first attempt: from the start; subsequent attempts: with `--start-from <failed-step> --previous-run-id <prev-run-id>`).
2. On success → print summary, exit 0.
3. On failure → call `classifyFailure(evidence)` then `debugWorkflowRun({ evidence, classification })` to get `repairMode` + a recommendation.
4. Branch on `repairMode`:
   - `'direct'`: apply the fix (see [Auto-applicable fixes](#auto-applicable-fixes) below). If the fix itself fails → escalate (treat as `'manual'`). If it succeeds → loop.
   - `'guided'`: don't auto-apply. Print the suggested steps. Exit non-zero with the suggestion. (User can rerun with the steps applied.)
   - `'manual'`: print the diagnosis + recommendation. Exit non-zero. No retry.
5. After the configured max attempts → print all attempt summaries, the final blocker, and exit 2.

The loop is **opt-in** — without `--auto-fix`, today's behavior is unchanged: one attempt, classified blocker, exit.

## Auto-applicable fixes

A "direct" repair is one Ricky can apply non-destructively, with a deterministic verification. v1 covers exactly these cases:

| Failure class      | Auto-applied fix                                        | Verification                                          |
|--------------------|---------------------------------------------------------|-------------------------------------------------------|
| `MISSING_BINARY`   | Run the `steps` from the blocker (`npm install`, etc.) | Re-check `node_modules/.bin/<pkg>` or `command -v`    |
| `NETWORK_TRANSIENT`| No edit — straight retry with backoff                  | (none — retry is the verification)                    |

Anything else (parse errors, assertion failures, missing env vars, dependency-version mismatches) → `repairMode` is *not* `'direct'`. Those become guided/manual; v1 does not auto-edit code or write env files.

Future cases to consider in v2 (out of scope here):
- Workflow parse errors with a single-line fix hint
- Lockfile drift (re-run install)
- LLM-assisted code fixes (would need explicit, separate consent)

## Failed-step + previous-run-id resolution

`agent-relay run --start-from X --previous-run-id Y` skips predecessors of step `X` and reuses cached outputs from run `Y`. To call it, Ricky needs both values from the *previous* attempt:

- **Failed step**: extracted from `evidence.steps[]` — the first step with `status: 'failed'`. If no step granularity is reported (e.g. process crashed before any step started), `--start-from` is omitted and we just retry the whole run with `--previous-run-id`.
- **Previous run id**: read from the run-id file the prior `agent-relay run` wrote (`AGENT_RELAY_RUN_ID_FILE`), or parsed from the `Run ID:` line agent-relay prints to stderr on failure. The runtime already passes the env var; Ricky just needs to read the file (or parse stderr) when it fires.

If neither source yields a run id, retry without `--previous-run-id` (full re-run) and warn that step-level resume wasn't possible.

## CLI surface changes

- New flag in `parseArgs` (`src/surfaces/cli/commands/cli-main.ts`): `--auto-fix[=N]`. Parses to `parsed.autoFix?: number` where `undefined` means "off" and a number means "max attempts".
- Threaded through the CLI handoff into `LocalInvocationRequest` (extend the type with an `autoFix?: { maxAttempts: number }` field — coexists with the existing `stageMode`).
- New top-level orchestrator function in `src/local/auto-fix-loop.ts` (or co-located in `entrypoint.ts` if small enough):
  ```ts
  async function runWithAutoFix(
    request: LocalInvocationRequest,
    options: { maxAttempts: number; ... },
  ): Promise<LocalResponse>
  ```
  This wraps the existing single-attempt path. When the response is a failure with a directly-repairable blocker, it applies the fix, captures the run-id, and re-invokes with `retry` metadata populated.

The existing single-attempt path stays exactly as-is. The loop is a wrapper — no behavioral change when `autoFix` is unset.

## Output shape

For each attempt, the loop emits a labeled section:

```
attempt 1/3:
  status: blocker (MISSING_BINARY)
  applied fix: npm install
  fix outcome: ok
attempt 2/3:
  status: ok
  duration: 14.2s
```

The final exit message summarizes: `Auto-fix loop succeeded on attempt 2/3.` or `Auto-fix loop exhausted 3 attempts. Final blocker: ...`.

When `--json` is set, the response includes:
```json
{
  "auto_fix": {
    "max_attempts": 3,
    "attempts": [
      { "attempt": 1, "status": "blocker", "blocker_code": "MISSING_BINARY", "applied_fix": { "steps": ["npm install"], "exit_code": 0 } },
      { "attempt": 2, "status": "ok", "run_id": "..." }
    ],
    "final_status": "ok"
  }
}
```

## Test cases

Unit tests in `src/local/auto-fix-loop.test.ts`:

1. **Single-attempt success bypasses the loop** — first run returns `ok`, no debugger call, no retry args.
2. **Direct repair retries with start-from + previous-run-id** — first attempt blocks on MISSING_BINARY, fix runs successfully, second attempt is invoked with `retry.previousRunId` and the failed step.
3. **Repair failure escalates** — direct repair's command exits non-zero. Loop stops, exit non-zero, user gets the recovery steps.
4. **Guided repairMode never retries** — output includes the recommended steps; exit non-zero; no second invocation.
5. **Max attempts exhaustion** — three blockers in a row, all with directly-repairable fixes that don't actually help. Loop stops at attempt 3 with all attempt summaries.
6. **Run id missing from prior attempt** — second attempt invoked without `--previous-run-id` and a warning logged.
7. **`--auto-fix=0` is treated as `--no-auto-fix`** (or rejected with a parse error — pick one and document).
8. **`--auto-fix` composes with `--run` after `--spec-file`** — generate, then enter the loop on the first run.

End-to-end (manual, not automated): generate a workflow that fails on first run because of a missing dep, run with `--auto-fix`, observe ricky installs it and resumes from the failed step.

## Out of scope

- LLM-assisted code edits as auto-fixes. (Requires separate consent flow.)
- Persistent state across CLI invocations. The loop is per-invocation.
- Concurrent retry of independent steps. Sequential only.
- Cloud execution. This is local/BYOH only; cloud has its own retry semantics via `agent-relay cloud run`.

## Acceptance

- `ricky run --artifact <path> --auto-fix` succeeds on a workflow that fails the first attempt with a `MISSING_BINARY` blocker and is fixable by `npm install`.
- Same command with `--auto-fix=1` runs once, blocker reported, no retry.
- Same command without `--auto-fix` behaves identically to today (single attempt, no debugger call).
- All existing `runLocal` tests still pass — the loop is a wrapper, not a replacement.
- `ricky --help` documents the flag.
