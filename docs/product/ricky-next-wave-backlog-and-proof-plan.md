# Ricky Next-Wave Backlog and Proof Plan

## Purpose

This document defines the next bounded Ricky backlog after the current first-wave buildout. It is not a replacement for the product spec, and it does not create follow-on workflow files. Its job is to make the next workflow-authoring batch concrete enough that implementation and proof workflows can be authored without rediscovering priorities.

The next batch should focus on implementation follow-through and proof hardening:
- complete or classify first-wave proof debt
- use the CLI/banner UX spec as a near-term deliverable and regression contract
- prove onboarding paths into local/BYOH and Cloud behavior
- move workflow proof beyond package tests and compile-only checks
- add real runtime/e2e validation evidence
- make environment and failure recovery explicit
- keep Cloud/local parity visible
- feed analytics/proof loops with actual run evidence

## Current First-Wave Status

Ricky has moved beyond planning. The repo currently contains 33 wave workflow files under `workflows/wave0-foundation` through `workflows/wave5-scale-and-ops`: 31 product-build workflows plus 2 runtime debug canaries. The implementation is split into npm workspaces for `@ricky/shared`, `@ricky/runtime`, `@ricky/product`, `@ricky/cloud`, `@ricky/local`, and `@ricky/cli`.

| Area | Current status |
|---|---|
| Foundation | Repo standards, package layout proof, shared models/config, architecture docs, and runtime debug canaries exist. |
| Runtime | Local coordination, evidence capture, failure classification, diagnosis, and unblocker proof exist in `@ricky/runtime`. |
| Product core | Spec intake, generation, debugger, validator, and analytics modules exist in `@ricky/product`. |
| Cloud | Auth validation, workspace scoping, provider guidance, generate endpoint, and Cloud generate proof exist in `@ricky/cloud`. |
| Local/BYOH | Request normalization, local entrypoint, and local proof exist in `@ricky/local`. |
| CLI/onboarding | ASCII banner, welcome, mode selection, onboarding, command parsing, interactive entrypoint, and onboarding proof tests exist in `@ricky/cli`. |
| Tests | `npm test` currently passes across workspace and root proof tests: 19 test files, 410 tests. |

### Signoff and Proof Debt

Per-workflow signoff is not yet complete. The product-build waves currently have 15 per-workflow signoff artifacts and 16 product-build workflows without per-workflow signoff:

- Wave 0: repo-standards-and-conventions, toolchain-and-validation-foundation, shared-models-and-config
- Wave 1: local-run-coordinator, workflow-evidence-model, workflow-failure-classification
- Wave 2: workflow-spec-intake, workflow-debugger-specialist, workflow-validator-specialist
- Wave 3: generate-endpoint
- Wave 4: local-invocation-entrypoint, cli-onboarding-ux-spec, prove-cli-onboarding-first-run-and-recovery, implement-cli-command-surface
- Wave 5: next-wave-backlog-and-proof-plan, split-ricky-into-workspace-packages

The two runtime debug canaries have separate signoff artifacts under `.workflow-artifacts/runtime-debug/`. The meta/generation workflows also have signoff evidence, but those do not replace per-workflow signoff for product-build work.

### What Is Proven

- Ricky can build and test as a TypeScript npm workspace.
- Core packages expose real implementation surfaces rather than placeholder docs.
- CLI onboarding renders user-visible banner/welcome/mode guidance and has focused tests.
- Local/BYOH and Cloud paths can normalize requests and return structured artifacts or setup blockers.
- Runtime evidence and failure classification distinguish known blocker classes.
- Product modules can parse specs, generate workflow artifacts, validate proof loops, debug failures, and analyze health patterns.
- Package layout and script parity are covered by root proof tests.

### What Is Not Proven Enough

