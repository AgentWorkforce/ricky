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

## Initial repo shape

This repo starts spec-first. No implementation should begin until the spec is reviewed and the first architecture slice is approved.
