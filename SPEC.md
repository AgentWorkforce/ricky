# Ricky Specification

## 1. Overview

Ricky is a workflow reliability, workflow coordination, and workflow authoring product for AgentWorkforce.

Ricky's core job is not generic assistant chat. Ricky is specifically responsible for:
- understanding Agent Relay workflows deeply
- generating new workflows from user intent/specs
- debugging workflow failures
- fixing broken workflows
- coordinating workflow execution
- restarting or rerunning workflows safely when needed
- proactively notifying users about workflow failures and degraded workflow health
- analyzing workflow runs over time and suggesting concrete workflow improvements
- returning resulting workflow artifacts when Ricky writes or coordinates runs

Ricky should work through three co-equal interfaces:
- **Local / BYOH mode**: runs against local repos, local tools, local agent-relay, and local skill loading
- **Cloud API**: hosted through `AgentWorkforce/cloud`, with an API surface that can generate workflows from a spec, return downloadable artifacts, and optionally kick off execution and return resulting code artifacts
- **Slack**: an interactive surface for workflow debugging, generation, coordination, and proactive notifications

Slack is a product surface, not Ricky's core identity.

Ricky should be implemented on top of **Agent Assistant** rather than as a standalone runtime stack.

---

## 2. Problem Statement

Today, workflows in the AgentWorkforce ecosystem are powerful but fragile in a few recurring ways:
- workflows can compile but fail operationally at runtime
- workflow debugging often requires deep Relay-specific knowledge
- restart/rerun decisions are operationally sensitive and easy to get wrong
- workflow generation quality depends heavily on the author knowing Relay patterns, step sizing rules, validation loops, and swarm-pattern tradeoffs
- workflow failures often surface late, without a dedicated product focused on triage, recovery, and optimization

Sage is a general assistant.
NightCTO is an operational/founder-facing observability agent.
Neither is explicitly the product for **workflow creation + workflow reliability + workflow recovery + workflow analytics**.

Ricky fills that gap.

---

## 3. Research Summary by Existing Repo

### 3.1 `relay`

**What matters:** Ricky must be deeply native to the Relay workflow model rather than treating workflows as opaque files.

Key evidence:
- `relay/packages/sdk/src/workflows/builder.ts`
  - Relay has a typed WorkflowBuilder with explicit agents, steps, verification, cloud execution options, retries, and swarm patterns.
- `relay/packages/sdk/src/workflows/runner.ts`
  - the runner owns parsing, validation, template resolution, retries, verification, state persistence, pause/resume/abort semantics, budgets, process spawning, and evidence capture.
- `skills/skills/writing-agent-relay-workflows/SKILL.md`
  - strongest operational guidance for authoring workflows correctly
  - especially step sizing, deterministic verification, test-fix-rerun loops, and dry-run validation.
- `skills/skills/choosing-swarm-patterns/SKILL.md`
  - pattern selection is a first-class design problem, not an afterthought.
- `skills/skills/relay-80-100-workflow/SKILL.md`
  - critical bar: workflows must prove real end-to-end correctness, not just build/typecheck.

**Implication for Ricky:**
Ricky must be workflow-native at the builder/runner/evidence level, not just a prompt wrapper around `agent-relay run`.

### 3.2 `agent-assistant`

**What matters:** Ricky should build on Agent Assistant seams instead of inventing its own assistant runtime.

Key evidence:
- `relay-agent-assistant/SPEC.md`
  - assistant architecture separates surfaces, turn-context, policy, harness/execution, continuation, proactive, connectivity, coordination.
- package boundaries already exist for:
  - `core`
  - `surfaces`
  - `turn-context`
  - `policy`
  - `proactive`
  - `specialists`
  - `webhook-runtime`
  - `vfs`
  - `sdk`

**Implication for Ricky:**
Ricky should be composed from Agent Assistant packages:
- Slack ingress via `surfaces` / `webhook-runtime`
- turn shaping via `turn-context`
- execution / BYOH via `harness`
- proactive follow-up via `proactive`
- specialist orchestration via `specialists`
- VFS/evidence interactions via `vfs`

Ricky should be a product built **on** Agent Assistant, not a competing assistant substrate.

### 3.3 `sage`

