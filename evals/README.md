# Ricky Evals

This directory holds human-authored product evals for Ricky. The shared loading,
filtering, deterministic checks, human-review marking, and run artifact writing
come from `@agent-assistant/telemetry/evals`; Ricky keeps the domain-specific
cases, rubrics, and product executors here.

## Start Here

Write new evals in `evals/suites/<suite>/cases.md`. Each `## case-id` block is
compiled into generated `cases.jsonl` by:

```sh
npm run evals:compile
```

Run all current evals:

```sh
npm run evals
```

Useful filters:

```sh
npm run evals -- --suite workflow-authoring
npm run evals -- --case workflow-authoring.deterministic-gates
npm run evals -- --tag local
npm run evals:list
```

Run history and review worksheets are written under `.ricky/evals/runs/`, which
is intentionally ignored by git.

## Writing Manual Cases

Use `Executor: manual` when you want to capture a Ricky behavior expectation for
humans to judge. Put the user request in `### Message`, then write concrete
`### Must` and `### Must Not` bullets. These become the human-review rubric.

To evaluate a real Ricky answer manually, paste it into `### Candidate Output`
or point to a file with `### Candidate Output Path`. If no output is supplied,
the run still creates a review worksheet so the expected behavior is visible.

Minimal manual case:

```text
## workflow-authoring.your-case-id
Executor: manual
Kind: capability
Tags: workflow-authoring
Human Review: true

### Message
Ask Ricky to do the thing you care about.

### Must
- State the behavior a good Ricky response must show.

### Must Not
- State the regression or product failure this eval should catch.
```

## Deterministic CLI Cases

Use `Executor: ricky-cli` for small command-surface checks. Put the command
arguments in `### Mock` as `argv: ...`; the runner invokes the source CLI through
local `tsx`.

```text
## cli.example
Executor: ricky-cli
Kind: regression
Tags: cli

### Message
--help

### Mock
argv: --help

### Deterministic Checks
ok: true
contentIncludes:
- ricky run <artifact>
forbidPhrases:
- TypeError
```

Keep deterministic cases narrow and cheap. Use human-review cases for planning
quality, workflow authoring judgment, and any behavior where a senior engineer
needs to read the output.

## Source Map

The current suites sweep the repo's existing product and architecture docs:

- `cli-behavior` covers `README.md`, `docs/product/ricky-cli-onboarding-ux-spec.md`,
  `docs/product/ricky-cofounder-interactive-readiness-checklist.md`, and
  `specs/cli-version-from-package-json.md`.
- `workflow-authoring` covers `AGENTS.md`,
  `docs/workflows/WORKFLOW_STANDARDS.md`,
  `workflows/shared/WORKFLOW_AUTHORING_RULES.md`, and
  workflow authoring expectations in `SPEC.md`.
- `runtime-recovery` covers `SPEC.md`,
  `docs/architecture/ricky-failure-taxonomy-and-unblockers.md`,
  `docs/architecture/ricky-runtime-architecture.md`,
  `specs/cli-auto-fix-and-resume.md`, and
  `specs/in-process-workflow-runner.md`.
- `surfaces-ingress` covers `docs/architecture/ricky-surfaces-and-ingress.md`,
  `docs/product/ricky-cli-onboarding-ux-spec.md`,
  `specs/cloud-runtime-execute-artifact.md`, and
  `specs/linear-integration.md`.
- `generation-quality` covers `SPEC.md`,
  `specs/workflow-generation-quality.md`, and
  `docs/product/ricky-skill-embedding-boundary.md`.
- `agent-assistant-boundary` covers the Agent Assistant adoption audit,
  boundary, proof, live proof, and local execution reuse documents under
  `docs/product/`.
