import { workflow } from '@agent-relay/sdk/workflows';

const artifactRoot = '.workflow-artifacts/wave6-proof/close-first-wave-signoff-and-blockers';

async function main() {
  const result = await workflow('ricky-wave6-close-first-wave-signoff-and-blockers')
    .description('Close Ricky first-wave proof debt by deterministically inventorying unsigned product-build workflows and producing an explicit signoff or taxonomy-classified blocker for each one.')
    .pattern('dag')
    .channel('wf-ricky-wave6-signoff-closure')
    .maxConcurrency(4)
    .timeout(3_600_000)
    .onError('retry', { maxRetries: 2, retryDelayMs: 10_000 })

    .agent('closure-lead-claude', {
      cli: 'claude',
      preset: 'worker',
      role: 'Audits unsigned first-wave workflows and writes only Wave 6 closure artifacts: summary, per-workflow signoffs, and per-workflow blockers.',
      retries: 2,
    })
    .agent('reviewer-claude', {
      cli: 'claude',
      preset: 'reviewer',
      role: 'Reviews closure artifacts for truthful evidence, taxonomy use, and absence of ambiguous limbo.',
      retries: 1,
    })
    .agent('reviewer-codex', {
      cli: 'codex',
      preset: 'reviewer',
      role: 'Reviews deterministic inventory, changed-file scope proof, validation commands, and no-limbo closure gates.',
      retries: 1,
    })

    .step('prepare-artifacts', {
      type: 'deterministic',
      command: [
        `mkdir -p ${artifactRoot}/per-workflow`,
        `mkdir -p ${artifactRoot}/reviews`,
        `mkdir -p ${artifactRoot}/final-review`,
        'echo RICKY_WAVE6_SIGNOFF_CLOSURE_READY',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })
    .step('read-next-wave-backlog', {
      type: 'deterministic',
      dependsOn: ['prepare-artifacts'],
      command: 'cat docs/product/ricky-next-wave-backlog-and-proof-plan.md',
      captureOutput: true,
      failOnError: true,
    })
    .step('read-workflow-standards', {
      type: 'deterministic',
      dependsOn: ['prepare-artifacts'],
      command: 'cat docs/workflows/WORKFLOW_STANDARDS.md && printf "\\n\\n---\\n\\n" && cat workflows/shared/WORKFLOW_AUTHORING_RULES.md',
      captureOutput: true,
      failOnError: true,
    })
    .step('read-failure-taxonomy', {
      type: 'deterministic',
      dependsOn: ['prepare-artifacts'],
      command: 'cat docs/architecture/ricky-failure-taxonomy-and-unblockers.md',
      captureOutput: true,
      failOnError: true,
    })
    .step('inventory-first-wave-artifacts', {
      type: 'deterministic',
      dependsOn: ['prepare-artifacts'],
      command: [
        `find workflows/wave0-foundation workflows/wave1-runtime workflows/wave2-product workflows/wave3-cloud-api workflows/wave4-local-byoh workflows/wave5-scale-and-ops -maxdepth 1 -type f -name "*.ts" | sort > ${artifactRoot}/first-wave-workflows.txt`,
        `find .workflow-artifacts -maxdepth 5 -type f | sort > ${artifactRoot}/current-first-wave-artifact-inventory.txt`,
        `find .workflow-artifacts -maxdepth 5 -type f \\( -name "signoff.md" -o -name "signoff.txt" -o -name "blocker.md" -o -name "*blocker*.md" \\) | sort > ${artifactRoot}/current-signoff-and-blocker-artifacts.txt`,
        'echo RICKY_FIRST_WAVE_ARTIFACT_INVENTORY_READY',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })
    .step('derive-unsigned-workflow-inventory', {
      type: 'deterministic',
      dependsOn: ['read-next-wave-backlog', 'read-workflow-standards', 'read-failure-taxonomy', 'inventory-first-wave-artifacts'],
      command: [
        "node --input-type=module <<'NODE'",
        "import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';",
        "import { basename, dirname } from 'node:path';",
        `const artifactRoot = '${artifactRoot}';`,
        "mkdirSync(artifactRoot, { recursive: true });",
        "const workflowPaths = readFileSync(`${artifactRoot}/first-wave-workflows.txt`, 'utf8')",
        "  .split(/\\r?\\n/)",
        "  .map((line) => line.trim())",
        "  .filter(Boolean)",
        "  .filter((path) => !/\\/\\d{2,3}-debug-/.test(path));",
        "const rows = workflowPaths.map((path) => {",
        "  const wave = dirname(path).split('/').pop();",
        "  const file = basename(path);",
        "  const slug = file.replace(/^\\d+-/, '').replace(/\\.ts$/, '');",
        "  const id = `${wave}__${file.replace(/\\.ts$/, '')}`;",
        "  const expectedSignoffPath = `.workflow-artifacts/${wave}/${slug}/signoff.md`;",
        "  const signedOff = existsSync(expectedSignoffPath);",
        "  return { id, wave, file, slug, path, expectedSignoffPath, signedOff };",
        "});",
        "const unsigned = rows.filter((row) => !row.signedOff);",
        "writeFileSync(`${artifactRoot}/first-wave-inventory.json`, JSON.stringify(rows, null, 2) + '\\n');",
        "writeFileSync(`${artifactRoot}/unsigned-workflows.json`, JSON.stringify(unsigned, null, 2) + '\\n');",
        "writeFileSync(`${artifactRoot}/unsigned-workflows.tsv`, unsigned.map((row) => [row.id, row.path, row.wave, row.slug, row.expectedSignoffPath].join('\\t')).join('\\n') + (unsigned.length ? '\\n' : ''));",
        "writeFileSync(`${artifactRoot}/unsigned-workflows.txt`, unsigned.map((row) => row.path).join('\\n') + (unsigned.length ? '\\n' : ''));",
        "const coverageLines = [",
        "  '# Ricky first-wave signoff coverage inventory',",
        "  '',",
        "  `Total product-build workflows inventoried: ${rows.length}`,",
        "  `Signed off by expected per-workflow artifact: ${rows.length - unsigned.length}`,",
        "  `Unsigned workflows requiring Wave 6 closure: ${unsigned.length}`,",
        "  '',",
        "  '| State | Workflow | Expected signoff artifact |',",
        "  '|---|---|---|',",
        "  ...rows.map((row) => `| ${row.signedOff ? 'signed-off' : 'unsigned'} | ${row.path} | ${row.expectedSignoffPath} |`),",
        "];",
        "writeFileSync(`${artifactRoot}/signoff-coverage.md`, coverageLines.join('\\n') + '\\n');",
        "console.log(`RICKY_UNSIGNED_WORKFLOW_COUNT=${unsigned.length}`);",
        "NODE",
      ].join('\n'),
      captureOutput: true,
      failOnError: true,
    })
    .step('unsigned-inventory-gate', {
      type: 'deterministic',
      dependsOn: ['derive-unsigned-workflow-inventory'],
      command: [
        `test -f ${artifactRoot}/first-wave-inventory.json`,
        `test -f ${artifactRoot}/unsigned-workflows.tsv`,
        `test -f ${artifactRoot}/signoff-coverage.md`,
        `grep -q "Unsigned workflows requiring Wave 6 closure" ${artifactRoot}/signoff-coverage.md`,
        `grep -Eq "workflows/wave[0-5]-" ${artifactRoot}/unsigned-workflows.txt`,
        'echo RICKY_UNSIGNED_INVENTORY_GATE_PASS',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('close-unsigned-workflows', {
      agent: 'closure-lead-claude',
      dependsOn: ['unsigned-inventory-gate'],
      task: `Close the Ricky first-wave signoff gap by writing only Wave 6 closure artifacts under ${artifactRoot}.

Inputs already materialized by deterministic steps:
- docs/product/ricky-next-wave-backlog-and-proof-plan.md
- docs/workflows/WORKFLOW_STANDARDS.md
- workflows/shared/WORKFLOW_AUTHORING_RULES.md
- docs/architecture/ricky-failure-taxonomy-and-unblockers.md
- ${artifactRoot}/first-wave-inventory.json
- ${artifactRoot}/signoff-coverage.md
- ${artifactRoot}/unsigned-workflows.tsv
- ${artifactRoot}/current-first-wave-artifact-inventory.txt
- ${artifactRoot}/current-signoff-and-blocker-artifacts.txt

Allowed writes:
- ${artifactRoot}/closure-summary.md
- ${artifactRoot}/per-workflow/<inventory-id>/signoff.md
- ${artifactRoot}/per-workflow/<inventory-id>/blocker.md
- ${artifactRoot}/per-workflow/<inventory-id>/validation-output.txt
- ${artifactRoot}/per-workflow/<inventory-id>/changed-file-scope-proof.txt
- ${artifactRoot}/per-workflow/<inventory-id>/notes.md

Required closure protocol:
1. Read unsigned-workflows.tsv and cover every row exactly once.
2. Do not attempt to close historical workflows inline by editing their workflow files or product code. Validate the current repo state and write only Wave 6 closure artifacts.
3. For each unsigned workflow, inspect its workflow file, related implementation or proof files, and existing artifacts before deciding.
4. Run meaningful validation commands for the workflow's product promise. Compile-only evidence is not sufficient closure. If only compile/typecheck evidence is available, write a blocker instead of signoff.
5. Capture changed-file scope proof for every workflow using the full changed set: git diff --name-only, git ls-files --others --exclude-standard, and an explicit file listing under ${artifactRoot} because .workflow-artifacts is intentionally gitignored. The proof must show that validation did not require product-code edits and that writes stayed inside ${artifactRoot}.
6. If closure is validated, write exactly one per-workflow signoff.md. It must include: workflow path, summary of validated behavior, validation commands, validation result, changed-file scope proof path, and why the evidence is stronger than compile-only.
7. If closure is blocked, write exactly one per-workflow blocker.md. It must include: workflow path, observed symptom, taxonomy classification using agent_runtime.*, environment.*, workflow_structure.*, or validation_strategy.*, whether the work is implemented-but-underproved or genuinely incomplete, unblock action, owner-facing next step, validation commands attempted or a reason validation could not be run, and changed-file scope proof path.
8. Write closure-summary.md covering every unsigned workflow from unsigned-workflows.tsv. The summary must list final state as SIGNED_OFF or BLOCKED only, artifact path, taxonomy classification for blockers, validation commands, changed-file scope proof, and a short reason. Do not leave any TODO, UNKNOWN, pending, ambiguous, skipped, or limbo state.

The summary artifact is the operator handoff. It must be specific enough to run later without rediscovering the closure protocol.`,
      verification: { type: 'file_exists', value: `${artifactRoot}/closure-summary.md` },
    })
    .step('closure-artifact-gate', {
      type: 'deterministic',
      dependsOn: ['close-unsigned-workflows'],
      command: [
        "bash <<'BASH'",
        'set -euo pipefail',
        `root='${artifactRoot}'`,
        'summary="$root/closure-summary.md"',
        'test -f "$summary"',
        'while IFS=$\'\\t\' read -r id path wave slug expected_signoff; do',
        '  test -n "$id" || continue',
        '  dir="$root/per-workflow/$id"',
        '  signoff="$dir/signoff.md"',
        '  blocker="$dir/blocker.md"',
        '  scope_proof="$dir/changed-file-scope-proof.txt"',
        '  if [ -f "$signoff" ] && [ -f "$blocker" ]; then echo "AMBIGUOUS_BOTH_SIGNOFF_AND_BLOCKER:$id"; exit 1; fi',
        '  if [ ! -f "$signoff" ] && [ ! -f "$blocker" ]; then echo "MISSING_CLOSURE_ARTIFACT:$id"; exit 1; fi',
        '  grep -Fq "$path" "$summary"',
        '  grep -Fq "$id" "$summary"',
        '  test -f "$scope_proof"',
        '  grep -qi "changed-file scope proof" "$scope_proof"',
        '  if [ -f "$signoff" ]; then',
        '    grep -qi "Validation commands" "$signoff"',
        '    grep -qi "Changed-file scope proof" "$signoff"',
        '    grep -qi "stronger than compile-only" "$signoff"',
        '    grep -Eqi "npm test|vitest|agent-relay|runtime|e2e|proof|behavior" "$signoff"',
        '  else',
        '    grep -Eq "Taxonomy classification: (agent_runtime|environment|workflow_structure|validation_strategy)\\." "$blocker"',
        '    grep -qi "Observed symptom" "$blocker"',
        '    grep -qi "Unblock action" "$blocker"',
        '    grep -qi "Owner-facing next step" "$blocker"',
        '    grep -qi "Validation commands" "$blocker"',
        '    grep -qi "Changed-file scope proof" "$blocker"',
        '  fi',
        'done < "$root/unsigned-workflows.tsv"',
        'if grep -Eqi "\\b(TODO|UNKNOWN|pending|ambiguous|limbo|skipped)\\b" "$summary"; then echo "AMBIGUOUS_SUMMARY_STATE"; exit 1; fi',
        'echo RICKY_CLOSURE_ARTIFACT_GATE_PASS',
        'BASH',
      ].join('\n'),
      captureOutput: true,
      failOnError: true,
    })

    .step('review-closure-claude', {
      agent: 'reviewer-claude',
      dependsOn: ['closure-artifact-gate'],
      task: `Review the Wave 6 first-wave closure artifacts under ${artifactRoot}.

Write ${artifactRoot}/reviews/review-claude.md only.

Required review checks:
- Every row in unsigned-workflows.tsv appears in closure-summary.md.
- Every unsigned workflow has exactly one per-workflow signoff.md or blocker.md.
- Signoffs include validation commands, changed-file scope proof, and evidence stronger than compile-only.
- Blockers include taxonomy classification, observed symptom, unblock action, owner-facing next step, validation commands, and changed-file scope proof.
- No workflow remains in TODO, UNKNOWN, pending, ambiguous, skipped, or limbo state.
- Scope discipline permits only ${artifactRoot} artifacts during closure.

End the review with these exact lines if and only if all checks pass:
NO_AMBIGUOUS_LIMBO: PASS
CLOSURE_ARTIFACT_CONTRACT: PASS
CHANGED_FILE_SCOPE_PROOF: PASS`,
      verification: { type: 'file_exists', value: `${artifactRoot}/reviews/review-claude.md` },
    })
    .step('review-closure-codex', {
      agent: 'reviewer-codex',
      dependsOn: ['closure-artifact-gate'],
      task: `Review the deterministic inventory and closure gates for ${artifactRoot}.

Write ${artifactRoot}/reviews/review-codex.md only.

Required review checks:
- first-wave-inventory.json and signoff-coverage.md deterministically establish unsigned workflows and current signoff coverage.
- closure-summary.md covers every unsigned first-wave workflow with final state SIGNED_OFF or BLOCKED only.
- Per-workflow signoff artifacts are backed by validation commands beyond compile-only evidence.
- Per-workflow blocker artifacts use Ricky failure taxonomy classification.
- Changed-file scope proof exists per workflow and proves writes stayed scoped to this Wave 6 closure artifact tree.
- No workflow remains in ambiguous limbo.

End the review with these exact lines if and only if all checks pass:
DETERMINISTIC_INVENTORY: PASS
NO_AMBIGUOUS_LIMBO: PASS
CLOSURE_ARTIFACT_CONTRACT: PASS
CHANGED_FILE_SCOPE_PROOF: PASS`,
      verification: { type: 'file_exists', value: `${artifactRoot}/reviews/review-codex.md` },
    })
    .step('reviewer-no-limbo-gate', {
      type: 'deterministic',
      dependsOn: ['review-closure-claude', 'review-closure-codex'],
      command: [
        `grep -q "^NO_AMBIGUOUS_LIMBO: PASS$" ${artifactRoot}/reviews/review-claude.md`,
        `grep -q "^NO_AMBIGUOUS_LIMBO: PASS$" ${artifactRoot}/reviews/review-codex.md`,
        `grep -q "^CLOSURE_ARTIFACT_CONTRACT: PASS$" ${artifactRoot}/reviews/review-claude.md`,
        `grep -q "^CLOSURE_ARTIFACT_CONTRACT: PASS$" ${artifactRoot}/reviews/review-codex.md`,
        `grep -q "^CHANGED_FILE_SCOPE_PROOF: PASS$" ${artifactRoot}/reviews/review-claude.md`,
        `grep -q "^CHANGED_FILE_SCOPE_PROOF: PASS$" ${artifactRoot}/reviews/review-codex.md`,
        'echo RICKY_REVIEWER_NO_LIMBO_GATE_PASS',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('fix-review-findings', {
      agent: 'closure-lead-claude',
      dependsOn: ['reviewer-no-limbo-gate'],
      task: `Read ${artifactRoot}/reviews/review-claude.md and ${artifactRoot}/reviews/review-codex.md.

If reviewers found any issue, fix only the Wave 6 closure artifacts under ${artifactRoot}. Do not edit product code, historical workflow files, or historical per-wave artifacts.

After fixes, write ${artifactRoot}/fixes.md with:
- reviewer findings considered
- exact artifacts changed
- confirmation that closure-summary.md still covers every unsigned workflow
- confirmation that each workflow has exactly one signoff or blocker
- confirmation that no workflow remains in ambiguous limbo`,
      verification: { type: 'file_exists', value: `${artifactRoot}/fixes.md` },
    })
    .step('post-fix-closure-gate', {
      type: 'deterministic',
      dependsOn: ['fix-review-findings'],
      command: [
        "bash <<'BASH'",
        'set -euo pipefail',
        `root='${artifactRoot}'`,
        'summary="$root/closure-summary.md"',
        'test -f "$summary"',
        'while IFS=$\'\\t\' read -r id path wave slug expected_signoff; do',
        '  test -n "$id" || continue',
        '  dir="$root/per-workflow/$id"',
        '  signoff="$dir/signoff.md"',
        '  blocker="$dir/blocker.md"',
        '  if [ -f "$signoff" ] && [ -f "$blocker" ]; then echo "AMBIGUOUS_AFTER_FIX:$id"; exit 1; fi',
        '  if [ ! -f "$signoff" ] && [ ! -f "$blocker" ]; then echo "MISSING_AFTER_FIX:$id"; exit 1; fi',
        '  grep -Fq "$path" "$summary"',
        'done < "$root/unsigned-workflows.tsv"',
        'if grep -Eqi "\\b(TODO|UNKNOWN|pending|ambiguous|limbo|skipped)\\b" "$summary"; then echo "AMBIGUOUS_SUMMARY_AFTER_FIX"; exit 1; fi',
        'echo RICKY_POST_FIX_CLOSURE_GATE_PASS',
        'BASH',
      ].join('\n'),
      captureOutput: true,
      failOnError: true,
    })

    .step('final-review-claude', {
      agent: 'reviewer-claude',
      dependsOn: ['post-fix-closure-gate'],
      task: `Perform final review of ${artifactRoot}/closure-summary.md and per-workflow closure artifacts.

Write ${artifactRoot}/final-review/final-review-claude.md only.

This is a final-review gate. Confirm:
- no unsigned workflow remains without exactly one closure artifact
- no workflow remains in ambiguous limbo
- blockers carry taxonomy classification and owner-facing unblock action
- signoffs carry validation commands and changed-file scope proof
- compile-only evidence was not accepted as closure
- edits are scoped to the new Wave 6 workflow and ${artifactRoot} artifacts

End with exactly:
FINAL_NO_AMBIGUOUS_LIMBO: PASS
FINAL_SCOPE_DISCIPLINE: PASS
FINAL_SIGNOFF_BLOCKER_TRUTH: PASS`,
      verification: { type: 'file_exists', value: `${artifactRoot}/final-review/final-review-claude.md` },
    })
    .step('final-review-codex', {
      agent: 'reviewer-codex',
      dependsOn: ['post-fix-closure-gate'],
      task: `Perform final deterministic review of Wave 6 closure evidence under ${artifactRoot}.

Write ${artifactRoot}/final-review/final-review-codex.md only.

This is a final-review gate. Confirm:
- unsigned-workflows.tsv, signoff-coverage.md, and closure-summary.md agree
- every unsigned workflow has SIGNED_OFF or BLOCKED final state only
- no ambiguous limbo state exists
- validation commands and changed-file scope proof are present in each per-workflow artifact
- blocker classification uses the Ricky taxonomy namespaces
- scope proof limits changes to workflows/wave6-proof/01-close-first-wave-signoff-and-blockers.ts and ${artifactRoot}

End with exactly:
FINAL_NO_AMBIGUOUS_LIMBO: PASS
FINAL_SCOPE_DISCIPLINE: PASS
FINAL_SIGNOFF_BLOCKER_TRUTH: PASS`,
      verification: { type: 'file_exists', value: `${artifactRoot}/final-review/final-review-codex.md` },
    })
    .step('final-review-no-limbo-gate', {
      type: 'deterministic',
      dependsOn: ['final-review-claude', 'final-review-codex'],
      command: [
        `grep -q "^FINAL_NO_AMBIGUOUS_LIMBO: PASS$" ${artifactRoot}/final-review/final-review-claude.md`,
        `grep -q "^FINAL_NO_AMBIGUOUS_LIMBO: PASS$" ${artifactRoot}/final-review/final-review-codex.md`,
        `grep -q "^FINAL_SCOPE_DISCIPLINE: PASS$" ${artifactRoot}/final-review/final-review-claude.md`,
        `grep -q "^FINAL_SCOPE_DISCIPLINE: PASS$" ${artifactRoot}/final-review/final-review-codex.md`,
        `grep -q "^FINAL_SIGNOFF_BLOCKER_TRUTH: PASS$" ${artifactRoot}/final-review/final-review-claude.md`,
        `grep -q "^FINAL_SIGNOFF_BLOCKER_TRUTH: PASS$" ${artifactRoot}/final-review/final-review-codex.md`,
        'echo RICKY_FINAL_REVIEW_NO_LIMBO_GATE_PASS',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })
    .step('workflow-validation-commands', {
      type: 'deterministic',
      dependsOn: ['final-review-no-limbo-gate'],
      command: [
        `npm run typecheck > ${artifactRoot}/workflow-typecheck.txt 2>&1`,
        `npm test > ${artifactRoot}/workflow-test.txt 2>&1`,
        'echo RICKY_WAVE6_WORKFLOW_VALIDATION_COMMANDS_PASS',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })
    .step('changed-file-scope-gate', {
      type: 'deterministic',
      dependsOn: ['workflow-validation-commands'],
      command: [
        "bash <<'BASH'",
        'set -euo pipefail',
        `root='${artifactRoot}'`,
        'target="workflows/wave6-proof/01-close-first-wave-signoff-and-blockers.ts"',
        'git diff --name-only > "$root/tracked-changes.txt"',
        'git ls-files --others --exclude-standard > "$root/untracked-changes.txt"',
        'find "$root" -type f | sort > "$root/artifact-files.txt"',
        'cat "$root/tracked-changes.txt" "$root/untracked-changes.txt" "$root/artifact-files.txt" | sed "/^$/d" > "$root/changed-files.txt"',
        'if grep -Ev "^($target|\\.workflow-artifacts/wave6-proof/close-first-wave-signoff-and-blockers/)" "$root/changed-files.txt"; then',
        '  echo "OUT_OF_SCOPE_CHANGED_FILE";',
        '  exit 1;',
        'fi',
        'grep -Eq "^($target|\\.workflow-artifacts/wave6-proof/close-first-wave-signoff-and-blockers/)" "$root/changed-files.txt"',
        'echo RICKY_CHANGED_FILE_SCOPE_GATE_PASS',
        'BASH',
      ].join('\n'),
      captureOutput: true,
      failOnError: true,
    })
    .step('final-signoff', {
      type: 'deterministic',
      dependsOn: ['changed-file-scope-gate'],
      command: [
        `cat > ${artifactRoot}/signoff.md <<'EOF'`,
        '# Ricky Wave 6 first-wave signoff and blocker closure workflow signoff',
        '',
        'Validation commands:',
        '- npm run typecheck',
        '- npm test',
        '',
        'Closure artifacts:',
        '- Summary artifact: .workflow-artifacts/wave6-proof/close-first-wave-signoff-and-blockers/closure-summary.md',
        '- Per-workflow signoff artifacts: .workflow-artifacts/wave6-proof/close-first-wave-signoff-and-blockers/per-workflow/<inventory-id>/signoff.md',
        '- Per-workflow blocker artifacts: .workflow-artifacts/wave6-proof/close-first-wave-signoff-and-blockers/per-workflow/<inventory-id>/blocker.md',
        '- Changed-file scope proof: .workflow-artifacts/wave6-proof/close-first-wave-signoff-and-blockers/changed-files.txt',
        '',
        'Final contract:',
        '- Every unsigned first-wave product-build workflow is closed as SIGNED_OFF or BLOCKED.',
        '- Blockers include Ricky taxonomy classification and owner-facing unblock action.',
        '- Signoffs include validation commands and changed-file scope proof.',
        '- Compile-only evidence is not accepted as closure.',
        '- Reviewer and final-review gates verified no workflow remains in ambiguous limbo.',
        '- Regression scope is limited to this Wave 6 workflow and its own artifacts.',
        '',
        'RICKY_WAVE6_SIGNOFF_BLOCKER_CLOSURE_WORKFLOW_COMPLETE',
        'EOF',
      ].join('\n'),
      captureOutput: true,
      failOnError: true,
    })

    .run({ cwd: process.cwd() });

  console.log(result.status);
  if (result.status !== 'completed') {
    throw new Error(`Workflow finished with status ${result.status}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
