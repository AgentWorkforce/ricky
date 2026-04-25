# Ricky Generated Workflow Template

This document defines the default shape that Ricky-generated implementation workflows should follow.

## Goal

Generated workflows should be:
- narrow enough to execute reliably
- explicit enough to review quickly
- deterministic enough to validate without guesswork
- strong enough to contribute to a larger wave program

## Default team shapes

### Lightweight doc/spec workflow
- `lead-claude`
- `author-codex` or `author-claude`
- `reviewer-claude` or `reviewer-codex`

### Implementation workflow
- `lead-claude`
- `impl-primary-codex`
- `impl-tests-codex`
- `reviewer-claude`
- `reviewer-codex`
- `validator-claude`

## Required shape

Each generated workflow should include:
1. explicit description
2. explicit pattern
3. explicit channel
4. explicit concurrency
5. explicit timeout
6. deterministic context/spec reads
7. implementation or authoring phase
8. deterministic file/materialization gate
9. review phase
10. fix phase when review/test feedback exists
11. final hard verification gate
12. explicit run cwd

## Required content expectations inside tasks

Each implementation-oriented generated workflow should make these explicit:
- context inputs
- deliverables
- file targets
- non-goals
- verification commands
- review checklist
- commit/PR boundary

## Default reliability ladder

For generated implementation workflows:
1. context/spec read
2. lead plan
3. implementation
4. file verification
5. review
6. fix loop
7. tests/build/dry-run validation
8. final signoff

## Generated workflow constraints

- no `general` channel
- no blind swarm defaulting
- no missing deterministic gates after agent edits
- no missing review stage
- no broad single-step ownership of many files unless the workflow is explicitly doc-only and bounded
- no final “done” without a deterministic gate
