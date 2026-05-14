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
- one or more scoped implementers such as `impl-runtime-codex` or `impl-tests-codex`
- one shadow reviewer per active implementation scope, such as `shadow-runtime-claude`
- optional validation owner such as `validator-runtime-claude`
- `final-reviewer-claude`
- `final-reviewer-codex`
- fresh fix agents for final-review findings

## Required shape

Each generated workflow should include:
1. explicit description
2. explicit pattern
3. explicit channel
4. explicit concurrency
5. explicit timeout
6. deterministic context/spec reads
7. lead squad split with non-overlapping file targets for serious implementation work
8. implementation or authoring phase
9. live shadow feedback for serious implementation work
10. implementer self-reflection artifact
11. deterministic file/materialization gate
12. fresh independent review phase
13. fix phase when review/test feedback exists
14. post-fix validation phase
15. independent final Claude review and independent final Codex review over the fixed state
16. merged final review artifact comparing reviewer notes
17. fresh fix-agent phase for final-review findings when needed
18. post-fix self-reflection and re-review
19. final review-pass gate
20. final hard verification gate
21. explicit run cwd

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
3. squad split for serious implementation work
4. implementation with shadow feedback
5. implementer self-reflection artifact
6. file verification
7. fresh independent review
8. read review feedback
9. fix loop
10. post-fix validation
11. independent final Claude and Codex reviews on the fixed state
12. merged final review artifact
13. fresh fix-agent pass for final-review findings when needed
14. post-fix self-reflection and re-review
15. final review-pass gate
16. final hard validation
17. regression/build gate
18. final signoff

## Generated workflow constraints

- no `general` channel
- no blind swarm defaulting
- no missing deterministic gates after agent edits
- no missing review stage
- no serious implementation workflow that omits implementer self-reflection, shadow feedback, independent final Claude/Codex review, and post-fix re-review
- no fix loop that depends on a pass-only review gate
- no final signoff that depends on stale pre-fix review artifacts
- no broad single-step ownership of many files unless the workflow is explicitly doc-only and bounded
- no broad regression allowlists unless the workflow declares an explicit dependency-change manifest and validates against it
- no final “done” without a deterministic gate
