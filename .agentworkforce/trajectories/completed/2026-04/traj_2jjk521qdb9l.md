# Trajectory: Surface background workflow run id and status command

> **Status:** ✅ Completed
> **Confidence:** 95%
> **Started:** April 30, 2026 at 05:24 PM
> **Completed:** April 30, 2026 at 05:28 PM

---

## Summary

Background local run selection now prints the monitor run id immediately, final CLI output includes run/status/log/evidence details, and ricky status --run reads persisted monitor state for progress.

**Approach:** Standard approach

---

## Key Decisions

### Surface local background monitor ids and status command
- **Chose:** Surface local background monitor ids and status command
- **Reasoning:** The monitor already persisted state, but the CLI did not print the run id after selection and status --run was not wired to read that state.

### Announce monitor run id before awaiting background execution
- **Chose:** Announce monitor run id before awaiting background execution
- **Reasoning:** A background selection must give the user a run id immediately so status --run can be used from another terminal while execution is still in progress.

---

## Chapters

### 1. Work
*Agent: default*

- Surface local background monitor ids and status command: Surface local background monitor ids and status command
- Announce monitor run id before awaiting background execution: Announce monitor run id before awaiting background execution
