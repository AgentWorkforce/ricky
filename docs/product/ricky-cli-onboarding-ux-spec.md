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

## Current vs Target CLI Surface

The Ricky package is private and has no published `bin` entry. The current runnable CLI surface and the target surface this spec requires are different. Implementations must not present target commands as already available.

### Current CLI surface (as of this writing)

The current CLI is invoked via `npm start` (which runs `tsx src/commands/cli-main.ts`). The parser in `packages/cli/src/commands/cli-main.ts` supports:

| Command / Flag | Behavior |
|---|---|
| `npm start` | Start interactive session (dispatches to `run`) |
| `npm start -- --mode <mode>` | Start with mode preset: `local`, `cloud`, `both` |
| `npm start -- help` or `--help` / `-h` | Show help text |
| `npm start -- version` or `--version` / `-v` | Show version |

No other commands or flags are parsed. The `ParsedArgs` type exposes `command: 'run' | 'help' | 'version'` and an optional `mode`.

### Target CLI surface (required by this spec)

This spec requires the following additions to `packages/cli/src/commands/cli-main.ts` before the onboarding UX is complete. Each entry includes the expected parser contract.

| Command / Flag | Parser contract | Dispatch target | Expected output |
|---|---|---|---|
| `ricky setup` | `{ command: 'setup' }` | `onboarding.runFirstRunSetup()` | Full banner, welcome, mode prompt, persist config |
| `ricky welcome` | `{ command: 'welcome' }` | `onboarding.renderWelcome()` | Full banner and welcome copy only (no mode prompt) |
| `ricky generate --spec "..."` | `{ command: 'generate', specSource: 'inline', spec: string }` | Build `CliHandoff`, pass to `normalizeRequest`, then execute | Spec intake confirmation, then workflow generation |
| `ricky generate --spec-file <path>` | `{ command: 'generate', specSource: 'file', specFile: string }` | Build `CliHandoff` with `specFile`, pass to `normalizeRequest`, then execute | Spec intake confirmation, then workflow generation |
| `ricky generate --spec-stdin` | `{ command: 'generate', specSource: 'stdin' }` | Read stdin, build `CliHandoff`, pass to `normalizeRequest`, then execute | Spec intake confirmation, then workflow generation |
| `ricky status` | `{ command: 'status' }` | Read config and provider state, render summary | Mode, provider connection status, config path |
| `--quiet` / `-q` | Sets `parsed.quiet = true` on any command | Suppress banner and non-essential output | Reduced output |
| `--no-banner` | Sets `parsed.noBanner = true` on any command | Suppress banner only | Output without banner |

The `generate` command must build a `CliHandoff` (as defined in `packages/local/src/request-normalizer.ts`) and pass it through `normalizeRequest()` before execution. The `--mode` flag applies to `generate` as well.

Until these are implemented, development-mode invocations use `npm start -- ...` with the current parser. User-facing copy in this spec uses `npx ricky` to represent the target surface. When the package gains a `bin` entry or is published, the `npx ricky` invocations become live.

### Parser Delta Punch List

`packages/cli/src/commands/cli-main.ts` must extend `ParsedArgs` from the current `run | help | version` shape to a discriminated union that can represent onboarding, status, and all three spec input modes:

```ts
type ParsedArgs =
  | BaseParsedArgs & { command: 'run' }
  | BaseParsedArgs & { command: 'help' }
  | BaseParsedArgs & { command: 'version' }
  | BaseParsedArgs & { command: 'setup' }
  | BaseParsedArgs & { command: 'welcome' }
  | BaseParsedArgs & { command: 'status' }
  | BaseParsedArgs & {
      command: 'generate';
      specSource: 'inline';
      spec: string;
    }
  | BaseParsedArgs & {
      command: 'generate';
      specSource: 'file';
      specFile: string;
    }
  | BaseParsedArgs & {
      command: 'generate';
      specSource: 'stdin';
    };

type BaseParsedArgs = {
  mode?: 'local' | 'cloud' | 'both';
  quiet?: boolean;
  noBanner?: boolean;
  verbose?: boolean;
};
```

Parser requirements:

- `setup`, `welcome`, and `status` are standalone commands.
- `generate` accepts exactly one of `--spec`, `--spec-file`, or `--spec-stdin`.
- `--mode`, `--quiet`, `--no-banner`, and `--verbose` may appear before or after the command.
- Missing or multiple spec sources return a user-facing usage error, not an uncaught exception.
- Unknown commands should continue to fall back to help-oriented guidance.

## Entry Points

The onboarding UX applies to these **target** CLI entry points (see "Current vs Target CLI Surface" above for implementation status):

