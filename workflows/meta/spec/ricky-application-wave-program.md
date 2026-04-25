# Ricky Application Wave Program

This document defines the first large-scale wave program that Ricky should eventually generate as workflows.

## Program goal

Generate a large, reliable workflow execution layer capable of building Ricky the product through staged, reviewable waves.

## Wave model

### Wave 0: Foundation
Purpose:
- repo standards
- shared models/config
- workflow scaffolding
- source-of-truth docs
- bootstrap/runtime assumptions

Example workflow themes:
- repo standards and convention files
- workflow shared rules
- first package/layout scaffold
- initial architecture docs

### Wave 1: Runtime
Purpose:
- local workflow coordination runtime
- evidence capture seams
- workflow run state modeling
- orchestration substrate

Example workflow themes:
- local run coordinator
- workflow evidence model
- workflow failure classification model
- workflow state and receipt contracts

### Wave 2: Product Core
Purpose:
- workflow authoring agent logic
- workflow debugger/repair logic
- workflow coordination logic
- specialist seams

Example workflow themes:
- workflow-spec intake
- workflow generation pipeline
- workflow debugging specialist
- rerun/restart decision policy

### Wave 3: Cloud API
Purpose:
- hosted workflow generation endpoint
- generate-and-run endpoint
- artifact return/download flow
- auth/workspace boundary

Example workflow themes:
- request schema and auth
- generate endpoint
- generate-and-run endpoint
- artifact storage/return policy

### Wave 4: Local / BYOH
Purpose:
- local repo awareness
- local `agent-relay` integration
- local artifact/log return
- local environment policy

Example workflow themes:
- local invocation entrypoint
- local runner adapter
- local tool and skill injection
- local workflow debugging loop

### Wave 5: Scale and Ops
Purpose:
- proactive failure analysis
- reliability analytics
- mass workflow generation and maintenance
- workflow quality tuning

Example workflow themes:
- failure digest generation
- workflow health analytics
- proactive degraded-run alerts
- meta-regeneration and workflow audit

## Batch generation rule

The first Ricky meta-workflow should not try to generate every future workflow forever.
It should generate a strong first batch of bounded workflows across these waves, enough to form the application execution layer without producing unreviewable sprawl.

## Size guidance

A good first generated batch is likely around:
- 3 to 5 workflows in Wave 0
- 4 to 6 workflows in Wave 1
- 5 to 8 workflows in Wave 2
- 4 to 6 workflows in Wave 3
- 3 to 5 workflows in Wave 4
- 3 to 5 workflows in Wave 5

That gives a first reliable wave backlog in roughly the 22 to 35 workflow range.

## Rule

The meta-workflow should prefer quality and boundedness over sheer count.
