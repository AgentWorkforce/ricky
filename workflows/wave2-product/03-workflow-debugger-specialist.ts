import { workflow } from '@agent-relay/sdk/workflows';

async function main() {
  const result = await workflow('ricky-wave2-workflow-debugger-specialist')
    .description('Implement the Wave 2 workflow debugger specialist that turns failed run evidence into bounded diagnoses and fix recommendations or direct repairs.')
    .pattern('dag')
    .channel('wf-ricky-wave2-workflow-debugger-specialist')
    .maxConcurrency(3)
    .timeout(3_600_000)
    .onError('retry', { maxRetries: 1, retryDelayMs: 10_000 })

    .agent('lead-claude', { cli: 'claude', role: 'Debugger specialist lead responsible for diagnosis scope, repair boundaries, and product fit.', retries: 1 })
    .agent('impl-primary-codex', { cli: 'codex', role: 'Primary implementer for debugger, diagnosis, fix recommender, types, and exports.', retries: 2 })
    .agent('impl-tests-codex', { cli: 'codex', role: 'Test implementer for debugger diagnosis and fix recommendation behavior.', retries: 2 })
    .agent('reviewer-claude', { cli: 'claude', preset: 'reviewer', role: 'Reviews debugger behavior, user-facing diagnosis quality, and repair safety.', retries: 1 })
    .agent('reviewer-codex', { cli: 'codex', preset: 'reviewer', role: 'Reviews implementation quality, deterministic behavior, and tests.', retries: 1 })
    .agent('validator-claude', { cli: 'claude', preset: 'worker', role: 'Applies bounded fixes and validation reruns until debugger reaches the 80-to-100 bar.', retries: 2 })

    .step('prepare-context', {
      type: 'deterministic',
      command: [
        'mkdir -p .workflow-artifacts/wave2-product/workflow-debugger-specialist src/product/specialists/debugger',
        'cat docs/workflows/WORKFLOW_STANDARDS.md > .workflow-artifacts/wave2-product/workflow-debugger-specialist/workflow-standards.md',
        'cat workflows/shared/WORKFLOW_AUTHORING_RULES.md > .workflow-artifacts/wave2-product/workflow-debugger-specialist/authoring-rules.md',
        'cat workflows/meta/spec/generated-workflow-template.md > .workflow-artifacts/wave2-product/workflow-debugger-specialist/generated-template.md',
        'cat .workflow-artifacts/ricky-meta/application-wave-plan.md > .workflow-artifacts/wave2-product/workflow-debugger-specialist/application-wave-plan.md',
        'cat SPEC.md > .workflow-artifacts/wave2-product/workflow-debugger-specialist/product-spec.md',
        'echo DEBUGGER_SPECIALIST_CONTEXT_READY',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('lead-plan', {
      agent: 'lead-claude',
      dependsOn: ['prepare-context'],
      task: `Plan the workflow debugger specialist implementation.

Read the prepared context under .workflow-artifacts/wave2-product/workflow-debugger-specialist/.

Deliverables:
- src/product/specialists/debugger/types.ts defines debugger input, diagnosis, cause mapping, fix recommendation, repair mode, and debugger result types.
- src/product/specialists/debugger/diagnosis.ts maps runtime failure classifications and evidence signals to workflow-layer causes.
- src/product/specialists/debugger/fix-recommender.ts produces bounded fix recommendations, required verification, and direct-repair eligibility.
- src/product/specialists/debugger/debugger.ts orchestrates diagnosis and recommendation for failed workflow runs.
- src/product/specialists/debugger/index.ts exports the public debugger API.
- src/product/specialists/debugger/debugger.test.ts covers verification failures, agent drift, missing files, oversized steps, environment errors, and direct-repair refusal when unsafe.

Non-goals:
- Do not implement the runtime failure classifier itself; consume its output or compatible evidence.
- Do not run arbitrary edits without a bounded recommendation and verification plan.
- Do not implement workflow generation, spec intake parsing, Cloud auth, or local command execution.

Verification:
- npx tsc --noEmit
- npx vitest run src/product/specialists/debugger/
- grep for debugger and diagnosis exports
- git diff scoped to src/product/specialists/debugger/.

Write .workflow-artifacts/wave2-product/workflow-debugger-specialist/implementation-plan.md ending with DEBUGGER_SPECIALIST_PLAN_READY.`,
      verification: { type: 'file_exists', value: '.workflow-artifacts/wave2-product/workflow-debugger-specialist/implementation-plan.md' },
    })

    .step('implement-debugger-core', {
      agent: 'impl-primary-codex',
      dependsOn: ['lead-plan'],
      task: `Implement the debugger specialist core.

Own only:
- src/product/specialists/debugger/types.ts
- src/product/specialists/debugger/diagnosis.ts
- src/product/specialists/debugger/fix-recommender.ts
- src/product/specialists/debugger/debugger.ts
- src/product/specialists/debugger/index.ts

Requirements:
- Accept failed workflow evidence and failure classifications from the runtime layer.
- Map raw failure classes to workflow-layer causes such as missing deterministic gates, wrong pattern choice, oversized agent step, missing file materialization, brittle grep, environment prerequisite, or agent drift.
- Produce fix recommendations with scope, confidence, files likely touched, verification commands, and whether direct repair is safe.
- Refuse direct repair when evidence is too weak, scope is too broad, or product/user intent is ambiguous.
- Keep diagnosis deterministic and structured so Cloud, CLI, MCP, and local/BYOH surfaces can present the same result.

After editing, stop. Do not modify tests in this step.`,
      verification: { type: 'file_exists', value: 'src/product/specialists/debugger/debugger.ts' },
    })

    .step('verify-core-after-edit', {
      type: 'deterministic',
      dependsOn: ['implement-debugger-core'],
      command: [
        'test -f src/product/specialists/debugger/types.ts',
        'test -f src/product/specialists/debugger/diagnosis.ts',
        'test -f src/product/specialists/debugger/fix-recommender.ts',
        'test -f src/product/specialists/debugger/debugger.ts',
        'test -f src/product/specialists/debugger/index.ts',
        'grep -Eq "diagnos|recommend|repair|classification|evidence" src/product/specialists/debugger/debugger.ts src/product/specialists/debugger/diagnosis.ts src/product/specialists/debugger/fix-recommender.ts',
        'grep -q "export" src/product/specialists/debugger/index.ts',
        'changed="$(git diff --name-only; git ls-files --others --exclude-standard)" && printf "%s\\n" "$changed" | grep -Eq "^src/product/specialists/debugger/(types|diagnosis|fix-recommender|debugger|index)\\.ts"',
        'echo DEBUGGER_SPECIALIST_CORE_VERIFIED',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('implement-tests', {
      agent: 'impl-tests-codex',
      dependsOn: ['verify-core-after-edit'],
      task: `Write debugger specialist tests.

Own only:
- src/product/specialists/debugger/debugger.test.ts

Required coverage:
- verification failure maps to a deterministic gate or assertion fix recommendation.
- agent drift maps to step scoping/prompt repair, not blind rerun.
- missing file materialization produces a file_exists gate recommendation.
- oversized step produces a split-step recommendation.
- environment error produces prerequisite guidance and refuses direct repair.
- weak or conflicting evidence returns a bounded clarify/manual-review result.

Review checklist:
- Tests do not invoke LLMs or real workflow runs.
- Tests prove the debugger supports generated workflows after failures.
- Recommendations include verification commands and scope limits.`,
      verification: { type: 'file_exists', value: 'src/product/specialists/debugger/debugger.test.ts' },
    })

    .step('verify-tests-after-edit', {
      type: 'deterministic',
      dependsOn: ['implement-tests'],
      command: [
        'test -f src/product/specialists/debugger/debugger.test.ts',
        'grep -Eq "describe|it\\(" src/product/specialists/debugger/debugger.test.ts',
        'grep -Eq "verification|drift|missing|environment|repair|recommend" src/product/specialists/debugger/debugger.test.ts',
        'changed="$(git diff --name-only; git ls-files --others --exclude-standard)" && printf "%s\\n" "$changed" | grep -Eq "^src/product/specialists/debugger/debugger\\.test\\.ts"',
        'echo DEBUGGER_SPECIALIST_TESTS_VERIFIED',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('initial-soft-validation', {
      type: 'deterministic',
      dependsOn: ['verify-tests-after-edit'],
      command: 'npx tsc --noEmit && npx vitest run src/product/specialists/debugger/',
      captureOutput: true,
      failOnError: false,
    })

    .step('review-claude', {
      agent: 'reviewer-claude',
      dependsOn: ['initial-soft-validation'],
      task: `Review debugger specialist product behavior.

Read src/product/specialists/debugger/ and initial validation output:
{{steps.initial-soft-validation.output}}

Assess whether diagnosis and fix recommendations are bounded, evidence-driven, safe for direct repair, and usable from Claude, CLI, MCP, Cloud, and local surfaces.

Write .workflow-artifacts/wave2-product/workflow-debugger-specialist/review-claude.md ending with REVIEW_CLAUDE_PASS or REVIEW_CLAUDE_FAIL.`,
      verification: { type: 'file_exists', value: '.workflow-artifacts/wave2-product/workflow-debugger-specialist/review-claude.md' },
    })

    .step('review-codex', {
      agent: 'reviewer-codex',
      dependsOn: ['initial-soft-validation'],
      task: `Review debugger specialist implementation and tests.

Read src/product/specialists/debugger/ and initial validation output:
{{steps.initial-soft-validation.output}}

Assess deterministic logic, TypeScript contracts, direct-repair safety flags, and test coverage.

Write .workflow-artifacts/wave2-product/workflow-debugger-specialist/review-codex.md ending with REVIEW_CODEX_PASS or REVIEW_CODEX_FAIL.`,
      verification: { type: 'file_exists', value: '.workflow-artifacts/wave2-product/workflow-debugger-specialist/review-codex.md' },
    })

    .step('fix-loop', {
      agent: 'validator-claude',
      dependsOn: ['review-claude', 'review-codex'],
      task: `Run the 80-to-100 fix loop for the debugger specialist.

Inputs:
- .workflow-artifacts/wave2-product/workflow-debugger-specialist/review-claude.md
- .workflow-artifacts/wave2-product/workflow-debugger-specialist/review-codex.md
- Initial validation output:
{{steps.initial-soft-validation.output}}

Fix only concrete issues in src/product/specialists/debugger/. Re-run npx tsc --noEmit and npx vitest run src/product/specialists/debugger/.

Write .workflow-artifacts/wave2-product/workflow-debugger-specialist/fix-loop.md ending with DEBUGGER_SPECIALIST_FIX_LOOP_COMPLETE.`,
      verification: { type: 'file_exists', value: '.workflow-artifacts/wave2-product/workflow-debugger-specialist/fix-loop.md' },
    })

    .step('post-fix-file-gate', {
      type: 'deterministic',
      dependsOn: ['fix-loop'],
      command: [
        'test -f src/product/specialists/debugger/debugger.ts',
        'test -f src/product/specialists/debugger/diagnosis.ts',
        'test -f src/product/specialists/debugger/fix-recommender.ts',
        'test -f src/product/specialists/debugger/debugger.test.ts',
        'test -f src/product/specialists/debugger/index.ts',
        'grep -Eq "diagnos|recommend|repair" src/product/specialists/debugger/debugger.ts',
        'echo DEBUGGER_SPECIALIST_POST_FIX_FILES_PASS',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('post-fix-validation', {
      type: 'deterministic',
      dependsOn: ['post-fix-file-gate'],
      command: 'npx tsc --noEmit && npx vitest run src/product/specialists/debugger/',
      captureOutput: true,
      failOnError: false,
    })

    .step('final-review-claude', {
      agent: 'reviewer-claude',
      dependsOn: ['post-fix-validation'],
      task: `Re-review debugger specialist after the fix loop.

Read src/product/specialists/debugger/, the fix-loop artifact, and post-fix validation output:
{{steps.post-fix-validation.output}}

Confirm prior findings are fixed or explicitly non-blocking, and that recommendations remain evidence-driven, bounded, and safe across Claude, CLI, MCP, Cloud, and local surfaces.

Write .workflow-artifacts/wave2-product/workflow-debugger-specialist/final-review-claude.md ending with FINAL_REVIEW_CLAUDE_PASS or FINAL_REVIEW_CLAUDE_FAIL.`,
      verification: { type: 'file_exists', value: '.workflow-artifacts/wave2-product/workflow-debugger-specialist/final-review-claude.md' },
    })

    .step('final-review-codex', {
      agent: 'reviewer-codex',
      dependsOn: ['post-fix-validation'],
      task: `Re-review debugger specialist implementation and tests after fixes.

Read src/product/specialists/debugger/, the fix-loop artifact, and post-fix validation output:
{{steps.post-fix-validation.output}}

Confirm deterministic diagnosis, repair safety flags, exports, and tests are ready for final hard gates.

Write .workflow-artifacts/wave2-product/workflow-debugger-specialist/final-review-codex.md ending with FINAL_REVIEW_CODEX_PASS or FINAL_REVIEW_CODEX_FAIL.`,
      verification: { type: 'file_exists', value: '.workflow-artifacts/wave2-product/workflow-debugger-specialist/final-review-codex.md' },
    })

    .step('final-review-pass-gate', {
      type: 'deterministic',
      dependsOn: ['final-review-claude', 'final-review-codex'],
      command: [
        'tail -n 1 .workflow-artifacts/wave2-product/workflow-debugger-specialist/final-review-claude.md | grep -Eq "^FINAL_REVIEW_CLAUDE_PASS$"',
        'tail -n 1 .workflow-artifacts/wave2-product/workflow-debugger-specialist/final-review-codex.md | grep -Eq "^FINAL_REVIEW_CODEX_PASS$"',
        'echo DEBUGGER_SPECIALIST_FINAL_REVIEW_PASS',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('final-hard-gate', {
      type: 'deterministic',
      dependsOn: ['final-review-pass-gate'],
      command: 'npx vitest run src/product/specialists/debugger/',
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
        'changed="$(git diff --name-only; git ls-files --others --exclude-standard)" && printf "%s\\n" "$changed" | grep -Eq "^src/product/specialists/debugger/"',
        '! printf "%s\\n" "$changed" | grep -Ev "^(src/product/specialists/debugger/|\\.workflow-artifacts/)"',
        'echo DEBUGGER_SPECIALIST_REGRESSION_PASS',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })
    .step('final-signoff', {
      agent: 'validator-claude',
      dependsOn: ['regression-gate'],
      task: `Write .workflow-artifacts/wave2-product/workflow-debugger-specialist/signoff.md.

Include files changed, validation commands run, review verdicts, and remaining risks.
End with WORKFLOW_DEBUGGER_SPECIALIST_COMPLETE.`,
      verification: { type: 'file_exists', value: '.workflow-artifacts/wave2-product/workflow-debugger-specialist/signoff.md' },
    })

    .run({ cwd: process.cwd() });

  console.log(result.status);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