- The CLI/banner UX spec has not been treated as a completed near-term deliverable with full conformance proof.
- Onboarding proof does not yet fully show a user moving from first-run choice to local/BYOH or Cloud outcomes.
- Local and Cloud parity is tested in slices, but not as a cross-surface evidence contract.
- Real `agent-relay` runtime/e2e execution evidence is still limited to canaries and local coordinator tests.
- Environment recovery is mostly diagnosis-oriented; recovery decisions and before/after proof are not yet a product loop.
- Analytics exists, but it is not yet fed by real runtime/e2e proof artifacts from follow-through workflows.

## CLI/Banner UX Deliverable Boundary

The CLI/banner UX spec is its own near-term deliverable: `docs/product/ricky-cli-onboarding-ux-spec.md`. It should not be buried inside the broader backlog or reopened by every follow-on workflow.

That spec owns:
- banner and ASCII-art behavior
- first-run and returning-user copy
- local/BYOH, Cloud, Both, and exploration mode guidance
- command-surface expectations for `setup`, `welcome`, `generate`, `status`, `--quiet`, and `--no-banner`
- non-TTY and suppressed-banner behavior
- recovery copy for missing toolchain, missing Cloud auth, stale local runtime state, and corrupted config

The next batch starts after that spec boundary. Follow-on workflows should either implement missing conformance or prove the implementation follows the spec. They should not restate the entire UX spec.

## Bounded Next Batch Recommendation

Recommended next batch: **Wave 6 - Follow-Through and Proof Hardening**.

Keep this to 8 workflows: 3 implementation workflows and 5 proof workflows. That is enough to close the highest-risk gaps without turning Wave 6 into an open-ended roadmap dump.

Wave 6 should include:

| Priority | Workflow | Type | Primary outcome |
|---:|---|---|---|
| 1 | `wave6-proof/01-close-first-wave-signoff-and-blockers.ts` | Proof | Every unsigned first-wave workflow has signoff or a classified blocker. |
| 2 | `wave6-proof/02-prove-cli-banner-and-command-conformance.ts` | Proof | CLI/banner implementation conforms to the dedicated UX spec. |
| 3 | `wave6-proof/03-prove-onboarding-to-local-byoh-handoff.ts` | Proof | First-run local/BYOH onboarding reaches a valid local request path. |
| 4 | `wave6-proof/04-prove-cloud-onboarding-and-local-parity.ts` | Proof | Cloud setup/generate behavior stays semantically aligned with local intent. |
| 5 | `wave6-runtime/05-implement-runtime-e2e-proof-harness.ts` | Implementation | Ricky can capture real runtime/e2e execution evidence in a reusable harness. |
| 6 | `wave6-proof/06-prove-spec-to-artifact-to-runtime-loop.ts` | Proof | A spec can move through generation, validation, runtime attempt, and evidence return. |
| 7 | `wave6-runtime/07-implement-environment-recovery-coordinator.ts` | Implementation | Ricky can choose bounded recovery actions from classified environment/runtime blockers. |
| 8 | `wave6-analytics/08-implement-proof-loop-analytics-ingestion.ts` | Implementation | Analytics consumes proof/run evidence and reports actionable gaps. |

Defer Slack, Web, broad MCP surface expansion, scheduled Cloud jobs, and full autonomous repair until this batch proves the existing CLI/local/Cloud path can follow through with truthful evidence.

## Prioritized Follow-On Areas

### Priority 1: First-Wave Signoff and Blocker Closure

**Workflow:** `wave6-proof/01-close-first-wave-signoff-and-blockers.ts`

**Why it matters:** Ricky cannot credibly expand scope while 16 product-build workflows lack per-workflow signoff. Some may only need evidence capture; others may reveal runtime, environment, workflow-structure, or validation-strategy blockers.

**Success looks like:**
- Every unsigned product-build workflow has either a signoff artifact or a blocker artifact.
- Blockers use the existing taxonomy: `agent_runtime.*`, `environment.*`, `workflow_structure.*`, `validation_strategy.*`.
- The summary distinguishes implemented-but-unproved work from genuinely incomplete work.

