# Trajectory: Tighten auto-fix resume with Workforce workflow persona

> **Status:** ✅ Completed
> **Confidence:** 93%
> **Started:** May 1, 2026 at 05:48 PM
> **Completed:** May 1, 2026 at 06:02 PM

---

## Summary

Implemented default auto-fix/resume for local workflow runs through the Workforce workflow persona. Ricky now diagnoses failed workflow evidence, patches the underlying workflow artifact, resumes with start-from and previous-run metadata, carries stable Ricky tracking ids through background monitors, and covers the repairer/loop with tests. Full npm test and typecheck pass.

**Approach:** Standard approach

---

## Key Decisions

### Auto-fix will repair workflow artifacts through the Workforce workflow persona before retrying
- **Chose:** Auto-fix will repair workflow artifacts through the Workforce workflow persona before retrying
- **Reasoning:** The requested behavior is not a shell-level recovery loop; failures should be diagnosed against run evidence, patched into the generated workflow artifact, and resumed with start-from/previous-run metadata while the user tracks one Ricky run.

---

## Chapters

### 1. Work
*Agent: default*

- Auto-fix will repair workflow artifacts through the Workforce workflow persona before retrying: Auto-fix will repair workflow artifacts through the Workforce workflow persona before retrying

---

## Artifacts

**Commits:** b3f1bcf
**Files changed:** 11
