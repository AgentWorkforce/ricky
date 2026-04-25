# Ricky Failure Taxonomy and Autonomous Unblockers

This document captures the concrete failure patterns observed while bootstrapping Ricky's meta-workflow and generated workflow batch. The goal is to turn real operator pain into product knowledge so Ricky can eventually classify, explain, and unblock these cases autonomously.

## Why this exists

During initial Ricky meta-workflow proving, several failures were not product-logic failures. They were orchestration, environment, validation-strategy, and agent-runtime failures. Ricky should learn to distinguish these categories instead of treating every failed run as "the workflow is bad".

## Category 1: Agent-runtime handoff failure

### Symptom
- A spawned planning, generation, review, or fix agent starts but emits little or no useful output.
- The workflow remains alive but the agent appears stalled.
- The process may later disappear without durable artifacts.

### Observed examples
- Early `plan-generated-backlog` runs stalled after agent assignment with little or no useful output.
- Some review/fix phases ran for long intervals with repeated "still running" notices and weak artifact visibility.

### Why this happens
- Interactive or semi-interactive coding agents can hang or become slow when broker state, prompt complexity, or runtime conditions are poor.
- Liveness is not the same as progress.

### Ricky classification
`agent_runtime.handoff_stalled`

### Ricky unblocker strategy
1. Detect "assigned but silent" or "still running without artifact change" as a first-class runtime symptom.
2. Check for artifact freshness and file-system progress, not just process liveness.
3. If the step is structurally deterministic, replace the live agent step with a deterministic artifact-generation step.
4. If the step is not safely deterministic, restart the step with a narrower prompt and stronger output contract.
5. Persist a blocker artifact describing what was observed and why the step was retried, downgraded, or replaced.

### Product rule
Ricky should prefer deterministic planning or validation steps over live agent delegation when the task is primarily structural and repeatable.

## Category 2: Environment contamination / stale relay state

### Symptom
- Repeated warnings about stale `.agent-relay/` directories in the repo.
- Workers may be harder to reason about across reruns.
- Runs can appear inconsistent even when workflow code is unchanged.

### Observed examples
- Ricky repo repeatedly surfaced warnings like: stale `.agent-relay/` directory found, remove it to avoid confusing spawned agents.
- The directory reappeared even after it was manually moved aside before reruns.

### Why this happens
- Local relay runtime state can persist across runs and contaminate future spawned sessions.
- A rerun can inherit workspace-level state that is invisible in the workflow definition itself.

### Ricky classification
`environment.relay_state_contaminated`

### Ricky unblocker strategy
1. Add a preflight check for `.agent-relay`, `.relay`, `.trajectories`, and similar local runtime state.
2. If stale state is present, quarantine it before launch and record the action.
3. If the stale state reappears repeatedly, classify it as a persistent environment blocker instead of assuming the workflow definition is at fault.
4. Recommend a bounded cleanup or isolated working directory when contamination persists.

### Product rule
Ricky should treat relay state contamination as an environment issue, not as evidence that the generated workflow logic itself is wrong.

## Category 3: Workflow orchestration correctness failure

### Symptom
- Generated workflows are syntactically valid and look detailed, but their dependency graph is wrong.
- Fix loops are unreachable because a pass-only review gate runs before fixes.
- Final signoff is not properly conditioned on post-fix review success.

### Observed examples
- Early generated workflows placed fix steps behind pass-only review verdict gates in some waves.
- Other waves allowed fix loops to run, but their review-pass gate was not a clean final precondition of signoff.

### Why this happens
- A workflow can be content-rich yet orchestration-poor.
- Structural quality is more than imports, steps, and validation commands. The dependency graph itself must express the intended remediation loop.

### Ricky classification
`workflow_structure.control_flow_invalid`

### Ricky unblocker strategy
1. Validate workflow dependency topology as part of generation-time linting.
2. Enforce the pattern: review -> read feedback -> fix -> post-fix validation -> final review-pass gate -> final hard gate -> regression gate -> signoff.
3. Reject workflows where fix steps depend on a pass-only review gate.
4. Reject workflows where signoff is reachable without a post-fix review-pass gate.

### Product rule
Ricky must lint for orchestration correctness, not only file presence and syntax.

## Category 4: Weak deterministic scope or change-detection gates

### Symptom
- Workflows claim to verify changes, but the gates only observe tracked diffs.
- Newly created files can be missed.
- Unexpected tracked or untracked files outside the intended scope are not always rejected.

### Observed examples
- Early generated workflows relied on `git diff`-only checks.
- Later review found that some gates included untracked detection but still did not consistently reject unrelated changed files.

### Why this happens
- "Some expected file changed" is weaker than "the changed set is confined to allowed paths and includes the intended target paths".

### Ricky classification
`workflow_structure.scope_gate_weak`

