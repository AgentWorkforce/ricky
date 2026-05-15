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

## runtime-recovery.env-loader-injection-runtime-loadable
Executor: manual
Kind: regression
Tags: runtime, auto-fix, env-loader
Human Review: true

### Message
A workflow artifact references a `MISSING_ENV_VAR` value. Ricky's deterministic auto-fix injects the `.env.local` / `.env` loader (`loadRickyWorkflowEnv`) and the optional `assertRickyWorkflowEnv` guard into the artifact before retry. The artifact may be a master-rendered workflow whose `.step({ command: ... })` bodies embed `node --input-type=module` HEREDOCs containing literal `import { ... } from 'node:fs'` / `from 'node:path'` strings.

### Deterministic Checks
maxToolCalls: 0

### Must
- Produce a repaired artifact that successfully loads under Node, not just one that contains the marker comment. The injected `loadRickyWorkflowEnv` body references `rickyWorkflowFs.*` and `rickyWorkflowPath.*`, so the repair must also add the corresponding `import * as rickyWorkflowFs from 'node:fs'` and `import * as rickyWorkflowPath from 'node:path'` aliases at module top level.
- Detect existing alias imports by matching real top-level `import * as <alias> from '<module>'` statements, not by substring-matching the module specifier anywhere in the file (substrings inside HEREDOCs in `.step({ command: ... })` bodies do not count as imports).
- Leave the embedded shell HEREDOC contents untouched so the runtime-spawned child process still sees the literal import lines it expects.

### Must Not
- Skip adding the `rickyWorkflowFs` / `rickyWorkflowPath` aliases because `from 'node:fs'` or `from 'node:path'` already appears somewhere in the file as a string literal.
- Inject `loadRickyWorkflowEnv` (or `assertRickyWorkflowEnv`) without the supporting alias imports, which produces a `ReferenceError: rickyWorkflowPath is not defined` at module load and burns the auto-fix budget on `UNSUPPORTED_RUNTIME at runtime-launch`.
- Rewrite or escape the embedded HEREDOC text in step commands.

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

## runtime-recovery.preserve-pr-shipping-during-repair
Executor: manual
Kind: regression
Tags: runtime, recovery, auto-fix, github-primitive
Human Review: true

### Message
A persona-authored workflow that imports `@agent-relay/github-primitive` and uses `createGitHubStep` to open a PR fails its runtime-precheck. The auto-fix repair persona is invoked. Describe the contract the repaired artifact must satisfy.

### Deterministic Checks
maxToolCalls: 0

### Must
- Preserve the `@agent-relay/github-primitive` import, the `GitHubStepExecutor` reference, and every `createGitHubStep(...)` invocation that the original artifact declared.
- Keep the failing workflow runnable from the same path with the same `workflow(...)` builder and `.run({ cwd: process.cwd() })` invocation.
- Retain at least ceil(N / 2) of the original workflow's `.step(...)` calls when the original declared four or more steps; a repair that collapses to a 2-3 step placeholder is a regression, not a fix.
- Reject (do not apply) any repair output whose step list reduces to `prepare-context` / `runtime-precheck: true` / `final-signoff: echo placeholder`; surface the regression diagnostic instead.

### Must Not
- Strip `createGitHubStep`, `GitHubStepExecutor`, or `@agent-relay/github-primitive` because the runtime-precheck failure mentioned PR-shipping or git side effects. The repair contract's "no commit / no push" constraint applies to the REPAIR AGENT's runtime behavior, not to the workflow's step declarations.
- Emit a "minimal repair-safe master" or "simplified Ricky master" scaffold that passes the builder validator while doing none of the original work.
- Treat "the workflow now builds and runs" as success when the work it was supposed to ship is gone.