```text
npx ricky                                          # target — currently: npm start
npx ricky setup                                    # target — not yet implemented
npx ricky welcome                                  # target — not yet implemented
npx ricky --mode local                             # target — currently: npm start -- --mode local
npx ricky --mode cloud                             # target — currently: npm start -- --mode cloud
npx ricky --mode both                              # target — currently: npm start -- --mode both
npx ricky generate --spec "..."                    # target — not yet implemented
npx ricky generate --spec-file spec.md             # target — not yet implemented
cat spec.md | npx ricky generate --spec-stdin      # target — not yet implemented
```

Examples throughout this spec use the target `npx ricky` form. During development, substitute `npm start -- ...` for the equivalent current command where one exists.

## Banner

### Banner Treatment

First-run onboarding should open with a compact ASCII treatment based on the Ricky runner mark. It must include:

- a bird/runner silhouette
- the word `RICKY`
- a short tagline
- no more than 72 columns
- no more than 10 lines
- no trailing whitespace

Placeholder ASCII example (subject to revision before release; treat dimensions and display rules as canonical, artwork as draft):

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
  "schemaVersion": 1,
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

### Config Schema Versioning

The persisted config must include a `schemaVersion` field:

```json
{
  "schemaVersion": 1,
  "mode": "local",
  "firstRunComplete": true,
  "providers": {
    "google": { "connected": false },
    "github": { "connected": false }
  }
}
```

Migration rules:

- When reading config, check `schemaVersion`. If missing, treat the file as version 0 (pre-versioning) and migrate in place.
- Each schema version bump must have a deterministic, forward-only migration function registered in the config module.
- If `schemaVersion` is higher than the running code understands, warn the user and refuse to overwrite (the config may have been written by a newer Ricky version).
- Migrations must not discard user choices. If a field is removed, its value must be mapped to the replacement field.

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

## Web and Slack Relationship

Ricky has three adjacent entry points: CLI, web, and Slack. They are adjacent because a user may begin in any of them and later move to another, but each surface owns its own onboarding UX.

The CLI owns CLI onboarding. Web and Slack must not become the source of truth, prerequisite, or hidden owner for the CLI first-run experience. The CLI can reference web and Slack as helpful places to continue, but `npx ricky` must be able to welcome a user, choose local/BYOH or Cloud, explain next steps, accept a CLI or MCP handoff, and recover from common setup blockers without requiring either surface.

### Surface roles

| Surface | Onboarding role | Owns |
|---|---|---|
| CLI | Local-first setup, mode selection, spec handoff, provider guidance | First-run prompt, mode persistence, local/BYOH execution |
| Web | Browser-based account creation, visual integration setup, spec submission | OAuth redirect flows, GitHub app install via Cloud dashboard/Nango, workspace management UI |
| Slack | Interactive assistant surface for workflow requests, debugging, notifications | Bot DM onboarding, workspace join, threaded workflow interaction |

### Hierarchy rules

- CLI does not depend on web or Slack to complete first-run setup. A user can go from `npx ricky` to a working local/BYOH setup without opening a browser or joining a Slack workspace.
- Web does not depend on CLI. A user can create an account, connect providers, and submit specs entirely through the browser.
- Slack does not depend on CLI or web for its own onboarding. The Slack bot has its own DM-based welcome and workspace join flow.
- No surface gates another surface's first-run completion.
- Web and Slack are adjacent entry points for onboarding continuity, not owners of CLI onboarding copy, state transitions, or terminal recovery behavior.

### Shared state

All surfaces share the same underlying config and provider model:

- `RickyConfig` (mode, firstRunComplete, providers) is the shared truth.
- A mode set via CLI is respected by web and Slack.
- A provider connected via web (e.g., Google OAuth, GitHub app install) is visible to CLI via `npx ricky status` or provider status checks.
- A provider connected via `npx agent-relay cloud connect google` from CLI is visible to web and Slack.

### Cross-surface guidance in CLI copy

CLI may mention web and Slack as available surfaces. It must not require them.

Acceptable:

```text
You can also interact with Ricky in Slack or through the web dashboard.
```

Not acceptable:

```text
Set up Slack to continue.
Complete web onboarding before using the CLI.
```

When CLI needs to reference a web-only flow (like the GitHub app install through the Cloud dashboard / Nango), it should give a clear pointer:

```text
Connect GitHub for repo-connected workflows:
  Open your AgentWorkforce Cloud dashboard.
  Go to Settings -> Integrations -> GitHub.
  Follow the Nango-backed connection flow there.
```

This is a reference, not a dependency. The user can skip GitHub setup and continue locally.

