import { workflow } from '@agent-relay/sdk/workflows';

async function main() {
  const result = await workflow("ricky-spec-ricky-version-reflects-the-installed-packag")
    .description("# Spec: `ricky --version` reflects the installed package version\n\n## Problem\n\nRunning `ricky --version` (or `-v`, or `version`) prints `ricky 0.0.0` regardless of which version of `@agentworkforce/ricky` is installed. The string is hardcoded.\n\n```\n$ ricky --version\nricky 0.0.0          # always — even when package.json says 0.1.0\n```\n\nThe default lives in `src/surfaces/cli/commands/cli-main.ts`:\n\n```ts\nif (parsed.command === 'version') {\n  const version = deps.version ?? '0.0.0';\n  return { exitCode: 0, output: [`ricky ${version}`] };\n}\n```\n\n`CliMainDeps.version` exists for test injection, but the bin entry (`src/bin/ricky.ts`) calls `cliMain()` with no deps, so the fallback always wins. Nothing reads `package.json`.\n\n## Why it matters\n\n- Users filing issues report the wrong version, slowing diagnosis.\n- After publishing 0.1.0 → 0.1.1 → … the CLI keeps lying.\n- The published bin is the one users see; tests don't catch this because they inject a fake version.\n\n## Behavior we want\n\n`ricky --version` (and `-v`, `version`) prints `ricky <version>` where `<version>` is the `version` field of the package.json shipped with the installed package.\n\n```\n$ ricky --version\nricky 0.1.0\n```\n\nIt must work in three contexts:\n\n1. **Installed from npm** — bin runs from `<prefix>/lib/node_modules/@agentworkforce/ricky/dist/bin/ricky.js`; `package.json` sits at `<that pkg root>/package.json`.\n2. **Local dev via `npm start`** — runs from source via tsx; `package.json` is at the repo root.\n3. **Tests** — `cliMain({ version: '9.9.9' })` still wins (the injectable `deps.version` override stays the highest-priority source).\n\n## Resolution order\n\n1. `deps.version` if provided (test seam — unchanged)\n2. The `version` field from the package.json that ships with the installed package\n3. Fallback: `'0.0.0'` (only reached if the file cannot be read or parsed)\n\n## Implementation notes\n\n- The cli-main module already has `import.meta.url`; use it to locate the package root: walk up from `dirname(fileURLToPath(import.meta.url))` until a `package.json` with `\"name\": \"@agentworkforce/ricky\"` is found, then read `version`. Stop at the filesystem root.\n- Read synchronously is fine here — version lookup happens once per invocation and only on the version path.\n- Cache the result at module scope so repeated calls don't hit the filesystem.\n- Do not require a build step (e.g. don't bake the version in via codegen) — keeping the lookup runtime keeps `npm version` bumps + `prepack` flow simple.\n- `tsconfig.build.json` already excludes tests; no config change needed.\n\n## Test cases\n\nAdd to `src/surfaces/cli/commands/cli-main.test.ts`:\n\n1. `cliMain({ argv: ['--version'], version: '9.9.9' })` → output `ricky 9.9.9` (existing override seam still works).\n2. With no `version` injected, `cliMain({ argv: ['--version'] })` returns `ricky <X>` where `<X>` matches the `version` from the repo's own `package.json`. Read it in the test via `readFileSync` so the assertion stays in sync with future bumps.\n3. When package.json lookup fails (mock the reader to throw), output falls back to `ricky 0.0.0` and exit code stays `0` — version display should never break the CLI.\n\n## Out of scope\n\n- Adding a `--verbose` / build-info flag (commit SHA, build date). Track separately if wanted.\n- Aligning `npm start --version` output formatting with the bin output (already identical — `cliMain` is shared).\n- Reflecting `@agent-relay/sdk` or other dep versions in the output.\n\n## Acceptance\n\n- `node dist/bin/ricky.js --version` prints the version from `package.json`.\n- All existing cli-main tests pass; the three new tests above pass.\n- `package.json` version bumps automatically flow through to the CLI without any code edit.")
    .pattern("pipeline")
    .channel("wf-ricky-spec-ricky-version-reflects-the-installed-packag")
    .maxConcurrency(1)
    .timeout(600000)
    .onError('fail-fast')

    .agent("lead-claude", { cli: "claude", role: "Plans task shape, ownership, non-goals, and verification gates.", retries: 1 })
    .agent("impl-primary-codex", { cli: "codex", role: "Primary implementer for the generated code-writing workflow.", retries: 2 })
    .agent("impl-tests-codex", { cli: "codex", role: "Adds or updates tests and validation coverage for the changed surface.", retries: 2 })
    .agent("reviewer-claude", { cli: "claude", preset: "reviewer", role: "Reviews product fit, scope control, and workflow evidence quality.", retries: 1 })
    .agent("reviewer-codex", { cli: "codex", preset: "reviewer", role: "Reviews TypeScript correctness, deterministic gates, and test coverage.", retries: 1 })
    .agent("validator-claude", { cli: "claude", preset: "worker", role: "Runs the 80-to-100 fix loop and verifies final readiness.", retries: 2 })

    .step("prepare-context", {
      type: 'deterministic',
      command: "mkdir -p '.workflow-artifacts/generated/spec-ricky-version-reflects-the-installed-packag' && printf '%s\\n' '# Spec: `ricky --version` reflects the installed package version\n\n## Problem\n\nRunning `ricky --version` (or `-v`, or `version`) prints `ricky 0.0.0` regardless of which version of `@agentworkforce/ricky` is installed. The string is hardcoded.\n\n```\n$ ricky --version\nricky 0.0.0          # always — even when package.json says 0.1.0\n```\n\nThe default lives in `src/surfaces/cli/commands/cli-main.ts`:\n\n```ts\nif (parsed.command === '\\''version'\\'') {\n  const version = deps.version ?? '\\''0.0.0'\\'';\n  return { exitCode: 0, output: [`ricky ${version}`] };\n}\n```\n\n`CliMainDeps.version` exists for test injection, but the bin entry (`src/bin/ricky.ts`) calls `cliMain()` with no deps, so the fallback always wins. Nothing reads `package.json`.\n\n## Why it matters\n\n- Users filing issues report the wrong version, slowing diagnosis.\n- After publishing 0.1.0 → 0.1.1 → … the CLI keeps lying.\n- The published bin is the one users see; tests don'\\''t catch this because they inject a fake version.\n\n## Behavior we want\n\n`ricky --version` (and `-v`, `version`) prints `ricky <version>` where `<version>` is the `version` field of the package.json shipped with the installed package.\n\n```\n$ ricky --version\nricky 0.1.0\n```\n\nIt must work in three contexts:\n\n1. **Installed from npm** — bin runs from `<prefix>/lib/node_modules/@agentworkforce/ricky/dist/bin/ricky.js`; `package.json` sits at `<that pkg root>/package.json`.\n2. **Local dev via `npm start`** — runs from source via tsx; `package.json` is at the repo root.\n3. **Tests** — `cliMain({ version: '\\''9.9.9'\\'' })` still wins (the injectable `deps.version` override stays the highest-priority source).\n\n## Resolution order\n\n1. `deps.version` if provided (test seam — unchanged)\n2. The `version` field from the package.json that ships with the installed package\n3. Fallback: `'\\''0.0.0'\\''` (only reached if the file cannot be read or parsed)\n\n## Implementation notes\n\n- The cli-main module already has `import.meta.url`; use it to locate the package root: walk up from `dirname(fileURLToPath(import.meta.url))` until a `package.json` with `\"name\": \"@agentworkforce/ricky\"` is found, then read `version`. Stop at the filesystem root.\n- Read synchronously is fine here — version lookup happens once per invocation and only on the version path.\n- Cache the result at module scope so repeated calls don'\\''t hit the filesystem.\n- Do not require a build step (e.g. don'\\''t bake the version in via codegen) — keeping the lookup runtime keeps `npm version` bumps + `prepack` flow simple.\n- `tsconfig.build.json` already excludes tests; no config change needed.\n\n## Test cases\n\nAdd to `src/surfaces/cli/commands/cli-main.test.ts`:\n\n1. `cliMain({ argv: ['\\''--version'\\''], version: '\\''9.9.9'\\'' })` → output `ricky 9.9.9` (existing override seam still works).\n2. With no `version` injected, `cliMain({ argv: ['\\''--version'\\''] })` returns `ricky <X>` where `<X>` matches the `version` from the repo'\\''s own `package.json`. Read it in the test via `readFileSync` so the assertion stays in sync with future bumps.\n3. When package.json lookup fails (mock the reader to throw), output falls back to `ricky 0.0.0` and exit code stays `0` — version display should never break the CLI.\n\n## Out of scope\n\n- Adding a `--verbose` / build-info flag (commit SHA, build date). Track separately if wanted.\n- Aligning `npm start --version` output formatting with the bin output (already identical — `cliMain` is shared).\n- Reflecting `@agent-relay/sdk` or other dep versions in the output.\n\n## Acceptance\n\n- `node dist/bin/ricky.js --version` prints the version from `package.json`.\n- All existing cli-main tests pass; the three new tests above pass.\n- `package.json` version bumps automatically flow through to the CLI without any code edit.' > '.workflow-artifacts/generated/spec-ricky-version-reflects-the-installed-packag/normalized-spec.txt' && printf '%s\\n' 'pattern=pipeline; reason=Selected pipeline because the request is low risk and can proceed through a linear reliability ladder.' > '.workflow-artifacts/generated/spec-ricky-version-reflects-the-installed-packag/pattern-decision.txt' && printf '%s\\n' 'relay-80-100-workflow confidence=1 reason=Spec text mentions \"agent-relay\". Spec text mentions \"must\". Spec text mentions \"code\". Spec text mentions \"works\". Spec text mentions \"mock\". Spec text mentions \"after\". Spec text mentions \"edit\". Spec text mentions \"implementation\". Spec text mentions \"through\". Spec text mentions \"tests\". evidence=keyword:agent-relay, keyword:must, keyword:code, keyword:works, keyword:mock, keyword:after, keyword:edit, keyword:implementation, keyword:through, keyword:tests\nwriting-agent-relay-workflows confidence=0.8 reason=Spec text mentions \"relay\". Spec text mentions \"step\". Spec text mentions \"agent\". Spec text mentions \"output\". evidence=keyword:relay, keyword:step, keyword:agent, keyword:output\nchoosing-swarm-patterns confidence=0.4 reason=Spec text mentions \"agent\". Spec text mentions \"relay\". evidence=keyword:agent, keyword:relay' > '.workflow-artifacts/generated/spec-ricky-version-reflects-the-installed-packag/loaded-skills.txt' && printf '%s\\n' '[{\"id\":\"relay-80-100-workflow\",\"name\":\"relay-80-100-workflow\",\"path\":\"/Users/khaliqgant/Projects/AgentWorkforce/ricky/.claude/skills/relay-80-100-workflow/SKILL.md\",\"confidence\":1,\"reason\":\"Spec text mentions \\\"agent-relay\\\". Spec text mentions \\\"must\\\". Spec text mentions \\\"code\\\". Spec text mentions \\\"works\\\". Spec text mentions \\\"mock\\\". Spec text mentions \\\"after\\\". Spec text mentions \\\"edit\\\". Spec text mentions \\\"implementation\\\". Spec text mentions \\\"through\\\". Spec text mentions \\\"tests\\\".\",\"evidence\":[{\"trigger\":\"agent-relay\",\"source\":\"keyword\",\"detail\":\"Spec text mentions \\\"agent-relay\\\".\"},{\"trigger\":\"must\",\"source\":\"keyword\",\"detail\":\"Spec text mentions \\\"must\\\".\"},{\"trigger\":\"code\",\"source\":\"keyword\",\"detail\":\"Spec text mentions \\\"code\\\".\"},{\"trigger\":\"works\",\"source\":\"keyword\",\"detail\":\"Spec text mentions \\\"works\\\".\"},{\"trigger\":\"mock\",\"source\":\"keyword\",\"detail\":\"Spec text mentions \\\"mock\\\".\"},{\"trigger\":\"after\",\"source\":\"keyword\",\"detail\":\"Spec text mentions \\\"after\\\".\"},{\"trigger\":\"edit\",\"source\":\"keyword\",\"detail\":\"Spec text mentions \\\"edit\\\".\"},{\"trigger\":\"implementation\",\"source\":\"keyword\",\"detail\":\"Spec text mentions \\\"implementation\\\".\"},{\"trigger\":\"through\",\"source\":\"keyword\",\"detail\":\"Spec text mentions \\\"through\\\".\"},{\"trigger\":\"tests\",\"source\":\"keyword\",\"detail\":\"Spec text mentions \\\"tests\\\".\"}],\"updatedAt\":\"2026-04-27T18:17:53.946Z\"},{\"id\":\"writing-agent-relay-workflows\",\"name\":\"writing-agent-relay-workflows\",\"path\":\"/Users/khaliqgant/Projects/AgentWorkforce/ricky/.claude/skills/writing-agent-relay-workflows/SKILL.md\",\"confidence\":0.8,\"reason\":\"Spec text mentions \\\"relay\\\". Spec text mentions \\\"step\\\". Spec text mentions \\\"agent\\\". Spec text mentions \\\"output\\\".\",\"evidence\":[{\"trigger\":\"relay\",\"source\":\"keyword\",\"detail\":\"Spec text mentions \\\"relay\\\".\"},{\"trigger\":\"step\",\"source\":\"keyword\",\"detail\":\"Spec text mentions \\\"step\\\".\"},{\"trigger\":\"agent\",\"source\":\"keyword\",\"detail\":\"Spec text mentions \\\"agent\\\".\"},{\"trigger\":\"output\",\"source\":\"keyword\",\"detail\":\"Spec text mentions \\\"output\\\".\"}],\"updatedAt\":\"2026-04-27T18:17:52.355Z\"},{\"id\":\"choosing-swarm-patterns\",\"name\":\"choosing-swarm-patterns\",\"path\":\"/Users/khaliqgant/Projects/AgentWorkforce/ricky/.claude/skills/choosing-swarm-patterns/SKILL.md\",\"confidence\":0.4,\"reason\":\"Spec text mentions \\\"agent\\\". Spec text mentions \\\"relay\\\".\",\"evidence\":[{\"trigger\":\"agent\",\"source\":\"keyword\",\"detail\":\"Spec text mentions \\\"agent\\\".\"},{\"trigger\":\"relay\",\"source\":\"keyword\",\"detail\":\"Spec text mentions \\\"relay\\\".\"}],\"updatedAt\":\"2026-04-27T18:17:50.596Z\"}]' > '.workflow-artifacts/generated/spec-ricky-version-reflects-the-installed-packag/skill-matches.json' && printf '%s\\n' '[{\"stepId\":\"lead-plan\",\"agent\":\"lead-claude\",\"runner\":\"@agent-relay/sdk\",\"concurrency\":1,\"rule\":\"project default runner @agent-relay/sdk\"},{\"stepId\":\"implement-artifact\",\"agent\":\"impl-primary-codex\",\"runner\":\"@agent-relay/sdk\",\"concurrency\":1,\"rule\":\"project default runner @agent-relay/sdk\"},{\"stepId\":\"review-claude\",\"agent\":\"reviewer-claude\",\"runner\":\"@agent-relay/sdk\",\"concurrency\":1,\"rule\":\"project default runner @agent-relay/sdk\"},{\"stepId\":\"review-codex\",\"agent\":\"reviewer-codex\",\"runner\":\"@agent-relay/sdk\",\"concurrency\":1,\"rule\":\"project default runner @agent-relay/sdk\"},{\"stepId\":\"fix-loop\",\"agent\":\"validator-claude\",\"runner\":\"@agent-relay/sdk\",\"concurrency\":1,\"rule\":\"project default runner @agent-relay/sdk\"},{\"stepId\":\"final-review-claude\",\"agent\":\"reviewer-claude\",\"runner\":\"@agent-relay/sdk\",\"concurrency\":1,\"rule\":\"project default runner @agent-relay/sdk\"},{\"stepId\":\"final-review-codex\",\"agent\":\"reviewer-codex\",\"runner\":\"@agent-relay/sdk\",\"concurrency\":1,\"rule\":\"project default runner @agent-relay/sdk\"},{\"stepId\":\"final-signoff\",\"agent\":\"validator-claude\",\"runner\":\"@agent-relay/sdk\",\"concurrency\":1,\"rule\":\"project default runner @agent-relay/sdk\"}]' > '.workflow-artifacts/generated/spec-ricky-version-reflects-the-installed-packag/tool-selection.json' && printf '%s\\n' '{\"behavior\":\"generation_time_only\",\"runtimeEmbodiment\":false,\"boundary\":\"Skills influence Ricky generator selection, loading, template rendering, workflow contract, validation gates, and metadata. Generated runtime agents receive only the rendered workflow instructions; they do not load or embody skill files at runtime.\",\"loadedSkills\":[\"relay-80-100-workflow\",\"writing-agent-relay-workflows\",\"choosing-swarm-patterns\"],\"applicationEvidence\":[{\"skillName\":\"relay-80-100-workflow\",\"stage\":\"generation_selection\",\"effect\":\"workflow_contract\",\"behavior\":\"generation_time_only\",\"runtimeEmbodiment\":false,\"evidence\":\"Selected relay-80-100-workflow during workflow generation. Spec text mentions \\\"agent-relay\\\". Spec text mentions \\\"must\\\". Spec text mentions \\\"code\\\". Spec text mentions \\\"works\\\". Spec text mentions \\\"mock\\\". Spec text mentions \\\"after\\\". Spec text mentions \\\"edit\\\". Spec text mentions \\\"implementation\\\". Spec text mentions \\\"through\\\". Spec text mentions \\\"tests\\\".\"},{\"skillName\":\"relay-80-100-workflow\",\"stage\":\"generation_loading\",\"effect\":\"metadata\",\"behavior\":\"generation_time_only\",\"runtimeEmbodiment\":false,\"evidence\":\"Loaded relay-80-100-workflow descriptor from /Users/khaliqgant/Projects/AgentWorkforce/ricky/.claude/skills/relay-80-100-workflow/SKILL.md before template rendering.\"},{\"skillName\":\"writing-agent-relay-workflows\",\"stage\":\"generation_selection\",\"effect\":\"workflow_contract\",\"behavior\":\"generation_time_only\",\"runtimeEmbodiment\":false,\"evidence\":\"Selected writing-agent-relay-workflows during workflow generation. Spec text mentions \\\"relay\\\". Spec text mentions \\\"step\\\". Spec text mentions \\\"agent\\\". Spec text mentions \\\"output\\\".\"},{\"skillName\":\"writing-agent-relay-workflows\",\"stage\":\"generation_loading\",\"effect\":\"metadata\",\"behavior\":\"generation_time_only\",\"runtimeEmbodiment\":false,\"evidence\":\"Loaded writing-agent-relay-workflows descriptor from /Users/khaliqgant/Projects/AgentWorkforce/ricky/.claude/skills/writing-agent-relay-workflows/SKILL.md before template rendering.\"},{\"skillName\":\"choosing-swarm-patterns\",\"stage\":\"generation_selection\",\"effect\":\"workflow_contract\",\"behavior\":\"generation_time_only\",\"runtimeEmbodiment\":false,\"evidence\":\"Selected choosing-swarm-patterns during workflow generation. Spec text mentions \\\"agent\\\". Spec text mentions \\\"relay\\\".\"},{\"skillName\":\"choosing-swarm-patterns\",\"stage\":\"generation_loading\",\"effect\":\"metadata\",\"behavior\":\"generation_time_only\",\"runtimeEmbodiment\":false,\"evidence\":\"Loaded choosing-swarm-patterns descriptor from /Users/khaliqgant/Projects/AgentWorkforce/ricky/.claude/skills/choosing-swarm-patterns/SKILL.md before template rendering.\"},{\"skillName\":\"writing-agent-relay-workflows\",\"stage\":\"generation_rendering\",\"effect\":\"workflow_contract\",\"behavior\":\"generation_time_only\",\"runtimeEmbodiment\":false,\"evidence\":\"Rendered 10 workflow tasks with dedicated channel setup, explicit agents, step dependencies, review stages, and final signoff.\"},{\"skillName\":\"relay-80-100-workflow\",\"stage\":\"generation_rendering\",\"effect\":\"validation_gates\",\"behavior\":\"generation_time_only\",\"runtimeEmbodiment\":false,\"evidence\":\"Rendered 9 deterministic gates including initial soft validation, fix-loop checks, final hard validation, git diff, and regression gates.\"}]}' > '.workflow-artifacts/generated/spec-ricky-version-reflects-the-installed-packag/skill-application-boundary.json' && printf '%s\\n' 'Skills influence Ricky generator selection, loading, template rendering, workflow contract, validation gates, and metadata. Generated runtime agents receive only the rendered workflow instructions; they do not load or embody skill files at runtime.' > '.workflow-artifacts/generated/spec-ricky-version-reflects-the-installed-packag/skill-runtime-boundary.txt' && : > '.workflow-artifacts/generated/spec-ricky-version-reflects-the-installed-packag/matched-skills.md' && printf '%s\\n' '\n# relay-80-100-workflow\nsource=/Users/khaliqgant/Projects/AgentWorkforce/ricky/.claude/skills/relay-80-100-workflow/SKILL.md\nreason=Spec text mentions \"agent-relay\". Spec text mentions \"must\". Spec text mentions \"code\". Spec text mentions \"works\". Spec text mentions \"mock\". Spec text mentions \"after\". Spec text mentions \"edit\". Spec text mentions \"implementation\". Spec text mentions \"through\". Spec text mentions \"tests\".\n' >> '.workflow-artifacts/generated/spec-ricky-version-reflects-the-installed-packag/matched-skills.md' && cat '/Users/khaliqgant/Projects/AgentWorkforce/ricky/.claude/skills/relay-80-100-workflow/SKILL.md' >> '.workflow-artifacts/generated/spec-ricky-version-reflects-the-installed-packag/matched-skills.md' && printf '%s\\n' '\n# writing-agent-relay-workflows\nsource=/Users/khaliqgant/Projects/AgentWorkforce/ricky/.claude/skills/writing-agent-relay-workflows/SKILL.md\nreason=Spec text mentions \"relay\". Spec text mentions \"step\". Spec text mentions \"agent\". Spec text mentions \"output\".\n' >> '.workflow-artifacts/generated/spec-ricky-version-reflects-the-installed-packag/matched-skills.md' && cat '/Users/khaliqgant/Projects/AgentWorkforce/ricky/.claude/skills/writing-agent-relay-workflows/SKILL.md' >> '.workflow-artifacts/generated/spec-ricky-version-reflects-the-installed-packag/matched-skills.md' && printf '%s\\n' '\n# choosing-swarm-patterns\nsource=/Users/khaliqgant/Projects/AgentWorkforce/ricky/.claude/skills/choosing-swarm-patterns/SKILL.md\nreason=Spec text mentions \"agent\". Spec text mentions \"relay\".\n' >> '.workflow-artifacts/generated/spec-ricky-version-reflects-the-installed-packag/matched-skills.md' && cat '/Users/khaliqgant/Projects/AgentWorkforce/ricky/.claude/skills/choosing-swarm-patterns/SKILL.md' >> '.workflow-artifacts/generated/spec-ricky-version-reflects-the-installed-packag/matched-skills.md' && echo GENERATED_WORKFLOW_CONTEXT_READY",
      captureOutput: true,
      failOnError: true,
    })

    .step("skill-boundary-metadata-gate", {
      type: 'deterministic',
      dependsOn: ["prepare-context"],
      command: "test -f '.workflow-artifacts/generated/spec-ricky-version-reflects-the-installed-packag/skill-application-boundary.json' && test -f '.workflow-artifacts/generated/spec-ricky-version-reflects-the-installed-packag/skill-matches.json' && test -f '.workflow-artifacts/generated/spec-ricky-version-reflects-the-installed-packag/tool-selection.json' && grep -F 'generation_time_only' '.workflow-artifacts/generated/spec-ricky-version-reflects-the-installed-packag/skill-application-boundary.json' && grep -F '\"runtimeEmbodiment\":false' '.workflow-artifacts/generated/spec-ricky-version-reflects-the-installed-packag/skill-application-boundary.json' && grep -F 'relay-80-100-workflow' '.workflow-artifacts/generated/spec-ricky-version-reflects-the-installed-packag/skill-application-boundary.json' && grep -F 'writing-agent-relay-workflows' '.workflow-artifacts/generated/spec-ricky-version-reflects-the-installed-packag/skill-application-boundary.json' && grep -F 'choosing-swarm-patterns' '.workflow-artifacts/generated/spec-ricky-version-reflects-the-installed-packag/skill-application-boundary.json' && grep -F '\"stage\":\"generation_selection\"' '.workflow-artifacts/generated/spec-ricky-version-reflects-the-installed-packag/skill-application-boundary.json' && grep -F '\"stage\":\"generation_loading\"' '.workflow-artifacts/generated/spec-ricky-version-reflects-the-installed-packag/skill-application-boundary.json' && grep -F '\"effect\":\"metadata\"' '.workflow-artifacts/generated/spec-ricky-version-reflects-the-installed-packag/skill-application-boundary.json' && grep -F '\"stage\":\"generation_rendering\"' '.workflow-artifacts/generated/spec-ricky-version-reflects-the-installed-packag/skill-application-boundary.json' && grep -F '\"effect\":\"workflow_contract\"' '.workflow-artifacts/generated/spec-ricky-version-reflects-the-installed-packag/skill-application-boundary.json' && grep -F '\"stage\":\"generation_rendering\"' '.workflow-artifacts/generated/spec-ricky-version-reflects-the-installed-packag/skill-application-boundary.json' && grep -F '\"effect\":\"validation_gates\"' '.workflow-artifacts/generated/spec-ricky-version-reflects-the-installed-packag/skill-application-boundary.json'",
      captureOutput: true,
      failOnError: true,
    })

    .step('lead-plan', {
      agent: 'lead-claude',
      dependsOn: ['skill-boundary-metadata-gate'],
      task: `Plan the workflow execution from the normalized spec.

Generation-time skill boundary:
- Read .workflow-artifacts/generated/spec-ricky-version-reflects-the-installed-packag/skill-application-boundary.json and treat it as generator metadata only.
- Skills are applied by Ricky during selection, loading, and template rendering.
- Do not claim generated agents load, retain, or embody skill files at runtime unless a future runtime test proves that path.

Description:
# Spec: \`ricky --version\` reflects the installed package version

## Problem

Running \`ricky --version\` (or \`-v\`, or \`version\`) prints \`ricky 0.0.0\` regardless of which version of \`@agentworkforce/ricky\` is installed. The string is hardcoded.

\`\`\`
$ ricky --version
ricky 0.0.0          # always — even when package.json says 0.1.0
\`\`\`

The default lives in \`src/surfaces/cli/commands/cli-main.ts\`:

\`\`\`ts
if (parsed.command === 'version') {
  const version = deps.version ?? '0.0.0';
  return { exitCode: 0, output: [\`ricky \${version}\`] };
}
\`\`\`

\`CliMainDeps.version\` exists for test injection, but the bin entry (\`src/bin/ricky.ts\`) calls \`cliMain()\` with no deps, so the fallback always wins. Nothing reads \`package.json\`.

## Why it matters

- Users filing issues report the wrong version, slowing diagnosis.
- After publishing 0.1.0 → 0.1.1 → … the CLI keeps lying.
- The published bin is the one users see; tests don't catch this because they inject a fake version.

## Behavior we want

\`ricky --version\` (and \`-v\`, \`version\`) prints \`ricky <version>\` where \`<version>\` is the \`version\` field of the package.json shipped with the installed package.

\`\`\`
$ ricky --version
ricky 0.1.0
\`\`\`

It must work in three contexts:

1. **Installed from npm** — bin runs from \`<prefix>/lib/node_modules/@agentworkforce/ricky/dist/bin/ricky.js\`; \`package.json\` sits at \`<that pkg root>/package.json\`.
2. **Local dev via \`npm start\`** — runs from source via tsx; \`package.json\` is at the repo root.
3. **Tests** — \`cliMain({ version: '9.9.9' })\` still wins (the injectable \`deps.version\` override stays the highest-priority source).

## Resolution order

1. \`deps.version\` if provided (test seam — unchanged)
2. The \`version\` field from the package.json that ships with the installed package
3. Fallback: \`'0.0.0'\` (only reached if the file cannot be read or parsed)

## Implementation notes

- The cli-main module already has \`import.meta.url\`; use it to locate the package root: walk up from \`dirname(fileURLToPath(import.meta.url))\` until a \`package.json\` with \`"name": "@agentworkforce/ricky"\` is found, then read \`version\`. Stop at the filesystem root.
- Read synchronously is fine here — version lookup happens once per invocation and only on the version path.
- Cache the result at module scope so repeated calls don't hit the filesystem.
- Do not require a build step (e.g. don't bake the version in via codegen) — keeping the lookup runtime keeps \`npm version\` bumps + \`prepack\` flow simple.
- \`tsconfig.build.json\` already excludes tests; no config change needed.

## Test cases

Add to \`src/surfaces/cli/commands/cli-main.test.ts\`:

1. \`cliMain({ argv: ['--version'], version: '9.9.9' })\` → output \`ricky 9.9.9\` (existing override seam still works).
2. With no \`version\` injected, \`cliMain({ argv: ['--version'] })\` returns \`ricky <X>\` where \`<X>\` matches the \`version\` from the repo's own \`package.json\`. Read it in the test via \`readFileSync\` so the assertion stays in sync with future bumps.
3. When package.json lookup fails (mock the reader to throw), output falls back to \`ricky 0.0.0\` and exit code stays \`0\` — version display should never break the CLI.

## Out of scope

- Adding a \`--verbose\` / build-info flag (commit SHA, build date). Track separately if wanted.
- Aligning \`npm start --version\` output formatting with the bin output (already identical — \`cliMain\` is shared).
- Reflecting \`@agent-relay/sdk\` or other dep versions in the output.

## Acceptance

- \`node dist/bin/ricky.js --version\` prints the version from \`package.json\`.
- All existing cli-main tests pass; the three new tests above pass.
- \`package.json\` version bumps automatically flow through to the CLI without any code edit.

Deliverables:
- dist/bin/ricky.js

Non-goals:
- None declared

Verification commands:
- file_exists gate for declared targets
- grep sanity gate
- npx tsc --noEmit
- npx vitest run
- git diff --name-only gate

Write .workflow-artifacts/generated/spec-ricky-version-reflects-the-installed-packag/lead-plan.md ending with GENERATION_LEAD_PLAN_READY.`,
      verification: { type: 'file_exists', value: ".workflow-artifacts/generated/spec-ricky-version-reflects-the-installed-packag/lead-plan.md" },
    })

    .step('implement-artifact', {
      agent: "impl-primary-codex",
      dependsOn: ['lead-plan'],

      task: `Implement the requested code-writing workflow slice.

Scope:
# Spec: \`ricky --version\` reflects the installed package version

## Problem

Running \`ricky --version\` (or \`-v\`, or \`version\`) prints \`ricky 0.0.0\` regardless of which version of \`@agentworkforce/ricky\` is installed. The string is hardcoded.

\`\`\`
$ ricky --version
ricky 0.0.0          # always — even when package.json says 0.1.0
\`\`\`

The default lives in \`src/surfaces/cli/commands/cli-main.ts\`:

\`\`\`ts
if (parsed.command === 'version') {
  const version = deps.version ?? '0.0.0';
  return { exitCode: 0, output: [\`ricky \${version}\`] };
}
\`\`\`

\`CliMainDeps.version\` exists for test injection, but the bin entry (\`src/bin/ricky.ts\`) calls \`cliMain()\` with no deps, so the fallback always wins. Nothing reads \`package.json\`.

## Why it matters

- Users filing issues report the wrong version, slowing diagnosis.
- After publishing 0.1.0 → 0.1.1 → … the CLI keeps lying.
- The published bin is the one users see; tests don't catch this because they inject a fake version.

## Behavior we want

\`ricky --version\` (and \`-v\`, \`version\`) prints \`ricky <version>\` where \`<version>\` is the \`version\` field of the package.json shipped with the installed package.

\`\`\`
$ ricky --version
ricky 0.1.0
\`\`\`

It must work in three contexts:

1. **Installed from npm** — bin runs from \`<prefix>/lib/node_modules/@agentworkforce/ricky/dist/bin/ricky.js\`; \`package.json\` sits at \`<that pkg root>/package.json\`.
2. **Local dev via \`npm start\`** — runs from source via tsx; \`package.json\` is at the repo root.
3. **Tests** — \`cliMain({ version: '9.9.9' })\` still wins (the injectable \`deps.version\` override stays the highest-priority source).

## Resolution order

1. \`deps.version\` if provided (test seam — unchanged)
2. The \`version\` field from the package.json that ships with the installed package
3. Fallback: \`'0.0.0'\` (only reached if the file cannot be read or parsed)

## Implementation notes

- The cli-main module already has \`import.meta.url\`; use it to locate the package root: walk up from \`dirname(fileURLToPath(import.meta.url))\` until a \`package.json\` with \`"name": "@agentworkforce/ricky"\` is found, then read \`version\`. Stop at the filesystem root.
- Read synchronously is fine here — version lookup happens once per invocation and only on the version path.
- Cache the result at module scope so repeated calls don't hit the filesystem.
- Do not require a build step (e.g. don't bake the version in via codegen) — keeping the lookup runtime keeps \`npm version\` bumps + \`prepack\` flow simple.
- \`tsconfig.build.json\` already excludes tests; no config change needed.

## Test cases

Add to \`src/surfaces/cli/commands/cli-main.test.ts\`:

1. \`cliMain({ argv: ['--version'], version: '9.9.9' })\` → output \`ricky 9.9.9\` (existing override seam still works).
2. With no \`version\` injected, \`cliMain({ argv: ['--version'] })\` returns \`ricky <X>\` where \`<X>\` matches the \`version\` from the repo's own \`package.json\`. Read it in the test via \`readFileSync\` so the assertion stays in sync with future bumps.
3. When package.json lookup fails (mock the reader to throw), output falls back to \`ricky 0.0.0\` and exit code stays \`0\` — version display should never break the CLI.

## Out of scope

- Adding a \`--verbose\` / build-info flag (commit SHA, build date). Track separately if wanted.
- Aligning \`npm start --version\` output formatting with the bin output (already identical — \`cliMain\` is shared).
- Reflecting \`@agent-relay/sdk\` or other dep versions in the output.

## Acceptance

- \`node dist/bin/ricky.js --version\` prints the version from \`package.json\`.
- All existing cli-main tests pass; the three new tests above pass.
- \`package.json\` version bumps automatically flow through to the CLI without any code edit.

Own only declared targets unless review feedback explicitly narrows a required fix:
- dist/bin/ricky.js

Acceptance gates:
- None declared

Tool selection: runner=@agent-relay/sdk; concurrency=1; rule=project default runner @agent-relay/sdk.

Before editing, read .workflow-artifacts/generated/spec-ricky-version-reflects-the-installed-packag/matched-skills.md when it exists and use it only as generation-time context for this task.

Keep execution routing explicit for local, cloud, and MCP callers. Materialize outputs to disk, then stop for deterministic gates.`,
    })

    .step("post-implementation-file-gate", {
      type: 'deterministic',
      dependsOn: ["implement-artifact"],
      command: "test -f 'dist/bin/ricky.js' && node dist/bin/ricky.js --version | grep -Eq '^ricky [0-9]+\\.[0-9]+\\.[0-9]+$'",
      captureOutput: true,
      failOnError: true,
    })

    .step("initial-soft-validation", {
      type: 'deterministic',
      dependsOn: ["post-implementation-file-gate"],
      command: "npx tsc --noEmit && npx vitest run",
      captureOutput: true,
      failOnError: false,
    })

    .step("review-claude", {
      agent: "reviewer-claude",
      dependsOn: ["initial-soft-validation"],

      task: `Review the generated work.

Assess:
- declared file targets and non-goals
- deterministic gates and evidence quality
- review/fix/final-review 80-to-100 loop shape
- local/cloud/MCP routing clarity

Spec:
# Spec: \`ricky --version\` reflects the installed package version

## Problem

Running \`ricky --version\` (or \`-v\`, or \`version\`) prints \`ricky 0.0.0\` regardless of which version of \`@agentworkforce/ricky\` is installed. The string is hardcoded.

\`\`\`
$ ricky --version
ricky 0.0.0          # always — even when package.json says 0.1.0
\`\`\`

The default lives in \`src/surfaces/cli/commands/cli-main.ts\`:

\`\`\`ts
if (parsed.command === 'version') {
  const version = deps.version ?? '0.0.0';
  return { exitCode: 0, output: [\`ricky \${version}\`] };
}
\`\`\`

\`CliMainDeps.version\` exists for test injection, but the bin entry (\`src/bin/ricky.ts\`) calls \`cliMain()\` with no deps, so the fallback always wins. Nothing reads \`package.json\`.

## Why it matters

- Users filing issues report the wrong version, slowing diagnosis.
- After publishing 0.1.0 → 0.1.1 → … the CLI keeps lying.
- The published bin is the one users see; tests don't catch this because they inject a fake version.

## Behavior we want

\`ricky --version\` (and \`-v\`, \`version\`) prints \`ricky <version>\` where \`<version>\` is the \`version\` field of the package.json shipped with the installed package.

\`\`\`
$ ricky --version
ricky 0.1.0
\`\`\`

It must work in three contexts:

1. **Installed from npm** — bin runs from \`<prefix>/lib/node_modules/@agentworkforce/ricky/dist/bin/ricky.js\`; \`package.json\` sits at \`<that pkg root>/package.json\`.
2. **Local dev via \`npm start\`** — runs from source via tsx; \`package.json\` is at the repo root.
3. **Tests** — \`cliMain({ version: '9.9.9' })\` still wins (the injectable \`deps.version\` override stays the highest-priority source).

## Resolution order

1. \`deps.version\` if provided (test seam — unchanged)
2. The \`version\` field from the package.json that ships with the installed package
3. Fallback: \`'0.0.0'\` (only reached if the file cannot be read or parsed)

## Implementation notes

- The cli-main module already has \`import.meta.url\`; use it to locate the package root: walk up from \`dirname(fileURLToPath(import.meta.url))\` until a \`package.json\` with \`"name": "@agentworkforce/ricky"\` is found, then read \`version\`. Stop at the filesystem root.
- Read synchronously is fine here — version lookup happens once per invocation and only on the version path.
- Cache the result at module scope so repeated calls don't hit the filesystem.
- Do not require a build step (e.g. don't bake the version in via codegen) — keeping the lookup runtime keeps \`npm version\` bumps + \`prepack\` flow simple.
- \`tsconfig.build.json\` already excludes tests; no config change needed.

## Test cases

Add to \`src/surfaces/cli/commands/cli-main.test.ts\`:

1. \`cliMain({ argv: ['--version'], version: '9.9.9' })\` → output \`ricky 9.9.9\` (existing override seam still works).
2. With no \`version\` injected, \`cliMain({ argv: ['--version'] })\` returns \`ricky <X>\` where \`<X>\` matches the \`version\` from the repo's own \`package.json\`. Read it in the test via \`readFileSync\` so the assertion stays in sync with future bumps.
3. When package.json lookup fails (mock the reader to throw), output falls back to \`ricky 0.0.0\` and exit code stays \`0\` — version display should never break the CLI.

## Out of scope

- Adding a \`--verbose\` / build-info flag (commit SHA, build date). Track separately if wanted.
- Aligning \`npm start --version\` output formatting with the bin output (already identical — \`cliMain\` is shared).
- Reflecting \`@agent-relay/sdk\` or other dep versions in the output.

## Acceptance

- \`node dist/bin/ricky.js --version\` prints the version from \`package.json\`.
- All existing cli-main tests pass; the three new tests above pass.
- \`package.json\` version bumps automatically flow through to the CLI without any code edit.

Tool selection: runner=@agent-relay/sdk; concurrency=1; rule=project default runner @agent-relay/sdk.

Write .workflow-artifacts/generated/spec-ricky-version-reflects-the-installed-packag/review-claude.md ending with REVIEW_COMPLETE.`,
      verification: { type: 'file_exists', value: ".workflow-artifacts/generated/spec-ricky-version-reflects-the-installed-packag/review-claude.md" },
    })

    .step("review-codex", {
      agent: "reviewer-codex",
      dependsOn: ["initial-soft-validation"],

      task: `Review the generated work.

Assess:
- declared file targets and non-goals
- deterministic gates and evidence quality
- review/fix/final-review 80-to-100 loop shape
- local/cloud/MCP routing clarity

Spec:
# Spec: \`ricky --version\` reflects the installed package version

## Problem

Running \`ricky --version\` (or \`-v\`, or \`version\`) prints \`ricky 0.0.0\` regardless of which version of \`@agentworkforce/ricky\` is installed. The string is hardcoded.

\`\`\`
$ ricky --version
ricky 0.0.0          # always — even when package.json says 0.1.0
\`\`\`

The default lives in \`src/surfaces/cli/commands/cli-main.ts\`:

\`\`\`ts
if (parsed.command === 'version') {
  const version = deps.version ?? '0.0.0';
  return { exitCode: 0, output: [\`ricky \${version}\`] };
}
\`\`\`

\`CliMainDeps.version\` exists for test injection, but the bin entry (\`src/bin/ricky.ts\`) calls \`cliMain()\` with no deps, so the fallback always wins. Nothing reads \`package.json\`.

## Why it matters

- Users filing issues report the wrong version, slowing diagnosis.
- After publishing 0.1.0 → 0.1.1 → … the CLI keeps lying.
- The published bin is the one users see; tests don't catch this because they inject a fake version.

## Behavior we want

\`ricky --version\` (and \`-v\`, \`version\`) prints \`ricky <version>\` where \`<version>\` is the \`version\` field of the package.json shipped with the installed package.

\`\`\`
$ ricky --version
ricky 0.1.0
\`\`\`

It must work in three contexts:

1. **Installed from npm** — bin runs from \`<prefix>/lib/node_modules/@agentworkforce/ricky/dist/bin/ricky.js\`; \`package.json\` sits at \`<that pkg root>/package.json\`.
2. **Local dev via \`npm start\`** — runs from source via tsx; \`package.json\` is at the repo root.
3. **Tests** — \`cliMain({ version: '9.9.9' })\` still wins (the injectable \`deps.version\` override stays the highest-priority source).

## Resolution order

1. \`deps.version\` if provided (test seam — unchanged)
2. The \`version\` field from the package.json that ships with the installed package
3. Fallback: \`'0.0.0'\` (only reached if the file cannot be read or parsed)

## Implementation notes

- The cli-main module already has \`import.meta.url\`; use it to locate the package root: walk up from \`dirname(fileURLToPath(import.meta.url))\` until a \`package.json\` with \`"name": "@agentworkforce/ricky"\` is found, then read \`version\`. Stop at the filesystem root.
- Read synchronously is fine here — version lookup happens once per invocation and only on the version path.
- Cache the result at module scope so repeated calls don't hit the filesystem.
- Do not require a build step (e.g. don't bake the version in via codegen) — keeping the lookup runtime keeps \`npm version\` bumps + \`prepack\` flow simple.
- \`tsconfig.build.json\` already excludes tests; no config change needed.

## Test cases

Add to \`src/surfaces/cli/commands/cli-main.test.ts\`:

1. \`cliMain({ argv: ['--version'], version: '9.9.9' })\` → output \`ricky 9.9.9\` (existing override seam still works).
2. With no \`version\` injected, \`cliMain({ argv: ['--version'] })\` returns \`ricky <X>\` where \`<X>\` matches the \`version\` from the repo's own \`package.json\`. Read it in the test via \`readFileSync\` so the assertion stays in sync with future bumps.
3. When package.json lookup fails (mock the reader to throw), output falls back to \`ricky 0.0.0\` and exit code stays \`0\` — version display should never break the CLI.

## Out of scope

- Adding a \`--verbose\` / build-info flag (commit SHA, build date). Track separately if wanted.
- Aligning \`npm start --version\` output formatting with the bin output (already identical — \`cliMain\` is shared).
- Reflecting \`@agent-relay/sdk\` or other dep versions in the output.

## Acceptance

- \`node dist/bin/ricky.js --version\` prints the version from \`package.json\`.
- All existing cli-main tests pass; the three new tests above pass.
- \`package.json\` version bumps automatically flow through to the CLI without any code edit.

Tool selection: runner=@agent-relay/sdk; concurrency=1; rule=project default runner @agent-relay/sdk.

Write .workflow-artifacts/generated/spec-ricky-version-reflects-the-installed-packag/review-codex.md ending with REVIEW_COMPLETE.`,
      verification: { type: 'file_exists', value: ".workflow-artifacts/generated/spec-ricky-version-reflects-the-installed-packag/review-codex.md" },
    })

    .step("read-review-feedback", {
      type: 'deterministic',
      dependsOn: ["review-claude", "review-codex"],
      command: "test -f '.workflow-artifacts/generated/spec-ricky-version-reflects-the-installed-packag/review-claude.md' && test -f '.workflow-artifacts/generated/spec-ricky-version-reflects-the-installed-packag/review-codex.md' && cat '.workflow-artifacts/generated/spec-ricky-version-reflects-the-installed-packag/review-claude.md' '.workflow-artifacts/generated/spec-ricky-version-reflects-the-installed-packag/review-codex.md' > '.workflow-artifacts/generated/spec-ricky-version-reflects-the-installed-packag/review-feedback.md'",
      captureOutput: true,
      failOnError: true,
    })

    .step('fix-loop', {
      agent: 'validator-claude',
      dependsOn: ['read-review-feedback'],

      task: `Run the 80-to-100 fix loop.

Inputs:
- .workflow-artifacts/generated/spec-ricky-version-reflects-the-installed-packag/review-feedback.md
- initial validation output from the previous deterministic step

Fix only concrete review or validation findings. Preserve the declared target boundary:
- dist/bin/ricky.js

Tool selection: runner=@agent-relay/sdk; concurrency=1; rule=project default runner @agent-relay/sdk.

Re-run typecheck and tests before handing off to post-fix validation.`,
    })

    .step("post-fix-verification-gate", {
      type: 'deterministic',
      dependsOn: ["fix-loop"],
      command: "test -f 'dist/bin/ricky.js' && node dist/bin/ricky.js --version | grep -Eq '^ricky [0-9]+\\.[0-9]+\\.[0-9]+$'",
      captureOutput: true,
      failOnError: true,
    })

    .step("post-fix-validation", {
      type: 'deterministic',
      dependsOn: ["post-fix-verification-gate"],
      command: "npx tsc --noEmit && npx vitest run",
      captureOutput: true,
      failOnError: false,
    })

    .step("final-review-claude", {
      agent: "reviewer-claude",
      dependsOn: ["post-fix-validation"],

      task: `Re-review the fixed state only.

Assess:
- declared file targets and non-goals
- deterministic gates and evidence quality
- review/fix/final-review 80-to-100 loop shape
- local/cloud/MCP routing clarity

Spec:
# Spec: \`ricky --version\` reflects the installed package version

## Problem

Running \`ricky --version\` (or \`-v\`, or \`version\`) prints \`ricky 0.0.0\` regardless of which version of \`@agentworkforce/ricky\` is installed. The string is hardcoded.

\`\`\`
$ ricky --version
ricky 0.0.0          # always — even when package.json says 0.1.0
\`\`\`

The default lives in \`src/surfaces/cli/commands/cli-main.ts\`:

\`\`\`ts
if (parsed.command === 'version') {
  const version = deps.version ?? '0.0.0';
  return { exitCode: 0, output: [\`ricky \${version}\`] };
}
\`\`\`

\`CliMainDeps.version\` exists for test injection, but the bin entry (\`src/bin/ricky.ts\`) calls \`cliMain()\` with no deps, so the fallback always wins. Nothing reads \`package.json\`.

## Why it matters

- Users filing issues report the wrong version, slowing diagnosis.
- After publishing 0.1.0 → 0.1.1 → … the CLI keeps lying.
- The published bin is the one users see; tests don't catch this because they inject a fake version.

## Behavior we want

\`ricky --version\` (and \`-v\`, \`version\`) prints \`ricky <version>\` where \`<version>\` is the \`version\` field of the package.json shipped with the installed package.

\`\`\`
$ ricky --version
ricky 0.1.0
\`\`\`

It must work in three contexts:

1. **Installed from npm** — bin runs from \`<prefix>/lib/node_modules/@agentworkforce/ricky/dist/bin/ricky.js\`; \`package.json\` sits at \`<that pkg root>/package.json\`.
2. **Local dev via \`npm start\`** — runs from source via tsx; \`package.json\` is at the repo root.
3. **Tests** — \`cliMain({ version: '9.9.9' })\` still wins (the injectable \`deps.version\` override stays the highest-priority source).

## Resolution order

1. \`deps.version\` if provided (test seam — unchanged)
2. The \`version\` field from the package.json that ships with the installed package
3. Fallback: \`'0.0.0'\` (only reached if the file cannot be read or parsed)

## Implementation notes

- The cli-main module already has \`import.meta.url\`; use it to locate the package root: walk up from \`dirname(fileURLToPath(import.meta.url))\` until a \`package.json\` with \`"name": "@agentworkforce/ricky"\` is found, then read \`version\`. Stop at the filesystem root.
- Read synchronously is fine here — version lookup happens once per invocation and only on the version path.
- Cache the result at module scope so repeated calls don't hit the filesystem.
- Do not require a build step (e.g. don't bake the version in via codegen) — keeping the lookup runtime keeps \`npm version\` bumps + \`prepack\` flow simple.
- \`tsconfig.build.json\` already excludes tests; no config change needed.

## Test cases

Add to \`src/surfaces/cli/commands/cli-main.test.ts\`:

1. \`cliMain({ argv: ['--version'], version: '9.9.9' })\` → output \`ricky 9.9.9\` (existing override seam still works).
2. With no \`version\` injected, \`cliMain({ argv: ['--version'] })\` returns \`ricky <X>\` where \`<X>\` matches the \`version\` from the repo's own \`package.json\`. Read it in the test via \`readFileSync\` so the assertion stays in sync with future bumps.
3. When package.json lookup fails (mock the reader to throw), output falls back to \`ricky 0.0.0\` and exit code stays \`0\` — version display should never break the CLI.

## Out of scope

- Adding a \`--verbose\` / build-info flag (commit SHA, build date). Track separately if wanted.
- Aligning \`npm start --version\` output formatting with the bin output (already identical — \`cliMain\` is shared).
- Reflecting \`@agent-relay/sdk\` or other dep versions in the output.

## Acceptance

- \`node dist/bin/ricky.js --version\` prints the version from \`package.json\`.
- All existing cli-main tests pass; the three new tests above pass.
- \`package.json\` version bumps automatically flow through to the CLI without any code edit.

Tool selection: runner=@agent-relay/sdk; concurrency=1; rule=project default runner @agent-relay/sdk.

Write .workflow-artifacts/generated/spec-ricky-version-reflects-the-installed-packag/final-review-claude.md ending with FINAL_REVIEW_CLAUDE_PASS.`,
      verification: { type: 'file_exists', value: ".workflow-artifacts/generated/spec-ricky-version-reflects-the-installed-packag/final-review-claude.md" },
    })

    .step("final-review-codex", {
      agent: "reviewer-codex",
      dependsOn: ["post-fix-validation"],

      task: `Re-review the fixed state only.

Assess:
- declared file targets and non-goals
- deterministic gates and evidence quality
- review/fix/final-review 80-to-100 loop shape
- local/cloud/MCP routing clarity

Spec:
# Spec: \`ricky --version\` reflects the installed package version

## Problem

Running \`ricky --version\` (or \`-v\`, or \`version\`) prints \`ricky 0.0.0\` regardless of which version of \`@agentworkforce/ricky\` is installed. The string is hardcoded.

\`\`\`
$ ricky --version
ricky 0.0.0          # always — even when package.json says 0.1.0
\`\`\`

The default lives in \`src/surfaces/cli/commands/cli-main.ts\`:

\`\`\`ts
if (parsed.command === 'version') {
  const version = deps.version ?? '0.0.0';
  return { exitCode: 0, output: [\`ricky \${version}\`] };
}
\`\`\`

\`CliMainDeps.version\` exists for test injection, but the bin entry (\`src/bin/ricky.ts\`) calls \`cliMain()\` with no deps, so the fallback always wins. Nothing reads \`package.json\`.

## Why it matters

- Users filing issues report the wrong version, slowing diagnosis.
- After publishing 0.1.0 → 0.1.1 → … the CLI keeps lying.
- The published bin is the one users see; tests don't catch this because they inject a fake version.

## Behavior we want

\`ricky --version\` (and \`-v\`, \`version\`) prints \`ricky <version>\` where \`<version>\` is the \`version\` field of the package.json shipped with the installed package.

\`\`\`
$ ricky --version
ricky 0.1.0
\`\`\`

It must work in three contexts:

1. **Installed from npm** — bin runs from \`<prefix>/lib/node_modules/@agentworkforce/ricky/dist/bin/ricky.js\`; \`package.json\` sits at \`<that pkg root>/package.json\`.
2. **Local dev via \`npm start\`** — runs from source via tsx; \`package.json\` is at the repo root.
3. **Tests** — \`cliMain({ version: '9.9.9' })\` still wins (the injectable \`deps.version\` override stays the highest-priority source).

## Resolution order

1. \`deps.version\` if provided (test seam — unchanged)
2. The \`version\` field from the package.json that ships with the installed package
3. Fallback: \`'0.0.0'\` (only reached if the file cannot be read or parsed)

## Implementation notes

- The cli-main module already has \`import.meta.url\`; use it to locate the package root: walk up from \`dirname(fileURLToPath(import.meta.url))\` until a \`package.json\` with \`"name": "@agentworkforce/ricky"\` is found, then read \`version\`. Stop at the filesystem root.
- Read synchronously is fine here — version lookup happens once per invocation and only on the version path.
- Cache the result at module scope so repeated calls don't hit the filesystem.
- Do not require a build step (e.g. don't bake the version in via codegen) — keeping the lookup runtime keeps \`npm version\` bumps + \`prepack\` flow simple.
- \`tsconfig.build.json\` already excludes tests; no config change needed.

## Test cases

Add to \`src/surfaces/cli/commands/cli-main.test.ts\`:

1. \`cliMain({ argv: ['--version'], version: '9.9.9' })\` → output \`ricky 9.9.9\` (existing override seam still works).
2. With no \`version\` injected, \`cliMain({ argv: ['--version'] })\` returns \`ricky <X>\` where \`<X>\` matches the \`version\` from the repo's own \`package.json\`. Read it in the test via \`readFileSync\` so the assertion stays in sync with future bumps.
3. When package.json lookup fails (mock the reader to throw), output falls back to \`ricky 0.0.0\` and exit code stays \`0\` — version display should never break the CLI.

## Out of scope

- Adding a \`--verbose\` / build-info flag (commit SHA, build date). Track separately if wanted.
- Aligning \`npm start --version\` output formatting with the bin output (already identical — \`cliMain\` is shared).
- Reflecting \`@agent-relay/sdk\` or other dep versions in the output.

## Acceptance

- \`node dist/bin/ricky.js --version\` prints the version from \`package.json\`.
- All existing cli-main tests pass; the three new tests above pass.
- \`package.json\` version bumps automatically flow through to the CLI without any code edit.

Tool selection: runner=@agent-relay/sdk; concurrency=1; rule=project default runner @agent-relay/sdk.

Write .workflow-artifacts/generated/spec-ricky-version-reflects-the-installed-packag/final-review-codex.md ending with FINAL_REVIEW_CODEX_PASS.`,
      verification: { type: 'file_exists', value: ".workflow-artifacts/generated/spec-ricky-version-reflects-the-installed-packag/final-review-codex.md" },
    })

    .step("final-review-pass-gate", {
      type: 'deterministic',
      dependsOn: ["final-review-claude", "final-review-codex"],
      command: "tail -n 1 '.workflow-artifacts/generated/spec-ricky-version-reflects-the-installed-packag/final-review-claude.md' | tr -d '[:space:]*' | grep -Eq '^FINAL_REVIEW_CLAUDE_PASS$' && tail -n 1 '.workflow-artifacts/generated/spec-ricky-version-reflects-the-installed-packag/final-review-codex.md' | tr -d '[:space:]*' | grep -Eq '^FINAL_REVIEW_CODEX_PASS$'",
      captureOutput: true,
      failOnError: true,
    })

    .step("final-hard-validation", {
      type: 'deterministic',
      dependsOn: ["final-review-pass-gate"],
      command: "npx tsc --noEmit && npx vitest run",
      captureOutput: true,
      failOnError: true,
    })

    .step("git-diff-gate", {
      type: 'deterministic',
      dependsOn: ["final-hard-validation"],
      command: "git diff --name-only -- 'dist/bin/ricky.js' > '.workflow-artifacts/generated/spec-ricky-version-reflects-the-installed-packag/git-diff.txt' && test -s '.workflow-artifacts/generated/spec-ricky-version-reflects-the-installed-packag/git-diff.txt'",
      captureOutput: true,
      failOnError: true,
    })

    .step("regression-gate", {
      type: 'deterministic',
      dependsOn: ["git-diff-gate"],
      command: "npx vitest run",
      captureOutput: true,
      failOnError: true,
    })

    .step('final-signoff', {
      agent: 'validator-claude',
      dependsOn: ['regression-gate'],

      task: `Write .workflow-artifacts/generated/spec-ricky-version-reflects-the-installed-packag/signoff.md.

Include:
- files changed
- dry-run command to execute before runtime launch
- deterministic validation commands
- review verdicts
- skill application boundary from .workflow-artifacts/generated/spec-ricky-version-reflects-the-installed-packag/skill-application-boundary.json
- remaining risks or environmental blockers

Tool selection: runner=@agent-relay/sdk; concurrency=1; rule=project default runner @agent-relay/sdk.

End with GENERATED_WORKFLOW_READY.`,
      verification: { type: 'file_exists', value: ".workflow-artifacts/generated/spec-ricky-version-reflects-the-installed-packag/signoff.md" },
    })

    .run({ cwd: process.cwd() });

  console.log(result.status);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
