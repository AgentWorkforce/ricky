# Ricky Runtime Architecture

Status: mixed current and target architecture. Current direct Agent Assistant reuse is `@agent-assistant/turn-context`; broader surfaces/specialists/proactive/VFS/harness entries are target architecture unless explicitly noted as implemented.

## Purpose

This document describes how Ricky is composed at runtime, what execution model it uses, and how its internal layers relate to the Agent Assistant substrate. Wave 1 and Wave 2 implementers should read this before writing runtime, evidence, or product-layer code.

---

## 1. Composition model

Ricky is a product composed on top of Agent Assistant. It is not a standalone runtime stack.

### Current dependency status

| Package | Status | Role in Ricky |
|---|---|---|
| `@agent-assistant/turn-context` | Current | Bounded request/turn envelope primitive in the local path |
| `@agentworkforce/harness-kit` | Current | BYOH execution coordination and harness integration |
| `@agentworkforce/workload-router` | Current | Workload routing and dispatch |
| `@agent-relay/sdk` | Current | Workflow builder, runner, and evidence APIs |
| `@agent-relay/cloud` | Current | Cloud-mode workflow execution and coordination |

### Planned Agent Assistant packages

| Package | Role in Ricky |
|---|---|
| `@agent-assistant/surfaces` | Planned for Slack ingress and webhook handling |
| `@agent-assistant/webhook-runtime` | Planned for Slack signature verification, dedup, and thread handling |
| `@agent-assistant/specialists` | Planned specialist orchestration and routing substrate |
| `@agent-assistant/proactive` | Planned proactive failure notifications and follow-up |
| `@agent-assistant/vfs` | Planned artifact persistence and evidence storage seam |
| `@agent-assistant/harness` | Planned BYOH execution coordination seam (may overlap with `@agentworkforce/harness-kit`) |
| `@agent-assistant/sdk` | Planned shared assistant SDK primitives |

### What Ricky owns

Ricky owns the domain logic above these packages:

- **Workflow generation** - spec intake, pattern selection, skill loading, artifact production
- **Workflow debugging** - evidence reading, failure classification, fix recommendation
- **Workflow validation** - 80->100 proof loops, structural sanity checks
- **Workflow coordination** - local and cloud execution routing, run lifecycle management
- **Workflow analytics** - run history analysis, improvement digests
- **CLI product surface** - onboarding, mode selection, provider guidance
- **Cloud API surface** - hosted generation and coordination endpoints

Ricky should never duplicate what Agent Assistant already provides. If a capability exists as an Agent Assistant package, Ricky composes it rather than reimplementing it.

### Agent Assistant version tracking

Ricky tracks upstream Agent Assistant changes through npm package versions. Pin the major version of each adopted `@agent-assistant/*` dependency; float minor and patch versions. When Agent Assistant ships a breaking major change, Ricky updates in a dedicated branch with its own validation pass — never auto-float majors.

---

## 1a. Relay SDK integration seam

Ricky is workflow-native at the builder/runner/evidence level, not a prompt wrapper around `agent-relay run`. This section defines which Relay SDK surfaces Ricky wraps, which it delegates to, and how the integration is structured.

### Relay SDK surfaces Ricky interacts with

| Relay SDK surface | Ricky interaction | Integration point |
|---|---|---|
| `WorkflowBuilder` (`@agent-relay/sdk/workflows/builder`) | Ricky's Workflow Author specialist programmatically constructs workflows using the builder API — setting agents, steps, verification, patterns, retries, and cloud options | `src/product/generation/pipeline.ts` |
| `WorkflowRunner` (`@agent-relay/sdk/workflows/runner`) | Ricky's Local Coordinator delegates execution to the runner. Ricky does not re-implement parsing, validation, template resolution, retries, pause/resume/abort, budget enforcement, or evidence capture — these are the runner's job | `src/runtime/local-coordinator.ts` |
| `WorkflowRunEvidence` (runner output) | The runner produces structured run evidence. Ricky's evidence layer captures and normalizes this into `WorkflowRunEvidence` from `src/shared/models/` | `src/runtime/evidence/capture.ts` |
| Verification primitives | Ricky's Validator specialist uses the runner's verification infrastructure for dry-run, step-level gate evaluation, and proof loops | `src/product/specialists/validator/` |
| Swarm pattern selection | Ricky wraps pattern choice with product-level heuristics (spec analysis, domain matching) before passing the selected pattern to the builder | `src/product/generation/pattern-selector.ts` |

