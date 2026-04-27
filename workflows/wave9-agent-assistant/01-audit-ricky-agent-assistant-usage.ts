import { workflow } from '@agent-relay/sdk/workflows';

async function main() {
  const result = await workflow('ricky-wave9-audit-agent-assistant-usage')
    .description("Resolve GitHub issue #9 by auditing Ricky's real agent-assistant usage, identifying local reimplementation seams, and producing a boundary-driving verdict document.")
    .pattern('dag')
    .channel('wf-ricky-wave9-agent-assistant-audit')
    .maxConcurrency(4)
    .timeout(3_600_000)
    .onError('retry', { maxRetries: 2, retryDelayMs: 10_000 })

    .agent('audit-codex', {
      cli: 'codex',
      preset: 'worker',
      role: 'Audits Ricky code and docs for real agent-assistant reuse versus product-local implementation.',
      retries: 2,
    })
    .agent('review-claude', {
      cli: 'claude',
      preset: 'reviewer',
      role: 'Reviews whether the audit is honest, specific, and useful for follow-on adoption planning.',
      retries: 1,
    })

    .step('prepare-context', {
      type: 'deterministic',
      command: [
        'mkdir -p .workflow-artifacts/wave9-agent-assistant/audit-ricky-agent-assistant-usage',
        'printf "%s\\n" "Issue #9: audit Ricky\'s real agent-assistant usage and gaps" "Summary: Ricky is aligned with agent-assistant but needs an explicit inventory separating real reuse from product-local implementation." "Acceptance: inventory of current reuse, list of locally owned assistant-like seams, honest assessment of integration depth, and recommendations grouped into keep local / adopt shared / extract later." > .workflow-artifacts/wave9-agent-assistant/audit-ricky-agent-assistant-usage/issue-9.md',
        'sed -n "1,260p" packages/cli/src/commands/cli-main.ts > .workflow-artifacts/wave9-agent-assistant/audit-ricky-agent-assistant-usage/cli-main.before.txt',
        'sed -n "1,260p" packages/cli/src/entrypoint/interactive-cli.ts > .workflow-artifacts/wave9-agent-assistant/audit-ricky-agent-assistant-usage/interactive-cli.before.txt',
        'sed -n "1,320p" packages/local/src/entrypoint.ts > .workflow-artifacts/wave9-agent-assistant/audit-ricky-agent-assistant-usage/local-entrypoint.before.txt',
        'sed -n "1,240p" packages/product/src/generation/skill-loader.ts > .workflow-artifacts/wave9-agent-assistant/audit-ricky-agent-assistant-usage/skill-loader.before.txt',
        'sed -n "1,240p" README.md > .workflow-artifacts/wave9-agent-assistant/audit-ricky-agent-assistant-usage/readme.before.txt',
        'echo PREPARE_CONTEXT_OK',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })
    .step('collect-reuse-signals', {
      type: 'deterministic',
      dependsOn: ['prepare-context'],
      command: [
        'OUT=.workflow-artifacts/wave9-agent-assistant/audit-ricky-agent-assistant-usage/reuse-signals.txt',
        'printf "# agent-assistant package references\\n" > "$OUT"',
        'rg -n "agent-assistant|relay-agent-assistant|@agent-relay/sdk|skills/|writing-agent-relay-workflows|relay-80-100-workflow|choosing-swarm-patterns" packages docs README.md workflows >> "$OUT" || true',
        'printf "\\n# assistant-like local seams\\n" >> "$OUT"',
        'rg -n "normalizeRequest|LocalResponse|blocker|stage: \'generate\'|stage: \'execute\'|runInteractiveCli|onboarding|diagnose|guidance|awaitingInput" packages >> "$OUT" || true',
        'printf "\\n# package graph hints\\n" >> "$OUT"',
        'cat package.json >> "$OUT"',
        'echo COLLECT_REUSE_SIGNALS_OK',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })
    .step('write-audit-verdict', {
      agent: 'audit-codex',
      dependsOn: ['collect-reuse-signals'],
      task: `Resolve GitHub issue #9.

Produce an honest audit document at docs/product/ricky-agent-assistant-usage-audit.md.

Required sections:
- Executive summary
- Real agent-assistant reuse today
- Conceptual alignment without direct runtime reuse
- Assistant-like seams Ricky owns locally today
- Divergences from an agent-assistant-native architecture
- Recommendations grouped into: keep local, adopt shared, extract later
- Verdict on current integration depth

Required scope:
- inspect Ricky CLI / interactive / local execution surfaces
- inspect generation-time skill loading and prompting alignment
- inspect whether Ricky reuses shared assistant runtime primitives versus implementing its own product-specific contracts
- be explicit about what is direct reuse, what is parallel invention, and what is future-looking only

Constraints:
- do not overclaim adoption depth
- do not recommend broad migration without tying it to concrete seams
- the document should be strong enough to drive issues #10 through #13 without redoing the audit`,
      verification: { type: 'file_exists', value: 'docs/product/ricky-agent-assistant-usage-audit.md' },
    })
    .step('post-audit-file-gate', {
      type: 'deterministic',
      dependsOn: ['write-audit-verdict'],
      command: [
        '{ git diff --name-only; git ls-files --others --exclude-standard; } | sort -u > .workflow-artifacts/wave9-agent-assistant/audit-ricky-agent-assistant-usage/changed-files.txt',
        'grep -F "docs/product/ricky-agent-assistant-usage-audit.md" .workflow-artifacts/wave9-agent-assistant/audit-ricky-agent-assistant-usage/changed-files.txt',
        'grep -Ei "Executive summary|Real agent-assistant reuse|Conceptual alignment|keep local|adopt shared|extract later|integration depth" docs/product/ricky-agent-assistant-usage-audit.md',
        'grep -Ei "cli|interactive|local execution|skill|runtime|sessions|memory|policy|proactive" docs/product/ricky-agent-assistant-usage-audit.md',
        'echo POST_AUDIT_FILE_GATE_OK',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })
    .step('final-review', {
      agent: 'review-claude',
      dependsOn: ['post-audit-file-gate'],
      task: `Review docs/product/ricky-agent-assistant-usage-audit.md for issue #9.

Confirm:
- the audit clearly distinguishes direct reuse from conceptual alignment and local implementation
- it does not overclaim Ricky as already deeply built on agent-assistant
- it names the strongest assistant-like seams Ricky still owns itself
- its recommendations are actionable enough to guide issues #10 through #13

Write .workflow-artifacts/wave9-agent-assistant/audit-ricky-agent-assistant-usage/final-review.md ending with FINAL_REVIEW_PASS or FINAL_REVIEW_FAIL.`,
      verification: { type: 'file_exists', value: '.workflow-artifacts/wave9-agent-assistant/audit-ricky-agent-assistant-usage/final-review.md' },
    })
    .step('final-review-pass-gate', {
      type: 'deterministic',
      dependsOn: ['final-review'],
      command: 'grep -F "FINAL_REVIEW_PASS" .workflow-artifacts/wave9-agent-assistant/audit-ricky-agent-assistant-usage/final-review.md',
      captureOutput: true,
      failOnError: true,
    })
    .step('signoff', {
      type: 'deterministic',
      dependsOn: ['final-review-pass-gate'],
      command: [
        "cat <<'EOF' > .workflow-artifacts/wave9-agent-assistant/audit-ricky-agent-assistant-usage/signoff.md",
        '# GitHub issue #9 signoff',
        '',
        'Acceptance proof:',
        '- Ricky agent-assistant usage is inventoried explicitly',
        '- product-local assistant-like seams are listed explicitly',
        '- recommendations are grouped into keep local / adopt shared / extract later',
        '- audit is concrete enough to drive follow-on adoption issues',
        '',
        'RICKY_AGENT_ASSISTANT_AUDIT_COMPLETE',
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
