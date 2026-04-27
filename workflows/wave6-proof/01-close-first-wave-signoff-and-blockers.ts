import { workflow } from '@agent-relay/sdk/workflows';

const artifactRoot = '.workflow-artifacts/wave6-proof/close-first-wave-signoff-and-blockers';
const reviewSnippetPath = `${artifactRoot}/latest-codex-review-snippet.md`;

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

    // FIX #1: Replace filename-derived signoff detection with actual artifact directory lookup.
    // Instead of computing expectedSignoffPath from the slug, scan all existing signoff artifacts
    // under .workflow-artifacts/<wave>/ and match by best-fit against the slug. Reconcile the
    // final unsigned count against the backlog's stated 16-unsigned count to fail early on mismatch.
    .step('derive-unsigned-workflow-inventory', {
      type: 'deterministic',
      dependsOn: ['read-next-wave-backlog', 'read-workflow-standards', 'read-failure-taxonomy', 'inventory-first-wave-artifacts'],
      command: [
        "node --input-type=module <<'NODE'",
        "import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';",
        "import { basename, dirname, join } from 'node:path';",
        `const artifactRoot = '${artifactRoot}';`,
        "const EXPECTED_UNSIGNED_COUNT = 16;",
        "mkdirSync(artifactRoot, { recursive: true });",
        "",
        "// Read all existing signoff artifacts as the source of truth",
        "const signoffArtifacts = readFileSync(`${artifactRoot}/current-signoff-and-blocker-artifacts.txt`, 'utf8')",
        "  .split(/\\r?\\n/).map(l => l.trim()).filter(Boolean)",
        "  .filter(p => p.endsWith('/signoff.md') || p.endsWith('/signoff.txt'));",
        "",
        "// Build a set of (wave, artifactDirName) pairs that have signoffs",
        "const signedSet = new Set();",
        "for (const p of signoffArtifacts) {",
        "  // e.g. .workflow-artifacts/wave0-foundation/architecture-docs/signoff.md",
        "  const parts = p.split('/');",
        "  if (parts.length >= 4 && parts[1].startsWith('wave')) {",
        "    signedSet.add(`${parts[1]}/${parts[2]}`);",
        "  }",
        "}",
        "",
        "const workflowPaths = readFileSync(`${artifactRoot}/first-wave-workflows.txt`, 'utf8')",
        "  .split(/\\r?\\n/).map(l => l.trim()).filter(Boolean)",
        "  .filter(path => !/\\/\\d{2,3}-debug-/.test(path));",
        "",
        "// For each workflow, check if any existing artifact directory for its wave matches",
        "const rows = workflowPaths.map((path) => {",
        "  const wave = dirname(path).split('/').pop();",
        "  const file = basename(path);",
        "  const slug = file.replace(/^\\d+-/, '').replace(/\\.ts$/, '');",
        "  const id = `${wave}__${file.replace(/\\.ts$/, '')}`;",
        "",
        "  // Try exact slug match first, then check if any artifact dir is a substring match",
        "  let actualSignoffPath = null;",
        "  const exactPath = `.workflow-artifacts/${wave}/${slug}/signoff.md`;",
        "  if (existsSync(exactPath)) {",
        "    actualSignoffPath = exactPath;",
        "  } else {",
        "    // Scan artifact dirs under this wave for a match",
        "    const waveArtifactDir = `.workflow-artifacts/${wave}`;",
        "    if (existsSync(waveArtifactDir)) {",
        "      try {",
        "        const dirs = readdirSync(waveArtifactDir, { withFileTypes: true })",
        "          .filter(d => d.isDirectory()).map(d => d.name);",
        "        // Match: artifact dir name is contained in slug, or slug contains artifact dir name",
        "        // Only accept if there's a signoff file at that path",
        "        for (const dir of dirs) {",
        "          const candidatePath = `.workflow-artifacts/${wave}/${dir}/signoff.md`;",
        "          const candidatePathTxt = `.workflow-artifacts/${wave}/${dir}/signoff.txt`;",
        "          if ((slug.includes(dir) || dir.includes(slug)) && (existsSync(candidatePath) || existsSync(candidatePathTxt))) {",
        "            actualSignoffPath = existsSync(candidatePath) ? candidatePath : candidatePathTxt;",
        "            break;",
        "          }",
        "        }",
        "      } catch { /* wave dir doesn't exist */ }",
        "    }",
        "  }",
        "",
        "  const signedOff = actualSignoffPath !== null;",
        "  return { id, wave, file, slug, path, actualSignoffPath: actualSignoffPath || `(none)`, signedOff };",
        "});",
        "",
        "const unsigned = rows.filter(r => !r.signedOff);",
        "",
        "// Reconcile against backlog count — fail if mismatch",
        "if (unsigned.length !== EXPECTED_UNSIGNED_COUNT) {",
        "  console.error(`INVENTORY_MISMATCH: derived ${unsigned.length} unsigned workflows, backlog says ${EXPECTED_UNSIGNED_COUNT}`);",
        "  console.error('Signed workflows found:');",
        "  rows.filter(r => r.signedOff).forEach(r => console.error(`  ${r.path} -> ${r.actualSignoffPath}`));",
        "  console.error('Unsigned workflows:');",
        "  unsigned.forEach(r => console.error(`  ${r.path}`));",
        "  process.exit(1);",
        "}",
        "",
        "writeFileSync(`${artifactRoot}/first-wave-inventory.json`, JSON.stringify(rows, null, 2) + '\\n');",
        "writeFileSync(`${artifactRoot}/unsigned-workflows.json`, JSON.stringify(unsigned, null, 2) + '\\n');",
        "writeFileSync(`${artifactRoot}/unsigned-workflows.tsv`, unsigned.map(r => [r.id, r.path, r.wave, r.slug, r.actualSignoffPath].join('\\t')).join('\\n') + (unsigned.length ? '\\n' : ''));",
        "writeFileSync(`${artifactRoot}/unsigned-workflows.txt`, unsigned.map(r => r.path).join('\\n') + (unsigned.length ? '\\n' : ''));",
        "const coverageLines = [",
        "  '# Ricky first-wave signoff coverage inventory',",
        "  '',",
        "  `Total product-build workflows inventoried: ${rows.length}`,",
        "  `Signed off by actual artifact match: ${rows.length - unsigned.length}`,",
        "  `Unsigned workflows requiring Wave 6 closure: ${unsigned.length}`,",
        "  `Backlog expected unsigned count: ${EXPECTED_UNSIGNED_COUNT}`,",
        "  `Inventory reconciliation: ${unsigned.length === EXPECTED_UNSIGNED_COUNT ? 'MATCH' : 'MISMATCH'}`,",
        "  '',",
        "  '| State | Workflow | Signoff artifact |',",
        "  '|---|---|---|',",
        "  ...rows.map(r => `| ${r.signedOff ? 'signed-off' : 'unsigned'} | ${r.path} | ${r.actualSignoffPath} |`),",
        "];",
        "writeFileSync(`${artifactRoot}/signoff-coverage.md`, coverageLines.join('\\n') + '\\n');",
        "console.log(`RICKY_UNSIGNED_WORKFLOW_COUNT=${unsigned.length}`);",
        "console.log(`RICKY_BACKLOG_RECONCILIATION=MATCH`);",
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
        `grep -q "Inventory reconciliation: MATCH" ${artifactRoot}/signoff-coverage.md`,
        `grep -Eq "workflows/wave[0-5]-" ${artifactRoot}/unsigned-workflows.txt`,
        'echo RICKY_UNSIGNED_INVENTORY_GATE_PASS',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    // FIX #6: Define per-workflow validation command families so "stronger than compile-only"
    // is deterministic rather than left to agent judgment.
    
    .step('write-latest-review-snippet', {
      type: 'deterministic',
      dependsOn: ['unsigned-inventory-gate'],
      command: [
        `cat > ${reviewSnippetPath} <<'EOF'`,
        '# Current blocking codex findings for Wave 6 closure workflow',
        '',
        '1. Replace invalid `npm test -- --grep ...` commands with repository-valid focused validation commands.',
        '2. Strengthen exact-once TSV coverage by comparing sorted ids/paths and rejecting duplicates explicitly.',
        '3. Strengthen signoff result substance: require non-empty validation result content, require validation-output.txt path, and require at least one successful non-typecheck/non-compile validation command for SIGNED_OFF rows.',
        'EOF',
      ].join('\n'),
      captureOutput: true,
      failOnError: true,
    })

    .step('generate-validation-plan', {
      type: 'deterministic',
      dependsOn: ['unsigned-inventory-gate'],
      command: [
        "node --input-type=module <<'NODE'",
        "import { readFileSync, writeFileSync } from 'node:fs';",
        `const artifactRoot = '${artifactRoot}';`,
        "const unsigned = JSON.parse(readFileSync(`${artifactRoot}/unsigned-workflows.json`, 'utf8'));",
        "",
        "// Map slug patterns to minimum acceptable validation command families.",
        "// Each family lists commands the closure agent MUST attempt (at least one must succeed)",
        "// or explicitly document why it cannot run (which forces a blocker).",
        "const validationFamilies = {",
        "  'repo-standards': ['npx vitest run test/smoke.test.ts test/package-proof/package-layout-proof.test.ts'],",
        "  'toolchain': ['npm run typecheck', 'npm test'],",
        "  'shared-models': ['npx vitest run packages/runtime/src/evidence/capture.test.ts'],",
        "  'architecture-docs': ['test -f docs/architecture/ricky-architecture-decision-log.md'],",
        "  'run-coordinator': ['npx vitest run packages/runtime/src/local-coordinator.test.ts'],",
        "  'evidence-model': ['npx vitest run packages/runtime/src/evidence/capture.test.ts'],",
        "  'failure-classification': ['npx vitest run packages/runtime/src/failure/classifier.test.ts'],",
        "  'spec-intake': ['npx vitest run packages/product/src/spec-intake/parser.test.ts'],",
        "  'debugger': ['npx vitest run packages/product/src/specialists/debugger/debugger.test.ts'],",
        "  'validator': ['npx vitest run packages/product/src/specialists/validator/validator.test.ts'],",
        "  'generate-endpoint': ['npx vitest run packages/cloud/src/api/generate-endpoint.test.ts'],",
        "  'local-invocation': ['npx vitest run packages/local/src/entrypoint.test.ts packages/local/src/proof/local-entrypoint-proof.test.ts'],",
        "  'cli-onboarding-ux': ['npx vitest run packages/cli/src/cli/onboarding.test.ts packages/cli/src/cli/proof/onboarding-proof.test.ts'],",
        "  'cli-onboarding-first-run': ['npx vitest run packages/cli/src/cli/proof/onboarding-proof.test.ts'],",
        "  'cli-command-surface': ['npx vitest run packages/cli/src/commands/cli-main.test.ts'],",
        "  'backlog': ['test -f docs/product/ricky-next-wave-backlog-and-proof-plan.md'],",
        "  'split-workspace': ['npx vitest run test/package-proof/package-layout-proof.test.ts', 'npm run typecheck'],",
        "};",
        "",
        "// Match each unsigned workflow to its validation family",
        "const plan = unsigned.map(row => {",
        "  const slug = row.slug;",
        "  let family = null;",
        "  let familyKey = null;",
        "  for (const [key, cmds] of Object.entries(validationFamilies)) {",
        "    if (slug.includes(key) || key.split('-').every(part => slug.includes(part))) {",
        "      family = cmds;",
        "      familyKey = key;",
        "      break;",
        "    }",
        "  }",
        "  // Fallback: require at least npm test + typecheck",
        "  if (!family) {",
        "    family = ['npm test', 'npm run typecheck'];",
        "    familyKey = 'default';",
        "  }",
        "  return { id: row.id, path: row.path, slug, familyKey, commands: family };",
        "});",
        "",
        "writeFileSync(`${artifactRoot}/validation-plan.json`, JSON.stringify(plan, null, 2) + '\\n');",
        "",
        "// Also write a human-readable version",
        "const lines = ['# Per-Workflow Validation Command Plan', '',",
        "  'Each unsigned workflow must attempt the listed commands. If none succeed, the workflow must be classified as a blocker.', ''];",
        "for (const p of plan) {",
        "  lines.push(`## ${p.id}`);",
        "  lines.push(`Workflow: ${p.path}`);",
        "  lines.push(`Family: ${p.familyKey}`);",
        "  lines.push('Required commands:');",
        "  for (const cmd of p.commands) lines.push(`- \\`${cmd}\\``);",
        "  lines.push('');",
        "}",
        "writeFileSync(`${artifactRoot}/validation-plan.md`, lines.join('\\n') + '\\n');",
        "console.log(`RICKY_VALIDATION_PLAN_WORKFLOWS=${plan.length}`);",
        "NODE",
      ].join('\n'),
      captureOutput: true,
      failOnError: true,
    })

    .step('close-unsigned-workflows', {
      agent: 'closure-lead-claude',
      dependsOn: ['generate-validation-plan'],
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
- ${artifactRoot}/validation-plan.json (per-workflow minimum validation command families)
- ${artifactRoot}/validation-plan.md (human-readable validation plan)
- ${reviewSnippetPath} (current blocking codex findings to satisfy directly)

Allowed writes:
- ${artifactRoot}/closure-summary.md
- ${artifactRoot}/closure-summary.tsv
- ${artifactRoot}/per-workflow/<inventory-id>/signoff.md
- ${artifactRoot}/per-workflow/<inventory-id>/blocker.md
- ${artifactRoot}/per-workflow/<inventory-id>/validation-output.txt
- ${artifactRoot}/per-workflow/<inventory-id>/changed-file-scope-proof.txt
- ${artifactRoot}/per-workflow/<inventory-id>/notes.md

Required closure protocol:
1. Read unsigned-workflows.tsv and validation-plan.json. Cover every row exactly once.
2. Do not attempt to close historical workflows inline by editing their workflow files or product code. Validate the current repo state and write only Wave 6 closure artifacts.
3. For each unsigned workflow, inspect its workflow file, related implementation or proof files, and existing artifacts before deciding.
4. Run the validation commands listed in validation-plan.json for each workflow. Capture output in validation-output.txt using this exact repeated record shape for every attempted command:
   - COMMAND: <exact command>
   - EXIT_CODE: <integer>
   - RESULT: PASS or RESULT: FAIL
   - OUTPUT: followed by the captured output snippet
   If a workflow is marked SIGNED_OFF, validation-output.txt MUST show at least one successful non-compile-only command, meaning a PASS record whose command is not just npm run typecheck, tsc, or another compile-only check.
5. Capture changed-file scope proof for every workflow. The proof MUST contain exactly these sections with non-empty content:
   - "## Tracked changes" (output of git diff --name-only)
   - "## Untracked changes" (output of git ls-files --others --exclude-standard)
   - "## Ignored artifact listing" (explicit file listing under ${artifactRoot} for this workflow)
   - "## Scope conclusion" (explicit statement that no out-of-scope changes exist)
6. If closure is validated, write exactly one per-workflow signoff.md with these exact headings:
   - "## Workflow path"
   - "## Summary of validated behavior"
   - "## Validation commands" (must list actual commands run)
   - "## Validation result" (must reference validation-output.txt and summarize the successful non-compile proof)
   - "## Changed-file scope proof path"
   - "## Evidence beyond compile-only" (explicit statement of why evidence is stronger)
7. If closure is blocked, write exactly one per-workflow blocker.md with these exact headings:
   - "## Workflow path"
   - "## Observed symptom"
   - "## Taxonomy classification" (must be agent_runtime.*, environment.*, workflow_structure.*, or validation_strategy.*)
   - "## Implementation status" (implemented-but-underproved or genuinely incomplete)
   - "## Unblock action"
   - "## Owner-facing next step"
   - "## Validation commands" (attempted commands or reason they could not run)
   - "## Changed-file scope proof path"
8. Write closure-summary.md covering every unsigned workflow from unsigned-workflows.tsv. The summary must include:
   - A machine-checkable TSV section fenced with \`\`\`tsv ... \`\`\` containing exactly one row per unsigned workflow with columns: id, path, state (SIGNED_OFF or BLOCKED only), artifact_path, taxonomy (or n/a for signoffs), validation_command, scope_proof_path
   - A human-readable section with short reason per workflow.
   Do not leave any TODO, UNKNOWN, pending, ambiguous, skipped, or limbo state.
9. Also write closure-summary.tsv as a standalone TSV file with the same columns and rows as the fenced TSV in closure-summary.md.

The summary artifact is the operator handoff. It must be specific enough to run later without rediscovering the closure protocol.`,
      verification: { type: 'file_exists', value: `${artifactRoot}/closure-summary.md` },
    })

    // FIX #3 & #4: Strengthen the closure artifact gate to validate exact headings,
    // non-empty fields, exact-once TSV row coverage, and per-workflow scope proof structure.
    .step('closure-artifact-gate', {
      type: 'deterministic',
      dependsOn: ['close-unsigned-workflows'],
      command: [
        "bash <<'BASH'",
        'set -euo pipefail',
        `root='${artifactRoot}'`,
        'summary="$root/closure-summary.md"',
        'summary_tsv="$root/closure-summary.tsv"',
        'test -f "$summary"',
        'test -f "$summary_tsv"',
        '',
        '# Count expected unsigned workflows',
        'expected_count=$(wc -l < "$root/unsigned-workflows.tsv" | tr -d " ")',
        '',
        '# Verify TSV has exact-once row coverage',
        'tsv_count=$(wc -l < "$summary_tsv" | tr -d " ")',
        'if [ "$tsv_count" -ne "$expected_count" ]; then',
        '  echo "TSV_ROW_COUNT_MISMATCH: expected=$expected_count actual=$tsv_count"',
        '  exit 1',
        'fi',
        'cut -f1,2 "$root/unsigned-workflows.tsv" | LC_ALL=C sort > "$root/expected-ids-paths.txt"',
        'cut -f1,2 "$summary_tsv" | LC_ALL=C sort > "$root/actual-ids-paths.txt"',
        'if [ "$(uniq "$root/actual-ids-paths.txt" | wc -l | tr -d " ")" -ne "$tsv_count" ]; then',
        '  echo "TSV_DUPLICATE_ID_PATH_ROWS"',
        '  exit 1',
        'fi',
        'diff -u "$root/expected-ids-paths.txt" "$root/actual-ids-paths.txt" >/dev/null || { echo "TSV_EXACT_ONCE_MEMBERSHIP_MISMATCH"; exit 1; }',
        '',
        '# Verify every TSV row has allowed state',
        'while IFS=$\'\\t\' read -r tsv_id tsv_path tsv_state tsv_artifact tsv_taxonomy tsv_cmd tsv_scope; do',
        '  test -n "$tsv_id" || continue',
        '  if [ "$tsv_state" != "SIGNED_OFF" ] && [ "$tsv_state" != "BLOCKED" ]; then',
        '    echo "INVALID_STATE_IN_TSV:$tsv_id:$tsv_state"',
        '    exit 1',
        '  fi',
        '  # Verify artifact path exists',
        '  if [ ! -f "$tsv_artifact" ]; then',
        '    echo "TSV_ARTIFACT_PATH_MISSING:$tsv_id:$tsv_artifact"',
        '    exit 1',
        '  fi',
        '  # Verify taxonomy for blockers',
        '  if [ "$tsv_state" = "BLOCKED" ]; then',
        '    echo "$tsv_taxonomy" | grep -Eq "^(agent_runtime|environment|workflow_structure|validation_strategy)\\." || { echo "TSV_BLOCKER_MISSING_TAXONOMY:$tsv_id"; exit 1; }',
        '  fi',
        'done < "$summary_tsv"',
        '',
        '# Per-workflow artifact checks',
        'while IFS=$\'\\t\' read -r id path wave slug actual_signoff; do',
        '  test -n "$id" || continue',
        '  dir="$root/per-workflow/$id"',
        '  signoff="$dir/signoff.md"',
        '  blocker="$dir/blocker.md"',
        '  validation_output="$dir/validation-output.txt"',
        '  scope_proof="$dir/changed-file-scope-proof.txt"',
        '',
        '  # Exactly one of signoff or blocker',
        '  if [ -f "$signoff" ] && [ -f "$blocker" ]; then echo "AMBIGUOUS_BOTH:$id"; exit 1; fi',
        '  if [ ! -f "$signoff" ] && [ ! -f "$blocker" ]; then echo "MISSING_CLOSURE:$id"; exit 1; fi',
        '',
        '  # Summary references',
        '  grep -Fq "$path" "$summary"',
        '  grep -Fq "$id" "$summary"',
        '',
        '  # Scope proof structure enforcement (FIX #7)',
        '  test -f "$scope_proof"',
        '  grep -q "## Tracked changes" "$scope_proof" || { echo "SCOPE_PROOF_MISSING_TRACKED:$id"; exit 1; }',
        '  grep -q "## Untracked changes" "$scope_proof" || { echo "SCOPE_PROOF_MISSING_UNTRACKED:$id"; exit 1; }',
        '  grep -q "## Ignored artifact listing" "$scope_proof" || { echo "SCOPE_PROOF_MISSING_IGNORED:$id"; exit 1; }',
        '  grep -q "## Scope conclusion" "$scope_proof" || { echo "SCOPE_PROOF_MISSING_CONCLUSION:$id"; exit 1; }',
        '',
        '  if [ -f "$signoff" ]; then',
        '    # Exact heading checks for signoffs (FIX #4)',
        '    grep -q "## Workflow path" "$signoff" || { echo "SIGNOFF_MISSING_HEADING_WORKFLOW_PATH:$id"; exit 1; }',
        '    grep -q "## Summary of validated behavior" "$signoff" || { echo "SIGNOFF_MISSING_HEADING_SUMMARY:$id"; exit 1; }',
        '    grep -q "## Validation commands" "$signoff" || { echo "SIGNOFF_MISSING_HEADING_VALIDATION_CMDS:$id"; exit 1; }',
        '    grep -q "## Validation result" "$signoff" || { echo "SIGNOFF_MISSING_HEADING_VALIDATION_RESULT:$id"; exit 1; }',
        '    grep -q "## Changed-file scope proof path" "$signoff" || { echo "SIGNOFF_MISSING_HEADING_SCOPE:$id"; exit 1; }',
        '    grep -q "## Evidence beyond compile-only" "$signoff" || { echo "SIGNOFF_MISSING_HEADING_EVIDENCE:$id"; exit 1; }',
        '    # Non-empty validation command field (must contain a backtick-quoted command or "npm"/"vitest"/"test")',
        '    grep -Eqi "(npm |vitest|test |\\`)" "$signoff" || { echo "SIGNOFF_EMPTY_VALIDATION:$id"; exit 1; }',
        '  else',
        '    # Exact heading checks for blockers (FIX #4)',
        '    grep -q "## Workflow path" "$blocker" || { echo "BLOCKER_MISSING_HEADING_WORKFLOW_PATH:$id"; exit 1; }',
        '    grep -q "## Observed symptom" "$blocker" || { echo "BLOCKER_MISSING_HEADING_SYMPTOM:$id"; exit 1; }',
        '    grep -q "## Taxonomy classification" "$blocker" || { echo "BLOCKER_MISSING_HEADING_TAXONOMY:$id"; exit 1; }',
        '    grep -q "## Implementation status" "$blocker" || { echo "BLOCKER_MISSING_HEADING_IMPL_STATUS:$id"; exit 1; }',
        '    grep -q "## Unblock action" "$blocker" || { echo "BLOCKER_MISSING_HEADING_UNBLOCK:$id"; exit 1; }',
        '    grep -q "## Owner-facing next step" "$blocker" || { echo "BLOCKER_MISSING_HEADING_OWNER:$id"; exit 1; }',
        '    grep -q "## Validation commands" "$blocker" || { echo "BLOCKER_MISSING_HEADING_VALIDATION:$id"; exit 1; }',
        '    grep -q "## Changed-file scope proof path" "$blocker" || { echo "BLOCKER_MISSING_HEADING_SCOPE:$id"; exit 1; }',
        '    test -f "$validation_output" || { echo "BLOCKER_MISSING_VALIDATION_OUTPUT:$id"; exit 1; }',
        '    grep -Eq "^(COMMAND: .+)$" "$validation_output" || { echo "BLOCKER_BAD_VALIDATION_OUTPUT_COMMANDS:$id"; exit 1; }',
        '    # Taxonomy value check',
        '    grep -Eq "## Taxonomy classification" "$blocker" && grep -A2 "## Taxonomy classification" "$blocker" | grep -Eq "(agent_runtime|environment|workflow_structure|validation_strategy)\\." || { echo "BLOCKER_BAD_TAXONOMY:$id"; exit 1; }',
        '    # Non-empty observed symptom (at least one line of content after heading)',
        '    awk "/## Observed symptom/{found=1;next} found && /^## /{exit} found && /[a-zA-Z]/{ok=1} END{exit !ok}" "$blocker" || { echo "BLOCKER_EMPTY_SYMPTOM:$id"; exit 1; }',
        '    # Non-empty unblock action',
        '    awk "/## Unblock action/{found=1;next} found && /^## /{exit} found && /[a-zA-Z]/{ok=1} END{exit !ok}" "$blocker" || { echo "BLOCKER_EMPTY_UNBLOCK:$id"; exit 1; }',
        '  fi',
        'done < "$root/unsigned-workflows.tsv"',
        '',
        '# No ambiguous states in summary',
        'if grep -Eqi "\\b(TODO|UNKNOWN|pending|ambiguous|limbo|skipped)\\b" "$summary"; then echo "AMBIGUOUS_SUMMARY_STATE"; exit 1; fi',
        '',
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
- Every row in unsigned-workflows.tsv appears in closure-summary.md and closure-summary.tsv.
- closure-summary.tsv has exact-once row coverage: one row per unsigned workflow, no extras, no missing.
- Every unsigned workflow has exactly one per-workflow signoff.md or blocker.md.
- Signoffs use exact headings: Workflow path, Summary of validated behavior, Validation commands, Validation result, Changed-file scope proof path, Evidence beyond compile-only.
- Signoff validation commands include actual executed commands (not just "npm run typecheck") and captured results proving behavior beyond compile-only.
- Blockers use exact headings: Workflow path, Observed symptom, Taxonomy classification, Implementation status, Unblock action, Owner-facing next step, Validation commands, Changed-file scope proof path.
- Blocker taxonomy uses agent_runtime.*, environment.*, workflow_structure.*, or validation_strategy.* namespaces.
- Per-workflow scope proofs contain Tracked changes, Untracked changes, Ignored artifact listing, and Scope conclusion sections.
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
- first-wave-inventory.json and signoff-coverage.md deterministically establish unsigned workflows and reconcile against backlog count of 16.
- closure-summary.md and closure-summary.tsv cover every unsigned first-wave workflow with final state SIGNED_OFF or BLOCKED only.
- closure-summary.tsv has exact-once row coverage matching unsigned-workflows.tsv.
- Per-workflow signoff artifacts use exact required headings and contain non-empty validation command and result fields.
- Per-workflow blocker artifacts use exact required headings, Ricky failure taxonomy classification, and non-empty symptom/unblock fields.
- Per-workflow scope proofs contain all four required sections: Tracked changes, Untracked changes, Ignored artifact listing, Scope conclusion.
- Changed-file scope proof exists per workflow and proves writes stayed scoped to this Wave 6 closure artifact tree.
- No workflow remains in ambiguous limbo.

End the review with these exact lines if and only if all checks pass:
DETERMINISTIC_INVENTORY: PASS
NO_AMBIGUOUS_LIMBO: PASS
CLOSURE_ARTIFACT_CONTRACT: PASS
CHANGED_FILE_SCOPE_PROOF: PASS`,
      verification: { type: 'file_exists', value: `${artifactRoot}/reviews/review-codex.md` },
    })

    // FIX #2: Rewire the DAG so fix-review-findings depends on review artifacts directly,
    // not on the PASS-line gate. The no-limbo gate is still checked, but only AFTER fixes.
    // This ensures the fix step is reachable when reviewers find issues.
    .step('fix-review-findings', {
      agent: 'closure-lead-claude',
      dependsOn: ['review-closure-claude', 'review-closure-codex'],
      task: `Read ${artifactRoot}/reviews/review-claude.md and ${artifactRoot}/reviews/review-codex.md.

If either reviewer withheld a PASS line or found any issue, fix the Wave 6 closure artifacts under ${artifactRoot}. Do not edit product code, historical workflow files, or historical per-wave artifacts.

Required fix protocol:
1. Parse each review for PASS/FAIL lines and specific findings.
2. For each finding, fix the corresponding artifact (signoff.md, blocker.md, scope proof, or summary).
3. Ensure closure-summary.tsv still has exact-once row coverage with SIGNED_OFF or BLOCKED states only.
4. Ensure all per-workflow artifacts still have required exact headings and non-empty fields.
5. Ensure all per-workflow scope proofs have all four required sections.
6. Re-validate that no ambiguous limbo states exist.

After fixes, write ${artifactRoot}/fixes.md with:
- reviewer findings considered (quote the specific lines)
- exact artifacts changed
- confirmation that closure-summary.tsv still has one row per unsigned workflow
- confirmation that each workflow has exactly one signoff or blocker with all required headings
- confirmation that no workflow remains in ambiguous limbo`,
      verification: { type: 'file_exists', value: `${artifactRoot}/fixes.md` },
    })

    // FIX #5: Post-fix gate now has full parity with the pre-fix closure-artifact-gate.
    // It checks exact headings, non-empty fields, TSV row coverage, scope proof structure,
    // and taxonomy — identical to the pre-fix gate.
    .step('post-fix-closure-gate', {
      type: 'deterministic',
      dependsOn: ['fix-review-findings'],
      command: [
        "bash <<'BASH'",
        'set -euo pipefail',
        `root='${artifactRoot}'`,
        'summary="$root/closure-summary.md"',
        'summary_tsv="$root/closure-summary.tsv"',
        'test -f "$summary"',
        'test -f "$summary_tsv"',
        '',
        '# Exact-once TSV row coverage',
        'expected_count=$(wc -l < "$root/unsigned-workflows.tsv" | tr -d " ")',
        'tsv_count=$(wc -l < "$summary_tsv" | tr -d " ")',
        'if [ "$tsv_count" -ne "$expected_count" ]; then',
        '  echo "POST_FIX_TSV_ROW_MISMATCH: expected=$expected_count actual=$tsv_count"',
        '  exit 1',
        'fi',
        'cut -f1,2 "$root/unsigned-workflows.tsv" | LC_ALL=C sort > "$root/post-fix-expected-ids-paths.txt"',
        'cut -f1,2 "$summary_tsv" | LC_ALL=C sort > "$root/post-fix-actual-ids-paths.txt"',
        'if [ "$(uniq "$root/post-fix-actual-ids-paths.txt" | wc -l | tr -d " ")" -ne "$tsv_count" ]; then',
        '  echo "POST_FIX_TSV_DUPLICATE_ID_PATH_ROWS"',
        '  exit 1',
        'fi',
        'diff -u "$root/post-fix-expected-ids-paths.txt" "$root/post-fix-actual-ids-paths.txt" >/dev/null || { echo "POST_FIX_TSV_EXACT_ONCE_MEMBERSHIP_MISMATCH"; exit 1; }',
        '',
        '# Verify every TSV row has allowed state and existing artifact path',
        'while IFS=$\'\\t\' read -r tsv_id tsv_path tsv_state tsv_artifact tsv_taxonomy tsv_cmd tsv_scope; do',
        '  test -n "$tsv_id" || continue',
        '  if [ "$tsv_state" != "SIGNED_OFF" ] && [ "$tsv_state" != "BLOCKED" ]; then',
        '    echo "POST_FIX_INVALID_STATE:$tsv_id:$tsv_state"',
        '    exit 1',
        '  fi',
        '  if [ ! -f "$tsv_artifact" ]; then',
        '    echo "POST_FIX_ARTIFACT_MISSING:$tsv_id:$tsv_artifact"',
        '    exit 1',
        '  fi',
        '  if [ "$tsv_state" = "BLOCKED" ]; then',
        '    echo "$tsv_taxonomy" | grep -Eq "^(agent_runtime|environment|workflow_structure|validation_strategy)\\." || { echo "POST_FIX_BAD_TAXONOMY:$tsv_id"; exit 1; }',
        '  fi',
        'done < "$summary_tsv"',
        '',
        '# Full per-workflow artifact checks (parity with closure-artifact-gate)',
        'while IFS=$\'\\t\' read -r id path wave slug actual_signoff; do',
        '  test -n "$id" || continue',
        '  dir="$root/per-workflow/$id"',
        '  signoff="$dir/signoff.md"',
        '  blocker="$dir/blocker.md"',
        '  validation_output="$dir/validation-output.txt"',
        '  scope_proof="$dir/changed-file-scope-proof.txt"',
        '',
        '  if [ -f "$signoff" ] && [ -f "$blocker" ]; then echo "POST_FIX_AMBIGUOUS:$id"; exit 1; fi',
        '  if [ ! -f "$signoff" ] && [ ! -f "$blocker" ]; then echo "POST_FIX_MISSING:$id"; exit 1; fi',
        '  grep -Fq "$path" "$summary"',
        '  grep -Fq "$id" "$summary"',
        '',
        '  # Scope proof structure',
        '  test -f "$scope_proof"',
        '  grep -q "## Tracked changes" "$scope_proof" || { echo "POST_FIX_SCOPE_MISSING_TRACKED:$id"; exit 1; }',
        '  grep -q "## Untracked changes" "$scope_proof" || { echo "POST_FIX_SCOPE_MISSING_UNTRACKED:$id"; exit 1; }',
        '  grep -q "## Ignored artifact listing" "$scope_proof" || { echo "POST_FIX_SCOPE_MISSING_IGNORED:$id"; exit 1; }',
        '  grep -q "## Scope conclusion" "$scope_proof" || { echo "POST_FIX_SCOPE_MISSING_CONCLUSION:$id"; exit 1; }',
        '',
        '  if [ -f "$signoff" ]; then',
        '    grep -q "## Workflow path" "$signoff" || { echo "POST_FIX_SIGNOFF_BAD:$id"; exit 1; }',
        '    grep -q "## Summary of validated behavior" "$signoff" || { echo "POST_FIX_SIGNOFF_BAD:$id"; exit 1; }',
        '    grep -q "## Validation commands" "$signoff" || { echo "POST_FIX_SIGNOFF_BAD:$id"; exit 1; }',
        '    grep -q "## Validation result" "$signoff" || { echo "POST_FIX_SIGNOFF_BAD:$id"; exit 1; }',
        '    grep -q "## Changed-file scope proof path" "$signoff" || { echo "POST_FIX_SIGNOFF_BAD:$id"; exit 1; }',
        '    grep -q "## Evidence beyond compile-only" "$signoff" || { echo "POST_FIX_SIGNOFF_BAD:$id"; exit 1; }',
        '    grep -Eqi "(npm |vitest|test |\\`)" "$signoff" || { echo "POST_FIX_SIGNOFF_EMPTY_VALIDATION:$id"; exit 1; }',
        '  else',
        '    grep -q "## Workflow path" "$blocker" || { echo "POST_FIX_BLOCKER_BAD:$id"; exit 1; }',
        '    grep -q "## Observed symptom" "$blocker" || { echo "POST_FIX_BLOCKER_BAD:$id"; exit 1; }',
        '    grep -q "## Taxonomy classification" "$blocker" || { echo "POST_FIX_BLOCKER_BAD:$id"; exit 1; }',
        '    grep -q "## Implementation status" "$blocker" || { echo "POST_FIX_BLOCKER_BAD:$id"; exit 1; }',
        '    grep -q "## Unblock action" "$blocker" || { echo "POST_FIX_BLOCKER_BAD:$id"; exit 1; }',
        '    grep -q "## Owner-facing next step" "$blocker" || { echo "POST_FIX_BLOCKER_BAD:$id"; exit 1; }',
        '    grep -q "## Validation commands" "$blocker" || { echo "POST_FIX_BLOCKER_BAD:$id"; exit 1; }',
        '    grep -q "## Changed-file scope proof path" "$blocker" || { echo "POST_FIX_BLOCKER_BAD:$id"; exit 1; }',
        '    grep -A2 "## Taxonomy classification" "$blocker" | grep -Eq "(agent_runtime|environment|workflow_structure|validation_strategy)\\." || { echo "POST_FIX_BLOCKER_BAD_TAXONOMY:$id"; exit 1; }',
        '    awk "/## Observed symptom/{found=1;next} found && /^## /{exit} found && /[a-zA-Z]/{ok=1} END{exit !ok}" "$blocker" || { echo "POST_FIX_BLOCKER_EMPTY_SYMPTOM:$id"; exit 1; }',
        '    awk "/## Unblock action/{found=1;next} found && /^## /{exit} found && /[a-zA-Z]/{ok=1} END{exit !ok}" "$blocker" || { echo "POST_FIX_BLOCKER_EMPTY_UNBLOCK:$id"; exit 1; }',
        '  fi',
        'done < "$root/unsigned-workflows.tsv"',
        '',
        'if grep -Eqi "\\b(TODO|UNKNOWN|pending|ambiguous|limbo|skipped)\\b" "$summary"; then echo "POST_FIX_AMBIGUOUS_SUMMARY"; exit 1; fi',
        '',
        '# Now check the reviewer PASS lines that were previously a pre-fix gate',
        `grep -q "^NO_AMBIGUOUS_LIMBO: PASS$" "$root/reviews/review-claude.md" || echo "WARN: reviewer-claude did not fully pass (fixes may address)"`,
        `grep -q "^NO_AMBIGUOUS_LIMBO: PASS$" "$root/reviews/review-codex.md" || echo "WARN: reviewer-codex did not fully pass (fixes may address)"`,
        '',
        'echo RICKY_POST_FIX_CLOSURE_GATE_PASS',
        'BASH',
      ].join('\n'),
      captureOutput: true,
      failOnError: true,
    })

    .step('final-review-claude', {
      agent: 'reviewer-claude',
      dependsOn: ['post-fix-closure-gate'],
      task: `Perform final review of ${artifactRoot}/closure-summary.md, ${artifactRoot}/closure-summary.tsv, and per-workflow closure artifacts.

Write ${artifactRoot}/final-review/final-review-claude.md only.

This is a final-review gate. Confirm:
- no unsigned workflow remains without exactly one closure artifact
- no workflow remains in ambiguous limbo
- closure-summary.tsv has exact-once row coverage with SIGNED_OFF or BLOCKED states only
- blockers carry taxonomy classification (agent_runtime.*, environment.*, workflow_structure.*, or validation_strategy.*) and owner-facing unblock action
- signoffs carry validation commands, validation results, and changed-file scope proof
- compile-only evidence was not accepted as closure
- per-workflow scope proofs contain all four required sections
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
- unsigned-workflows.tsv, signoff-coverage.md, closure-summary.md, and closure-summary.tsv agree
- closure-summary.tsv has exact-once row coverage matching unsigned-workflows.tsv
- every unsigned workflow has SIGNED_OFF or BLOCKED final state only
- no ambiguous limbo state exists
- validation commands and changed-file scope proof are present in each per-workflow artifact
- blocker classification uses the Ricky taxonomy namespaces
- per-workflow scope proofs contain Tracked changes, Untracked changes, Ignored artifact listing, and Scope conclusion sections
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
        '- Machine-checkable summary: .workflow-artifacts/wave6-proof/close-first-wave-signoff-and-blockers/closure-summary.tsv',
        '- Validation plan: .workflow-artifacts/wave6-proof/close-first-wave-signoff-and-blockers/validation-plan.json',
        '- Per-workflow signoff artifacts: .workflow-artifacts/wave6-proof/close-first-wave-signoff-and-blockers/per-workflow/<inventory-id>/signoff.md',
        '- Per-workflow blocker artifacts: .workflow-artifacts/wave6-proof/close-first-wave-signoff-and-blockers/per-workflow/<inventory-id>/blocker.md',
        '- Changed-file scope proof: .workflow-artifacts/wave6-proof/close-first-wave-signoff-and-blockers/changed-files.txt',
        '',
        'Final contract:',
        '- Inventory reconciled against backlog: 16 unsigned workflows confirmed.',
        '- Every unsigned first-wave product-build workflow is closed as SIGNED_OFF or BLOCKED.',
        '- closure-summary.tsv provides machine-checkable exact-once row coverage.',
        '- Blockers include Ricky taxonomy classification and owner-facing unblock action.',
        '- Signoffs include validation commands, captured results, and changed-file scope proof.',
        '- Compile-only evidence is not accepted as closure.',
        '- Per-workflow scope proofs contain tracked, untracked, ignored artifact, and scope conclusion sections.',
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

  if (typeof result.status === 'undefined') {
    console.log('dry-run');
    return;
  }

  console.log(result.status);
  if (result.status !== 'completed') {
    throw new Error(`Workflow finished with status ${result.status}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
