# Ricky

Ricky is a Slack-native workflow runner and workflow reliability agent.

It is built to:
- debug failed workflows
- restart or rerun them safely when appropriate
- proactively report workflow failures from Cloud
- analyze workflow quality over time
- suggest concrete workflow improvements
- help users generate high-quality workflows for local BYOH or Cloud execution

## Positioning

Ricky sits between Sage and NightCTO:
- like **Sage**, it is a user-facing Slack agent with BYOH and Cloud modes
- like **NightCTO**, it is proactive, analytics-driven, and operationally opinionated
- like **Relay**, it is deeply workflow-native rather than just LLM-chat-native
- like **Agent Assistant**, it should reuse shared assistant/runtime packages instead of rebuilding those seams locally

## First artifact

The first artifact in this repo is the product spec:
- `SPEC.md`

## Branding

The provided runner mark is used as the Ricky project logo and should be used as the default Slack app / manifest image.
- `assets/ricky-logo.svg`

## Initial repo shape

This repo starts spec-first. No implementation should begin until the spec is reviewed and the first architecture slice is approved.
