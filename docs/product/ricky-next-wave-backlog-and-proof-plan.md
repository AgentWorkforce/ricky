# Ricky Next-Wave Backlog and Proof Plan

## Purpose

This backlog should stay explicitly aligned with the original workflow monitor-agent problem captured in `AgentWorkforce/cloud#161`. Ricky is not just a general workflow product idea; it is the productization of the need for a cheap, observant, restart-aware workflow monitor that can diagnose failures, apply bounded fixes, and resume from the right point with evidence.

This document defines the bounded next Ricky backlog after the first-wave buildout and proof closure. It is a workflow-authoring plan, not a replacement product spec, and it does not create follow-on workflow files.

The goal is to make the next implementation and proof workflows specific enough to author without rediscovering priorities, evidence bars, or sequencing.

## Current First-Wave Status

As of 2026-04-28, Ricky has a real npm workspace split across six private packages:

| Package | Current scope | Current proof |
|---|---|---|
| `@ricky/shared` | Shared models, config, constants | Covered through downstream package tests |
| `@ricky/runtime` | Local coordinator, evidence capture, failure classifier, diagnosis engine, unblocker proof | 134 package tests |
| `@ricky/product` | Spec intake, generation pipeline, debugger specialist, validator specialist, workflow health analytics | 75 package tests |
| `@ricky/cloud` | Cloud auth validation, workspace scoping, provider guidance, generate endpoint, cloud proof | 88 package tests |
| `@ricky/local` | Local/BYOH request normalization, entrypoint, local proof | 98 package tests |
| `@ricky/cli` | Banner/welcome primitives, mode selection, onboarding proof, interactive entrypoint, current command surface, linked external-repo CLI proof | 136 package tests |

The root proof suite adds 21 smoke and package-layout tests. `npm test` passes across all workspaces and root proof tests, for 552 passing tests total. The repo currently contains 51 TypeScript workflow files, including 31 first-wave product-build workflows, 2 runtime debug canaries, the meta workflow, the Wave 6 closure workflow, and later Wave 7-9 proof/issue workflows.

### Signoff State

The Wave 6 closure workflow (`workflows/wave6-proof/01-close-first-wave-signoff-and-blockers.ts`) ran on 2026-04-27 and closed all 16 previously unsigned product-build workflows. Result: **16/16 SIGNED_OFF, 0 BLOCKED**.

Combined with the 15 product-build workflows that already had signoff, Ricky now has **31/31 product-build workflows signed off**. The two runtime debug canaries have separate signoff under `.workflow-artifacts/runtime-debug/`. Wave 6 closure evidence lives under `.workflow-artifacts/wave6-proof/close-first-wave-signoff-and-blockers/`.

### What Is Proven

- Workspace package layout, scripts, typecheck wiring, and test wiring are operational.
- Runtime coordinator, evidence capture, failure classification, diagnosis, and unblocker proof are unit-proven.
- Product spec intake, workflow generation, debugger, validator, and analytics modules are unit-proven.
- Cloud auth, workspace scoping, provider setup guidance, and generate endpoint behavior are unit-proven.
- Local/BYOH normalization and local entrypoint behavior are unit-proven.
- CLI banner/onboarding behavior, the current command surface, and linked external-repo CLI invocation proof are covered deterministically.
- First-wave workflow signoff evidence exists for all product-build workflows.

### What Is Not Proven

- No full user journey crosses CLI/local/cloud/runtime/product boundaries end to end.
- No real local `agent-relay` execution loop is proven from spec to outcome artifact.
- No Slack, MCP/assistant handoff, or Web surface exists.
- No proactive failure detection or notification loop exists.
- No restart/rerun specialist exists.
- No Cloud deployment worker, scheduled analytics job, or live Cloud run-state ingestion exists.
- Local/BYOH and Cloud behavior are not yet proven equivalent for the same user intent.
- CLI target commands from the CLI/banner UX spec are not fully wired.

## CLI/Banner UX Deliverable Boundary

The CLI/banner UX spec at `docs/product/ricky-cli-onboarding-ux-spec.md` is its own near-term deliverable and regression contract.

