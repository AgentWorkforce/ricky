# Ricky CLI Onboarding UX Spec

## Purpose

This document defines the dedicated Ricky CLI onboarding experience: banner, welcome copy, first-run setup, returning-user behavior, local/BYOH versus Cloud selection, spec handoff, recovery paths, and implementation boundaries.

It is intentionally narrower than the full Ricky product spec. It should give a future implementation workflow enough detail to build and test the CLI onboarding surface without inventing copy, commands, provider flows, or module boundaries.

## UX Principles

- Be warm and direct: help the user start without sounding like a launch page.
- Treat local/BYOH and Cloud as co-equal modes.
- End every onboarding branch with a concrete next step.
- Use only real provider guidance. Do not invent integration URLs or Ricky-specific OAuth flows.
- Keep onboarding separate from workflow generation, execution, and Cloud API logic.
- Hide stack traces from normal interactive users; show specific recovery guidance instead.

## Entry Points

The onboarding UX applies to these CLI entry points:

```text
npx ricky
npx ricky setup
npx ricky welcome
npx ricky --mode local
npx ricky --mode cloud
npx ricky --mode both
npx ricky generate --spec "..."
npx ricky generate --spec-file spec.md
cat spec.md | npx ricky generate --spec-stdin
```

Current private-package development commands may use `npm start -- ...`, but user-facing copy should prefer `npx ricky` unless the implementation is explicitly rendering current-development help.

## Banner

### Banner Treatment

First-run onboarding should open with a compact ASCII treatment based on the Ricky runner mark. It must include:

- a bird/runner silhouette
- the word `RICKY`
- a short tagline
- no more than 72 columns
- no more than 10 lines
- no trailing whitespace

Canonical ASCII example:

```text
        __             RRRR
   ____/  \__        RICKY
  <__  _    _>
     \_\>--'
      /  \__
     / /\__/
    /_/  \_\
workflow reliability for AgentWorkforce
```

Compact fallback:

```text
ricky - workflow reliability for AgentWorkforce
```

### Banner Display Rules

| Condition | Behavior |
|---|---|
| First run, interactive TTY | Show full banner and tagline |
| `npx ricky setup` | Show full banner unless suppressed |
| `npx ricky welcome` | Show full banner unless suppressed |
| Returning user with no command | Show compact one-line header |
| Returning user with command and payload | Skip full banner; show compact confirmation only when useful |
| `--quiet` or `-q` | Suppress banner and non-essential output |
| `--no-banner` | Suppress banner only |
| Non-TTY or piped output | Suppress banner |
| `RICKY_BANNER=0` | Suppress banner |
| `NO_COLOR` set | Render plain ASCII without ANSI color |
| Terminal width below 60 columns | Use compact fallback |

ANSI color is optional. If enabled, color must be disabled automatically for non-TTY output and when `NO_COLOR` is set.

## First-Run Flow

First run means Ricky cannot find a completed project or global config. Project config takes precedence over global config.

Flow order:

1. Render the banner.
2. Render a short welcome.
3. Explain local/BYOH and Cloud in one screen.
4. Ask for mode.
5. Persist the selected mode only when the user makes an interactive mode choice.
6. Render next steps for the selected mode.
7. Render spec handoff examples.
8. Render recovery guidance only if setup detects a blocker.

### First-Run Example

```text
$ npx ricky

        __             RRRR
   ____/  \__        RICKY
  <__  _    _>
     \_\>--'
      /  \__
     / /\__/
    /_/  \_\
workflow reliability for AgentWorkforce

Welcome to Ricky. Let's get you started.

Ricky helps you turn workflow intent into runnable workflows, then debug and recover them when something blocks.
You can start locally with your own tools, use AgentWorkforce Cloud, or keep both paths available.

How would you like to use Ricky?

> [1] Local / BYOH  - run workflows against this repo and your local tools
  [2] Cloud         - run workflows on AgentWorkforce Cloud
  [3] Both          - start locally and connect Cloud when needed
  [4] Just explore  - skip setup and show examples

Choice [1]:
```

### Mode Persistence

