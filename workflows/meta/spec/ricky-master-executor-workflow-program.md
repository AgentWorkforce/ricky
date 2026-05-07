# Ricky Master Executor Workflow Program

## Objective

Ricky should move from large monolithic implementation workflows toward a master executor model that decomposes a user or product spec into smaller, bounded 80-to-100 workflows, runs independent work in parallel, and advances only through explicit evidence and merge gates.

The goal is not just to generate more workflow files. The goal is for Ricky to decide how to divide a spec into reliable execution slices, produce or select the right child workflows, run them in dependency order, inspect their evidence, and either advance, repair, split, block, or ask for human input.

## Product Need

The current workflow style can complete useful work, but large workflows become hard to resume, hard to review, and sensitive to agent drift. The successful pattern from adjacent AgentWorkforce projects is a smaller workflow model: each child workflow owns a narrow deliverable and proves it with deterministic validation, while a master executor owns ordering, parallelism, status, and final integration.

Ricky should make that pattern first-class. Given a spec such as "implement nested runner, runtime policy, telemetry, evals, and insights", Ricky should produce an execution plan that identifies independent child workflows, dependency barriers, merge or PR gates, validation requirements, and final signoff criteria.

## Source Of Truth

When implementing this program, use this order:

1. `docs/workflows/WORKFLOW_STANDARDS.md`
2. `AGENTS.md`
3. This spec
4. `workflows/shared/WORKFLOW_AUTHORING_RULES.md`
5. `.agents/skills/writing-agent-relay-workflows/SKILL.md`
6. `.agents/skills/relay-80-100-workflow/SKILL.md`
7. Local code reality

## Target Architecture

The master executor has four layers.

### Spec Decomposition

The planner accepts a normalized spec and produces an execution plan. The plan includes child workflow candidates, file scopes, dependency edges, parallelization groups, validation requirements, merge gates, and known non-goals.

Child workflows should be created around bounded deliverables, not agent count. A good child workflow owns one slice such as runtime policy, telemetry ingestion, eval fixtures, insight summarization, CLI proof, or a narrow integration path. A poor child workflow owns an entire product milestone with ambiguous file ownership.

### Child Workflow Contract

Each child workflow must declare:

- stable id and human-readable title
- target workflow file path
- target files and allowed dirty scope
- dependency ids
- whether it can run in parallel with siblings
- validation commands
- required signoff artifact and marker
- optional PR or merge gate
- retry policy
- timeout
- escalation rules

### Execution Coordinator

The master executor runs child workflows by dependency wave. It may run independent children concurrently up to a configured limit. A child is considered complete only when its run exits successfully and its evidence gate passes.

Evidence gates should verify concrete artifacts: signoff files, marker strings, changed file scopes, test output, dry-run output, PR state, or merge state. The master executor must not advance based only on agent text.

### Failure And Replanning

When a child fails, the master executor should classify the outcome into one of these decisions:

- retry the child as-is
- repair the child workflow and retry
- split the child into smaller workflows
- block on missing environment or credentials
- escalate to the user with evidence

The master executor should preserve partial evidence and should not hide environmental blockers.

## First Implementation Slice

The first workflow should implement a deterministic, unit-tested local planning and execution model. It does not need to run live remote PRs or perform real GitHub merges.

### Required Files

The first implementation slice should create:

- `src/product/orchestration/types.ts`
- `src/product/orchestration/planner.ts`
- `src/product/orchestration/master-executor.ts`
- `src/product/orchestration/index.ts`
- `src/product/orchestration/master-executor.test.ts`

It may update:

- `src/product/index.ts`

### Required Types

The implementation should expose:

- `MasterExecutionPlan`
- `ChildWorkflowPlan`
- `ChildWorkflowGate`
- `ChildWorkflowRunResult`
- `MasterExecutionResult`
- `MasterExecutorOptions`
- `MasterExecutorDecision`

The types should be plain TypeScript interfaces and discriminated unions. They should not require a live Agent Relay runtime to test.

### Planner Requirements

The planner should:

- accept a spec title, description, optional desired slices, optional constraints, and optional target files
- produce stable child workflow ids and paths
- assign dependency waves
- mark independent slices as parallelizable
- attach default 80-to-100 gates to every child
- reject or mark ambiguous specs that cannot be decomposed safely

### Executor Requirements

The executor should:

- accept a `MasterExecutionPlan`
- accept an injected child runner function
- execute child workflows by dependency wave
- enforce `maxConcurrency`
- skip children whose signoff gate is already satisfied when resume mode is enabled
- stop or continue according to failure policy
- return structured evidence for every child
- classify next action as `complete`, `retry`, `repair`, `split`, `blocked`, or `escalate`

### Test Requirements

The implementation must include deterministic tests for:

- spec decomposition into multiple child workflows
- dependency wave ordering
- bounded concurrency
- signoff-gated resume skip
- failed child classification
- blocked child classification for missing environment
- final result only marked complete when all required gates pass

Tests must use injected fakes, not a live `agent-relay` invocation.

## Workflow Authoring Requirements

The implementation workflow must:

- live under `workflows/wave13-master-executor/`
- use a numeric prefix and a concrete slug
- use a dedicated `wf-ricky-*` channel
- read this spec and Ricky workflow standards deterministically
- include a review stage with artifacts under `.workflow-artifacts/`
- use the 80-to-100 soft-gate, fix, hard-gate loop
- include scoped change detection for the intended files
- keep commit and push outside the workflow unless a later spec explicitly owns those boundaries

## Acceptance Criteria

The first slice is complete when:

- all required source and test files exist
- product exports are available from `src/product/orchestration/index.ts`
- `npx vitest run src/product/orchestration/master-executor.test.ts` passes
- `npm run typecheck` passes
- a final signoff artifact exists under `.workflow-artifacts/wave13-master-executor/implement-master-executor/`
- the signoff artifact contains `RICKY_MASTER_EXECUTOR_IMPLEMENTED`

## Non-Goals

This first slice should not:

- create or merge GitHub PRs
- run hosted cloud workflows
- mutate existing unrelated generated workflows
- replace the local coordinator
- require live provider credentials
- implement a web UI

Those are later child workflows that the master executor model should eventually be able to plan and run.
