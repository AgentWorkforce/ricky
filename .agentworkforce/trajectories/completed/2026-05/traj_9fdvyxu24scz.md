# Trajectory: ricky-resolve-review-findings-workflow

> **Status:** ✅ Completed
> **Task:** f813f1fdf78648bd635e8689
> **Confidence:** 93%
> **Started:** May 1, 2026 at 07:23 PM
> **Completed:** May 3, 2026 at 08:10 PM

---

## Summary

Patched Ricky CLI so ricky run <workflow> --mode cloud builds a Cloud request with Ricky supervision metadata and auto-fix policy, including --no-auto-fix as supervision with repairs disabled. Opened PR #40.

**Approach:** Standard approach

---

## Key Decisions

### Add explicit guided local status line
- **Chose:** Add explicit guided local status line
- **Reasoning:** Generation failures were technically reported but visually buried under a neutral header; an overall Status line makes failed vs ready vs running clear before details.

### Added implementation semantic gates to Ricky generation
- **Chose:** Added implementation semantic gates to Ricky generation
- **Reasoning:** The failure mode was a persona-authored artifact that passed structural checks while reducing an implementation spec to planning files. The new validator uses the normalized spec to require an implementation contract, source-change language, non-empty diff evidence, and PR/result reporting, and rejects planning-only signals.

### Addressed PR 35 implementation validation comments
- **Chose:** Addressed PR 35 implementation validation comments
- **Reasoning:** Codex review correctly identified that PR-specific evidence was too narrow and that 'write a plan' should not exempt mixed plan-then-implement specs. The patch accepts explicit result status/location evidence and only treats planning as non-implementation when it is explicitly planning-only without implementation targets or signals.

### Write Ricky cloud/autofix and Slack agent plans as additive specs in cloud/specs
- **Chose:** Write Ricky cloud/autofix and Slack agent plans as additive specs in cloud/specs
- **Reasoning:** The cloud repo already owns workflow runs, credentials, Slack proxying, and deployment surfaces; docs-only specs avoid disturbing the active dirty worktree while giving implementers concrete contracts.

### Require choosing-swarm-patterns during Ricky workflow generation
- **Chose:** Require choosing-swarm-patterns during Ricky workflow generation
- **Reasoning:** Workflow authoring now needs explicit pattern-selection guidance alongside authoring and 80-to-100 validation skills so generated workflows choose the right coordination shape.

### Created clean cloud worktree for Ricky cloud auto-fix specs
- **Chose:** Created clean cloud worktree for Ricky cloud auto-fix specs
- **Reasoning:** User requested a new worktree to carry the specs; branch codex/ricky-cloud-autofix-spec isolates follow-on implementation from the busy main cloud checkout.

### Fix Ricky sanity gate validation in a new worktree
- **Chose:** Fix Ricky sanity gate validation in a new worktree
- **Reasoning:** User requested an isolated worktree and PR; validation should accept deterministic sanity gates beyond literal grep while preserving the quality guard.

### Bundle Ricky generation skills with npm package and feed them into shape selection
- **Chose:** Bundle Ricky generation skills with npm package and feed them into shape selection
- **Reasoning:** Global installs run from arbitrary project roots, so Ricky must publish .agents/skills and discover package-relative skills; pattern selection must receive loaded skill context before selecting a workflow shape.

### Opened Ricky sanity gate resilience PR
- **Chose:** Opened Ricky sanity gate resilience PR
- **Reasoning:** PR #37 contains the validator and regression tests on a branch rebased onto main; full suite exposed a local timing flake unrelated to the generation validator, and targeted tests/typecheck passed.

### Preserve explicit maxMatches ranking while keeping Ricky workflow defaults
- **Chose:** Preserve explicit maxMatches ranking while keeping Ricky workflow defaults
- **Reasoning:** PR feedback showed explicit maxMatches callers expect top-ranked matches, so fallback workflow defaults should only be force-preserved on the normal uncapped generation path.

### Expanded PR 37 to cover generation guidance as well as validation
- **Chose:** Expanded PR 37 to cover generation guidance as well as validation
- **Reasoning:** PR 36 improves skill loading and generation context, but PR 37 now explicitly aligns rendered workflow prompts and Workforce persona prompts with the resilient sanity-gate validator.

### Patch generated workflow diff manifest to include untracked files
- **Chose:** Patch generated workflow diff manifest to include untracked files
- **Reasoning:** The failed gate uses git diff --name-only, which omits newly-created Ricky API/lib/test files; combining tracked diff and git ls-files --others makes the manifest reflect implementation output.

### Add deterministic repair for bare git diff workflow gates
- **Chose:** Add deterministic repair for bare git diff workflow gates
- **Reasoning:** Generated/custom Agent Relay workflows can hand-author implementation manifest gates with only git diff --name-only. On local runs, new files are untracked until commit, so Ricky needs to rewrite those gates to include git ls-files --others before retrying.

### Address PR 39 review comments
- **Chose:** Address PR 39 review comments
- **Reasoning:** Review feedback needs to be applied on the PR branch with focused tests before updating the pull request.

### Use temp file for repaired redirected diff gates
- **Chose:** Use temp file for repaired redirected diff gates
- **Reasoning:** Redirecting directly into the manifest can create an untracked file before git ls-files runs. Writing to mktemp outside the repo and moving it afterward preserves empty-diff failure semantics.

