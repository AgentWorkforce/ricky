# Ricky CLI Onboarding UX Spec

## 1. Purpose

Define the first-run and early-returning-user CLI experience for Ricky so onboarding feels welcoming, truthful, and implementation-ready.

This spec turns the current banner and ASCII-art requirement into a concrete product contract.

## 2. Product truth

Ricky is a workflow reliability, coordination, authoring, recovery, and analytics product.

The CLI is not a thin wrapper around Slack or Cloud. It is a first-class Ricky surface alongside:
- local and BYOH execution
- Cloud-backed execution and integrations
- interactive surfaces such as Slack and web
- spec handoff paths from Claude, CLI, and MCP

## 3. UX goals

The CLI onboarding experience should:
- feel friendly and high-confidence on first launch
- show that Ricky can help without making users hand-write workflows
- keep local/BYOH and Cloud as co-equal paths
- make the next useful action obvious within one screenful when possible
- explain real provider connection options without inventing fake setup URLs
- handle environment/setup blockers honestly
- create a stable copy contract that tests can assert

## 4. Target users

Primary audiences:
- builders who want Ricky locally or in BYOH mode
- users who want to connect Cloud providers and use Ricky through Cloud-backed flows
- users bringing a spec from Claude, CLI, or MCP and wanting Ricky to take it from there
- users who are curious but do not yet know whether they need local or Cloud mode

## 5. Experience principles

1. Friendly first, but not fluffy.
2. Truth over magic.
3. Do not bury local/BYOH behind Cloud.
4. Do not imply Slack is Ricky's identity.
5. The CLI should help users start, recover, and hand off work, not just print commands.
6. Every onboarding branch should end in a concrete next step.

## 6. Banner and ASCII-art contract

### 6.1 When the banner appears

Show the full Ricky banner when:
- the user runs Ricky for the first time in a workspace
- the user explicitly requests help or onboarding
- the user runs a dedicated onboarding command

Do not show the full large banner on every command after setup.

For returning users, prefer a compact header unless they enter an onboarding or recovery flow.

### 6.2 Banner behavior

The banner should:
- render instantly with no network dependency
- be deterministic plain text
- degrade cleanly in narrow terminals
- remain recognizable in copy/paste logs

### 6.3 Example ASCII treatment

This is an illustrative contract, not final art:

```text
RRRR   III   CCCC  K   K  Y   Y
R   R   I   C      K  K    Y Y
RRRR    I   C      KKK      Y
R  R    I   C      K  K     Y
R   R  III   CCCC  K   K    Y

Workflows, without the mess.
```

### 6.4 Banner copy block

Immediately below the banner, Ricky should present one short framing block:

- what Ricky is
- what Ricky can do next
- which mode the user can choose

Example:

```text
Ricky helps you generate, debug, recover, and run workflows.
You can start locally, bring your own harness, or connect Cloud providers.
Tell Ricky what you want done. You should not need to hand-write workflows.
```

## 7. First-run flow

### 7.1 First-run sequence

Order:
1. render banner
2. render one-paragraph product framing
3. ask or present mode choices
4. present the next action for the chosen mode
5. offer spec handoff examples
6. surface blockers if setup is incomplete

### 7.2 First-run screen content

First-run output should contain:
- banner
- short description of Ricky
- mode chooser
- one example local/BYOH next step
- one example Cloud next step
- one example spec handoff
- recovery/help hint

### 7.3 First-run mode chooser

The CLI should present local/BYOH and Cloud as co-equal options.

Example:

```text
Choose how you want to start:

1. Local / BYOH
   Use your local environment and agent setup.
   Best when you want direct control and local proof.

2. Cloud
   Connect providers and use Ricky with Cloud-backed integrations.
   Best when you want hosted coordination and shared access.
```

## 8. Returning-user behavior

Returning users should usually see:
- a compact Ricky header
- current mode or detected context
- the next most useful action
- warnings only when relevant

Do not force the full onboarding narrative every time.

Examples:
- if the user has a local workspace and no Cloud setup, bias toward local continuation
- if the user has already connected Cloud providers, surface the next useful Cloud action
- if the user arrived with a spec payload, skip long onboarding and route into intake with a compact confirmation

## 9. Local and BYOH onboarding path

### 9.1 Promise

Local/BYOH must be treated as a first-class way to use Ricky, not a fallback.

### 9.2 Local onboarding output

The local/BYOH branch should explain:
- Ricky can use local repo context and local agent-relay execution
- the user can hand Ricky a plain-language spec, workflow artifact, or Claude/MCP handoff
- local environment blockers will be surfaced explicitly

### 9.3 Example next actions

Examples:

```text
Try one of these:
- Give Ricky a plain-language workflow request
- Hand Ricky a spec file
- Hand Ricky a Claude or MCP-produced spec
- Ask Ricky to inspect the current repo and propose the next workflow
```

### 9.4 Local environment checks

Before deep local execution, Ricky should detect and report whether basics are present, such as:
- Node/toolchain availability when required
- agent-relay availability when required
- workspace/repo context when relevant
- missing spec or artifact input when the chosen command requires it

