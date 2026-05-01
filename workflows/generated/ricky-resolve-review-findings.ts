import { workflow } from '@agent-relay/sdk/workflows';

async function main() {
  const artifactRoot = '.workflow-artifacts/review-findings-hardening';

  const result = await workflow('ricky-resolve-review-findings')
    .description('Resolve six Ricky CLI review findings with implementation lanes, self-review, peer-review, reflection, and 80-to-100 validation.')
    .pattern('dag')
    .channel('wf-ricky-review-findings-hardening')
    .maxConcurrency(5)
    .timeout(7_200_000)
    .onError('retry', { maxRetries: 2, retryDelayMs: 10_000 })

    .agent('lead', {
      cli: 'claude',
      preset: 'worker',
      role: 'Workflow lead who owns product interpretation, lane coordination, reflection, and final integration quality.',
      retries: 2,
    })
    .agent('cloud-power-impl', {
      cli: 'codex',
      preset: 'worker',
      role: 'Implements Cloud power-user spec command auth/workspace derivation and tests.',
      retries: 2,
    })
    .agent('cloud-guided-impl', {
      cli: 'codex',
      preset: 'worker',
      role: 'Implements guided Cloud readiness ordering and optional integration readiness tests.',
      retries: 2,
    })
    .agent('runtime-impl', {
      cli: 'codex',
      preset: 'worker',
      role: 'Implements true background monitor behavior and removes hidden repo mutation in SDK precheck.',
      retries: 2,
    })
    .agent('defaults-impl', {
      cli: 'codex',
      preset: 'worker',
      role: 'Aligns auto-fix and refine defaults with product specs or explicitly updates specs/tests when product direction changed.',
      retries: 2,
    })
    .agent('reviewer-claude', {
      cli: 'claude',
      preset: 'reviewer',
      role: 'Primary reviewer for behavioral correctness, product fit, and missing test coverage.',
      retries: 1,
    })
    .agent('reviewer-codex', {
      cli: 'codex',
      preset: 'reviewer',
      role: 'Secondary reviewer focused on regressions, test gaps, and implementation risks.',
      retries: 1,
    })
    .agent('fixer', {
      cli: 'codex',
      preset: 'worker',
      role: 'Applies bounded fixes from validation and review feedback without broad refactors.',
      retries: 2,
    })

    .step('preflight', {
      type: 'deterministic',
      command: [
        'set -e',
        `mkdir -p ${artifactRoot}`,
        'echo "branch: $(git rev-parse --abbrev-ref HEAD)"',
        'if ! git diff --cached --quiet; then echo "ERROR: staging area is dirty"; git diff --cached --stat; exit 1; fi',
        'test -f package.json',
        'test -f src/surfaces/cli/commands/cli-main.ts',
        'test -f src/surfaces/cli/entrypoint/interactive-cli.ts',
        'test -f src/surfaces/cli/flows/local-run-monitor.ts',
        'test -f src/local/entrypoint.ts',
        'test -f src/surfaces/cli/flows/power-user-parser.ts',
        'echo PREFLIGHT_OK',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('capture-context', {
      type: 'deterministic',
      dependsOn: ['preflight'],
      command: [
        'set -e',
        `cat > ${artifactRoot}/review-findings.md <<'EOF'`,
        '# Review findings to resolve',
        '',
        '1. P1: Public `ricky cloud --spec ...` exits before `executeCloudPath` can derive auth/workspace from stored Cloud credentials.',
        '2. P1: `buildGuidedCloudRequest` captures workflow spec before `runCloudWorkflowFlow` performs agent and optional-integration readiness checks.',
        '3. P1: Background monitor awaits workflow execution instead of returning a reattachable run immediately.',
        '4. P1: SDK availability precheck creates a symlink under the target repo node_modules, mutating the user workspace.',
        '5. P2: Auto-fix defaults on even though the reviewed auto-fix spec says it should be opt-in.',
        '6. P2: Refine defaults on even though generation-quality spec says refinement should require `--refine`.',
        'EOF',
        `sed -n '1360,1445p' src/surfaces/cli/commands/cli-main.ts > ${artifactRoot}/cli-main-cloud-slice.txt`,
        `sed -n '1000,1085p' src/surfaces/cli/entrypoint/interactive-cli.ts > ${artifactRoot}/interactive-cloud-slice.txt`,
        `sed -n '1,130p' src/surfaces/cli/flows/local-run-monitor.ts > ${artifactRoot}/local-run-monitor-slice.txt`,
        `sed -n '520,620p' src/local/entrypoint.ts > ${artifactRoot}/local-entrypoint-precheck-slice.txt`,
        `sed -n '160,235p' src/surfaces/cli/flows/power-user-parser.ts > ${artifactRoot}/power-user-parser-slice.txt`,
        `test -f specs/cli-auto-fix-and-resume.md && sed -n '1,150p' specs/cli-auto-fix-and-resume.md > ${artifactRoot}/auto-fix-spec-slice.txt || true`,
        `rg -n "refine|generation-quality|workforce persona|Cloud readiness|cloud --spec|startLocalRunMonitor|ensure.*sdk|symlink|autoFix" docs specs src test > ${artifactRoot}/related-search.txt || true`,
        'echo CONTEXT_CAPTURED',
      ].join('\n'),
      captureOutput: true,
      failOnError: true,
    })

    .step('lead-plan-and-policy-reflection', {
      agent: 'lead',
      dependsOn: ['capture-context'],
      task: `Read ${artifactRoot}/review-findings.md and the captured code/spec slices.

Produce ${artifactRoot}/lead-plan.md with:
- an acceptance contract for each of the six findings
- exact files/tests likely touched by each lane
- a policy decision for finding 5: either make auto-fix opt-in to satisfy the reviewed spec, or update the spec and tests if the current product decision explicitly requires default-on
- a policy decision for finding 6: refine must stay opt-in unless a newer spec says otherwise
- the deterministic commands every lane must run after edits
- risks and sequencing notes

End the file with LEAD_PLAN_COMPLETE.`,
      verification: { type: 'file_exists', value: `${artifactRoot}/lead-plan.md` },
    })
    .step('lead-plan-gate', {
      type: 'deterministic',
      dependsOn: ['lead-plan-and-policy-reflection'],
      command: [
        'set -e',
        `tail -n 1 ${artifactRoot}/lead-plan.md | tr -d '[:space:]*' | grep -Eq '^LEAD_PLAN_COMPLETE$'`,
        `grep -Eiq 'cloud --spec|auth|workspace' ${artifactRoot}/lead-plan.md`,
        `grep -Eiq 'readiness|optional integration|before spec' ${artifactRoot}/lead-plan.md`,
        `grep -Eiq 'background|reattach|synchronous' ${artifactRoot}/lead-plan.md`,
        `grep -Eiq 'node_modules|symlink|mutat' ${artifactRoot}/lead-plan.md`,
        `grep -Eiq 'auto-fix|autoFix' ${artifactRoot}/lead-plan.md`,
        `grep -Eiq 'refine' ${artifactRoot}/lead-plan.md`,
        'echo LEAD_PLAN_GATE_OK',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('fix-cloud-power-user-path', {
      agent: 'cloud-power-impl',
      dependsOn: ['lead-plan-gate'],
      task: `Resolve finding 1.

Owned files:
- src/surfaces/cli/commands/cli-main.ts
- Cloud auth/status helpers it already imports or owns
- tests that cover power-user Cloud command behavior

Requirements:
- Public commands like \`ricky cloud --spec "..." --run\` and \`ricky cloud --spec-file ./spec.md --no-run\` must derive Cloud auth and workspace from stored credentials/API helpers when no test injects cloudRequest.
- If the user is not authenticated, the command must fail with useful guidance to connect Cloud; it must not silently run local fallback.
- Do not require users to know a workspace id when credentials can reconcile it.
- Keep injected cloudRequest support for tests.
- Add or update tests proving no injected cloudRequest is needed for the public path.

Run relevant tests locally. Write ${artifactRoot}/cloud-power-self-review.md with the change summary, tests run, and SELF_REVIEW_CLOUD_POWER_PASS or SELF_REVIEW_CLOUD_POWER_FAIL.`,
      verification: { type: 'file_exists', value: `${artifactRoot}/cloud-power-self-review.md` },
    })
    .step('fix-cloud-guided-readiness-order', {
      agent: 'cloud-guided-impl',
      dependsOn: ['lead-plan-gate'],
      task: `Resolve finding 2.

Owned files:
- src/surfaces/cli/entrypoint/interactive-cli.ts
- src/surfaces/cli/flows/cloud-workflow-flow.ts
- tests for guided Cloud flow ordering/readiness

Requirements:
- Guided Cloud flow must perform account, agent, and optional integration readiness/recovery before asking the user for workflow spec details.
- Optional integrations must remain Nango/Cloud-dashboard oriented, never Daytona.
- Tests must prove spec intake prompts are not reached until readiness checks/recovery have completed.
- Preserve existing Cloud/local mode UX improvements.

Run relevant tests locally. Write ${artifactRoot}/cloud-guided-self-review.md with the change summary, tests run, and SELF_REVIEW_CLOUD_GUIDED_PASS or SELF_REVIEW_CLOUD_GUIDED_FAIL.`,
      verification: { type: 'file_exists', value: `${artifactRoot}/cloud-guided-self-review.md` },
    })
    .step('fix-background-and-sdk-mutation', {
      agent: 'runtime-impl',
      dependsOn: ['lead-plan-gate'],
      task: `Resolve findings 3 and 4.

Owned files:
- src/surfaces/cli/flows/local-run-monitor.ts
- src/local/entrypoint.ts
- shared state/runtime helpers and focused tests

Requirements for finding 3:
- The background branch must return promptly with a stable Ricky run id, status command, log/evidence/fixes paths, and persisted queued/running state.
- Workflow execution should continue outside the foreground CLI await path, with status refresh reading persisted state.
- Foreground behavior should remain synchronous.

Requirements for finding 4:
- SDK availability precheck must not create symlinks or mutate the target repo's node_modules.
- If SDK is unavailable, use the installed Ricky package dependency, bundled runtime path, or clear blocker guidance without dirtying the user's workspace.
- Add tests proving no repo-local node_modules write/symlink occurs during precheck.

Run relevant tests locally. Write ${artifactRoot}/runtime-self-review.md with the change summary, tests run, and SELF_REVIEW_RUNTIME_PASS or SELF_REVIEW_RUNTIME_FAIL.`,
      verification: { type: 'file_exists', value: `${artifactRoot}/runtime-self-review.md` },
    })
    .step('fix-default-policy-alignment', {
      agent: 'defaults-impl',
      dependsOn: ['lead-plan-gate'],
      task: `Resolve findings 5 and 6 according to ${artifactRoot}/lead-plan.md.

Owned files:
- src/surfaces/cli/flows/power-user-parser.ts
- src/surfaces/cli/commands/cli-main.ts
- src/surfaces/cli/flows/local-run-monitor.ts if background defaults must change
- specs/docs that define auto-fix and refinement behavior
- parser/CLI tests

Requirements:
- Refine must be opt-in unless a newer product spec explicitly says otherwise. If omitted, generation should stay fast/deterministic.
- Auto-fix policy must be made internally consistent across parser, guided flows, docs/specs, and tests. If the reviewed spec remains authoritative, omitted \`--auto-fix\` must be single-attempt and \`--auto-fix\` must opt in. If the product decision is default-on, update the spec and tests so this is no longer contradictory.
- Add tests for omitted flag, explicit opt-in, explicit disable, and generated handoff metadata.

Run relevant tests locally. Write ${artifactRoot}/defaults-self-review.md with the change summary, product policy decision, tests run, and SELF_REVIEW_DEFAULTS_PASS or SELF_REVIEW_DEFAULTS_FAIL.`,
      verification: { type: 'file_exists', value: `${artifactRoot}/defaults-self-review.md` },
    })

    .step('self-review-pass-gate', {
      type: 'deterministic',
      dependsOn: [
        'fix-cloud-power-user-path',
        'fix-cloud-guided-readiness-order',
        'fix-background-and-sdk-mutation',
        'fix-default-policy-alignment',
      ],
      command: [
        'set -e',
        `grep -F SELF_REVIEW_CLOUD_POWER_PASS ${artifactRoot}/cloud-power-self-review.md`,
        `grep -F SELF_REVIEW_CLOUD_GUIDED_PASS ${artifactRoot}/cloud-guided-self-review.md`,
        `grep -F SELF_REVIEW_RUNTIME_PASS ${artifactRoot}/runtime-self-review.md`,
        `grep -F SELF_REVIEW_DEFAULTS_PASS ${artifactRoot}/defaults-self-review.md`,
        'echo SELF_REVIEW_PASS_GATE_OK',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('post-implementation-reflection', {
      agent: 'lead',
      dependsOn: ['self-review-pass-gate'],
      task: `Read all self-review files and inspect the current diff.

Write ${artifactRoot}/reflection.md with:
- what changed across the four lanes
- whether the lanes conflict with each other
- whether every P1 has a real E2E or integration test, not just unit coverage
- whether the auto-fix/refine policy is now internally consistent
- any remaining risks that reviewers must focus on

End with REFLECTION_COMPLETE.`,
      verification: { type: 'file_exists', value: `${artifactRoot}/reflection.md` },
    })
    .step('targeted-soft-validation', {
      type: 'deterministic',
      dependsOn: ['post-implementation-reflection'],
      command: [
        'set +e',
        'npm run typecheck',
        'TYPECHECK=$?',
        'npm test -- --run src/surfaces/cli/commands/cli-main.test.ts src/surfaces/cli/entrypoint/interactive-cli.test.ts src/surfaces/cli/flows/cloud-workflow-flow.test.ts src/surfaces/cli/flows/local-run-monitor.test.ts src/local/entrypoint.test.ts test/simplified-workflow-cli.e2e.test.ts',
        'TESTS=$?',
        `printf "typecheck=%s\\ntargeted_tests=%s\\n" "$TYPECHECK" "$TESTS" > ${artifactRoot}/targeted-soft-validation.txt`,
        'exit 0',
      ].join('\n'),
      captureOutput: true,
      failOnError: false,
    })
    .step('fix-targeted-validation', {
      agent: 'fixer',
      dependsOn: ['targeted-soft-validation'],
      task: `Inspect ${artifactRoot}/targeted-soft-validation.txt and the targeted validation output.

If anything failed:
- read the failing tests and source
- apply the smallest fix
- rerun the exact targeted commands until they pass

If everything passed, do no unrelated edits.

Write ${artifactRoot}/targeted-fix.md ending with TARGETED_FIX_COMPLETE.`,
      verification: { type: 'file_exists', value: `${artifactRoot}/targeted-fix.md` },
    })
    .step('targeted-hard-validation', {
      type: 'deterministic',
      dependsOn: ['fix-targeted-validation'],
      command: [
        'set -e',
        'npm run typecheck',
        'npm test -- --run src/surfaces/cli/commands/cli-main.test.ts src/surfaces/cli/entrypoint/interactive-cli.test.ts src/surfaces/cli/flows/cloud-workflow-flow.test.ts src/surfaces/cli/flows/local-run-monitor.test.ts src/local/entrypoint.test.ts test/simplified-workflow-cli.e2e.test.ts',
        'echo TARGETED_HARD_VALIDATION_OK',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('peer-review-claude', {
      agent: 'reviewer-claude',
      dependsOn: ['targeted-hard-validation'],
      task: `Perform a code-review stance review of the current diff against all six findings.

Focus:
- public Cloud spec commands work without injected test-only context
- guided Cloud readiness happens before spec intake
- background run returns promptly and remains reattachable
- SDK precheck does not mutate the user repo
- auto-fix and refine defaults match the accepted spec/policy
- tests prove the real user paths

Write ${artifactRoot}/review-claude.md. Findings first if any. End with REVIEW_CLAUDE_PASS or REVIEW_CLAUDE_FAIL.`,
      verification: { type: 'file_exists', value: `${artifactRoot}/review-claude.md` },
    })
    .step('peer-review-codex', {
      agent: 'reviewer-codex',
      dependsOn: ['targeted-hard-validation'],
      task: `Independently review the current diff against the six findings and the 80-to-100 validation standard.

Focus on regressions, missing edge cases, hidden state writes, async process lifecycle risks, and insufficient CLI-level tests.

Write ${artifactRoot}/review-codex.md. Findings first if any. End with REVIEW_CODEX_PASS or REVIEW_CODEX_FAIL.`,
      verification: { type: 'file_exists', value: `${artifactRoot}/review-codex.md` },
    })
    .step('peer-review-pass-gate', {
      type: 'deterministic',
      dependsOn: ['peer-review-claude', 'peer-review-codex'],
      command: [
        'set -e',
        `tail -n 5 ${artifactRoot}/review-claude.md | grep -F REVIEW_CLAUDE_PASS`,
        `tail -n 5 ${artifactRoot}/review-codex.md | grep -F REVIEW_CODEX_PASS`,
        'echo PEER_REVIEW_PASS_GATE_OK',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })
    .step('review-fix-loop', {
      agent: 'fixer',
      dependsOn: ['peer-review-pass-gate'],
      task: `Read both peer reviews and the current diff.

If either review included concrete risks despite a pass marker, apply bounded fixes and rerun targeted validation.
If there are no concrete issues, do no unrelated edits.

Write ${artifactRoot}/review-fix-loop.md ending with REVIEW_FIX_LOOP_COMPLETE.`,
      verification: { type: 'file_exists', value: `${artifactRoot}/review-fix-loop.md` },
    })
    .step('full-regression-soft', {
      type: 'deterministic',
      dependsOn: ['review-fix-loop'],
      command: [
        'set +e',
        'npm run typecheck',
        'TYPECHECK=$?',
        'npm test',
        'FULL_TEST=$?',
        `printf "typecheck=%s\\nfull_test=%s\\n" "$TYPECHECK" "$FULL_TEST" > ${artifactRoot}/full-regression-soft.txt`,
        'exit 0',
      ].join('\n'),
      captureOutput: true,
      failOnError: false,
    })
    .step('fix-full-regression', {
      agent: 'fixer',
      dependsOn: ['full-regression-soft'],
      task: `Inspect ${artifactRoot}/full-regression-soft.txt and the full regression output.

If failures occurred:
- fix only regressions caused by this workflow
- rerun npm run typecheck and npm test until green
- if a timing-only proof flakes, rerun the isolated file once and document the evidence

If everything passed, do no unrelated edits.

Write ${artifactRoot}/full-regression-fix.md ending with FULL_REGRESSION_FIX_COMPLETE.`,
      verification: { type: 'file_exists', value: `${artifactRoot}/full-regression-fix.md` },
    })
    .step('final-hard-validation', {
      type: 'deterministic',
      dependsOn: ['fix-full-regression'],
      command: [
        'set -e',
        'npm run typecheck',
        'npm test',
        'git diff --check',
        'echo FINAL_HARD_VALIDATION_OK',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })
    .step('final-scope-and-product-gate', {
      type: 'deterministic',
      dependsOn: ['final-hard-validation'],
      command: [
        'set -e',
        `git diff --name-only > ${artifactRoot}/final-changed-files.txt`,
        `test -s ${artifactRoot}/final-changed-files.txt`,
        `grep -Eq 'src/surfaces/cli/commands/cli-main\\.ts|src/surfaces/cli/entrypoint/interactive-cli\\.ts|src/surfaces/cli/flows/cloud-workflow-flow\\.ts|src/surfaces/cli/flows/local-run-monitor\\.ts|src/local/entrypoint\\.ts|src/surfaces/cli/flows/power-user-parser\\.ts|test/|\\.test\\.ts|specs/|docs/' ${artifactRoot}/final-changed-files.txt`,
        `grep -Eiq 'Cloud|workspace|auth|readiness|background|node_modules|auto-fix|refine' ${artifactRoot}/reflection.md`,
        'echo FINAL_SCOPE_AND_PRODUCT_GATE_OK',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })
    .step('final-signoff', {
      agent: 'lead',
      dependsOn: ['final-scope-and-product-gate'],
      task: `Write ${artifactRoot}/signoff.md.

Include:
- a finding-by-finding resolution table
- exact files changed
- exact validation commands and outcomes
- reviewer verdicts from Claude and Codex
- the policy decision for auto-fix/refine defaults
- residual risks, if any

End with REVIEW_FINDINGS_HARDENING_COMPLETE.`,
      verification: { type: 'file_exists', value: `${artifactRoot}/signoff.md` },
    })
    .step('signoff-gate', {
      type: 'deterministic',
      dependsOn: ['final-signoff'],
      command: [
        'set -e',
        `tail -n 3 ${artifactRoot}/signoff.md | grep -F REVIEW_FINDINGS_HARDENING_COMPLETE`,
        'echo REVIEW_FINDINGS_WORKFLOW_COMPLETE',
      ].join(' && '),
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
