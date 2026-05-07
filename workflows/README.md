# Ricky Workflows

Ricky treats workflows as a first-class execution layer for building the product.

This directory is organized around three ideas:
- **waves** for staged delivery
- **shared rules** for consistent authoring
- **meta-workflows** for generating reliable workflow batches in bulk

## Directory shape

```text
workflows/
  README.md
  shared/
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
  wave6-proof/
  wave7-analytics-proof/
  wave7-cli-proof/
  wave7-local-proof/
  wave7-recovery/
  wave7-runtime-proof/
  wave8-github-issues/
  wave9-agent-assistant/
  wave10-agent-assistant-adoption/
  wave11-flat-layout-collapse/
  wave12-simplified-workflow-cli/
  demo-persona-repair/
  generated/
```

## Principles

- Every workflow must use a dedicated `wf-ricky-*` channel. Never use `general`.
- Every non-trivial workflow must state its context inputs, deliverables, file targets, non-goals, verification commands, review expectations, branch naming pattern, and commit/PR boundary.
- Every workflow must have deterministic verification gates after agent edits.
- Generated workflows must pass `agent-relay run --dry-run` before sign-off.
- For large programs, prefer meta-workflows over hand-writing dozens of inconsistent files.
- Use wave folders to express staged system delivery, not arbitrary grouping.
- Review artifacts for significant workflows must be written to disk under `.workflow-artifacts/`.

For the full policy, see `docs/workflows/WORKFLOW_STANDARDS.md`.

Before authoring or reviewing workflows, read `docs/workflows/WORKFLOW_STANDARDS.md`, `workflows/shared/WORKFLOW_AUTHORING_RULES.md`, and the workflow-specific spec or program doc. For generated workflow work, also read `workflows/meta/spec/generated-workflow-template.md`.

## Wave folders

Wave folders use `workflows/wave<N>-<slug>/` and represent staged product or runtime milestones:

- `wave0-foundation` covers repo scaffolding, standards, shared models, and first specs.
- `wave1-runtime` covers execution substrate and local runner coordination.
- `wave2-product` covers authoring, repair, debug, and orchestration specialists.
- `wave3-cloud-api` covers hosted endpoints and coordination APIs.
- `wave4-local-byoh` covers local invocation and local runtime integration.
- `wave5-scale-and-ops` covers failure analysis, analytics, and mass-generation programs.

Later waves keep the same convention: the folder name must describe the milestone, not the implementation team.

## Workflow naming

Workflow files use a numeric prefix plus an outcome-based slug:

```text
01-repo-standards.ts
02-shared-models-and-config.ts
10-local-run-coordinator.ts
```

Rules:
- numeric prefixes increase monotonically within the wave folder
- slugs describe the deliverable
- top-level workflow files are reserved for shared or meta assets, not ordinary wave work
- shared helpers stay under `workflows/shared/`
- generated specs and templates stay under `workflows/meta/spec/`

## Channel naming

Workflow channels use:

```text
wf-ricky-<wave>-<short-slug>
```

Examples:
- `wf-ricky-wave0-standards`
- `wf-ricky-wave3-generate-run-api`
- `wf-ricky-meta-mass-generation`

## Runtime shape

Serious workflows use the runtime shape defined in `AGENTS.md`: import from `@agent-relay/sdk/workflows`, wrap execution in `async function main()`, end with `main().catch(...)`, and run with `.run({ cwd: process.cwd() })`.

Set runtime configuration explicitly instead of relying on defaults:

- `.channel("wf-ricky-...")`
- `.pattern(...)`
- `.maxConcurrency(...)`
- `.timeout(...)`
- `.onError(...)` for long-running or multi-agent workflows

## Swarm patterns

Choose the workflow pattern from the work shape:

| Work shape | Preferred pattern |
| --- | --- |
| Spec, program, or meta planning | `supervisor` or `dag` |
| Many independent artifacts | `dag` |
| Interactive lead plus implementers | `dag` or `supervisor` |
| Validation, fix, and rerun loops | `dag` |
| Simple linear repo tightening | `supervisor` or `pipeline` |

Use named roles such as `lead-claude`, `author-codex`, `author-claude`, `impl-primary-codex`, `impl-tests-codex`, `reviewer-claude`, `reviewer-codex`, and `validator-claude`.

## Source of truth

When authoring workflows, read in this order:
1. `docs/workflows/WORKFLOW_STANDARDS.md`
2. repo-level `AGENTS.md` and Claude rules
3. workflow-specific specs in `workflows/meta/spec/` or other local docs
4. `workflows/shared/WORKFLOW_AUTHORING_RULES.md`

