# Trajectory: Fix Ricky SDK workflow failure detection for auto-fix

> **Status:** ✅ Completed
> **Confidence:** 88%
> **Started:** May 1, 2026 at 07:07 PM
> **Completed:** May 1, 2026 at 07:11 PM

---

## Summary

Fixed Ricky's SDK workflow coordinator to detect workflow-level failure signals even when the underlying runner exits zero, classify them as workflow blockers, and added regression coverage for text and structured failure results.

**Approach:** Standard approach

---

## Key Decisions

### Treat zero-exit workflow failure output as a Ricky runtime blocker
- **Chose:** Treat zero-exit workflow failure output as a Ricky runtime blocker
- **Reasoning:** Relay script runners can complete with process exit 0 while the workflow engine reports [workflow] FAILED; Ricky must convert that signal into a failed local execution so auto-fix/resume can engage.

---

## Chapters

### 1. Work
*Agent: default*

- Treat zero-exit workflow failure output as a Ricky runtime blocker: Treat zero-exit workflow failure output as a Ricky runtime blocker
