# Trajectory: Reproduce and fix workflow-node IPC pipe deadlock

> **Status:** ✅ Completed
> **Confidence:** 90%
> **Started:** May 10, 2026 at 10:06 PM
> **Completed:** May 10, 2026 at 10:17 PM

---

## Summary

Reproduced workflow-node broker stdout pipe wedge from the provided diagnostics and fixed Ricky's SDK workflow preload to resume and drain agent-relay-broker stdout after the SDK startup reader pauses it. Added a regression that floods a fake broker stdout pipe and proves the workflow node completes. Verified with typecheck and full npm test.

**Approach:** Standard approach

---

## Key Decisions

### Patch workflow preload to drain broker stdout
- **Chose:** Patch workflow preload to drain broker stdout
- **Reasoning:** Reproduction showed AgentRelayClient.spawn stops draining broker stdout after startup; a workflow-node preload can patch child_process.spawn before the SDK imports it, adding a no-op drain only for agent-relay-broker init children without forking SDK files.

---

## Chapters

### 1. Work
*Agent: default*

- Patch workflow preload to drain broker stdout: Patch workflow preload to drain broker stdout
- Reproduced broker stdout pipe wedge and verified preload drain fix with focused regression
