# Spec: auto-fix loop must not forward synthetic stage IDs as `startFromStep`

## Problem

When `ricky --mode local --spec-file <path> --run` (or any `runLocal` invocation that lands in the auto-fix loop) hits a launch-phase failure — i.e. the spawned workflow process exits non-zero before any Agent Relay SDK step starts — Ricky reports the failure with a synthetic step id and the auto-fix loop then forwards that id back to the SDK as `startFromStep` on every retry. The SDK rejects it because the id is not a real workflow step name, and all retries fail identically.

Concrete repro from a real run on `cloud@codex/msd-shared-sandbox-review-runtime-spec`:

```
ricky --mode local --spec-file docs/runtimes/specs/msd-shared-sandbox-review-runtime.md --run
…
Error: startFrom step "local-runtime" not found in workflow. Available steps: prepare-context, …, final-signoff
…
Error: startFrom step "runtime-launch" not found in workflow. Available steps: prepare-context, …, final-signoff   # ×6 more
…
Execution: blocked — MISSING_BINARY at runtime-launch
Auto-fix: stopped after 7/7 attempt(s) (MISSING_BINARY)
```

The synthetic ids come from three places inside Ricky:

- `src/local/entrypoint.ts:2013` — `runtime-precheck` ("Local runtime precheck"), reported when the precheck phase fails.
- `src/local/entrypoint.ts:2085` — `runtime-launch` ("Local runtime execution"), reported when the launch phase fails.
- `src/local/auto-fix-loop.ts:1643` — `local-runtime` fallback in `localResponseToWorkflowRunEvidence` when no `failed_step.id` is reported.

All three are Ricky-internal labels for stage-level failures, not real Agent Relay SDK step names.

The auto-fix loop then propagates that id to the SDK:

- `src/local/auto-fix-loop.ts:148` — `failedStepFromEvidence` reads back the synthetic id as `failedStep`.
- `src/local/auto-fix-loop.ts:362, 387, 475` — passes `startFromStep: failedStep` into the retry request.
- `src/local/entrypoint.ts:401, 532, 798` — that becomes a `--start-from <synthetic>` CLI arg or a `START_FROM` env var on the next workflow run.
- `@agent-relay/sdk WorkflowRunner.execute` validates `startFrom` against the workflow's actual step names and throws `startFrom step "<x>" not found in workflow`. The seven retries all fail the same way; the user sees seven copies of the same stack trace and a misleading `MISSING_BINARY at runtime-launch` final blocker.

## Behavior we want

A launch-phase failure (process never reached an SDK step) must not produce a `startFromStep` on retry. The retry should re-run from the beginning — with `previousRunId` reused if available — exactly as the spec already says ("If no step granularity is reported … `--start-from` is omitted and we just retry the whole run with `--previous-run-id`." — `specs/cli-auto-fix-and-resume.md:59`).

After this fix, the same repro must:

- Not emit any `startFrom step "..." not found in workflow` errors on retry.
- Either succeed within the budget if the underlying failure is repairable, or terminate with the real classified blocker (e.g. `MISSING_BINARY` for an actually-missing binary) without burning retries on a phantom-step error.
- Surface the real failed step in the per-attempt summary only when one exists; otherwise omit `failed_step` instead of synthesizing `runtime-launch` / `local-runtime`.

## Implementation surface

The fix is contained and surgical. Two coordinated changes:

1. **Stop synthesizing fake step ids as resume targets.** Introduce a single source of truth listing the synthetic stage labels Ricky uses internally:

   ```ts
   // src/local/synthetic-step-ids.ts
   export const SYNTHETIC_LOCAL_STAGE_IDS = new Set([
     'runtime-precheck',
     'runtime-launch',
     'local-runtime',
   ]);
   export function isSyntheticStageId(id: string | undefined): boolean { … }
   ```

   The label may still appear in human-facing evidence (`evidence.failed_step.name = 'Local runtime execution'`) and in attempt summary output for diagnostics, but it must not be forwarded to the SDK as a `startFrom` target.

