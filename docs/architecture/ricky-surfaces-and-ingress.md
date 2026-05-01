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
Ingress routing            ← src/surfaces/cli/entrypoint/interactive-cli.ts
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
| Ingress routing | `src/surfaces/cli/entrypoint/interactive-cli.ts` |
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

`src/surfaces/cli/commands/cli-main.ts` parses command-line arguments:

```
ricky                    # Interactive (default)
ricky --mode local       # Override mode
ricky help               # Usage
ricky version            # Version
```

Returns a structured `CliMainResult` with exit code, output lines, and optional `InteractiveCliResult`.

### Onboarding flow

`src/surfaces/cli/cli/onboarding.ts` orchestrates the first-run experience:

1. **Banner** - ASCII art from `src/surfaces/cli/cli/ascii-art.ts`
2. **Welcome** - first-run vs returning user messaging from `src/surfaces/cli/cli/welcome.ts`
3. **Mode selection** - local, cloud, both, or explore via `src/surfaces/cli/cli/mode-selector.ts`
4. **Provider guidance** - next-step instructions per selected mode

### Configuration

Two-tier config store:
- Project-level: `.ricky/config.json`
- Global: `~/.config/ricky/config.json`

Project-level config overrides global config. Both are plain JSON.

### Mode selection

`src/surfaces/cli/cli/mode-selector.ts` accepts four modes:

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

`src/local/request-normalizer.ts` accepts requests from five ingress types and normalizes them into a single contract.

### Five handoff types

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

**WebHandoff** - browser-initiated submission
- Source: `POST /api/v1/ricky/web/submit` (see §7)
- Contains: session/OAuth auth context, spec, mode, and metadata
- Normalizes to `CloudGenerateRequest` when mode is `cloud` or `both`, or `LocalInvocationRequest` when mode is `local`

### Normalized output

All five handoff variants normalize through the same boundary. Four of the five (CliHandoff, McpHandoff, ClaudeHandoff, WorkflowArtifactHandoff) always normalize to `LocalInvocationRequest`. WebHandoff normalizes to either `CloudGenerateRequest` (when mode is `cloud` or `both`) or `LocalInvocationRequest` (when mode is `local`), with the mode field in the handoff determining the downstream domain contract:

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

## 4a. Cloud API versioning policy

### Versioning strategy

Ricky's Cloud API uses **path-based versioning**. The version segment is embedded in the URL path: `/api/v1/ricky/...`.

This was chosen over header-based versioning because:
- It is visible and debuggable in logs, dashboards, and curl commands without inspecting headers
- It is consistent with the existing Cloud API surface patterns in `AgentWorkforce/cloud`
- Path routing is simpler to implement in the Cloudflare worker than header-based dispatch

### Version lifecycle

| Phase | Duration | Meaning |
|---|---|---|
| Active | Indefinite until successor ships | Current recommended version; receives new features and fixes |
| Deprecated | Minimum 90 days after successor reaches Active | Still functional; responses include `Deprecation` header with sunset date; no new features |
| Sunset | After deprecation period ends | Returns `410 Gone` with a body pointing to the successor version |

### Deprecation signaling

When a version enters the Deprecated phase, all responses include:

```
Deprecation: true
Sunset: <ISO 8601 date>
Link: </api/v2/ricky/workflows/generate>; rel="successor-version"
```

### Backward compatibility expectations

Within a single version (e.g., `v1`):

1. **New fields may be added** to response bodies. Clients must tolerate unknown fields.
2. **Existing response fields are never removed or renamed.** If a field becomes irrelevant, it continues to be returned (possibly as `null`).
3. **New optional request fields may be added.** Existing requests without the new field continue to work.
4. **Required request fields are never added** within a version. Adding a new required field is a breaking change that requires a new version.
5. **Error codes are stable.** Once an error code (e.g., `SPEC_AMBIGUOUS`) is shipped in a version, it is never removed or changed in meaning.

### Rule for implementers

