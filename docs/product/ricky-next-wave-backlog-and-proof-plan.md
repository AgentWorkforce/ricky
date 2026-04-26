# Ricky Next-Wave Backlog and Proof Plan

## Purpose

This document defines the next bounded Ricky backlog after the current first-wave buildout. It is not a replacement for the product spec, and it does not create follow-on workflow files. Its job is to make the next workflow-authoring batch concrete enough that implementation and proof workflows can be authored without rediscovering priorities.

## Current State (as of 2026-04-27)

### What exists

Ricky is a real npm workspace with 6 `@ricky/*` packages, 34+ workflow files across waves 0-6, and a proven test foundation.

| Package | Implementation | Tests |
|---|---|---|
| `@ricky/shared` | Models, config, constants | Covered by runtime/product consumers |
| `@ricky/runtime` | Local coordinator, evidence capture, failure classifier, diagnostics engine, unblocker proof | 119 tests |
| `@ricky/product` | Spec intake, generation pipeline, debugger specialist, validator specialist, analytics | 70 tests |
| `@ricky/cloud` | Auth validation, workspace scoping, provider connect, generate endpoint, cloud proof | 88 tests |
| `@ricky/local` | Request normalizer, entrypoint, local proof | 49 tests |
| `@ricky/cli` | ASCII banner, welcome, mode selector, onboarding, command surface, interactive CLI, onboarding proof | 63 tests |

Root proof tests: 21 (smoke + package layout). All workspace and root tests pass.

### First-wave signoff: COMPLETE

The Wave 6 closure workflow (`wave6-proof/01-close-first-wave-signoff-and-blockers.ts`) ran on 2026-04-27 and closed all 16 previously unsigned product-build workflows. Result: **16/16 SIGNED_OFF, 0 BLOCKED.** Per-workflow signoff artifacts with validation commands and changed-file scope proofs are under `.workflow-artifacts/wave6-proof/close-first-wave-signoff-and-blockers/per-workflow/`.

Combined with the 15 workflows that already had signoff, all 31 product-build workflows now have signoff evidence. The two runtime debug canaries have separate signoff under `.workflow-artifacts/runtime-debug/`.

### What is proven

- TypeScript npm workspace builds and tests across all 6 packages.
- CLI renders ASCII banner, welcome, mode guidance; first-run and returning-user paths are distinct.
- Local/BYOH normalizes specs and returns structured artifacts or setup blockers.
- Cloud auth validates requests, scopes workspaces, guides provider setup, and generates artifacts.
- Failure classifier distinguishes all taxonomy categories.
- Generation pipeline selects patterns, loads skills, renders templates.
- Validators enforce structural checks and proof loops.
- Analytics analyzes health and generates digests.
- Overnight batch infrastructure supports flight-safe and expanded queue modes with checkpoint/resume.

### What is NOT proven

- No user journey crosses more than one subsystem boundary end-to-end.
- No real `agent-relay` execution with outcome artifacts.
- No Slack surface exists.
- No Web surface exists.
- No MCP/assistant handoff surface exists.
- No proactive failure detection or notification.
- No restart/rerun specialist.
- No Agent Assistant package composition.
- CLI UX spec target commands (`setup`, `welcome`, `generate`, `status`, `--quiet`, `--no-banner`) are specified but not all fully wired.

### CLI/Banner UX deliverable boundary

The CLI/banner UX spec (`docs/product/ricky-cli-onboarding-ux-spec.md`) is a completed near-term deliverable and regression contract. Follow-on workflows should implement conformance or prove the implementation follows the spec. They should not restate the entire UX spec.

---

## What the First 16-Workflow Wave Already Covers

The original 16-workflow batch covered:

