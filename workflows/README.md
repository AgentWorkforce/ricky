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
  wave8-github-issues/
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
