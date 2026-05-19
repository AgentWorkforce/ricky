# Ricky Agent-Assistant Live Proof Verdict

GitHub issue #13 verdict: Ricky's agent-assistant adoption is present in the live local product path. The captured proof supports continuing the adoption while holding the boundary to request/turn context reuse.

## What was adopted

Ricky adopted `@agent-assistant/turn-context` as a bounded request/turn envelope primitive. The adopted adapter is `ricky-local-turn-context-adapter`, recorded as package `@agent-assistant/turn-context` version `1`.

The adapter maps Ricky's normalized local request into shared turn context metadata and enrichment blocks. It carries the request id, source, source metadata, structured spec, invocation root, execution mode, stage mode, request metadata, and spec text as provenance. The captured adapter blocks were:

- `enrichment-ricky-request-summary`
- `enrichment-ricky-spec-text`
- `enrichment-ricky-structured-spec`
- `enrichment-ricky-source-metadata`
- `enrichment-ricky-request-metadata`

The adoption remains intentionally narrow. Ricky still owns request normalization, workflow generation, workflow artifacts, run-stage behavior, runtime prechecks, blocker classification, recovery wording, and local execution semantics.

## Product path exercised

The adapter runtime smoke artifact exercised assistant `ricky` with turn id `req-wave10-live-proof`. It confirmed CLI source metadata, `mode: local`, `stageMode: run`, invocation root `/Users/khaliqgant/Projects/AgentWorkforce/ricky`, and structured spec description `generate a workflow for package checks`.

The external product path then invoked Ricky from outside the implementation proof flow with:

```text
ricky --mode local --spec generate a workflow for package checks with typecheck and tests --no-workforce-persona
```

Ricky generated:

```text
workflows/generated/ricky-generate-a-workflow-for-package-checks-with-type.ts
```

The generate-and-run proof then executed the generated workflow through Ricky:

```text
ricky run workflows/generated/ricky-generate-a-workflow-for-package-checks-with-type.ts
```

## Deterministic test proof

The issue #11 implementation signoff records the deterministic validation commands used for the adopted adapter slice:

```text
npm run typecheck
npx tsc --noEmit
npx vitest run src/local
npx vitest run src/surfaces/cli
```

The adoption proof also confirms the shared adapter is called by the real local executor before product intake, workflow generation, artifact selection, runtime prechecks, or coordinator launch. That makes this a runtime-path adoption, not copied types or documentation-only alignment.

## Live/user-facing validation proof

The external generate artifact returned `status: ok`, wrote the generated workflow file, and printed the user-facing next commands for foreground and background execution.

The external generate-and-run artifact returned `status: success` for the execute stage. It recorded workflow name `wf-51009be3b0c7`, execution run `1393dd51eb0d6e11ea232bfc`, stdout and stderr log paths under Ricky local state, and `Auto-fix: repaired after 1/7 attempt(s)`.

The execute-stage assertion `external_cli_execution` passed with detail that the printed next command executed successfully in the external temp repo. The captured process exit artifact is `0`.

## Regression or product cost observed

No regression was observed in the captured proof artifacts. Generation succeeded, the generated workflow was executed, and the external run completed successfully after Ricky's auto-fix loop repaired the workflow once.

The product cost is that live execution may still require one repair pass even when the adoption boundary is correct. That cost belongs to Ricky's workflow generation and repair loop, not to the shared turn-context adapter.

## Verdict: keep adopting, hold boundary, or redesign

Verdict: keep adopting, hold boundary.

The proof supports continuing the adoption because a real `agent-assistant` runtime primitive is now exercised in Ricky's live local product path. The boundary should stay where it is: neutral request/turn context can be shared, while Ricky keeps ownership of workflow-specific product behavior, execution UX, evidence, recovery, and reliability semantics.

## Completion summary

Produced this concise evidence document at `docs/product/ricky-agent-assistant-live-proof.md` from the captured adapter smoke, external generate, external generate-and-run, exit-code, signoff, and adoption-proof artifacts.

RICKY_AGENT_ASSISTANT_LIVE_PROOF_COMPLETE
