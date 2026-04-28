import { workflow } from '@agent-relay/sdk/workflows';

const artifactDir = '.workflow-artifacts/wave10-agent-assistant-adoption/close-agent-assistant-handoff-issue';

async function main() {
  const result = await workflow('ricky-wave10-close-agent-assistant-handoff-issue')
    .description('Close issue #14 after verifying the doc closures, implementation signoff, live proof signoff, and GitHub issue states for the Ricky agent-assistant adoption program.')
    .pattern('pipeline')
    .channel('wf-ricky-wave10-handoff-closure')
    .maxConcurrency(2)
    .timeout(1_200_000)
    .onError('retry', { maxRetries: 1, retryDelayMs: 10_000 })

    .step('preflight', {
      type: 'deterministic',
      command: [
        `DIR=${artifactDir}`,
        'mkdir -p "$DIR"',
        'test -f .workflow-artifacts/wave10-agent-assistant-adoption/verify-and-close-wave9-docs/signoff.md',
        'test -f .workflow-artifacts/wave10-agent-assistant-adoption/adopt-request-turn-context-adapter/signoff.md',
        'test -f .workflow-artifacts/wave10-agent-assistant-adoption/prove-live-product-path/signoff.md',
        'grep -F "WAVE9_AGENT_ASSISTANT_DOC_ISSUES_COMPLETE" .workflow-artifacts/wave10-agent-assistant-adoption/verify-and-close-wave9-docs/signoff.md',
        'grep -F "RICKY_TURN_CONTEXT_ADOPTION_IMPLEMENTED" .workflow-artifacts/wave10-agent-assistant-adoption/adopt-request-turn-context-adapter/signoff.md',
        'grep -F "RICKY_AGENT_ASSISTANT_ADOPTION_LIVE_PROOF_COMPLETE" .workflow-artifacts/wave10-agent-assistant-adoption/prove-live-product-path/signoff.md',
        'test -f docs/product/ricky-agent-assistant-adoption-proof.md',
        'test -f docs/product/ricky-agent-assistant-live-proof.md',
        'gh auth status >/dev/null 2>&1 || (echo "ERROR: gh CLI must be authenticated to close issue #14" && exit 1)',
        'echo PREFLIGHT_OK',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })
    .step('verify-related-issues-closed', {
      type: 'deterministic',
      dependsOn: ['preflight'],
      command: [
        `DIR=${artifactDir}`,
        'for issue in 9 10 11 12 13; do gh issue view "$issue" --json number,state,title,url > "$DIR/issue-$issue-state.json"; test "$(gh issue view "$issue" --json state --jq .state)" = "CLOSED"; done',
        'echo RELATED_ISSUES_CLOSED',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })
    .step('write-issue-14-close-comment', {
      type: 'deterministic',
      dependsOn: ['verify-related-issues-closed'],
      command: [
        `DIR=${artifactDir}`,
        "cat > \"$DIR/issue-14-close-comment.md\" <<'EOF'",
        'Completed the Ricky agent-assistant adoption handoff program.',
        '',
        'Closed the already-produced documentation issues:',
        '- #9: `docs/product/ricky-agent-assistant-usage-audit.md`',
        '- #10: `docs/product/ricky-agent-assistant-adoption-boundary.md`',
        '- #12: `docs/product/ricky-local-execution-contract-reuse-evaluation.md`',
        '',
        'Completed the adoption/proof sequence:',
        '- #11: first real shared slice via `@agent-assistant/turn-context` request/turn compatibility adapter',
        '- #13: live product proof in `docs/product/ricky-agent-assistant-live-proof.md`',
        '',
        'Durable signoffs:',
        '- `.workflow-artifacts/wave10-agent-assistant-adoption/verify-and-close-wave9-docs/signoff.md`',
        '- `.workflow-artifacts/wave10-agent-assistant-adoption/adopt-request-turn-context-adapter/signoff.md`',
        '- `.workflow-artifacts/wave10-agent-assistant-adoption/prove-live-product-path/signoff.md`',
        '',
        'Closing this handoff issue as complete.',
        'EOF',
        'echo ISSUE_14_CLOSE_COMMENT_READY',
      ].join('\n'),
      captureOutput: true,
      failOnError: true,
    })
    .step('close-issue-14', {
      type: 'deterministic',
      dependsOn: ['write-issue-14-close-comment'],
      command: [
        `DIR=${artifactDir}`,
        'state=$(gh issue view 14 --json state --jq .state)',
        'if [ "$state" != "CLOSED" ]; then gh issue comment 14 --body-file "$DIR/issue-14-close-comment.md"; gh issue close 14 --reason completed; fi',
        'test "$(gh issue view 14 --json state --jq .state)" = "CLOSED"',
        'echo ISSUE_14_CLOSED',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })
    .step('signoff', {
      type: 'deterministic',
      dependsOn: ['close-issue-14'],
      command: [
        `DIR=${artifactDir}`,
        "cat > \"$DIR/signoff.md\" <<'EOF'",
        '# GitHub issue #14 signoff',
        '',
        'All handoff items are complete and issues #9, #10, #11, #12, #13, and #14 are closed.',
        '',
        'RICKY_AGENT_ASSISTANT_HANDOFF_COMPLETE',
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
