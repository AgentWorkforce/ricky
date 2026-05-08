# Trajectory: Harden Ricky workflow never-fail coverage

> **Status:** ✅ Completed
> **Confidence:** 92%
> **Started:** May 8, 2026 at 04:46 PM
> **Completed:** May 8, 2026 at 04:54 PM

---

## Summary

Hardened Ricky workflow generation so generated workflows opt into repair-aware retry with repairAgent/repairRetries, added validation and generation tests across code, doc, low-risk, master, and child workflow shapes, kept local auto-fix coverage green, and synced package proof/docs for existing eval scripts so the full suite passes.

**Approach:** Standard approach

---

## Key Decisions

### Harden generated workflows with repair-aware retry instead of fail-fast
- **Chose:** Harden generated workflows with repair-aware retry instead of fail-fast
- **Reasoning:** Relay now supports deterministic gate repair agents; Ricky should emit workflows that opt into that behavior for ordinary, master, and child workflows so generated workflows do not terminate on repairable checks.

---

## Chapters

### 1. Work
*Agent: default*

- Harden generated workflows with repair-aware retry instead of fail-fast: Harden generated workflows with repair-aware retry instead of fail-fast
- Ricky generator now emits repair-aware retry for ordinary, master, and child workflows; pipeline tests cover code, doc, low-risk, and master shapes; local auto-fix and full suite are green after syncing package proof script allowlist.