**Required evidence/proof:**
- A summary artifact listing all 16 unsigned workflows with final state.
- For each completed workflow: validation commands, changed-file scope proof, and signoff artifact path.
- For each blocked workflow: observed symptom, taxonomy classification, unblock action, and owner-facing next step.

### Priority 2: CLI/Banner Implementation Conformance

**Workflow:** `wave6-proof/02-prove-cli-banner-and-command-conformance.ts`

**Why it matters:** The CLI/banner UX spec is the immediate product deliverable. If the parser, command dispatch, banner behavior, or recovery copy drifts from the spec, onboarding becomes untrustworthy before Ricky ever generates a workflow.

**Success looks like:**
- `setup`, `welcome`, `generate`, `status`, `--quiet`, and `--no-banner` behavior matches the UX spec or is explicitly listed as not implemented.
- Help output does not advertise unavailable flows.
- Non-TTY usage suppresses decorative banner and interactive prompts.
- Returning-user and first-run paths are distinct.

**Required evidence/proof:**
- Deterministic tests for TTY, non-TTY, quiet, no-banner, first-run, returning-user, narrow terminal, and missing config states.
- Parser/dispatch proof showing each target command in the UX spec is either implemented or listed as a bounded gap.
- Snapshot or fixture evidence for user-visible copy, without relying on manual inspection.

### Priority 3: Onboarding to Local/BYOH Handoff

**Workflow:** `wave6-proof/03-prove-onboarding-to-local-byoh-handoff.ts`

**Why it matters:** Ricky should not merely describe local/BYOH mode. It must prove that a local-first user can select local mode, provide a spec, and reach the local request boundary without Cloud credentials or empty-intent execution.

**Success looks like:**
- First-run local/BYOH selection persists the expected mode.
- Inline spec, spec-file, and stdin handoffs normalize to `LocalInvocationRequest`.
- Empty handoffs return bounded "awaiting input" guidance.
- Missing local prerequisites are classified as environment blockers with recovery guidance.

**Required evidence/proof:**
- End-to-end slice test from first-run state through request normalization into the local entrypoint boundary.
- Fixtures for inline spec, spec file, stdin, and no-spec invocation.
- Proof that no Cloud auth is required for the local/BYOH happy path.
- Failure evidence for stale local state or missing runtime tooling using the failure taxonomy.

### Priority 4: Cloud Onboarding and Cloud/Local Parity

**Workflow:** `wave6-proof/04-prove-cloud-onboarding-and-local-parity.ts`

**Why it matters:** Ricky presents local/BYOH and Cloud as co-equal. Cloud cannot have different request semantics, vague provider failures, or weaker artifact evidence.

**Success looks like:**
- Cloud mode uses existing provider guidance, including Google Cloud connect and GitHub/Nango dashboard direction.
- The same spec produces equivalent product intent through local and Cloud request paths.
- Cloud responses include artifacts, warnings, follow-up actions, request ID, auth/workspace outcome, and explicit setup blockers.
- Local-only and Cloud-only evidence fields are documented.

**Required evidence/proof:**
- Parity fixtures that run the same spec through local and Cloud request shaping.
- Cloud auth and workspace-scoping tests tied to generate endpoint behavior.
- Provider-missing and provider-connected fixtures with user-visible recovery guidance.
- A proof artifact comparing local/BYOH and Cloud evidence fields.

### Priority 5: Real Runtime/E2E Proof Harness

**Workflow:** `wave6-runtime/05-implement-runtime-e2e-proof-harness.ts`

**Why it matters:** Workflow proof must not stop at package tests. Ricky needs a controlled way to attempt real runtime execution, capture outcomes, and classify failures without confusing product bugs with local environment problems.

**Success looks like:**
- A generated workflow artifact can be handed to a runtime proof harness.
- The harness records command, environment, artifact paths, exit status, logs, timing, timeout, and classified outcome.
- Passing, failing, timed-out, and unavailable-runtime runs all produce structured evidence.
- Evidence is consumable by validator, debugger, recovery, and analytics modules.

