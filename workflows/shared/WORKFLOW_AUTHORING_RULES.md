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
