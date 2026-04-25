# Ricky Next-Wave Backlog and Proof Plan

## 1. Purpose

Turn the work that remains after Ricky's first bounded workflow wave into an explicit, quality-first next batch.

This document exists so Ricky does not drift from:
- a bounded workflow program
- truthful proof expectations
- local/BYOH and Cloud parity
- real unblocker knowledge instead of compile-only optimism

## 2. Current first-wave status

Ricky's first major bounded workflow wave is now in place.

Current wave coverage includes:
- Wave 0 foundation
  - repo standards and conventions
  - toolchain and validation foundation
  - shared models and config
  - initial architecture docs
- Wave 1 runtime
  - local run coordinator
  - workflow evidence model
  - workflow failure classification
- Wave 2 product
  - workflow spec intake
  - workflow generation pipeline
  - workflow debugger specialist
  - workflow validator specialist
- Wave 3 Cloud API
  - Cloud connect and auth
  - generate endpoint
- Wave 4 local/BYOH
  - CLI onboarding and welcome
  - local invocation entrypoint
  - CLI onboarding UX spec workflow
- Wave 5 scale and ops
  - workflow health analytics
  - next-wave backlog and proof plan workflow

The first wave is no longer just an idea. It now has:
- a hardened source-of-truth generator/template
- a truthful TypeScript and Vitest foundation
- a 16-workflow batch expanded to 18 with two planning/spec workflows added afterward
- dry-run validation coverage across the authored workflow set
- a dedicated CLI onboarding UX spec document

## 3. What the first wave still does not prove

The first wave gives Ricky a much better execution scaffold, but it does not yet prove the whole product end-to-end.

The biggest remaining gaps are:
- actual implementation of the CLI onboarding modules described by the new UX spec
- actual implementation of the local/BYOH runtime path behind the planning workflows
- actual implementation of the Cloud-facing Ricky pieces behind the planning workflows
- end-to-end proof that a user can hand Ricky a spec and receive the right workflow generation/debug/recovery behavior
- proof that Ricky can classify and unblock environment/runtime/orchestration failures in a user-visible way
- proof that onboarding works in practice instead of only in docs/specs/workflows

## 4. Planning principles for the next wave

The next Ricky wave should preserve these rules:

1. Quality over speed.
2. Proof over compile-only comfort.
3. Template/systemic fixes over file-by-file heroics.
4. Local/BYOH, Cloud, and interactive surfaces remain co-equal.
5. Workflow recovery and unblocker knowledge must keep becoming product behavior.
6. The next wave must stay bounded enough to finish and evaluate honestly.

## 5. Recommended immediate sequence

Recommended order after the new CLI onboarding UX spec:

1. implement the CLI onboarding experience from the spec
2. prove that onboarding works through deterministic user-visible tests
3. implement the local/BYOH invocation path behind the current local workflow designs
4. prove spec handoff from CLI and MCP into Ricky's intake and local routing
5. implement the first Cloud-backed Ricky execution slice behind the current Cloud workflows
6. prove end-to-end generation/debug/recovery behavior with at least one real spec and one real failure/unblock loop
7. harden the failure taxonomy into executable Ricky diagnosis behavior

## 6. Recommended bounded next batch

The next batch should be a bounded follow-on program, not an unbounded wishlist.

### Batch A: CLI onboarding implementation and proof

#### Why it matters
Ricky now has a concrete onboarding UX spec. The next step is turning that into real user-facing behavior.

#### Suggested workflow(s)
- implement-cli-onboarding-from-ux-spec
- prove-cli-onboarding-first-run-and-recovery

#### Scope
- build the modules described in `docs/product/ricky-cli-onboarding-ux-spec.md`
- implement deterministic tests for first-run, returning-user, local/BYOH, Cloud guidance, and recovery-path output
- prove banner behavior and copy contracts

#### Required proof
- user-visible deterministic tests pass
- local/BYOH and Cloud both appear as first-class options
- Google connect guidance uses `npx agent-relay cloud connect google`
- GitHub guidance does not invent fake URLs
- at least one recovery path is tested

#### Classification
- one implementation workflow
- one proof workflow

### Batch B: local/BYOH execution implementation and proof

#### Why it matters
Ricky's local/BYOH identity is central. It should not remain a spec-only promise.

#### Suggested workflow(s)
- implement-local-byoh-entrypoint
- prove-local-spec-handoff-and-artifact-return

#### Scope
- build the local entrypoint, normalizer, and response model
- connect spec intake to local execution orchestration with injected/mockable runtime seams first
- prove artifact/log/warning outputs

#### Required proof
- a CLI or structured spec can be normalized into a local execution contract
- local mode does not silently route through Cloud
- local blockers are surfaced explicitly
- one end-to-end local happy path is proven with deterministic artifacts

#### Classification
- one implementation workflow
- one proof workflow

### Batch C: first Cloud-backed Ricky slice

#### Why it matters
Ricky must support Cloud API usage and provider-backed flows without becoming Cloud-only.

#### Suggested workflow(s)
- implement-ricky-cloud-generate-slice
- prove-cloud-connect-and-generate-happy-path

#### Scope
- implement the first honest Cloud-backed Ricky API slice behind the existing Cloud workflows
- keep the interface focused on spec intake, generation request handling, and artifact return
- use real connection patterns where already source-backed

#### Required proof
- one honest Cloud-backed generation path works
- Cloud setup and missing-provider states are explicit
- generated artifacts can be returned or surfaced coherently
- Cloud proof does not invalidate local/BYOH parity