All Cloud API changes must be evaluated against these compatibility rules before merge. A change that violates backward compatibility within a version must be shipped in a new version. Version transitions are planned, not accidental.

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

## 6a. MCP tool definition contract

The `ricky.generate` MCP tool is the concrete contract that connected assistants use to invoke Ricky. This section defines the parameter schema, response schema, and behavioral expectations.

### Tool definition

```json
{
  "name": "ricky.generate",
  "description": "Hand off a workflow spec to Ricky for generation, debugging, coordination, or analysis. Ricky will determine the correct action based on the spec content and metadata.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "spec": {
        "type": "string",
        "description": "The workflow specification — natural language description, structured spec, or reference to a failing workflow."
      },
      "intent": {
        "type": "string",
        "enum": ["generate", "debug", "restart", "analyze", "coordinate", "auto"],
        "description": "What the user wants Ricky to do. 'auto' lets Ricky determine intent from the spec content. Default: 'auto'."
      },
      "mode": {
        "type": "string",
        "enum": ["local", "cloud", "both"],
        "description": "Execution mode. Default: 'local'."
      },
      "context": {
        "type": "object",
        "description": "Optional conversation context from the calling assistant — what was discussed, what the user intends. Helps Ricky route without re-asking.",
        "properties": {
          "conversationSummary": { "type": "string" },
          "userGoal": { "type": "string" },
          "priorDecisions": {
            "type": "array",
            "items": { "type": "string" }
          }
        },
        "additionalProperties": true
      },
      "workflowPath": {
        "type": "string",
        "description": "Optional path to an existing workflow file on disk for debugging or restart."
      }
    },
    "required": ["spec"]
  }
}
```

### Response schema

```json
{
  "type": "object",
  "properties": {
    "success": { "type": "boolean" },
    "action": {
      "type": "string",
      "enum": ["generated", "debugged", "restarted", "analyzed", "coordinated", "escalated"]
    },
    "artifacts": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "path": { "type": "string" },
          "type": { "type": "string", "enum": ["workflow", "report", "evidence", "log"] },
          "summary": { "type": "string" }
        }
      }
    },
    "warnings": {
      "type": "array",
      "items": { "type": "string" }
    },
    "followUp": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "action": { "type": "string" },
          "description": { "type": "string" }
        }
      }
    },
    "summary": { "type": "string" }
  }
}
```

### Error response

On failure, the MCP tool returns the standard MCP error shape:

```json
{
  "isError": true,
  "content": [
    { "type": "text", "text": "Workflow generation failed: <user-visible reason>" }
  ]
}
```

### Behavioral rules

1. When `intent` is `"auto"`, Ricky inspects the spec content to determine the correct action. A spec describing desired behavior routes to generation; a spec referencing a failed run routes to debugging; an explicit restart or analytics request routes accordingly.
2. The `context` field is advisory. Ricky uses it for routing heuristics but does not require it. The spec alone must be sufficient to determine the action.
3. The MCP tool normalizes its input into a `McpHandoff` variant and passes it through `request-normalizer.ts`. No domain logic lives in the MCP tool handler itself.
4. Response `artifacts` contain file paths (for local mode) or inline summaries (for cloud mode). The calling assistant can use paths to read generated files or present summaries to the user.

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

## 9b. Rate limiting and abuse protection

Cloud-connected and externally accessible surfaces need rate-limiting guidance to prevent abuse and resource exhaustion. This section defines per-surface expectations.

### Per-surface rate-limiting expectations

| Surface | Rate limit strategy | Implementation layer |
|---|---|---|
| CLI | None. Local trust — the user controls invocation frequency. | — |
| Local/BYOH | None. Same as CLI. | — |
| MCP | None. Caller trust — the MCP host manages invocation frequency. | — |
| Slack | Slack's own rate limiting applies to outbound messages. Ricky deduplicates inbound events via `@agent-assistant/webhook-runtime`. No additional Ricky-specific rate limit on inbound. | `@agent-assistant/webhook-runtime` (dedup) |
| Cloud API | Per-workspace, per-endpoint rate limits enforced by the Cloud infrastructure layer. | Cloudflare worker / Cloud API gateway |
| Web | Inherits Cloud API rate limits for spec submission endpoints. Session-based limits for auth flows. | Cloud API gateway |

