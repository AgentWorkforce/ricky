import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { workflow } from '@agent-relay/sdk/workflows';

const artifactDir = '.workflow-artifacts/wave13-master-executor/implement-master-executor';
const workflowFile = 'workflows/wave13-master-executor/01-implement-master-executor-planner.ts';
const specFile = 'workflows/meta/spec/ricky-master-executor-workflow-program.md';
const targetFiles = [
  'src/product/orchestration/types.ts',
  'src/product/orchestration/planner.ts',
  'src/product/orchestration/master-executor.ts',
  'src/product/orchestration/index.ts',
  'src/product/orchestration/master-executor.test.ts',
  'src/product/index.ts',
] as const;

function loadEnvFile(path: string): void {
  const fullPath = resolve(process.cwd(), path);
  if (!existsSync(fullPath)) return;

  for (const rawLine of readFileSync(fullPath, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = /^export\s+([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line) ??
      /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key] !== undefined) continue;
    const value = rawValue.replace(/^(['"])(.*)\1$/, '$2');
    process.env[key] = value;
  }
}

function loadRepoEnv(): void {
  loadEnvFile('.env.local');
  loadEnvFile('.env');
}

async function main() {
  loadRepoEnv();

  const result = await workflow('ricky-wave13-implement-master-executor-planner')
    .description([
      'Implement the first Ricky master executor slice: a spec decomposition planner, child workflow execution model, evidence gates, and deterministic unit tests.',
      'This workflow follows the 80-to-100 pattern: write tests, implement bounded files, verify scoped changes, review, fix captured failures, rerun hard gates, run regression checks, and sign off with evidence.',
      'The selected pattern is dag because tests, planner, executor, and type contracts can move through explicit dependencies and converge through deterministic gates.',
    ].join(' '))
    .pattern('dag')
    .channel('wf-ricky-wave13-master-executor')
    .maxConcurrency(4)
    .timeout(7_200_000)
    .onError('retry', { maxRetries: 2, retryDelayMs: 10_000 })

    .agent('lead-claude', {
      cli: 'claude',
      role: 'Owns the master executor architecture, decomposition rules, file scope discipline, and final implementation plan.',
      retries: 1,
    })
    .agent('tests-codex', {
      cli: 'codex',
      role: 'Writes deterministic unit tests for planner and executor behavior using injected fakes only.',
      retries: 2,
    })
    .agent('planner-codex', {
      cli: 'codex',
      role: 'Implements master execution planning, child workflow wave assignment, dependency ordering, and default gate construction.',
      retries: 2,
    })
    .agent('executor-codex', {
      cli: 'codex',
      role: 'Implements the injected child workflow runner coordinator, bounded concurrency, resume skips, gate evaluation, and failure classification.',
      retries: 2,
    })
    .agent('reviewer-claude', {
      cli: 'claude',
      preset: 'reviewer',
      role: 'Reviews product architecture, scope fit, and whether the implementation matches the master executor spec.',
      retries: 1,
    })
    .agent('reviewer-codex', {
      cli: 'codex',
      preset: 'reviewer',
      role: 'Reviews TypeScript correctness, deterministic test quality, injected seams, and 80-to-100 evidence quality.',
      retries: 1,
    })
    .agent('validator-claude', {
      cli: 'claude',
      preset: 'worker',
      role: 'Runs the 80-to-100 fix loop from captured failures and review artifacts, applying bounded repairs only to declared target files.',
      retries: 2,
    })

    .step('preflight', {
      type: 'deterministic',
      command: [
        'set -e',
        `DIR=${artifactDir}`,
        'mkdir -p "$DIR"',
        'test -f package.json',
        `test -f ${specFile}`,
        'test -f docs/workflows/WORKFLOW_STANDARDS.md',
        'test -f workflows/shared/WORKFLOW_AUTHORING_RULES.md',
        'test -f .agents/skills/writing-agent-relay-workflows/SKILL.md',
        'test -f .agents/skills/relay-80-100-workflow/SKILL.md',
        'node --version > "$DIR/node-version.txt"',
        'npm --version > "$DIR/npm-version.txt"',
        'git rev-parse --show-toplevel > "$DIR/repo-root.txt"',
        'git status --short > "$DIR/preflight-git-status.txt"',
        'if ! git diff --cached --quiet; then echo "ERROR: staging area is dirty"; git diff --cached --stat; exit 1; fi',
        'for cli in claude codex; do if ! command -v "$cli" >/dev/null 2>&1; then echo "MISSING_ENV_VAR: ${cli}_CLI_AVAILABLE"; exit 1; fi; done',
        'echo RICKY_MASTER_EXECUTOR_PREFLIGHT_OK',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })
    .step('read-source-contracts', {
      type: 'deterministic',
      dependsOn: ['preflight'],
      command: [
        `cat ${specFile}`,
        'printf "\\n\\n--- WORKFLOW STANDARDS ---\\n\\n"',
        'cat docs/workflows/WORKFLOW_STANDARDS.md',
        'printf "\\n\\n--- AUTHORING RULES ---\\n\\n"',
        'cat workflows/shared/WORKFLOW_AUTHORING_RULES.md',
        'printf "\\n\\n--- WRITING SKILL ---\\n\\n"',
        'sed -n "1,420p" .agents/skills/writing-agent-relay-workflows/SKILL.md',
        'printf "\\n\\n--- 80 TO 100 SKILL ---\\n\\n"',
        'sed -n "1,420p" .agents/skills/relay-80-100-workflow/SKILL.md',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })
    .step('snapshot-current-code', {
      type: 'deterministic',
      dependsOn: ['preflight'],
      command: [
        'printf "%s\\n" "--- src/runtime/types.ts ---"',
        'sed -n "1,260p" src/runtime/types.ts',
        'printf "\\n%s\\n" "--- src/runtime/local-coordinator.ts ---"',
        'sed -n "1,320p" src/runtime/local-coordinator.ts',
        'printf "\\n%s\\n" "--- src/product/generation/types.ts ---"',
        'sed -n "1,260p" src/product/generation/types.ts',
        'printf "\\n%s\\n" "--- src/product/index.ts ---"',
        'sed -n "1,220p" src/product/index.ts',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })
    .step('write-acceptance-matrix', {
      type: 'deterministic',
      dependsOn: ['read-source-contracts'],
      command: [
        'set -e',
        `DIR=${artifactDir}`,
        "cat > \"$DIR/acceptance-matrix.md\" <<'EOF'",
        '# Ricky master executor acceptance matrix',
        '',
        'The first implementation slice is complete only when these deterministic behaviors are present and tested.',
        '',
        '## Planner behavior',
        '- Accepts a spec title, description, optional slices, constraints, and target files.',
        '- Produces stable child workflow ids and wave-scoped workflow paths.',
        '- Assigns dependency waves from child dependencies.',
        '- Marks independent children as parallelizable.',
        '- Adds default 80-to-100 gates to every child.',
        '- Marks ambiguous specs instead of pretending decomposition is safe.',
        '',
        '## Executor behavior',
        '- Accepts an injected child runner function.',
        '- Executes children by dependency wave.',
        '- Enforces maxConcurrency.',
        '- Skips already-signed-off children in resume mode.',
        '- Records structured evidence for every child.',
        '- Classifies next action as complete, retry, repair, split, blocked, or escalate.',
        '',
        '## Required test cases',
        '- Spec decomposition into multiple child workflows.',
        '- Dependency wave ordering.',
        '- Bounded concurrency.',
        '- Signoff-gated resume skip.',
        '- Failed child classification.',
        '- Missing environment classification as blocked.',
        '- Final result only complete when all required gates pass.',
        '',
        'RICKY_MASTER_EXECUTOR_ACCEPTANCE_MATRIX_READY',
        'EOF',
      ].join('\n'),
      captureOutput: true,
      failOnError: true,
    })
    .step('lead-plan', {
      agent: 'lead-claude',
      dependsOn: ['read-source-contracts', 'snapshot-current-code', 'write-acceptance-matrix'],
      task: `Create the implementation plan for the Ricky master executor first slice.

Inputs:
- Source contracts: {{steps.read-source-contracts.output}}
- Current code snapshot: {{steps.snapshot-current-code.output}}
- Acceptance matrix: ${artifactDir}/acceptance-matrix.md

Write ${artifactDir}/lead-plan.md ending with RICKY_MASTER_EXECUTOR_LEAD_PLAN_READY.
The plan must assign exact file ownership, define non-goals, specify exported API names, and preserve the existing LocalCoordinator as the low-level run seam.
Do not implement in this step.`,
      verification: { type: 'file_exists', value: `${artifactDir}/lead-plan.md` },
    })
    .step('lead-plan-gate', {
      type: 'deterministic',
      dependsOn: ['lead-plan'],
      command: [
        'set -e',
        `grep -F RICKY_MASTER_EXECUTOR_LEAD_PLAN_READY ${artifactDir}/lead-plan.md`,
        `grep -E "planner|executor|types|test|LocalCoordinator|80-to-100" ${artifactDir}/lead-plan.md`,
        'echo RICKY_MASTER_EXECUTOR_PLAN_VERIFIED',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('write-tests-first', {
      agent: 'tests-codex',
      dependsOn: ['lead-plan-gate'],
      task: `Write deterministic tests first for the master executor.

Read ${specFile}, ${artifactDir}/acceptance-matrix.md, and ${artifactDir}/lead-plan.md.
Own only src/product/orchestration/master-executor.test.ts.
Tests must use Vitest and injected fake child runners; do not invoke live agent-relay.
Cover decomposition, wave ordering, maxConcurrency, resume signoff skip, failed child classification, missing environment blocked classification, and complete-only-after-gates behavior.
It is acceptable for tests to fail before implementation exists.`,
      verification: { type: 'exit_code', value: '0' },
    })
    .step('verify-tests-written', {
      type: 'deterministic',
      dependsOn: ['write-tests-first'],
      command: [
        'set -e',
        'test -f src/product/orchestration/master-executor.test.ts',
        'grep -E "describe|it\\(" src/product/orchestration/master-executor.test.ts',
        'grep -E "maxConcurrency|resume|blocked|dependency|decomposition|signoff|complete" src/product/orchestration/master-executor.test.ts',
        'echo RICKY_MASTER_EXECUTOR_TESTS_WRITTEN',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })
    .step('run-tests-red-or-green', {
      type: 'deterministic',
      dependsOn: ['verify-tests-written'],
      command: 'npx vitest run src/product/orchestration/master-executor.test.ts 2>&1 | tail -120',
      captureOutput: true,
      failOnError: false,
    })

    .step('implement-planner-and-types', {
      agent: 'planner-codex',
      dependsOn: ['verify-tests-written'],
      task: `Implement the master executor type contracts and planner.

Read ${specFile}, ${artifactDir}/lead-plan.md, and src/product/orchestration/master-executor.test.ts.
Own only:
- src/product/orchestration/types.ts
- src/product/orchestration/planner.ts
- src/product/orchestration/index.ts
- src/product/index.ts

Expose plain TypeScript types and a planner API that satisfies the tests.
Do not edit executor implementation or tests.`,
      verification: { type: 'exit_code', value: '0' },
    })
    .step('implement-master-executor', {
      agent: 'executor-codex',
      dependsOn: ['verify-tests-written'],
      task: `Implement the master executor runtime coordinator.

Read ${specFile}, ${artifactDir}/lead-plan.md, and src/product/orchestration/master-executor.test.ts.
Own only src/product/orchestration/master-executor.ts.
Use an injected child runner function and in-memory gate evaluator hooks so tests never invoke live agent-relay.
Implement dependency-wave execution, maxConcurrency, resume signoff skip, structured evidence, and next-action classification.
Do not edit planner files or tests unless the fix loop later requests it.`,
      verification: { type: 'exit_code', value: '0' },
    })
    .step('verify-implementation-files', {
      type: 'deterministic',
      dependsOn: ['implement-planner-and-types', 'implement-master-executor'],
      command: [
        'set -e',
        ...targetFiles.map((file) => `test -f ${file}`),
        'grep -F "MasterExecutionPlan" src/product/orchestration/types.ts',
        'grep -E "planMasterExecution|createMasterExecutionPlan" src/product/orchestration/planner.ts',
        'grep -E "executeMasterPlan|MasterExecutor" src/product/orchestration/master-executor.ts',
        'grep -F "orchestration" src/product/index.ts',
        `changed="$(git diff --name-only -- ${targetFiles.join(' ')}; git ls-files --others --exclude-standard -- ${targetFiles.join(' ')})"`,
        'if [ -z "$changed" ]; then echo "NO_CHANGES_DETECTED"; exit 1; fi',
        'echo "$changed" > "' + artifactDir + '/scoped-changes.txt"',
        'echo RICKY_MASTER_EXECUTOR_IMPLEMENTATION_FILES_VERIFIED',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('run-focused-tests-soft', {
      type: 'deterministic',
      dependsOn: ['verify-implementation-files'],
      command: 'npx vitest run src/product/orchestration/master-executor.test.ts 2>&1 | tail -160',
      captureOutput: true,
      failOnError: false,
    })
    .step('run-typecheck-soft', {
      type: 'deterministic',
      dependsOn: ['verify-implementation-files'],
      command: 'npm run typecheck 2>&1 | tail -160',
      captureOutput: true,
      failOnError: false,
    })
    .step('review-claude', {
      agent: 'reviewer-claude',
      dependsOn: ['run-focused-tests-soft', 'run-typecheck-soft'],
      task: `Review the master executor implementation against ${specFile}.

Soft focused test output:
{{steps.run-focused-tests-soft.output}}

Soft typecheck output:
{{steps.run-typecheck-soft.output}}

Write ${artifactDir}/review-claude.md with:
- PASS or FAIL
- any product/architecture gaps
- exact file references for required fixes
End with RICKY_MASTER_EXECUTOR_CLAUDE_REVIEW_READY.`,
      verification: { type: 'file_exists', value: `${artifactDir}/review-claude.md` },
    })
    .step('review-codex', {
      agent: 'reviewer-codex',
      dependsOn: ['run-focused-tests-soft', 'run-typecheck-soft'],
      task: `Review the TypeScript implementation and tests for deterministic quality.

Soft focused test output:
{{steps.run-focused-tests-soft.output}}

Soft typecheck output:
{{steps.run-typecheck-soft.output}}

Write ${artifactDir}/review-codex.md with:
- PASS or FAIL
- type/API/test gaps
- exact file references for required fixes
End with RICKY_MASTER_EXECUTOR_CODEX_REVIEW_READY.`,
      verification: { type: 'file_exists', value: `${artifactDir}/review-codex.md` },
    })
    .step('verify-review-artifacts', {
      type: 'deterministic',
      dependsOn: ['review-claude', 'review-codex'],
      command: [
        'set -e',
        `grep -F RICKY_MASTER_EXECUTOR_CLAUDE_REVIEW_READY ${artifactDir}/review-claude.md`,
        `grep -F RICKY_MASTER_EXECUTOR_CODEX_REVIEW_READY ${artifactDir}/review-codex.md`,
        'echo RICKY_MASTER_EXECUTOR_REVIEWS_CAPTURED',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })
    .step('fix-from-soft-gates-and-review', {
      agent: 'validator-claude',
      dependsOn: ['verify-review-artifacts'],
      task: `Run the 80-to-100 fix loop for the master executor first slice.

Focused test output:
{{steps.run-focused-tests-soft.output}}

Typecheck output:
{{steps.run-typecheck-soft.output}}

Claude review: ${artifactDir}/review-claude.md
Codex review: ${artifactDir}/review-codex.md

Fix failures and review findings only within:
${targetFiles.map((file) => `- ${file}`).join('\n')}

Run locally until green:
- npx vitest run src/product/orchestration/master-executor.test.ts
- npm run typecheck

Do not commit, push, or edit unrelated files.`,
      verification: { type: 'exit_code', value: '0' },
    })
    .step('verify-post-fix-scope', {
      type: 'deterministic',
      dependsOn: ['fix-from-soft-gates-and-review'],
      command: [
        'set -e',
        `changed="$(git diff --name-only -- ${targetFiles.join(' ')}; git ls-files --others --exclude-standard -- ${targetFiles.join(' ')})"`,
        'if [ -z "$changed" ]; then echo "NO_SCOPED_CHANGES_AFTER_FIX"; exit 1; fi',
        'unexpected="$(git diff --name-only; git ls-files --others --exclude-standard)"',
        'printf "%s\\n" "$unexpected" > "' + artifactDir + '/all-workspace-changes-after-fix.txt"',
        'echo RICKY_MASTER_EXECUTOR_POST_FIX_SCOPE_RECORDED',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })
    .step('run-focused-tests-final', {
      type: 'deterministic',
      dependsOn: ['verify-post-fix-scope'],
      command: 'npx vitest run src/product/orchestration/master-executor.test.ts',
      captureOutput: true,
      failOnError: true,
    })
    .step('run-typecheck-final', {
      type: 'deterministic',
      dependsOn: ['verify-post-fix-scope'],
      command: 'npm run typecheck',
      captureOutput: true,
      failOnError: true,
    })
    .step('run-regression-soft', {
      type: 'deterministic',
      dependsOn: ['run-focused-tests-final', 'run-typecheck-final'],
      command: 'npm test 2>&1 | tail -200',
      captureOutput: true,
      failOnError: false,
    })
    .step('fix-regressions', {
      agent: 'validator-claude',
      dependsOn: ['run-regression-soft'],
      task: `Check the full regression output for failures caused by the master executor changes.

Regression output:
{{steps.run-regression-soft.output}}

If all tests passed, do nothing.
If there are failures caused by this slice, fix only the declared target files and rerun npm test until green.
If failures are clearly unrelated pre-existing workspace issues, document them in ${artifactDir}/regression-notes.md and do not hide them.`,
      verification: { type: 'exit_code', value: '0' },
    })
    .step('quarantine-generated-workflow-residue', {
      type: 'deterministic',
      dependsOn: ['fix-regressions'],
      command: [
        'set -e',
        `DIR=${artifactDir}`,
        'mkdir -p "$DIR/quarantined-generated-workflows"',
        'allowed="workflows/generated/ricky-i-want-to-clean-up-the-codebase-to-remove-outdat.ts"',
        'for file in workflows/generated/*.ts; do',
        '  [ -e "$file" ] || continue',
        '  if [ "$file" = "$allowed" ]; then continue; fi',
        '  if git ls-files --error-unmatch "$file" >/dev/null 2>&1; then',
        '    echo "TRACKED_UNEXPECTED_GENERATED_WORKFLOW: $file"',
        '    exit 1',
        '  fi',
        '  mv "$file" "$DIR/quarantined-generated-workflows/$(basename "$file")"',
        '  echo "quarantined_untracked_generated_workflow=$file"',
        'done',
        'echo RICKY_MASTER_EXECUTOR_GENERATED_RESIDUE_QUARANTINED',
      ].join('\n'),
      captureOutput: true,
      failOnError: true,
    })
    .step('run-regression-final', {
      type: 'deterministic',
      dependsOn: ['quarantine-generated-workflow-residue'],
      command: 'npm test',
      captureOutput: true,
      failOnError: true,
    })
    .step('final-signoff', {
      type: 'deterministic',
      dependsOn: ['run-regression-final'],
      command: [
        'set -e',
        `DIR=${artifactDir}`,
        "cat > \"$DIR/signoff.md\" <<'EOF'",
        '# Ricky master executor first-slice signoff',
        '',
        'Implemented and verified:',
        '- Master execution plan and child workflow contract types.',
        '- Spec decomposition planner with child workflow waves and default gates.',
        '- Injected master executor with bounded concurrency, resume skip, evidence recording, and failure classification.',
        '- Deterministic Vitest coverage for the acceptance matrix.',
        '',
        'Validation gates:',
        '- npx vitest run src/product/orchestration/master-executor.test.ts',
        '- npm run typecheck',
        '- npm test',
        '',
        'Commit and push are intentionally outside this workflow.',
        '',
        'RICKY_MASTER_EXECUTOR_IMPLEMENTED',
        'EOF',
        'grep -F RICKY_MASTER_EXECUTOR_IMPLEMENTED "$DIR/signoff.md"',
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
