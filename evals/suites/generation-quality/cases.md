# Generation Quality Cases

These cases come from `SPEC.md`, `specs/workflow-generation-quality.md`,
`docs/product/ricky-skill-embedding-boundary.md`, and the CLI proof specs.

## generation-quality.skill-matcher-registry-backed
Executor: manual
Kind: capability
Tags: generation, skills
Human Review: true

### Message
Generate a workflow for a GitHub primitive change and explain which skills Ricky selected.

### Deterministic Checks
maxToolCalls: 0

### Must
- Select skills from the actual registry rather than a hardcoded static set.
- Record ranked skill matches with confidence and trigger evidence.
- Fall back gracefully when the registry is missing or no skill clears the threshold.

### Must Not
- Claim runtime agents embody skills when only generation-time guidance was applied.
- Fail generation solely because optional skill files are missing.
- Hide skill selection evidence from artifacts or JSON output.

## generation-quality.tool-selector-honors-spec-hints
Executor: manual
Kind: capability
Tags: generation, tools
Human Review: true

### Message
Generate a workflow where the spec says "use Claude to review and Codex to implement".

### Deterministic Checks
maxToolCalls: 0

### Must
- Assign per-step runner/model decisions from explicit spec hints where possible.
- Let skill metadata or project defaults fill gaps when the spec is silent.
- Write `tool-selection.json` or equivalent audit metadata.

### Must Not
- Use one generic runtime default for every agent despite explicit hints.
- Let skill defaults override explicit user/spec runner hints.
- Omit the reason each tool or model was chosen.

## generation-quality.refine-is-opt-in-and-bounded
Executor: manual
Kind: capability
Tags: generation, refine, llm
Human Review: true

### Message
Use `--refine` to sharpen a generated workflow's step task descriptions and acceptance gates.

### Deterministic Checks
maxToolCalls: 0

### Must
- Keep the deterministic unrefined path as the default.
- Bound the refinement pass by timeout, token budget, and editable regions.
- Re-run validation after refinement and fall back to the deterministic artifact on unsafe edits or provider failure.

### Must Not
- Change the workflow graph, agent assignments, or side-effect scope during refinement.
- Fail the whole generation if optional refinement times out.
- Hide warnings when the deterministic artifact is returned unchanged.

## generation-quality.behavior-grounded-gates
Executor: manual
Kind: regression
Tags: generation, validation
Human Review: true

### Message
Generate a workflow for the `ricky --version` spec.

### Deterministic Checks
maxToolCalls: 0

### Must
- Build gates from the stated acceptance behavior, such as checking `ricky --version` output.
- Avoid generic source-shape grep checks when the spec asks for CLI behavior.
- Keep generated validation meaningful for the current repo shape.

### Must Not
- Treat `grep -Eq 'export|function|class|workflow(' dist/ricky.js` as proof of version behavior.
- Claim the workflow is proven by source syntax alone.
- Ignore the package-json version resolution order in the spec.

## generation-quality.pattern-selection-deliberate
Executor: manual
Kind: regression
Tags: generation, pattern
Human Review: true

### Message
Generate a workflow for many independent artifacts with a validation/fix/rerun loop.

### Deterministic Checks
maxToolCalls: 0

### Must
- Choose `dag`, `supervisor`, or `pipeline` deliberately based on the work shape.
- Explain the pattern choice in artifact metadata or a rationale.
- Use `dag` for validation/fix/rerun loops when dependencies matter.

### Must Not
- Default blindly to `dag` for every workflow.
- Collapse independent artifact work into one vague agent task.
- Omit verification gates because the chosen pattern seems obvious.

## generation-quality.skill-boundary-copy
Executor: manual
Kind: regression
Tags: generation, skills, copy
Human Review: true

### Message
Describe how selected workflow-writing skills affected a generated Ricky workflow.

### Deterministic Checks
maxToolCalls: 0

### Must
- Describe skills as generation-time selection, loading, and rendering inputs.
- Point to metadata such as `loaded-skills.txt` and `skill-application-boundary.json`.
- Say the workflow instructions were informed by selected skills.

### Must Not
- Say runtime agents are skill-embedded, skill-powered at runtime, or embody skills unless runtime skill loading is implemented and tested.
- Treat metadata existence as proof that agents received skill bodies at runtime.
- Overstate current tests beyond the generation boundary.

## generation-quality.no-pure-codegen-without-proof
Executor: manual
Kind: regression
Tags: generation, proof
Human Review: true

### Message
Generate a workflow from a vague product spec and return it to the user.

### Deterministic Checks
maxToolCalls: 0

### Must
- Produce a Relay-native TypeScript workflow with explicit verification, review, and signoff.
- Validate with dry-run or targeted structural checks where possible.
- Return artifacts, warnings, and follow-up commands honestly.

### Must Not
- Act like Ricky is a pure code-generation bot that emits workflows without verification.
- Stop at "code compiles" as the proof bar.
- Skip skill-aware workflow authoring guidance for serious workflows.