The current runnable CLI is still development-mode oriented: `npm start`, `npm start -- --mode <local|cloud|both>`, `help`, and `version`. The spec's target user-facing commands and flags are not all implemented yet: `setup`, `welcome`, `generate --spec`, `generate --spec-file`, `generate --spec-stdin`, `status`, `--quiet`, and `--no-banner`.

Therefore the next wave should not treat the spec as a product surface that is already complete. It should first prove implementation follow-through against the spec, then use that honest CLI surface as one input to the cross-surface proof work.

## Recommended Bounded Next Batch

Before expanding into broader surfaces, each next-wave workflow should be checked against that originating monitor-agent intent. If a workflow does not improve Ricky's ability to monitor, diagnose, recover, resume, or explain workflow runs truthfully, it is probably a later-wave concern rather than current critical path work.

Do **not** open a broad "everything Ricky eventually needs" wave next. The next batch should be seven workflows: three implementation workflows and four proof workflows.

For the immediate gym-run push, the first authored Wave 7 workflow batch is now:
- `workflows/wave7-cli-proof/01-implement-cli-ux-spec-conformance.ts`
- `workflows/wave7-cli-proof/02-prove-cli-onboarding-command-journeys.ts`
- `workflows/wave7-local-proof/03-prove-local-byoh-spec-to-artifact-loop.ts`
- `workflows/wave7-runtime-proof/05-prove-runtime-execution-outcome-loop.ts`
- `workflows/wave7-recovery/06-implement-environment-recovery-unblockers.ts`
- `workflows/wave7-analytics-proof/07-prove-proof-loop-analytics-feedback.ts`

These are intended to move Ricky from the current local readiness dead-end toward a retestable local-first journey after a bounded workout-length run, without pretending live end-to-end proof already exists.
 This is enough to move Ricky from signed-off subsystems to proven product journeys without mixing in every future surface.

### Priority 1: CLI/Banner UX Follow-Through

**Workflow:** `wave7-cli-proof/01-implement-cli-ux-spec-conformance.ts`

**Type:** Implementation

**Why it matters:** The CLI/banner UX spec is Ricky's nearest user-facing deliverable. If the implementation keeps advertising only development-mode behavior, users cannot rely on the spec, and later onboarding proof will be built on a false surface.

**Scope:**

- Wire the parser and dispatcher for `setup`, `welcome`, `generate`, and `status`.
- Add `--quiet`, `-q`, and `--no-banner` behavior.
- Build `generate` around `CliHandoff` and `normalizeRequest()` rather than bypassing local/BYOH intake.
- Keep help output truthful: only advertise commands that work.
- Preserve current development invocation through `npm start -- ...` until a published bin exists.

**Success looks like:**

- Each target command produces deterministic, user-facing output or a structured blocker.
- `generate` refuses empty specs and missing spec files with recovery guidance.
- Non-TTY, quiet, and no-banner modes suppress decorative output correctly.
- Help and examples match actual behavior.

**Required evidence/proof:**

- CLI parser and dispatcher tests for every target command and flag.
- Onboarding output tests for first-run, returning-user, non-TTY, narrow terminal, quiet, and no-banner states.
- Local/BYOH handoff test proving `generate` routes through `normalizeRequest()`.
- Regression: `npm test` and `npm run typecheck`.

### Priority 2: Onboarding Proof From Real CLI Commands

**Workflow:** `wave7-cli-proof/02-prove-cli-onboarding-command-journeys.ts`

**Type:** Proof

**Why it matters:** Existing onboarding proof covers banner and onboarding primitives. The next proof must cover the real command journeys users will invoke, including failure and recovery paths.

**Scope:**

- Prove `setup` and default first-run behavior.
- Prove `welcome` renders the banner/welcome contract without prompting for mode.
- Prove `status` reflects local/BYOH and Cloud readiness without inventing provider state.
- Prove `generate` handles inline, file, and stdin specs.
- Prove recovery for missing config, missing toolchain, missing Cloud auth, stale local runtime state, and corrupted config.

**Success looks like:**

- A new user can run setup and get a concrete next step for local, Cloud, or both.
- A returning user is not forced through first-run onboarding.
- Cloud setup guidance points to existing Cloud/provider flows rather than Ricky-specific OAuth inventions.
- Local/BYOH setup guidance is runnable without Cloud credentials.

