# Trajectory: Fix master executor workflow snapshot printf gate

> **Status:** ✅ Completed
> **Confidence:** 95%
> **Started:** May 7, 2026 at 01:26 PM
> **Completed:** May 7, 2026 at 01:26 PM

---

## Summary

Fixed the snapshot-current-code gate in wave13 master executor workflow by changing leading-dash printf format strings to safe '%s' format usage. Re-ran npx tsc --noEmit and agent-relay dry-run successfully.

**Approach:** Standard approach

---

## Key Decisions

### Patch snapshot printf labels to portable format strings
- **Chose:** Patch snapshot printf labels to portable format strings
- **Reasoning:** The child workflow failed because sh printf treated a leading --- format as an option; using printf '%s\n' with the label as an argument avoids shell-specific option parsing.

---

## Chapters

### 1. Work
*Agent: default*

- Patch snapshot printf labels to portable format strings: Patch snapshot printf labels to portable format strings
