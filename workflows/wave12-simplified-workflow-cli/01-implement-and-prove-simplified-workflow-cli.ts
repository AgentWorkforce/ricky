import { workflow } from '@agent-relay/sdk/workflows';

const artifactDir = '.workflow-artifacts/wave12-simplified-workflow-cli/implement-and-prove';
const finalScopeAllowPattern = [
  'package\\.json',
  'package-lock\\.json',
  'src/surfaces/cli',
  'src/cloud',
  'src/local',
  'src/runtime',
  'src/product/generation',
  'test/',
  'workflows/wave12-simplified-workflow-cli/',
  '\\.workflow-artifacts/',
  '\\.ricky/config\\.json',
  'docs/product/ricky-simplified-workflow-cli-spec\\.md',
  'workflows/generated/ricky-verify-simplified-cli-smoke\\.ts',
].join('|');

async function main() {
  const result = await workflow('ricky-wave12-implement-and-prove-simplified-workflow-cli')
    .description([
      'Implement the Ricky simplified workflow CLI from docs/product/ricky-simplified-workflow-cli-spec.md and prove every local, Cloud, and power-user path end to end.',
      'This workflow explicitly follows the 80-to-100 pattern: implement, verify edits, create path-complete E2E tests, run them, fix failures, rerun hard gates, run full regressions, and sign off with evidence.',
      'The selected pattern is dag because the implementation has independent local, Cloud, parser, writer-harness, and runtime-monitoring tracks that can move in parallel after a shared plan, then converge through tests and review.',
    ].join(' '))
    .pattern('dag')
    .channel('wf-ricky-wave12-simplified-cli')
    .maxConcurrency(5)
    .timeout(7_200_000)
    .onError('retry', { maxRetries: 2, retryDelayMs: 10_000 })

    .agent('lead-claude', {
      cli: 'claude',
      role: 'Owns the product architecture, acceptance matrix, file ownership, and final scope discipline for the simplified CLI.',
      retries: 1,
    })
    .agent('prompts-codex', {
      cli: 'codex',
      role: 'Implements @inquirer/prompts wrappers, compact first screen, cancellation behavior, and dependency injection seams.',
      retries: 2,
    })
    .agent('local-codex', {
      cli: 'codex',
      role: 'Implements local guided spec intake, workflow summary, run confirmation, existing-workflow path, and background local run orchestration.',
      retries: 2,
    })
    .agent('cloud-codex', {
      cli: 'codex',
      role: 'Implements Cloud readiness, login recovery, agent connection checks, integration prompts, and Cloud run confirmation without silent fallback.',
      retries: 2,
    })
    .agent('writer-codex', {
      cli: 'codex',
      role: 'Implements Workforce persona workflow writer integration and metadata persistence through ../workforce or package seams.',
      retries: 2,
    })
    .agent('power-codex', {
      cli: 'codex',
      role: 'Implements quiet power-user parser behavior, status/connect commands, JSON output, --yes safety limits, and non-interactive recovery text.',
      retries: 2,
    })
    .agent('tests-codex', {
      cli: 'codex',
      role: 'Builds deterministic E2E and regression tests that cover every path named in the simplified CLI spec.',
      retries: 2,
    })
    .agent('reviewer-claude', {
      cli: 'claude',
      preset: 'reviewer',
      role: 'Reviews product completeness, UX truthfulness, Cloud/local equivalence, and no-overclaim behavior.',
      retries: 1,
    })
    .agent('reviewer-codex', {
      cli: 'codex',
      preset: 'reviewer',
      role: 'Reviews TypeScript boundaries, injectable seams, deterministic tests, and 80-to-100 proof quality.',
      retries: 1,
    })
    .agent('validator-claude', {
      cli: 'claude',
      preset: 'worker',
      role: 'Runs the 80-to-100 fix loop from captured failures and applies bounded repairs until all hard gates pass.',
      retries: 2,
    })

    .step('preflight', {
      type: 'deterministic',
      command: [
        `DIR=${artifactDir}`,
        'mkdir -p "$DIR"',
        'test -f package.json',
        'test -f docs/product/ricky-simplified-workflow-cli-spec.md',
        'test -f docs/workflows/WORKFLOW_STANDARDS.md',
        'test -f workflows/shared/WORKFLOW_AUTHORING_RULES.md',
        'test -f .agents/skills/writing-agent-relay-workflows/SKILL.md',
        'test -f .agents/skills/relay-80-100-workflow/SKILL.md',
        'node --version > "$DIR/node-version.txt"',
        'npm --version > "$DIR/npm-version.txt"',
        'git rev-parse --show-toplevel > "$DIR/repo-root.txt"',
        'git status --short > "$DIR/preflight-git-status.txt"',
        'echo SIMPLIFIED_CLI_PREFLIGHT_OK',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })
    .step('read-source-contracts', {
      type: 'deterministic',
      dependsOn: ['preflight'],
      command: [
        'cat docs/product/ricky-simplified-workflow-cli-spec.md',
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
    .step('snapshot-current-surfaces', {
      type: 'deterministic',
      dependsOn: ['preflight'],
      command: [
        'sed -n "1,340p" src/surfaces/cli/commands/cli-main.ts',
        'printf "\\n--- interactive-cli.ts ---\\n"',
        'sed -n "1,340p" src/surfaces/cli/entrypoint/interactive-cli.ts',
        'printf "\\n--- onboarding.ts ---\\n"',
        'sed -n "1,300p" src/surfaces/cli/cli/onboarding.ts',
        'printf "\\n--- local entrypoint ---\\n"',
        'sed -n "1,320p" src/local/entrypoint.ts',
        'printf "\\n--- cloud auth/provider files ---\\n"',
        'sed -n "1,260p" src/cloud/auth/types.ts',
        'printf "\\n"',
        'sed -n "1,220p" src/cloud/auth/provider-connect.ts',
        'printf "\\n--- generation pipeline ---\\n"',
        'sed -n "1,300p" src/product/generation/pipeline.ts',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })
    .step('write-acceptance-matrix', {
      type: 'deterministic',
      dependsOn: ['read-source-contracts'],
      command: [
        `DIR=${artifactDir}`,
        "cat > \"$DIR/acceptance-matrix.md\" <<'EOF'",
        '# Ricky simplified workflow CLI acceptance matrix',
        '',
        'This matrix is the workflow-owned 80-to-100 contract. Implementation is not complete until every path below has a deterministic E2E or integration-style proof and the final hard gates pass.',
        '',
        '## Interactive entry',
        '- `ricky` opens a compact @inquirer/prompts menu with choices: local, Cloud, status, connect tools, exit.',
        '- Ctrl+C renders concise cancellation without a stack trace unless verbose is enabled.',
        '- Non-TTY, piped stdin, CI, quiet, JSON, and verbose modes preserve non-interactive behavior.',
        '',
        '## Local guided paths',
        '- Local preflight detects repo root, package manager, agent-relay availability, Claude, Codex, OpenCode, Gemini, `.ricky/config.json`, and spec locations.',
        '- Spec file path asks for path, defaults name from filename, generates through the existing pipeline, summarizes, and offers run actions.',
        '- Editor path captures a long spec, asks for name, generates, summarizes, and offers run actions.',
        '- Goal path captures one-sentence outcome, asks only necessary clarifiers, approves or edits generated spec, generates, summarizes, and offers run actions.',
        '- Existing workflow path skips generation and goes directly to summary and run confirmation.',
        '- Run choices cover background monitored run, foreground run, not-now command output, and edit-before-run.',
        '',
        '## Workflow writer harness',
        '- Ricky delegates workflow writing to the adjacent Workforce persona system through a non-interactive harness, not an interactive TUI.',
        '- The generation task includes normalized spec, workflow name, target mode, repo root, file context, Relay standards, output path, structured response contract, verification constraints, side-effect rules, auto-fix policy, and evidence rules.',
        '- Metadata persists persona id, tier, harness, model, prompt digest, warnings, and run id.',
        '',
        '## Cloud guided paths',
        '- Cloud readiness checks account, credentials, workspace, Claude, Codex, OpenCode, Gemini connections, and optional Slack/GitHub/Notion/Linear integrations.',
        '- Missing login prompts login and re-checks; failed login offers local mode without pretending success.',
        '- Missing agents prompt connect all, choose agents, continue with connected, or go back; generated summary reflects actually available agents.',
        '- Optional integrations use checkbox and can be skipped; skipped integrations are explained only when relevant.',
        '- Cloud run confirmation covers run-and-monitor, show command, and edit workflow first.',
        '',
        '## Power-user paths',
        '- `ricky local` supports --spec-file, --spec, --stdin, --workflow, --name, --run, --no-run, --background, --foreground, --auto-fix, --no-auto-fix, --yes, --json, --quiet, --verbose.',
        '- `ricky cloud` supports the same generation/run choices where applicable and fails with actionable recovery if auth or required agents are missing.',
        '- `ricky status`, `ricky status --json`, `ricky connect cloud`, `ricky connect agents --cloud ...`, and `ricky connect integrations --cloud ...` are real command paths.',
        '- `--yes` never approves commits, pushes, destructive file changes, paid upgrades, credential creation, or broad dependency upgrades.',
        '',
        '## Required tests',
        '- Prompt cancellation.',
        '- Missing spec.',
        '- Spec file flow.',
        '- Editor spec flow.',
        '- Goal-to-spec flow.',
        '- Existing workflow flow.',
        '- Local run confirmation: background, foreground, not now, edit first.',
        '- Cloud login missing and re-check.',
        '- Cloud agents missing and re-check.',
        '- Optional integration skip.',
        '- Power-user --json.',
        '- Power-user --yes safety limits.',
        '- Non-interactive recovery text without raw stack traces.',
        '- Background evidence path and reattach command.',
        '',
        'SIMPLIFIED_CLI_ACCEPTANCE_MATRIX_READY',
        'EOF',
      ].join('\n'),
      captureOutput: true,
      failOnError: true,
    })
    .step('lead-plan', {
      agent: 'lead-claude',
      dependsOn: ['read-source-contracts', 'snapshot-current-surfaces', 'write-acceptance-matrix'],
      task: `Create the implementation plan for the simplified workflow CLI.

Inputs:
- Spec and standards are in {{steps.read-source-contracts.output}}
- Current code snapshot is in {{steps.snapshot-current-surfaces.output}}
- Acceptance matrix is ${artifactDir}/acceptance-matrix.md

Write ${artifactDir}/lead-plan.md ending with SIMPLIFIED_CLI_LEAD_PLAN_READY.
The plan must assign file ownership by track, define non-goals, identify risky seams, and preserve existing generation/local-run behavior while adding the guided product surface.
Do not implement in this step.`,
      verification: { type: 'file_exists', value: `${artifactDir}/lead-plan.md` },
    })
    .step('lead-plan-gate', {
      type: 'deterministic',
      dependsOn: ['lead-plan'],
      command: [
        `grep -F SIMPLIFIED_CLI_LEAD_PLAN_READY ${artifactDir}/lead-plan.md`,
        `grep -E "local|Cloud|power|Workforce|80-to-100|test" ${artifactDir}/lead-plan.md`,
        'echo SIMPLIFIED_CLI_PLAN_VERIFIED',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('implement-prompt-shell', {
      agent: 'prompts-codex',
      dependsOn: ['lead-plan-gate'],
      task: `Implement the compact interactive prompt shell and prompt abstractions.

Own these files and nearby tests only:
- package.json
- package-lock.json
- src/surfaces/cli/prompts/*
- src/surfaces/cli/entrypoint/interactive-cli.ts
- src/surfaces/cli/cli/onboarding.ts
- src/surfaces/cli/cli/mode-selector.ts
- src/surfaces/cli/entrypoint/interactive-cli.test.ts
- src/surfaces/cli/cli/onboarding.test.ts

Requirements:
- Add @inquirer/prompts ^8.4.2 and import only used prompts.
- ricky first screen is compact: local, Cloud, status, connect tools, exit.
- Prompt wrappers are dependency-injectable and support clean AbortController cancellation.
- Ctrl+C prints a concise cancellation line unless verbose is set.
- Preserve piped stdin, non-TTY, CI, quiet, JSON, and existing local handoff behavior.
- Do not invent Cloud credentials or provider state.`,
      verification: { type: 'exit_code', value: '0' },
    })
    .step('prompt-shell-gate', {
      type: 'deterministic',
      dependsOn: ['implement-prompt-shell'],
      command: [
        'grep -F \'"@inquirer/prompts"\' package.json',
        'test -d src/surfaces/cli/prompts',
        'grep -R "from .@inquirer/prompts." src/surfaces/cli src/surfaces/cli/prompts >/dev/null || grep -R "@inquirer/prompts" src/surfaces/cli src/surfaces/cli/prompts',
        'grep -R "AbortController\\|cancel" src/surfaces/cli src/surfaces/cli/prompts',
        'grep -R "Run a workflow locally\\|Run a workflow in Cloud\\|Check status\\|Connect tools\\|Exit" src/surfaces/cli',
        'echo PROMPT_SHELL_GATE_PASS',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('implement-local-guided-flow', {
      agent: 'local-codex',
      dependsOn: ['lead-plan-gate'],
      task: `Implement the local hand-holding flow.

Own these files and nearby tests only:
- src/surfaces/cli/flows/local-workflow-flow.ts
- src/surfaces/cli/flows/spec-intake-flow.ts
- src/surfaces/cli/flows/workflow-summary.ts
- src/surfaces/cli/flows/local-run-monitor.ts
- src/surfaces/cli/entrypoint/interactive-cli.ts
- src/local/entrypoint.ts
- src/runtime/local-coordinator.ts

Requirements:
- Local preflight detects repo root, package manager, agent-relay, Claude, Codex, OpenCode, Gemini, .ricky/config.json, and common spec locations.
- Spec intake supports spec file, editor text, goal-to-spec with approval/edit, and existing workflow artifact.
- Generated artifacts use the existing generation pipeline and land in workflows/generated unless overridden.
- Summary names artifact, goal, agents and jobs, desired outcome, side effects, and missing local blockers.
- Run confirmation supports background monitored run, foreground run, not now command, and edit first.
- Background runs persist state, logs, generated artifacts, fixes, evidence, and reattach command under .workflow-artifacts/.
- Auto-fixes are bounded and never approve destructive actions or commits.`,
      verification: { type: 'exit_code', value: '0' },
    })
    .step('local-flow-gate', {
      type: 'deterministic',
      dependsOn: ['implement-local-guided-flow'],
      command: [
        'test -f src/surfaces/cli/flows/local-workflow-flow.ts',
        'test -f src/surfaces/cli/flows/spec-intake-flow.ts',
        'test -f src/surfaces/cli/flows/workflow-summary.ts',
        'grep -R "spec file\\|editor\\|goal\\|existing workflow" src/surfaces/cli/flows src/surfaces/cli/entrypoint/interactive-cli.ts',
        'grep -R "background\\|foreground\\|reattach\\|workflow-artifacts" src/surfaces/cli/flows src/local src/runtime',
        'echo LOCAL_GUIDED_FLOW_GATE_PASS',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('implement-cloud-guided-flow', {
      agent: 'cloud-codex',
      dependsOn: ['lead-plan-gate'],
      task: `Implement the Cloud hand-holding flow.

Own these files and nearby tests only:
- src/surfaces/cli/flows/cloud-workflow-flow.ts
- src/surfaces/cli/flows/workflow-summary.ts
- src/cloud/auth/*
- src/cloud/provider-connect.ts
- src/cloud/index.ts
- src/surfaces/cli/entrypoint/interactive-cli.ts

Requirements:
- Readiness checks account, credentials, workspace, Claude, Codex, OpenCode, Gemini, and optional Slack/GitHub/Notion/Linear integrations.
- Missing login prompts real login mechanism recovery and re-checks readiness.
- Missing agents prompt connect all, choose which, continue with connected, or go back.
- At least one capable implementation agent is required before Cloud execution.
- Optional integrations use checkbox, allow skip all, and explain skipped tools only when relevant.
- Never silently fall back from Cloud to local or local to Cloud.
- Cloud summary and run confirmation reflect actually available agents and integration caveats.`,
      verification: { type: 'exit_code', value: '0' },
    })
    .step('cloud-flow-gate', {
      type: 'deterministic',
      dependsOn: ['implement-cloud-guided-flow'],
      command: [
        'test -f src/surfaces/cli/flows/cloud-workflow-flow.ts',
        'grep -R "Claude\\|Codex\\|OpenCode\\|Gemini" src/surfaces/cli/flows src/cloud',
        'grep -R "Slack\\|GitHub\\|Notion\\|Linear" src/surfaces/cli/flows src/cloud',
        'grep -R "login\\|credentials\\|workspace\\|connected agents\\|missing agents" src/surfaces/cli/flows src/cloud',
        'echo CLOUD_GUIDED_FLOW_GATE_PASS',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('implement-workforce-writer', {
      agent: 'writer-codex',
      dependsOn: ['lead-plan-gate'],
      task: `Implement the Workforce persona workflow writer harness.

Own these files and nearby tests only:
- src/product/generation/workforce-persona-writer.ts
- src/product/generation/pipeline.ts
- src/product/generation/types.ts
- src/local/entrypoint.ts
- src/cloud/api/generate-endpoint.ts

Requirements:
- Resolve the right LLM persona programmatically from ../workforce in local development and package seams in packaged builds.
- Prefer the Agent Relay workflow-writing persona or closest workflow-authoring routing intent.
- Invoke the selected persona in non-interactive one-shot mode through Workforce harness kit or usePersona(...).sendMessage().
- Do not open Claude, Codex, or OpenCode TUI and do not hand-roll a separate persona registry.
- Task includes normalized spec, workflow name, target mode, repo root, relevant file context, Agent Relay workflow standards, output path, structured response contract, constraints, and evidence rules.
- Parse structured output where possible; otherwise require fenced artifact plus metadata and validate both.
- Persist persona id, tier, harness, model, prompt digest, warnings, and run id in generation metadata.`,
      verification: { type: 'exit_code', value: '0' },
    })
    .step('workforce-writer-gate', {
      type: 'deterministic',
      dependsOn: ['implement-workforce-writer'],
      command: [
        'test -f src/product/generation/workforce-persona-writer.ts',
        'grep -R "workforce\\|usePersona\\|harness\\|persona" src/product/generation src/local src/cloud/api',
        'grep -R "promptDigest\\|prompt_digest\\|runId\\|run_id\\|tier\\|model" src/product/generation src/local src/cloud/api',
        'grep -R "structured\\|fenced\\|metadata" src/product/generation/workforce-persona-writer.ts',
        'echo WORKFORCE_WRITER_GATE_PASS',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('implement-power-user-surface', {
      agent: 'power-codex',
      dependsOn: ['lead-plan-gate'],
      task: `Implement the quiet power-user CLI surface.

Own these files and nearby tests only:
- src/surfaces/cli/commands/cli-main.ts
- src/surfaces/cli/flows/power-user-parser.ts
- src/surfaces/cli/flows/workflow-summary.ts
- src/surfaces/cli/entrypoint/interactive-cli.ts

Requirements:
- Commands: ricky local, ricky cloud, ricky status, ricky connect cloud, ricky connect agents --cloud, ricky connect integrations --cloud.
- Flags: --spec, --spec-file, --stdin, --workflow, --name, --run, --no-run, --background, --foreground, --auto-fix, --no-auto-fix, --yes, --json, --quiet, --verbose.
- If --run is omitted, generate and print summary plus run command.
- If --run --yes is present, skip only non-destructive confirmations after a one-line summary.
- --yes never approves commits, pushes, destructive file changes, paid Cloud upgrades, credential creation, or broad dependency upgrades.
- Non-interactive Cloud blockers fail with actionable recovery commands, not stack traces.
- --json includes mode, workflowName, workflowPath, runId, status, evidencePath, cloudUrl, warnings, and nextActions when available.`,
      verification: { type: 'exit_code', value: '0' },
    })
    .step('power-user-gate', {
      type: 'deterministic',
      dependsOn: ['implement-power-user-surface'],
      command: [
        'test -f src/surfaces/cli/flows/power-user-parser.ts',
        'grep -R "local\\|cloud\\|status\\|connect" src/surfaces/cli/commands src/surfaces/cli/flows/power-user-parser.ts',
        'grep -R "spec-file\\|workflow\\|background\\|foreground\\|auto-fix\\|yes\\|quiet\\|verbose" src/surfaces/cli/commands src/surfaces/cli/flows/power-user-parser.ts',
        'grep -R "destructive\\|credential\\|paid\\|commit\\|push" src/surfaces/cli/commands src/surfaces/cli/flows/power-user-parser.ts',
        'echo POWER_USER_SURFACE_GATE_PASS',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('implementation-diff-gate', {
      type: 'deterministic',
      dependsOn: [
        'prompt-shell-gate',
        'local-flow-gate',
        'cloud-flow-gate',
        'workforce-writer-gate',
        'power-user-gate',
      ],
      command: [
        'changed="$(git diff --name-only; git ls-files --others --exclude-standard)"',
        'printf "%s\\n" "$changed" > ' + artifactDir + '/changed-after-implementation.txt',
        'grep -Eq "^(package\\.json|package-lock\\.json|src/surfaces/cli|src/cloud|src/local|src/runtime|src/product/generation|test/)" ' + artifactDir + '/changed-after-implementation.txt',
        'echo IMPLEMENTATION_DIFF_GATE_PASS',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('create-path-complete-tests', {
      agent: 'tests-codex',
      dependsOn: ['implementation-diff-gate'],
      task: `Create deterministic tests for every path in ${artifactDir}/acceptance-matrix.md.

Own tests only, plus small exported test seams if absolutely necessary:
- src/surfaces/cli/commands/cli-main.test.ts
- src/surfaces/cli/entrypoint/interactive-cli.test.ts
- src/surfaces/cli/flows/*.test.ts
- src/product/generation/workforce-persona-writer.test.ts
- test/simplified-workflow-cli.e2e.test.ts

Required coverage:
- prompt cancellation, missing spec, spec file flow, editor spec flow, goal-to-spec flow, existing workflow flow
- local run confirmation: background, foreground, not now, edit first
- Cloud login missing and re-check, Cloud agents missing and re-check, optional integration skip
- power-user --json, --yes safety limits, --quiet, --verbose, status and connect commands
- non-interactive recovery text with no raw stack traces
- background evidence path, logs path, reattach command, and final summary

Tests must use injected fakes for prompts, Cloud APIs, Workforce harness calls, filesystem roots, and runner processes. Do not require live credentials, live Cloud, or live agent CLIs.`,
      verification: { type: 'file_exists', value: 'test/simplified-workflow-cli.e2e.test.ts' },
    })
    .step('test-coverage-gate', {
      type: 'deterministic',
      dependsOn: ['create-path-complete-tests'],
      command: [
        'test -f test/simplified-workflow-cli.e2e.test.ts',
        'grep -R "prompt cancellation\\|Ctrl\\+C\\|Abort" src/surfaces/cli test',
        'grep -R "spec file\\|editor\\|goal\\|existing workflow" src/surfaces/cli test',
        'grep -R "background\\|foreground\\|not now\\|edit" src/surfaces/cli test',
        'grep -R "Cloud login\\|missing agents\\|optional integration\\|Slack\\|GitHub\\|Notion\\|Linear" src/surfaces/cli src/cloud test',
        'grep -R -e "--json\\|--yes\\|quiet\\|verbose\\|safety" src/surfaces/cli test',
        'echo PATH_COMPLETE_TEST_COVERAGE_GATE_PASS',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('run-targeted-e2e-tests', {
      type: 'deterministic',
      dependsOn: ['test-coverage-gate'],
      command: 'npx vitest run test/simplified-workflow-cli.e2e.test.ts src/surfaces/cli/flows src/product/generation/workforce-persona-writer.test.ts 2>&1 | tee ' + artifactDir + '/targeted-e2e-initial.log',
      captureOutput: true,
      failOnError: false,
    })
    .step('fix-targeted-e2e-tests', {
      agent: 'validator-claude',
      dependsOn: ['run-targeted-e2e-tests'],
      task: `Follow the relay-80-100 test-fix-rerun pattern for targeted E2E failures.

Initial output:
{{steps.run-targeted-e2e-tests.output}}

If tests passed, write ${artifactDir}/targeted-e2e-fix.md ending with TARGETED_E2E_ALREADY_PASSING.
If tests failed:
- Read the failing tests and implementation files.
- Fix only the smallest product or test issue needed.
- Re-run: npx vitest run test/simplified-workflow-cli.e2e.test.ts src/surfaces/cli/flows src/product/generation/workforce-persona-writer.test.ts
- Keep iterating until all targeted E2E tests pass.
- Write ${artifactDir}/targeted-e2e-fix.md ending with TARGETED_E2E_FIX_LOOP_COMPLETE.`,
      verification: { type: 'file_exists', value: `${artifactDir}/targeted-e2e-fix.md` },
    })
    .step('run-targeted-e2e-tests-final', {
      type: 'deterministic',
      dependsOn: ['fix-targeted-e2e-tests'],
      command: 'npx vitest run test/simplified-workflow-cli.e2e.test.ts src/surfaces/cli/flows src/product/generation/workforce-persona-writer.test.ts 2>&1 | tee ' + artifactDir + '/targeted-e2e-final.log',
      captureOutput: true,
      failOnError: true,
    })

    .step('run-typecheck-soft', {
      type: 'deterministic',
      dependsOn: ['run-targeted-e2e-tests-final'],
      command: 'npx tsc --noEmit 2>&1 | tee ' + artifactDir + '/typecheck-initial.log',
      captureOutput: true,
      failOnError: false,
    })
    .step('fix-typecheck', {
      agent: 'validator-claude',
      dependsOn: ['run-typecheck-soft'],
      task: `Fix TypeScript failures from the captured output.

Typecheck output:
{{steps.run-typecheck-soft.output}}

If already passing, write ${artifactDir}/typecheck-fix.md ending with TYPECHECK_ALREADY_PASSING.
If failing, make bounded fixes and re-run npx tsc --noEmit until it passes.
Write ${artifactDir}/typecheck-fix.md ending with TYPECHECK_FIX_LOOP_COMPLETE.`,
      verification: { type: 'file_exists', value: `${artifactDir}/typecheck-fix.md` },
    })
    .step('run-typecheck-final', {
      type: 'deterministic',
      dependsOn: ['fix-typecheck'],
      command: 'npx tsc --noEmit 2>&1 | tee ' + artifactDir + '/typecheck-final.log',
      captureOutput: true,
      failOnError: true,
    })

    .step('run-full-regression-soft', {
      type: 'deterministic',
      dependsOn: ['run-typecheck-final'],
      command: 'npm test 2>&1 | tee ' + artifactDir + '/npm-test-initial.log',
      captureOutput: true,
      failOnError: false,
    })
    .step('fix-regressions', {
      agent: 'validator-claude',
      dependsOn: ['run-full-regression-soft'],
      task: `Fix regressions from the full test suite.

Regression output:
{{steps.run-full-regression-soft.output}}

If already passing, write ${artifactDir}/regression-fix.md ending with REGRESSION_ALREADY_PASSING.
If failing, find the broken contract, fix the smallest impacted files, and re-run npm test until it passes.
Do not weaken tests to hide a missing simplified CLI path.
Write ${artifactDir}/regression-fix.md ending with REGRESSION_FIX_LOOP_COMPLETE.`,
      verification: { type: 'file_exists', value: `${artifactDir}/regression-fix.md` },
    })
    .step('run-full-regression-final', {
      type: 'deterministic',
      dependsOn: ['fix-regressions'],
      command: 'npm test 2>&1 | tee ' + artifactDir + '/npm-test-final.log',
      captureOutput: true,
      failOnError: true,
    })

    .step('run-cli-smoke-final', {
      type: 'deterministic',
      dependsOn: ['run-full-regression-final'],
      command: [
        'npm start -- --help > ' + artifactDir + '/cli-help.txt',
        'npm start -- version > ' + artifactDir + '/cli-version.txt',
        'npm start -- local --spec "verify simplified CLI smoke" --name simplified-cli-smoke --no-run --json > ' + artifactDir + '/cli-local-json.txt',
        'node -e "const fs=require(\\"fs\\"); const text=fs.readFileSync(\\"' + artifactDir + '/cli-local-json.txt\\",\\"utf8\\"); if (!/workflowName|workflowPath|mode|nextActions|status/.test(text)) process.exit(1);"',
        'grep -E "local|cloud|status|connect|spec-file|workflow|background|foreground|json|quiet|verbose" ' + artifactDir + '/cli-help.txt',
        'echo CLI_SMOKE_FINAL_PASS',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('review-product-completeness', {
      agent: 'reviewer-claude',
      dependsOn: ['run-cli-smoke-final'],
      task: `Review the implementation against the simplified CLI spec and acceptance matrix.

Focus:
- The first screen is useful and compact.
- Local and Cloud flows are equivalent choices with no silent fallback.
- Workflow writing delegates to Workforce persona harnesses.
- Every path in ${artifactDir}/acceptance-matrix.md has a test or CLI smoke proof.
- Side effects and blockers are summarized before run actions.
- Missing accounts, credentials, providers, and tools are checked before claims.

Write ${artifactDir}/reviewer-claude.md ending with REVIEWER_CLAUDE_PASS or REVIEWER_CLAUDE_FAIL with concrete required fixes.`,
      verification: { type: 'file_exists', value: `${artifactDir}/reviewer-claude.md` },
    })
    .step('review-technical-completeness', {
      agent: 'reviewer-codex',
      dependsOn: ['run-cli-smoke-final'],
      task: `Review the implementation for code quality and test truth.

Focus:
- @inquirer/prompts usage is injectable and cancellation-safe.
- Parser behavior is scriptable, quiet by default, and does not throw raw stack traces for user errors.
- --yes safety limits are enforced in code, not just documented.
- Tests use fakes for Cloud, Workforce, providers, prompts, and runners.
- Background evidence paths and reattach commands are deterministic.
- No broad rewrites or unrelated refactors slipped in.

Write ${artifactDir}/reviewer-codex.md ending with REVIEWER_CODEX_PASS or REVIEWER_CODEX_FAIL with concrete required fixes.`,
      verification: { type: 'file_exists', value: `${artifactDir}/reviewer-codex.md` },
    })
    .step('review-pass-gate', {
      type: 'deterministic',
      dependsOn: ['review-product-completeness', 'review-technical-completeness'],
      command: [
        `grep -Eq "REVIEWER_CLAUDE_(PASS|FAIL)" ${artifactDir}/reviewer-claude.md`,
        `grep -Eq "REVIEWER_CODEX_(PASS|FAIL)" ${artifactDir}/reviewer-codex.md`,
        `if grep -F REVIEWER_CLAUDE_FAIL ${artifactDir}/reviewer-claude.md >/dev/null; then echo REVIEWER_CLAUDE_FAIL >> ${artifactDir}/review-status.txt; else echo REVIEWER_CLAUDE_PASS >> ${artifactDir}/review-status.txt; fi`,
        `if grep -F REVIEWER_CODEX_FAIL ${artifactDir}/reviewer-codex.md >/dev/null; then echo REVIEWER_CODEX_FAIL >> ${artifactDir}/review-status.txt; else echo REVIEWER_CODEX_PASS >> ${artifactDir}/review-status.txt; fi`,
        'echo REVIEW_ARTIFACT_GATE_PASS',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })
    .step('final-fix-loop', {
      agent: 'validator-claude',
      dependsOn: ['review-pass-gate'],
      task: `Apply final review feedback if anything remains. If both review artifacts pass with no requested fixes, do nothing.
If either artifact contains a FAIL marker, treat that as expected 80-to-100 review feedback, not as a terminal failure.

Read:
- ${artifactDir}/reviewer-claude.md
- ${artifactDir}/reviewer-codex.md
- ${artifactDir}/review-status.txt

For each required fix:
- Make the smallest code or test change that satisfies the review.
- Preserve user-facing honesty for unresolved external Cloud/open-question seams.
- Record the fix, files touched, and validation command in ${artifactDir}/final-fix-loop.md.

Then rerun:
- npx vitest run test/simplified-workflow-cli.e2e.test.ts src/surfaces/cli/flows src/product/generation/workforce-persona-writer.test.ts
- npx tsc --noEmit
- npm test
- npm start -- --help

Write ${artifactDir}/final-fix-loop.md ending with SIMPLIFIED_CLI_FINAL_FIX_LOOP_COMPLETE.`,
      verification: { type: 'file_exists', value: `${artifactDir}/final-fix-loop.md` },
    })
    .step('final-hard-validation', {
      type: 'deterministic',
      dependsOn: ['final-fix-loop'],
      command: [
        'npx vitest run test/simplified-workflow-cli.e2e.test.ts src/surfaces/cli/flows src/product/generation/workforce-persona-writer.test.ts',
        'npx tsc --noEmit',
        'npm test',
        'npm start -- --help',
        'echo SIMPLIFIED_CLI_FINAL_HARD_VALIDATION_PASS',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })
    .step('final-diff-and-scope-gate', {
      type: 'deterministic',
      dependsOn: ['final-hard-validation'],
      command: [
        'changed="$(git diff --name-only; git ls-files --others --exclude-standard)"',
        'printf "%s\\n" "$changed" > ' + artifactDir + '/final-changed-files.txt',
        `grep -Eq "^(${finalScopeAllowPattern})" ${artifactDir}/final-changed-files.txt`,
        `! grep -Ev "^(${finalScopeAllowPattern})" ${artifactDir}/final-changed-files.txt`,
        'echo SIMPLIFIED_CLI_FINAL_SCOPE_GATE_PASS',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })
    .step('signoff', {
      type: 'deterministic',
      dependsOn: ['final-diff-and-scope-gate'],
      command: [
        `DIR=${artifactDir}`,
        "cat > \"$DIR/signoff.md\" <<'EOF'",
        '# Ricky simplified workflow CLI signoff',
        '',
        'Implemented contract:',
        '- Compact @inquirer/prompts first screen.',
        '- Local guided spec intake, summary, and run confirmation.',
        '- Workforce persona workflow writer harness integration.',
        '- Cloud readiness, login recovery, agent connection, and integration paths.',
        '- Quiet power-user local/cloud/status/connect command surface.',
        '- Background local monitoring evidence and reattach path.',
        '',
        '80-to-100 evidence gates:',
        '- Targeted E2E tests passed.',
        '- Typecheck passed.',
        '- Full npm test passed.',
        '- CLI help/version/local JSON smoke passed.',
        '- Claude and Codex review artifacts were consumed and final fixes were validated.',
        '- Final scope gate passed.',
        '',
        'Commit boundary:',
        '- This workflow intentionally does not commit, push, or open a PR.',
        '- Operator should inspect final-changed-files.txt and signoff.md before committing.',
        '',
        'SIMPLIFIED_WORKFLOW_CLI_100_PERCENT_COMPLETE',
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
