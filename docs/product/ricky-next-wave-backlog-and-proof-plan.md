# Ricky Next-Wave Backlog and Proof Plan

## 1. Purpose

Turn the work that remains after Ricky's first five waves into an explicit, bounded, proof-oriented next batch.

This document exists so Ricky does not drift from:
- a bounded workflow program with clear proof gates
- truthful end-to-end execution expectations
- co-equal surface coverage across CLI, Slack, MCP, local/BYOH, and Cloud
- productized unblocker knowledge from the failure taxonomy
- real 80-to-100 proof rather than compile-only optimism

## 2. What the first wave program already covers

### 2.1 Workflow inventory

The first wave program expanded from the original 16-workflow plan to 28 authored workflow files across five waves:

| Wave | Workflows | Status |
|---|---|---|
| Wave 0 — Foundation | 4 workflows + 2 debug workflows | Implemented: repo standards, toolchain, shared models, architecture docs |
| Wave 1 — Runtime | 5 workflows | Implemented: local coordinator, evidence model, failure classification, diagnosis engine, unblocker proof |
| Wave 2 — Product Core | 4 workflows | Implemented: spec intake, generation pipeline, debugger specialist, validator specialist |
| Wave 3 — Cloud API | 4 workflows | Implemented: cloud auth, generate endpoint, cloud generate slice, cloud connect proof |
| Wave 4 — Local/BYOH | 9 workflows | Implemented: CLI onboarding, local invocation, CLI UX spec, onboarding implementation, onboarding proof, local BYOH entrypoint, local spec handoff proof, interactive CLI, CLI command surface |
| Wave 5 — Scale and Ops | 4 workflows | Implemented: workflow health analytics, next-wave backlog, package conventions alignment, package layout proof |

### 2.2 Implementation coverage

The `src/` tree now contains real implementation across all major product areas:

- **Shared foundation** — models, config, constants
- **Runtime** — local coordinator, evidence capture, failure classifier, diagnostics engine with unblocker proof
- **Product core** — spec intake (parser, normalizer, router), generation pipeline (pattern selector, skill loader, template renderer), debugger specialist (diagnosis, fix recommender), validator specialist (structural checks, proof loop)
- **CLI** — welcome, ASCII art, mode selector, onboarding with proof tests
- **Interactive entrypoint** — CLI main command surface with `npm start`
- **Local/BYOH** — entrypoint, request normalizer, local entrypoint proof
- **Cloud** — auth (request validator, workspace scoping, provider connect), API (generate endpoint, cloud generate proof)
- **Analytics** — health analyzer, digest generator

### 2.3 Test coverage

21 test files with 389 passing tests. Proof tests exist for:
- CLI onboarding first-run and recovery paths
- Local entrypoint spec handoff and artifact return
- Cloud generate happy path
- Runtime unblocker paths across failure taxonomy categories
- Package layout and script parity

### 2.4 What the first waves prove

The first waves prove that Ricky has:
- a real TypeScript and Vitest foundation with truthful validation
- a working CLI onboarding experience with ASCII welcome, mode selection, and provider guidance
- local/BYOH and Cloud execution paths that can normalize specs and return artifacts
- failure classification and diagnosis that distinguishes blocker categories
- a generation pipeline that selects patterns and loads skills
- deterministic proof tests that exercise user-visible behavior, not just internal plumbing

### 2.5 CLI/banner UX deliverable boundary

The CLI/banner UX spec is its own near-term deliverable, not something to bury inside the next backlog batch. It is already represented by `workflows/wave4-local-byoh/03-cli-onboarding-ux-spec.ts` and `docs/product/ricky-cli-onboarding-ux-spec.md`, and it defines the banner, ASCII-art, first-run, returning-user, local/BYOH, Cloud, and recovery copy contracts.

The follow-on implementation and onboarding proof work from Wave 4 used that spec as the source of truth. Wave 6 should therefore treat the CLI/banner spec as a completed prerequisite and regression contract, not reopen it unless later product feedback shows the banner or onboarding contract is wrong.

