import { workflow } from '@agent-relay/sdk/workflows';

async function main() {
  const result = await workflow('ricky-wave2-workflow-validator-specialist')
    .description('Implement the Wave 2 validator specialist that applies Ricky 80-to-100 validation, dry-run checks, structural checks, and bounded proof loops before signoff.')
    .pattern('dag')
    .channel('wf-ricky-wave2-workflow-validator-specialist')
    .maxConcurrency(3)
    .timeout(3_600_000)
    .onError('retry', { maxRetries: 1, retryDelayMs: 10_000 })

    .agent('lead-claude', { cli: 'claude', role: 'Validator specialist lead responsible for 80-to-100 quality policy and product signoff semantics.', retries: 1 })
    .agent('impl-primary-codex', { cli: 'codex', role: 'Primary implementer for validator, structural checks, proof loop, types, and exports.', retries: 2 })
    .agent('impl-tests-codex', { cli: 'codex', role: 'Test implementer for validation policy, structural checks, and proof-loop behavior.', retries: 2 })
    .agent('reviewer-claude', { cli: 'claude', preset: 'reviewer', role: 'Reviews validation policy, signoff quality, and generated workflow readiness.', retries: 1 })
    .agent('reviewer-codex', { cli: 'codex', preset: 'reviewer', role: 'Reviews implementation practicality, deterministic checks, and tests.', retries: 1 })
    .agent('validator-claude', { cli: 'claude', preset: 'worker', role: 'Applies bounded fixes and validation reruns until validator reaches the 80-to-100 bar.', retries: 2 })

    .step('prepare-context', {
      type: 'deterministic',
      command: [
        'mkdir -p .workflow-artifacts/wave2-product/workflow-validator-specialist src/product/specialists/validator',
        'cat docs/workflows/WORKFLOW_STANDARDS.md > .workflow-artifacts/wave2-product/workflow-validator-specialist/workflow-standards.md',
        'cat workflows/shared/WORKFLOW_AUTHORING_RULES.md > .workflow-artifacts/wave2-product/workflow-validator-specialist/authoring-rules.md',
        'cat workflows/meta/spec/generated-workflow-template.md > .workflow-artifacts/wave2-product/workflow-validator-specialist/generated-template.md',
        'cat .workflow-artifacts/ricky-meta/application-wave-plan.md > .workflow-artifacts/wave2-product/workflow-validator-specialist/application-wave-plan.md',
        'cat SPEC.md > .workflow-artifacts/wave2-product/workflow-validator-specialist/product-spec.md',
        'echo VALIDATOR_SPECIALIST_CONTEXT_READY',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('lead-plan', {
      agent: 'lead-claude',
      dependsOn: ['prepare-context'],
      task: `Plan the workflow validator specialist implementation.

Read the prepared context under .workflow-artifacts/wave2-product/workflow-validator-specialist/.

Deliverables:
- src/product/specialists/validator/types.ts defines validation input, structural finding, proof-loop step, command result, signoff verdict, and validator result types.
- src/product/specialists/validator/structural-checks.ts checks generated/repaired workflow text for required Relay shape, dedicated channel, deterministic gates, review stage, non-goals, deliverables, and 80-to-100 loops.
- src/product/specialists/validator/proof-loop.ts models initial soft run, fix loop, final gate, build/typecheck gate, and regression gate.
- src/product/specialists/validator/validator.ts orchestrates structural checks, dry-run command planning, proof-loop evaluation, and signoff.
- src/product/specialists/validator/index.ts exports the public validator API.
- src/product/specialists/validator/validator.test.ts covers passing workflow, missing review, missing deterministic gate, missing soft gate, dry-run failure, and regression gate failure.

Non-goals:
- Do not generate workflows or parse user specs.
- Do not silently pass workflows where dry-run/build/test status is missing.
- Do not depend on live shell execution in unit tests; model command results with injectable inputs.

Verification:
- npx tsc --noEmit
- npx vitest run src/product/specialists/validator/
- grep for validator and proof-loop exports
- git diff scoped to src/product/specialists/validator/.

Write .workflow-artifacts/wave2-product/workflow-validator-specialist/implementation-plan.md ending with VALIDATOR_SPECIALIST_PLAN_READY.`,
      verification: { type: 'file_exists', value: '.workflow-artifacts/wave2-product/workflow-validator-specialist/implementation-plan.md' },
    })

    .step('implement-validator-core', {
      agent: 'impl-primary-codex',
      dependsOn: ['lead-plan'],
      task: `Implement the validator specialist core.

Own only:
- src/product/specialists/validator/types.ts
- src/product/specialists/validator/structural-checks.ts
- src/product/specialists/validator/proof-loop.ts
- src/product/specialists/validator/validator.ts
- src/product/specialists/validator/index.ts

Requirements:
- Enforce Ricky workflow standards on generated or repaired workflows before signoff.
- Structural checks must verify workflow(), dedicated wf-ricky-* channel, explicit pattern, maxConcurrency, timeout, deterministic steps, review stage, deliverables, non-goals, verification language, failOnError false initial gate, failOnError true final gate, typecheck/test/build gate, regression gate, and .run({ cwd: process.cwd() }).
- Structural checks must detect stale pre-fix review gates: if a workflow checks initial review verdicts after a fix loop instead of running a final re-review, flag it as a blocking finding. The correct shape is fix -> post-fix validation -> final-review -> final-review-pass-gate.
- Structural checks must detect over-broad regression allowlists: if a regression gate allows directories outside the workflow's declared file targets and .workflow-artifacts/, flag it as a warning with a recommendation to restrict to exact target paths.
- Proof loop must explicitly model initial soft run, fix loop, final hard gate, build/typecheck gate, and regression gate.
- Produce structured findings with severity, path/location when available, fix hint, and blocking status.
- Return a signoff verdict that refuses ready status when deterministic verification is missing.

After editing, stop. Do not modify tests in this step.`,
      verification: { type: 'file_exists', value: 'src/product/specialists/validator/validator.ts' },
    })

    .step('verify-core-after-edit', {
      type: 'deterministic',
      dependsOn: ['implement-validator-core'],
      command: [
        'test -f src/product/specialists/validator/types.ts',
        'test -f src/product/specialists/validator/structural-checks.ts',
        'test -f src/product/specialists/validator/proof-loop.ts',
        'test -f src/product/specialists/validator/validator.ts',
        'test -f src/product/specialists/validator/index.ts',
        'grep -Eq "failOnError|dry-run|regression|typecheck|review|deterministic" src/product/specialists/validator/structural-checks.ts src/product/specialists/validator/proof-loop.ts src/product/specialists/validator/validator.ts',
        'grep -q "export" src/product/specialists/validator/index.ts',
        'changed="$(git diff --name-only; git ls-files --others --exclude-standard)" && printf "%s\\n" "$changed" | grep -Eq "^src/product/specialists/validator/(types|structural-checks|proof-loop|validator|index)\\.ts"',
        'echo VALIDATOR_SPECIALIST_CORE_VERIFIED',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('implement-tests', {
      agent: 'impl-tests-codex',
      dependsOn: ['verify-core-after-edit'],
      task: `Write validator specialist tests.

Own only:
- src/product/specialists/validator/validator.test.ts

Required coverage:
- complete generated workflow passes structural checks and proof-loop evaluation.
- missing review stage blocks signoff.
- missing deterministic gate blocks signoff.
- missing initial failOnError false soft gate blocks 80-to-100 signoff.
- failed dry-run command is reported as blocking.
- failed regression gate keeps verdict not ready.
- stale pre-fix review gate (checking initial review verdicts after fix loop instead of running final re-review) is flagged as blocking.
- over-broad regression allowlist (allowing directories outside declared file targets) is flagged as a warning.

Review checklist:
- Tests do not execute agent-relay or shell commands.
- Tests make every failure diagnosable through structured findings.
- Tests encode the same quality bar used by generation and debugger workflows.`,
      verification: { type: 'file_exists', value: 'src/product/specialists/validator/validator.test.ts' },
    })

    .step('verify-tests-after-edit', {
      type: 'deterministic',
      dependsOn: ['implement-tests'],
      command: [
        'test -f src/product/specialists/validator/validator.test.ts',
        'grep -Eq "describe|it\\(" src/product/specialists/validator/validator.test.ts',
        'grep -Eq "review|deterministic|soft|dry-run|regression|signoff" src/product/specialists/validator/validator.test.ts',
        'changed="$(git diff --name-only; git ls-files --others --exclude-standard)" && printf "%s\\n" "$changed" | grep -Eq "^src/product/specialists/validator/validator\\.test\\.ts"',
        'echo VALIDATOR_SPECIALIST_TESTS_VERIFIED',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('initial-soft-validation', {
      type: 'deterministic',
      dependsOn: ['verify-tests-after-edit'],
      command: 'npx tsc --noEmit && npx vitest run src/product/specialists/validator/',
      captureOutput: true,
      failOnError: false,
    })

    .step('review-claude', {
      agent: 'reviewer-claude',
      dependsOn: ['initial-soft-validation'],
      task: `Review validator specialist policy and product fit.

Read src/product/specialists/validator/ and initial validation output:
{{steps.initial-soft-validation.output}}

Assess whether the validator enforces Ricky's 80-to-100 bar for generated and repaired workflows, including dry-run, structural checks, proof loops, and honest signoff.

Write .workflow-artifacts/wave2-product/workflow-validator-specialist/review-claude.md ending with REVIEW_CLAUDE_PASS or REVIEW_CLAUDE_FAIL.`,
      verification: { type: 'file_exists', value: '.workflow-artifacts/wave2-product/workflow-validator-specialist/review-claude.md' },
    })

    .step('review-codex', {
      agent: 'reviewer-codex',
      dependsOn: ['initial-soft-validation'],
      task: `Review validator specialist implementation and tests.

Read src/product/specialists/validator/ and initial validation output:
{{steps.initial-soft-validation.output}}

Assess structural check coverage, proof-loop modeling, TypeScript contracts, and missing edge cases.

Write .workflow-artifacts/wave2-product/workflow-validator-specialist/review-codex.md ending with REVIEW_CODEX_PASS or REVIEW_CODEX_FAIL.`,
      verification: { type: 'file_exists', value: '.workflow-artifacts/wave2-product/workflow-validator-specialist/review-codex.md' },
    })

    .step('fix-loop', {
      agent: 'validator-claude',
      dependsOn: ['review-claude', 'review-codex'],
      task: `Run the 80-to-100 fix loop for validator specialist.

Inputs:
- .workflow-artifacts/wave2-product/workflow-validator-specialist/review-claude.md
- .workflow-artifacts/wave2-product/workflow-validator-specialist/review-codex.md
- Initial validation output:
{{steps.initial-soft-validation.output}}

Fix only concrete issues in src/product/specialists/validator/. Re-run npx tsc --noEmit and npx vitest run src/product/specialists/validator/.

Write .workflow-artifacts/wave2-product/workflow-validator-specialist/fix-loop.md ending with VALIDATOR_SPECIALIST_FIX_LOOP_COMPLETE.`,
      verification: { type: 'file_exists', value: '.workflow-artifacts/wave2-product/workflow-validator-specialist/fix-loop.md' },
    })

    .step('post-fix-file-gate', {
      type: 'deterministic',
      dependsOn: ['fix-loop'],
      command: [
        'test -f src/product/specialists/validator/validator.ts',
        'test -f src/product/specialists/validator/structural-checks.ts',
        'test -f src/product/specialists/validator/proof-loop.ts',
        'test -f src/product/specialists/validator/validator.test.ts',
        'test -f src/product/specialists/validator/index.ts',
        'grep -Eq "failOnError|dry-run|regression|typecheck" src/product/specialists/validator/validator.ts src/product/specialists/validator/proof-loop.ts',
        'echo VALIDATOR_SPECIALIST_POST_FIX_FILES_PASS',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('post-fix-validation', {
      type: 'deterministic',
      dependsOn: ['post-fix-file-gate'],
      command: 'npx tsc --noEmit && npx vitest run src/product/specialists/validator/',
      captureOutput: true,
      failOnError: false,
    })

    .step('final-review-claude', {
      agent: 'reviewer-claude',
      dependsOn: ['post-fix-validation'],
      task: `Re-review validator specialist after the fix loop.

Read src/product/specialists/validator/, the fix-loop artifact, and post-fix validation output:
{{steps.post-fix-validation.output}}

Confirm prior findings are fixed or explicitly non-blocking, and that the validator enforces Ricky's 80-to-100 bar, dry-run/structural checks, proof loops, and honest signoff for generated and repaired workflows.

Write .workflow-artifacts/wave2-product/workflow-validator-specialist/final-review-claude.md ending with FINAL_REVIEW_CLAUDE_PASS or FINAL_REVIEW_CLAUDE_FAIL.`,
      verification: { type: 'file_exists', value: '.workflow-artifacts/wave2-product/workflow-validator-specialist/final-review-claude.md' },
    })

    .step('final-review-codex', {
      agent: 'reviewer-codex',
      dependsOn: ['post-fix-validation'],
      task: `Re-review validator specialist implementation and tests after fixes.

Read src/product/specialists/validator/, the fix-loop artifact, and post-fix validation output:
{{steps.post-fix-validation.output}}

Confirm structural checks, proof-loop modeling, TypeScript contracts, and tests are ready for final hard gates.

Write .workflow-artifacts/wave2-product/workflow-validator-specialist/final-review-codex.md ending with FINAL_REVIEW_CODEX_PASS or FINAL_REVIEW_CODEX_FAIL.`,
      verification: { type: 'file_exists', value: '.workflow-artifacts/wave2-product/workflow-validator-specialist/final-review-codex.md' },
    })

    .step('final-review-pass-gate', {
      type: 'deterministic',
      dependsOn: ['final-review-claude', 'final-review-codex'],
      command: [
        "tail -n 1 .workflow-artifacts/wave2-product/workflow-validator-specialist/final-review-claude.md | tr -d '[:space:]*' | grep -Eq \"^FINAL_REVIEW_CLAUDE_PASS$\"",
        "tail -n 1 .workflow-artifacts/wave2-product/workflow-validator-specialist/final-review-codex.md | tr -d '[:space:]*' | grep -Eq \"^FINAL_REVIEW_CODEX_PASS$\"",
        'echo VALIDATOR_SPECIALIST_FINAL_REVIEW_PASS',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('final-hard-gate', {
      type: 'deterministic',
      dependsOn: ['final-review-pass-gate'],
      command: 'npx vitest run src/product/specialists/validator/',
      captureOutput: true,
      failOnError: true,
    })

    .step('build-typecheck-gate', {
      type: 'deterministic',
      dependsOn: ['final-hard-gate'],
      command: 'npx tsc --noEmit',
      captureOutput: true,
      failOnError: true,
    })

    .step('regression-gate', {
      type: 'deterministic',
      dependsOn: ['build-typecheck-gate'],
      command: [
        'npx vitest run',
        'changed="$(git diff --name-only; git ls-files --others --exclude-standard)" && printf "%s\\n" "$changed" | grep -Eq "^src/product/specialists/validator/"',
        '! printf "%s\\n" "$changed" | grep -Ev "^(src/product/specialists/validator/|\\.workflow-artifacts/)"',
        'echo VALIDATOR_SPECIALIST_REGRESSION_PASS',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })
    .step('final-signoff', {
      agent: 'validator-claude',
      dependsOn: ['regression-gate'],
      task: `Write .workflow-artifacts/wave2-product/workflow-validator-specialist/signoff.md.

Include files changed, validation commands run, review verdicts, and remaining risks.
End with WORKFLOW_VALIDATOR_SPECIALIST_COMPLETE.`,
      verification: { type: 'file_exists', value: '.workflow-artifacts/wave2-product/workflow-validator-specialist/signoff.md' },
    })

    .run({ cwd: process.cwd() });

  console.log(result.status);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
