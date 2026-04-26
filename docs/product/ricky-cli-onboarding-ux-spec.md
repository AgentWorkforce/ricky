# Ricky CLI Onboarding UX Spec

## 1. Purpose

Define the first-run and early-returning-user CLI experience for Ricky so onboarding feels welcoming, truthful, and implementation-ready.

This spec turns the current banner and ASCII-art requirement into a concrete product contract. A follow-on implementation workflow should be able to build the CLI onboarding modules from this spec without guessing behavior.

## 2. Product truth

Ricky is a workflow reliability, coordination, authoring, recovery, and analytics product.

The CLI is not a thin wrapper around Slack or Cloud. It is a first-class Ricky surface alongside:
- local and BYOH execution
- Cloud-backed execution and integrations
- interactive surfaces such as Slack and web
- spec handoff paths from Claude, CLI, and MCP

## 3. Target users

| User type | What they need from CLI onboarding |
|---|---|
| **Workflow author** | Quick local setup, spec submission, immediate generation |
| **Operator / team lead** | Cloud connect for hosted execution, provider auth guidance |
| **Claude / LLM user** | Handoff from a Claude session into Ricky via CLI or MCP |
| **First-time explorer** | Understand what Ricky does and reach a useful action fast |

## 4. UX goals

1. **Recognize** — the user immediately knows they are in Ricky (ASCII banner + name) within 1 second
2. **Orient** — the user understands the two primary modes (local/BYOH and Cloud) within one screen
3. **Choose** — the user selects a mode or defers the choice
4. **Act** — the user reaches a concrete next action within 30 seconds
5. **Recover** — if anything fails, the user sees a specific remediation step, not a stack trace

## 5. Experience principles

1. Friendly first, but not fluffy.
2. Truth over magic.
3. Do not bury local/BYOH behind Cloud.
4. Do not imply Slack is Ricky's identity.
5. The CLI should help users start, recover, and hand off work, not just print commands.
6. Every onboarding branch should end in a concrete next step.

---

## 6. Banner and ASCII-art contract

### 6.1 Visual identity

The ASCII banner must be a simplified rendering of the Ricky roadrunner logo (`assets/ricky-logo.svg`). The logo is a stylized teal and navy roadrunner in front of a cloud outline.

The ASCII art must convey:
- a recognizable bird/roadrunner silhouette (the primary mark)
- the word "RICKY" adjacent to or below the silhouette
- a tagline: "workflow reliability for AgentWorkforce"

### 6.2 Reference ASCII art

Canonical implementation (as shipped in `ascii-art.ts`):

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

The left silhouette represents the roadrunner: tail, head/beak, wing, and running legs. `RRRR` appears on line 1 as a secondary Ricky mark. The exact rendering may be refined, but the contract is:
- the silhouette must be recognizable as a bird/roadrunner, not abstract ASCII decoration or a text-only wordmark
- "RICKY" must appear in the banner, not only below it
- the tagline must appear on the last line

### 6.3 Sizing rules

- Maximum width: 72 columns (safe for standard terminals)
- Maximum height: 10 lines (banner + tagline, excluding surrounding blank lines)
- No trailing whitespace on any line

### 6.4 Color rules

| Condition | Behavior |
|---|---|
| `stdout` is a TTY and `NO_COLOR` is not set | ANSI color output |
| `NO_COLOR=1` is set | Plain ASCII, no escape codes |
| Non-TTY (piped output) | Plain ASCII, no escape codes |

Color mapping when ANSI is enabled:
- Roadrunner silhouette: teal/cyan (ANSI 36 or 96, matching the logo gradient)
- "RICKY" text: bold
- Tagline: dim/muted (ANSI 2)

### 6.5 Display rules

| Condition | Banner behavior |
|---|---|
| First run (no prior config) | Full banner + tagline |
| Returning user, no command provided | Compact one-line header + suggested next action |
| Returning user, command provided | Compact one-line header only when useful; never block the command |
| `npx ricky welcome` or `npx ricky setup --show-banner` | Full banner + tagline |
| `--quiet` or `-q` flag | No banner, no non-essential output |
| `--no-banner` flag | No banner, rest of output unchanged |
| Non-TTY (piped output) | No banner |
| `NO_COLOR=1` | Banner without ANSI colors |
| `RICKY_BANNER=0` env var | No banner |

