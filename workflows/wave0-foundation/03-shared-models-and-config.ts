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
      interactive: false,
      role: 'Implementation lead who defines the shared model boundary and prevents runtime-specific behavior from leaking into Wave 0.',
      retries: 1,
    })
    .agent('impl-primary-codex', {
      cli: 'codex',
      role: 'Primary implementer for shared TypeScript model and config files.',
      retries: 2,
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
      command: 'mkdir -p .workflow-artifacts/wave0-foundation/shared-models packages/shared/src/models && echo W0_SHARED_MODELS_ARTIFACTS_READY',
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
      command: 'cat package.json && cat packages/shared/package.json && if [ -f tsconfig.json ]; then cat tsconfig.json; else echo "NO_TSCONFIG_PRESENT"; fi && if [ -f packages/shared/tsconfig.json ]; then cat packages/shared/tsconfig.json; else echo "NO_SHARED_TSCONFIG_PRESENT"; fi',
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
- packages/shared/src/models/workflow-evidence.ts
- packages/shared/src/models/workflow-config.ts
- packages/shared/src/models/index.ts
- packages/shared/src/constants.ts

Non-goals:
- Do not implement the local run coordinator.
- Do not implement persistence, API endpoints, Slack behavior, or workflow generation.
- Do not add dependencies unless the repo already uses them.
- Do not add broad tests unless a test framework is already present and useful for these pure types.

Verification commands:
- test -f packages/shared/src/models/workflow-evidence.ts
- test -f packages/shared/src/models/workflow-config.ts
- test -f packages/shared/src/models/index.ts
- test -f packages/shared/src/constants.ts
- grep -q "export" packages/shared/src/models/index.ts
- grep -Eq "WorkflowEvidence|WorkflowStepEvidence|Verification" packages/shared/src/models/workflow-evidence.ts
- grep -Eq "WorkflowConfig|RickyWorkflowConfig|Config" packages/shared/src/models/workflow-config.ts
- npx tsc --noEmit
- changed="$(git diff --name-only -- packages/shared/src/models/workflow-evidence.ts packages/shared/src/models/workflow-config.ts packages/shared/src/models/index.ts packages/shared/src/constants.ts; git ls-files --others --exclude-standard -- packages/shared/src/models/workflow-evidence.ts packages/shared/src/models/workflow-config.ts packages/shared/src/models/index.ts packages/shared/src/constants.ts)" && printf "%s\n" "$changed" | grep -Eq "^(packages/shared/src/models/workflow-evidence.ts|packages/shared/src/models/workflow-config.ts|packages/shared/src/models/index.ts|packages/shared/src/constants.ts)$" && echo CHANGES_PRESENT

Review checklist:
- Types are product-specific but not overfit to one future workflow.
- Exports are explicit and easy to import.
- Constants are narrow and do not create runtime policy prematurely.
- Typecheck errors are fixed or honestly documented if the repo lacks TypeScript config.
- Commit boundary is limited to packages/shared/src/models/* and packages/shared/src/constants.ts.

Commit/PR boundary:
- One implementation commit or PR should include only the four shared files above, plus a minimal tsconfig only if typecheck cannot run without one and reviewers approve it.
- Do not recreate legacy root src/ files now that Ricky is package-split.

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
- packages/shared/src/models/workflow-evidence.ts exports workflow evidence, step evidence, verification result, retry/history, and artifact/log reference types.
- packages/shared/src/models/workflow-config.ts exports a Ricky workflow config type or schema shape covering local/cloud mode, validation policy, channel, timeout, and retry settings.
- packages/shared/src/models/index.ts re-exports all shared model files.
- packages/shared/src/constants.ts exports narrow Ricky constants such as default channel prefix, wave folder names, and validation policy defaults.

File targets:
- packages/shared/src/models/workflow-evidence.ts
- packages/shared/src/models/workflow-config.ts
- packages/shared/src/models/index.ts
- packages/shared/src/constants.ts

Non-goals:
- Do not create runtime coordinator behavior.
- Do not create product generation pipeline behavior.
- Do not add package dependencies.
- Do not introduce environmental assumptions beyond current repo tooling.

Verification commands to keep green:
- grep -q "export" packages/shared/src/models/index.ts
- npx tsc --noEmit

Write files to disk and keep the implementation compact.`,
      verification: { type: 'exit_code', value: '0' },
    })

    .step('verify-materialized-files', {
      type: 'deterministic',
      dependsOn: ['implement-shared-models'],
      command: 'test -f packages/shared/src/models/workflow-evidence.ts && test -f packages/shared/src/models/workflow-config.ts && test -f packages/shared/src/models/index.ts && test -f packages/shared/src/constants.ts && echo W0_SHARED_MODELS_FILES_PRESENT',
      captureOutput: true,
      failOnError: true,
    })
    .step('verify-exports', {
      type: 'deterministic',
      dependsOn: ['verify-materialized-files'],
      command: [
        'grep -q "export" packages/shared/src/models/index.ts',
        'grep -Eq "WorkflowEvidence|WorkflowStepEvidence|Verification" packages/shared/src/models/workflow-evidence.ts',
        'grep -Eq "WorkflowConfig|RickyWorkflowConfig|Config" packages/shared/src/models/workflow-config.ts',
        'grep -Eq "RICKY|WAVE|CHANNEL" packages/shared/src/constants.ts',
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

    .step('review-shared-models-claude', {
      agent: 'reviewer-claude',
      dependsOn: ['initial-soft-typecheck'],
      task: `Review the shared model semantics and product fit.

Read:
- .workflow-artifacts/wave0-foundation/shared-models/plan.md
- packages/shared/src/models/workflow-evidence.ts
- packages/shared/src/models/workflow-config.ts
- packages/shared/src/models/index.ts
- packages/shared/src/constants.ts
- Initial soft typecheck output:
{{steps.initial-soft-typecheck.output}}

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
      dependsOn: ['initial-soft-typecheck'],
      task: `Review the shared TypeScript implementation.

Read:
- packages/shared/src/models/workflow-evidence.ts
- packages/shared/src/models/workflow-config.ts
- packages/shared/src/models/index.ts
- packages/shared/src/constants.ts
- package.json
- tsconfig.json if present
- Initial soft typecheck output:
{{steps.initial-soft-typecheck.output}}

Review checklist:
- Exports are explicit and compile-friendly.
- Types avoid circular imports.
- Constants are narrow and named consistently.
- No dependency or unrelated file churn was introduced.
- The intended verification commands are practical:
  - npx tsc --noEmit
  - grep -q "export" packages/shared/src/models/index.ts

Write .workflow-artifacts/wave0-foundation/shared-models/review-codex.md and end with REVIEW_CODEX_PASS or REVIEW_CODEX_FAIL.`,
      verification: { type: 'file_exists', value: '.workflow-artifacts/wave0-foundation/shared-models/review-codex.md' },
    })

    .step('fix-review-feedback', {
      agent: 'impl-primary-codex',
      dependsOn: ['review-shared-models-claude', 'review-shared-models-codex'],
      task: `Fix concrete review feedback for the Wave 0 shared models.

Read:
- .workflow-artifacts/wave0-foundation/shared-models/review-claude.md
- .workflow-artifacts/wave0-foundation/shared-models/review-codex.md
- packages/shared/src/models/workflow-evidence.ts
- packages/shared/src/models/workflow-config.ts
- packages/shared/src/models/index.ts
- packages/shared/src/constants.ts
- Initial soft typecheck output:
{{steps.initial-soft-typecheck.output}}

Only edit:
- packages/shared/src/models/workflow-evidence.ts
- packages/shared/src/models/workflow-config.ts
- packages/shared/src/models/index.ts
- packages/shared/src/constants.ts
- tsconfig.json only if validation already introduced it for an explicit TypeScript setup blocker

Do not broaden scope. Fix only concrete review findings and validation failures, then run npx tsc --noEmit before exiting. If the repository lacks TypeScript setup, document the blocker in .workflow-artifacts/wave0-foundation/shared-models/validation-notes.md and make the smallest repo-appropriate fix only if obvious.`,
      verification: { type: 'exit_code', value: '0' },
    })

    .step('post-fix-typecheck', {
      type: 'deterministic',
      dependsOn: ['fix-review-feedback'],
      command: 'npx tsc --noEmit',
      captureOutput: true,
      failOnError: true,
    })
    .step('post-fix-structure-gate', {
      type: 'deterministic',
      dependsOn: ['post-fix-typecheck'],
      command: [
        'test -f packages/shared/src/models/workflow-evidence.ts',
        'test -f packages/shared/src/models/workflow-config.ts',
        'test -f packages/shared/src/models/index.ts',
        'test -f packages/shared/src/constants.ts',
        'grep -q "export" packages/shared/src/models/index.ts',
        'grep -Eq "WorkflowEvidence|WorkflowStepEvidence|Verification" packages/shared/src/models/workflow-evidence.ts',
        'grep -Eq "WorkflowConfig|RickyWorkflowConfig|Config" packages/shared/src/models/workflow-config.ts',
        'echo W0_SHARED_MODELS_POST_FIX_VALIDATION_PASS',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('final-review-shared-models-claude', {
      agent: 'reviewer-claude',
      dependsOn: ['post-fix-structure-gate'],
      task: `Final semantic review for the Wave 0 shared models after fixes and post-fix validation.

Read:
- .workflow-artifacts/wave0-foundation/shared-models/review-claude.md
- packages/shared/src/models/workflow-evidence.ts
- packages/shared/src/models/workflow-config.ts
- packages/shared/src/models/index.ts
- packages/shared/src/constants.ts
- Post-fix validation output:
{{steps.post-fix-structure-gate.output}}

Check the original semantic review checklist again and verify any earlier concrete failures were fixed. Write .workflow-artifacts/wave0-foundation/shared-models/final-review-claude.md and end with REVIEW_CLAUDE_PASS or REVIEW_CLAUDE_FAIL.`,
      verification: { type: 'file_exists', value: '.workflow-artifacts/wave0-foundation/shared-models/final-review-claude.md' },
    })
    .step('final-review-shared-models-codex', {
      agent: 'reviewer-codex',
      dependsOn: ['post-fix-structure-gate'],
      task: `Final TypeScript review for the Wave 0 shared models after fixes and post-fix validation.

Read:
- .workflow-artifacts/wave0-foundation/shared-models/review-codex.md
- packages/shared/src/models/workflow-evidence.ts
- packages/shared/src/models/workflow-config.ts
- packages/shared/src/models/index.ts
- packages/shared/src/constants.ts
- package.json
- tsconfig.json if present
- Post-fix validation output:
{{steps.post-fix-structure-gate.output}}

Check the original TypeScript review checklist again and verify any earlier concrete failures were fixed. Write .workflow-artifacts/wave0-foundation/shared-models/final-review-codex.md and end with REVIEW_CODEX_PASS or REVIEW_CODEX_FAIL.`,
      verification: { type: 'file_exists', value: '.workflow-artifacts/wave0-foundation/shared-models/final-review-codex.md' },
    })

    .step('final-review-pass-gate', {
      type: 'deterministic',
      dependsOn: ['final-review-shared-models-claude', 'final-review-shared-models-codex'],
      command: [
        'tail -n 1 .workflow-artifacts/wave0-foundation/shared-models/final-review-claude.md | grep -Eq "^REVIEW_CLAUDE_PASS$"',
        'tail -n 1 .workflow-artifacts/wave0-foundation/shared-models/final-review-codex.md | grep -Eq "^REVIEW_CODEX_PASS$"',
        'echo W0_SHARED_MODELS_REVIEW_PASS_GATE',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('final-hard-typecheck', {
      type: 'deterministic',
      dependsOn: ['final-review-pass-gate'],
      command: 'npx tsc --noEmit',
      captureOutput: true,
      failOnError: true,
    })
    .step('final-hard-structure-gate', {
      type: 'deterministic',
      dependsOn: ['final-hard-typecheck'],
      command: [
        'test -f packages/shared/src/models/workflow-evidence.ts',
        'test -f packages/shared/src/models/workflow-config.ts',
        'test -f packages/shared/src/models/index.ts',
        'test -f packages/shared/src/constants.ts',
        'grep -q "export" packages/shared/src/models/index.ts',
        'grep -Eq "WorkflowEvidence|WorkflowStepEvidence|Verification" packages/shared/src/models/workflow-evidence.ts',
        'grep -Eq "WorkflowConfig|RickyWorkflowConfig|Config" packages/shared/src/models/workflow-config.ts',
        'echo W0_SHARED_MODELS_FINAL_STRUCTURE_PASS',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })
    .step('regression-scope-gate', {
      type: 'deterministic',
      dependsOn: ['final-hard-structure-gate'],
      command: [
        'changed="$(git diff --name-only; git ls-files --others --exclude-standard)"',
        'printf "%s\\n" "$changed" | grep -Eq "^(src/shared/(models/|constants\\.ts)|tsconfig\\.json)"',
        '! printf "%s\\n" "$changed" | grep -Ev "^(src/shared/(models/|constants\\.ts)|tsconfig\\.json|\\.workflow-artifacts/)"',
        'echo W0_SHARED_MODELS_REGRESSION_SCOPE_PASS',
      ].join(' && '),
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