Persisted config shape:

```json
{
  "mode": "local",
  "firstRunComplete": true,
  "providers": {
    "google": { "connected": false },
    "github": { "connected": false }
  }
}
```

Precedence:

1. `--mode`
2. `RICKY_MODE`
3. project config at `.ricky/config.json`
4. global config at `~/.config/ricky/config.json`
5. first-run prompt default, `local`

Persistence rules:

- Interactive choices `local`, `cloud`, and `both` are persisted.
- `explore` is not persisted.
- `--mode` is not persisted.
- `RICKY_MODE` is not persisted.
- Provider status is updated only by explicit provider checks or Cloud status results, not by showing guidance text.

## Returning-User Flow

Returning users have completed setup before. They should not see the full welcome every time.

Returning behavior:

1. Load config using the precedence above.
2. If a command includes a spec, file, stdin payload, MCP handoff, or workflow artifact, skip onboarding narrative.
3. Show a compact header when interactive output would help orientation.
4. Route to the requested command or mode.
5. Show warnings only when a blocker affects the requested action.

Compact header examples:

```text
ricky - local mode - ready
ricky - cloud mode - google connected
ricky - cloud mode - google not connected
ricky - local + cloud mode - local ready - cloud not connected
```

Returning-user examples:

```text
$ npx ricky
ricky - local mode - ready

Hand Ricky a spec when you are ready:
  npx ricky generate --spec-file spec.md
```

```text
$ npx ricky generate --spec-file spec.md
ricky - local mode - receiving spec.md
```

The second example must proceed into spec intake rather than replaying the full first-run choices.

## Mode Selection Copy

### Local / BYOH

Use this copy after the user selects Local / BYOH:

```text
Local / BYOH mode selected.

In this mode, Ricky will:
- generate workflows into your local repo
- validate workflows using local tools such as TypeScript, tests, and agent-relay
- run workflows through your local agent-relay setup when available
- return artifacts and logs locally

No Cloud credentials are required.

Next steps:
- Generate from inline spec:  npx ricky generate --spec "describe the workflow"
- Generate from file:        npx ricky generate --spec-file spec.md
- Use a Claude handoff:      npx ricky generate --spec-file /tmp/ricky-spec.md
- Check help:                npx ricky help
```

If local preflight detects a blocker, keep Local / BYOH selected but append recovery guidance rather than silently switching modes.

### Cloud

Use this copy after the user selects Cloud:

```text
Cloud mode selected.

In this mode, Ricky will:
- generate and run workflows on AgentWorkforce Cloud
- use Cloud-connected providers for account and repo access
- return workflow artifacts, logs, and follow-up actions

Step 1: Connect Google
  npx agent-relay cloud connect google

Step 2: Connect GitHub when repo-connected workflows need it
  Open the AgentWorkforce Cloud dashboard.
  Go to Settings -> Integrations -> GitHub.
  Follow the Nango-backed connection flow there.

Next steps:
- Verify setup:              npx ricky status
- Generate in Cloud mode:    npx ricky generate --mode cloud --spec-file spec.md
- Continue locally instead:  npx ricky --mode local
```

Rules:

- The Google command must be shown exactly as `npx agent-relay cloud connect google`.
- GitHub setup must reference the Cloud dashboard and Nango-backed integration flow.
- Do not invent a dashboard URL.
- Do not invent `npx ricky connect github`.
- Do not build a Ricky-specific GitHub OAuth flow.

### Both

Use this copy after the user selects Both:

```text
Local + Cloud mode selected.

Ricky will start with your local repo and tools. Cloud stays available for hosted generation, provider-backed workflows, and team execution once connected.

Cloud setup:
- Google:  npx agent-relay cloud connect google
- GitHub:  AgentWorkforce Cloud dashboard -> Settings -> Integrations -> GitHub

Next steps:
- Generate locally now:      npx ricky generate --spec-file spec.md
- Check provider status:     npx ricky status
- Force Cloud for one run:   npx ricky generate --mode cloud --spec-file spec.md
```

### Just Explore

Use this copy when the user wants to defer setup:

