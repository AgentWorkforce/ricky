# Ricky Simplified Workflow CLI Spec

## Purpose

This spec defines the next Ricky CLI experience: a beautiful, hand-holding interactive flow for new and occasional users, plus a compact power-user interface that exposes the same local and Cloud capabilities without ceremony.

The product goal is simple: a user should be able to open Ricky, choose where the workflow should run, hand Ricky a spec or describe the desired outcome, review the generated workflow plan, and then let Ricky take the workflow to completion.

This spec supersedes the older interactive posture where the CLI primarily explained artifact generation and left execution as a separate command. Generation and execution are still separate technical stages, but the human experience should feel like one guided path with an explicit final confirmation before any workflow runs.

## Target Users

- First-time users who know what they want done but do not know Agent Relay workflow structure.
- Returning users who want Ricky to turn a spec into a workflow, run it, monitor it, fix direct blockers, and finish.
- Power users who already know the mode, spec source, provider posture, and run preference.
- Team users who want the same workflow experience locally or through AgentWorkforce Cloud.

## Product Principles

- Make the first screen useful, not explanatory.
- Ask one decision at a time.
- Prefer menus, confirmation prompts, file pickers, and editor prompts over long prose.
- Summarize before running anything with side effects.
- Treat local and Cloud as equivalent execution choices, not advanced settings.
- Keep the power-user path scriptable and quiet by default.
- Never claim an account, credential, integration, or agent connection exists without checking it.
- Never silently fall back from Cloud to local or local to Cloud.

## Prompting Library

Interactive CLI prompts must use `@inquirer/prompts`.

Required dependency:

```json
{
  "dependencies": {
    "@inquirer/prompts": "^8.4.2"
  }
}
```

The package provides individual prompt functions such as `select`, `input`, `confirm`, `checkbox`, `editor`, and `password`. Ricky should import only the prompts it uses:

```ts
import { checkbox, confirm, editor, input, select } from '@inquirer/prompts';
```

Prompt implementation rules:

- Use `select` for mode and next-action choices.
- Use `confirm` for side-effecting actions such as login, provider connection, and run confirmation.
- Use `input` for workflow name, spec path, branch, workspace, and short goal capture.
- Use `editor` when the user wants to paste or write a longer spec.
- Use `checkbox` for optional integration connection prompts.
- Use `AbortController` or the package's prompt context support for clean cancellation.
- Render a concise cancellation message on `Ctrl+C`; do not show stack traces unless `--verbose` is set.
- Preserve non-interactive behavior for piped stdin and CI.