### Cloud API rate-limiting contract

Cloud API rate limits are enforced at the infrastructure layer (Cloudflare worker or Cloud API gateway), not in Ricky's application code. The application code must:

1. **Not implement its own rate-limiting logic.** Ricky's Cloud endpoint handlers assume that the infrastructure has already enforced limits by the time a request reaches them.
2. **Return standard rate-limit response headers** when the infrastructure injects them:
   - `X-RateLimit-Limit`: maximum requests per window
   - `X-RateLimit-Remaining`: remaining requests in current window
   - `X-RateLimit-Reset`: UTC timestamp when the window resets
   - `Retry-After`: seconds until the client should retry (on 429 responses)
3. **Return `429 Too Many Requests`** when the infrastructure signals a rate-limit hit. The body must include a structured error: `{ ok: false, status: 429, error: { code: "RATE_LIMITED", message: "..." } }`.

### Recommended initial rate limits

These are guidance for the Cloud infrastructure team, not application-level config:

| Endpoint | Per-workspace limit | Rationale |
|---|---|---|
| `POST /api/v1/ricky/workflows/generate` | 30 requests / minute | Generation is compute-intensive; prevents runaway automation |
| `POST /api/v1/ricky/workflows/generate-and-run` | 10 requests / minute | Includes execution; more resource-intensive |
| `POST /api/v1/ricky/workflows/debug` | 30 requests / minute | Diagnosis is cheaper than generation |
| `POST /api/v1/ricky/workflows/restart` | 10 requests / minute | Restarts are operationally sensitive |
| `GET /health` | No limit | Health checks are cheap and must always succeed |

### Rules

1. Rate limits are per-workspace, not per-user. A workspace's total request budget is shared across all users and API keys in that workspace.
2. Rate-limit configuration is owned by the Cloud infrastructure, not by the Ricky application. Ricky never reads or modifies rate-limit settings.
3. If a surface does not have a rate limit (CLI, local, MCP), it must not artificially throttle requests. Rate limiting is only applied where external abuse is possible.
4. Abuse patterns beyond rate limits (e.g., credential stuffing, large payload flooding) are handled by the Cloud infrastructure's WAF / DDoS protection, not by Ricky application code.

---

## 10. Ingress routing decision

After normalization, the mode field in the request determines the execution path:

```
mode = "local"  -> LocalExecutor.execute()
mode = "cloud"  -> CloudExecutor.generate()
mode = "both"   -> LocalExecutor.execute() with cloud fallback
mode = "explore" -> informational response, no execution
```

The orchestrator (`src/surfaces/cli/entrypoint/interactive-cli.ts`) makes this routing decision. No surface should pre-decide the execution path; that is the orchestrator's responsibility.

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

## 11c. Request timeout and cancellation

Surfaces have different timeout expectations based on their interaction model. This section defines timeout behavior and cancellation propagation for each surface.

### Per-surface timeout behavior

