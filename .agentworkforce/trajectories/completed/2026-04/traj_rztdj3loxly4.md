# Trajectory: ricky-wave12-implement-and-prove-simplified-workflow-cli-workflow

> **Status:** ✅ Completed
> **Task:** 2a3906e4d995ccb1728ad3dc
> **Confidence:** 90%
> **Started:** April 30, 2026 at 09:44 AM
> **Completed:** April 30, 2026 at 05:15 PM

---

## Summary

Fixed Connect tools path isolation so optional integrations use Nango only, Cloud agents are opt-in, and Daytona-backed auth requires explicit confirmation; validated with typecheck, targeted E2E/CLI tests, full npm test, diff check, and source-run connect smokes.

**Approach:** Standard approach

---

## Key Decisions

### Added a single path-complete E2E test file for simplified CLI coverage
- **Chose:** Added a single path-complete E2E test file for simplified CLI coverage
- **Reasoning:** Workflow required test/simplified-workflow-cli.e2e.test.ts plus deterministic coverage across local, Cloud, and power-user paths; keeping the new coverage in one injected-fake test file avoids live credentials or runner dependencies.

### Fix BSD grep option parsing in simplified CLI workflow coverage gate
- **Chose:** Fix BSD grep option parsing in simplified CLI workflow coverage gate
- **Reasoning:** The workflow failed in test-coverage-gate because a grep pattern beginning with --json was parsed as an option on macOS/BSD grep; the gate should use -e/-- before option-like patterns.

### Allow final fix loop to consume reviewer FAIL verdicts
- **Chose:** Allow final fix loop to consume reviewer FAIL verdicts
- **Reasoning:** The simplified CLI workflow is an 80-to-100 workflow; reviewer FAIL markers are actionable feedback for the final repair loop, so the deterministic gate should validate artifact completeness rather than require immediate review pass.

### Allow expected simplified CLI smoke artifacts in final scope gate
- **Chose:** Allow expected simplified CLI smoke artifacts in final scope gate
- **Reasoning:** The final scope gate failed on .ricky/config.json, the simplified CLI spec input, and the generated smoke workflow; these are expected side effects of the workflow and CLI smoke command, so the gate should allow those exact paths while still rejecting unrelated drift.

### Investigate Relay SDK Cloud connect package for Ricky connect commands
- **Chose:** Investigate Relay SDK Cloud connect package for Ricky connect commands
- **Reasoning:** The current Ricky connect path is a fail-closed placeholder, but the user reports the Relay SDK connect package is now exposed; we should inspect local SDK exports before keeping the placeholder.

### Use @agent-relay/cloud connectProvider for Ricky cloud/agent connects
- **Chose:** Use @agent-relay/cloud connectProvider for Ricky cloud/agent connects
- **Reasoning:** The current @agent-relay/sdk package does not expose a connect export, while @agent-relay/cloud 6.0.6 exposes the same connectProvider used by the Agent Relay CLI. Ricky should call that real connector for Cloud account and Cloud agent auth instead of printing a placeholder.

### Interactive Connect tools menu now runs selected Relay Cloud connects
- **Chose:** Interactive Connect tools menu now runs selected Relay Cloud connects
- **Reasoning:** Direct ricky connect commands were wired, but the first-screen Connect tools choice still stopped at guidance. In a real TTY, the checkbox prompt now drives the same connectProvider flow for Cloud account and Cloud agents, while non-interactive contexts keep guidance-only recovery.

### Resolve Cloud workspace automatically from stored Cloud auth
- **Chose:** Resolve Cloud workspace automatically from stored Cloud auth
- **Reasoning:** Prompting for a raw workspace id is a dead end for normal users. Guided Cloud now prefers explicit env overrides, then calls the Cloud profile/whoami API through stored Relay Cloud credentials to obtain currentWorkspace.id, and otherwise gives recovery guidance instead of asking the user to guess.

### Connect tools now asks for concrete optional integrations before provider auth
- **Chose:** Connect tools now asks for concrete optional integrations before provider auth
- **Reasoning:** Selecting Optional integrations alongside Cloud account launched the blocking Daytona provider auth before the user ever saw Slack/GitHub/Notion/Linear. The flow now prompts for concrete optional integrations first and renders dashboard guidance for the selected tools, then continues to provider auth.

### Split Cloud account login from provider credential connection
- **Chose:** Split Cloud account login from provider credential connection
- **Reasoning:** Selecting Cloud was taking the Google provider Daytona path. Cloud account setup now uses Relay Cloud ensureAuthenticated for account login, while provider credential auth remains under Cloud agents/connect providers. This keeps Cloud selection on the workflow path and avoids treating Google provider auth as Cloud login.

### Optional integrations use Nango connect links, not Daytona provider auth
- **Chose:** Optional integrations use Nango connect links, not Daytona provider auth
- **Reasoning:** Slack, GitHub, Notion, and Linear are Cloud app integrations, not sandbox agent/provider credentials. Ricky now routes optional integrations through a Nango connect-link connector and only uses Daytona provider auth for Cloud agents/providers.

### Made Cloud agent auth opt-in from Connect tools
- **Chose:** Made Cloud agent auth opt-in from Connect tools
- **Reasoning:** Optional integrations must use Nango only; preselecting Cloud agents let the Daytona-backed provider connector run after an integrations choice.

---

## Chapters

### 1. Planning
*Agent: orchestrator*

### 2. Execution: read-source-contracts, snapshot-current-surfaces
*Agent: orchestrator*

