# Ricky Next-Wave Backlog and Proof Plan

## 1. Purpose

This document defines the next bounded Ricky backlog after the current first-wave program. It is not a replacement for the product spec and it does not create follow-on workflow files. Its job is to make the next workflow-authoring batch concrete enough that implementation and proof workflows can be written without rediscovering priorities.

The next batch should keep Ricky focused on:
- implementation follow-through from the CLI/banner UX spec
- onboarding proof that reaches real local/BYOH and Cloud choices
- workflow proof beyond compile-only checks
- real runtime and end-to-end validation
- environment recovery and unblocker behavior
- Cloud/local parity
- analytics and proof loops that learn from actual run evidence

## 2. Current First-Wave Status

The first-wave program has produced a real foundation, not just planning notes. The repo currently contains 34 workflow files across foundation, runtime, product, Cloud, local/BYOH, scale/ops, debug, and meta workflow areas:

| Area | Current status |
|---|---|
| Foundation | Repo standards, toolchain, shared models/config, architecture docs, and runtime debug canaries exist. |
| Runtime | Local coordinator, evidence capture, failure classifier, diagnosis engine, and unblocker proof exist in `@ricky/runtime`. |
| Product core | Spec intake, generation pipeline, debugger specialist, validator specialist, and analytics primitives exist in `@ricky/product`. |
| Cloud | Auth validation, workspace scoping, provider-connect guidance, generate endpoint, and Cloud generate proof exist in `@ricky/cloud`. |
| Local/BYOH | Request normalization, local entrypoint, local proof, and CLI composition paths exist in `@ricky/local` and `@ricky/cli`. |
| CLI/onboarding | ASCII banner, welcome, mode selection, onboarding, command surface, interactive entrypoint, and onboarding proof tests exist in `@ricky/cli`. |
| Package split | The repo is split into `@ricky/shared`, `@ricky/runtime`, `@ricky/product`, `@ricky/cloud`, `@ricky/local`, and `@ricky/cli`. |
| Test/proof coverage | There are 21 test files spanning package tests plus root package/smoke proof tests. |

The first wave proves that Ricky can be built and tested as a TypeScript workspace, can present a CLI onboarding surface, can normalize local and Cloud requests, can classify known failure modes, can generate artifacts through package-level seams, and can enforce package layout parity.

It does not yet prove enough real user journeys. The remaining risk is no longer "does Ricky have modules?" The risk is whether the modules stay truthful when a user starts from onboarding, selects local/BYOH or Cloud, hands Ricky a real spec, hits a runtime/environment blocker, and expects actionable proof back.

## 3. CLI/Banner UX Deliverable Boundary

The CLI/banner UX spec is its own near-term deliverable and must remain separate from this backlog. It is represented by `docs/product/ricky-cli-onboarding-ux-spec.md` and the Wave 4 CLI onboarding UX workflow.

That spec owns:
- banner and ASCII-art behavior
- first-run and returning-user copy
- local/BYOH, Cloud, Both, and exploration mode guidance
- command-surface expectations
- non-TTY and suppressed-banner behavior
- recovery copy for missing toolchain, missing Cloud auth, stale local runtime state, and corrupted config

The next batch should not reopen the banner spec or bury it inside a broader roadmap. It should use the CLI/banner spec as the regression contract, then prove the implementation follows through.

## 4. Bounded Next Batch Recommendation

Recommended next batch: **Wave 6 - Follow-Through and Proof Hardening**.

This should be an 8-workflow batch: 3 implementation workflows and 5 proof workflows. That is enough to connect the existing surfaces to real evidence without turning Wave 6 into an open-ended surface expansion program.

Do not include Slack, Web, broad provider expansion, or full autonomous repair in this batch. Those can follow once CLI/local/Cloud proof is stronger.

## 5. Prioritized Follow-On Areas

### Priority 1: CLI/banner implementation conformance proof

**Workflow:** `wave6-proof/01-prove-cli-banner-and-command-conformance.ts`

**Why it matters:** The CLI is the first Ricky surface a local/BYOH user will touch. If the banner, setup commands, quiet/non-TTY behavior, or command help drift from the spec, onboarding becomes untrustworthy before any workflow generation happens.

