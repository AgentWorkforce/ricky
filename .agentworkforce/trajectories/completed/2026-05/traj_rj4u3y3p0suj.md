# Trajectory: Address PR 104 review comments

> **Status:** ✅ Completed
> **Confidence:** 90%
> **Started:** May 14, 2026 at 10:46 AM
> **Completed:** May 14, 2026 at 10:49 AM

---

## Summary

Addressed PR 104 review feedback by requiring detached child re-entry to match the explicitly spawned foreground run shape, clearing the run-id env before execution, and adding regression coverage for inherited env no-run commands.

**Approach:** Standard approach

---

## Key Decisions

### Constrained detached child re-entry to explicit foreground run commands
- **Chose:** Constrained detached child re-entry to explicit foreground run commands
- **Reasoning:** The run id environment variable can be inherited by nested Ricky commands, so the child path now also requires the spawned child's --foreground and --run shape, and clears the env before executing the monitor to avoid leaking it to descendants.

---

## Chapters

### 1. Work
*Agent: default*

- Constrained detached child re-entry to explicit foreground run commands: Constrained detached child re-entry to explicit foreground run commands

---

## Artifacts

**Commits:** bd3897c
**Files changed:** 2
