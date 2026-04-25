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

## 8. Boundary rules

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

---

## 9. Key rules for implementers

1. **Start with the diagnostic engine as reference.** It demonstrates the correct pattern: typed input, deterministic core, typed output, injectable dependencies, isolated tests.

2. **Write the interface before the implementation.** Define the specialist's contract as a TypeScript interface in its `types.ts` file before writing any logic. Review the interface for boundary clarity before proceeding.

3. **Use injectable dependencies.** Every specialist must accept its dependencies as constructor or function parameters. No hidden imports of other specialists, no module-level singletons.

4. **Test in isolation.** Specialist tests should use fixtures from shared models, not live execution. A specialist test that requires another specialist to run is a boundary violation.

5. **Keep the diagnostic engine as a runtime primitive.** The diagnostic engine is not a product specialist; it is a runtime primitive that product specialists consume. Do not merge it into the debugger or add product-level logic to it.

6. **Respect the ownership table.** If a capability is listed in another specialist's "Owns" column, do not implement it in your specialist. If ownership is unclear, resolve it before writing code.