2. **Filter at the boundary, not at the source.** The cleanest place is `failedStepFromEvidence` in `src/local/auto-fix-loop.ts`: return `undefined` when the only failed step id is synthetic. That keeps the existing evidence/event shape intact (other consumers, tests, and the persona-repair prompt may still want to know "the launch phase failed") while making the auto-fix retry path correctly treat it as a no-step-granularity failure.

   Concretely:

   ```ts
   // src/local/auto-fix-loop.ts
   function failedStepFromEvidence(evidence: WorkflowRunEvidence): string | undefined {
     const real = evidence.steps.find(
       (step) => step.status === 'failed' && !isSyntheticStageId(step.stepId),
     );
     return real?.stepId;
   }
   ```

   Every existing call site that reads `failedStep` (`src/local/auto-fix-loop.ts:148, 362, 387, 475` and the attempt-summary builder at `:155`) keeps working unchanged — they already guard with `failedStep ? { startFromStep: failedStep } : {}`, and after this filter `failedStep` will be `undefined` for launch-phase failures.

3. **Keep the synthetic id out of evidence.steps[].stepId for resume purposes only.** Leave `src/local/entrypoint.ts:2104` (`workflow_steps[].id = 'runtime-launch'` in the success branch) untouched — that is observability metadata for a successful run and does not flow into auto-fix. The fallback at `src/local/auto-fix-loop.ts:1643` (`stepId: failedStepId ?? 'local-runtime'`) is the one that produces the bogus retry target; it should keep using the synthetic id for the *fallback step name* so output remains readable, but `failedStepFromEvidence` is the only place that decides resume targets, so this is already covered by change 2.

## Test cases

Unit tests in `src/local/auto-fix-loop.test.ts` (extend the existing file):

1. **Synthetic launch-phase failure does not propagate `startFromStep`** — first attempt returns a `LocalResponse` with `execution.evidence.failed_step = { id: 'runtime-launch', name: 'Local runtime execution' }`. The retry request built by the loop must have `retry.startFromStep === undefined`. The retry must still set `retry.previousRunId` when a run id is available.
2. **Synthetic fallback id does not propagate either** — `LocalResponse` with no `failed_step` field; the fallback path stamps `stepId: 'local-runtime'` into evidence. Same assertion as (1).
3. **Real failed step still propagates** — evidence has a real failed step (`stepId: 'aggregate-drift'`, `status: 'failed'`). Retry request must carry `startFromStep: 'aggregate-drift'`. (Regression guard for the existing happy path.)
4. **Mixed evidence prefers a real failed step over a synthetic one** — if `evidence.steps` contains both `{ stepId: 'runtime-launch', status: 'failed' }` and `{ stepId: 'aggregate-drift', status: 'failed' }`, the loop forwards `aggregate-drift`. (Defends against future changes that emit both.)
5. **Attempt summary still records the synthetic name** — so users / logs can still see "Local runtime execution failed" even though no `startFromStep` was forwarded. The `failed_step` field on the summary is allowed to be omitted, but the human-readable summary line / evidence narrative must still mention the launch-phase failure.

End-to-end (manual): rerun the original repro (`ricky --mode local --spec-file <some.md> --run` against a workflow that fails to launch — e.g. arrange for a `MISSING_BINARY`). Verify zero `startFrom step "..." not found in workflow` errors across all retries; verify the final summary cites the real underlying blocker.

## Out of scope

- Changing the `MISSING_BINARY` classification or the auto-fix attempt budget.
- Renaming or removing the synthetic stage labels in observability output (`evidence.failed_step.name`, attempt summary text). They remain useful for humans reading logs.
- Detecting the *real* failed step from stderr when the SDK never reported one. The retry just re-runs from the start, which is correct and safe.
- Cloud-run retry semantics. This is local-only.

## Acceptance

- The original repro (`ricky --mode local --spec-file docs/runtimes/specs/msd-shared-sandbox-review-runtime.md --run`, run from the `cloud` repo) emits no `startFrom step "..." not found in workflow` errors. The final blocker, if any, reflects the real classified failure (e.g. `MISSING_BINARY` with the genuinely missing binary), not `runtime-launch`.
- `npm test` passes, including the new auto-fix-loop test cases above.
- No regression in `specs/cli-auto-fix-and-resume.md` acceptance criteria — `--auto-fix` with `MISSING_BINARY` + `npm install` still resumes correctly when a real step fails.
