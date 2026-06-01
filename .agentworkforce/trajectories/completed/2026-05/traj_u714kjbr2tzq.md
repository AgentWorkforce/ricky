# Trajectory: Investigate PR 480 webhook secret usage

> **Status:** ✅ Completed
> **Confidence:** 86%
> **Started:** May 7, 2026 at 02:54 PM
> **Completed:** May 8, 2026 at 04:05 PM

---

## Summary

Added Ricky eval suite and local OpenCode provider execution path, opened and updated PR #74, validated offline evals/typecheck, and documented free OpenCode model usage.

**Approach:** Standard approach

---

## Key Decisions

### Run Workforce persona writer for master workflow generation
- **Chose:** Run Workforce persona writer for master workflow generation
- **Reasoning:** Ricky's CLI already opts into the Workforce persona writer by default, but generateWithWorkforcePersona returned early whenever the deterministic generator produced a master execution plan. That made broad specs silently bypass persona authoring.

### Clarification answers are appended to the spec and generation is retried once
- **Chose:** Clarification answers are appended to the spec and generation is retried once
- **Reasoning:** Ricky should ask concrete unresolved-spec questions interactively and feed answers back into the existing generation path without inventing a separate workflow-generation branch.

### Match clarification answers to specific questions
- **Chose:** Match clarification answers to specific questions
- **Reasoning:** PR feedback showed that a blanket Clarification answers marker could hide later unresolved TBD items, so the intake now filters only answered question text and keeps remaining blockers active.

### Use @agent-assistant/telemetry human eval primitives for Ricky eval scaffolding
- **Chose:** Use @agent-assistant/telemetry human eval primitives for Ricky eval scaffolding
- **Reasoning:** Ricky needs product-owned cases and rubrics, while the sibling Agent Assistant package now owns shared JSONL loading, markdown compilation, deterministic checks, and run artifacts.

### Keep telemetry eval helpers as a dev dependency
- **Chose:** Keep telemetry eval helpers as a dev dependency
- **Reasoning:** Ricky's runtime path only needs @agent-assistant/turn-context; @agent-assistant/telemetry is used by local eval scripts and should not expand the published runtime dependency surface.

### Use Workforce router default tier for workflow authoring
- **Chose:** Use Workforce router default tier for workflow authoring
- **Reasoning:** Ricky was forcing best tier and bypassing the router's lower-latency best-value default; honoring router selection keeps persona authoring while reducing startup and model latency.

### Perform full Ricky eval sweep from existing specs and docs
- **Chose:** Perform full Ricky eval sweep from existing specs and docs
- **Reasoning:** The initial eval scaffold seeded high-signal cases; the user asked for a fuller sweep, so new cases should be explicitly derived from existing product specs, architecture docs, workflow standards, and proof documents.

### Address PR 73 feedback in PR worktree
- **Chose:** Address PR 73 feedback in PR worktree
- **Reasoning:** The original checkout has unrelated dirty files, so keeping PR feedback changes in the clean PR worktree avoids contaminating the branch.

### Preserve installRoot on runnable Workforce fallback
- **Chose:** Preserve installRoot on runnable Workforce fallback
- **Reasoning:** PR feedback correctly identified that usePersona can be a runnable fallback, not just metadata selection; metadata probes should omit installRoot while runnable fallback should pass it and retry without it for non-Claude harnesses.

### Add direct opencode eval executor as first provider path
- **Chose:** Add direct opencode eval executor as first provider path
- **Reasoning:** Agent Assistant already proves opencode one-shot semantics with opencode run -m <model> <prompt>; direct execution keeps Ricky evals free of OpenRouter credentials while leaving agent-relay orchestration for heavier tool/worker evals.

---

## Chapters

### 1. Work
*Agent: default*