## 3. What the first waves do NOT yet prove

Despite significant implementation progress, Ricky still has concrete product gaps against the SPEC:

### 3.1 Missing surfaces

| Surface | SPEC status | Implementation status |
|---|---|---|
| CLI | Co-equal surface | Implemented and proven |
| Local/BYOH | Co-equal surface | Implemented and proven |
| Cloud API | Co-equal surface | Implemented and proven |
| **Slack** | Co-equal surface | **Not started — no `src/slack/`** |
| **Web** | Co-equal surface | **Not started — no `src/web/`** |
| **MCP/assistant handoff** | First-class journey (SPEC 5.1, 7.3) | **Not started — no `src/mcp/`** |

### 3.2 Missing product capabilities

| Capability | SPEC reference | Status |
|---|---|---|
| **Proactive failure notification** | SPEC 5.2, 7.6 | Not started — no `src/proactive/` |
| **Workflow restart/rerun specialist** | SPEC 8.2.C | Not started — runtime restart specialist missing |
| **Real agent-relay execution** | SPEC 5.4, 7.4 | Typed but not wired to real Relay SDK runs |
| **Agent Assistant integration** | SPEC 2, 8.1 | Currently standalone — no `@agent-assistant/*` composition |
| **Cloud deployment** | SPEC 9 | No worker, infra, or deployment artifacts |
| **Cataloging/scheduled analytics** | SPEC 8.2.F | Health analyzer exists but no scheduled job or real run data |

### 3.3 Missing end-to-end proof

The first waves prove individual subsystems. What remains unproven:
- A user hands Ricky a spec via Slack and receives a generated workflow artifact back
- A user hands a spec from Claude via MCP and Ricky normalizes, generates, and returns results
- Ricky proactively detects a workflow failure in Cloud and notifies the user with a diagnosis
- Ricky coordinates a real `agent-relay` run locally, monitors it, and returns outcome artifacts
- Ricky restarts a failed workflow safely after classifying the failure

## 4. Candidate follow-on workflows: Wave 6

### Wave 6 theme: Surfaces, Integration, and End-to-End Proof

The next wave should make Ricky reachable from its declared co-equal surfaces and prove end-to-end contracts work against real execution, not just mocked seams.

### Sequencing rationale

Waves 0-5 built Ricky's internals: runtime, product core, CLI, local/BYOH, Cloud API, and analytics. Wave 6 must connect those internals to the surfaces users actually interact through (Slack, MCP) and prove the full loop works. Slack is prioritized over web because it is the highest-leverage interactive surface in the AgentWorkforce ecosystem today.

### 4.1 Batch A: Slack surface — implementation and proof

**Why it matters:** Slack is declared as a co-equal surface in SPEC 5.1. It is the primary interactive surface for workflow debugging, generation, coordination, and proactive notifications. Without Slack, Ricky is CLI-only.

**Connection to SPEC:** Sections 5.1, 7.1, 7.2, 7.6, 8.2.A

#### Workflow: `wave6-surfaces/01-implement-slack-ingress.ts`
- **Type:** Implementation
- **Scope:**
  - Slack webhook handler with signature verification, dedup, and thread handling
  - Slack outbound delivery for responses, artifacts, and notifications
  - Health route for monitoring
  - Router integration to connect Slack messages to Ricky's spec intake / domain core
- **Primary files:** `src/slack/webhook-handler.ts`, `src/slack/outbound.ts`, `src/slack/router.ts`, `src/slack/types.ts`, `src/slack/webhook-handler.test.ts`, `src/slack/index.ts`
- **Proof expectations:** Deterministic tests for signature verification, dedup, thread routing, and outbound message formatting. Must follow proven Sage/NightCTO Slack patterns per SPEC 3.3.

