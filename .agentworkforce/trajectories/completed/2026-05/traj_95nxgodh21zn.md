# Trajectory: Address PR feedback and fix local auto-fix ladder CI failure

> **Status:** ✅ Completed
> **Confidence:** 93%
> **Started:** May 12, 2026 at 12:00 PM
> **Completed:** May 12, 2026 at 12:20 PM

---

## Summary

Addressed PR feedback on PR #100 by making GitHub workflows consume .nvmrc, aligning the repo runtime metadata to Node 22.14.0, adding a timeout to the pre-merge job, rebasing onto the mainline auto-fix evidence fix, and hardening load-sensitive proof tests. Verified the local premerge suite and the GitHub pre-merge check on the pushed PR head.

**Approach:** Standard approach

---

## Key Decisions

### Raised load-sensitive proof and subprocess test time budgets
- **Chose:** Raised load-sensitive proof and subprocess test time budgets
- **Reasoning:** The new premerge gate runs heavy e2e subprocess tests together; local-run-monitor had multiple 5s internal waits under a 5s Vitest timeout, and flat-layout's 1s wall-clock proof missed by about 50ms under load while remaining bounded.

### Updated declared Node runtime to 22.14.0
- **Chose:** Updated declared Node runtime to 22.14.0
- **Reasoning:** Using .nvmrc in CI was correct, but npm ci fails under Node 20 because locked dependencies require >=22.13.0. The repo runtime declaration needed to match the installable dependency graph.

---

## Chapters

### 1. Work
*Agent: default*

- Raised load-sensitive proof and subprocess test time budgets: Raised load-sensitive proof and subprocess test time budgets
- Updated declared Node runtime to 22.14.0: Updated declared Node runtime to 22.14.0

---

## Artifacts

**Commits:** 5c30c8a, 74dee62, 9d0d45c, ad7d0d3
**Files changed:** 16
