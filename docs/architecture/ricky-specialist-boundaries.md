# Ricky Specialist Boundaries

## Purpose

This document defines the specialist domains in Ricky, their ownership boundaries, and how they communicate. Wave 2 implementers should read this before writing specialist code to avoid overlapping responsibilities or unintended coupling.

---

## 1. Composition via Agent Assistant

Ricky specialists are orchestrated through `@agent-assistant/specialists`, not through ad-hoc routing or direct inter-specialist calls.

### How it works

- Each specialist implements a bounded domain interface
- The product orchestration layer decides which specialist handles a request
- Specialists communicate through shared models (`src/shared/models/`), not by importing each other
- Specialist registration and routing use the Agent Assistant specialist infrastructure

### Why this matters

Without clear specialist boundaries, Ricky drifts into a monolithic agent where every request touches every module. The specialist model keeps domains separable, testable, and independently deployable to Cloud specialist-worker infrastructure when needed.

### 1a. Specialist lifecycle and registration

Specialists are stateless, per-request handlers. There is no singleton state, no warm cache between requests, and no persistent specialist instances.

**Discovery:** The orchestration layer discovers available specialists through a registration manifest at `src/product/specialists/manifest.ts`. This manifest exports a list of specialist descriptors — each declaring its name, domain, and factory function.

**Instantiation:** Each specialist exports a factory function that accepts injectable dependencies and returns the specialist interface. The orchestration layer creates a fresh specialist instance per request.

```typescript
// Example specialist factory
export function createWorkflowDebugger(deps: {
  diagnosticEngine: DiagnosticEngine;
  evidenceReader: EvidenceReader;
}): WorkflowDebugger {
  return {
    diagnose: (evidence) => /* ... */,
    recommendFix: (diagnosis) => /* ... */,
    applyFix: (recommendation) => /* ... */,
  };
}
```

**Registration manifest shape:**

```typescript
// src/product/specialists/manifest.ts
export const specialists = [
  { name: 'workflow-author',    domain: 'generation',  factory: createWorkflowAuthor },
  { name: 'workflow-debugger',  domain: 'debugging',   factory: createWorkflowDebugger },
  { name: 'workflow-validator', domain: 'validation',  factory: createWorkflowValidator },
  { name: 'workflow-analytics', domain: 'analytics',   factory: createWorkflowAnalytics },
  { name: 'runtime-restart',   domain: 'restart',     factory: createRuntimeRestart },
  { name: 'workflow-coordinator', domain: 'coordination', factory: createWorkflowCoordinator },
] as const;
```

**Rules:**
1. No specialist holds state between requests. Every invocation starts with a fresh instance.
2. Dependencies are injected at creation time, never imported at module level.
3. The manifest is the single source of truth for which specialists exist. The orchestration layer does not hard-code specialist names.
4. Adding a new specialist means adding a factory function and a manifest entry — no changes to the orchestration layer's routing logic beyond adding the new domain to the routing rules.

---

## 1b. Specialist interface evolution

As specialists evolve across waves, their interfaces will change. This section defines rules for managing those changes so that the manifest, orchestration layer, and inter-specialist contracts remain stable.

### What can change without coordination

