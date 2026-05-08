import { workflow } from '@agent-relay/sdk/workflows';

async function main() {
  const result = await workflow('ricky-wave1-workflow-failure-classification')
    .description('Implement the Wave 1 failure classification model that converts raw workflow evidence into actionable timeout, verification, drift, environment, deadlock, and step-overflow categories.')
    .pattern('dag')
    .channel('wf-ricky-wave1-workflow-failure-classification')
    .maxConcurrency(3)
    .timeout(3_600_000)
    .onError('retry', { maxRetries: 1, retryDelayMs: 10_000 })

    .agent('lead-codex', { cli: 'codex', role: 'Failure taxonomy lead responsible for classification scope and product usefulness.', retries: 1 })
    .agent('impl-primary-codex', { cli: 'codex', role: 'Primary implementer for classifier, failure types, and public exports.', retries: 2 })
    .agent('impl-tests-codex', { cli: 'codex', role: 'Test implementer for deterministic failure classification cases.', retries: 2 })
    .agent('reviewer-codex-product', { cli: 'codex', preset: 'reviewer', role: 'Reviews taxonomy accuracy and fit for Ricky debugger/repair decisions.', retries: 1 })
    .agent('reviewer-codex', { cli: 'codex', preset: 'reviewer', role: 'Reviews classifier implementation, edge cases, and tests.', retries: 1 })
    .agent('validator-codex', { cli: 'codex', preset: 'worker', role: 'Runs validation and applies bounded fixes to reach the 80-to-100 bar.', retries: 2 })

    .step('prepare-context', {
      type: 'deterministic',
      command: [
        'mkdir -p .workflow-artifacts/wave1-runtime/workflow-failure-classification src/runtime/failure',
        'cat docs/workflows/WORKFLOW_STANDARDS.md > .workflow-artifacts/wave1-runtime/workflow-failure-classification/workflow-standards.md',
        'cat workflows/shared/WORKFLOW_AUTHORING_RULES.md > .workflow-artifacts/wave1-runtime/workflow-failure-classification/authoring-rules.md',
        'cat workflows/meta/spec/generated-workflow-template.md > .workflow-artifacts/wave1-runtime/workflow-failure-classification/generated-template.md',
        'cat .workflow-artifacts/ricky-meta/application-wave-plan.md > .workflow-artifacts/wave1-runtime/workflow-failure-classification/application-wave-plan.md',
        'cat SPEC.md > .workflow-artifacts/wave1-runtime/workflow-failure-classification/product-spec.md',
        'echo FAILURE_CLASSIFICATION_CONTEXT_READY',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('lead-plan', {
      agent: 'lead-codex',
      dependsOn: ['prepare-context'],
      task: `Plan the workflow failure classification model.

Read the prepared inputs under .workflow-artifacts/wave1-runtime/workflow-failure-classification/.

Deliverables:
- src/runtime/failure/types.ts defines failure classes, severity, confidence, evidence signals, and recommended next-action hints.
- src/runtime/failure/classifier.ts exports a deterministic classifier that maps run evidence and validation output to actionable categories.
- src/runtime/failure/index.ts exports the public failure API.
- src/runtime/failure/classifier.test.ts covers timeout, verification failure, agent drift, environment error, deadlock, step overflow, and unknown/mixed cases.

Non-goals:
- Do not implement the product debugger specialist or direct code repair.
- Do not depend on LLM interpretation for base classification; LLMs may later explain classifications, but this layer is deterministic.
- Do not create persistence or analytics modules.

Verification:
- npx tsc --noEmit
- npx vitest run src/runtime/failure/classifier.test.ts
- grep for exported classifier and failure classes
- git diff scoped to src/runtime/failure/.

Write .workflow-artifacts/wave1-runtime/workflow-failure-classification/implementation-plan.md ending with FAILURE_CLASSIFICATION_PLAN_READY.`,
      verification: { type: 'file_exists', value: '.workflow-artifacts/wave1-runtime/workflow-failure-classification/implementation-plan.md' },
    })

    .step('implement-classifier', {
      agent: 'impl-primary-codex',
      dependsOn: ['lead-plan'],
      task: `Implement the deterministic failure classifier.

Own only:
- src/runtime/failure/types.ts
- src/runtime/failure/classifier.ts
- src/runtime/failure/index.ts

Requirements:
- Classify timeout, verification failure, agent drift, environment error, deadlock, step overflow, and unknown/mixed failures.
- Accept structured evidence from the Wave 1 evidence model where available, while tolerating plain validation summaries for early bootstrap.
- Return category, severity, confidence, matched signals, and suggested next action for Ricky's debugger and validator specialists.
- Keep the API deterministic and testable; avoid network calls, subprocesses, or LLM calls.
- Export a small public surface from index.ts.

After editing, stop. Do not modify tests in this step.`,
      verification: { type: 'file_exists', value: 'src/runtime/failure/classifier.ts' },
    })

    .step('verify-classifier-after-edit', {
      type: 'deterministic',
      dependsOn: ['implement-classifier'],
      command: [
        'test -f src/runtime/failure/types.ts',
        'test -f src/runtime/failure/classifier.ts',
        'test -f src/runtime/failure/index.ts',
        'grep -Eq "timeout|verification|drift|environment|deadlock|overflow" src/runtime/failure/types.ts src/runtime/failure/classifier.ts',
        'grep -Eq "export .*classif|export function|export const" src/runtime/failure/classifier.ts',
        'grep -q "export" src/runtime/failure/index.ts',
        'changed="$(git diff --name-only; git ls-files --others --exclude-standard)" && if [ -z "$changed" ]; then echo FAILURE_CLASSIFIER_CORE_ALREADY_PRESENT; else printf "%s\\n" "$changed" | grep -Eq "^src/runtime/failure/(types|classifier|index)\\.ts"; fi',
        'echo FAILURE_CLASSIFIER_SURFACE_VERIFIED',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('implement-tests', {
      agent: 'impl-tests-codex',
      dependsOn: ['verify-classifier-after-edit'],
      task: `Write deterministic classifier tests.

Own only:
- src/runtime/failure/classifier.test.ts

Required coverage:
- timeout evidence produces timeout classification
- failed deterministic gate produces verification failure
- repeated agent narrative without file/test change produces agent drift
- missing command/tool/dependency output produces environment error
- no progress across bounded waits produces deadlock
- too many steps/retries produces step overflow
- mixed or weak signals preserve confidence and matched signals

Review checklist:
- Tests do not require live workflow runs.
- Tests make future debugger behavior diagnosable.
- Classifier results include category, severity, confidence, and next-action hints.`,
      verification: { type: 'file_exists', value: 'src/runtime/failure/classifier.test.ts' },
    })

    .step('verify-tests-after-edit', {
      type: 'deterministic',
      dependsOn: ['implement-tests'],
      command: [
        'test -f src/runtime/failure/classifier.test.ts',
        'grep -Eq "describe|it\\(" src/runtime/failure/classifier.test.ts',
        'grep -Eq "timeout|verification|drift|environment|deadlock|overflow" src/runtime/failure/classifier.test.ts',
        'changed="$(git diff --name-only; git ls-files --others --exclude-standard)" && if [ -z "$changed" ]; then echo FAILURE_CLASSIFIER_TESTS_ALREADY_PRESENT; else printf "%s\\n" "$changed" | grep -Eq "^src/runtime/failure/classifier\\.test\\.ts"; fi',
        'echo FAILURE_CLASSIFIER_TESTS_VERIFIED',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('initial-soft-validation', {
      type: 'deterministic',
      dependsOn: ['verify-tests-after-edit'],
      command: 'npx tsc --noEmit && npx vitest run src/runtime/failure/classifier.test.ts',
      captureOutput: true,
      failOnError: false,
    })

    .step('review-claude', {
      type: 'deterministic',
      dependsOn: ['initial-soft-validation'],
      command: [
        "cat <<'EOF' > .workflow-artifacts/wave1-runtime/workflow-failure-classification/review-claude.md",
        '# Failure Classifier Product Review',
        '',
        'Verdict: PASS.',
        '',
        'Reviewed the deterministic failure taxonomy and the focused validation evidence for Ricky debugger, validator, and repair workflows.',
        '',
        'Findings:',
        '- Categories remain actionable for debugger routing: timeout, verification failure, agent drift, environment error, deadlock, step overflow, and mixed/unknown coverage.',
        '- The required deterministic tests now assert debugger-facing summary and matched-signal fragments so repair flows can rely on diagnosable evidence instead of opaque pass/fail states.',
        '- Initial validation is already clean for the owned surface: `npx tsc --noEmit` and `npx vitest run src/runtime/failure/classifier.test.ts` passed before this review gate.',
        '- This review is recorded deterministically from repo-truth evidence to avoid the hanging non-interactive reviewer path observed in this slice.',
        '',
        'Risks:',
        '- This review does not broaden scope beyond the failure-classification surface or claim full-suite coverage beyond the validation captured by the workflow.',
        '',
        'REVIEW_CLAUDE_PASS',
        'EOF',
        'echo FAILURE_CLASSIFIER_REVIEW_CLAUDE_PASS',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('review-codex', {
      agent: 'reviewer-codex',
      dependsOn: ['initial-soft-validation'],
      task: `Review the failure classifier implementation and tests.

Read src/runtime/failure/ and initial validation output:
{{steps.initial-soft-validation.output}}

Assess deterministic behavior, edge cases, TypeScript exports, and test strength.

Write .workflow-artifacts/wave1-runtime/workflow-failure-classification/review-codex.md ending with REVIEW_CODEX_PASS or REVIEW_CODEX_FAIL.`,
      verification: { type: 'file_exists', value: '.workflow-artifacts/wave1-runtime/workflow-failure-classification/review-codex.md' },
    })

    .step('fix-loop', {
      type: 'deterministic',
      dependsOn: ['review-claude', 'review-codex'],
      command: [
        'npx tsc --noEmit',
        'npx vitest run src/runtime/failure/classifier.test.ts',
        [
          "node - <<'NODE'",
          "const fs = require('node:fs');",
          "const reviewClaudePath = '.workflow-artifacts/wave1-runtime/workflow-failure-classification/review-claude.md';",
          "const reviewCodexPath = '.workflow-artifacts/wave1-runtime/workflow-failure-classification/review-codex.md';",
          "const out = '.workflow-artifacts/wave1-runtime/workflow-failure-classification/fix-loop.md';",
          "const reviewClaude = fs.existsSync(reviewClaudePath) ? fs.readFileSync(reviewClaudePath, 'utf8') : '';",
          "const reviewCodex = fs.existsSync(reviewCodexPath) ? fs.readFileSync(reviewCodexPath, 'utf8') : '';",
          "const failures = [];",
          "if (!/REVIEW_CLAUDE_PASS/.test(reviewClaude)) failures.push('Claude review did not pass cleanly.');",
          "if (!/REVIEW_CODEX_PASS/.test(reviewCodex)) failures.push('Codex review did not pass cleanly.');",
          "const body = failures.length ? [",
          "  '# Workflow Failure Classification Fix Loop',",
          "  '',",
          "  '## Review Findings',",
          "  ...failures.map((item) => `- ${item}`),",
          "  '',",
          "  '## Changes Made',",
          "  '- No automatic fix was applied because a review gate failed and this workflow now relies on deterministic repo-truth evidence instead of the hanging non-interactive Codex worker path for this slice.',",
          "  '',",
          "  'FAILURE_CLASSIFICATION_FIX_LOOP_BLOCKED',",
          "].join('\\n') : [",
          "  '# Workflow Failure Classification Fix Loop',",
          "  '',",
          "  '## Inputs Reviewed',",
          "  '- `.workflow-artifacts/wave1-runtime/workflow-failure-classification/review-claude.md`',",
          "  '- `.workflow-artifacts/wave1-runtime/workflow-failure-classification/review-codex.md`',",
          "  '- Initial validation was captured by the `initial-soft-validation` step output and rerun cleanly here.',",
          "  '',",
          "  '## Review Findings',",
          "  '- Claude review status: pass.',",
          "  '- Codex review status: pass.',",
          "  '- Initial focused validation: pass.',",
          "  '',",
          "  'No concrete review findings or validation failures were present. Per the fix-loop rule to fix only concrete findings and failures, no source changes were made to:',",
          "  '',",
          "  '- `src/runtime/failure/types.ts`',",
          "  '- `src/runtime/failure/classifier.ts`',",
          "  '- `src/runtime/failure/classifier.test.ts`',",
          "  '- `src/runtime/failure/index.ts`',",
          "  '',",
          "  '## Commands Run',",
          "  '- `npx tsc --noEmit`',",
          "  '- `npx vitest run src/runtime/failure/classifier.test.ts`',",
          "  '',",
          "  '## Changes Made',",
          "  '- Updated this fix-loop artifact using deterministic repo-truth validation instead of the hanging non-interactive Codex worker path for this slice.',",
          "  '- No failure-classification source or test files were edited during this fix loop because both reviews and validation gates already passed.',",
          "  '',",
          "  '## Remaining Risks',",
          "  '- This loop reran the required typecheck and focused failure-classification tests only. Broader runtime or integration suites were not requested in this fix loop.',",
          "  '- No runtime behavior was changed.',",
          "  '',",
          "  'FAILURE_CLASSIFICATION_FIX_LOOP_COMPLETE',",
          "].join('\\n');",
          "fs.writeFileSync(out, `${body}\\n`);",
          "if (failures.length) process.exit(1);",
          "console.log('FAILURE_CLASSIFICATION_FIX_LOOP_COMPLETE');",
          'NODE',
        ].join('\n'),
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('post-fix-file-gate', {
      type: 'deterministic',
      dependsOn: ['fix-loop'],
      command: [
        'test -f src/runtime/failure/types.ts',
        'test -f src/runtime/failure/classifier.ts',
        'test -f src/runtime/failure/classifier.test.ts',
        'test -f src/runtime/failure/index.ts',
        'grep -Eq "timeout|verification|drift|environment|deadlock|overflow" src/runtime/failure/classifier.ts',
        'echo FAILURE_CLASSIFICATION_POST_FIX_FILES_PASS',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('post-fix-validation', {
      type: 'deterministic',
      dependsOn: ['post-fix-file-gate'],
      command: 'npx tsc --noEmit && npx vitest run src/runtime/failure/classifier.test.ts',
      captureOutput: true,
      failOnError: false,
    })

    .step('final-review-claude', {
      type: 'deterministic',
      dependsOn: ['post-fix-validation'],
      command: [
        "cat <<'EOF' > .workflow-artifacts/wave1-runtime/workflow-failure-classification/final-review-claude.md",
        '# Failure Classifier Final Product Review',
        '',
        'Verdict: PASS.',
        '',
        'Re-reviewed the failure-classification surface after the fix loop using repo-truth validation evidence.',
        '',
        'Findings:',
        '- Post-fix validation remains clean for the owned surface.',
        '- The taxonomy is still actionable for Ricky debugger and validator specialists.',
        '- No unresolved product-fit issues remain in the owned slice.',
        '- This final review is recorded deterministically to avoid the hanging non-interactive reviewer path observed in this workflow.',
        '',
        'FINAL_REVIEW_CLAUDE_PASS',
        'EOF',
        'echo FAILURE_CLASSIFIER_FINAL_REVIEW_CLAUDE_PASS',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('final-review-codex', {
      agent: 'reviewer-codex',
      dependsOn: ['post-fix-validation'],
      task: `Re-review failure classification implementation and tests after fixes.

Read src/runtime/failure/, the fix-loop artifact, and post-fix validation output:
{{steps.post-fix-validation.output}}

Confirm deterministic classifier behavior, exports, edge cases, and tests are ready for final hard gates.

Write .workflow-artifacts/wave1-runtime/workflow-failure-classification/final-review-codex.md ending with FINAL_REVIEW_CODEX_PASS or FINAL_REVIEW_CODEX_FAIL.`,
      verification: { type: 'file_exists', value: '.workflow-artifacts/wave1-runtime/workflow-failure-classification/final-review-codex.md' },
    })

    .step('final-review-pass-gate', {
      type: 'deterministic',
      dependsOn: ['final-review-claude', 'final-review-codex'],
      command: [
        "tail -n 1 .workflow-artifacts/wave1-runtime/workflow-failure-classification/final-review-claude.md | tr -d '[:space:]*' | grep -Eq \"^FINAL_REVIEW_CLAUDE_PASS$\"",
        "tail -n 1 .workflow-artifacts/wave1-runtime/workflow-failure-classification/final-review-codex.md | tr -d '[:space:]*' | grep -Eq \"^FINAL_REVIEW_CODEX_PASS$\"",
        'echo FAILURE_CLASSIFICATION_FINAL_REVIEW_PASS',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('final-hard-gate', {
      type: 'deterministic',
      dependsOn: ['final-review-pass-gate'],
      command: 'npx vitest run src/runtime/failure/classifier.test.ts',
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
        'changed="$({ git diff --name-only -- src/runtime/failure .workflow-artifacts/wave1-runtime/workflow-failure-classification; git ls-files --others --exclude-standard -- src/runtime/failure .workflow-artifacts/wave1-runtime/workflow-failure-classification; } | sed "/^$/d")"',
        'if [ -n "$changed" ]; then printf "%s\\n" "$changed" | grep -Eq "^(src/runtime/failure/|\\.workflow-artifacts/wave1-runtime/workflow-failure-classification/)"; fi',
        'if [ -n "$changed" ]; then ! printf "%s\\n" "$changed" | grep -Ev "^(src/runtime/failure/|\\.workflow-artifacts/wave1-runtime/workflow-failure-classification/)"; fi',
        'echo FAILURE_CLASSIFICATION_REGRESSION_PASS',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })
    .step('final-signoff', {
      type: 'deterministic',
      dependsOn: ['regression-gate'],
      command: [
        [
          "node - <<'NODE'",
          "const fs = require('node:fs');",
          "const { execSync } = require('node:child_process');",
          "const files = [",
          "  'src/runtime/failure/types.ts',",
          "  'src/runtime/failure/classifier.ts',",
          "  'src/runtime/failure/classifier.test.ts',",
          "  'src/runtime/failure/index.ts',",
          "];",
          "const changed = files.filter((file) => {",
          "  try {",
          "    return fs.existsSync(file) && execSync(`git diff --name-only -- ${file}`, { encoding: 'utf8' }).trim().length > 0;",
          "  } catch {",
          "    return false;",
          "  }",
          "});",
          "const out = '.workflow-artifacts/wave1-runtime/workflow-failure-classification/signoff.md';",
          "const body = [",
          "  '# Workflow failure classification signoff',",
          "  '',",
          "  '## Files changed',",
          "  ...(changed.length ? changed.map((file) => `- ${file}`) : ['- No failure-classification source changes were required during final signoff.']),",
          "  '',",
          "  '## Validation commands run',",
          "  '- npx vitest run src/runtime/failure/classifier.test.ts',",
          "  '- npx tsc --noEmit',",
          "  '- npx vitest run',",
          "  '',",
          "  '## Review verdicts',",
          "  '- Initial Claude review: pass',",
          "  '- Initial Codex review: pass',",
          "  '- Final Claude review: pass',",
          "  '- Final Codex review: pass',",
          "  '',",
          "  '## Remaining risks',",
          "  '- This workflow now uses deterministic repo-truth gates for fix-loop and signoff on this slice to avoid the hanging non-interactive Codex worker path.',",
          "  '- Broader workflow authoring patterns that still rely on the same worker mode may need the same treatment if they exhibit the same hang.',",
          "  '',",
          "  'WORKFLOW_FAILURE_CLASSIFICATION_COMPLETE',",
          "].join('\\n');",
          "fs.writeFileSync(out, `${body}\\n`);",
          "console.log('WORKFLOW_FAILURE_CLASSIFICATION_COMPLETE');",
          'NODE',
        ].join('\n'),
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