**What matters:** Sage provides the closest product/runtime reference for an agent product that can run in cloud and BYOH modes, with Slack as one major surface.

Key evidence:
- `sage/package.json`
  - direct use of many `@agent-assistant/*` packages
- `sage/src/app/slack-webhooks.ts`
  - shared Slack ingress flow using Agent Assistant surfaces/webhook runtime
  - includes dedup, thread handling, notify preferences, router integration, and runtime services
- `cloud/services/sage/README.md`
  - operational deployment shape in Cloud
- Sage patterns already cover:
  - Slack ingress
  - BYOH/runtime routing
  - proactive behavior
  - specialist routing
  - RelayFile-backed evidence paths

**Implication for Ricky:**
Ricky should reuse Sage’s assistant/runtime patterns, but specialize them around workflows:
- workflow ingestion
- workflow debugging
- workflow restart/rerun
- workflow authoring
- workflow quality guidance

Ricky should not copy Sage’s product identity or generic-purpose agent scope.

### 3.4 `nightcto`

**What matters:** NightCTO provides the best reference for proactive operational behavior and gateway/runtime seams.

Key evidence:
- `nightcto/apps/gateway/src/index.ts`
  - gateway pattern for channel ingress, health, webhook handling, outbound routing
- `nightcto/FAILED_WORKFLOWS_CLEANUP.md`
  - clear evidence that workflow debugging, reruns, deadlock repair, and failure categorization are recurring product needs
- NightCTO work already separates:
  - runtime wiring
  - observability-driven actions
  - channel surfaces
  - specialist orchestration
  - durable output seams

**Implication for Ricky:**
Ricky should borrow NightCTO’s proactive/ops posture, but point it specifically at workflow systems instead of founder observability.

### 3.5 `cloud`

**What matters:** Ricky Cloud should be hosted through `cloud`, and should likely reuse cloud worker + specialist + cataloging patterns.

Key evidence:
- `cloud/infra/sage.ts`
  - Sage deployment is stage-aware and hosted as a Cloudflare worker through Cloud
- `cloud/packages/specialist-worker/src/routes.ts`
  - specialist-worker already exposes delegated specialist capabilities with auth, workspace scoping, and RelayFile integration
- `cloud/packages/cataloging-agent-github/src/index.ts`
  - cataloging pattern already exists for workspace discovery + periodic insight generation

**Implication for Ricky:**
Ricky’s hosted shape should likely include:
- a Ricky worker/service deployed from `cloud`
- Ricky-specific specialist capabilities where warranted
- Ricky analytics/cataloging jobs for workflow health, failures, retries, restart rates, duration outliers, and pattern-level insights

### 3.6 `skills`

**What matters:** Ricky’s quality advantage should come partly from loading and applying the right workflow-writing skills automatically.

Key evidence:
- `skills/skills/writing-agent-relay-workflows/SKILL.md`
- `skills/skills/choosing-swarm-patterns/SKILL.md`
- `skills/skills/relay-80-100-workflow/SKILL.md`

**Implication for Ricky:**
Ricky should have explicit skill-selection logic around workflow generation and workflow repair:
- default to TypeScript workflows
- do not default blindly to `dag`
- use 80→100 validation slices when workflow correctness matters
- prefer bounded deterministic verification and test-fix-rerun loops

---

## 4. Product Thesis

Ricky is the **workflow reliability and workflow generation agent** for the AgentWorkforce ecosystem.

If Sage answers broad user requests and NightCTO manages operational/business signals, Ricky owns:
- workflow authoring
- workflow debugging
- workflow recovery
- workflow quality improvement
- workflow analytics

Ricky is intentionally narrower and more opinionated than a general assistant.
That narrower scope is a feature.

---

## 5. What Ricky Should Be

Ricky should be:

### 5.1 A workflow-native product across local, API, and Slack surfaces
Users should be able to ask or invoke Ricky through local tooling, API calls, or Slack for things like:
- “Why did this workflow fail?”
- “Fix this workflow and rerun it.”
- “Generate a workflow from this spec.”
- “What swarm pattern should this workflow use?”
- “Why is this workflow hanging?”
- “How can we reduce workflow runtime and retries?”
- “Write this workflow, run it, and return the artifacts.”