### What Ricky wraps vs. delegates

**Ricky wraps (adds product value on top):**
- Pattern selection — the builder accepts any pattern; Ricky adds deliberate selection logic based on spec analysis
- Skill loading — the builder does not know about skills; Ricky loads and applies workflow-authoring skills before or during generation
- Evidence normalization — the runner produces raw evidence; Ricky normalizes it into the canonical `WorkflowRunEvidence` shape
- Failure classification — the runner surfaces errors; Ricky's diagnostic engine classifies them into blocker categories
- Restart safety — the runner can resume/abort; Ricky adds safety evaluation before deciding whether to resume

**Ricky delegates (does not re-implement):**
- Workflow parsing, template resolution, and YAML/TS interpretation
- Step execution, process spawning, and timeout enforcement
- Retry logic and backoff within a run
- Pause, resume, and abort semantics
- Budget tracking and enforcement
- Raw evidence capture at the step level

### Integration rule for implementers

Target rule: Ricky code should import Relay SDK types and invoke Relay SDK APIs through a thin adapter layer once that layer exists. There is no current `src/runtime/relay-adapter/` directory, so direct SDK usage remains part of the current implementation until an adapter migration lands.

---

## 1b. Skill loading model

Ricky's workflow quality advantage comes partly from loading and applying the right workflow-writing skills automatically. This section describes how skills are discovered, loaded, and applied during generation and repair.

### What skills are

Skills are structured knowledge packages that encode best practices for workflow authoring. The three primary skills Ricky uses:

| Skill | Purpose | When applied |
|---|---|---|
| `writing-agent-relay-workflows` | Step sizing, deterministic verification, test-fix-rerun loops, dry-run validation | Every generation and repair pass |
| `choosing-swarm-patterns` | Pattern selection heuristics, tradeoff analysis between supervisor/dag/pipeline/fan-out/etc. | During pattern selection in the generation pipeline |
| `relay-80-100-workflow` | End-to-end correctness proof, PGlite for in-memory Postgres testing, mock sandbox patterns, verify gates | During validation specialist proof loops |

### Skill discovery

Skills are discovered at generation time by the skill-loader module (`src/product/generation/skill-loader.ts` when implemented). Discovery is static: the skill-loader has a hardcoded registry of known skill names and their file system paths. There is no dynamic plugin system in v1.

```typescript
// Expected shape of the skill registry
const SKILL_REGISTRY = {
  'writing-agent-relay-workflows': {
    path: 'skills/skills/writing-agent-relay-workflows/SKILL.md',
    appliesTo: ['generation', 'repair'],
  },
  'choosing-swarm-patterns': {
    path: 'skills/skills/choosing-swarm-patterns/SKILL.md',
    appliesTo: ['pattern-selection'],
  },
  'relay-80-100-workflow': {
    path: 'skills/skills/relay-80-100-workflow/SKILL.md',
    appliesTo: ['validation'],
  },
} as const;
```

### Skill loading sequence

```
generation or repair request arrives
  -> skill-loader resolves applicable skills based on the task type
  -> skill content is read from disk (or from a cached read)
  -> skill rules are injected into the generation/repair prompt context
  -> the specialist (author, debugger, or validator) operates with skill awareness
```

### Skill application rules

1. Skills are read-only inputs, not executable code. They inform the specialist's behavior through prompt context, not through programmatic API calls.
2. The skill-loader is the only module that reads skill files. Specialists receive skill content through their dependency injection, not by reading the file system directly.
3. If a skill file is not found at the expected path, the skill-loader logs a warning and proceeds without that skill. Missing skills degrade quality but do not block execution.
4. Skill content is cached per invocation (same process, same skill file = one read). There is no cross-invocation cache in v1.
5. When Ricky runs in Cloud mode, skills must be bundled with the deployment artifact or fetched from a known location. The skill-loader abstracts this behind a `SkillSource` interface that has `local` and `remote` implementations.

---

## 2. Execution model

Ricky uses a **request-response, per-invocation** execution model. There is no persistent event loop, no background worker queue, and no long-lived server process in the core CLI path.

### Entry flow