### What CLI does not own

- Slack bot onboarding (DM welcome, workspace join, thread UX)
- Web account creation and visual OAuth flows
- Slack or web notification preferences
- Slack-specific workflow interaction patterns

These belong to their respective surface specs.

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

CLI-based spec handoff from an implementation workflow:

```text
npx ricky generate \
  --mode local \
  --spec "Build a workflow that validates package layout, runs tests, fixes failures, and reports evidence."
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

MCP-based spec handoff from an assistant or workflow engine:

```json
{
  "tool": "ricky.generate",
  "arguments": {
    "mode": "both",
    "source": "mcp",
    "spec": {
      "goal": "Create a workflow that validates Ricky CLI onboarding behavior.",
      "requirements": [
        "prove first-run banner behavior",
        "prove returning-user compact header behavior",
        "prove missing-auth recovery copy"
      ]
    },
    "metadata": {
      "handoffFrom": "implementation-workflow",
      "stepOwner": "write-cli-ux-spec"
    }
  }
}
```

Expected normalized behavior:

- CLI and MCP handoffs normalize into the same request model before execution.
- MCP is a transport, not a separate product path.
- If mode is missing, Ricky uses normal mode precedence and may ask interactively only when the transport supports it.
- If the MCP call is non-interactive and Ricky is unconfigured, return a structured setup-required error with next actions.

## Interactive CLI Composition Contract

`packages/cli/src/entrypoint/interactive-cli.ts` is the composition boundary between terminal UX and execution. It wires onboarding to the normalized request path but does not own banner artwork, copy strings, provider OAuth, or workflow generation internals.

Required flow:

1. Parse `ParsedArgs` in `packages/cli/src/commands/cli-main.ts`.
2. Load config and provider status through injected dependencies.
3. Resolve mode using `--mode`, `RICKY_MODE`, project config, global config, then interactive prompt.
4. Render first-run onboarding only when there is no completed config and the current command is interactive.
5. For `setup`, run first-run onboarding and persist the interactive mode choice.
6. For `welcome`, render the banner and welcome copy without persisting config.
7. For `status`, render mode, config path, and provider status.
8. For `generate`, build a `CliHandoff`, pass it through `normalizeRequest()`, then route to local, Cloud, or both based on resolved mode.
9. On execution failure, call diagnostics/recovery helpers and render the matching user-facing recovery path.
10. Return an `InteractiveCliResult` with success/failure, selected mode, config effects, and any recovery classification.

`InteractiveCliResult` shape:

```ts
type InteractiveCliResult = {
  success: boolean;
  mode: 'local' | 'cloud' | 'both' | 'explore' | undefined;
  configEffects: {
    persisted: boolean;       // true if config was written during this run
    schemaVersion: number;    // version of config after this run
  };
  recovery?: {
    classification: 'env-blocker' | 'auth-blocker' | 'config-blocker' | 'generation-failure' | 'setup-required';
    message: string;          // user-facing recovery text rendered to terminal
  };
};
```

Composition rules:

- Onboarding copy must live in CLI onboarding/welcome modules, not in `interactive-cli.ts`.
- `interactive-cli.ts` may decide which recovery renderer to call, but recovery copy should remain testable without invoking real local or Cloud execution.
- Non-interactive commands must return structured setup or usage errors instead of prompting.
- Local and MCP/CLI handoffs must share the same normalization path before execution.

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

### Provider Connect Failure

Detection:

- User ran or was directed to `npx agent-relay cloud connect google`.
- The connect command failed, timed out, or returned an incomplete provider status.
- Cloud mode or Both mode remains selected.

Message:

```text
Google did not finish connecting.

Retry the Cloud connection:
  npx agent-relay cloud connect google

If GitHub is the provider you need, use the AgentWorkforce Cloud dashboard:
  Settings -> Integrations -> GitHub

You can keep working locally while Cloud setup is pending:
  npx ricky generate --mode local --spec-file spec.md
```

Behavior:

- Keep the selected mode unchanged.
- Mark Google as not connected unless provider status proves otherwise.
- Do not invent a browser URL or attempt GitHub OAuth in the CLI.
- If `--verbose` is set, include the provider command exit code or provider status reason.

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

### Corrupted or Unparseable Config

Detection:

- Config file exists but `JSON.parse()` throws.
- Config file parses but `schemaVersion` is unrecognized or required fields are missing/wrong type.

Message:

```text
Ricky config is corrupted or unreadable.

  Path: .ricky/config.json

Delete the file and re-run setup:
  rm .ricky/config.json && npx ricky setup

Or set a mode for this command:
  npx ricky --mode local
