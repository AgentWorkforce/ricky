# Trajectory: Package generated workflow context into sidecar files

> **Status:** ✅ Completed
> **Confidence:** 94%
> **Started:** May 7, 2026 at 11:18 AM
> **Completed:** May 7, 2026 at 11:23 AM

---

## Summary

Opened a PR that packages generated workflow context into sidecar files and shrinks agent task bodies, with regression coverage and full validation.

**Approach:** Standard approach

---

## Key Decisions

### Packaged long generated workflow context into sidecar files
- **Chose:** Packaged long generated workflow context into sidecar files
- **Reasoning:** Agent tasks were exceeding runner size warnings because full normalized specs were interpolated into lead, implementation, and review prompts. The generated workflow now materializes context sidecars in prepare-context and prompts agents to read those files.

---

## Chapters

### 1. Work
*Agent: default*

- Packaged long generated workflow context into sidecar files: Packaged long generated workflow context into sidecar files
