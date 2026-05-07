<!-- prpm:snippet:start @agent-workforce/trail-snippet@1.1.2 -->
# Trail

`CLAUDE.md` is a symlink to this `AGENTS.md`; keep shared agent instructions here.

Record your work as a trajectory for future agents and humans to follow.

## Usage

If `trail` is installed globally, run commands directly:
```bash
trail start "Task description"
```

If not globally installed, use npx to run from local installation:
```bash
npx trail start "Task description"
```

## When Starting Work

Start a trajectory when beginning a task:

```bash
trail start "Implement user authentication"
```

With external task reference:
```bash
trail start "Fix login bug" --task "ENG-123"
```

## Recording Decisions

Record key decisions as you work:

```bash
trail decision "Chose JWT over sessions" \
  --reasoning "Stateless scaling requirements"
```

For minor decisions, reasoning is optional:
```bash
trail decision "Used existing auth middleware"
```

**Record decisions when you:**
- Choose between alternatives
- Make architectural trade-offs
- Decide on an approach after investigation

## Recording Reflections

Periodically step back and synthesize progress:

```bash
trail reflect "Workers aligned on auth approach, API layer progressing well" \
  --confidence 0.8
```

With focal points and adjustments:
```bash
trail reflect "Frontend and backend duplicating validation logic" \
  --focal-points "duplication,ownership" \
  --adjustments "Reassigning validation to backend team" \
  --confidence 0.7
```

**Record reflections when you:**
- Have received several updates and need to synthesize the big picture
- Notice workers or tasks diverging from the plan
- Want to course-correct before continuing
- Are coordinating multiple agents and need to assess overall progress

Reflections differ from decisions: decisions record a specific choice,
reflections record a higher-level synthesis of what's happening and whether
the current approach is working.

## Completing Work

When done, complete with a retrospective:

```bash
trail complete --summary "Added JWT auth with refresh tokens" --confidence 0.85
```

After completing work, compact the finished trajectory or merged PR into a
durable summary. When the compacted summary is sufficient, discard the raw
source trajectories so `.trajectories/index.json` and list output stay focused:

```bash
trail compact --discard-sources
# or after a PR merge:
trail compact --pr 42 --discard-sources
```

`--discard-sources` removes the source trajectory JSON/Markdown/trace files and
updates the index. Use it after confirming the compacted artifact is the record
you want to keep.

**Confidence levels:**
- 0.9+ : High confidence, well-tested
- 0.7-0.9 : Good confidence, standard implementation
- 0.5-0.7 : Some uncertainty, edge cases possible
- <0.5 : Significant uncertainty, needs review

## Abandoning Work

If you need to stop without completing:

```bash
trail abandon --reason "Blocked by missing API credentials"
```

## Checking Status

View current trajectory:
```bash
trail status
```

## Listing and Viewing Trajectories

List all trajectories:
```bash
trail list
```

View a specific trajectory:
```bash
trail show <trajectory-id>
```

Export a trajectory (markdown, json, timeline, html):
```bash
trail export <trajectory-id> --format markdown
```

## Compacting Trajectories

After a PR merge, compact related trajectories into a single summary and prune
raw source trajectories when the summary should replace them:

```bash
trail compact --pr 42 --discard-sources
```

Compact by branch (finds trajectories with commits not in the specified base branch):
```bash
trail compact --branch main --discard-sources
```

Compact by specific commits:
```bash
trail compact --commits abc123,def456 --discard-sources
```

Compaction consolidates decisions and creates a grouped summary. Adding
`--discard-sources` makes the compacted artifact the durable record by removing
the raw trajectories and their index entries.

## Why Trail?

Your trajectory helps others understand:
- **What** you built (commits show this)
- **Why** you built it this way (trajectory shows this)
- **What alternatives** you considered
- **What challenges** you faced

Future agents can query past trajectories to learn from your decisions.
<!-- prpm:snippet:end @agent-workforce/trail-snippet@1.1.2 -->

# Ricky Workflow Conventions

Every agent working in this repo must follow these rules when authoring, reviewing, or modifying Ricky workflows.

## Before Writing Any Workflow

