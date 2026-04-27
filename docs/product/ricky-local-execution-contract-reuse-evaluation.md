# Ricky Local Execution Contract Reuse Evaluation

## Executive summary

Ricky's local execution contract should remain Ricky-local for now.

The seam is real and mature enough to evaluate: `packages/local/src/request-normalizer.ts` turns CLI, MCP, Claude-style, free-form, structured, and workflow-artifact handoffs into one `LocalInvocationRequest`; `packages/local/src/entrypoint.ts` then returns a staged `LocalResponse` with generation, execution, blockers, recovery guidance, execution evidence, and process-oriented exit codes.

That shape is adjacent to agent-assistant-style shared runtime concerns, especially request/turn intake, execution harnessing, blocker recovery, and evidence reporting. But the reusable core is not concrete enough yet to extract. The current contract still encodes Ricky-specific workflow authoring semantics, artifact paths, local/BYOH defaults, Relay workflow commands, staged generate/run product UX, and workflow-oriented blocker/evidence language.

The recommended boundary decision is therefore:

- keep ownership of the current local execution contract in Ricky
- use this document to guide issue #11 toward one small shared-runtime compatibility slice, not a broad extraction
- require issue #13 to prove any adopted slice on a live Ricky path before claiming the seam is shared

This is deliberately conservative. Ricky should not overclaim that this local contract is already an agent-assistant shared runtime primitive, and it should not extract the contract until a reusable core can be named, typed, tested, and proven outside Ricky's workflow domain.

## What the current Ricky local contract includes

The local contract has four connected parts.

### Request normalization / turn intake behavior

`normalizeRequest()` accepts multiple raw handoff shapes and converges them into `LocalInvocationRequest`.

Current intake sources:

- `free-form`
- `structured`
- `cli`
- `mcp`
- `claude`
- `workflow-artifact`

The normalized request includes:

- `_normalized: true` as a runtime discriminator
- textual `spec`
- optional `structuredSpec`
- originating `source`
- resolved execution `mode`
- optional local `stageMode`
- optional `invocationRoot`
- optional `specPath`
- merged opaque `metadata`
- source-specific `sourceMetadata`
- optional `requestId`

This is more than simple parsing. It is already doing turn-intake work: preserving source context, carrying caller root information, accepting structured and natural-language payloads, mapping `executionPreference: auto` to `both`, interpreting stage aliases such as `behavior`, and resolving workflow artifacts from disk.

It also includes Ricky-specific behavior. A workflow-artifact handoff reads the artifact as the spec and defaults `stageMode` to `run`. Structured specs are converted to text through Ricky's preferred carrier fields such as `description`, `prompt`, `spec`, `goal`, and `objective`. This is useful product behavior, but it is not yet a proven generic assistant turn envelope.

### Staged generation vs execution contract

`runLocal()` and the default local executor split the local path into a generation stage and an execution stage.

The generation stage reports:

- `stage: "generate"`
- `status: "ok" | "error"`
- generated or referenced artifact path
- workflow id
- spec digest
- next run command and run-mode hint when generation succeeds
- generation error when generation fails

The execution stage reports:

- `stage: "execute"`
- `status: "success" | "blocker" | "error"`
- workflow id
- artifact path
- command
- workflow file
- cwd
- start and finish timestamps
- duration
- completed and total step counts
- optional evidence
- optional classified blocker

This contract is product-important because Ricky has a local workflow UX where a user can generate only, run an existing artifact, or generate and run. The code currently normalizes `generate-and-run` to run behavior and defaults direct local behavior toward generation unless explicit run behavior or artifact execution is requested.

This is adjacent to shared runtime concerns because many assistants need a distinction between planning or artifact generation and execution. But Ricky's exact split is workflow-specific: the artifact is a Relay workflow file, the generation result carries workflow identifiers and spec digests, and the next commands are Ricky/Relay commands.

### Blocker classification and recovery structure

The current local contract models blockers as typed, actionable failures instead of plain errors.

Blocker codes:

- `MISSING_ENV_VAR`
- `MISSING_BINARY`
- `INVALID_ARTIFACT`
- `UNSUPPORTED_RUNTIME`
- `CREDENTIALS_REJECTED`
- `WORKDIR_DIRTY`
- `NETWORK_UNREACHABLE`

