# Trajectory: Add Ricky cloud workflow scheduling surface

> **Status:** ✅ Completed
> **Confidence:** 86%
> **Started:** May 9, 2026 at 09:35 PM
> **Completed:** May 9, 2026 at 09:41 PM

---

## Summary

Added Ricky CLI commands for scheduling and listing Cloud workflow schedules, backed by Cloud schedule endpoints and covered by CLI tests.

**Approach:** Standard approach

---

## Key Decisions

### Added Ricky scheduling as a cloud workflow CLI surface
- **Chose:** Added Ricky scheduling as a cloud workflow CLI surface
- **Reasoning:** Ricky already owns workflow authoring and cloud handoff UX, while Relay owns the lower-level cloud CLI. A thin Ricky schedule/list command lets users schedule generated workflow artifacts without moving scheduling state into Ricky itself.

---

## Chapters

### 1. Work
*Agent: default*

- Added Ricky scheduling as a cloud workflow CLI surface: Added Ricky scheduling as a cloud workflow CLI surface