1. Read `docs/workflows/WORKFLOW_STANDARDS.md`.
2. Read `workflows/shared/WORKFLOW_AUTHORING_RULES.md`.
3. Read the workflow-specific spec or program doc when one exists, including files under `workflows/meta/spec/`.
4. For workflow generation tasks, also read `workflows/meta/spec/generated-workflow-template.md`.
5. For convention-update workflows, read the operator plan artifact when one is provided before editing the declared convention files.

## Mandatory Conventions

- **Workflow contract:** Every non-trivial workflow must state its context inputs, deliverables, file targets, non-goals, verification commands, review expectations, branch naming pattern, and commit/PR boundary.
- **Wave placement:** Place each workflow in the correct `workflows/wave<N>-<slug>/` folder. Top-level workflow files are reserved for explicitly shared or meta assets.
- **Numeric prefix and slug:** Use monotonically increasing numeric prefixes (`01-`, `02-`, ...) within each wave folder. Slugs must name the concrete deliverable or outcome, not a vague improvement theme.
- **Dedicated channel:** Every workflow must use a `wf-ricky-*` channel. Never use `general`.
- **Deterministic gates:** After any agent step that edits files, add a deterministic verification gate such as `file_exists`, `exit_code`, grep checks, dry-run checks, or scoped `git diff` change detection. Prefer gate types in this order: `exit_code`, `file_exists`, `output_contains` only for deterministic sentinels not echoed by the task, then `custom`.
- **Review stage:** Every significant workflow must include review by an agent distinct from the writer when possible. Prefer `writer=codex` with `reviewer=claude`, `writer=claude` with `reviewer=codex`, and both reviewers for critical workflows. Review artifacts for significant workflows must be written under `.workflow-artifacts/`.
- **80-to-100 validation:** Serious implementation workflows must use a soft-gate, fix, hard-gate loop. The fix loop must include a post-fix re-review on the fixed state before final signoff. Passing compile or typecheck alone is not enough.
- **Commit boundaries:** Do not run `git commit` or `git push` from agent steps unless the workflow explicitly owns that boundary and documents the expected files. Each workflow must state the expected branch naming pattern and whether PR creation is in or out of scope. Default branch names should follow `ricky/<wave-or-meta>-<workflow-slug>` unless a nearby spec declares a narrower pattern.
- **Reviewable wording:** Workflow requirements must be specific enough for grep checks, structural checks, dry-run output, review artifacts, or scoped diff review. Avoid broad prose that cannot be verified by deterministic gates or reviewer inspection.
- **Env loading:** Load `.env.local` and `.env` before `.run(...)` without overwriting exported values. Fail fast with `MISSING_ENV_VAR: <NAME>` before expensive agent steps.
- **Scoped change detection:** After implementation steps, verify the repo changed in the expected scope using `git diff --name-only` plus `git ls-files --others --exclude-standard`, scoped to declared file targets. Do not use repo-wide `git diff --quiet` when unrelated work may be present.
- **Signoff artifacts:** Serious implementation workflows must write a final signoff artifact under `.workflow-artifacts/`. Passing tests alone is not sufficient proof of completion.
- **Workflow-level context reads:** High-value workflows must include deterministic runtime reads of standards and specs instead of relying only on agent ambient context. Include `cat docs/workflows/WORKFLOW_STANDARDS.md`, `cat workflows/shared/WORKFLOW_AUTHORING_RULES.md`, the workflow-specific spec or program doc, and `cat workflows/meta/spec/generated-workflow-template.md` when generation is in scope.

## Repo Boundary For Convention Work

When the task is to update Ricky workflow standards, conventions, or authoring rules, keep the change inside the declared convention files unless the workflow contract explicitly expands scope. Do not edit package metadata, runtime configuration, product source, generated wave workflows, or product specs for a convention-only update.

For convention-only work, `CLAUDE.md` should remain a symlink to `AGENTS.md`. Update `AGENTS.md` as the shared source of truth and verify Claude-facing behavior through the symlink instead of forking separate Claude instructions.

`CLAUDE.md` must exist and mirror repo-level workflow behavior through that symlink. Do not replace it with a standalone file or add Claude-only workflow rules that conflict with `AGENTS.md`.