**Success looks like:**
- `setup`, `welcome`, `generate`, `status`, `--quiet`, and `--no-banner` behavior matches the CLI/banner UX spec.
- Returning users do not see full first-run onboarding.
- Non-interactive usage does not emit decorative banner output.
- Help and recovery copy only mention commands and flows that actually exist.

**Required evidence/proof:**
- Deterministic tests comparing command parsing and rendered output to the CLI/banner spec contract.
- Fixture coverage for TTY, non-TTY, quiet, no-banner, narrow terminal, first-run, and returning-user states.
- A proof artifact showing no target command in the spec is missing from the parser or dispatch layer.

### Priority 2: Onboarding-to-local/BYOH proof

**Workflow:** `wave6-proof/02-prove-onboarding-to-local-byoh-handoff.ts`

**Why it matters:** Ricky should not merely explain local/BYOH mode. It must prove that local onboarding can lead to a valid local request without Cloud credentials and without silently executing empty user intent.

**Success looks like:**
- A first-run local/BYOH selection persists the correct mode.
- A CLI spec handoff normalizes into the same local request model used by the local entrypoint.
- Empty handoffs return bounded "awaiting input" guidance instead of invoking local execution with an empty description.
- Missing local prerequisites are classified as environment blockers with actionable recovery guidance.

**Required evidence/proof:**
- End-to-end slice test from onboarding state through request normalization into the local entrypoint boundary.
- Fixtures for inline spec, spec file, stdin, and no-spec invocation.
- Proof that no Cloud auth is required for the local/BYOH happy path.
- Failure evidence for missing toolchain or stale local state using the existing failure taxonomy.

### Priority 3: Cloud onboarding and Cloud/local parity proof

**Workflow:** `wave6-proof/03-prove-cloud-onboarding-and-generate-parity.ts`

**Why it matters:** Ricky presents local/BYOH and Cloud as co-equal modes. Cloud cannot be treated as a separate product path with different request semantics, weaker evidence, or vague provider failures.

**Success looks like:**
- Cloud mode selection gives exact provider guidance from the CLI/banner spec.
- A Cloud generate request and a local generate request for the same spec normalize to equivalent product intent.
- Cloud responses return artifact bundles, warnings, follow-up actions, and explicit provider/auth failures.
- Missing Google/GitHub provider state is surfaced as a Cloud setup blocker, not a generic generation failure.

**Required evidence/proof:**
- Parity fixtures that run the same spec through local and Cloud request normalization and compare the resulting domain intent.
- Cloud auth/workspace scoping tests tied to the generate endpoint.
- Provider-missing and provider-connected fixtures with user-visible recovery copy.
- A proof artifact showing which evidence fields local and Cloud both return, and which fields are mode-specific.

### Priority 4: Real runtime/e2e validation loop

**Workflow:** `wave6-runtime/04-implement-real-runtime-execution-proof-harness.ts`

**Why it matters:** Current tests prove package seams and deterministic behavior, but Ricky still needs a controlled way to attempt real runtime execution and report outcome evidence. Without this, "workflow proof" can regress into compile-only optimism.

**Success looks like:**
- A generated workflow artifact can be handed to a runtime proof harness.
- The harness records command, environment, artifact paths, exit status, logs, and classified outcome.
- Successful, failed, and timed-out runs all produce structured evidence.
- The harness distinguishes product failures from environment/runtime failures.

**Required evidence/proof:**
- Unit tests for evidence capture and timeout classification.
- A deterministic fixture workflow that succeeds.
- A deterministic fixture workflow that fails structurally.
- A runtime canary path that can be run locally without Cloud credentials.
- Evidence written in a shape consumable by the validator, debugger, and analytics modules.

### Priority 5: Spec-to-artifact-to-runtime proof

**Workflow:** `wave6-proof/05-prove-local-spec-to-artifact-to-runtime.ts`

**Why it matters:** Ricky's central promise is not just to parse specs or render templates. It should take a user spec, produce a workflow artifact, validate it, attempt execution where appropriate, and return a useful result.