### 6.6 Compact header for returning users

After first-run setup, returning users see a compact header instead of the full banner unless they explicitly ask for the welcome/setup screen:

```text
ricky · local mode · ready
```

or:

```text
ricky · cloud mode · google connected
```

The compact header is one line, no ASCII art.

### 6.7 Export contract

`src/cli/ascii-art.ts` must export:
- `RICKY_BANNER: string` — the plain-text full banner (no ANSI codes)
- `RICKY_COMPACT_BANNER: string` — the one-line compact banner for narrow terminals
- `type BannerVariant = 'full' | 'compact'`
- `renderBanner(options?: RenderBannerOptions | BannerVariant): string` — returns the banner with or without ANSI color codes
- `shouldShowBanner(options: ShouldShowBannerOptions): boolean` — pure function encapsulating display logic; supports `quiet`, `noBanner`, `isTTY`, `isFirstRun`, `forceOnboarding`, `env.RICKY_BANNER`, and direct `rickyBanner` option
- `chooseBannerVariant(columns?: number): BannerVariant` — returns `'compact'` when columns < 60, `'full'` otherwise
- `shouldUseColor(options?: { color?: boolean; isTTY?: boolean; noColor?: boolean }): boolean` — respects explicit `color` flag, TTY detection, and `NO_COLOR` env var

---

## 7. First-run flow

### 7.1 First-run sequence

Order:
1. Render banner
2. Render one-paragraph product framing
3. Present mode choices
4. Present the next action for the chosen mode
5. Offer spec handoff examples
6. Surface blockers if setup is incomplete

### 7.2 Complete first-run terminal session

```text
$ npx ricky

        __
   ____/  \__        RICKY
  <__  _    _>
     \_\>--'
      /  \__
     / /\__/
    /_/  \_\
workflow reliability for AgentWorkforce

  Welcome to Ricky! Let's get you set up.

  Ricky helps you generate, debug, recover, and run workflows.
  You can start locally, bring your own harness, or connect Cloud providers.
  Tell Ricky what you want done. You should not need to hand-write workflows.

  How would you like to use Ricky?

  > [1] Local / BYOH  — run workflows against your local repo and tools
    [2] Cloud         — run workflows on AgentWorkforce Cloud
    [3] Both          — set up local now, connect Cloud later
    [4] Just explore  — skip setup, show me what Ricky can do

  Choice [1]:
```

### 7.3 Non-interactive behavior

When stdin is not a TTY (piped, CI, scripted) and no mode override is set:

```text
$ echo '{"spec": "..."}' | npx ricky generate

  Error: Ricky has not been configured yet.

  Run `npm start` interactively to complete first-run setup,
  or set RICKY_MODE=local to skip setup and use local mode.
```

In this case, `runOnboarding` returns `mode: 'explore'` as the default. The `explore` mode is a sentinel: it signals that no real mode was committed and the caller should surface the error rather than proceed with generation. Callers should treat `explore` as "setup not completed."

Environment variable `RICKY_MODE` can be set to `local` or `cloud` to bypass interactive setup in CI/scripting contexts. When `RICKY_MODE` is set, non-TTY invocations skip the error and proceed directly with the specified mode. Config is NOT persisted for `RICKY_MODE` overrides — they are ephemeral per-invocation context.

---

## 8. Mode selection UX

### 8.1 Design principle

Local/BYOH and Cloud are co-equal modes. Neither is presented as the "real" mode with the other as a fallback. Local appears first in the list because it requires no external setup.

### 8.2 Option 1: Local / BYOH

**Target copy** (when generate/debug commands ship):

```text
  Local / BYOH mode selected.

  In this mode, Ricky will:
  - generate workflows into your local repo
  - validate workflows using local tools (tsc, vitest, agent-relay)
  - run workflows via local agent-relay
  - return artifacts and logs locally

  No Cloud credentials required.

  Next steps:
  - Submit a workflow spec:    npx ricky generate --spec "your spec here"
  - Submit a spec from file:   npx ricky generate --spec-file spec.md
  - Debug a failed workflow:   npx ricky debug --workflow <path>
  - See all commands:          npx ricky help

  Ready to go!
```

**As currently implemented** (`renderModeResult('local')`):

