import { workflow } from '@agent-relay/sdk/workflows';

async function main() {
  const result = await workflow('ricky-build-application-workflows')
    .description('Generate the first Ricky application wave backlog as reliable, reviewable workflow files with structural checks and dry-run validation.')
    .pattern('dag')
    .channel('wf-ricky-meta-build-application-workflows')
    .maxConcurrency(3)
    .timeout(3_600_000)
    .onError('retry', { maxRetries: 2, retryDelayMs: 10_000 })

    .agent('meta-lead-claude', {
      cli: 'claude',
      role: 'Meta lead who plans the generated workflow backlog, keeps it bounded, and signs off only when all generated workflows pass review and dry-run gates.',
      retries: 1,
    })
    .agent('meta-writer-codex', {
      cli: 'codex',
      role: 'Writes generated Ricky workflow files to disk following the shared template and wave program.',
      retries: 2,
    })
    .agent('meta-reviewer-claude', {
      cli: 'claude',
      preset: 'reviewer',
      role: 'Reviews generated workflows for product alignment, structure, and standards conformance.',
      retries: 1,
    })
    .agent('meta-reviewer-codex', {
      cli: 'codex',
      preset: 'reviewer',
      role: 'Reviews generated workflows for implementation practicality, deterministic gates, and structural consistency.',
      retries: 1,
    })
    .agent('meta-validator-claude', {
      cli: 'claude',
      preset: 'worker',
      role: 'Runs dry-run validation and fixes parse/shape issues until generated workflows are structurally sound.',
      retries: 2,
    })

    .step('prepare-artifacts', {
      type: 'deterministic',
      command: [
        'mkdir -p .workflow-artifacts/ricky-meta',
        'mkdir -p workflows/wave0-foundation workflows/wave1-runtime workflows/wave2-product workflows/wave3-cloud-api workflows/wave4-local-byoh workflows/wave5-scale-and-ops',
        'echo "RICKY_META_READY"',
      ].join(' && '),
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
    .step('read-wave-program', {
      type: 'deterministic',
      dependsOn: ['prepare-artifacts'],
      command: 'cat workflows/meta/spec/ricky-application-wave-program.md',
      captureOutput: true,
      failOnError: true,
    })
    .step('read-meta-design', {
      type: 'deterministic',
      dependsOn: ['prepare-artifacts'],
      command: 'cat workflows/meta/spec/ricky-meta-workflow-design.md',
      captureOutput: true,
      failOnError: true,
    })
    .step('read-product-spec', {
      type: 'deterministic',
      dependsOn: ['prepare-artifacts'],
      command: 'cat SPEC.md',
      captureOutput: true,
      failOnError: true,
    })

    .step('plan-generated-backlog', {
      agent: 'meta-lead-claude',
      dependsOn: [
        'read-workflow-standards',
        'read-authoring-rules',
        'read-generated-template',
        'read-wave-program',
        'read-meta-design',
        'read-product-spec',
      ],
      task: `Plan the first generated Ricky application workflow backlog.

Read and synthesize these inputs:

## Workflow standards
{{steps.read-workflow-standards.output}}

## Authoring rules
{{steps.read-authoring-rules.output}}

## Generated workflow template
{{steps.read-generated-template.output}}

## Wave program
{{steps.read-wave-program.output}}

## Meta-workflow design
{{steps.read-meta-design.output}}

## Product spec
{{steps.read-product-spec.output}}

Write .workflow-artifacts/ricky-meta/application-wave-plan.md.

Requirements:
1. Define a bounded first batch of generated workflows, roughly 12 to 18 workflows total.
2. Distribute them across the wave folders, with priority on Wave 0, Wave 1, Wave 2, and the CLI/Cloud-connect flows implied by the spec.
3. Include workflow filename, target wave folder, one-sentence purpose, why it belongs in the first batch, expected primary files it should touch, the exact validation gates it should run, and the recommended agent/team shape.
4. Make sure the batch reflects Ricky's product truth:
   - users should not need to hand-write workflows
   - spec handoff from Claude/CLI/MCP is first-class
   - CLI onboarding and Cloud connect are first-class
5. For each planned workflow, specify an 80-to-100 validation shape: implementation gates, initial run, fix loop, final hard gate, and regression gate.
6. Keep the batch reviewable, not huge.
7. End the file with APPLICATION_WAVE_PLAN_READY.

IMPORTANT: write the file to disk and do not print the full plan to stdout.`,
      verification: { type: 'file_exists', value: '.workflow-artifacts/ricky-meta/application-wave-plan.md' },
    })

    .step('generate-wave0-workflows', {
      agent: 'meta-writer-codex',
      dependsOn: ['plan-generated-backlog'],
      task: `Read .workflow-artifacts/ricky-meta/application-wave-plan.md and generate the Wave 0 workflows listed there into workflows/wave0-foundation/.

Also read these requirements again before writing:
- docs/workflows/WORKFLOW_STANDARDS.md
- workflows/shared/WORKFLOW_AUTHORING_RULES.md
- workflows/meta/spec/generated-workflow-template.md

Constraints:
1. Only generate workflows assigned to Wave 0.
2. Write files to disk.
3. Each generated workflow must have a dedicated wf-ricky-* channel, deterministic context reads, deterministic verification gates, and a review phase.
4. The generated workflows should be narrow and reviewable.
5. Prefer doc/spec/scaffold workflows in Wave 0.
6. Every generated workflow must follow the relay 80-to-100 skill where applicable: implement -> verify edit -> run initial validation with failOnError false -> fix loop -> final hard gate -> regression/build gate -> final signoff.
7. Change-detection and regression gates must work for both tracked edits and first-run untracked file creation. Never rely on git diff alone. Use a tracked-plus-untracked pattern such as combining git diff --name-only with git ls-files --others --exclude-standard.
8. After every review step, add a deterministic verdict gate that reads the review artifact and fails if it ends in REVIEW_*_FAIL.
9. Include explicit file targets, non-goals, verification commands, review checklist, and commit/PR boundary guidance inside the tasking.
10. Prefer multiple narrow deterministic verify gates over one broad final grep.
11. The generated workflows should be explicit enough that a human can inspect one file and understand exactly what success means.
12. Use import syntax that matches the written standard instead of CommonJS require.
13. Do not declare unused agents. If a validator agent exists, it must own either the fix loop, final signoff, or both.
14. Do not print full workflow contents to stdout.

End by ensuring the planned Wave 0 files exist on disk.`,
      verification: { type: 'exit_code' },
    })

    .step('generate-wave1-wave2-workflows', {
      agent: 'meta-writer-codex',
      dependsOn: ['plan-generated-backlog'],
      task: `Read .workflow-artifacts/ricky-meta/application-wave-plan.md and generate the Wave 1 and Wave 2 workflows listed there into:
- workflows/wave1-runtime/
- workflows/wave2-product/

Also read these requirements again before writing:
- docs/workflows/WORKFLOW_STANDARDS.md
- workflows/shared/WORKFLOW_AUTHORING_RULES.md
- workflows/meta/spec/generated-workflow-template.md

Constraints:
1. Only generate workflows assigned to Wave 1 or Wave 2.
2. Write files to disk.
3. Reflect the product truths around:
   - spec intake from Claude/CLI/MCP
   - no hand-authored workflow requirement for users
   - workflow abstraction and execution routing
4. Include deterministic gates and review stages.
5. For testable/code-writing workflows, explicitly encode 80-to-100 validation loops with initial run, fix loop, final gate, build/typecheck gate, regression gate, and final signoff artifact.
6. Change-detection gates must handle newly created untracked files as well as tracked edits.
7. Add deterministic review verdict gates after review artifacts are written.
8. Prefer detailed tasking over vague prompts. The generated workflows should feel ready for first real use, not like sketches.
9. Require deterministic verification after every meaningful edit phase, not just at the very end.
10. Keep each generated workflow narrow enough that failures are diagnosable quickly.
11. Do not print full workflow contents to stdout.

End by ensuring the planned Wave 1 and Wave 2 files exist on disk.`,
      verification: { type: 'exit_code' },
    })

    .step('generate-wave3-plus-workflows', {
      agent: 'meta-writer-codex',
      dependsOn: ['plan-generated-backlog'],
      task: `Read .workflow-artifacts/ricky-meta/application-wave-plan.md and generate the remaining first-batch workflows listed there for:
- workflows/wave3-cloud-api/
- workflows/wave4-local-byoh/
- workflows/wave5-scale-and-ops/

Also read these requirements again before writing:
- docs/workflows/WORKFLOW_STANDARDS.md
- workflows/shared/WORKFLOW_AUTHORING_RULES.md
- workflows/meta/spec/generated-workflow-template.md

Constraints:
1. Only generate workflows assigned to Waves 3, 4, or 5.
2. Write files to disk.
3. Cloud onboarding/connect flows must align with the product spec.
4. Local/BYOH flows must remain first-class.
5. For any implementation-oriented workflow, include 80-to-100 style validation and deterministic post-edit verification gates after every meaningful edit phase.
6. Include final signoff artifacts for these serious workflows so completion evidence is consistent across the batch.
7. Change-detection gates must handle newly created untracked files as well as tracked edits.
8. If a workflow covers onboarding or connection flows, require explicit user-visible proof or contract checks, not just internal code edits.
9. Add deterministic review verdict gates after review artifacts are written.
10. Do not print full workflow contents to stdout.

End by ensuring the planned files for these waves exist on disk.`,
      verification: { type: 'exit_code' },
    })

    .step('verify-generated-files-exist', {
      type: 'deterministic',
      dependsOn: ['generate-wave0-workflows', 'generate-wave1-wave2-workflows', 'generate-wave3-plus-workflows'],
      command: [
        'test -f .workflow-artifacts/ricky-meta/application-wave-plan.md',
        'count=$(find workflows/wave0-foundation workflows/wave1-runtime workflows/wave2-product workflows/wave3-cloud-api workflows/wave4-local-byoh workflows/wave5-scale-and-ops -maxdepth 1 -name "*.ts" | wc -l | tr -d " ")',
        'echo "GENERATED_COUNT:$count"',
        'test "$count" -ge 12',
        'echo "RICKY_GENERATED_FILES_PRESENT"',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('sanity-check-generated-workflows', {
      type: 'deterministic',
      dependsOn: ['verify-generated-files-exist'],
      command: `failed=0
for f in $(find workflows/wave0-foundation workflows/wave1-runtime workflows/wave2-product workflows/wave3-cloud-api workflows/wave4-local-byoh workflows/wave5-scale-and-ops -maxdepth 1 -name '*.ts' | sort); do
  echo "=== $f ==="
  grep -q "workflow(" "$f" || { echo "MISSING_WORKFLOW:$f"; failed=1; }
  grep -q ".channel('wf-ricky-" "$f" || { echo "MISSING_CHANNEL:$f"; failed=1; }
  grep -q ".run({ cwd: process.cwd() })" "$f" || { echo "MISSING_RUN_CWD:$f"; failed=1; }
  grep -q "type: 'deterministic'" "$f" || { echo "MISSING_DETERMINISTIC:$f"; failed=1; }
  grep -q "review" "$f" || { echo "MISSING_REVIEW:$f"; failed=1; }
  grep -Eq "Deliverables|deliverables" "$f" || { echo "MISSING_DELIVERABLES_CONTEXT:$f"; failed=1; }
  grep -Eq "Non-goals|non-goals" "$f" || { echo "MISSING_NON_GOALS:$f"; failed=1; }
  grep -Eq "Verification|verification" "$f" || { echo "MISSING_VERIFICATION_SECTION:$f"; failed=1; }
  if grep -Eq "impl|build|generate|debug|runtime|connect|api" "$f"; then
    grep -q "failOnError: false" "$f" || { echo "MISSING_INITIAL_SOFT_GATE:$f"; failed=1; }
    grep -Eq "fix|validate" "$f" || { echo "MISSING_FIX_LOOP:$f"; failed=1; }
    grep -q "failOnError: true" "$f" || { echo "MISSING_FINAL_HARD_GATE:$f"; failed=1; }
  fi
done
if [ "$failed" -ne 0 ]; then exit 1; fi
echo "RICKY_GENERATED_SANITY_PASS"`,
      captureOutput: true,
      failOnError: true,
    })

    .step('review-generated-workflows-claude', {
      agent: 'meta-reviewer-claude',
      dependsOn: ['sanity-check-generated-workflows'],
      task: `Review the generated Ricky workflows.

Read:
- .workflow-artifacts/ricky-meta/application-wave-plan.md
- docs/workflows/WORKFLOW_STANDARDS.md
- workflows/shared/WORKFLOW_AUTHORING_RULES.md
- workflows/meta/spec/generated-workflow-template.md
- all generated workflow files under the wave folders

Write .workflow-artifacts/ricky-meta/review-claude.md.

Assess:
1. Does the generated batch reflect Ricky's actual product shape?
2. Are CLI onboarding, Cloud connect, and spec handoff represented early enough?
3. Are workflows narrow, staged, and reviewable?
4. Do they appear structurally consistent with the template?
5. Do implementation-oriented workflows follow the 80-to-100 bar closely enough that first real test runs should need few iterations?
6. Are the task bodies detailed enough to avoid ambiguous agent behavior and shallow outputs?
7. Do all serious workflows end with consistent completion evidence, including final signoff artifacts?

End the file with either REVIEW_CLAUDE_PASS or REVIEW_CLAUDE_FAIL.`,
      verification: { type: 'file_exists', value: '.workflow-artifacts/ricky-meta/review-claude.md' },
    })

    .step('review-generated-workflows-codex', {
      agent: 'meta-reviewer-codex',
      dependsOn: ['sanity-check-generated-workflows'],
      task: `Review the generated Ricky workflows.

Read:
- .workflow-artifacts/ricky-meta/application-wave-plan.md
- docs/workflows/WORKFLOW_STANDARDS.md
- workflows/shared/WORKFLOW_AUTHORING_RULES.md
- workflows/meta/spec/generated-workflow-template.md
- all generated workflow files under the wave folders

Write .workflow-artifacts/ricky-meta/review-codex.md.

Assess:
1. Are the deterministic gates strong enough?
2. Are the workflow scopes practical?
3. Is the generated batch implementation-friendly rather than just aspirational?
4. Are there obvious structural inconsistencies across the generated files?
5. Do the generated workflows include detailed enough validation commands, fix loops, final hard gates, and signoff artifacts to minimize iteration when first tested?
6. Are the generated workflows explicit enough about deliverables, non-goals, and verification that agents are unlikely to wander?
7. Do change-detection gates correctly account for untracked first-run files?

End the file with either REVIEW_CODEX_PASS or REVIEW_CODEX_FAIL.`,
      verification: { type: 'file_exists', value: '.workflow-artifacts/ricky-meta/review-codex.md' },
    })

    .step('read-generated-reviews', {
      type: 'deterministic',
      dependsOn: ['review-generated-workflows-claude', 'review-generated-workflows-codex'],
      command: 'cat .workflow-artifacts/ricky-meta/review-claude.md .workflow-artifacts/ricky-meta/review-codex.md',
      captureOutput: true,
      failOnError: true,
    })
    .step('verify-review-verdicts', {
      type: 'deterministic',
      dependsOn: ['read-generated-reviews'],
      command: [
        'grep -Eq "REVIEW_CLAUDE_PASS$|REVIEW_CLAUDE_FAIL$" .workflow-artifacts/ricky-meta/review-claude.md',
        'grep -Eq "REVIEW_CODEX_PASS$|REVIEW_CODEX_FAIL$" .workflow-artifacts/ricky-meta/review-codex.md',
        'echo RICKY_META_REVIEW_VERDICTS_RECORDED',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('fix-generated-workflows', {
      agent: 'meta-validator-claude',
      dependsOn: ['verify-review-verdicts'],
      task: `Read the review output below and fix the generated workflows if needed.

{{steps.read-generated-reviews.output}}

Also re-read:
- docs/workflows/WORKFLOW_STANDARDS.md
- workflows/shared/WORKFLOW_AUTHORING_RULES.md
- workflows/meta/spec/generated-workflow-template.md

Rules:
1. If both reviews are effectively pass-level, only make targeted fixes if they identify real structural problems.
2. Keep the generated batch bounded.
3. Preserve the wave plan unless a workflow is clearly misplaced.
4. Write changes to disk and do not print the full files.
5. Focus on structural correctness and dry-run viability.

Exit only after the generated workflows are ready for final dry-run validation.`,
      verification: { type: 'exit_code' },
    })

    .step('dry-run-generated-workflows', {
      type: 'deterministic',
      dependsOn: ['fix-generated-workflows'],
      command: `failed=0
mkdir -p .workflow-artifacts/ricky-meta/dryrun
for f in $(find workflows/wave0-foundation workflows/wave1-runtime workflows/wave2-product workflows/wave3-cloud-api workflows/wave4-local-byoh workflows/wave5-scale-and-ops -maxdepth 1 -name '*.ts' | sort); do
  base=$(basename "$f" .ts)
  echo "=== DRY RUN $f ==="
  if ! agent-relay run --dry-run "$f" > ".workflow-artifacts/ricky-meta/dryrun/$base.txt" 2>&1; then
    echo "DRYRUN_FAIL:$f"
    failed=1
  else
    echo "DRYRUN_PASS:$f"
  fi
done
if [ "$failed" -ne 0 ]; then exit 1; fi
echo "RICKY_GENERATED_DRYRUN_PASS"`,
      captureOutput: true,
      failOnError: false,
    })

    .step('final-signoff', {
      agent: 'meta-lead-claude',
      dependsOn: ['dry-run-generated-workflows'],
      task: `Write the final signoff at .workflow-artifacts/ricky-meta/signoff.md.

Inputs to consider:
- .workflow-artifacts/ricky-meta/application-wave-plan.md
- .workflow-artifacts/ricky-meta/review-claude.md
- .workflow-artifacts/ricky-meta/review-codex.md
- dry-run output summary from the prior step:
{{steps.dry-run-generated-workflows.output}}

Requirements:
1. State whether the generated Ricky application wave backlog is ready for human review.
2. Mention whether dry-run passed fully or where it failed.
3. Call out any workflows that still look under-specified or likely to require extra iteration.
4. Keep the verdict honest.
5. End with either META_SIGNOFF_PASS or META_SIGNOFF_FAIL.

IMPORTANT: write the file to disk.`,
      verification: { type: 'file_exists', value: '.workflow-artifacts/ricky-meta/signoff.md' },
    })

    .step('verify-signoff-artifact', {
      type: 'deterministic',
      dependsOn: ['final-signoff'],
      command: [
        'test -f .workflow-artifacts/ricky-meta/signoff.md',
        'grep -Eq "META_SIGNOFF_PASS|META_SIGNOFF_FAIL" .workflow-artifacts/ricky-meta/signoff.md',
        'echo "RICKY_META_SIGNOFF_RECORDED"',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .run({ cwd: process.cwd() });

  console.log(result.status);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
