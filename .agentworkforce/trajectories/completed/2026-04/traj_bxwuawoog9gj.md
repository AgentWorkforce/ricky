# Trajectory: Fix Nango integration connect workspace/auth flow

> **Status:** ✅ Completed
> **Confidence:** 90%
> **Started:** April 30, 2026 at 05:21 PM
> **Completed:** April 30, 2026 at 05:23 PM

---

## Summary

Fixed multi-step connect order, added workspace-scoped Nango connect-link requests, improved Cloud failure diagnostics, and verified current Cloud returns 404 for the probed Nango endpoint.

**Approach:** Standard approach

---

## Key Decisions

### Send workspace context when requesting Nango connect links
- **Chose:** Send workspace context when requesting Nango connect links
- **Reasoning:** Cloud integration authorization is workspace scoped; Ricky was only posting integration/provider and made every non-url response look the same.

### Run Cloud login before optional integrations in multi-step connect
- **Chose:** Run Cloud login before optional integrations in multi-step connect
- **Reasoning:** Nango connect links depend on current Cloud auth and workspace context; the previous ordering produced integration failures before the selected Cloud login step ran.

---

## Chapters

### 1. Work
*Agent: default*

- Send workspace context when requesting Nango connect links: Send workspace context when requesting Nango connect links
- Run Cloud login before optional integrations in multi-step connect: Run Cloud login before optional integrations in multi-step connect
