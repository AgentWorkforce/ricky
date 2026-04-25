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
11. post-fix validation phase
12. final review phase over the fixed state
13. final review-pass gate
14. final hard verification gate
15. explicit run cwd

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
6. read review feedback
7. fix loop
8. post-fix validation
9. final re-review on the fixed state
10. final review-pass gate
11. final hard validation
12. regression/build gate
13. final signoff

## Generated workflow constraints

- no `general` channel
- no blind swarm defaulting
- no missing deterministic gates after agent edits
- no missing review stage
- no fix loop that depends on a pass-only review gate
- no final signoff that depends on stale pre-fix review artifacts
- no broad single-step ownership of many files unless the workflow is explicitly doc-only and bounded
- no broad regression allowlists unless the workflow declares an explicit dependency-change manifest and validates against it
- no final “done” without a deterministic gate