Blocker categories:

- `environment`
- `credentials`
- `dependency`
- `workflow_invalid`
- `resource`
- `unsupported`

Each `LocalClassifiedBlocker` includes:

- machine-readable code and category
- user-facing message
- timestamp
- phase where it was detected: `precheck`, `launch`, or `step_setup`
- recovery steps with an actionable flag
- missing and found context

The default executor creates blockers from both deterministic prechecks and coordinator launch results. Prechecks catch unreadable workflow artifacts and missing local runtime binaries before launch. Runtime classification then maps command-not-found, missing environment, credentials, dirty workdir, network, and unknown runtime failures into recovery guidance.

This is one of the strongest candidates for future shared influence. Assistants often need typed failure classes, recoverability, and next actions. But Ricky's current blocker vocabulary is tuned to local workflow execution and Relay command launch behavior. It should remain Ricky-owned until the generic blocker model is separated from Ricky's specific classes and recovery commands.

### Execution evidence framing

`LocalExecutionEvidence` frames execution as inspectable proof rather than a boolean result.

Evidence includes:

- outcome summary
- produced artifacts with path, kind, and byte count
- failed step details
- exit code
- stdout/stderr log paths, tail, and truncation flag
- side effects such as files written and commands invoked
- optional network calls
- assertions with pass/fail/skipped status
- optional workflow-step summaries

This framing is central to Ricky's product promise: a local workflow run should return enough evidence for a user or later agent to understand what happened, what files were affected, what command ran, and why a failure was classified as a blocker.

The reusable idea is strong: assistant runtimes need evidence envelopes for local execution. The current shape, however, is still workflow-oriented. It assumes workflow files, one local runtime launch step, generated artifacts, stdout/stderr log capture, command invocation evidence, and exit-code assertions.

## Product-specific parts that should remain Ricky-local

The following parts should stay under Ricky ownership.

### Workflow authoring and Relay artifact semantics

Ricky's contract knows that the main artifact is a workflow file under `workflows/**` or a `.workflow.*` file. It calculates workflow ids from paths or generated artifacts, records spec digests, and returns Relay/Ricky run commands. These details are product behavior, not generic assistant runtime behavior.

### Local/BYOH default and Cloud rejection behavior

The local entrypoint defaults to local execution and explicitly rejects cloud-only requests. That is a Ricky product boundary: this surface is local/BYOH, while hosted execution belongs to the Cloud API surface. A shared runtime should not own that policy decision.

### Spec intake, generation, validation, and proof-loop logic

The local contract calls Ricky's product intake and generation pipeline. It routes natural-language or structured specs into workflow generation or artifact execution, renders workflow artifacts, and surfaces product validation warnings. This is Ricky's core workflow-reliability product logic and should not be extracted as runtime infrastructure.

### Stage wording and user-facing next actions

The exact next actions are Ricky-specific: inspect generated workflow artifacts, run `npx --no-install agent-relay run ...`, use `ricky run --artifact ...`, fix generated workflow validation errors, or optionally promote a locally validated result to Cloud. A shared runtime might provide a generic next-action container, but Ricky should own the command text and product guidance.

### Current blocker vocabulary and recovery commands

The generic pattern of typed blockers is reusable. The current code/category set and recovery commands are local workflow execution semantics. For example, `INVALID_ARTIFACT`, `WORKDIR_DIRTY`, and `MISSING_BINARY` currently mean specific things in the context of a local Relay workflow run from a caller's workspace.

### Evidence labels tied to workflow execution

Fields such as `workflow_file`, `workflow_id`, `workflow_steps`, generated workflow artifact bytes, and `runtime-launch` step names are part of Ricky's evidence contract. A shared runtime could define a broader evidence model, but Ricky's current labels and exact interpretation should stay local.

## Candidate reusable/shared-runtime parts

The reusable candidates are narrower than the full local contract.

### A normalized turn/request envelope

Potential reusable core:

- source identity
- request id
- textual input
- optional structured input
- source metadata
- invocation root or execution context root
- requested execution target
- requested stage/behavior