| Wave | Scope | Result |
|---|---|---|
| Wave 0: Foundation (4) | Repo standards, toolchain, shared models, architecture docs | All signed off. Real tsconfig, vitest, shared types. |
| Wave 1: Runtime (3) | Local coordinator, evidence model, failure classification | All signed off. Coordinator, evidence capture, classifier with full taxonomy. |
| Wave 2: Product (4) | Spec intake, generation pipeline, debugger, validator | All signed off. Parser, normalizer, router, pattern selector, skill loader, template renderer, specialists. |
| Wave 3: Cloud (2) | Cloud auth, generate endpoint | All signed off. Request validation, workspace scoping, provider connect, generate API. |
| Wave 4: Local/BYOH (2) | CLI onboarding, local invocation | All signed off. ASCII welcome, mode selector, request normalizer, local entrypoint. |
| Wave 5: Scale (1) | Workflow health analytics | Signed off. Health analyzer, digest generator. |

Beyond the original 16, follow-on workflows expanded coverage: failure diagnosis engine, runtime unblocker proof, cloud generate slice, cloud connect proof, CLI UX spec, CLI onboarding implementation, CLI proof, local BYOH entrypoint, local spec handoff proof, interactive CLI, CLI command surface, package conventions, package layout proof, and workspace package split. All now signed off.

---

## Product and Workflow Gaps Remaining

### Missing surfaces (SPEC co-equal surfaces)

| Surface | SPEC Reference | Status | Priority |
|---|---|---|---|
| Slack | 5.1, 7.1, 7.2, 7.6, 8.2.A | **Not started** | **High** |
| MCP/assistant handoff | 5.1, 7.3, 8.2.A | **Not started** | **High** |
| Web | 5.1, 8.2.A | **Not started** | Medium |

### Missing product capabilities

| Capability | SPEC Reference | Status | Priority |
|---|---|---|---|
| Proactive failure notification | 5.2, 7.6, 8.2.F | **Not started** | **High** (core differentiator) |
| Restart/rerun specialist | 7.1, 8.2.C | **Not started** | **High** |
| Real agent-relay execution proof | 5.4, 7.4, 13 | Typed but not wired | **High** |
| Agent Assistant composition | 2, 3.2, 8.1 | Currently standalone | Medium |
| Cloud deployment artifacts | 9 | No worker/infra | Low |
| Cataloging/scheduled analytics jobs | 8.2.F | Health analyzer exists, no scheduled jobs | Low |
| Full CLI UX spec conformance | UX spec | Spec exists, partial implementation | Medium |

### Missing end-to-end proof

None of these user journeys are proven:

1. User hands Ricky a spec via Slack and receives a generated workflow artifact back.
2. User hands a spec from Claude via MCP and Ricky normalizes, generates, and returns results.
3. Ricky proactively detects a workflow failure and notifies with diagnosis.
4. Ricky coordinates a real `agent-relay` run locally with outcome artifacts.
5. Ricky restarts a failed workflow safely after classifying the failure.
6. Full local path: CLI spec -> normalize -> generate -> validate -> execute -> outcome.
7. Full Cloud path: auth -> scope -> normalize -> generate -> artifact bundle.

---

## Bounded Next Batch: Wave 7 — Surfaces, Integration, and End-to-End Proof

### Why Wave 7

Wave 6 was proof debt closure. All 16 unsigned workflows are now signed off. The next batch should open new surfaces and prove end-to-end journeys.

### Batch size: 14 workflows

5 implementation, 9 proof. The proof-heavy ratio is deliberate: Ricky's internals exist and are tested. What needs proving is that they connect to real surfaces, real execution, and complete user journeys.

---

### Batch A — Slack surface (2 workflows)

**Why:** Slack is the highest-leverage interactive surface in AgentWorkforce. Without it, Ricky is CLI-only for interactive use.

**SPEC connection:** 5.1, 7.1, 7.2, 7.6, 8.2.A

| # | Workflow | Type | Scope |
|---|---|---|---|
| 01 | `wave7-surfaces/01-implement-slack-ingress.ts` | Implementation | Webhook handler (sig verify, dedup, threads), outbound delivery, health route, router integration. New package: `packages/slack/`. Mirror proven patterns from Sage/NightCTO. |
| 02 | `wave7-surfaces/02-prove-slack-spec-to-artifact.ts` | Proof | Prove Slack message reaches intake, triggers generation, returns formatted artifact in same thread. Error states produce friendly messages, not stack traces. |