```text
  Local / BYOH mode selected.

  In this mode, Ricky will:
  - generate workflows into your local repo
  - validate workflows using local tools (tsc, vitest, agent-relay)
  - run workflows via local agent-relay
  - return artifacts and logs locally

  No Cloud credentials required.

  Give Ricky a spec, a workflow artifact, or a Claude/MCP handoff and continue locally.

  Next steps:
  - Start Ricky again when you have a concrete spec or workflow artifact to hand off
  - Use `npm start -- --help` to see the currently implemented CLI surface
  - Cloud guidance is available with: npx agent-relay cloud connect google

  Ready to go!
```

### 8.3 Option 2: Cloud

```text
  Cloud mode selected.

  In this mode, Ricky will:
  - generate and run workflows on AgentWorkforce Cloud
  - return downloadable artifacts and execution results
  - support proactive failure notifications

  Let's connect your Cloud providers.

  Step 1: Connect Google (required for Cloud execution)
  Run: npx agent-relay cloud connect google

  Step 2: Connect GitHub (optional, for repo-connected workflows)
  Visit your Cloud dashboard to install the GitHub app:
  → Open your AgentWorkforce Cloud settings → Integrations → GitHub

  After connecting, verify with:
  $ npx ricky status

  Need help? See: npx ricky help cloud
```

### 8.4 Option 3: Both

```text
  Local + Cloud mode selected.

  Local mode is ready now — you can start generating and running
  workflows immediately against your local repo.

  To also enable Cloud execution, connect providers when ready:
  - Google:  npx agent-relay cloud connect google
  - GitHub:  Cloud dashboard → Integrations → GitHub

  Next steps:
  - Submit a workflow spec:    npx ricky generate --spec "your spec here"
  - Check Cloud status:        npx ricky status
  - See all commands:          npx ricky help
```

### 8.5 Option 4: Just explore

**Target copy** (when generate/debug/fix/analyze/status commands ship):

```text
  Explore mode — no setup needed.

  Here's what Ricky can do:

  Generate workflows    npx ricky generate --spec "describe your workflow"
  Debug failures        npx ricky debug --workflow <path>
  Fix broken workflows  npx ricky fix --workflow <path>
  Analyze workflow runs npx ricky analyze
  Check status          npx ricky status

  When you're ready to set up, run: npx ricky setup
```

**As currently implemented** (`renderModeResult('explore')`):

```text
  Explore mode - no setup needed.

  Here's what Ricky can do:

  Today's implemented surface is the interactive CLI onboarding and mode-selection path.
  Ricky also has proven local/BYOH and Cloud domain logic behind that surface,
  but the typed command layer is still intentionally thin.

  See the current CLI help: npm start -- --help
  For Cloud setup:       npx agent-relay cloud connect google
```

### 8.6 Mode persistence

- Selected mode is stored in `.ricky/config.json` (project-local) or `~/.config/ricky/config.json` (global fallback)
- Mode can be overridden per-invocation with `--mode local` or `--mode cloud`
- Mode can be overridden via `RICKY_MODE` env var
- Precedence: `--mode` flag > `RICKY_MODE` env var > project config > global config
- `npx ricky setup` re-runs mode selection at any time

Config persistence rules (implemented):
- Config is persisted only for interactive mode selections (user chose 1/2/3 via the prompt)
- Config is NOT persisted when the mode comes from `--mode` flag or `RICKY_MODE` env var (these are ephemeral per-invocation overrides, not permanent mode commitments)
- Config is NOT persisted for the `explore` choice (explore is a deferral, not a mode commitment)
- Config stores `mode`, `firstRunComplete`, and `providers` (google/github connected booleans)

---

## 9. Returning-user behavior

Returning users should see:
- a compact one-line header (not the full banner)
- current mode or detected context
- the next most useful action
- warnings only when relevant

Do not force the full onboarding narrative every time.

Examples:
- if the user has a local workspace and no Cloud setup, bias toward local continuation
- if the user has already connected Cloud providers, surface the next useful Cloud action
- if the user arrived with a spec payload, skip onboarding and route into intake with a compact confirmation

---

## 10. Provider connection guidance

### 10.1 Source-backed commands only

This spec only references commands and flows that exist in the current codebase.

### 10.2 Google Cloud connect

Command: `npx agent-relay cloud connect google`

This is a real, existing command. The CLI must display it verbatim.