```
CLI argv
  -> src/surfaces/cli/commands/cli-main.ts        (parse --help, --version, --mode)
  -> src/surfaces/cli/entrypoint/interactive-cli.ts  (three-phase orchestrator)
```

### Three-phase execution

**Phase 1 - Onboarding:**
- Display ASCII banner and welcome message
- Detect first-run vs returning user
- Mode selection: local, cloud, status, connect, or exit

**Phase 2 - Mode-routed execution:**
- `cloud` mode -> `executeCloudPath()` via CloudExecutor
- `local` mode -> `executeLocalPath()` via LocalExecutor

**Phase 3 - Diagnosis and recovery:**
- On local failure, the diagnostic engine classifies the blocker
- Surfaces typed unblocker guidance with action, rationale, and automatable flag
- Returns unified `InteractiveCliResult`

### Process lifecycle

Each CLI invocation is a complete lifecycle: parse -> onboard -> execute -> return -> exit. There is no session persistence between invocations. For batch or overnight workflows, shell scripts (`scripts/run-ricky-batch.sh`, `scripts/run-ricky-overnight.sh`) orchestrate multiple invocations.

---

## 3. Injectable executor seam

Both the local and cloud execution paths use injectable executor interfaces. This is Ricky's primary seam for testing, stubbing, and production wiring.

### LocalExecutor

Defined in `src/local/entrypoint.ts`:

```typescript
interface LocalExecutor {
  execute(request: LocalInvocationRequest): Promise<LocalResponse>;
}
```

- Default stub executor returns a structured placeholder response
- Production wiring connects to the real agent-relay runtime
- Handles workflow generation and local BYOH execution coordination

### CloudExecutor

Defined in `src/cloud/api/generate-endpoint.ts`:

```typescript
interface CloudExecutor {
  generate(request: CloudGenerateRequest): Promise<CloudGenerateResult>;
}
```

- Default stub executor returns a structured placeholder response
- Production wiring connects to the Cloud runtime
- Handles hosted workflow generation and artifact return

### Dependency injection rule

All side-effecting dependencies in the interactive CLI orchestrator are injectable: onboarding, local executor, cloud executor, and diagnostic engine. This ensures deterministic testing without mocks or environment coupling.

---

## 4. Shared models layer

`src/shared/models/` is the canonical type substrate that all runtime, product, and specialist code imports from.

### WorkflowConfig (`workflow-config.ts`)

Defines the shape of a Ricky workflow definition:

- `workflowId`, `workflowName` - identity
- `mode` - local, cloud, or both
- `pattern` - supervisor, dag, or pipeline
- `team` - array of TeamMember with role, model, description
- Timeout, retry, and validation policy settings
- `onError` strategy - fail, continue, or retry

### WorkflowEvidence (`workflow-evidence.ts`)

Defines the shape of workflow execution evidence:

**WorkflowStepEvidence:**
- Status: pending, running, passed, failed, skipped, timed_out
- Agent role executing the step
- Verification results, logs, artifacts
- Retry history per step
- Duration metrics

**WorkflowRunEvidence:**
- Run identity: runId, workflowId
- Aggregate status
- Step array with full per-step evidence
- Final signoff path
- Duration metrics

### Shared constants (`constants.ts`)

Product-wide constants including API routes, default timeouts, and configuration keys.

Cloud execution produces evidence in whatever format the Cloud runtime uses, but the Cloud executor must normalize it back into `WorkflowRunEvidence` before returning it to the orchestrator. There is no separate cloud-specific evidence model at the product layer — `WorkflowEvidence` is the single canonical evidence shape across both local and cloud paths.

### Rule for implementers

New types that are used across more than one layer (runtime, product, cloud, CLI) must be defined in `src/shared/models/` and re-exported through `src/shared/models/index.ts`. Layer-local types stay in their own directory.

---

## 5. Diagnostic engine

`src/runtime/diagnostics/` implements Ricky's failure classification and unblocker system.

### Eight blocker classes

| Class | Code | Meaning |
|---|---|---|
| Runtime handoff stall | `agent_runtime.handoff_stalled` | Agent assigned but not producing output |
| Opaque progress | `agent_runtime.progress_opaque` | Worker alive but no artifact-visible progress |
| Stale relay state | `environment.relay_state_contaminated` | Local relay state contaminates reruns |
| Missing config | `environment.missing_config` | Required setup/config is absent |
| Already running | `environment.already_running` | Existing run state makes another launch unsafe |
| Control flow breakage | `workflow_structure.control_flow_invalid` | Dependency graph is wrong |
| Unsupported validation command | `validation_strategy.unsupported_command` | Requested validation command is unavailable or unsupported |
| Repo validation mismatch | `validation_strategy.repo_mismatch` | Validation command is not meaningful |

