# Trajectory: Investigate publish workflow push rejection

> **Status:** ✅ Completed
> **Confidence:** 90%
> **Started:** May 7, 2026 at 10:43 AM
> **Completed:** May 7, 2026 at 10:45 AM

---

## Summary

Explained publish.yml rejection: workflow published @agentworkforce/ricky@0.1.26, then failed to push release commit/tag because remote main had newer work than the runner's local main. Suggested syncing/concurrency/order fixes.

**Approach:** Standard approach

---

## Key Decisions

### Diagnosed publish failure as non-fast-forward release push after npm publish
- **Chose:** Diagnosed publish failure as non-fast-forward release push after npm publish
- **Reasoning:** publish.yml commits the bumped package version locally, publishes to npm, then pushes main with --follow-tags. The push rejects when origin/main has advanced beyond the checkout SHA before the tag/push step.

---

## Chapters

### 1. Work
*Agent: default*

- Diagnosed publish failure as non-fast-forward release push after npm publish: Diagnosed publish failure as non-fast-forward release push after npm publish
