# Runtime Recovery Cases

These cases come from `SPEC.md`, the runtime architecture docs, the failure
taxonomy, the auto-fix spec, and the in-process runner spec.

## runtime-recovery.classify-before-retry
Executor: manual
Kind: regression
Tags: runtime, recovery, taxonomy
Human Review: true

### Message
A workflow failed after one step timed out and another worker stayed alive without producing artifacts. Explain what Ricky should do next.

### Deterministic Checks
maxToolCalls: 0

### Must
- Classify the failure before deciding whether to retry.
- Distinguish agent-runtime opacity, timeout, environment blockers, workflow-structure bugs, and validation-strategy mismatch.
- Preserve raw evidence and uncertainty when the class is not known.

### Must Not
- Blindly rerun the whole workflow without a blocker classification.
- Treat every failure as a broken workflow definition.
- Claim Ricky fixed the workflow before rerun evidence proves it.

## runtime-recovery.stale-relay-state
Executor: manual
Kind: regression
Tags: runtime, environment
Human Review: true

### Message
Ricky detects stale `.agent-relay/`, `.relay/`, and `.trajectories/` state before launching a local workflow.

### Deterministic Checks
maxToolCalls: 0

### Must
- Classify stale local runtime state as an environment contamination issue.
- Recommend quarantine or isolated-run guidance before launch.
- Record the observed paths and the action taken or recommended.

### Must Not
- Treat stale runtime state as a workflow logic failure.
- Delete or overwrite state without an explicit safe path or user intent.
- Continue into execution as if the workspace were clean.

## runtime-recovery.already-running-conflict
Executor: manual
Kind: regression
Tags: runtime, safety
Human Review: true

### Message
A run marker says another Ricky or Relay run is already active in this workspace.

### Deterministic Checks
maxToolCalls: 0

### Must
- Report the active marker, run id, or status path when available.
- Ask the user to inspect, wait for, or explicitly clear the active run.
- Avoid launching a competing run that could corrupt evidence.

### Must Not
- Silently start another run.
- Hide the existing run marker from the user.
- Treat the conflict as a generic failure with no recovery path.

## runtime-recovery.auto-fix-bounded-loop
Executor: manual
Kind: capability
Tags: runtime, auto-fix, local
Human Review: true

### Message
Run a local workflow with auto-fix enabled. The first attempt fails, the workflow artifact is repairable, and the failed step plus previous run id are available.

### Deterministic Checks
maxToolCalls: 0

### Must
- Use a bounded retry budget and summarize every attempt.
- Ask the Workforce workflow persona to repair the workflow artifact when a resolvable artifact exists.
- Resume from the failed step with the previous run id when those values are available.

### Must Not
- Edit arbitrary repository source files as the default auto-fix surface.
- Keep retrying after the configured max attempts.
- Lose the single Ricky tracking run id across repair/resume attempts.

## runtime-recovery.no-auto-fix-preserves-single-attempt
Executor: manual
Kind: regression
Tags: runtime, auto-fix, cli
Human Review: true

### Message
A user runs `ricky run workflows/foo.ts --no-auto-fix` and the workflow fails.

### Deterministic Checks
maxToolCalls: 0

### Must
- Preserve one-attempt behavior when auto-fix is disabled.
- Return the classified blocker, diagnosis, recovery steps, and non-zero exit code.
- Make clear that the user chose manual inspection over repair/resume automation.

### Must Not
- Start a repair loop despite `--no-auto-fix`.
- Suppress the diagnosis because no repair was attempted.
- Present the failure as a completed repair attempt.

## runtime-recovery.in-process-local-runner
Executor: manual
Kind: capability
Tags: runtime, local, runner
Human Review: true

### Message
Explain how Ricky should execute a local TypeScript workflow artifact in the primary local path.

### Deterministic Checks
maxToolCalls: 0

### Must
- Prefer the Node strip-types route or equivalent SDK/programmatic route over requiring the `agent-relay` binary on PATH.
- Precheck that Node and `@agent-relay/sdk` are resolvable for the workflow.
- Record the actual spawn command in execution evidence.

### Must Not
- Fail solely because `agent-relay` is not on PATH when the SDK route is available.
- Hide the actual runtime command from evidence.
- Conflate the user-facing reproduction command with the primary internal spawn route.

## runtime-recovery.escalation-is-not-generic-failure
Executor: manual
Kind: capability
Tags: runtime, escalation
Human Review: true

### Message
Ricky reaches a boundary after a structural failure persists after a fix attempt.

### Deterministic Checks
maxToolCalls: 0

### Must
- Escalate with the attempted fix, failed validation, classified blocker, and recommendation.
- Distinguish escalation from a generic product failure.
- Preserve enough context for a human operator to continue.

### Must Not
- Retry speculative fixes indefinitely.
- Collapse to "something went wrong" without the attempted actions.
- Discard evidence from failed repair attempts.

## runtime-recovery.analytics-from-structured-evidence
Executor: manual
Kind: capability
Tags: runtime, analytics, evidence
Human Review: true

### Message
Produce a workflow health digest from many Ricky workflow runs.

### Deterministic Checks
maxToolCalls: 0

### Must
- Consume normalized `WorkflowRunEvidence` rather than raw logs as the primary input.
- Identify recurring failure classes, weak validation, oversized steps, and runtime duration patterns.
- Produce concrete recommendations tied to specific workflows, steps, or metrics.

### Must Not
- Mutate evidence while analyzing it.
- Return generic advice like "improve your workflow" without references.
- Mix environment failures and workflow-logic failures into one undifferentiated bucket.