```text
Explore mode. No setup was saved.

Useful examples:
- Generate from text:        npx ricky generate --spec "describe the workflow"
- Generate from a file:      npx ricky generate --spec-file spec.md
- Connect Google for Cloud:  npx agent-relay cloud connect google
- Re-run setup:              npx ricky setup
```

Explore mode must not mark `firstRunComplete`.

## Spec Handoff

Ricky must support the idea that a user may write a workflow spec in another assistant and hand it to Ricky without rewriting it.

### CLI Handoff Examples

Inline:

```text
npx ricky generate --spec "Create a workflow that runs lint, tests, and typecheck across three packages."
```

File:

```text
npx ricky generate --spec-file ./workflow-spec.md
```

Stdin:

```text
cat workflow-spec.md | npx ricky generate --spec-stdin
```

Claude-to-CLI:

```text
# In Claude or another assistant:
# "Write the workflow spec to /tmp/ricky-spec.md."

npx ricky generate --spec-file /tmp/ricky-spec.md --mode local
```

### MCP Handoff Example

MCP tool name:

```text
ricky.generate
```

MCP request:

```json
{
  "spec": "Create a workflow that validates every package, fixes failures, and summarizes evidence.",
  "mode": "local",
  "source": "mcp",
  "metadata": {
    "handoffFrom": "claude",
    "conversationId": "optional-conversation-id"
  }
}
```

Expected normalized behavior:

- CLI and MCP handoffs normalize into the same request model before execution.
- MCP is a transport, not a separate product path.
- If mode is missing, Ricky uses normal mode precedence and may ask interactively only when the transport supports it.
- If the MCP call is non-interactive and Ricky is unconfigured, return a structured setup-required error with next actions.

## Recovery Paths

Recovery messages must include what failed and the nearest useful fix. They should be short enough to read in a terminal.

### Missing Toolchain: agent-relay

Detection:

- Local / BYOH selected.
- Command requires local execution.
- `agent-relay` binary or package cannot be resolved.

Message:

```text
agent-relay was not found.

Ricky needs agent-relay for local workflow execution.
Install or expose it, then retry:
  npm install -g @agent-relay/cli

You can also continue with Cloud:
  npx ricky --mode cloud
```

Behavior:

- Do not mark the workflow run as failed due to generated workflow logic.
- Classify as a local environment blocker.
- Keep the user's selected mode unchanged.

### Missing Cloud Auth

Detection:

- Cloud mode selected, or a Cloud command is requested.
- Google provider status is missing, expired, or rejected by Cloud.

Message:

```text
Cloud is not connected yet.

Connect Google, then retry:
  npx agent-relay cloud connect google

For GitHub repo access, use the AgentWorkforce Cloud dashboard:
  Settings -> Integrations -> GitHub

To keep working locally:
  npx ricky generate --mode local --spec-file spec.md
```

Behavior:

- Do not attempt GitHub OAuth locally.
- Do not guess a Cloud dashboard URL.
- Return a user-facing auth blocker with these next actions.

### Local Environment Blocker

Detection examples:

- Current directory is not writable.
- `.ricky/config.json` cannot be written.
- TypeScript is required for validation but cannot be resolved.
- Stale local runtime state is detected and would make local proof unreliable.

Message:

```text
Local setup is blocked.

Ricky could not write to this project directory:
  /path/to/project

Fix the permission issue or run Ricky from a writable checkout.
Cloud remains available after provider setup:
  npx agent-relay cloud connect google
```

Behavior:

- Keep the error scoped to the environment.
- Do not dump a stack trace unless `--verbose` is set.
- If an automated cleanup is safe, present it as an explicit action before running it.

### Non-Interactive First Run

Detection:

- stdin or stdout is not a TTY.
- No config exists.
- No `--mode` or `RICKY_MODE` was provided.

Message:

```text
Ricky has not been configured yet.

Run setup interactively:
  npx ricky setup

Or choose a mode for this command:
  RICKY_MODE=local npx ricky generate --spec-stdin
```

Behavior:

