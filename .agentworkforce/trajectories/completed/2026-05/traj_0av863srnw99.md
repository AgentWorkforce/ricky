# Trajectory: ricky-resolve-review-findings-workflow

> **Status:** ✅ Completed
> **Task:** df04948e1991ab1268aebbed
> **Confidence:** 92%
> **Started:** May 1, 2026 at 07:24 PM
> **Completed:** May 2, 2026 at 01:47 AM

---

## Summary

Updated Ricky local artifact runs to prefer positional ricky run <workflow>, suppress direct-run onboarding noise, render concise foreground summaries, and stream lightweight auto-fix progress. Verified with focused suites, typecheck, smoke commands, and full npm test.

**Approach:** Standard approach

---

## Key Decisions

### Made foreground local runs concise with opt-in progress callbacks
- **Chose:** Made foreground local runs concise with opt-in progress callbacks
- **Reasoning:** The previous renderer dumped full generation, execution, tails, recovery options, and repeated next actions. Direct artifact runs now show artifact, execution status, log paths, one compact reason, and short auto-fix status while auto-fix emits lightweight running/repairing/retrying progress.

---

## Chapters

### 1. Planning
*Agent: orchestrator*

### 2. Execution: review-fix-loop
*Agent: fixer*

- Made foreground local runs concise with opt-in progress callbacks: Made foreground local runs concise with opt-in progress callbacks
