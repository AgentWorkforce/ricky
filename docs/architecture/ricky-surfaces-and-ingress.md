# Ricky Surfaces and Ingress

## Purpose

This document describes every surface through which users and systems interact with Ricky, how requests enter the system, and how they converge into a unified domain model. Wave 1 through Wave 4 implementers should read this before adding or modifying any ingress path.

---

## 1. Surface equality principle

All Ricky surfaces are co-equal product interfaces. No surface is a wrapper around another. Every surface must:

- Converge on the same internal domain model (`LocalInvocationRequest` for local paths, `CloudGenerateRequest` for cloud paths)
- Provide the same quality of onboarding and guidance
- Support the same routing decisions (local vs cloud, generate vs debug vs coordinate)
- Return outcomes in a format appropriate to the surface

CLI is not the "real" interface with Slack as an afterthought. Slack is not the primary surface with CLI as a developer shortcut. They are peers.

---

## 1a. Unified request lifecycle

Every request through every surface follows the same lifecycle. This is the single mental model for all Ricky ingress paths.

```
Surface ingress
  │
  ▼
Auth / validation          ← surface-specific (see §9a)
  │
  ▼
Request normalization      ← src/local/request-normalizer.ts
  │                          Produces LocalInvocationRequest or CloudGenerateRequest
  ▼
Ingress routing            ← src/entrypoint/interactive-cli.ts
  │                          Mode-based: local / cloud / both / explore
  ▼
Executor                   ← LocalExecutor or CloudExecutor
  │
  ▼
Evidence capture           ← src/runtime/evidence/
  │                          Assembles WorkflowRunEvidence
  ▼
Specialist processing      ← diagnostic engine, debugger, validator (as needed)
  │
  ▼
Surface adapter            ← surface-specific response formatting
  │
  ▼
Response delivery          ← CLI stdout, Slack thread, JSON body, MCP response, etc.
```

### Responsible modules

| Stage | Module |
|---|---|
| Auth / validation | Surface-specific (see §9a Authentication model) |
| Request normalization | `src/local/request-normalizer.ts` |
| Ingress routing | `src/entrypoint/interactive-cli.ts` |
| Local execution | `src/local/entrypoint.ts` (LocalExecutor) |
| Cloud execution | `src/cloud/api/generate-endpoint.ts` (CloudExecutor) |
| Evidence capture | `src/runtime/evidence/` |
| Diagnostic classification | `src/runtime/diagnostics/` |
| Surface adaptation | Surface-specific adapter per §11 |

### Rule for implementers

When adding a new surface or modifying an existing one, trace your request through every stage of this lifecycle. If your surface skips a stage or invents a parallel path, the design is wrong.

---

## 2. CLI surface

### Entry point

`src/commands/cli-main.ts` parses command-line arguments:

```
ricky                    # Interactive (default)
ricky --mode local       # Override mode
ricky help               # Usage
ricky version            # Version
```

Returns a structured `CliMainResult` with exit code, output lines, and optional `InteractiveCliResult`.

### Onboarding flow

`src/cli/onboarding.ts` orchestrates the first-run experience:

1. **Banner** - ASCII art from `src/cli/ascii-art.ts`
2. **Welcome** - first-run vs returning user messaging from `src/cli/welcome.ts`
3. **Mode selection** - local, cloud, both, or explore via `src/cli/mode-selector.ts`
4. **Provider guidance** - next-step instructions per selected mode

### Configuration

Two-tier config store:
- Project-level: `.ricky/config.json`
- Global: `~/.config/ricky/config.json`

Project-level config overrides global config. Both are plain JSON.

### Mode selection

`src/cli/mode-selector.ts` accepts four modes:

| Mode | Behavior |
|---|---|
| `local` | Route to LocalExecutor for BYOH execution |
| `cloud` | Route to CloudExecutor for hosted execution |
| `both` | Route to LocalExecutor with cloud fallback |
| `explore` | Informational mode, no execution |

Accepts numeric input (1-4) or text aliases. Defaults to `local` if no input.

---

## 3. Request normalization

### The normalizer

`src/local/request-normalizer.ts` accepts requests from four ingress types and normalizes them into a single contract.

### Four handoff types

**CliHandoff** - direct CLI submission
- Source: `--spec "string"` argument or stdin
- Contains: raw spec string

**McpHandoff** - structured MCP tool invocation
- Source: `ricky.generate` MCP tool call from a connected assistant
- Contains: structured spec, optional metadata

**ClaudeHandoff** - spec from Claude or similar LLM
- Source: conversation handoff from Claude session
- Contains: spec string, optional conversation context for routing