This is the most plausible candidate for issue #11 because it is close to shared assistant-runtime turn-context concerns. But it should begin as alignment or an adapter, not extraction. The Ricky normalizer still has product-specific defaults and artifact handling that should not be hidden inside a generic package.

### A stage-result envelope

Potential reusable core:

- stage name
- status
- produced artifacts
- next executable action
- error or blocker reference

This could eventually support assistant workflows that separate preparation from execution. The generic core would need to avoid assuming Ricky's `generate` and `execute` names, workflow ids, spec digests, or Relay command strings.

### A blocker and recovery envelope

Potential reusable core:

- blocker code
- category
- message
- detection phase
- recoverability/actionability
- recovery steps
- observed missing/found context

This is reusable in principle, but only if the generic taxonomy is separate from Ricky's current blocker classes. A shared envelope can carry Ricky's classes as domain-specific codes without requiring all assistants to adopt Ricky's workflow failure taxonomy.

### An execution evidence envelope

Potential reusable core:

- outcome summary
- artifacts produced
- failed unit of work
- exit code or terminal status
- log references and tail
- side effects
- assertions

This is a good candidate for shared assistant-runtime influence, especially for local tool execution. It should not be extracted as-is because the current evidence model assumes local workflow execution. A reusable version would need a domain-neutral way to represent units of work, artifacts, assertions, and side effects.

### An execution adapter interface

Potential reusable core:

- normalized request in
- structured execution response out
- injectable runner/coordinator
- no import-time process spawning
- deterministic fake support for tests

Ricky already has a local `LocalExecutor` seam and a structural `CoordinatorLauncher` interface. Those ideas are reusable, but the concrete executor currently calls Ricky intake, Ricky generation, and the Relay local coordinator. The reusable boundary would have to stop before product generation starts or after a domain-specific executor has already produced a generic evidence envelope.

## Comparison against agent-assistant-style shared runtime concerns

This comparison is against shared assistant-runtime goals, not a claim that current packages already provide these capabilities.

| Shared runtime concern | Ricky local contract match | Boundary implication |
|---|---|---|
| Turn context / request shaping | Strong conceptual match. Ricky normalizes multiple handoff sources and preserves source metadata, request ids, structured payloads, and invocation roots. | Candidate for issue #11 alignment. Keep Ricky's artifact and stage defaults local. |
| Surfaces and sessions | Partial match. The normalizer knows source types, but it does not implement full sessions, cross-turn state, or shared surface lifecycle. | Do not describe current local contract as a shared session system. |
| Execution harness / adapter | Partial match. `LocalExecutor`, `CoordinatorLauncher`, route injection, and command-runner injection are clear seams. | Candidate for a small adapter compatibility test, but not enough for full extraction. |
| Staged assistant work | Strong conceptual match. Ricky separates generation from execution and exposes both stages. | Reusable idea, but Ricky's specific stages are workflow product UX. |
| Blocker/recovery model | Strong conceptual match. Ricky returns typed blockers and actionable recovery steps. | Candidate envelope only. Taxonomy and recovery text remain Ricky-local. |
| Evidence and receipts | Strong conceptual match. Ricky captures logs, side effects, artifacts, assertions, and step outcomes. | Candidate envelope only. Workflow-specific labels remain Ricky-local. |
| Policy, memory, proactive behavior | Weak current match. The local contract does not prove memory, policy, or proactive assistant behavior. | Not part of issue #12's extraction boundary. Do not pull these into the local contract migration. |
| Product-specific orchestration | Ricky-specific. Spec intake, workflow generation, validation, artifact writing, and Cloud/local product routing are core Ricky behavior. | Keep local. Shared runtime should not own this unless Ricky's product boundary changes. |

The strongest conclusion is that Ricky has a shared-runtime-shaped seam, not a shared-runtime-owned implementation. That distinction matters for issue #11. The next work should test one compatibility boundary rather than rename Ricky's local code as shared runtime.

## Recommended boundary decision

Do not extract the local execution contract now.

Keep the current contract Ricky-local until the reusable core is concrete. The reusable core is not the full `LocalInvocationRequest`, not the full `LocalResponse`, and not the current blocker taxonomy. The likely reusable core is a smaller set of envelopes:

- assistant turn/request envelope
- generic stage outcome envelope
- generic blocker/recovery envelope
- generic execution evidence envelope

Those envelopes still need proof. Today they are inferred from Ricky's implementation, not proven as shared runtime primitives.

For issue #11, the safest adoption target is request/turn envelope alignment or execution evidence envelope alignment. Both are narrow enough to avoid changing the product contract and concrete enough to reduce ambiguity before issue #13. The work should preserve Ricky's public local response shape while introducing an internal compatibility adapter or mapping proof against a proposed shared-runtime shape.

The boundary should be stated this way:

- Ricky owns product intake, workflow generation, local stage semantics, blocker taxonomy, recovery wording, and user-visible local response behavior.
- A shared assistant-runtime layer may eventually own neutral envelope shapes for turn intake, stage results, blocker/recovery, and execution evidence.
- Ricky should only depend on those shared shapes after a real adapter proves that no product behavior is lost.

## First safe migration step if extraction is recommended

Extraction is not recommended yet. If later work decides extraction is warranted, the first safe migration step should be a compatibility adapter, not a package move.

The adapter should:

- define a minimal neutral request/turn envelope that can represent Ricky's current `LocalInvocationRequest` without dropping source, request id, structured input, invocation root, mode, stage mode, metadata, or source metadata
- map Ricky raw handoffs through the existing `normalizeRequest()` first, then into the neutral envelope
- map the neutral envelope back into Ricky's existing executor input for the current product path
- prove round-trip preservation for CLI, MCP, Claude, structured, free-form, and workflow-artifact handoffs
- leave Ricky's public `LocalResponse` unchanged
- add tests showing generation-only, artifact-run, generate-and-run, blocker, and evidence paths still emit the same Ricky fields

This step would make the seam measurable. It would also prevent accidental extraction of product-specific behavior into a generic layer. If the adapter cannot preserve Ricky's current behavior without special cases dominating the neutral shape, that is evidence against extraction.

## Proof burden before any extraction

Before any extraction, Ricky should require proof in four categories.

### 1. Behavioral preservation proof

The extracted or adopted layer must preserve current local behavior for:

- raw CLI spec handoff
- structured CLI handoff
- MCP handoff with arguments metadata
- Claude-style handoff with conversation and turn ids
- workflow-artifact handoff that defaults to run behavior
- cloud-only request rejection from the local entrypoint
- generation-only response
- generated artifact followed by execution
- existing artifact execution
- normalization failure
- intake/generation failure
- runtime precheck blocker
- coordinator failure classified as a blocker
- successful execution evidence

### 2. Product wording and contract proof

Tests or snapshot checks must show that Ricky still emits its current user-visible contract:

- artifact paths and optional content
- generation stage object
- execution stage object
- blocker code/category/message/recovery/context
- evidence summary, logs, side effects, assertions, and workflow-step details
- warnings and next actions
- exit-code semantics: `0` success, `2` blocker, `1` error

### 3. Reuse proof outside the Ricky-specific path

The proposed shared core must be useful without importing Ricky product generation, Ricky spec intake, or Ricky workflow artifact semantics. At minimum, the shared shape should be demonstrable with a non-Ricky assistant execution fixture that still benefits from the same request, blocker, or evidence envelope.

If the only working consumer is Ricky's workflow execution path, the seam is not yet shared. It is Ricky-local code with a generic-looking shape.

### 4. Simplicity and ownership proof

The migration must reduce ambiguity or duplication. It should not add an abstraction layer that every Ricky change has to work around.

Before extraction, reviewers should be able to answer:

- What exact fields move to shared runtime ownership?
- Which fields remain Ricky-owned extensions?
- Which package owns schema versioning?
- How are Ricky-specific blocker codes represented without forcing them into other assistants?
- How does a shared execution evidence model represent non-workflow work?
- What tests prove the local CLI and local/BYOH path did not regress?
- What will issue #13 prove end to end?

Until those answers are concrete, the correct boundary is Ricky-local ownership with a small compatibility experiment for issue #11.