### 5.2 A proactive workflow operations agent
Ricky should proactively:
- notice workflow failures in Cloud
- detect repeated retries / restart loops
- detect unusual runtime duration or timeout patterns
- surface workflow flakiness and regression trends
- suggest improvements to workflow definitions and execution patterns

### 5.3 A workflow authoring expert
Ricky should know how to produce workflows that are:
- Relay-native
- skill-aware
- verification-heavy
- local/BYOH-friendly
- cloud-compatible when needed
- realistic about retry, completion evidence, and deterministic checks

### 5.4 A dual-mode product
Ricky should support:
- **Local/BYOH**
  - write workflows into a local repo
  - inspect logs/artifacts locally
  - run/fix/retry workflows using local `agent-relay`
- **Cloud**
  - accept a spec + API key
  - generate workflow artifacts
  - return downloadable code/artifacts
  - optionally launch the workflow and track its result

---

## 6. What Ricky Should Not Be

Ricky should not be:
- a generic chat assistant competing with Sage
- a founder observability product competing with NightCTO
- a replacement for Relay itself
- a thin wrapper over `agent-relay run` without product-specific reasoning
- a pure code-generation bot that emits workflows without verifying them
- a product that claims “workflow fixed” without proving the user-visible failure is gone

Most importantly, Ricky should not stop at “code compiles.”
It should inherit the **80→100** mindset for workflow generation and repair.

---

## 7. Core User Journeys

### 7.1 Debug a failed workflow
Input:
- failing workflow run
- logs/evidence

Ricky should:
1. classify failure type
2. map it to likely workflow-layer causes
3. suggest or apply a bounded fix
4. rerun safely if allowed
5. return outcome + artifacts + explanation

### 7.2 Generate a workflow from a spec
Input:
- natural-language or structured workflow spec

Ricky should:
1. choose workflow representation (default TS)
2. choose swarm pattern deliberately
3. select/apply relevant skills
4. produce workflow artifact(s)
5. validate with dry-run and bounded deterministic checks
6. return downloadable files, or kick off execution in Cloud/local mode when requested

### 7.3 Coordinate and run a workflow
Input:
- workflow spec or existing workflow artifact
- execution preference (local/BYOH or Cloud)

Ricky should:
1. determine the right execution environment
2. prepare or update the workflow artifact if needed
3. coordinate workflow launch
4. monitor progress / failure state
5. return resulting code artifacts, logs, and outcomes

### 7.4 Proactive workflow failure notification

### 7.3 Proactive workflow failure notification
Input:
- failure or degraded health signal from Cloud/workflow analytics

Ricky should:
1. classify urgency and recurrence
2. summarize what failed and why it probably failed
3. suggest next actions
4. optionally trigger safe remediation or ask for approval

### 7.4 Workflow improvement analytics
Input:
- many workflow runs over time

Ricky should:
1. identify common failure classes
2. identify bad pattern choices, oversized steps, or weak verification
3. recommend concrete workflow design improvements
4. produce digests/reports

---

## 8. System Architecture Proposal

### 8.1 Product architecture
Ricky should follow this split:

- **Ingress / surfaces**
  - local/BYOH invocation
  - API endpoint in Cloud for workflow generation/execution requests
  - Slack interactive surface
- **Assistant runtime**
  - Agent Assistant packages
- **Workflow domain logic**
  - Ricky-owned orchestration / diagnosis / generation layer
- **Execution plane**
  - local BYOH via local `agent-relay`
  - cloud execution via `cloud` workflow APIs / Cloud runtime
- **Evidence plane**
  - logs, run metadata, artifacts, possibly RelayFile-backed evidence over time
- **Analytics plane**
  - cataloging + scheduled analysis of workflow health and patterns

### 8.2 Internal subsystems

#### A. Ricky surfaces
Initial surfaces should include:

#### Slack ingress
Should mirror proven Slack patterns from Sage/NightCTO:
- signature verification
- dedup
- thread handling
- outbound delivery
- health route

#### Local/BYOH invocation
Should support:
- local repo inspection
- local workflow artifact creation
- local `agent-relay` validation/run coordination
- local log and artifact return

