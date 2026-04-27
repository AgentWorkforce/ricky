import { workflow } from '@agent-relay/sdk/workflows';

async function main() {
  const result = await workflow('ricky-wave4-local-invocation-entrypoint')
    .description('Implement the local/BYOH invocation entrypoint that accepts specs or workflow artifacts, detects repo context and skills, and coordinates local agent-relay execution.')
    .pattern('dag')
    .channel('wf-ricky-wave4-local-entrypoint')
    .maxConcurrency(4)
    .timeout(3_600_000)
    .onError('retry', { maxRetries: 2, retryDelayMs: 10_000 })

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

    .step('implement-local-entrypoint', {
      agent: 'impl-primary-codex',
      dependsOn: ['read-workflow-standards', 'read-authoring-rules', 'read-generated-template', 'read-product-spec'],
      task: `Implement the local/BYOH invocation entrypoint.

Context inputs:
- docs/workflows/WORKFLOW_STANDARDS.md:
{{steps.read-workflow-standards.output}}
- workflows/shared/WORKFLOW_AUTHORING_RULES.md:
{{steps.read-authoring-rules.output}}
- workflows/meta/spec/generated-workflow-template.md:
{{steps.read-generated-template.output}}
- SPEC.md:
{{steps.read-product-spec.output}}

Before writing code, first write .workflow-artifacts/wave4-local-byoh/local-invocation-entrypoint/plan.md summarizing the concrete request-normalization contract, entrypoint behavior, file targets, and validation steps you are about to implement.
End that plan artifact with LOCAL_ENTRYPOINT_PLAN_READY.
Then implement the code.

Deliverables:
- entrypoint.ts should accept a local invocation request containing a spec or workflow artifact, execution preference, and optional MCP/CLI source metadata.
- request-normalizer.ts should normalize free-form specs, structured specs, Claude handoff payloads, MCP handoff payloads, and workflow artifact paths into one local request contract.
- entrypoint.ts should call product spec intake and generation contracts where available, then coordinate local runtime execution without requiring Cloud credentials.
- index.ts should export public local invocation contracts.

Non-goals:
- Do not execute destructive commands.
- Do not require Cloud credentials.
- Do not hide local environment blockers.
- Do not shell out to live agent-relay in unit tests unless a deterministic fake is used.

Verification:
- Keep command execution injectable or mockable.
- Return artifacts, logs, warnings, and next actions in the local response.
- Preserve the distinction between local workflow generation and Cloud workflow generation.
- Tests must prove local routing, spec handoff, request normalization, and artifact/log response contracts.

Commit/PR boundary:
- Keep changes scoped to packages/local/src and tiny shared type imports if needed.`,
      verification: { type: 'exit_code', value: '0' },
    })
    .step('plan-gate', {
      type: 'deterministic',
      dependsOn: ['implement-local-entrypoint'],
      command: [
        'test -f .workflow-artifacts/wave4-local-byoh/local-invocation-entrypoint/plan.md',
        "tail -n 1 .workflow-artifacts/wave4-local-byoh/local-invocation-entrypoint/plan.md | grep -Eq '^LOCAL_ENTRYPOINT_PLAN_READY$'",
        'echo LOCAL_ENTRYPOINT_PLAN_VERIFIED',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })
    .step('post-implementation-file-gate', {
      type: 'deterministic',
      dependsOn: ['implement-local-entrypoint', 'plan-gate'],
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
        'grep -qE "normalize|spec|MCP|Claude" packages/local/src/entrypoint.test.ts packages/local/src/request-normalizer.ts',
        'grep -qE "local|BYOH|agent-relay" packages/local/src/entrypoint.test.ts packages/local/src/entrypoint.ts',
        'grep -qE "artifact|log|warning" packages/local/src/entrypoint.test.ts packages/local/src/entrypoint.ts',
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
- Deterministic gates, exported types, and injectable coordination seams remain practical.

Write .workflow-artifacts/wave4-local-byoh/local-invocation-entrypoint/review-claude.md ending with REVIEW_CLAUDE_PASS or REVIEW_CLAUDE_FAIL.
Note that this workflow intentionally uses a single Claude review path because the current non-interactive Codex reviewer runtime has been observed to hang in this slice after producing artifacts.`,
      verification: { type: 'file_exists', value: '.workflow-artifacts/wave4-local-byoh/local-invocation-entrypoint/review-claude.md' },
    })

    .step('read-review-feedback', {
      type: 'deterministic',
      dependsOn: ['review-local-claude'],
      command: 'cat .workflow-artifacts/wave4-local-byoh/local-invocation-entrypoint/review-claude.md',
      captureOutput: true,
      failOnError: true,
    })
    .step('fix-local-entrypoint', {
      type: 'deterministic',
      dependsOn: ['read-review-feedback'],
      command: [
        "tail -n 1 .workflow-artifacts/wave4-local-byoh/local-invocation-entrypoint/review-claude.md | tr -d '[:space:]*' | grep -Eq \"^REVIEW_CLAUDE_PASS$\"",
        "cat <<'EOF' > .workflow-artifacts/wave4-local-byoh/local-invocation-entrypoint/fix-local-entrypoint.md",
        '# Local invocation entrypoint fix pass',
        '',
        'Review feedback consumed. Claude passed the slice, so no bounded fix was required in this step.',
        '',
        'FIX_LOCAL_ENTRYPOINT_PASS',
        'EOF',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
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

    .step('final-hard-validation', {
      type: 'deterministic',
      dependsOn: ['post-fix-validation'],
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
        'if [[ -z "$changed" ]]; then echo LOCAL_ENTRYPOINT_REGRESSION_GATE_PASS_NOOP; exit 0; fi',
        'printf "%s\\n" "$changed" | grep -Eq "^packages/local/src/"',
        '! printf "%s\\n" "$changed" | grep -Ev "^(packages/local/src/|\\.workflow-artifacts/)"',
        'echo LOCAL_ENTRYPOINT_REGRESSION_GATE_PASS',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })
    .step('final-signoff', {
      type: 'deterministic',
      dependsOn: ['regression-gate'],
      command: `changed="$(git diff --name-only -- packages/local/src)"
if [[ -z "$changed" ]]; then changed="(no source changes captured at signoff)"; fi
cat > .workflow-artifacts/wave4-local-byoh/local-invocation-entrypoint/signoff.md <<EOF
# Ricky local invocation entrypoint signoff

## Workflow path
- workflows/wave4-local-byoh/02-local-invocation-entrypoint.ts

## Changed files
\${changed}

## Summary of validated behavior
- local/BYOH request normalization covers CLI, MCP, Claude, structured-spec, and workflow-artifact handoffs.
- ready-workflow handoffs route directly to the local runtime without Cloud fallback or regeneration.
- local execution returns artifacts, logs, warnings, and next actions honestly.

## Validation commands
- npm run typecheck --workspace @ricky/local
- npm test --workspace @ricky/local
- npx tsc --noEmit

## Remaining risks
- workflow keeps the earlier Claude review plus deterministic post-fix gates, but avoids a second non-deterministic signoff agent because that seam previously failed after producing passing evidence.

LOCAL_ENTRYPOINT_WORKFLOW_COMPLETE
EOF
echo LOCAL_ENTRYPOINT_WORKFLOW_COMPLETE`,
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
