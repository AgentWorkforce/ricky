# Trajectory: Scope relayflows workflow move SDK wiring

> **Status:** ✅ Completed
> **Confidence:** 82%
> **Started:** May 29, 2026 at 01:50 PM
> **Completed:** May 29, 2026 at 01:53 PM

---

## Summary

Scoped relay-to-relayflows workflow migration. Ricky has no ../relay filesystem dependency; migration touches SDK import compatibility, CLI command text/preflight, generator templates, validator checks, and local runtime loader. relayflows itself currently fails typecheck due primitive workspace package build visibility and @agent-relay/cloud export mismatch, so those must be fixed before Ricky can switch consumers.

**Approach:** Standard approach

---

## Key Decisions

### Scope relayflows as workflow runtime package boundary
- **Chose:** Scope relayflows as workflow runtime package boundary
- **Reasoning:** Ricky has no ../relay path dependency; the move is primarily import/CLI compatibility from @agent-relay/sdk/workflows and agent-relay run to @relayflows/core and relayflows run, plus relayflows core still depends on Agent Relay SDK, config, cloud, and primitives.

---

## Chapters

### 1. Work
*Agent: default*

- Scope relayflows as workflow runtime package boundary: Scope relayflows as workflow runtime package boundary
- Found relayflows typecheck blocked by unresolved primitive workspace builds and @agent-relay/cloud export mismatch; Ricky migration is a consumer compatibility layer problem plus generated-artifact template update.
