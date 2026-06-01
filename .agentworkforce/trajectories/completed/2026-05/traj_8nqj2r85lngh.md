# Trajectory: ricky-resolve-review-findings-workflow

> **Status:** ✅ Completed
> **Task:** 1adde55331b2221c33dd941d
> **Confidence:** 90%
> **Started:** May 1, 2026 at 07:26 PM
> **Completed:** May 1, 2026 at 09:25 PM

---

## Summary

Added @agentworkforce/harness-kit dependency and updated Ricky Workforce persona generation/repair to resolve runnable sendMessage contexts via harness-kit, preserving workload-router as metadata-only selection. Local generation/repair now passes Ricky state-root install locations, deterministic auto-fix repairs run before external persona repair, focused/full tests pass, and PR #30 was updated.

**Approach:** Standard approach

---

## Key Decisions

### No full-regression source fix required
- **Chose:** No full-regression source fix required
- **Reasoning:** full-regression-soft.txt records typecheck=0 and full_test=0, and no separate regression log exists in the review-findings-hardening artifact directory

### Treat failed guided local generation as terminal before run confirmation
- **Chose:** Treat failed guided local generation as terminal before run confirmation
- **Reasoning:** When Workforce persona authoring fails, Ricky currently keeps an in-memory deterministic artifact path in the summary, asks to run it, then fails reading a file that was never written. The narrow fix is to stop before run confirmation and render the generation failure.

### Add bounded deterministic auto-fix fallback for obvious workflow artifact mismatches
- **Chose:** Add bounded deterministic auto-fix fallback for obvious workflow artifact mismatches
- **Reasoning:** The published workload-router currently exposes persona selection/install metadata but no sendMessage harness bridge, so the default Workforce repairer can be unavailable locally. For clear SDK evidence, Ricky can safely patch simple file_exists, output_contains, and stale step-output reference mismatches without broad LLM repair.

### Ricky now resolves runnable Workforce personas through harness-kit
- **Chose:** Ricky now resolves runnable Workforce personas through harness-kit
- **Reasoning:** workload-router is metadata-only after Workforce PR #33; harness-kit owns sendMessage and cancellation behavior, with local-dev fallback for the sibling Workforce checkout while npm publication catches up

### Run bounded deterministic workflow repairs before spawning Workforce repair personas
- **Chose:** Run bounded deterministic workflow repairs before spawning Workforce repair personas
- **Reasoning:** local auto-fix fixtures and obvious deterministic mismatches should stay fast and offline; harness-kit repair remains the fallback for failures Ricky cannot repair deterministically

---

## Chapters

### 1. Planning
*Agent: orchestrator*

### 2. Execution: review-fix-loop
*Agent: fixer*

- No full-regression source fix required: No full-regression source fix required
- Post-merge check: PR #29 is merged into main, publish/test run passed, local npm test and typecheck pass, and no new GitHub issue/PR report is visible.
- User reported guided local foreground run generated documentation-audit artifact but handoff failed instead of executing, and generation appeared deterministic rather than Workforce-persona authored. Starting local reproduction and narrow patch.
- Treat failed guided local generation as terminal before run confirmation: Treat failed guided local generation as terminal before run confirmation
- Focused fix stops guided local flow after failed generation; targeted local workflow and CLI rendering tests pass; typecheck passes. Preparing branch, full regression, commit, and PR.
- Opened PR #30 for guided local generation failure. Commit 02376ef pushed on codex/fix-guided-local-generation-failure. Full npm test passed locally; untracked workflows/demo-auto-fix remains unrelated and unstaged.
- User reported auto-fix failed on demo broken-greeting workflow: runtime failure at verify-greeting was classified/repair-escalated as runtime-launch lacking deterministic gate evidence, and Workforce persona resolver was unavailable. Reproducing locally before patch.
- Add bounded deterministic auto-fix fallback for obvious workflow artifact mismatches: Add bounded deterministic auto-fix fallback for obvious workflow artifact mismatches
- PR #30 updated with auto-fix evidence and deterministic fallback repair. Local smoke on throwaway broken-greeting copy now succeeds on attempt 2/3, full npm test passes.
- User confirmed local auto-fix run succeeds quickly and asked whether fixes use actual agents. Need clarify deterministic fallback vs persona repair, and add local escalating workflow failure tests so demo behavior is covered.
- Added local auto-fix workflow failure ladder e2e test and CLI repair-mode rendering. Targeted tests and typecheck pass.
- Pushed commit 7fa9fe0 adding CLI repair-mode output and local auto-fix workflow failure ladder e2e suite. Full npm test passes with 42 files / 756 tests.
- Ricky now resolves runnable Workforce personas through harness-kit: Ricky now resolves runnable Workforce personas through harness-kit
- Run bounded deterministic workflow repairs before spawning Workforce repair personas: Run bounded deterministic workflow repairs before spawning Workforce repair personas
- Ricky now resolves runnable Workforce persona contexts via harness-kit, keeps obvious deterministic repairs local-first, and verification is green after focused and full test runs