**Proof bar:**
- Signature verification, dedup, thread routing tested deterministically.
- Spec message -> generation -> artifact return proven.
- Error states produce Slack-friendly recovery messages.

**Primary files:** `packages/slack/src/webhook-handler.ts`, `packages/slack/src/outbound.ts`, `packages/slack/src/router.ts`, `packages/slack/src/types.ts`, tests.

### Batch B — MCP/assistant handoff (2 workflows)

**Why:** SPEC 7.3 declares spec handoff from Claude as first-class, not a nice-to-have. Users should be able to draft a spec in Claude and hand it directly to Ricky.

**SPEC connection:** 5.1, 7.3, 8.2.A

| # | Workflow | Type | Scope |
|---|---|---|---|
| 03 | `wave7-surfaces/03-implement-mcp-handoff-surface.ts` | Implementation | MCP tool definitions (generate, debug, coordinate, status), request normalization, response formatting, domain routing. New package: `packages/mcp/`. |
| 04 | `wave7-surfaces/04-prove-mcp-spec-handoff-and-return.ts` | Proof | Prove MCP tool call with natural-language spec normalizes identically to CLI and returns structured results. |

**Proof bar:**
- MCP calls route through the same intake pipeline as CLI.
- Parity test: same spec produces equivalent normalized request from CLI and MCP.
- Error states return structured MCP tool errors.

**Primary files:** `packages/mcp/src/tools.ts`, `packages/mcp/src/normalizer.ts`, `packages/mcp/src/types.ts`, tests.

### Batch C — Proactive failure notification (2 workflows)

**Why:** Without proactive detection, Ricky only reacts when asked. This is the core differentiator from Sage.

**SPEC connection:** 5.2, 7.6, 8.2.F
**Failure taxonomy connection:** All categories — proactive detection reuses the existing classifier.

| # | Workflow | Type | Scope |
|---|---|---|---|
| 05 | `wave7-proactive/05-implement-proactive-failure-detection.ts` | Implementation | Signal ingestion from Cloud run state, urgency/recurrence classification using failure taxonomy, notification assembly with diagnosis + recommended next actions, delivery routing (Slack initially). Run-state signals consumed via a defined fixture contract (not live Cloud infrastructure). Files: `packages/product/src/proactive/`. |
| 06 | `wave7-proactive/06-prove-proactive-notification-loop.ts` | Proof | Prove simulated failure signals produce classified notifications with taxonomy-specific diagnosis. Different categories produce different content. Recurrence detection flags repeats. |

**Proof bar:**
- Different failure taxonomy categories produce different notification content.
- Urgency classification affects priority.
- Notifications include diagnosis and recommended next action, not just "workflow failed."
- Recurrence detection flags repeat failures.

**Primary files:** `packages/product/src/proactive/detector.ts`, `packages/product/src/proactive/notification-builder.ts`, `packages/product/src/proactive/types.ts`, tests.

### Batch D — Restart specialist (2 workflows)

**Why:** Ricky must not just diagnose failures — it should evaluate restart safety and coordinate execution.

**SPEC connection:** 7.1, 8.2.C
**Failure taxonomy connection:** `agent_runtime.handoff_stalled`, `environment.relay_state_contaminated`, `workflow_structure.control_flow_invalid`

| # | Workflow | Type | Scope |
|---|---|---|---|
| 07 | `wave7-runtime/07-implement-restart-specialist.ts` | Implementation | Safety evaluation per failure classification, mode selection (full restart, partial rerun, narrower scope), preflight environment checks, restart coordination through local coordinator. Files: `packages/product/src/specialists/restart/`. |
| 08 | `wave7-runtime/08-prove-restart-safety-and-execution.ts` | Proof | Prove: `handoff_stalled` -> restart narrowly; `relay_state_contaminated` -> quarantine then restart; `control_flow_invalid` -> block restart, recommend fix. Preflight detects stale `.agent-relay/`. |

