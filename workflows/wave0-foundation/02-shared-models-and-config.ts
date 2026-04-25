import { workflow } from '@agent-relay/sdk/workflows';

async function main() {
  const result = await workflow('ricky-wave0-shared-models-and-config')
    .description('Create shared Ricky TypeScript workflow evidence and configuration models that later runtime and product workflows can import.')
    .pattern('dag')
    .channel('wf-ricky-wave0-shared-models')
    .maxConcurrency(4)
    .timeout(3_600_000)
    .onError('retry', { maxRetries: 1, retryDelayMs: 10_000 })

    .agent('lead-claude', {
      cli: 'claude',
      role: 'Implementation lead who defines the shared model boundary and prevents runtime-specific behavior from leaking into Wave 0.',
      retries: 1,
    })
    .agent('impl-primary-codex', {
      cli: 'codex',
      role: 'Primary implementer for shared TypeScript model and config files.',
      retries: 2,
    })
    .agent('impl-tests-codex', {
      cli: 'codex',
      role: 'Validation implementer who adds or adjusts lightweight compile-time checks only if the existing repo test setup supports them.',
      retries: 1,
    })
    .agent('reviewer-claude', {
      cli: 'claude',
      preset: 'reviewer',
      role: 'Reviews model semantics and product alignment.',
      retries: 1,
    })
    .agent('reviewer-codex', {
      cli: 'codex',
      preset: 'reviewer',
      role: 'Reviews TypeScript practicality, exports, and validation gates.',
      retries: 1,
    })
    .agent('validator-claude', {
      cli: 'claude',
      preset: 'worker',
      role: 'Writes final completion evidence after review and regression gates pass.',
      retries: 1,
    })

    .step('prepare-artifacts', {
      type: 'deterministic',
      command: 'mkdir -p .workflow-artifacts/wave0-foundation/shared-models src/shared/models && echo W0_SHARED_MODELS_ARTIFACTS_READY',
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
    .step('read-wave-plan', {
      type: 'deterministic',
      dependsOn: ['prepare-artifacts'],
      command: 'cat .workflow-artifacts/ricky-meta/application-wave-plan.md',
      captureOutput: true,
      failOnError: true,
    })
    .step('read-package-context', {
      type: 'deterministic',
      dependsOn: ['prepare-artifacts'],
      command: 'cat package.json && if [ -f tsconfig.json ]; then cat tsconfig.json; else echo "NO_TSCONFIG_PRESENT"; fi',
      captureOutput: true,
      failOnError: true,
    })

    .step('plan-shared-models', {
      agent: 'lead-claude',
      dependsOn: ['read-workflow-standards', 'read-authoring-rules', 'read-generated-template', 'read-wave-plan', 'read-package-context'],
      task: `Plan the Wave 0 shared TypeScript model and config foundation.

Context inputs:
- Workflow standards:
{{steps.read-workflow-standards.output}}
- Authoring rules:
{{steps.read-authoring-rules.output}}
- Generated workflow template:
{{steps.read-generated-template.output}}
- Application wave plan:
{{steps.read-wave-plan.output}}
- Package/TypeScript context:
{{steps.read-package-context.output}}

Deliverables:
- A plan for the shared evidence types, workflow config schema/types, index exports, and constants.
- The model set must be small, stable, and importable by future runtime/product workflows.

File targets:
- src/shared/models/workflow-evidence.ts
- src/shared/models/workflow-config.ts
- src/shared/models/index.ts
- src/shared/constants.ts

Non-goals:
- Do not implement the local run coordinator.
- Do not implement persistence, API endpoints, Slack behavior, or workflow generation.
- Do not add dependencies unless the repo already uses them.
- Do not add broad tests unless a test framework is already present and useful for these pure types.

Verification commands:
- test -f src/shared/models/workflow-evidence.ts
- test -f src/shared/models/workflow-config.ts
- test -f src/shared/models/index.ts
- test -f src/shared/constants.ts
- grep -q "export" src/shared/models/index.ts
- grep -Eq "WorkflowEvidence|WorkflowStepEvidence|Verification" src/shared/models/workflow-evidence.ts
- grep -Eq "WorkflowConfig|RickyWorkflowConfig|Config" src/shared/models/workflow-config.ts
- npx tsc --noEmit
- changed="$(git diff --name-only -- src/shared/models/workflow-evidence.ts src/shared/models/workflow-config.ts src/shared/models/index.ts src/shared/constants.ts; git ls-files --others --exclude-standard -- src/shared/models/workflow-evidence.ts src/shared/models/workflow-config.ts src/shared/models/index.ts src/shared/constants.ts)" && printf "%s\n" "$changed" | grep -Eq "^(src/shared/models/workflow-evidence.ts|src/shared/models/workflow-config.ts|src/shared/models/index.ts|src/shared/constants.ts)$" && echo CHANGES_PRESENT

Review checklist:
- Types are product-specific but not overfit to one future workflow.
- Exports are explicit and easy to import.
- Constants are narrow and do not create runtime policy prematurely.
- Typecheck errors are fixed or honestly documented if the repo lacks TypeScript config.
- Commit boundary is limited to src/shared/models/* and src/shared/constants.ts.

Commit/PR boundary:
- One implementation commit or PR should include only the four shared files above, plus a minimal tsconfig only if typecheck cannot run without one and reviewers approve it.

Write .workflow-artifacts/wave0-foundation/shared-models/plan.md and end it with W0_SHARED_MODELS_PLAN_READY.`,
      verification: { type: 'file_exists', value: '.workflow-artifacts/wave0-foundation/shared-models/plan.md' },
    })

    .step('implement-shared-models', {
      agent: 'impl-primary-codex',
      dependsOn: ['plan-shared-models'],
      task: `Implement the Wave 0 shared model and config foundation.

Read:
- .workflow-artifacts/wave0-foundation/shared-models/plan.md
- docs/workflows/WORKFLOW_STANDARDS.md
- workflows/shared/WORKFLOW_AUTHORING_RULES.md
- package.json
- tsconfig.json if present

Deliverables:
- src/shared/models/workflow-evidence.ts exports workflow evidence, step evidence, verification result, retry/history, and artifact/log reference types.
- src/shared/models/workflow-config.ts exports a Ricky workflow config type or schema shape covering local/cloud mode, validation policy, channel, timeout, and retry settings.
- src/shared/models/index.ts re-exports all shared model files.
- src/shared/constants.ts exports narrow Ricky constants such as default channel prefix, wave folder names, and validation policy defaults.

File targets:
- src/shared/models/workflow-evidence.ts
- src/shared/models/workflow-config.ts
- src/shared/models/index.ts
- src/shared/constants.ts

Non-goals:
- Do not create runtime coordinator behavior.
- Do not create product generation pipeline behavior.
- Do not add package dependencies.
- Do not introduce environmental assumptions beyond current repo tooling.

Verification commands to keep green:
- grep -q "export" src/shared/models/index.ts
- npx tsc --noEmit

Write files to disk and keep the implementation compact.`,
      verification: { type: 'exit_code' },
    })

    .step('verify-materialized-files', {
      type: 'deterministic',
      dependsOn: ['implement-shared-models'],
      command: 'test -f src/shared/models/workflow-evidence.ts && test -f src/shared/models/workflow-config.ts && test -f src/shared/models/index.ts && test -f src/shared/constants.ts && echo W0_SHARED_MODELS_FILES_PRESENT',
      captureOutput: true,
      failOnError: true,
    })
    .step('verify-exports', {
      type: 'deterministic',
      dependsOn: ['verify-materialized-files'],
      command: [
        'grep -q "export" src/shared/models/index.ts',
        'grep -Eq "WorkflowEvidence|WorkflowStepEvidence|Verification" src/shared/models/workflow-evidence.ts',
        'grep -Eq "WorkflowConfig|RickyWorkflowConfig|Config" src/shared/models/workflow-config.ts',
        'grep -Eq "RICKY|WAVE|CHANNEL" src/shared/constants.ts',
        'echo W0_SHARED_MODELS_EXPORTS_PRESENT',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })
    .step('initial-soft-typecheck', {
      type: 'deterministic',
      dependsOn: ['verify-exports'],
      command: 'npx tsc --noEmit',
      captureOutput: true,
      failOnError: false,
    })

    .step('fill-validation-gaps', {
      agent: 'impl-tests-codex',
      dependsOn: ['initial-soft-typecheck'],
      task: `Review the initial typecheck output and add only minimal validation support if needed.

Initial typecheck output:
{{steps.initial-soft-typecheck.output}}

Allowed file targets:
- src/shared/models/workflow-evidence.ts
- src/shared/models/workflow-config.ts
- src/shared/models/index.ts
- src/shared/constants.ts
- tsconfig.json only if no TypeScript config exists and npx tsc --noEmit cannot run for that reason

Non-goals:
- Do not add runtime tests unless a test framework already exists and the checks are trivial.
- Do not edit unrelated source files to silence errors.
- Do not add package dependencies.

Verification commands:
- npx tsc --noEmit
- grep -q "export" src/shared/models/index.ts

If the soft typecheck failed because the repository lacks TypeScript setup, document the blocker in .workflow-artifacts/wave0-foundation/shared-models/validation-notes.md and make the smallest repo-appropriate fix only if obvious.`,
      verification: { type: 'exit_code' },
    })

    .step('review-shared-models-claude', {
      agent: 'reviewer-claude',
      dependsOn: ['fill-validation-gaps'],
      task: `Review the shared model semantics and product fit.

Read:
- .workflow-artifacts/wave0-foundation/shared-models/plan.md
- src/shared/models/workflow-evidence.ts
- src/shared/models/workflow-config.ts
- src/shared/models/index.ts
- src/shared/constants.ts

Review checklist:
- Evidence types can represent step status, verification results, logs, artifacts, and retry history.
- Config types cover validation policy, local/cloud mode, channel, timeout, and retry settings.
- The model does not implement Wave 1 runtime behavior prematurely.
- The files are easy for later workflows to import.

Write .workflow-artifacts/wave0-foundation/shared-models/review-claude.md and end with REVIEW_CLAUDE_PASS or REVIEW_CLAUDE_FAIL.`,
      verification: { type: 'file_exists', value: '.workflow-artifacts/wave0-foundation/shared-models/review-claude.md' },
    })
    .step('review-shared-models-codex', {
      agent: 'reviewer-codex',
      dependsOn: ['fill-validation-gaps'],
      task: `Review the shared TypeScript implementation.

Read:
- src/shared/models/workflow-evidence.ts
- src/shared/models/workflow-config.ts
- src/shared/models/index.ts
- src/shared/constants.ts
- package.json
- tsconfig.json if present

Review checklist:
- Exports are explicit and compile-friendly.
- Types avoid circular imports.
- Constants are narrow and named consistently.
- No dependency or unrelated file churn was introduced.
- The intended verification commands are practical:
  - npx tsc --noEmit
  - grep -q "export" src/shared/models/index.ts

Write .workflow-artifacts/wave0-foundation/shared-models/review-codex.md and end with REVIEW_CODEX_PASS or REVIEW_CODEX_FAIL.`,
      verification: { type: 'file_exists', value: '.workflow-artifacts/wave0-foundation/shared-models/review-codex.md' },
    })

    .step('review-verdict-gate', {
      type: 'deterministic',
      dependsOn: ['review-shared-models-claude', 'review-shared-models-codex'],
      command: [
        'grep -Eq "REVIEW_CLAUDE_PASS$|REVIEW_CLAUDE_FAIL$" .workflow-artifacts/wave0-foundation/shared-models/review-claude.md',
        'grep -Eq "REVIEW_CODEX_PASS$|REVIEW_CODEX_FAIL$" .workflow-artifacts/wave0-foundation/shared-models/review-codex.md',
        'echo REVIEW_VERDICTS_RECORDED',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('fix-review-feedback', {
      agent: 'impl-primary-codex',
      dependsOn: ['review-shared-models-claude', 'review-shared-models-codex'],
      task: `Fix concrete review feedback for the Wave 0 shared models.

Read:
- .workflow-artifacts/wave0-foundation/shared-models/review-claude.md
- .workflow-artifacts/wave0-foundation/shared-models/review-codex.md
- src/shared/models/workflow-evidence.ts
- src/shared/models/workflow-config.ts
- src/shared/models/index.ts
- src/shared/constants.ts

Only edit:
- src/shared/models/workflow-evidence.ts
- src/shared/models/workflow-config.ts
- src/shared/models/index.ts
- src/shared/constants.ts
- tsconfig.json only if validation already introduced it for an explicit TypeScript setup blocker

Do not broaden scope. Re-run mentally against the review checklist and exit only after targeted fixes are written.`,
      verification: { type: 'exit_code' },
    })

    .step('final-hard-typecheck', {
      type: 'deterministic',
      dependsOn: ['fix-review-feedback'],
      command: 'npx tsc --noEmit',
      captureOutput: true,
      failOnError: true,
    })
    .step('final-hard-structure-gate', {
      type: 'deterministic',
      dependsOn: ['final-hard-typecheck'],
      command: [
        'test -f src/shared/models/workflow-evidence.ts',
        'test -f src/shared/models/workflow-config.ts',
        'test -f src/shared/models/index.ts',
        'test -f src/shared/constants.ts',
        'grep -q "export" src/shared/models/index.ts',
        'grep -Eq "WorkflowEvidence|WorkflowStepEvidence|Verification" src/shared/models/workflow-evidence.ts',
        'grep -Eq "WorkflowConfig|RickyWorkflowConfig|Config" src/shared/models/workflow-config.ts',
        'echo W0_SHARED_MODELS_FINAL_STRUCTURE_PASS',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })
    .step('regression-scope-gate', {
      type: 'deterministic',
      dependsOn: ['final-hard-structure-gate'],
      command: 'changed="$(git diff --name-only; git ls-files --others --exclude-standard)" && printf "%s\n" "$changed" | grep -Eq "^(src/shared/models/workflow-evidence.ts|src/shared/models/workflow-config.ts|src/shared/models/index.ts|src/shared/constants.ts|tsconfig.json)$" && printf "%s\n" "$changed" | grep -Ev "^(src/shared/models/workflow-evidence.ts|src/shared/models/workflow-config.ts|src/shared/models/index.ts|src/shared/constants.ts|tsconfig.json|\.workflow-artifacts/)" >/tmp/w0_shared_models_unexpected.txt || true; test ! -s /tmp/w0_shared_models_unexpected.txt && echo W0_SHARED_MODELS_REGRESSION_SCOPE_PASS',
      captureOutput: true,
      failOnError: true,
    })
    .step('final-signoff', {
      agent: 'validator-claude',
      dependsOn: ['regression-scope-gate'],
      task: `Write .workflow-artifacts/wave0-foundation/shared-models/signoff.md.

Include files changed, validation commands run, review verdicts, and remaining risks.
End with W0_SHARED_MODELS_WORKFLOW_COMPLETE.`,
      verification: { type: 'file_exists', value: '.workflow-artifacts/wave0-foundation/shared-models/signoff.md' },
    })

    .run({ cwd: process.cwd() });

  console.log(result.status);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
