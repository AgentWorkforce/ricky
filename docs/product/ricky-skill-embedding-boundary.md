# Ricky Skill Embedding Boundary

Ricky currently applies workflow-generation skills at generation time only. The generator selects applicable skills from its registry, records that their prerequisites are available, and renders their guidance into workflow structure, deterministic gates, and metadata. Generated workflow agents do not load skill files at runtime, retain skill state, or embody a skill beyond the concrete instructions and gates already rendered into the workflow artifact.

## Current Behavior

The current product boundary has three observable phases. First, selection happens before rendering when `packages/product/src/generation/skill-loader.ts` decides which registered skills apply to the normalized request. Second, loading records the skill descriptor path and prerequisite result. Third, rendering in `packages/product/src/generation/template-renderer.ts` turns selected skills into workflow-contract evidence, validation gates, and metadata files in the generated workflow.

For strict TypeScript or proof-oriented workflow generation, the expected loaded skills include `writing-agent-relay-workflows` and `relay-80-100-workflow`. The generated artifact records this in `loaded-skills.txt` and `skill-application-boundary.json`. That boundary file marks each evidence item as `generation_time_only` with `runtimeEmbodiment: false`.

## Observable Effects

`writing-agent-relay-workflows` affects the generated workflow contract by shaping the dedicated channel, explicit agents, step dependencies, review stages, and final signoff. `relay-80-100-workflow` affects validation by shaping soft validation, review/fix/final-review flow, final hard validation, git diff, and regression gates. These are generation-time effects because they are materialized into the workflow text and deterministic metadata before any workflow runner launches agents.

The generated workflow also includes a deterministic `skill-boundary-metadata-gate`. This gate checks that the generated boundary metadata exists, records `generation_time_only`, names the loaded skills, includes the `generation_selection`, `generation_loading`, and applicable `generation_rendering` stages, and records effects such as `workflow_contract` and `validation_gates`. The gate proves the artifact carries the skill boundary forward as metadata; it does not prove runtime agents load skills.

## Runtime Boundary

At runtime, agents receive the rendered workflow tasks, commands, and metadata paths. Product copy must describe this as "generated workflow instructions informed by selected skills" or "generation-time skill application." It must not say agents are skill-embedded, skill-powered at runtime, or embodying skills unless a separate runtime execution path loads skill files into the agent process and tests prove that behavior.

Current tests intentionally stop at the generation boundary. They prove selected skills affected generated contracts, gates, and metadata. They do not prove deeper runtime skill execution.

## Future Runtime Skill Execution

A richer future path could add runtime skill execution if the workflow runner explicitly passes skill bodies or skill-derived tools to agents during execution. That path needs its own contract and tests: runner input evidence, agent prompt or tool payload evidence, runtime logs showing receipt, and regression tests proving the behavior across local and cloud routes. Until that exists, Ricky's skill claims should remain scoped to generation-time selection, loading, and rendering.
