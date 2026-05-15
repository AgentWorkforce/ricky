# Workflow Authoring Cases

These cases are intentionally human-review heavy. They capture the behavior Ricky
should preserve when it plans, generates, reviews, or repairs Agent Relay
workflows.

## workflow-authoring.deterministic-gates
Executor: manual
Kind: capability
Tags: workflow-authoring, gates, local
Human Review: true

### Message
Generate a Ricky workflow that updates a TypeScript package and proves it works before final signoff.

### Deterministic Checks
maxToolCalls: 0

### Must
- Include deterministic verification gates after every file-editing step, preferably `exit_code`, `file_exists`, or scoped diff checks.
- Use a soft-gate, fix, hard-gate loop for serious implementation work.
- Include a final signoff artifact under `.workflow-artifacts/`.

### Must Not
- Treat typecheck or compile alone as sufficient proof for user-facing behavior.
- Use broad repo-wide `git diff --quiet` as the only change-detection gate.
- Mark work complete without a review of the fixed state.

## workflow-authoring.distinct-reviewer
Executor: manual
Kind: regression
Tags: workflow-authoring, review
Human Review: true

### Message
Write a workflow that has Codex generate a convention update and then review it.

### Deterministic Checks
maxToolCalls: 0

### Must
- Assign a reviewer agent distinct from the writer when possible.
- Persist significant review artifacts under `.workflow-artifacts/`.
- Keep convention-only edits scoped to the declared convention files.

### Must Not
- Let the same agent both write and rubber-stamp the change without an explicit reason.
- Skip deterministic file-existence, grep, symlink, or scoped change-detection checks.
- Edit unrelated package metadata or generated workflows for a convention-only request.

## workflow-authoring.fresh-eyes-loop-simple-test
Executor: ricky-cli
Kind: regression
Tags: workflow-authoring, review, tests, fresh-eyes
Human Review: false

### Message
Generate a small Agent Relay workflow that adds one missing Vitest unit test for a TypeScript helper and proves the test passes.

### Mock
cwd: temp
specFileContent: Generate a small Agent Relay workflow that adds one missing Vitest unit test for a TypeScript helper and proves the test passes.
argv: --mode local --spec-file {{specFile}} --no-run --json --no-workforce-persona
includeGeneratedArtifacts: true

