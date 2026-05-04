# Trajectory: Fix SDK workflow timeout cleanup PR

> **Status:** ✅ Completed
> **Confidence:** 90%
> **Started:** May 4, 2026 at 01:09 PM
> **Completed:** May 4, 2026 at 01:10 PM

---

## Summary

Opened PR #43 to fix SDK workflow timeout cleanup. SDK script workflow runs now receive an AbortSignal, timeout aborts the runner, spawned scripts run detached so process-group cleanup can terminate broker/PTY/MCP children, and tests prove a hanging child process is gone after timeout. Verification: focused entrypoint tests, typecheck, and full npm test passed after rerunning one timing-flaky monitor test.

**Approach:** Standard approach

---

## Key Decisions

### Opened dedicated trajectory after closing stale active trajectories
- **Chose:** Opened dedicated trajectory after closing stale active trajectories
- **Reasoning:** AGENTS.md requires trajectory records for task work; two stale workflow-runner trajectories were active, so they were completed before starting this PR-specific trajectory.

---

## Chapters

### 1. Work
*Agent: default*

- Opened dedicated trajectory after closing stale active trajectories: Opened dedicated trajectory after closing stale active trajectories
- PR #43 fixes SDK workflow timeout cleanup by aborting the SDK runner, killing the spawned process group on timeout, closing readline handles, and proving child cleanup with a regression test.
