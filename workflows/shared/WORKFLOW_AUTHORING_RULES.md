# Ricky Workflow Authoring Rules

Compact execution rules for agents writing Ricky workflows.

## Must-do

1. Use explicit wave/folder placement.
2. Use numeric prefixes and concise outcome-based slugs.
3. Use a dedicated `wf-ricky-*` channel.
4. Choose swarm pattern deliberately, do not default blindly.
5. Read standards/spec inputs deterministically at runtime, including `cat docs/workflows/WORKFLOW_STANDARDS.md`, `cat workflows/shared/WORKFLOW_AUTHORING_RULES.md`, and `cat workflows/meta/spec/generated-workflow-template.md` when generation is in scope.
6. Materialize files to disk, do not rely on stdout.
7. Add deterministic post-edit gates.
8. Include a review stage for significant workflows.
9. Use 80→100 validation loops for serious implementation workflows.
10. If generating workflows in bulk, run structural sanity checks and `agent-relay run --dry-run` before sign-off.
11. Import from `@agent-relay/sdk/workflows`, wrap serious workflows in `async function main()`, end with `main().catch(...)`, and call `.run({ cwd: process.cwd() })`.
12. Keep commit/push boundaries explicit and deterministic.
13. Load repo-local `.env.local`/`.env` before `.run(...)` without overwriting exported values, and fail fast with `MISSING_ENV_VAR: NAME` for required env vars before long-running agent steps.
14. For generation tasks, read `workflows/meta/spec/generated-workflow-template.md` before authoring.
15. Set `.channel()`, `.pattern()`, `.maxConcurrency()`, and `.timeout()` explicitly; add `.onError()` for long-running or multi-agent workflows.
16. Prefer named roles over generic numbering. Default implementation team shape is `lead-claude`, `impl-primary-codex`, `impl-tests-codex`, `reviewer-claude`, `reviewer-codex`, and `validator-claude`; doc/spec workflows may use `lead-claude`, `author-codex` or `author-claude`, and a distinct reviewer.
17. State the expected branch naming pattern and whether PR creation is in or out of scope.
18. Use scoped change detection after implementation steps with `git diff --name-only` and `git ls-files --others --exclude-standard` limited to declared file targets.
19. Write final signoff artifacts under `.workflow-artifacts/` for significant implementation or generation workflows.
20. In 80-to-100 validation loops, run the same validation first as a soft gate, fix from captured output, then rerun it as a hard gate before final signoff.
21. For convention-only workflows, keep edits inside declared convention files and preserve `CLAUDE.md` as a symlink to `AGENTS.md` unless the contract explicitly says otherwise.
22. For convention-only workflows, run file existence checks, grep or structural checks for the required terms, symlink checks when `CLAUDE.md` is in scope, and scoped change detection limited to declared convention files.

## Must-not

1. Do not use `general` as the workflow channel.
2. Do not trust interactive agent success without deterministic verification.
3. Do not let one agent step own too many files or too much scope.
4. Do not skip review artifacts for meta-workflows.
5. Do not claim generated workflows are ready if dry-run has not passed.
6. Do not hand-tune generated workflows first when the template/spec/rules should be fixed upstream.
7. Do not hide environmental blockers; document them explicitly.
8. Do not sign off using review artifacts produced before the fix loop; re-review must evaluate the post-fix state.
9. Do not use repo-wide `git diff --quiet` as the change-detection gate when unrelated work may be present.
10. Do not edit package metadata, runtime configuration, product source, generated wave workflows, or product specs from a convention-only workflow.
11. Do not add broad prose that cannot be checked by deterministic gates or reviewer inspection.

## Default reliability pattern

1. Read specs and standards.
2. Plan.
3. Write artifacts.
4. Run deterministic gates.
5. Review.
6. Fix.
7. Re-review on the fixed state.
8. Re-run deterministic gates.
9. Final sign-off.

## 80-to-100 Validation Ladder

Use this ladder for serious implementation workflows:

1. Read context, specs, and standards deterministically.
2. Plan with explicit deliverables, file targets, non-goals, verification, and commit boundary.
3. Implement within the declared scope.
4. Verify files exist and expected scoped changes are present.
5. Run the first validation gate with `failOnError: false` and capture output.
6. Fix failures from the captured output.
7. Re-run the same validation as a hard gate with `failOnError: true`.
8. Run regression, build, typecheck, dry-run, or local smoke gates appropriate to the workflow.
9. Re-review on the fixed state; do not reuse stale pre-fix review artifacts.
10. Materialize review and signoff artifacts under `.workflow-artifacts/` for significant workflows.
11. Sign off only after the final deterministic gates pass.

The ladder is mandatory when the workflow changes runtime behavior, generated workflows, user-visible behavior, or shared execution contracts. Documentation-only and convention-only workflows may use a lighter version, but they still need file existence checks, grep or structural checks, symlink checks when `CLAUDE.md` is in scope, scoped change detection, and independent review when significant.

## Scoped Change-Detection Gate

After implementation steps that create or edit files, verify the repo actually changed in the expected scope:

```bash
changed="$(git diff --name-only -- <file-targets>; git ls-files --others --exclude-standard -- <file-targets>)"
if [ -z "$changed" ]; then
  echo "NO_CHANGES_DETECTED" && exit 1
fi
echo "CHANGES_PRESENT"
```

Scope the check to the workflow's declared file targets. Do not use a repo-wide `git diff --quiet` when unrelated work may be present.

## Preferred Gate Types

Prefer deterministic gate types in this order:

1. `exit_code`
2. `file_exists`
3. `output_contains` only when the sentinel is deterministic and not agent-echoed
4. `custom` only when simpler gates cannot express the check

## Reviewer Independence

Use a reviewer distinct from the writer when possible:

- writer = codex, reviewer = claude
- writer = claude, reviewer = codex
- critical workflows = both reviewers

## Meta-Workflow Artifact Layout

Meta-workflows and significant generation workflows should write artifacts under:

```text
.workflow-artifacts/<meta-slug>/
```

Expected files include:

- `plan.md`
- `<workflow-id>-review.md`
- `<workflow-id>-dryrun.txt`
- `signoff.md`