| Change type | Impact | Allowed freely? |
|---|---|---|
| Add a new method to a specialist interface | Existing callers unaffected (they don't call the new method) | Yes |
| Add a new optional parameter to an existing method | Existing callers unaffected (parameter is optional) | Yes |
| Add a new field to a return type | Existing consumers ignore unknown fields | Yes |
| Add a new specialist to the manifest | Orchestration layer gains a new routing option | Yes — add factory + manifest entry |

### What requires a deprecation cycle

| Change type | Risk | Required process |
|---|---|---|
| Remove a method from a specialist interface | Callers that invoke the method will break | Mark with `@deprecated` JSDoc. The method must remain functional for at least one wave cycle before removal. |
| Rename a method | Same as removal + addition | Add the new name, deprecate the old name, remove old after one wave cycle |
| Change a method's parameter from optional to required | Existing callers that omit the parameter will break | Not allowed within a wave. Ship as a new method or wait for the next major interface revision. |
| Remove a field from a return type | Consumers that read the field will break | Mark with `@deprecated`. Field continues to be populated for one wave cycle. |
| Remove a specialist from the manifest | Orchestration routing breaks for that domain | Requires explicit approval. All routing paths to the specialist must be redirected before removal. |

### Interface revision protocol

When a specialist interface needs a breaking change:

1. The implementer opens a dedicated branch with the change.
2. The branch updates the specialist interface in `types.ts`, the factory function, and the manifest entry.
3. The branch updates all orchestration-layer call sites that reference the changed interface.
4. The branch updates all integration tests that exercise the specialist boundary.
5. The branch is reviewed for boundary clarity before merge.

### Rules

1. Specialist interfaces are versioned implicitly by the wave in which they were introduced. There is no explicit version number on interfaces — the deprecation cycle handles transitions.
2. The orchestration layer must never type-assert or cast specialist return values. If the return type needs to change, update the interface definition so the compiler catches all downstream consumers.
3. When a specialist gains a new method, the manifest descriptor does not change. The orchestration layer discovers capabilities through the interface type, not through manifest metadata.
4. Interface evolution must be tested: the orchestration-layer integration tests (`src/product/orchestration.test.ts`) must cover both the old and new interface shapes during the deprecation overlap period.

---

## 2. Current implemented boundary: Diagnostic engine

The diagnostic engine in `src/runtime/diagnostics/` is the first specialist-like boundary in Ricky. It serves as the reference pattern for all future specialists.

### What it owns

- Failure classification: mapping raw evidence to typed blocker classes
- Unblocker guidance: producing actionable remediation strategies
- Five blocker classes: `agent_runtime.handoff_stalled`, `agent_runtime.progress_opaque`, `environment.relay_state_contaminated`, `workflow_structure.control_flow_invalid`, `validation_strategy.repo_mismatch`

### How it works

```
raw failure evidence (message, source metadata)
  -> rule-based regex matching
  -> blocker class assignment
  -> UnblockerGuidance { action, rationale, automatable }
```

### What it does not own

- Applying fixes (that belongs to the debugger specialist)
- Deciding whether to rerun (that belongs to the restart specialist)
- Reporting failure trends (that belongs to the analytics specialist)

### Reference pattern

The diagnostic engine demonstrates the specialist contract pattern:
- Typed input (failure evidence)
- Deterministic classification (no LLM in the hot path)
- Typed output (unblocker guidance)
- Injectable dependencies (testable without environment coupling)
- Isolated test suite (`failure-diagnosis.test.ts`)

All future specialists should follow this pattern.

---

## 3. Planned specialist: Workflow Author

### Domain

Accepts a workflow spec and produces a validated Relay TypeScript workflow artifact.

### Ownership

| Owns | Does not own |
|---|---|
| Spec intake and parsing | Workflow execution |
| Swarm pattern selection | Surface request normalization (owned by `request-normalizer.ts`) |
| Skill loading and application | Failure diagnosis of running workflows |
| Workflow artifact generation | Proactive failure notifications |
| Dry-run validation of generated workflows | Run history analytics |
| | Cloud deployment |

The Workflow Author consumes already-normalized requests (`LocalInvocationRequest` or `CloudGenerateRequest`) produced by the surface normalizer. It does not handle raw surface-specific input shapes.

### Expected file locations

- `src/product/spec-intake/` - parser, normalizer, router, types
- `src/product/generation/` - pipeline, pattern-selector, skill-loader, template-renderer, types

### Key constraints

- Must read workflow standards and authoring rules before generating
- Must not default blindly to DAG pattern; pattern selection must be deliberate
- Must validate generated workflows with dry-run and structural checks before claiming success
- Must produce Relay-native TypeScript workflows, not generic task scripts
- Generated workflows must include deterministic gates, review stages, and explicit verification

### Interfaces

```typescript
interface WorkflowAuthor {
  intake(spec: SpecInput): Promise<NormalizedSpec>;
  generate(spec: NormalizedSpec): Promise<GeneratedWorkflow>;
  validate(workflow: GeneratedWorkflow): Promise<ValidationResult>;
}
```

---

## 4. Planned specialist: Workflow Debugger

### Domain

Reads workflow execution evidence, classifies failures, and recommends or applies bounded fixes.

### Ownership

| Owns | Does not own |
|---|---|
| Evidence reading and interpretation | Failure classification (uses diagnostic engine) |
| Fix recommendation for classified failures | Workflow generation from scratch |
| Bounded fix application | Restart/rerun decisions |
| Fix verification | Run history trend analysis |

### Expected file locations

- `src/product/specialists/debugger/` - diagnosis bridge, fix-recommender, debugger, types

### Key constraints

- Must consume failure classifications from the diagnostic engine, not re-implement classification
- Must propose bounded fixes, not wholesale rewrites
- Must verify that fixes address the classified failure, not just that the workflow compiles
- Must persist fix artifacts on disk for audit

### Interfaces

```typescript
interface WorkflowDebugger {
  diagnose(evidence: WorkflowRunEvidence): Promise<DiagnosisResult>;
  recommendFix(diagnosis: DiagnosisResult): Promise<FixRecommendation>;
  applyFix(recommendation: FixRecommendation): Promise<FixResult>;
}
```

### Relationship to diagnostic engine

The debugger specialist delegates classification to `src/runtime/diagnostics/`. It adds the fix recommendation and application layer on top. The diagnostic engine is a runtime primitive; the debugger is a product specialist that uses it.

---

## 5. Planned specialist: Workflow Validator

### Domain

Enforces the 80->100 workflow proof standard through structural checks, proof loops, and deterministic gate enforcement.

### Ownership

| Owns | Does not own |
|---|---|
| Structural sanity checks on workflow artifacts | Workflow generation |
| 80->100 proof loop execution | Failure classification |
| Deterministic gate enforcement | Fix application |
| Build/typecheck/test validation | Run coordination |
| Review artifact verification | |

### Expected file locations

- `src/product/specialists/validator/` - structural-checks, proof-loop, validator, types

### Key constraints

- Must not approve workflows that only pass syntax or typecheck
- Must run the standard three-step validation loop: soft run -> fix -> hard gate
- Must verify that deterministic gates actually exist after agent edit steps
- Must check for review stage presence in non-trivial workflows
- Must verify change-detection gates cover both tracked and untracked files

### Interfaces

```typescript
interface WorkflowValidator {
  checkStructure(workflow: GeneratedWorkflow): Promise<StructuralCheckResult>;
  runProofLoop(workflow: GeneratedWorkflow): Promise<ProofLoopResult>;
  enforceGates(workflow: GeneratedWorkflow): Promise<GateEnforcementResult>;
}
```

### The 80->100 standard

"It compiles" is not enough. "Tests passed once" is often not enough. The validator must prove the user-visible slice actually works:

1. Initial test/dry-run with `failOnError: false`
2. Validator fixes based on captured output
3. Final hard gate with `failOnError: true`

---

## 6. Planned specialist: Workflow Analytics

### Domain

Mines workflow run histories to identify failure patterns, bad design choices, and improvement opportunities. Produces actionable digests.

### Ownership

| Owns | Does not own |
|---|---|
| Run history aggregation | Individual failure diagnosis |
| Failure frequency analysis | Fix application |
| Pattern detection (common failures, slow steps, retry storms) | Workflow generation |
| Improvement digest generation | Proactive notification delivery |
| Duration and timeout analysis | |

### Expected file locations

- `src/analytics/` - health-analyzer, digest-generator, types

### Key constraints

- Must consume structured evidence from the evidence model, not raw logs
- Must distinguish between workflow-logic failures and environment/runtime failures
- Must produce concrete, actionable recommendations, not vague observations
- Digests should be machine-readable (structured types) and human-readable (markdown)

### Interfaces

```typescript
interface WorkflowAnalytics {
  analyze(runs: WorkflowRunEvidence[]): Promise<AnalysisResult>;
  generateDigest(analysis: AnalysisResult): Promise<HealthDigest>;
}
```

---

## 6a. Analytics data model and aggregation

The analytics specialist operates on structured evidence, not raw logs. This section defines the data shapes and aggregation primitives that Wave 5 implementers will build against.

### Input: `WorkflowRunEvidence[]`

The analytics specialist receives an array of `WorkflowRunEvidence` records (defined in `src/shared/models/workflow-evidence.ts`). Each record contains full per-step evidence, verification results, gate outcomes, retry history, and duration metrics. The analytics specialist never reads raw log files or Cloud-specific formats — evidence is always pre-normalized.

### Aggregation primitives

The analytics specialist computes the following aggregation primitives from evidence arrays:

```typescript
interface WorkflowHealthMetrics {
  /** Identity */
  workflowId: string;
  workflowName: string;

  /** Run counts */
  totalRuns: number;
  passedRuns: number;
  failedRuns: number;
  timedOutRuns: number;
  cancelledRuns: number;

  /** Failure analysis */
  failureRate: number;                    // failedRuns / totalRuns
  topFailureSteps: StepFailureFrequency[];  // most frequently failing steps
  topBlockerCodes: BlockerCodeFrequency[];  // most frequent diagnostic classifications
  failuresByCategory: Record<string, number>; // domain vs infra vs user-facing

  /** Duration analysis */
  medianDurationMs: number;
  p95DurationMs: number;
  durationTrend: 'improving' | 'stable' | 'degrading'; // based on recent window vs historical

  /** Retry analysis */
  totalRetries: number;
  retryRate: number;                      // runs with retries / totalRuns
  retryStormDetected: boolean;            // >3x baseline retry rate in recent window

  /** Verification analysis */
  gatePassRate: number;                   // passed gates / total gates across all runs
  weakGates: string[];                    // gate names that fail >30% of the time

  /** Time window */
  windowStart: string;                    // ISO 8601
  windowEnd: string;                      // ISO 8601
}

interface StepFailureFrequency {
  stepId: string;
  stepName: string;
  failureCount: number;
  commonErrors: string[];                 // deduplicated error messages
}

interface BlockerCodeFrequency {
  blockerCode: string;
  count: number;
  percentage: number;                     // of total failures
}
```

### Digest output shape

The digest generator transforms `WorkflowHealthMetrics` into both structured and human-readable formats:

```typescript
interface HealthDigest {
  /** Structured data for programmatic consumption */
  metrics: WorkflowHealthMetrics;

  /** Human-readable markdown for surface delivery */
  markdownSummary: string;

  /** Actionable recommendations */
  recommendations: AnalyticsRecommendation[];

  /** When this digest was generated */
  generatedAt: string;
}

interface AnalyticsRecommendation {
  type: 'pattern_migration' | 'step_split' | 'verification_improvement' | 'timeout_adjustment' | 'retry_policy_change';
  severity: 'info' | 'warning' | 'critical';
  description: string;
  affectedWorkflows: string[];
  suggestedAction: string;
}
```

### Aggregation rules

1. Analytics never modifies evidence. It reads `WorkflowRunEvidence[]` and produces computed metrics. The evidence array is immutable from the analytics specialist's perspective.
2. Time windows are explicit. Every aggregation operates on a defined `[windowStart, windowEnd]` range. There are no implicit "all-time" aggregations — the caller specifies the window.
3. Trend detection requires a minimum sample size. `durationTrend` and `retryStormDetected` are only computed when the window contains at least 10 runs. Below that threshold, trend fields return `'stable'` and `false` respectively.
4. Recommendations are concrete. "Consider splitting step X" is acceptable. "Improve your workflow" is not. Every recommendation must reference specific workflows, steps, or metrics.
5. The `markdownSummary` field in `HealthDigest` is the only human-readable output. All other fields are typed and machine-readable. Surface adapters use `markdownSummary` for Slack/Web delivery and `metrics` + `recommendations` for programmatic consumption.

---

## 7. Planned specialist: Runtime Restart

### Domain

Evaluates whether a failed or stalled workflow can be safely restarted, determines the correct restart mode, and coordinates re-launch.

### Ownership

| Owns | Does not own |
|---|---|
| Restart safety evaluation | Failure classification (uses diagnostic engine) |
| Restart mode selection (full rerun, resume, step retry) | Fix application (uses debugger) |
| Pre-restart environment checks | Workflow generation |
| Restart coordination | Analytics |
| Post-restart outcome capture | |

### Key constraints

- Must classify the original failure before deciding to restart; blind retries are not allowed
- Must check for environment contamination (stale relay state) before re-launch
- Must distinguish between retriable failures and structural failures that require fixes first
- Must record restart decisions and outcomes for analytics

### Interfaces

```typescript
interface RuntimeRestart {
  evaluateSafety(evidence: WorkflowRunEvidence): Promise<RestartSafetyResult>;
  selectMode(safety: RestartSafetyResult): Promise<RestartMode>;
  execute(mode: RestartMode): Promise<RestartResult>;
}
```

---

## 8. Planned specialist: Workflow Coordinator

### Domain

Manages the lifecycle of workflow execution across local and cloud environments — launch, monitor, collect outcomes, and hand off to other specialists when intervention is needed.

### Ownership

| Owns | Does not own |
|---|---|
| Execution environment selection (local vs cloud) | Workflow generation (uses author specialist) |
| Workflow launch coordination | Failure classification (uses diagnostic engine) |
| Progress monitoring and status polling | Fix application (uses debugger specialist) |
| Outcome collection and evidence assembly | Validation of generated artifacts (uses validator) |
| Handoff to debugger or restart on failure | Analytics aggregation |

### Expected file locations

- `src/product/specialists/coordinator/` - launcher, monitor, coordinator, types

### Key constraints

- Must not embed domain logic about how to fix or restart workflows — delegates to debugger and restart specialists
- Must support both synchronous (wait for result) and asynchronous (return run ID, poll later) coordination
- Must assemble `WorkflowRunEvidence` from whatever the execution environment produces
- Must respect mode selection (local, cloud, both) from the normalized request

### Interfaces

```typescript
interface WorkflowCoordinator {
  launch(request: CoordinationRequest): Promise<LaunchResult>;
  monitor(runId: string): Promise<MonitorStatus>;
  collectOutcome(runId: string): Promise<WorkflowRunEvidence>;
}
```

---

## 8a. Proactive monitoring boundary

Proactive failure detection is an orchestration-layer concern, not a specialist. It uses `@agent-assistant/proactive` from Agent Assistant.

### What proactive monitoring owns

- **Detection:** Watching for workflow failure signals, degraded health indicators, and anomalous runtime patterns (retry storms, timeout spikes, duration regression)
- **Timing:** Deciding when to check and how often to poll
- **Delivery:** Routing detected signals to the appropriate surface for notification

### What proactive monitoring does not own

- **Classification:** The diagnostic engine classifies failures. Proactive monitoring detects that a failure occurred; it does not determine what kind of failure it is.
- **Remediation:** Specialists own response logic. Proactive monitoring routes signals to the coordinator, which delegates to the debugger or restart specialist as needed.
- **Threshold definition:** Analytics feeds proactive thresholds. For example, "alert when failure rate exceeds 3x baseline" is an analytics-derived threshold consumed by the proactive system.

### Flow

```
Cloud runtime / evidence store
  -> proactive polling detects failure or anomaly
  -> signal routed to coordinator specialist
  -> coordinator delegates to debugger or restart
  -> outcome captured as evidence
  -> surface adapter delivers notification (Slack, etc.)
```

### Rules

1. Proactive monitoring is a runtime infrastructure concern, not a product specialist. It lives at the orchestration layer alongside `@agent-assistant/proactive`.
2. Proactive signals are typed (failure, degradation, anomaly) and carry enough context for the coordinator to route without re-querying the evidence store.
3. The proactive system does not apply fixes directly. It detects and routes; specialists respond.
4. Escalation severity (info, warning, critical) determines delivery timing. See §9 Escalation boundaries for severity definitions.

---

## 8b. Multi-specialist sequencing protocol

When a request requires multiple specialists (e.g., generate -> validate, or debug -> fix -> validate -> restart), the orchestration layer sequences them. This section defines the handoff contract shape for intermediate data between specialists in multi-specialist flows.

### The sequencing problem

The Coordinator specialist manages execution lifecycle, but multi-specialist flows pass intermediate data between specialists that the Coordinator did not produce. For example, after the Debugger recommends a fix, the Validator needs the fix artifacts to verify them. The data that flows between them must have a defined shape.

### Intermediate data contract: `SpecialistHandoff`

```typescript
interface SpecialistHandoff {
  /** Which specialist produced this handoff */
  fromSpecialist: string;

  /** Which specialist should consume it */
  toSpecialist: string;

  /** The domain action that was completed */
  completedAction: string;

  /** Typed payload — shape depends on the fromSpecialist → toSpecialist pair */
  payload: SpecialistHandoffPayload;

  /** Evidence snapshot at the point of handoff */
  evidenceSnapshot: WorkflowRunEvidence;

  /** Timestamp of the handoff */
  handoffAt: string;
}
```

### Known handoff pairs and their payload shapes

| From | To | `completedAction` | `payload` type |
|---|---|---|---|
| Author | Validator | `'workflow_generated'` | `{ workflow: GeneratedWorkflow; dryRunResult?: ValidationResult }` |
| Author | Coordinator | `'workflow_generated'` | `{ workflow: GeneratedWorkflow; mode: WorkflowExecutionMode }` |
| Debugger | Validator | `'fix_applied'` | `{ fixResult: FixResult; originalDiagnosis: DiagnosisResult }` |
| Debugger | Restart | `'fix_applied'` | `{ fixResult: FixResult; restartRecommended: boolean }` |
| Validator | Coordinator | `'validation_passed'` | `{ proofResult: ProofLoopResult }` |
| Validator | Debugger | `'validation_failed'` | `{ failedChecks: StructuralCheckResult[]; proofResult: ProofLoopResult }` |
| Coordinator | Debugger | `'execution_failed'` | `{ runEvidence: WorkflowRunEvidence }` |
| Coordinator | Restart | `'execution_failed'` | `{ runEvidence: WorkflowRunEvidence; failureClassification?: DiagnosisResult }` |
| Analytics | Coordinator | `'improvements_identified'` | `{ recommendations: AnalyticsRecommendation[] }` |

### Sequencing flow

```
orchestration layer receives normalized request
  │
  ▼
route to primary specialist (per §9a priority ladder)
  │
  ▼
primary specialist returns result + optional handoff descriptor
  │
  ▼
orchestration layer evaluates: does the result require a follow-up specialist?
  │
  ├── no  → assemble final result, return to surface
  │
  └── yes → construct SpecialistHandoff, invoke next specialist
              │
              ▼
            repeat until no further handoff is needed
              │
              ▼
            assemble final result from all specialist outputs
```

### Rules

1. **The orchestration layer owns sequencing.** Specialists return results; they never invoke the next specialist directly. If a specialist needs a follow-up (e.g., Debugger wants Validator to check its fix), it includes a `suggestedNext` field in its result, but the orchestration layer decides whether to honor it.
2. **Handoffs carry evidence snapshots.** Every `SpecialistHandoff` includes the `WorkflowRunEvidence` as of the handoff moment. This ensures the receiving specialist has full context without re-querying the evidence store.
3. **Handoff payloads are typed per pair.** The `payload` is a discriminated union keyed on `fromSpecialist` + `toSpecialist`. Adding a new handoff pair means defining the payload type in `src/shared/models/` and updating the orchestration layer's sequencing logic.
4. **Maximum chain depth is 5.** To prevent infinite specialist loops, the orchestration layer enforces a maximum of 5 handoffs per request. If a flow exceeds this depth, the orchestration layer escalates to the user with the full chain history.
5. **Every handoff is logged.** The orchestration layer logs each `SpecialistHandoff` (from, to, completedAction, timestamp) as a structured log entry for debugging and analytics.

---

## 9. Escalation boundaries

Not every failure can be resolved autonomously. Ricky must know when to escalate to a human operator instead of retrying or applying speculative fixes.

### Escalation triggers

| Condition | Escalation action |
|---|---|
| Structural failure after fix attempt | Surface the diagnosis and failed fix to the user; do not retry |
| Environment blocker that persists after cleanup | Report the blocker class and suggest manual remediation |
| Multiple restart attempts without progress | Stop retrying and present the full failure chain |
| Specialist boundary ambiguity | Ask the user which action to take rather than guessing |
| Safety-sensitive restart (destructive or externally visible) | Require explicit user approval before proceeding |
| Unknown failure class | Surface raw evidence with honest "unclassified" label |

### Escalation rules

1. **Never hide failures behind retries.** If a retry does not resolve the issue, the next action is escalation, not another retry.
2. **Preserve full context when escalating.** The user or operator must see: what was attempted, what failed, the classified blocker (or "unclassified"), and what Ricky recommends.
3. **Distinguish escalation from failure.** Escalation means Ricky has reached a boundary, not that Ricky has failed. The summary should say what Ricky knows and what it recommends, not just that something went wrong.
4. **Proactive surfaces use escalation for urgency.** When proactive monitoring detects a failure, the escalation severity determines whether Ricky sends a notification immediately or batches it into a digest.

### Escalation severity levels

| Level | Meaning | Delivery |
|---|---|---|
| `info` | Notable but not blocking | Batched into periodic digest |
| `warning` | Degraded but functional | Delivered at next convenient surface interaction |
| `critical` | Blocking or data-risk | Immediate proactive notification |
| `unclassified` | Cannot determine severity | Treated as `warning` with honest "unclassified" label |

### Rule for implementers

Escalation is a first-class outcome, not an error path. Every specialist must define its escalation conditions in its interface contract. The product orchestration layer collects escalation signals and routes them to the appropriate surface for delivery.

---

## 9a. Request routing and conflict resolution

When a request could match multiple specialists, the orchestration layer uses a priority ladder to determine routing. This eliminates ambiguity and prevents specialists from competing for the same request.

### Priority ladder

| Priority | Condition | Routes to |
|---|---|---|
| 1 | Request contains a workflow spec (natural language or structured) | Workflow Author |
| 2 | Request references a failed or stalled workflow run | Workflow Debugger (via Coordinator) |
| 3 | Request explicitly asks for rerun, restart, or retry | Runtime Restart (via Coordinator) |
| 4 | Request asks for analysis, trends, health, or improvement suggestions | Workflow Analytics |
| 5 | Request asks to launch, monitor, or check status of a running workflow | Workflow Coordinator |
| 6 | Ambiguous — request does not clearly match any specialist | Escalate to user with options |

### Evaluation rules

1. The orchestration layer evaluates the priority ladder top-to-bottom and routes to the first matching specialist.
2. A request may trigger multiple specialists in sequence (e.g., Author generates a workflow, then Coordinator launches it, then Validator proves it). This sequencing is the orchestration layer's responsibility, not the specialist's.
3. If a request matches priority 6 (ambiguous), the orchestration layer presents the user with a clear set of options rather than guessing. The options correspond to the specialist domains: generate, debug, restart, analyze, coordinate.
4. The Coordinator specialist is the delegation hub for multi-specialist flows. When a debug request requires a restart after fix, the orchestration layer routes through Coordinator, which sequences Debugger -> Validator -> Restart.
5. The priority ladder is defined in the orchestration layer, not in individual specialists. Specialists do not self-select or compete for requests.

---

## 9b. Specialist artifact output conventions

Specialists produce disk artifacts during execution: generated workflows, fix patches, review files, analytics digests, evidence snapshots. This section defines where specialists write artifacts and how they name them.

### Artifact output root

All specialist artifacts are written under the `.workflow-artifacts/` directory at the repo root. This convention is inherited from the workflow standards (see `docs/workflows/WORKFLOW_STANDARDS.md` §12.1) and applies uniformly to specialist outputs.

### Per-specialist artifact paths

| Specialist | Artifact output path | Artifact types |
|---|---|---|
| Workflow Author | `.workflow-artifacts/generation/<workflow-id>/` | Generated workflow files, dry-run reports, skill selection logs |
| Workflow Debugger | `.workflow-artifacts/debugging/<run-id>/` | Diagnosis reports, fix patches, fix verification results |
| Workflow Validator | `.workflow-artifacts/validation/<workflow-id>/` | Structural check reports, proof loop results, gate enforcement logs |
| Workflow Analytics | `.workflow-artifacts/analytics/<digest-id>/` | Health digests (markdown + structured JSON), recommendation reports |
| Runtime Restart | `.workflow-artifacts/restart/<run-id>/` | Safety evaluation reports, restart decision logs, post-restart evidence |
| Workflow Coordinator | `.workflow-artifacts/coordination/<run-id>/` | Launch logs, progress snapshots, final outcome summaries |

### Artifact naming conventions

Within a specialist's output directory:

| Artifact type | Naming pattern | Example |
|---|---|---|
| Primary output | `<action>.md` or `<action>.json` | `diagnosis.md`, `health-digest.json` |
| Structured data | `<action>-data.json` | `diagnosis-data.json`, `metrics.json` |
| Evidence snapshot | `evidence-snapshot.json` | — |
| Review / signoff | `review.md`, `signoff.md` | — |
| Intermediate files | `_<name>.<ext>` (underscore prefix) | `_dry-run-output.txt`, `_fix-diff.patch` |

### Rules

1. **Specialists must write artifacts to their designated path.** A specialist that writes to another specialist's directory or to an ad-hoc location is a boundary violation. The artifact path is constructed by the specialist's factory function based on the request context (workflow ID or run ID).
2. **Artifact paths are relative to the repo root.** Specialists receive the repo root path through dependency injection and construct their output paths relative to it. No hardcoded absolute paths.
3. **Intermediate files use an underscore prefix.** Files prefixed with `_` are considered transient and may be cleaned up after the specialist completes. Files without the prefix are durable outputs that consumers (surfaces, analytics, audit) may read.
4. **Every specialist must produce a structured JSON artifact alongside any markdown output.** The markdown is for human consumption; the JSON is for programmatic consumption by other specialists and by the analytics module.
5. **Artifact directories are created on demand.** Specialists create their output directory when they first need to write. They do not assume the directory exists.
6. **Generated workflow files go to the project source tree, not to `.workflow-artifacts/`.** The Author specialist writes the actual workflow `.ts` file to the project's source tree (e.g., `workflows/wave2-product/`). The `.workflow-artifacts/generation/` path holds the Author's metadata artifacts (dry-run reports, skill selection logs), not the workflow file itself.

---

## 10. Boundary rules

### Specialists do not import each other

No specialist should directly import from another specialist's directory. All inter-specialist communication goes through shared models in `src/shared/models/`.

**Correct:** Debugger reads `WorkflowRunEvidence` from shared models, calls diagnostic engine, produces `FixRecommendation`.

**Incorrect:** Debugger imports `WorkflowValidator` to check its own fixes.

### Shared models are the communication substrate

`src/shared/models/` defines the types that flow between specialists:
- `WorkflowConfig` - workflow definition shape
- `WorkflowStepEvidence` / `WorkflowRunEvidence` - execution evidence
- Future: `NormalizedSpec`, `GeneratedWorkflow`, `DiagnosisResult`, etc.

When a new type is needed for cross-specialist communication, it goes in shared models.

### Orchestration belongs to the product layer

The product orchestration layer (not yet implemented, expected at `src/product/`) decides which specialist handles a request and in what order. Specialists do not call each other or decide their own sequencing.

Example orchestration flow for a debug request:
1. Product layer receives debug request
2. Calls diagnostic engine for classification
3. Calls debugger specialist for fix recommendation
4. Calls validator specialist to verify the fix
5. Calls restart specialist if rerun is needed
6. Returns unified result to the surface

### New specialists require justification

Adding a new specialist is not free. Each specialist adds:
- A new interface contract
- A new test suite
- A new orchestration path
- A new set of shared model types

Only add a specialist when the domain is clearly separable and the alternative (putting the logic in an existing specialist) would create unclear ownership. Convenience is not sufficient justification.

### Shared model evolution rules

Types in `src/shared/models/` are the communication substrate between specialists. Evolving them safely requires discipline:

1. **Adding types is free.** New types, new fields with optional modifiers, new union variants — all safe to add without coordination.
2. **Removing or renaming types requires a deprecation cycle.** Add a `@deprecated` JSDoc comment with the removal target version. The deprecated type must remain importable for at least one release cycle before deletion.
3. **Never break existing specialist imports.** If a shared type is imported by any specialist, removing it without deprecation is a boundary violation.
4. **Type changes that affect multiple specialists must be reviewed.** If changing a shared type would require updating more than one specialist's implementation, the change needs explicit review before merge.

### Integration testing across specialist boundaries

Specialists are tested in isolation with fixtures (see §11 rule 4). The orchestration layer needs its own integration tests to verify routing and sequencing.

**Orchestration-layer integration tests:**
- Use stub specialist implementations that return canned responses from fixture data in `src/shared/models/`
- Test routing decisions: given a normalized request, does the orchestration layer invoke the correct specialist?
- Test sequencing: for multi-specialist flows (e.g., debug -> validate -> restart), does the orchestration layer call specialists in the correct order with the correct intermediate data?
- Do not test specialist internals. Stub specialists return predetermined results; the tests verify that the orchestration layer handles those results correctly.

**Test location:** `src/product/orchestration.test.ts` (or equivalent when the orchestration layer is implemented).

---

## 11. Key rules for implementers

1. **Start with the diagnostic engine as reference.** It demonstrates the correct pattern: typed input, deterministic core, typed output, injectable dependencies, isolated tests.

2. **Write the interface before the implementation.** Define the specialist's contract as a TypeScript interface in its `types.ts` file before writing any logic. Review the interface for boundary clarity before proceeding.

3. **Use injectable dependencies.** Every specialist must accept its dependencies as constructor or function parameters. No hidden imports of other specialists, no module-level singletons.

4. **Test in isolation.** Specialist tests should use fixtures from shared models, not live execution. A specialist test that requires another specialist to run is a boundary violation.

5. **Keep the diagnostic engine as a runtime primitive.** The diagnostic engine is not a product specialist; it is a runtime primitive that product specialists consume. Do not merge it into the debugger or add product-level logic to it.

6. **Respect the ownership table.** If a capability is listed in another specialist's "Owns" column, do not implement it in your specialist. If ownership is unclear, resolve it before writing code.