### Deterministic Checks
ok: true
contentIncludes:
- stage": "generate
- status": "ok
- --- GENERATED ARTIFACT:
- .agent("reviewer-claude"
- .agent("validator-claude"
- .agent("reviewer-codex"
- .agent("validator-codex"
- verdict: FINDINGS | NO_ISSUES_FOUND | BLOCKED
- add or update appropriate tests/proofs
- dependsOn: ["final-fix-codex"]
contentMatches:
- \.step\("review-claude"[\s\S]*\.step\("fix-loop"[\s\S]*\.step\("final-review-claude"[\s\S]*\.step\("final-fix-claude"[\s\S]*\.step\("review-codex"[\s\S]*\.step\("fix-loop-codex"[\s\S]*\.step\("final-review-codex"[\s\S]*\.step\("final-fix-codex"[\s\S]*\.step\("final-review-pass-gate"[\s\S]*\.step\("final-hard-validation"
forbidPhrases:
- TypeError
- ReferenceError
- needs_clarification
maxToolCalls: 1

### Must
- Include the mandatory fresh-eyes review/fix loop even though the workflow is small.
- Run the loop in this order: Claude review, Claude fix, Claude final review, Claude final fix, then Codex review, Codex fix, Codex final review, Codex final fix.
- Require review output to use a structured verdict such as `FINDINGS`, `NO_ISSUES_FOUND`, or `BLOCKED`.
- Require fix steps to add or update tests, fixtures, assertions, or deterministic proof for testable findings.
- Put final deterministic acceptance after the Codex final fix.

### Must Not
- Treat the first passing test run as a substitute for fresh-eyes review.
- Run Claude and Codex reviews in parallel before fixing.
- Collapse all findings into one generic fix step with no final re-review.
- Commit, open a PR, or hand off before the Codex loop finishes.

## workflow-authoring.fresh-eyes-loop-medium-source-and-test
Executor: ricky-cli
Kind: regression
Tags: workflow-authoring, review, generation, fresh-eyes
Human Review: false

### Message
Generate a Ricky workflow that changes one source file and one test file for a CLI parsing bug, with scoped diff evidence and a targeted Vitest command.

### Mock
cwd: temp
specFileContent: Generate a Ricky workflow that changes one source file and one test file for a CLI parsing bug.\n\n## Target Files\n\n- src/surfaces/cli/flows/power-user-parser.ts\n- src/surfaces/cli/flows/power-user-parser.test.ts\n\n## Acceptance\n\nRun `npx vitest run src/surfaces/cli/flows/power-user-parser.test.ts`.
argv: --mode local --spec-file {{specFile}} --no-run --json --no-workforce-persona
includeGeneratedArtifacts: true

### Deterministic Checks
ok: true
contentIncludes:
- stage": "generate
- status": "ok
- src/surfaces/cli/flows/power-user-parser.ts
- src/surfaces/cli/flows/power-user-parser.test.ts
- npx vitest run src/surfaces/cli/flows/power-user-parser.test.ts
- git diff --name-only
- git ls-files --others --exclude-standard
- review-claude.md
- final-review-codex.md
- codex-final-fix.md
- dependsOn: ["final-fix-codex"]
contentMatches:
- \.step\("review-claude"[\s\S]*\.step\("fix-loop"[\s\S]*\.step\("final-review-claude"[\s\S]*\.step\("final-fix-claude"[\s\S]*\.step\("review-codex"[\s\S]*\.step\("fix-loop-codex"[\s\S]*\.step\("final-review-codex"[\s\S]*\.step\("final-fix-codex"[\s\S]*\.step\("final-review-pass-gate"[\s\S]*\.step\("final-hard-validation"
forbidPhrases:
- TypeError
- ReferenceError
- needs_clarification
maxToolCalls: 1

### Must
- Preserve the Claude-then-Codex review/fix/final-review/final-fix order before final acceptance.
- Keep deterministic file gates and scoped `git diff --name-only` / untracked-file checks limited to the declared source and test targets.
- Feed review findings into fix steps and require fixers to harden tests when findings are testable.
- Write review, fix, final-review, final-fix, validation, and signoff artifacts under `.workflow-artifacts/`.

### Must Not
- Use broad repo-wide change detection as the only proof.
- Allow a single reviewer to rubber-stamp its own work without a distinct fresh-eyes pass.
- Skip the Codex final review/fix loop because Claude already reviewed.
- Move final hard validation before the Codex final fix.

## workflow-authoring.fresh-eyes-loop-complex-multitrack
Executor: ricky-cli
Kind: capability
Tags: workflow-authoring, review, multitrack, fresh-eyes
Human Review: false

### Message
Generate a serious multi-track master executor workflow for three independent product slices: runtime evidence, CLI status copy, and generation validation. Each track owns separate files and the final workflow may create a PR.

### Mock
cwd: temp
specFileContent: Generate a serious multi-track workflow for three independent product slices as smaller workflows run by a master executor: runtime evidence, CLI status copy, and generation validation. Each track owns separate files and the final workflow may create a PR.\n\nUse independent child workflows with deterministic validation, fresh-eyes review/fix loops, and GitHub primitive PR creation when shipping is in scope.
argv: --mode local --spec-file {{specFile}} --no-run --json --no-workforce-persona
includeGeneratedArtifacts: true

### Deterministic Checks
ok: true
contentIncludes:
- stage": "generate
- status": "ok
- RICKY_MASTER_EXECUTOR_WORKFLOW
- Master plan:
- RICKY_CHILD_WORKFLOW_COMPLETE
- review-claude
- final-fix-codex
- RICKY_CHILD_FRESH_EYES_LOOP_READY
- BLOCKED_NO_COMMIT
contentMatches:
- review-claude[\s\S]*fix-loop[\s\S]*final-review-claude[\s\S]*final-fix-claude[\s\S]*review-codex[\s\S]*fix-loop-codex[\s\S]*final-review-codex[\s\S]*final-fix-codex[\s\S]*final-review-pass-gate[\s\S]*final-hard-validation
forbidPhrases:
- TypeError
- ReferenceError
- needs_clarification
maxToolCalls: 1

### Must
- Use a coordination shape that fits independent tracks while preserving deterministic gates after every editing step.
- Ensure each implementation track or child workflow has the mandatory Claude-then-Codex fresh-eyes review/fix loop before track signoff.
- Run final deterministic acceptance only after all Codex final fixes and post-fix reviews have completed.
- Use `BLOCKED_NO_COMMIT` with evidence when a finding cannot be fixed, and skip commit or PR creation in that state.
- Use the GitHub primitive for PR creation when shipping is in scope.

### Must Not
- Put one global review at the end and call that sufficient for all tracks.
- Serialize independent tracks without a stated dependency reason.
- Let PR creation, commit, or handoff race ahead of unresolved review findings.
- Present tests, typecheck, or dry-run alone as the complete proof bar.

## workflow-authoring.no-silent-mode-fallback
Executor: manual
Kind: regression
Tags: workflow-authoring, local, cloud
Human Review: true

### Message
Create a workflow for a user who asked to run in Cloud, but Cloud auth is missing.

### Deterministic Checks
maxToolCalls: 0

### Must
- Detect and report the missing Cloud readiness or auth condition before any expensive generation or run step.
- Ask for an explicit user decision before switching to local/BYOH execution.
- Preserve the requested execution mode in the workflow context and user-facing summary.

### Must Not
- Silently fall back from Cloud to local.
- Claim a provider, account, credential, or integration is connected without a deterministic check.
- Hide mode changes inside generic "auto" wording.

## workflow-authoring.agent-assistant-boundary
Executor: manual
Kind: capability
Tags: workflow-authoring, agent-assistant, boundary
Human Review: true

### Message
Update Ricky to reuse a new Agent Assistant primitive while preserving Ricky-owned local execution behavior.

### Deterministic Checks
maxToolCalls: 0

### Must
- Reuse the shared Agent Assistant package for neutral assistant/runtime mechanics where appropriate.
- State the Ricky-owned behavior that must remain local, including workflow generation, LocalResponse, blocker taxonomy, recovery wording, and evidence semantics.
- Add proof that the shared primitive is exercised in a real Ricky path, not only imported or documented.

### Must Not
- Move product-specific Ricky execution contracts into Agent Assistant without an explicit proof boundary.
- Overclaim broad Agent Assistant adoption from a narrow adapter change.
- Replace Ricky's local blocker and recovery contract with generic assistant output.

## workflow-authoring.evidence-trail
Executor: manual
Kind: capability
Tags: workflow-authoring, evidence
Human Review: true

### Message
Design a workflow that watches a long-running workflow, diagnoses a failure, attempts a safe repair, and reports the outcome.

### Deterministic Checks
maxToolCalls: 0

### Must
- Preserve an evidence trail that names commands, artifacts, failed steps, log locations, assertions, and side effects.
- Distinguish successful repair, actionable blocker, unsupported condition, and unrecoverable error.
- Include resumability guidance such as failed step, previous run id, or exact rerun command when available.

### Must Not
- Claim the workflow succeeded when a blocker or missing dependency stopped execution.
- Drop log paths or side-effect summaries from the final outcome.
- Retry destructive or credentialed actions without explicit authorization.

## workflow-authoring.wave-placement-and-naming
Executor: manual
Kind: regression
Tags: workflow-authoring, standards, structure
Human Review: true

### Message
Author a non-trivial Ricky workflow for a new product milestone.

### Deterministic Checks
maxToolCalls: 0

### Must
- Place the workflow in the correct `workflows/wave<N>-<slug>/` folder.
- Use a monotonically increasing numeric prefix and an outcome-based slug.
- Use a dedicated `wf-ricky-*` channel rather than `general`.

### Must Not
- Put a significant wave workflow at the top level without an explicit shared/meta reason.
- Use vague names like `workflow-improvements.ts`.
- Treat wave folders as arbitrary batches instead of product/runtime milestones.

## workflow-authoring.runtime-wrapper-shape
Executor: manual
Kind: regression
Tags: workflow-authoring, runtime-shape
Human Review: true

### Message
Write a serious long-running Ricky workflow with multiple agent steps.

### Deterministic Checks
maxToolCalls: 0

### Must
- Import workflow APIs from `@agent-relay/sdk/workflows`.
- Wrap execution in `async function main()` and call `main().catch(...)` with explicit error reporting and nonzero exit.
- End workflow execution with `.run({ cwd: process.cwd() })`.
- Set `.channel()`, `.pattern()`, `.maxConcurrency()`, `.timeout()`, and `.onError()` explicitly.

### Must Not
- Rely on implicit runtime defaults for a serious workflow.
- Omit explicit error handling around `main()`.
- Use `general` as a fallback channel.

## workflow-authoring.env-loading-before-run
Executor: manual
Kind: regression
Tags: workflow-authoring, environment
Human Review: true

### Message
Create a Ricky workflow that requires `OPENROUTER_API_KEY` and `GITHUB_TOKEN`.

### Deterministic Checks
maxToolCalls: 0

### Must
- Load `.env.local` and `.env` before `.run(...)` without overwriting exported values.
- Fail fast with `MISSING_ENV_VAR: <NAME>` before expensive agent steps.
- State required environment variables in the workflow contract.

### Must Not
- Discover missing credentials only after long-running agent work.
- Overwrite environment values already exported by the operator.
- Hide credential requirements in agent prose only.

## workflow-authoring.github-pr-primitive
Executor: manual
Kind: regression
Tags: workflow-authoring, github, pr
Human Review: true

### Message
Author a workflow where creating a GitHub PR is in scope.

### Deterministic Checks
maxToolCalls: 0

### Must
- Use `@agent-relay/github-primitive` for PR creation.
- Use `createGitHubStep` with `action: 'createPR'` for declarative workflow steps, or `GitHubClient.create({ runtime: 'auto' })` with `client.createPR(...)` for imperative use.
- Document the commit and PR boundary in the workflow contract.

### Must Not
- Shell out to `gh pr create` from an agent step.
- Create or push PRs when the workflow explicitly says PR creation is out of scope.
- Hide the expected branch naming pattern.

## workflow-authoring.generated-workflow-template-read
Executor: manual
Kind: regression
Tags: workflow-authoring, generation
Human Review: true

### Message
Generate several Ricky workflows from a meta-workflow.

### Deterministic Checks
maxToolCalls: 0

### Must
- Read `docs/workflows/WORKFLOW_STANDARDS.md`, `workflows/shared/WORKFLOW_AUTHORING_RULES.md`, relevant specs, and `workflows/meta/spec/generated-workflow-template.md` at runtime.
- Materialize audit artifacts under `.workflow-artifacts/<meta-slug>/`.
- Dry-run or structurally validate generated workflows before signoff.

### Must Not
- Rely only on ambient agent context for workflow standards.
- Claim generated workflows are ready before dry-run or structural sanity checks.
- Hand-tune generated workflows when the template/spec/rules should be fixed upstream.