```text
  Connect Google for Cloud execution:
  $ npx agent-relay cloud connect google
```

### 10.3 GitHub app connect

GitHub app installation uses the existing Cloud dashboard integration flow backed by Nango. There is no CLI command for this.

```text
  Connect GitHub for repo-connected workflows:
  Open your AgentWorkforce Cloud settings → Integrations → GitHub
  The GitHub app is installed through the Cloud dashboard.
```

The CLI must NOT:
- invent a `npx ricky connect github` command
- generate or guess a Cloud dashboard URL
- attempt to open a browser to an unverified URL
- create a bespoke OAuth flow for GitHub

### 10.4 Provider status check

```text
$ npx ricky status

  Ricky Status
  ─────────────
  Mode:     cloud
  Google:   connected
  GitHub:   not connected (optional)
  Local:    ready (agent-relay found)
```

---

## 11. Claude / CLI / MCP handoff story

### 11.1 Direct CLI spec submission

Users can pass a spec directly from any source:

```text
$ npx ricky generate --spec "Generate a workflow that runs tests across 3 repos"

$ npx ricky generate --spec-file ~/specs/my-workflow-spec.md

$ cat spec.md | npx ricky generate --spec-stdin
```

### 11.2 Claude session handoff

When a user drafts a spec in a Claude session, they can hand it to Ricky:

```text
# In Claude conversation:
"Here's my workflow spec. Hand this to Ricky."

# Claude can suggest:
$ npx ricky generate --spec-file /tmp/claude-spec-output.md
```

### 11.3 MCP-mediated handoff

When Ricky is registered as an MCP tool, Claude or other assistants can invoke it directly:

- MCP tool name: `ricky.generate`
- Input: `{ spec: "...", mode: "local" | "cloud", source: "claude" | "mcp" | "cli" }`
- Output: `{ artifacts: [...], warnings: [...], nextActions: [...] }`

The CLI and MCP paths must produce the same domain behavior. MCP is a transport, not a different product.

### 11.4 Handoff onboarding copy

**As currently implemented** (`renderHandoffGuidance()`):

```text
  Spec handoff:
  Tip: You can hand specs from Claude directly to Ricky.
  In a Claude session, ask Claude to write a workflow spec.
  Ricky already has internal local/BYOH and Cloud handoff plumbing,
  but the user-facing generate/debug command layer is not exposed yet.

  For now, use the interactive CLI to choose mode, then rerun once
  you have a concrete workflow spec or artifact ready to wire into the next surface.

  Using MCP later? Invoke ricky.generate with the same spec, mode, and source fields.
```

**Target handoff copy** (when generate command ships):

```text
  Tip: You can hand specs from Claude directly to Ricky.
  In a Claude session, ask Claude to write a workflow spec,
  then run: npx ricky generate --spec-file <path>

  Using MCP? Pass Ricky the structured request directly.
```

### 11.5 Handoff UX rule

If a spec or structured request is already present in the invocation, Ricky should prefer a compact confirmation and intake summary over replaying the full onboarding story.

---

## 12. Relationship to web and Slack

CLI, web, and Slack are co-equal onboarding surfaces. None is the "primary" path.

### Cross-surface consistency

| Aspect | CLI | Web | Slack |
|---|---|---|---|
| First-run welcome | ASCII banner + mode selection | Visual welcome + mode cards | DM welcome + guided thread |
| Mode selection | Interactive prompt or `--mode` flag | Radio buttons / cards | Slack buttons |
| Provider connect | Shows command / dashboard link | Inline OAuth flows | Shows command / link |
| Spec submission | `--spec` / `--spec-file` / stdin | Text area / file upload | Message or thread |
| Result delivery | Terminal output + local files | Web UI | Thread reply |

### CLI must not

- Tell users to "go to Slack for the full experience"
- Subordinate CLI features to Slack-first flows
- Require Slack for any core functionality
- Present CLI as a developer-only tool while Slack is the "real" product

Suggested cross-surface phrasing:

```text
  You can also use Ricky from the web or Slack.
  Ricky keeps the workflow intent consistent across surfaces.
```

---

## 13. Concrete copy examples

### 13.1 Help text

**As currently implemented** (`renderHelp()` in `cli-main.ts`):

