# Ricky Wave 4 Runtime Completion Findings

## Summary

The repeated Wave 4 live-run failures were narrowed with a minimal reproducer.

The main finding is:
- live Codex worker steps in this Ricky runtime can complete successfully
- but completion recognition can lag by roughly 30 seconds after the file artifact is already written
- this is slower and more opaque than desired, but it is not the same as a total deadlock for every worker step

## Minimal reproducer

A dedicated runtime reproducer workflow was added:
- `workflows/wave0-foundation/99-debug-codex-worker-runtime.ts`

It performs:
1. deterministic setup
2. one Codex worker step that writes exactly one file
3. deterministic verification of that file
4. deterministic signoff

## Reproducer result

Live run:
- workflow: `ricky-debug-codex-worker-runtime-workflow`
- run id: `e2b9a81925dd3267369d3925`

Observed behavior:
- `codex-write-file` started normally
- `tmp/runtime-debug/codex-worker-output.txt` was written with the exact expected content
- the workflow did not emit useful progress immediately after write completion
- after about 30 seconds, the workflow advanced automatically to deterministic verification
- the workflow then completed successfully end-to-end

## What this means

### Confirmed
- Codex worker steps can write bounded files successfully in this repo/runtime.
- File-based verification does work.
- The runtime is not universally broken for live worker steps.

### Not confirmed
- The runtime does not yet provide fast or transparent completion detection for these worker steps.
- Wave 4 workflows may still feel hung even when progress is actually happening.

## Updated diagnosis

The remaining problem appears to be a combination of:
- slow worker-step completion recognition
- poor progress visibility during that grace period
- bigger Wave 4 tasks making the opaque interval feel like a stall

This is meaningfully narrower than the earlier theory that live Codex worker execution was simply broken.

## Implications for Ricky workflow authoring

### 1. Keep steps small and bounded
Smaller worker tasks are more likely to finish cleanly and make the grace-period delay tolerable.

### 2. Prefer deterministic post-write gates
The reproducer confirms that downstream deterministic steps work once the worker resolves.

### 3. Do not interpret a short opaque period as guaranteed deadlock
For this runtime, a 20-30 second quiet interval after file creation may still resolve successfully.

### 4. Wave 4 still needs narrower implementation slices
The CLI implementation and proof workflows likely remain too large for comfortable operator confidence under this runtime behavior.

## Recommended next move

Instead of continuing to tweak only runtime prompts, Ricky should:
1. split large Wave 4 implementation/proof worker steps into smaller file-scoped or tightly bounded worker steps
2. keep deterministic verification immediately after each file-writing phase
3. preserve the minimal reproducer as an ongoing runtime canary

## Decision

The runtime issue is now classified as:
- not a universal worker deadlock
- but a slow and opaque worker completion behavior that becomes risky when Wave 4 steps are too large

So the next quality-first fix should be workflow decomposition, not just more retries or more prompt tweaks.