**Proof bar:**
- Different failure categories produce different restart decisions.
- Unsafe restarts are blocked with explanation and fix recommendation.
- Preflight detects stale `.agent-relay/`, `.relay/`, `.trajectories/` state.
- All restart attempts produce evidence artifacts with before/after state.

**Primary files:** `packages/product/src/specialists/restart/safety-evaluator.ts`, `packages/product/src/specialists/restart/coordinator.ts`, `packages/product/src/specialists/restart/types.ts`, tests.

### Batch E — End-to-end execution proof (3 workflows)

**Why:** Individual subsystems are tested in isolation. No proof exists that the full user journey works from spec to execution to outcome.

**SPEC connection:** 7.1, 7.2, 7.4, 14

| # | Workflow | Type | Scope |
|---|---|---|---|
| 09 | `wave7-proof/09-prove-local-spec-to-execution-loop.ts` | Proof | Full local/BYOH path: CLI spec -> normalize -> generate -> validate (80-to-100) -> local coordinator execution -> outcome artifacts. Works without Cloud. Execution mode: controlled local subprocess with fixture-backed `agent-relay` state (not live relay execution). The workflow file must lock the acceptance mode during its planning step. |
| 10 | `wave7-proof/10-prove-cloud-spec-to-artifact-return.ts` | Proof | Full Cloud API path: authenticated request -> workspace scoping -> normalize -> generate -> artifact bundle + warnings + follow-ups. Missing provider state surfaced explicitly. |
| 11 | `wave7-proof/11-prove-cli-surface-honesty-and-empty-handoff.ts` | Proof | Interactive CLI does not advertise non-existent commands, does not invoke runtime with empty spec, exits honestly when no handoff exists. Verifies CLI against actual repo state. |

**Proof bar:**
- At least one full user journey proven for both local and Cloud.
- CLI honesty verified: no ghost commands, no empty-spec execution, honest recovery.
- All existing tests still pass after changes.

### Batch F — Agent Assistant composition (2 workflows)

**Why:** SPEC says Ricky should compose Agent Assistant packages, not be standalone. Currently standalone.

**SPEC connection:** 2, 3.2, 8.1

| # | Workflow | Type | Scope |
|---|---|---|---|
| 12 | `wave7-integration/12-implement-agent-assistant-composition.ts` | Implementation/spec | Evaluate which `@agent-assistant/*` packages to compose first (likely `turn-context` for turn shaping or `surfaces` for Slack). Implement first integration point. Document composition boundary. |
| 13 | `wave7-integration/13-prove-agent-assistant-integration-seam.ts` | Proof | At least one Agent Assistant package imported and used in a real code path. All existing tests still pass. Integration seam documented with clear boundary rules. |

**External dependency gate:** Batch F depends on `@agent-assistant/*` packages being available and stable. If those packages are not ready at authoring time, implement the composition boundary as a typed interface with a stub implementation and defer real package integration to Wave 8. The proof workflow should verify the seam contract is consumable by downstream code, not that a specific package version works.

**Proof bar:**
- Real Agent Assistant package used in production code path, not just type re-exports — OR, if packages unavailable, composition interface proven consumable with stub and documented upgrade path.
- Integration seam documented with clear boundary rules.
- All existing tests still pass.

### Batch G — CLI UX conformance (1 workflow)

**Why:** The CLI UX spec defines target commands (`setup`, `welcome`, `generate`, `status`, `--quiet`, `--no-banner`) that are not all fully wired. This is the near-term deliverable that proves Ricky's first user-facing surface is honest.

| # | Workflow | Type | Scope |
|---|---|---|---|
| 14 | `wave7-proof/14-prove-cli-ux-spec-full-conformance.ts` | Proof | Every command and flag in the UX spec either works as specified or is explicitly listed as a bounded gap. Non-TTY, quiet, no-banner, first-run, returning-user, missing config, narrow terminal all proven. |