Source note: the current npm metadata for [`@inquirer/prompts`](https://www.npmjs.com/package/@inquirer/prompts) describes it as "Inquirer prompts, combined in a single package", with version `8.4.2`, MIT license, and repository `github.com/SBoudrias/Inquirer.js` as of 2026-04-30.

## Main Interactive Entry

Command:

```text
ricky
```

First screen:

```text
Ricky
Workflow runs, watched to completion.

What do you want to do?
> Run a workflow locally
  Run a workflow in Cloud
  Check status
  Connect tools
  Exit
```

Rules:

- The full ASCII banner may still exist, but the default interactive experience should open compactly.
- A returning user should see mode, account, and provider status inline only when it affects the chosen path.
- The user should never be asked to read a long onboarding page before taking the first action.

## Local Hand-Holding Flow

### Step 1: Choose Local

When the user selects "Run a workflow locally", Ricky should immediately run a local preflight:

- detect repo root
- detect package manager
- detect `agent-relay` availability
- detect known local agent CLIs where useful, including Claude, Codex, OpenCode, and Gemini
- detect whether `.ricky/config.json` exists
- detect whether the current repo has common spec locations, such as `SPEC.md`, `specs/`, `docs/product/`, and `.ricky/specs/`

Preflight must be quiet unless there is a blocker or useful default to offer.

### Step 2: Ask For A Spec

Prompt:

```text
Do you already have a spec for this workflow?
> Yes, use a spec file
  Yes, I will paste or write it now
  No, help me shape one from a goal
  Run an existing workflow file
```

If the user chooses a spec file:

1. Ask for path with smart default suggestions from detected spec files.
2. Ask for a workflow name.
3. Default the name from the spec filename.
4. Pass both spec content and name into the workflow generation request.

If the user writes a spec now:

1. Use `editor`.
2. Ask for a workflow name.
3. Pass the entered spec and name into the generation request.

If the user starts from a goal:

1. Ask for the desired outcome in one sentence.
2. Ask two or three clarifying questions only when needed.
3. Convert the answers into a lightweight spec.
4. Ask the user to approve or edit the generated spec before generation.

If the user chooses an existing workflow file:

1. Ask for the workflow artifact path.
2. Skip workflow generation.
3. Go directly to run summary and confirmation.

### Step 3: Generate The Workflow

Given a spec, Ricky writes the workflow artifact using the existing product generation pipeline. The generation request must include:

- execution mode: `local`
- spec source: file, editor, generated-from-goal, or stdin
- workflow name
- invocation repo root
- requested run mode: background monitored run, unless the user later declines execution

Generated artifacts should continue to land in `workflows/generated/` unless the user supplies an explicit output path.

### Workflow Writer Harness

Workflow writing must be delegated to the adjacent Workforce persona system instead of being authored by Ricky's CLI process directly.

During local development, Ricky should use `../workforce` as the source of the Workforce SDK and harness kit. In packaged builds, this should become the equivalent package dependency on `@agentworkforce/workload-router` and `@agentworkforce/harness-kit`.

Required behavior:

- Resolve the right LLM persona programmatically from Workforce, preferring the Agent Relay workflow-writing persona or the closest routing intent for workflow authoring.
- Invoke the selected persona in a non-interactive, one-shot mode to produce the workflow artifact.
- Use Workforce's harness kit or `usePersona(...).sendMessage()` flow so persona selection, model choice, system prompt, skill materialization, MCP isolation, permissions, environment resolution, and harness-specific argv construction stay centralized in `../workforce`.
- Do not open an interactive Claude, Codex, or OpenCode TUI to write the workflow.
- Do not hand-roll a parallel persona registry inside Ricky.
- Persist the selected persona id, tier, harness, model, prompt digest, warnings, and run id in workflow generation metadata.

For Claude-backed personas, the one-shot invocation should be equivalent to a non-interactive print run such as `claude -p "<workflow-writing task>"` with the persona's system prompt, MCP config, permissions, plugin dirs, and environment injected by the Workforce harness layer. Codex and OpenCode personas should use their equivalent non-interactive harness path through Workforce rather than a terminal UI.

The task sent to the persona must include:

- normalized spec content
- workflow name
- target mode: local or Cloud
- repo root and relevant file context
- required Agent Relay workflow standards
- expected artifact path
- expected JSON or structured response contract
- constraints around verification, agents, side effects, auto-fix, and evidence

The persona response must be parsed as structured output where possible. If the selected harness can only return text, Ricky must require a fenced artifact plus metadata block and validate both before writing the workflow file.

### Step 4: Preview Before Running

After generation, Ricky must show a compact workflow summary:

```text
Ricky wrote: workflows/generated/release-health-check.ts

What this workflow will do
  Verify release health across build, typecheck, tests, and package output.

Agents
  Codex: implement and repair local code or workflow issues.
  Claude: review workflow structure and acceptance criteria.

Plan
  1. Read the release spec and current repo scripts.
  2. Run deterministic checks.
  3. Diagnose failures.
  4. Apply direct fixes when safe.
  5. Rerun until passing or blocked.

Desired outcome
  A completed run with evidence, logs, and a final summary.
```

Summary requirements:

- Name the workflow artifact.
- State the goal in plain language.
- Name every agent Ricky expects to use and each agent's job.
- State the desired outcome.
- State side effects, such as writing files, running tests, opening PRs, or committing changes.
- Surface missing local tools as blockers before offering to run.

### Step 5: Offer To Run

Prompt:

```text
Run this workflow now?
> Yes, run in the background and monitor it
  Yes, run in the foreground
  Not now, just show the command
  Edit the workflow first
```

If the user chooses background execution, Ricky says:

```text
Ricky will run this in the background, monitor for issues, fix direct blockers when safe, and keep going until the workflow completes or needs your decision.
```

Background local execution requirements:

- Start the workflow without requiring the terminal to stay focused.
- Save run state, logs, generated artifacts, fixes, and evidence under `.workflow-artifacts/`.
- Stream a compact status line in the CLI while attached.
- Provide a reattach command.
- Diagnose known blockers.
- Apply only bounded auto-fixes that are already classified as safe.
- Pause and ask for input before destructive actions, credential steps, broad rewrites, dependency upgrades, or commits.
- End with a final summary that includes outcome, changed files, evidence path, and next command.

## Cloud Hand-Holding Flow

### Step 1: Choose Cloud

When the user selects "Run a workflow in Cloud", Ricky must check Cloud readiness before asking for a spec.

Readiness checks:

- active AgentWorkforce Cloud account
- active credentials for the current workspace
- Cloud workspace selected or inferable
- active Cloud agent connections for Claude, Codex, OpenCode, and Gemini
- optional productivity integrations: Slack, GitHub, Notion, and Linear

### Step 2: Account And Credentials

If the user does not have an active Cloud account or credentials, Ricky prompts:

```text
You are not logged in to AgentWorkforce Cloud.

Log in now?
> Yes, open login
  No, go back
```

Rules:

- Use the real AgentWorkforce Cloud login mechanism exposed by the Cloud package or `agent-relay`.
- Do not invent a Ricky-specific OAuth flow.
- After login, re-run the credential check.
- If login fails, show a short recovery message and offer local mode.

### Step 3: Cloud Agent Connections

After login, Ricky checks for active Cloud agents:

```text
Cloud agents
  Claude:   connected
  Codex:    missing
  OpenCode: missing
  Gemini:   connected

Connect missing agents now?
> Yes, connect missing agents
  Choose which agents to connect
  Continue with connected agents
  Go back
```

Rules:

- At least one capable implementation agent must be connected before Cloud execution can run.
- Missing preferred agents should be warnings, not hard blockers, unless the generated workflow requires that agent.
- If the user chooses to connect, launch the real provider connection flow and re-check status afterward.
- The generated summary must reflect the agents actually available in Cloud.

### Step 4: Optional Integrations

Once account and agent readiness pass, Ricky asks about optional integrations:

```text
Connect integrations to make workflow runs better?
> Slack
  GitHub
  Notion
  Linear
```

Rules:

- Use `checkbox`.
- Allow the user to skip all.
- Explain each skipped integration only if it affects the chosen workflow.
- GitHub is required only when the workflow needs repo-hosted auth beyond the uploaded or selected repo context.
- Slack is optional for notifications and approvals.
- Notion and Linear are optional context and issue-tracking enhancements.

### Step 5: Same Spec And Summary Loop

After Cloud readiness, use the same spec flow as local:

1. Ask whether the user has a spec.
2. Capture spec path, editor content, or goal.
3. Ask for workflow name.
4. Generate the workflow.
5. Show the summary, agents, desired outcome, side effects, and missing integration caveats.
6. Offer to run.

Cloud run confirmation:

```text
Run this workflow in AgentWorkforce Cloud?
> Yes, run in Cloud and monitor it
  Not now, show me the Cloud run command
  Edit the workflow first
```

When accepted, Ricky says:

```text
Ricky will run this in Cloud, monitor for issues, fix direct blockers when safe, and keep going until the workflow completes or needs your decision.
```

Cloud execution requirements:

- Submit the workflow artifact and spec metadata to Cloud.
- Persist run id and Cloud URL.
- Show compact progress locally.
- Surface Slack approval or notification setup when Slack is connected.
- Continue monitoring in Cloud if the user closes the terminal.
- End with outcome, artifacts, logs, changed files or PR links, and a concise next step.

## Power-User Interface

Power users need the same choices without the guided prompts.

### Commands

```text
ricky local --spec-file ./spec.md --name release-health --run
ricky local --spec "verify package publishing readiness" --name package-readiness --run
ricky local --stdin --name typed-spec --run
ricky local --workflow workflows/generated/release-health.ts --run

ricky cloud --spec-file ./spec.md --name release-health --run
ricky cloud --spec "verify package publishing readiness" --name package-readiness --run
ricky cloud --stdin --name typed-spec --run
ricky cloud --workflow workflows/generated/release-health.ts --run

ricky status
ricky connect cloud
ricky connect agents --cloud claude,codex,opencode,gemini
ricky connect integrations --cloud slack,github,notion,linear
```

### Flags

| Flag | Applies to | Meaning |
|---|---|---|
| `--spec <text>` | local, cloud | Inline spec text. |
| `--spec-file <path>` | local, cloud | Read spec from file. |
| `--stdin` | local, cloud | Read spec from stdin. |
| `--workflow <path>` | local, cloud | Run an existing workflow artifact. |
| `--name <name>` | local, cloud | Workflow name passed into generation and run metadata. |
| `--run` | local, cloud | Generate and then run after automatic summary rendering. |
| `--no-run` | local, cloud | Generate only and print next commands. |
| `--background` | local, cloud | Run detached with monitoring. Default for `--run` in interactive mode. |
| `--foreground` | local | Keep process attached and stream full runner output. |
| `--auto-fix <n>` | local, cloud | Maximum bounded repair attempts. Default 3. |
| `--no-auto-fix` | local, cloud | Diagnose but do not apply fixes. |
| `--refine[=<model>]` | local, cloud | Optional LLM refinement pass after deterministic generation. Off by default. |
| `--no-refine` | local, cloud | Explicitly keep deterministic generation only. |
| `--yes` | local, cloud | Accept non-destructive prompts. Never accepts destructive actions. |
| `--json` | local, cloud, status | Emit machine-readable result. |
| `--quiet` | all | Suppress non-essential output. |
| `--verbose` | all | Include diagnostic detail and stack traces for unexpected errors. |

### Power-User Behavior

- If `--run` is omitted, Ricky generates and prints the summary plus run command.
- If `--run --yes` is present, Ricky may skip the interactive run confirmation after showing a one-line summary.
- `--yes` must not approve commits, pushes, destructive file changes, paid Cloud upgrades, credential creation, or broad dependency upgrades.
- If Cloud auth or required agent connections are missing, power-user commands fail with a concise recovery command unless `--login` or `--connect-missing` is present.
- `--json` output must include `mode`, `workflowName`, `workflowPath`, `runId`, `status`, `evidencePath`, `cloudUrl`, `warnings`, and `nextActions` when available.

Example JSON:

```json
{
  "mode": "cloud",
  "workflowName": "release-health",
  "workflowPath": "workflows/generated/release-health.ts",
  "runId": "run_123",
  "status": "running",
  "cloudUrl": "<cloud-run-url>",
  "warnings": [],
  "nextActions": ["ricky status --run run_123"]
}
```

## Status Surface

`ricky status` should be beautiful but dense:

```text
Ricky status

Local
  Repo:        AgentWorkforce/ricky
  agent-relay: ready
  Codex:       ready
  Claude:      missing

Cloud
  Account:     logged in
  Workspace:   agentworkforce
  Claude:      connected
  Codex:       connected
  OpenCode:    missing
  Gemini:      connected

Integrations
  Slack:       connected
  GitHub:      connected
  Notion:      skipped
  Linear:      skipped

Next
  ricky cloud --spec-file ./spec.md --name my-workflow --run
```

`ricky status --json` should expose the same information as structured data.

## Implementation Boundaries

Recommended modules:

- `src/surfaces/cli/prompts/` for `@inquirer/prompts` wrappers.
- `src/surfaces/cli/flows/local-workflow-flow.ts` for local guided flow orchestration.
- `src/surfaces/cli/flows/cloud-workflow-flow.ts` for Cloud guided flow orchestration.
- `src/surfaces/cli/flows/spec-intake-flow.ts` for shared spec capture.
- `src/surfaces/cli/flows/workflow-summary.ts` for summary rendering.
- `src/product/generation/workforce-persona-writer.ts` for selecting a Workforce persona and running the non-interactive workflow-writing harness call.
- `src/surfaces/cli/flows/power-user-parser.ts` or an extension of the existing parser for non-interactive flags.
- `src/cloud/auth/` for Cloud account and credential checks.
- `src/cloud/provider-connect.ts` or equivalent for Cloud agent and integration checks.

Implementation rules:

- Prompt wrappers should be dependency-injectable for tests.
- Flow orchestration should return typed state objects rather than writing directly to stdout everywhere.
- Rendering should be separated from state transitions.
- Cloud readiness checks should be abstractions over real Cloud APIs or CLI commands.
- Existing generation, local runner, auto-fix loop, and evidence capture should be reused.
- Workflow writing should call into `../workforce` / Workforce packages programmatically; Ricky should own orchestration, validation, summary, and persistence, not persona runtime construction.
- Do not fork a second workflow generation path for interactive mode.

## Acceptance Criteria

- `ricky` opens a compact interactive menu using `@inquirer/prompts`.
- Local mode asks for a spec, workflow name, or existing workflow artifact.
- Given a spec, Ricky writes a workflow and displays a summary with agents and desired outcome.
- Workflow writing uses the appropriate Workforce persona through a non-interactive harness invocation, such as Claude print mode, and records persona metadata.
- Ricky offers to run the workflow in background, foreground, or not now.
- Background local runs monitor, diagnose, apply bounded safe fixes, and finish with evidence or a user decision.
- Cloud mode checks account, credentials, Cloud agents, and optional integrations before spec intake.
- Missing Cloud login prompts the user to log in and re-checks afterward.
- Missing Cloud agents prompt connection and re-check afterward.
- Slack, GitHub, Notion, and Linear are offered as optional enhancements.
- Power-user commands expose local and Cloud spec, workflow, run, background, auto-fix, status, connect, JSON, quiet, and verbose paths.
- Non-interactive commands fail with actionable recovery text, not raw stack traces.
- Tests cover prompt cancellation, missing spec, spec file flow, goal-to-spec flow, local run confirmation, Cloud login missing, Cloud agents missing, optional integration skip, `--json`, and `--yes` safety limits.

## Open Questions

- What is the canonical Cloud login command or API method Ricky should call?
- What is the canonical Cloud provider model for Claude, Codex, OpenCode, and Gemini connections?
- Should Cloud require all four agents before execution, or only the agents selected by the generated workflow?
- Should background local execution be implemented by the existing in-process runner, a detached child process, or an Agent Relay daemon?
- Should `ricky connect integrations` open the Cloud dashboard, run provider-specific CLI flows, or support both?
