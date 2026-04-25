# Ricky Wave 4 Runtime Completion Findings

## Summary

The repeated Wave 4 live-run failures were narrowed with three runtime experiments:
1. a minimal temp-file write reproducer
2. a decomposed real Wave 4 rerun
3. a minimal existing-source-file edit reproducer

The main findings are:
- live Codex worker steps in this Ricky runtime can complete successfully in a minimal bounded temp-file write reproducer
- live Codex worker steps can also complete successfully in a minimal bounded existing-source-file edit reproducer
- completion recognition in successful minimal reproducers still lags by roughly 20-30 seconds after the file operation
- decomposing the real Wave 4 implementation workflow into smaller file-scoped steps improved workflow topology and observability, but did not solve the live completion trust problem
- prompt-level countermeasures against the injected stdout-deliverable contract did not solve the real Wave 4 problem either
- the remaining failure is now most likely specific to the real Ricky step context, not to Codex’s basic ability to edit files and exit

## Minimal reproducer 1: temp-file write

A dedicated runtime reproducer workflow was added:
- `workflows/wave0-foundation/99-debug-codex-worker-runtime.ts`

It performs:
1. deterministic setup
2. one Codex worker step that writes exactly one file
3. deterministic verification of that file
4. deterministic signoff

### Result

Live run:
- workflow: `ricky-debug-codex-worker-runtime-workflow`
- run id: `e2b9a81925dd3267369d3925`

Observed behavior:
- `codex-write-file` started normally
- `tmp/runtime-debug/codex-worker-output.txt` was written with the exact expected content
- the workflow did not emit useful progress immediately after write completion
- after about 30 seconds, the workflow advanced automatically to deterministic verification
- the workflow then completed successfully end-to-end

## Minimal reproducer 2: existing-source-file edit

A second runtime reproducer was added:
- `workflows/wave0-foundation/100-debug-codex-source-edit-runtime.ts`

It performs:
1. deterministic setup of an existing `.ts` source file under `tmp/runtime-debug/`
2. one Codex worker step that edits that existing source file in place
3. deterministic verification of exact resulting content
4. deterministic signoff

### Result

Live run:
- workflow: `ricky-debug-codex-source-edit-runtime-workflow`
- run id: `81e7b6e5a67cab86b546ed06`

Observed behavior:
- `codex-edit-existing-file` started normally
- the worker stayed tightly scoped to `tmp/runtime-debug/source-edit-target.ts`
- the file changed from `BEFORE` to `AFTER` exactly as requested
- the worker emitted a short completion note
- after about 23 seconds, the workflow advanced automatically to deterministic verification
- the workflow then completed successfully end-to-end

## Decomposed Wave 4 rerun result

After decomposing `04-implement-cli-onboarding-from-ux-spec.ts` into narrower file-scoped steps, a live rerun was attempted.

Live run:
- workflow: `ricky-wave4-implement-cli-onboarding-from-ux-spec-workflow`
- run id: `b65b2628f568210934143f9d`

Observed behavior:
- deterministic prep and read steps completed successfully
- the first tiny worker step, `write-ascii-art`, started normally
- the runtime reported it still running at 30s, 60s, and 90s
- the run terminated before that worker step cleanly completed
- inspection after termination showed `src/cli/ascii-art.ts` had in fact been edited during the step

## Prompt-countermeasure rerun result

After inspecting the worker log, the workflow prompts were patched to explicitly say that file-writing steps are not report-writing steps, should not emit long stdout deliverables, and should exit immediately after writing.

Live run:
- workflow: `ricky-wave4-implement-cli-onboarding-from-ux-spec-workflow`
- run id: `ccacff157ab4a8c678d73e39`

Observed behavior:
- deterministic prep and read steps again completed successfully
- the first tiny worker step, `write-ascii-art`, again started normally
- the worker log still showed broader repo exploration, including reads from other onboarding implementation files and tests
- `src/cli/ascii-art.ts` mtime did not change during this rerun
- the worker still did not reach a timely clean completion, and the run was manually terminated