```text
ricky — workflow reliability, coordination, and authoring

Usage:
  ricky                    Start interactive session (default)
  ricky --mode <mode>      Start with mode preset: local | cloud | both
  ricky help               Show this help text
  ricky version            Show version

Options:
  --mode <mode>   Override execution mode (local, cloud, both)
  --help, -h      Show help
  --version, -v   Show version

Examples:
  npm start
  npm start -- --mode local
  npm start -- help
```

**Target help text** (when generate/debug/fix/analyze/status/setup commands ship):

```text
$ npx ricky help

  Ricky — workflow reliability for AgentWorkforce

  Commands:
    generate    Generate a workflow from a spec
    debug       Debug a failed workflow
    fix         Fix a broken workflow and optionally rerun
    analyze     Analyze workflow runs and suggest improvements
    status      Show Ricky configuration and provider status
    setup       Re-run first-time setup
    help        Show this help

  Options:
    --mode <local|cloud>   Override execution mode
    --quiet, -q            Suppress banner and non-essential output
    --no-banner            Suppress only the ASCII banner
    --version, -v          Show version

  Examples:
    npx ricky generate --spec "test runner for 3 repos"
    npx ricky generate --spec-file spec.md
    npx ricky debug --workflow workflows/wave2/10-test-runner.ts
    npx ricky status
```

### 13.1.1 Current command surface (implemented)

The CLI currently supports three commands via `parseArgs` in `cli-main.ts`:
- `run` (default) — launches the interactive CLI session via `runInteractiveCli`
- `help` — prints usage text
- `version` — prints version string

One flag: `--mode <local|cloud|both>` — overrides mode for the session.

The commands `generate`, `debug`, `fix`, `analyze`, `status`, and `setup` are planned but not yet in `parseArgs`. The flags `--spec`, `--spec-file`, `--spec-stdin`, `--quiet`, and `--no-banner` are also planned.

### 13.2 Error: missing agent-relay (local mode)

```text
$ npx ricky generate --spec "test runner"

  Error: agent-relay not found.

  Ricky needs agent-relay for local workflow execution.
  Install it with: npm install -g @agent-relay/cli

  Or switch to Cloud mode: npx ricky setup
```

### 13.3 Error: Cloud not connected

```text
$ npx ricky generate --spec "test runner" --mode cloud

  Error: No Cloud providers connected.

  Connect Google to use Cloud mode:
  $ npx agent-relay cloud connect google

  Or use local mode:
  $ npx ricky generate --spec "test runner" --mode local
```

### 13.4 Error: unconfigured non-interactive

```text
$ echo '{}' | npx ricky generate

  Error: Ricky has not been configured yet.

  Run `npx ricky` interactively to complete first-run setup,
  or set RICKY_MODE=local to skip setup and use local mode.
```

---

## 14. Happy-path and recovery-path flows

### 14.1 Happy path: local first-run

1. User runs `npx ricky`
2. Banner displays
3. User selects "Local / BYOH"
4. Next-steps shown with example commands
5. User runs `npx ricky generate --spec "my workflow"`
6. Ricky generates workflow, validates locally, returns artifact path

### 14.2 Happy path: Cloud first-run

1. User runs `npx ricky`
2. Banner displays
3. User selects "Cloud"
4. Provider connect instructions shown
5. User runs `npx agent-relay cloud connect google`
6. User runs `npx ricky status` to verify
7. User runs `npx ricky generate --spec "my workflow" --mode cloud`
8. Ricky generates and optionally executes on Cloud

### 14.3 Happy path: Claude handoff

1. User drafts spec in Claude session
2. Claude suggests `npx ricky generate --spec-file <path>` or invokes via MCP
3. Ricky normalizes the spec, selects mode, generates workflow
4. Artifacts returned to user

### 14.4 Recovery: setup interrupted

```text
  It looks like setup was interrupted.
  Run `npx ricky setup` to restart, or use --mode local to skip setup.
```

### 14.5 Recovery: provider connect fails

```text
  Google connect failed. Common causes:
  - Network connectivity issue
  - Browser did not complete OAuth flow
  - Expired or revoked credentials

  Try again: npx agent-relay cloud connect google
  Or continue in local mode: npx ricky --mode local
```

### 14.6 Recovery: workflow generation fails

