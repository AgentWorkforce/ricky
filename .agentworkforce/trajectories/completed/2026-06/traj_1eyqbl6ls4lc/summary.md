# Trajectory: Fix PR 147 pre-merge flat layout proof failures

> **Status:** ✅ Completed
> **Confidence:** 92%
> **Started:** June 1, 2026 at 02:12 PM
> **Completed:** June 1, 2026 at 02:14 PM

---

## Summary

Fixed flat-layout proof failures by excluding .agentworkforce trajectory archives from active reference scans; verified npm run premerge passes.

**Approach:** Standard approach

---

## Key Decisions

### Treat .agentworkforce trajectories as archived proof history
- **Chose:** Treat .agentworkforce trajectories as archived proof history
- **Reasoning:** The flat-layout proof scans active repo files for obsolete artifact references. Committed .agentworkforce trajectory JSON contains historical references, analogous to .trajectories archives, and should not make live source cleanup proofs fail.

---

## Chapters

### 1. Work
*Agent: default*

- Treat .agentworkforce trajectories as archived proof history: Treat .agentworkforce trajectories as archived proof history