#### Cloud API ingress
Should support:
- authenticated workflow generation requests
- authenticated workflow coordination/run requests
- artifact return/download flows

#### B. Ricky Domain Core
The Ricky-owned core should classify requests into domains like:
- workflow generation
- workflow debugging
- workflow restart/rerun
- workflow analytics
- workflow quality coaching

#### C. Ricky Specialists
Ricky should use specialists where the task is clearly separable, for example:
- **workflow-author specialist**
  - writes or rewrites workflow files
- **workflow-debugger specialist**
  - diagnoses failed runs/logs
- **workflow-validator specialist**
  - applies 80→100 validation expectations
- **workflow-analytics specialist**
  - mines run histories and suggests improvements
- **runtime-restart specialist**
  - evaluates whether rerun/restart is safe and what mode to use

These should use the Cloud specialist architecture pattern where it genuinely helps.

#### D. Local / BYOH runtime adapter
Ricky should be able to:
- detect local project context
- detect available local skills/workflow repo conventions
- invoke local `agent-relay` safely
- read logs and run status locally

#### E. Cloud runtime + API
In Cloud, Ricky should expose an endpoint that can accept:
- API key
- workflow spec / structured request
- execution preference
  - generate only
  - generate + run
  - generate + run + return artifacts

Response modes:
- workflow artifact bundle
- run started + run ID
- final result + artifacts when synchronous mode is acceptable

#### F. Analytics/cataloging
Ricky should likely use cataloging patterns for:
- failed workflow frequency
- retry rate by workflow
- median/p95 runtime by workflow
- timeout incidence
- deadlock/hang incidence
- fix success rate after Ricky intervention
- recommended pattern migrations (for example pipeline → dag)

---

## 9. Repo / Placement Recommendation

### Recommendation
Create **a dedicated `ricky` product repo**.

Why:
- Ricky is a real product, not just a Cloud-only feature
- it needs local/BYOH usage and Cloud usage
- it should have its own identity, spec, Slack app, runtime seams, and docs
- it should reuse Agent Assistant packages, not live inside them
- it should deploy through `cloud`, but not be defined by `cloud`

### Relationship to existing repos
- `ricky`
  - product repo, source of truth for Ricky product/runtime/spec/app code
- `cloud`
  - deployment host and cloud service integration point
- `relay-agent-assistant`
  - shared assistant/runtime substrate Ricky composes
- `relay`
  - workflow engine/platform Ricky is expert in
- `skills`
  - workflow-authoring knowledge layer Ricky should actively use

### Expected future cloud integration
Cloud should eventually host:
- Ricky runtime/worker deployment
- Ricky API endpoint(s)
- Ricky proactive analytics jobs
- Ricky-specific workspace/runtime secrets where needed

---

## 10. Data / Evidence Model

Ricky should reason over more than raw chat input.
It should use a workflow evidence model with artifacts such as:
- workflow source file
- dry-run report
- workflow run metadata
- per-step status
- logs
- completion evidence / verification failures
- retry history
- output artifacts
- prior fix attempts

A future RelayFile-backed model may be useful here, but Ricky should not require a full RelayFile-first architecture to deliver its first version.

---

## 11. Cloud Product/API Shape

### 11.1 Initial endpoint concept
A Cloud-hosted Ricky endpoint should eventually accept requests like:
- `POST /api/v1/ricky/workflows/generate`
- `POST /api/v1/ricky/workflows/generate-and-run`
- `POST /api/v1/ricky/workflows/debug`
- `POST /api/v1/ricky/workflows/restart`

### 11.2 Request shape
At minimum:
- auth / API key
- workspace/project context
- natural-language or structured workflow spec
- mode
  - generate only
  - generate and return artifacts
  - generate and run

### 11.3 Response shape
- artifact bundle or files
- warnings / assumptions
- run metadata if kicked off
- suggested follow-up actions

---

## 12. Execution / Swarm Strategy

Ricky should not default blindly to one pattern.

Recommended defaults:
- **generation**: `dag` if workflow authoring + validation can fan out; otherwise `pipeline`
- **debugging**: `hub-spoke` or `dag`
- **recovery decisions**: `handoff` or `hub-spoke`
- **analytics**: `fan-out` or `dag`
- **cheap first-pass triage**: `cascade`