#### Workflow: `wave6-surfaces/02-prove-slack-spec-to-artifact.ts`
- **Type:** Proof
- **Scope:** Prove that a Slack message containing a workflow spec reaches Ricky's intake, triggers generation, and returns a formatted artifact response in the same thread.
- **Required proof:**
  - Spec normalization from Slack message format
  - Generation pipeline produces an artifact
  - Outbound delivery formats the artifact for Slack
  - Thread context is preserved
  - Error states produce user-friendly Slack messages, not raw stack traces

### 4.2 Batch B: MCP/assistant handoff — implementation and proof

**Why it matters:** SPEC 7.3 declares that users should be able to draft a spec in Claude and hand it directly to Ricky. This is a first-class journey, not a nice-to-have.

**Connection to SPEC:** Sections 5.1, 7.3, 8.2.A

#### Workflow: `wave6-surfaces/03-implement-mcp-handoff-surface.ts`
- **Type:** Implementation
- **Scope:**
  - MCP tool definitions for Ricky capabilities (generate, debug, coordinate, status)
  - Request normalization from MCP tool call format to Ricky's internal spec model
  - Response formatting for MCP tool results
  - Routing into the same domain core used by CLI and Slack
- **Primary files:** `src/mcp/tools.ts`, `src/mcp/request-normalizer.ts`, `src/mcp/response-formatter.ts`, `src/mcp/types.ts`, `src/mcp/tools.test.ts`, `src/mcp/index.ts`
- **Proof expectations:** Deterministic tests proving MCP tool calls normalize correctly and route through the same intake pipeline as CLI.

#### Workflow: `wave6-surfaces/04-prove-mcp-spec-handoff-and-return.ts`
- **Type:** Proof
- **Scope:** Prove that a spec handed from an MCP-connected assistant normalizes, generates, and returns a workflow artifact through the MCP response path.
- **Required proof:**
  - MCP tool call with a natural-language spec produces a normalized internal request
  - The request routes through spec intake and generation pipeline identically to CLI
  - The response includes the generated artifact, warnings, and follow-up suggestions
  - Error states are surfaced as structured MCP tool errors, not opaque failures

### 4.3 Batch C: Proactive failure notification — implementation and proof

**Why it matters:** SPEC 5.2 and 7.6 define proactive workflow operations as a core Ricky responsibility. Without proactive notifications, Ricky only reacts when asked.

**Connection to SPEC:** Sections 5.2, 7.6, 8.2.F
**Connection to failure taxonomy:** All categories — proactive detection should use the same classifier

#### Workflow: `wave6-surfaces/05-implement-proactive-failure-detection.ts`
- **Type:** Implementation
- **Scope:**
  - Failure signal ingestion from Cloud workflow run state
  - Urgency and recurrence classification using the existing failure taxonomy
  - Notification assembly with diagnosis summary and recommended next actions
  - Delivery routing to appropriate surfaces (Slack initially)
- **Primary files:** `src/proactive/signal-ingester.ts`, `src/proactive/urgency-classifier.ts`, `src/proactive/notification-builder.ts`, `src/proactive/types.ts`, `src/proactive/signal-ingester.test.ts`, `src/proactive/index.ts`
- **Proof expectations:** Deterministic tests proving that failure signals produce correctly classified notifications with taxonomy-specific diagnosis and unblocker recommendations.

#### Workflow: `wave6-surfaces/06-prove-proactive-notification-loop.ts`
- **Type:** Proof
- **Scope:** Prove that a simulated workflow failure signal flows through ingestion, classification, notification assembly, and produces a user-visible notification with actionable content.
- **Required proof:**
  - Different failure taxonomy categories produce different notification content
  - Urgency classification affects notification priority
  - Notifications include diagnosis summary, not just "workflow failed"
  - Recurrence detection flags repeated failures of the same workflow
  - Notification content matches what a user would need to decide on next action

### 4.4 Batch D: Workflow restart specialist — implementation and proof

