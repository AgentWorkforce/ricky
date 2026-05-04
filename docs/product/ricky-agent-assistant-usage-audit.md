# Ricky Agent-Assistant Usage Audit

## Executive summary

Ricky is directionally aligned with the `agent-assistant` ecosystem, but it is not yet deeply composed from shared `agent-assistant` runtime packages in the way some of Ricky's own architecture docs imply. The strongest real reuse today is `@agent-relay/sdk` for workflow authoring and execution conventions, plus Ricky's own generation-time skill system for Relay workflow production. Beyond that, much of Ricky's current local-first product behavior is implemented as Ricky-local code rather than shared assistant-runtime reuse.

The honest current verdict is:

- **Direct shared-runtime reuse:** light
- **Conceptual alignment:** high
- **Product-local assistant-like implementation:** substantial
- **Risk:** Ricky can overclaim agent-assistant adoption if docs are read literally rather than against current code truth

This means Ricky is in a good position to adopt more `agent-assistant` infrastructure later, but it should not yet be described as a strongly agent-assistant-native product.

## Real agent-assistant reuse today

### 1. Relay workflow runtime and authoring substrate are real

Ricky has one strong shared dependency at the repo level:

- `@agent-relay/sdk`
- `@agent-assistant/turn-context`

The Relay dependency is real and central. Ricky uses `workflow()` from `@agent-relay/sdk/workflows` throughout authored workflows and generated workflow artifacts. Its product output, validation expectations, and execution contract are built around Relay-native TypeScript workflows rather than a Ricky-only workflow DSL.

`@agent-assistant/turn-context` is also a landed direct adoption slice. Ricky maps normalized local requests into the shared turn context envelope and records compact provenance in generation decisions and local coordinator metadata. This is intentionally narrow and does not move Ricky's workflow artifact contract, blocker taxonomy, runtime prechecks, or execution semantics into Agent Assistant.

This matters because Ricky is not inventing a separate workflow runtime. It is building a product on top of the Relay workflow substrate.

### 2. Generation-time skill loading is real

Ricky has a real generation-time skill layer under:

- `src/product/generation/skill-loader.ts`
- `src/product/generation/pipeline.ts`
- `src/product/generation/template-renderer.ts`

Observed loaded skills include:

- `writing-agent-relay-workflows`
- `choosing-swarm-patterns`
- `relay-80-100-workflow`

This is real reuse of shared skill content and conventions, and it materially shapes generated workflow structure, metadata, and validation gates. Ricky already has a documented product boundary for this in:

- `docs/product/ricky-skill-embedding-boundary.md`

That boundary is honest: skills are applied at **generation time**, not embodied by runtime agents.

### 3. Agent-assistant alignment is present in architecture and product intent

Ricky's docs repeatedly position the product as composed above `agent-assistant` ideas and packages, including references to:

- surfaces
- webhook runtime
- turn context
- specialists
- proactive behavior
- vfs
- harness
- sdk

These references appear in docs such as:

- `docs/architecture/ricky-runtime-architecture.md`
- `docs/architecture/ricky-surfaces-and-ingress.md`
- `docs/architecture/ricky-specialist-boundaries.md`

This gives Ricky a coherent target architecture and keeps the repo pointed toward shared assistant primitives rather than pure product-local sprawl.

## Conceptual alignment without direct runtime reuse

Ricky currently has many seams that *look* like `agent-assistant` runtime primitives, but which are still mostly implemented locally inside Ricky.

### 1. Turn intake / handoff normalization

Ricky has a serious multi-surface handoff normalization layer in:

- `src/local/request-normalizer.ts`

It handles local invocation shapes for CLI, MCP, Claude-style handoffs, and workflow artifacts. This is strongly adjacent to assistant-runtime turn-context or ingress normalization, but it is currently Ricky-owned rather than clearly delegated to a shared `agent-assistant` package.

### 2. Interactive assistant-like orchestration

`src/surfaces/cli/entrypoint/interactive-cli.ts` acts like a narrow assistant orchestrator:

- onboarding
- mode selection
- local vs cloud routing
- recovery guidance
- diagnosis surfacing
- awaiting-input behavior

This is conceptually close to a sessions/surfaces/turn-context orchestration boundary, but it is still product-local.

### 3. Local execution contract

Ricky's local execution path now has a meaningful staged assistant-like contract in:

- `src/local/entrypoint.ts`

That includes:

- generation vs execution stages
- typed `LocalResponse`
- classified blockers
- recovery steps
- execution evidence
- exit code semantics for success, blocker, and error

This is one of Ricky's strongest seams, and it is the most plausible candidate either to remain Ricky-specific or to inform later shared assistant-runtime extraction.

### 4. Diagnosis and unblocker guidance

Ricky's diagnostic engine under `src/runtime/diagnostics/` behaves like a shared runtime primitive:

- typed input
- deterministic classification
- typed unblocker guidance
- injectable dependencies

It is product-useful and assistant-like, but the current implementation lives inside Ricky.

## Assistant-like seams Ricky owns locally today

The following seams are currently owned by Ricky rather than clearly reused from `agent-assistant` runtime packages:

### CLI / interactive product surface

Ricky owns:

- CLI argument parsing
- help and onboarding copy
- mode selection
- staged output formatting
- local artifact vs execution reporting

Primary files:

- `src/surfaces/cli/commands/cli-main.ts`
- `src/surfaces/cli/cli/onboarding.ts`
- `src/surfaces/cli/entrypoint/interactive-cli.ts`

