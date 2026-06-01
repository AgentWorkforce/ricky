# Trajectory: Investigate blocked Ricky local workflow run

> **Status:** ✅ Completed
> **Confidence:** 90%
> **Started:** May 1, 2026 at 03:04 AM
> **Completed:** May 1, 2026 at 05:05 PM

---

## Summary

Improved Ricky CLI status UX: interactive Status now renders the real dashboard, compact headers use stored Cloud auth instead of stale config labels, Cloud 401s are treated as login-required, and Cloud agent harness mapping accepts provider-style names like google/gemini.

**Approach:** Standard approach

---

## Key Decisions

### Fallback local run route uses PATH agent-relay
- **Chose:** Fallback local run route uses PATH agent-relay
- **Reasoning:** Ricky status already treats a PATH-installed agent-relay as available, so run-now must not block solely because node_modules/.bin/agent-relay is absent. The no-install route is still used when the workspace-local package exists.

---

## Chapters

### 1. Work
*Agent: default*

- Fallback local run route uses PATH agent-relay: Fallback local run route uses PATH agent-relay