- Run Workforce persona writer for master workflow generation: Run Workforce persona writer for master workflow generation
- Clarification answers are appended to the spec and generation is retried once: Clarification answers are appended to the spec and generation is retried once
- Match clarification answers to specific questions: Match clarification answers to specific questions
- Use @agent-assistant/telemetry human eval primitives for Ricky eval scaffolding: Use @agent-assistant/telemetry human eval primitives for Ricky eval scaffolding
- Keep telemetry eval helpers as a dev dependency: Keep telemetry eval helpers as a dev dependency
- Ricky eval scaffolding is in place: latest @agent-assistant/turn-context is installed, @agent-assistant/telemetry powers local eval scripts, CLI regression cases pass, and workflow-authoring cases create human-review worksheets for manual expansion.
- Use Workforce router default tier for workflow authoring: Use Workforce router default tier for workflow authoring
- Perform full Ricky eval sweep from existing specs and docs: Perform full Ricky eval sweep from existing specs and docs
- Created PR 73 from a clean worktree for the Workforce workflow writer latency fix; original checkout left with only unrelated pre-existing dirty files.
- Full eval sweep expanded Ricky to 44 cases across CLI behavior, workflow authoring, runtime recovery, surfaces/ingress, generation quality, and Agent Assistant boundaries. The sweep is doc-derived and compiles/runs cleanly with 2 deterministic passes and 42 human-review cases.
- Address PR 73 feedback in PR worktree: Address PR 73 feedback in PR worktree
- Preserve installRoot on runnable Workforce fallback: Preserve installRoot on runnable Workforce fallback
- Add direct opencode eval executor as first provider path: Add direct opencode eval executor as first provider path
- PR 73 feedback addressed by separating metadata selection options from runnable fallback options, preserving installRoot for Claude-backed fallback and adding retry coverage for non-Claude installRoot rejection.
- Added local OpenCode eval execution to the existing Ricky human-eval sweep; offline baseline still passes and PR #74 now documents free-model runs plus the 60s smoke timeout caveat.

---

## Artifacts

**Commits:** 39f581e, d291798, 5c5e10e, 0bb2b97, ab400a6, c09f7ef, cf38691, 5d00fbb, 4fee485, bfa98ae, 0db07ec, 19c958b, 18ca8b6, 8abe0a8, 14f2e28, 3cc6b20, bdf0e7b, fd2be04, efe4b22, c2a6f1c, 6198c2a, 82a1533, 11ef7b9, 0ee235c, 6f36c1d, 7dc2fd4, d84885e, 56c1430, 1c3da09, 3ab54f6, 4486ef8, beb1651, f352755, 7d7a9bb, e769fba, 4d166a3, 76fa79f, 4124968, f60589b, 97d372d, 7b44f78, 8ec59c2, 6208aed, 61cd072, 6ad9707, 9fc1683, cb9a67a, 2b26cb3, 81c45b6, 16f61b1, 17dc383, 85ad4f1, 0b19805, dbd1e90, b7308e5, a4409c2, f3be062, 20b7eb7, 3dcb6bd, 3fe00d4, 480a9cd, ad3ca41, f35866e, 4234544, 34d9d19, e1f0853, b88d324, cfecea0, 489d2ff, 7d19761, 3c09bbd, b276356, a81a46e, 9fc4a5f, 3c408cc, d15f42f, fce3243, f2bddec, 2ec0b75, 75cb5d0, 4176132, 2262390, f063ee4, f613e30, f244728, d6a7b04, 03a4a41, 01b0f8b, 0c32e4c, 3f4cf79, e35b2d9, 5d4f504, b910dda, fd1463c, 02f13c3, 94edad1, 0d8de5d, 756632f, 4b39a27, 3f95ba9, f8d867c, b4c5ad0, 462d210, e84eee0, 28d4a01, 13678ff, 3bb561b, 7af7502, 8650861, 36086ae, dfad022, 287cb2e, 4a62a51, 58773ee, 0e68073, 0435b72, e8dae35, 3f9f5ee
**Files changed:** 84
