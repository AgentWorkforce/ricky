# Spec: Ricky Linear integration — @-mention to Cloud workflow to PR

## Problem

Paraglide and similar teams want to triage Linear issues and have a coding agent take a stab at low/mid complexity ones. They've tried wiring Linear → Cursor cloud agents and it doesn't fire reliably; they end up triggering it manually. Ricky already has a Cloud workflow runtime, an auto-fix/diagnose/resume loop, and a Linear provider connection in the integration list — but no surface that listens to Linear events, decides what to do, runs the workflow, and posts the result back.

This spec adds that surface.

End state: a user @-mentions the Ricky agent on a Linear issue (or assigns the issue to it). Ricky reads the issue, generates a workflow that uses the agents the user has connected in Cloud, runs it on Cloud, opens a GitHub PR, and posts the PR link back as Linear AgentActivity.

## Architecture: where things live

Same split as Sage:
- **Cloud (`AgentWorkforce/cloud`, secret sauce)** — webhook ingress, Nango forwarding, agent registry checks, GitHub-app readiness checks, workflow launcher, AgentActivity egress.
- **Ricky OSS (`AgentWorkforce/ricky`, this repo)** — Linear surface contracts (event types, AgentActivity envelope shape), workflow generation that respects the user's connected agent set, status/connect CLI commands, types consumed by Cloud.