**Required evidence/proof:**

- Deterministic command journey fixtures.
- Assertions that no stack traces appear in normal user-facing failures.
- Proof artifact summarizing each onboarding branch, command invoked, expected output class, and recovery result.
- Regression: all CLI tests plus `npm test`.

### Priority 3: Local/BYOH Spec-to-Artifact Proof

**Workflow:** `wave7-local-proof/03-prove-local-byoh-spec-to-artifact-loop.ts`

**Type:** Proof

**Why it matters:** Local/BYOH is one of Ricky's co-equal product modes. It is currently module-proven, but not journey-proven from a user spec through product intake and artifact return.

**Scope:**

- Exercise a CLI `generate` request in local mode.
- Normalize the request through `@ricky/local`.
- Route through product spec intake and generation.
- Validate with the product validator proof loop.
- Return a workflow artifact or an explicit setup blocker.

This proof should use controlled fixtures and a deterministic local execution adapter. It should not require live Cloud or live external provider credentials.

**Success looks like:**

- The same local spec produces a normalized request, generated workflow artifact, validation result, and user-facing summary.
- Local setup blockers are classified as local environment/setup issues, not product generation failures.
- The proof can be rerun in a clean checkout without hidden state.

**Required evidence/proof:**

- End-to-end fixture for local/BYOH happy path.
- Failure fixture for missing local prerequisites.
- Proof artifact containing normalized request, generated artifact metadata, validator result, and user-facing response.
- Regression: local, product, runtime, CLI tests plus `npm test`.

### Priority 4: Cloud Spec-to-Artifact Parity Proof

**Workflow:** `wave7-cloud-proof/04-prove-cloud-spec-to-artifact-parity.ts`

**Type:** Proof

**Why it matters:** Cloud is co-equal with local/BYOH. Ricky needs proof that the Cloud path handles the same user intent with workspace scoping, provider state, warnings, and artifact return rather than drifting into a separate product.

**Scope:**

- Exercise authenticated Cloud generate requests.
- Prove workspace scoping and provider readiness checks.
- Route through the same product intake/generation/validator behavior as local where applicable.
- Compare local and Cloud output classes for the same input spec.
- Surface missing provider state as explicit follow-up actions.

**Success looks like:**

- A valid Cloud request returns an artifact bundle, warnings, and follow-up actions.
- Missing auth, invalid workspace scope, and missing provider setup produce structured Cloud errors.
- Local and Cloud normalize the same core user intent equivalently, while preserving mode-specific metadata.

**Required evidence/proof:**

- Cloud happy-path fixture with authenticated request and workspace scope.
- Provider-missing fixture with follow-up actions.
- Parity assertion comparing local and Cloud normalized intent for the same spec.
- Regression: cloud, product, local, runtime tests plus `npm test`.

### Priority 5: Runtime/E2E Execution Proof

**Workflow:** `wave7-runtime-proof/05-prove-runtime-execution-outcome-loop.ts`

**Type:** Proof

**Why it matters:** Ricky cannot claim workflow reliability until at least one generated or selected workflow path reaches execution evidence and an outcome summary. Unit tests prove pieces; this proves the loop.

**Scope:**

- Take a validated workflow artifact from the local proof path.
- Execute through the local coordinator against a controlled subprocess or fixture-backed runner.
- Capture evidence events, gates, stdout/stderr excerpts, step outcomes, and final summary.
- Produce a user-facing result that distinguishes success, product failure, runtime failure, and environment blocker.

This proof must use a fixture-backed `agent-relay` adapter: a deterministic local subprocess runner that replays canned step events and gate results without requiring a live relay process or external state. The workflow should define the adapter contract (input: workflow artifact and run config; output: ordered step events and final status) as part of its implementation. Live `agent-relay` execution is a separate follow-on proof and should not begin until the fixture-backed proof is stable and environment recovery is proven.

**Success looks like:**

- Ricky records enough evidence to explain what ran, what passed, what failed, and what to do next.
- Runtime proof is repeatable and does not depend on stale `.agent-relay` state.
- The outcome summary is suitable for CLI, Cloud, and future Slack/MCP presentation.

**Required evidence/proof:**

