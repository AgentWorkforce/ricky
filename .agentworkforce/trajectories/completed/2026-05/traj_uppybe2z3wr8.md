# Trajectory: ricky-resolve-review-findings-workflow

> **Status:** ✅ Completed
> **Task:** e552d24c04ea9bf188d0c651
> **Confidence:** 80%
> **Started:** May 1, 2026 at 07:20 PM
> **Completed:** May 4, 2026 at 01:09 PM

---

## Summary

Closed pre-existing active trajectory before starting a dedicated trajectory for the SDK workflow timeout cleanup PR.

**Approach:** Standard approach

---

## Key Decisions

### Print workflow artifact path on failed Ricky local generation
- **Chose:** Print workflow artifact path on failed Ricky local generation
- **Reasoning:** Generation failures can occur after Ricky has selected an artifact target; hiding that path makes the user unable to inspect or rerun the generated candidate.

### Recover Workforce persona artifact content from expected output path
- **Chose:** Recover Workforce persona artifact content from expected output path
- **Reasoning:** The reproduced failure showed a persona-created workflow file with a response missing inline artifact.content; bounded recovery from the exact expected outputPath lets Ricky accept the artifact while preserving path validation and clearer contract errors.

### Diagnosed non-exit as SDK timeout without child cancellation
- **Chose:** Diagnosed non-exit as SDK timeout without child cancellation
- **Reasoning:** Ricky's SdkScriptWorkflowCoordinator races the script runner against a timeout; the timeout returns a blocked result but does not kill the spawned node workflow, broker, PTYs, or MCP child processes, so the event loop and subprocess tree remain alive.

### Fix SDK workflow timeout by terminating process tree
- **Chose:** Fix SDK workflow timeout by terminating process tree
- **Reasoning:** User requested a PR; root cause is the SDK script runner reporting timeout without cancelling spawned workflow/broker/PTY children.

---

## Chapters

### 1. Planning
*Agent: orchestrator*

### 2. Execution: review-fix-loop
*Agent: fixer*

- Print workflow artifact path on failed Ricky local generation: Print workflow artifact path on failed Ricky local generation
- Patched Ricky CLI failed-generation rendering to keep the artifact target visible; focused CLI tests and typecheck pass, and the ignored dist bundle was refreshed for local binary use.
- Opened PR 42 for failed-generation workflow target reporting; branch codex/show-workflow-target-on-generation-failure contains the renderer change and CLI regression test.
- Recover Workforce persona artifact content from expected output path: Recover Workforce persona artifact content from expected output path
- Added the deeper persona response-contract fix to PR 42: exact outputPath recovery, prompt guard against direct writes, and precise next-action wording. Focused tests and typecheck passed.
- Diagnosed non-exit as SDK timeout without child cancellation: Diagnosed non-exit as SDK timeout without child cancellation
- Fix SDK workflow timeout by terminating process tree: Fix SDK workflow timeout by terminating process tree
- Opened PR for SDK workflow timeout cleanup; focused tests, typecheck, and full suite are green after rerunning one timing-flaky monitor test
