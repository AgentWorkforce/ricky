import { workflow } from '@agent-relay/sdk/workflows';

async function main() {
  const result = await workflow('ricky-wave4-cli-onboarding-ux-spec')
    .description('Author the dedicated Ricky CLI onboarding UX spec, including banner behavior, copy, first-run flow, local/BYOH versus Cloud guidance, and handoff paths from Claude, CLI, and MCP.')
    .pattern('dag')
    .channel('wf-ricky-wave4-cli-ux-spec')
    .maxConcurrency(4)
    .timeout(3_600_000)
    .onError('retry', { maxRetries: 2, retryDelayMs: 10_000 })

    .agent('lead-claude', {
      cli: 'claude',
      preset: 'worker',
      role: 'UX/product lead who keeps Ricky onboarding welcoming, truthful, omnichannel, and grounded in real Cloud and local/BYOH behavior.',
      retries: 1,
    })
    .agent('writer-primary-codex', {
      cli: 'codex',
      role: 'Primary doc/spec writer for the CLI banner UX spec, flow details, copy contracts, and decision tables.',
      retries: 2,
    })
    .agent('reviewer-claude', {
      cli: 'claude',
      preset: 'reviewer',
      role: 'Reviews onboarding quality, friendliness, product truth, and user-journey coverage.',
      retries: 1,
    })
    .agent('reviewer-codex', {
      cli: 'codex',
      preset: 'reviewer',
      role: 'Reviews spec precision, determinism, flow completeness, and implementation-readiness.',
      retries: 1,
    })
    .agent('validator-claude', {
      cli: 'claude',
      preset: 'worker',
      role: 'Runs the doc quality 80-to-100 loop and final signoff for the Ricky CLI onboarding UX spec.',
      retries: 2,
    })

    .step('prepare-artifacts', {
      type: 'deterministic',
      command: [
        'mkdir -p .workflow-artifacts/wave4-local-byoh/cli-onboarding-ux-spec',
        'mkdir -p docs/product',
        'echo RICKY_CLI_UX_SPEC_READY',
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
    .step('read-product-spec', {
      type: 'deterministic',
      dependsOn: ['prepare-artifacts'],
      command: 'cat SPEC.md',
      captureOutput: true,
      failOnError: true,
    })
    .step('read-cli-workflows', {
      type: 'deterministic',
      dependsOn: ['prepare-artifacts'],
      command: 'cat workflows/wave4-local-byoh/01-cli-onboarding-and-welcome.ts && printf "\n\n---\n\n" && cat workflows/wave4-local-byoh/02-local-invocation-entrypoint.ts',
      captureOutput: true,
      failOnError: true,
    })
    .step('read-relevant-docs', {
      type: 'deterministic',
      dependsOn: ['prepare-artifacts'],
      command: 'cat README.md && printf "\n\n---\n\n" && cat docs/workflows/WORKFLOW_STANDARDS.md',
      captureOutput: true,
      failOnError: true,
    })

    .step('lead-plan', {
      agent: 'lead-claude',
      dependsOn: ['read-workflow-standards', 'read-authoring-rules', 'read-product-spec', 'read-cli-workflows', 'read-relevant-docs'],
      task: `Plan the dedicated Ricky CLI onboarding UX spec.

Context inputs:
- docs/workflows/WORKFLOW_STANDARDS.md:
{{steps.read-workflow-standards.output}}
- workflows/shared/WORKFLOW_AUTHORING_RULES.md:
{{steps.read-authoring-rules.output}}
- SPEC.md:
{{steps.read-product-spec.output}}
- existing CLI-related workflows:
{{steps.read-cli-workflows.output}}
- repo docs context:
{{steps.read-relevant-docs.output}}

Deliverables:
- docs/product/ricky-cli-onboarding-ux-spec.md

The spec must include:
- purpose and target users
- first-run UX goals
- banner / ASCII-art behavior contract
- first-run flow from CLI launch to next useful action
- local/BYOH and Cloud mode selection UX
- provider connection guidance using real existing command patterns where source-backed
- Claude / CLI / MCP handoff story
- web and Slack onboarding relationship, with CLI kept first-class rather than subordinate
- concrete copy examples
- happy-path and recovery-path flows
- failure/unblocker guidance for environment/runtime/setup issues
- implementation notes and open questions

Non-goals:
- Do not implement CLI code in this workflow.
- Do not invent unsupported Cloud URLs or commands.
- Do not make Slack Ricky's identity.

Verification:
- The spec must be concrete enough that a follow-on implementation workflow can build the CLI without guessing the onboarding behavior.
- It must explicitly keep local/BYOH, Cloud, and interactive surfaces co-equal.
- It must turn the current banner/ASCII requirement into a real UX contract, not a vague aspiration.

Commit/PR boundary:
- Keep edits scoped to docs/product/ricky-cli-onboarding-ux-spec.md unless a tiny README link is truly necessary.

Write .workflow-artifacts/wave4-local-byoh/cli-onboarding-ux-spec/plan.md with concrete headings and implementation-ready bullets. End with CLI_UX_SPEC_PLAN_READY.`,
      verification: { type: 'file_exists', value: '.workflow-artifacts/wave4-local-byoh/cli-onboarding-ux-spec/plan.md' },
    })

    .step('plan-artifact-ready', {
      type: 'deterministic',
      dependsOn: ['lead-plan'],
      command: [
        'test -f .workflow-artifacts/wave4-local-byoh/cli-onboarding-ux-spec/plan.md',
        'tail -n 5 .workflow-artifacts/wave4-local-byoh/cli-onboarding-ux-spec/plan.md | grep -q "READY"',
        'echo PLAN_ARTIFACT_READY',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('write-cli-ux-spec', {
      agent: 'writer-primary-codex',
      dependsOn: ['plan-artifact-ready'],
      task: `Write the dedicated Ricky CLI onboarding UX spec.

Deliverables:
- docs/product/ricky-cli-onboarding-ux-spec.md

Requirements:
- Include a concrete banner section with example ASCII treatment and rules for when it appears.
- Define first-run versus returning-user behavior.
- Define local/BYOH versus Cloud selection copy and next steps.
- Include an explicit "Web and Slack relationship" section that says those surfaces are adjacent entry points, not the owner of CLI onboarding.
- Include Google connect guidance using the real pattern npx agent-relay cloud connect google.
- For GitHub/integration setup, reference Cloud dashboard / Nango-backed guidance rather than invented URLs.
- Include CLI-based and MCP-based spec handoff examples.
- Include at least one recovery flow for missing toolchain, missing auth, or local environment blockers.
- Make the copy warm and welcoming without turning into marketing fluff.
- Make implementation boundaries explicit so a future implementation workflow knows what code modules and tests to build.

Non-goals:
- Do not add implementation code.
- Do not duplicate the entire product spec.
- Do not leave key interactions as TODO if they can be specified now.

Verification:
- The document should be implementation-ready.
- It should have concrete headings, flow steps, examples, and acceptance criteria.
- It should mention banner, welcome, onboarding, local/BYOH, Cloud, CLI, MCP, and at least one recovery path.`,
      verification: { type: 'file_exists', value: 'docs/product/ricky-cli-onboarding-ux-spec.md' },
    })
    .step('post-write-file-gate', {
      type: 'deterministic',
      dependsOn: ['write-cli-ux-spec'],
      command: [
        'test -f docs/product/ricky-cli-onboarding-ux-spec.md',
        'grep -qiE "banner|ASCII" docs/product/ricky-cli-onboarding-ux-spec.md',
        'grep -qiE "local|BYOH" docs/product/ricky-cli-onboarding-ux-spec.md',
        'grep -qiE "Cloud" docs/product/ricky-cli-onboarding-ux-spec.md',
        'grep -qiE "CLI" docs/product/ricky-cli-onboarding-ux-spec.md',
        'grep -qiE "MCP" docs/product/ricky-cli-onboarding-ux-spec.md',
        'grep -qiE "Slack|web" docs/product/ricky-cli-onboarding-ux-spec.md',
        'grep -qiE "cloud connect google|agent-relay cloud connect google" docs/product/ricky-cli-onboarding-ux-spec.md',
        'grep -qiE "GitHub|Nango|dashboard" docs/product/ricky-cli-onboarding-ux-spec.md',
        'grep -qiE "recovery|failure|unblock" docs/product/ricky-cli-onboarding-ux-spec.md',
        'echo CLI_UX_SPEC_FILE_PRESENT',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('review-cli-ux-spec-claude', {
      agent: 'reviewer-claude',
      dependsOn: ['post-write-file-gate'],
      task: `Review the Ricky CLI onboarding UX spec.

Focus:
- Is the banner/onboarding experience concrete, welcoming, and product-aligned?
- Are local/BYOH, Cloud, CLI, MCP, web, and Slack represented honestly and in the right hierarchy?
- Does the spec help a future implementation workflow without requiring product guesswork?
- Are the recovery paths and first-run guidance good enough for real users?

Write .workflow-artifacts/wave4-local-byoh/cli-onboarding-ux-spec/review-claude.md ending with REVIEW_CLAUDE_PASS or REVIEW_CLAUDE_FAIL.`,
      verification: { type: 'file_exists', value: '.workflow-artifacts/wave4-local-byoh/cli-onboarding-ux-spec/review-claude.md' },
    })
    .step('review-cli-ux-spec-codex', {
      agent: 'reviewer-codex',
      dependsOn: ['post-write-file-gate'],
      task: `Review the Ricky CLI onboarding UX spec.

Focus:
- Is the document structurally precise and implementation-ready?
- Are acceptance criteria and examples concrete?
- Does it avoid invented commands and unsupported assumptions?
- Is the future code/test boundary explicit enough to implement deterministically?

Write .workflow-artifacts/wave4-local-byoh/cli-onboarding-ux-spec/review-codex.md ending with REVIEW_CODEX_PASS or REVIEW_CODEX_FAIL.`,
      verification: { type: 'file_exists', value: '.workflow-artifacts/wave4-local-byoh/cli-onboarding-ux-spec/review-codex.md' },
    })

    .step('read-review-feedback', {
      type: 'deterministic',
      dependsOn: ['review-cli-ux-spec-claude', 'review-cli-ux-spec-codex'],
      command: 'cat .workflow-artifacts/wave4-local-byoh/cli-onboarding-ux-spec/review-claude.md .workflow-artifacts/wave4-local-byoh/cli-onboarding-ux-spec/review-codex.md',
      captureOutput: true,
      failOnError: true,
    })
    .step('fix-cli-ux-spec', {
      type: 'deterministic',
      dependsOn: ['read-review-feedback'],
      command: [
        "tail -n 1 .workflow-artifacts/wave4-local-byoh/cli-onboarding-ux-spec/review-claude.md | tr -d '[:space:]*' | grep -Eq \"^REVIEW_CLAUDE_PASS$\"",
        "tail -n 1 .workflow-artifacts/wave4-local-byoh/cli-onboarding-ux-spec/review-codex.md | tr -d '[:space:]*' | grep -Eq \"^REVIEW_CODEX_PASS$\"",
        'node -e "require(\'node:fs\').writeFileSync(\'.workflow-artifacts/wave4-local-byoh/cli-onboarding-ux-spec/fix-cli-ux-spec.md\', [\'# CLI onboarding UX spec fix pass\', \'\', \'Review feedback consumed. Both reviewers passed, so no additional spec edits are required in the fix step.\', \'\', \'FIX_CLI_UX_SPEC_PASS\', \'\'].join(\'\\n\'))"',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })
    .step('post-fix-verification-gate', {
      type: 'deterministic',
      dependsOn: ['fix-cli-ux-spec'],
      command: [
        'test -f docs/product/ricky-cli-onboarding-ux-spec.md',
        'grep -qi "banner\|ASCII" docs/product/ricky-cli-onboarding-ux-spec.md',
        'grep -qi "local\|BYOH" docs/product/ricky-cli-onboarding-ux-spec.md',
        'grep -qi "Cloud" docs/product/ricky-cli-onboarding-ux-spec.md',
        'grep -qi "acceptance criteria\|acceptance" docs/product/ricky-cli-onboarding-ux-spec.md',
        'grep -qiE "Slack|web" docs/product/ricky-cli-onboarding-ux-spec.md',
        'grep -qi "recovery\|failure\|unblock" docs/product/ricky-cli-onboarding-ux-spec.md',
        'echo CLI_UX_SPEC_POST_FIX_GATE_PASS',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('final-review-cli-ux-spec-claude', {
      agent: 'reviewer-claude',
      dependsOn: ['post-fix-verification-gate'],
      task: `Re-review the Ricky CLI onboarding UX spec after fixes.

Confirm the spec is welcoming, truthful, and implementation-ready.
Write .workflow-artifacts/wave4-local-byoh/cli-onboarding-ux-spec/final-review-claude.md ending with FINAL_REVIEW_CLAUDE_PASS or FINAL_REVIEW_CLAUDE_FAIL.`,
      verification: { type: 'file_exists', value: '.workflow-artifacts/wave4-local-byoh/cli-onboarding-ux-spec/final-review-claude.md' },
    })
    .step('final-review-cli-ux-spec-codex', {
      agent: 'reviewer-codex',
      dependsOn: ['post-fix-verification-gate'],
      task: `Re-review the Ricky CLI onboarding UX spec after fixes.

Confirm the spec is precise, deterministic, and ready for a follow-on implementation workflow.
Write .workflow-artifacts/wave4-local-byoh/cli-onboarding-ux-spec/final-review-codex.md ending with FINAL_REVIEW_CODEX_PASS or FINAL_REVIEW_CODEX_FAIL.`,
      verification: { type: 'file_exists', value: '.workflow-artifacts/wave4-local-byoh/cli-onboarding-ux-spec/final-review-codex.md' },
    })
    .step('final-review-pass-gate', {
      type: 'deterministic',
      dependsOn: ['final-review-cli-ux-spec-claude', 'final-review-cli-ux-spec-codex'],
      command: [
        "tail -n 1 .workflow-artifacts/wave4-local-byoh/cli-onboarding-ux-spec/final-review-claude.md | tr -d '[:space:]*' | grep -Eq \"^FINAL_REVIEW_CLAUDE_PASS$\"",
        "tail -n 1 .workflow-artifacts/wave4-local-byoh/cli-onboarding-ux-spec/final-review-codex.md | tr -d '[:space:]*' | grep -Eq \"^FINAL_REVIEW_CODEX_PASS$\"",
        'echo CLI_UX_SPEC_FINAL_REVIEW_PASS',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })
    .step('regression-gate', {
      type: 'deterministic',
      dependsOn: ['final-review-pass-gate'],
      command: [
        'changed="$(git diff --name-only; git ls-files --others --exclude-standard)"',
        'printf "%s\n" "$changed" | grep -Eq "^(docs/product/ricky-cli-onboarding-ux-spec\.md)$"',
        '! printf "%s\n" "$changed" | grep -Ev "^(docs/product/ricky-cli-onboarding-ux-spec\.md|\.workflow-artifacts/)"',
        'echo CLI_UX_SPEC_REGRESSION_GATE_PASS',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })
    .step('final-signoff', {
      agent: 'validator-claude',
      dependsOn: ['regression-gate'],
      task: `Write .workflow-artifacts/wave4-local-byoh/cli-onboarding-ux-spec/signoff.md.

Include what the spec now defines, why it is implementation-ready, review verdicts, and any remaining open questions.
End with CLI_UX_SPEC_COMPLETE.`,
      verification: { type: 'file_exists', value: '.workflow-artifacts/wave4-local-byoh/cli-onboarding-ux-spec/signoff.md' },
    })

    .run({ cwd: process.cwd() });

  console.log(result.status);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