The Linear additions in Cloud land as a **follow-up PR after [PR #412](https://github.com/AgentWorkforce/cloud/pull/412)** (Ricky agent v2 Slack surface) merges. PR #412 establishes the Ricky-as-Cloud-agent foundation (DB schema, route layout under `app/api/v1/ricky/<surface>/`, lib layout under `lib/ricky/<surface>/`, `workflow-launcher.ts`, SSE run events). The Linear surface mirrors that layout file-for-file; merging Slack first keeps the Linear PR small and reviewable against a settled base, and avoids coupling two surfaces in one merge/rollback.

### Cloud file layout (mirrors PR #412 Slack)

```
packages/web/app/api/v1/ricky/linear/
  events/route.ts              # Nango-forwarded Linear webhook receiver
  oauth/start/route.ts         # Linear OAuth Actor app start
  oauth/callback/route.ts      # OAuth callback → install row
  webhook/route.ts             # raw webhook (if Nango is bypassed in any env)

packages/web/lib/ricky/linear/
  ingress.ts                   # parse + classify AgentSessionEvent / IssueMention
  egress.ts                    # post AgentActivity (thought / action / response / error)
  parser.ts                    # extract @-mention command + issue context
  auth.ts                      # validate webhook signature, resolve workspace from connectionId
  blocks.ts                    # AgentActivity payload builders (connect link, agent-list link, PR link)
  dedup.ts                     # webhook-id idempotency
  signature.ts                 # Linear-LinearSignature HMAC verify
  store.ts                     # Drizzle accessors for ricky_linear_installation + session table
  proactive.ts                 # cross-surface notifications (PR opened → Linear comment)
packages/web/lib/ricky/linear-agent-v2.ts   # main entry, parallel to slack-agent-v2.ts
packages/web/drizzle/<next>_ricky_linear_agent_v2.sql   # whichever idx is next when this PR opens
integrations/linear/ricky-manifest.json     # OAuth Actor app manifest
```

### Ricky OSS additions

```
src/surfaces/linear/
  index.ts                     # surface entrypoint (status/connect helpers)
  event-types.ts               # AgentSessionEvent, AgentActivity types (shared contract w/ cloud)
  workflow-builder.ts          # issue + connected-agents → workflow spec
  status.ts                    # `ricky status linear` row
  connect.ts                   # `ricky connect linear` guidance (mirrors github connect)
  README.md
src/cloud/api/linear-agent-types.ts          # request/response types for cloud-bound calls
specs/linear-integration.md                  # this file
```

Ricky OSS does **not** receive webhooks. All Linear traffic terminates in Cloud. Ricky OSS contributes the workflow shape, agent contract, and CLI surfaces. Cloud imports types from Ricky.

## Behavior we want

### 1. @-mention ingress

Linear sends webhooks via Nango → `POST /api/v1/ricky/linear/events`. Body envelope:

```jsonc
{
  "type": "forward",
  "from": "linear",
  "connectionId": "<nango-connection-id>",
  "providerConfigKey": "linear-ricky",
  "payload": { /* raw Linear AgentSessionEvent */ }
}
```

Cloud handler steps:
1. Validate envelope shape; verify Linear webhook signature against the configured secret. On mismatch → 401, no body.
2. Look up `ricky_linear_installation` row by `connectionId` + `providerConfigKey`. If none → 200 with no-op (uninstall race).
3. Dedup by Linear `webhookId` for 24h.
4. Classify the event (`ingress.ts`):
   - `AgentSessionEvent` of type `created` (mention or assign) → enter the run flow.
   - `prompted` (follow-up message in an existing session) → continue an existing session.
   - Anything else → ack and ignore.

### 2. Readiness checks (must run in this order, fail fast)

Before generating any workflow:

**a. GitHub app installed for this workspace?**
Query `workspaceIntegrations` for `provider = 'github'` and `status = 'active'`. If missing:
- Post a single `AgentActivity` of kind `response` with body: a short message + a Nango connect link to install the `github-ricky` app for this workspace. Use the same connect-link helper PR #412 uses for Slack `connect` commands; do not roll a fresh one.
- Mark session `ended` with reason `awaiting_github_install`. Do not generate a workflow.

**b. User has connected agents in Cloud?**
Query the agent registry for the actor (the Linear user who triggered the session) within this workspace. The actor's connected agents are the specialists Ricky may use in the workflow. If the user has zero connected agents:
- Post a `response` AgentActivity with a link to the Cloud dashboard's agent connection page and a short message naming the user.
- End session with reason `awaiting_agent_connect`. Do not generate.

Both readiness checks live in `packages/web/lib/ricky/linear/auth.ts` (or a sibling `readiness.ts`) and return a typed result so the agent entry can switch on them.

### 3. Workflow generation

If both checks pass:
1. Read the Linear issue via Nango proxy: title, description, comments, labels, assignees, project.
2. Resolve the connected agent set for the actor (names + capabilities). Pass these to `src/surfaces/linear/workflow-builder.ts` (Ricky OSS).
3. `workflow-builder` produces a Ricky workflow spec that:
   - Treats issue body as the spec input
   - Lists the actor's connected agents as the available specialist set
   - Picks the appropriate Ricky pattern (`pipeline` / `supervisor` / `dag`) from the existing pattern selector
   - Includes a final step that opens a GitHub PR against the repo named in the issue (or the workspace default repo if unambiguous)
4. Post a `thought` AgentActivity describing the chosen pattern and selected agents.

### 4. Workflow execution

Reuse the existing workflow launcher (`packages/web/lib/ricky/workflow-launcher.ts` from PR #412). Cloud invokes it with the generated artifact and emits run events on the existing SSE channel.

While the run executes, mirror notable run events as Linear `AgentActivity`:
- workflow start → `action` (kind: "Generating workflow")
- step start → `action` (kind: step name)
- auto-fix attempt → `thought` ("Step X failed; diagnosing and retrying")
- run complete → see step 5
- run error after auto-fix budget exhausted → `error` AgentActivity with the final blocker, then `ended` with reason `failed`

Auto-fix is on by default — that is the literal differentiator vs the Cursor flow Paraglide gave up on. Do not change that default for the Linear surface.

### 5. PR link reply

When the workflow's PR-opening step succeeds:
1. Capture the PR URL from the step's run evidence.
2. Post a `response` AgentActivity with the PR link and a one-line summary of what the PR changes.
3. Mark the session `ended` with reason `completed`.

If the workflow finishes without producing a PR (e.g. no code changes were needed), post `response` describing the conclusion and end with reason `completed_no_changes`.

## Surface contracts (Ricky OSS)

### `src/surfaces/linear/event-types.ts`

Re-export Linear's `AgentSessionEvent` and `AgentActivity` shapes typed so Cloud can `import { AgentSessionEvent, AgentActivity } from "@agentworkforce/ricky/surfaces/linear/event-types"`. Ricky OSS owns this contract; if Linear updates the schema, the bump lands here first.

### `src/surfaces/linear/workflow-builder.ts`

```ts
export interface BuildLinearWorkflowInput {
  issue: { title: string; description: string; labels: string[]; comments: string[]; project?: string };
  repoTarget: { owner: string; repo: string; defaultBranch: string };
  connectedAgents: ReadonlyArray<{ id: string; name: string; capabilities: string[] }>;
  actor: { linearUserId: string; cloudUserId: string };
}

export interface BuildLinearWorkflowResult {
  artifactPath: string;
  artifactContent: string;
  pattern: "pipeline" | "supervisor" | "dag";
  selectedAgents: ReadonlyArray<string>;
  rationale: string;          // surfaced as a Linear `thought`
}

export function buildLinearWorkflow(input: BuildLinearWorkflowInput): BuildLinearWorkflowResult;
```

Implementation reuses `src/product/generation/pattern-selector.ts` and the existing workforce persona writer; do not fork a parallel generator.

### `src/cloud/api/linear-agent-types.ts`

The HTTP shapes Cloud uses for `/api/v1/ricky/linear/events` requests and the AgentActivity post payload, exported so Cloud can typecheck imports from this repo.

The exported wire types are `LinearMentionRequest`, `LinearMentionResponse`, `RickyLinearSession`, and `SessionEndReason`. The `SessionEndReason` values are exactly `completed`, `completed_no_changes`, and `failed`.

## CLI additions (Ricky OSS)

- `ricky status linear` — show whether the Linear connection is wired for the user's workspace (delegates to existing readiness check)
- `ricky connect linear` — print the Cloud dashboard URL for the Linear OAuth Actor app install, mirroring the existing `ricky connect github` guidance pattern at `src/cloud/auth/provider-connect.ts`

These reuse the existing connect-guidance helpers; do not invent a new flow.

## Telemetry

Each Linear session run emits one Cloud telemetry record with:
- workspace + actor + linear issue id
- pattern selected
- agents selected
- workflow run id
- PR url (if any)
- end reason
- auto-fix attempts used

This is the eval surface Paraglide eventually expands into; ship it on day one even if no UI consumes it yet.

## Out of scope

- Linear comments that aren't @-mentions (no passive monitoring)
- High-complexity issues — the triage decision lives in the user's Linear setup, not in Ricky. Ricky acts on whatever it's @-mentioned on.
- Multi-issue batching or epic-level orchestration
- Custom per-repo workflow templates
- A Linear-specific dashboard surface (the existing Cloud dashboard surface is enough for v1)

## Test plan

OSS (`ricky/`):
- Unit tests for `workflow-builder.ts`: pattern selection respects connected-agent count; rationale references issue labels; missing repo target throws.
- Type test that `event-types.ts` matches Linear's published Agents API schema.
- `ricky status linear` smoke test against a fake readiness fixture.

Cloud (`cloud/`, in PR #412 follow-on):
- Webhook signature verification rejects bad HMAC.
- Envelope unwrap handles `from: "linear"` and ignores other `from` values.
- Readiness path 1: missing GitHub install → exactly one `response` AgentActivity with a connect link, no workflow generated.
- Readiness path 2: actor has zero connected agents → exactly one `response` with the agent-connect link, no workflow generated.
- Happy path: generates workflow, runs it, posts PR link, ends session `completed`.
- Auto-fix exhaustion: posts `error`, ends `failed`.
- Dedup: same `webhookId` twice → second is no-op.

Manual:
- Real Linear workspace, install the Ricky Actor app via Nango, @-mention on a throwaway issue, watch AgentActivity post live, end with a real PR link in a sandbox repo.

## Open questions for the implementor

1. The actor → Cloud user mapping for the agent-readiness check needs an explicit linkage. PR #412's Slack store maps Slack user IDs to Cloud user IDs through OAuth identity. The Linear surface should do the same — confirm the mapping table extension before implementing the readiness check.
2. "Repo target" resolution: if the issue body doesn't name a repo, fall back to the workspace's default repo binding. Confirm where that default is stored (workspace settings? first-active GitHub installation?) before implementing the workflow builder.
