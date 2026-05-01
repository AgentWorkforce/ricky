import { workflow } from '@agent-relay/sdk/workflows';

async function main() {
  const result = await workflow("ricky-i-want-to-clean-up-the-codebase-to-remove-outdat")
    .description("I want to clean up the codebase to remove outdated and unused files")
    .pattern("pipeline")
    .channel("wf-ricky-i-want-to-clean-up-the-codebase-to-remove-outdat")
    .maxConcurrency(1)
    .timeout(600000)
    .onError('fail-fast')

    .agent("lead-claude", { cli: "claude", role: "Plans the generated workflow deliverables, boundaries, and verification gates.", retries: 1 })
    .agent("author-codex", { cli: "codex", role: "Writes the requested bounded artifact and keeps scope to declared files.", retries: 2 })
    .agent("reviewer-claude", { cli: "claude", preset: "reviewer", role: "Reviews artifact quality, scope, and evidence.", retries: 1 })
    .agent("reviewer-codex", { cli: "codex", preset: "reviewer", role: "Reviews implementation practicality and deterministic checks.", retries: 1 })
    .agent("validator-claude", { cli: "claude", preset: "worker", role: "Applies bounded fixes and confirms final signoff evidence.", retries: 2 })

    .step("prepare-context", {
      type: 'deterministic',
      command: "mkdir -p '.workflow-artifacts/generated/i-want-to-clean-up-the-codebase-to-remove-outdat' && printf '%s\\n' 'I want to clean up the codebase to remove outdated and unused files' > '.workflow-artifacts/generated/i-want-to-clean-up-the-codebase-to-remove-outdat/normalized-spec.txt' && printf '%s\\n' 'pattern=pipeline; reason=Selected pipeline because the request is low risk and can proceed through a linear reliability ladder.' > '.workflow-artifacts/generated/i-want-to-clean-up-the-codebase-to-remove-outdat/pattern-decision.txt' && printf '%s\\n' 'writing-agent-relay-workflows confidence=0.4 reason=Project default skill loaded because no stronger registry trigger matched. evidence=fallback:writing-agent-relay-workflows' > '.workflow-artifacts/generated/i-want-to-clean-up-the-codebase-to-remove-outdat/loaded-skills.txt' && printf '%s\\n' '[{\"id\":\"writing-agent-relay-workflows\",\"name\":\"writing-agent-relay-workflows\",\"confidence\":0.4,\"reason\":\"Project default skill loaded because no stronger registry trigger matched.\",\"evidence\":[{\"trigger\":\"writing-agent-relay-workflows\",\"source\":\"fallback\",\"detail\":\"Fallback project workflow-generation skill.\"}]}]' > '.workflow-artifacts/generated/i-want-to-clean-up-the-codebase-to-remove-outdat/skill-matches.json' && printf '%s\\n' '[{\"stepId\":\"lead-plan\",\"agent\":\"lead-claude\",\"runner\":\"@agent-relay/sdk\",\"concurrency\":1,\"rule\":\"project default runner @agent-relay/sdk\"},{\"stepId\":\"implement-artifact\",\"agent\":\"author-codex\",\"runner\":\"@agent-relay/sdk\",\"concurrency\":1,\"rule\":\"project default runner @agent-relay/sdk\"},{\"stepId\":\"review-claude\",\"agent\":\"reviewer-claude\",\"runner\":\"@agent-relay/sdk\",\"concurrency\":1,\"rule\":\"project default runner @agent-relay/sdk\"},{\"stepId\":\"review-codex\",\"agent\":\"reviewer-codex\",\"runner\":\"@agent-relay/sdk\",\"concurrency\":1,\"rule\":\"project default runner @agent-relay/sdk\"},{\"stepId\":\"fix-loop\",\"agent\":\"validator-claude\",\"runner\":\"@agent-relay/sdk\",\"concurrency\":1,\"rule\":\"project default runner @agent-relay/sdk\"},{\"stepId\":\"final-review-claude\",\"agent\":\"reviewer-claude\",\"runner\":\"@agent-relay/sdk\",\"concurrency\":1,\"rule\":\"project default runner @agent-relay/sdk\"},{\"stepId\":\"final-review-codex\",\"agent\":\"reviewer-codex\",\"runner\":\"@agent-relay/sdk\",\"concurrency\":1,\"rule\":\"project default runner @agent-relay/sdk\"},{\"stepId\":\"final-signoff\",\"agent\":\"validator-claude\",\"runner\":\"@agent-relay/sdk\",\"concurrency\":1,\"rule\":\"project default runner @agent-relay/sdk\"}]' > '.workflow-artifacts/generated/i-want-to-clean-up-the-codebase-to-remove-outdat/tool-selection.json' && printf '%s\\n' '{\"behavior\":\"generation_time_only\",\"runtimeEmbodiment\":false,\"boundary\":\"Skills influence Ricky generator selection, loading, template rendering, workflow contract, validation gates, and metadata. Generated runtime agents receive only the rendered workflow instructions; they do not load or embody skill files at runtime.\",\"loadedSkills\":[\"writing-agent-relay-workflows\"],\"applicationEvidence\":[{\"skillName\":\"writing-agent-relay-workflows\",\"stage\":\"generation_selection\",\"effect\":\"workflow_contract\",\"behavior\":\"generation_time_only\",\"runtimeEmbodiment\":false,\"evidence\":\"Selected writing-agent-relay-workflows during workflow generation. Project default skill loaded because no stronger registry trigger matched.\"},{\"skillName\":\"writing-agent-relay-workflows\",\"stage\":\"generation_loading\",\"effect\":\"metadata\",\"behavior\":\"generation_time_only\",\"runtimeEmbodiment\":false,\"evidence\":\"Loaded writing-agent-relay-workflows descriptor before template rendering.\"},{\"skillName\":\"writing-agent-relay-workflows\",\"stage\":\"generation_rendering\",\"effect\":\"workflow_contract\",\"behavior\":\"generation_time_only\",\"runtimeEmbodiment\":false,\"evidence\":\"Rendered 10 workflow tasks with dedicated channel setup, explicit agents, step dependencies, review stages, and final signoff.\"}]}' > '.workflow-artifacts/generated/i-want-to-clean-up-the-codebase-to-remove-outdat/skill-application-boundary.json' && printf '%s\\n' 'Skills influence Ricky generator selection, loading, template rendering, workflow contract, validation gates, and metadata. Generated runtime agents receive only the rendered workflow instructions; they do not load or embody skill files at runtime.' > '.workflow-artifacts/generated/i-want-to-clean-up-the-codebase-to-remove-outdat/skill-runtime-boundary.txt' && : > '.workflow-artifacts/generated/i-want-to-clean-up-the-codebase-to-remove-outdat/matched-skills.md' && printf '%s\\n' '\n# writing-agent-relay-workflows\nreason=Project default skill loaded because no stronger registry trigger matched.\n' >> '.workflow-artifacts/generated/i-want-to-clean-up-the-codebase-to-remove-outdat/matched-skills.md' && printf '%s\\n' '---\nname: writing-agent-relay-workflows\ndescription: Use when building multi-agent workflows with the relay broker-sdk - covers the WorkflowBuilder API, DAG step dependencies, agent definitions, step output chaining via {{steps.X.output}}, verification gates, evidence-based completion, owner decisions, dedicated channels, dynamic channel management (subscribe/unsubscribe/mute/unmute), swarm patterns, error handling, event listeners, step sizing rules, authoring best practices, and the lead+workers team pattern for complex steps\n---\n\n### Overview\n\nThe relay broker-sdk workflow system orchestrates multiple AI agents (Claude, Codex, Gemini, Aider, Goose) through typed DAG-based workflows. Workflows can be written in **TypeScript** (preferred), **Python**, or **YAML**.\n\n**Language preference:** TypeScript > Python > YAML. Use TypeScript unless the project is Python-only or a simple config-driven workflow suits YAML.\n\n**Pattern selection:** Do not default to `dag` blindly. If the job needs a different swarm/workflow type, consult the `choosing-swarm-patterns` skill when available and select the pattern that best matches the coordination problem.\n\n### When to Use\n\n- Building multi-agent workflows with step dependencies\n- Orchestrating different AI CLIs (claude, codex, gemini, aider, goose)\n- Creating DAG, pipeline, fan-out, or other swarm patterns\n- Needing verification gates, retries, or step output chaining\n- Dynamic channel management: agents joining/leaving/muting channels mid-workflow\n\n### Quick Reference\n\n#### > **Note:** this Quick Reference assumes an **ESM** workflow file (the host `package.json` has `\"type\": \"module\"`). For CJS repos, see rule #1 in **Critical TypeScript rules** below — convert `import { workflow } from '\\''@agent-relay/sdk/workflows'\\''` to `const { workflow } = require('\\''@agent-relay/sdk/workflows'\\'')` and wrap the workflow in `async function main() { ... } main().catch(console.error)` since CJS does not support top-level `await`. **Always check `package.json` before copy-pasting the snippet.**\n\n```typescript\nimport { workflow } from '\\''@agent-relay/sdk/workflows'\\'';\n\nconst result = await workflow('\\''my-workflow'\\'')\n  .description('\\''What this workflow does'\\'')\n  .pattern('\\''dag'\\'') // or '\\''pipeline'\\'', '\\''fan-out'\\'', etc.\n  .channel('\\''wf-my-workflow'\\'') // dedicated channel (auto-generated if omitted)\n  .maxConcurrency(3)\n  .timeout(3_600_000) // global timeout (ms)\n\n  .agent('\\''lead'\\'', { cli: '\\''claude'\\'', role: '\\''Architect'\\'', retries: 2 })\n  .agent('\\''worker'\\'', { cli: '\\''codex'\\'', role: '\\''Implementer'\\'', retries: 2 })\n\n  .step('\\''plan'\\'', {\n    agent: '\\''lead'\\'',\n    task: `Analyze the codebase and produce a plan.`,\n    retries: 2,\n    verification: { type: '\\''output_contains'\\'', value: '\\''PLAN_COMPLETE'\\'' },\n  })\n  .step('\\''implement'\\'', {\n    agent: '\\''worker'\\'',\n    task: `Implement based on this plan:\\n{{steps.plan.output}}`,\n    dependsOn: ['\\''plan'\\''],\n    verification: { type: '\\''exit_code'\\'' },\n  })\n\n  .onError('\\''retry'\\'', { maxRetries: 2, retryDelayMs: 10_000 })\n  .run({ cwd: process.cwd() });\n\n  console.log('\\''Result:'\\'', result.status);\n```\n\n\n### ⚡ Parallelism — Design for Speed\n\n#### Cross-Workflow Parallelism: Wave Planning\n\n```bash\n# BAD — sequential (14 hours for 27 workflows at ~30 min each)\nagent-relay run workflows/34-sst-wiring.ts\nagent-relay run workflows/35-env-config.ts\nagent-relay run workflows/36-loading-states.ts\n# ... one at a time\n\n# GOOD — parallel waves (3-4 hours for 27 workflows)\n# Wave 1: independent infra (parallel)\nagent-relay run workflows/34-sst-wiring.ts &\nagent-relay run workflows/35-env-config.ts &\nagent-relay run workflows/36-loading-states.ts &\nagent-relay run workflows/37-responsive.ts &\nwait\ngit add -A && git commit -m \"Wave 1\"\n\n# Wave 2: testing (parallel — independent test suites)\nagent-relay run workflows/40-unit-tests.ts &\nagent-relay run workflows/41-integration-tests.ts &\nagent-relay run workflows/42-e2e-tests.ts &\nwait\ngit add -A && git commit -m \"Wave 2\"\n```\n\n#### Declare File Scope for Planning\n\n```typescript\nworkflow('\\''48-comparison-mode'\\'')\n  .packages(['\\''web'\\'', '\\''core'\\''])                // monorepo packages touched\n  .isolatedFrom(['\\''49-feedback-system'\\''])      // explicitly safe to parallelize\n  .requiresBefore(['\\''46-admin-dashboard'\\''])    // explicit ordering constraint\n```\n\n#### Within-Workflow Parallelism\n\n```typescript\n// BAD — unnecessary sequential chain\n.step('\\''fix-component-a'\\'', { agent: '\\''worker'\\'', dependsOn: ['\\''review'\\''] })\n.step('\\''fix-component-b'\\'', { agent: '\\''worker'\\'', dependsOn: ['\\''fix-component-a'\\''] })  // why wait?\n\n// GOOD — parallel fan-out, merge at the end\n.step('\\''fix-component-a'\\'', { agent: '\\''impl-1'\\'', dependsOn: ['\\''review'\\''] })\n.step('\\''fix-component-b'\\'', { agent: '\\''impl-2'\\'', dependsOn: ['\\''review'\\''] })  // same dep = parallel\n.step('\\''verify-all'\\'', { agent: '\\''reviewer'\\'', dependsOn: ['\\''fix-component-a'\\'', '\\''fix-component-b'\\''] })\n```\n\n\n### Failure Prevention\n\n#### 1. Do not use raw top-level `await`\n\n```ts\nasync function runWorkflow() {\n  const result = await workflow('\\''my-workflow'\\'')\n    // ...\n    .run({ cwd: process.cwd() });\n\n  console.log('\\''Workflow status:'\\'', result.status);\n}\n\nrunWorkflow().catch((error) => {\n  console.error(error);\n  process.exit(1);\n});\n```\n\n#### 2b. Standard preflight template for resumable workflows\n\n```ts\n.step('\\''preflight'\\'', {\n  type: '\\''deterministic'\\'',\n  command: [\n    '\\''set -e'\\'',\n    '\\''BRANCH=$(git rev-parse --abbrev-ref HEAD)'\\'',\n    '\\''echo \"branch: $BRANCH\"'\\'',\n    '\\''if [ \"$BRANCH\" != \"fix/your-branch-name\" ]; then echo \"ERROR: wrong branch\"; exit 1; fi'\\'',\n    // Files the workflow is allowed to find dirty on entry:\n    //   - package-lock.json: npm install is idempotent and often touches it\n    //   - every file the workflow'\\''s edit steps will rewrite: a prior partial\n    //     run may have left them dirty, and the edit step will rewrite\n    //     them cleanly before commit\n    // Everything else is unexpected drift and must fail preflight.\n    '\\''ALLOWED_DIRTY=\"package-lock.json|path/to/file1\\\\\\\\.ts|path/to/file2\\\\\\\\.ts\"'\\'',\n    '\\''DIRTY=$(git diff --name-only | grep -vE \"^(${ALLOWED_DIRTY})$\" || true)'\\'',\n    '\\''if [ -n \"$DIRTY\" ]; then echo \"ERROR: unexpected tracked drift:\"; echo \"$DIRTY\"; exit 1; fi'\\'',\n    '\\''if ! git diff --cached --quiet; then echo \"ERROR: staging area is dirty\"; git diff --cached --stat; exit 1; fi'\\'',\n    '\\''gh auth status >/dev/null 2>&1 || (echo \"ERROR: gh CLI not authenticated\"; exit 1)'\\'',\n    '\\''echo PREFLIGHT_OK'\\'',\n  ].join('\\'' && '\\''),\n  captureOutput: true,\n  failOnError: true,\n}),\n```\n\n#### 2c. Picking the right `.join()` for multi-line shell commands\n\n```ts\ncommand: [\n  '\\''set -e'\\'',\n  '\\''HITS=$(grep -c diag src/cli/commands/setup.ts || true)'\\'',\n  '\\''if [ \"$HITS\" -lt 6 ]; then echo \"FAIL\"; exit 1; fi'\\'',\n  '\\''echo OK'\\'',\n].join('\\'' && '\\''),\n```\n\n#### 3. Keep final verification boring and deterministic\n\n```bash\ngrep -Eq \"foo|bar|baz\" file.ts\n```\n\n#### 6. Be explicit about shell requirements\n\n```bash\n/opt/homebrew/bin/bash workflows/your-workflow/execute.sh --wave 2\n```\n\n#### 9. Factor repo-specific setup into a shared helper\n\n```ts\n// workflows/lib/cloud-repo-setup.ts\nexport interface CloudRepoSetupOptions {\n  branch: string;\n  committerName?: string;\n  extraSetupCommands?: string[];\n  skipWorkspaceBuild?: boolean;\n}\n\nexport function applyCloudRepoSetup<T>(wf: T, opts: CloudRepoSetupOptions): T {\n  // adds two steps: setup-branch, install-deps\n  // install-deps runs: npm install + workspace prebuilds (build:platform, build:core, etc.)\n  // ...\n}\n```\n\n\n### End-to-End Bug Fix Workflows\n\n- **Capture the original failure**\n- Reproduce the bug first in a deterministic or evidence-capturing step\n- Save exact commands, logs, status codes, or screenshots/artifacts\n- **State the acceptance contract**\n- Define the exact end-to-end success criteria before implementation\n- Include the real entrypoint a user would run\n- **Implement the fix**\n- **Rebuild / reinstall from scratch**\n- Do not trust dirty local state\n- Prefer a clean environment when install/bootstrap behavior is involved\n- **Run targeted regression checks**\n- Unit/integration tests are helpful but not sufficient by themselves\n- **Run a full end-to-end validation**\n- Use the real CLI / API / install path\n- Prefer a clean environment (Docker, sandbox, cloud workspace, Daytona, etc.) for install/runtime issues\n- **Compare before vs after evidence**\n- Show that the original failure no longer occurs\n- **Record residual risks**\n- Call out what was not covered\n- disposable sandbox / cloud workspace\n- Docker / containerized environment\n- fresh local shell with isolated paths\n- compares candidate validation environments\n- defines the acceptance contract\n- chooses the best swarm pattern\n- then authors the final fix/validation workflow\n\n### Key Concepts\n\n#### Verification Gates\n\n```typescript\nverification: { type: '\\''exit_code'\\'' }                        // preferred for code-editing steps\nverification: { type: '\\''output_contains'\\'', value: '\\''DONE'\\'' }   // optional accelerator\nverification: { type: '\\''file_exists'\\'', value: '\\''src/out.ts'\\'' } // deterministic file check\n```\n\n#### DAG Dependencies\n\n```typescript\n.step('\\''fix-types'\\'',  { agent: '\\''worker'\\'', dependsOn: ['\\''review'\\''], ... })\n.step('\\''fix-tests'\\'',  { agent: '\\''worker'\\'', dependsOn: ['\\''review'\\''], ... })\n.step('\\''final'\\'',      { agent: '\\''lead'\\'',   dependsOn: ['\\''fix-types'\\'', '\\''fix-tests'\\''], ... })\n```\n\n#### SDK API\n\n```typescript\n// Subscribe an agent to additional channels post-spawn\nrelay.subscribe({ agent: '\\''security-auditor'\\'', channels: ['\\''review-pr-456'\\''] });\n\n// Unsubscribe — agent leaves the channel entirely\nrelay.unsubscribe({ agent: '\\''security-auditor'\\'', channels: ['\\''general'\\''] });\n\n// Mute — agent stays subscribed (history access) but messages are NOT injected into PTY\nrelay.mute({ agent: '\\''security-auditor'\\'', channel: '\\''review-pr-123'\\'' });\n\n// Unmute — resume PTY injection\nrelay.unmute({ agent: '\\''security-auditor'\\'', channel: '\\''review-pr-123'\\'' });\n```\n\n#### Events\n\n```typescript\nrelay.onChannelSubscribed = (agent, channels) => { /* ... */ };\nrelay.onChannelUnsubscribed = (agent, channels) => { /* ... */ };\nrelay.onChannelMuted = (agent, channel) => { /* ... */ };\nrelay.onChannelUnmuted = (agent, channel) => { /* ... */ };\n```\n\n\n### Agent Definition\n\n#### ```typescript\n\n```typescript\n.agent('\\''name'\\'', {\n  cli: '\\''claude'\\'' | '\\''codex'\\'' | '\\''gemini'\\'' | '\\''aider'\\'' | '\\''goose'\\'' | '\\''opencode'\\'' | '\\''droid'\\'',\n  role?: string,\n  preset?: '\\''lead'\\'' | '\\''worker'\\'' | '\\''reviewer'\\'' | '\\''analyst'\\'',\n  retries?: number,\n  model?: string,\n  interactive?: boolean, // default: true\n})\n```\n\n#### Model Constants\n\n```typescript\nimport { ClaudeModels, CodexModels, GeminiModels } from '\\''@agent-relay/config'\\'';\n\n.agent('\\''planner'\\'', { cli: '\\''claude'\\'', model: ClaudeModels.OPUS })    // not '\\''opus'\\''\n.agent('\\''worker'\\'',  { cli: '\\''claude'\\'', model: ClaudeModels.SONNET })  // not '\\''sonnet'\\''\n.agent('\\''coder'\\'',   { cli: '\\''codex'\\'',  model: CodexModels.GPT_5_4 })  // not '\\''gpt-5.4'\\''\n```\n\n\n### Step Definition\n\n#### Agent Steps\n\n```typescript\n.step('\\''name'\\'', {\n  agent: string,\n  task: string,                   // supports {{var}} and {{steps.NAME.output}}\n  dependsOn?: string[],\n  verification?: VerificationCheck,\n  retries?: number,\n})\n```\n\n#### Deterministic Steps (Shell Commands)\n\n```typescript\n.step('\\''verify-files'\\'', {\n  type: '\\''deterministic'\\'',\n  command: '\\''test -f src/auth.ts && echo \"FILE_EXISTS\"'\\'',\n  dependsOn: ['\\''implement'\\''],\n  captureOutput: true,\n  failOnError: true,\n})\n```\n\n\n### Common Patterns\n\n#### Interactive Team (lead + workers on shared channel)\n\n```typescript\n.agent('\\''lead'\\'', {\n  cli: '\\''claude'\\'',\n  model: ClaudeModels.OPUS,\n  role: '\\''Architect and reviewer — assigns work, reviews, posts feedback'\\'',\n  retries: 1,\n  // No preset — interactive by default\n})\n\n.agent('\\''impl-new'\\'', {\n  cli: '\\''codex'\\'',\n  model: CodexModels.O3,\n  role: '\\''Creates new files. Listens on channel for assignments and feedback.'\\'',\n  retries: 2,\n  // No preset — interactive, receives channel messages\n})\n\n.agent('\\''impl-modify'\\'', {\n  cli: '\\''codex'\\'',\n  model: CodexModels.O3,\n  role: '\\''Edits existing files. Listens on channel for assignments and feedback.'\\'',\n  retries: 2,\n})\n\n// All three share the same dependsOn — they start concurrently (no deadlock)\n.step('\\''lead-coordinate'\\'', {\n  agent: '\\''lead'\\'',\n  dependsOn: ['\\''context'\\''],\n  task: `You are the lead on #channel. Workers: impl-new, impl-modify.\nPost the plan. Assign files. Review their work. Post feedback if needed.\nWorkers iterate based on your feedback. Exit when all files are correct.`,\n})\n.step('\\''impl-new-work'\\'', {\n  agent: '\\''impl-new'\\'',\n  dependsOn: ['\\''context'\\''],   // same dep as lead = parallel start\n  task: `You are impl-new on #channel. Wait for the lead'\\''s plan.\nCreate files as assigned. Report completion. Fix issues from feedback.`,\n})\n.step('\\''impl-modify-work'\\'', {\n  agent: '\\''impl-modify'\\'',\n  dependsOn: ['\\''context'\\''],   // same dep as lead = parallel start\n  task: `You are impl-modify on #channel. Wait for the lead'\\''s plan.\nEdit files as assigned. Report completion. Fix issues from feedback.`,\n})\n// Downstream gates on lead (lead exits when satisfied)\n.step('\\''verify'\\'', { type: '\\''deterministic'\\'', dependsOn: ['\\''lead-coordinate'\\''], ... })\n```\n\n#### Pipeline (sequential handoff)\n\n```typescript\n.pattern('\\''pipeline'\\'')\n.step('\\''analyze'\\'', { agent: '\\''analyst'\\'', task: '\\''...'\\'' })\n.step('\\''implement'\\'', { agent: '\\''dev'\\'', task: '\\''{{steps.analyze.output}}'\\'', dependsOn: ['\\''analyze'\\''] })\n.step('\\''test'\\'', { agent: '\\''tester'\\'', task: '\\''{{steps.implement.output}}'\\'', dependsOn: ['\\''implement'\\''] })\n```\n\n#### Error Handling\n\n```typescript\n.onError('\\''fail-fast'\\'')   // stop on first failure (default)\n.onError('\\''continue'\\'')    // skip failed branches, continue others\n.onError('\\''retry'\\'', { maxRetries: 3, retryDelayMs: 5000 })\n```\n\n\n### Multi-File Edit Pattern\n\n#### When a workflow needs to modify multiple existing files, **use one agent step per file** with a deterministic verify gate after each. Agents reliably edit 1-2 files per step but fail on 4+.\n\n```yaml\nsteps:\n  - name: read-types\n    type: deterministic\n    command: cat src/types.ts\n    captureOutput: true\n\n  - name: edit-types\n    agent: dev\n    dependsOn: [read-types]\n    task: |\n      Edit src/types.ts. Current contents:\n      {{steps.read-types.output}}\n      Add '\\''pending'\\'' to the Status union type.\n      Only edit this one file.\n    verification:\n      type: exit_code\n\n  - name: verify-types\n    type: deterministic\n    dependsOn: [edit-types]\n    command: '\\''if git diff --quiet src/types.ts; then echo \"NOT MODIFIED\"; exit 1; fi; echo \"OK\"'\\''\n    failOnError: true\n\n  - name: read-service\n    type: deterministic\n    dependsOn: [verify-types]\n    command: cat src/service.ts\n    captureOutput: true\n\n  - name: edit-service\n    agent: dev\n    dependsOn: [read-service]\n    task: |\n      Edit src/service.ts. Current contents:\n      {{steps.read-service.output}}\n      Add a handlePending() method.\n      Only edit this one file.\n    verification:\n      type: exit_code\n\n  - name: verify-service\n    type: deterministic\n    dependsOn: [edit-service]\n    command: '\\''if git diff --quiet src/service.ts; then echo \"NOT MODIFIED\"; exit 1; fi; echo \"OK\"'\\''\n    failOnError: true\n\n  # Deterministic commit — never rely on agents to commit\n  - name: commit\n    type: deterministic\n    dependsOn: [verify-service]\n    command: git add src/types.ts src/service.ts && git commit -m \"feat: add pending status\"\n    failOnError: true\n```\n\n\n### File Materialization: Verify Before Proceeding\n\n#### After any step that creates files, add a deterministic `file_exists` check before proceeding. Non-interactive agents may exit 0 without writing anything (wrong cwd, stdout instead of disk).\n\n```yaml\n- name: verify-files\n  type: deterministic\n  dependsOn: [impl-auth, impl-storage]\n  command: |\n    missing=0\n    for f in src/auth/credentials.ts src/storage/client.ts; do\n      if [ ! -f \"$f\" ]; then echo \"MISSING: $f\"; missing=$((missing+1)); fi\n    done\n    if [ $missing -gt 0 ]; then echo \"$missing files missing\"; exit 1; fi\n    echo \"All files present\"\n  failOnError: true\n```\n\n\n### DAG Deadlock Anti-Pattern\n\n#### ```yaml\n\n```yaml\n# WRONG — deadlock: coordinate depends on context, work-a depends on coordinate\nsteps:\n  - name: coordinate\n    dependsOn: [context]    # lead waits for WORKER_DONE...\n  - name: work-a\n    dependsOn: [coordinate] # ...but work-a can'\\''t start until coordinate finishes\n\n# RIGHT — workers and lead start in parallel\nsteps:\n  - name: context\n    type: deterministic\n  - name: work-a\n    dependsOn: [context]    # starts with lead\n  - name: coordinate\n    dependsOn: [context]    # starts with workers\n  - name: merge\n    dependsOn: [work-a, coordinate]\n```\n\n\n### Step Sizing\n\n#### **One agent, one deliverable.** A step'\\''s task prompt should be 10-20 lines max.\n\n```yaml\n# Team pattern: lead + workers on a shared channel\nsteps:\n  - name: track-lead-coord\n    agent: track-lead\n    dependsOn: [prior-step]\n    task: |\n      Lead the track on #my-track. Workers: track-worker-1, track-worker-2.\n      Post assignments to the channel. Review worker output.\n\n  - name: track-worker-1-impl\n    agent: track-worker-1\n    dependsOn: [prior-step]  # same dep as lead — starts concurrently\n    task: |\n      Join #my-track. track-lead will post your assignment.\n      Implement the file as directed.\n    verification:\n      type: exit_code\n\n  - name: next-step\n    dependsOn: [track-lead-coord]  # downstream depends on lead, not workers\n```\n\n\n### Supervisor Pattern\n\nWhen you set `.pattern('\\''supervisor'\\'')` (or `hub-spoke`, `fan-out`), the runner auto-assigns a supervisor agent as owner for worker steps. The supervisor monitors progress, nudges idle workers, and issues `OWNER_DECISION`.\n\n**Auto-hardening only activates for hub patterns** — not `pipeline` or `dag`.\n\n| Use case | Pattern | Why |\n|----------|---------|-----|\n| Sequential, no monitoring | `pipeline` | Simple, no overhead |\n| Workers need oversight | `supervisor` | Auto-owner monitors |\n| Local/small models | `supervisor` | Supervisor catches stuck workers |\n| All non-interactive | `pipeline` or `dag` | No PTY = no supervision needed |\n\n### Concurrency\n\n**Cap `maxConcurrency` at 4-6.** Spawning 10+ agents simultaneously causes broker timeouts.\n\n| Parallel agents | `maxConcurrency` |\n|-----------------|-------------------|\n| 2-4             | 4 (default safe)  |\n| 5-10            | 5                 |\n| 10+             | 6-8 max           |\n\n### Common Mistakes\n\n| Mistake | Fix |\n|---------|-----|\n| All workflows run sequentially | Group independent workflows into parallel waves (4-7x speedup) |\n| Every step depends on the previous one | Only add `dependsOn` when there'\\''s a real data dependency |\n| Self-review step with no timeout | Set `timeout: 300_000` (5 min) — Codex hangs in non-interactive review |\n| One giant workflow per feature | Split into smaller workflows that can run in parallel waves |\n| Adding exit instructions to tasks | Runner handles self-termination automatically |\n| Setting `timeoutMs` on agents/steps | Use global `.timeout()` only |\n| Using `general` channel | Set `.channel('\\''wf-name'\\'')` for isolation |\n| `{{steps.X.output}}` without `dependsOn: ['\\''X'\\'']` | Output won'\\''t be available yet |\n| Requiring exact sentinel as only completion gate | Use `exit_code` or `file_exists` verification |\n| Writing 100-line task prompts | Split into lead + workers on a channel |\n| `maxConcurrency: 16` with many parallel steps | Cap at 5-6 |\n| Non-interactive agent reading large files via tools | Pre-read in deterministic step, inject via `{{steps.X.output}}` |\n| Workers depending on lead step (deadlock) | Both depend on shared context step |\n| `fan-out`/`hub-spoke` for simple parallel workers | Use `dag` instead |\n| `pipeline` but expecting auto-supervisor | Only hub patterns auto-harden. Use `.pattern('\\''supervisor'\\'')` |\n| Workers without `preset: '\\''worker'\\''` in one-shot DAG lead+worker flows | Add preset for clean stdout when chaining `{{steps.X.output}}` (not needed for interactive team patterns) |\n| Using `_` in YAML numbers (`timeoutMs: 1_200_000`) | YAML doesn'\\''t support `_` separators |\n| Workflow timeout under 30 min for complex workflows | Use `3600000` (1 hour) as default |\n| Using `require()` in ESM projects | Check `package.json` for `\"type\": \"module\"` — use `import` if ESM |\n| Wrapping in `async function main()` in ESM | ESM supports top-level `await` — no wrapper needed |\n| Using `createWorkflowRenderer` | Does not exist. Use `.run({ cwd: process.cwd() })` |\n| `export default workflow(...)...build()` | No `.build()`. Chain ends with `.run()` — the file must call `.run()`, not just export config |\n| Relative import `'\\''../workflows/builder.js'\\''` | Use `import { workflow } from '\\''@agent-relay/sdk/workflows'\\''` |\n| Hardcoded model strings (`model: '\\''opus'\\''`) | Use constants: `import { ClaudeModels } from '\\''@agent-relay/config'\\''` → `model: ClaudeModels.OPUS` |\n| Thinking `agent-relay run` inspects exports | It executes the file as a subprocess. Only `.run()` invocations trigger steps |\n| `pattern('\\''single'\\'')` on cloud runner | Not supported — use `dag` |\n| `pattern('\\''supervisor'\\'')` with one agent | Same agent is owner + specialist. Use `dag` |\n| Invalid verification type (`type: '\\''deterministic'\\''`) | Only `exit_code`, `output_contains`, `file_exists`, `custom` are valid |\n| Chaining `{{steps.X.output}}` from interactive agents | PTY output is garbled. Use deterministic steps or `preset: '\\''worker'\\''` |\n| Single step editing 4+ files | Agents modify 1-2 then exit. Split to one file per step with verify gates |\n| Relying on agents to `git commit` | Agents emit markers without running git. Use deterministic commit step |\n| File-writing steps without `file_exists` verification | `exit_code` auto-passes even if no file written |\n| Manual peer fanout in `handleChannelMessage()` | Use broker-managed channel subscriptions — broker fans out to all subscribers automatically |\n| Client-side `personaNames.has(from)` filtering | Use `relay.subscribe()`/`relay.unsubscribe()` — only subscribed agents receive messages |\n| Agents receiving noisy cross-channel messages during focused work | Use `relay.mute({ agent, channel })` to silence non-primary channels without leaving them |\n| Hardcoding all channels at spawn time | Use `agent.subscribe()` / `agent.unsubscribe()` for dynamic channel membership post-spawn |\n| Using `preset: '\\''worker'\\''` for Codex in *interactive team* patterns when coordination is needed | Codex interactive mode works fine with PTY channel injection. Drop the preset for interactive team patterns (keep it for one-shot DAG workers where clean stdout matters) |\n| Separate reviewer agent from lead in interactive team | Merge lead + reviewer into one interactive Claude agent — reviews between rounds, fewer agents |\n| Not printing PR URL after `gh pr create` | Add a final deterministic step: `echo \"PR: $(cat pr-url.txt)\"` or capture in the `gh pr create` command |\n| Workflow ending without worktree + PR for cross-repo changes | Add `setup-worktree` at start and `push-and-pr` + `cleanup-worktree` at end |\n\n### YAML Alternative\n\n#### ```yaml\n\n```yaml\nversion: '\\''1.0'\\''\nname: my-workflow\nswarm:\n  pattern: dag\n  channel: wf-my-workflow\nagents:\n  - name: lead\n    cli: claude\n    role: Architect\n  - name: worker\n    cli: codex\n    role: Implementer\nworkflows:\n  - name: default\n    steps:\n      - name: plan\n        agent: lead\n        task: '\\''Produce a detailed implementation plan.'\\''\n      - name: implement\n        agent: worker\n        task: '\\''Implement: {{steps.plan.output}}'\\''\n        dependsOn: [plan]\n        verification:\n          type: exit_code\n```\n\n\n### Available Swarm Patterns\n\n`dag` (default), `fan-out`, `pipeline`, `hub-spoke`, `consensus`, `mesh`, `handoff`, `cascade`, `debate`, `hierarchical`, `map-reduce`, `scatter-gather`, `supervisor`, `reflection`, `red-team`, `verifier`, `auction`, `escalation`, `saga`, `circuit-breaker`, `blackboard`, `swarm`\n\nSee skill `choosing-swarm-patterns` for pattern selection guidance.\n' >> '.workflow-artifacts/generated/i-want-to-clean-up-the-codebase-to-remove-outdat/matched-skills.md' && echo GENERATED_WORKFLOW_CONTEXT_READY",
      captureOutput: true,
      failOnError: true,
    })

    .step("skill-boundary-metadata-gate", {
      type: 'deterministic',
      dependsOn: ["prepare-context"],
      command: "test -f '.workflow-artifacts/generated/i-want-to-clean-up-the-codebase-to-remove-outdat/skill-application-boundary.json' && test -f '.workflow-artifacts/generated/i-want-to-clean-up-the-codebase-to-remove-outdat/skill-matches.json' && test -f '.workflow-artifacts/generated/i-want-to-clean-up-the-codebase-to-remove-outdat/tool-selection.json' && grep -F 'generation_time_only' '.workflow-artifacts/generated/i-want-to-clean-up-the-codebase-to-remove-outdat/skill-application-boundary.json' && grep -F '\"runtimeEmbodiment\":false' '.workflow-artifacts/generated/i-want-to-clean-up-the-codebase-to-remove-outdat/skill-application-boundary.json' && grep -F 'writing-agent-relay-workflows' '.workflow-artifacts/generated/i-want-to-clean-up-the-codebase-to-remove-outdat/skill-application-boundary.json' && grep -F '\"stage\":\"generation_selection\"' '.workflow-artifacts/generated/i-want-to-clean-up-the-codebase-to-remove-outdat/skill-application-boundary.json' && grep -F '\"stage\":\"generation_loading\"' '.workflow-artifacts/generated/i-want-to-clean-up-the-codebase-to-remove-outdat/skill-application-boundary.json' && grep -F '\"effect\":\"metadata\"' '.workflow-artifacts/generated/i-want-to-clean-up-the-codebase-to-remove-outdat/skill-application-boundary.json' && grep -F '\"stage\":\"generation_rendering\"' '.workflow-artifacts/generated/i-want-to-clean-up-the-codebase-to-remove-outdat/skill-application-boundary.json' && grep -F '\"effect\":\"workflow_contract\"' '.workflow-artifacts/generated/i-want-to-clean-up-the-codebase-to-remove-outdat/skill-application-boundary.json'",
      captureOutput: true,
      failOnError: true,
    })

    .step('lead-plan', {
      agent: 'lead-claude',
      dependsOn: ['skill-boundary-metadata-gate'],
      task: `Plan the workflow execution from the normalized spec.

Generation-time skill boundary:
- Read .workflow-artifacts/generated/i-want-to-clean-up-the-codebase-to-remove-outdat/skill-application-boundary.json and treat it as generator metadata only.
- Skills are applied by Ricky during selection, loading, and template rendering.
- Do not claim generated agents load, retain, or embody skill files at runtime unless a future runtime test proves that path.

Description:
I want to clean up the codebase to remove outdated and unused files

Deliverables:
- A generated workflow artifact and any requested output files

Non-goals:
- None declared

Verification commands:
- file_exists gate for declared targets
- grep sanity gate
- npx tsc --noEmit
- npx vitest run
- git diff --name-only gate

Write .workflow-artifacts/generated/i-want-to-clean-up-the-codebase-to-remove-outdat/lead-plan.md ending with GENERATION_LEAD_PLAN_READY.`,
      verification: { type: 'file_exists', value: ".workflow-artifacts/generated/i-want-to-clean-up-the-codebase-to-remove-outdat/lead-plan.md" },
    })

    .step('implement-artifact', {
      agent: "author-codex",
      dependsOn: ['lead-plan'],

      task: `Author the requested workflow artifact.

Scope:
I want to clean up the codebase to remove outdated and unused files

Own only declared targets unless review feedback explicitly narrows a required fix:
- No explicit file targets were supplied. Write all created file paths (one per line) to .workflow-artifacts/generated/i-want-to-clean-up-the-codebase-to-remove-outdat/output-manifest.txt. Keep changes bounded.

Acceptance gates:
- None declared

Tool selection: runner=@agent-relay/sdk; concurrency=1; rule=project default runner @agent-relay/sdk.

Before editing, read .workflow-artifacts/generated/i-want-to-clean-up-the-codebase-to-remove-outdat/matched-skills.md when it exists and use it only as generation-time context for this task.

Keep execution routing explicit for local, cloud, and MCP callers. Materialize outputs to disk, then stop for deterministic gates.`,
    })

    .step("post-implementation-file-gate", {
      type: 'deterministic',
      dependsOn: ["implement-artifact"],
      command: "test -f '.workflow-artifacts/generated/i-want-to-clean-up-the-codebase-to-remove-outdat/output-manifest.txt' && test -s '.workflow-artifacts/generated/i-want-to-clean-up-the-codebase-to-remove-outdat/output-manifest.txt' && while IFS= read -r f; do test -f \"$f\"; done < '.workflow-artifacts/generated/i-want-to-clean-up-the-codebase-to-remove-outdat/output-manifest.txt'",
      captureOutput: true,
      failOnError: true,
    })

    .step("initial-soft-validation", {
      type: 'deterministic',
      dependsOn: ["post-implementation-file-gate"],
      command: "npx tsc --noEmit && npx vitest run",
      captureOutput: true,
      failOnError: false,
    })

    .step("review-claude", {
      agent: "reviewer-claude",
      dependsOn: ["initial-soft-validation"],

      task: `Review the generated work.

Assess:
- declared file targets and non-goals
- deterministic gates and evidence quality
- review/fix/final-review 80-to-100 loop shape
- local/cloud/MCP routing clarity

Spec:
I want to clean up the codebase to remove outdated and unused files

Tool selection: runner=@agent-relay/sdk; concurrency=1; rule=project default runner @agent-relay/sdk.

Write .workflow-artifacts/generated/i-want-to-clean-up-the-codebase-to-remove-outdat/review-claude.md ending with REVIEW_COMPLETE.`,
      verification: { type: 'file_exists', value: ".workflow-artifacts/generated/i-want-to-clean-up-the-codebase-to-remove-outdat/review-claude.md" },
    })

    .step("review-codex", {
      agent: "reviewer-codex",
      dependsOn: ["initial-soft-validation"],

      task: `Review the generated work.

Assess:
- declared file targets and non-goals
- deterministic gates and evidence quality
- review/fix/final-review 80-to-100 loop shape
- local/cloud/MCP routing clarity

Spec:
I want to clean up the codebase to remove outdated and unused files

Tool selection: runner=@agent-relay/sdk; concurrency=1; rule=project default runner @agent-relay/sdk.

Write .workflow-artifacts/generated/i-want-to-clean-up-the-codebase-to-remove-outdat/review-codex.md ending with REVIEW_COMPLETE.`,
      verification: { type: 'file_exists', value: ".workflow-artifacts/generated/i-want-to-clean-up-the-codebase-to-remove-outdat/review-codex.md" },
    })

    .step("read-review-feedback", {
      type: 'deterministic',
      dependsOn: ["review-claude", "review-codex"],
      command: "test -f '.workflow-artifacts/generated/i-want-to-clean-up-the-codebase-to-remove-outdat/review-claude.md' && test -f '.workflow-artifacts/generated/i-want-to-clean-up-the-codebase-to-remove-outdat/review-codex.md' && cat '.workflow-artifacts/generated/i-want-to-clean-up-the-codebase-to-remove-outdat/review-claude.md' '.workflow-artifacts/generated/i-want-to-clean-up-the-codebase-to-remove-outdat/review-codex.md' > '.workflow-artifacts/generated/i-want-to-clean-up-the-codebase-to-remove-outdat/review-feedback.md'",
      captureOutput: true,
      failOnError: true,
    })

    .step('fix-loop', {
      agent: 'validator-claude',
      dependsOn: ['read-review-feedback'],

      task: `Run the 80-to-100 fix loop.

Inputs:
- .workflow-artifacts/generated/i-want-to-clean-up-the-codebase-to-remove-outdat/review-feedback.md
- initial validation output from the previous deterministic step

Fix only concrete review or validation findings. Preserve the declared target boundary:
- No explicit targets supplied

Tool selection: runner=@agent-relay/sdk; concurrency=1; rule=project default runner @agent-relay/sdk.

Re-run document sanity checks before handing off to post-fix validation.`,
    })

    .step("post-fix-verification-gate", {
      type: 'deterministic',
      dependsOn: ["fix-loop"],
      command: "test -f '.workflow-artifacts/generated/i-want-to-clean-up-the-codebase-to-remove-outdat/output-manifest.txt' && test -s '.workflow-artifacts/generated/i-want-to-clean-up-the-codebase-to-remove-outdat/output-manifest.txt' && while IFS= read -r f; do test -f \"$f\"; done < '.workflow-artifacts/generated/i-want-to-clean-up-the-codebase-to-remove-outdat/output-manifest.txt'",
      captureOutput: true,
      failOnError: true,
    })

    .step("post-fix-validation", {
      type: 'deterministic',
      dependsOn: ["post-fix-verification-gate"],
      command: "npx tsc --noEmit && npx vitest run",
      captureOutput: true,
      failOnError: false,
    })

    .step("final-review-claude", {
      agent: "reviewer-claude",
      dependsOn: ["post-fix-validation"],

      task: `Re-review the fixed state only.

Assess:
- declared file targets and non-goals
- deterministic gates and evidence quality
- review/fix/final-review 80-to-100 loop shape
- local/cloud/MCP routing clarity

Spec:
I want to clean up the codebase to remove outdated and unused files

Tool selection: runner=@agent-relay/sdk; concurrency=1; rule=project default runner @agent-relay/sdk.

Write .workflow-artifacts/generated/i-want-to-clean-up-the-codebase-to-remove-outdat/final-review-claude.md ending with FINAL_REVIEW_CLAUDE_PASS.`,
      verification: { type: 'file_exists', value: ".workflow-artifacts/generated/i-want-to-clean-up-the-codebase-to-remove-outdat/final-review-claude.md" },
    })

    .step("final-review-codex", {
      agent: "reviewer-codex",
      dependsOn: ["post-fix-validation"],

      task: `Re-review the fixed state only.

Assess:
- declared file targets and non-goals
- deterministic gates and evidence quality
- review/fix/final-review 80-to-100 loop shape
- local/cloud/MCP routing clarity

Spec:
I want to clean up the codebase to remove outdated and unused files

Tool selection: runner=@agent-relay/sdk; concurrency=1; rule=project default runner @agent-relay/sdk.

Write .workflow-artifacts/generated/i-want-to-clean-up-the-codebase-to-remove-outdat/final-review-codex.md ending with FINAL_REVIEW_CODEX_PASS.`,
      verification: { type: 'file_exists', value: ".workflow-artifacts/generated/i-want-to-clean-up-the-codebase-to-remove-outdat/final-review-codex.md" },
    })

    .step("final-review-pass-gate", {
      type: 'deterministic',
      dependsOn: ["final-review-claude", "final-review-codex"],
      command: "tail -n 1 '.workflow-artifacts/generated/i-want-to-clean-up-the-codebase-to-remove-outdat/final-review-claude.md' | tr -d '[:space:]*' | grep -Eq '^FINAL_REVIEW_CLAUDE_PASS$' && tail -n 1 '.workflow-artifacts/generated/i-want-to-clean-up-the-codebase-to-remove-outdat/final-review-codex.md' | tr -d '[:space:]*' | grep -Eq '^FINAL_REVIEW_CODEX_PASS$'",
      captureOutput: true,
      failOnError: true,
    })

    .step("final-hard-validation", {
      type: 'deterministic',
      dependsOn: ["final-review-pass-gate"],
      command: "npx tsc --noEmit && npx vitest run",
      captureOutput: true,
      failOnError: true,
    })

    .step("git-diff-gate", {
      type: 'deterministic',
      dependsOn: ["final-hard-validation"],
      command: "test -s '.workflow-artifacts/generated/i-want-to-clean-up-the-codebase-to-remove-outdat/output-manifest.txt' && : > '.workflow-artifacts/generated/i-want-to-clean-up-the-codebase-to-remove-outdat/git-diff.txt' && while IFS= read -r f; do { git diff --name-only -- \"$f\"; git ls-files --others --exclude-standard -- \"$f\"; } >> '.workflow-artifacts/generated/i-want-to-clean-up-the-codebase-to-remove-outdat/git-diff.txt'; done < '.workflow-artifacts/generated/i-want-to-clean-up-the-codebase-to-remove-outdat/output-manifest.txt' && sort -u '.workflow-artifacts/generated/i-want-to-clean-up-the-codebase-to-remove-outdat/git-diff.txt' -o '.workflow-artifacts/generated/i-want-to-clean-up-the-codebase-to-remove-outdat/git-diff.txt' && test -s '.workflow-artifacts/generated/i-want-to-clean-up-the-codebase-to-remove-outdat/git-diff.txt'",
      captureOutput: true,
      failOnError: true,
    })

    .step("regression-gate", {
      type: 'deterministic',
      dependsOn: ["git-diff-gate"],
      command: "git diff --check",
      captureOutput: true,
      failOnError: true,
    })

    .step('final-signoff', {
      agent: 'validator-claude',
      dependsOn: ['regression-gate'],

      task: `Write .workflow-artifacts/generated/i-want-to-clean-up-the-codebase-to-remove-outdat/signoff.md.

Include:
- files changed
- dry-run command to execute before runtime launch
- deterministic validation commands
- review verdicts
- skill application boundary from .workflow-artifacts/generated/i-want-to-clean-up-the-codebase-to-remove-outdat/skill-application-boundary.json
- remaining risks or environmental blockers

Tool selection: runner=@agent-relay/sdk; concurrency=1; rule=project default runner @agent-relay/sdk.

End with GENERATED_WORKFLOW_READY.`,
      verification: { type: 'file_exists', value: ".workflow-artifacts/generated/i-want-to-clean-up-the-codebase-to-remove-outdat/signoff.md" },
    })

    .run({ cwd: process.cwd() });

  console.log(result.status);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
