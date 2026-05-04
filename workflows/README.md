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

- Every serious workflow gets a dedicated `wf-ricky-*` channel.
- Every workflow should have deterministic verification gates.
- Generated workflows must be dry-run validated before sign-off.
- For large programs, prefer meta-workflows over hand-writing dozens of inconsistent files.
- Use wave folders to express staged system delivery, not arbitrary grouping.

## Source of truth

When authoring workflows, read in this order:
1. `docs/workflows/WORKFLOW_STANDARDS.md`
2. `workflows/shared/WORKFLOW_AUTHORING_RULES.md`
3. workflow-specific specs in `workflows/meta/spec/` or other local docs
4. repo-level `AGENTS.md` and Claude rules

## Next expected artifacts

The first major Ricky workflow initiative is a meta-workflow that generates a large wave-structured backlog of reliable implementation workflows to serve as the execution layer for building the application.

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