- Evidence artifact with run id, step events, gate results, and final status.
- Tests for success, verification failure, timeout, and runner/environment failure.
- Proof that outcome summaries use existing failure taxonomy categories.
- Regression: runtime, local, product tests plus `npm test`.

### Priority 6: Environment Recovery and Failure Unblockers

**Workflow:** `wave7-recovery/06-implement-environment-recovery-unblockers.ts`

**Type:** Implementation

**Why it matters:** Ricky's own proving history showed that stale relay state, validation mismatch, opaque worker progress, and unsafe reruns can waste operator time. The next runtime proof should include recovery behavior, not just report failure.

**Scope:**

- Add preflight checks for `.agent-relay/`, `.relay/`, `.trajectories/`, missing config, unsupported validation commands, and already-running state.
- Add quarantine guidance for stale runtime state.
- Add restart/rerun safety decisions for known taxonomy classes.
- Keep actions conservative: classify and recommend first; mutate local state only behind explicit safe paths.

**Success looks like:**

- Environment blockers are identified before execution when possible.
- Ricky distinguishes environment blockers from product logic failures.
- Unsafe reruns are blocked with concrete remediation guidance.
- Safe retries are narrowed and evidence-backed.

**Required evidence/proof:**

- Unit tests for each preflight signal and taxonomy mapping.
- Fixture proof for stale relay state quarantine recommendation.
- Restart/rerun decision matrix for `agent_runtime.handoff_stalled`, `agent_runtime.progress_opaque`, `environment.relay_state_contaminated`, `workflow_structure.control_flow_invalid`, and `validation_strategy.repo_mismatch`.
- Regression: runtime and product tests plus `npm test`.

### Priority 7: Analytics and Proof Loop Feedback

**Workflow:** `wave7-analytics-proof/07-prove-proof-loop-analytics-feedback.ts`

**Type:** Proof

**Why it matters:** Ricky already has workflow health analytics, but it is not yet connected to proof expectations. The next batch should prove that evidence from onboarding, local, Cloud, runtime, and recovery loops can feed product decisions.

**Scope:**

- Ingest proof artifacts from the previous six workflows as fixture inputs. If any prior workflow is blocked or incomplete, use the blocked/partial artifact as-is and classify it honestly rather than skipping the journey.
- Classify proof health by journey, surface, blocker category, and regression status.
- Generate an actionable digest for the next planning cycle.
- Identify whether the next wave should prioritize Slack/MCP surfaces, live Cloud run-state ingestion, or live `agent-relay` execution.
- If the batch produced partial results, the digest must still cover all seven journeys: proven journeys cite evidence, blocked journeys cite the blocker, and unstarted journeys are listed with their unmet entry conditions.

**Success looks like:**

- Analytics reports which journeys are proven, partially proven, blocked, or unstarted.
- Recurring failure classes are visible.
- The digest produces concrete next workflow recommendations with evidence references.

**Required evidence/proof:**

- Fixture set representing passing, blocked, and partial proof artifacts.
- Digest tests that verify local/BYOH, Cloud, onboarding proof, workflow proof, and environment recovery are all represented.
- Proof artifact with prioritized recommendations and cited evidence paths.
- Regression: product analytics tests plus `npm test`.

## Sequencing

Run the next batch in this order:

1. **CLI UX follow-through**: implement the command surface first because onboarding proof and local handoff need honest commands.
2. **Onboarding proof**: prove the real CLI journeys immediately after implementation.
3. **Local/BYOH proof and Cloud parity proof in parallel**: both depend on product intake/generation and should expose normalization drift early.
4. **Runtime/e2e proof**: run after local proof has a validated artifact path.
5. **Environment recovery/unblockers**: can begin after runtime proof shape is clear; final proof should use runtime evidence classes.
6. **Analytics/proof-loop feedback**: run last so it can consume artifacts from the whole batch.

### Sub-batch parallelism guidance

- Priorities 1 and 2 are strictly serial: onboarding proof depends on real CLI commands from Priority 1.
- Priorities 3 and 4 may run in parallel after Priority 2 completes. Both consume product intake/generation and should compare outputs while normalization behavior is fresh.
- Priorities 5 and 6 are serial: environment recovery (6) needs runtime proof shape (5) to define its taxonomy inputs.
- Priority 7 is serial after all others: it consumes their artifacts.

