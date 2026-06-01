# Trajectory: Support ricky run workflow --cloud shorthand

> **Status:** ✅ Completed
> **Confidence:** 92%
> **Started:** May 7, 2026 at 11:36 AM
> **Completed:** May 7, 2026 at 11:39 AM

---

## Summary

Added --cloud shorthand for ricky run artifact commands, updated Cloud run-command rendering and docs/help copy, and covered the shorthand with parser/CLI/summary tests.

**Approach:** Standard approach

---

## Key Decisions

### Made ricky run <artifact> --cloud the preferred Cloud artifact command
- **Chose:** Made ricky run <artifact> --cloud the preferred Cloud artifact command
- **Reasoning:** The user-facing mental model is run this workflow, with Cloud as an execution option; parser can map that directly to the existing Cloud artifact request path.

---

## Chapters

### 1. Work
*Agent: default*

- Made ricky run <artifact> --cloud the preferred Cloud artifact command: Made ricky run <artifact> --cloud the preferred Cloud artifact command
