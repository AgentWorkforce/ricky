# CLI Proof Artifact — Command Journey & Fixture Coverage

Generated deterministically from onboarding-proof.ts, cli-main.test.ts, and interactive-cli.test.ts.
No live provider or live relay dependency.

## Journey Proof Cases

| Journey   | Command / Entry                              | Expected Output Class              | Blocker / Recovery Class                        |
|-----------|----------------------------------------------|------------------------------------|-------------------------------------------------|
| default   | `npm start --` (no args)                     | `run` command, awaitingInput=true  | Recovery guidance: lists --spec, --spec-file, --stdin |
| local     | `npm start -- --mode local`                  | `run` with mode=local              | Local handoff blocker if no spec provided       |
| setup     | First-run interactive onboarding             | Banner + welcome + mode selector   | 4 choices: Local/BYOH, Cloud, Both, Just explore |
| welcome   | `renderWelcome()`                            | First-run vs returning user text   | N/A — deterministic render                      |
| status    | `renderCompactHeader(mode, providers)`       | Mode + provider connection status  | N/A — deterministic render                      |
| generate  | `--spec "generate a workflow for ..."` | Generated workflow artifact        | No invented `npx ricky generate` command        |

## Fixture Proof Cases

| Fixture               | Input                                      | Expected Output Class                          | Blocker / Recovery Class                         |
|-----------------------|--------------------------------------------|------------------------------------------------|--------------------------------------------------|
| inline-spec           | `--spec "text"`                            | ParsedArgs.spec = text, handoff.source = cli   | Empty spec → "Inline spec is empty"              |
| spec-file             | `--spec-file ./path.md`                    | ParsedArgs.specFile = path, file read via deps | ENOENT → "CLI input blocker" + recovery guidance |
| stdin                 | `--stdin` + piped content                  | ParsedArgs.stdin = true, handoff.source = cli  | Empty stdin → "Stdin spec is empty"              |
| missing-spec          | No --spec, --spec-file, or --stdin         | ParsedArgs with no spec fields                 | awaitingInput=true + recovery listing all 3 flags |
| missing-file-recovery | `--spec-file` (no value) / `--file` (no value) | ParsedArgs.errors populated                    | "requires a value" + "provide one of" guidance   |

## Proof Invariants

- **Deterministic**: All proof cases use injectable dependencies (vi.fn mocks). No live provider, relay, or network calls.
- **No invented commands**: Proof explicitly asserts absence of `npx ricky generate`, `npx ricky debug`, and similar fabricated CLI surfaces.
- **Cloud mode rejected for spec handoff**: `--mode cloud --spec` produces exit code 1 with "Cloud mode does not accept CLI spec handoff".
- **Spec defaults to local**: `--spec "text"` without `--mode` defaults mode to `local`.
- **`--file` alias**: `--file` is accepted as alias for `--spec-file`.
- **Explore maps to local**: Onboarding choice `explore` resolves to `local` mode at runtime.

## Test Coverage Summary

| File                              | Tests Before | Tests After | New Tests |
|-----------------------------------|-------------|-------------|-----------|
| cli-main.test.ts                  | 24          | 32          | +8        |
| interactive-cli.test.ts           | 15          | 27          | +12       |
| onboarding-proof.test.ts          | 13          | 26          | +13       |
| **Total**                         | **52**      | **85**      | **+33**   |

## Proof Case Registry (onboarding-proof.ts)

All 22 proof cases pass deterministically:

1. `implementation-modules-present` — Required CLI files exist
2. `first-run-experience` — Banner, welcome, mode selector rendered
3. `returning-user-compact-header` — Compact path for returning users
4. `local-byoh-path` — Local/BYOH is first, concrete
5. `cloud-path` — Cloud is first-class with provider guidance
6. `google-connect-guidance` — Uses real agent-relay command
7. `github-dashboard-nango-guidance` — Dashboard/Nango flow, no invented URLs
8. `cli-mcp-handoff-language` — Claude/CLI/MCP handoff supported
9. `recovery-paths` — Blocked/generic recovery is actionable
10. `banner-suppression` — Quiet/noBanner/nonTTY/env opt-out work
11. `narrow-terminal-fallback` — Compact text-only banner for narrow terminals
12. `default-journey` — No-args parses to `run`, help/version recognized
13. `local-journey` — --mode local parses correctly, surfaces handoff options
14. `setup-journey` — First-run renders all four mode choices
15. `welcome-journey` — First-run vs returning welcome text are distinct
16. `status-journey` — Compact header renders mode + provider status
17. `generate-journey` — Spec handoff parsing, generate example in help
18. `fixture-inline-spec` — --spec flag parses correctly
19. `fixture-spec-file` — --spec-file and --file parse to specFile
20. `fixture-stdin` — --stdin sets stdin=true
21. `fixture-missing-spec` — No spec fields when no flag provided
22. `fixture-missing-file-recovery` — Missing values produce actionable errors
