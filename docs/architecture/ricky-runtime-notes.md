# Ricky Runtime Notes

## Core findings

### 1. Codex is not generically broken in Ricky
Minimal live reproducers proved that Codex worker steps can:
- write a fresh temp file successfully
- edit an existing source file successfully
- reach deterministic verification and signoff successfully

So the Ricky problem is not a universal Codex edit/exit failure.

### 2. The real failure was specific to Ricky product-surface file steps
The problematic behavior appeared when Codex was asked to perform tiny bounded edits inside real Ricky product files such as `src/cli/*`.

Observed behavior in that path:
- worker would roam through neighboring implementation files and tests
- worker would sometimes edit the target file but fail to complete cleanly
- prompt-only tightening did not reliably keep it scoped

Conclusion:
- the remaining problem was specific to real product-surface context and file-boundary enforcement, not Codex in general

### 3. Prompt-only hardening was not enough
Several prompt-level fixes were attempted, including explicitly telling workers that file-writing steps are not report-writing steps and should emit minimal stdout.

Those changes did not reliably solve the live Ricky `src/cli/*` issue.

Conclusion:
- execution-path change was a better fix direction than more prompt tuning

## Execution-path decision

### 4. Tiny bounded Ricky file writes should prefer deterministic execution
For the smallest bounded writes in Ricky’s own proving workflows, deterministic helper scripts/templates are higher confidence than Codex worker steps.

This is especially true inside the actual product surface, where the scoped Codex path proved unreliable.

### 5. Checked-in scripts/templates beat giant inline file payloads
An attempted approach of embedding large file bodies directly in workflow source caused brittle TypeScript escaping failures and was not worth salvaging.

Conclusion:
- prefer checked-in helper scripts or templates
- avoid giant inline source payloads inside workflow `.ts` files

## Concrete fix applied

### 6. Deterministic helper script added
A helper script now exists for restoring Ricky CLI onboarding sources:
- `workflows/shared/scripts/restore-ricky-cli-onboarding.sh`

This script restores deterministic source files used by the onboarding implementation flow.

### 7. Wave 4 implementation workflow rewired
`workflows/wave4-local-byoh/04-implement-cli-onboarding-from-ux-spec.ts` was rewired to use the deterministic helper-script path instead of relying on the tiny flaky Codex write steps for early source restoration.

## Result so far

### 8. The original early runtime bottleneck in `04` is effectively cleared
After the helper-script change, live reruns of `04` progressed through:
- restore helper
- restored-source gate
- implementation-file gate
- test gate
- soft validation

Validation output reached:
- `npx tsc --noEmit`
- `npx vitest run src/cli/`
- 22 passing tests across onboarding + proof coverage in the current run context

The workflow then advanced into review-stage execution.

Conclusion:
- the original early runtime stall was materially improved by removing tiny real-file writes from the Codex path in `04`

## Practical workflow-authoring rules for Ricky

1. For tiny bounded product-surface writes, prefer deterministic scripts/templates.
2. Use Codex where it adds value: review, proof support, broader reasoning, and larger bounded tasks.
3. Treat prompt tuning as secondary when runtime scoping is the real problem.
4. Avoid giant inline file payloads inside workflow TypeScript.
5. When a live rerun advances from opaque worker stalls to ordinary deterministic gate bugs, that is real progress, not noise.

## Next recommended steps

1. Finish stabilizing live execution of `04` through review/fix/signoff.
2. Commit and push the helper-script execution-path fix.
3. Apply the same execution-path pattern to `05` where appropriate.
4. Preserve the minimal reproducers as runtime canaries:
   - `workflows/wave0-foundation/99-debug-codex-worker-runtime.ts`
   - `workflows/wave0-foundation/100-debug-codex-source-edit-runtime.ts`