**WorkflowArtifactHandoff** - existing workflow file
- Source: path to a workflow file on disk
- Contains: file path, optional metadata

### Normalized output

All handoff types normalize to `LocalInvocationRequest`:

- `spec` - the workflow spec string
- `source` - label identifying the handoff origin
- `mode` - local, cloud, or both
- `specPath` - optional path to spec file on disk
- `metadata` - optional structured metadata from the source

### Rule for implementers

Adding a new ingress type means adding a new handoff variant to the normalizer. The normalizer is the only place where surface-specific input shapes are translated into domain contracts. No downstream code should know which surface originated the request.

---

## 4. Cloud API surface

### Endpoint

`src/cloud/api/generate-endpoint.ts` handles hosted workflow generation.

**Route:** `POST /api/v1/ricky/workflows/generate` (constant `CLOUD_GENERATE_ROUTE`)

### Request contract (`CloudGenerateRequest`)

```typescript
{
  auth: {
    token: string;
    tokenType?: 'bearer' | 'api-key';
  };
  workspace: {
    workspaceId: string;
    environment?: string;
  };
  body: {
    spec: string;
    specPath?: string;
    mode?: 'cloud' | 'both';
    metadata?: Record<string, unknown>;
  };
}
```

### Response contract (`CloudGenerateResponse`)

```typescript
{
  ok: boolean;
  status: number;
  artifacts: CloudArtifact[];
  warnings: CloudWarning[];
  followUpActions: CloudFollowUpAction[];
  requestId: string;
}
```

### Validation

- Auth token required (non-empty string)
- Workspace ID required
- Spec required (non-empty string)
- Returns typed errors: 401 for auth failure, 400 for validation failure, 500 for server error

### Future endpoints (per SPEC.md)

- `POST /api/v1/ricky/workflows/generate-and-run`
- `POST /api/v1/ricky/workflows/debug`
- `POST /api/v1/ricky/workflows/restart`

These are not yet implemented. Implementers should follow the same request/response contract pattern established by the generate endpoint.

---

## 5. Slack surface

### Manifest

`slack/manifest.json` defines the Slack app configuration:

- **Webhook:** `POST https://ricky.agentrelay.com/api/webhooks/slack`
- **Interactivity:** `POST https://ricky.agentrelay.com/api/slack/interactivity`
- **Bot events:** `app_mention`, `message.im`
- **Scopes:** channels:history, channels:read, chat:write, im:history, im:read, im:write, users:read

### Implementation approach

Slack ingress is implemented through Agent Assistant packages, not custom webhook handling:

- `@agent-assistant/surfaces` for Slack surface abstraction
- `@agent-assistant/webhook-runtime` for signature verification, dedup, thread handling, outbound delivery

### Capabilities

Slack users can:
- Ask Ricky to debug, generate, or coordinate workflows via @mention or DM
- Receive proactive failure notifications
- Get onboarding guidance for first-time interaction

### Rule for implementers

Slack-specific logic (formatting, thread management, interactive components) belongs in the surface layer. Domain logic (what Ricky does with the request) must go through the same normalizer and executor path as every other surface.

---

## 6. MCP and Claude handoff surface

### MCP handoff

Ricky exposes a `ricky.generate` MCP tool that connected assistants (Claude, etc.) can invoke to hand off workflow specs.

The MCP handoff preserves structured context so Ricky can determine whether the user wants generation, execution, debugging, or coordination without re-asking.

### Claude handoff

When a user drafts a spec in a Claude session and hands it to Ricky, the handoff includes:
- The spec itself
- Optional conversation context (what the user discussed, what they intend)

This context helps Ricky route the request correctly without degrading to a generic "what would you like to do?" prompt.

### Rule for implementers

MCP and Claude handoffs must normalize through `request-normalizer.ts` like every other surface. The conversation context is metadata, not a separate execution path.

---

## 7. Web surface

Per SPEC.md, Ricky will have a browser-based onboarding and interaction surface. This surface is not yet implemented, but the ingress contract is defined here so implementers build to the same normalization path as every other surface.

### Expected capabilities

- First-run onboarding for non-CLI users
- Account and integration connection flows
- Spec submission and workflow launch entrypoints
- Transition into cloud-backed execution

### Expected ingress route

**Route:** `POST /api/v1/ricky/web/submit` (browser-initiated requests)

The web handler should accept a `WebHandoff` (the fifth handoff variant in the request normalizer):

```typescript
{
  auth: {
    sessionToken: string;       // browser session or OAuth token
    tokenType: 'session' | 'oauth';
  };
  body: {
    spec: string;               // workflow spec from the web form
    mode?: 'local' | 'cloud' | 'both';
    metadata?: Record<string, unknown>;
  };
}
```