## Key log evidence

The `write-ascii-art` worker log showed a contradictory injected contract:
- `Write the file to disk, then exit cleanly.`
- `Your stdout output is your ONLY deliverable.`
- `Print your COMPLETE deliverable to stdout — this is the ONLY output that will be captured`

This is a poor fit for bounded source-editing workers and likely contributes to lingering/non-terminal behavior.

However, the successful existing-source-file reproducer proves that this injected contract alone is not enough to explain the Ricky failure. In the reproducer, Codex still completed cleanly despite the same injected wrapper.

## What this means

### Confirmed
- Codex worker steps can write bounded files successfully in this repo/runtime.
- Codex worker steps can edit an existing `.ts` source file successfully in this repo/runtime.
- File-based verification does work when the worker reaches terminal completion.
- The runtime is not universally broken for live worker steps.
- The remaining trust gap is not purely caused by overly broad Wave 4 step scope.
- The remaining trust gap is not solved by a prompt-only countermeasure against the injected stdout contract.

### Newly confirmed
- The failure is now much more specific to the real Ricky step context.
- In minimal reproducers, Codex remains tightly scoped and exits cleanly.
- In the real Ricky `write-ascii-art` step, Codex roams across broader onboarding files and tests instead of staying tightly scoped to the requested file.

## Updated diagnosis

The remaining problem appears to be a combination of:
- slow or opaque worker-step completion recognition, even on successful runs
- poor enforcement of requested file boundaries in the real Ricky workflow context
- some interaction between the real Ricky step context and Codex that causes broader repo exploration during supposedly single-file edits

This is meaningfully narrower than the earlier theory that live Codex worker execution was simply broken, and narrower than the later theories that step decomposition or prompt-only tightening would fix the issue.

## Most likely differentiators now

The real Ricky step differs from the successful reproducers in ways that likely matter:
- much larger deterministic context is provided before the worker starts
- richer product/spec/workflow text is injected into the worker task path
- the target file lives inside the active real product surface (`src/cli/`) alongside closely related neighboring files and tests

That combination appears to trigger broader exploratory behavior that does not happen in the minimal reproducers.

## Implications for Ricky workflow authoring

### 1. Decomposition is still good, but not sufficient
Smaller worker tasks improve structure and reduce ambiguity, but they do not fully repair the current runtime completion issue.

### 2. Deterministic post-write gates remain valuable
The workflow should continue to rely on deterministic file gates once the worker resolves.

### 3. Prompt hardening alone is not enough
Even explicit “do not emit long stdout” guidance did not keep the worker scoped to a single real product file.

### 4. Real-product file edits may need a different execution path
If worker scoping remains unreliable in real product paths, Ricky should reserve Codex steps for review/proof or broader reasoning, and use deterministic shell-backed generation, direct authored commits, or a different execution backend for the smallest bounded writes.

## Recommended next move

Instead of only further prompt tuning, Ricky should now:
1. build a third reproducer that targets a real `src/cli/` file but minimizes surrounding context
2. inspect step outputs under `.agent-relay/step-outputs/<run-id>` for additional completion metadata
3. decide whether bounded Ricky source-file edits inside real product directories should stay on Codex worker steps at all
4. consider switching the smallest file-writing steps to a deterministic execution path

## Decision

The runtime issue is now classified as:
- not a universal worker deadlock
- not solved by planner removal alone
- not solved by file-scoped decomposition alone
- not solved by prompt-only suppression of long stdout behavior
- not a generic existing-source-file editing failure
- most likely a real-step-context and file-boundary enforcement problem for Codex inside the actual Ricky product surface

So the next quality-first fix should be either:
- a near-real reproducer that isolates the context trigger, or
- an execution-path change for the smallest Ricky file-writing steps.
