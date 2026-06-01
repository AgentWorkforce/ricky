# Trajectory: Make fresh-eyes workflow evals automatic

> **Status:** ✅ Completed
> **Confidence:** 92%
> **Started:** May 15, 2026 at 12:55 PM
> **Completed:** May 15, 2026 at 01:00 PM

---

## Summary

Converted the fresh-eyes workflow-authoring evals into automatic Ricky CLI evals, added generated-artifact inspection to the eval harness, enforced/generated the mandatory Claude-then-Codex review/fix/final-review/final-fix loop, and verified with workflow-authoring evals plus typecheck and full tests.

**Approach:** Standard approach

---

## Chapters

### 1. Work
*Agent: default*

- Fresh-eyes workflow evals now run through Ricky CLI automatically; harness reads generated workflow artifacts for deterministic assertions; typecheck, unit tests, and workflow-authoring eval suite are green.