### Handler boundary

The web handler validates the session/auth, extracts the spec and mode, and produces either a `CloudGenerateRequest` (when mode is `cloud` or `both`) or a `LocalInvocationRequest` (when mode is `local`) via the same normalizer used by all other surfaces. The handler itself owns only auth/session validation and request shaping — no domain logic.

### Auth and session expectations

- Browser sessions use OAuth or session-token auth, validated against the Cloud auth layer
- The web surface does not introduce a separate auth mechanism; it delegates to the same workspace-scoped auth as the Cloud API surface

### Rule for implementers

When the web surface is implemented, it must follow the same surface equality principle: converge on the same domain model, use the same normalizer contract, and support the same routing decisions. The web handler must normalize through `request-normalizer.ts` — adding a `WebHandoff` variant — and must not short-circuit to executors directly.

---

## 8. Local/BYOH surface

### Capabilities

The local surface supports:
- Local repo inspection and context detection
- Local workflow artifact creation on disk
- Local `agent-relay` validation and dry-run
- Local execution coordination
- Local log and artifact return

### Execution path

```
LocalInvocationRequest
  -> LocalExecutor.execute()
  -> workflow generation + local agent-relay coordination
  -> LocalResponse with artifacts, logs, outcomes
```

### Environment awareness

Ricky's local surface must distinguish between:
- Workflows intended for local execution
- Workflows intended for cloud execution
- Workflows that should support both

This means the local surface reasons about environment assumptions (available tools, local config, agent-relay installation) rather than generating one-size-fits-all workflow code.

---

## 9. Provider connection guidance

### Google (Cloud)

For cloud-backed usage requiring Google auth, Ricky directs users to the existing Cloud connect command:

```
npx agent-relay cloud connect google
```

This is surfaced during CLI onboarding when the user selects cloud or both mode.

### GitHub

For GitHub app setup, Ricky points users to the existing Cloud dashboard integration flow backed by Nango. Ricky does not implement a separate GitHub auth flow.

### Rule for implementers

Provider connection guidance uses existing AgentWorkforce Cloud infrastructure. Do not create Ricky-specific auth flows when Cloud already provides them.

---

## 9a. Authentication model

Each surface has a distinct authentication method appropriate to its trust context. The auth step happens before request normalization — an unauthenticated request never reaches the domain layer.

### Per-surface authentication

| Surface | Auth method | Responsible module | Trust model |
|---|---|---|---|
| CLI | None (local trust) | — | User is on the local machine; no auth required |
| Slack | Webhook signature verification | `@agent-assistant/webhook-runtime` | Slack signs every request; Agent Assistant verifies |
| Cloud API | Bearer token or API key | `src/cloud/api/generate-endpoint.ts` | Token validated against Cloud auth; workspace-scoped |
| Web | Session token or OAuth | Cloud auth layer | Browser session validated by Cloud |
| MCP | Caller trust | — | MCP host (Claude, etc.) is trusted by the user |
| Local/BYOH | None (local trust) | — | Same as CLI; local execution context |

### Rules

1. Auth validation is the first operation in every surface handler. It runs before any normalization or routing.
2. Auth failures return immediately with a surface-appropriate error (401 for API surfaces, thread reply for Slack, stderr for CLI). No partial processing occurs.
3. Workspace scoping (which workspace the request operates in) is part of the auth contract for Cloud API and Web surfaces. CLI and local surfaces use the project-level config for workspace context.
4. No surface invents its own auth mechanism. CLI and local use local trust. Cloud-connected surfaces use Cloud auth infrastructure. Slack uses Agent Assistant webhook verification.

---

## 10. Ingress routing decision

After normalization, the mode field in the request determines the execution path:

```
mode = "local"  -> LocalExecutor.execute()
mode = "cloud"  -> CloudExecutor.generate()
mode = "both"   -> LocalExecutor.execute() with cloud fallback
mode = "explore" -> informational response, no execution
```

The orchestrator (`src/entrypoint/interactive-cli.ts`) makes this routing decision. No surface should pre-decide the execution path; that is the orchestrator's responsibility.

---

## 11. Artifact return expectations

Each surface has different expectations for how Ricky returns workflow artifacts, outcomes, and follow-up actions. The domain layer produces a unified result; the surface layer adapts delivery to the medium.

### Per-surface return contracts