### Classification flow

```
raw failure evidence
  -> rule-based regex matching on message + source metadata
  -> blocker class assignment
  -> typed UnblockerGuidance { action, rationale, automatable }
```

### Diagnostic engine as reference pattern

The diagnostic engine is the first specialist-like boundary in Ricky. Its structure (typed input -> deterministic classification -> typed output with injectable dependencies) is the reference pattern for future specialists.

See `docs/architecture/ricky-failure-taxonomy-and-unblockers.md` for the full taxonomy with observed examples and unblocker strategies.

---

## 6. Evidence flow

Evidence is the structured record of what happened during a workflow run. Ricky treats evidence as a first-class data flow, not an afterthought appended to logs.

### Evidence capture path

```
workflow step executes
  -> step outcome (pass/fail/timeout/skip)
  -> verification results captured
  -> logs and artifacts recorded
  -> retry history appended if applicable
  -> duration metrics stamped
  -> WorkflowStepEvidence assembled
```

After all steps complete (or the run terminates early):

```
per-step evidence array
  -> aggregate run status computed
  -> final signoff path recorded (if present)
  -> WorkflowRunEvidence assembled
  -> returned to orchestrator for surface delivery or further specialist processing
```

### Evidence consumers

| Consumer | What it reads | Why |
|---|---|---|
| Diagnostic engine | Step-level failure messages and metadata | Classify blockers |
| Debugger specialist | Full run evidence | Recommend fixes |
| Validator specialist | Verification results and gate outcomes | Enforce 80->100 proof |
| Analytics specialist | Aggregated run evidence over time | Detect patterns and regressions |
| Restart specialist | Run evidence + environment state | Evaluate rerun safety |
| Surface layer | Run evidence summary | Present outcomes to the user |

### Evidence normalization rule

Local execution produces evidence directly as `WorkflowRunEvidence`. Cloud execution produces evidence in whatever format the Cloud runtime uses, but the Cloud executor normalizes it back into `WorkflowRunEvidence` before returning it to the orchestrator. There is one canonical evidence shape for all paths.

---

## 6a. Evidence normalization contract

Cloud execution environments may produce evidence in formats that differ from Ricky's canonical `WorkflowRunEvidence` shape. This section defines the translation surface and contract for normalizing Cloud-format evidence.

### The problem

The Cloud runtime (Cloudflare worker, Cloud specialist-worker, or future Cloud execution backends) captures run state in its own format — potentially using RelayFile-backed evidence, JSON log streams, or Cloud-specific run metadata schemas. Ricky's product layer must not know about these formats. Every consumer (diagnostic engine, debugger, validator, analytics, surface adapters) reads `WorkflowRunEvidence` exclusively.

### Translation surface

Planned target: `CloudEvidenceNormalizer` is a function owned by the Cloud executor adapter. The current Cloud generate endpoint returns artifact-bundle response fields and does not yet expose a separate implemented `CloudEvidenceNormalizer`.

```typescript
interface CloudEvidenceNormalizer {
  normalize(raw: CloudRawEvidence): WorkflowRunEvidence;
}

// CloudRawEvidence is an opaque type — its shape depends on the
// Cloud runtime version. The normalizer is the only module that
// knows the internal structure.
type CloudRawEvidence = Record<string, unknown>;
```

### Field mapping contract

| `WorkflowRunEvidence` field | Source in Cloud evidence | Mapping rule |
|---|---|---|
| `runId` | Cloud run identifier | Direct mapping; must be globally unique |
| `workflowId` | Cloud workflow identifier | Direct mapping |
| `status` | Cloud run status | Map to `RunStatus` enum; unknown statuses map to `'failed'` with a warning |
| `steps[]` | Cloud step records | Each step maps to `WorkflowStepEvidence`; missing fields default to empty arrays or `undefined` |
| `startedAt` / `completedAt` | Cloud timestamps | ISO 8601 strings; timezone normalized to UTC |
| `durationMs` | Computed | `completedAt - startedAt` if both present; `undefined` otherwise |
| `deterministicGates[]` | Cloud gate results | Map to `DeterministicGateResult[]`; gate names preserved |
| `artifacts[]` | Cloud artifact references | Map to `WorkflowArtifactReference[]`; paths may be Cloud URLs rather than local paths |
| `logs[]` | Cloud log references | Map to `WorkflowLogReference[]`; `stream` defaults to `'relay'` if not specified |
| `finalSignoffPath` | Cloud signoff artifact | URL or path to signoff artifact; `undefined` if not present |

