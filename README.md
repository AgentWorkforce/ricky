<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/ricky-logo-dark.png">
    <source media="(prefers-color-scheme: light)" srcset="assets/ricky-logo-light.png">
    <img src="assets/ricky-logo-light.png" alt="Ricky runner logo" width="180">
  </picture>
</p>

<p align="center"><strong>Workflow reliability at runner speed.</strong></p>

# Ricky

Ricky is a workflow reliability, workflow coordination, and workflow authoring product for AgentWorkforce.

Ricky is built to:
- debug failed workflows
- fix broken workflows
- restart or rerun them safely when appropriate
- proactively report workflow failures from Cloud
- analyze workflow quality over time
- suggest concrete workflow improvements
- help users generate high-quality workflows for local BYOH or Cloud execution
- coordinate workflow runs and return resulting artifacts

## Interfaces

Ricky is designed to work through these co-equal interfaces and onboarding surfaces:
- **Slack**
- **Web**
- **CLI**
- **Local / BYOH**
- **Cloud API**

Slack is a surface, not the product identity.

## CLI onboarding

Ricky's CLI should be intentionally welcoming and user-friendly.

The CLI onboarding experience should:
- greet users with a recognizable ASCII-art version of the Ricky logo
- help users understand the difference between local/BYOH and Cloud usage
- make the first useful action obvious instead of dropping users into a blank tool
- walk users toward Cloud setup when they want hosted workflow execution

At minimum, Ricky's onboarding surfaces should be able to guide users through:
- local-first workflow authoring and execution
- Cloud connect commands for supported providers
- connecting a Google account for Cloud-backed usage
- connecting the GitHub app through the Cloud/Nango dashboard flow
- starting from Slack, web, or CLI without needing a special privileged setup path

Known Cloud connect command pattern from the Cloud repo:
- `npx agent-relay cloud connect google`

For GitHub-app connection flow, Ricky should direct users into the Cloud dashboard integration flow rather than inventing an ad hoc local-only path.

## Positioning

Ricky sits between Sage and NightCTO:
- like **Sage**, it supports user-facing interaction and BYOH/runtime flexibility
- like **NightCTO**, it is proactive, analytics-driven, and operationally opinionated
- like **Relay**, it is deeply workflow-native rather than just LLM-chat-native
- like **Agent Assistant**, it should reuse shared assistant/runtime packages instead of rebuilding those seams locally

## First artifact

The first artifact in this repo is the product spec:
- `SPEC.md`

## Branding

The provided runner mark is used as the Ricky project logo and should be used as the default Slack app / manifest image.
- `assets/ricky-logo.svg`

## Bootstrap

Ricky uses npm workspaces as its workspace package manager. The root package is private and orchestrates the internal `@ricky/*` packages under `packages/`.

```sh
npm install          # install root and workspace dependencies
```

npm scripts:
- `npm start` — launch the interactive CLI through the `@ricky/cli` workspace
- `npm test` — run workspace package tests, then root proof tests
- `npm run typecheck` — run workspace package typechecks, then root workflow/proof typecheck
- `npm run batch` — run workflow batches via `scripts/run-ricky-batch.sh`
- `npm run overnight` — run the overnight workflow queue via `scripts/run-ricky-overnight.sh`
  - default queue mode is now `flight-safe`, which only runs the workflows currently classified as unattended-safe
  - use `RICKY_OVERNIGHT_QUEUE_MODE=expanded` when you explicitly want the broader supervised queue
  - default behavior checkpoints after a small bounded chunk (`RICKY_OVERNIGHT_MAX_WORKFLOWS_PER_INVOCATION`, default `4`) and can resume with `bash scripts/run-ricky-overnight.sh --resume`
  - checkpoint state lives under `.workflow-artifacts/overnight-state/<queue-mode>/checkpoint.env`

## Package shape

Ricky is a private npm workspace repo.

Workspace packages:
- `@ricky/shared` — shared constants, workflow config models, and workflow evidence models
- `@ricky/runtime` — local coordination, runtime evidence, failure classification, and diagnostics
- `@ricky/product` — spec intake, workflow generation, specialists, and analytics
- `@ricky/cloud` — Cloud auth, workspace scoping, provider guidance, and generate API surfaces
- `@ricky/local` — local/BYOH request normalization and execution composition
- `@ricky/cli` — onboarding, command surface, and interactive CLI entrypoints

The root keeps workflow program assets, bootstrap scripts, shared validation config, and repo-level proof tests.

## Product direction

Ricky should make workflows feel accessible to normal users, not just workflow authors.

The product goal is:
- users can rely on workflows heavily without ever hand-writing one
- users can talk through a spec with Claude or another LLM, then hand that spec directly to Ricky
- Ricky can receive that handoff via CLI or MCP, normalize it, and route it correctly through local/BYOH or Cloud execution
- Ricky should feel fully connected across CLI and Cloud, not like separate disconnected tools

## Initial repo shape

This repo starts spec-first. No implementation should begin until the spec is reviewed and the first architecture slice is approved.
