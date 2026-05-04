# Ricky Agent-Assistant Live Proof Verdict

GitHub issue #13 verdict: the agent-assistant adoption is real in Ricky's local product path, but the adopted boundary should stay narrow.

## What was adopted

Ricky adopted `@agent-assistant/turn-context` as a bounded request/turn envelope primitive in the local runtime path. The adapter maps Ricky's normalized `LocalInvocationRequest` into a shared turn context and preserves request id, source metadata, structured spec data, invocation root, execution mode, stage mode, spec path, request metadata, and spec text as metadata/enrichment context.

The local executor now records the assembled context as compact provenance through `generation.decisions.assistant_turn_context` and local coordinator run metadata. The adoption still does not move Ricky's local request normalization, workflow artifact contract, runtime precheck behavior, blocker taxonomy, recovery wording, or coordinator execution semantics into `agent-assistant`.

## Product path exercised

The adapter smoke artifact exercised assistant `ricky` and turn `req-wave10-live-proof`. It confirmed adapter `ricky-local-turn-context-adapter`, package `@agent-assistant/turn-context`, version `1`, with CLI-sourced Ricky metadata and `stageMode: run`.

The live product path generated `workflows/generated/ricky-generate-a-workflow-for-package-checks-with-type.ts` with workflow id `ricky-generate-a-workflow-for-package-checks-with-type` and spec digest `841a2ef99ffb18fd74b8300e3c10fb3c5e876218087582f457f6eae46d415dbd`. The generated response exposed the user-facing run command:

```text
npx --no-install agent-relay run workflows/generated/ricky-generate-a-workflow-for-package-checks-with-type.ts
```

## Deterministic test proof

The issue #11 implementation signoff records the deterministic validation suite:

```text
npm run typecheck
npx tsc --noEmit
npm test
```

The adoption proof confirms the local executor calls the adapter before product intake, workflow generation, artifact selection, runtime prechecks, or coordinator launch. That makes the shared package part of the runtime path rather than copied types or documentation-only alignment.

## Live/user-facing validation proof

The live generate artifact returned status `ok`, produced the generated workflow artifact, and returned the expected next action plus Ricky run-mode hint. This proves the adopted adapter is present in the live user-facing generation path.

The live generate-and-run artifact reached the execution stage and stopped at Ricky's local runtime precheck with blocker code `MISSING_BINARY`, category `dependency`, and message `Runtime package "agent-relay" is not installed in this workspace.` The process exit artifact recorded exit code `2`.

The blocker evidence identified failed step `runtime-precheck`, zero workflow steps completed, no files written during failed execution, and the invoked command as the generated `agent-relay run` command. Recovery guidance was actionable: run `npm install`, verify the local `agent-relay` binary, then rerun the generated workflow command.

## Regression or product cost observed

No regression in Ricky's product boundary was observed. The live failure occurred after generation, inside Ricky-owned runtime dependency prechecks, not inside the adopted turn-context adapter.

The product cost is explicit: full live run validation still depends on the workspace containing the local `agent-relay` runtime binary. When that dependency is absent, Ricky correctly reports a dependency blocker instead of claiming execution success.

## Verdict: keep adopting, hold boundary, or redesign

Verdict: keep adopting, hold boundary.

The adoption should remain because it proves real shared reuse in the local product path while preserving Ricky-owned workflow generation, staged run UX, runtime prechecks, blocker classification, recovery guidance, and response semantics. Future adoption should stay limited to similarly neutral runtime primitives unless a later proof shows product-owned Ricky behavior can move without weakening the local execution contract.

RICKY_AGENT_ASSISTANT_LIVE_PROOF_COMPLETE
