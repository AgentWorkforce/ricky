# Ricky Workflow Standards and Convention Enforcement

## Purpose

This document defines how workflows in the Ricky repo should be structured, reviewed, generated, and enforced.

It is intentionally opinionated.

Ricky is a workflow product. That means the repo should treat workflows as first-class execution assets, not loose task scripts. The standards here are meant to make workflows:
- easier to navigate
- easier to generate consistently
- easier to review
- safer to rerun
- more reliable in real end-to-end execution

These standards are derived from the strongest patterns currently visible in:
- `relay-sdk` / Relay-first AGENTS and Claude rules
- `nightcto` wave/phase workflow structure and explicit workflow authoring rules
- `agent-assistant` spec-program, tightening, and standards-oriented workflow patterns

---

## 1. Source-of-truth hierarchy

When writing or reviewing a Ricky workflow, follow this hierarchy:

1. **This standards doc**
   - repo-local workflow shape, naming, and enforcement rules
2. **Repo-level `AGENTS.md` and Claude rules**
   - mandatory behavioral and convention-loading rules for agents working in the repo
3. **Workflow-specific spec or program doc**
   - the contract for what the workflow is meant to produce
4. **Shared workflow-writing skills**
   - especially workflow authoring, swarm-pattern selection, and 80→100 validation
5. **Local code reality**
   - implementation truth, file paths, existing package boundaries, current repo layout

If these sources conflict, the more local and more specific source wins, unless it violates a higher-level safety or runtime rule.

---

## 2. Workflow philosophy

Ricky workflows must be:
- product-specific
- explicit about inputs and outputs
- explicit about review gates
- explicit about verification
- explicit about repo boundaries
- realistic about how agents actually succeed and fail

A Ricky workflow is not done because an agent said “done”.
A Ricky workflow is done when:
- the expected files exist on disk
- the expected validations ran
- failures are either fixed or documented honestly
- the resulting output is reviewable and usable by the next workflow or operator

---

## 3. Repo structure for workflows

Ricky workflows should be organized in a way that makes the delivery program legible.

### 3.1 Preferred top-level layout

```text
workflows/
  README.md
  shared/
    models.ts
    WORKFLOW_AUTHORING_RULES.md
  meta/
    README.md
    spec/
  wave0-foundation/
  wave1-runtime/
  wave2-product/
  wave3-cloud-api/
  wave4-local-byoh/
  wave5-scale-and-ops/
```

### 3.2 Why waves

Ricky should use **waves** because NightCTO’s wave/phase structure makes long execution programs legible and easier to expand safely.

Use waves when the repo is building toward a larger system in staged layers.

A wave should represent a meaningful product/runtime milestone, not just an arbitrary batch of files.

Examples:
- `wave0-foundation` = repo scaffolding, standards, shared models, first specs
- `wave1-runtime` = execution substrate, local runner coordination, workflow evidence seams
- `wave2-product` = authoring/repair/debug specialists and orchestration
- `wave3-cloud-api` = hosted endpoint and coordination APIs
- `wave4-local-byoh` = local invocation and local tool/runtime integration
- `wave5-scale-and-ops` = proactive failure analysis, analytics, mass-generation programs

### 3.3 Prefer domain subfolders within a wave

Inside a wave, group by domain when helpful:

```text
workflows/wave3-cloud-api/
  api/
  auth/
  orchestration/
```

Do not create deep nesting unless it improves scanability.

---

## 4. Workflow naming conventions

### 4.1 File naming

Use a stable numeric prefix plus a concise slug:

```text
01-repo-standards.ts
02-shared-models-and-config.ts
10-local-run-coordinator.ts
11-workflow-evidence-model.ts
```

Rules:
- numeric prefixes should increase monotonically within the folder/program
- slugs should describe the deliverable, not the vibe
- prefer nouns and concrete outcomes over vague verbs

Good:
- `12-cloud-api-generate-and-run.ts`
- `24-workflow-failure-classification.ts`

Bad:
- `stuff.ts`
- `workflow-improvements.ts`
- `better-meta.ts`

### 4.2 Channel naming

Every workflow must use a dedicated channel.
Never use `general`.

Pattern:

```text
wf-ricky-<wave>-<short-slug>
```

Examples:
- `wf-ricky-wave0-standards`
- `wf-ricky-wave3-generate-run-api`
- `wf-ricky-meta-mass-generation`

---

## 5. Mandatory workflow sections and shape

Every non-trivial Ricky workflow must be explicit about:
- context inputs
- deliverables
- file targets
- non-goals
- verification
- review
- commit boundary

This can be expressed either:
- in the workflow description/task bodies directly
- or by referencing a nearby spec doc the workflow reads deterministically before execution

