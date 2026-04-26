import { workflow } from '@agent-relay/sdk/workflows';

async function main() {
  const result = await workflow('ricky-wave1-workflow-evidence-model')
    .description('Implement the Wave 1 workflow evidence capture model for per-step status, verification results, logs, artifacts, and retry history.')
    .pattern('dag')
    .channel('wf-ricky-wave1-workflow-evidence-model')
    .maxConcurrency(3)
    .timeout(3_600_000)
    .onError('retry', { maxRetries: 1, retryDelayMs: 10_000 })

    .agent('lead-claude', { cli: 'claude', role: 'Runtime evidence lead who owns scope, contracts, and final signoff.', retries: 1 })
    .agent('impl-primary-codex', { cli: 'codex', role: 'Primary implementer for evidence types, capture utilities, and index exports.', retries: 2 })
    .agent('impl-tests-codex', { cli: 'codex', role: 'Test implementer for deterministic evidence capture coverage.', retries: 2 })
    .agent('reviewer-claude', { cli: 'claude', preset: 'reviewer', role: 'Reviews evidence completeness for Ricky debugging, reporting, and fix loops.', retries: 1 })
    .agent('reviewer-codex', { cli: 'codex', preset: 'reviewer', role: 'Reviews TypeScript shape, utility behavior, and test quality.', retries: 1 })
    .agent('validator-claude', { cli: 'claude', preset: 'worker', role: 'Applies review and validation fixes until evidence capture reaches the 80-to-100 bar.', retries: 2 })

    .step('prepare-context', {
      type: 'deterministic',
      command: [
        'mkdir -p .workflow-artifacts/wave1-runtime/workflow-evidence-model src/runtime/evidence',
        'cat docs/workflows/WORKFLOW_STANDARDS.md > .workflow-artifacts/wave1-runtime/workflow-evidence-model/workflow-standards.md',
        'cat workflows/shared/WORKFLOW_AUTHORING_RULES.md > .workflow-artifacts/wave1-runtime/workflow-evidence-model/authoring-rules.md',
        'cat workflows/meta/spec/generated-workflow-template.md > .workflow-artifacts/wave1-runtime/workflow-evidence-model/generated-template.md',
        'cat .workflow-artifacts/ricky-meta/application-wave-plan.md > .workflow-artifacts/wave1-runtime/workflow-evidence-model/application-wave-plan.md',
        'cat SPEC.md > .workflow-artifacts/wave1-runtime/workflow-evidence-model/product-spec.md',
        'echo WORKFLOW_EVIDENCE_CONTEXT_READY',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('lead-plan', {
      agent: 'lead-claude',
      dependsOn: ['prepare-context'],
      task: `Plan the workflow evidence capture model.

Read the prepared standards, authoring rules, generated template, wave plan, and product spec under .workflow-artifacts/wave1-runtime/workflow-evidence-model/.

Deliverables:
- src/runtime/evidence/types.ts defines step status, verification result, log fragment, artifact reference, retry attempt, run evidence, and evidence summary types.
- src/runtime/evidence/capture.ts exports utilities for creating evidence records, appending step events, recording deterministic gates, attaching artifacts, and summarizing failures.
- src/runtime/evidence/index.ts exports the public evidence API.
- src/runtime/evidence/capture.test.ts covers status transitions, retry history, validation result capture, artifact references, and summary generation.

Non-goals:
- Do not implement failure classification, debugger recommendations, local command execution, Cloud APIs, or generated workflow authoring.
- Do not persist evidence to a database; keep storage adapters out of this workflow.

Verification:
- npx tsc --noEmit
- npx vitest run src/runtime/evidence/capture.test.ts
- grep for exports in src/runtime/evidence/index.ts
- git diff scoped to src/runtime/evidence/.

Write .workflow-artifacts/wave1-runtime/workflow-evidence-model/implementation-plan.md ending with WORKFLOW_EVIDENCE_PLAN_READY.`,
      verification: { type: 'file_exists', value: '.workflow-artifacts/wave1-runtime/workflow-evidence-model/implementation-plan.md' },
    })

    .step('implement-evidence-model', {
      agent: 'impl-primary-codex',
      dependsOn: ['lead-plan'],
      task: `Implement the evidence model.

Own only:
- src/runtime/evidence/types.ts
- src/runtime/evidence/capture.ts
- src/runtime/evidence/index.ts

Requirements:
- Evidence must be structured enough for Ricky to report outcomes, classify failures, drive fix loops, and audit workflow abstraction/execution routing.
- Include explicit statuses for pending, running, passed, failed, skipped, cancelled, and timed_out where appropriate.
- Model deterministic gates separately from agent narrative output.
- Preserve retry attempts, verification commands, exit codes, relevant output snippets, and produced artifact paths.
- Keep the public index export stable and obvious.

After editing, stop. Do not modify tests in this step.`,
      verification: { type: 'file_exists', value: 'src/runtime/evidence/capture.ts' },
    })

    .step('verify-model-after-edit', {
      type: 'deterministic',
      dependsOn: ['implement-evidence-model'],
      command: [
        'test -f src/runtime/evidence/types.ts',
        'test -f src/runtime/evidence/capture.ts',
        'test -f src/runtime/evidence/index.ts',
        'grep -Eq "export .*Evidence|export type .*Evidence|export interface .*Evidence" src/runtime/evidence/types.ts',
        'grep -Eq "record|append|create|summar" src/runtime/evidence/capture.ts',
        'grep -q "export" src/runtime/evidence/index.ts',
        'changed="$(git diff --name-only; git ls-files --others --exclude-standard)" && printf "%s\\n" "$changed" | grep -Eq "^src/runtime/evidence/(types|capture|index)\\.ts"',
        'echo WORKFLOW_EVIDENCE_MODEL_VERIFIED',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('implement-tests', {
      agent: 'impl-tests-codex',
      dependsOn: ['verify-model-after-edit'],
      task: `Write deterministic tests for evidence capture.

Own only:
- src/runtime/evidence/capture.test.ts

Required coverage:
- creating an empty run evidence record
- appending step lifecycle events and deterministic gate results
- recording retry attempts and preserving order
- attaching artifact/log references without reading external files
- producing summaries that expose failed gates and incomplete steps

Review checklist:
- Tests do not depend on real workflow execution.
- Tests prove evidence is useful for Ricky's later debugger and validator specialists.
- Assertions cover structured fields rather than broad snapshots.`,
      verification: { type: 'file_exists', value: 'src/runtime/evidence/capture.test.ts' },
    })

    .step('verify-tests-after-edit', {
      type: 'deterministic',
      dependsOn: ['implement-tests'],
      command: [
        'test -f src/runtime/evidence/capture.test.ts',
        'grep -Eq "describe|it\\(" src/runtime/evidence/capture.test.ts',
        'grep -Eq "retry|artifact|summary|failed|gate" src/runtime/evidence/capture.test.ts',
        'changed="$(git diff --name-only; git ls-files --others --exclude-standard)" && printf "%s\\n" "$changed" | grep -Eq "^src/runtime/evidence/capture\\.test\\.ts"',
        'echo WORKFLOW_EVIDENCE_TESTS_VERIFIED',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('initial-soft-validation', {
      type: 'deterministic',
      dependsOn: ['verify-tests-after-edit'],
      command: 'npx tsc --noEmit && npx vitest run src/runtime/evidence/capture.test.ts',
      captureOutput: true,
      failOnError: false,
    })

    .step('review-claude', {
      agent: 'reviewer-claude',
      dependsOn: ['initial-soft-validation'],
      task: `Review evidence capture for product usefulness and runtime completeness.

Read src/runtime/evidence/ and initial validation output:
{{steps.initial-soft-validation.output}}

Assess whether the evidence model supports generated workflow execution, failure analysis, user-facing reporting, fix loops, and regression proof.

Write .workflow-artifacts/wave1-runtime/workflow-evidence-model/review-claude.md ending with REVIEW_CLAUDE_PASS or REVIEW_CLAUDE_FAIL.`,
      verification: { type: 'file_exists', value: '.workflow-artifacts/wave1-runtime/workflow-evidence-model/review-claude.md' },
    })

    .step('review-codex', {
      agent: 'reviewer-codex',
      dependsOn: ['initial-soft-validation'],
      task: `Review evidence capture for implementation quality.

Read src/runtime/evidence/ and initial validation output:
{{steps.initial-soft-validation.output}}

Assess TypeScript exports, utility behavior, determinism, edge cases, and missing tests.

Write .workflow-artifacts/wave1-runtime/workflow-evidence-model/review-codex.md ending with REVIEW_CODEX_PASS or REVIEW_CODEX_FAIL.`,
      verification: { type: 'file_exists', value: '.workflow-artifacts/wave1-runtime/workflow-evidence-model/review-codex.md' },
    })

    .step('fix-loop', {
      agent: 'validator-claude',
      dependsOn: ['review-claude', 'review-codex'],
      task: `Run the 80-to-100 fix loop for evidence capture.

Inputs:
- .workflow-artifacts/wave1-runtime/workflow-evidence-model/review-claude.md
- .workflow-artifacts/wave1-runtime/workflow-evidence-model/review-codex.md
- Initial validation output:
{{steps.initial-soft-validation.output}}

Fix only concrete issues in src/runtime/evidence/. Re-run npx tsc --noEmit and npx vitest run src/runtime/evidence/capture.test.ts.

Write .workflow-artifacts/wave1-runtime/workflow-evidence-model/fix-loop.md ending with WORKFLOW_EVIDENCE_FIX_LOOP_COMPLETE.`,
      verification: { type: 'file_exists', value: '.workflow-artifacts/wave1-runtime/workflow-evidence-model/fix-loop.md' },
    })

    .step('post-fix-file-gate', {
      type: 'deterministic',
      dependsOn: ['fix-loop'],
      command: [
        'test -f src/runtime/evidence/types.ts',
        'test -f src/runtime/evidence/capture.ts',
        'test -f src/runtime/evidence/capture.test.ts',
        'test -f src/runtime/evidence/index.ts',
        'grep -q "export" src/runtime/evidence/index.ts',
        'echo WORKFLOW_EVIDENCE_POST_FIX_FILES_PASS',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('post-fix-validation', {
      type: 'deterministic',
      dependsOn: ['post-fix-file-gate'],
      command: 'npx tsc --noEmit && npx vitest run src/runtime/evidence/capture.test.ts',
      captureOutput: true,
      failOnError: false,
    })

    .step('final-review-claude', {
      agent: 'reviewer-claude',
      dependsOn: ['post-fix-validation'],
      task: `Re-review evidence capture after the fix loop.

Read src/runtime/evidence/, the fix-loop artifact, and post-fix validation output:
{{steps.post-fix-validation.output}}

Confirm prior findings are fixed or explicitly non-blocking, and that evidence remains useful for generated workflow execution, debugging, validation, and reporting.

Write .workflow-artifacts/wave1-runtime/workflow-evidence-model/final-review-claude.md ending with FINAL_REVIEW_CLAUDE_PASS or FINAL_REVIEW_CLAUDE_FAIL.`,
      verification: { type: 'file_exists', value: '.workflow-artifacts/wave1-runtime/workflow-evidence-model/final-review-claude.md' },
    })

    .step('final-review-codex', {
      agent: 'reviewer-codex',
      dependsOn: ['post-fix-validation'],
      task: `Re-review evidence capture implementation and tests after fixes.

Read src/runtime/evidence/, the fix-loop artifact, and post-fix validation output:
{{steps.post-fix-validation.output}}

Confirm the public exports, deterministic utilities, and tests are ready for final hard gates.

Write .workflow-artifacts/wave1-runtime/workflow-evidence-model/final-review-codex.md ending with FINAL_REVIEW_CODEX_PASS or FINAL_REVIEW_CODEX_FAIL.`,
      verification: { type: 'file_exists', value: '.workflow-artifacts/wave1-runtime/workflow-evidence-model/final-review-codex.md' },
    })

    .step('final-review-pass-gate', {
      type: 'deterministic',
      dependsOn: ['final-review-claude', 'final-review-codex'],
      command: [
        "tail -n 1 .workflow-artifacts/wave1-runtime/workflow-evidence-model/final-review-claude.md | tr -d '[:space:]*' | grep -Eq \"^FINAL_REVIEW_CLAUDE_PASS$\"",
        "tail -n 1 .workflow-artifacts/wave1-runtime/workflow-evidence-model/final-review-codex.md | tr -d '[:space:]*' | grep -Eq \"^FINAL_REVIEW_CODEX_PASS$\"",
        'echo WORKFLOW_EVIDENCE_FINAL_REVIEW_PASS',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('final-hard-gate', {
      type: 'deterministic',
      dependsOn: ['final-review-pass-gate'],
      command: 'npx vitest run src/runtime/evidence/capture.test.ts',
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
        'changed="$(git diff --name-only; git ls-files --others --exclude-standard)" && printf "%s\\n" "$changed" | grep -Eq "^src/runtime/evidence/"',
        '! printf "%s\\n" "$changed" | grep -Ev "^(src/runtime/evidence/|\\.workflow-artifacts/)"',
        'echo WORKFLOW_EVIDENCE_REGRESSION_PASS',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })
    .step('final-signoff', {
      agent: 'validator-claude',
      dependsOn: ['regression-gate'],
      task: `Write .workflow-artifacts/wave1-runtime/workflow-evidence-model/signoff.md.

Include files changed, validation commands run, review verdicts, and remaining risks.
End with WORKFLOW_EVIDENCE_MODEL_COMPLETE.`,
      verification: { type: 'file_exists', value: '.workflow-artifacts/wave1-runtime/workflow-evidence-model/signoff.md' },
    })

    .run({ cwd: process.cwd() });

  console.log(result.status);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
