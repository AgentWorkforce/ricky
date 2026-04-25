# Ricky Meta-Workflows

Meta-workflows exist to generate reliable Ricky workflows in bulk.

Ricky is a workflow-heavy product. If the application is going to be built through a large execution layer of workflows, then the workflow program itself needs to be generated and governed systematically.

## Why meta-workflows

Meta-workflows help Ricky:
- produce large workflow batches consistently
- keep wave structure coherent
- enforce authoring rules automatically
- centralize generated workflow shape in one template
- validate generated workflows before a human reviews them

## Inputs

Ricky meta-workflows should usually read:
- `docs/workflows/WORKFLOW_STANDARDS.md`
- `workflows/shared/WORKFLOW_AUTHORING_RULES.md`
- `workflows/meta/spec/generated-workflow-template.md`
- `workflows/meta/spec/ricky-application-wave-program.md`
- `workflows/meta/spec/ricky-meta-workflow-design.md`

## Outputs

Typical outputs:
- generated workflow files under wave folders
- transient review and dry-run artifacts under `.workflow-artifacts/<meta-slug>/`
- final signoff artifact

## Rule

Do not hand-author a huge wave backlog if a meta-workflow can generate it more reliably.