**Success looks like:**
- CLI spec input reaches the product spec-intake pipeline.
- Generation produces a Relay workflow artifact.
- Validator proof checks run before execution.
- The local runtime proof harness attempts execution or returns a classified reason it cannot.
- The final response includes artifact location, validation result, runtime result, and recovery guidance when needed.

**Required evidence/proof:**
- One happy-path fixture from spec to generated artifact to runtime evidence.
- One fixture where validation blocks execution with a specific structural diagnosis.
- One fixture where runtime/environment failure is classified through the existing taxonomy.
- Proof logs that show the handoff across CLI, product, validator, local, runtime, and diagnostics packages.

### Priority 6: Environment recovery and unblocker follow-through

**Workflow:** `wave6-runtime/06-implement-environment-recovery-coordinator.ts`

**Why it matters:** Ricky already classifies failures such as stalled handoffs, opaque progress, stale relay state, weak workflow structure, and repo validation mismatch. The next step is to make recovery decisions explicit and safe instead of leaving users with diagnosis only.

**Success looks like:**
- Recovery recommendations are selected from the failure class, evidence, and current mode.
- Stale local relay state can be quarantined before retry.
- Unsafe retries are blocked with a clear explanation.
- Local/BYOH recovery and Cloud recovery are separated where their mechanics differ.
- Recovery attempts emit evidence that analytics can inspect later.

**Required evidence/proof:**
- Tests for each known failure taxonomy category.
- Fixture evidence for `environment.relay_state_contaminated`, `agent_runtime.handoff_stalled`, and `workflow_structure.control_flow_invalid`.
- Proof that stale local state quarantine is deterministic and does not delete unrelated user files.
- Proof that Cloud/provider recovery gives setup guidance rather than local filesystem actions.

### Priority 7: Recovery proof loop

**Workflow:** `wave6-proof/07-prove-recovery-and-rerun-safety.ts`

**Why it matters:** Recovery logic is high-risk. A retry that hides the root cause or mutates the wrong environment is worse than a clean failure.

**Success looks like:**
- Ricky can decide between "retry now", "quarantine then retry", "ask for provider setup", and "block until workflow is fixed".
- Recovery decisions include a reason and evidence pointer.
- The same failure produces different recovery action when running local/BYOH versus Cloud if the environment constraints differ.
- A rerun attempt records before/after evidence.

**Required evidence/proof:**
- Table-driven proof fixtures mapping failure class, mode, and evidence to recovery action.
- A local stale-state fixture proving quarantine then rerun.
- A Cloud missing-auth fixture proving provider setup guidance without local retry.
- A structural workflow failure fixture proving rerun is blocked until implementation changes.

### Priority 8: Analytics and proof-loop feedback

**Workflow:** `wave6-ops/08-implement-proof-analytics-feedback-loop.ts`

**Why it matters:** Ricky's analytics should not only summarize generic health. It should turn workflow proof evidence into concrete next actions: which workflows are flaky, which failures are environmental, which proof gaps recur, and where authoring rules need tightening.

**Success looks like:**
- Proof and runtime evidence can be ingested by the analytics module.
- Repeated failure classes are grouped by workflow, package, mode, and environment.
- Analytics can distinguish product regressions from local environment blockers.
- The digest recommends a bounded next action, not a vague "investigate".

**Required evidence/proof:**
- Fixture run histories containing successful runs, validation failures, runtime stalls, stale-state failures, and Cloud auth blockers.
- Digest tests proving the recommended action changes by failure pattern.
- Proof that analytics consumes the same evidence emitted by runtime/e2e proof workflows.
- A sample digest artifact checked by deterministic assertions.

## 6. Proof Expectations Across The Batch

### Workflow proof

Every Wave 6 workflow must produce deterministic evidence that the behavior it claims is true. Implementation workflows need focused tests plus an artifact or fixture proving the new seam is usable. Proof workflows need slice-level or end-to-end evidence, not just TypeScript compilation.

### Onboarding proof

