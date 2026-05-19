# Ricky Agent-Assistant Live Proof Verdict

GitHub issue #13 verdict: Ricky's agent-assistant adoption is present in the live local product path. The evidence supports continued adoption while holding the boundary at request/turn context reuse.

## What was adopted

Ricky adopted the real `@agent-assistant/turn-context` package as a bounded request/turn envelope primitive through the `ricky-local-turn-context-adapter`.

The runtime smoke artifact records assistant id `ricky`, turn id `req-wave10-live-proof`, adapter package `@agent-assistant/turn-context`, adapter version `1`, CLI source metadata, structured spec data, local mode, run stage mode, and request metadata provenance.

Captured enrichment blocks:

- `enrichment-ricky-request-summary`
- `enrichment-ricky-spec-text`
- `enrichment-ricky-structured-spec`
- `enrichment-ricky-source-metadata`
- `enrichment-ricky-request-metadata`

Ricky still owns request normalization, workflow generation, workflow artifacts, run-stage behavior, runtime prechecks, blocker classification, recovery wording, and local execution semantics.

## Product path exercised

The adapter runtime smoke proof exercised assistant `ricky` from the CLI with `mode: local`, `stageMode: run`, invocation root `/Users/khaliqgant/Projects/AgentWorkforce/ricky`, and structured spec description `generate a workflow for package checks`.

The external product path invoked the user-facing Ricky CLI:

```text
ricky --mode local --spec generate a workflow for package checks with typecheck and tests --no-workforce-persona
```

Ricky generated:

```text
workflows/generated/ricky-generate-a-workflow-for-package-checks-with-type.ts
```

The generated workflow was then executed through the user-facing run command:

```text
ricky run workflows/generated/ricky-generate-a-workflow-for-package-checks-with-type.ts
```

This proves the adopted turn-context adapter was present while Ricky moved through generate and run, not only in an isolated adapter check.

## Deterministic test proof

The issue #11 implementation signoff records this deterministic validation suite for the adopted adapter slice:

```text
npm run typecheck
npx tsc --noEmit
npx vitest run src/local
npx vitest run src/surfaces/cli
npm test
```

The issue #13 captured artifacts add deterministic product-path proof:

- `adapter-runtime-smoke.json` confirms the real adapter package, assistant id, turn id, request metadata, and enrichment block ids.
- `external-generate.json` returned `status: ok` and wrote the generated workflow file.
- `external-generate-and-run.json` returned `status: ok` for generation and `status: success` for execution.
- `external-generate-and-run.exit` is `0`.

The adoption proof document confirms the shared adapter is called by the real local executor before product intake, workflow generation, artifact selection, runtime prechecks, or coordinator launch. This is runtime-path adoption, not copied types or documentation-only alignment.

## Live/user-facing validation proof

The external generate artifact printed the user-facing next commands for foreground and background execution:

```text
Run: ricky run workflows/generated/ricky-generate-a-workflow-for-package-checks-with-type.ts
Background: ricky run workflows/generated/ricky-generate-a-workflow-for-package-checks-with-type.ts --background
```

The external generate-and-run artifact executed the printed foreground command successfully. It recorded workflow name `wf-51009be3b0c7`, execution run `2346199fa6afadc8ee88ec98`, stdout log `/Users/khaliqgant/.local/state/ricky/local-runs/f45bf144beab/eb28d915-4f04-4616-83a9-9a01cd319ef3/stdout.log`, stderr log `/Users/khaliqgant/.local/state/ricky/local-runs/f45bf144beab/eb28d915-4f04-4616-83a9-9a01cd319ef3/stderr.log`, and assertion `external_cli_execution: pass`.

The execution also recorded `Auto-fix: repaired after 1/7 attempt(s)`, proving the user-facing run path completed through Ricky's existing repair loop.

## Regression or product cost observed

No regression was observed in the captured proof artifacts. Generation succeeded, the generated workflow executed, the external run completed successfully, and the captured process exit was `0`.

The observed product cost is that live execution may still require a repair pass. That cost belongs to Ricky's workflow generation and repair loop, not to the shared turn-context adapter.

## Verdict: keep adopting, hold boundary, or redesign

Verdict: keep adopting, hold boundary.

The proof supports continued adoption because a real `agent-assistant` runtime primitive is exercised in Ricky's live local product path. The boundary should remain narrow: shared neutral request/turn context is appropriate, while Ricky keeps ownership of workflow-specific product behavior, execution UX, evidence, recovery, and reliability semantics.

RICKY_AGENT_ASSISTANT_LIVE_PROOF_COMPLETE
