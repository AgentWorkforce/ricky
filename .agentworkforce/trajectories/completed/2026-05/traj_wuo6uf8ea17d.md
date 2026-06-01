# Trajectory: Reduce Ricky local state writes in user repositories

> **Status:** ✅ Completed
> **Confidence:** 90%
> **Started:** May 1, 2026 at 05:28 PM
> **Completed:** May 1, 2026 at 05:36 PM

---

## Summary

Reduced Ricky state writes in user repositories by making generation metadata sidecars opt-in and moving local run monitor/runtime log state to a repo-keyed user state directory with legacy status fallback.

**Approach:** Standard approach

---

## Key Decisions

### Make generated workflow metadata sidecars opt-in
- **Chose:** Make generated workflow metadata sidecars opt-in
- **Reasoning:** The workflow .ts file is a user deliverable, but skill/tool/refinement/persona metadata is Ricky bookkeeping already returned in LocalResponse.decisions; writing it into .workflow-artifacts during generation pollutes user repositories.

### Move background run monitor state out of repositories
- **Chose:** Move background run monitor state out of repositories
- **Reasoning:** Run logs, evidence, and status JSON are Ricky state for reattachment; they can live in the user's state directory keyed by repo hash, with legacy repo-local reads retained for old runs.

---

## Chapters

### 1. Work
*Agent: default*

- Make generated workflow metadata sidecars opt-in: Make generated workflow metadata sidecars opt-in
- Move background run monitor state out of repositories: Move background run monitor state out of repositories
- State spillover reduced in two places: generation metadata sidecars are opt-in, and background/runtime monitor state now routes through a repo-keyed user state directory with legacy read fallback for old runs.