**Required evidence/proof:**
- Unit tests for evidence capture, timeout classification, and unavailable-runtime classification.
- One deterministic success fixture and one deterministic structural-failure fixture.
- A local canary path that can run without Cloud credentials.
- Evidence schema compatibility check against existing runtime evidence types.

### Priority 6: Spec to Artifact to Runtime Loop

**Workflow:** `wave6-proof/06-prove-spec-to-artifact-to-runtime-loop.ts`

**Why it matters:** Ricky's core promise is not just to parse specs or render templates. A user spec should become a workflow artifact, pass validation, attempt execution where appropriate, and return useful proof or recovery guidance.

**Success looks like:**
- CLI spec input reaches product spec intake.
- Generation produces a Relay workflow artifact.
- Validator proof checks run before execution.
- Runtime proof harness attempts execution or returns a classified reason it cannot.
- Final response includes artifact path, validation result, runtime result, and recovery guidance.

**Required evidence/proof:**
- One happy-path fixture from spec to generated artifact to runtime evidence.
- One fixture where validation blocks execution with a structural diagnosis.
- One fixture where runtime/environment failure is classified through existing taxonomy.
- Proof logs showing handoff across CLI, product, validator, local, runtime, and diagnostics packages.

### Priority 7: Environment Recovery and Unblockers

**Workflow:** `wave6-runtime/07-implement-environment-recovery-coordinator.ts`

**Why it matters:** Ricky already diagnoses failures such as stale relay state, opaque progress, stalled handoffs, invalid control flow, and validation mismatches. The next step is to choose bounded recovery actions safely instead of leaving the user with diagnosis only.

**Success looks like:**
- Recovery decisions are driven by failure classification.
- Stale `.agent-relay`, `.relay`, and `.trajectories` state can be detected and quarantined before rerun.
- Unsafe reruns are blocked with a fix recommendation.
- Restart/rerun decisions include reason, evidence pointer, and before/after state.

**Required evidence/proof:**
- Fixtures for `environment.relay_state_contaminated`, `agent_runtime.handoff_stalled`, `agent_runtime.progress_opaque`, `workflow_structure.control_flow_invalid`, and `validation_strategy.repo_mismatch`.
- Tests proving each category maps to a different recovery action.
- Before/after artifact proof for quarantine or retry decisions.
- Guard test proving structural workflow failures are not blindly rerun.

### Priority 8: Analytics and Proof-Loop Ingestion

**Workflow:** `wave6-analytics/08-implement-proof-loop-analytics-ingestion.ts`

**Why it matters:** Analytics should close the proof loop. Ricky should learn from runtime/e2e evidence and recovery outcomes instead of reporting generic health summaries detached from real runs.

**Success looks like:**
- Health analyzer consumes runtime proof harness evidence and recovery decision evidence.
- Digest output distinguishes workflow logic failures, environment blockers, runtime handoff failures, and validation-strategy mismatches.
- Repeated failures are grouped by workflow, package, failure class, and recovery outcome.
- Analytics can recommend the next proof or implementation workflow based on observed evidence gaps.

**Required evidence/proof:**
- Fixtures with mixed successful, failed, recovered, and blocked runs.
- Tests showing different failure classes produce different recommendations.
- A proof artifact showing analytics output for at least one local/BYOH run, one Cloud generate path, and one environment recovery path.

## Proof Expectations Across Wave 6

### Workflow Proof

Every workflow must produce deterministic evidence for the behavior it claims. Implementation workflows need focused tests plus an artifact or fixture proving the new module can be used. Proof workflows need slice-level or e2e evidence, not just TypeScript compilation.

### Onboarding Proof

Onboarding proof must cover visible copy and state transitions: first-run, returning-user, local/BYOH, Cloud, Both, no-spec, non-TTY, quiet/no-banner, missing toolchain, missing Cloud auth, stale local state, and corrupted config where applicable.

