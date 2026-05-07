# Ricky Workflow Authoring Rules

Compact execution rules for agents writing Ricky workflows.

## Must-do

1. Use explicit wave/folder placement.
2. Use numeric prefixes and concise outcome-based slugs.
3. Use a dedicated `wf-ricky-*` channel.
4. Choose swarm pattern deliberately, do not default blindly.
5. Read standards/spec inputs deterministically at runtime.
6. Materialize files to disk, do not rely on stdout.
7. Add deterministic post-edit gates.
8. Include a review stage for significant workflows.
9. Use 80→100 validation loops for serious implementation workflows.
10. If generating workflows in bulk, run structural sanity checks and `agent-relay run --dry-run` before sign-off.
11. End serious workflows with `.run({ cwd: process.cwd() })`.
12. Keep commit/push boundaries explicit and deterministic.
13. Load repo-local `.env.local`/`.env` before `.run(...)` without overwriting exported values, and fail fast with `MISSING_ENV_VAR: NAME` for required env vars before long-running agent steps.

## Must-not

1. Do not use `general` as the workflow channel.
2. Do not trust interactive agent success without deterministic verification.
3. Do not let one agent step own too many files or too much scope.
4. Do not skip review artifacts for meta-workflows.
5. Do not claim generated workflows are ready if dry-run has not passed.
6. Do not hand-tune generated workflows first when the template/spec/rules should be fixed upstream.
7. Do not hide environmental blockers; document them explicitly.

## Default reliability pattern

1. Read specs and standards.
2. Plan.
3. Write artifacts.
4. Run deterministic gates.
5. Review.
6. Fix.
7. Re-run deterministic gates.
8. Final sign-off.

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
9. Materialize review and signoff artifacts under `.workflow-artifacts/` for significant workflows.
10. Sign off only after the final deterministic gates pass.

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
