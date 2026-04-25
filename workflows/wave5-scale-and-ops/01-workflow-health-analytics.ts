import { workflow } from '@agent-relay/sdk/workflows';

async function main() {
  const result = await workflow('ricky-wave5-workflow-health-analytics')
    .description('Implement workflow health analytics that mines run histories for failure classes, weak verification, retry rates, and improvement recommendations.')
    .pattern('dag')
    .channel('wf-ricky-wave5-health-analytics')
    .maxConcurrency(4)
    .timeout(3_600_000)
    .onError('retry', { maxRetries: 2, retryDelayMs: 10_000 })

    .agent('lead-claude', {
      cli: 'claude',
      role: 'Analytics lead who keeps run-history analysis tied to actionable Ricky workflow quality improvements.',
      retries: 1,
    })
    .agent('impl-primary-codex', {
      cli: 'codex',
      role: 'Primary implementer for health analyzer, digest generator, types, and exports.',
      retries: 2,
    })
    .agent('impl-tests-codex', {
      cli: 'codex',
      role: 'Test implementer for health analytics failure summaries, pattern warnings, retry/timeout rates, and digest contracts.',
      retries: 2,
    })
    .agent('reviewer-claude', {
      cli: 'claude',
      preset: 'reviewer',
      role: 'Product reviewer for analytics usefulness and workflow improvement recommendation quality.',
      retries: 1,
    })
    .agent('reviewer-codex', {
      cli: 'codex',
      preset: 'reviewer',
      role: 'Code reviewer for analytics determinism, data contracts, tests, and regression gates.',
      retries: 1,
    })
    .agent('validator-claude', {
      cli: 'claude',
      preset: 'worker',
      role: 'Validation owner for the workflow health analytics 80-to-100 loop and final signoff.',
      retries: 2,
    })

    .step('prepare-artifacts', {
      type: 'deterministic',
      command: [
        'mkdir -p .workflow-artifacts/wave5-scale-and-ops/workflow-health-analytics',
        'mkdir -p src/analytics',
        'echo RICKY_WAVE5_HEALTH_ANALYTICS_READY',
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
    .step('read-product-spec', {
      type: 'deterministic',
      dependsOn: ['prepare-artifacts'],
      command: 'cat SPEC.md',
      captureOutput: true,
      failOnError: true,
    })

    .step('lead-plan', {
      agent: 'lead-claude',
      dependsOn: ['read-workflow-standards', 'read-authoring-rules', 'read-generated-template', 'read-product-spec'],
      task: `Plan the workflow health analytics implementation.

Context inputs:
- docs/workflows/WORKFLOW_STANDARDS.md:
{{steps.read-workflow-standards.output}}
- workflows/shared/WORKFLOW_AUTHORING_RULES.md:
{{steps.read-authoring-rules.output}}
- workflows/meta/spec/generated-workflow-template.md:
{{steps.read-generated-template.output}}
- SPEC.md:
{{steps.read-product-spec.output}}

Deliverables:
- src/analytics/health-analyzer.ts
- src/analytics/digest-generator.ts
- src/analytics/types.ts
- src/analytics/health-analyzer.test.ts
- src/analytics/index.ts

Non-goals:
- Do not build dashboards.
- Do not require live Cloud telemetry.
- Do not mutate workflows automatically from analytics findings.

Verification:
- Analyzer must identify common failure classes, bad pattern choices, oversized steps, weak verification, retry rates, timeout rates, and missing hard gates from structured run-history input.
- Digest generator must produce concrete improvement recommendations, not generic summaries.
- Tests must cover representative successful, degraded, and empty-history cases.
- Post-edit gates must run after implementation and tests.

Commit/PR boundary:
- Keep changes scoped to src/analytics and imports from runtime evidence/failure types if they already exist.

Write .workflow-artifacts/wave5-scale-and-ops/workflow-health-analytics/plan.md ending with HEALTH_ANALYTICS_PLAN_READY.`,
      verification: { type: 'file_exists', value: '.workflow-artifacts/wave5-scale-and-ops/workflow-health-analytics/plan.md' },
    })

    .step('implement-health-analytics', {
      agent: 'impl-primary-codex',
      dependsOn: ['lead-plan'],
      task: `Implement workflow health analytics.

Deliverables:
- health-analyzer.ts should accept structured run histories and calculate failure class counts, retry and timeout rates, weak verification signals, step size warnings, and pattern-choice warnings.
- digest-generator.ts should convert analysis into structured digest output with findings, severity, evidence, and recommended actions.
- types.ts and index.ts should export public analytics contracts.

Non-goals:
- Do not read live databases.
- Do not implement notification delivery.
- Do not auto-edit workflow files.

Verification:
- Keep analysis deterministic.
- Prefer typed inputs that can be fed by local or Cloud evidence stores later.
- Recommendations must reference concrete signals from the analyzed history.`,
      verification: { type: 'file_exists', value: 'src/analytics/health-analyzer.ts' },
    })
    .step('post-implementation-file-gate', {
      type: 'deterministic',
      dependsOn: ['implement-health-analytics'],
      command: [
        'test -f src/analytics/health-analyzer.ts',
        'test -f src/analytics/digest-generator.ts',
        'test -f src/analytics/types.ts',
        'test -f src/analytics/index.ts',
        'grep -q "failure\\|timeout\\|retry\\|verification" src/analytics/health-analyzer.ts src/analytics/types.ts',
        'grep -q "recommend\\|digest\\|finding" src/analytics/digest-generator.ts src/analytics/types.ts',
        'grep -q "export" src/analytics/index.ts',
        'echo HEALTH_ANALYTICS_IMPLEMENTATION_FILES_PRESENT',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('implement-health-tests', {
      agent: 'impl-tests-codex',
      dependsOn: ['post-implementation-file-gate'],
      task: `Add tests for workflow health analytics.

Deliverables:
- src/analytics/health-analyzer.test.ts should cover failure class aggregation, retry/timeout rate calculation, weak verification detection, oversized step detection, pattern-choice warnings, digest generation, and empty-history behavior.

Non-goals:
- Do not depend on real run logs.
- Do not snapshot large text blobs when structured assertions are clearer.

Verification:
- Tests must prove recommendations are concrete and tied to evidence.
- Tests must prove empty history returns a useful no-data digest instead of crashing.`,
      verification: { type: 'file_exists', value: 'src/analytics/health-analyzer.test.ts' },
    })
    .step('post-test-file-gate', {
      type: 'deterministic',
      dependsOn: ['implement-health-tests'],
      command: [
        'test -f src/analytics/health-analyzer.test.ts',
        'grep -q "failure\\|timeout\\|retry" src/analytics/health-analyzer.test.ts src/analytics/health-analyzer.ts',
        'grep -q "verification\\|hard gate\\|weak" src/analytics/health-analyzer.test.ts src/analytics/health-analyzer.ts',
        'grep -q "recommend\\|digest" src/analytics/health-analyzer.test.ts src/analytics/digest-generator.ts',
        'changed="$(git diff --name-only -- src/analytics; git ls-files --others --exclude-standard -- src/analytics)" && printf "%s\n" "$changed" | grep -Eq "^src/analytics/"',
        'echo HEALTH_ANALYTICS_TEST_FILES_PRESENT',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('initial-soft-validation', {
      type: 'deterministic',
      dependsOn: ['post-test-file-gate'],
      command: 'npx tsc --noEmit && npx vitest run src/analytics/',
      captureOutput: true,
      failOnError: false,
    })

    .step('review-analytics-claude', {
      agent: 'reviewer-claude',
      dependsOn: ['initial-soft-validation'],
      task: `Review the workflow health analytics module.

Focus:
- Recommendations are actionable enough for Ricky to improve workflows.
- Failure classes, weak verification, pattern choices, retry rates, and timeout rates are represented.
- Empty and degraded histories produce honest output.
- Analytics closes the generation/debugging feedback loop without over-automating fixes.

Write .workflow-artifacts/wave5-scale-and-ops/workflow-health-analytics/review-claude.md ending with REVIEW_CLAUDE_PASS or REVIEW_CLAUDE_FAIL.`,
      verification: { type: 'file_exists', value: '.workflow-artifacts/wave5-scale-and-ops/workflow-health-analytics/review-claude.md' },
    })
    .step('review-analytics-codex', {
      agent: 'reviewer-codex',
      dependsOn: ['initial-soft-validation'],
      task: `Review workflow health analytics code and tests.

Focus:
- Deterministic calculations.
- Test coverage for edge cases.
- Type quality and export shape.
- No accidental live telemetry dependency.

Write .workflow-artifacts/wave5-scale-and-ops/workflow-health-analytics/review-codex.md ending with REVIEW_CODEX_PASS or REVIEW_CODEX_FAIL.`,
      verification: { type: 'file_exists', value: '.workflow-artifacts/wave5-scale-and-ops/workflow-health-analytics/review-codex.md' },
    })

    .step('read-review-feedback', {
      type: 'deterministic',
      dependsOn: ['review-analytics-claude', 'review-analytics-codex'],
      command: 'cat .workflow-artifacts/wave5-scale-and-ops/workflow-health-analytics/review-claude.md .workflow-artifacts/wave5-scale-and-ops/workflow-health-analytics/review-codex.md',
      captureOutput: true,
      failOnError: true,
    })
    .step('fix-health-analytics', {
      agent: 'validator-claude',
      dependsOn: ['read-review-feedback'],
      task: `Fix workflow health analytics issues from review feedback.

Review feedback:
{{steps.read-review-feedback.output}}

Rules:
- Keep analytics deterministic and evidence-backed.
- Update tests when contracts change.
- Do not add live telemetry dependencies.
- Re-run deterministic gates after changes.`,
      verification: { type: 'exit_code', value: '0' },
    })
    .step('post-fix-verification-gate', {
      type: 'deterministic',
      dependsOn: ['fix-health-analytics'],
      command: [
        'test -f src/analytics/health-analyzer.ts',
        'test -f src/analytics/digest-generator.ts',
        'test -f src/analytics/types.ts',
        'test -f src/analytics/health-analyzer.test.ts',
        'test -f src/analytics/index.ts',
        'grep -q "failure\\|timeout\\|retry\\|verification" src/analytics/health-analyzer.ts src/analytics/health-analyzer.test.ts',
        'grep -q "recommend\\|digest" src/analytics/digest-generator.ts src/analytics/health-analyzer.test.ts',
        'grep -q "export" src/analytics/index.ts',
        'echo HEALTH_ANALYTICS_POST_FIX_GATE_PASS',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })
    .step('post-fix-validation', {
      type: 'deterministic',
      dependsOn: ['post-fix-verification-gate'],
      command: 'npx tsc --noEmit && npx vitest run src/analytics/',
      captureOutput: true,
      failOnError: false,
    })

    .step('final-review-analytics-claude', {
      agent: 'reviewer-claude',
      dependsOn: ['post-fix-validation'],
      task: `Re-review the workflow health analytics module after fixes and post-fix validation.

Read src/analytics/ source and tests, and post-fix validation output:
{{steps.post-fix-validation.output}}

Confirm prior review findings are fixed or explicitly non-blocking. Re-check that recommendations are actionable, failure classes and rates are represented, empty/degraded histories produce honest output, and analytics closes the feedback loop without over-automating.

Write .workflow-artifacts/wave5-scale-and-ops/workflow-health-analytics/final-review-claude.md ending with FINAL_REVIEW_CLAUDE_PASS or FINAL_REVIEW_CLAUDE_FAIL.`,
      verification: { type: 'file_exists', value: '.workflow-artifacts/wave5-scale-and-ops/workflow-health-analytics/final-review-claude.md' },
    })
    .step('final-review-analytics-codex', {
      agent: 'reviewer-codex',
      dependsOn: ['post-fix-validation'],
      task: `Re-review workflow health analytics code and tests after fixes.

Read src/analytics/ source and tests, and post-fix validation output:
{{steps.post-fix-validation.output}}

Confirm deterministic calculations, test edge case coverage, type quality, export shape, and no accidental live telemetry dependency are ready for final hard gates.

Write .workflow-artifacts/wave5-scale-and-ops/workflow-health-analytics/final-review-codex.md ending with FINAL_REVIEW_CODEX_PASS or FINAL_REVIEW_CODEX_FAIL.`,
      verification: { type: 'file_exists', value: '.workflow-artifacts/wave5-scale-and-ops/workflow-health-analytics/final-review-codex.md' },
    })

    .step('final-review-pass-gate', {
      type: 'deterministic',
      dependsOn: ['final-review-analytics-claude', 'final-review-analytics-codex'],
      command: [
        'tail -n 1 .workflow-artifacts/wave5-scale-and-ops/workflow-health-analytics/final-review-claude.md | grep -Eq "^FINAL_REVIEW_CLAUDE_PASS$"',
        'tail -n 1 .workflow-artifacts/wave5-scale-and-ops/workflow-health-analytics/final-review-codex.md | grep -Eq "^FINAL_REVIEW_CODEX_PASS$"',
        'echo HEALTH_ANALYTICS_FINAL_REVIEW_PASS',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })
    .step('final-hard-validation', {
      type: 'deterministic',
      dependsOn: ['final-review-pass-gate'],
      command: 'npx tsc --noEmit && npx vitest run src/analytics/',
      captureOutput: true,
      failOnError: true,
    })
    .step('regression-gate', {
      type: 'deterministic',
      dependsOn: ['final-hard-validation'],
      command: [
        'npx tsc --noEmit',
        'changed="$(git diff --name-only; git ls-files --others --exclude-standard)"',
        'printf "%s\\n" "$changed" | grep -Eq "^src/analytics/"',
        '! printf "%s\\n" "$changed" | grep -Ev "^(src/analytics/|\\.workflow-artifacts/)"',
        'echo HEALTH_ANALYTICS_REGRESSION_GATE_PASS',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })
    .step('final-signoff', {
      agent: 'validator-claude',
      dependsOn: ['regression-gate'],
      task: `Write .workflow-artifacts/wave5-scale-and-ops/workflow-health-analytics/signoff.md.

Include files changed, validation commands, analytics contract summary, and remaining risks.
End with HEALTH_ANALYTICS_WORKFLOW_COMPLETE.`,
      verification: { type: 'file_exists', value: '.workflow-artifacts/wave5-scale-and-ops/workflow-health-analytics/signoff.md' },
    })

    .run({ cwd: process.cwd() });

  console.log(result.status);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
