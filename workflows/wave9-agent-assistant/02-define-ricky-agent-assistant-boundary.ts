import { workflow } from '@agent-relay/sdk/workflows';

async function main() {
  const result = await workflow('ricky-wave9-define-agent-assistant-boundary')
    .description("Resolve GitHub issue #10 by defining the intended boundary between Ricky-local product logic and agent-assistant shared runtime primitives.")
    .pattern('dag')
    .channel('wf-ricky-wave9-agent-assistant-boundary')
    .maxConcurrency(4)
    .timeout(3_600_000)
    .onError('retry', { maxRetries: 2, retryDelayMs: 10_000 })

    .agent('boundary-codex', {
      cli: 'codex',
      preset: 'worker',
      role: 'Writes a concrete Ricky vs agent-assistant boundary document grounded in current code truth and the completed audit.',
      retries: 2,
    })
    .agent('review-claude', {
      cli: 'claude',
      preset: 'reviewer',
      role: 'Reviews whether the boundary is specific, non-hand-wavy, and actionable for follow-on implementation.',
      retries: 1,
    })

    .step('prepare-context', {
      type: 'deterministic',
      command: [
        'mkdir -p .workflow-artifacts/wave9-agent-assistant/define-ricky-agent-assistant-boundary',
        'printf "%s\\n" "Issue #10: define Ricky vs agent-assistant adoption boundary" "Summary: Ricky needs a concrete boundary between product-local behavior and shared assistant runtime primitives." "Acceptance: each major seam is classified into product-local now / adopt shared package now / extract later after proof, with enough specificity to drive implementation issues without re-litigating scope." > .workflow-artifacts/wave9-agent-assistant/define-ricky-agent-assistant-boundary/issue-10.md',
        'test -f docs/product/ricky-agent-assistant-usage-audit.md || (echo "Missing audit doc from issue #9" && exit 1)',
        'sed -n "1,260p" docs/product/ricky-agent-assistant-usage-audit.md > .workflow-artifacts/wave9-agent-assistant/define-ricky-agent-assistant-boundary/usage-audit.snapshot.txt',
        'sed -n "1,220p" docs/architecture/ricky-runtime-architecture.md > .workflow-artifacts/wave9-agent-assistant/define-ricky-agent-assistant-boundary/runtime-architecture.snapshot.txt',
        'sed -n "1,220p" docs/architecture/ricky-specialist-boundaries.md > .workflow-artifacts/wave9-agent-assistant/define-ricky-agent-assistant-boundary/specialist-boundaries.snapshot.txt',
        'sed -n "1,220p" packages/cli/src/entrypoint/interactive-cli.ts > .workflow-artifacts/wave9-agent-assistant/define-ricky-agent-assistant-boundary/interactive-cli.snapshot.txt',
        'sed -n "1,260p" packages/local/src/entrypoint.ts > .workflow-artifacts/wave9-agent-assistant/define-ricky-agent-assistant-boundary/local-entrypoint.snapshot.txt',
        'sed -n "1,220p" packages/product/src/generation/skill-loader.ts > .workflow-artifacts/wave9-agent-assistant/define-ricky-agent-assistant-boundary/skill-loader.snapshot.txt',
        'echo PREPARE_CONTEXT_OK',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })
    .step('collect-boundary-signals', {
      type: 'deterministic',
      dependsOn: ['prepare-context'],
      command: [
        'OUT=.workflow-artifacts/wave9-agent-assistant/define-ricky-agent-assistant-boundary/boundary-signals.txt',
        'printf "# major Ricky seams\\n" > "$OUT"',
        'printf "%s\\n" "CLI / interactive surface" "handoff normalization / turn intake" "execution contract and blocker classification" "sessions / surfaces" "memory / policy / proactive behavior" "workflow generation / skill loading" >> "$OUT"',
        'printf "\\n# current code references\\n" >> "$OUT"',
        'rg -n "runInteractiveCli|normalizeRequest|LocalResponse|blocker|guidance|awaitingInput|skill-loader|turn-context|surfaces|memory|policy|proactive|specialists" packages docs >> "$OUT" || true',
        'echo COLLECT_BOUNDARY_SIGNALS_OK',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })
    .step('write-boundary-doc', {
      agent: 'boundary-codex',
      dependsOn: ['collect-boundary-signals'],
      task: `Resolve GitHub issue #10.

Write docs/product/ricky-agent-assistant-adoption-boundary.md.

Required sections:
- Executive summary
- Boundary decision principles
- Seam-by-seam classification table
- Product-local now
- Adopt shared package now
- Extract later after proof
- Risks of premature adoption
- Recommended implementation order

Required seam coverage:
- CLI / interactive surface
- handoff normalization / turn intake
- execution contract and blocker classification
- sessions / surfaces
- memory / policy / proactive behavior
- workflow generation / skill loading

Constraints:
- ground the boundary in the current audit doc and current code truth
- do not treat target architecture docs as already-landed implementation
- make explicit where Ricky should keep product ownership to protect product quality
- make explicit where shared adoption is mature enough to pursue now
- the resulting document must be concrete enough to guide issues #11, #12, and #13`,
      verification: { type: 'file_exists', value: 'docs/product/ricky-agent-assistant-adoption-boundary.md' },
    })
    .step('post-boundary-file-gate', {
      type: 'deterministic',
      dependsOn: ['write-boundary-doc'],
      command: [
        '{ git diff --name-only; git ls-files --others --exclude-standard; } | sort -u > .workflow-artifacts/wave9-agent-assistant/define-ricky-agent-assistant-boundary/changed-files.txt',
        'grep -F "docs/product/ricky-agent-assistant-adoption-boundary.md" .workflow-artifacts/wave9-agent-assistant/define-ricky-agent-assistant-boundary/changed-files.txt',
        'grep -Ei "Executive summary|Boundary decision principles|Product-local now|Adopt shared package now|Extract later after proof|implementation order" docs/product/ricky-agent-assistant-adoption-boundary.md',
        'grep -Ei "CLI / interactive|handoff normalization|execution contract|sessions / surfaces|memory / policy / proactive|workflow generation / skill loading" docs/product/ricky-agent-assistant-adoption-boundary.md',
        'echo POST_BOUNDARY_FILE_GATE_OK',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })
    .step('final-review', {
      agent: 'review-claude',
      dependsOn: ['post-boundary-file-gate'],
      task: `Review docs/product/ricky-agent-assistant-adoption-boundary.md for issue #10.

Confirm:
- each major Ricky seam is classified clearly and non-vaguely
- the boundary protects Ricky-specific product behavior where needed
- the document does not confuse target architecture with current implementation truth
- the recommendations are concrete enough to guide implementation issues without re-opening the same boundary debate

Write .workflow-artifacts/wave9-agent-assistant/define-ricky-agent-assistant-boundary/final-review.md ending with FINAL_REVIEW_PASS or FINAL_REVIEW_FAIL.`,
      verification: { type: 'file_exists', value: '.workflow-artifacts/wave9-agent-assistant/define-ricky-agent-assistant-boundary/final-review.md' },
    })
    .step('final-review-pass-gate', {
      type: 'deterministic',
      dependsOn: ['final-review'],
      command: 'grep -F "FINAL_REVIEW_PASS" .workflow-artifacts/wave9-agent-assistant/define-ricky-agent-assistant-boundary/final-review.md',
      captureOutput: true,
      failOnError: true,
    })
    .step('signoff', {
      type: 'deterministic',
      dependsOn: ['final-review-pass-gate'],
      command: [
        "cat <<'EOF' > .workflow-artifacts/wave9-agent-assistant/define-ricky-agent-assistant-boundary/signoff.md",
        '# GitHub issue #10 signoff',
        '',
        'Acceptance proof:',
        '- each major Ricky seam is classified explicitly',
        '- the boundary distinguishes current code truth from target architecture',
        '- product-local now / adopt shared now / extract later categories are concrete',
        '- the document is strong enough to drive issues #11 through #13',
        '',
        'RICKY_AGENT_ASSISTANT_BOUNDARY_COMPLETE',
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