### Ricky unblocker strategy
1. Build change-detection gates from the full changed set:
   - tracked changes via `git diff --name-only`
   - untracked changes via `git ls-files --others --exclude-standard`
2. Require proof that at least one expected path changed.
3. Reject any changed path outside the workflow's allowed code paths plus `.workflow-artifacts/`.
4. Lint generated workflows for this exact pattern.

### Product rule
Ricky should treat weak scope gates as a reliability bug, not a cosmetic issue.

## Category 5: Validation-strategy mismatch

### Symptom
- A theoretically strong validation command is not actually meaningful in the repo.
- Repo-wide `npx tsc --noEmit` may fail or be misleading because the repo lacks a normal `tsconfig.json` or Node type setup for standalone workflow files.

### Observed examples
- Ricky generation/review explicitly noted that repo-wide `npx tsc --noEmit` was not a truthful proof gate for standalone workflow files in the current repo state.
- Targeted workflow parsing or `agent-relay run --dry-run` was more accurate.

### Why this happens
- Validation quality depends on the actual repository shape, not the ideal one.
- A bad proof gate can create false failures or false confidence.

### Ricky classification
`validation_strategy.repo_mismatch`

### Ricky unblocker strategy
1. Detect whether global validation commands are actually configured and meaningful.
2. If not, downgrade to truthful targeted validation such as per-file parsing, targeted build, or `agent-relay run --dry-run`.
3. Record why the fallback was used.
4. Distinguish "tooling gap" from "implementation failure" in run summaries.

### Product rule
Ricky should never pretend a validation command is authoritative when the repo does not support it.

## Category 6: Opaque long-running review or fix loops

### Symptom
- A review or fix step remains alive for many minutes with repeated `still running` notices.
- It is unclear whether the step is genuinely working or just hanging.

### Observed examples
- Review and fix phases in the Ricky meta-workflow often produced long-running status notices with limited visibility into whether artifacts were changing.

### Why this happens
- Agent runtime progress is often under-instrumented.
- Without artifact freshness checks, operators only see process liveness.

### Ricky classification
`agent_runtime.progress_opaque`

### Ricky unblocker strategy
1. Track artifact modification time and changed file count while agent steps are running.
2. Emit progress summaries based on artifact activity, not only worker liveness.
3. Escalate to a blocker when a step is alive but artifacts are unchanged for a configured interval.
4. Support bounded restart or downgrade strategies when opacity persists.

### Product rule
Ricky should reason about progress through evidence, not just process existence.

## Recommended Ricky runtime behaviors

### 1. Preflight environment checks
Before running a generated workflow, Ricky should check:
- stale relay state
- required local config presence
- whether validation tools are actually configured
- whether the workspace is already mid-run or contaminated by prior sessions

### 2. Failure classification before retry
Ricky should classify the blocker before deciding to rerun:
- `agent_runtime.*`
- `environment.*`
- `workflow_structure.*`
- `validation_strategy.*`

A retry without reclassification is often wasted motion.

### 3. Deterministic downgrade path
For structurally deterministic phases such as planning, file enumeration, or plan synthesis, Ricky should support a downgrade path from live agent delegation to deterministic artifact creation.

### 4. Template-level remediation over file-by-file patching
If multiple generated workflows fail for the same structural reason, Ricky should patch the generator/template/rules first, then regenerate, rather than hand-tuning each file.

### 5. Honest run summaries
Every Ricky failure summary should clearly distinguish:
- product logic failures
- environment blockers
- runtime handoff failures
- orchestration bugs
- validation-strategy mismatches

## Initial taxonomy table

| Category | Code | Meaning | Preferred first unblocker |
|---|---|---|---|
| Agent handoff stalled | `agent_runtime.handoff_stalled` | Spawned worker assigned but not producing useful output | downgrade deterministic step or restart narrowly |
| Progress opaque | `agent_runtime.progress_opaque` | Worker alive but no artifact-visible progress | inspect artifact freshness, then restart or downgrade |
| Relay state contaminated | `environment.relay_state_contaminated` | Local relay state likely contaminates reruns | quarantine state and rerun clean |
| Control flow invalid | `workflow_structure.control_flow_invalid` | Review/fix/signoff dependency graph is wrong | patch template and regenerate |
| Scope gate weak | `workflow_structure.scope_gate_weak` | Changed-set validation is incomplete | tighten regression/change gates |
| Repo validation mismatch | `validation_strategy.repo_mismatch` | Nominal validation command is not meaningful in this repo | switch to truthful targeted validation |

## Decision

Ricky should evolve from a workflow generator into a workflow diagnosis and unblocker system. The product must recognize when the failure is caused by runtime delegation, stale environment state, weak orchestration topology, or invalid proof strategy, and then choose the matching unblock action instead of blindly retrying.