```text
  Workflow generation failed.

  Error: TypeScript compilation error in generated workflow
  File: /tmp/ricky-gen-abc123/workflow.ts:42

  Ricky will attempt to fix this automatically...
  [fix attempt 1/3]
```

---

## 15. Failure / unblocker guidance

### 15.1 Environment issues

| Issue | Detection | User-facing message |
|---|---|---|
| Node.js not found or too old | `process.version` check | "Ricky requires Node.js 18+. Current: {version}" |
| agent-relay not installed | `which agent-relay` fails | "Install agent-relay: npm install -g @agent-relay/cli" |
| No write permission | `fs.access` check on project dir | "Cannot write to {dir}. Check permissions or run from a writable directory." |
| No network (Cloud mode) | Connection test fails | "Cannot reach AgentWorkforce Cloud. Check your network or use local mode." |
| TypeScript not available | `which tsc` or project check | "TypeScript not found. Install: npm install -D typescript" |

### 15.2 Auth issues

| Issue | Detection | User-facing message |
|---|---|---|
| Google not connected | Config check | "Run: npx agent-relay cloud connect google" |
| Google token expired | API error on Cloud call | "Google credentials expired. Re-run: npx agent-relay cloud connect google" |
| GitHub app not installed | Cloud API check | "Install the GitHub app from your Cloud dashboard: Settings → Integrations → GitHub" |

### 15.3 Error message principle

Every error message must include:
1. What went wrong (one sentence)
2. The most likely cause
3. The exact command or action to fix it

Never show a raw stack trace to an interactive user. Stack traces go to `--verbose` output or log files only.

### 15.4 Stale or contaminated local state

If Ricky detects local runtime contamination or stale state:
- surface it explicitly
- avoid claiming a reliable local run is possible until cleared
- offer a cleanup or recovery suggestion

---

## 16. Copy tone

The voice should be:
- warm, bright, confident, concise
- not corporate, not cheesy

Good:
- "Let's get you started."
- "You can start locally or connect Cloud providers."
- "Hand Ricky the spec. You don't need to rewrite it as a workflow."

Avoid:
- hypey claims
- fake certainty
- "magic" language that hides real prerequisites

---

## 17. Implementation guidance

### 17.1 File targets

| File | Purpose | Status |
|---|---|---|
| `src/cli/ascii-art.ts` | ASCII banner constant and render function | Implemented |
| `src/cli/welcome.ts` | First-run welcome text and product framing | Implemented |
| `src/cli/mode-selector.ts` | Mode selection prompt, descriptions, and persistence | Implemented |
| `src/cli/onboarding.ts` | Orchestrates welcome + mode + provider + next-action | Implemented |
| `src/cli/index.ts` | Public exports for the CLI onboarding module | Implemented |
| `src/cli/onboarding.test.ts` | Tests for user-visible onboarding contracts | Implemented |
| `src/commands/cli-main.ts` | CLI argument parsing and command dispatch | Implemented |
| `src/entrypoint/interactive-cli.ts` | Interactive session composition (onboarding + local/cloud routing + diagnosis) | Implemented |
| `src/entrypoint/interactive-cli.test.ts` | Tests for interactive CLI composition contracts | Implemented |
| `src/commands/cli-main.test.ts` | Tests for CLI argument parsing and dispatch | Implemented |

### 17.2 Export contract (matches current implementation)

`src/cli/index.ts` exports the full public API. This contract is verified by the existing test suite.