### Local/BYOH Proof

Local proof must show Ricky can accept a spec without Cloud credentials, normalize it, generate or route it through the product pipeline, validate it, and either attempt local execution or return a classified local blocker.

### Cloud Proof

Cloud proof must show auth validation, workspace scoping, provider guidance, generate request normalization, artifact response shape, request IDs, warnings, follow-up actions, and explicit setup blockers. Cloud proof must not silently fall back to local execution.

### Cloud/Local Parity Proof

Equivalent specs should produce equivalent product intent across local/BYOH and Cloud paths. Differences are allowed only where the mode requires them, and those differences must be documented in evidence.

### Runtime/E2E Proof

Runtime proof must record actual command attempts or a classified reason execution was unavailable. It should capture exit status, timeout, logs, artifact paths, and failure classification in a shape downstream modules can consume.

### Environment and Failure Recovery Proof

Recovery proof must use the existing failure taxonomy. It must prove Ricky can separate runtime handoff stalls, opaque progress, stale relay state, workflow structure failures, and validation strategy mismatches, then choose a bounded recovery action with evidence.

### Analytics/Proof-Loop Proof

Analytics must consume real proof and recovery evidence, not only synthetic summaries. The proof loop should show how Ricky turns observed failures into concrete recommendations for the next workflow, recovery action, or documentation update.

## Sequencing

Recommended order:

1. Close first-wave signoff and blockers. This establishes the true starting line.
2. Prove CLI/banner conformance. This locks the near-term UX deliverable.
3. Prove onboarding to local/BYOH and Cloud/local parity in parallel.
4. Implement the runtime/e2e proof harness.
5. Prove the full spec-to-artifact-to-runtime loop.
6. Implement environment recovery using the taxonomy and runtime evidence.
7. Feed proof and recovery evidence into analytics.

Dependencies:

| Workflow | Depends on |
|---|---|
| `01-close-first-wave-signoff-and-blockers` | Existing workflow artifacts and current test commands |
| `02-prove-cli-banner-and-command-conformance` | CLI/banner UX spec and existing CLI package |
| `03-prove-onboarding-to-local-byoh-handoff` | 02, local request normalizer |
| `04-prove-cloud-onboarding-and-local-parity` | 02, Cloud generate endpoint, local normalizer |
| `05-implement-runtime-e2e-proof-harness` | Runtime evidence and failure classifier |
| `06-prove-spec-to-artifact-to-runtime-loop` | 03, 05, product generation, validator |
| `07-implement-environment-recovery-coordinator` | 05 and failure taxonomy |
| `08-implement-proof-loop-analytics-ingestion` | 05, 06, 07, analytics module |

## What Should Wait

| Area | Why it waits |
|---|---|
| Slack surface | Valuable, but it should reuse proven onboarding, request normalization, runtime proof, and recovery contracts. |
| Web surface | Web can follow the same parity and proof patterns after CLI/local/Cloud are hardened. |
| Broad MCP/assistant handoff expansion | MCP should not be added before local and Cloud proof contracts are stable enough to compare against. |
| Full autonomous repair | Recovery coordinator is the bounded first step; broad repair needs proven safety policy. |
| Scheduled Cloud analytics jobs | Analytics ingestion should first prove value on captured proof artifacts. |
| Multi-provider expansion | Current Google/GitHub guidance and Cloud setup blockers need proof before new providers are added. |

## Decision

Build **Wave 6 - Follow-Through and Proof Hardening** as an 8-workflow batch.

The batch starts with proof debt and CLI/banner conformance, then proves onboarding into local/BYOH and Cloud, adds real runtime/e2e validation, implements environment recovery, and connects analytics to proof evidence. This is the smallest batch that directly addresses Ricky's current risk: the product has modules and tests, but still needs stronger evidence that the user journey works across implementation, onboarding, runtime, recovery, Cloud/local parity, and analytics loops.
