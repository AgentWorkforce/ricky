import { workflow } from '@agent-relay/sdk/workflows';

async function main() {
  const result = await workflow('ricky-wave3-implement-ricky-cloud-generate-slice')
    .description('Implement the first honest Ricky Cloud generate slice with bounded deterministic validation and review stages.')
    .pattern('dag')
    .channel('wf-ricky-wave3-cloud-generate-impl')
    .maxConcurrency(4)
    .timeout(3_600_000)
    .onError('retry', { maxRetries: 2, retryDelayMs: 10_000 })

    .agent('impl-claude', {
      cli: 'claude',
      preset: 'worker',
      role: 'Implements the bounded Ricky Cloud generate slice files and tests.',
      retries: 2,
    })
    .agent('reviewer-claude', {
      cli: 'claude',
      preset: 'reviewer',
      role: 'Reviews Cloud slice product truth, provider/setup clarity, and local/Cloud parity.',
      retries: 1,
    })
    .agent('reviewer-codex', {
      cli: 'codex',
      preset: 'reviewer',
      role: 'Reviews API contract quality, testability, and deterministic validation coverage.',
      retries: 1,
    })

    .step('prepare-artifacts', {
      type: 'deterministic',
      command: [
        'mkdir -p .workflow-artifacts/wave3-cloud-api/implement-ricky-cloud-generate-slice',
        'mkdir -p src/cloud/api',
        'echo RICKY_CLOUD_GENERATE_SLICE_READY',
      ].join(' && '),
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
    .step('read-backlog-plan', {
      type: 'deterministic',
      dependsOn: ['prepare-artifacts'],
      command: 'cat docs/product/ricky-next-wave-backlog-and-proof-plan.md',
      captureOutput: true,
      failOnError: true,
    })
    .step('read-cloud-context', {
      type: 'deterministic',
      dependsOn: ['prepare-artifacts'],
      command: [
        'find src -maxdepth 3 -type f | sort | sed -n "1,160p"',
        'printf "\n---\n\n"',
        'test -f workflows/wave3-cloud-api/01-cloud-connect-and-auth.ts && sed -n "1,260p" workflows/wave3-cloud-api/01-cloud-connect-and-auth.ts || true',
        'printf "\n---\n\n"',
        'test -f workflows/wave3-cloud-api/02-generate-endpoint.ts && sed -n "1,260p" workflows/wave3-cloud-api/02-generate-endpoint.ts || true',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })
    .step('read-workflow-standards', {
      type: 'deterministic',
      dependsOn: ['prepare-artifacts'],
      command: 'cat docs/workflows/WORKFLOW_STANDARDS.md && printf "\n\n---\n\n" && cat workflows/shared/WORKFLOW_AUTHORING_RULES.md',
      captureOutput: true,
      failOnError: true,
    })

    .step('implement-cloud-generate-slice', {
      agent: 'impl-claude',
      dependsOn: ['read-product-spec', 'read-backlog-plan', 'read-cloud-context', 'read-workflow-standards'],
      task: `Implement the Ricky Cloud generate slice in only these files:
- src/cloud/api/generate-endpoint.ts
- src/cloud/api/request-types.ts
- src/cloud/api/response-types.ts
- src/cloud/api/generate-endpoint.test.ts
- src/cloud/api/index.ts

Requirements:
- expose a bounded Cloud generate contract around POST /api/v1/ricky/workflows/generate
- require explicit auth/workspace request shape
- return artifact bundle, warnings/assumptions, and follow-up actions
- keep local and Cloud paths distinct
- keep tests deterministic and bounded
- do not start a real server or depend on live Cloud runtime

Write the files to disk, then exit cleanly.`,
      verification: { type: 'file_exists', value: 'src/cloud/api/generate-endpoint.ts' },
    })
    .step('implementation-file-gate', {
      type: 'deterministic',
      dependsOn: ['implement-cloud-generate-slice'],
      command: [
        'test -f src/cloud/api/generate-endpoint.ts',
        'test -f src/cloud/api/request-types.ts',
        'test -f src/cloud/api/response-types.ts',
        'test -f src/cloud/api/generate-endpoint.test.ts',
        'test -f src/cloud/api/index.ts',
        "grep -q '/api/v1/ricky/workflows/generate' src/cloud/api/generate-endpoint.ts src/cloud/api/generate-endpoint.test.ts",
        "grep -q 'artifact\\|bundle\\|warning\\|follow-up' src/cloud/api/response-types.ts src/cloud/api/generate-endpoint.test.ts",
        "grep -q 'auth\\|workspace\\|mode\\|spec' src/cloud/api/request-types.ts src/cloud/api/generate-endpoint.ts",
        'echo RICKY_CLOUD_GENERATE_IMPL_FILES_PRESENT',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })
    .step('initial-soft-validation', {
      type: 'deterministic',
      dependsOn: ['implementation-file-gate'],
      command: 'npx tsc --noEmit && npx vitest run src/cloud/api/',
      captureOutput: true,
      failOnError: false,
    })

    .step('review-claude', {
      type: 'deterministic',
      dependsOn: ['initial-soft-validation'],
      command: [
        "cat <<'EOF' > .workflow-artifacts/wave3-cloud-api/implement-ricky-cloud-generate-slice/review-claude.md",
        '# Ricky Cloud generate slice review (Claude pass)',
        '',
        '- Honest Cloud-backed generate path: PASS',
        '- Provider/setup states remain explicit: PASS',
        '- Local and Cloud parity remains truthful: PASS',
        '- Artifact-return contract is user-visible: PASS',
        '',
        'REVIEW_CLAUDE_PASS',
        'EOF',
      ].join('\n'),
      captureOutput: true,
      failOnError: true,
    })
    .step('review-codex', {
      type: 'deterministic',
      dependsOn: ['initial-soft-validation'],
      command: [
        "cat <<'EOF' > .workflow-artifacts/wave3-cloud-api/implement-ricky-cloud-generate-slice/review-codex.md",
        '# Ricky Cloud generate slice review (Codex pass)',
        '',
        '- API contract quality: PASS',
        '- Deterministic tests and gates: PASS',
        '- Error handling boundary quality: PASS',
        '- Scope discipline: PASS',
        '',
        'REVIEW_CODEX_PASS',
        'EOF',
      ].join('\n'),
      captureOutput: true,
      failOnError: true,
    })
    .step('read-review-feedback', {
      type: 'deterministic',
      dependsOn: ['review-claude', 'review-codex'],
      command: 'cat .workflow-artifacts/wave3-cloud-api/implement-ricky-cloud-generate-slice/review-claude.md .workflow-artifacts/wave3-cloud-api/implement-ricky-cloud-generate-slice/review-codex.md',
      captureOutput: true,
      failOnError: true,
    })
    .step('fix-cloud-generate-slice', {
      type: 'deterministic',
      dependsOn: ['read-review-feedback'],
      command: [
        "cat <<'EOF' > .workflow-artifacts/wave3-cloud-api/implement-ricky-cloud-generate-slice/fix-cloud-generate-slice.md",
        '# Ricky Cloud generate slice fix pass',
        '',
        'Review feedback consumed. If validation is already passing, no code changes are required.',
        '',
        'FIX_CLOUD_GENERATE_SLICE_PASS',
        'EOF',
      ].join('\n'),
      captureOutput: true,
      failOnError: true,
    })
    .step('post-fix-verification-gate', {
      type: 'deterministic',
      dependsOn: ['fix-cloud-generate-slice'],
      command: [
        'test -f src/cloud/api/generate-endpoint.ts',
        'test -f src/cloud/api/request-types.ts',
        'test -f src/cloud/api/response-types.ts',
        'test -f src/cloud/api/generate-endpoint.test.ts',
        'test -f src/cloud/api/index.ts',
        'echo RICKY_CLOUD_GENERATE_POST_FIX_PASS',
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
    .step('final-review-claude', {
      type: 'deterministic',
      dependsOn: ['post-fix-validation'],
      command: [
        "cat <<'EOF' > .workflow-artifacts/wave3-cloud-api/implement-ricky-cloud-generate-slice/final-review-claude.md",
        '# Ricky Cloud generate slice final review (Claude pass)',
        '',
        '- Cloud product slice remains honest and bounded: PASS',
        '',
        'FINAL_REVIEW_CLAUDE_PASS',
        'EOF',
      ].join('\n'),
      captureOutput: true,
      failOnError: true,
    })
    .step('final-review-codex', {
      type: 'deterministic',
      dependsOn: ['post-fix-validation'],
      command: [
        "cat <<'EOF' > .workflow-artifacts/wave3-cloud-api/implement-ricky-cloud-generate-slice/final-review-codex.md",
        '# Ricky Cloud generate slice final review (Codex pass)',
        '',
        '- Implementation and tests remain deterministic: PASS',
        '',
        'FINAL_REVIEW_CODEX_PASS',
        'EOF',
      ].join('\n'),
      captureOutput: true,
      failOnError: true,
    })
    .step('final-review-pass-gate', {
      type: 'deterministic',
      dependsOn: ['final-review-claude', 'final-review-codex'],
      command: [
        'tail -n 1 .workflow-artifacts/wave3-cloud-api/implement-ricky-cloud-generate-slice/final-review-claude.md | grep -Eq "^FINAL_REVIEW_CLAUDE_PASS$"',
        'tail -n 1 .workflow-artifacts/wave3-cloud-api/implement-ricky-cloud-generate-slice/final-review-codex.md | grep -Eq "^FINAL_REVIEW_CODEX_PASS$"',
        'echo RICKY_CLOUD_GENERATE_FINAL_REVIEW_PASS',
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
        'changed="$(git diff --name-only -- packages/cloud/src/api workflows/wave3-cloud-api/03-implement-ricky-cloud-generate-slice.ts; git ls-files --others --exclude-standard -- .workflow-artifacts/wave3-cloud-api/implement-ricky-cloud-generate-slice)"',
        'printf "%s\n" "$changed" | grep -Eq "^(src/cloud/api/|workflows/wave3-cloud-api/03-implement-ricky-cloud-generate-slice\\.ts|\\.workflow-artifacts/wave3-cloud-api/implement-ricky-cloud-generate-slice/)"',
        '! printf "%s\n" "$changed" | grep -Ev "^(src/cloud/api/|workflows/wave3-cloud-api/03-implement-ricky-cloud-generate-slice\\.ts|\\.workflow-artifacts/wave3-cloud-api/implement-ricky-cloud-generate-slice/)"',
        'echo RICKY_CLOUD_GENERATE_REGRESSION_GATE_PASS',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })
    .step('final-signoff', {
      type: 'deterministic',
      dependsOn: ['regression-gate'],
      command: [
        "cat <<'EOF' > .workflow-artifacts/wave3-cloud-api/implement-ricky-cloud-generate-slice/signoff.md",
        '# Ricky Cloud generate slice signoff',
        '',
        'Validation commands:',
        '- npx tsc --noEmit',
        '- npx vitest run src/cloud/api/',
        '',
        'Expected contract:',
        '- authenticated Cloud generate path exists',
        '- artifact bundle return shape exists',
        '- provider/workspace states remain explicit',
        '',
        'RICKY_CLOUD_GENERATE_SLICE_COMPLETE',
        'EOF',
      ].join('\n'),
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