```typescript
// From ascii-art.ts
export const RICKY_BANNER: string;
export const RICKY_COMPACT_BANNER: string;
export type BannerVariant = 'full' | 'compact';
export interface RenderBannerOptions { color?: boolean; variant?: BannerVariant }
export interface ShouldShowBannerOptions { quiet?: boolean; noBanner?: boolean; isTTY?: boolean; isFirstRun?: boolean; forceOnboarding?: boolean; env?: { RICKY_BANNER?: string }; rickyBanner?: string }
export function renderBanner(options?: RenderBannerOptions | BannerVariant): string;
export function shouldShowBanner(options?: ShouldShowBannerOptions): boolean;
export function chooseBannerVariant(columns?: number): BannerVariant;
export function shouldUseColor(options?: { color?: boolean; isTTY?: boolean; noColor?: boolean }): boolean;

// From welcome.ts
export interface WelcomeOptions { isFirstRun?: boolean }
export const FIRST_RUN_WELCOME: string;
export const RETURNING_USER_WELCOME: string;
export function renderWelcome(options?: WelcomeOptions): string;

// From mode-selector.ts
export type RickyMode = 'local' | 'cloud' | 'both';
export type OnboardingChoice = RickyMode | 'explore';
export interface ProviderStatus { google: { connected: boolean }; github: { connected: boolean } }
export interface RickyConfig { mode: RickyMode; firstRunComplete: boolean; providers: ProviderStatus }
export interface ModeOption { choice: '1' | '2' | '3' | '4'; value: OnboardingChoice; title: string; description: string }
export const DEFAULT_PROVIDER_STATUS: ProviderStatus;
export const MODE_OPTIONS: ModeOption[];
export function parseModeChoice(input: string): OnboardingChoice | null;
export function isRickyMode(value: string | undefined): value is RickyMode;
export function toRickyMode(choice: OnboardingChoice): RickyMode;
export function renderModeSelection(): string;
export function renderModeSelector(): string;
export function renderModeResult(choice: OnboardingChoice): string;
export function renderCompactHeader(mode: RickyMode, providerStatus?: ProviderStatus): string;

// From onboarding.ts
export interface OnboardingContext { isFirstRun?: boolean; isTTY?: boolean; quiet?: boolean; noBanner?: boolean; forceOnboarding?: boolean; columns?: number; blockedReason?: string | null; mode?: RickyMode; choice?: OnboardingChoice; providerStatus?: ProviderStatus; env?: { RICKY_BANNER?: string } }
export interface RickyConfigStore { readProjectConfig(): Promise<RickyConfig | null>; readGlobalConfig(): Promise<RickyConfig | null>; writeProjectConfig(config: RickyConfig): Promise<void> }
export interface OnboardingOptions { input?: NodeJS.ReadableStream; output?: NodeJS.WritableStream; isTTY?: boolean; quiet?: boolean; noBanner?: boolean; mode?: RickyMode; showBanner?: boolean; columns?: number; env?: NodeJS.ProcessEnv; configStore?: RickyConfigStore; firstRun?: boolean }
export interface OnboardingResult { mode: OnboardingChoice; firstRun: boolean; bannerShown: boolean; output: string }
export function renderOnboarding(context?: OnboardingContext): string;
export function renderCloudGuidance(): string;
export function renderHandoffGuidance(): string;
export function renderInterruptedSetupRecovery(): string;
export function renderNonInteractiveSetupError(): string;
export function renderRecoveryGuidance(blockedReason?: string | null): string;
export function renderProviderConnectFailureRecovery(provider?: string): string;
export function renderWorkflowGenerationFailureRecovery(): string;
export function renderSuggestedNextAction(mode: RickyMode): string;
export function runOnboarding(options?: OnboardingOptions): Promise<OnboardingResult>;
```

### 17.2.1 Interactive CLI and command layer exports

`src/entrypoint/interactive-cli.ts` exports:

```typescript
export interface InteractiveCliResult { ok: boolean; mode: RickyMode; onboarding: OnboardingResult; localResult?: LocalResponse; cloudResult?: CloudGenerateResult; diagnoses: Diagnosis[]; guidance: string[]; awaitingInput?: boolean }
export interface InteractiveCliDeps { onboard?: ...; localExecutor?: LocalExecutor; cloudExecutor?: CloudExecutor; diagnoseFn?: ...; handoff?: RawHandoff; cloudRequest?: CloudGenerateRequest; configStore?: RickyConfigStore; mode?: RickyMode; input?: ...; output?: ...; isTTY?: boolean }
export function runInteractiveCli(deps?: InteractiveCliDeps): Promise<InteractiveCliResult>;
```

`src/commands/cli-main.ts` exports:

```typescript
export interface ParsedArgs { command: 'run' | 'help' | 'version'; mode?: RickyMode }
export interface CliMainResult { exitCode: number; output: string[]; interactiveResult?: InteractiveCliResult }
export interface CliMainDeps extends InteractiveCliDeps { argv?: string[]; runInteractive?: ...; version?: string }
export function parseArgs(argv: string[]): ParsedArgs;
export function renderHelp(): string[];
export function cliMain(deps?: CliMainDeps): Promise<CliMainResult>;
```

### 17.3 Config file shape

