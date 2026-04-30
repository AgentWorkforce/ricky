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
Ricky is the product answer to the workflow monitor problem described in `AgentWorkforce/cloud#161`: a cheap, workflow-native monitor/recovery agent that can watch long-running workflow programs, diagnose failures, fix common issues, resume from the right point, and keep a truthful evidence trail instead of requiring expensive manual babysitting.

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

Ricky is a single-package repo with a flat `src/` tree. The product surfaces live under `src/surfaces/`, with shared inner layers under `src/{shared,runtime,product,cloud,local}`.

```sh
npm install          # install dependencies for the single root package
npm run typecheck    # typecheck src, tests, workflows, and scripts
npm test             # bundle the CLI and run the repo test suite + proof tests
npm start            # launch the CLI from src/surfaces/cli/commands/cli-main.ts
```

npm scripts:
- `npm start` — launch the interactive CLI from `src/surfaces/cli/commands/cli-main.ts`
- `npm test` — bundle the CLI, then run the full test suite and proof tests
- `npm run typecheck` — typecheck the flat `src/` tree plus workflows/proofs/scripts
- `npm run batch` — run workflow batches via `scripts/run-ricky-batch.sh`
- `npm run overnight` — run the overnight workflow queue via `scripts/run-ricky-overnight.sh`
  - default queue mode is now `flight-safe`, which only runs the workflows currently classified as unattended-safe
  - default behavior checkpoints after a small bounded chunk (`RICKY_OVERNIGHT_MAX_WORKFLOWS_PER_INVOCATION`, default `4`) and can resume with `bash scripts/run-ricky-overnight.sh --resume`
  - checkpoint state lives under `.workflow-artifacts/overnight-state/<queue-mode>/checkpoint.env`

## Package shape

Ricky is a private single-package repo.

Source layout:
- `src/shared` — shared constants, workflow config models, and workflow evidence models
- `src/runtime` — local coordination, runtime evidence, failure classification, and diagnostics
- `src/product` — spec intake, workflow generation, specialists, and analytics
- `src/cloud` — Cloud auth, workspace scoping, provider guidance, and generate API surfaces
- `src/local` — local/BYOH request normalization and execution composition
- `src/surfaces/cli` — onboarding, command surface, and interactive CLI entrypoints

The root keeps workflow program assets, bootstrap scripts, validation config, bundle output, and repo-level proof tests.

## Product direction

Ricky should make workflows feel accessible to normal users, not just workflow authors.

The product goal is:
- users can rely on workflows heavily without ever hand-writing one
- users can talk through a spec with Claude or another LLM, then hand that spec directly to Ricky
- Ricky can receive that handoff via CLI or MCP, normalize it, and route it correctly through local/BYOH or Cloud execution
- Ricky should feel fully connected across CLI and Cloud, not like separate disconnected tools

## Repo shape

Ricky now uses the flat-layout collapse proved by `test/flat-layout-proof/`. Product source should live under the root `src/` tree, with surfaces under `src/surfaces/` and no legacy `packages/*` workspace sources.
