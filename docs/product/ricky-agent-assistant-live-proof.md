# Ricky Agent-Assistant Live Proof Verdict

GitHub issue #13 verdict: Ricky's agent-assistant adoption is present in the live local product path. The evidence supports continued adoption while holding the boundary to neutral request/turn context reuse.

## What was adopted

Ricky adopted the real `@agent-assistant/turn-context` package through the `ricky-local-turn-context-adapter`.

The adapter runtime smoke artifact records assistant id `ricky`, turn id `req-wave10-live-proof`, adapter package `@agent-assistant/turn-context`, adapter version `1`, source `cli`, invocation root `/Users/khaliqgant/Projects/AgentWorkforce/ricky`, `mode: local`, and `stageMode: run`.

It also records the bounded enrichment blocks Ricky contributes to the shared turn context:

- `enrichment-ricky-request-summary`
- `enrichment-ricky-spec-text`
- `enrichment-ricky-structured-spec`
- `enrichment-ricky-source-metadata`
- `enrichment-ricky-request-metadata`

The adopted slice is the request/turn envelope. Ricky still owns request normalization, workflow generation, artifact selection, runtime prechecks, blocker classification, recovery wording, execution semantics, and the public local response contract.

## Product path exercised

The proof exercised Ricky from the user-facing local CLI path, not only from an isolated adapter check.

Generation invoked:

```text
ricky --mode local --spec generate a workflow for package checks with typecheck and tests --no-workforce-persona
```

That produced:

```text
workflows/generated/ricky-generate-a-workflow-for-package-checks-with-type.ts
```

The generated workflow was then executed through the printed foreground command:

```text
ricky run workflows/generated/ricky-generate-a-workflow-for-package-checks-with-type.ts
```

This covers the local generate-and-run product path with the adopted turn-context adapter present in Ricky's runtime.

## Deterministic test proof

The issue #11 implementation signoff records the adopted adapter slice passing:

```text
npm run typecheck
npx tsc --noEmit
npx vitest run src/local
npx vitest run src/surfaces/cli
npm test
```

The issue #13 artifacts add deterministic live-path evidence:

- `adapter-runtime-smoke.json` confirms the real adapter package, assistant id, turn id, CLI source, request metadata, and enrichment block ids.
- `external-generate.json` records generation `status: ok`, the generated workflow path, the CLI command invoked, and the run commands shown to the user.
- `external-generate-and-run.json` records generation `status: ok`, execution `status: success`, command `ricky run workflows/generated/ricky-generate-a-workflow-for-package-checks-with-type.ts`, and assertion `external_cli_execution: pass`.
- `external-generate-and-run.exit` is `0`.

The adoption proof document confirms the shared adapter is called by the real local executor before product intake, workflow generation, artifact selection, runtime prechecks, or coordinator launch. This is runtime-path adoption, not copied types or documentation-only alignment.

## Live/user-facing validation proof

The external generate artifact printed user-facing next commands:

```text
Run: ricky run workflows/generated/ricky-generate-a-workflow-for-package-checks-with-type.ts
Background: ricky run workflows/generated/ricky-generate-a-workflow-for-package-checks-with-type.ts --background
```

The external generate-and-run artifact executed the printed foreground command successfully. It recorded workflow name `wf-51009be3b0c7`, execution run `9dc3bec086dbc660e42b15a4`, stdout log `/Users/khaliqgant/.local/state/ricky/local-runs/f5536fe45932/a269f8c2-33f5-4849-9eba-e4a8d8968a01/stdout.log`, stderr log `/Users/khaliqgant/.local/state/ricky/local-runs/f5536fe45932/a269f8c2-33f5-4849-9eba-e4a8d8968a01/stderr.log`, and assertion `external_cli_execution: pass`.

The run also recorded:

```text
Auto-fix: repaired after 1/7 attempt(s)
```

That proves the user-facing run path completed through Ricky's existing repair loop.

## Regression or product cost observed

No regression is shown by the captured proof artifacts. Generation succeeded, the generated workflow executed, the external run completed successfully, and the captured process exit was `0`.

The observed product cost is that live execution may still require a repair pass. That cost belongs to Ricky's workflow generation and repair loop, not to the shared turn-context adapter.

## Verdict: keep adopting, hold boundary, or redesign

Verdict: keep adopting, hold boundary.

The proof supports continued adoption because a real agent-assistant runtime primitive is exercised in Ricky's live local product path. The boundary should remain narrow: shared neutral request/turn context is appropriate, while Ricky keeps ownership of workflow-specific product behavior, execution UX, evidence, recovery, and reliability semantics.

RICKY_AGENT_ASSISTANT_LIVE_PROOF_COMPLETE
