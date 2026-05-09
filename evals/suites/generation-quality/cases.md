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

## generation-quality.unanswered-spec-questions-ask-user
Executor: ricky-cli
Kind: regression
Tags: generation, clarification, local
Human Review: false

### Message
Ricky receives a workflow generation spec with an explicit open question and no `--best-judgement` flag.

### Mock
cwd: temp
specFileContent: Generate a workflow for package validation.\nOpen questions:\n- Who owns final rollout signoff?
argv: --mode local --spec-file {{specFile}} --no-workforce-persona

### Deterministic Checks
ok: false
contentIncludes:
- Generation: failed (status: needs_clarification).
- Next: Clarify: Who owns final rollout signoff?
forbidPhrases:
- Best-judgement clarifications
- TypeError
- ReferenceError
maxToolCalls: 1

### Must
- Stop before generating a workflow artifact when the spec carries an unanswered question.
- Ask the user the unresolved question directly.
- Avoid writing an implementation assumption unless the caller explicitly opts into best judgement.

### Must Not
- Generate a workflow by silently guessing the answer.
- Hide the clarification question behind a generic failure.

## generation-quality.best-judgement-answers-spec-questions
Executor: ricky-cli
Kind: regression
Tags: generation, clarification, local, best-judgement
Human Review: false

### Message
Ricky receives the same open-question spec with `--best-judgement`.

### Mock
cwd: temp
specFileContent: Generate a workflow for package validation.\nOpen questions:\n- Who owns final rollout signoff?
argv: local --spec-file {{specFile}} --best-judgement --no-workforce-persona

### Deterministic Checks
ok: true
contentIncludes:
- generated; run when ready
- Warning: --best-judgement Who owns final rollout signoff?
- Answered by implementing agent impl-primary-codex using --best-judgement
- Workflow: workflows/generated/
forbidPhrases:
- Generation: failed
- needs_clarification
- TypeError
- ReferenceError
maxToolCalls: 1

### Must
- Continue to workflow generation after explicitly answering the unresolved question.
- Call out each best-judgement question and answer in user-visible output or generated context.
- Identify the implementing agent that made the assumption.

### Must Not
- Pretend the user supplied the answer.
- Drop the original question from the assumption record.

## generation-quality.mode-local-overrides-runtime-wording
Executor: ricky-cli
Kind: regression
Tags: generation, clarification, local, issue-76
Human Review: false

### Message
Ricky receives a spec that legitimately discusses both local and Cloud execution while the CLI selected local mode.

### Mock
cwd: temp
specFileContent: Generate a workflow for a primitive whose API supports local BYOH execution and Cloud hosted execution. The generated workflow should implement the primitive docs and validation gates.
argv: --mode local --spec-file {{specFile}} --no-workforce-persona

### Deterministic Checks
ok: true
contentIncludes:
- Generation: ok
- Run: ricky run workflows/generated/
forbidPhrases:
- execution-mode-conflict
- needs_clarification
- Should this workflow run locally/BYOH
- TypeError
- ReferenceError
maxToolCalls: 1

### Must
- Treat the explicit local CLI mode as the execution preference.
- Generate a workflow even when the design spec mentions both local and Cloud runtime support.
- Avoid re-asking the local-vs-Cloud clarification after mode has already been chosen.

### Must Not
- Infer `auto` solely from runtime keywords when an explicit CLI mode is present.
- Force the user to rewrite a design spec to remove one runtime keyword.

## generation-quality.target-files-from-backticked-prose
Executor: ricky-cli
Kind: regression
Tags: generation, target-files, parser, local
Human Review: false

### Message
Ricky receives a markdown spec that names target file paths inside backticks in prose. The parser must recognize them so the workflow targets real source files instead of falling back to the manifest-driven single-artifact path.

### Mock
cwd: temp
specFileContent: # Spec\n\nImplementation plan:\n\n- Update `packages/web/app/api/v1/workflows/run/route.ts` to accept the new mode.\n- Update `packages/core/src/bootstrap/launcher.ts` to provision a sandbox.\n
argv: --mode local --spec-file {{specFile}} --no-run --json --no-workforce-persona

### Deterministic Checks
ok: true
contentIncludes:
- "target_files":
- packages/web/app/api/v1/workflows/run/route.ts
- packages/core/src/bootstrap/launcher.ts
forbidPhrases:
- TypeError
- ReferenceError
maxToolCalls: 1

### Must
- Extract paths wrapped in markdown backticks into `target_files`.
- Surface `target_files` in the generation JSON so callers can verify scope.

### Must Not
- Fall back to the manifest-driven single-artifact path when the spec names concrete files.
- Capture prose noise like `base/head` as a target file.

## generation-quality.target-files-from-structured-block
Executor: ricky-cli
Kind: regression
Tags: generation, target-files, parser, local
Human Review: false

### Message
A spec with an explicit `## Target Files` block must take precedence over any prose paths so authors can be unambiguous about scope.

### Mock
cwd: temp
specFileContent: # Spec\n\nProse mentions `tests/scratch/example.ts` casually.\n\n## Target Files\n\n- `packages/web/app/api/v1/workflows/run/route.ts`\n- packages/core/src/bootstrap/launcher.ts\n\n## Acceptance\n\nIt works.\n
argv: --mode local --spec-file {{specFile}} --no-run --json --no-workforce-persona

### Deterministic Checks
ok: true
contentIncludes:
- "target_files":
- packages/web/app/api/v1/workflows/run/route.ts
- packages/core/src/bootstrap/launcher.ts
forbidPhrases:
- tests/scratch/example.ts
- TypeError
- ReferenceError
maxToolCalls: 1

### Must
- Honor the structured `## Target Files` block as the source of truth when present.
- Strip leading bullets and surrounding backticks from each line in the block.

### Must Not
- Mix prose-extracted candidates into `target_files` when a structured block is declared.

## generation-quality.target-files-suppresses-prose-noise
Executor: ricky-cli
Kind: regression
Tags: generation, target-files, parser, local
Human Review: false

### Message
The parser must suppress two-segment prose tokens that have no extension and no recognized leading directory (e.g. `base/head`, `my-org/my-repo`) so they are not captured as target files.

### Mock
cwd: temp
specFileContent: # Spec\n\nSend the PR number, base/head SHA, and the user/account pair to MSD. Then update `packages/web/app/api/v1/workflows/run/route.ts`.\n
argv: --mode local --spec-file {{specFile}} --no-run --json --no-workforce-persona

### Deterministic Checks
ok: true
contentIncludes:
- "target_files":
- packages/web/app/api/v1/workflows/run/route.ts
forbidPhrases:
- "\"base/head\""
- "\"user/account\""
- TypeError
- ReferenceError
maxToolCalls: 1

### Must
- Keep real backticked paths in `target_files`.
- Drop two-segment prose tokens that look like noise.

### Must Not
- Capture human-readable phrases as file paths.
