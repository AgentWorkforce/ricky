# Trajectory: Add PR-gated Ricky eval workflow

> **Status:** ✅ Completed
> **Task:** ricky-pr-evals
> **Confidence:** 88%
> **Started:** May 8, 2026 at 05:43 PM
> **Completed:** May 8, 2026 at 05:48 PM

---

## Summary

Added Sage-shaped provider eval CI for Ricky: OpenRouter executor, evals:provider script, path-gated GitHub Actions workflow, CI summary helper, PR review comment helper, and artifact upload. Validated script syntax, typecheck, CI helper rendering, and the focused issue #76 eval.

**Approach:** Standard approach

---

## Key Decisions

### Use Sage-shaped provider eval CI for Ricky
- **Chose:** Use Sage-shaped provider eval CI for Ricky
- **Reasoning:** The user explicitly asked to copy Sage's OpenRouter-backed PR eval pattern, so Ricky now gets an OpenRouter executor, CI summary/comment scripts, and a path-gated workflow with fork-secret safeguards.

---

## Chapters

### 1. Work
*Agent: default*

- Use Sage-shaped provider eval CI for Ricky: Use Sage-shaped provider eval CI for Ricky

---

## Artifacts

**Commits:** da9f524
**Files changed:** 5
