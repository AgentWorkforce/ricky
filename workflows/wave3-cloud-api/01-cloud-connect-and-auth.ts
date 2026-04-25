import { workflow } from '@agent-relay/sdk/workflows';

async function main() {
  const result = await workflow('ricky-wave3-cloud-connect-and-auth')
    .description('Implement Ricky Cloud auth, workspace scoping, and provider connection guidance aligned with the product spec.')
    .pattern('dag')
    .channel('wf-ricky-wave3-cloud-auth')
    .maxConcurrency(4)
    .timeout(3_600_000)
    .onError('retry', { maxRetries: 2, retryDelayMs: 10_000 })

    .agent('lead-claude', {
      cli: 'claude',
      role: 'Cloud API lead who keeps auth, workspace scoping, and provider connect behavior aligned with Ricky product requirements.',
      retries: 1,
    })
    .agent('impl-primary-codex', {
      cli: 'codex',
      role: 'Primary implementer for src/cloud/auth request validation, workspace scoping, provider guidance, and exports.',
      retries: 2,
    })
    .agent('impl-tests-codex', {
      cli: 'codex',
      role: 'Test implementer for Cloud auth validation, workspace scope isolation, and user-visible provider connect contract checks.',
      retries: 2,
    })
    .agent('reviewer-claude', {
      cli: 'claude',
      preset: 'reviewer',
      role: 'Product reviewer for Cloud onboarding/auth alignment and user-visible connection guidance.',
      retries: 1,
    })
    .agent('reviewer-codex', {
      cli: 'codex',
      preset: 'reviewer',
      role: 'Code reviewer for deterministic gates, TypeScript practicality, auth contracts, and test coverage.',
      retries: 1,
    })
    .agent('validator-claude', {
      cli: 'claude',
      preset: 'worker',
      role: 'Validation owner who runs the 80-to-100 loop and signs off only after hard gates and regression checks pass.',
      retries: 2,
    })

    .step('prepare-artifacts', {
      type: 'deterministic',
      command: [
        'mkdir -p .workflow-artifacts/wave3-cloud-auth',
        'mkdir -p src/cloud/auth',
        'echo RICKY_WAVE3_CLOUD_AUTH_READY',
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
      task: `Plan the Ricky Cloud auth and provider connect implementation.

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
- src/cloud/auth/request-validator.ts
- src/cloud/auth/workspace-scoping.ts
- src/cloud/auth/provider-connect.ts
- src/cloud/auth/types.ts
- src/cloud/auth/request-validator.test.ts
- src/cloud/auth/index.ts

Non-goals:
- Do not implement the full Cloud worker deployment.
- Do not invent a new GitHub auth flow outside the Cloud dashboard and Nango-backed integration path.
- Do not implement workflow generation endpoints in this workflow.

Verification:
- Provider guidance must include the user-visible Google command: npx agent-relay cloud connect google.
- GitHub guidance must point to Cloud dashboard / Nango, not a bespoke Ricky-only flow.
- Auth must reject missing API key and workspace context.
- Workspace scoping must prevent cross-workspace access by construction.
- Post-edit gates must run after implementation and test edits.

Commit/PR boundary:
- Keep changes scoped to src/cloud/auth and tests for this module.

Write .workflow-artifacts/wave3-cloud-auth/plan.md and end with CLOUD_AUTH_PLAN_READY.`,
      verification: { type: 'file_exists', value: '.workflow-artifacts/wave3-cloud-auth/plan.md' },
    })

    .step('implement-auth-module', {
      agent: 'impl-primary-codex',
      dependsOn: ['lead-plan'],
      task: `Implement the Cloud auth module according to .workflow-artifacts/wave3-cloud-auth/plan.md.

Deliverables:
- request-validator.ts should validate API key presence, workspace/project context, request mode, and provider connection state needed by Ricky Cloud requests.
- workspace-scoping.ts should expose a small, testable function that resolves authorized workspace scope and rejects cross-workspace mismatches.
- provider-connect.ts should expose user-visible guidance for Google and GitHub provider setup. Google must use npx agent-relay cloud connect google. GitHub must route to the existing Cloud dashboard / Nango-backed integration flow.
- types.ts and index.ts should export the public contract.

Non-goals:
- Do not depend on a live Cloud service.
- Do not add secrets or environment-specific credentials.
- Do not touch Wave 4 local/BYOH files.

Verification:
- Keep functions deterministic and unit-testable.
- Make user-visible connect guidance assertable by tests and grep gates.
- Write files to disk and keep stdout concise.`,
      verification: { type: 'file_exists', value: 'src/cloud/auth/provider-connect.ts' },
    })
    .step('post-implementation-file-gate', {
      type: 'deterministic',
      dependsOn: ['implement-auth-module'],
      command: [
        'test -f src/cloud/auth/request-validator.ts',
        'test -f src/cloud/auth/workspace-scoping.ts',
        'test -f src/cloud/auth/provider-connect.ts',
        'test -f src/cloud/auth/types.ts',
        'test -f src/cloud/auth/index.ts',
        'grep -q "cloud connect google\\|agent-relay cloud connect" src/cloud/auth/provider-connect.ts',
        'grep -q "Nango\\|nango\\|Cloud dashboard\\|dashboard" src/cloud/auth/provider-connect.ts',
        'grep -q "workspace" src/cloud/auth/workspace-scoping.ts',
        'echo CLOUD_AUTH_IMPLEMENTATION_FILES_PRESENT',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('implement-auth-tests', {
      agent: 'impl-tests-codex',
      dependsOn: ['post-implementation-file-gate'],
      task: `Add tests for the Cloud auth module.

Deliverables:
- src/cloud/auth/request-validator.test.ts should cover missing API key, missing workspace context, accepted valid requests, workspace mismatch rejection, and provider connect guidance contracts.

Non-goals:
- Do not call real provider APIs.
- Do not snapshot implementation internals.

Verification:
- Tests must prove user-visible guidance includes npx agent-relay cloud connect google.
- Tests must prove GitHub guidance references Cloud dashboard or Nango.
- Tests must fail if auth accepts an unscoped request.`,
      verification: { type: 'file_exists', value: 'src/cloud/auth/request-validator.test.ts' },
    })
    .step('post-test-file-gate', {
      type: 'deterministic',
      dependsOn: ['implement-auth-tests'],
      command: [
        'test -f src/cloud/auth/request-validator.test.ts',
        'grep -q "cloud connect google\\|agent-relay cloud connect" src/cloud/auth/request-validator.test.ts src/cloud/auth/provider-connect.ts',
        'grep -q "Nango\\|nango\\|dashboard\\|Cloud dashboard" src/cloud/auth/request-validator.test.ts src/cloud/auth/provider-connect.ts',
        'grep -q "workspace" src/cloud/auth/request-validator.test.ts',
        'changed="$(git diff --name-only -- src/cloud/auth; git ls-files --others --exclude-standard -- src/cloud/auth)" && printf "%s\n" "$changed" | grep -Eq "^src/cloud/auth/"',
        'echo CLOUD_AUTH_TEST_FILES_PRESENT',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('initial-soft-validation', {
      type: 'deterministic',
      dependsOn: ['post-test-file-gate'],
      command: 'npx tsc --noEmit && npx vitest run src/cloud/auth/',
      captureOutput: true,
      failOnError: false,
    })

    .step('review-cloud-auth-claude', {
      agent: 'reviewer-claude',
      dependsOn: ['initial-soft-validation'],
      task: `Review the Cloud auth and provider connect implementation.

Focus:
- Product spec alignment for Cloud connect, Google command guidance, and GitHub dashboard/Nango path.
- User-visible proof: tests or contracts must assert onboarding/connect guidance, not only internal code.
- Auth/workspace behavior must be understandable from the public types.
- 80-to-100 loop readiness.

Write .workflow-artifacts/wave3-cloud-auth/review-claude.md ending with REVIEW_CLAUDE_PASS or REVIEW_CLAUDE_FAIL.`,
      verification: { type: 'file_exists', value: '.workflow-artifacts/wave3-cloud-auth/review-claude.md' },
    })
    .step('review-cloud-auth-codex', {
      agent: 'reviewer-codex',
      dependsOn: ['initial-soft-validation'],
      task: `Review the Cloud auth implementation for code quality.

Focus:
- Deterministic validation coverage.
- TypeScript design and exported contract.
- Workspace scoping correctness.
- Test coverage for request validation and provider guidance.

Write .workflow-artifacts/wave3-cloud-auth/review-codex.md ending with REVIEW_CODEX_PASS or REVIEW_CODEX_FAIL.`,
      verification: { type: 'file_exists', value: '.workflow-artifacts/wave3-cloud-auth/review-codex.md' },
    })
    .step('review-verdict-gate', {
      type: 'deterministic',
      dependsOn: ['review-cloud-auth-claude', 'review-cloud-auth-codex'],
      command: [
        'grep -Eq "REVIEW_CLAUDE_PASS$|REVIEW_CLAUDE_FAIL$" .workflow-artifacts/wave3-cloud-auth/review-claude.md',
        'grep -Eq "REVIEW_CODEX_PASS$|REVIEW_CODEX_FAIL$" .workflow-artifacts/wave3-cloud-auth/review-codex.md',
        'echo REVIEW_VERDICTS_RECORDED',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('read-review-feedback', {
      type: 'deterministic',
      dependsOn: ['review-cloud-auth-claude', 'review-cloud-auth-codex'],
      command: 'cat .workflow-artifacts/wave3-cloud-auth/review-claude.md .workflow-artifacts/wave3-cloud-auth/review-codex.md',
      captureOutput: true,
      failOnError: true,
    })
    .step('fix-cloud-auth', {
      agent: 'impl-primary-codex',
      dependsOn: ['read-review-feedback'],
      task: `Fix Cloud auth issues from review feedback.

Review feedback:
{{steps.read-review-feedback.output}}

Rules:
- Preserve the planned file boundary.
- If tests need updates, coordinate the edits in the same pass and keep them scoped to src/cloud/auth.
- Re-check provider guidance contracts after any edit.
- Do not claim success without deterministic gates.`,
      verification: { type: 'exit_code' },
    })
    .step('post-fix-verification-gate', {
      type: 'deterministic',
      dependsOn: ['fix-cloud-auth'],
      command: [
        'test -f src/cloud/auth/request-validator.ts',
        'test -f src/cloud/auth/workspace-scoping.ts',
        'test -f src/cloud/auth/provider-connect.ts',
        'test -f src/cloud/auth/types.ts',
        'test -f src/cloud/auth/request-validator.test.ts',
        'test -f src/cloud/auth/index.ts',
        'grep -q "cloud connect google\\|agent-relay cloud connect" src/cloud/auth/provider-connect.ts',
        'grep -q "Nango\\|nango\\|Cloud dashboard\\|dashboard" src/cloud/auth/provider-connect.ts',
        'echo CLOUD_AUTH_POST_FIX_GATE_PASS',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })
    .step('final-hard-validation', {
      type: 'deterministic',
      dependsOn: ['post-fix-verification-gate'],
      command: 'npx tsc --noEmit && npx vitest run src/cloud/auth/',
      captureOutput: true,
      failOnError: true,
    })
    .step('regression-gate', {
      type: 'deterministic',
      dependsOn: ['final-hard-validation'],
      command: [
        'npx tsc --noEmit',
        'changed="$(git diff --name-only; git ls-files --others --exclude-standard)" && printf "%s\n" "$changed" | grep -Eq "^(src/cloud/auth/|package.json|tsconfig.json)$|^src/cloud/auth/"',
        'printf "%s\n" "$changed" | grep -q . && echo CHANGES_PRESENT',
        'echo CLOUD_AUTH_REGRESSION_GATE_PASS',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })
    .step('final-signoff', {
      agent: 'validator-claude',
      dependsOn: ['regression-gate'],
      task: `Write .workflow-artifacts/wave3-cloud-auth/signoff.md.

Include:
- Files changed.
- Validation commands run.
- Whether user-visible Cloud connect guidance was contract-checked.
- Remaining risks, if any.

End with CLOUD_AUTH_WORKFLOW_COMPLETE.`,
      verification: { type: 'file_exists', value: '.workflow-artifacts/wave3-cloud-auth/signoff.md' },
    })

    .run({ cwd: process.cwd() });

  console.log(result.status);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