Ricky should encode pattern choice as a first-class design decision and explain it when asked.

---

## 13. Local / BYOH Strategy

Ricky’s local mode should explicitly support:
- local repo inspection
- local workflow file generation
- local skill loading
- local `agent-relay` validation and execution
- local run/log analysis

Key constraint:
Ricky should know the difference between:
- writing a workflow intended for local execution
- writing a workflow intended for Cloud execution
- writing a workflow that should support both

That means Ricky must reason about environment assumptions rather than generating one-size-fits-all workflow code.

---

## 14. Constraints / Traps to Preserve

### Preserve these rules
- do not claim workflow fixes without proving the original failure is gone
- do not default to one swarm pattern blindly
- do not overstuff single steps with too many file edits or responsibilities
- keep deterministic verification close to each significant step
- keep product identity separate from execution backend choice
- keep Cloud-specific deployment/runtime glue in `cloud`
- keep reusable assistant abstractions in Agent Assistant, not Ricky-local unless truly product-specific

### Avoid these traps
- a generic workflow “copilot” with no operational rigor
- pure architecture/spec work without real end-to-end proof slices
- giant monolithic agent logic instead of bounded specialists where helpful
- overpromising autonomous restart/remediation without explicit safety policy

---

## 15. Recommended Initial MVP

### MVP scope
1. Local/BYOH workflow debugging and authoring assistant
2. Cloud API for workflow generation / coordination / execution
3. Slack surface for interactive requests and proactive notifications
4. workflow generation from a spec
5. dry-run validation + bounded local proof loop
6. proactive notification for failed workflow runs in Cloud
7. simple workflow health analytics digest

### Explicitly out of MVP
- full autonomous workflow repair at scale
- broad multi-channel support beyond Slack
- full RelayFile-backed workflow evidence substrate
- heavy UI/dashboard product work
- all-provider workflow generation beyond Relay-native workflows

---

## 16. First Implementation Slice Recommendation

The first implementation slice should be:

**“Ricky can take a workflow spec, generate a Relay TypeScript workflow using the right skills/pattern heuristics, validate it locally with dry-run + bounded deterministic checks, and return the artifact in Slack or via API.”**

Why this first:
- proves product identity quickly
- is deeply aligned with Ricky’s core thesis
- exercises workflow expertise rather than generic chat
- works in local/BYOH mode first
- sets up the Cloud API and proactive failure work naturally after

---

## 17. Recommended First Spec Outline

The implementation spec after this product spec should cover:

1. product goals and non-goals
2. assistant/runtime composition on top of Agent Assistant
3. Slack ingress model
4. local/BYOH execution model
5. Cloud API model
6. workflow generation pipeline
7. skill loading strategy
8. swarm-pattern selection strategy
9. bounded validation / proof strategy
10. specialist architecture
11. proactive failure signal model
12. analytics/cataloging model
13. deployment placement in Cloud
14. MVP slice and proof gates

---

## 18. Initial Repo Structure Recommendation

```text
ricky/
  README.md
  SPEC.md
  assets/
    ricky-logo.svg
  docs/
    architecture/
      ricky-runtime-architecture.md
      ricky-cloud-api.md
      ricky-workflow-generation-pipeline.md
  src/
    (later)
  slack/
    manifest.json
  workflows/
    (later: Ricky-authored proving workflows)
```

---

## 19. Open Questions

1. Should Ricky be deployed as a dedicated worker/service like Sage, or as a Cloud web/API + worker split?
2. How much of workflow evidence should be durably normalized versus read live from Relay run state/logs?
3. Should restart/rerun authority require explicit per-workspace policy and approvals?
4. Should workflow analytics use a Ricky-specific cataloging agent, or piggyback on broader Cloud cataloging infrastructure?
5. How much should Ricky rely on Cloud specialist-worker versus product-local specialist orchestration in v1?
6. Should Ricky own workflow artifact storage, or return generated artifacts inline/download-first in v1?

---

## 20. Decision

Proceed with Ricky as a new dedicated product repo, built on Agent Assistant, deployed through Cloud, and focused on workflow generation, workflow debugging, workflow recovery, and workflow analytics.
