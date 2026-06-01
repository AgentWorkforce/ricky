# Trajectory: Investigate spec ambiguity question flow

> **Status:** ✅ Completed
> **Confidence:** 84%
> **Started:** May 7, 2026 at 10:18 AM
> **Completed:** May 7, 2026 at 10:19 AM

---

## Summary

Investigated how Ricky should ask user-facing clarification questions when workflow specs are ambiguous. Found current goal-only clarification, route-level suggestedFollowUp strings, local response nextActions, Cloud assumptions/followUpActions, and one-shot Workforce persona response contract. Recommended structured clarification questions before generation plus a persona needs_clarification response relayed by Ricky surfaces.

**Approach:** Standard approach

---

## Key Decisions

### Model ambiguity as structured clarification requests before generation
- **Chose:** Model ambiguity as structured clarification requests before generation
- **Reasoning:** Current intake only has suggestedFollowUp strings and goal-only CLI prompts; a reusable question contract can serve CLI, API, Slack/MCP, and persona handoff without forcing best-effort workflow authoring.

---

## Chapters

### 1. Work
*Agent: default*

- Model ambiguity as structured clarification requests before generation: Model ambiguity as structured clarification requests before generation
- Investigation found the natural insertion point: deterministic spec intake can emit clarification questions, and the Workforce persona writer can return a needs_clarification contract that Ricky relays through CLI/API/Slack instead of writing an assumed workflow.