Onboarding proof must cover both user-visible copy and state transitions. It should prove first-run, returning-user, local/BYOH, Cloud, Both, no-spec, non-TTY, quiet/no-banner, missing toolchain, missing Cloud auth, stale local state, and corrupted config behavior.

### Local/BYOH proof

Local proof must show Ricky can accept a spec without Cloud credentials, normalize it, generate or route it through the product pipeline, validate it, and either attempt local execution or return a classified local blocker.

### Cloud proof

Cloud proof must show auth validation, workspace scoping, provider guidance, generate request normalization, artifact response shape, and explicit setup blockers. Cloud proof must not use local-only assumptions or silently fall back to local execution.

### Environment and failure recovery proof

Recovery proof must use the existing failure taxonomy. It must prove Ricky can separate runtime handoff stalls, opaque progress, stale relay state, workflow structure failures, and validation strategy mismatches, then choose a bounded recovery action with evidence.

### Analytics/proof-loop proof

Analytics must consume real proof evidence shapes from runtime and e2e validation. The output should identify repeated failure classes and recommend bounded follow-up work that can become a workflow or fix, not a generic report.

## 7. Sequencing

Recommended order:

1. **CLI/banner conformance proof** - lock the near-term UX deliverable as a regression gate before adding more behavior.
2. **Onboarding-to-local/BYOH proof** - prove a local user can move from first-run to a real normalized request without Cloud.
3. **Cloud onboarding and parity proof** - prove Cloud uses equivalent product intent while keeping provider/auth blockers explicit.
4. **Runtime execution proof harness** - add the evidence-producing harness needed for real e2e validation.
5. **Local spec-to-artifact-to-runtime proof** - connect CLI, product, validator, local, runtime, and diagnostics in one local path.
6. **Environment recovery coordinator** - implement recovery decisions once runtime proof evidence exists.
7. **Recovery and rerun safety proof** - prove recovery does not become blind retry behavior.
8. **Analytics proof-loop feedback** - consume the evidence produced by the previous workflows and turn it into bounded recommendations.

Dependencies:

| Workflow | Depends on |
|---|---|
| 01-prove-cli-banner-and-command-conformance | CLI/banner UX spec and existing CLI command surface |
| 02-prove-onboarding-to-local-byoh-handoff | 01 |
| 03-prove-cloud-onboarding-and-generate-parity | 01 |
| 04-implement-real-runtime-execution-proof-harness | Existing runtime evidence and diagnostics modules |
| 05-prove-local-spec-to-artifact-to-runtime | 02 and 04 |
| 06-implement-environment-recovery-coordinator | 04 and existing failure taxonomy |
| 07-prove-recovery-and-rerun-safety | 03, 05, and 06 |
| 08-implement-proof-analytics-feedback-loop | 04, 05, and 07 |

## 8. What Should Wait

These are important, but they should wait until the proof-hardening batch is complete:

| Area | Why it waits |
|---|---|
| Slack surface | Slack should reuse proven request, proof, recovery, and analytics contracts instead of becoming another unproven path. |
| Web onboarding | Web can reuse the local/Cloud onboarding parity rules after those rules are proven in CLI. |
| MCP/assistant handoff | MCP should route into the same normalized product path; prove that path first through CLI/local/Cloud. |
| Full autonomous repair | Recovery and rerun safety must be proven before automated repair decisions expand. |
| Cloud deployment/worker infrastructure | Cloud request and provider proof should be stronger before deployment becomes the bottleneck. |
| Broad provider expansion | Provider-specific work should wait until Cloud/local parity and setup-blocker handling are proven. |

## 9. Decision

Build **Wave 6 - Follow-Through and Proof Hardening** as an 8-workflow batch.

The immediate next workflow should be `wave6-proof/01-prove-cli-banner-and-command-conformance.ts`. That locks the CLI/banner UX spec as a near-term deliverable and regression contract. After that, proceed through local/BYOH onboarding proof, Cloud parity proof, real runtime/e2e validation, environment recovery, and analytics proof loops in the sequence above.

This is deliberately narrower than a full Ricky roadmap. It gives later workflow authors concrete workflow names, priorities, proof expectations, and dependencies while avoiding a broad backlog dump.