**Why it matters:** SPEC 8.2.C lists the runtime-restart specialist as a core specialist. Ricky should not just diagnose failures — it should evaluate whether rerun/restart is safe and execute it.

**Connection to SPEC:** Sections 7.1, 8.2.C
**Connection to failure taxonomy:** `agent_runtime.handoff_stalled`, `environment.relay_state_contaminated`, `workflow_structure.control_flow_invalid`

#### Workflow: `wave6-runtime/07-implement-restart-specialist.ts`
- **Type:** Implementation
- **Scope:**
  - Safety evaluation for restart/rerun based on failure classification
  - Mode selection (full restart, partial rerun from failed step, restart with narrower scope)
  - Preflight environment checks before restart (stale relay state, contamination)
  - Restart execution coordination through the local coordinator
- **Primary files:** `src/product/specialists/restart/safety-evaluator.ts`, `src/product/specialists/restart/mode-selector.ts`, `src/product/specialists/restart/restart-coordinator.ts`, `src/product/specialists/restart/types.ts`, `src/product/specialists/restart/restart.test.ts`, `src/product/specialists/restart/index.ts`
- **Proof expectations:** Deterministic tests proving that different failure categories produce different restart decisions, and that unsafe restarts are blocked with explanation.

#### Workflow: `wave6-runtime/08-prove-restart-safety-and-execution.ts`
- **Type:** Proof
- **Scope:** Prove that the restart specialist correctly evaluates safety, selects the right restart mode, and coordinates restart through the local coordinator.
- **Required proof:**
  - `agent_runtime.handoff_stalled` failure → restart with narrower prompt, not blind retry
  - `environment.relay_state_contaminated` → quarantine state then restart clean
  - `workflow_structure.control_flow_invalid` → block restart, recommend fix first
  - Preflight checks detect and quarantine stale `.agent-relay/` state
  - Restart execution produces evidence artifacts

### 4.5 Batch E: End-to-end execution proof

**Why it matters:** Individual subsystems are tested, but no proof exists that a full user journey works from spec to execution to outcome.

**Connection to SPEC:** Sections 7.1, 7.2, 7.4, 14
**Connection to workflow standards:** These proofs should absorb real-life CLI and onboarding regressions before a human wastes cycles manually testing them.

#### Workflow: `wave6-proof/09-prove-local-spec-to-execution-loop.ts`
- **Type:** Proof
- **Scope:** Prove the full local/BYOH path: user provides a spec via CLI, Ricky normalizes it, generates a workflow, validates it, and coordinates a local execution attempt.
- **Required proof:**
  - Spec intake from CLI produces a normalized request
  - Generation pipeline produces a valid Relay workflow artifact
  - Validator specialist applies structural checks and the 80-to-100 proof loop
  - Local coordinator can accept and attempt execution of the generated workflow
  - Outcome artifacts (success or failure diagnosis) are returned to the user
  - The path works without Cloud dependency

#### Workflow: `wave6-proof/10-prove-cloud-spec-to-artifact-return.ts`
- **Type:** Proof
- **Scope:** Prove the full Cloud API path: authenticated request with a spec produces a generated workflow artifact returned through the API response.
- **Required proof:**
  - Auth validation and workspace scoping work
  - Spec normalization from API request format
  - Generation pipeline produces artifacts
  - Response includes artifact bundle, warnings, and follow-up suggestions
  - Missing provider state is surfaced explicitly, not silently ignored

#### Workflow: `wave6-proof/11-prove-cli-surface-honesty-and-empty-handoff-recovery.ts`
- **Type:** Proof
- **Scope:** Prove Ricky's interactive CLI does not advertise non-existent commands, does not fall through into empty local execution, and exits honestly when no real spec or workflow handoff was provided.
- **Required proof:**
  - onboarding/help/recovery copy only references commands or flows that actually exist in the repo
  - selecting Local / BYOH without a spec or artifact does not invoke the local runtime with an empty description
  - the CLI returns a bounded "awaiting input" result instead of a failure when no handoff exists yet
  - proof fixtures compare Ricky against the intended Sage-style local/BYOH behavior where local CLI resolution is real but empty user intent is not executed
  - failures in these user-visible flows break the workflow proof suite automatically

