# Ricky Meta-Workflow Design

## Objective

Design a meta-workflow that can generate a large batch of reliable Ricky workflows which then serve as the execution layer for building the application.

## Product need

Ricky is itself a workflow-centric product. If we want workflows to become the main execution layer for building the app, we need a generator that can produce:
- consistent workflow structure
- strong reviewability
- deterministic validation
- wave-aware program ordering
- scalable regeneration when the template changes

## Recommended meta-workflow shape

### Pattern
Default to `dag`.

Reason:
- per-workflow generation can fan out in parallel
- sanity checks and review gates can stay isolated per workflow
- final signoff can depend on all generated tracks

### Recommended team
- `meta-lead-claude`
- `meta-writer-codex`
- `meta-reviewer-claude`
- `meta-reviewer-codex`
- `meta-validator-claude`

## Inputs the meta-workflow should read

1. `docs/workflows/WORKFLOW_STANDARDS.md`
2. `workflows/shared/WORKFLOW_AUTHORING_RULES.md`
3. `workflows/meta/spec/generated-workflow-template.md`
4. `workflows/meta/spec/ricky-application-wave-program.md`
5. this design doc
6. selected existing Ricky repo docs/specs as needed

## Recommended phases

### Phase 0: Prepare artifact directories
Create:
- `.workflow-artifacts/ricky-meta/`
- wave directories if missing

### Phase 1: Read all planning/spec inputs
Deterministically read the standards, rules, template, and wave program.

### Phase 2: Produce a generation plan
The meta lead should write a plan artifact that:
- enumerates the workflows to generate
- maps each workflow to a wave
- explains why the batch size is bounded
- lists intended file paths

### Phase 3: Per-workflow generation fan-out
For each planned workflow:
1. generate the file
2. run structural sanity checks
3. review it
4. fix it if needed
5. run `agent-relay run --dry-run`
6. record the result

### Phase 4: Final signoff
The meta lead writes signoff only if:
- every generated file exists
- every review gate passed
- every dry-run passed
- the generated set matches the planned backlog

## Sanity checks each generated workflow should pass

At minimum verify:
- file exists
- contains workflow wrapper/imports
- contains explicit description
- contains explicit pattern
- contains dedicated `wf-ricky-*` channel
- contains at least one deterministic context read
- contains at least one deterministic verification gate
- contains a review step
- ends with `.run({ cwd: process.cwd() })`

## Output locations

Generated workflows should land in their target wave folders.
Transient review artifacts should land in:
- `.workflow-artifacts/ricky-meta/`

## First implementation target

The first real meta-workflow should generate the initial application wave backlog, not implementation code directly.

That means its output should be workflows, not product packages.

## Important risk controls

1. Do not generate too many workflows at once.
2. Do not skip dry-run validation.
3. Do not let reviewer verdicts exist only in stdout.
4. Do not let generated workflows drift from the shared template.
5. Do not let the meta-workflow become the only source of structure knowledge; keep the standards and template files human-readable and editable.

## Naming recommendation

The first meta-workflow file should likely be:
- `workflows/meta/build-application-workflows.ts`