#### Classification
- one implementation workflow
- one proof workflow

### Batch D: failure diagnosis and unblocker behavior

#### Why it matters
Ricky's differentiator is not only writing workflows. It is understanding why they fail and how to unblock them.

#### Suggested workflow(s)
- implement-failure-diagnosis-engine
- prove-runtime-environment-orchestration-unblocker-paths

#### Scope
- turn the taxonomy in `docs/architecture/ricky-failure-taxonomy-and-unblockers.md` into executable Ricky behavior
- classify at least:
  - runtime handoff stall
  - opaque progress
  - stale relay state contamination
  - control-flow invalid workflow structure
  - weak scope gate
  - repo validation mismatch
- return a diagnosis plus recommended unblock action

#### Required proof
- representative fixtures map to the correct classification
- unblock advice differs by blocker class rather than always retrying
- at least one environment blocker and one orchestration blocker are handled distinctly

#### Classification
- one implementation workflow
- one proof workflow

### Batch E: package-convention and npm package alignment

#### Why it matters
Ricky should follow the same npm/package conventions used across the other AgentWorkforce projects instead of drifting as a one-off repo shape.

#### Suggested workflow(s)
- align-ricky-package-conventions
- prove-ricky-package-layout-and-script-parity

#### Scope
- decide whether Ricky should remain intentionally single-package or move to a small multi-package layout
- align package scripts, dependency placement, and repo structure with the broader AgentWorkforce convention
- keep the change bounded and avoid breaking the already-proven CLI/workflow lanes

#### Required proof
- the chosen package layout is explicit and documented
- scripts and dependency placement match project conventions
- typecheck/test entrypoints still work after alignment
- Ricky package structure no longer feels like an unexplained exception

#### Classification
- one implementation/alignment workflow
- one proof workflow

## 7. What should wait until after the next batch

These are important, but should not outrun the core proof path:
- broader multi-surface polish across Slack and web onboarding
- deeper analytics and proactive alerting beyond the first useful health slice
- full autonomous repair loops without operator review
- large-scale backlog expansion into many more workflow files
- broad Cloud productionization before the local/BYOH and first Cloud proof slices are honest

## 8. Proof expectations by area

### CLI/onboarding proof
Must show user-visible behavior, not just internal module existence.

### Local/BYOH proof
Must show a spec can become a real local Ricky action with artifacts, logs, or warnings.

### Cloud proof
Must show at least one real Cloud-backed path with honest connection and artifact behavior.

### Diagnosis/unblocker proof
Must show Ricky distinguishes blocker classes and recommends different unblockers.

### Regression proof
Must continue to use exact or bounded change-scope gates, post-fix validation, final re-review, and final signoff.

## 9. Recommended authoring pattern for the next batch

For each next-wave implementation area, prefer this pair:
- implementation workflow
- proof workflow

Why:
- implementation and proof often diverge in failure mode
- a compile-clean implementation can still fail the actual product contract
- proof workflows keep Ricky honest about 80-to-100 behavior

Where possible, proof workflows should run after implementation workflows and use:
- clean or isolated setup when relevant
- deterministic artifact checks
- before/after evidence where a bug or blocker is involved
- explicit residual-risk recording

## 10. Suggested next concrete workflow names

These names are recommendations, not yet authored files:

- `workflows/wave4-local-byoh/04-implement-cli-onboarding-from-ux-spec.ts`
- `workflows/wave4-local-byoh/05-prove-cli-onboarding-first-run-and-recovery.ts`
- `workflows/wave4-local-byoh/06-implement-local-byoh-entrypoint.ts`
- `workflows/wave4-local-byoh/07-prove-local-spec-handoff-and-artifact-return.ts`
- `workflows/wave3-cloud-api/03-implement-ricky-cloud-generate-slice.ts`
- `workflows/wave3-cloud-api/04-prove-cloud-connect-and-generate-happy-path.ts`
- `workflows/wave1-runtime/04-implement-failure-diagnosis-engine.ts`
- `workflows/wave1-runtime/05-prove-runtime-environment-orchestration-unblockers.ts`
- `workflows/wave5-scale-and-ops/03-align-ricky-package-conventions.ts`
- `workflows/wave5-scale-and-ops/04-prove-ricky-package-layout-and-script-parity.ts`

## 11. Why this sequencing is recommended

This order keeps Ricky honest:
- the onboarding UX spec turns into real behavior first
- the local path becomes real next, preserving Ricky's local/BYOH promise
- Cloud follows as a real slice rather than documentation theater
- diagnosis/unblocker behavior then becomes a proven differentiator instead of a research note only

It also keeps the batch bounded and understandable.

## 12. Risks if we skip this plan

If Ricky skips this next-wave structure, likely failure modes are:
- too many new workflows without enough proof
- over-investment in spec scaffolding with not enough implementation truth
- Cloud-only drift that weakens local/BYOH credibility
- continued runtime/environment blocker rediscovery rather than productized unblockers
- false confidence from compile/test-only progress

## 13. Decision

The recommended next Ricky wave is a bounded proof-oriented batch centered on:
- CLI onboarding implementation and proof
- local/BYOH implementation and proof
- first Cloud-backed Ricky slice and proof
- failure diagnosis/unblocker implementation and proof

The immediate next thing to build after the new CLI onboarding UX spec is:
- the actual CLI onboarding implementation workflow
- followed immediately by a proof workflow for first-run and recovery behavior