### 4.6 Batch F: Agent Assistant composition proof

**Why it matters:** SPEC Section 2 and 8.1 state that Ricky should be built on Agent Assistant, not as a standalone stack. Currently Ricky is standalone. This batch begins the composition.

**Connection to SPEC:** Sections 2, 3.2, 8.1

#### Workflow: `wave6-integration/12-implement-agent-assistant-composition.ts`
- **Type:** Implementation / spec
- **Scope:**
  - Evaluate which `@agent-assistant/*` packages Ricky should compose today versus later
  - Implement the first integration point — likely `turn-context` for request shaping or `surfaces` for Slack ingress
  - Document the composition boundary between Ricky-owned domain logic and Agent Assistant shared packages
- **Primary files:** `src/assistant/composition.ts`, `src/assistant/types.ts`, `docs/architecture/ricky-agent-assistant-composition.md`
- **Proof expectations:** At least one Agent Assistant package is imported and used for a real product behavior, not just a type re-export.

#### Workflow: `wave6-integration/13-prove-agent-assistant-integration-seam.ts`
- **Type:** Proof
- **Scope:** Prove that the first Agent Assistant integration works correctly and that Ricky's existing tests continue to pass after the composition change.
- **Required proof:**
  - Agent Assistant package is imported and used in a real code path
  - Existing 389 tests still pass
  - The integration seam is documented with clear boundary rules
  - No Ricky-owned domain logic leaks into Agent Assistant packages

## 5. What should wait until after Wave 6

These are important but should not outrun the surface and integration work:

| Area | Why it waits |
|---|---|
| **Web surface** | Slack and MCP are higher leverage; web can reuse patterns from both |
| **Full autonomous repair** | Restart specialist is the first step; autonomous repair at scale needs proven safety policy |
| **Cataloging/scheduled analytics jobs** | Health analyzer exists; scheduled jobs need Cloud deployment infrastructure first |
| **Cloud deployment (worker/infra)** | Requires the Slack and proactive paths to exist before deployment is meaningful |
| **Multi-provider workflow generation** | Core Relay-native generation must be proven first |
| **RelayFile-backed evidence substrate** | Current evidence model works; RelayFile integration is an optimization |
| **Broad Slack app polish** | Get the basic Slack path working and proven before polishing interactive features |

## 6. Proof expectations by area

### Workflow proof
Every proposed Wave 6 workflow must produce evidence that its user-facing contract works. Implementation workflows need deterministic unit or integration tests for the behavior they add; proof workflows need end-to-end or slice-level evidence that the behavior reaches the intended surface, artifact, diagnosis, or execution outcome.

### CLI/banner and onboarding proof
The CLI/banner UX spec and onboarding behavior remain a regression gate for the next batch. Future surface work must not break the proven onboarding contract: recognizable Ricky banner, truthful local/BYOH and Cloud guidance, first-run and recovery paths, non-TTY behavior, and user-visible setup errors.

### Slack proof
Must show a Slack message reaches Ricky's domain core, triggers a real product action, and returns a formatted response in the same thread. Not just webhook parsing.

### MCP proof
Must show a spec from an MCP-connected assistant normalizes identically to CLI input and returns structured results through MCP tool responses.

### Proactive proof
Must show different failure taxonomy categories produce different notification content with actionable next steps. Not just "workflow failed" alerts.

### Restart proof
Must show the restart specialist blocks unsafe restarts, selects the right restart mode per failure class, and coordinates through the local coordinator with evidence.

### End-to-end proof
Must show at least one full user journey from spec to execution outcome for both local and Cloud paths. Not just subsystem unit tests.

### Agent Assistant proof
Must show at least one Agent Assistant package used in a real Ricky code path with all existing tests passing.

