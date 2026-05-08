# Trajectory: Avoid master child workflow false terminal failures

> **Status:** ✅ Completed
> **Confidence:** 90%
> **Started:** May 8, 2026 at 05:04 PM
> **Completed:** May 8, 2026 at 05:12 PM

---

## Summary

Updated Ricky workflow generation and auto-fix resilience so generated master workflows keep nested child auto-fix enabled, generated child final validation no longer terminally blocks on parallel sibling repo state, legacy generated artifacts can be deterministically repaired, and repair-provider exceptions trigger bounded retry/resume instead of immediate failure.

**Approach:** Standard approach

---

## Key Decisions

### Keep nested Ricky child auto-fix enabled from master workflows
- **Chose:** Keep nested Ricky child auto-fix enabled from master workflows
- **Reasoning:** The cloud failure showed master-generated child runs using --no-auto-fix, which prevented the child workflow from repairing its own deterministic blocker before the master failed.

### Make generated child final validation non-terminal
- **Chose:** Make generated child final validation non-terminal
- **Reasoning:** Parallel child workflows can observe temporary integrated-repo typecheck failures caused by sibling slices; the master final validation should own the hard integrated check after all child signoffs.

### Retry after workflow repair provider exceptions
- **Chose:** Retry after workflow repair provider exceptions
- **Reasoning:** Malformed or missing structured artifacts from the repair persona should consume a bounded retry and resume the workflow, not stop the auto-fix loop after the first attempt.

---

## Chapters

### 1. Work
*Agent: default*

- Keep nested Ricky child auto-fix enabled from master workflows: Keep nested Ricky child auto-fix enabled from master workflows
- Make generated child final validation non-terminal: Make generated child final validation non-terminal
- Retry after workflow repair provider exceptions: Retry after workflow repair provider exceptions
- Generated workflows now keep repair loops active at both master and child layers, and legacy artifacts get deterministic repair for the old no-auto-fix and hard child validation patterns.