| Surface | Primary return format | Artifact delivery | Follow-up actions |
|---|---|---|---|
| CLI | Structured terminal output | Files written to disk in the local project | Printed next-step instructions |
| Slack | Threaded message with summary | File uploads or links to artifacts | Interactive buttons or suggested commands |
| Cloud API | JSON response body | `CloudArtifact[]` array with type, path, and content | `CloudFollowUpAction[]` with action type and description |
| MCP/Claude | Structured tool response | Inline artifact content or file paths | Suggested next tool invocations |
| Web | JSON response to browser | Download links or inline previews | UI-rendered action buttons |
| Local/BYOH | `LocalResponse` struct | Files on disk at specified paths | Terminal-printed guidance |

### What every return must include

Regardless of surface, every Ricky result must include:

1. **Success/failure signal** - whether the requested action completed
2. **Artifacts produced** - what files, data, or outputs were created
3. **Warnings** - any assumptions made or edge cases encountered
4. **Follow-up actions** - what the user should or could do next

### Artifact content rules

- Generated workflow files are returned as complete, self-contained TypeScript files
- Evidence summaries are returned as structured data, not raw log dumps
- Diagnostic results include both the classification and the recommended action
- Analytics digests are returned in both structured (typed) and human-readable (markdown) formats when the surface supports it

### Rule for implementers

The domain layer produces a surface-agnostic result. Surface adapters transform this result into the appropriate delivery format. No domain logic should be conditional on the surface type. If a surface needs a different artifact shape, the surface adapter handles the transformation.

---

## 11a. Error response contracts

Each surface has a defined error shape. The domain layer produces a unified error (see runtime architecture §9a Error propagation model); the surface adapter translates it into the surface-appropriate format.

### Per-surface error shapes

| Surface | Error format | Example |
|---|---|---|
| CLI | stderr message + non-zero exit code | `Error: workflow generation failed — pattern selection could not resolve ambiguous spec (exit 1)` |
| Slack | Thread reply with error summary and suggested next action | "Workflow generation failed: ambiguous spec. Try narrowing your request or specifying a pattern." |
| Cloud API | JSON `{ ok: false, status: number, error: { code: string, message: string } }` | `{ ok: false, status: 400, error: { code: "SPEC_AMBIGUOUS", message: "..." } }` |
| MCP/Claude | Structured MCP tool error response | `{ isError: true, content: [{ type: "text", text: "..." }] }` |
| Web | JSON matching Cloud API shape | Same as Cloud API |
| Local/BYOH | `LocalResponse` with `success: false` and diagnostic info | `{ success: false, diagnostics: { blockerCode: "...", guidance: "..." } }` |

### Error content rules

1. Every error response includes: what was attempted, what failed, and what the user should do next.
2. Internal error details (stack traces, infra errors) are never exposed to users. They are logged to stderr with structured JSON (see runtime architecture §10 Logging).
3. Error codes in Cloud API responses use `SCREAMING_SNAKE_CASE` and are stable across versions. They are documented in the API contract.
4. Slack error messages are concise and actionable. They do not dump diagnostic details into the thread; instead they summarize and offer a follow-up action.

---

## 11b. Health and readiness endpoints

Cloud-deployed Ricky surfaces must expose health endpoints for infrastructure monitoring.

### Health endpoint contract

**Route:** `GET /health`

**Response:**
```json
{
  "ok": true,
  "version": "0.1.0",
  "service": "ricky"
}
```

### Per-surface health

| Surface | Health mechanism |
|---|---|
| Cloud API | Dedicated `GET /health` route on the Ricky worker |
| Slack webhook | Inherits health route from `@agent-assistant/webhook-runtime` |
| CLI | No health endpoint (local process, exits after each invocation) |
| Local/BYOH | No health endpoint (local process) |
| Web | Shares Cloud API health endpoint |
| MCP | No health endpoint (caller-initiated) |

### Rules

1. Health endpoints must not perform expensive operations (no database calls, no specialist invocations). They verify the service is alive and return the version.
2. Health endpoints are unauthenticated. They are intended for load balancers and infrastructure monitors, not for users.
3. When Cloud deployment infrastructure requires a readiness check distinct from liveness, add `GET /ready` that verifies downstream dependencies (e.g., Cloud auth service reachable). This is not required for v1.

---

## 12. Key rules for implementers

1. **Never assume one privileged surface.** Code that works only from CLI or only from Slack is a bug.
2. **All surfaces converge on the same domain model.** Surface-specific input shapes are translated in the normalizer, nowhere else.
3. **Provider connect uses existing Cloud commands.** Do not invent parallel auth flows.
4. **Surface layer owns presentation, not logic.** Formatting, thread management, and interactive components stay in the surface layer. Domain routing and execution stay in the orchestrator and executors.
5. **New surfaces require a new handoff variant.** The normalizer is the single integration point for new ingress types.
