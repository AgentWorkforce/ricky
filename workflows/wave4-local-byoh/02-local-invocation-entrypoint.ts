import { workflow } from '@agent-relay/sdk/workflows';

async function main() {
  const result = await workflow('ricky-wave4-local-invocation-entrypoint')
    .description('Implement the local/BYOH invocation entrypoint that accepts specs or workflow artifacts, detects repo context and skills, and coordinates local agent-relay execution.')
    .pattern('dag')
    .channel('wf-ricky-wave4-local-entrypoint')
    .maxConcurrency(4)
    .timeout(3_600_000)
    .onError('retry', { maxRetries: 2, retryDelayMs: 10_000 })

    .agent('lead-claude', {
      cli: 'claude',
      role: 'Local/BYOH lead who keeps local invocation first-class and distinct from Cloud execution assumptions.',
      retries: 1,
    })
    .agent('impl-primary-codex', {
      cli: 'codex',
      role: 'Primary implementer for local entrypoint, context detector, skill loader, types, and exports.',
      retries: 2,
    })
    .agent('impl-tests-codex', {
      cli: 'codex',
      role: 'Test implementer for local context detection, skill loading, entrypoint routing, and local run coordination contracts.',
      retries: 2,
    })
    .agent('reviewer-claude', {
      cli: 'claude',
      preset: 'reviewer',
      role: 'Product reviewer for local/BYOH behavior, artifact return, and local execution ergonomics.',
      retries: 1,
    })
    .agent('reviewer-codex', {
      cli: 'codex',
      preset: 'reviewer',
      role: 'Code reviewer for local adapter contracts, deterministic verification, and testability.',
      retries: 1,
    })
    .agent('validator-claude', {
      cli: 'claude',
      preset: 'worker',
      role: 'Validation owner for the local entrypoint 80-to-100 loop and final signoff.',
      retries: 2,
    })

    .step('prepare-artifacts', {
      type: 'deterministic',
      command: [
        'mkdir -p .workflow-artifacts/wave4-local-byoh/local-invocation-entrypoint',
        'mkdir -p packages/local/src',
        'echo RICKY_WAVE4_LOCAL_ENTRYPOINT_READY',
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
      task: `Plan the local/BYOH invocation entrypoint.

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
- packages/local/src/entrypoint.ts
- packages/local/src/request-normalizer.ts
- packages/local/src/entrypoint.test.ts
- packages/local/src/index.ts

Non-goals:
- Do not implement Cloud execution.
- Do not assume every workflow artifact is Cloud-compatible.
- Do not shell out to live agent-relay in unit tests unless a deterministic fake is used.

Verification:
- Request normalizer must accept spec handoff from CLI, MCP, Claude, or workflow artifact input and convert it into the local invocation contract.
- Entrypoint must tie normalized intake, generation, and local runtime coordination together and return local artifacts/log/run metadata.
- Local/BYOH execution must remain first-class and explicit.
- Tests must prove local routing, spec handoff, request normalization, and artifact/log response contracts.

Commit/PR boundary:
- Keep changes scoped to src/local and tiny shared type imports if needed.

Write .workflow-artifacts/wave4-local-byoh/local-invocation-entrypoint/plan.md ending with LOCAL_ENTRYPOINT_PLAN_READY.`,
      verification: { type: 'file_exists', value: '.workflow-artifacts/wave4-local-byoh/local-invocation-entrypoint/plan.md' },
    })

    .step('implement-local-entrypoint', {
      agent: 'impl-primary-codex',
      dependsOn: ['lead-plan'],
      task: `Implement the local/BYOH invocation entrypoint.

Deliverables:
- entrypoint.ts should accept a local invocation request containing a spec or workflow artifact, execution preference, and optional MCP/CLI source metadata.
- request-normalizer.ts should normalize free-form specs, structured specs, Claude handoff payloads, MCP handoff payloads, and workflow artifact paths into one local request contract.
- entrypoint.ts should call product spec intake and generation contracts where available, then coordinate local runtime execution without requiring Cloud credentials.
- index.ts should export public local invocation contracts.

Non-goals:
- Do not execute destructive commands.
- Do not require Cloud credentials.
- Do not hide local environment blockers.

Verification:
- Keep command execution injectable or mockable.
- Return artifacts, logs, warnings, and next actions in the local response.
- Preserve the distinction between local workflow generation and Cloud workflow generation.`,
      verification: { type: 'file_exists', value: 'packages/local/src/entrypoint.ts' },
    })
    .step('post-implementation-file-gate', {
      type: 'deterministic',
      dependsOn: ['implement-local-entrypoint'],
      command: [
        'test -f packages/local/src/entrypoint.ts',
        'test -f packages/local/src/request-normalizer.ts',
        'test -f packages/local/src/index.ts',
        'grep -q "normalize\\|spec\\|MCP\\|Claude" packages/local/src/request-normalizer.ts',
        'grep -q "local\\|BYOH\\|agent-relay" packages/local/src/entrypoint.ts packages/local/src/request-normalizer.ts',
        'grep -q "export" packages/local/src/index.ts',
        'echo LOCAL_ENTRYPOINT_IMPLEMENTATION_FILES_PRESENT',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('implement-local-tests', {
      agent: 'impl-tests-codex',
      dependsOn: ['post-implementation-file-gate'],
      task: `Add tests for the local/BYOH entrypoint.

Deliverables:
- packages/local/src/entrypoint.test.ts should cover request normalization, CLI/MCP/Claude spec handoff, workflow artifact input routing, local artifact/log response shape, and environment warning behavior.

Non-goals:
- Do not depend on the current developer machine layout.
- Do not run live workflows.

Verification:
- Use injected generation/runtime adapters where appropriate.
- Tests must prove local/BYOH mode is explicit and not routed through Cloud by default.`,
      verification: { type: 'file_exists', value: 'packages/local/src/entrypoint.test.ts' },
    })
    .step('post-test-file-gate', {
      type: 'deterministic',
      dependsOn: ['implement-local-tests'],
      command: [
        'test -f packages/local/src/entrypoint.test.ts',
        'grep -q "normalize\\|spec\\|MCP\\|Claude" packages/local/src/entrypoint.test.ts packages/local/src/request-normalizer.ts',
        'grep -q "local\\|BYOH\\|agent-relay" packages/local/src/entrypoint.test.ts packages/local/src/entrypoint.ts',
        'grep -q "artifact\\|log\\|warning" packages/local/src/entrypoint.test.ts packages/local/src/entrypoint.ts',
        'changed="$(git diff --name-only -- packages/local/src; git ls-files --others --exclude-standard -- packages/local/src)" && printf "%s\n" "$changed" | grep -Eq "^packages/local/src/"',
        'echo LOCAL_ENTRYPOINT_TEST_FILES_PRESENT',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('initial-soft-validation', {
      type: 'deterministic',
      dependsOn: ['post-test-file-gate'],
      command: 'npm run typecheck --workspace @ricky/local && npm test --workspace @ricky/local',
      captureOutput: true,
      failOnError: false,
    })

    .step('review-local-claude', {
      agent: 'reviewer-claude',
      dependsOn: ['initial-soft-validation'],
      task: `Review the local/BYOH invocation implementation.

Focus:
- Local/BYOH is co-equal with Cloud and does not silently degrade.
- CLI/MCP spec handoff is represented.
- Local artifact, log, warning, and next-action outputs are useful to users.
- Environment blockers are explicit.

Write .workflow-artifacts/wave4-local-byoh/local-invocation-entrypoint/review-claude.md ending with REVIEW_CLAUDE_PASS or REVIEW_CLAUDE_FAIL.`,
      verification: { type: 'file_exists', value: '.workflow-artifacts/wave4-local-byoh/local-invocation-entrypoint/review-claude.md' },
    })
    .step('review-local-codex', {
      agent: 'reviewer-codex',
      dependsOn: ['initial-soft-validation'],
      task: `Review the local entrypoint code and tests.

Focus:
- Deterministic gates and test coverage.
- Injectable process/filesystem boundaries.
- Exported type quality.
- Practical fit with local agent-relay coordination.

Write .workflow-artifacts/wave4-local-byoh/local-invocation-entrypoint/review-codex.md ending with REVIEW_CODEX_PASS or REVIEW_CODEX_FAIL.`,
      verification: { type: 'file_exists', value: '.workflow-artifacts/wave4-local-byoh/local-invocation-entrypoint/review-codex.md' },
    })

    .step('read-review-feedback', {
      type: 'deterministic',
      dependsOn: ['review-local-claude', 'review-local-codex'],
      command: 'cat .workflow-artifacts/wave4-local-byoh/local-invocation-entrypoint/review-claude.md .workflow-artifacts/wave4-local-byoh/local-invocation-entrypoint/review-codex.md',
      captureOutput: true,
      failOnError: true,
    })
    .step('fix-local-entrypoint', {
      agent: 'validator-claude',
      dependsOn: ['read-review-feedback'],
      task: `Fix local/BYOH entrypoint issues from review feedback.

Review feedback:
{{steps.read-review-feedback.output}}

Rules:
- Keep local execution first-class.
- Update tests when contracts change.
- Do not add live external dependencies.
- Run deterministic gates after changes.`,
      verification: { type: 'exit_code', value: '0' },
    })
    .step('post-fix-verification-gate', {
      type: 'deterministic',
      dependsOn: ['fix-local-entrypoint'],
      command: [
        'test -f packages/local/src/entrypoint.ts',
        'test -f packages/local/src/request-normalizer.ts',
        'test -f packages/local/src/entrypoint.test.ts',
        'test -f packages/local/src/index.ts',
        'grep -q "normalize\\|spec\\|MCP\\|Claude" packages/local/src/request-normalizer.ts',
        'grep -q "local\\|BYOH\\|agent-relay" packages/local/src/entrypoint.ts packages/local/src/entrypoint.test.ts',
        'grep -q "export" packages/local/src/index.ts',
        'echo LOCAL_ENTRYPOINT_POST_FIX_GATE_PASS',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })
    .step('post-fix-validation', {
      type: 'deterministic',
      dependsOn: ['post-fix-verification-gate'],
      command: 'npm run typecheck --workspace @ricky/local && npm test --workspace @ricky/local',
      captureOutput: true,
      failOnError: false,
    })

    .step('final-review-local-claude', {
      agent: 'reviewer-claude',
      dependsOn: ['post-fix-validation'],
      task: `Re-review the local/BYOH invocation implementation after fixes and post-fix validation.

Read packages/local/src/ source and tests, and post-fix validation output:
{{steps.post-fix-validation.output}}

Confirm prior review findings are fixed or explicitly non-blocking. Re-check that local/BYOH is co-equal with Cloud, CLI/MCP spec handoff is represented, local outputs are useful, and environment blockers are explicit.

Write .workflow-artifacts/wave4-local-byoh/local-invocation-entrypoint/final-review-claude.md ending with FINAL_REVIEW_CLAUDE_PASS or FINAL_REVIEW_CLAUDE_FAIL.`,
      verification: { type: 'file_exists', value: '.workflow-artifacts/wave4-local-byoh/local-invocation-entrypoint/final-review-claude.md' },
    })
    .step('final-review-local-codex', {
      agent: 'reviewer-codex',
      dependsOn: ['post-fix-validation'],
      task: `Re-review the local entrypoint code and tests after fixes.

Read packages/local/src/ source and tests, and post-fix validation output:
{{steps.post-fix-validation.output}}

Confirm deterministic gates, injectable process/filesystem boundaries, exported type quality, and fit with local agent-relay coordination are ready for final hard gates.

Write .workflow-artifacts/wave4-local-byoh/local-invocation-entrypoint/final-review-codex.md ending with FINAL_REVIEW_CODEX_PASS or FINAL_REVIEW_CODEX_FAIL.`,
      verification: { type: 'file_exists', value: '.workflow-artifacts/wave4-local-byoh/local-invocation-entrypoint/final-review-codex.md' },
    })

    .step('final-review-pass-gate', {
      type: 'deterministic',
      dependsOn: ['final-review-local-claude', 'final-review-local-codex'],
      command: [
        'tail -n 1 .workflow-artifacts/wave4-local-byoh/local-invocation-entrypoint/final-review-claude.md | grep -Eq "^FINAL_REVIEW_CLAUDE_PASS$"',
        'tail -n 1 .workflow-artifacts/wave4-local-byoh/local-invocation-entrypoint/final-review-codex.md | grep -Eq "^FINAL_REVIEW_CODEX_PASS$"',
        'echo LOCAL_ENTRYPOINT_FINAL_REVIEW_PASS',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })
    .step('final-hard-validation', {
      type: 'deterministic',
      dependsOn: ['final-review-pass-gate'],
      command: 'npm run typecheck --workspace @ricky/local && npm test --workspace @ricky/local',
      captureOutput: true,
      failOnError: true,
    })
    .step('regression-gate', {
      type: 'deterministic',
      dependsOn: ['final-hard-validation'],
      command: [
        'npx tsc --noEmit',
        'changed="$(git diff --name-only; git ls-files --others --exclude-standard)"',
        'printf "%s\\n" "$changed" | grep -Eq "^packages/local/src/"',
        '! printf "%s\\n" "$changed" | grep -Ev "^(packages/local/src/|\\.workflow-artifacts/)"',
        'echo LOCAL_ENTRYPOINT_REGRESSION_GATE_PASS',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })
    .step('final-signoff', {
      agent: 'validator-claude',
      dependsOn: ['regression-gate'],
      task: `Write .workflow-artifacts/wave4-local-byoh/local-invocation-entrypoint/signoff.md.

Include files changed, local/BYOH contract summary, validation commands, and remaining risks.
End with LOCAL_ENTRYPOINT_WORKFLOW_COMPLETE.`,
      verification: { type: 'file_exists', value: '.workflow-artifacts/wave4-local-byoh/local-invocation-entrypoint/signoff.md' },
    })

    .run({ cwd: process.cwd() });

  console.log(result.status);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