### Rules

1. The normalizer runs inside the Cloud executor, before evidence is returned to the orchestrator. No downstream consumer ever sees `CloudRawEvidence`.
2. Unknown or missing fields in Cloud evidence must not cause the normalizer to throw. Use defensive defaults: empty arrays for collection fields, `undefined` for optional scalars.
3. If the Cloud evidence contains fields that have no mapping to `WorkflowRunEvidence`, they are discarded. The normalizer does not preserve Cloud-specific metadata.
4. The normalizer logs a structured warning for every field that required a lossy default. This supports debugging evidence quality issues without blocking execution.
5. Evidence normalization is synchronous. It is a pure data transformation with no I/O.

---

## 7. Validation loops

Ricky uses a structured validation loop pattern inherited from the 80->100 workflow proof standard. This pattern applies to workflow generation, debugging, and any specialist that produces artifacts.

### Standard three-step loop

```
Step 1: Soft validation (failOnError: false)
  -> run typecheck, test, dry-run, or structural check
  -> capture output including failures

Step 2: Fix pass
  -> read captured failures
  -> apply bounded fixes
  -> re-stage artifacts

Step 3: Hard validation (failOnError: true)
  -> re-run the same validation commands
  -> fail the workflow if validation does not pass
```

### Where validation loops appear

- **Workflow generation:** after producing a workflow artifact, the author specialist validates it with dry-run and structural checks before returning it
- **Debugging:** after applying a fix, the debugger specialist re-validates to confirm the original failure is resolved
- **Meta-workflows:** after generating multiple workflow artifacts, each is validated individually
- **CI-equivalent gates:** typecheck (`npx tsc --noEmit`), test (`npx vitest run`), and structural grep checks

### Validation loop rules

1. A validation loop must capture output from the soft run, not just exit codes
2. Fixes must be scoped to the captured failures, not wholesale rewrites
3. The hard gate must run the same commands as the soft run
4. If the hard gate fails, the workflow must report the failure honestly rather than silently downgrading the bar
5. Validation commands must be truthful — if the repo does not support a command, use a targeted alternative (see failure taxonomy: `validation_strategy.repo_mismatch`)

---

## 8. Cloud deployment relationship

Ricky is a product deployed through `AgentWorkforce/cloud`, but it is not defined by Cloud. The `ricky` repo is the source of truth for product logic; Cloud provides the hosting infrastructure.

### Deployment shape

Ricky's Cloud deployment follows the same pattern as Sage:
- Stage-aware Cloudflare worker deployment managed by `cloud/infra/`
- Ricky-specific worker/service for API endpoints
- Workspace-scoped auth and secrets
- Cloud specialist-worker integration where specialist orchestration benefits from hosted infrastructure

### What Cloud hosts

| Capability | Cloud role |
|---|---|
| Generation API endpoint | Receives authenticated requests, invokes Ricky generation pipeline, returns artifacts |
| Execution coordination | Launches workflow runs in Cloud runtime, tracks outcomes |
| Proactive analytics jobs | Scheduled cataloging of workflow health, failure rates, and improvement opportunities |
| Provider auth | Google and GitHub connection flows via existing Cloud/Nango infrastructure |
| Artifact storage | Optionally stores generated artifacts for download |

### What Cloud does not own

