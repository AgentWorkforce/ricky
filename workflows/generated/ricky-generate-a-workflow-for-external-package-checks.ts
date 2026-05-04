import { workflow } from '@agent-relay/sdk/workflows';

async function main() {
  const result = await workflow("ricky-generate-a-workflow-for-external-package-checks")
    .description("generate a workflow for external package checks")
    .pattern("pipeline")
    .channel("wf-ricky-generate-a-workflow-for-external-package-checks")
    .maxConcurrency(1)
    .timeout(600000)
    .onError('fail-fast')

    .agent("lead-claude", { cli: "claude", role: "Plans the generated workflow deliverables, boundaries, and verification gates.", retries: 1 })
    .agent("author-codex", { cli: "codex", role: "Writes the requested bounded artifact and keeps scope to declared files.", retries: 2 })
    .agent("reviewer-claude", { cli: "claude", preset: "reviewer", role: "Reviews artifact quality, scope, and evidence.", retries: 1 })
    .agent("reviewer-codex", { cli: "codex", preset: "reviewer", role: "Reviews implementation practicality and deterministic checks.", retries: 1 })
    .agent("validator-claude", { cli: "claude", preset: "worker", role: "Applies bounded fixes and confirms final signoff evidence.", retries: 2 })

    .step("prepare-context", {
      type: 'deterministic',
      command: "mkdir -p '.workflow-artifacts/generated/generate-a-workflow-for-external-package-checks' && printf '%s\\n' 'generate a workflow for external package checks' > '.workflow-artifacts/generated/generate-a-workflow-for-external-package-checks/normalized-spec.txt' && printf '%s\\n' 'pattern=pipeline; reason=Selected pipeline because the request is low risk and can proceed through a linear reliability ladder.' > '.workflow-artifacts/generated/generate-a-workflow-for-external-package-checks/pattern-decision.txt' && printf '%s\\n' 'writing-agent-relay-workflows,choosing-swarm-patterns' > '.workflow-artifacts/generated/generate-a-workflow-for-external-package-checks/loaded-skills.txt' && echo GENERATED_WORKFLOW_CONTEXT_READY",
      captureOutput: true,
      failOnError: true,
    })

    .step('lead-plan', {
      agent: 'lead-claude',
      dependsOn: ['prepare-context'],
      task: `Plan the workflow execution from the normalized spec.

Description:
generate a workflow for external package checks

Deliverables:
- A generated workflow artifact and any requested output files

Non-goals:
- None declared

Verification commands:
- file_exists gate for declared targets
- grep sanity gate
- npx tsc --noEmit
- npx vitest run
- git diff --name-only gate

Write .workflow-artifacts/generated/generate-a-workflow-for-external-package-checks/lead-plan.md ending with GENERATION_LEAD_PLAN_READY.`,
      verification: { type: 'file_exists', value: ".workflow-artifacts/generated/generate-a-workflow-for-external-package-checks/lead-plan.md" },
    })

    .step('implement-artifact', {
      agent: "author-codex",
      dependsOn: ['lead-plan'],
      task: `Author the requested workflow artifact.

Scope:
generate a workflow for external package checks

Own only declared targets unless review feedback explicitly narrows a required fix:
- No explicit file targets were supplied. Write all created file paths (one per line) to .workflow-artifacts/generated/generate-a-workflow-for-external-package-checks/output-manifest.txt. Keep changes bounded.

Acceptance gates:
- None declared

Keep execution routing explicit for local, cloud, and MCP callers. Materialize outputs to disk, then stop for deterministic gates.`,
    })

    .step("post-implementation-file-gate", {
      type: 'deterministic',
      dependsOn: ["implement-artifact"],
      command: "test -f '.workflow-artifacts/generated/generate-a-workflow-for-external-package-checks/output-manifest.txt' && test -s '.workflow-artifacts/generated/generate-a-workflow-for-external-package-checks/output-manifest.txt' && while IFS= read -r f; do test -f \"$f\"; done < '.workflow-artifacts/generated/generate-a-workflow-for-external-package-checks/output-manifest.txt'",
      captureOutput: true,
      failOnError: true,
    })

    .step("initial-soft-validation", {
      type: 'deterministic',
      dependsOn: ["post-implementation-file-gate"],
      command: "npx tsc --noEmit && npx vitest run",
      captureOutput: true,
      failOnError: false,
    })

    .step("review-claude", {
      agent: "reviewer-claude",
      dependsOn: ["initial-soft-validation"],
      task: `Review the generated work.

Assess:
- declared file targets and non-goals
- deterministic gates and evidence quality
- review/fix/final-review 80-to-100 loop shape
- local/cloud/MCP routing clarity

Spec:
generate a workflow for external package checks

Write .workflow-artifacts/generated/generate-a-workflow-for-external-package-checks/review-claude.md ending with REVIEW_COMPLETE.`,
      verification: { type: 'file_exists', value: ".workflow-artifacts/generated/generate-a-workflow-for-external-package-checks/review-claude.md" },
    })

    .step("review-codex", {
      agent: "reviewer-codex",
      dependsOn: ["initial-soft-validation"],
      task: `Review the generated work.

Assess:
- declared file targets and non-goals
- deterministic gates and evidence quality
- review/fix/final-review 80-to-100 loop shape
- local/cloud/MCP routing clarity

Spec:
generate a workflow for external package checks

Write .workflow-artifacts/generated/generate-a-workflow-for-external-package-checks/review-codex.md ending with REVIEW_COMPLETE.`,
      verification: { type: 'file_exists', value: ".workflow-artifacts/generated/generate-a-workflow-for-external-package-checks/review-codex.md" },
    })

    .step("read-review-feedback", {
      type: 'deterministic',
      dependsOn: ["review-claude", "review-codex"],
      command: "test -f '.workflow-artifacts/generated/generate-a-workflow-for-external-package-checks/review-claude.md' && test -f '.workflow-artifacts/generated/generate-a-workflow-for-external-package-checks/review-codex.md' && cat '.workflow-artifacts/generated/generate-a-workflow-for-external-package-checks/review-claude.md' '.workflow-artifacts/generated/generate-a-workflow-for-external-package-checks/review-codex.md' > '.workflow-artifacts/generated/generate-a-workflow-for-external-package-checks/review-feedback.md'",
      captureOutput: true,
      failOnError: true,
    })

    .step('fix-loop', {
      agent: 'validator-claude',
      dependsOn: ['read-review-feedback'],
      task: `Run the 80-to-100 fix loop.

Inputs:
- .workflow-artifacts/generated/generate-a-workflow-for-external-package-checks/review-feedback.md
- initial validation output from the previous deterministic step

Fix only concrete review or validation findings. Preserve the declared target boundary:
- No explicit targets supplied

Re-run document sanity checks before handing off to post-fix validation.`,
    })

    .step("post-fix-verification-gate", {
      type: 'deterministic',
      dependsOn: ["fix-loop"],
      command: "test -f '.workflow-artifacts/generated/generate-a-workflow-for-external-package-checks/output-manifest.txt' && test -s '.workflow-artifacts/generated/generate-a-workflow-for-external-package-checks/output-manifest.txt' && while IFS= read -r f; do test -f \"$f\"; done < '.workflow-artifacts/generated/generate-a-workflow-for-external-package-checks/output-manifest.txt'",
      captureOutput: true,
      failOnError: true,
    })

    .step("post-fix-validation", {
      type: 'deterministic',
      dependsOn: ["post-fix-verification-gate"],
      command: "npx tsc --noEmit && npx vitest run",
      captureOutput: true,
      failOnError: false,
    })

    .step("final-review-claude", {
      agent: "reviewer-claude",
      dependsOn: ["post-fix-validation"],
      task: `Re-review the fixed state only.

Assess:
- declared file targets and non-goals
- deterministic gates and evidence quality
- review/fix/final-review 80-to-100 loop shape
- local/cloud/MCP routing clarity

Spec:
generate a workflow for external package checks

Write .workflow-artifacts/generated/generate-a-workflow-for-external-package-checks/final-review-claude.md ending with FINAL_REVIEW_CLAUDE_PASS.`,
      verification: { type: 'file_exists', value: ".workflow-artifacts/generated/generate-a-workflow-for-external-package-checks/final-review-claude.md" },
    })

    .step("final-review-codex", {
      agent: "reviewer-codex",
      dependsOn: ["post-fix-validation"],
      task: `Re-review the fixed state only.

Assess:
- declared file targets and non-goals
- deterministic gates and evidence quality
- review/fix/final-review 80-to-100 loop shape
- local/cloud/MCP routing clarity

Spec:
generate a workflow for external package checks

Write .workflow-artifacts/generated/generate-a-workflow-for-external-package-checks/final-review-codex.md ending with FINAL_REVIEW_CODEX_PASS.`,
      verification: { type: 'file_exists', value: ".workflow-artifacts/generated/generate-a-workflow-for-external-package-checks/final-review-codex.md" },
    })

    .step("final-review-pass-gate", {
      type: 'deterministic',
      dependsOn: ["final-review-claude", "final-review-codex"],
      command: "tail -n 1 '.workflow-artifacts/generated/generate-a-workflow-for-external-package-checks/final-review-claude.md' | tr -d '[:space:]*' | grep -Eq '^FINAL_REVIEW_CLAUDE_PASS$' && tail -n 1 '.workflow-artifacts/generated/generate-a-workflow-for-external-package-checks/final-review-codex.md' | tr -d '[:space:]*' | grep -Eq '^FINAL_REVIEW_CODEX_PASS$'",
      captureOutput: true,
      failOnError: true,
    })

    .step("final-hard-validation", {
      type: 'deterministic',
      dependsOn: ["final-review-pass-gate"],
      command: "npx tsc --noEmit && npx vitest run",
      captureOutput: true,
      failOnError: true,
    })

    .step("git-diff-gate", {
      type: 'deterministic',
      dependsOn: ["final-hard-validation"],
      command: "test -s '.workflow-artifacts/generated/generate-a-workflow-for-external-package-checks/output-manifest.txt' && : > '.workflow-artifacts/generated/generate-a-workflow-for-external-package-checks/git-diff.txt' && while IFS= read -r f; do { git diff --name-only -- \"$f\"; git ls-files --others --exclude-standard -- \"$f\"; } >> '.workflow-artifacts/generated/generate-a-workflow-for-external-package-checks/git-diff.txt'; done < '.workflow-artifacts/generated/generate-a-workflow-for-external-package-checks/output-manifest.txt' && sort -u '.workflow-artifacts/generated/generate-a-workflow-for-external-package-checks/git-diff.txt' -o '.workflow-artifacts/generated/generate-a-workflow-for-external-package-checks/git-diff.txt' && test -s '.workflow-artifacts/generated/generate-a-workflow-for-external-package-checks/git-diff.txt'",
      captureOutput: true,
      failOnError: true,
    })

    .step("regression-gate", {
      type: 'deterministic',
      dependsOn: ["git-diff-gate"],
      command: "git diff --check",
      captureOutput: true,
      failOnError: true,
    })

    .step('final-signoff', {
      agent: 'validator-claude',
      dependsOn: ['regression-gate'],
      task: `Write .workflow-artifacts/generated/generate-a-workflow-for-external-package-checks/signoff.md.

Include:
- files changed
- dry-run command to execute before runtime launch
- deterministic validation commands
- review verdicts
- remaining risks or environmental blockers

End with GENERATED_WORKFLOW_READY.`,
      verification: { type: 'file_exists', value: ".workflow-artifacts/generated/generate-a-workflow-for-external-package-checks/signoff.md" },
    })

    .run({ cwd: process.cwd() });

  console.log(result.status);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
