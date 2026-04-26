import { workflow } from '@agent-relay/sdk/workflows';

async function main() {
  const result = await workflow('ricky-wave3-generate-endpoint')
    .description('Implement the Cloud POST /api/v1/ricky/workflows/generate endpoint that accepts an authenticated spec and returns a validated artifact bundle.')
    .pattern('dag')
    .channel('wf-ricky-wave3-generate-endpoint')
    .maxConcurrency(4)
    .timeout(3_600_000)
    .onError('retry', { maxRetries: 2, retryDelayMs: 10_000 })

    .agent('lead-claude', {
      cli: 'claude',
      interactive: false,
      role: 'Cloud endpoint lead who keeps the API route aligned with Ricky spec intake, generation, validation, and artifact-return contracts.',
      retries: 1,
    })
    .agent('impl-primary-codex', {
      cli: 'codex',
      role: 'Primary implementer for src/cloud/api route registration, request handling, response building, and exports.',
      retries: 2,
    })
    .agent('impl-tests-codex', {
      cli: 'codex',
      role: 'Test implementer for Cloud generation endpoint request/response contracts and failure cases.',
      retries: 2,
    })
    .agent('reviewer-claude', {
      cli: 'claude',
      preset: 'reviewer',
      role: 'Product/API reviewer for endpoint behavior, artifact return, and Cloud auth dependency alignment.',
      retries: 1,
    })
    .agent('reviewer-codex', {
      cli: 'codex',
      preset: 'reviewer',
      role: 'Code reviewer for route contracts, deterministic gates, TypeScript quality, and tests.',
      retries: 1,
    })
    .agent('validator-claude', {
      cli: 'claude',
      preset: 'worker',
      role: 'Validation owner for final hard gate, regression gate, and endpoint signoff.',
      retries: 2,
    })

    .step('prepare-artifacts', {
      type: 'deterministic',
      command: [
        'mkdir -p .workflow-artifacts/wave3-cloud-api/generate-endpoint',
        'mkdir -p src/cloud/api',
        'echo RICKY_WAVE3_GENERATE_ENDPOINT_READY',
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
      task: `Plan the Cloud generation endpoint.

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
- src/cloud/api/generate-endpoint.ts
- src/cloud/api/request-types.ts
- src/cloud/api/response-types.ts
- src/cloud/api/generate-endpoint.test.ts
- src/cloud/api/index.ts

Non-goals:
- Do not implement generate-and-run, debug, or restart endpoints.
- Do not bypass the Cloud auth module from W3-01.
- Do not implement a full HTTP server if the repo has no server surface yet; expose a route/handler contract that Cloud can mount.

Verification:
- generate-endpoint.ts must expose POST /api/v1/ricky/workflows/generate as a mountable handler contract.
- request-types.ts must require authenticated workspace context, workflow spec input, and mode handling for generate-only/artifact return.
- response-types.ts must return artifact bundle, warnings or assumptions, run receipts when applicable, and suggested follow-up actions.
- Tests must cover success, missing auth/workspace, missing spec, and validation failure mapping.
- Every implementation phase must be followed by deterministic file or grep gates.

Commit/PR boundary:
- Keep changes scoped to src/cloud/api and any required imports from Cloud auth/product generation contracts.

Write .workflow-artifacts/wave3-cloud-api/generate-endpoint/plan.md ending with GENERATE_ENDPOINT_PLAN_READY.`,
      verification: { type: 'file_exists', value: '.workflow-artifacts/wave3-cloud-api/generate-endpoint/plan.md' },
    })

    .step('implement-endpoint', {
      agent: 'impl-primary-codex',
      dependsOn: ['lead-plan'],
      task: `Implement the Cloud generation endpoint contract.

Deliverables:
- generate-endpoint.ts should expose a handler/function for POST /api/v1/ricky/workflows/generate that accepts an authenticated request with workspace context and a natural-language or structured workflow spec.
- request-types.ts should define the authenticated request, workspace context, generation mode, and spec payload contract.
- response-types.ts should define artifact bundle responses, run receipt fields when execution is requested, warnings, assumptions, validation status, and suggested follow-up actions.
- index.ts should export the endpoint contract.

Non-goals:
- Do not start a server process.
- Do not implement execution/run behavior.
- Do not write generated workflow artifacts outside the response contract in this workflow.

Verification:
- Use explicit typed contracts rather than opaque any objects where practical.
- Preserve Cloud/local mode distinctions from the product spec.
- Make route path and response shape easy to grep and test.`,
      verification: { type: 'file_exists', value: 'src/cloud/api/generate-endpoint.ts' },
    })
    .step('post-implementation-file-gate', {
      type: 'deterministic',
      dependsOn: ['implement-endpoint'],
      command: [
        'test -f src/cloud/api/generate-endpoint.ts',
        'test -f src/cloud/api/request-types.ts',
        'test -f src/cloud/api/response-types.ts',
        'test -f src/cloud/api/index.ts',
        'grep -q "/api/v1/ricky/workflows/generate" src/cloud/api/generate-endpoint.ts',
        'grep -q "POST\\|post" src/cloud/api/generate-endpoint.ts',
        'grep -q "artifact\\|bundle" src/cloud/api/response-types.ts',
        'echo GENERATE_ENDPOINT_IMPLEMENTATION_FILES_PRESENT',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('implement-endpoint-tests', {
      agent: 'impl-tests-codex',
      dependsOn: ['post-implementation-file-gate'],
      task: `Add tests for the Cloud generation endpoint.

Deliverables:
- src/cloud/api/generate-endpoint.test.ts should cover route path/method, successful generation response, missing authentication/workspace, missing spec, validation failure, and artifact bundle response contract.

Non-goals:
- Do not require network calls.
- Do not depend on a live Cloud runtime.

Verification:
- Tests must assert /api/v1/ricky/workflows/generate.
- Tests must assert artifact bundle or file return fields.
- Tests must assert warnings/assumptions or follow-up actions are represented.`,
      verification: { type: 'file_exists', value: 'src/cloud/api/generate-endpoint.test.ts' },
    })
    .step('post-test-file-gate', {
      type: 'deterministic',
      dependsOn: ['implement-endpoint-tests'],
      command: [
        'test -f src/cloud/api/generate-endpoint.test.ts',
        'grep -q "/api/v1/ricky/workflows/generate" src/cloud/api/generate-endpoint.test.ts src/cloud/api/generate-endpoint.ts',
        'grep -q "artifact\\|bundle" src/cloud/api/generate-endpoint.test.ts src/cloud/api/response-types.ts',
        'grep -q "workspace\\|auth" src/cloud/api/generate-endpoint.test.ts src/cloud/api/generate-endpoint.ts src/cloud/api/request-types.ts',
        'changed="$(git diff --name-only -- packages/cloud/src/api; git ls-files --others --exclude-standard -- packages/cloud/src/api)" && printf "%s\\n" "$changed" | grep -Eq "^packages/cloud/src/api/"',
        'echo GENERATE_ENDPOINT_TEST_FILES_PRESENT',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('initial-soft-validation', {
      type: 'deterministic',
      dependsOn: ['post-test-file-gate'],
      command: 'npx tsc --noEmit && npx vitest run src/cloud/api/',
      captureOutput: true,
      failOnError: false,
    })

    .step('review-endpoint-claude', {
      agent: 'reviewer-claude',
      dependsOn: ['initial-soft-validation'],
      task: `Review the Cloud generation endpoint.

Focus:
- Alignment with Ricky product journey: spec in, validated workflow artifact bundle out.
- Auth/workspace boundary alignment with W3-01.
- Cloud/local mode distinction is not erased.
- Response contract is user-visible and useful, not just internal status.

Write .workflow-artifacts/wave3-cloud-api/generate-endpoint/review-claude.md ending with REVIEW_CLAUDE_PASS or REVIEW_CLAUDE_FAIL.`,
      verification: { type: 'file_exists', value: '.workflow-artifacts/wave3-cloud-api/generate-endpoint/review-claude.md' },
    })
    .step('review-endpoint-codex', {
      agent: 'reviewer-codex',
      dependsOn: ['initial-soft-validation'],
      task: `Review the Cloud generation endpoint code and tests.

Focus:
- Deterministic gates and test completeness.
- Route and handler contract shape.
- Practical integration boundary with generation pipeline.
- Error handling for invalid request and validation failure.

Write .workflow-artifacts/wave3-cloud-api/generate-endpoint/review-codex.md ending with REVIEW_CODEX_PASS or REVIEW_CODEX_FAIL.`,
      verification: { type: 'file_exists', value: '.workflow-artifacts/wave3-cloud-api/generate-endpoint/review-codex.md' },
    })

    .step('read-review-feedback', {
      type: 'deterministic',
      dependsOn: ['review-endpoint-claude', 'review-endpoint-codex'],
      command: 'cat .workflow-artifacts/wave3-cloud-api/generate-endpoint/review-claude.md .workflow-artifacts/wave3-cloud-api/generate-endpoint/review-codex.md',
      captureOutput: true,
      failOnError: true,
    })
    .step('fix-endpoint', {
      agent: 'validator-claude',
      dependsOn: ['read-review-feedback'],
      task: `Fix Cloud generation endpoint issues from review feedback.

Review feedback:
{{steps.read-review-feedback.output}}

Rules:
- Preserve endpoint scope: only POST /api/v1/ricky/workflows/generate.
- Keep auth/workspace contract explicit.
- Update tests when behavior changes.
- Re-run deterministic gates after edits.`,
      verification: { type: 'exit_code', value: '0' },
    })
    .step('post-fix-verification-gate', {
      type: 'deterministic',
      dependsOn: ['fix-endpoint'],
      command: [
        'test -f src/cloud/api/generate-endpoint.ts',
        'test -f src/cloud/api/request-types.ts',
        'test -f src/cloud/api/response-types.ts',
        'test -f src/cloud/api/generate-endpoint.test.ts',
        'test -f src/cloud/api/index.ts',
        'grep -q "/api/v1/ricky/workflows/generate" src/cloud/api/generate-endpoint.ts',
        'grep -q "artifact\\|bundle" src/cloud/api/response-types.ts src/cloud/api/generate-endpoint.test.ts',
        'echo GENERATE_ENDPOINT_POST_FIX_GATE_PASS',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })
    .step('post-fix-validation', {
      type: 'deterministic',
      dependsOn: ['post-fix-verification-gate'],
      command: 'npx tsc --noEmit && npx vitest run src/cloud/api/',
      captureOutput: true,
      failOnError: false,
    })

    .step('final-review-endpoint-claude', {
      agent: 'reviewer-claude',
      dependsOn: ['post-fix-validation'],
      task: `Re-review the Cloud generation endpoint after fixes and post-fix validation.

Read src/cloud/api/ source and tests, and post-fix validation output:
{{steps.post-fix-validation.output}}

Confirm prior review findings are fixed or explicitly non-blocking. Re-check alignment with Ricky product journey, auth/workspace boundary, Cloud/local mode distinction, and response contract.

Write .workflow-artifacts/wave3-cloud-api/generate-endpoint/final-review-claude.md ending with FINAL_REVIEW_CLAUDE_PASS or FINAL_REVIEW_CLAUDE_FAIL.`,
      verification: { type: 'file_exists', value: '.workflow-artifacts/wave3-cloud-api/generate-endpoint/final-review-claude.md' },
    })
    .step('final-review-endpoint-codex', {
      agent: 'reviewer-codex',
      dependsOn: ['post-fix-validation'],
      task: `Re-review the Cloud generation endpoint code and tests after fixes.

Read src/cloud/api/ source and tests, and post-fix validation output:
{{steps.post-fix-validation.output}}

Confirm deterministic gates, route/handler contract, generation pipeline integration, and error handling are ready for final hard gates.

Write .workflow-artifacts/wave3-cloud-api/generate-endpoint/final-review-codex.md ending with FINAL_REVIEW_CODEX_PASS or FINAL_REVIEW_CODEX_FAIL.`,
      verification: { type: 'file_exists', value: '.workflow-artifacts/wave3-cloud-api/generate-endpoint/final-review-codex.md' },
    })

    .step('final-review-pass-gate', {
      type: 'deterministic',
      dependsOn: ['final-review-endpoint-claude', 'final-review-endpoint-codex'],
      command: [
        "tail -n 1 .workflow-artifacts/wave3-cloud-api/generate-endpoint/final-review-claude.md | tr -d '[:space:]*' | grep -Eq \"^FINAL_REVIEW_CLAUDE_PASS$\"",
        "tail -n 1 .workflow-artifacts/wave3-cloud-api/generate-endpoint/final-review-codex.md | tr -d '[:space:]*' | grep -Eq \"^FINAL_REVIEW_CODEX_PASS$\"",
        'echo GENERATE_ENDPOINT_FINAL_REVIEW_PASS',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })
    .step('final-hard-validation', {
      type: 'deterministic',
      dependsOn: ['final-review-pass-gate'],
      command: 'npx tsc --noEmit && npx vitest run src/cloud/api/',
      captureOutput: true,
      failOnError: true,
    })
    .step('regression-gate', {
      type: 'deterministic',
      dependsOn: ['final-hard-validation'],
      command: [
        'npx tsc --noEmit',
        'changed="$(git diff --name-only; git ls-files --others --exclude-standard)"',
        'printf "%s\\n" "$changed" | grep -Eq "^packages/cloud/src/api/"',
        '! printf "%s\\n" "$changed" | grep -Ev "^(packages/cloud/src/api/|\\.workflow-artifacts/)"',
        'echo GENERATE_ENDPOINT_REGRESSION_GATE_PASS',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })
    .step('final-signoff', {
      agent: 'validator-claude',
      dependsOn: ['regression-gate'],
      task: `Write .workflow-artifacts/wave3-cloud-api/generate-endpoint/signoff.md.

Include files changed, validation commands, endpoint contract summary, and any residual integration risks.
End with GENERATE_ENDPOINT_WORKFLOW_COMPLETE.`,
      verification: { type: 'file_exists', value: '.workflow-artifacts/wave3-cloud-api/generate-endpoint/signoff.md' },
    })

    .run({ cwd: process.cwd() });

  console.log(result.status);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
