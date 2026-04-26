import { workflow } from '@agent-relay/sdk/workflows';

async function main() {
  const result = await workflow('ricky-wave6-close-first-wave-signoff-and-blockers')
    .description('Audit the remaining unsigned first-wave Ricky workflows, classify their status honestly, and produce the signoff-or-blocker closure plan that establishes the real Wave 6 starting line.')
    .pattern('dag')
    .channel('wf-ricky-wave6-signoff-closure')
    .maxConcurrency(4)
    .timeout(3_600_000)
    .onError('retry', { maxRetries: 2, retryDelayMs: 10_000 })

    .agent('lead-claude', {
      cli: 'claude',
      interactive: false,
      role: 'Proof lead who turns Ricky’s remaining unsigned first-wave workflows into an explicit closure program with signoff or blocker outcomes.',
      retries: 1,
    })
    .agent('writer-primary-codex', {
      cli: 'codex',
      role: 'Primary writer for the signoff closure workflow, audit summary, and blocker/signoff output contract.',
      retries: 2,
    })
    .agent('reviewer-claude', {
      cli: 'claude',
      preset: 'reviewer',
      role: 'Reviews proof quality, taxonomy use, and whether the workflow is honest about incomplete versus blocked work.',
      retries: 1,
    })
    .agent('reviewer-codex', {
      cli: 'codex',
      preset: 'reviewer',
      role: 'Reviews deterministic gates, artifact shape, and workflow readiness for real Ricky signoff closure runs.',
      retries: 1,
    })
    .agent('validator-claude', {
      cli: 'claude',
      preset: 'worker',
      role: 'Runs the 80-to-100 validation loop, tightens the closure workflow, and writes the final signoff artifact.',
      retries: 2,
    })

    .step('prepare-artifacts', {
      type: 'deterministic',
      command: [
        'mkdir -p .workflow-artifacts/wave6-proof/close-first-wave-signoff-and-blockers',
        'mkdir -p workflows/wave6-proof',
        'echo WAVE6_SIGNOFF_BLOCKER_CLOSURE_READY',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })
    .step('read-backlog-plan', {
      type: 'deterministic',
      dependsOn: ['prepare-artifacts'],
      command: 'cat docs/product/ricky-next-wave-backlog-and-proof-plan.md',
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
    .step('read-failure-taxonomy', {
      type: 'deterministic',
      dependsOn: ['prepare-artifacts'],
      command: 'cat docs/architecture/ricky-failure-taxonomy-and-unblockers.md',
      captureOutput: true,
      failOnError: true,
    })
    .step('inventory-first-wave-workflows', {
      type: 'deterministic',
      dependsOn: ['prepare-artifacts'],
      command: 'find workflows/wave0-foundation workflows/wave1-runtime workflows/wave2-product workflows/wave3-cloud-api workflows/wave4-local-byoh workflows/wave5-scale-and-ops -maxdepth 1 -name "*.ts" | sort',
      captureOutput: true,
      failOnError: true,
    })
    .step('inventory-existing-signoff-artifacts', {
      type: 'deterministic',
      dependsOn: ['prepare-artifacts'],
      command: 'find .workflow-artifacts/wave0-foundation .workflow-artifacts/wave1-runtime .workflow-artifacts/wave2-product .workflow-artifacts/wave3-cloud-api .workflow-artifacts/wave4-local-byoh .workflow-artifacts/wave5-scale-and-ops -maxdepth 2 \\( -name "signoff.md" -o -name "blocker.md" -o -name "*blocker*.md" \\) | sort 2>/dev/null || true',
      captureOutput: true,
      failOnError: true,
    })

    .step('lead-plan', {
      agent: 'lead-claude',
      dependsOn: ['read-backlog-plan', 'read-workflow-standards', 'read-failure-taxonomy', 'inventory-first-wave-workflows', 'inventory-existing-signoff-artifacts'],
      task: `Plan the Ricky Wave 6 signoff-and-blocker closure workflow.

Context inputs:
- next-wave backlog and proof plan:
{{steps.read-backlog-plan.output}}
- workflow standards:
{{steps.read-workflow-standards.output}}
- failure taxonomy:
{{steps.read-failure-taxonomy.output}}
- first-wave workflow inventory:
{{steps.inventory-first-wave-workflows.output}}
- existing signoff/blocker artifacts:
{{steps.inventory-existing-signoff-artifacts.output}}

Deliverables:
- workflows/wave6-proof/01-close-first-wave-signoff-and-blockers.ts

The workflow must:
- audit all first-wave product-build workflows lacking per-workflow signoff
- distinguish signed off, implemented-but-underproved, and blocked states
- require blocker artifacts to use Ricky’s existing failure taxonomy
- require a summary artifact listing every audited workflow and its final state
- make validation commands, changed-file scope proof, and signoff-or-blocker artifact paths explicit
- avoid pretending all unsigned workflows can be auto-signed in one pass without review

Non-goals:
- Do not implement the actual closure sweep in this workflow.
- Do not create wave7 or unrelated roadmap work.
- Do not collapse blocker states into vague prose.

Verification:
- The authored workflow should be bounded, deterministic where possible, and ready for real unattended execution with reviewer gates.
- It must produce a summary artifact plus per-workflow closure outputs.
- It must keep edits scoped to the new workflow file and its local artifacts.

Write .workflow-artifacts/wave6-proof/close-first-wave-signoff-and-blockers/plan.md ending with WAVE6_SIGNOFF_BLOCKER_PLAN_READY.`,
      verification: { type: 'file_exists', value: '.workflow-artifacts/wave6-proof/close-first-wave-signoff-and-blockers/plan.md' },
    })

    .step('write-signoff-closure-workflow', {
      agent: 'writer-primary-codex',
      dependsOn: ['lead-plan'],
      task: `Write the Ricky Wave 6 workflow that closes first-wave signoff and blocker truth.

Deliverables:
- workflows/wave6-proof/01-close-first-wave-signoff-and-blockers.ts

Requirements:
- Follow Ricky workflow standards and use the real workflow(...) authoring pattern.
- Read the next-wave backlog, workflow standards, failure taxonomy, and current first-wave artifact inventory.
- Require a deterministic inventory of unsigned workflows and current signoff coverage.
- Author steps that produce:
  - a closure summary artifact covering every unsigned first-wave workflow
  - a per-workflow signoff artifact when closure is validated
  - or a per-workflow blocker artifact with taxonomy classification when closure is blocked
- Include reviewer and final-review gates that explicitly verify no workflow remains in ambiguous limbo.
- Include regression/change-scope gates that keep edits limited to the new wave6 workflow and its own artifacts.
- End with a final signoff artifact for this workflow.

Non-goals:
- Do not attempt to close all historical workflows inline in this authoring workflow.
- Do not mutate product code outside this new workflow file.
- Do not treat compile-only evidence as sufficient closure.

Verification:
- The workflow must mention signoff, blocker classification, summary artifact, validation commands, and changed-file scope proof.
- It must be specific enough to run later without rediscovering the closure protocol.`,
      verification: { type: 'file_exists', value: 'workflows/wave6-proof/01-close-first-wave-signoff-and-blockers.ts' },
    })
    .step('post-write-file-gate', {
      type: 'deterministic',
      dependsOn: ['write-signoff-closure-workflow'],
      command: [
        'test -f workflows/wave6-proof/01-close-first-wave-signoff-and-blockers.ts',
        'grep -q "signoff" workflows/wave6-proof/01-close-first-wave-signoff-and-blockers.ts',
        'grep -q "blocker" workflows/wave6-proof/01-close-first-wave-signoff-and-blockers.ts',
        'grep -q "summary" workflows/wave6-proof/01-close-first-wave-signoff-and-blockers.ts',
        'grep -q "validation" workflows/wave6-proof/01-close-first-wave-signoff-and-blockers.ts',
        'grep -q "changed-file\\|regression" workflows/wave6-proof/01-close-first-wave-signoff-and-blockers.ts',
        'echo WAVE6_SIGNOFF_BLOCKER_WORKFLOW_PRESENT',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('review-workflow-claude', {
      agent: 'reviewer-claude',
      dependsOn: ['post-write-file-gate'],
      task: `Review the Ricky Wave 6 signoff/blocker closure workflow.

Focus:
- Is it honest about what closure means?
- Does it preserve the proof bar instead of hiding uncertainty?
- Does it use the failure taxonomy correctly for blocker states?
- Does it prevent unsigned workflows from remaining in vague limbo?

Write .workflow-artifacts/wave6-proof/close-first-wave-signoff-and-blockers/review-claude.md ending with REVIEW_CLAUDE_PASS or REVIEW_CLAUDE_FAIL.`,
      verification: { type: 'file_exists', value: '.workflow-artifacts/wave6-proof/close-first-wave-signoff-and-blockers/review-claude.md' },
    })
    .step('review-workflow-codex', {
      agent: 'reviewer-codex',
      dependsOn: ['post-write-file-gate'],
      task: `Review the Ricky Wave 6 signoff/blocker closure workflow.

Focus:
- Is the workflow specific enough to execute deterministically?
- Are the summary, signoff, and blocker artifact contracts clear?
- Are the change-scope and final-review gates tight enough?
- Is the workflow ready to become a real closure sweep without structural ambiguity?

Write .workflow-artifacts/wave6-proof/close-first-wave-signoff-and-blockers/review-codex.md ending with REVIEW_CODEX_PASS or REVIEW_CODEX_FAIL.`,
      verification: { type: 'file_exists', value: '.workflow-artifacts/wave6-proof/close-first-wave-signoff-and-blockers/review-codex.md' },
    })

    .step('read-review-feedback', {
      type: 'deterministic',
      dependsOn: ['review-workflow-claude', 'review-workflow-codex'],
      command: 'cat .workflow-artifacts/wave6-proof/close-first-wave-signoff-and-blockers/review-claude.md .workflow-artifacts/wave6-proof/close-first-wave-signoff-and-blockers/review-codex.md',
      captureOutput: true,
      failOnError: true,
    })
    .step('fix-workflow', {
      agent: 'validator-claude',
      dependsOn: ['read-review-feedback'],
      task: `Fix Ricky Wave 6 signoff/blocker closure workflow issues from review feedback.

Review feedback:
{{steps.read-review-feedback.output}}

Rules:
- Keep the workflow bounded and quality-first.
- Preserve the requirement that every audited workflow ends as signoff, blocker, or explicitly implemented-but-underproved in the summary.
- Keep taxonomy use explicit for blockers.
- Do not broaden scope beyond the closure sweep contract.`,
      verification: { type: 'exit_code', value: '0' },
    })
    .step('post-fix-verification-gate', {
      type: 'deterministic',
      dependsOn: ['fix-workflow'],
      command: [
        'test -f workflows/wave6-proof/01-close-first-wave-signoff-and-blockers.ts',
        'grep -q "implemented-but-underproved\\|underproved" workflows/wave6-proof/01-close-first-wave-signoff-and-blockers.ts',
        'grep -q "summary" workflows/wave6-proof/01-close-first-wave-signoff-and-blockers.ts',
        'grep -q "taxonomy" workflows/wave6-proof/01-close-first-wave-signoff-and-blockers.ts',
        'echo WAVE6_SIGNOFF_BLOCKER_POST_FIX_PASS',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('final-review-workflow-claude', {
      agent: 'reviewer-claude',
      dependsOn: ['post-fix-verification-gate'],
      task: `Re-review the Ricky Wave 6 signoff/blocker closure workflow after fixes.

Confirm it is honest, proof-oriented, and ready to drive the real signoff closure sweep.
Write .workflow-artifacts/wave6-proof/close-first-wave-signoff-and-blockers/final-review-claude.md ending with FINAL_REVIEW_CLAUDE_PASS or FINAL_REVIEW_CLAUDE_FAIL.`,
      verification: { type: 'file_exists', value: '.workflow-artifacts/wave6-proof/close-first-wave-signoff-and-blockers/final-review-claude.md' },
    })
    .step('final-review-workflow-codex', {
      agent: 'reviewer-codex',
      dependsOn: ['post-fix-verification-gate'],
      task: `Re-review the Ricky Wave 6 signoff/blocker closure workflow after fixes.

Confirm it is precise, bounded, and execution-ready.
Write .workflow-artifacts/wave6-proof/close-first-wave-signoff-and-blockers/final-review-codex.md ending with FINAL_REVIEW_CODEX_PASS or FINAL_REVIEW_CODEX_FAIL.`,
      verification: { type: 'file_exists', value: '.workflow-artifacts/wave6-proof/close-first-wave-signoff-and-blockers/final-review-codex.md' },
    })
    .step('final-review-pass-gate', {
      type: 'deterministic',
      dependsOn: ['final-review-workflow-claude', 'final-review-workflow-codex'],
      command: [
        'tail -n 1 .workflow-artifacts/wave6-proof/close-first-wave-signoff-and-blockers/final-review-claude.md | tr -d "[:space:]*" | grep -Eq "^FINAL_REVIEW_CLAUDE_PASS$"',
        'tail -n 1 .workflow-artifacts/wave6-proof/close-first-wave-signoff-and-blockers/final-review-codex.md | tr -d "[:space:]*" | grep -Eq "^FINAL_REVIEW_CODEX_PASS$"',
        'echo WAVE6_SIGNOFF_BLOCKER_FINAL_REVIEW_PASS',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })
    .step('regression-gate', {
      type: 'deterministic',
      dependsOn: ['final-review-pass-gate'],
      command: [
        'changed="$(git diff --name-only; git ls-files --others --exclude-standard)"',
        'printf "%s\\n" "$changed" | grep -Eq "^(workflows/wave6-proof/01-close-first-wave-signoff-and-blockers\\.ts)$"',
        '! printf "%s\\n" "$changed" | grep -Ev "^(workflows/wave6-proof/01-close-first-wave-signoff-and-blockers\\.ts|\\.workflow-artifacts/)"',
        'echo WAVE6_SIGNOFF_BLOCKER_REGRESSION_GATE_PASS',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })
    .step('final-signoff', {
      agent: 'validator-claude',
      dependsOn: ['regression-gate'],
      task: `Write .workflow-artifacts/wave6-proof/close-first-wave-signoff-and-blockers/signoff.md.

Include:
- why first-wave signoff closure is the true Wave 6 starting line
- the closure protocol for signoff vs blocker outcomes
- the non-negotiable proof bar for audited workflows

End with WAVE6_SIGNOFF_BLOCKER_WORKFLOW_COMPLETE.`,
      verification: { type: 'file_exists', value: '.workflow-artifacts/wave6-proof/close-first-wave-signoff-and-blockers/signoff.md' },
    })

    .run({ cwd: process.cwd() });

  console.log(result.status);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
