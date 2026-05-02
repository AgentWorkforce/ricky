# Ricky Agent-Assistant Adoption Proof

## Summary

Issue #11 is implemented as a bounded request/turn envelope alignment slice. Ricky Local now imports the real `@agent-assistant/turn-context` package and assembles a shared turn context from the existing `LocalInvocationRequest` before continuing through Ricky's local generation and execution path.

This is real shared reuse, but it is intentionally narrow. The adapter proves that Ricky can adopt an agent-assistant runtime primitive without moving Ricky's workflow product contract into a shared package.

## Real shared reuse

Ricky now depends on `@agent-assistant/turn-context` in the root `package.json`, with the resolved package captured in `package-lock.json`.

The shared runtime package is used by `src/local/assistant-turn-context-adapter.ts`. The adapter maps Ricky's normalized local request into a `TurnContextInput` through `toRickyTurnContextInput()`, then assembles it through `createTurnContextAssembler()` in `assembleRickyTurnContext()`.

The real local executor path calls `assembleRickyTurnContext(request)` before product intake, workflow generation, artifact selection, runtime prechecks, or coordinator launch. That means the adoption is runtime behavior, not copied local types or documentation-only alignment.

The shared turn context preserves the local request envelope data that issues #9, #10, and #12 identified as the safest first reuse boundary:

- request id
- source
- source metadata
- structured spec
- invocation root
- execution mode
- stage mode
- spec path
- request metadata
- spec text

Those fields are carried in the shared turn context metadata and bounded enrichment blocks. Ricky now also surfaces a compact `generation.decisions.assistant_turn_context` summary with the assistant id, turn id, adapter package, context block ids, and enrichment ids. The full turn context remains internal to the adapter boundary; Ricky's product response still owns the workflow-specific semantics.

## Still Ricky-owned

Ricky still owns the public `LocalResponse` shape, including artifacts, logs, warnings, next actions, generation stage, execution stage, and exit code semantics.

Ricky uses the shared turn context as provenance instead of as a product decision engine. The local executor records a compact summary in generation decisions and carries the same summary into local coordinator run metadata, so generated artifacts and local runs can be traced back to the Agent Assistant turn envelope without moving generation, execution, blockers, or evidence into `agent-assistant`.

Ricky still owns local request normalization. Raw CLI, MCP, Claude, structured, free-form, and workflow-artifact handoffs continue through `normalizeRequest()` before the shared turn context adapter runs.

Ricky still owns spec intake, workflow generation, workflow artifact writing, workflow artifact selection, runtime launch prechecks, coordinator launch, blocker classification, recovery wording, execution evidence, and local/cloud rejection behavior.

Ricky does not move the full local execution contract, blocker taxonomy, staged generate/run UX, policy, memory, proactive behavior, sessions, or local CLI/runtime contract into `agent-assistant`.

## Boundary verdict

The adopted slice matches the decision source from issues #9, #10, and #12: use one real shared assistant-runtime primitive for the neutral request/turn envelope, but do not broaden into sessions, memory, policy, proactive behavior, or full local execution extraction.

The result is a measurable compatibility adapter. Ricky can now prove a real `agent-assistant` dependency in the local product path while preserving the workflow-reliability behavior that remains product-specific.
