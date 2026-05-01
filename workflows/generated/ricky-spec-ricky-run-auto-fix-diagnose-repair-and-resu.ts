import { workflow } from '@agent-relay/sdk/workflows';

async function main() {
  const result = await workflow("ricky-spec-ricky-run-auto-fix-diagnose-repair-and-resu")
    .description("# Spec: `ricky run --auto-fix` — diagnose, repair, and resume on failure\n\n## Problem\n\nToday `ricky run <path>` shells out to `agent-relay run <path>` and reports back. On failure, the user gets a classified blocker (MISSING_BINARY, INVALID_ARTIFACT, etc.) and a list of recovery steps — but they have to run those recovery steps by hand, then re-invoke `agent-relay run --start-from <step> --previous-run-id <runId>` themselves.\n\nThat's the part Ricky should automate. The pieces already exist, but nothing wires them into a closed loop:\n\n- `runtime/failure/classifier.ts` classifies failures by category.\n- `product/specialists/debugger/debugger.ts` exposes `debugWorkflowRun(evidence)` returning a diagnosis + fix recommendation + a `repairMode` of `'direct' | 'guided' | 'manual'`.\n- `LocalCoordinator` already accepts `retry: { previousRunId, retryOfRunId, attempt, reason }` and threads `--start-from` / `--previous-run-id` into the spawn args.\n- `agent-relay run` writes a run-id file (`AGENT_RELAY_RUN_ID_FILE` env) and supports `--start-from <step> --previous-run-id <id>`.\n\nWhat's missing is the orchestrator that ties them.\n\n## Behavior we want\n\nA new opt-in flag: `--auto-fix` (alias `--repair`).\n\n```\nricky run workflows/generated/foo.ts --auto-fix\nricky run workflows/generated/foo.ts --auto-fix=5     # max 5 attempts\nricky --mode local --spec-file my.md --run --auto-fix             # composes with --run\n```\n\nDefault attempts: **3**. `--auto-fix` with no value → 3. `--auto-fix=N` → N attempts (1–10 clamped).\n\nLoop semantics on each iteration:\n\n1. Run the workflow (first attempt: from the start; subsequent attempts: with `--start-from <failed-step> --previous-run-id <prev-run-id>`).\n2. On success → print summary, exit 0.\n3. On failure → call `classifyFailure(evidence)` then `debugWorkflowRun({ evidence, classification })` to get `repairMode` + a recommendation.\n4. Branch on `repairMode`:\n   - `'direct'`: apply the fix (see [Auto-applicable fixes](#auto-applicable-fixes) below). If the fix itself fails → escalate (treat as `'manual'`). If it succeeds → loop.\n   - `'guided'`: don't auto-apply. Print the suggested steps. Exit non-zero with the suggestion. (User can rerun with the steps applied.)\n   - `'manual'`: print the diagnosis + recommendation. Exit non-zero. No retry.\n5. After the configured max attempts → print all attempt summaries, the final blocker, and exit 2.\n\nThe loop is **opt-in** — without `--auto-fix`, today's behavior is unchanged: one attempt, classified blocker, exit.\n\n## Auto-applicable fixes\n\nA \"direct\" repair is one Ricky can apply non-destructively, with a deterministic verification. v1 covers exactly these cases:\n\n| Failure class      | Auto-applied fix                                        | Verification                                          |\n|--------------------|---------------------------------------------------------|-------------------------------------------------------|\n| `MISSING_BINARY`   | Run the `steps` from the blocker (`npm install`, etc.) | Re-check `node_modules/.bin/<pkg>` or `command -v`    |\n| `NETWORK_TRANSIENT`| No edit — straight retry with backoff                  | (none — retry is the verification)                    |\n\nAnything else (parse errors, assertion failures, missing env vars, dependency-version mismatches) → `repairMode` is *not* `'direct'`. Those become guided/manual; v1 does not auto-edit code or write env files.\n\nFuture cases to consider in v2 (out of scope here):\n- Workflow parse errors with a single-line fix hint\n- Lockfile drift (re-run install)\n- LLM-assisted code fixes (would need explicit, separate consent)\n\n## Failed-step + previous-run-id resolution\n\n`agent-relay run --start-from X --previous-run-id Y` skips predecessors of step `X` and reuses cached outputs from run `Y`. To call it, Ricky needs both values from the *previous* attempt:\n\n- **Failed step**: extracted from `evidence.steps[]` — the first step with `status: 'failed'`. If no step granularity is reported (e.g. process crashed before any step started), `--start-from` is omitted and we just retry the whole run with `--previous-run-id`.\n- **Previous run id**: read from the run-id file the prior `agent-relay run` wrote (`AGENT_RELAY_RUN_ID_FILE`), or parsed from the `Run ID:` line agent-relay prints to stderr on failure. The runtime already passes the env var; Ricky just needs to read the file (or parse stderr) when it fires.\n\nIf neither source yields a run id, retry without `--previous-run-id` (full re-run) and warn that step-level resume wasn't possible.\n\n## CLI surface changes\n\n- New flag in `parseArgs` (`src/surfaces/cli/commands/cli-main.ts`): `--auto-fix[=N]`. Parses to `parsed.autoFix?: number` where `undefined` means \"off\" and a number means \"max attempts\".\n- Threaded through the CLI handoff into `LocalInvocationRequest` (extend the type with an `autoFix?: { maxAttempts: number }` field — coexists with the existing `stageMode`).\n- New top-level orchestrator function in `src/local/auto-fix-loop.ts` (or co-located in `entrypoint.ts` if small enough):\n  ```ts\n  async function runWithAutoFix(\n    request: LocalInvocationRequest,\n    options: { maxAttempts: number; ... },\n  ): Promise<LocalResponse>\n  ```\n  This wraps the existing single-attempt path. When the response is a failure with a directly-repairable blocker, it applies the fix, captures the run-id, and re-invokes with `retry` metadata populated.\n\nThe existing single-attempt path stays exactly as-is. The loop is a wrapper — no behavioral change when `autoFix` is unset.\n\n## Output shape\n\nFor each attempt, the loop emits a labeled section:\n\n```\nattempt 1/3:\n  status: blocker (MISSING_BINARY)\n  applied fix: npm install\n  fix outcome: ok\nattempt 2/3:\n  status: ok\n  duration: 14.2s\n```\n\nThe final exit message summarizes: `Auto-fix loop succeeded on attempt 2/3.` or `Auto-fix loop exhausted 3 attempts. Final blocker: ...`.\n\nWhen `--json` is set, the response includes:\n```json\n{\n  \"auto_fix\": {\n    \"max_attempts\": 3,\n    \"attempts\": [\n      { \"attempt\": 1, \"status\": \"blocker\", \"blocker_code\": \"MISSING_BINARY\", \"applied_fix\": { \"steps\": [\"npm install\"], \"exit_code\": 0 } },\n      { \"attempt\": 2, \"status\": \"ok\", \"run_id\": \"...\" }\n    ],\n    \"final_status\": \"ok\"\n  }\n}\n```\n\n## Test cases\n\nUnit tests in `src/local/auto-fix-loop.test.ts`:\n\n1. **Single-attempt success bypasses the loop** — first run returns `ok`, no debugger call, no retry args.\n2. **Direct repair retries with start-from + previous-run-id** — first attempt blocks on MISSING_BINARY, fix runs successfully, second attempt is invoked with `retry.previousRunId` and the failed step.\n3. **Repair failure escalates** — direct repair's command exits non-zero. Loop stops, exit non-zero, user gets the recovery steps.\n4. **Guided repairMode never retries** — output includes the recommended steps; exit non-zero; no second invocation.\n5. **Max attempts exhaustion** — three blockers in a row, all with directly-repairable fixes that don't actually help. Loop stops at attempt 3 with all attempt summaries.\n6. **Run id missing from prior attempt** — second attempt invoked without `--previous-run-id` and a warning logged.\n7. **`--auto-fix=0` is treated as `--no-auto-fix`** (or rejected with a parse error — pick one and document).\n8. **`--auto-fix` composes with `--run` after `--spec-file`** — generate, then enter the loop on the first run.\n\nEnd-to-end (manual, not automated): generate a workflow that fails on first run because of a missing dep, run with `--auto-fix`, observe ricky installs it and resumes from the failed step.\n\n## Out of scope\n\n- LLM-assisted code edits as auto-fixes. (Requires separate consent flow.)\n- Persistent state across CLI invocations. The loop is per-invocation.\n- Concurrent retry of independent steps. Sequential only.\n- Cloud execution. This is local/BYOH only; cloud has its own retry semantics via `agent-relay cloud run`.\n\n## Acceptance\n\n- `ricky run <path> --auto-fix` succeeds on a workflow that fails the first attempt with a `MISSING_BINARY` blocker and is fixable by `npm install`.\n- Same command with `--auto-fix=1` runs once, blocker reported, no retry.\n- Same command without `--auto-fix` behaves identically to today (single attempt, no debugger call).\n- All existing `runLocal` tests still pass — the loop is a wrapper, not a replacement.\n- `ricky --help` documents the flag.")
    .pattern("dag")
    .channel("wf-ricky-spec-ricky-run-auto-fix-diagnose-repair-and-resu")
    .maxConcurrency(4)
    .timeout(600000)
    .onError('retry', { maxRetries: 2, retryDelayMs: 1000 })

    .agent("lead-claude", { cli: "claude", role: "Plans task shape, ownership, non-goals, and verification gates.", retries: 1 })
    .agent("impl-primary-codex", { cli: "codex", role: "Primary implementer for independent file slices and code changes.", retries: 2 })
    .agent("impl-tests-codex", { cli: "codex", role: "Adds or updates tests and validation coverage for the changed surface.", retries: 2 })
    .agent("reviewer-claude", { cli: "claude", preset: "reviewer", role: "Reviews product fit, scope control, and workflow evidence quality.", retries: 1 })
    .agent("reviewer-codex", { cli: "codex", preset: "reviewer", role: "Reviews TypeScript correctness, deterministic gates, and test coverage.", retries: 1 })
    .agent("validator-claude", { cli: "claude", preset: "worker", role: "Runs the 80-to-100 fix loop and verifies final readiness.", retries: 2 })

    .step("prepare-context", {
      type: 'deterministic',
      command: "mkdir -p '.workflow-artifacts/generated/spec-ricky-run-auto-fix-diagnose-repair-and-resu' && printf '%s\\n' '# Spec: `ricky run --auto-fix` — diagnose, repair, and resume on failure\n\n## Problem\n\nToday `ricky run <path>` shells out to `agent-relay run <path>` and reports back. On failure, the user gets a classified blocker (MISSING_BINARY, INVALID_ARTIFACT, etc.) and a list of recovery steps — but they have to run those recovery steps by hand, then re-invoke `agent-relay run --start-from <step> --previous-run-id <runId>` themselves.\n\nThat'\\''s the part Ricky should automate. The pieces already exist, but nothing wires them into a closed loop:\n\n- `runtime/failure/classifier.ts` classifies failures by category.\n- `product/specialists/debugger/debugger.ts` exposes `debugWorkflowRun(evidence)` returning a diagnosis + fix recommendation + a `repairMode` of `'\\''direct'\\'' | '\\''guided'\\'' | '\\''manual'\\''`.\n- `LocalCoordinator` already accepts `retry: { previousRunId, retryOfRunId, attempt, reason }` and threads `--start-from` / `--previous-run-id` into the spawn args.\n- `agent-relay run` writes a run-id file (`AGENT_RELAY_RUN_ID_FILE` env) and supports `--start-from <step> --previous-run-id <id>`.\n\nWhat'\\''s missing is the orchestrator that ties them.\n\n## Behavior we want\n\nA new opt-in flag: `--auto-fix` (alias `--repair`).\n\n```\nricky run workflows/generated/foo.ts --auto-fix\nricky run workflows/generated/foo.ts --auto-fix=5     # max 5 attempts\nricky --mode local --spec-file my.md --run --auto-fix             # composes with --run\n```\n\nDefault attempts: **3**. `--auto-fix` with no value → 3. `--auto-fix=N` → N attempts (1–10 clamped).\n\nLoop semantics on each iteration:\n\n1. Run the workflow (first attempt: from the start; subsequent attempts: with `--start-from <failed-step> --previous-run-id <prev-run-id>`).\n2. On success → print summary, exit 0.\n3. On failure → call `classifyFailure(evidence)` then `debugWorkflowRun({ evidence, classification })` to get `repairMode` + a recommendation.\n4. Branch on `repairMode`:\n   - `'\\''direct'\\''`: apply the fix (see [Auto-applicable fixes](#auto-applicable-fixes) below). If the fix itself fails → escalate (treat as `'\\''manual'\\''`). If it succeeds → loop.\n   - `'\\''guided'\\''`: don'\\''t auto-apply. Print the suggested steps. Exit non-zero with the suggestion. (User can rerun with the steps applied.)\n   - `'\\''manual'\\''`: print the diagnosis + recommendation. Exit non-zero. No retry.\n5. After the configured max attempts → print all attempt summaries, the final blocker, and exit 2.\n\nThe loop is **opt-in** — without `--auto-fix`, today'\\''s behavior is unchanged: one attempt, classified blocker, exit.\n\n## Auto-applicable fixes\n\nA \"direct\" repair is one Ricky can apply non-destructively, with a deterministic verification. v1 covers exactly these cases:\n\n| Failure class      | Auto-applied fix                                        | Verification                                          |\n|--------------------|---------------------------------------------------------|-------------------------------------------------------|\n| `MISSING_BINARY`   | Run the `steps` from the blocker (`npm install`, etc.) | Re-check `node_modules/.bin/<pkg>` or `command -v`    |\n| `NETWORK_TRANSIENT`| No edit — straight retry with backoff                  | (none — retry is the verification)                    |\n\nAnything else (parse errors, assertion failures, missing env vars, dependency-version mismatches) → `repairMode` is *not* `'\\''direct'\\''`. Those become guided/manual; v1 does not auto-edit code or write env files.\n\nFuture cases to consider in v2 (out of scope here):\n- Workflow parse errors with a single-line fix hint\n- Lockfile drift (re-run install)\n- LLM-assisted code fixes (would need explicit, separate consent)\n\n## Failed-step + previous-run-id resolution\n\n`agent-relay run --start-from X --previous-run-id Y` skips predecessors of step `X` and reuses cached outputs from run `Y`. To call it, Ricky needs both values from the *previous* attempt:\n\n- **Failed step**: extracted from `evidence.steps[]` — the first step with `status: '\\''failed'\\''`. If no step granularity is reported (e.g. process crashed before any step started), `--start-from` is omitted and we just retry the whole run with `--previous-run-id`.\n- **Previous run id**: read from the run-id file the prior `agent-relay run` wrote (`AGENT_RELAY_RUN_ID_FILE`), or parsed from the `Run ID:` line agent-relay prints to stderr on failure. The runtime already passes the env var; Ricky just needs to read the file (or parse stderr) when it fires.\n\nIf neither source yields a run id, retry without `--previous-run-id` (full re-run) and warn that step-level resume wasn'\\''t possible.\n\n## CLI surface changes\n\n- New flag in `parseArgs` (`src/surfaces/cli/commands/cli-main.ts`): `--auto-fix[=N]`. Parses to `parsed.autoFix?: number` where `undefined` means \"off\" and a number means \"max attempts\".\n- Threaded through the CLI handoff into `LocalInvocationRequest` (extend the type with an `autoFix?: { maxAttempts: number }` field — coexists with the existing `stageMode`).\n- New top-level orchestrator function in `src/local/auto-fix-loop.ts` (or co-located in `entrypoint.ts` if small enough):\n  ```ts\n  async function runWithAutoFix(\n    request: LocalInvocationRequest,\n    options: { maxAttempts: number; ... },\n  ): Promise<LocalResponse>\n  ```\n  This wraps the existing single-attempt path. When the response is a failure with a directly-repairable blocker, it applies the fix, captures the run-id, and re-invokes with `retry` metadata populated.\n\nThe existing single-attempt path stays exactly as-is. The loop is a wrapper — no behavioral change when `autoFix` is unset.\n\n## Output shape\n\nFor each attempt, the loop emits a labeled section:\n\n```\nattempt 1/3:\n  status: blocker (MISSING_BINARY)\n  applied fix: npm install\n  fix outcome: ok\nattempt 2/3:\n  status: ok\n  duration: 14.2s\n```\n\nThe final exit message summarizes: `Auto-fix loop succeeded on attempt 2/3.` or `Auto-fix loop exhausted 3 attempts. Final blocker: ...`.\n\nWhen `--json` is set, the response includes:\n```json\n{\n  \"auto_fix\": {\n    \"max_attempts\": 3,\n    \"attempts\": [\n      { \"attempt\": 1, \"status\": \"blocker\", \"blocker_code\": \"MISSING_BINARY\", \"applied_fix\": { \"steps\": [\"npm install\"], \"exit_code\": 0 } },\n      { \"attempt\": 2, \"status\": \"ok\", \"run_id\": \"...\" }\n    ],\n    \"final_status\": \"ok\"\n  }\n}\n```\n\n## Test cases\n\nUnit tests in `src/local/auto-fix-loop.test.ts`:\n\n1. **Single-attempt success bypasses the loop** — first run returns `ok`, no debugger call, no retry args.\n2. **Direct repair retries with start-from + previous-run-id** — first attempt blocks on MISSING_BINARY, fix runs successfully, second attempt is invoked with `retry.previousRunId` and the failed step.\n3. **Repair failure escalates** — direct repair'\\''s command exits non-zero. Loop stops, exit non-zero, user gets the recovery steps.\n4. **Guided repairMode never retries** — output includes the recommended steps; exit non-zero; no second invocation.\n5. **Max attempts exhaustion** — three blockers in a row, all with directly-repairable fixes that don'\\''t actually help. Loop stops at attempt 3 with all attempt summaries.\n6. **Run id missing from prior attempt** — second attempt invoked without `--previous-run-id` and a warning logged.\n7. **`--auto-fix=0` is treated as `--no-auto-fix`** (or rejected with a parse error — pick one and document).\n8. **`--auto-fix` composes with `--run` after `--spec-file`** — generate, then enter the loop on the first run.\n\nEnd-to-end (manual, not automated): generate a workflow that fails on first run because of a missing dep, run with `--auto-fix`, observe ricky installs it and resumes from the failed step.\n\n## Out of scope\n\n- LLM-assisted code edits as auto-fixes. (Requires separate consent flow.)\n- Persistent state across CLI invocations. The loop is per-invocation.\n- Concurrent retry of independent steps. Sequential only.\n- Cloud execution. This is local/BYOH only; cloud has its own retry semantics via `agent-relay cloud run`.\n\n## Acceptance\n\n- `ricky run <path> --auto-fix` succeeds on a workflow that fails the first attempt with a `MISSING_BINARY` blocker and is fixable by `npm install`.\n- Same command with `--auto-fix=1` runs once, blocker reported, no retry.\n- Same command without `--auto-fix` behaves identically to today (single attempt, no debugger call).\n- All existing `runLocal` tests still pass — the loop is a wrapper, not a replacement.\n- `ricky --help` documents the flag.' > '.workflow-artifacts/generated/spec-ricky-run-auto-fix-diagnose-repair-and-resu/normalized-spec.txt' && printf '%s\\n' 'pattern=dag; reason=Selected dag because the request is high risk and benefits from parallel implementation, review, and validation gates.' > '.workflow-artifacts/generated/spec-ricky-run-auto-fix-diagnose-repair-and-resu/pattern-decision.txt' && printf '%s\\n' 'writing-agent-relay-workflows,choosing-swarm-patterns,relay-80-100-workflow' > '.workflow-artifacts/generated/spec-ricky-run-auto-fix-diagnose-repair-and-resu/loaded-skills.txt' && printf '%s\\n' '{\"behavior\":\"generation_time_only\",\"runtimeEmbodiment\":false,\"boundary\":\"Skills influence Ricky generator selection, loading, template rendering, workflow contract, validation gates, and metadata. Generated runtime agents receive only the rendered workflow instructions; they do not load or embody skill files at runtime.\",\"loadedSkills\":[\"writing-agent-relay-workflows\",\"choosing-swarm-patterns\",\"relay-80-100-workflow\"],\"applicationEvidence\":[{\"skillName\":\"writing-agent-relay-workflows\",\"stage\":\"generation_selection\",\"effect\":\"workflow_contract\",\"behavior\":\"generation_time_only\",\"runtimeEmbodiment\":false,\"evidence\":\"Selected writing-agent-relay-workflows during workflow generation because it was applicable to the normalized spec.\"},{\"skillName\":\"writing-agent-relay-workflows\",\"stage\":\"generation_loading\",\"effect\":\"metadata\",\"behavior\":\"generation_time_only\",\"runtimeEmbodiment\":false,\"evidence\":\"Loaded writing-agent-relay-workflows descriptor from skills/skills/writing-agent-relay-workflows/SKILL.md before template rendering.\"},{\"skillName\":\"choosing-swarm-patterns\",\"stage\":\"generation_selection\",\"effect\":\"workflow_contract\",\"behavior\":\"generation_time_only\",\"runtimeEmbodiment\":false,\"evidence\":\"Selected choosing-swarm-patterns during workflow generation because it was applicable to the normalized spec.\"},{\"skillName\":\"choosing-swarm-patterns\",\"stage\":\"generation_loading\",\"effect\":\"metadata\",\"behavior\":\"generation_time_only\",\"runtimeEmbodiment\":false,\"evidence\":\"Loaded choosing-swarm-patterns descriptor from skills/skills/choosing-swarm-patterns/SKILL.md before template rendering.\"},{\"skillName\":\"relay-80-100-workflow\",\"stage\":\"generation_selection\",\"effect\":\"workflow_contract\",\"behavior\":\"generation_time_only\",\"runtimeEmbodiment\":false,\"evidence\":\"Selected relay-80-100-workflow during workflow generation because it was applicable to the normalized spec.\"},{\"skillName\":\"relay-80-100-workflow\",\"stage\":\"generation_loading\",\"effect\":\"metadata\",\"behavior\":\"generation_time_only\",\"runtimeEmbodiment\":false,\"evidence\":\"Loaded relay-80-100-workflow descriptor from skills/skills/relay-80-100-workflow/SKILL.md before template rendering.\"},{\"skillName\":\"writing-agent-relay-workflows\",\"stage\":\"generation_rendering\",\"effect\":\"workflow_contract\",\"behavior\":\"generation_time_only\",\"runtimeEmbodiment\":false,\"evidence\":\"Rendered 10 workflow tasks with dedicated channel setup, explicit agents, step dependencies, review stages, and final signoff.\"},{\"skillName\":\"relay-80-100-workflow\",\"stage\":\"generation_rendering\",\"effect\":\"validation_gates\",\"behavior\":\"generation_time_only\",\"runtimeEmbodiment\":false,\"evidence\":\"Rendered 9 deterministic gates including initial soft validation, fix-loop checks, final hard validation, git diff, and regression gates.\"}]}' > '.workflow-artifacts/generated/spec-ricky-run-auto-fix-diagnose-repair-and-resu/skill-application-boundary.json' && printf '%s\\n' 'Skills influence Ricky generator selection, loading, template rendering, workflow contract, validation gates, and metadata. Generated runtime agents receive only the rendered workflow instructions; they do not load or embody skill files at runtime.' > '.workflow-artifacts/generated/spec-ricky-run-auto-fix-diagnose-repair-and-resu/skill-runtime-boundary.txt' && echo GENERATED_WORKFLOW_CONTEXT_READY",
      captureOutput: true,
      failOnError: true,
    })

    .step("skill-boundary-metadata-gate", {
      type: 'deterministic',
      dependsOn: ["prepare-context"],
      command: "test -f '.workflow-artifacts/generated/spec-ricky-run-auto-fix-diagnose-repair-and-resu/skill-application-boundary.json' && grep -F 'generation_time_only' '.workflow-artifacts/generated/spec-ricky-run-auto-fix-diagnose-repair-and-resu/skill-application-boundary.json' && grep -F '\"runtimeEmbodiment\":false' '.workflow-artifacts/generated/spec-ricky-run-auto-fix-diagnose-repair-and-resu/skill-application-boundary.json' && grep -F '\"stage\":\"generation_selection\"' '.workflow-artifacts/generated/spec-ricky-run-auto-fix-diagnose-repair-and-resu/skill-application-boundary.json' && grep -F '\"stage\":\"generation_loading\"' '.workflow-artifacts/generated/spec-ricky-run-auto-fix-diagnose-repair-and-resu/skill-application-boundary.json' && grep -F '\"effect\":\"metadata\"' '.workflow-artifacts/generated/spec-ricky-run-auto-fix-diagnose-repair-and-resu/skill-application-boundary.json' && grep -F 'writing-agent-relay-workflows' '.workflow-artifacts/generated/spec-ricky-run-auto-fix-diagnose-repair-and-resu/skill-application-boundary.json' && grep -F 'choosing-swarm-patterns' '.workflow-artifacts/generated/spec-ricky-run-auto-fix-diagnose-repair-and-resu/skill-application-boundary.json' && grep -F 'relay-80-100-workflow' '.workflow-artifacts/generated/spec-ricky-run-auto-fix-diagnose-repair-and-resu/skill-application-boundary.json' && grep -F '\"stage\":\"generation_rendering\"' '.workflow-artifacts/generated/spec-ricky-run-auto-fix-diagnose-repair-and-resu/skill-application-boundary.json' && grep -F '\"effect\":\"workflow_contract\"' '.workflow-artifacts/generated/spec-ricky-run-auto-fix-diagnose-repair-and-resu/skill-application-boundary.json' && grep -F '\"stage\":\"generation_rendering\"' '.workflow-artifacts/generated/spec-ricky-run-auto-fix-diagnose-repair-and-resu/skill-application-boundary.json' && grep -F '\"effect\":\"validation_gates\"' '.workflow-artifacts/generated/spec-ricky-run-auto-fix-diagnose-repair-and-resu/skill-application-boundary.json'",
      captureOutput: true,
      failOnError: true,
    })

    .step('lead-plan', {
      agent: 'lead-claude',
      dependsOn: ['skill-boundary-metadata-gate'],
      task: `Plan the workflow execution from the normalized spec.

Generation-time skill boundary:
- Read .workflow-artifacts/generated/spec-ricky-run-auto-fix-diagnose-repair-and-resu/skill-application-boundary.json and treat it as generator metadata only.
- Skills are applied by Ricky during selection, loading, and template rendering.
- Do not claim generated agents load, retain, or embody skill files at runtime unless a future runtime test proves that path.

Description:
# Spec: \`ricky run --auto-fix\` — diagnose, repair, and resume on failure

## Problem

Today \`ricky run <path>\` shells out to \`agent-relay run <path>\` and reports back. On failure, the user gets a classified blocker (MISSING_BINARY, INVALID_ARTIFACT, etc.) and a list of recovery steps — but they have to run those recovery steps by hand, then re-invoke \`agent-relay run --start-from <step> --previous-run-id <runId>\` themselves.

That's the part Ricky should automate. The pieces already exist, but nothing wires them into a closed loop:

- \`runtime/failure/classifier.ts\` classifies failures by category.
- \`product/specialists/debugger/debugger.ts\` exposes \`debugWorkflowRun(evidence)\` returning a diagnosis + fix recommendation + a \`repairMode\` of \`'direct' | 'guided' | 'manual'\`.
- \`LocalCoordinator\` already accepts \`retry: { previousRunId, retryOfRunId, attempt, reason }\` and threads \`--start-from\` / \`--previous-run-id\` into the spawn args.
- \`agent-relay run\` writes a run-id file (\`AGENT_RELAY_RUN_ID_FILE\` env) and supports \`--start-from <step> --previous-run-id <id>\`.

What's missing is the orchestrator that ties them.

## Behavior we want

A new opt-in flag: \`--auto-fix\` (alias \`--repair\`).

\`\`\`
ricky run workflows/generated/foo.ts --auto-fix
ricky run workflows/generated/foo.ts --auto-fix=5     # max 5 attempts
ricky --mode local --spec-file my.md --run --auto-fix             # composes with --run
\`\`\`

Default attempts: **3**. \`--auto-fix\` with no value → 3. \`--auto-fix=N\` → N attempts (1–10 clamped).

Loop semantics on each iteration:

1. Run the workflow (first attempt: from the start; subsequent attempts: with \`--start-from <failed-step> --previous-run-id <prev-run-id>\`).
2. On success → print summary, exit 0.
3. On failure → call \`classifyFailure(evidence)\` then \`debugWorkflowRun({ evidence, classification })\` to get \`repairMode\` + a recommendation.
4. Branch on \`repairMode\`:
   - \`'direct'\`: apply the fix (see [Auto-applicable fixes](#auto-applicable-fixes) below). If the fix itself fails → escalate (treat as \`'manual'\`). If it succeeds → loop.
   - \`'guided'\`: don't auto-apply. Print the suggested steps. Exit non-zero with the suggestion. (User can rerun with the steps applied.)
   - \`'manual'\`: print the diagnosis + recommendation. Exit non-zero. No retry.
5. After the configured max attempts → print all attempt summaries, the final blocker, and exit 2.

The loop is **opt-in** — without \`--auto-fix\`, today's behavior is unchanged: one attempt, classified blocker, exit.

## Auto-applicable fixes

A "direct" repair is one Ricky can apply non-destructively, with a deterministic verification. v1 covers exactly these cases:

| Failure class      | Auto-applied fix                                        | Verification                                          |
|--------------------|---------------------------------------------------------|-------------------------------------------------------|
| \`MISSING_BINARY\`   | Run the \`steps\` from the blocker (\`npm install\`, etc.) | Re-check \`node_modules/.bin/<pkg>\` or \`command -v\`    |
| \`NETWORK_TRANSIENT\`| No edit — straight retry with backoff                  | (none — retry is the verification)                    |

Anything else (parse errors, assertion failures, missing env vars, dependency-version mismatches) → \`repairMode\` is *not* \`'direct'\`. Those become guided/manual; v1 does not auto-edit code or write env files.

Future cases to consider in v2 (out of scope here):
- Workflow parse errors with a single-line fix hint
- Lockfile drift (re-run install)
- LLM-assisted code fixes (would need explicit, separate consent)

## Failed-step + previous-run-id resolution

\`agent-relay run --start-from X --previous-run-id Y\` skips predecessors of step \`X\` and reuses cached outputs from run \`Y\`. To call it, Ricky needs both values from the *previous* attempt:

- **Failed step**: extracted from \`evidence.steps[]\` — the first step with \`status: 'failed'\`. If no step granularity is reported (e.g. process crashed before any step started), \`--start-from\` is omitted and we just retry the whole run with \`--previous-run-id\`.
- **Previous run id**: read from the run-id file the prior \`agent-relay run\` wrote (\`AGENT_RELAY_RUN_ID_FILE\`), or parsed from the \`Run ID:\` line agent-relay prints to stderr on failure. The runtime already passes the env var; Ricky just needs to read the file (or parse stderr) when it fires.

If neither source yields a run id, retry without \`--previous-run-id\` (full re-run) and warn that step-level resume wasn't possible.

## CLI surface changes

- New flag in \`parseArgs\` (\`src/surfaces/cli/commands/cli-main.ts\`): \`--auto-fix[=N]\`. Parses to \`parsed.autoFix?: number\` where \`undefined\` means "off" and a number means "max attempts".
- Threaded through the CLI handoff into \`LocalInvocationRequest\` (extend the type with an \`autoFix?: { maxAttempts: number }\` field — coexists with the existing \`stageMode\`).
- New top-level orchestrator function in \`src/local/auto-fix-loop.ts\` (or co-located in \`entrypoint.ts\` if small enough):
  \`\`\`ts
  async function runWithAutoFix(
    request: LocalInvocationRequest,
    options: { maxAttempts: number; ... },
  ): Promise<LocalResponse>
  \`\`\`
  This wraps the existing single-attempt path. When the response is a failure with a directly-repairable blocker, it applies the fix, captures the run-id, and re-invokes with \`retry\` metadata populated.

The existing single-attempt path stays exactly as-is. The loop is a wrapper — no behavioral change when \`autoFix\` is unset.

## Output shape

For each attempt, the loop emits a labeled section:

\`\`\`
attempt 1/3:
  status: blocker (MISSING_BINARY)
  applied fix: npm install
  fix outcome: ok
attempt 2/3:
  status: ok
  duration: 14.2s
\`\`\`

The final exit message summarizes: \`Auto-fix loop succeeded on attempt 2/3.\` or \`Auto-fix loop exhausted 3 attempts. Final blocker: ...\`.

When \`--json\` is set, the response includes:
\`\`\`json
{
  "auto_fix": {
    "max_attempts": 3,
    "attempts": [
      { "attempt": 1, "status": "blocker", "blocker_code": "MISSING_BINARY", "applied_fix": { "steps": ["npm install"], "exit_code": 0 } },
      { "attempt": 2, "status": "ok", "run_id": "..." }
    ],
    "final_status": "ok"
  }
}
\`\`\`

## Test cases

Unit tests in \`src/local/auto-fix-loop.test.ts\`:

1. **Single-attempt success bypasses the loop** — first run returns \`ok\`, no debugger call, no retry args.
2. **Direct repair retries with start-from + previous-run-id** — first attempt blocks on MISSING_BINARY, fix runs successfully, second attempt is invoked with \`retry.previousRunId\` and the failed step.
3. **Repair failure escalates** — direct repair's command exits non-zero. Loop stops, exit non-zero, user gets the recovery steps.
4. **Guided repairMode never retries** — output includes the recommended steps; exit non-zero; no second invocation.
5. **Max attempts exhaustion** — three blockers in a row, all with directly-repairable fixes that don't actually help. Loop stops at attempt 3 with all attempt summaries.
6. **Run id missing from prior attempt** — second attempt invoked without \`--previous-run-id\` and a warning logged.
7. **\`--auto-fix=0\` is treated as \`--no-auto-fix\`** (or rejected with a parse error — pick one and document).
8. **\`--auto-fix\` composes with \`--run\` after \`--spec-file\`** — generate, then enter the loop on the first run.

End-to-end (manual, not automated): generate a workflow that fails on first run because of a missing dep, run with \`--auto-fix\`, observe ricky installs it and resumes from the failed step.

## Out of scope

- LLM-assisted code edits as auto-fixes. (Requires separate consent flow.)
- Persistent state across CLI invocations. The loop is per-invocation.
- Concurrent retry of independent steps. Sequential only.
- Cloud execution. This is local/BYOH only; cloud has its own retry semantics via \`agent-relay cloud run\`.

## Acceptance

- \`ricky run <path> --auto-fix\` succeeds on a workflow that fails the first attempt with a \`MISSING_BINARY\` blocker and is fixable by \`npm install\`.
- Same command with \`--auto-fix=1\` runs once, blocker reported, no retry.
- Same command without \`--auto-fix\` behaves identically to today (single attempt, no debugger call).
- All existing \`runLocal\` tests still pass — the loop is a wrapper, not a replacement.
- \`ricky --help\` documents the flag.

Deliverables:
- workflows/generated/foo.ts
- guided/manual
- 1/3
- 2/3
- local/BYOH

Non-goals:
- None declared

Verification commands:
- file_exists gate for declared targets
- grep sanity gate
- npx tsc --noEmit
- npx vitest run
- git diff --name-only gate

Write .workflow-artifacts/generated/spec-ricky-run-auto-fix-diagnose-repair-and-resu/lead-plan.md ending with GENERATION_LEAD_PLAN_READY.`,
      verification: { type: 'file_exists', value: ".workflow-artifacts/generated/spec-ricky-run-auto-fix-diagnose-repair-and-resu/lead-plan.md" },
    })

    .step('implement-artifact', {
      agent: "impl-primary-codex",
      dependsOn: ['lead-plan'],
      task: `Implement the requested code-writing workflow slice.

Scope:
# Spec: \`ricky run --auto-fix\` — diagnose, repair, and resume on failure

## Problem

Today \`ricky run <path>\` shells out to \`agent-relay run <path>\` and reports back. On failure, the user gets a classified blocker (MISSING_BINARY, INVALID_ARTIFACT, etc.) and a list of recovery steps — but they have to run those recovery steps by hand, then re-invoke \`agent-relay run --start-from <step> --previous-run-id <runId>\` themselves.

That's the part Ricky should automate. The pieces already exist, but nothing wires them into a closed loop:

- \`runtime/failure/classifier.ts\` classifies failures by category.
- \`product/specialists/debugger/debugger.ts\` exposes \`debugWorkflowRun(evidence)\` returning a diagnosis + fix recommendation + a \`repairMode\` of \`'direct' | 'guided' | 'manual'\`.
- \`LocalCoordinator\` already accepts \`retry: { previousRunId, retryOfRunId, attempt, reason }\` and threads \`--start-from\` / \`--previous-run-id\` into the spawn args.
- \`agent-relay run\` writes a run-id file (\`AGENT_RELAY_RUN_ID_FILE\` env) and supports \`--start-from <step> --previous-run-id <id>\`.

What's missing is the orchestrator that ties them.

## Behavior we want

A new opt-in flag: \`--auto-fix\` (alias \`--repair\`).

\`\`\`
ricky run workflows/generated/foo.ts --auto-fix
ricky run workflows/generated/foo.ts --auto-fix=5     # max 5 attempts
ricky --mode local --spec-file my.md --run --auto-fix             # composes with --run
\`\`\`

Default attempts: **3**. \`--auto-fix\` with no value → 3. \`--auto-fix=N\` → N attempts (1–10 clamped).

Loop semantics on each iteration:

1. Run the workflow (first attempt: from the start; subsequent attempts: with \`--start-from <failed-step> --previous-run-id <prev-run-id>\`).
2. On success → print summary, exit 0.
3. On failure → call \`classifyFailure(evidence)\` then \`debugWorkflowRun({ evidence, classification })\` to get \`repairMode\` + a recommendation.
4. Branch on \`repairMode\`:
   - \`'direct'\`: apply the fix (see [Auto-applicable fixes](#auto-applicable-fixes) below). If the fix itself fails → escalate (treat as \`'manual'\`). If it succeeds → loop.
   - \`'guided'\`: don't auto-apply. Print the suggested steps. Exit non-zero with the suggestion. (User can rerun with the steps applied.)
   - \`'manual'\`: print the diagnosis + recommendation. Exit non-zero. No retry.
5. After the configured max attempts → print all attempt summaries, the final blocker, and exit 2.

The loop is **opt-in** — without \`--auto-fix\`, today's behavior is unchanged: one attempt, classified blocker, exit.

## Auto-applicable fixes

A "direct" repair is one Ricky can apply non-destructively, with a deterministic verification. v1 covers exactly these cases:

| Failure class      | Auto-applied fix                                        | Verification                                          |
|--------------------|---------------------------------------------------------|-------------------------------------------------------|
| \`MISSING_BINARY\`   | Run the \`steps\` from the blocker (\`npm install\`, etc.) | Re-check \`node_modules/.bin/<pkg>\` or \`command -v\`    |
| \`NETWORK_TRANSIENT\`| No edit — straight retry with backoff                  | (none — retry is the verification)                    |

Anything else (parse errors, assertion failures, missing env vars, dependency-version mismatches) → \`repairMode\` is *not* \`'direct'\`. Those become guided/manual; v1 does not auto-edit code or write env files.

Future cases to consider in v2 (out of scope here):
- Workflow parse errors with a single-line fix hint
- Lockfile drift (re-run install)
- LLM-assisted code fixes (would need explicit, separate consent)

## Failed-step + previous-run-id resolution

\`agent-relay run --start-from X --previous-run-id Y\` skips predecessors of step \`X\` and reuses cached outputs from run \`Y\`. To call it, Ricky needs both values from the *previous* attempt:

- **Failed step**: extracted from \`evidence.steps[]\` — the first step with \`status: 'failed'\`. If no step granularity is reported (e.g. process crashed before any step started), \`--start-from\` is omitted and we just retry the whole run with \`--previous-run-id\`.
- **Previous run id**: read from the run-id file the prior \`agent-relay run\` wrote (\`AGENT_RELAY_RUN_ID_FILE\`), or parsed from the \`Run ID:\` line agent-relay prints to stderr on failure. The runtime already passes the env var; Ricky just needs to read the file (or parse stderr) when it fires.

If neither source yields a run id, retry without \`--previous-run-id\` (full re-run) and warn that step-level resume wasn't possible.

## CLI surface changes

- New flag in \`parseArgs\` (\`src/surfaces/cli/commands/cli-main.ts\`): \`--auto-fix[=N]\`. Parses to \`parsed.autoFix?: number\` where \`undefined\` means "off" and a number means "max attempts".
- Threaded through the CLI handoff into \`LocalInvocationRequest\` (extend the type with an \`autoFix?: { maxAttempts: number }\` field — coexists with the existing \`stageMode\`).
- New top-level orchestrator function in \`src/local/auto-fix-loop.ts\` (or co-located in \`entrypoint.ts\` if small enough):
  \`\`\`ts
  async function runWithAutoFix(
    request: LocalInvocationRequest,
    options: { maxAttempts: number; ... },
  ): Promise<LocalResponse>
  \`\`\`
  This wraps the existing single-attempt path. When the response is a failure with a directly-repairable blocker, it applies the fix, captures the run-id, and re-invokes with \`retry\` metadata populated.

The existing single-attempt path stays exactly as-is. The loop is a wrapper — no behavioral change when \`autoFix\` is unset.

## Output shape

For each attempt, the loop emits a labeled section:

\`\`\`
attempt 1/3:
  status: blocker (MISSING_BINARY)
  applied fix: npm install
  fix outcome: ok
attempt 2/3:
  status: ok
  duration: 14.2s
\`\`\`

The final exit message summarizes: \`Auto-fix loop succeeded on attempt 2/3.\` or \`Auto-fix loop exhausted 3 attempts. Final blocker: ...\`.

When \`--json\` is set, the response includes:
\`\`\`json
{
  "auto_fix": {
    "max_attempts": 3,
    "attempts": [
      { "attempt": 1, "status": "blocker", "blocker_code": "MISSING_BINARY", "applied_fix": { "steps": ["npm install"], "exit_code": 0 } },
      { "attempt": 2, "status": "ok", "run_id": "..." }
    ],
    "final_status": "ok"
  }
}
\`\`\`

## Test cases

Unit tests in \`src/local/auto-fix-loop.test.ts\`:

1. **Single-attempt success bypasses the loop** — first run returns \`ok\`, no debugger call, no retry args.
2. **Direct repair retries with start-from + previous-run-id** — first attempt blocks on MISSING_BINARY, fix runs successfully, second attempt is invoked with \`retry.previousRunId\` and the failed step.
3. **Repair failure escalates** — direct repair's command exits non-zero. Loop stops, exit non-zero, user gets the recovery steps.
4. **Guided repairMode never retries** — output includes the recommended steps; exit non-zero; no second invocation.
5. **Max attempts exhaustion** — three blockers in a row, all with directly-repairable fixes that don't actually help. Loop stops at attempt 3 with all attempt summaries.
6. **Run id missing from prior attempt** — second attempt invoked without \`--previous-run-id\` and a warning logged.
7. **\`--auto-fix=0\` is treated as \`--no-auto-fix\`** (or rejected with a parse error — pick one and document).
8. **\`--auto-fix\` composes with \`--run\` after \`--spec-file\`** — generate, then enter the loop on the first run.

End-to-end (manual, not automated): generate a workflow that fails on first run because of a missing dep, run with \`--auto-fix\`, observe ricky installs it and resumes from the failed step.

## Out of scope

- LLM-assisted code edits as auto-fixes. (Requires separate consent flow.)
- Persistent state across CLI invocations. The loop is per-invocation.
- Concurrent retry of independent steps. Sequential only.
- Cloud execution. This is local/BYOH only; cloud has its own retry semantics via \`agent-relay cloud run\`.

## Acceptance

- \`ricky run <path> --auto-fix\` succeeds on a workflow that fails the first attempt with a \`MISSING_BINARY\` blocker and is fixable by \`npm install\`.
- Same command with \`--auto-fix=1\` runs once, blocker reported, no retry.
- Same command without \`--auto-fix\` behaves identically to today (single attempt, no debugger call).
- All existing \`runLocal\` tests still pass — the loop is a wrapper, not a replacement.
- \`ricky --help\` documents the flag.

Own only declared targets unless review feedback explicitly narrows a required fix:
- workflows/generated/foo.ts
- guided/manual
- 1/3
- 2/3
- local/BYOH

Acceptance gates:
- None declared

Keep execution routing explicit for local, cloud, and MCP callers. Materialize outputs to disk, then stop for deterministic gates.`,
    })

    .step("post-implementation-file-gate", {
      type: 'deterministic',
      dependsOn: ["implement-artifact"],
      command: "grep -Eq 'autoFix|--auto-fix' src/surfaces/cli/commands/cli-main.ts && test -f 'src/local/auto-fix-loop.ts' && test -f 'src/local/auto-fix-loop.test.ts'",
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
# Spec: \`ricky run --auto-fix\` — diagnose, repair, and resume on failure

## Problem

Today \`ricky run <path>\` shells out to \`agent-relay run <path>\` and reports back. On failure, the user gets a classified blocker (MISSING_BINARY, INVALID_ARTIFACT, etc.) and a list of recovery steps — but they have to run those recovery steps by hand, then re-invoke \`agent-relay run --start-from <step> --previous-run-id <runId>\` themselves.

That's the part Ricky should automate. The pieces already exist, but nothing wires them into a closed loop:

- \`runtime/failure/classifier.ts\` classifies failures by category.
- \`product/specialists/debugger/debugger.ts\` exposes \`debugWorkflowRun(evidence)\` returning a diagnosis + fix recommendation + a \`repairMode\` of \`'direct' | 'guided' | 'manual'\`.
- \`LocalCoordinator\` already accepts \`retry: { previousRunId, retryOfRunId, attempt, reason }\` and threads \`--start-from\` / \`--previous-run-id\` into the spawn args.
- \`agent-relay run\` writes a run-id file (\`AGENT_RELAY_RUN_ID_FILE\` env) and supports \`--start-from <step> --previous-run-id <id>\`.

What's missing is the orchestrator that ties them.

## Behavior we want

A new opt-in flag: \`--auto-fix\` (alias \`--repair\`).

\`\`\`
ricky run workflows/generated/foo.ts --auto-fix
ricky run workflows/generated/foo.ts --auto-fix=5     # max 5 attempts
ricky --mode local --spec-file my.md --run --auto-fix             # composes with --run
\`\`\`

Default attempts: **3**. \`--auto-fix\` with no value → 3. \`--auto-fix=N\` → N attempts (1–10 clamped).

Loop semantics on each iteration:

1. Run the workflow (first attempt: from the start; subsequent attempts: with \`--start-from <failed-step> --previous-run-id <prev-run-id>\`).
2. On success → print summary, exit 0.
3. On failure → call \`classifyFailure(evidence)\` then \`debugWorkflowRun({ evidence, classification })\` to get \`repairMode\` + a recommendation.
4. Branch on \`repairMode\`:
   - \`'direct'\`: apply the fix (see [Auto-applicable fixes](#auto-applicable-fixes) below). If the fix itself fails → escalate (treat as \`'manual'\`). If it succeeds → loop.
   - \`'guided'\`: don't auto-apply. Print the suggested steps. Exit non-zero with the suggestion. (User can rerun with the steps applied.)
   - \`'manual'\`: print the diagnosis + recommendation. Exit non-zero. No retry.
5. After the configured max attempts → print all attempt summaries, the final blocker, and exit 2.

The loop is **opt-in** — without \`--auto-fix\`, today's behavior is unchanged: one attempt, classified blocker, exit.

## Auto-applicable fixes

A "direct" repair is one Ricky can apply non-destructively, with a deterministic verification. v1 covers exactly these cases:

| Failure class      | Auto-applied fix                                        | Verification                                          |
|--------------------|---------------------------------------------------------|-------------------------------------------------------|
| \`MISSING_BINARY\`   | Run the \`steps\` from the blocker (\`npm install\`, etc.) | Re-check \`node_modules/.bin/<pkg>\` or \`command -v\`    |
| \`NETWORK_TRANSIENT\`| No edit — straight retry with backoff                  | (none — retry is the verification)                    |

Anything else (parse errors, assertion failures, missing env vars, dependency-version mismatches) → \`repairMode\` is *not* \`'direct'\`. Those become guided/manual; v1 does not auto-edit code or write env files.

Future cases to consider in v2 (out of scope here):
- Workflow parse errors with a single-line fix hint
- Lockfile drift (re-run install)
- LLM-assisted code fixes (would need explicit, separate consent)

## Failed-step + previous-run-id resolution

\`agent-relay run --start-from X --previous-run-id Y\` skips predecessors of step \`X\` and reuses cached outputs from run \`Y\`. To call it, Ricky needs both values from the *previous* attempt:

- **Failed step**: extracted from \`evidence.steps[]\` — the first step with \`status: 'failed'\`. If no step granularity is reported (e.g. process crashed before any step started), \`--start-from\` is omitted and we just retry the whole run with \`--previous-run-id\`.
- **Previous run id**: read from the run-id file the prior \`agent-relay run\` wrote (\`AGENT_RELAY_RUN_ID_FILE\`), or parsed from the \`Run ID:\` line agent-relay prints to stderr on failure. The runtime already passes the env var; Ricky just needs to read the file (or parse stderr) when it fires.

If neither source yields a run id, retry without \`--previous-run-id\` (full re-run) and warn that step-level resume wasn't possible.

## CLI surface changes

- New flag in \`parseArgs\` (\`src/surfaces/cli/commands/cli-main.ts\`): \`--auto-fix[=N]\`. Parses to \`parsed.autoFix?: number\` where \`undefined\` means "off" and a number means "max attempts".
- Threaded through the CLI handoff into \`LocalInvocationRequest\` (extend the type with an \`autoFix?: { maxAttempts: number }\` field — coexists with the existing \`stageMode\`).
- New top-level orchestrator function in \`src/local/auto-fix-loop.ts\` (or co-located in \`entrypoint.ts\` if small enough):
  \`\`\`ts
  async function runWithAutoFix(
    request: LocalInvocationRequest,
    options: { maxAttempts: number; ... },
  ): Promise<LocalResponse>
  \`\`\`
  This wraps the existing single-attempt path. When the response is a failure with a directly-repairable blocker, it applies the fix, captures the run-id, and re-invokes with \`retry\` metadata populated.

The existing single-attempt path stays exactly as-is. The loop is a wrapper — no behavioral change when \`autoFix\` is unset.

## Output shape

For each attempt, the loop emits a labeled section:

\`\`\`
attempt 1/3:
  status: blocker (MISSING_BINARY)
  applied fix: npm install
  fix outcome: ok
attempt 2/3:
  status: ok
  duration: 14.2s
\`\`\`

The final exit message summarizes: \`Auto-fix loop succeeded on attempt 2/3.\` or \`Auto-fix loop exhausted 3 attempts. Final blocker: ...\`.

When \`--json\` is set, the response includes:
\`\`\`json
{
  "auto_fix": {
    "max_attempts": 3,
    "attempts": [
      { "attempt": 1, "status": "blocker", "blocker_code": "MISSING_BINARY", "applied_fix": { "steps": ["npm install"], "exit_code": 0 } },
      { "attempt": 2, "status": "ok", "run_id": "..." }
    ],
    "final_status": "ok"
  }
}
\`\`\`

## Test cases

Unit tests in \`src/local/auto-fix-loop.test.ts\`:

1. **Single-attempt success bypasses the loop** — first run returns \`ok\`, no debugger call, no retry args.
2. **Direct repair retries with start-from + previous-run-id** — first attempt blocks on MISSING_BINARY, fix runs successfully, second attempt is invoked with \`retry.previousRunId\` and the failed step.
3. **Repair failure escalates** — direct repair's command exits non-zero. Loop stops, exit non-zero, user gets the recovery steps.
4. **Guided repairMode never retries** — output includes the recommended steps; exit non-zero; no second invocation.
5. **Max attempts exhaustion** — three blockers in a row, all with directly-repairable fixes that don't actually help. Loop stops at attempt 3 with all attempt summaries.
6. **Run id missing from prior attempt** — second attempt invoked without \`--previous-run-id\` and a warning logged.
7. **\`--auto-fix=0\` is treated as \`--no-auto-fix\`** (or rejected with a parse error — pick one and document).
8. **\`--auto-fix\` composes with \`--run\` after \`--spec-file\`** — generate, then enter the loop on the first run.

End-to-end (manual, not automated): generate a workflow that fails on first run because of a missing dep, run with \`--auto-fix\`, observe ricky installs it and resumes from the failed step.

## Out of scope

- LLM-assisted code edits as auto-fixes. (Requires separate consent flow.)
- Persistent state across CLI invocations. The loop is per-invocation.
- Concurrent retry of independent steps. Sequential only.
- Cloud execution. This is local/BYOH only; cloud has its own retry semantics via \`agent-relay cloud run\`.

## Acceptance

- \`ricky run <path> --auto-fix\` succeeds on a workflow that fails the first attempt with a \`MISSING_BINARY\` blocker and is fixable by \`npm install\`.
- Same command with \`--auto-fix=1\` runs once, blocker reported, no retry.
- Same command without \`--auto-fix\` behaves identically to today (single attempt, no debugger call).
- All existing \`runLocal\` tests still pass — the loop is a wrapper, not a replacement.
- \`ricky --help\` documents the flag.

Write .workflow-artifacts/generated/spec-ricky-run-auto-fix-diagnose-repair-and-resu/review-claude.md ending with REVIEW_COMPLETE.`,
      verification: { type: 'file_exists', value: ".workflow-artifacts/generated/spec-ricky-run-auto-fix-diagnose-repair-and-resu/review-claude.md" },
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
# Spec: \`ricky run --auto-fix\` — diagnose, repair, and resume on failure

## Problem

Today \`ricky run <path>\` shells out to \`agent-relay run <path>\` and reports back. On failure, the user gets a classified blocker (MISSING_BINARY, INVALID_ARTIFACT, etc.) and a list of recovery steps — but they have to run those recovery steps by hand, then re-invoke \`agent-relay run --start-from <step> --previous-run-id <runId>\` themselves.

That's the part Ricky should automate. The pieces already exist, but nothing wires them into a closed loop:

- \`runtime/failure/classifier.ts\` classifies failures by category.
- \`product/specialists/debugger/debugger.ts\` exposes \`debugWorkflowRun(evidence)\` returning a diagnosis + fix recommendation + a \`repairMode\` of \`'direct' | 'guided' | 'manual'\`.
- \`LocalCoordinator\` already accepts \`retry: { previousRunId, retryOfRunId, attempt, reason }\` and threads \`--start-from\` / \`--previous-run-id\` into the spawn args.
- \`agent-relay run\` writes a run-id file (\`AGENT_RELAY_RUN_ID_FILE\` env) and supports \`--start-from <step> --previous-run-id <id>\`.

What's missing is the orchestrator that ties them.

## Behavior we want

A new opt-in flag: \`--auto-fix\` (alias \`--repair\`).

\`\`\`
ricky run workflows/generated/foo.ts --auto-fix
ricky run workflows/generated/foo.ts --auto-fix=5     # max 5 attempts
ricky --mode local --spec-file my.md --run --auto-fix             # composes with --run
\`\`\`

Default attempts: **3**. \`--auto-fix\` with no value → 3. \`--auto-fix=N\` → N attempts (1–10 clamped).

Loop semantics on each iteration:

1. Run the workflow (first attempt: from the start; subsequent attempts: with \`--start-from <failed-step> --previous-run-id <prev-run-id>\`).
2. On success → print summary, exit 0.
3. On failure → call \`classifyFailure(evidence)\` then \`debugWorkflowRun({ evidence, classification })\` to get \`repairMode\` + a recommendation.
4. Branch on \`repairMode\`:
   - \`'direct'\`: apply the fix (see [Auto-applicable fixes](#auto-applicable-fixes) below). If the fix itself fails → escalate (treat as \`'manual'\`). If it succeeds → loop.
   - \`'guided'\`: don't auto-apply. Print the suggested steps. Exit non-zero with the suggestion. (User can rerun with the steps applied.)
   - \`'manual'\`: print the diagnosis + recommendation. Exit non-zero. No retry.
5. After the configured max attempts → print all attempt summaries, the final blocker, and exit 2.

The loop is **opt-in** — without \`--auto-fix\`, today's behavior is unchanged: one attempt, classified blocker, exit.

## Auto-applicable fixes

A "direct" repair is one Ricky can apply non-destructively, with a deterministic verification. v1 covers exactly these cases:

| Failure class      | Auto-applied fix                                        | Verification                                          |
|--------------------|---------------------------------------------------------|-------------------------------------------------------|
| \`MISSING_BINARY\`   | Run the \`steps\` from the blocker (\`npm install\`, etc.) | Re-check \`node_modules/.bin/<pkg>\` or \`command -v\`    |
| \`NETWORK_TRANSIENT\`| No edit — straight retry with backoff                  | (none — retry is the verification)                    |

Anything else (parse errors, assertion failures, missing env vars, dependency-version mismatches) → \`repairMode\` is *not* \`'direct'\`. Those become guided/manual; v1 does not auto-edit code or write env files.

Future cases to consider in v2 (out of scope here):
- Workflow parse errors with a single-line fix hint
- Lockfile drift (re-run install)
- LLM-assisted code fixes (would need explicit, separate consent)

## Failed-step + previous-run-id resolution

\`agent-relay run --start-from X --previous-run-id Y\` skips predecessors of step \`X\` and reuses cached outputs from run \`Y\`. To call it, Ricky needs both values from the *previous* attempt:

- **Failed step**: extracted from \`evidence.steps[]\` — the first step with \`status: 'failed'\`. If no step granularity is reported (e.g. process crashed before any step started), \`--start-from\` is omitted and we just retry the whole run with \`--previous-run-id\`.
- **Previous run id**: read from the run-id file the prior \`agent-relay run\` wrote (\`AGENT_RELAY_RUN_ID_FILE\`), or parsed from the \`Run ID:\` line agent-relay prints to stderr on failure. The runtime already passes the env var; Ricky just needs to read the file (or parse stderr) when it fires.

If neither source yields a run id, retry without \`--previous-run-id\` (full re-run) and warn that step-level resume wasn't possible.

## CLI surface changes

- New flag in \`parseArgs\` (\`src/surfaces/cli/commands/cli-main.ts\`): \`--auto-fix[=N]\`. Parses to \`parsed.autoFix?: number\` where \`undefined\` means "off" and a number means "max attempts".
- Threaded through the CLI handoff into \`LocalInvocationRequest\` (extend the type with an \`autoFix?: { maxAttempts: number }\` field — coexists with the existing \`stageMode\`).
- New top-level orchestrator function in \`src/local/auto-fix-loop.ts\` (or co-located in \`entrypoint.ts\` if small enough):
  \`\`\`ts
  async function runWithAutoFix(
    request: LocalInvocationRequest,
    options: { maxAttempts: number; ... },
  ): Promise<LocalResponse>
  \`\`\`
  This wraps the existing single-attempt path. When the response is a failure with a directly-repairable blocker, it applies the fix, captures the run-id, and re-invokes with \`retry\` metadata populated.

The existing single-attempt path stays exactly as-is. The loop is a wrapper — no behavioral change when \`autoFix\` is unset.

## Output shape

For each attempt, the loop emits a labeled section:

\`\`\`
attempt 1/3:
  status: blocker (MISSING_BINARY)
  applied fix: npm install
  fix outcome: ok
attempt 2/3:
  status: ok
  duration: 14.2s
\`\`\`

The final exit message summarizes: \`Auto-fix loop succeeded on attempt 2/3.\` or \`Auto-fix loop exhausted 3 attempts. Final blocker: ...\`.

When \`--json\` is set, the response includes:
\`\`\`json
{
  "auto_fix": {
    "max_attempts": 3,
    "attempts": [
      { "attempt": 1, "status": "blocker", "blocker_code": "MISSING_BINARY", "applied_fix": { "steps": ["npm install"], "exit_code": 0 } },
      { "attempt": 2, "status": "ok", "run_id": "..." }
    ],
    "final_status": "ok"
  }
}
\`\`\`

## Test cases

Unit tests in \`src/local/auto-fix-loop.test.ts\`:

1. **Single-attempt success bypasses the loop** — first run returns \`ok\`, no debugger call, no retry args.
2. **Direct repair retries with start-from + previous-run-id** — first attempt blocks on MISSING_BINARY, fix runs successfully, second attempt is invoked with \`retry.previousRunId\` and the failed step.
3. **Repair failure escalates** — direct repair's command exits non-zero. Loop stops, exit non-zero, user gets the recovery steps.
4. **Guided repairMode never retries** — output includes the recommended steps; exit non-zero; no second invocation.
5. **Max attempts exhaustion** — three blockers in a row, all with directly-repairable fixes that don't actually help. Loop stops at attempt 3 with all attempt summaries.
6. **Run id missing from prior attempt** — second attempt invoked without \`--previous-run-id\` and a warning logged.
7. **\`--auto-fix=0\` is treated as \`--no-auto-fix\`** (or rejected with a parse error — pick one and document).
8. **\`--auto-fix\` composes with \`--run\` after \`--spec-file\`** — generate, then enter the loop on the first run.

End-to-end (manual, not automated): generate a workflow that fails on first run because of a missing dep, run with \`--auto-fix\`, observe ricky installs it and resumes from the failed step.

## Out of scope

- LLM-assisted code edits as auto-fixes. (Requires separate consent flow.)
- Persistent state across CLI invocations. The loop is per-invocation.
- Concurrent retry of independent steps. Sequential only.
- Cloud execution. This is local/BYOH only; cloud has its own retry semantics via \`agent-relay cloud run\`.

## Acceptance

- \`ricky run <path> --auto-fix\` succeeds on a workflow that fails the first attempt with a \`MISSING_BINARY\` blocker and is fixable by \`npm install\`.
- Same command with \`--auto-fix=1\` runs once, blocker reported, no retry.
- Same command without \`--auto-fix\` behaves identically to today (single attempt, no debugger call).
- All existing \`runLocal\` tests still pass — the loop is a wrapper, not a replacement.
- \`ricky --help\` documents the flag.

Write .workflow-artifacts/generated/spec-ricky-run-auto-fix-diagnose-repair-and-resu/review-codex.md ending with REVIEW_COMPLETE.`,
      verification: { type: 'file_exists', value: ".workflow-artifacts/generated/spec-ricky-run-auto-fix-diagnose-repair-and-resu/review-codex.md" },
    })

    .step("read-review-feedback", {
      type: 'deterministic',
      dependsOn: ["review-claude", "review-codex"],
      command: "test -f '.workflow-artifacts/generated/spec-ricky-run-auto-fix-diagnose-repair-and-resu/review-claude.md' && test -f '.workflow-artifacts/generated/spec-ricky-run-auto-fix-diagnose-repair-and-resu/review-codex.md' && cat '.workflow-artifacts/generated/spec-ricky-run-auto-fix-diagnose-repair-and-resu/review-claude.md' '.workflow-artifacts/generated/spec-ricky-run-auto-fix-diagnose-repair-and-resu/review-codex.md' > '.workflow-artifacts/generated/spec-ricky-run-auto-fix-diagnose-repair-and-resu/review-feedback.md'",
      captureOutput: true,
      failOnError: true,
    })

    .step('fix-loop', {
      agent: 'validator-claude',
      dependsOn: ['read-review-feedback'],
      task: `Run the 80-to-100 fix loop.

Inputs:
- .workflow-artifacts/generated/spec-ricky-run-auto-fix-diagnose-repair-and-resu/review-feedback.md
- initial validation output from the previous deterministic step

Fix only concrete review or validation findings. Preserve the declared target boundary:
- workflows/generated/foo.ts
- guided/manual
- 1/3
- 2/3
- local/BYOH

Re-run typecheck and tests before handing off to post-fix validation.`,
    })

    .step("post-fix-verification-gate", {
      type: 'deterministic',
      dependsOn: ["fix-loop"],
      command: "grep -Eq 'autoFix|--auto-fix' src/surfaces/cli/commands/cli-main.ts && test -f 'src/local/auto-fix-loop.ts' && test -f 'src/local/auto-fix-loop.test.ts'",
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
# Spec: \`ricky run --auto-fix\` — diagnose, repair, and resume on failure

## Problem

Today \`ricky run <path>\` shells out to \`agent-relay run <path>\` and reports back. On failure, the user gets a classified blocker (MISSING_BINARY, INVALID_ARTIFACT, etc.) and a list of recovery steps — but they have to run those recovery steps by hand, then re-invoke \`agent-relay run --start-from <step> --previous-run-id <runId>\` themselves.

That's the part Ricky should automate. The pieces already exist, but nothing wires them into a closed loop:

- \`runtime/failure/classifier.ts\` classifies failures by category.
- \`product/specialists/debugger/debugger.ts\` exposes \`debugWorkflowRun(evidence)\` returning a diagnosis + fix recommendation + a \`repairMode\` of \`'direct' | 'guided' | 'manual'\`.
- \`LocalCoordinator\` already accepts \`retry: { previousRunId, retryOfRunId, attempt, reason }\` and threads \`--start-from\` / \`--previous-run-id\` into the spawn args.
- \`agent-relay run\` writes a run-id file (\`AGENT_RELAY_RUN_ID_FILE\` env) and supports \`--start-from <step> --previous-run-id <id>\`.

What's missing is the orchestrator that ties them.

## Behavior we want

A new opt-in flag: \`--auto-fix\` (alias \`--repair\`).

\`\`\`
ricky run workflows/generated/foo.ts --auto-fix
ricky run workflows/generated/foo.ts --auto-fix=5     # max 5 attempts
ricky --mode local --spec-file my.md --run --auto-fix             # composes with --run
\`\`\`

Default attempts: **3**. \`--auto-fix\` with no value → 3. \`--auto-fix=N\` → N attempts (1–10 clamped).

Loop semantics on each iteration:

1. Run the workflow (first attempt: from the start; subsequent attempts: with \`--start-from <failed-step> --previous-run-id <prev-run-id>\`).
2. On success → print summary, exit 0.
3. On failure → call \`classifyFailure(evidence)\` then \`debugWorkflowRun({ evidence, classification })\` to get \`repairMode\` + a recommendation.
4. Branch on \`repairMode\`:
   - \`'direct'\`: apply the fix (see [Auto-applicable fixes](#auto-applicable-fixes) below). If the fix itself fails → escalate (treat as \`'manual'\`). If it succeeds → loop.
   - \`'guided'\`: don't auto-apply. Print the suggested steps. Exit non-zero with the suggestion. (User can rerun with the steps applied.)
   - \`'manual'\`: print the diagnosis + recommendation. Exit non-zero. No retry.
5. After the configured max attempts → print all attempt summaries, the final blocker, and exit 2.

The loop is **opt-in** — without \`--auto-fix\`, today's behavior is unchanged: one attempt, classified blocker, exit.

## Auto-applicable fixes

A "direct" repair is one Ricky can apply non-destructively, with a deterministic verification. v1 covers exactly these cases:

| Failure class      | Auto-applied fix                                        | Verification                                          |
|--------------------|---------------------------------------------------------|-------------------------------------------------------|
| \`MISSING_BINARY\`   | Run the \`steps\` from the blocker (\`npm install\`, etc.) | Re-check \`node_modules/.bin/<pkg>\` or \`command -v\`    |
| \`NETWORK_TRANSIENT\`| No edit — straight retry with backoff                  | (none — retry is the verification)                    |

Anything else (parse errors, assertion failures, missing env vars, dependency-version mismatches) → \`repairMode\` is *not* \`'direct'\`. Those become guided/manual; v1 does not auto-edit code or write env files.

Future cases to consider in v2 (out of scope here):
- Workflow parse errors with a single-line fix hint
- Lockfile drift (re-run install)
- LLM-assisted code fixes (would need explicit, separate consent)

## Failed-step + previous-run-id resolution

\`agent-relay run --start-from X --previous-run-id Y\` skips predecessors of step \`X\` and reuses cached outputs from run \`Y\`. To call it, Ricky needs both values from the *previous* attempt:

- **Failed step**: extracted from \`evidence.steps[]\` — the first step with \`status: 'failed'\`. If no step granularity is reported (e.g. process crashed before any step started), \`--start-from\` is omitted and we just retry the whole run with \`--previous-run-id\`.
- **Previous run id**: read from the run-id file the prior \`agent-relay run\` wrote (\`AGENT_RELAY_RUN_ID_FILE\`), or parsed from the \`Run ID:\` line agent-relay prints to stderr on failure. The runtime already passes the env var; Ricky just needs to read the file (or parse stderr) when it fires.

If neither source yields a run id, retry without \`--previous-run-id\` (full re-run) and warn that step-level resume wasn't possible.

## CLI surface changes

- New flag in \`parseArgs\` (\`src/surfaces/cli/commands/cli-main.ts\`): \`--auto-fix[=N]\`. Parses to \`parsed.autoFix?: number\` where \`undefined\` means "off" and a number means "max attempts".
- Threaded through the CLI handoff into \`LocalInvocationRequest\` (extend the type with an \`autoFix?: { maxAttempts: number }\` field — coexists with the existing \`stageMode\`).
- New top-level orchestrator function in \`src/local/auto-fix-loop.ts\` (or co-located in \`entrypoint.ts\` if small enough):
  \`\`\`ts
  async function runWithAutoFix(
    request: LocalInvocationRequest,
    options: { maxAttempts: number; ... },
  ): Promise<LocalResponse>
  \`\`\`
  This wraps the existing single-attempt path. When the response is a failure with a directly-repairable blocker, it applies the fix, captures the run-id, and re-invokes with \`retry\` metadata populated.

The existing single-attempt path stays exactly as-is. The loop is a wrapper — no behavioral change when \`autoFix\` is unset.

## Output shape

For each attempt, the loop emits a labeled section:

\`\`\`
attempt 1/3:
  status: blocker (MISSING_BINARY)
  applied fix: npm install
  fix outcome: ok
attempt 2/3:
  status: ok
  duration: 14.2s
\`\`\`

The final exit message summarizes: \`Auto-fix loop succeeded on attempt 2/3.\` or \`Auto-fix loop exhausted 3 attempts. Final blocker: ...\`.

When \`--json\` is set, the response includes:
\`\`\`json
{
  "auto_fix": {
    "max_attempts": 3,
    "attempts": [
      { "attempt": 1, "status": "blocker", "blocker_code": "MISSING_BINARY", "applied_fix": { "steps": ["npm install"], "exit_code": 0 } },
      { "attempt": 2, "status": "ok", "run_id": "..." }
    ],
    "final_status": "ok"
  }
}
\`\`\`

## Test cases

Unit tests in \`src/local/auto-fix-loop.test.ts\`:

1. **Single-attempt success bypasses the loop** — first run returns \`ok\`, no debugger call, no retry args.
2. **Direct repair retries with start-from + previous-run-id** — first attempt blocks on MISSING_BINARY, fix runs successfully, second attempt is invoked with \`retry.previousRunId\` and the failed step.
3. **Repair failure escalates** — direct repair's command exits non-zero. Loop stops, exit non-zero, user gets the recovery steps.
4. **Guided repairMode never retries** — output includes the recommended steps; exit non-zero; no second invocation.
5. **Max attempts exhaustion** — three blockers in a row, all with directly-repairable fixes that don't actually help. Loop stops at attempt 3 with all attempt summaries.
6. **Run id missing from prior attempt** — second attempt invoked without \`--previous-run-id\` and a warning logged.
7. **\`--auto-fix=0\` is treated as \`--no-auto-fix\`** (or rejected with a parse error — pick one and document).
8. **\`--auto-fix\` composes with \`--run\` after \`--spec-file\`** — generate, then enter the loop on the first run.

End-to-end (manual, not automated): generate a workflow that fails on first run because of a missing dep, run with \`--auto-fix\`, observe ricky installs it and resumes from the failed step.

## Out of scope

- LLM-assisted code edits as auto-fixes. (Requires separate consent flow.)
- Persistent state across CLI invocations. The loop is per-invocation.
- Concurrent retry of independent steps. Sequential only.
- Cloud execution. This is local/BYOH only; cloud has its own retry semantics via \`agent-relay cloud run\`.

## Acceptance

- \`ricky run <path> --auto-fix\` succeeds on a workflow that fails the first attempt with a \`MISSING_BINARY\` blocker and is fixable by \`npm install\`.
- Same command with \`--auto-fix=1\` runs once, blocker reported, no retry.
- Same command without \`--auto-fix\` behaves identically to today (single attempt, no debugger call).
- All existing \`runLocal\` tests still pass — the loop is a wrapper, not a replacement.
- \`ricky --help\` documents the flag.

Write .workflow-artifacts/generated/spec-ricky-run-auto-fix-diagnose-repair-and-resu/final-review-claude.md ending with FINAL_REVIEW_CLAUDE_PASS.`,
      verification: { type: 'file_exists', value: ".workflow-artifacts/generated/spec-ricky-run-auto-fix-diagnose-repair-and-resu/final-review-claude.md" },
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
# Spec: \`ricky run --auto-fix\` — diagnose, repair, and resume on failure

## Problem

Today \`ricky run <path>\` shells out to \`agent-relay run <path>\` and reports back. On failure, the user gets a classified blocker (MISSING_BINARY, INVALID_ARTIFACT, etc.) and a list of recovery steps — but they have to run those recovery steps by hand, then re-invoke \`agent-relay run --start-from <step> --previous-run-id <runId>\` themselves.

That's the part Ricky should automate. The pieces already exist, but nothing wires them into a closed loop:

- \`runtime/failure/classifier.ts\` classifies failures by category.
- \`product/specialists/debugger/debugger.ts\` exposes \`debugWorkflowRun(evidence)\` returning a diagnosis + fix recommendation + a \`repairMode\` of \`'direct' | 'guided' | 'manual'\`.
- \`LocalCoordinator\` already accepts \`retry: { previousRunId, retryOfRunId, attempt, reason }\` and threads \`--start-from\` / \`--previous-run-id\` into the spawn args.
- \`agent-relay run\` writes a run-id file (\`AGENT_RELAY_RUN_ID_FILE\` env) and supports \`--start-from <step> --previous-run-id <id>\`.

What's missing is the orchestrator that ties them.

## Behavior we want

A new opt-in flag: \`--auto-fix\` (alias \`--repair\`).

\`\`\`
ricky run workflows/generated/foo.ts --auto-fix
ricky run workflows/generated/foo.ts --auto-fix=5     # max 5 attempts
ricky --mode local --spec-file my.md --run --auto-fix             # composes with --run
\`\`\`

Default attempts: **3**. \`--auto-fix\` with no value → 3. \`--auto-fix=N\` → N attempts (1–10 clamped).

Loop semantics on each iteration:

1. Run the workflow (first attempt: from the start; subsequent attempts: with \`--start-from <failed-step> --previous-run-id <prev-run-id>\`).
2. On success → print summary, exit 0.
3. On failure → call \`classifyFailure(evidence)\` then \`debugWorkflowRun({ evidence, classification })\` to get \`repairMode\` + a recommendation.
4. Branch on \`repairMode\`:
   - \`'direct'\`: apply the fix (see [Auto-applicable fixes](#auto-applicable-fixes) below). If the fix itself fails → escalate (treat as \`'manual'\`). If it succeeds → loop.
   - \`'guided'\`: don't auto-apply. Print the suggested steps. Exit non-zero with the suggestion. (User can rerun with the steps applied.)
   - \`'manual'\`: print the diagnosis + recommendation. Exit non-zero. No retry.
5. After the configured max attempts → print all attempt summaries, the final blocker, and exit 2.

The loop is **opt-in** — without \`--auto-fix\`, today's behavior is unchanged: one attempt, classified blocker, exit.

## Auto-applicable fixes

A "direct" repair is one Ricky can apply non-destructively, with a deterministic verification. v1 covers exactly these cases:

| Failure class      | Auto-applied fix                                        | Verification                                          |
|--------------------|---------------------------------------------------------|-------------------------------------------------------|
| \`MISSING_BINARY\`   | Run the \`steps\` from the blocker (\`npm install\`, etc.) | Re-check \`node_modules/.bin/<pkg>\` or \`command -v\`    |
| \`NETWORK_TRANSIENT\`| No edit — straight retry with backoff                  | (none — retry is the verification)                    |

Anything else (parse errors, assertion failures, missing env vars, dependency-version mismatches) → \`repairMode\` is *not* \`'direct'\`. Those become guided/manual; v1 does not auto-edit code or write env files.

Future cases to consider in v2 (out of scope here):
- Workflow parse errors with a single-line fix hint
- Lockfile drift (re-run install)
- LLM-assisted code fixes (would need explicit, separate consent)

## Failed-step + previous-run-id resolution

\`agent-relay run --start-from X --previous-run-id Y\` skips predecessors of step \`X\` and reuses cached outputs from run \`Y\`. To call it, Ricky needs both values from the *previous* attempt:

- **Failed step**: extracted from \`evidence.steps[]\` — the first step with \`status: 'failed'\`. If no step granularity is reported (e.g. process crashed before any step started), \`--start-from\` is omitted and we just retry the whole run with \`--previous-run-id\`.
- **Previous run id**: read from the run-id file the prior \`agent-relay run\` wrote (\`AGENT_RELAY_RUN_ID_FILE\`), or parsed from the \`Run ID:\` line agent-relay prints to stderr on failure. The runtime already passes the env var; Ricky just needs to read the file (or parse stderr) when it fires.

If neither source yields a run id, retry without \`--previous-run-id\` (full re-run) and warn that step-level resume wasn't possible.

## CLI surface changes

- New flag in \`parseArgs\` (\`src/surfaces/cli/commands/cli-main.ts\`): \`--auto-fix[=N]\`. Parses to \`parsed.autoFix?: number\` where \`undefined\` means "off" and a number means "max attempts".
- Threaded through the CLI handoff into \`LocalInvocationRequest\` (extend the type with an \`autoFix?: { maxAttempts: number }\` field — coexists with the existing \`stageMode\`).
- New top-level orchestrator function in \`src/local/auto-fix-loop.ts\` (or co-located in \`entrypoint.ts\` if small enough):
  \`\`\`ts
  async function runWithAutoFix(
    request: LocalInvocationRequest,
    options: { maxAttempts: number; ... },
  ): Promise<LocalResponse>
  \`\`\`
  This wraps the existing single-attempt path. When the response is a failure with a directly-repairable blocker, it applies the fix, captures the run-id, and re-invokes with \`retry\` metadata populated.

The existing single-attempt path stays exactly as-is. The loop is a wrapper — no behavioral change when \`autoFix\` is unset.

## Output shape

For each attempt, the loop emits a labeled section:

\`\`\`
attempt 1/3:
  status: blocker (MISSING_BINARY)
  applied fix: npm install
  fix outcome: ok
attempt 2/3:
  status: ok
  duration: 14.2s
\`\`\`

The final exit message summarizes: \`Auto-fix loop succeeded on attempt 2/3.\` or \`Auto-fix loop exhausted 3 attempts. Final blocker: ...\`.

When \`--json\` is set, the response includes:
\`\`\`json
{
  "auto_fix": {
    "max_attempts": 3,
    "attempts": [
      { "attempt": 1, "status": "blocker", "blocker_code": "MISSING_BINARY", "applied_fix": { "steps": ["npm install"], "exit_code": 0 } },
      { "attempt": 2, "status": "ok", "run_id": "..." }
    ],
    "final_status": "ok"
  }
}
\`\`\`

## Test cases

Unit tests in \`src/local/auto-fix-loop.test.ts\`:

1. **Single-attempt success bypasses the loop** — first run returns \`ok\`, no debugger call, no retry args.
2. **Direct repair retries with start-from + previous-run-id** — first attempt blocks on MISSING_BINARY, fix runs successfully, second attempt is invoked with \`retry.previousRunId\` and the failed step.
3. **Repair failure escalates** — direct repair's command exits non-zero. Loop stops, exit non-zero, user gets the recovery steps.
4. **Guided repairMode never retries** — output includes the recommended steps; exit non-zero; no second invocation.
5. **Max attempts exhaustion** — three blockers in a row, all with directly-repairable fixes that don't actually help. Loop stops at attempt 3 with all attempt summaries.
6. **Run id missing from prior attempt** — second attempt invoked without \`--previous-run-id\` and a warning logged.
7. **\`--auto-fix=0\` is treated as \`--no-auto-fix\`** (or rejected with a parse error — pick one and document).
8. **\`--auto-fix\` composes with \`--run\` after \`--spec-file\`** — generate, then enter the loop on the first run.

End-to-end (manual, not automated): generate a workflow that fails on first run because of a missing dep, run with \`--auto-fix\`, observe ricky installs it and resumes from the failed step.

## Out of scope

- LLM-assisted code edits as auto-fixes. (Requires separate consent flow.)
- Persistent state across CLI invocations. The loop is per-invocation.
- Concurrent retry of independent steps. Sequential only.
- Cloud execution. This is local/BYOH only; cloud has its own retry semantics via \`agent-relay cloud run\`.

## Acceptance

- \`ricky run <path> --auto-fix\` succeeds on a workflow that fails the first attempt with a \`MISSING_BINARY\` blocker and is fixable by \`npm install\`.
- Same command with \`--auto-fix=1\` runs once, blocker reported, no retry.
- Same command without \`--auto-fix\` behaves identically to today (single attempt, no debugger call).
- All existing \`runLocal\` tests still pass — the loop is a wrapper, not a replacement.
- \`ricky --help\` documents the flag.

Write .workflow-artifacts/generated/spec-ricky-run-auto-fix-diagnose-repair-and-resu/final-review-codex.md ending with FINAL_REVIEW_CODEX_PASS.`,
      verification: { type: 'file_exists', value: ".workflow-artifacts/generated/spec-ricky-run-auto-fix-diagnose-repair-and-resu/final-review-codex.md" },
    })

    .step("final-review-pass-gate", {
      type: 'deterministic',
      dependsOn: ["final-review-claude", "final-review-codex"],
      command: "tail -n 1 '.workflow-artifacts/generated/spec-ricky-run-auto-fix-diagnose-repair-and-resu/final-review-claude.md' | tr -d '[:space:]*' | grep -Eq '^FINAL_REVIEW_CLAUDE_PASS$' && tail -n 1 '.workflow-artifacts/generated/spec-ricky-run-auto-fix-diagnose-repair-and-resu/final-review-codex.md' | tr -d '[:space:]*' | grep -Eq '^FINAL_REVIEW_CODEX_PASS$'",
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
      command: "git diff --name-only -- 'workflows/generated/foo.ts' 'guided/manual' '1/3' '2/3' 'local/BYOH' > '.workflow-artifacts/generated/spec-ricky-run-auto-fix-diagnose-repair-and-resu/git-diff.txt' && test -s '.workflow-artifacts/generated/spec-ricky-run-auto-fix-diagnose-repair-and-resu/git-diff.txt'",
      captureOutput: true,
      failOnError: true,
    })

    .step("regression-gate", {
      type: 'deterministic',
      dependsOn: ["git-diff-gate"],
      command: "npx vitest run",
      captureOutput: true,
      failOnError: true,
    })

    .step('final-signoff', {
      agent: 'validator-claude',
      dependsOn: ['regression-gate'],
      task: `Write .workflow-artifacts/generated/spec-ricky-run-auto-fix-diagnose-repair-and-resu/signoff.md.

Include:
- files changed
- dry-run command to execute before runtime launch
- deterministic validation commands
- review verdicts
- skill application boundary from .workflow-artifacts/generated/spec-ricky-run-auto-fix-diagnose-repair-and-resu/skill-application-boundary.json
- remaining risks or environmental blockers

End with GENERATED_WORKFLOW_READY.`,
      verification: { type: 'file_exists', value: ".workflow-artifacts/generated/spec-ricky-run-auto-fix-diagnose-repair-and-resu/signoff.md" },
    })

    .run({ cwd: process.cwd() });

  console.log(result.status);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