- Ricky product logic (owned by `ricky` repo)
- Workflow generation pipeline (owned by Ricky domain core)
- Failure classification and specialist behavior (owned by Ricky runtime and specialists)
- Local/BYOH execution (runs entirely on the user's machine)

### Deployment boundary rule

Cloud-specific deployment glue (worker entry points, infrastructure config, stage routing) lives in `cloud`. Reusable assistant abstractions live in Agent Assistant packages. Product-specific domain logic lives in `ricky`. When in doubt, prefer placing logic in `ricky` unless it is genuinely deployment infrastructure.

---

## 9. Batch and overnight execution

Non-interactive execution paths delegate to shell scripts:

- `npm run batch` -> `scripts/run-ricky-batch.sh`
- `npm run overnight` -> `scripts/run-ricky-overnight.sh`

These scripts orchestrate multiple CLI invocations, manage workflow queues, and capture per-run artifacts. They are operational wrappers, not part of the core runtime architecture.

The overnight wrapper is intentionally restart-safe rather than monolithic. It checkpoints queue position under `.workflow-artifacts/overnight-state/<queue-mode>/checkpoint.env`, skips missing workflow files instead of burning the whole run, and defaults to small bounded chunks per invocation so an external SIGKILL or host sleep loses at most the current workflow rather than the entire overnight plan.

---

## 9a. Error propagation model

Ricky distinguishes three error categories. Every error in the system is one of these.

### Planned error hierarchy

The named classes below are target architecture. The current implementation primarily returns structured blocker/error response objects rather than these concrete error classes.

| Error type | Class | Carries | When |
|---|---|---|---|
| Domain error | `RickyDomainError` | blocker class (`BlockerCode`), cause chain | A workflow-level failure that the diagnostic engine can classify |
| Infrastructure error | `RickyInfraError` | `retriable: boolean`, cause chain | Network, file I/O, permission, or process-spawn failures |
| User-facing error | `RickyUserError` | user-visible message, cause chain | Input validation failures, auth failures, or surface-level problems |

### Propagation paths

```
executor / specialist
  -> throws RickyDomainError | RickyInfraError
     -> orchestrator catches
        -> if domain error: attach blocker class, route to diagnostic engine
        -> if infra error and retriable: retry once, then escalate
        -> if infra error and not retriable: escalate immediately
     -> surface adapter translates to surface-appropriate error shape
        -> CLI: stderr + non-zero exit code
        -> Slack: thread reply with error summary
        -> Cloud API: JSON { ok: false, error: { code, message } }
```

### Rules

1. All errors carry a structured `cause` chain for debugging. Never discard the original error.
2. Domain errors always carry a `BlockerCode` so the diagnostic engine can route them.
3. Infrastructure errors carry a `retriable` flag. The orchestrator decides whether to retry; specialists and executors never retry on their own.
4. User-facing errors carry a human-readable message safe to display. Domain and infra errors are translated into user-facing messages by the surface adapter, never shown raw.
5. No error type uses string-matching for control flow. Error routing is based on `instanceof` or discriminated union tags.

---

## 9b. Configuration loading sequence

Configuration is loaded once at the entry point and threaded through as a parameter. There is no mid-execution config reload.

### Loading order (highest priority wins)

```
1. CLI argv flags (--mode, --spec, etc.)
2. Project-level config:   .ricky/config.json
3. Global config:          ~/.config/ricky/config.json
4. Built-in defaults:      src/shared/constants.ts
```

### Rules

1. `--mode` from CLI argv always overrides mode from config files.
2. Project config overrides global config on a per-key basis (shallow merge, not deep merge).
3. Config is loaded by the entry point (`src/surfaces/cli/commands/cli-main.ts`) and passed as a typed `RickyConfig` parameter to the orchestrator. No module reads config files directly.
4. Config loading happens before onboarding. The onboarding flow reads the loaded config to decide first-run vs returning user behavior.
5. Config files are plain JSON with no environment-variable interpolation. Secrets belong in environment variables read at the entry point, not in config files.

---

## 9c. Concurrency model

Ricky's per-invocation execution is single-threaded by default. Internal parallelism is opt-in and must be explicit.

### Default: sequential

Most orchestration flows (onboarding -> mode selection -> execution -> diagnosis) run sequentially. This is deliberate: each phase depends on the previous phase's output.

### Opt-in parallelism

When independent operations can safely run in parallel, use explicit `Promise.all`:

```typescript
// Correct: independent validation gates run in parallel
const [typecheck, lint, structuralCheck] = await Promise.all([
  runTypecheck(config),
  runLint(config),
  runStructuralCheck(workflow),
]);
```

### Rules

1. No shared mutable state between parallel operations. Each parallel branch receives its own copy of any mutable data.
2. Parallelism must be visible in the function signature or call site. No background workers, no implicit concurrency.
3. Error handling in parallel branches uses `Promise.allSettled` when partial results are useful, `Promise.all` when any failure should abort.
4. Wave 1 runtime implementers should default to sequential unless profiling shows a clear benefit from parallelism. Premature parallelism adds debugging complexity without measurable gain at current scale.

---

## 10. Key architectural rules for implementers

### No ambient dependencies

Every function that performs I/O or side effects must accept its dependencies as parameters. No module-level singletons, no implicit global state, no environment variable reads buried in implementation code. Configuration is loaded explicitly at the entry point and passed down.

### Strict TypeScript

- Target: ES2022
- Module resolution: NodeNext
- Strict mode enabled
- All public interfaces must have explicit type annotations

### Testing

- Framework: Vitest with global test setup in `test/setup.ts`
- All executor and diagnostic interfaces are testable with stub implementations
- Proof modules (`*/proof/*.ts`) serve as integration-level smoke tests

### Deterministic over interactive

For structural tasks (file enumeration, plan synthesis, bounded file writes), prefer deterministic scripts or templates over live agent delegation. This is a learned lesson from runtime experience documented in `docs/architecture/ricky-runtime-notes.md`.

### Logging and observability

- Use structured JSON logs written to stderr. Never use `console.log` in production code.
- Three log levels: `info`, `warn`, `error`. Use `info` for operational milestones (phase transitions, specialist invocations). Use `warn` for recoverable issues (retry triggered, fallback path taken). Use `error` for unrecoverable failures.
- Every log entry must include a `component` field for filtering (e.g., `component: "orchestrator"`, `component: "diagnostic-engine"`, `component: "local-executor"`).
- Runtime telemetry (invocation duration, specialist routing decisions, blocker class distribution) is captured as structured log entries that the analytics specialist can consume. There is no separate telemetry pipeline in v1.

### Layer boundaries

```
src/surfaces/cli/commands/    CLI argument parsing only
src/surfaces/cli/entrypoint/  Orchestration only, no domain logic
src/surfaces/cli/cli/         CLI product surface (onboarding, welcome, mode selection)
src/local/          Local/BYOH execution coordination
src/cloud/api/      Cloud API surface
src/runtime/        Runtime substrate (diagnostics, evidence, coordination)
src/shared/         Cross-layer types, models, constants
src/product/        (future) Domain specialists and generation pipeline
src/product/analytics/        Workflow health analytics
```

No layer should import from a layer above it. Shared models are the only cross-cutting import path.

---

## 10a. Version and compatibility targets

### Runtime targets

| Dependency | Target version | Rationale |
|---|---|---|
| Node.js | >=20.x LTS | Required for stable ES2022 support, native fetch, and `node:test` if needed alongside Vitest |
| TypeScript | >=5.4 | Required for `NoInfer`, satisfies constraints, and stable NodeNext module resolution |
| Vitest | >=3.x | Test framework used throughout; aligns with the `vitest.config.ts` already in the repo |

### Relay SDK compatibility

| Package | Target | Compatibility rule |
|---|---|---|
| `@agent-relay/sdk` | Latest stable at time of Wave 1 implementation | Pin the exact version in `package.json`. Relay SDK changes are validated in a dedicated branch before updating the pin. |
| Relay CLI (`agent-relay`) | Compatible with the pinned SDK version | Local/BYOH mode requires that the user's installed `agent-relay` CLI is compatible with the SDK version Ricky uses. The CLI onboarding surface should detect and warn on version mismatches. |

### Agent Assistant compatibility

All `@agent-assistant/*` packages follow the version tracking rule in §1: pin major, float minor and patch. The current target is the latest stable release series available when Wave 1 begins.

### Rules

1. Node.js version is enforced via the `engines` field in `package.json`. Do not use Node.js APIs introduced after the target version without checking.
2. TypeScript version is pinned in `devDependencies`. The `tsconfig.json` target (`ES2022`) and module resolution (`NodeNext`) must remain compatible with the pinned version.
3. When a Wave begins, the implementer verifies that all version targets are still current. If a new LTS or stable release has shipped, the implementer may update the target with a validation pass — but never mid-wave.
4. Version mismatches between Ricky's Relay SDK pin and the user's local `agent-relay` CLI installation are classified as `environment.relay_state_contaminated` by the diagnostic engine and surfaced with appropriate unblocker guidance.
