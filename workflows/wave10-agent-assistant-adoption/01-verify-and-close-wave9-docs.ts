import { workflow } from '@agent-relay/sdk/workflows';

const artifactDir = '.workflow-artifacts/wave10-agent-assistant-adoption/verify-and-close-wave9-docs';

async function main() {
  const result = await workflow('ricky-wave10-verify-and-close-wave9-docs')
    .description('Verify the completed wave9 agent-assistant documents against issues #9, #10, and #12, then close those issues with precise document-linked comments.')
    .pattern('pipeline')
    .channel('wf-ricky-wave10-doc-closure')
    .maxConcurrency(2)
    .timeout(1_800_000)
    .onError('retry', { maxRetries: 1, retryDelayMs: 10_000 })

    .agent('review-claude', {
      cli: 'claude',
      preset: 'reviewer',
      role: 'Performs a bounded acceptance review of already-authored Ricky agent-assistant product documents.',
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
        'gh auth status >/dev/null 2>&1 || (echo "ERROR: gh CLI must be authenticated to close issues" && exit 1)',
        'for issue in 9 10 12; do gh issue view "$issue" --json number,state,title,url > "$DIR/issue-$issue.json"; done',
        'echo PREFLIGHT_OK',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })
    .step('deterministic-doc-gates', {
      type: 'deterministic',
      dependsOn: ['preflight'],
      command: [
        `DIR=${artifactDir}`,
        'grep -Eiq "Direct shared-runtime reuse|Conceptual alignment|Product-local assistant-like implementation|keep local|adopt shared|extract later|integration depth" docs/product/ricky-agent-assistant-usage-audit.md',
        'grep -Eiq "CLI / interactive surface|Handoff normalization / turn intake|Execution contract and blocker classification|Sessions / surfaces|Memory / policy / proactive behavior|Workflow generation / skill loading" docs/product/ricky-agent-assistant-adoption-boundary.md',
        'grep -Eiq "request/turn envelope alignment|compatibility adapter|round-trip preservation|CLI, MCP, Claude, structured, free-form, and workflow-artifact|Do not extract the local execution contract now" docs/product/ricky-local-execution-contract-reuse-evaluation.md',
        'wc -l docs/product/ricky-agent-assistant-usage-audit.md docs/product/ricky-agent-assistant-adoption-boundary.md docs/product/ricky-local-execution-contract-reuse-evaluation.md > "$DIR/doc-line-counts.txt"',
        'echo DOC_GATES_OK',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })
    .step('acceptance-review', {
      agent: 'review-claude',
      dependsOn: ['deterministic-doc-gates'],
      task: `Review only these files against GitHub issues #9, #10, and #12:
- docs/product/ricky-agent-assistant-usage-audit.md
- docs/product/ricky-agent-assistant-adoption-boundary.md
- docs/product/ricky-local-execution-contract-reuse-evaluation.md

This is a bounded acceptance review, not a rewrite. Do not edit the product docs unless a clear acceptance miss is found.

Confirm:
- #9 is satisfied by the usage audit document.
- #10 is satisfied by the adoption boundary document.
- #12 is satisfied by the local execution contract reuse evaluation.
- The docs do not overclaim current agent-assistant runtime adoption.
- The docs point #11 toward request/turn envelope alignment as the preferred compatibility-adapter slice.

Write ${artifactDir}/acceptance-review.md ending with WAVE9_DOC_ACCEPTANCE_PASS or WAVE9_DOC_ACCEPTANCE_FAIL.`,
      verification: { type: 'file_exists', value: `${artifactDir}/acceptance-review.md` },
    })
    .step('acceptance-pass-gate', {
      type: 'deterministic',
      dependsOn: ['acceptance-review'],
      command: [
        `DIR=${artifactDir}`,
        'grep -F "WAVE9_DOC_ACCEPTANCE_PASS" "$DIR/acceptance-review.md"',
        'if grep -F "WAVE9_DOC_ACCEPTANCE_FAIL" "$DIR/acceptance-review.md"; then echo "acceptance review failed"; exit 1; fi',
        'echo ACCEPTANCE_PASS_GATE_OK',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })
    .step('write-closing-comments', {
      type: 'deterministic',
      dependsOn: ['acceptance-pass-gate'],
      command: [
        `DIR=${artifactDir}`,
        "cat > \"$DIR/issue-9-close-comment.md\" <<'EOF'",
        'Verified and accepted.',
        '',
        'The audit deliverable is on disk at `docs/product/ricky-agent-assistant-usage-audit.md`. It distinguishes direct shared-runtime reuse, conceptual alignment, and Ricky-local assistant-like implementation, then groups recommendations into keep-local, adopt-shared, and extract-later paths.',
        '',
        'Closing as complete.',
        'EOF',
        "cat > \"$DIR/issue-10-close-comment.md\" <<'EOF'",
        'Verified and accepted.',
        '',
        'The boundary deliverable is on disk at `docs/product/ricky-agent-assistant-adoption-boundary.md`. It classifies the requested seams across product-local now, adopt shared package now, and extract later after proof, and it is concrete enough to guide the implementation sequence.',
        '',
        'Closing as complete.',
        'EOF',
        "cat > \"$DIR/issue-12-close-comment.md\" <<'EOF'",
        'Verified and accepted.',
        '',
        'The reuse evaluation is on disk at `docs/product/ricky-local-execution-contract-reuse-evaluation.md`. It recommends keeping the full local execution contract Ricky-local for now and using request/turn envelope alignment as the first compatibility-adapter slice for #11.',
        '',
        'Closing as complete.',
        'EOF',
        'echo CLOSING_COMMENTS_READY',
      ].join('\n'),
      captureOutput: true,
      failOnError: true,
    })
    .step('close-github-issues', {
      type: 'deterministic',
      dependsOn: ['write-closing-comments'],
      command: [
        `DIR=${artifactDir}`,
        'for issue in 9 10 12; do state=$(gh issue view "$issue" --json state --jq .state); if [ "$state" != "CLOSED" ]; then gh issue comment "$issue" --body-file "$DIR/issue-$issue-close-comment.md"; gh issue close "$issue" --reason completed; fi; done',
        'for issue in 9 10 12; do test "$(gh issue view "$issue" --json state --jq .state)" = "CLOSED"; done',
        'echo WAVE9_DOC_ISSUES_CLOSED',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })
    .step('signoff', {
      type: 'deterministic',
      dependsOn: ['close-github-issues'],
      command: [
        `DIR=${artifactDir}`,
        "cat > \"$DIR/signoff.md\" <<'EOF'",
        '# Wave10 doc closure signoff',
        '',
        'Closed issues:',
        '- #9: docs/product/ricky-agent-assistant-usage-audit.md',
        '- #10: docs/product/ricky-agent-assistant-adoption-boundary.md',
        '- #12: docs/product/ricky-local-execution-contract-reuse-evaluation.md',
        '',
        'WAVE9_AGENT_ASSISTANT_DOC_ISSUES_COMPLETE',
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