No other parallelism is intended. If Priority 3 or 4 blocks, the other may continue, but Priority 5 should not start until both have evidence.

Checkpoint gates:

| Checkpoint | Required result | Stop condition |
|---|---|---|
| After 1-2 | CLI target commands are real and onboarding proof passes | Help advertises unavailable commands, or `generate` bypasses local/BYOH normalization |
| After 3-4 | Local and Cloud prove comparable spec-to-artifact behavior | Local and Cloud normalize the same intent incompatibly |
| Mid-batch review after 1-4 | First four workflows have signoff, no stop conditions triggered, and batch scope has not drifted | Any stop condition above was triggered, or scope expanded beyond the seven named workflows |
| After 5-6 | Runtime outcome evidence and recovery decisions are taxonomy-backed | Runtime failures are only surfaced as generic failures |
| After 7 | Analytics digest identifies proven, partial, blocked, and unstarted journeys | Digest cannot point to concrete proof artifacts |

## Proof Expectations For The Batch

Every workflow in this batch must produce more than compilation evidence.

Implementation workflows must include:

- Focused unit tests for primary behavior and recovery behavior.
- Exported APIs or fixtures that downstream proof workflows can consume.
- User-facing output or typed result contracts.
- A signoff artifact with validation commands and changed-file scope proof.
- Regression: `npm test`; `npm run typecheck` where the workflow changes TypeScript source.

Proof workflows must include:

- Deterministic fixtures for happy path and failure path.
- Evidence artifacts that show input, normalized request, decision, output, and blocker classification where applicable.
- Explicit proof of user-facing behavior, not just internal function calls.
- Failure taxonomy mapping for runtime, environment, orchestration, and validation-strategy failures.
- Scope proof showing no unrelated product files changed.

The 80-to-100 bar for this batch:

- Workflow proof must exercise a real product journey or a controlled substitute that is named honestly.
- Onboarding proof must use real CLI commands after the follow-through implementation.
- Local/BYOH proof must work without Cloud credentials.
- Cloud proof must validate auth/workspace/provider behavior, not skip it.
- Environment/failure recovery must classify before retrying.
- Analytics/proof loops must consume evidence artifacts, not manually restate outcomes.

## Follow-On Candidates After This Batch

These should wait until the seven-workflow batch above has evidence:

| Candidate | Why it waits | Entry condition |
|---|---|---|
| Slack ingress and notification surface | Slack should build on proven outcome summaries and recovery classifications | Runtime/e2e proof and recovery proof pass |
| MCP/assistant handoff surface | MCP should reuse proven CLI/local/cloud normalization behavior | Local/Cloud parity proof passes |
| Live `agent-relay` execution proof | Controlled runtime proof should stabilize first | Fixture-backed runtime proof passes and stale-state recovery is proven |
| Live Cloud run-state ingestion | Cloud spec-to-artifact parity should land before live run monitoring | Cloud parity proof passes |
| Proactive failure notification | Needs runtime evidence, recovery classification, and a delivery surface | Runtime proof plus Slack surface exist |
| Restart/rerun specialist expansion | Needs conservative recovery decisions proven first | Environment recovery/unblocker workflow passes |
| Web surface | Lower leverage than CLI, local/BYOH, Cloud parity, Slack, and MCP | Slack/MCP patterns exist |
| Scheduled analytics jobs | Current analytics proof should define the useful digest first | Proof-loop analytics produces actionable recommendations |

## Decision

Build the next wave as a bounded seven-workflow batch:

1. Implement CLI/banner UX spec conformance.
2. Prove CLI onboarding command journeys.
3. Prove local/BYOH spec-to-artifact behavior.
4. Prove Cloud spec-to-artifact parity.
5. Prove controlled runtime/e2e execution outcomes.
6. Implement environment recovery and failure unblockers.
7. Prove analytics and proof-loop feedback.

This batch follows the CLI/banner UX deliverable, proves onboarding, connects local/BYOH and Cloud paths, introduces real runtime outcome evidence, and adds environment recovery without opening Slack, MCP, Web, live Cloud infrastructure, or broad autonomous repair at the same time.
