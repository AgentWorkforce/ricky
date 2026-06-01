# Trajectory: Harden Ricky best-judgement workflow generation evals

> **Status:** ✅ Completed
> **Task:** ricky-best-judgement-evals
> **Confidence:** 90%
> **Started:** May 8, 2026 at 05:13 PM
> **Completed:** May 8, 2026 at 05:23 PM

---

## Summary

Added --best-judgement clarification handling through Ricky local generation, CLI flag plumbing, deterministic eval harness temp-cwd support, unit coverage, and generation-quality eval cases for ask-user versus implementer-assumption behavior.

**Approach:** Standard approach

---

## Key Decisions

### Implement --best-judgement at the local invocation boundary
- **Chose:** Implement --best-judgement at the local invocation boundary
- **Reasoning:** Clarification blocking currently happens before generation, so resolving questions there preserves the default ask-user behavior while allowing CLI/MCP/local callers to continue with explicit implementer assumptions.

---

## Chapters

### 1. Work
*Agent: default*

- Implement --best-judgement at the local invocation boundary: Implement --best-judgement at the local invocation boundary
- Best-judgement clarification path is implemented at local intake, CLI flag plumbing is in place, focused tests pass, and deterministic evals now cover ask-user versus implementer-assumption modes.

---

## Artifacts

**Commits:** 4783817
**Files changed:** 10
