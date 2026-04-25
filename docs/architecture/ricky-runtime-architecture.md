# Ricky Runtime Architecture

## Purpose

This document describes how Ricky is composed at runtime, what execution model it uses, and how its internal layers relate to the Agent Assistant substrate. Wave 1 and Wave 2 implementers should read this before writing runtime, evidence, or product-layer code.

---

## 1. Composition model

Ricky is a product composed on top of Agent Assistant. It is not a standalone runtime stack.

### Agent Assistant packages Ricky depends on

| Package | Role in Ricky |
|---|---|
| `@agent-assistant/surfaces` | Slack ingress, webhook handling |
| `@agent-assistant/webhook-runtime` | Slack signature verification, dedup, thread handling |
| `@agent-assistant/turn-context` | Turn shaping and conversation context |
| `@agent-assistant/specialists` | Specialist orchestration and routing |
| `@agent-assistant/proactive` | Proactive failure notifications and follow-up |
| `@agent-assistant/vfs` | Artifact persistence and evidence storage |
| `@agent-assistant/harness` | BYOH execution coordination |
| `@agent-assistant/sdk` | Shared assistant SDK primitives |

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

---

## 2. Execution model

Ricky uses a **request-response, per-invocation** execution model. There is no persistent event loop, no background worker queue, and no long-lived server process in the core CLI path.

### Entry flow

```
CLI argv
  -> src/commands/cli-main.ts        (parse --help, --version, --mode)
  -> src/entrypoint/interactive-cli.ts  (three-phase orchestrator)
```

### Three-phase execution

**Phase 1 - Onboarding:**
- Display ASCII banner and welcome message
- Detect first-run vs returning user
- Mode selection: local, cloud, both, or explore

**Phase 2 - Mode-routed execution:**
- `cloud` mode -> `executeCloudPath()` via CloudExecutor
- `local` or `both` mode -> `executeLocalPath()` via LocalExecutor

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

### Rule for implementers

New types that are used across more than one layer (runtime, product, cloud, CLI) must be defined in `src/shared/models/` and re-exported through `src/shared/models/index.ts`. Layer-local types stay in their own directory.

---

## 5. Diagnostic engine

`src/runtime/diagnostics/` implements Ricky's failure classification and unblocker system.

### Five blocker classes

| Class | Code | Meaning |
|---|---|---|
| Runtime handoff stall | `agent_runtime.handoff_stalled` | Agent assigned but not producing output |
| Opaque progress | `agent_runtime.progress_opaque` | Worker alive but no artifact-visible progress |
| Stale relay state | `environment.relay_state_contaminated` | Local relay state contaminates reruns |
| Control flow breakage | `workflow_structure.control_flow_invalid` | Dependency graph is wrong |
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

## 6. Batch and overnight execution

Non-interactive execution paths delegate to shell scripts:

- `npm run batch` -> `scripts/run-ricky-batch.sh`
- `npm run overnight` -> `scripts/run-ricky-overnight.sh`

These scripts orchestrate multiple CLI invocations, manage workflow queues, and capture per-run artifacts. They are operational wrappers, not part of the core runtime architecture.

---

## 7. Key architectural rules for implementers

### No ambient dependencies

Every function that performs I/O or side effects must accept its dependencies as parameters. No module-level singletons, no implicit global state, no environment variable reads buried in implementation code. Configuration is loaded explicitly at the entry point and passed down.

### Strict TypeScript

- Target: ES2022
- Module resolution: NodeNext
- Strict mode enabled
- All public interfaces must have explicit type annotations

### Testing

- Framework: Vitest with global test setup in `src/test/setup.ts`
- All executor and diagnostic interfaces are testable with stub implementations
- Proof modules (`*/proof/*.ts`) serve as integration-level smoke tests

### Deterministic over interactive

For structural tasks (file enumeration, plan synthesis, bounded file writes), prefer deterministic scripts or templates over live agent delegation. This is a learned lesson from runtime experience documented in `docs/architecture/ricky-runtime-notes.md`.

### Layer boundaries

```
src/commands/       CLI argument parsing only
src/entrypoint/     Orchestration only, no domain logic
src/cli/            CLI product surface (onboarding, welcome, mode selection)
src/local/          Local/BYOH execution coordination
src/cloud/api/      Cloud API surface
src/runtime/        Runtime substrate (diagnostics, evidence, coordination)
src/shared/         Cross-layer types, models, constants
src/product/        (future) Domain specialists and generation pipeline
src/analytics/      (future) Workflow health analytics
```

No layer should import from a layer above it. Shared models are the only cross-cutting import path.
