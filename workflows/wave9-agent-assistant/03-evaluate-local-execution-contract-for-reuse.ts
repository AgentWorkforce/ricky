import { workflow } from '@agent-relay/sdk/workflows';

async function main() {
  const result = await workflow('ricky-wave9-evaluate-local-execution-contract-for-reuse')
    .description("Resolve GitHub issue #12 by evaluating whether Ricky's local handoff normalization and staged execution/blocker contract should remain product-local or move toward agent-assistant shared runtime ownership.")
    .pattern('dag')
    .channel('wf-ricky-wave9-local-contract-reuse')
    .maxConcurrency(4)
    .timeout(3_600_000)
    .onError('retry', { maxRetries: 2, retryDelayMs: 10_000 })

    .agent('analysis-codex', {
      cli: 'codex',
      preset: 'worker',
      role: 'Evaluates Ricky local execution contract for reuse potential versus product-local ownership.',
      retries: 2,
    })
    .agent('review-claude', {
      cli: 'claude',
      preset: 'reviewer',
      role: 'Reviews whether the seam evaluation is concrete, honest, and useful for follow-on adoption work.',
      retries: 1,
    })

    .step('prepare-context', {
      type: 'deterministic',
      command: [
        'mkdir -p .workflow-artifacts/wave9-agent-assistant/evaluate-local-execution-contract-for-reuse',
        'printf "%s\\n" "Issue #12: evaluate Ricky local execution contract for agent-assistant reuse" "Summary: evaluate whether Ricky\'s current handoff normalization and staged execution/blocker contract should stay local or become a shared runtime seam." "Acceptance: compare current local contract against shared-runtime goals, classify what is product-specific vs reusable, and recommend keep local vs extract path with proof burden." > .workflow-artifacts/wave9-agent-assistant/evaluate-local-execution-contract-for-reuse/issue-12.md',
        'test -f docs/product/ricky-agent-assistant-usage-audit.md || (echo "Missing audit doc from issue #9" && exit 1)',
        'test -f docs/product/ricky-agent-assistant-adoption-boundary.md || (echo "Missing boundary doc from issue #10" && exit 1)',
        'sed -n "1,260p" docs/product/ricky-agent-assistant-usage-audit.md > .workflow-artifacts/wave9-agent-assistant/evaluate-local-execution-contract-for-reuse/usage-audit.snapshot.txt',
        'sed -n "1,260p" docs/product/ricky-agent-assistant-adoption-boundary.md > .workflow-artifacts/wave9-agent-assistant/evaluate-local-execution-contract-for-reuse/adoption-boundary.snapshot.txt',
        'sed -n "1,360p" packages/local/src/entrypoint.ts > .workflow-artifacts/wave9-agent-assistant/evaluate-local-execution-contract-for-reuse/local-entrypoint.snapshot.txt',
        'sed -n "1,260p" packages/local/src/request-normalizer.ts > .workflow-artifacts/wave9-agent-assistant/evaluate-local-execution-contract-for-reuse/request-normalizer.snapshot.txt',
        'sed -n "1,260p" packages/cli/src/entrypoint/interactive-cli.ts > .workflow-artifacts/wave9-agent-assistant/evaluate-local-execution-contract-for-reuse/interactive-cli.snapshot.txt',
        'sed -n "1200,1420p" packages/local/src/entrypoint.test.ts > .workflow-artifacts/wave9-agent-assistant/evaluate-local-execution-contract-for-reuse/local-entrypoint-tests.snapshot.txt',
        'echo PREPARE_CONTEXT_OK',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })
    .step('collect-contract-signals', {
      type: 'deterministic',
      dependsOn: ['prepare-context'],
      command: [
        'OUT=.workflow-artifacts/wave9-agent-assistant/evaluate-local-execution-contract-for-reuse/contract-signals.txt',
        'printf "# local contract symbols\\n" > "$OUT"',
        'rg -n "normalizeRequest|LocalResponse|LocalGenerationStageResult|LocalExecutionStageResult|LocalClassifiedBlocker|stageMode|returnGeneratedArtifactOnly|awaitingInput|blocker|recovery|evidence" packages/local packages/cli >> "$OUT" || true',
        'printf "\\n# live contract docs\\n" >> "$OUT"',
        'rg -n "generate vs execute|blocker|recovery|evidence|turn intake|request shaping|product-local|extract later" docs/product docs/architecture >> "$OUT" || true',
        'echo COLLECT_CONTRACT_SIGNALS_OK',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })
    .step('write-contract-evaluation', {
      agent: 'analysis-codex',
      dependsOn: ['collect-contract-signals'],
      task: `Resolve GitHub issue #12.

Write docs/product/ricky-local-execution-contract-reuse-evaluation.md.

Required sections:
- Executive summary
- What the current Ricky local contract includes
- Product-specific parts that should remain Ricky-local
- Candidate reusable/shared-runtime parts
- Comparison against agent-assistant-style shared runtime concerns
- Recommended boundary decision
- First safe migration step if extraction is recommended
- Proof burden before any extraction

Required scope:
- evaluate request normalization / turn intake behavior
- evaluate staged generation vs execution contract
- evaluate blocker classification and recovery structure
- evaluate execution evidence framing
- compare the seam against shared assistant-runtime goals without assuming existing packages already solve it

Constraints:
- do not overclaim that this seam is already shared
- do not recommend extraction unless the reusable core is concrete
- if recommending Ricky-local ownership for now, say so directly and explain why
- the output should help drive issue #11 and reduce ambiguity before #13`,
      verification: { type: 'file_exists', value: 'docs/product/ricky-local-execution-contract-reuse-evaluation.md' },
    })
    .step('post-evaluation-file-gate', {
      type: 'deterministic',
      dependsOn: ['write-contract-evaluation'],
      command: [
        '{ git diff --name-only; git ls-files --others --exclude-standard; } | sort -u > .workflow-artifacts/wave9-agent-assistant/evaluate-local-execution-contract-for-reuse/changed-files.txt',
        'grep -F "docs/product/ricky-local-execution-contract-reuse-evaluation.md" .workflow-artifacts/wave9-agent-assistant/evaluate-local-execution-contract-for-reuse/changed-files.txt',
        'grep -Ei "Executive summary|Product-specific|Candidate reusable|Recommended boundary decision|First safe migration step|Proof burden" docs/product/ricky-local-execution-contract-reuse-evaluation.md',
        'grep -Ei "request normalization|turn intake|generation vs execution|blocker|recovery|evidence" docs/product/ricky-local-execution-contract-reuse-evaluation.md',
        'echo POST_EVALUATION_FILE_GATE_OK',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })
    .step('final-review', {
      agent: 'review-claude',
      dependsOn: ['post-evaluation-file-gate'],
      task: `Review docs/product/ricky-local-execution-contract-reuse-evaluation.md for issue #12.

Confirm:
- the evaluation names the real pieces of the local execution contract, not abstractions only
- product-specific versus reusable parts are distinguished clearly
- the recommendation is direct and not hedged into meaninglessness
- the first migration step and proof burden are concrete enough to guide issue #11

Write .workflow-artifacts/wave9-agent-assistant/evaluate-local-execution-contract-for-reuse/final-review.md ending with FINAL_REVIEW_PASS or FINAL_REVIEW_FAIL.`,
      verification: { type: 'file_exists', value: '.workflow-artifacts/wave9-agent-assistant/evaluate-local-execution-contract-for-reuse/final-review.md' },
    })
    .step('final-review-pass-gate', {
      type: 'deterministic',
      dependsOn: ['final-review'],
      command: 'grep -F "FINAL_REVIEW_PASS" .workflow-artifacts/wave9-agent-assistant/evaluate-local-execution-contract-for-reuse/final-review.md',
      captureOutput: true,
      failOnError: true,
    })
    .step('signoff', {
      type: 'deterministic',
      dependsOn: ['final-review-pass-gate'],
      command: [
        "cat <<'EOF' > .workflow-artifacts/wave9-agent-assistant/evaluate-local-execution-contract-for-reuse/signoff.md",
        '# GitHub issue #12 signoff',
        '',
        'Acceptance proof:',
        '- the current Ricky local execution contract is described concretely',
        '- product-local vs reusable parts are distinguished explicitly',
        '- the document recommends keep-local vs extract path directly',
        '- first migration step and proof burden are concrete enough to guide issue #11',
        '',
        'RICKY_LOCAL_CONTRACT_REUSE_EVALUATION_COMPLETE',
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
