import { workflow } from '@agent-relay/sdk/workflows';

const artifactDir = '.workflow-artifacts/wave10-agent-assistant-adoption/adopt-request-turn-context-adapter';

async function main() {
  const result = await workflow('ricky-wave10-adopt-request-turn-context-adapter')
    .description('Resolve issue #11 by adopting @agent-assistant/turn-context as a narrow request/turn compatibility adapter while preserving Ricky local product behavior.')
    .pattern('dag')
    .channel('wf-ricky-wave10-turn-context-adoption')
    .maxConcurrency(4)
    .timeout(3_600_000)
    .onError('retry', { maxRetries: 2, retryDelayMs: 10_000 })

    .agent('impl-codex', {
      cli: 'codex',
      preset: 'worker',
      role: 'Implements the bounded Ricky local request-to-agent-assistant turn-context adapter without broad product rewrites.',
      retries: 2,
    })
    .agent('test-codex', {
      cli: 'codex',
      preset: 'worker',
      role: 'Adds preservation tests proving all Ricky handoff sources survive the new shared turn-context adapter.',
      retries: 2,
    })
    .agent('review-claude', {
      cli: 'claude',
      preset: 'reviewer',
      role: 'Reviews whether issue #11 is truly using a real agent-assistant package and preserving Ricky behavior.',
      retries: 1,
    })

    .step('preflight', {
      type: 'deterministic',
      command: [
        `DIR=${artifactDir}`,
        'mkdir -p "$DIR"',
        'test -f docs/product/ricky-agent-assistant-usage-audit.md',
        'test -f docs/product/ricky-agent-assistant-adoption-boundary.md',
        'test -f docs/product/ricky-local-execution-contract-reuse-evaluation.md',
        'npm view @agent-assistant/turn-context version > "$DIR/turn-context-registry-version.txt"',
        'sed -n "1,220p" packages/local/src/request-normalizer.ts > "$DIR/request-normalizer.before.txt"',
        'sed -n "1,260p" packages/local/src/entrypoint.ts > "$DIR/local-entrypoint.before.txt"',
        'sed -n "1,160p" packages/local/src/index.ts > "$DIR/local-index.before.txt"',
        'sed -n "1,120p" packages/local/package.json > "$DIR/local-package.before.json"',
        'echo PREFLIGHT_OK',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })
    .step('install-turn-context-dependency', {
      type: 'deterministic',
      dependsOn: ['preflight'],
      command: 'npm install --workspace @ricky/local',
      captureOutput: true,
      failOnError: true,
    })
    .step('implement-adapter', {
      agent: 'impl-codex',
      dependsOn: ['install-turn-context-dependency'],
      task: `Implement GitHub issue #11 as the preferred request/turn envelope alignment slice.

You are not alone in the codebase. Preserve unrelated edits and do not revert work outside this slice.

Owned write scope:
- packages/local/src/assistant-turn-context-adapter.ts
- packages/local/src/index.ts
- packages/local/src/entrypoint.ts
- packages/local/package.json
- docs/product/ricky-agent-assistant-adoption-proof.md
- package-lock.json only for workspace dependency sync needed to materialize the declared @agent-assistant/turn-context dependency

Acceptance contract:
- Ricky uses the real @agent-assistant/turn-context package at runtime, not just copied local types.
- Add a bounded adapter that maps the existing LocalInvocationRequest into a TurnContextInput and assembles it through createTurnContextAssembler().
- Name the adapter functions clearly, including toRickyTurnContextInput() and assembleRickyTurnContext().
- Preserve Ricky's public LocalResponse shape and current local generation/execution/blocker behavior.
- Preserve request id, source, source metadata, structured spec, invocation root, mode, stage mode, spec path, and metadata in the shared turn context metadata or enrichment blocks.
- The adapter must not move the full LocalResponse, blocker taxonomy, or local CLI/runtime contract into agent-assistant.
- Update the product proof doc with what is now real shared reuse versus still Ricky-owned.

Use the docs from #9, #10, and #12 as the decision source. Do not broaden into sessions, memory, policy, proactive behavior, or a full local execution extraction.`,
      verification: { type: 'exit_code', value: '0' },
    })
    .step('adapter-file-gate', {
      type: 'deterministic',
      dependsOn: ['implement-adapter'],
      command: [
        `DIR=${artifactDir}`,
        '{ git diff --name-only; git ls-files --others --exclude-standard; } | sort -u > "$DIR/changed-files.txt"',
        'test -f packages/local/src/assistant-turn-context-adapter.ts',
        'grep -F "@agent-assistant/turn-context" packages/local/package.json package-lock.json packages/local/src/assistant-turn-context-adapter.ts',
        'grep -F "createTurnContextAssembler" packages/local/src/assistant-turn-context-adapter.ts',
        'grep -F "toRickyTurnContextInput" packages/local/src/assistant-turn-context-adapter.ts',
        'grep -F "assembleRickyTurnContext" packages/local/src/assistant-turn-context-adapter.ts',
        'grep -R "assembleRickyTurnContext" packages/local/src/entrypoint.ts packages/local/src/index.ts',
        'grep -Eiq "real shared reuse|@agent-assistant/turn-context|still Ricky-owned|LocalResponse" docs/product/ricky-agent-assistant-adoption-proof.md',
        'echo ADAPTER_FILE_GATE_OK',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })
    .step('add-preservation-tests', {
      agent: 'test-codex',
      dependsOn: ['adapter-file-gate'],
      task: `Add tests for the issue #11 adapter slice.

You are not alone in the codebase. Work with the implementation as it exists; do not revert unrelated edits.

Owned write scope:
- packages/local/src/assistant-turn-context-adapter.test.ts
- packages/local/src/entrypoint.test.ts only if needed to prove the adapter is in the live local path

Required test proof:
- CLI, MCP, Claude, structured, free-form, and workflow-artifact handoffs round-trip through normalizeRequest() and the turn-context adapter without dropping request id, source, structured payloads, source metadata, invocation root, mode, stage mode, spec path, or metadata.
- runLocal() still returns the existing LocalResponse fields for generation-only behavior.
- artifact-run and generate-and-run behavior still preserve stage semantics.
- blocker and evidence paths still emit the same Ricky fields.
- The tests import and exercise the real @agent-assistant/turn-context-backed adapter.

Prefer deterministic fakes and injected executors. Do not require live provider credentials or a real agent-relay runtime.`,
      verification: { type: 'exit_code', value: '0' },
    })
    .step('test-file-gate', {
      type: 'deterministic',
      dependsOn: ['add-preservation-tests'],
      command: [
        'test -f packages/local/src/assistant-turn-context-adapter.test.ts',
        'grep -Eiq "cli|mcp|claude|structured|free-form|workflow-artifact" packages/local/src/assistant-turn-context-adapter.test.ts',
        'grep -Eiq "requestId|sourceMetadata|invocationRoot|stageMode|structuredSpec|specPath" packages/local/src/assistant-turn-context-adapter.test.ts',
        'grep -F "@agent-assistant/turn-context" packages/local/src/assistant-turn-context-adapter.ts',
        'echo TEST_FILE_GATE_OK',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })
    .step('run-targeted-tests', {
      type: 'deterministic',
      dependsOn: ['test-file-gate'],
      command: 'npm run typecheck && npx tsc --noEmit && npm test --workspace @ricky/local && npm test --workspace @ricky/cli',
      captureOutput: true,
      failOnError: false,
    })
    .step('fix-loop', {
      agent: 'impl-codex',
      dependsOn: ['run-targeted-tests'],
      task: `This is the 80-to-100 fix loop for issue #11. Fix any validation failure and rerun until green.

Validation output:
{{steps.run-targeted-tests.output}}

Commands to rerun:
- npm run typecheck
- npx tsc --noEmit
- npm test --workspace @ricky/local
- npm test --workspace @ricky/cli

Do not widen scope beyond the request/turn context adapter.

Write ${artifactDir}/fix-loop.md ending with TURN_CONTEXT_ADOPTION_FIX_LOOP_COMPLETE.`,
      verification: { type: 'file_exists', value: `${artifactDir}/fix-loop.md` },
    })
    .step('final-review', {
      agent: 'review-claude',
      dependsOn: ['fix-loop'],
      task: `Review issue #11 completion.

Confirm:
- Ricky now imports and uses @agent-assistant/turn-context in the local product path.
- The chosen slice is explicitly request/turn envelope alignment.
- The adapter preserves Ricky LocalResponse behavior and does not move the full local contract.
- Tests prove all six handoff sources preserve their important fields.
- docs/product/ricky-agent-assistant-adoption-proof.md honestly distinguishes real reuse from Ricky-owned behavior.

Write ${artifactDir}/final-review.md ending with FINAL_REVIEW_PASS or FINAL_REVIEW_FAIL.`,
      verification: { type: 'file_exists', value: `${artifactDir}/final-review.md` },
    })
    .step('final-review-pass-gate', {
      type: 'deterministic',
      dependsOn: ['final-review'],
      command: [
        `DIR=${artifactDir}`,
        'grep -F "FINAL_REVIEW_PASS" "$DIR/final-review.md"',
        'if grep -F "FINAL_REVIEW_FAIL" "$DIR/final-review.md"; then echo "final review failed"; exit 1; fi',
        'echo FINAL_REVIEW_PASS_GATE_OK',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })
    .step('final-hard-validation', {
      type: 'deterministic',
      dependsOn: ['final-review-pass-gate'],
      command: 'npm run typecheck && npx tsc --noEmit && npm test --workspace @ricky/local && npm test --workspace @ricky/cli && npm test',
      captureOutput: true,
      failOnError: true,
    })
    .step('signoff', {
      type: 'deterministic',
      dependsOn: ['final-hard-validation'],
      command: [
        `DIR=${artifactDir}`,
        "cat > \"$DIR/signoff.md\" <<'EOF'",
        '# GitHub issue #11 implementation signoff',
        '',
        'Chosen slice:',
        '- request/turn envelope alignment through @agent-assistant/turn-context',
        '',
        'Validation commands:',
        '- npm run typecheck',
        '- npx tsc --noEmit',
        '- npm test --workspace @ricky/local',
        '- npm test --workspace @ricky/cli',
        '- npm test',
        '',
        'Completion note:',
        '- #11 is implemented, but final issue closure should wait for the live product proof workflow for #13.',
        '',
        'RICKY_TURN_CONTEXT_ADOPTION_IMPLEMENTED',
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
  process.exitCode = 1;
});