## Review and validation

Significant workflows must include:

- a planning step before implementation
- a review step after implementation, using `writer=codex` with `reviewer=claude`, `writer=claude` with `reviewer=codex`, or both reviewers for critical workflows when possible
- materialized review output under `.workflow-artifacts/`
- a soft validation gate that captures failures without stopping the fix loop
- a fix step that reads the captured validation output
- a final hard validation gate with `failOnError: true`
- a scoped change-detection gate for expected file targets
- a post-fix re-review on the fixed state, not reused pre-fix review artifacts
- a final signoff artifact under `.workflow-artifacts/` for serious workflows

Meta-workflows should write artifacts under `.workflow-artifacts/<meta-slug>/`, including `plan.md`, `<workflow-id>-review.md`, `<workflow-id>-dryrun.txt`, and `signoff.md`.

## Commit and PR boundaries

Every workflow must state the expected branch naming pattern, file targets, verification commands, and whether commit or PR creation is in scope. Agent steps must not run `git commit` or `git push` unless the workflow explicitly owns that boundary and documents the exact files expected in the change.

For convention-only updates, the normal file boundary is `AGENTS.md`, symlinked `CLAUDE.md`, `workflows/README.md`, and `workflows/shared/WORKFLOW_AUTHORING_RULES.md`, plus optional preserved review artifacts under `.workflow-artifacts/`.

Convention-only workflow commits should stay inside that boundary unless the workflow contract explicitly expands scope. `CLAUDE.md` should remain a symlink to `AGENTS.md`, so Claude-facing behavior is verified through the symlink rather than forked into separate instructions.

## Reliability traps

Avoid these recurring failure modes:

1. No wave or program structure.
2. No standards inputs read at runtime.
3. No deterministic gates after edits.
4. No review artifacts on disk.
5. No dry-run validation for generated workflows.
6. Overly broad agent tasks.
7. Blind swarm pattern choice.
8. No honest blocker reporting.

## Current batch plan

The active workflow batch plan is at `.workflow-artifacts/ricky-meta/application-wave-plan.md`. It covers 16 workflows across waves 0-5 and should be treated as the current operator reference for generated implementation batches. Wave-specific files still own their local contracts, file targets, non-goals, review expectations, and deterministic gates.

## Current GitHub Issue Workflows

`wave8-github-issues/` contains issue-focused workflows for the current open GitHub backlog:
- `01-fix-cli-artifact-path-and-caller-root.ts` covers issues #1 and #2.
- `02-prove-external-repo-cli-generation.ts` covers issue #6.
- `03-close-local-execution-outcome-loop.ts` covers issue #3.
- `04-tighten-onboarding-readiness-copy-and-checklist.ts` covers issues #4 and #7.
- `05-prove-skill-embedding-boundary.ts` covers issue #5.
- `06-close-local-run-product-loop.ts` closes the local run product loop.

`wave10-agent-assistant-adoption/` contains the issue #14 adoption closeout program:
- `00-execute-agent-assistant-adoption-program.ts` runs the full program. By default it uses `WAVE10_EXECUTION_MODE=parallel`, running doc closure and adapter implementation concurrently before live proof and handoff closure. Set `WAVE10_EXECUTION_MODE=sequential` for strict 01 -> 02 -> 03 -> 04 ordering.
- `01-verify-and-close-wave9-docs.ts` verifies and closes issues #9, #10, and #12.
- `02-adopt-request-turn-context-adapter.ts` implements issue #11.
- `03-prove-live-product-path.ts` proves issue #13 and closes #11/#13.
- `04-close-agent-assistant-handoff-issue.ts` closes issue #14 after all signoffs are present.

`wave11-flat-layout-collapse/` collapses the npm-workspaces multi-package layout into a single sage-style `src/` tree:
- `01-collapse-packages-into-src.ts` is a TDD-driven migration: a flat-layout proof test is authored first and runs RED, the workflow then moves `packages/{shared,runtime,product,cloud,local,cli}` into `src/{shared,runtime,product,cloud,local,surfaces/cli}`, rewrites `@ricky/*` aliases to relative paths via a recorded codemod, consolidates package.json/tsconfig.json/vitest.config.ts, deletes the old `test/package-proof/`, and drives typecheck + full test suite + the new flat-layout proof to GREEN before sign-off. Layer boundaries are enforced by folder convention only — no path aliases.