**Proof bar:**
- Deterministic tests for each target command and flag.
- Help output does not advertise unavailable flows.
- Non-TTY suppresses decorative banner and interactive prompts.
- Recovery copy for missing toolchain, missing Cloud auth, stale local state, corrupted config.

---

## Failure Taxonomy Integration Across Wave 7

| Taxonomy category | Where it appears |
|---|---|
| `agent_runtime.handoff_stalled` | Restart specialist safety evaluation, proactive notification content |
| `agent_runtime.progress_opaque` | Proactive notification urgency classification |
| `environment.relay_state_contaminated` | Restart specialist preflight checks, end-to-end local execution proof |
| `workflow_structure.control_flow_invalid` | Restart specialist blocks restart and recommends fix |
| `workflow_structure.scope_gate_weak` | Validator specialist in end-to-end proof path |
| `validation_strategy.repo_mismatch` | End-to-end proof must use truthful validation, not aspirational commands |

---

## Sequencing and Dependencies

```
Batch A (Slack) ────────────────────┐
                                    ├── Batch E (end-to-end proof)
Batch B (MCP handoff) ─────────────┤
                                    │
Batch C (proactive) ── needs Slack for delivery routing
                                    │
Batch D (restart) ── independent of surfaces
                                    │
Batch F (Agent Assistant) ── can parallel with A+B
                                    │
Batch G (CLI conformance) ── independent, can start immediately
```

Recommended execution order:

1. **Batch A + B in parallel** — Slack and MCP are independent implementations and the highest-leverage gaps.
2. **Batch G in parallel with A+B** — CLI conformance is independent and keeps the near-term deliverable sharp.
3. **Batch C** — Proactive notifications need Slack delivery surface from Batch A.
4. **Batch D** — Restart specialist can start in parallel with Batch C.
5. **Batch E** — End-to-end proof should run after surfaces exist.
6. **Batch F** — Agent Assistant composition can start anytime but should prove integration after surfaces stabilize.

Dependencies:

| Workflow | Depends on |
|---|---|
| 01 implement-slack-ingress | Existing product spec-intake and generation pipeline |
| 02 prove-slack-spec-to-artifact | 01 |
| 03 implement-mcp-handoff-surface | Existing product spec-intake pipeline |
| 04 prove-mcp-spec-handoff-and-return | 03 |
| 05 implement-proactive-failure-detection | Failure classifier, 01 (for Slack delivery) |
| 06 prove-proactive-notification-loop | 05 |
| 07 implement-restart-specialist | Failure classifier, local coordinator |
| 08 prove-restart-safety-and-execution | 07 |
| 09 prove-local-spec-to-execution-loop | Local entrypoint, generation, validator, local coordinator |
| 10 prove-cloud-spec-to-artifact-return | Cloud generate endpoint, auth, generation |
| 11 prove-cli-surface-honesty-and-empty-handoff | CLI command surface |
| 12 implement-agent-assistant-composition | Agent Assistant packages available |
| 13 prove-agent-assistant-integration-seam | 12 |
| 14 prove-cli-ux-spec-full-conformance | CLI UX spec, CLI command surface |

---

## Sub-Batch Checkpoints

Wave 7 is the largest batch yet (14 workflows vs. prior waves of 1–4). To maintain execution discipline, the wave uses three sub-batch checkpoints with explicit go/no-go criteria.

### Checkpoint 1 — After Batches A + B + G (5 workflows)

**Go criteria:** Slack ingress receives and routes messages with signature verification and dedup. MCP tool calls normalize specs through the existing intake pipeline. CLI UX spec conformance gaps are bounded and documented. All existing tests still pass.

**No-go signal:** If Slack or MCP implementation reveals that the existing spec-intake pipeline needs structural changes, pause Batches C–F and resolve intake issues first. Do not build proactive notifications or restart on top of a pipeline that is about to change.

