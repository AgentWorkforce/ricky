# Ricky Linear Surface

This directory contains Ricky OSS artifacts for the Linear Actor integration. Cloud owns webhook ingress, OAuth installation, database-backed deduplication, workflow execution, and AgentActivity egress. Ricky owns the shared contracts and deterministic workflow construction logic Cloud imports.

## Public Entry Points

Cloud should import from `src/surfaces/linear/index.ts` for the orchestration helper, event contracts, workflow builder, status helper, and connect guidance. Cloud should import HTTP/session wire types from `src/cloud/api/linear-agent-types.ts`. It should not deep-import implementation files from this directory.

## Contract

`handleLinearMention(input, deps)` verifies signatures through an injected verifier, checks deduplication, classifies the Linear AgentSessionEvent, checks GitHub readiness before connected-agent readiness, builds a Ricky workflow, invokes an injected Cloud runner, mirrors lifecycle updates as `AgentActivity`, and ends the session with `completed`, `completed_no_changes`, or `failed`.

`buildLinearWorkflow(input)` turns issue context, repo target, connected agents, and actor identity into a Cloud-executable Ricky workflow artifact. Pattern selection uses the existing product pattern selector, with the connected-agent count deciding whether the Linear run is `pipeline`, `supervisor`, or `dag`.

## CLI Helpers

`ricky status linear` renders Linear readiness in the required order: GitHub App, connected agents, then Linear Actor app. `ricky connect linear` prints Cloud dashboard guidance for installing the Linear OAuth Actor app.

## Skill Boundary

Skills apply while Ricky generates workflows. Runtime agents receive rendered workflow instructions and do not load or embody skill files.
