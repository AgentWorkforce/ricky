# Surfaces and Ingress Cases

These cases come from the surfaces/ingress architecture, CLI onboarding spec,
Cloud runtime execution spec, Linear integration spec, and MCP/Web/Slack
contracts.

## surfaces-ingress.co-equal-surfaces
Executor: manual
Kind: capability
Tags: surfaces, ingress
Human Review: true

### Message
Design a new Ricky Slack surface for workflow debugging.

### Deterministic Checks
maxToolCalls: 0

### Must
- Treat Slack as a co-equal product surface, not a wrapper around CLI.
- Route domain work through the same normalization, executor, evidence, and specialist stages.
- Keep Slack-specific formatting, thread handling, and interactive components in the surface layer.

### Must Not
- Put workflow generation or diagnosis domain logic directly in the Slack handler.
- Degrade Slack to a developer shortcut with weaker routing than CLI.
- Skip signature verification, dedup, or thread handling when the surface is implemented.

## surfaces-ingress.normalizer-is-only-translation-boundary
Executor: manual
Kind: regression
Tags: surfaces, normalization
Human Review: true

### Message
Add a new web handoff type that submits a workflow spec and mode.

### Deterministic Checks
maxToolCalls: 0

### Must
- Add a handoff variant that normalizes into `LocalInvocationRequest` or `CloudGenerateRequest`.
- Keep auth/session validation in the web surface before normalization.
- Ensure downstream code does not need to know the request came from web.

### Must Not
- Short-circuit directly from the web handler to executors.
- Create a parallel domain model for web requests.
- Make the web surface the owner of local or Cloud routing semantics.

## surfaces-ingress.mcp-claude-context-is-metadata
Executor: manual
Kind: regression
Tags: surfaces, mcp, claude
Human Review: true

### Message
A Claude session hands Ricky a workflow spec plus conversation context and asks Ricky to determine whether to generate, debug, restart, analyze, or coordinate.

### Deterministic Checks
maxToolCalls: 0

### Must
- Normalize the tool call through the MCP/Claude handoff path.
- Treat conversation context as advisory metadata.
- Make the spec itself sufficient for routing whenever possible.

### Must Not
- Require the user to rewrite the spec manually as a workflow.
- Put domain routing logic inside the MCP tool handler itself.
- Ignore provided mode, workflow path, or prior decisions metadata.

## surfaces-ingress.cloud-api-versioning
Executor: manual
Kind: regression
Tags: cloud, api, compatibility
Human Review: true

### Message
Change the Cloud Ricky generate API response to include a new field and change one existing error code name.

### Deterministic Checks
maxToolCalls: 0

### Must
- Allow additive response fields within `/api/v1/ricky/...`.
- Reject renaming or changing the meaning of an existing error code inside the same version.
- Require a new API version for breaking request/response changes.

### Must Not
- Remove or rename existing response fields in v1.
- Add a new required request field within v1.
- Treat version transitions as accidental or unplanned.

## surfaces-ingress.cloud-run-json-is-single-object
Executor: manual
Kind: regression
Tags: cloud, cli, json
Human Review: true

### Message
Implement `ricky run workflows/foo.ts --cloud --json`.

### Deterministic Checks
maxToolCalls: 0

### Must
- Return exactly one well-formed JSON object on stdout.
- Include `runReceipt.runId` on success or an actionable `error` object on missing or invalid Cloud auth.
- Suppress live tail, status lines, and human event text in JSON mode.

### Must Not
- Silently fall back to a Cloud stub when authenticated execution is rejected.
- Mix human-readable progress lines with JSON output.
- Upload large artifacts inline beyond the documented threshold without a clear error.

## surfaces-ingress.linear-readiness-fail-fast
Executor: manual
Kind: capability
Tags: linear, cloud, readiness
Human Review: true

### Message
A Linear user mentions Ricky on an issue, but GitHub app installation is missing and the user has no connected agents.

### Deterministic Checks
maxToolCalls: 0

### Must
- Run readiness checks before workflow generation.
- First report the missing GitHub app install with a connect link and end the session awaiting install.
- Avoid generating or launching a workflow until required readiness passes.

### Must Not
- Generate a workflow before checking GitHub and connected-agent readiness.
- Invent a Ricky-specific GitHub auth flow.
- Post multiple noisy AgentActivity responses for the same readiness blocker.

## surfaces-ingress.linear-pr-link-completion
Executor: manual
Kind: capability
Tags: linear, cloud, pr
Human Review: true

### Message
Ricky completes a Linear-triggered Cloud workflow that opened a GitHub PR.

### Deterministic Checks
maxToolCalls: 0

### Must
- Capture the PR URL from run evidence.
- Post a Linear AgentActivity response with the PR link and concise change summary.
- End the session with `completed`, or `completed_no_changes` if no PR was needed.

### Must Not
- Claim a PR was opened without a URL in evidence.
- Leave the Linear session open after terminal completion.
- Ignore auto-fix exhaustion or failed run terminal states.

## surfaces-ingress.provider-guidance-no-invented-flows
Executor: manual
Kind: regression
Tags: cli, onboarding, cloud
Human Review: true

### Message
A CLI user selects Cloud mode and needs Google and GitHub setup guidance.

### Deterministic Checks
maxToolCalls: 0

### Must
- Show the Google command exactly as `npx agent-relay cloud connect google`.
- Point GitHub setup to the AgentWorkforce Cloud dashboard and Nango-backed integration flow.
- Keep Cloud and local as co-equal choices with an explicit local alternative.

### Must Not
- Invent `npx ricky connect github`.
- Invent an unaudited dashboard URL.
- Require web or Slack onboarding before CLI can be useful.