### Checkpoint 2 — After Batches C + D (4 workflows)

**Go criteria:** Proactive notifications produce taxonomy-specific content and route through Slack. Restart specialist blocks unsafe restarts and produces evidence artifacts. All existing and new tests pass.

**No-go signal:** If proactive detection requires Cloud run-state infrastructure that does not exist locally, scope the implementation to fixture-backed detection with a documented "live signal" gap. Do not open Cloud infrastructure work inside Wave 7.

### Checkpoint 3 — After Batches E + F (5 workflows)

**Go criteria:** At least one end-to-end journey proven for local and Cloud paths. Agent Assistant integration uses a real package in a real code path. CLI honesty verified. All tests pass. Wave 7 signoff can proceed.

**No-go signal:** If Agent Assistant packages (`@agent-assistant/*`) are not available or not stable enough for production use at authoring time, Batch F should implement the composition boundary and integration seam as a documented interface with a stub, and defer the real package import to Wave 8. The proof workflow should verify the seam contract is consumable, not that a specific package version works. This keeps Batch F useful without blocking on an external dependency.

---

## Proof Expectations

### Implementation workflows
Every implementation workflow must produce:
- Focused tests exercising the new module's primary behavior.
- An artifact or fixture proving the module can be used by downstream consumers.
- Regression pass: all existing tests still pass.

### Proof workflows
Every proof workflow must produce:
- Slice-level or end-to-end evidence, not just TypeScript compilation.
- Deterministic fixtures for happy path and error states.
- Failure evidence using the existing taxonomy when applicable.
- A signoff artifact with validation commands and scope proof.

### 80-to-100 bar
- No workflow claims "done" without deterministic proof that user-facing behavior works.
- Regression gate: all existing tests must pass after every change.
- Failure taxonomy categories must appear in real product paths, not just test fixtures.
- End-to-end proof must exercise the full journey, not just subsystem boundaries.
- Honest run summaries distinguish product logic failures from environment blockers, runtime handoff failures, orchestration bugs, and validation-strategy mismatches.

---

## What Should Wait Until After Wave 7

| Area | Why it waits |
|---|---|
| Web surface | Slack and MCP are higher leverage; web can reuse patterns from both after they are proven. |
| Full autonomous repair | Restart specialist is the bounded first step; broad repair needs proven safety policy from restart evidence. |
| Cataloging/scheduled analytics jobs | Health analyzer exists; scheduled jobs need Cloud deployment infrastructure first. |
| Cloud deployment (worker/infra) | Requires Slack and proactive paths before deployment is meaningful. |
| Multi-provider workflow generation | Core Relay-native generation must be proven end-to-end first. |
| RelayFile-backed evidence substrate | Current evidence model works; RelayFile integration is an optimization, not a blocker. |
| Broad Slack app polish | Get the basic Slack path working and proven before polishing interactive features. |

---

## Recommendation: What to Build Immediately After CLI Onboarding UX Spec

The CLI onboarding UX spec is complete. The signoff gap is closed. The immediate next actions are:

1. **Slack ingress implementation (Batch A, workflow 01)** — highest-leverage missing surface.
2. **MCP handoff implementation (Batch B, workflow 03)** — can run in parallel with Slack.
3. **CLI UX conformance proof (Batch G, workflow 14)** — locks the near-term deliverable while surfaces are being built.

These three actions open the two highest-leverage new surfaces while keeping the CLI deliverable honest.

---

## Decision

Build **Wave 7 — Surfaces, Integration, and End-to-End Proof** as a bounded 14-workflow batch: 5 implementation workflows and 9 proof workflows. The batch opens Slack and MCP surfaces, adds proactive failure detection, implements the restart specialist, proves end-to-end user journeys for local and Cloud, begins Agent Assistant composition, and verifies CLI UX spec conformance. Defer web surface, Cloud deployment, and scheduled analytics to Wave 8.