### 5.1 Required runtime shape

Unless there is a strong reason otherwise, Ricky workflows should:
- wrap in `async function main()`
- end with a `main().catch(...)` block
- import workflow runtime from `@agent-relay/sdk/workflows`
- end with `.run({ cwd: process.cwd() })`

### 5.2 Required configuration defaults

Default to:
- explicit `.channel(...)`
- explicit `.pattern(...)`
- explicit `.maxConcurrency(...)`
- explicit `.timeout(...)`
- explicit `.onError(...)` when the workflow is long-running or multi-agent

Do not rely on implicit defaults for serious workflows.

---

## 6. Swarm and team-shape rules

### 6.1 Pattern choice must be deliberate

Do not default blindly to one pattern.

Recommended defaults:
- **spec/program/meta planning**: `supervisor` or `dag`
- **artifact generation across many independent files**: `dag`
- **interactive lead + implementers**: `dag` or `supervisor`, depending on whether shared-phase gating matters more than dynamic coordination
- **validation/fix/rerun loops**: `dag`
- **simple linear repo-tightening**: `supervisor` or `pipeline`

If the workflow is a meta-workflow generating many bounded workflows, prefer `dag` with explicit per-artifact gates.

### 6.2 Team shape expectations

Ricky workflows should prefer named roles over generic worker numbering.

Examples:
- `lead-claude`
- `writer-codex`
- `reviewer-claude`
- `reviewer-codex`
- `validator-claude`

For interactive implementation workflows, the NightCTO-style split is usually the right default:
- lead
- implementer primary
- implementer tests
- reviewer claude
- reviewer codex
- validator

For standards/spec workflows, a lighter shape is fine:
- lead
- author
- reviewer

---

## 7. Deterministic gates are mandatory

After meaningful agent work, add deterministic gates.

Examples:
- `file_exists`
- `exit_code`
- deterministic shell checks
- grep-based structural checks
- build/test/dry-run commands

Do not trust interactive agent stdout as the main proof of success.

### 7.1 Required gate types

Prefer these verification types:
- `exit_code`
- `file_exists`
- `output_contains` only when the sentinel is deterministic and not echoed by the task itself
- `custom` only when the simpler forms cannot express the check

### 7.2 Git-diff enforcement

If an agent is expected to edit files, add a deterministic gate confirming the repo actually changed.

Typical pattern:

```bash
git diff --quiet && echo "NO_CHANGES" && exit 1 || echo "CHANGES_PRESENT"
```

This is especially important for Claude/Codex steps that may exit successfully without writing.

---

## 8. Required review model

Every significant Ricky workflow should include review as a first-class stage.

### 8.1 Minimum review expectations

At minimum:
1. planning step before implementation
2. implementation step(s)
3. review step after implementation
4. validation/fix step after tests or dry-run
5. final deterministic gate

### 8.2 Reviewer independence

When possible, use a reviewer that is distinct from the writer.

Preferred review shapes:
- writer = codex, reviewer = claude
- writer = claude, reviewer = codex
- for critical workflows, both

### 8.3 Review outputs should be materialized

For larger workflows, reviewers should write review artifacts to disk, not just print to stdout.

Examples:
- `.workflow-artifacts/<slug>/review.md`
- `.workflow-artifacts/<slug>/signoff.md`

This is especially important for meta-workflows.

---

## 9. 80→100 validation rule

Ricky should inherit the 80→100 bar.

That means:
- “it compiles” is not enough
- “tests passed once” is often not enough
- workflows should prove the user-visible slice actually works

### 9.1 Standard three-step loop

Use the standard pattern:
1. initial test/dry-run with `failOnError: false`
2. validator fixes based on the captured output
3. final hard gate with `failOnError: true`

Use this for:
- tests
- build/typecheck
- dry-run validation
- local runtime smoke proof when appropriate

### 9.2 Meta-workflow expectation

If a workflow generates other workflows, the generated workflows must at least pass:
- file materialization gates
- structural sanity checks
- `agent-relay run --dry-run`

Prefer not to claim generated workflows are ready until those checks pass.

---

## 10. AGENTS.md and Claude-rules enforcement

Ricky should make workflow conventions unavoidable for agents.

### 10.1 Repo-level convention files

The repo should include:
- `AGENTS.md`
- `CLAUDE.md` or equivalent Claude-rules file if needed

These should instruct agents to:
- read the workflow standards before authoring workflows
- preserve wave/folder/naming conventions
- use dedicated workflow channels
- materialize artifacts and reviews on disk
- use deterministic gates after agent edits
- follow 80→100 validation for serious workflows

### 10.2 Workflow-level explicit context reads

Do not rely only on repo ambient instructions.
For high-value workflows, include deterministic reads of the standards/spec inputs at runtime.