Convention-only workflows still need deterministic file-existence checks, grep or structural checks for the updated terms, symlink verification for `CLAUDE.md`, and scoped change detection limited to the declared convention files. The scoped change-detection gate must include both `git diff --name-only -- <declared-files>` and `git ls-files --others --exclude-standard -- <declared-files>`.

The convention-only gate must check each declared file target directly, verify required terms with deterministic grep or structural checks, verify `CLAUDE.md -> AGENTS.md` when Claude instructions are in scope, and fail if scoped change detection reports files outside the declared convention targets.

## Runtime Shape

Serious Ricky workflows must use the standard runtime wrapper:

- import workflow APIs from `@agent-relay/sdk/workflows`
- wrap execution in `async function main()`
- call `main().catch(...)` with explicit error reporting and nonzero exit
- end workflow execution with `.run({ cwd: process.cwd() })`

Do not rely on implicit runtime defaults for long-running or multi-agent workflows. State these configuration calls explicitly:

- `.channel("wf-ricky-...")`
- `.pattern(...)`
- `.maxConcurrency(...)`
- `.timeout(...)`
- `.onError(...)`

## Swarm Pattern and Team Shape

Choose the swarm pattern from the work shape:

| Work shape | Preferred pattern |
| --- | --- |
| Spec, program, or meta planning | `supervisor` or `dag` |
| Many independent artifacts | `dag` |
| Interactive lead plus implementers | `dag` or `supervisor` |
| Validation, fix, and rerun loops | `dag` |
| Simple linear repo tightening | `supervisor` or `pipeline` |

Use named roles instead of generic worker numbering. Preferred role names are:

- `lead-claude`
- `author-codex`
- `author-claude`
- `impl-primary-codex`
- `impl-tests-codex`
- `writer-codex`
- `reviewer-claude`
- `reviewer-codex`
- `validator-claude`

For implementation workflows, default to lead, `impl-primary-codex`, `impl-tests-codex`, `reviewer-claude`, `reviewer-codex`, and `validator-claude`. For standards and spec workflows, `lead-claude`, `author-codex` or `author-claude`, and a distinct reviewer are enough when the scope is narrow.

## Meta-Workflow Artifact Layout

Meta-workflows and significant workflow-generation runs must materialize audit artifacts under:

```text
.workflow-artifacts/<meta-slug>/
```

Expected artifacts include:

- `plan.md`
- `<workflow-id>-review.md`
- `<workflow-id>-dryrun.txt`
- `signoff.md`

Do not commit transient artifact output unless the workflow explicitly owns that boundary.

## Reliability Traps

Check for these traps before signing off a Ricky workflow:

1. No wave or program structure.
2. No standards inputs read at runtime.
3. No deterministic gates after edits.
4. No review artifacts on disk.
5. No dry-run validation for generated workflows.
6. Overly broad agent tasks.
7. Blind swarm pattern choice.
8. No honest blocker reporting.

## Wave Structure

Use wave folders to express staged delivery:

- `wave0-foundation` for repo scaffolding, standards, shared models, and first specs.
- `wave1-runtime` for execution substrate and local runner coordination.
- `wave2-product` for authoring, repair, debug, and orchestration specialists.
- `wave3-cloud-api` for hosted endpoints and coordination APIs.
- `wave4-local-byoh` for local invocation and local runtime integration.
- `wave5-scale-and-ops` for failure analysis, analytics, and mass-generation programs.

Later wave folders keep the same rule: a wave must represent a meaningful product or runtime milestone, not arbitrary grouping.

Waves beyond `wave5-scale-and-ops`, including `wave6-proof` through `wave12-simplified-workflow-cli`, exist in the repo and follow the same naming convention. Each later wave must also represent a meaningful product or runtime milestone.

## Source Of Truth

When sources conflict, use this order unless a lower source would violate a higher-level safety or runtime rule:

1. `docs/workflows/WORKFLOW_STANDARDS.md`
2. `AGENTS.md` and Claude rules
3. Workflow-specific spec or program doc
4. Shared workflow-writing skills and `workflows/shared/WORKFLOW_AUTHORING_RULES.md`
5. Local code reality