- Exit with a user-facing setup-required error.
- Do not persist `RICKY_MODE`.
- Do not render the banner.

## Implementation Boundaries

The future implementation workflow should build within these boundaries.

### CLI Package Modules

| Module | Responsibility |
|---|---|
| `packages/cli/src/cli/ascii-art.ts` | Banner constants, color handling, compact/full rendering, display predicates |
| `packages/cli/src/cli/welcome.ts` | First-run and returning-user welcome copy |
| `packages/cli/src/cli/mode-selector.ts` | Mode options, aliases, prompt rendering, selected-mode result copy |
| `packages/cli/src/cli/onboarding.ts` | First-run orchestration, config read/write, provider guidance, recovery guidance |
| `packages/cli/src/commands/cli-main.ts` | CLI argument parsing and command dispatch |
| `packages/cli/src/entrypoint/interactive-cli.ts` | Composition of onboarding, normalized handoff, local executor, Cloud executor, and diagnostics |

### Non-CLI Boundaries

| Module area | Boundary |
|---|---|
| `packages/local/src/request-normalizer.ts` | Normalizes CLI, MCP, Claude, and artifact handoffs into local request contracts |
| `packages/local/src/entrypoint.ts` | Executes local/BYOH requests; does not own onboarding copy |
| `packages/cloud/src/auth/*` | Owns provider auth status and workspace scoping; does not own terminal UX |
| `packages/cloud/src/api/*` | Owns Cloud generate request/response handling; does not render onboarding |
| `packages/runtime/src/diagnostics/*` | Classifies blockers and returns structured unblocker guidance |

Implementation must not:

- put provider OAuth logic in CLI onboarding
- put terminal copy in Cloud API handlers
- bypass request normalization for MCP handoffs
- route local/BYOH requests directly from argument parsing
- add prompt or color dependencies unless a specific follow-up approves them

### Tests To Build

| Test file | Required coverage |
|---|---|
| `packages/cli/src/cli/onboarding.test.ts` | First-run banner, welcome, mode copy, recovery copy, non-TTY behavior |
| `packages/cli/src/cli/mode-selector.test.ts` | Mode aliases, default local choice, explore non-persistence, copy snapshots |
| `packages/cli/src/commands/cli-main.test.ts` | `--mode`, `--quiet`, `--no-banner`, setup/welcome/generate dispatch |
| `packages/cli/src/entrypoint/interactive-cli.test.ts` | Returning-user routing, handoff skips full onboarding, local/cloud/both composition |
| `packages/local/src/request-normalizer.test.ts` | CLI and MCP handoffs normalize to the same domain shape |
| `packages/runtime/src/diagnostics/*.test.ts` | Missing toolchain, missing auth, and local environment blocker classification |

Tests must use injected input, output, config stores, provider status, and executors. They must not depend on the developer machine's actual Cloud auth, global config, or terminal width.

## Acceptance Criteria

The implementation is complete when:

- First-run onboarding renders the full Ricky banner and welcome in an interactive TTY.
- Banner suppression works for `--quiet`, `--no-banner`, non-TTY output, `RICKY_BANNER=0`, and narrow terminals.
- Returning users see a compact header instead of the full banner.
- Local/BYOH, Cloud, Both, and Just Explore are available from the first-run prompt.
- Local/BYOH copy says no Cloud credentials are required and gives CLI next steps.
- Cloud copy shows `npx agent-relay cloud connect google` exactly.
- GitHub setup references the AgentWorkforce Cloud dashboard and Nango-backed integration guidance without invented URLs.
- CLI handoff examples cover inline spec, spec file, stdin, and Claude-to-CLI handoff.
- MCP handoff uses `ricky.generate` and normalizes through the same request path as CLI.
- At least one recovery path exists for missing toolchain, missing Cloud auth, and local environment blockers.
- Non-interactive first run returns setup guidance without rendering the banner.
- Interactive mode choices persist config; overrides and explore do not.
- User-facing errors include a specific action and avoid raw stack traces unless verbose output is requested.
- Implementation stays inside the module boundaries above and does not add provider auth flows to CLI onboarding.