### Regression proof
All proof workflows must verify that existing test suites (currently 389 tests across 21 files) continue to pass after each implementation change.

## 7. Dependency and sequencing notes

```
Batch A (Slack) ──────────────────────┐
                                      ├── Batch E (end-to-end proof)
Batch B (MCP handoff) ────────────────┤
                                      │
Batch C (proactive) ──── needs Slack ─┘
                          for delivery
Batch D (restart) ──── independent of surfaces

Batch F (Agent Assistant) ──── independent, can run in parallel
```

Recommended execution order:
1. **Batch A + B in parallel** — Slack ingress and MCP handoff are independent implementations
2. **Batch C** — Proactive notifications need a delivery surface (Slack from Batch A)
3. **Batch D** — Restart specialist can start in parallel with Batch C
4. **Batch E** — End-to-end proof should run after surfaces exist
5. **Batch F** — Agent Assistant composition can start anytime but should prove integration after surfaces stabilize

## 8. Workflow type classification

| Workflow | Type | Wave |
|---|---|---|
| 01-implement-slack-ingress | Implementation | wave6-surfaces |
| 02-prove-slack-spec-to-artifact | Proof | wave6-surfaces |
| 03-implement-mcp-handoff-surface | Implementation | wave6-surfaces |
| 04-prove-mcp-spec-handoff-and-return | Proof | wave6-surfaces |
| 05-implement-proactive-failure-detection | Implementation | wave6-surfaces |
| 06-prove-proactive-notification-loop | Proof | wave6-surfaces |
| 07-implement-restart-specialist | Implementation | wave6-runtime |
| 08-prove-restart-safety-and-execution | Proof | wave6-runtime |
| 09-prove-local-spec-to-execution-loop | Proof | wave6-proof |
| 10-prove-cloud-spec-to-artifact-return | Proof | wave6-proof |
| 11-implement-agent-assistant-composition | Implementation/spec | wave6-integration |
| 12-prove-agent-assistant-integration-seam | Proof | wave6-integration |

**Total: 12 workflows** — 5 implementation, 7 proof

The proof-heavy ratio is deliberate. Ricky's internals exist. What needs proving is that they connect to real surfaces and real execution.

## 9. Connection to failure taxonomy

The next wave should exercise these taxonomy categories in real product paths:

| Taxonomy category | Where it appears in Wave 6 |
|---|---|
| `agent_runtime.handoff_stalled` | Restart specialist safety evaluation, proactive notification content |
| `agent_runtime.progress_opaque` | Proactive notification urgency classification |
| `environment.relay_state_contaminated` | Restart specialist preflight checks, end-to-end execution proof |
| `workflow_structure.control_flow_invalid` | Restart specialist blocks restart and recommends fix |
| `workflow_structure.scope_gate_weak` | Validator specialist in end-to-end proof path |
| `validation_strategy.repo_mismatch` | End-to-end proof must use truthful validation, not aspirational commands |

## 10. What should be built immediately after Wave 6

If Wave 6 completes honestly:
1. **Web surface** — using patterns proven by Slack and MCP
2. **Cloud deployment** — worker/infra now that Slack and proactive paths exist
3. **Scheduled analytics jobs** — cataloging with real Cloud run data
4. **Broader Slack interactivity** — buttons, modals, approval flows for restart decisions

## 11. Decision

The recommended next Ricky wave is a bounded 12-workflow batch (Wave 6) centered on:
- Slack surface implementation and proof
- MCP/assistant handoff implementation and proof
- Proactive failure notification implementation and proof
- Restart specialist implementation and proof
- End-to-end execution proof for local and Cloud paths
- Agent Assistant composition proof

This wave turns Ricky from a CLI-and-test product into a multi-surface, proactive, real-execution product.

The immediate next thing to build is:
- Slack ingress implementation (Batch A)
- MCP handoff implementation (Batch B)
- These can run in parallel because they share no implementation dependencies
