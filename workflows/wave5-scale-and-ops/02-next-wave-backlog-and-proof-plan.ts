import { workflow } from '@agent-relay/sdk/workflows';

async function main() {
  const result = await workflow('ricky-wave5-next-wave-backlog-and-proof-plan')
    .description('Author the explicit follow-on Ricky backlog and proof plan after the first 16-workflow wave, covering what comes next beyond the current bounded batch.')
    .pattern('dag')
    .channel('wf-ricky-wave5-next-wave-plan')
    .maxConcurrency(4)
    .timeout(3_600_000)
    .onError('retry', { maxRetries: 2, retryDelayMs: 10_000 })

    .agent('lead-claude', {
      cli: 'claude',
      role: 'Roadmap lead who turns Ricky’s remaining product gaps into an explicit next-wave backlog and proof plan.',
      retries: 1,
    })
    .agent('writer-primary-codex', {
      cli: 'codex',
      role: 'Primary writer for the next-wave backlog doc, execution priorities, and proof expectations.',
      retries: 2,
    })
    .agent('reviewer-claude', {
      cli: 'claude',
      preset: 'reviewer',
      role: 'Reviews product sequencing, proof quality, and user value.',
      retries: 1,
    })
    .agent('reviewer-codex', {
      cli: 'codex',
      preset: 'reviewer',
      role: 'Reviews specificity, workflow readiness, and deterministic planning quality.',
      retries: 1,
    })
    .agent('validator-claude', {
      cli: 'claude',
      preset: 'worker',
      role: 'Runs the planning doc 80-to-100 loop and final signoff for the next Ricky wave plan.',
      retries: 2,
    })

    .step('prepare-artifacts', {
      type: 'deterministic',
      command: [
        'mkdir -p .workflow-artifacts/wave5-scale-and-ops/next-wave-backlog-and-proof-plan',
        'mkdir -p docs/product',
        'echo RICKY_NEXT_WAVE_PLAN_READY',
      ].join(' && '),
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
    .step('read-current-workflows', {
      type: 'deterministic',
      dependsOn: ['prepare-artifacts'],
      command: 'find workflows/wave0-foundation workflows/wave1-runtime workflows/wave2-product workflows/wave3-cloud-api workflows/wave4-local-byoh workflows/wave5-scale-and-ops -maxdepth 1 -name "*.ts" | sort',
      captureOutput: true,
      failOnError: true,
    })
    .step('read-failure-taxonomy', {
      type: 'deterministic',
      dependsOn: ['prepare-artifacts'],
      command: 'cat docs/architecture/ricky-failure-taxonomy-and-unblockers.md',
      captureOutput: true,
      failOnError: true,
    })
    .step('read-meta-plan-context', {
      type: 'deterministic',
      dependsOn: ['prepare-artifacts'],
      command: 'cat .workflow-artifacts/ricky-meta/application-wave-plan.md 2>/dev/null || true && printf "\n\n---\n\n" && cat README.md',
      captureOutput: true,
      failOnError: true,
    })

    .step('lead-plan', {
      agent: 'lead-claude',
      dependsOn: ['read-product-spec', 'read-current-workflows', 'read-failure-taxonomy', 'read-meta-plan-context'],
      task: `Plan the next Ricky wave backlog and proof plan.

Context inputs:
- SPEC.md:
{{steps.read-product-spec.output}}
- current workflow inventory:
{{steps.read-current-workflows.output}}
- Ricky failure taxonomy:
{{steps.read-failure-taxonomy.output}}
- meta plan and repo context:
{{steps.read-meta-plan-context.output}}

Deliverables:
- docs/product/ricky-next-wave-backlog-and-proof-plan.md

The document must include:
- what the first 16-workflow wave already covers
- what product/workflow gaps remain
- candidate follow-on workflows grouped into a sane next wave
- proof expectations for each follow-on area
- sequencing and dependency notes
- which items are spec-only, implementation, validation, or proof workflows
- a recommendation for what should be built immediately after the CLI onboarding UX spec

Non-goals:
- Do not claim Ricky is complete.
- Do not create an unbounded giant wishlist.
- Do not collapse proof work into mere compile/test claims.

Verification:
- The backlog must explicitly connect remaining work to Ricky’s product goals and failure taxonomy.
- It must identify what needs real 80-to-100 execution proof versus what is still spec scaffolding.
- It must be bounded enough to become follow-on workflow files without ambiguity.

Commit/PR boundary:
- Keep edits scoped to docs/product/ricky-next-wave-backlog-and-proof-plan.md.

Write .workflow-artifacts/wave5-scale-and-ops/next-wave-backlog-and-proof-plan/plan.md ending with NEXT_WAVE_PLAN_PLAN_READY.`,
      verification: { type: 'file_exists', value: '.workflow-artifacts/wave5-scale-and-ops/next-wave-backlog-and-proof-plan/plan.md' },
    })

    .step('write-next-wave-plan', {
      agent: 'writer-primary-codex',
      dependsOn: ['lead-plan'],
      task: `Write the explicit Ricky next-wave backlog and proof plan.

Deliverables:
- docs/product/ricky-next-wave-backlog-and-proof-plan.md

Requirements:
- Summarize the current first-wave status accurately.
- Call out that the CLI/banner UX spec is its own near-term deliverable.
- Identify the next concrete workflows or proof workflows Ricky should get after that.
- Cover product areas like implementation follow-through, onboarding proof, real runtime/e2e validation, environment recovery/unblockers, Cloud/local parity, and analytics/proof loops where applicable.
- For each follow-on area, include why it matters, what success looks like, and what evidence/proof is required.
- Recommend a bounded next batch rather than an open-ended backlog dump.

Non-goals:
- Do not generate actual follow-on workflow files in this workflow.
- Do not restate the whole product spec.
- Do not leave next steps as vague slogans.

Verification:
- The document must include a prioritized list, proof expectations, and sequencing.
- It must mention workflow proof, onboarding proof, local/BYOH, Cloud, and environment/failure recovery as applicable.
- It must be specific enough that later workflow authoring can proceed from it without rediscovery.`,
      verification: { type: 'file_exists', value: 'docs/product/ricky-next-wave-backlog-and-proof-plan.md' },
    })
    .step('post-write-file-gate', {
      type: 'deterministic',
      dependsOn: ['write-next-wave-plan'],
      command: [
        'test -f docs/product/ricky-next-wave-backlog-and-proof-plan.md',
        'grep -qi "16-workflow\|first wave\|current wave" docs/product/ricky-next-wave-backlog-and-proof-plan.md',
        'grep -qi "CLI\|banner\|onboarding" docs/product/ricky-next-wave-backlog-and-proof-plan.md',
        'grep -qi "proof\|80-to-100\|validation" docs/product/ricky-next-wave-backlog-and-proof-plan.md',
        'grep -qi "local\|BYOH" docs/product/ricky-next-wave-backlog-and-proof-plan.md',
        'grep -qi "Cloud" docs/product/ricky-next-wave-backlog-and-proof-plan.md',
        'grep -qi "failure\|recovery\|unblock" docs/product/ricky-next-wave-backlog-and-proof-plan.md',
        'grep -qi "priority\|sequence\|dependency" docs/product/ricky-next-wave-backlog-and-proof-plan.md',
        'echo NEXT_WAVE_PLAN_FILE_PRESENT',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('review-next-wave-plan-claude', {
      agent: 'reviewer-claude',
      dependsOn: ['post-write-file-gate'],
      task: `Review the Ricky next-wave backlog and proof plan.

Focus:
- Does it identify the right remaining work after the first wave?
- Is the sequencing believable and quality-first?
- Does it maintain the proof bar instead of falling back to compile-only progress?
- Does it clearly say what should come after the CLI onboarding UX spec?

Write .workflow-artifacts/wave5-scale-and-ops/next-wave-backlog-and-proof-plan/review-claude.md ending with REVIEW_CLAUDE_PASS or REVIEW_CLAUDE_FAIL.`,
      verification: { type: 'file_exists', value: '.workflow-artifacts/wave5-scale-and-ops/next-wave-backlog-and-proof-plan/review-claude.md' },
    })
    .step('review-next-wave-plan-codex', {
      agent: 'reviewer-codex',
      dependsOn: ['post-write-file-gate'],
      task: `Review the Ricky next-wave backlog and proof plan.

Focus:
- Is it precise enough to drive future workflow authoring?
- Are proof expectations concrete and scoped?
- Does it avoid hand-wavy backlog sprawl?
- Is the prioritization actionable?

Write .workflow-artifacts/wave5-scale-and-ops/next-wave-backlog-and-proof-plan/review-codex.md ending with REVIEW_CODEX_PASS or REVIEW_CODEX_FAIL.`,
      verification: { type: 'file_exists', value: '.workflow-artifacts/wave5-scale-and-ops/next-wave-backlog-and-proof-plan/review-codex.md' },
    })

    .step('read-review-feedback', {
      type: 'deterministic',
      dependsOn: ['review-next-wave-plan-claude', 'review-next-wave-plan-codex'],
      command: 'cat .workflow-artifacts/wave5-scale-and-ops/next-wave-backlog-and-proof-plan/review-claude.md .workflow-artifacts/wave5-scale-and-ops/next-wave-backlog-and-proof-plan/review-codex.md',
      captureOutput: true,
      failOnError: true,
    })
    .step('fix-next-wave-plan', {
      agent: 'validator-claude',
      dependsOn: ['read-review-feedback'],
      task: `Fix Ricky next-wave backlog and proof plan issues from review feedback.

Review feedback:
{{steps.read-review-feedback.output}}

Rules:
- Keep the backlog bounded and actionable.
- Preserve the quality-first proof bar.
- Make sequencing and evidence expectations clearer where needed.
- Do not turn the plan into an unbounded wishlist.`,
      verification: { type: 'exit_code', value: '0' },
    })
    .step('post-fix-verification-gate', {
      type: 'deterministic',
      dependsOn: ['fix-next-wave-plan'],
      command: [
        'test -f docs/product/ricky-next-wave-backlog-and-proof-plan.md',
        'grep -qi "proof\|80-to-100\|validation" docs/product/ricky-next-wave-backlog-and-proof-plan.md',
        'grep -qi "priority\|sequence\|dependency" docs/product/ricky-next-wave-backlog-and-proof-plan.md',
        'grep -qi "CLI\|banner\|onboarding" docs/product/ricky-next-wave-backlog-and-proof-plan.md',
        'echo NEXT_WAVE_PLAN_POST_FIX_GATE_PASS',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('final-review-next-wave-plan-claude', {
      agent: 'reviewer-claude',
      dependsOn: ['post-fix-verification-gate'],
      task: `Re-review the Ricky next-wave backlog and proof plan after fixes.

Confirm it is product-aligned, quality-first, and ready to drive follow-on workflow authoring.
Write .workflow-artifacts/wave5-scale-and-ops/next-wave-backlog-and-proof-plan/final-review-claude.md ending with FINAL_REVIEW_CLAUDE_PASS or FINAL_REVIEW_CLAUDE_FAIL.`,
      verification: { type: 'file_exists', value: '.workflow-artifacts/wave5-scale-and-ops/next-wave-backlog-and-proof-plan/final-review-claude.md' },
    })
    .step('final-review-next-wave-plan-codex', {
      agent: 'reviewer-codex',
      dependsOn: ['post-fix-verification-gate'],
      task: `Re-review the Ricky next-wave backlog and proof plan after fixes.

Confirm it is precise, bounded, and implementation-ready for follow-on workflow authoring.
Write .workflow-artifacts/wave5-scale-and-ops/next-wave-backlog-and-proof-plan/final-review-codex.md ending with FINAL_REVIEW_CODEX_PASS or FINAL_REVIEW_CODEX_FAIL.`,
      verification: { type: 'file_exists', value: '.workflow-artifacts/wave5-scale-and-ops/next-wave-backlog-and-proof-plan/final-review-codex.md' },
    })
    .step('final-review-pass-gate', {
      type: 'deterministic',
      dependsOn: ['final-review-next-wave-plan-claude', 'final-review-next-wave-plan-codex'],
      command: [
        'tail -n 1 .workflow-artifacts/wave5-scale-and-ops/next-wave-backlog-and-proof-plan/final-review-claude.md | grep -Eq "^FINAL_REVIEW_CLAUDE_PASS$"',
        'tail -n 1 .workflow-artifacts/wave5-scale-and-ops/next-wave-backlog-and-proof-plan/final-review-codex.md | grep -Eq "^FINAL_REVIEW_CODEX_PASS$"',
        'echo NEXT_WAVE_PLAN_FINAL_REVIEW_PASS',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })
    .step('regression-gate', {
      type: 'deterministic',
      dependsOn: ['final-review-pass-gate'],
      command: [
        'changed="$(git diff --name-only; git ls-files --others --exclude-standard)"',
        'printf "%s\n" "$changed" | grep -Eq "^(docs/product/ricky-next-wave-backlog-and-proof-plan\.md)$"',
        '! printf "%s\n" "$changed" | grep -Ev "^(docs/product/ricky-next-wave-backlog-and-proof-plan\.md|\.workflow-artifacts/)"',
        'echo NEXT_WAVE_PLAN_REGRESSION_GATE_PASS',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })
    .step('final-signoff', {
      agent: 'validator-claude',
      dependsOn: ['regression-gate'],
      task: `Write .workflow-artifacts/wave5-scale-and-ops/next-wave-backlog-and-proof-plan/signoff.md.

Include the recommended next sequence, why it matters, and what proof bar remains non-negotiable.
End with NEXT_WAVE_PLAN_COMPLETE.`,
      verification: { type: 'file_exists', value: '.workflow-artifacts/wave5-scale-and-ops/next-wave-backlog-and-proof-plan/signoff.md' },
    })

    .run({ cwd: process.cwd() });

  console.log(result.status);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