### Handoff normalization and request shaping

Ricky owns:

- raw handoff parsing
- invocation root propagation
- artifact-path normalization
- mode/stage interpretation
- source-specific request shaping

Primary files:

- `src/local/request-normalizer.ts`
- `src/local/entrypoint.ts`

### Execution reporting and blocker classification

Ricky owns:

- generation-stage reporting
- execution-stage reporting
- blocker codes and categories
- recovery steps
- evidence framing
- exit code mapping

Primary files:

- `src/local/entrypoint.ts`
- `src/runtime/diagnostics/*`

### Workflow generation pipeline

Ricky owns:

- spec intake
- pattern selection
- skill selection/loading
- workflow rendering
- validator specialist logic

Primary files:

- `src/product/spec-intake/*`
- `src/product/generation/*`
- `src/product/specialists/*`

### Local/cloud product routing

Ricky owns:

- local vs cloud path selection
- cloud generate endpoint shaping
- BYOH local runtime coordination

Primary files:

- `src/surfaces/cli/entrypoint/interactive-cli.ts`
- `src/cloud/api/*`
- `src/local/entrypoint.ts`

## Divergences from an agent-assistant-native architecture

Current docs sometimes describe a future or intended runtime composition more strongly than the current code proves.

### 1. Docs overstate current package-level reuse

`docs/architecture/ricky-runtime-architecture.md` says Ricky is composed on top of many `@agent-assistant/*` packages and that Ricky should never duplicate what Agent Assistant already provides.

That is a good target, but it is not fully reflected in the current repo/package graph. The root `package.json` currently shows only one direct shared dependency:

- `@agent-relay/sdk`

So the architecture docs should be read as **target architecture / intended composition**, not as a literal audit of already-landed package reuse.

### 2. Specialist boundaries are more planned than runtime-backed

`docs/architecture/ricky-specialist-boundaries.md` describes specialist composition through `@agent-assistant/specialists`, but the current Ricky codebase more clearly proves:

- product-local specialist-like boundaries
- product-local diagnostic and validation seams
- product-local workflow-generation and validation subsystems

It does **not** yet strongly prove broad runtime specialist orchestration reuse from shared `agent-assistant` packages.

### 3. Surfaces and turn-context are described more than implemented

The docs discuss Slack, webhook runtime, turn context, MCP/Claude handoff, and future web surfaces in a way that is strategically coherent. But Ricky's strongest current product proof is still:

- local CLI
- local staged execution
- cloud generation endpoint shape

So Ricky is further ahead as a local-first workflow product than as a broad assistant-runtime product.

## Recommendations

### Keep local for now

These seams are product-defining enough that Ricky should continue owning them until shared reuse is clearly worth the cost:

- workflow generation pipeline
- workflow validator specialist behavior
- staged local workflow authoring and execution UX
- Ricky-specific blocker wording and workflow evidence framing
- Ricky onboarding and product messaging

These are not generic assistant concerns yet. They are tightly coupled to Ricky's workflow-reliability product identity.

### Adopt from agent-assistant now

These areas are the most promising near-term adoption candidates if the shared packages are ready enough:

- turn intake / request shaping primitives, if a shared turn-context or ingress layer can carry Ricky's handoff metadata honestly
- sessions/surfaces primitives for future assistant-native interaction modes beyond the CLI
- harness or execution-adapter seams where Ricky currently owns local orchestration patterns that match existing shared abstractions

The rule should be: adopt only where Ricky can use a real shared runtime seam, not where it would merely rename local code to sound aligned.

### Extract later after proof

These seams feel potentially reusable, but Ricky should prove them locally first before extracting them:

- staged generation/execution response contract
- blocker taxonomy and recovery contract for workflow execution
- workflow evidence framing for local proving-ground runs
- workflow-oriented diagnostic engine patterns

These are strong candidates for shared runtime influence, but they are still closest to Ricky's own product maturity path today.

## Verdict on current integration depth

Ricky is **not yet broadly built on agent-assistant** in an implementation sense, but it does have a narrow direct adoption of `@agent-assistant/turn-context`.

A more accurate description is:

- Ricky is built on the Relay workflow substrate
- Ricky uses real generation-time shared skills and Relay-native workflow conventions
- Ricky has architecture and product intent aligned with agent-assistant
- Ricky directly uses `@agent-assistant/turn-context` for local request/turn envelope provenance
- Ricky still implements many assistant-like runtime seams locally
- Ricky should treat agent-assistant adoption as a deliberate next wave, not a claim about the current state

If someone asked, "How well is Ricky using agent-assistant today?" the honest answer would be:

> Ricky is using some real shared workflow and skill infrastructure, and it is strongly aligned with the agent-assistant direction, but most of its current local-first product behavior still lives in Ricky-local code rather than deeply reused agent-assistant runtime packages.

## Follow-on implications for issues #10 through #13

This audit suggests the right next sequence is:

1. define the intended Ricky vs agent-assistant boundary clearly
2. evaluate whether Ricky's strongest local execution contract should remain product-local or become a shared runtime seam
3. choose one real adoption slice rather than a broad migration
4. prove that adoption on a live Ricky product path

The most promising concrete seam is Ricky's current handoff + staged execution + blocker/evidence contract, because it is mature enough to study and close enough to shared assistant-runtime concerns to test for reuse value.
