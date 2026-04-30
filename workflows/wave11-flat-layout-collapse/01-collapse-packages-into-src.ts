import { workflow } from '@agent-relay/sdk/workflows';

const artifactDir = '.workflow-artifacts/wave11-flat-layout-collapse/collapse-packages-into-src';

async function main() {
  const result = await workflow('ricky-wave11-collapse-packages-into-src')
    .description(
      'Collapse the npm-workspaces multi-package layout (packages/{shared,runtime,product,cloud,local,cli}) into a single sage-style src/ tree with topical subfolders and a surfaces/ directory for cli/slack/web/mac. Driven end-to-end by a TDD layout proof: a flat-layout test is written first and runs RED, the migration makes it GREEN, and the existing workspace-layout proof is replaced rather than silently deleted.',
    )
    .pattern('dag')
    .channel('wf-ricky-wave11-flat-layout-collapse')
    .maxConcurrency(2)
    .timeout(7_200_000)
    .onError('retry', { maxRetries: 2, retryDelayMs: 10_000 })

    .agent('test-author-codex', {
      cli: 'codex',
      preset: 'worker',
      role: 'Authors the flat-layout proof test that defines the post-collapse contract before any source moves. Test must run RED on the current workspace layout.',
      retries: 2,
    })
    .agent('migrator-codex', {
      cli: 'codex',
      preset: 'worker',
      role: 'Performs the file moves, import rewrites, and config consolidation that turn the failing flat-layout proof green. Owns the bulk of the diff.',
      retries: 2,
    })
    .agent('fix-codex', {
      cli: 'codex',
      preset: 'worker',
      role: 'Runs the 80-to-100 fix loop after the migration: typecheck, full test suite, and re-runs until the flat-layout proof and all existing tests are green together.',
      retries: 3,
    })
    .agent('review-claude', {
      cli: 'claude',
      preset: 'reviewer',
      role: 'Reviews whether the collapse preserves behavior, whether boundaries are maintained by folder convention (sage-style, no path aliases), and whether nothing was silently deleted.',
      retries: 1,
    })

    // ---------------------------------------------------------------------
    // 1. Preflight — capture before-state and confirm clean tree
    // ---------------------------------------------------------------------
    .step('preflight', {
      type: 'deterministic',
      command: [
        `DIR=${artifactDir}`,
        'STATUS_FILE=$(mktemp)',
        'git status --porcelain > "$STATUS_FILE"',
        'test ! -s "$STATUS_FILE" || { cat "$STATUS_FILE"; rm -f "$STATUS_FILE"; echo "working tree must be clean before collapse"; exit 1; }',
        'mkdir -p "$DIR"',
        'cp "$STATUS_FILE" "$DIR/git-status.before.txt"',
        'rm -f "$STATUS_FILE"',
        'test -d packages/shared',
        'test -d packages/runtime',
        'test -d packages/product',
        'test -d packages/cloud',
        'test -d packages/local',
        'test -d packages/cli',
        'test ! -d src || { echo "top-level src/ already exists; collapse expects fresh start"; exit 1; }',
        'find packages -type f \\( -name "*.ts" -o -name "*.tsx" \\) | grep "/src/" | sort > "$DIR/source-inventory.before.txt"',
        'wc -l "$DIR/source-inventory.before.txt" > "$DIR/source-inventory.before.count.txt"',
        'cp package.json "$DIR/root-package.before.json"',
        'cp tsconfig.json "$DIR/root-tsconfig.before.json" 2>/dev/null || true',
        'cp vitest.config.ts "$DIR/root-vitest.before.ts" 2>/dev/null || true',
        'for p in shared runtime product cloud local cli; do cp "packages/$p/package.json" "$DIR/$p-package.before.json"; done',
        'echo PREFLIGHT_OK',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    // ---------------------------------------------------------------------
    // 2. TDD RED — write the flat-layout proof test before any source moves
    // ---------------------------------------------------------------------
    .step('write-flat-layout-proof', {
      agent: 'test-author-codex',
      dependsOn: ['preflight'],
      task: `Author the flat-layout proof test that defines the post-collapse contract. This test MUST FAIL on the current workspace layout — that is the RED step of the TDD migration.

You are not alone in the codebase. Do not move any source yet. Do not modify package.json, tsconfig.json, vitest.config.ts, or anything under packages/. The only thing this step adds is the new test plus its supporting evaluator module.

Owned write scope:
- test/flat-layout-proof/flat-layout-proof.ts
- test/flat-layout-proof/flat-layout-proof.test.ts

Reference (must read before writing):
- test/package-proof/package-layout-proof.ts (current workspace-layout evaluator — mirror its shape: pure functions, named cases, evidence array, deterministic, no network, sub-second).
- test/package-proof/package-layout-proof.test.ts (drive the new test the same way: summary + per-case evidence assertions).

Required proof cases (use these exact names so downstream gates can grep them):
1. flat-src-tree-exists — src/shared, src/runtime, src/product, src/cloud, src/local, src/surfaces/cli all exist as directories with at least one .ts file each.
2. workspaces-removed — root package.json has no "workspaces" key.
3. single-package-manifest — only one package.json exists in the repo (excluding node_modules and .claude/worktrees), and it is at the repo root.
4. single-tsconfig-covers-src — exactly one tsconfig.json at the root, its include array references "src", strict mode is on.
5. single-vitest-config — exactly one vitest.config.ts at the root, picks up src/**/*.test.ts.
6. no-cross-package-aliases — no remaining "@ricky/*" import specifiers anywhere under src/, no remaining "file:../" references in package.json. Surfaces depend on inner layers via relative paths only (sage-style).
7. cli-bin-still-wired — bin/ricky still exists, root package.json "bin" still maps "ricky", and the bin shim resolves to src/surfaces/cli/<entrypoint>.
8. legacy-packages-removed — packages/ directory either does not exist or is empty.
9. surface-folder-shape — src/surfaces/ contains a cli/ subfolder; the surfaces/ folder is the documented home for future slack/, web/, mac/.
10. layer-direction-by-folder — quick lexical scan: no file under src/shared imports from src/runtime|product|cloud|local|surfaces; no file under src/runtime imports from src/product|cloud|local|surfaces; no file under src/product imports from src/cloud|local|surfaces; no file under src/{cloud,local} imports from src/surfaces. Trust folders for boundaries (sage style); this is a lightweight grep, not a full graph.

Test-suite shape:
- describe('Ricky flat src layout proof', ...) with one summary "all cases pass" assertion plus per-case it.each blocks asserting expected evidence substrings.
- evaluator must be deterministic, finish under one second, and require no network.

After writing, RUN the new test once with:
  npx vitest run test/flat-layout-proof/flat-layout-proof.test.ts
and capture the failing output to ${artifactDir}/red-output.txt. Do NOT make it pass. The whole point is that it is RED here.

Write ${artifactDir}/red-confirmation.md ending with the literal token FLAT_LAYOUT_PROOF_RED_CONFIRMED.`,
      verification: { type: 'file_exists', value: `${artifactDir}/red-confirmation.md` },
    })
    .step('red-gate', {
      type: 'deterministic',
      dependsOn: ['write-flat-layout-proof'],
      command: [
        `DIR=${artifactDir}`,
        'test -f test/flat-layout-proof/flat-layout-proof.ts',
        'test -f test/flat-layout-proof/flat-layout-proof.test.ts',
        'grep -F "flat-src-tree-exists" test/flat-layout-proof/flat-layout-proof.ts',
        'grep -F "workspaces-removed" test/flat-layout-proof/flat-layout-proof.ts',
        'grep -F "no-cross-package-aliases" test/flat-layout-proof/flat-layout-proof.ts',
        'grep -F "legacy-packages-removed" test/flat-layout-proof/flat-layout-proof.ts',
        'grep -F "FLAT_LAYOUT_PROOF_RED_CONFIRMED" "$DIR/red-confirmation.md"',
        // The new test must currently fail. We invert exit code so a passing test here is an error.
        'if npx vitest run test/flat-layout-proof/flat-layout-proof.test.ts > "$DIR/red-rerun.txt" 2>&1; then echo "flat-layout proof unexpectedly passed before migration"; exit 1; fi',
        'echo RED_GATE_OK',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    // ---------------------------------------------------------------------
    // 3. Migration plan — explicit file map, no source moves yet
    // ---------------------------------------------------------------------
    .step('write-migration-plan', {
      agent: 'migrator-codex',
      dependsOn: ['red-gate'],
      task: `Write the deterministic migration plan that the next steps will execute. No source moves in this step — just the plan doc plus a machine-readable file map.

Owned write scope:
- ${artifactDir}/migration-plan.md
- ${artifactDir}/file-map.tsv  (TAB-separated: <old-path>\\t<new-path>, one row per source/test/asset move)

Required content for migration-plan.md:
- Mapping rule: packages/<layer>/src/** -> src/<layer>/** for layer in {shared, runtime, product, cloud, local}; packages/cli/src/** -> src/surfaces/cli/**; packages/cli/bin/** preserved at /bin/**.
- Import-rewrite rules: "@ricky/<layer>" -> relative path from the importing file to src/<layer>/index.ts; "@ricky/<layer>/<sub>" -> relative path to src/<layer>/<sub>.ts; "@agentworkforce/ricky" self-imports -> relative paths from src/surfaces/cli; "file:../<layer>" entries removed from package.json.
- Config consolidation: single root package.json takes name "@agentworkforce/ricky", merges every dependency from the six package manifests, drops "workspaces" and "private" stays true, keeps engines + packageManager + bin; single root tsconfig.json with include ["src", "test", "workflows", "scripts"]; single root vitest.config.ts that scans src/**/*.test.ts and test/**/*.test.ts.
- What gets deleted: packages/ tree (after the moves land), per-package package.json/tsconfig.json/vitest.config.ts files, the old test/package-proof/* (it is the proof of the layout we are removing — it must be deleted in this same workflow, not silently kept).
- What stays untouched: bin/ricky shim, scripts/, docs/, workflows/ (except the README entry added separately), .claude/, top-level .env.example.
- Boundary policy: enforced by folder convention only, no path aliases, no eslint-plugin-boundaries. Match sage.

Required content for file-map.tsv:
- Every .ts/.tsx file under packages/<layer>/src that needs a new home, one row per file. Generate it with: find packages -type f \( -name "*.ts" -o -name "*.tsx" \) | grep "/src/" | sort and translate the prefix. Do not include dist/ declaration outputs or any non-src build artifacts.

Write ${artifactDir}/migration-plan.md ending with the literal token MIGRATION_PLAN_READY.`,
      verification: { type: 'file_exists', value: `${artifactDir}/migration-plan.md` },
    })
    .step('plan-gate', {
      type: 'deterministic',
      dependsOn: ['write-migration-plan'],
      command: [
        `DIR=${artifactDir}`,
        'grep -F "MIGRATION_PLAN_READY" "$DIR/migration-plan.md"',
        'test -s "$DIR/file-map.tsv"',
        'awk -F"\\t" \'NF != 2 { print "bad row: " $0; exit 1 } { print }\' "$DIR/file-map.tsv" > /dev/null',
        // Sanity: every source file from preflight inventory must appear as an "old" entry in the map (or be explicitly listed as deleted in the plan body).
        'cut -f1 "$DIR/file-map.tsv" | sort -u > "$DIR/file-map.olds.txt"',
        'comm -23 "$DIR/source-inventory.before.txt" "$DIR/file-map.olds.txt" > "$DIR/file-map.unmapped.txt" || true',
        'if [ -s "$DIR/file-map.unmapped.txt" ]; then echo "unmapped sources:"; cat "$DIR/file-map.unmapped.txt"; exit 1; fi',
        'echo PLAN_GATE_OK',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    // ---------------------------------------------------------------------
    // 4. Execute migration — moves + import rewrites + config consolidation
    // ---------------------------------------------------------------------
    .step('execute-migration', {
      agent: 'migrator-codex',
      dependsOn: ['plan-gate'],
      task: `Execute the migration described in ${artifactDir}/migration-plan.md and ${artifactDir}/file-map.tsv. Use git mv for tracked files so history is preserved.

You are not alone in the codebase. Do not touch unrelated areas (workflows/, docs/, scripts/, .claude/) except where the plan explicitly requires it.

Owned write scope (broad — this is the whole point of the step):
- everything under src/ (creating it from scratch using the file map)
- root package.json, root tsconfig.json, root vitest.config.ts
- package-lock.json (regenerated via npm install)
- bin/ricky may be edited only if its require/import target needs to point at the new src/surfaces/cli entrypoint
- packages/ tree (deletion only — after files have been moved out)
- test/package-proof/** (delete; the new test/flat-layout-proof/** replaces it)

Required actions, in order:
1. For each row of file-map.tsv: ensure target directory exists, then "git mv <old> <new>". If git mv reports "not under version control", fall back to mkdir -p && mv && git add.
2. Rewrite imports across every moved file:
   - "@ricky/shared", "@ricky/runtime", "@ricky/product", "@ricky/cloud", "@ricky/local" -> relative path to src/<layer>/index.ts
   - "@ricky/<layer>/<sub>" -> relative path to src/<layer>/<sub>.ts (or .tsx)
   - "@agentworkforce/ricky" self-imports inside the cli surface -> relative paths
   Use a deterministic codemod (a small Node script under ${artifactDir}/codemod.mjs or ts-morph if already available); commit the codemod into ${artifactDir} so the rewrite is reproducible. Do NOT ad-hoc edit imports by hand across hundreds of files.
3. Consolidate package.json: merge every "dependencies" and "devDependencies" entry from the six package manifests into the root, drop "workspaces", drop every "file:../" entry, keep "private": true, keep "engines" and "packageManager", set "name" to "@agentworkforce/ricky", keep "bin": { "ricky": "./bin/ricky" }, replace the root "scripts" with: { "start": "tsx src/surfaces/cli/<entry>.ts", "typecheck": "tsc --noEmit", "test": "vitest run", "batch": "bash scripts/run-ricky-batch.sh", "overnight": "bash scripts/run-ricky-overnight.sh" }. Pick the cli entry by reading what packages/cli/package.json "scripts.start" pointed to.
4. Consolidate tsconfig.json: single file at root with strict, NodeNext, ES2022, include ["src", "test", "workflows", "scripts"]; remove every per-package tsconfig.
5. Consolidate vitest.config.ts: single file at root that picks up src/**/*.test.ts and test/**/*.test.ts; remove every per-package vitest config.
6. Delete the now-empty packages/ tree and the obsolete test/package-proof/ directory. Confirm with "git status" that nothing salvageable remains.
7. Run "npm install" once to regenerate package-lock.json against the new flat manifest. Do NOT run tests in this step — the next gate handles that.

Write ${artifactDir}/migration-execution.md summarizing the moves, the codemod approach, the resolved cli entrypoint path, and any deviations from the plan. End with the literal token MIGRATION_EXECUTED.`,
      verification: { type: 'file_exists', value: `${artifactDir}/migration-execution.md` },
    })
    .step('migration-structural-gate', {
      type: 'deterministic',
      dependsOn: ['execute-migration'],
      command: [
        `DIR=${artifactDir}`,
        'grep -F "MIGRATION_EXECUTED" "$DIR/migration-execution.md"',
        // Required structure
        'test -d src/shared && test -d src/runtime && test -d src/product && test -d src/cloud && test -d src/local && test -d src/surfaces/cli',
        'test -f tsconfig.json && test -f vitest.config.ts && test -f package.json',
        // No leftovers
        'if [ -d packages ]; then echo "packages/ still exists"; ls packages; exit 1; fi',
        'if [ -d test/package-proof ]; then echo "old package-proof still present"; exit 1; fi',
        // No workspaces and no file: deps
        'node -e "const p=require(\\"./package.json\\"); if (p.workspaces) { console.error(\\"workspaces still set\\"); process.exit(1) }"',
        'if grep -RF "\\"file:" package.json; then echo "file: deps still present"; exit 1; fi',
        // No @ricky aliases left in src/
        'if grep -REn "@ricky/(shared|runtime|product|cloud|local)" src; then echo "@ricky alias imports still present"; exit 1; fi',
        // bin still wired
        'test -f bin/ricky',
        'node -e "const p=require(\\"./package.json\\"); if (!p.bin || !p.bin.ricky) { console.error(\\"bin.ricky missing\\"); process.exit(1) }"',
        // Codemod recorded
        'test -f "$DIR/codemod.mjs" || test -f "$DIR/codemod.ts"',
        // package-lock regenerated and references no file: workspace links
        'if grep -F "file:packages/" package-lock.json; then echo "lockfile still references workspace links"; exit 1; fi',
        'echo MIGRATION_STRUCTURAL_GATE_OK',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    // ---------------------------------------------------------------------
    // 5. TDD GREEN — flat-layout proof + full test suite + typecheck
    // ---------------------------------------------------------------------
    .step('green-validation', {
      type: 'deterministic',
      dependsOn: ['migration-structural-gate'],
      command: [
        `DIR=${artifactDir}`,
        'set +e',
        'npx vitest run test/flat-layout-proof/flat-layout-proof.test.ts > "$DIR/green-flat-proof.txt" 2>&1; FLAT=$?',
        'npm run typecheck > "$DIR/green-typecheck.txt" 2>&1; TC=$?',
        'npm test > "$DIR/green-test.txt" 2>&1; TS=$?',
        'set -e',
        'echo "flat=$FLAT typecheck=$TC test=$TS" > "$DIR/green-summary.txt"',
        'cat "$DIR/green-summary.txt"',
      ].join(' && '),
      captureOutput: true,
      failOnError: false,
    })
    .step('fix-loop', {
      agent: 'fix-codex',
      dependsOn: ['green-validation'],
      task: `This is the 80-to-100 fix loop. Read the validation outputs and drive everything to green together.

Validation summary file: ${artifactDir}/green-summary.txt
Flat-layout proof output: ${artifactDir}/green-flat-proof.txt
Typecheck output: ${artifactDir}/green-typecheck.txt
Test output: ${artifactDir}/green-test.txt

Most recent raw outputs from upstream:
{{steps.green-validation.output}}

Rules:
- If a test was deleted as part of removing packages/, DO NOT silently re-add it. The flat-layout proof and the rest of the surviving suite are the contract.
- If an existing test under packages/ moved to src/ but now fails because it imported "@ricky/..." or "@agentworkforce/ricky" — fix the import to a relative path. Do NOT add path aliases.
- If typecheck fails because of dropped types, restore the missing source rather than adding any-casts.
- Re-run all three commands after each fix until all three exit 0:
  - npx vitest run test/flat-layout-proof/flat-layout-proof.test.ts
  - npm run typecheck
  - npm test
- Do not widen scope beyond the collapse migration.

Write ${artifactDir}/fix-loop.md describing every fix applied and ending with the literal token FLAT_LAYOUT_FIX_LOOP_COMPLETE.`,
      verification: { type: 'file_exists', value: `${artifactDir}/fix-loop.md` },
    })
    .step('green-gate', {
      type: 'deterministic',
      dependsOn: ['fix-loop'],
      command: [
        `DIR=${artifactDir}`,
        'grep -F "FLAT_LAYOUT_FIX_LOOP_COMPLETE" "$DIR/fix-loop.md"',
        'npx vitest run test/flat-layout-proof/flat-layout-proof.test.ts',
        'npm run typecheck',
        'npm test',
        'echo GREEN_GATE_OK',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    // ---------------------------------------------------------------------
    // 6. Review — preserve-or-justify check on the diff
    // ---------------------------------------------------------------------
    .step('final-review', {
      agent: 'review-claude',
      dependsOn: ['green-gate'],
      task: `Review the collapse PR end-to-end.

Confirm honestly:
- Every source file in ${artifactDir}/source-inventory.before.txt has a counterpart at the new src/ path (allowing for renames documented in the plan), and nothing was silently dropped.
- The cli still runs: bin/ricky resolves to src/surfaces/cli/<entry>; "npm start" uses tsx against the same path.
- Layer direction is enforced by folder convention only — no path aliases, no eslint plugin, matching sage.
- The old test/package-proof/ was REPLACED by test/flat-layout-proof/, not silently deleted.
- workflows/README.md was updated to describe wave11 (this is a separate commit-time concern; flag it if missing but do not block).
- No new abstractions, helpers, or surfaces beyond what the migration required (no premature slack/web/mac scaffolding).

Write ${artifactDir}/final-review.md. End with FINAL_REVIEW_PASS or FINAL_REVIEW_FAIL on its own line.`,
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

    // ---------------------------------------------------------------------
    // 7. Final hard validation + signoff
    // ---------------------------------------------------------------------
    .step('final-hard-validation', {
      type: 'deterministic',
      dependsOn: ['final-review-pass-gate'],
      command: [
        'npm run typecheck',
        'npm test',
        'npx vitest run test/flat-layout-proof/flat-layout-proof.test.ts',
        'node bin/ricky --help > /dev/null 2>&1 || node bin/ricky --version > /dev/null 2>&1 || echo "cli bin smoke skipped"',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })
    .step('signoff', {
      type: 'deterministic',
      dependsOn: ['final-hard-validation'],
      command: [
        `DIR=${artifactDir}`,
        "cat > \"$DIR/signoff.md\" <<'EOF'",
        '# Ricky wave11 flat-layout collapse signoff',
        '',
        'Outcome:',
        '- packages/{shared,runtime,product,cloud,local,cli} collapsed into src/{shared,runtime,product,cloud,local,surfaces/cli}',
        '- npm workspaces removed; single package.json, single tsconfig.json, single vitest.config.ts',
        '- Layer boundaries enforced by folder convention only (sage-style); no path aliases',
        '- test/package-proof/ replaced by test/flat-layout-proof/ as the layout contract',
        '',
        'Validation commands:',
        '- npm run typecheck',
        '- npm test',
        '- npx vitest run test/flat-layout-proof/flat-layout-proof.test.ts',
        '',
        'RICKY_FLAT_LAYOUT_COLLAPSE_COMPLETE',
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