| Surface | Request timeout | Timeout behavior | Cancellation mechanism |
|---|---|---|---|
| CLI | No hard timeout (process-level) | The user controls process lifetime via Ctrl-C or `kill`. The CLI orchestrator respects `WorkflowTimeoutSettings` from config for execution phases. | SIGINT/SIGTERM caught by the CLI entry point; triggers graceful shutdown of the executor and evidence capture. |
| Local/BYOH | `WorkflowTimeoutSettings.runTimeoutMs` | Execution phases respect the configured timeout. On timeout, the local executor records `timed_out` status in evidence and returns. | Same as CLI — process signal propagation. |
| Slack | 3 seconds (Slack webhook ack requirement) | Slack requires a webhook acknowledgment within 3 seconds. Ricky acknowledges immediately, then processes asynchronously. Results are delivered as follow-up thread messages. | No explicit cancellation. Users can start a new request; the original continues to completion or internal timeout. |
| Cloud API | 30 seconds default (configurable per deployment) | The Cloudflare worker enforces an HTTP response timeout. For fast operations (generate-only), Ricky returns within the timeout. For long operations (generate-and-run), Ricky returns a run receipt (`runId`) immediately and the client polls for results. | Client can disconnect (HTTP connection close). The worker notes the disconnect but the backend operation continues to completion — results are stored for later retrieval. |
| Web | Inherits Cloud API timeout | Same as Cloud API. The browser client uses async polling for long operations. | Same as Cloud API — disconnect does not cancel. |
| MCP | Caller-determined | The MCP host sets the timeout. Ricky's MCP handler has no internal timeout — it relies on the host's timeout and the execution-phase timeouts from config. | MCP cancellation is propagated by the host. If the host cancels, Ricky's handler stops and returns a partial result or error. |

### Timeout propagation model

```
Surface timeout (HTTP, Slack ack, process signal)
  │
  ▼
Orchestrator timeout (per-mode execution phase)
  │
  ▼
Executor timeout (WorkflowTimeoutSettings.runTimeoutMs)
  │
  ▼
Step timeout (WorkflowTimeoutSettings.stepTimeoutMs)
```

The most restrictive timeout at any level wins. If the surface timeout fires before the executor completes, the surface returns an appropriate timeout response while the executor may continue (for async surfaces like Cloud API and Slack) or be killed (for synchronous surfaces like CLI).

### Cancellation propagation rules

1. **CLI/Local:** SIGINT triggers an `AbortController` signal that propagates to the executor. The executor has a grace period (5 seconds by default) to capture partial evidence before the process exits.
2. **Cloud API:** Client disconnection is noted but does not cancel the backend operation. The operation completes and results are stored. This prevents accidental cancellation from network instability.
3. **Slack:** No cancellation. Once Ricky begins processing, it completes. This is consistent with Slack's fire-and-forget webhook model.
4. **MCP:** Cancellation is synchronous. If the MCP host signals cancellation, Ricky stops immediately and returns partial results. MCP cancellation does not trigger graceful evidence capture.

### Long-running operation pattern

For operations that exceed the surface timeout (common in generate-and-run flows):

1. The surface handler returns a receipt containing a `runId` and a status URL.
2. The client polls `GET /api/v1/ricky/workflows/runs/{runId}/status` for progress.
3. When the operation completes, the status response includes full `WorkflowRunEvidence`.
4. The status endpoint uses the same auth and workspace scoping as the originating request.

This pattern applies to Cloud API and Web surfaces. CLI and local surfaces are synchronous — they block until completion or timeout.

### Rules

1. Every executor and specialist must respect the `AbortSignal` passed through the execution context. Operations that ignore cancellation signals are bugs.
2. Partial evidence is always better than no evidence. On timeout or cancellation, the executor must capture whatever evidence has been assembled so far and include it in the response.
3. Timeout values are part of `WorkflowTimeoutSettings` in the shared config, not hardcoded in surface handlers. The only exception is the Slack 3-second ack requirement, which is a platform constraint.
4. Cloud API must never return a timeout error for generate-and-run requests. It must always return a run receipt immediately and use the polling pattern.

---

## 12. Key rules for implementers

1. **Never assume one privileged surface.** Code that works only from CLI or only from Slack is a bug.
2. **All surfaces converge on the same domain model.** Surface-specific input shapes are translated in the normalizer, nowhere else.
3. **Provider connect uses existing Cloud commands.** Do not invent parallel auth flows.
4. **Surface layer owns presentation, not logic.** Formatting, thread management, and interactive components stay in the surface layer. Domain routing and execution stay in the orchestrator and executors.
5. **New surfaces require a new handoff variant.** The normalizer is the single integration point for new ingress types.