Examples:
- `cat workflows/shared/WORKFLOW_AUTHORING_RULES.md`
- `cat docs/workflows/WORKFLOW_STANDARDS.md`
- `cat workflows/meta/spec/generated-workflow-template.md`

This mirrors the strongest NightCTO meta-workflow pattern.

---

## 11. Shared authoring rules file

In addition to this standards doc, Ricky should keep a compressed rules file at:

```text
workflows/shared/WORKFLOW_AUTHORING_RULES.md
```

Purpose:
- a short must-do / must-not file that generator agents can ingest cheaply
- optimized for workflow-writing tasks
- easier to include in deterministic read steps than a long standards doc

Think of this standards doc as the policy manual, and `WORKFLOW_AUTHORING_RULES.md` as the compact executable cheat sheet.

---

## 12. Meta-workflow standards

Ricky will likely depend heavily on meta-workflows that generate many narrower workflows.

Those meta-workflows must:
- read a per-workflow contract/spec file
- read a generated-workflow template file
- read the compact authoring rules
- generate each workflow to disk
- run structural sanity checks
- run reviewer feedback loops
- run `--dry-run` validation
- only sign off once all generated artifacts pass their gates

### 12.1 Meta-workflow artifact layout

Prefer a transient artifact directory like:

```text
.workflow-artifacts/<meta-slug>/
```

Examples of generated artifacts:
- `plan.md`
- `<workflow-id>-review.md`
- `<workflow-id>-dryrun.txt`
- `signoff.md`

Do not commit transient artifact output unless the workflow is explicitly designed to keep it.

### 12.2 Generated workflows should not be hand-tuned first

If a generated workflow is structurally wrong, fix the template/spec/rules source and regenerate.
Do not silently normalize hand-edited drift unless there is a good reason.

---

## 13. Commit and PR boundary rules

Workflows should be explicit about branch and commit boundaries.

At minimum they should state:
- expected branch naming pattern
- scope of the change
- whether commit is deterministic or manual
- whether PR creation is in or out of scope

Default rule:
- do not ask agents to run `git commit` or `git push`
- use deterministic steps for commits when the workflow truly owns the final change
- otherwise leave commit/push as operator actions

For Ricky meta-workflows that generate large workflow batches, prefer:
- generation + validation in the workflow
- commit as a final deterministic step only if the batch is intentionally owned by that workflow

---

## 14. Reliability traps to avoid

Avoid these recurring failure modes:

1. **No wave/program structure**
   - leads to an unreadable workflow directory and unclear sequencing
2. **No standards inputs at runtime**
   - generator agents drift from conventions
3. **No deterministic gates after edits**
   - agents claim success without writing files
4. **No review artifacts on disk**
   - meta workflows become hard to audit
5. **No dry-run validation for generated workflows**
   - invalid files accumulate silently
6. **Overly broad tasks**
   - a single step tries to edit too many files or own too much logic
7. **Blind pattern choice**
   - `dag` or `supervisor` used by habit rather than need
8. **No honest blocker reporting**
   - workflows hide environmental failures instead of surfacing them cleanly

---

## 15. Enforcement checklist

When authoring or reviewing a Ricky workflow, check all of these:

- [ ] Is it placed in the right wave/folder?
- [ ] Does the numeric prefix preserve program order?
- [ ] Does it use a dedicated `wf-ricky-*` channel?
- [ ] Is the swarm pattern chosen deliberately?
- [ ] Are inputs/spec files read deterministically?
- [ ] Are deliverables and non-goals explicit?
- [ ] Are file targets explicit?
- [ ] Are there deterministic gates after agent edits?
- [ ] Is there a real review stage?
- [ ] Is there an 80→100 validation loop where appropriate?
- [ ] If it generates workflows, does it also sanity-check and dry-run them?
- [ ] Are commit/push boundaries explicit?

If several of these are missing, the workflow is not ready.

---

## 16. Immediate repo follow-ups

To make these standards operational, Ricky should add next:
- `AGENTS.md` with explicit workflow-convention instructions
- `workflows/README.md`
- `workflows/shared/WORKFLOW_AUTHORING_RULES.md`
- `workflows/meta/README.md`
- a first meta-workflow that generates a reliable wave backlog rather than hand-writing every workflow individually

These files turn the standards from prose into execution scaffolding.

---

## 17. Decision

Ricky will use:
- wave-based workflow organization
- explicit repo-level convention loading through `AGENTS.md` and related rules
- deterministic post-edit gates
- review artifacts on disk
- 80→100 validation for serious workflows
- meta-workflow generation for large workflow programs

That is the default standard unless a specific workflow documents a bounded reason to deviate.