## 10. Cloud onboarding path

### 10.1 Promise

Cloud is a first-class path for hosted coordination, provider connections, and shared integrations.

### 10.2 Cloud guidance rules

Use only real command patterns or source-backed guidance.

For Google, the canonical example is:

```text
npx agent-relay cloud connect google
```

For GitHub or other dashboard-managed integrations, do not invent a local URL or fake direct connect path. Point users to the Cloud dashboard / Nango-backed integration flow.

### 10.3 Cloud next-action copy

Example:

```text
To connect Google in Cloud:
  npx agent-relay cloud connect google

For GitHub and other dashboard-managed integrations:
  Open the Cloud dashboard and complete the provider connection flow.
```

## 11. Spec handoff paths

Ricky should make it obvious that users do not need to translate their intent into handwritten workflows.

### 11.1 Accepted handoff sources

Ricky onboarding should explicitly mention:
- Claude-developed specs
- CLI-authored plain-language specs
- MCP-provided structured specs
- workflow artifact inputs

### 11.2 Handoff copy examples

Example:

```text
Already worked out the problem in Claude?
Hand Ricky the spec and let it turn that into the next workflow or execution step.

Using MCP?
Pass Ricky the structured request directly instead of rewriting it by hand.
```

### 11.3 Handoff UX rule

If a spec or structured request is already present, Ricky should prefer a compact confirmation and intake summary over replaying the full onboarding story.

## 12. Relationship to web and Slack

Ricky supports onboarding from Slack, web, and CLI.

But in the CLI spec:
- CLI remains first-class
- Slack is a surface, not Ricky's identity
- web and Slack should be described as sibling entry points, not the canonical product home

Suggested phrasing:

```text
You can start in the CLI, from the web, or from Slack.
Ricky keeps the workflow intent consistent across surfaces.
```

## 13. Recovery and blocker flows

The CLI must not fail silently or imply the environment is fine when it is not.

### 13.1 Missing local toolchain

If the CLI detects missing local prerequisites, it should:
- say what is missing
- say which path is blocked
- suggest the nearest unblocked next action

Example:

```text
Ricky can continue, but local execution is not ready yet.
Missing: agent-relay
You can install/fix the local runtime, or continue with Cloud setup instead.
```

### 13.2 Missing Cloud connection

If the user chooses Cloud but no provider connection exists:
- say Cloud is not fully connected yet
- show the next real command or dashboard step
- do not pretend the provider is ready

### 13.3 Ambiguous user intent

If the user starts Ricky without a clear goal:
- keep the mode chooser visible
- give 2-4 concrete examples
- offer help phrased around outcomes, not internal implementation terms

### 13.4 Stale or contaminated local runtime state

If Ricky detects local runtime contamination or stale state:
- surface it explicitly
- avoid claiming a reliable local run is possible until cleared
- offer a cleanup or recovery suggestion

This matters because Ricky is explicitly learning from environment and orchestration failure classes.

## 14. Copy tone

The voice should be:
- warm
- bright
- confident
- concise
- not corporate
- not cheesy

Good:
- “Let’s get you started.”
- “You can start locally or connect Cloud providers.”
- “Hand Ricky the spec. You don’t need to rewrite it as a workflow.”

Avoid:
- hypey claims
- fake certainty
- “magic” language that hides real prerequisites

## 15. Implementation guidance

A follow-on implementation workflow should be able to build at least these modules from this spec:
- `src/cli/ascii-art.ts`
- `src/cli/welcome.ts`
- `src/cli/mode-selector.ts`
- `src/cli/onboarding.ts`
- `src/cli/index.ts`
- `src/cli/onboarding.test.ts`

Suggested responsibilities:
- `ascii-art.ts`: banner rendering and compact/fallback variants
- `welcome.ts`: product framing and greeting blocks
- `mode-selector.ts`: mode definitions and mode-selection copy contracts
- `onboarding.ts`: first-run and returning-user composition
- `index.ts`: public CLI onboarding exports
- `onboarding.test.ts`: user-visible text and flow assertions

## 16. Test and acceptance contract

Implementation should pass when:
- the banner behavior is deterministic and testable
- local/BYOH and Cloud are both visible as first-class modes
- Google Cloud connect guidance uses `npx agent-relay cloud connect google`
- GitHub guidance references the Cloud dashboard / Nango-backed flow rather than an invented URL
- CLI/MCP/Claude handoff language is present
- at least one recovery path is represented in output or documented flow contracts
- returning-user mode is distinct from first-run mode

## 17. Open questions

These remain open but should not block implementation:
- whether the default first-run mode chooser is interactive, flag-based, or both
- how aggressively the CLI should auto-detect repo/workspace context before showing choices
- whether the banner gets a second compact variant for very narrow terminals
- how much onboarding history should persist per workspace

## 18. Immediate recommended follow-on

After this spec, the next implementation workflow should:
- implement the CLI onboarding modules and tests defined here
- prove the user-visible output with deterministic tests
- keep local/BYOH and Cloud co-equal in both code and copy
- include at least one recovery-path test for missing local runtime or missing Cloud setup
