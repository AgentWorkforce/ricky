# Trajectory: Fix Ricky background run detachment

> **Status:** ✅ Completed
> **Confidence:** 88%
> **Started:** May 14, 2026 at 10:26 AM
> **Completed:** May 14, 2026 at 10:34 AM

---

## Summary

Fixed Ricky CLI background runs so power-user local generate-and-run commands persist a run id, spawn a detached child process, and return the status command immediately. Added CLI tests for the parent detachment and child run-id reuse paths.

**Approach:** Standard approach

---

## Key Decisions

### Detached Ricky background CLI runs into a child process
- **Chose:** Detached Ricky background CLI runs into a child process
- **Reasoning:** Power-user --run --background was persisting monitor state but still doing generation/execution in the parent Node process, leaving the terminal occupied; spawning the same entrypoint with --foreground and a shared run id lets the parent return immediately while the child writes normal run state.

---

## Chapters

### 1. Work
*Agent: default*

- Detached Ricky background CLI runs into a child process: Detached Ricky background CLI runs into a child process
