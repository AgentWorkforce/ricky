import { workflow } from '@agent-relay/sdk/workflows';

async function main() {
  const result = await workflow('ricky-wave0-repo-standards-and-conventions')
    .description('Establish and verify Ricky repo-level workflow conventions so later generated workflows operate under enforced standards.')
    .pattern('dag')
    .channel('wf-ricky-wave0-standards')
    .maxConcurrency(3)
    .timeout(3_600_000)
    .onError('retry', { maxRetries: 1, retryDelayMs: 10_000 })

    .agent('lead-claude', {
      cli: 'claude',
      role: 'Foundation lead who plans repo convention updates and keeps the scope limited to standards and workflow authoring rules.',
      retries: 1,
    })
    .agent('author-codex', {
      cli: 'codex',
      role: 'Documentation author who edits repo-level convention files and writes only the agreed Wave 0 standards content.',
      retries: 2,
    })
    .agent('reviewer-claude', {
      cli: 'claude',
      preset: 'reviewer',
      role: 'Reviews convention updates for product alignment, enforceability, and missing workflow safety rules.',
      retries: 1,
    })

    .step('prepare-artifacts', {
      type: 'deterministic',
      command: 'mkdir -p .workflow-artifacts/wave0-foundation/repo-standards && echo W0_REPO_STANDARDS_ARTIFACTS_READY',
      captureOutput: true,
      failOnError: true,
    })

    .step('read-workflow-standards', {
      type: 'deterministic',
      dependsOn: ['prepare-artifacts'],
      command: 'cat docs/workflows/WORKFLOW_STANDARDS.md',
      captureOutput: true,
      failOnError: true,
    })
    .step('read-authoring-rules', {
      type: 'deterministic',
      dependsOn: ['prepare-artifacts'],
      command: 'cat workflows/shared/WORKFLOW_AUTHORING_RULES.md',
      captureOutput: true,
      failOnError: true,
    })
    .step('read-generated-template', {
      type: 'deterministic',
      dependsOn: ['prepare-artifacts'],
      command: 'cat workflows/meta/spec/generated-workflow-template.md',
      captureOutput: true,
      failOnError: true,
    })
    .step('read-wave-plan', {
      type: 'deterministic',
      dependsOn: ['prepare-artifacts'],
      command: 'cat .workflow-artifacts/ricky-meta/application-wave-plan.md',
      captureOutput: true,
      failOnError: true,
    })
    .step('read-existing-targets', {
      type: 'deterministic',
      dependsOn: ['prepare-artifacts'],
      command: 'for f in AGENTS.md CLAUDE.md workflows/README.md workflows/shared/WORKFLOW_AUTHORING_RULES.md; do echo "===== $f ====="; if [ -f "$f" ]; then sed -n "1,220p" "$f"; else echo "MISSING:$f"; fi; done',
      captureOutput: true,
      failOnError: false,
    })

    .step('plan-convention-updates', {
      agent: 'lead-claude',
      dependsOn: ['read-workflow-standards', 'read-authoring-rules', 'read-generated-template', 'read-wave-plan', 'read-existing-targets'],
      task: `Plan a narrow Wave 0 convention update.

Context inputs:
- docs/workflows/WORKFLOW_STANDARDS.md:
{{steps.read-workflow-standards.output}}
- workflows/shared/WORKFLOW_AUTHORING_RULES.md:
{{steps.read-authoring-rules.output}}
- workflows/meta/spec/generated-workflow-template.md:
{{steps.read-generated-template.output}}
- .workflow-artifacts/ricky-meta/application-wave-plan.md:
{{steps.read-wave-plan.output}}
- Current target file snapshots:
{{steps.read-existing-targets.output}}

Deliverables:
- A concise plan for updating AGENTS.md, CLAUDE.md, workflows/README.md, and workflows/shared/WORKFLOW_AUTHORING_RULES.md.
- The plan must preserve existing repo guidance while adding Ricky-specific workflow standards, deterministic gates, wave structure, and review requirements.

File targets:
- AGENTS.md
- CLAUDE.md
- workflows/README.md
- workflows/shared/WORKFLOW_AUTHORING_RULES.md

Non-goals:
- Do not edit application source files.
- Do not generate Wave 1 or later workflows.
- Do not introduce new workflow runtime abstractions.
- Do not remove existing safety guidance unless it directly conflicts with Ricky standards.

Verification commands the author and reviewers must expect:
- test -f AGENTS.md
- test -f CLAUDE.md
- test -f workflows/README.md
- test -f workflows/shared/WORKFLOW_AUTHORING_RULES.md
- grep -Eiq "workflow standards|deterministic gates|wave" AGENTS.md
- grep -Eq "Must-do|Must-not" workflows/shared/WORKFLOW_AUTHORING_RULES.md
- changed="$(git diff --name-only -- AGENTS.md CLAUDE.md workflows/README.md workflows/shared/WORKFLOW_AUTHORING_RULES.md; git ls-files --others --exclude-standard -- AGENTS.md CLAUDE.md workflows/README.md workflows/shared/WORKFLOW_AUTHORING_RULES.md)" && printf "%s\n" "$changed" | grep -Eq "^(AGENTS.md|CLAUDE.md|workflows/README.md|workflows/shared/WORKFLOW_AUTHORING_RULES.md)$" && echo CHANGES_PRESENT

Review checklist:
- Standards are enforceable and not just aspirational.
- Wave structure and dedicated wf-ricky-* channels are documented.
- Deterministic gates and review stages are mandatory.
- Commit boundary is limited to the four file targets.

Commit/PR boundary:
- One commit or PR should contain only the four convention files above plus review artifacts if the operator chooses to preserve them.

Write .workflow-artifacts/wave0-foundation/repo-standards/plan.md and end it with W0_REPO_STANDARDS_PLAN_READY.`,
      verification: { type: 'file_exists', value: '.workflow-artifacts/wave0-foundation/repo-standards/plan.md' },
    })

    .step('author-convention-files', {
      agent: 'author-codex',
      dependsOn: ['plan-convention-updates'],
      task: `Implement the Wave 0 repo standards and convention updates.

First read:
- .workflow-artifacts/wave0-foundation/repo-standards/plan.md
- docs/workflows/WORKFLOW_STANDARDS.md
- workflows/shared/WORKFLOW_AUTHORING_RULES.md
- workflows/meta/spec/generated-workflow-template.md

Deliverables:
- AGENTS.md exists and includes Ricky workflow standards, deterministic gates, wave structure, review expectations, and commit boundary expectations.
- CLAUDE.md exists and mirrors the repo-level workflow behavior needed by Claude agents without conflicting with AGENTS.md.
- workflows/README.md explains the wave folders, workflow naming, channel naming, and review/validation expectations.
- workflows/shared/WORKFLOW_AUTHORING_RULES.md keeps Must-do and Must-not sections and includes the 80-to-100 validation ladder.

File targets:
- AGENTS.md
- CLAUDE.md
- workflows/README.md
- workflows/shared/WORKFLOW_AUTHORING_RULES.md

Non-goals:
- Do not edit package.json, source files, generated wave workflows, or product specs.
- Do not add broad prose that cannot be verified by grep or review.

Verification commands to keep green:
- test -f AGENTS.md CLAUDE.md workflows/README.md workflows/shared/WORKFLOW_AUTHORING_RULES.md
- grep -Eiq "workflow standards|deterministic gates|wave" AGENTS.md
- grep -Eiq "wf-ricky|deterministic|review" workflows/README.md
- grep -Eq "Must-do|Must-not" workflows/shared/WORKFLOW_AUTHORING_RULES.md

Write changes to disk. Do not print complete file contents.`,
      verification: { type: 'exit_code' },
    })

    .step('verify-materialized-files', {
      type: 'deterministic',
      dependsOn: ['author-convention-files'],
      command: 'test -f AGENTS.md && test -f CLAUDE.md && test -f workflows/README.md && test -f workflows/shared/WORKFLOW_AUTHORING_RULES.md && echo W0_REPO_STANDARDS_FILES_PRESENT',
      captureOutput: true,
      failOnError: true,
    })
    .step('initial-soft-validation', {
      type: 'deterministic',
      dependsOn: ['verify-materialized-files'],
      command: [
        'grep -Eiq "workflow standards|deterministic gates|wave" AGENTS.md',
        'grep -Eiq "workflow standards|deterministic gates|wave" CLAUDE.md',
        'grep -Eiq "wf-ricky|deterministic|review" workflows/README.md',
        'grep -Eq "Must-do|Must-not" workflows/shared/WORKFLOW_AUTHORING_RULES.md',
        'changed="$(git diff --name-only -- AGENTS.md CLAUDE.md workflows/README.md workflows/shared/WORKFLOW_AUTHORING_RULES.md; git ls-files --others --exclude-standard -- AGENTS.md CLAUDE.md workflows/README.md workflows/shared/WORKFLOW_AUTHORING_RULES.md)" && printf "%s\n" "$changed" | grep -Eq "^(AGENTS.md|CLAUDE.md|workflows/README.md|workflows/shared/WORKFLOW_AUTHORING_RULES.md)$" && echo CHANGES_PRESENT',
      ].join(' && '),
      captureOutput: true,
      failOnError: false,
    })

    .step('review-convention-files', {
      agent: 'reviewer-claude',
      dependsOn: ['initial-soft-validation'],
      task: `Review the Wave 0 repo convention updates.

Read:
- .workflow-artifacts/wave0-foundation/repo-standards/plan.md
- AGENTS.md
- CLAUDE.md
- workflows/README.md
- workflows/shared/WORKFLOW_AUTHORING_RULES.md
- Initial soft validation output:
{{steps.initial-soft-validation.output}}

Review checklist:
- Each target file exists and has a clear purpose.
- The standards mention deterministic gates, review stages, wave folders, and dedicated wf-ricky-* channels.
- AGENTS.md and CLAUDE.md do not conflict.
- workflows/README.md is useful to someone inspecting the workflow tree.
- WORKFLOW_AUTHORING_RULES.md retains Must-do and Must-not sections.
- The diff is scoped to AGENTS.md, CLAUDE.md, workflows/README.md, and workflows/shared/WORKFLOW_AUTHORING_RULES.md.

If fixes are needed, list exact file-level changes. Write .workflow-artifacts/wave0-foundation/repo-standards/review.md and end with REVIEW_PASS or REVIEW_FAIL.`,
      verification: { type: 'file_exists', value: '.workflow-artifacts/wave0-foundation/repo-standards/review.md' },
    })

    .step('fix-review-feedback', {
      agent: 'author-codex',
      dependsOn: ['review-convention-files'],
      task: `Fix any concrete issues from .workflow-artifacts/wave0-foundation/repo-standards/review.md.

If the review passes, make no unrelated edits. If it fails, only patch the four target files:
- AGENTS.md
- CLAUDE.md
- workflows/README.md
- workflows/shared/WORKFLOW_AUTHORING_RULES.md

Re-check these expectations before exiting:
- Dedicated wf-ricky-* channel convention is documented.
- Deterministic gates and review stages are required.
- Wave folder structure is documented.
- Commit/PR boundary remains limited to the target files.`,
      verification: { type: 'exit_code' },
    })

    .step('final-hard-gate', {
      type: 'deterministic',
      dependsOn: ['fix-review-feedback'],
      command: [
        'test -f AGENTS.md',
        'test -f CLAUDE.md',
        'test -f workflows/README.md',
        'test -f workflows/shared/WORKFLOW_AUTHORING_RULES.md',
        'grep -Eiq "workflow standards|deterministic gates|wave" AGENTS.md',
        'grep -Eiq "workflow standards|deterministic gates|wave" CLAUDE.md',
        'grep -Eiq "wf-ricky|deterministic|review" workflows/README.md',
        'grep -Eq "Must-do|Must-not" workflows/shared/WORKFLOW_AUTHORING_RULES.md',
        'echo W0_REPO_STANDARDS_FINAL_GATE_PASS',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })
    .step('regression-scope-gate', {
      type: 'deterministic',
      dependsOn: ['final-hard-gate'],
      command: 'changed="$(git diff --name-only; git ls-files --others --exclude-standard)" && printf "%s\n" "$changed" | grep -Eq "^(AGENTS.md|CLAUDE.md|workflows/README.md|workflows/shared/WORKFLOW_AUTHORING_RULES.md)$" && printf "%s\n" "$changed" | grep -Ev "^(AGENTS.md|CLAUDE.md|workflows/README.md|workflows/shared/WORKFLOW_AUTHORING_RULES.md|\.workflow-artifacts/)" >/tmp/w0_repo_standards_unexpected.txt || true; test ! -s /tmp/w0_repo_standards_unexpected.txt && echo W0_REPO_STANDARDS_REGRESSION_SCOPE_PASS',
      captureOutput: true,
      failOnError: true,
    })
    .step('final-signoff', {
      agent: 'validator-claude',
      dependsOn: ['regression-scope-gate'],
      task: `Write .workflow-artifacts/wave0-foundation/repo-standards/signoff.md.

Include files changed, validation commands run, review verdicts, and remaining risks.
End with W0_REPO_STANDARDS_WORKFLOW_COMPLETE.`,
      verification: { type: 'file_exists', value: '.workflow-artifacts/wave0-foundation/repo-standards/signoff.md' },
    })

    .run({ cwd: process.cwd() });

  console.log(result.status);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