### Opened cloud PR #411 from codex/ricky-cloud-autofix-spec
- **Chose:** Opened cloud PR #411 from codex/ricky-cloud-autofix-spec
- **Reasoning:** Workflow final signoff was approved; branch was rebased onto origin/main and migration regenerated as 0024 before push

### Patch workflow metadata validation for backwards compatibility
- **Chose:** Patch workflow metadata validation for backwards compatibility
- **Reasoning:** Normal workflow execution should not reject legacy callers that include non-Ricky metadata fields; only valid env-style string metadata should be forwarded

### Addressed PR #411 review findings
- **Chose:** Addressed PR #411 review findings
- **Reasoning:** Added strict Ricky create validation, blocked stale gate resolutions, and retried Ricky event append sequence conflicts with regression tests

### Cloud-mode artifact runs should build Ricky-supervised Cloud requests
- **Chose:** Cloud-mode artifact runs should build Ricky-supervised Cloud requests
- **Reasoning:** ricky run <workflow> --mode cloud was being rejected as a local handoff before Cloud request construction; routing it through Cloud with an explicit autoFix policy lets the Cloud executor choose /api/v1/ricky/runs while preserving --no-auto-fix as repairs disabled.

---

## Chapters

### 1. Planning
*Agent: orchestrator*

### 2. Execution: review-fix-loop
*Agent: fixer*

- Add explicit guided local status line: Add explicit guided local status line
- Updated PR #34 to make guided local workflow summaries state overall status before generation details; focused CLI tests and typecheck pass.
- Changed foreground repair copy to generic Ricky-owned fixing language and raised default auto-fix attempts to 7 across CLI parsers and monitor handoffs; full npm test is passing.
- Foreground runtime output now streams SDK workflow stdout/stderr through the CLI after clearing the spinner, so attached runs show workflow logs as they happen; full npm test passes.
- User wants Ricky to generate comprehensive implementation workflows, not planning-only artifacts. Plan should add intent classification, implementation-oriented workflow generation, hard semantic gates, visible result locations, and regenerate webapp-review as an implementation DAG with deterministic verification.
- Added implementation semantic gates to Ricky generation: Added implementation semantic gates to Ricky generation
- Addressed PR 35 implementation validation comments: Addressed PR 35 implementation validation comments
- Write Ricky cloud/autofix and Slack agent plans as additive specs in cloud/specs: Write Ricky cloud/autofix and Slack agent plans as additive specs in cloud/specs
- Added additive cloud specs for Ricky v1 auto-fix supervisor and v2 Slack agent; no code paths touched, leaving active cloud worktree changes alone.
- Require choosing-swarm-patterns during Ricky workflow generation: Require choosing-swarm-patterns during Ricky workflow generation
- Created clean cloud worktree for Ricky cloud auto-fix specs: Created clean cloud worktree for Ricky cloud auto-fix specs
- Added choosing-swarm-patterns as required workflow-generation context with tests, typecheck, full suite, commit, push, and PR complete
- Fix Ricky sanity gate validation in a new worktree: Fix Ricky sanity gate validation in a new worktree
- Ricky sanity gate validator now checks deterministic gate commands and accepts rg/equivalent assertions; full test suite passed.
- Bundle Ricky generation skills with npm package and feed them into shape selection: Bundle Ricky generation skills with npm package and feed them into shape selection
- Addressed self-review findings by feeding skill context into pattern selection, adding persona prompt skill context, publishing .agents/skills, and proving pack/test coverage
- Opened Ricky sanity gate resilience PR: Opened Ricky sanity gate resilience PR
- Preserve explicit maxMatches ranking while keeping Ricky workflow defaults: Preserve explicit maxMatches ranking while keeping Ricky workflow defaults
- Expanded PR 37 to cover generation guidance as well as validation: Expanded PR 37 to cover generation guidance as well as validation
- Patch generated workflow diff manifest to include untracked files: Patch generated workflow diff manifest to include untracked files
- Add deterministic repair for bare git diff workflow gates: Add deterministic repair for bare git diff workflow gates
- Patched the failing cloud workflow locally and opened a Ricky follow-up PR so future local auto-fix retries repair bare git diff manifest gates automatically.
- Address PR 39 review comments: Address PR 39 review comments
- Use temp file for repaired redirected diff gates: Use temp file for repaired redirected diff gates
- Workflow completed with approved final signoff; preparing manifest-listed changes from cloud-ricky-autofix-spec for PR
- Opened cloud PR #411 from codex/ricky-cloud-autofix-spec: Opened cloud PR #411 from codex/ricky-cloud-autofix-spec
- Checking backwards compatibility risk for Ricky PR against normal workflow execution path
- Patch workflow metadata validation for backwards compatibility: Patch workflow metadata validation for backwards compatibility
- Patched PR #411 metadata compatibility and force-pushed amended commit
- Starting PR #411 feedback pass
- Addressed PR #411 review findings: Addressed PR #411 review findings
- Need cloud-mode ricky run workflow to opt into Ricky endpoint automatically
- Cloud-mode artifact runs should build Ricky-supervised Cloud requests: Cloud-mode artifact runs should build Ricky-supervised Cloud requests
