# Trajectory: Fix Ricky auto-repair for lead plan marker gate failures

> **Status:** ✅ Completed
> **Confidence:** 94%
> **Started:** May 7, 2026 at 11:12 AM
> **Completed:** May 7, 2026 at 11:17 AM

---

## Summary

Added and PR'd a Ricky deterministic auto-fix for lead-plan marker gate failures, with regression coverage and full test validation.

**Approach:** Standard approach

---

## Key Decisions

### Added deterministic auto-fix for generated lead-plan required marker gates
- **Chose:** Added deterministic auto-fix for generated lead-plan required marker gates
- **Reasoning:** The failed run resumes from lead-plan-gate, so patching only the lead prompt would not fix existing lead-plan.md artifacts. The repair instead rewrites the generated gate to append missing plan sections before validation, preserving the sentinel and bounded trigger.

---

## Chapters

### 1. Work
*Agent: default*

- Added deterministic auto-fix for generated lead-plan required marker gates: Added deterministic auto-fix for generated lead-plan required marker gates
