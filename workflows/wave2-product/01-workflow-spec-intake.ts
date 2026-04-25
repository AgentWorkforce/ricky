import { workflow } from '@agent-relay/sdk/workflows';

async function main() {
  const result = await workflow('ricky-wave2-workflow-spec-intake')
    .description('Implement the Wave 2 spec intake pipeline that accepts workflow specs from Claude handoff, CLI, MCP, Slack, web, or API and routes them to Ricky product actions.')
    .pattern('dag')
    .channel('wf-ricky-wave2-workflow-spec-intake')
    .maxConcurrency(3)
    .timeout(3_600_000)
    .onError('retry', { maxRetries: 1, retryDelayMs: 10_000 })

    .agent('lead-claude', { cli: 'claude', role: 'Product-core lead for spec intake scope, routing semantics, and no-hand-authored-workflow product truth.', retries: 1 })
    .agent('impl-primary-codex', { cli: 'codex', role: 'Primary implementer for parser, normalizer, router, types, and exports.', retries: 2 })
    .agent('impl-tests-codex', { cli: 'codex', role: 'Test implementer for spec intake parsing, normalization, and routing behavior.', retries: 2 })
    .agent('reviewer-claude', { cli: 'claude', preset: 'reviewer', role: 'Reviews product alignment across Claude, CLI, MCP, Slack, web, and API surfaces.', retries: 1 })
    .agent('reviewer-codex', { cli: 'codex', preset: 'reviewer', role: 'Reviews implementation quality, routing determinism, and test coverage.', retries: 1 })
    .agent('validator-claude', { cli: 'claude', preset: 'worker', role: 'Applies bounded fixes and validation reruns until spec intake reaches the 80-to-100 bar.', retries: 2 })

    .step('prepare-context', {
      type: 'deterministic',
      command: [
        'mkdir -p .workflow-artifacts/wave2-product/workflow-spec-intake src/product/spec-intake',
        'cat docs/workflows/WORKFLOW_STANDARDS.md > .workflow-artifacts/wave2-product/workflow-spec-intake/workflow-standards.md',
        'cat workflows/shared/WORKFLOW_AUTHORING_RULES.md > .workflow-artifacts/wave2-product/workflow-spec-intake/authoring-rules.md',
        'cat workflows/meta/spec/generated-workflow-template.md > .workflow-artifacts/wave2-product/workflow-spec-intake/generated-template.md',
        'cat .workflow-artifacts/ricky-meta/application-wave-plan.md > .workflow-artifacts/wave2-product/workflow-spec-intake/application-wave-plan.md',
        'cat SPEC.md > .workflow-artifacts/wave2-product/workflow-spec-intake/product-spec.md',
        'echo SPEC_INTAKE_CONTEXT_READY',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('lead-plan', {
      agent: 'lead-claude',
      dependsOn: ['prepare-context'],
      task: `Plan the spec intake pipeline implementation.

Read the prepared context files under .workflow-artifacts/wave2-product/workflow-spec-intake/.

Deliverables:
- src/product/spec-intake/types.ts defines input surfaces, raw spec payloads, normalized workflow spec, routing decisions, validation issues, and intake result types.
- src/product/spec-intake/parser.ts parses natural-language or structured specs from Claude handoff, CLI, MCP, Slack, web, and API inputs.
- src/product/spec-intake/normalizer.ts normalizes intent, target repo/context, desired action, constraints, evidence requirements, and acceptance gates.
- src/product/spec-intake/router.ts routes normalized specs to generate, debug, coordinate, execute, or clarify.
- src/product/spec-intake/index.ts exports the public intake API.
- src/product/spec-intake/parser.test.ts covers natural language, structured JSON, MCP-style payloads, CLI text, malformed input, and routing.

Non-goals:
- Do not generate Relay workflow files in this workflow.
- Do not implement Cloud request auth, local execution, debugger repairs, or UI flows.
- Do not require users to hand-author workflow files; intake converts user intent into Ricky's internal domain model.

Verification:
- npx tsc --noEmit
- npx vitest run src/product/spec-intake/
- grep for parser, normalizer, and router exports
- git diff scoped to src/product/spec-intake/.

Write .workflow-artifacts/wave2-product/workflow-spec-intake/implementation-plan.md ending with SPEC_INTAKE_PLAN_READY.`,
      verification: { type: 'file_exists', value: '.workflow-artifacts/wave2-product/workflow-spec-intake/implementation-plan.md' },
    })

    .step('implement-intake-core', {
      agent: 'impl-primary-codex',
      dependsOn: ['lead-plan'],
      task: `Implement the spec intake core.

Own only:
- src/product/spec-intake/types.ts
- src/product/spec-intake/parser.ts
- src/product/spec-intake/normalizer.ts
- src/product/spec-intake/router.ts
- src/product/spec-intake/index.ts

Requirements:
- Treat Claude handoff, CLI, MCP, Slack, web, and API as first-class surfaces.
- Convert vague natural-language requests and structured payloads into one normalized Ricky workflow spec shape.
- Preserve user intent, constraints, target files/repos, required evidence, provider context, and acceptance criteria.
- Route to generate when the user wants a new workflow, debug when evidence references a failed run, coordinate when the request spans agents, execute when a ready artifact is provided, and clarify only when required fields are missing.
- Keep parsing deterministic and local; no LLM or network dependency in the base parser.
- Export a clean public API from index.ts.

After editing, stop. Do not modify tests in this step.`,
      verification: { type: 'file_exists', value: 'src/product/spec-intake/parser.ts' },
    })

    .step('verify-core-after-edit', {
      type: 'deterministic',
      dependsOn: ['implement-intake-core'],
      command: [
        'test -f src/product/spec-intake/types.ts',
        'test -f src/product/spec-intake/parser.ts',
        'test -f src/product/spec-intake/normalizer.ts',
        'test -f src/product/spec-intake/router.ts',
        'test -f src/product/spec-intake/index.ts',
        'grep -Eq "Claude|CLI|MCP|Slack|web|API|surface" src/product/spec-intake/types.ts src/product/spec-intake/parser.ts',
        'grep -Eq "generate|debug|coordinate|execute|clarify" src/product/spec-intake/router.ts',
        'grep -q "export" src/product/spec-intake/index.ts',
        'changed="$(git diff --name-only; git ls-files --others --exclude-standard)" && printf "%s\\n" "$changed" | grep -Eq "^src/product/spec-intake/(types|parser|normalizer|router|index)\\.ts"',
        'echo SPEC_INTAKE_CORE_VERIFIED',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('implement-tests', {
      agent: 'impl-tests-codex',
      dependsOn: ['verify-core-after-edit'],
      task: `Write spec intake tests.

Own only:
- src/product/spec-intake/parser.test.ts

Required coverage:
- Claude handoff text with workflow intent routes to generate.
- CLI natural-language request normalizes constraints and acceptance gates.
- MCP-style structured payload preserves source and context.
- Failed-run evidence routes to debug.
- Ready artifact request routes to execute.
- Ambiguous input returns clarify with actionable missing fields.

Review checklist:
- Tests prove no hand-authored workflow file is required from users.
- Tests cover parser, normalizer, and router behavior together.
- Tests stay deterministic and do not call external services.`,
      verification: { type: 'file_exists', value: 'src/product/spec-intake/parser.test.ts' },
    })

    .step('verify-tests-after-edit', {
      type: 'deterministic',
      dependsOn: ['implement-tests'],
      command: [
        'test -f src/product/spec-intake/parser.test.ts',
        'grep -Eq "describe|it\\(" src/product/spec-intake/parser.test.ts',
        'grep -Eq "Claude|CLI|MCP|generate|debug|clarify" src/product/spec-intake/parser.test.ts',
        'changed="$(git diff --name-only; git ls-files --others --exclude-standard)" && printf "%s\\n" "$changed" | grep -Eq "^src/product/spec-intake/parser\\.test\\.ts"',
        'echo SPEC_INTAKE_TESTS_VERIFIED',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('initial-soft-validation', {
      type: 'deterministic',
      dependsOn: ['verify-tests-after-edit'],
      command: 'npx tsc --noEmit && npx vitest run src/product/spec-intake/',
      captureOutput: true,
      failOnError: false,
    })

    .step('review-claude', {
      agent: 'reviewer-claude',
      dependsOn: ['initial-soft-validation'],
      task: `Review spec intake for Ricky product truth and user journey fit.

Read src/product/spec-intake/ and initial validation output:
{{steps.initial-soft-validation.output}}

Assess:
- Spec intake from Claude, CLI, MCP, Slack, web, and API is first-class.
- Users are not required to hand-author workflows.
- Routing cleanly separates generate, debug, coordinate, execute, and clarify.
- The normalized model is strong enough for the generation pipeline.

Write .workflow-artifacts/wave2-product/workflow-spec-intake/review-claude.md ending with REVIEW_CLAUDE_PASS or REVIEW_CLAUDE_FAIL.`,
      verification: { type: 'file_exists', value: '.workflow-artifacts/wave2-product/workflow-spec-intake/review-claude.md' },
    })

    .step('review-codex', {
      agent: 'reviewer-codex',
      dependsOn: ['initial-soft-validation'],
      task: `Review spec intake implementation and tests.

Read src/product/spec-intake/ and initial validation output:
{{steps.initial-soft-validation.output}}

Assess TypeScript exports, deterministic parsing, validation issue modeling, routing edge cases, and test strength.

Write .workflow-artifacts/wave2-product/workflow-spec-intake/review-codex.md ending with REVIEW_CODEX_PASS or REVIEW_CODEX_FAIL.`,
      verification: { type: 'file_exists', value: '.workflow-artifacts/wave2-product/workflow-spec-intake/review-codex.md' },
    })

    .step('fix-loop', {
      agent: 'validator-claude',
      dependsOn: ['review-claude', 'review-codex'],
      task: `Run the 80-to-100 fix loop for spec intake.

Inputs:
- .workflow-artifacts/wave2-product/workflow-spec-intake/review-claude.md
- .workflow-artifacts/wave2-product/workflow-spec-intake/review-codex.md
- Initial validation output:
{{steps.initial-soft-validation.output}}

Fix only concrete issues in src/product/spec-intake/. Re-run npx tsc --noEmit and npx vitest run src/product/spec-intake/.

Write .workflow-artifacts/wave2-product/workflow-spec-intake/fix-loop.md ending with SPEC_INTAKE_FIX_LOOP_COMPLETE.`,
      verification: { type: 'file_exists', value: '.workflow-artifacts/wave2-product/workflow-spec-intake/fix-loop.md' },
    })

    .step('post-fix-file-gate', {
      type: 'deterministic',
      dependsOn: ['fix-loop'],
      command: [
        'test -f src/product/spec-intake/parser.ts',
        'test -f src/product/spec-intake/normalizer.ts',
        'test -f src/product/spec-intake/router.ts',
        'test -f src/product/spec-intake/parser.test.ts',
        'test -f src/product/spec-intake/index.ts',
        'grep -Eq "generate|debug|coordinate|execute|clarify" src/product/spec-intake/router.ts',
        'echo SPEC_INTAKE_POST_FIX_FILES_PASS',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('final-hard-gate', {
      type: 'deterministic',
      dependsOn: ['post-fix-file-gate'],
      command: 'npx tsc --noEmit && npx vitest run src/product/spec-intake/',
      captureOutput: true,
      failOnError: true,
    })

    .step('regression-gate', {
      type: 'deterministic',
      dependsOn: ['final-hard-gate'],
      command: [
        'npx vitest run',
        'changed="$(git diff --name-only; git ls-files --others --exclude-standard)" && printf "%s\\n" "$changed" | grep -Eq "^src/product/spec-intake/"',
        '! printf "%s\\n" "$changed" | grep -Ev "^(src/product/spec-intake/|\\.workflow-artifacts/)"',
        'echo SPEC_INTAKE_REGRESSION_PASS',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })
    .step('final-signoff', {
      agent: 'validator-claude',
      dependsOn: ['regression-gate'],
      task: `Write .workflow-artifacts/wave2-product/workflow-spec-intake/signoff.md.

Include files changed, validation commands run, review verdicts, and remaining risks.
End with WORKFLOW_SPEC_INTAKE_COMPLETE.`,
      verification: { type: 'file_exists', value: '.workflow-artifacts/wave2-product/workflow-spec-intake/signoff.md' },
    })

    .run({ cwd: process.cwd() });

  console.log(result.status);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
