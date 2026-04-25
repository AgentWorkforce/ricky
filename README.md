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

Ricky is designed to work through three co-equal interfaces:
- **Local / BYOH**
- **Cloud API**
- **Slack**

Slack is a surface, not the product identity.

## CLI onboarding

Ricky's CLI should be intentionally welcoming and user-friendly.

The CLI onboarding experience should:
- greet users with a recognizable ASCII-art version of the Ricky logo
- help users understand the difference between local/BYOH and Cloud usage
- make the first useful action obvious instead of dropping users into a blank tool
- walk users toward Cloud setup when they want hosted workflow execution

At minimum, Ricky's CLI should be able to guide users through:
- local-first workflow authoring and execution
- Cloud connect commands for supported providers
- connecting a Google account for Cloud-backed usage
- connecting the GitHub app through the Cloud/Nango dashboard flow

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

Ricky should bootstrap required skills and repo-improvement tooling up front.

Current bootstrap commands:
- `npx skills add https://github.com/vercel-labs/skills --skill find-skills --yes`
- `prpm install @prpm/self-improving`

Convenience script:
- `bash ./skills.sh`

## Initial repo shape

This repo starts spec-first. No implementation should begin until the spec is reviewed and the first architecture slice is approved.