Location: `.ricky/config.json` (project-local, takes precedence) or `~/.config/ricky/config.json` (global fallback).

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

Override precedence: `--mode` flag > `RICKY_MODE` env var > project config > global config.

### 17.4 Testability requirements

- All user-visible output must be deterministic (no random elements, no live timestamps in tests)
- Mode selection must accept injected input (not hardcoded to `process.stdin`)
- Provider status checks must be injectable/mockable
- Banner display logic (`shouldShowBanner`) must be a pure function of its options
- File I/O for config must be injectable for testing

### 17.5 Interactive CLI composition pattern (implemented)

The interactive CLI session (`interactive-cli.ts`) composes the onboarding surface with execution:

1. **Onboarding** — runs `runOnboarding` to display banner, welcome, mode selection, and persist config
2. **Mode routing** — based on the resolved mode:
   - `local` or `both`: executes the local path
   - `cloud`: executes the cloud path
3. **Local path behavior**:
   - If no handoff (spec/artifact) is provided, returns `awaitingInput: true` with guidance about what the CLI can do today
   - If a handoff is provided, calls `runLocal` from `@ricky/local`
   - On failure, runs runtime diagnosis via `@ricky/runtime/diagnostics` and surfaces structured unblocker guidance
4. **Cloud path behavior**:
   - If no cloud request context, surfaces bounded recovery guidance
   - If request is present, calls `handleCloudGenerate` from `@ricky/cloud`
   - On failure, surfaces workflow generation failure recovery guidance
5. **Both mode**: runs local first, then cloud if local succeeded and cloud request exists

All dependencies are injectable via `InteractiveCliDeps` for deterministic testing.

### 17.6 Dependency rule

The onboarding module must not add external dependencies for:
- Terminal colors (use raw ANSI codes or a minimal internal helper)
- Interactive prompts (use built-in `readline` or accept injected input)
- File I/O beyond config persistence

---

## 18. Test and acceptance contract

Implementation should pass when (all currently verified by the test suite):
- the banner renders a recognizable roadrunner silhouette with `RRRR` mark
- the banner behavior is deterministic and testable via `shouldShowBanner()`
- local/BYOH and Cloud are both visible as first-class modes in mode selection output
- Google Cloud connect guidance uses the literal text `npx agent-relay cloud connect google`
- GitHub guidance references the Cloud dashboard / Nango-backed flow, not an invented URL
- CLI/MCP/Claude handoff language is present in onboarding output (and honest about current limitations)
- at least one recovery path is represented in tests
- returning-user compact header is distinct from first-run banner
- `--quiet` and `--no-banner` suppress the banner
- non-TTY invocations do not render the banner
- config is persisted for interactive selections but NOT for overrides or explore
- `RICKY_BANNER=0` env var and `rickyBanner` option suppress the banner
- re-prompt behavior works on invalid input
- mode override precedence: `options.mode` > `RICKY_MODE` env > project config > global config

---

## 19. Open questions

1. **ASCII art fidelity** — Should the roadrunner be a detailed multi-line rendering or a minimal 3-4 line silhouette? This spec proposes ~8 lines; implementation may simplify as long as it remains recognizable as a bird.

2. **Interactive prompt library** — Should onboarding use Node's built-in `readline` or a lightweight prompt library? Proposed: built-in `readline` to avoid dependencies.

3. **MCP tool registration** — How and where is Ricky registered as an MCP tool? This spec defines the interface but not the registration mechanism.

4. **Version-gated re-onboarding** — Should a major version bump re-trigger first-run setup? Proposed: no, but `npx ricky setup` is always available.

5. **Offline/air-gapped local mode** — Should local mode work fully offline? Proposed: core local mode works offline; skill loading may require network.

6. **Narrow terminal fallback** — Should the banner degrade to a 2-line text-only version below 60 columns? Proposed: yes, fall back to `ricky · workflow reliability for AgentWorkforce`.

---

## 20. Immediate recommended follow-on

After this spec, the next implementation workflow should:
- implement the CLI onboarding modules and tests defined here
- prove the user-visible output with deterministic tests
- keep local/BYOH and Cloud co-equal in both code and copy
- include at least one recovery-path test for missing local runtime or missing Cloud setup
- validate that `shouldShowBanner()` correctly handles all display rules
- confirm the roadrunner ASCII art is recognizable
