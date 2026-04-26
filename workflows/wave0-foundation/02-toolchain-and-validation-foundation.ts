import { workflow } from '@agent-relay/sdk/workflows';

async function main() {
  const result = await workflow('ricky-wave0-toolchain-and-validation-foundation')
    .description('Establish the minimal Ricky TypeScript and Vitest toolchain so later workflows have truthful validation contracts.')
    .pattern('dag')
    .channel('wf-ricky-wave0-toolchain-foundation')
    .maxConcurrency(4)
    .timeout(3_600_000)
    .onError('retry', { maxRetries: 1, retryDelayMs: 10_000 })

    .agent('lead-claude', {
      cli: 'claude',
      role: 'Foundation lead who keeps the Ricky toolchain minimal, explicit, and sufficient for later validation gates.',
      retries: 1,
    })
    .agent('impl-primary-codex', {
      cli: 'codex',
      role: 'Primary implementer for package scripts, tsconfig, vitest config, and minimal test setup.',
      retries: 2,
    })
    .agent('reviewer-claude', {
      cli: 'claude',
      preset: 'reviewer',
      role: 'Reviews whether the toolchain honestly supports Ricky onboarding, runtime, and workflow validation needs.',
      retries: 1,
    })
    .agent('validator-claude', {
      cli: 'claude',
      preset: 'worker',
      role: 'Runs the 80-to-100 loop until the minimal Ricky validation foundation is real and scoped.',
      retries: 2,
    })

    .step('prepare-artifacts', {
      type: 'deterministic',
      command: [
        'rm -rf .workflow-artifacts/wave0-foundation/toolchain-validation-foundation',
        'mkdir -p .workflow-artifacts/wave0-foundation/toolchain-validation-foundation',
        'mkdir -p src/test',
        'echo W0_TOOLCHAIN_FOUNDATION_READY',
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
    .step('read-package-context', {
      type: 'deterministic',
      dependsOn: ['prepare-artifacts'],
      command: 'cat package.json && if [ -f tsconfig.json ]; then cat tsconfig.json; fi && if [ -f vitest.config.ts ]; then cat vitest.config.ts; fi',
      captureOutput: true,
      failOnError: true,
    })

    .step('lead-plan', {
      agent: 'lead-claude',
      dependsOn: ['read-workflow-standards', 'read-authoring-rules', 'read-generated-template', 'read-package-context'],
      task: `Plan the minimal Ricky validation foundation.

Context inputs:
- docs/workflows/WORKFLOW_STANDARDS.md:
{{steps.read-workflow-standards.output}}
- workflows/shared/WORKFLOW_AUTHORING_RULES.md:
{{steps.read-authoring-rules.output}}
- workflows/meta/spec/generated-workflow-template.md:
{{steps.read-generated-template.output}}
- package/tooling context:
{{steps.read-package-context.output}}

Deliverables:
- package.json updates for validation scripts and minimal devDependencies
- tsconfig.json
- vitest.config.ts
- src/test/setup.ts

Non-goals:
- Do not scaffold app code.
- Do not add linting, formatting, or build tooling beyond what later Ricky workflows already rely on.
- Do not add broad workspace/package-manager churn.

Verification:
- package.json must expose honest scripts for typecheck and test.
- tsconfig.json must support the generated TypeScript workflow files without pretending the whole future app exists.
- vitest.config.ts and src/test/setup.ts must make \`npx vitest run\` meaningful.
- Post-edit gates must verify tracked and untracked changes only in the declared toolchain files.

Commit/PR boundary:
- Keep changes scoped to package.json, tsconfig.json, vitest.config.ts, and src/test/setup.ts.

Write .workflow-artifacts/wave0-foundation/toolchain-validation-foundation/plan.md and end with W0_TOOLCHAIN_PLAN_READY.`,
      verification: { type: 'file_exists', value: '.workflow-artifacts/wave0-foundation/toolchain-validation-foundation/plan.md' },
    })

    .step('implement-toolchain', {
      agent: 'impl-primary-codex',
      dependsOn: ['lead-plan'],
      task: `Implement the minimal Ricky validation foundation.

Deliverables:
- package.json should add minimal scripts for typecheck and test plus minimal devDependencies for typescript, vitest, and any tiny companion package required for Vitest on Node.
- tsconfig.json should target modern Node TypeScript execution and include src plus workflows as appropriate.
- vitest.config.ts should define a minimal Node test environment.
- src/test/setup.ts should exist as the shared test setup entrypoint.

Non-goals:
- Do not add unrelated scripts.
- Do not add bundlers or framework-specific configs.
- Do not add runtime-specific dependencies outside the validation foundation.

Verification:
- Keep the setup small and deterministic.
- Make \`npx tsc --noEmit\` and \`npx vitest run\` honest first-run contracts for the repo.
- Stop after writing the toolchain files.`,
      verification: { type: 'exit_code', value: '0' },
    })

    .step('post-implementation-file-gate', {
      type: 'deterministic',
      dependsOn: ['implement-toolchain'],
      command: [
        'test -f package.json',
        'test -f tsconfig.json',
        'test -f vitest.config.ts',
        'test -f src/test/setup.ts',
        'grep -q "typecheck" package.json',
        'grep -q "vitest" package.json vitest.config.ts',
        'grep -q "typescript" package.json',
        'changed="$(git diff --name-only -- package.json tsconfig.json vitest.config.ts src/test/setup.ts; git ls-files --others --exclude-standard -- package.json tsconfig.json vitest.config.ts src/test/setup.ts)" && { [ -z "$changed" ] || printf "%s\\n" "$changed" | grep -Eq "^(package.json|tsconfig.json|vitest.config.ts|src/test/setup.ts)$"; }',
        'echo W0_TOOLCHAIN_FILES_PRESENT',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })
    .step('initial-soft-validation', {
      type: 'deterministic',
      dependsOn: ['post-implementation-file-gate'],
      command: 'npm install && npx tsc --noEmit && npx vitest run',
      captureOutput: true,
      failOnError: false,
    })

    .step('review-toolchain-claude', {
      agent: 'reviewer-claude',
      dependsOn: ['initial-soft-validation'],
      task: `Review the Ricky validation foundation.

Focus:
- Later workflows now have an honest minimum toolchain instead of aspirational validation commands.
- The scope stays minimal and foundation-only.
- The scripts are user-friendly enough for Ricky's first-run developer experience.

Write .workflow-artifacts/wave0-foundation/toolchain-validation-foundation/review-claude.md ending with REVIEW_CLAUDE_PASS or REVIEW_CLAUDE_FAIL.`,
      verification: { type: 'file_exists', value: '.workflow-artifacts/wave0-foundation/toolchain-validation-foundation/review-claude.md' },
    })
    .step('read-review-feedback', {
      type: 'deterministic',
      dependsOn: ['review-toolchain-claude'],
      command: 'cat .workflow-artifacts/wave0-foundation/toolchain-validation-foundation/review-claude.md',
      captureOutput: true,
      failOnError: true,
    })
    .step('fix-toolchain', {
      agent: 'validator-claude',
      dependsOn: ['read-review-feedback'],
      task: `Fix Ricky validation foundation issues from review feedback.

Review feedback:
{{steps.read-review-feedback.output}}

Rules:
- Keep scope limited to package.json, tsconfig.json, vitest.config.ts, and src/test/setup.ts.
- Do not add extra tooling categories.
- Re-run install, typecheck, and tests after edits.`,
      verification: { type: 'exit_code', value: '0' },
    })
    .step('post-fix-verification-gate', {
      type: 'deterministic',
      dependsOn: ['fix-toolchain'],
      command: [
        'test -f package.json',
        'test -f tsconfig.json',
        'test -f vitest.config.ts',
        'test -f src/test/setup.ts',
        'grep -q "typecheck" package.json',
        'grep -q "vitest" package.json vitest.config.ts',
        'echo W0_TOOLCHAIN_POST_FIX_GATE_PASS',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })
    .step('post-fix-validation', {
      type: 'deterministic',
      dependsOn: ['post-fix-verification-gate'],
      command: 'npm install && npx tsc --noEmit && npx vitest run',
      captureOutput: true,
      failOnError: false,
    })

    .step('final-review-toolchain-claude', {
      agent: 'reviewer-claude',
      dependsOn: ['post-fix-validation'],
      task: `Re-review the Ricky validation foundation after fixes.

Read package.json, tsconfig.json, vitest.config.ts, src/test/setup.ts, and post-fix validation output:
{{steps.post-fix-validation.output}}

Confirm prior findings are fixed or explicitly non-blocking. Write .workflow-artifacts/wave0-foundation/toolchain-validation-foundation/final-review-claude.md ending with FINAL_REVIEW_CLAUDE_PASS or FINAL_REVIEW_CLAUDE_FAIL.`,
      verification: { type: 'file_exists', value: '.workflow-artifacts/wave0-foundation/toolchain-validation-foundation/final-review-claude.md' },
    })
    .step('final-review-pass-gate', {
      type: 'deterministic',
      dependsOn: ['final-review-toolchain-claude'],
      command: [
        'tail -n 1 .workflow-artifacts/wave0-foundation/toolchain-validation-foundation/final-review-claude.md | grep -Eq "^FINAL_REVIEW_CLAUDE_PASS$"',
        'echo W0_TOOLCHAIN_FINAL_REVIEW_PASS',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })
    .step('final-hard-validation', {
      type: 'deterministic',
      dependsOn: ['final-review-pass-gate'],
      command: 'npm install && npx tsc --noEmit && npx vitest run',
      captureOutput: true,
      failOnError: true,
    })
    .step('regression-gate', {
      type: 'deterministic',
      dependsOn: ['final-hard-validation'],
      command: [
        'changed="$(git diff --name-only; git ls-files --others --exclude-standard)"',
        'printf "%s\\n" "$changed" | grep -Eq "^(package.json|package-lock.json|tsconfig.json|vitest.config.ts|src/test/setup.ts)$"',
        '! printf "%s\\n" "$changed" | grep -Ev "^(package.json|package-lock.json|tsconfig.json|vitest.config.ts|src/test/setup.ts|\.workflow-artifacts/)"',
        'echo W0_TOOLCHAIN_REGRESSION_GATE_PASS',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })
    .step('final-signoff', {
      agent: 'validator-claude',
      dependsOn: ['regression-gate'],
      task: `Write .workflow-artifacts/wave0-foundation/toolchain-validation-foundation/signoff.md.

Include files changed, install/typecheck/test commands run, review verdicts, and remaining risks.
Note that this workflow intentionally uses a single Claude review path because the current non-interactive Codex reviewer runtime has been observed to hang in this foundation slice.
End with W0_TOOLCHAIN_FOUNDATION_COMPLETE.`,
      verification: { type: 'file_exists', value: '.workflow-artifacts/wave0-foundation/toolchain-validation-foundation/signoff.md' },
    })

    .run({ cwd: process.cwd() });

  console.log(result.status);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
