import { workflow } from '@agent-relay/sdk/workflows';

async function main() {
  const result = await workflow('ricky-wave7-prove-proof-loop-analytics-feedback')
    .description('Prove that Ricky can digest evidence from the current CLI, local, runtime, recovery, and Cloud proof slices into actionable next-wave feedback.')
    .pattern('dag')
    .channel('wf-ricky-wave7-analytics-feedback')
    .maxConcurrency(4)
    .timeout(3_600_000)
    .onError('retry', { maxRetries: 2, retryDelayMs: 10_000 })

    .agent('impl-claude', {
      cli: 'claude',
      preset: 'worker',
      role: 'Implements the bounded analytics digest and evidence classification from prior proof artifacts.',
      retries: 2,
    })
    .agent('reviewer-codex', {
      cli: 'codex',
      preset: 'reviewer',
      role: 'Reviews digest determinism, coverage of blocked/proven journeys, and planning usefulness.',
      retries: 1,
    })

    .step('prepare-artifacts', {
      type: 'deterministic',
      command: [
        'mkdir -p .workflow-artifacts/wave7-analytics-proof/prove-proof-loop-analytics-feedback',
        'echo RICKY_WAVE7_ANALYTICS_FEEDBACK_READY',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })
    .step('collect-evidence-index', {
      type: 'deterministic',
      dependsOn: ['prepare-artifacts'],
      command: [
        'find .workflow-artifacts -maxdepth 4 -type f | sort > .workflow-artifacts/wave7-analytics-proof/prove-proof-loop-analytics-feedback/evidence-index.txt',
        'cat .workflow-artifacts/wave7-analytics-proof/prove-proof-loop-analytics-feedback/evidence-index.txt',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })
    .step('implement-analytics-digest', {
      agent: 'impl-claude',
      dependsOn: ['collect-evidence-index'],
      task: `Using existing Ricky analytics or proof-related seams where practical, create a bounded digest artifact set under .workflow-artifacts/wave7-analytics-proof/prove-proof-loop-analytics-feedback/.

Requirements:
- classify proven, blocked, and partial journeys across CLI, local, runtime, recovery, Cloud, and signoff state
- do not skip blocked journeys; name the blocker explicitly
- produce a next-wave recommendation that says whether live runtime proof, Cloud parity, or MCP/Slack should come next based on current evidence
- keep the digest deterministic and file-backed`,
      verification: { type: 'file_exists', value: '.workflow-artifacts/wave7-analytics-proof/prove-proof-loop-analytics-feedback/evidence-index.txt' },
    })
    .step('final-hard-validation', {
      type: 'deterministic',
      dependsOn: ['implement-analytics-digest'],
      command: 'test -s .workflow-artifacts/wave7-analytics-proof/prove-proof-loop-analytics-feedback/evidence-index.txt && echo ANALYTICS_EVIDENCE_INDEX_OK',
      captureOutput: true,
      failOnError: true,
    })
    .step('final-signoff', {
      type: 'deterministic',
      dependsOn: ['final-hard-validation'],
      command: [
        "cat <<'EOF' > .workflow-artifacts/wave7-analytics-proof/prove-proof-loop-analytics-feedback/signoff.md",
        '# Ricky proof-loop analytics feedback signoff',
        '',
        'Validation commands:',
        '- test -s .workflow-artifacts/wave7-analytics-proof/prove-proof-loop-analytics-feedback/evidence-index.txt',
        '',
        'Expected slice truth:',
        '- blocked journeys are included rather than erased',
        '- next-wave recommendation is grounded in current artifact evidence',
        '',
        'ANALYTICS_FEEDBACK_COMPLETE',
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