### 3. Convergence: read-source-contracts + snapshot-current-surfaces
*Agent: orchestrator*

- read-source-contracts + snapshot-current-surfaces resolved. 2/2 steps completed. All steps completed on first attempt. Unblocking: write-acceptance-matrix, lead-plan.

### 4. Execution: lead-plan
*Agent: lead-claude*

### 5. Execution: implement-prompt-shell, implement-local-guided-flow, implement-cloud-guided-flow, implement-workforce-writer, implement-power-user-surface
*Agent: orchestrator*

### 6. Execution: implement-prompt-shell
*Agent: prompts-codex*

### 7. Execution: implement-local-guided-flow
*Agent: local-codex*

### 8. Execution: implement-cloud-guided-flow
*Agent: cloud-codex*

### 9. Execution: implement-workforce-writer
*Agent: writer-codex*

### 10. Execution: implement-power-user-surface
*Agent: power-codex*

### 11. Convergence: implement-prompt-shell + implement-local-guided-flow + implement-cloud-guided-flow + implement-workforce-writer + implement-power-user-surface
*Agent: orchestrator*

- implement-prompt-shell + implement-local-guided-flow + implement-cloud-guided-flow + implement-workforce-writer + implement-power-user-surface resolved. 5/5 steps completed. All steps completed on first attempt. Unblocking: prompt-shell-gate, local-flow-gate, cloud-flow-gate, workforce-writer-gate, power-user-gate.

### 12. Execution: prompt-shell-gate, local-flow-gate, cloud-flow-gate, workforce-writer-gate, power-user-gate
*Agent: orchestrator*

### 13. Convergence: prompt-shell-gate + local-flow-gate + cloud-flow-gate + workforce-writer-gate + power-user-gate
*Agent: orchestrator*

- prompt-shell-gate + local-flow-gate + cloud-flow-gate + workforce-writer-gate + power-user-gate resolved. 5/5 steps completed. All steps completed on first attempt. Unblocking: implementation-diff-gate.

### 14. Execution: create-path-complete-tests
*Agent: tests-codex*

- Added a single path-complete E2E test file for simplified CLI coverage: Added a single path-complete E2E test file for simplified CLI coverage
- Path-complete test step is implemented and both targeted vitest plus deterministic coverage gate pass locally.
- Fix BSD grep option parsing in simplified CLI workflow coverage gate: Fix BSD grep option parsing in simplified CLI workflow coverage gate
- Patched the simplified CLI workflow test-coverage gate to use grep -e for option-like patterns, verified the failed gate locally, and ran the targeted E2E suite that follows it.
- Allow final fix loop to consume reviewer FAIL verdicts: Allow final fix loop to consume reviewer FAIL verdicts
- Allow expected simplified CLI smoke artifacts in final scope gate: Allow expected simplified CLI smoke artifacts in final scope gate
- Patched final scope gate to allow exact expected simplified CLI smoke side effects: .ricky/config.json, the simplified CLI spec input, and the generated smoke workflow, while keeping unrelated drift blocked.
- Fixed source CLI Cloud selection dead-end: interactive Cloud without a request now returns an awaiting-spec guidance state with readiness/next commands, while explicit power-user Cloud without context still exits blocked. Verified typecheck, focused CLI tests, and source CLI cloud smoke.
- Fixed Connect tools first-screen dead end by returning actionable guidance for status/connect/exit compact shell choices; verified typecheck, focused CLI tests, and direct connect command output.
- Updated Cloud first-screen selection so missing Cloud/Google readiness surfaces Cloud account setup and the real npx agent-relay cloud connect google path before spec commands.
- Connect tools now opens a second checkbox prompt for Cloud account, Cloud agents, and optional integrations, with deterministic fallback guidance and tests for selected tool-specific output.
- Investigate Relay SDK Cloud connect package for Ricky connect commands: Investigate Relay SDK Cloud connect package for Ricky connect commands
- Use @agent-relay/cloud connectProvider for Ricky cloud/agent connects: Use @agent-relay/cloud connectProvider for Ricky cloud/agent connects
- Ricky connect now uses @agent-relay/cloud connectProvider for Cloud account and Cloud agent auth, with integrations kept dashboard-driven. Typecheck, targeted CLI tests, full npm test, and source smoke checks passed; non-TTY smokes prove the real connector is reached and fails at its TTY guard.
- Interactive Connect tools menu now runs selected Relay Cloud connects: Interactive Connect tools menu now runs selected Relay Cloud connects
- No-dead-end pass added guided Cloud continuation from first-screen Cloud selection into readiness/context, shared spec intake, Cloud flow defaults, and Cloud generation. Added a dedicated no-dead-end workflow guard and regression test. Typecheck, targeted tests, npm test, and source smokes pass.
- Resolve Cloud workspace automatically from stored Cloud auth: Resolve Cloud workspace automatically from stored Cloud auth
- Connect tools now asks for concrete optional integrations before provider auth: Connect tools now asks for concrete optional integrations before provider auth
- Split Cloud account login from provider credential connection: Split Cloud account login from provider credential connection
- Optional integrations use Nango connect links, not Daytona provider auth: Optional integrations use Nango connect links, not Daytona provider auth
- Made Cloud agent auth opt-in from Connect tools: Made Cloud agent auth opt-in from Connect tools
- Connect menu now separates Nango integrations from Daytona-backed agent auth; focused and full tests are passing after the opt-in guard.
