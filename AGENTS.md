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

## Mandatory Conventions

- **Wave placement:** Place each workflow in the correct `workflows/wave<N>-<slug>/` folder. Top-level workflow files are reserved for explicitly shared or meta assets.
- **Numeric prefix:** Use monotonically increasing numeric prefixes (`01-`, `02-`, ...) within each wave folder.
- **Dedicated channel:** Every workflow must use a `wf-ricky-*` channel. Never use `general`.
- **Deterministic gates:** After any agent step that edits files, add a deterministic verification gate such as `file_exists`, `exit_code`, grep checks, dry-run checks, or scoped `git diff` change detection.
- **Review stage:** Every significant workflow must include review by an agent distinct from the writer when possible. Review artifacts for significant workflows must be written under `.workflow-artifacts/`.
- **80-to-100 validation:** Serious implementation workflows must use a soft-gate, fix, hard-gate loop. Passing compile or typecheck alone is not enough.
- **Commit boundaries:** Do not run `git commit` or `git push` from agent steps unless the workflow explicitly owns that boundary and documents the expected files.
- **Env loading:** Load `.env.local` and `.env` before `.run(...)` without overwriting exported values. Fail fast with `MISSING_ENV_VAR: <NAME>` before expensive agent steps.

## Wave Structure

Use wave folders to express staged delivery:

- `wave0-foundation` for repo scaffolding, standards, shared models, and first specs.
- `wave1-runtime` for execution substrate and local runner coordination.
- `wave2-product` for authoring, repair, debug, and orchestration specialists.
- `wave3-cloud-api` for hosted endpoints and coordination APIs.
- `wave4-local-byoh` for local invocation and local runtime integration.
- `wave5-scale-and-ops` for failure analysis, analytics, and mass-generation programs.

Later wave folders keep the same rule: a wave must represent a meaningful product or runtime milestone, not arbitrary grouping.

## Source Of Truth

When sources conflict, use this order unless a lower source would violate a higher-level safety or runtime rule:

1. `docs/workflows/WORKFLOW_STANDARDS.md`
2. `AGENTS.md` and Claude rules
3. Workflow-specific spec or program doc
4. Shared workflow-writing skills and `workflows/shared/WORKFLOW_AUTHORING_RULES.md`
5. Local code reality
