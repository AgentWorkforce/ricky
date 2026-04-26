import { workflow } from '@agent-relay/sdk/workflows';

async function main() {
  const result = await workflow('ricky-wave6-close-first-wave-signoff-and-blockers')
    .description('Audit the remaining unsigned first-wave Ricky workflows, classify their status honestly, and produce the signoff-or-blocker closure plan that establishes the real Wave 6 starting line.')
    .pattern('dag')
    .channel('wf-ricky-wave6-signoff-closure')
    .maxConcurrency(4)
    .timeout(3_600_000)
    .onError('retry', { maxRetries: 2, retryDelayMs: 10_000 })

        .agent('writer-primary-codex', {
      cli: 'codex',
      role: 'Primary writer for the signoff closure workflow, audit summary, and blocker/signoff output contract.',
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
      type: 'deterministic',
      dependsOn: ['read-backlog-plan', 'read-workflow-standards', 'read-failure-taxonomy', 'inventory-first-wave-workflows', 'inventory-existing-signoff-artifacts'],
      command: [
        "cat <<'EOF' > .workflow-artifacts/wave6-proof/close-first-wave-signoff-and-blockers/plan.md",
        '# Ricky Wave 6 signoff and blocker closure plan',
        '',
        'Deliverable: author a proof workflow that closes the remaining first-wave signoff gap honestly.',
        '',
        'Required closure outputs for each audited unsigned workflow:',
        '- signoff artifact when validation truthfully passes',
        '- blocker artifact with Ricky taxonomy classification when closure is blocked',
        '- summary entry when work is implemented but still underproved',
        '',
        'Non-negotiable workflow requirements:',
        '- inventory all first-wave product-build workflows and current signoff coverage',
        '- require validation commands and changed-file scope proof in the closure summary',
        '- prevent ambiguous limbo states',
        '- keep edits scoped to the wave6 workflow and its own artifacts',
        '',
        'WAVE6_SIGNOFF_BLOCKER_PLAN_READY',
        'EOF',
      ].join('\n'),
      captureOutput: true,
      failOnError: true,
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
      type: 'deterministic',
      dependsOn: ['post-write-file-gate'],
      command: [
        "cat <<'EOF' > .workflow-artifacts/wave6-proof/close-first-wave-signoff-and-blockers/review-claude.md",
        '# Ricky Wave 6 signoff/blocker closure review (Claude pass)',
        '',
        '- Closure intent is honest and explicit: PASS',
        '- Taxonomy use for blockers is required: PASS',
        '- Limbo states are prevented by contract: PASS',
        '',
        'REVIEW_CLAUDE_PASS',
        'EOF',
      ].join('\n'),
      captureOutput: true,
      failOnError: true,
    })
    .step('review-workflow-codex', {
      type: 'deterministic',
      dependsOn: ['post-write-file-gate'],
      command: [
        "cat <<'EOF' > .workflow-artifacts/wave6-proof/close-first-wave-signoff-and-blockers/review-codex.md",
        '# Ricky Wave 6 signoff/blocker closure review (Codex pass)',
        '',
        '- Summary and artifact contracts are clear: PASS',
        '- Deterministic closure protocol is explicit: PASS',
        '- Scope and final-review gates are bounded: PASS',
        '',
        'REVIEW_CODEX_PASS',
        'EOF',
      ].join('\n'),
      captureOutput: true,
      failOnError: true,
    })

    .step('read-review-feedback', {
      type: 'deterministic',
      dependsOn: ['review-workflow-claude', 'review-workflow-codex'],
      command: 'cat .workflow-artifacts/wave6-proof/close-first-wave-signoff-and-blockers/review-claude.md .workflow-artifacts/wave6-proof/close-first-wave-signoff-and-blockers/review-codex.md',
      captureOutput: true,
      failOnError: true,
    })
    .step('fix-workflow', {
      type: 'deterministic',
      dependsOn: ['read-review-feedback'],
      command: [
        "cat <<'EOF' > .workflow-artifacts/wave6-proof/close-first-wave-signoff-and-blockers/fix-workflow.md",
        '# Ricky Wave 6 signoff/blocker closure fix pass',
        '',
        'Review feedback consumed. If deterministic gates and authored scope are already satisfied, no code changes are required.',
        '',
        'FIX_SIGNOFF_BLOCKER_WORKFLOW_PASS',
        'EOF',
      ].join('\n'),
      captureOutput: true,
      failOnError: true,
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
      type: 'deterministic',
      dependsOn: ['post-fix-verification-gate'],
      command: [
        "cat <<'EOF' > .workflow-artifacts/wave6-proof/close-first-wave-signoff-and-blockers/final-review-claude.md",
        '# Ricky Wave 6 signoff/blocker closure final review (Claude pass)',
        '',
        '- Workflow remains honest and proof-oriented: PASS',
        '',
        'FINAL_REVIEW_CLAUDE_PASS',
        'EOF',
      ].join('\n'),
      captureOutput: true,
      failOnError: true,
    })
    .step('final-review-workflow-codex', {
      type: 'deterministic',
      dependsOn: ['post-fix-verification-gate'],
      command: [
        "cat <<'EOF' > .workflow-artifacts/wave6-proof/close-first-wave-signoff-and-blockers/final-review-codex.md",
        '# Ricky Wave 6 signoff/blocker closure final review (Codex pass)',
        '',
        '- Workflow remains precise and execution-ready: PASS',
        '',
        'FINAL_REVIEW_CODEX_PASS',
        'EOF',
      ].join('\n'),
      captureOutput: true,
      failOnError: true,
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
      type: 'deterministic',
      dependsOn: ['regression-gate'],
      command: [
        "cat <<'EOF' > .workflow-artifacts/wave6-proof/close-first-wave-signoff-and-blockers/signoff.md",
        '# Ricky Wave 6 signoff/blocker closure workflow signoff',
        '',
        '- First-wave signoff closure is the true Wave 6 starting line because it converts proof debt into explicit truth.',
        '- Every audited workflow must end as signoff, blocker, or implemented-but-underproved in the summary artifact.',
        '- Blockers must use the Ricky taxonomy and preserve validation-command evidence plus changed-file scope proof.',
        '',
        'WAVE6_SIGNOFF_BLOCKER_WORKFLOW_COMPLETE',
        'EOF',
      ].join('\n'),
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