```

Behavior:

- Do not silently overwrite the corrupted file.
- Classify as a config blocker, not a workflow failure.
- If `--verbose` is set, include the parse error message.

### Workflow Generation Failure

Detection:

- A `generate` command reached local or Cloud execution.
- Request normalization succeeded.
- The generator or executor returned a recoverable failure, validation failure, or provider/runtime error.

Message:

```text
Workflow generation did not complete.

Ricky accepted the spec, but generation stopped during execution.
Review the reported issue, then retry:
  npx ricky generate --spec-file spec.md

To check setup before retrying:
  npx ricky status
```

Behavior:

- Do not replay first-run onboarding.
- Preserve the normalized handoff metadata in logs or artifacts when available.
- Classify the failure as generation/execution, not onboarding.
- If diagnostics identify a more specific blocker, render that specific recovery path instead.

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

| Test file | Required coverage | Depends on new parser work? |
|---|---|---|
| `packages/cli/src/cli/onboarding.test.ts` | First-run banner, welcome, mode copy, recovery copy, non-TTY behavior, corrupted config recovery | No — tests onboarding module directly |
| `packages/cli/src/cli/ascii-art.test.ts` | Full banner, compact banner, terminal width fallback, color suppression, environment suppression | No — tests banner module directly |
| `packages/cli/src/cli/mode-selector.test.ts` | Mode aliases, default local choice, explore non-persistence, copy snapshots | No — tests mode-selector module directly |
| `packages/cli/src/commands/cli-main.test.ts` | Existing: `--mode`, `help`, `version`. **New (requires parser additions per "Target CLI surface" above):** `--quiet`, `--no-banner`, `setup`, `welcome`, `generate`, `status` dispatch | **Yes** — new commands require extending `ParsedArgs` and `parseArgs()` |
| `packages/cli/src/entrypoint/interactive-cli.test.ts` | Returning-user routing, handoff skips full onboarding, local/cloud/both composition | Partially — handoff routing depends on `generate` dispatch existing |
| `packages/local/src/request-normalizer.test.ts` | CLI and MCP handoffs normalize to the same domain shape | No — normalizer already supports `CliHandoff` and `McpHandoff` |
| `packages/runtime/src/diagnostics/*.test.ts` | Missing toolchain, missing auth, local environment blocker, and corrupted config classification | No — tests diagnostic classifiers directly |

Tests must use injected input, output, config stores, provider status, and executors. They must not depend on the developer machine's actual Cloud auth, global config, or terminal width.

The table describes the preferred test organization, but the implementation may consolidate files if the same behavioral coverage remains explicit and easy to locate. A consolidated test file is acceptable only when test names preserve the module or flow being covered.

## Acceptance Criteria

The implementation is complete when:

- The CLI parser in `cli-main.ts` supports all commands listed in the "Target CLI surface" table: `setup`, `welcome`, `generate` (with `--spec`, `--spec-file`, `--spec-stdin`), `status`, `--quiet`, and `--no-banner`.
- First-run onboarding renders the full Ricky banner and welcome in an interactive TTY.
- Banner suppression works for `--quiet`, `--no-banner`, non-TTY output, `RICKY_BANNER=0`, and narrow terminals.
- Returning users see a compact header instead of the full banner.
- Local/BYOH, Cloud, Both, and Just Explore are available from the first-run prompt.
- Local/BYOH copy says no Cloud credentials are required and gives CLI next steps.
- Cloud copy shows `npx agent-relay cloud connect google` exactly.
- GitHub setup references the AgentWorkforce Cloud dashboard and Nango-backed integration guidance without invented URLs.
- CLI handoff examples cover inline spec, spec file, stdin, and Claude-to-CLI handoff.
- The `generate` command builds a `CliHandoff` and passes it through `normalizeRequest()` from `packages/local/src/request-normalizer.ts`.
- MCP handoff uses `ricky.generate` and normalizes through the same request path as CLI.
- At least one recovery path exists for missing toolchain, missing Cloud auth, local environment blockers, and corrupted config.
- Non-interactive first run returns setup guidance without rendering the banner.
- Interactive mode choices persist config; overrides and explore do not.
- Config includes `schemaVersion` and the config reader handles missing, outdated, and future schema versions.
- User-facing errors include a specific action and avoid raw stack traces unless verbose output is requested.
- The spec includes an explicit section on web and Slack onboarding relationship.
- CLI onboarding is not subordinate to or dependent on web or Slack for first-run completion.
- Shared config and provider state is documented as the cross-surface contract.
- Implementation stays inside the module boundaries above and does not add provider auth flows to CLI onboarding.
