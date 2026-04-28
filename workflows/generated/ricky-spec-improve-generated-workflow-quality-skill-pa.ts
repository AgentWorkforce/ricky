import { workflow } from '@agent-relay/sdk/workflows';

async function main() {
  const result = await workflow("ricky-spec-improve-generated-workflow-quality-skill-pa")
    .description("# Spec: Improve generated-workflow quality (skill-pack matcher, CLI-tool selector, optional LLM augmentation)\n\n## Problem\n\nRicky's `generate` step is fast (~milliseconds) because it's pure code: spec parser → pattern detector → template renderer → validator. No LLM, no network. That's a feature — most of the time you want a deterministic scaffold.\n\nBut the speed comes from skipping three decisions the renderer should be making, and the cost shows up in the produced workflow:\n\n1. **Skill matching is hardcoded.** `src/product/generation/skill-loader.ts` declares `AVAILABLE_PREREQUISITES = new Set(['@agent-relay/sdk', 'embedded-relay-typescript-template'])`. There's no actual matcher against the rich PRPM-style skill registry; the same two skills get loaded regardless of what the spec is about.\n\n2. **CLI-tool / agent selection is absent.** Generated workflows always use `@agent-relay/sdk` agent steps with no model or runtime choice. A spec that calls for `claude` (e.g. \"use Claude to refactor X\") or `codex` (e.g. \"have codex audit Y\") generates the same workflow shape — agent identity is left to runtime defaults.\n\n3. **Step task descriptions are echoed spec text.** The template renderer's slot-fillers paste the spec's prose into each agent step. For tightly-scoped specs that's enough; for vague specs the agents do all the heavy lifting at runtime, often with under-specified instructions.\n\n   This one bites in another way: deterministic gates generated from spec acceptance criteria can be too coarse. The current `--version` workflow generated `grep -Eq 'export|function|class|workflow(' dist/bin/ricky.js` as a post-implementation file gate, which fails on intentionally-minimal bin scripts that have none of those tokens. The grep was inferred from \"primary artifact\" without any behavioral grounding from the spec's actual acceptance text.\n\nWe need three additions: a skill matcher, a tool/agent selector, and an optional LLM-augmented refinement pass. All three should be additive — the fast deterministic path stays the default.\n\n## Behavior we want\n\n### 1. Skill-pack matcher\n\nReplace the hardcoded `AVAILABLE_PREREQUISITES` set with a registry-backed matcher in `src/product/generation/skill-matcher.ts`:\n\n- **Registry source**: read installed PRPM packages (or whatever the canonical skill registry is — `~/.claude/skills/` and project-local `skills/`). Cache the descriptor list at process start.\n- **Matching**: for each skill, evaluate its `description` and triggers (filename patterns, keyword lists, file-mentions in the spec) against the normalized spec. Return ranked matches with confidence scores.\n- **Selection**: pick the top N matches above a confidence threshold (default: 3 skills, ≥ 0.4 confidence). Ties broken by skill update-recency.\n- **Output**: each selected skill's `loaded-skills.txt` artifact lists the matched skill IDs and why they were chosen (the trigger that fired).\n\nSurfaces in the generated workflow as a `pre-implementation` step that loads the matched skills' SKILL.md files into the agent's context.\n\n### 2. CLI-tool / agent selector\n\nA `tool-selector.ts` companion that decides:\n\n- **Which CLI tool runs each agent step** (`claude` / `codex` / `cursor` / `opencode` / generic `@agent-relay/sdk`). Defaults to the project's agent-relay default; overrides come from explicit spec hints (`use claude to ...`) or skill-pack metadata (a skill can declare its preferred runner).\n- **Which model the runner targets**. Spec-level hints (`with sonnet`, `via opus 4.6`) override skill defaults override project defaults.\n- **Concurrency** for parallelizable steps — currently always 1.\n\nThe selector is consulted once per step during template rendering. Output: each `step()` call gets the right `agent` / `model` / `runner` fields.\n\n### 3. Optional LLM-augmented refinement (gated)\n\nA new `--refine` flag (alias `--with-llm`) that adds a single LLM pass after the deterministic render:\n\n```\nricky --mode local --spec-file my.md --refine\nricky --mode local --spec-file my.md --refine=sonnet  # explicit model\n```\n\nWithout `--refine`, behavior is unchanged — fast, deterministic, no model call.\n\nWith `--refine`, after the renderer produces an artifact:\n\n- Send the rendered artifact + the spec to a model with a focused prompt: *\"Refine this generated workflow's step task descriptions and acceptance gates to be specific and behavioral. Do not change the workflow shape, the agent assignments, or the step graph.\"*\n- Apply the returned diff (or reject if the model wandered outside the allowlist of editable regions).\n- Re-run the validator on the refined artifact.\n- Cost cap: hard timeout (45s) + token budget (configurable, default 50k input / 8k output). On overflow, return the deterministic artifact as-is and warn.\n\nDefault refinement model: Sonnet. Override via `--refine=<model>`.\n\nAcceptance test for this layer: a spec like the `--version` one would produce a `post-implementation-file-gate` whose command actually verifies `node dist/bin/ricky.js --version | grep -Eq '^ricky [0-9]+\\\\.[0-9]+\\\\.[0-9]+$'` (the spec's stated acceptance) instead of a generic source-shape grep.\n\n## Where these plug in\n\n- `src/product/generation/skill-matcher.ts` (new) — replaces the hardcoded set in `skill-loader.ts`.\n- `src/product/generation/tool-selector.ts` (new) — consulted from `template-renderer.ts` during slot fill.\n- `src/product/generation/refine-with-llm.ts` (new) — invoked from `pipeline.ts` after the existing render+validate, only when `--refine` is set.\n- `src/surfaces/cli/commands/cli-main.ts` — parse `--refine[=model]`, thread through the handoff.\n- `src/local/entrypoint.ts` `toRawSpecPayload` — already structured-json under the CLI sane-defaults change; adding a `refine` field is straightforward.\n\n## Output shape additions\n\nGenerated workflow context artifacts (`.workflow-artifacts/generated/<slug>/`):\n\n- `skill-matches.json` — ranked match list with confidence scores and trigger evidence (replaces the static `loaded-skills.txt`).\n- `tool-selection.json` — per-step tool/model/runner decisions and the rule that fired.\n- `refinement.json` (only when `--refine`) — `{ model, input_tokens, output_tokens, edited_regions, diff_size, validator_passed }`.\n\n`ricky --json` includes these in the response so callers can audit the decisions.\n\n## Test cases\n\nSkill matcher (`src/product/generation/skill-matcher.test.ts`):\n1. A spec that mentions \"github primitive\" matches the github skill above the relay-80-100 default.\n2. A spec with no skill-relevant content falls back to the project default (`writing-agent-relay-workflows`).\n3. Empty / missing skill registry → no skills loaded, no error, warning recorded.\n4. Confidence below threshold → not selected even if it's the top match.\n\nTool selector (`src/product/generation/tool-selector.test.ts`):\n1. Spec hint `\"use claude\"` → all agent steps get `runner: 'claude'`.\n2. Spec hint `\"with codex\"` on a single step → only that step gets `codex`, others stay default.\n3. Skill-pack metadata `preferredRunner: 'opencode'` → applied unless spec overrides.\n4. No hints → project default runner.\n\nRefinement (`src/product/generation/refine-with-llm.test.ts`):\n1. Refinement returns a valid edit that passes the validator → applied.\n2. Refinement edits outside the allowlist (changes the step graph) → rejected, warning, deterministic artifact returned unchanged.\n3. Refinement timeout → deterministic artifact returned, warning includes elapsed ms.\n4. Token budget exceeded → deterministic artifact returned, warning includes attempted vs max tokens.\n5. Model unavailable / API error → deterministic artifact returned, warning surfaced, exit code unchanged.\n\nEnd-to-end (manual):\n- `ricky --mode local --spec-file specs/cli-version-from-package-json.md` → fast deterministic artifact, today's behavior.\n- `... --refine` → same workflow shape but with sharper gate commands and step task descriptions tied to the spec's acceptance criteria.\n\n## Out of scope\n\n- Full agentic generation (LLM writes the workflow from scratch, not refines a scaffold). Different product, different latency budget.\n- Skill authoring tooling. Just consumption.\n- Cross-spec retrieval / RAG. The refinement pass sees only the spec + scaffold.\n- Caching refinement output across invocations.\n\n## Acceptance\n\n- Skill matcher selects from the actual skill registry; same `--version` spec selects different skills than a \"github webhook handler\" spec.\n- Tool selector produces per-step runner/model assignments visible in `tool-selection.json`.\n- `ricky --refine` produces a refined artifact whose deterministic gates align with the spec's stated acceptance criteria. The unrefined path stays bit-for-bit unchanged.\n- All existing generation tests still pass; ~14 new tests above pass.\n- A vague spec that today produces a passable scaffold and a tightly-scoped one (like `--version`) that today produces a *near-correct* scaffold both produce *behavior-grounded* gates after `--refine`.")
    .pattern("dag")
    .channel("wf-ricky-spec-improve-generated-workflow-quality-skill-pa")
    .maxConcurrency(4)
    .timeout(600000)
    .onError('retry', { maxRetries: 2, retryDelayMs: 1000 })

    .agent("lead-claude", { cli: "claude", role: "Plans task shape, ownership, non-goals, and verification gates.", retries: 1 })
    .agent("impl-primary-codex", { cli: "codex", role: "Primary implementer for independent file slices and code changes.", retries: 2 })
    .agent("impl-tests-codex", { cli: "codex", role: "Adds or updates tests and validation coverage for the changed surface.", retries: 2 })
    .agent("reviewer-claude", { cli: "claude", preset: "reviewer", role: "Reviews product fit, scope control, and workflow evidence quality.", retries: 1 })
    .agent("reviewer-codex", { cli: "codex", preset: "reviewer", role: "Reviews TypeScript correctness, deterministic gates, and test coverage.", retries: 1 })
    .agent("validator-claude", { cli: "claude", preset: "worker", role: "Runs the 80-to-100 fix loop and verifies final readiness.", retries: 2 })

    .step("prepare-context", {
      type: 'deterministic',
      command: "mkdir -p '.workflow-artifacts/generated/spec-improve-generated-workflow-quality-skill-pa' && printf '%s\\n' '# Spec: Improve generated-workflow quality (skill-pack matcher, CLI-tool selector, optional LLM augmentation)\n\n## Problem\n\nRicky'\\''s `generate` step is fast (~milliseconds) because it'\\''s pure code: spec parser → pattern detector → template renderer → validator. No LLM, no network. That'\\''s a feature — most of the time you want a deterministic scaffold.\n\nBut the speed comes from skipping three decisions the renderer should be making, and the cost shows up in the produced workflow:\n\n1. **Skill matching is hardcoded.** `src/product/generation/skill-loader.ts` declares `AVAILABLE_PREREQUISITES = new Set(['\\''@agent-relay/sdk'\\'', '\\''embedded-relay-typescript-template'\\''])`. There'\\''s no actual matcher against the rich PRPM-style skill registry; the same two skills get loaded regardless of what the spec is about.\n\n2. **CLI-tool / agent selection is absent.** Generated workflows always use `@agent-relay/sdk` agent steps with no model or runtime choice. A spec that calls for `claude` (e.g. \"use Claude to refactor X\") or `codex` (e.g. \"have codex audit Y\") generates the same workflow shape — agent identity is left to runtime defaults.\n\n3. **Step task descriptions are echoed spec text.** The template renderer'\\''s slot-fillers paste the spec'\\''s prose into each agent step. For tightly-scoped specs that'\\''s enough; for vague specs the agents do all the heavy lifting at runtime, often with under-specified instructions.\n\n   This one bites in another way: deterministic gates generated from spec acceptance criteria can be too coarse. The current `--version` workflow generated `grep -Eq '\\''export|function|class|workflow('\\'' dist/bin/ricky.js` as a post-implementation file gate, which fails on intentionally-minimal bin scripts that have none of those tokens. The grep was inferred from \"primary artifact\" without any behavioral grounding from the spec'\\''s actual acceptance text.\n\nWe need three additions: a skill matcher, a tool/agent selector, and an optional LLM-augmented refinement pass. All three should be additive — the fast deterministic path stays the default.\n\n## Behavior we want\n\n### 1. Skill-pack matcher\n\nReplace the hardcoded `AVAILABLE_PREREQUISITES` set with a registry-backed matcher in `src/product/generation/skill-matcher.ts`:\n\n- **Registry source**: read installed PRPM packages (or whatever the canonical skill registry is — `~/.claude/skills/` and project-local `skills/`). Cache the descriptor list at process start.\n- **Matching**: for each skill, evaluate its `description` and triggers (filename patterns, keyword lists, file-mentions in the spec) against the normalized spec. Return ranked matches with confidence scores.\n- **Selection**: pick the top N matches above a confidence threshold (default: 3 skills, ≥ 0.4 confidence). Ties broken by skill update-recency.\n- **Output**: each selected skill'\\''s `loaded-skills.txt` artifact lists the matched skill IDs and why they were chosen (the trigger that fired).\n\nSurfaces in the generated workflow as a `pre-implementation` step that loads the matched skills'\\'' SKILL.md files into the agent'\\''s context.\n\n### 2. CLI-tool / agent selector\n\nA `tool-selector.ts` companion that decides:\n\n- **Which CLI tool runs each agent step** (`claude` / `codex` / `cursor` / `opencode` / generic `@agent-relay/sdk`). Defaults to the project'\\''s agent-relay default; overrides come from explicit spec hints (`use claude to ...`) or skill-pack metadata (a skill can declare its preferred runner).\n- **Which model the runner targets**. Spec-level hints (`with sonnet`, `via opus 4.6`) override skill defaults override project defaults.\n- **Concurrency** for parallelizable steps — currently always 1.\n\nThe selector is consulted once per step during template rendering. Output: each `step()` call gets the right `agent` / `model` / `runner` fields.\n\n### 3. Optional LLM-augmented refinement (gated)\n\nA new `--refine` flag (alias `--with-llm`) that adds a single LLM pass after the deterministic render:\n\n```\nricky --mode local --spec-file my.md --refine\nricky --mode local --spec-file my.md --refine=sonnet  # explicit model\n```\n\nWithout `--refine`, behavior is unchanged — fast, deterministic, no model call.\n\nWith `--refine`, after the renderer produces an artifact:\n\n- Send the rendered artifact + the spec to a model with a focused prompt: *\"Refine this generated workflow'\\''s step task descriptions and acceptance gates to be specific and behavioral. Do not change the workflow shape, the agent assignments, or the step graph.\"*\n- Apply the returned diff (or reject if the model wandered outside the allowlist of editable regions).\n- Re-run the validator on the refined artifact.\n- Cost cap: hard timeout (45s) + token budget (configurable, default 50k input / 8k output). On overflow, return the deterministic artifact as-is and warn.\n\nDefault refinement model: Sonnet. Override via `--refine=<model>`.\n\nAcceptance test for this layer: a spec like the `--version` one would produce a `post-implementation-file-gate` whose command actually verifies `node dist/bin/ricky.js --version | grep -Eq '\\''^ricky [0-9]+\\\\.[0-9]+\\\\.[0-9]+$'\\''` (the spec'\\''s stated acceptance) instead of a generic source-shape grep.\n\n## Where these plug in\n\n- `src/product/generation/skill-matcher.ts` (new) — replaces the hardcoded set in `skill-loader.ts`.\n- `src/product/generation/tool-selector.ts` (new) — consulted from `template-renderer.ts` during slot fill.\n- `src/product/generation/refine-with-llm.ts` (new) — invoked from `pipeline.ts` after the existing render+validate, only when `--refine` is set.\n- `src/surfaces/cli/commands/cli-main.ts` — parse `--refine[=model]`, thread through the handoff.\n- `src/local/entrypoint.ts` `toRawSpecPayload` — already structured-json under the CLI sane-defaults change; adding a `refine` field is straightforward.\n\n## Output shape additions\n\nGenerated workflow context artifacts (`.workflow-artifacts/generated/<slug>/`):\n\n- `skill-matches.json` — ranked match list with confidence scores and trigger evidence (replaces the static `loaded-skills.txt`).\n- `tool-selection.json` — per-step tool/model/runner decisions and the rule that fired.\n- `refinement.json` (only when `--refine`) — `{ model, input_tokens, output_tokens, edited_regions, diff_size, validator_passed }`.\n\n`ricky --json` includes these in the response so callers can audit the decisions.\n\n## Test cases\n\nSkill matcher (`src/product/generation/skill-matcher.test.ts`):\n1. A spec that mentions \"github primitive\" matches the github skill above the relay-80-100 default.\n2. A spec with no skill-relevant content falls back to the project default (`writing-agent-relay-workflows`).\n3. Empty / missing skill registry → no skills loaded, no error, warning recorded.\n4. Confidence below threshold → not selected even if it'\\''s the top match.\n\nTool selector (`src/product/generation/tool-selector.test.ts`):\n1. Spec hint `\"use claude\"` → all agent steps get `runner: '\\''claude'\\''`.\n2. Spec hint `\"with codex\"` on a single step → only that step gets `codex`, others stay default.\n3. Skill-pack metadata `preferredRunner: '\\''opencode'\\''` → applied unless spec overrides.\n4. No hints → project default runner.\n\nRefinement (`src/product/generation/refine-with-llm.test.ts`):\n1. Refinement returns a valid edit that passes the validator → applied.\n2. Refinement edits outside the allowlist (changes the step graph) → rejected, warning, deterministic artifact returned unchanged.\n3. Refinement timeout → deterministic artifact returned, warning includes elapsed ms.\n4. Token budget exceeded → deterministic artifact returned, warning includes attempted vs max tokens.\n5. Model unavailable / API error → deterministic artifact returned, warning surfaced, exit code unchanged.\n\nEnd-to-end (manual):\n- `ricky --mode local --spec-file specs/cli-version-from-package-json.md` → fast deterministic artifact, today'\\''s behavior.\n- `... --refine` → same workflow shape but with sharper gate commands and step task descriptions tied to the spec'\\''s acceptance criteria.\n\n## Out of scope\n\n- Full agentic generation (LLM writes the workflow from scratch, not refines a scaffold). Different product, different latency budget.\n- Skill authoring tooling. Just consumption.\n- Cross-spec retrieval / RAG. The refinement pass sees only the spec + scaffold.\n- Caching refinement output across invocations.\n\n## Acceptance\n\n- Skill matcher selects from the actual skill registry; same `--version` spec selects different skills than a \"github webhook handler\" spec.\n- Tool selector produces per-step runner/model assignments visible in `tool-selection.json`.\n- `ricky --refine` produces a refined artifact whose deterministic gates align with the spec'\\''s stated acceptance criteria. The unrefined path stays bit-for-bit unchanged.\n- All existing generation tests still pass; ~14 new tests above pass.\n- A vague spec that today produces a passable scaffold and a tightly-scoped one (like `--version`) that today produces a *near-correct* scaffold both produce *behavior-grounded* gates after `--refine`.' > '.workflow-artifacts/generated/spec-improve-generated-workflow-quality-skill-pa/normalized-spec.txt' && printf '%s\\n' 'pattern=dag; reason=Selected dag because the request is high risk and benefits from parallel implementation, review, and validation gates.' > '.workflow-artifacts/generated/spec-improve-generated-workflow-quality-skill-pa/pattern-decision.txt' && printf '%s\\n' 'relay-80-100-workflow,writing-agent-relay-workflows,choosing-swarm-patterns' > '.workflow-artifacts/generated/spec-improve-generated-workflow-quality-skill-pa/loaded-skills.txt' && printf '%s\\n' '[{\"id\":\"relay-80-100-workflow\",\"name\":\"relay-80-100-workflow\",\"path\":\"/Users/khaliqgant/Projects/AgentWorkforce/ricky/.claude/skills/relay-80-100-workflow/SKILL.md\",\"confidence\":1,\"reason\":\"Spec text mentions \\\"writing\\\". Spec text mentions \\\"agent-relay\\\". Spec text mentions \\\"workflows\\\". Spec text mentions \\\"validate\\\". Spec text mentions \\\"end-to-end\\\". Spec text mentions \\\"pattern\\\". Spec text mentions \\\"code\\\". Spec text mentions \\\"feature\\\". Spec text mentions \\\"includes\\\". Spec text mentions \\\"patterns\\\". Spec text mentions \\\"gates\\\". Spec text mentions \\\"after\\\". Spec text mentions \\\"edit\\\". Spec text mentions \\\"full\\\". Spec text mentions \\\"implementation\\\". Spec text mentions \\\"through\\\". Spec text mentions \\\"tests\\\".\",\"evidence\":[{\"trigger\":\"writing\",\"source\":\"keyword\",\"detail\":\"Spec text mentions \\\"writing\\\".\"},{\"trigger\":\"agent-relay\",\"source\":\"keyword\",\"detail\":\"Spec text mentions \\\"agent-relay\\\".\"},{\"trigger\":\"workflows\",\"source\":\"keyword\",\"detail\":\"Spec text mentions \\\"workflows\\\".\"},{\"trigger\":\"validate\",\"source\":\"keyword\",\"detail\":\"Spec text mentions \\\"validate\\\".\"},{\"trigger\":\"end-to-end\",\"source\":\"keyword\",\"detail\":\"Spec text mentions \\\"end-to-end\\\".\"},{\"trigger\":\"pattern\",\"source\":\"keyword\",\"detail\":\"Spec text mentions \\\"pattern\\\".\"},{\"trigger\":\"code\",\"source\":\"keyword\",\"detail\":\"Spec text mentions \\\"code\\\".\"},{\"trigger\":\"feature\",\"source\":\"keyword\",\"detail\":\"Spec text mentions \\\"feature\\\".\"},{\"trigger\":\"includes\",\"source\":\"keyword\",\"detail\":\"Spec text mentions \\\"includes\\\".\"},{\"trigger\":\"patterns\",\"source\":\"keyword\",\"detail\":\"Spec text mentions \\\"patterns\\\".\"},{\"trigger\":\"gates\",\"source\":\"keyword\",\"detail\":\"Spec text mentions \\\"gates\\\".\"},{\"trigger\":\"after\",\"source\":\"keyword\",\"detail\":\"Spec text mentions \\\"after\\\".\"},{\"trigger\":\"edit\",\"source\":\"keyword\",\"detail\":\"Spec text mentions \\\"edit\\\".\"},{\"trigger\":\"full\",\"source\":\"keyword\",\"detail\":\"Spec text mentions \\\"full\\\".\"},{\"trigger\":\"implementation\",\"source\":\"keyword\",\"detail\":\"Spec text mentions \\\"implementation\\\".\"},{\"trigger\":\"through\",\"source\":\"keyword\",\"detail\":\"Spec text mentions \\\"through\\\".\"},{\"trigger\":\"tests\",\"source\":\"keyword\",\"detail\":\"Spec text mentions \\\"tests\\\".\"}],\"updatedAt\":\"2026-04-27T18:17:53.946Z\"},{\"id\":\"writing-agent-relay-workflows\",\"name\":\"writing-agent-relay-workflows\",\"path\":\"/Users/khaliqgant/Projects/AgentWorkforce/ricky/.claude/skills/writing-agent-relay-workflows/SKILL.md\",\"confidence\":1,\"reason\":\"Spec text mentions \\\"writing-agent-relay-workflows\\\". Spec text mentions \\\"workflows\\\". Spec text mentions \\\"relay\\\". Spec text mentions \\\"step\\\". Spec text mentions \\\"agent\\\". Spec text mentions \\\"output\\\". Spec text mentions \\\"gates\\\". Spec text mentions \\\"decisions\\\". Spec text mentions \\\"patterns\\\". Spec text mentions \\\"error\\\". Spec text mentions \\\"authoring\\\". Spec text mentions \\\"pattern\\\". Spec text mentions \\\"steps\\\".\",\"evidence\":[{\"trigger\":\"writing-agent-relay-workflows\",\"source\":\"keyword\",\"detail\":\"Spec text mentions \\\"writing-agent-relay-workflows\\\".\"},{\"trigger\":\"workflows\",\"source\":\"keyword\",\"detail\":\"Spec text mentions \\\"workflows\\\".\"},{\"trigger\":\"relay\",\"source\":\"keyword\",\"detail\":\"Spec text mentions \\\"relay\\\".\"},{\"trigger\":\"step\",\"source\":\"keyword\",\"detail\":\"Spec text mentions \\\"step\\\".\"},{\"trigger\":\"agent\",\"source\":\"keyword\",\"detail\":\"Spec text mentions \\\"agent\\\".\"},{\"trigger\":\"output\",\"source\":\"keyword\",\"detail\":\"Spec text mentions \\\"output\\\".\"},{\"trigger\":\"gates\",\"source\":\"keyword\",\"detail\":\"Spec text mentions \\\"gates\\\".\"},{\"trigger\":\"decisions\",\"source\":\"keyword\",\"detail\":\"Spec text mentions \\\"decisions\\\".\"},{\"trigger\":\"patterns\",\"source\":\"keyword\",\"detail\":\"Spec text mentions \\\"patterns\\\".\"},{\"trigger\":\"error\",\"source\":\"keyword\",\"detail\":\"Spec text mentions \\\"error\\\".\"},{\"trigger\":\"authoring\",\"source\":\"keyword\",\"detail\":\"Spec text mentions \\\"authoring\\\".\"},{\"trigger\":\"pattern\",\"source\":\"keyword\",\"detail\":\"Spec text mentions \\\"pattern\\\".\"},{\"trigger\":\"steps\",\"source\":\"keyword\",\"detail\":\"Spec text mentions \\\"steps\\\".\"}],\"updatedAt\":\"2026-04-27T18:17:52.355Z\"},{\"id\":\"choosing-swarm-patterns\",\"name\":\"choosing-swarm-patterns\",\"path\":\"/Users/khaliqgant/Projects/AgentWorkforce/ricky/.claude/skills/choosing-swarm-patterns/SKILL.md\",\"confidence\":1,\"reason\":\"Spec text mentions \\\"agents\\\". Spec text mentions \\\"agent\\\". Spec text mentions \\\"relay\\\". Spec text mentions \\\"workflow\\\". Spec text mentions \\\"pick\\\". Spec text mentions \\\"right\\\". Spec text mentions \\\"pattern\\\". Spec text mentions \\\"core\\\". Spec text mentions \\\"patterns\\\". Spec text mentions \\\"pipeline\\\". Spec text mentions \\\"handoff\\\". Spec text mentions \\\"decision\\\".\",\"evidence\":[{\"trigger\":\"agents\",\"source\":\"keyword\",\"detail\":\"Spec text mentions \\\"agents\\\".\"},{\"trigger\":\"agent\",\"source\":\"keyword\",\"detail\":\"Spec text mentions \\\"agent\\\".\"},{\"trigger\":\"relay\",\"source\":\"keyword\",\"detail\":\"Spec text mentions \\\"relay\\\".\"},{\"trigger\":\"workflow\",\"source\":\"keyword\",\"detail\":\"Spec text mentions \\\"workflow\\\".\"},{\"trigger\":\"pick\",\"source\":\"keyword\",\"detail\":\"Spec text mentions \\\"pick\\\".\"},{\"trigger\":\"right\",\"source\":\"keyword\",\"detail\":\"Spec text mentions \\\"right\\\".\"},{\"trigger\":\"pattern\",\"source\":\"keyword\",\"detail\":\"Spec text mentions \\\"pattern\\\".\"},{\"trigger\":\"core\",\"source\":\"keyword\",\"detail\":\"Spec text mentions \\\"core\\\".\"},{\"trigger\":\"patterns\",\"source\":\"keyword\",\"detail\":\"Spec text mentions \\\"patterns\\\".\"},{\"trigger\":\"pipeline\",\"source\":\"keyword\",\"detail\":\"Spec text mentions \\\"pipeline\\\".\"},{\"trigger\":\"handoff\",\"source\":\"keyword\",\"detail\":\"Spec text mentions \\\"handoff\\\".\"},{\"trigger\":\"decision\",\"source\":\"keyword\",\"detail\":\"Spec text mentions \\\"decision\\\".\"}],\"updatedAt\":\"2026-04-27T18:17:50.596Z\"}]' > '.workflow-artifacts/generated/spec-improve-generated-workflow-quality-skill-pa/skill-matches.json' && printf '%s\\n' '[{\"stepId\":\"lead-plan\",\"agent\":\"lead-claude\",\"runner\":\"@agent-relay/sdk\",\"concurrency\":1,\"rule\":\"project default runner @agent-relay/sdk\"},{\"stepId\":\"implement-artifact\",\"agent\":\"impl-primary-codex\",\"runner\":\"@agent-relay/sdk\",\"concurrency\":2,\"rule\":\"project default runner @agent-relay/sdk\"},{\"stepId\":\"review-claude\",\"agent\":\"reviewer-claude\",\"runner\":\"@agent-relay/sdk\",\"concurrency\":2,\"rule\":\"project default runner @agent-relay/sdk\"},{\"stepId\":\"review-codex\",\"agent\":\"reviewer-codex\",\"runner\":\"@agent-relay/sdk\",\"concurrency\":2,\"rule\":\"project default runner @agent-relay/sdk\"},{\"stepId\":\"fix-loop\",\"agent\":\"validator-claude\",\"runner\":\"@agent-relay/sdk\",\"concurrency\":1,\"rule\":\"project default runner @agent-relay/sdk\"},{\"stepId\":\"final-review-claude\",\"agent\":\"reviewer-claude\",\"runner\":\"@agent-relay/sdk\",\"concurrency\":2,\"rule\":\"project default runner @agent-relay/sdk\"},{\"stepId\":\"final-review-codex\",\"agent\":\"reviewer-codex\",\"runner\":\"@agent-relay/sdk\",\"concurrency\":2,\"rule\":\"project default runner @agent-relay/sdk\"},{\"stepId\":\"final-signoff\",\"agent\":\"validator-claude\",\"runner\":\"@agent-relay/sdk\",\"concurrency\":1,\"rule\":\"project default runner @agent-relay/sdk\"}]' > '.workflow-artifacts/generated/spec-improve-generated-workflow-quality-skill-pa/tool-selection.json' && printf '%s\\n' '{\"behavior\":\"generation_time_only\",\"runtimeEmbodiment\":false,\"boundary\":\"Skills influence Ricky generator selection, loading, template rendering, workflow contract, validation gates, and metadata. Generated runtime agents receive only the rendered workflow instructions; they do not load or embody skill files at runtime.\",\"loadedSkills\":[\"relay-80-100-workflow\",\"writing-agent-relay-workflows\",\"choosing-swarm-patterns\"],\"applicationEvidence\":[{\"skillName\":\"relay-80-100-workflow\",\"stage\":\"generation_selection\",\"effect\":\"workflow_contract\",\"behavior\":\"generation_time_only\",\"runtimeEmbodiment\":false,\"evidence\":\"Selected relay-80-100-workflow during workflow generation. Spec text mentions \\\"writing\\\". Spec text mentions \\\"agent-relay\\\". Spec text mentions \\\"workflows\\\". Spec text mentions \\\"validate\\\". Spec text mentions \\\"end-to-end\\\". Spec text mentions \\\"pattern\\\". Spec text mentions \\\"code\\\". Spec text mentions \\\"feature\\\". Spec text mentions \\\"includes\\\". Spec text mentions \\\"patterns\\\". Spec text mentions \\\"gates\\\". Spec text mentions \\\"after\\\". Spec text mentions \\\"edit\\\". Spec text mentions \\\"full\\\". Spec text mentions \\\"implementation\\\". Spec text mentions \\\"through\\\". Spec text mentions \\\"tests\\\".\"},{\"skillName\":\"relay-80-100-workflow\",\"stage\":\"generation_loading\",\"effect\":\"metadata\",\"behavior\":\"generation_time_only\",\"runtimeEmbodiment\":false,\"evidence\":\"Loaded relay-80-100-workflow descriptor from /Users/khaliqgant/Projects/AgentWorkforce/ricky/.claude/skills/relay-80-100-workflow/SKILL.md before template rendering.\"},{\"skillName\":\"writing-agent-relay-workflows\",\"stage\":\"generation_selection\",\"effect\":\"workflow_contract\",\"behavior\":\"generation_time_only\",\"runtimeEmbodiment\":false,\"evidence\":\"Selected writing-agent-relay-workflows during workflow generation. Spec text mentions \\\"writing-agent-relay-workflows\\\". Spec text mentions \\\"workflows\\\". Spec text mentions \\\"relay\\\". Spec text mentions \\\"step\\\". Spec text mentions \\\"agent\\\". Spec text mentions \\\"output\\\". Spec text mentions \\\"gates\\\". Spec text mentions \\\"decisions\\\". Spec text mentions \\\"patterns\\\". Spec text mentions \\\"error\\\". Spec text mentions \\\"authoring\\\". Spec text mentions \\\"pattern\\\". Spec text mentions \\\"steps\\\".\"},{\"skillName\":\"writing-agent-relay-workflows\",\"stage\":\"generation_loading\",\"effect\":\"metadata\",\"behavior\":\"generation_time_only\",\"runtimeEmbodiment\":false,\"evidence\":\"Loaded writing-agent-relay-workflows descriptor from /Users/khaliqgant/Projects/AgentWorkforce/ricky/.claude/skills/writing-agent-relay-workflows/SKILL.md before template rendering.\"},{\"skillName\":\"choosing-swarm-patterns\",\"stage\":\"generation_selection\",\"effect\":\"workflow_contract\",\"behavior\":\"generation_time_only\",\"runtimeEmbodiment\":false,\"evidence\":\"Selected choosing-swarm-patterns during workflow generation. Spec text mentions \\\"agents\\\". Spec text mentions \\\"agent\\\". Spec text mentions \\\"relay\\\". Spec text mentions \\\"workflow\\\". Spec text mentions \\\"pick\\\". Spec text mentions \\\"right\\\". Spec text mentions \\\"pattern\\\". Spec text mentions \\\"core\\\". Spec text mentions \\\"patterns\\\". Spec text mentions \\\"pipeline\\\". Spec text mentions \\\"handoff\\\". Spec text mentions \\\"decision\\\".\"},{\"skillName\":\"choosing-swarm-patterns\",\"stage\":\"generation_loading\",\"effect\":\"metadata\",\"behavior\":\"generation_time_only\",\"runtimeEmbodiment\":false,\"evidence\":\"Loaded choosing-swarm-patterns descriptor from /Users/khaliqgant/Projects/AgentWorkforce/ricky/.claude/skills/choosing-swarm-patterns/SKILL.md before template rendering.\"},{\"skillName\":\"writing-agent-relay-workflows\",\"stage\":\"generation_rendering\",\"effect\":\"workflow_contract\",\"behavior\":\"generation_time_only\",\"runtimeEmbodiment\":false,\"evidence\":\"Rendered 10 workflow tasks with dedicated channel setup, explicit agents, step dependencies, review stages, and final signoff.\"},{\"skillName\":\"relay-80-100-workflow\",\"stage\":\"generation_rendering\",\"effect\":\"validation_gates\",\"behavior\":\"generation_time_only\",\"runtimeEmbodiment\":false,\"evidence\":\"Rendered 9 deterministic gates including initial soft validation, fix-loop checks, final hard validation, git diff, and regression gates.\"}]}' > '.workflow-artifacts/generated/spec-improve-generated-workflow-quality-skill-pa/skill-application-boundary.json' && printf '%s\\n' 'Skills influence Ricky generator selection, loading, template rendering, workflow contract, validation gates, and metadata. Generated runtime agents receive only the rendered workflow instructions; they do not load or embody skill files at runtime.' > '.workflow-artifacts/generated/spec-improve-generated-workflow-quality-skill-pa/skill-runtime-boundary.txt' && echo GENERATED_WORKFLOW_CONTEXT_READY",
      captureOutput: true,
      failOnError: true,
    })

    .step("skill-boundary-metadata-gate", {
      type: 'deterministic',
      dependsOn: ["prepare-context"],
      command: "test -f '.workflow-artifacts/generated/spec-improve-generated-workflow-quality-skill-pa/skill-application-boundary.json' && test -f '.workflow-artifacts/generated/spec-improve-generated-workflow-quality-skill-pa/skill-matches.json' && test -f '.workflow-artifacts/generated/spec-improve-generated-workflow-quality-skill-pa/tool-selection.json' && grep -F 'generation_time_only' '.workflow-artifacts/generated/spec-improve-generated-workflow-quality-skill-pa/skill-application-boundary.json' && grep -F '\"runtimeEmbodiment\":false' '.workflow-artifacts/generated/spec-improve-generated-workflow-quality-skill-pa/skill-application-boundary.json' && grep -F 'relay-80-100-workflow' '.workflow-artifacts/generated/spec-improve-generated-workflow-quality-skill-pa/skill-application-boundary.json' && grep -F 'writing-agent-relay-workflows' '.workflow-artifacts/generated/spec-improve-generated-workflow-quality-skill-pa/skill-application-boundary.json' && grep -F 'choosing-swarm-patterns' '.workflow-artifacts/generated/spec-improve-generated-workflow-quality-skill-pa/skill-application-boundary.json' && grep -F '\"stage\":\"generation_selection\"' '.workflow-artifacts/generated/spec-improve-generated-workflow-quality-skill-pa/skill-application-boundary.json' && grep -F '\"stage\":\"generation_loading\"' '.workflow-artifacts/generated/spec-improve-generated-workflow-quality-skill-pa/skill-application-boundary.json' && grep -F '\"effect\":\"metadata\"' '.workflow-artifacts/generated/spec-improve-generated-workflow-quality-skill-pa/skill-application-boundary.json' && grep -F '\"stage\":\"generation_rendering\"' '.workflow-artifacts/generated/spec-improve-generated-workflow-quality-skill-pa/skill-application-boundary.json' && grep -F '\"effect\":\"workflow_contract\"' '.workflow-artifacts/generated/spec-improve-generated-workflow-quality-skill-pa/skill-application-boundary.json' && grep -F '\"stage\":\"generation_rendering\"' '.workflow-artifacts/generated/spec-improve-generated-workflow-quality-skill-pa/skill-application-boundary.json' && grep -F '\"effect\":\"validation_gates\"' '.workflow-artifacts/generated/spec-improve-generated-workflow-quality-skill-pa/skill-application-boundary.json'",
      captureOutput: true,
      failOnError: true,
    })

    .step('lead-plan', {
      agent: 'lead-claude',
      dependsOn: ['skill-boundary-metadata-gate'],
      task: `Plan the workflow execution from the normalized spec.

Generation-time skill boundary:
- Read .workflow-artifacts/generated/spec-improve-generated-workflow-quality-skill-pa/skill-application-boundary.json and treat it as generator metadata only.
- Skills are applied by Ricky during selection, loading, and template rendering.
- Do not claim generated agents load, retain, or embody skill files at runtime unless a future runtime test proves that path.

Description:
# Spec: Improve generated-workflow quality (skill-pack matcher, CLI-tool selector, optional LLM augmentation)

## Problem

Ricky's \`generate\` step is fast (~milliseconds) because it's pure code: spec parser → pattern detector → template renderer → validator. No LLM, no network. That's a feature — most of the time you want a deterministic scaffold.

But the speed comes from skipping three decisions the renderer should be making, and the cost shows up in the produced workflow:

1. **Skill matching is hardcoded.** \`src/product/generation/skill-loader.ts\` declares \`AVAILABLE_PREREQUISITES = new Set(['@agent-relay/sdk', 'embedded-relay-typescript-template'])\`. There's no actual matcher against the rich PRPM-style skill registry; the same two skills get loaded regardless of what the spec is about.

2. **CLI-tool / agent selection is absent.** Generated workflows always use \`@agent-relay/sdk\` agent steps with no model or runtime choice. A spec that calls for \`claude\` (e.g. "use Claude to refactor X") or \`codex\` (e.g. "have codex audit Y") generates the same workflow shape — agent identity is left to runtime defaults.

3. **Step task descriptions are echoed spec text.** The template renderer's slot-fillers paste the spec's prose into each agent step. For tightly-scoped specs that's enough; for vague specs the agents do all the heavy lifting at runtime, often with under-specified instructions.

   This one bites in another way: deterministic gates generated from spec acceptance criteria can be too coarse. The current \`--version\` workflow generated \`grep -Eq 'export|function|class|workflow(' dist/bin/ricky.js\` as a post-implementation file gate, which fails on intentionally-minimal bin scripts that have none of those tokens. The grep was inferred from "primary artifact" without any behavioral grounding from the spec's actual acceptance text.

We need three additions: a skill matcher, a tool/agent selector, and an optional LLM-augmented refinement pass. All three should be additive — the fast deterministic path stays the default.

## Behavior we want

### 1. Skill-pack matcher

Replace the hardcoded \`AVAILABLE_PREREQUISITES\` set with a registry-backed matcher in \`src/product/generation/skill-matcher.ts\`:

- **Registry source**: read installed PRPM packages (or whatever the canonical skill registry is — \`~/.claude/skills/\` and project-local \`skills/\`). Cache the descriptor list at process start.
- **Matching**: for each skill, evaluate its \`description\` and triggers (filename patterns, keyword lists, file-mentions in the spec) against the normalized spec. Return ranked matches with confidence scores.
- **Selection**: pick the top N matches above a confidence threshold (default: 3 skills, ≥ 0.4 confidence). Ties broken by skill update-recency.
- **Output**: each selected skill's \`loaded-skills.txt\` artifact lists the matched skill IDs and why they were chosen (the trigger that fired).

Surfaces in the generated workflow as a \`pre-implementation\` step that loads the matched skills' SKILL.md files into the agent's context.

### 2. CLI-tool / agent selector

A \`tool-selector.ts\` companion that decides:

- **Which CLI tool runs each agent step** (\`claude\` / \`codex\` / \`cursor\` / \`opencode\` / generic \`@agent-relay/sdk\`). Defaults to the project's agent-relay default; overrides come from explicit spec hints (\`use claude to ...\`) or skill-pack metadata (a skill can declare its preferred runner).
- **Which model the runner targets**. Spec-level hints (\`with sonnet\`, \`via opus 4.6\`) override skill defaults override project defaults.
- **Concurrency** for parallelizable steps — currently always 1.

The selector is consulted once per step during template rendering. Output: each \`step()\` call gets the right \`agent\` / \`model\` / \`runner\` fields.

### 3. Optional LLM-augmented refinement (gated)

A new \`--refine\` flag (alias \`--with-llm\`) that adds a single LLM pass after the deterministic render:

\`\`\`
ricky --mode local --spec-file my.md --refine
ricky --mode local --spec-file my.md --refine=sonnet  # explicit model
\`\`\`

Without \`--refine\`, behavior is unchanged — fast, deterministic, no model call.

With \`--refine\`, after the renderer produces an artifact:

- Send the rendered artifact + the spec to a model with a focused prompt: *"Refine this generated workflow's step task descriptions and acceptance gates to be specific and behavioral. Do not change the workflow shape, the agent assignments, or the step graph."*
- Apply the returned diff (or reject if the model wandered outside the allowlist of editable regions).
- Re-run the validator on the refined artifact.
- Cost cap: hard timeout (45s) + token budget (configurable, default 50k input / 8k output). On overflow, return the deterministic artifact as-is and warn.

Default refinement model: Sonnet. Override via \`--refine=<model>\`.

Acceptance test for this layer: a spec like the \`--version\` one would produce a \`post-implementation-file-gate\` whose command actually verifies \`node dist/bin/ricky.js --version | grep -Eq '^ricky [0-9]+\\\\.[0-9]+\\\\.[0-9]+$'\` (the spec's stated acceptance) instead of a generic source-shape grep.

## Where these plug in

- \`src/product/generation/skill-matcher.ts\` (new) — replaces the hardcoded set in \`skill-loader.ts\`.
- \`src/product/generation/tool-selector.ts\` (new) — consulted from \`template-renderer.ts\` during slot fill.
- \`src/product/generation/refine-with-llm.ts\` (new) — invoked from \`pipeline.ts\` after the existing render+validate, only when \`--refine\` is set.
- \`src/surfaces/cli/commands/cli-main.ts\` — parse \`--refine[=model]\`, thread through the handoff.
- \`src/local/entrypoint.ts\` \`toRawSpecPayload\` — already structured-json under the CLI sane-defaults change; adding a \`refine\` field is straightforward.

## Output shape additions

Generated workflow context artifacts (\`.workflow-artifacts/generated/<slug>/\`):

- \`skill-matches.json\` — ranked match list with confidence scores and trigger evidence (replaces the static \`loaded-skills.txt\`).
- \`tool-selection.json\` — per-step tool/model/runner decisions and the rule that fired.
- \`refinement.json\` (only when \`--refine\`) — \`{ model, input_tokens, output_tokens, edited_regions, diff_size, validator_passed }\`.

\`ricky --json\` includes these in the response so callers can audit the decisions.

## Test cases

Skill matcher (\`src/product/generation/skill-matcher.test.ts\`):
1. A spec that mentions "github primitive" matches the github skill above the relay-80-100 default.
2. A spec with no skill-relevant content falls back to the project default (\`writing-agent-relay-workflows\`).
3. Empty / missing skill registry → no skills loaded, no error, warning recorded.
4. Confidence below threshold → not selected even if it's the top match.

Tool selector (\`src/product/generation/tool-selector.test.ts\`):
1. Spec hint \`"use claude"\` → all agent steps get \`runner: 'claude'\`.
2. Spec hint \`"with codex"\` on a single step → only that step gets \`codex\`, others stay default.
3. Skill-pack metadata \`preferredRunner: 'opencode'\` → applied unless spec overrides.
4. No hints → project default runner.

Refinement (\`src/product/generation/refine-with-llm.test.ts\`):
1. Refinement returns a valid edit that passes the validator → applied.
2. Refinement edits outside the allowlist (changes the step graph) → rejected, warning, deterministic artifact returned unchanged.
3. Refinement timeout → deterministic artifact returned, warning includes elapsed ms.
4. Token budget exceeded → deterministic artifact returned, warning includes attempted vs max tokens.
5. Model unavailable / API error → deterministic artifact returned, warning surfaced, exit code unchanged.

End-to-end (manual):
- \`ricky --mode local --spec-file specs/cli-version-from-package-json.md\` → fast deterministic artifact, today's behavior.
- \`... --refine\` → same workflow shape but with sharper gate commands and step task descriptions tied to the spec's acceptance criteria.

## Out of scope

- Full agentic generation (LLM writes the workflow from scratch, not refines a scaffold). Different product, different latency budget.
- Skill authoring tooling. Just consumption.
- Cross-spec retrieval / RAG. The refinement pass sees only the spec + scaffold.
- Caching refinement output across invocations.

## Acceptance

- Skill matcher selects from the actual skill registry; same \`--version\` spec selects different skills than a "github webhook handler" spec.
- Tool selector produces per-step runner/model assignments visible in \`tool-selection.json\`.
- \`ricky --refine\` produces a refined artifact whose deterministic gates align with the spec's stated acceptance criteria. The unrefined path stays bit-for-bit unchanged.
- All existing generation tests still pass; ~14 new tests above pass.
- A vague spec that today produces a passable scaffold and a tightly-scoped one (like \`--version\`) that today produces a *near-correct* scaffold both produce *behavior-grounded* gates after \`--refine\`.

Deliverables:
- dist/bin/ricky.js
- tool/model/runner
- specs/cli-version-from-package-json.md

Non-goals:
- None declared

Verification commands:
- file_exists gate for declared targets
- grep sanity gate
- npx tsc --noEmit
- npx vitest run
- git diff --name-only gate

Write .workflow-artifacts/generated/spec-improve-generated-workflow-quality-skill-pa/lead-plan.md ending with GENERATION_LEAD_PLAN_READY.`,
      verification: { type: 'file_exists', value: ".workflow-artifacts/generated/spec-improve-generated-workflow-quality-skill-pa/lead-plan.md" },
    })

    .step('implement-artifact', {
      agent: "impl-primary-codex",
      dependsOn: ['lead-plan'],

      task: `Implement the requested code-writing workflow slice.

Scope:
# Spec: Improve generated-workflow quality (skill-pack matcher, CLI-tool selector, optional LLM augmentation)

## Problem

Ricky's \`generate\` step is fast (~milliseconds) because it's pure code: spec parser → pattern detector → template renderer → validator. No LLM, no network. That's a feature — most of the time you want a deterministic scaffold.

But the speed comes from skipping three decisions the renderer should be making, and the cost shows up in the produced workflow:

1. **Skill matching is hardcoded.** \`src/product/generation/skill-loader.ts\` declares \`AVAILABLE_PREREQUISITES = new Set(['@agent-relay/sdk', 'embedded-relay-typescript-template'])\`. There's no actual matcher against the rich PRPM-style skill registry; the same two skills get loaded regardless of what the spec is about.

2. **CLI-tool / agent selection is absent.** Generated workflows always use \`@agent-relay/sdk\` agent steps with no model or runtime choice. A spec that calls for \`claude\` (e.g. "use Claude to refactor X") or \`codex\` (e.g. "have codex audit Y") generates the same workflow shape — agent identity is left to runtime defaults.

3. **Step task descriptions are echoed spec text.** The template renderer's slot-fillers paste the spec's prose into each agent step. For tightly-scoped specs that's enough; for vague specs the agents do all the heavy lifting at runtime, often with under-specified instructions.

   This one bites in another way: deterministic gates generated from spec acceptance criteria can be too coarse. The current \`--version\` workflow generated \`grep -Eq 'export|function|class|workflow(' dist/bin/ricky.js\` as a post-implementation file gate, which fails on intentionally-minimal bin scripts that have none of those tokens. The grep was inferred from "primary artifact" without any behavioral grounding from the spec's actual acceptance text.

We need three additions: a skill matcher, a tool/agent selector, and an optional LLM-augmented refinement pass. All three should be additive — the fast deterministic path stays the default.

## Behavior we want

### 1. Skill-pack matcher

Replace the hardcoded \`AVAILABLE_PREREQUISITES\` set with a registry-backed matcher in \`src/product/generation/skill-matcher.ts\`:

- **Registry source**: read installed PRPM packages (or whatever the canonical skill registry is — \`~/.claude/skills/\` and project-local \`skills/\`). Cache the descriptor list at process start.
- **Matching**: for each skill, evaluate its \`description\` and triggers (filename patterns, keyword lists, file-mentions in the spec) against the normalized spec. Return ranked matches with confidence scores.
- **Selection**: pick the top N matches above a confidence threshold (default: 3 skills, ≥ 0.4 confidence). Ties broken by skill update-recency.
- **Output**: each selected skill's \`loaded-skills.txt\` artifact lists the matched skill IDs and why they were chosen (the trigger that fired).

Surfaces in the generated workflow as a \`pre-implementation\` step that loads the matched skills' SKILL.md files into the agent's context.

### 2. CLI-tool / agent selector

A \`tool-selector.ts\` companion that decides:

- **Which CLI tool runs each agent step** (\`claude\` / \`codex\` / \`cursor\` / \`opencode\` / generic \`@agent-relay/sdk\`). Defaults to the project's agent-relay default; overrides come from explicit spec hints (\`use claude to ...\`) or skill-pack metadata (a skill can declare its preferred runner).
- **Which model the runner targets**. Spec-level hints (\`with sonnet\`, \`via opus 4.6\`) override skill defaults override project defaults.
- **Concurrency** for parallelizable steps — currently always 1.

The selector is consulted once per step during template rendering. Output: each \`step()\` call gets the right \`agent\` / \`model\` / \`runner\` fields.

### 3. Optional LLM-augmented refinement (gated)

A new \`--refine\` flag (alias \`--with-llm\`) that adds a single LLM pass after the deterministic render:

\`\`\`
ricky --mode local --spec-file my.md --refine
ricky --mode local --spec-file my.md --refine=sonnet  # explicit model
\`\`\`

Without \`--refine\`, behavior is unchanged — fast, deterministic, no model call.

With \`--refine\`, after the renderer produces an artifact:

- Send the rendered artifact + the spec to a model with a focused prompt: *"Refine this generated workflow's step task descriptions and acceptance gates to be specific and behavioral. Do not change the workflow shape, the agent assignments, or the step graph."*
- Apply the returned diff (or reject if the model wandered outside the allowlist of editable regions).
- Re-run the validator on the refined artifact.
- Cost cap: hard timeout (45s) + token budget (configurable, default 50k input / 8k output). On overflow, return the deterministic artifact as-is and warn.

Default refinement model: Sonnet. Override via \`--refine=<model>\`.

Acceptance test for this layer: a spec like the \`--version\` one would produce a \`post-implementation-file-gate\` whose command actually verifies \`node dist/bin/ricky.js --version | grep -Eq '^ricky [0-9]+\\\\.[0-9]+\\\\.[0-9]+$'\` (the spec's stated acceptance) instead of a generic source-shape grep.

## Where these plug in

- \`src/product/generation/skill-matcher.ts\` (new) — replaces the hardcoded set in \`skill-loader.ts\`.
- \`src/product/generation/tool-selector.ts\` (new) — consulted from \`template-renderer.ts\` during slot fill.
- \`src/product/generation/refine-with-llm.ts\` (new) — invoked from \`pipeline.ts\` after the existing render+validate, only when \`--refine\` is set.
- \`src/surfaces/cli/commands/cli-main.ts\` — parse \`--refine[=model]\`, thread through the handoff.
- \`src/local/entrypoint.ts\` \`toRawSpecPayload\` — already structured-json under the CLI sane-defaults change; adding a \`refine\` field is straightforward.

## Output shape additions

Generated workflow context artifacts (\`.workflow-artifacts/generated/<slug>/\`):

- \`skill-matches.json\` — ranked match list with confidence scores and trigger evidence (replaces the static \`loaded-skills.txt\`).
- \`tool-selection.json\` — per-step tool/model/runner decisions and the rule that fired.
- \`refinement.json\` (only when \`--refine\`) — \`{ model, input_tokens, output_tokens, edited_regions, diff_size, validator_passed }\`.

\`ricky --json\` includes these in the response so callers can audit the decisions.

## Test cases

Skill matcher (\`src/product/generation/skill-matcher.test.ts\`):
1. A spec that mentions "github primitive" matches the github skill above the relay-80-100 default.
2. A spec with no skill-relevant content falls back to the project default (\`writing-agent-relay-workflows\`).
3. Empty / missing skill registry → no skills loaded, no error, warning recorded.
4. Confidence below threshold → not selected even if it's the top match.

Tool selector (\`src/product/generation/tool-selector.test.ts\`):
1. Spec hint \`"use claude"\` → all agent steps get \`runner: 'claude'\`.
2. Spec hint \`"with codex"\` on a single step → only that step gets \`codex\`, others stay default.
3. Skill-pack metadata \`preferredRunner: 'opencode'\` → applied unless spec overrides.
4. No hints → project default runner.

Refinement (\`src/product/generation/refine-with-llm.test.ts\`):
1. Refinement returns a valid edit that passes the validator → applied.
2. Refinement edits outside the allowlist (changes the step graph) → rejected, warning, deterministic artifact returned unchanged.
3. Refinement timeout → deterministic artifact returned, warning includes elapsed ms.
4. Token budget exceeded → deterministic artifact returned, warning includes attempted vs max tokens.
5. Model unavailable / API error → deterministic artifact returned, warning surfaced, exit code unchanged.

End-to-end (manual):
- \`ricky --mode local --spec-file specs/cli-version-from-package-json.md\` → fast deterministic artifact, today's behavior.
- \`... --refine\` → same workflow shape but with sharper gate commands and step task descriptions tied to the spec's acceptance criteria.

## Out of scope

- Full agentic generation (LLM writes the workflow from scratch, not refines a scaffold). Different product, different latency budget.
- Skill authoring tooling. Just consumption.
- Cross-spec retrieval / RAG. The refinement pass sees only the spec + scaffold.
- Caching refinement output across invocations.

## Acceptance

- Skill matcher selects from the actual skill registry; same \`--version\` spec selects different skills than a "github webhook handler" spec.
- Tool selector produces per-step runner/model assignments visible in \`tool-selection.json\`.
- \`ricky --refine\` produces a refined artifact whose deterministic gates align with the spec's stated acceptance criteria. The unrefined path stays bit-for-bit unchanged.
- All existing generation tests still pass; ~14 new tests above pass.
- A vague spec that today produces a passable scaffold and a tightly-scoped one (like \`--version\`) that today produces a *near-correct* scaffold both produce *behavior-grounded* gates after \`--refine\`.

Own only declared targets unless review feedback explicitly narrows a required fix:
- dist/bin/ricky.js
- tool/model/runner
- specs/cli-version-from-package-json.md

Acceptance gates:
- test for this layer: a spec like the \`--version\` one would produce a \`post-implementation-file-gate\` whose command actually verifies \`node dist/bin/ricky.js --version | grep -Eq '^ricky [0-9]+\\\\.[0-9]+\\\\.[0-9]+$'\` (the spec's stated acceptance) instead of a generic source-shape grep.

Tool selection: runner=@agent-relay/sdk; concurrency=2; rule=project default runner @agent-relay/sdk.

Keep execution routing explicit for local, cloud, and MCP callers. Materialize outputs to disk, then stop for deterministic gates.`,
    })

    .step("post-implementation-file-gate", {
      type: 'deterministic',
      dependsOn: ["implement-artifact"],
      command: "test -f 'src/product/generation/skill-matcher.ts' && test -f 'src/product/generation/tool-selector.ts' && test -f 'src/product/generation/refine-with-llm.ts' && grep -Eq '\\brefine\\b|--refine' src/surfaces/cli/commands/cli-main.ts",
      captureOutput: true,
      failOnError: true,
    })

    .step("initial-soft-validation", {
      type: 'deterministic',
      dependsOn: ["post-implementation-file-gate"],
      command: "npx tsc --noEmit && npx vitest run && node dist/bin/ricky.js --version | grep -Eq '^ricky [0-9]+\\\\.[0-9]+\\\\.[0-9]+$'",
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
# Spec: Improve generated-workflow quality (skill-pack matcher, CLI-tool selector, optional LLM augmentation)

## Problem

Ricky's \`generate\` step is fast (~milliseconds) because it's pure code: spec parser → pattern detector → template renderer → validator. No LLM, no network. That's a feature — most of the time you want a deterministic scaffold.

But the speed comes from skipping three decisions the renderer should be making, and the cost shows up in the produced workflow:

1. **Skill matching is hardcoded.** \`src/product/generation/skill-loader.ts\` declares \`AVAILABLE_PREREQUISITES = new Set(['@agent-relay/sdk', 'embedded-relay-typescript-template'])\`. There's no actual matcher against the rich PRPM-style skill registry; the same two skills get loaded regardless of what the spec is about.

2. **CLI-tool / agent selection is absent.** Generated workflows always use \`@agent-relay/sdk\` agent steps with no model or runtime choice. A spec that calls for \`claude\` (e.g. "use Claude to refactor X") or \`codex\` (e.g. "have codex audit Y") generates the same workflow shape — agent identity is left to runtime defaults.

3. **Step task descriptions are echoed spec text.** The template renderer's slot-fillers paste the spec's prose into each agent step. For tightly-scoped specs that's enough; for vague specs the agents do all the heavy lifting at runtime, often with under-specified instructions.

   This one bites in another way: deterministic gates generated from spec acceptance criteria can be too coarse. The current \`--version\` workflow generated \`grep -Eq 'export|function|class|workflow(' dist/bin/ricky.js\` as a post-implementation file gate, which fails on intentionally-minimal bin scripts that have none of those tokens. The grep was inferred from "primary artifact" without any behavioral grounding from the spec's actual acceptance text.

We need three additions: a skill matcher, a tool/agent selector, and an optional LLM-augmented refinement pass. All three should be additive — the fast deterministic path stays the default.

## Behavior we want

### 1. Skill-pack matcher

Replace the hardcoded \`AVAILABLE_PREREQUISITES\` set with a registry-backed matcher in \`src/product/generation/skill-matcher.ts\`:

- **Registry source**: read installed PRPM packages (or whatever the canonical skill registry is — \`~/.claude/skills/\` and project-local \`skills/\`). Cache the descriptor list at process start.
- **Matching**: for each skill, evaluate its \`description\` and triggers (filename patterns, keyword lists, file-mentions in the spec) against the normalized spec. Return ranked matches with confidence scores.
- **Selection**: pick the top N matches above a confidence threshold (default: 3 skills, ≥ 0.4 confidence). Ties broken by skill update-recency.
- **Output**: each selected skill's \`loaded-skills.txt\` artifact lists the matched skill IDs and why they were chosen (the trigger that fired).

Surfaces in the generated workflow as a \`pre-implementation\` step that loads the matched skills' SKILL.md files into the agent's context.

### 2. CLI-tool / agent selector

A \`tool-selector.ts\` companion that decides:

- **Which CLI tool runs each agent step** (\`claude\` / \`codex\` / \`cursor\` / \`opencode\` / generic \`@agent-relay/sdk\`). Defaults to the project's agent-relay default; overrides come from explicit spec hints (\`use claude to ...\`) or skill-pack metadata (a skill can declare its preferred runner).
- **Which model the runner targets**. Spec-level hints (\`with sonnet\`, \`via opus 4.6\`) override skill defaults override project defaults.
- **Concurrency** for parallelizable steps — currently always 1.

The selector is consulted once per step during template rendering. Output: each \`step()\` call gets the right \`agent\` / \`model\` / \`runner\` fields.

### 3. Optional LLM-augmented refinement (gated)

A new \`--refine\` flag (alias \`--with-llm\`) that adds a single LLM pass after the deterministic render:

\`\`\`
ricky --mode local --spec-file my.md --refine
ricky --mode local --spec-file my.md --refine=sonnet  # explicit model
\`\`\`

Without \`--refine\`, behavior is unchanged — fast, deterministic, no model call.

With \`--refine\`, after the renderer produces an artifact:

- Send the rendered artifact + the spec to a model with a focused prompt: *"Refine this generated workflow's step task descriptions and acceptance gates to be specific and behavioral. Do not change the workflow shape, the agent assignments, or the step graph."*
- Apply the returned diff (or reject if the model wandered outside the allowlist of editable regions).
- Re-run the validator on the refined artifact.
- Cost cap: hard timeout (45s) + token budget (configurable, default 50k input / 8k output). On overflow, return the deterministic artifact as-is and warn.

Default refinement model: Sonnet. Override via \`--refine=<model>\`.

Acceptance test for this layer: a spec like the \`--version\` one would produce a \`post-implementation-file-gate\` whose command actually verifies \`node dist/bin/ricky.js --version | grep -Eq '^ricky [0-9]+\\\\.[0-9]+\\\\.[0-9]+$'\` (the spec's stated acceptance) instead of a generic source-shape grep.

## Where these plug in

- \`src/product/generation/skill-matcher.ts\` (new) — replaces the hardcoded set in \`skill-loader.ts\`.
- \`src/product/generation/tool-selector.ts\` (new) — consulted from \`template-renderer.ts\` during slot fill.
- \`src/product/generation/refine-with-llm.ts\` (new) — invoked from \`pipeline.ts\` after the existing render+validate, only when \`--refine\` is set.
- \`src/surfaces/cli/commands/cli-main.ts\` — parse \`--refine[=model]\`, thread through the handoff.
- \`src/local/entrypoint.ts\` \`toRawSpecPayload\` — already structured-json under the CLI sane-defaults change; adding a \`refine\` field is straightforward.

## Output shape additions

Generated workflow context artifacts (\`.workflow-artifacts/generated/<slug>/\`):

- \`skill-matches.json\` — ranked match list with confidence scores and trigger evidence (replaces the static \`loaded-skills.txt\`).
- \`tool-selection.json\` — per-step tool/model/runner decisions and the rule that fired.
- \`refinement.json\` (only when \`--refine\`) — \`{ model, input_tokens, output_tokens, edited_regions, diff_size, validator_passed }\`.

\`ricky --json\` includes these in the response so callers can audit the decisions.

## Test cases

Skill matcher (\`src/product/generation/skill-matcher.test.ts\`):
1. A spec that mentions "github primitive" matches the github skill above the relay-80-100 default.
2. A spec with no skill-relevant content falls back to the project default (\`writing-agent-relay-workflows\`).
3. Empty / missing skill registry → no skills loaded, no error, warning recorded.
4. Confidence below threshold → not selected even if it's the top match.

Tool selector (\`src/product/generation/tool-selector.test.ts\`):
1. Spec hint \`"use claude"\` → all agent steps get \`runner: 'claude'\`.
2. Spec hint \`"with codex"\` on a single step → only that step gets \`codex\`, others stay default.
3. Skill-pack metadata \`preferredRunner: 'opencode'\` → applied unless spec overrides.
4. No hints → project default runner.

Refinement (\`src/product/generation/refine-with-llm.test.ts\`):
1. Refinement returns a valid edit that passes the validator → applied.
2. Refinement edits outside the allowlist (changes the step graph) → rejected, warning, deterministic artifact returned unchanged.
3. Refinement timeout → deterministic artifact returned, warning includes elapsed ms.
4. Token budget exceeded → deterministic artifact returned, warning includes attempted vs max tokens.
5. Model unavailable / API error → deterministic artifact returned, warning surfaced, exit code unchanged.

End-to-end (manual):
- \`ricky --mode local --spec-file specs/cli-version-from-package-json.md\` → fast deterministic artifact, today's behavior.
- \`... --refine\` → same workflow shape but with sharper gate commands and step task descriptions tied to the spec's acceptance criteria.

## Out of scope

- Full agentic generation (LLM writes the workflow from scratch, not refines a scaffold). Different product, different latency budget.
- Skill authoring tooling. Just consumption.
- Cross-spec retrieval / RAG. The refinement pass sees only the spec + scaffold.
- Caching refinement output across invocations.

## Acceptance

- Skill matcher selects from the actual skill registry; same \`--version\` spec selects different skills than a "github webhook handler" spec.
- Tool selector produces per-step runner/model assignments visible in \`tool-selection.json\`.
- \`ricky --refine\` produces a refined artifact whose deterministic gates align with the spec's stated acceptance criteria. The unrefined path stays bit-for-bit unchanged.
- All existing generation tests still pass; ~14 new tests above pass.
- A vague spec that today produces a passable scaffold and a tightly-scoped one (like \`--version\`) that today produces a *near-correct* scaffold both produce *behavior-grounded* gates after \`--refine\`.

Tool selection: runner=@agent-relay/sdk; concurrency=2; rule=project default runner @agent-relay/sdk.

Write .workflow-artifacts/generated/spec-improve-generated-workflow-quality-skill-pa/review-claude.md ending with REVIEW_COMPLETE.`,
      verification: { type: 'file_exists', value: ".workflow-artifacts/generated/spec-improve-generated-workflow-quality-skill-pa/review-claude.md" },
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
# Spec: Improve generated-workflow quality (skill-pack matcher, CLI-tool selector, optional LLM augmentation)

## Problem

Ricky's \`generate\` step is fast (~milliseconds) because it's pure code: spec parser → pattern detector → template renderer → validator. No LLM, no network. That's a feature — most of the time you want a deterministic scaffold.

But the speed comes from skipping three decisions the renderer should be making, and the cost shows up in the produced workflow:

1. **Skill matching is hardcoded.** \`src/product/generation/skill-loader.ts\` declares \`AVAILABLE_PREREQUISITES = new Set(['@agent-relay/sdk', 'embedded-relay-typescript-template'])\`. There's no actual matcher against the rich PRPM-style skill registry; the same two skills get loaded regardless of what the spec is about.

2. **CLI-tool / agent selection is absent.** Generated workflows always use \`@agent-relay/sdk\` agent steps with no model or runtime choice. A spec that calls for \`claude\` (e.g. "use Claude to refactor X") or \`codex\` (e.g. "have codex audit Y") generates the same workflow shape — agent identity is left to runtime defaults.

3. **Step task descriptions are echoed spec text.** The template renderer's slot-fillers paste the spec's prose into each agent step. For tightly-scoped specs that's enough; for vague specs the agents do all the heavy lifting at runtime, often with under-specified instructions.

   This one bites in another way: deterministic gates generated from spec acceptance criteria can be too coarse. The current \`--version\` workflow generated \`grep -Eq 'export|function|class|workflow(' dist/bin/ricky.js\` as a post-implementation file gate, which fails on intentionally-minimal bin scripts that have none of those tokens. The grep was inferred from "primary artifact" without any behavioral grounding from the spec's actual acceptance text.

We need three additions: a skill matcher, a tool/agent selector, and an optional LLM-augmented refinement pass. All three should be additive — the fast deterministic path stays the default.

## Behavior we want

### 1. Skill-pack matcher

Replace the hardcoded \`AVAILABLE_PREREQUISITES\` set with a registry-backed matcher in \`src/product/generation/skill-matcher.ts\`:

- **Registry source**: read installed PRPM packages (or whatever the canonical skill registry is — \`~/.claude/skills/\` and project-local \`skills/\`). Cache the descriptor list at process start.
- **Matching**: for each skill, evaluate its \`description\` and triggers (filename patterns, keyword lists, file-mentions in the spec) against the normalized spec. Return ranked matches with confidence scores.
- **Selection**: pick the top N matches above a confidence threshold (default: 3 skills, ≥ 0.4 confidence). Ties broken by skill update-recency.
- **Output**: each selected skill's \`loaded-skills.txt\` artifact lists the matched skill IDs and why they were chosen (the trigger that fired).

Surfaces in the generated workflow as a \`pre-implementation\` step that loads the matched skills' SKILL.md files into the agent's context.

### 2. CLI-tool / agent selector

A \`tool-selector.ts\` companion that decides:

- **Which CLI tool runs each agent step** (\`claude\` / \`codex\` / \`cursor\` / \`opencode\` / generic \`@agent-relay/sdk\`). Defaults to the project's agent-relay default; overrides come from explicit spec hints (\`use claude to ...\`) or skill-pack metadata (a skill can declare its preferred runner).
- **Which model the runner targets**. Spec-level hints (\`with sonnet\`, \`via opus 4.6\`) override skill defaults override project defaults.
- **Concurrency** for parallelizable steps — currently always 1.

The selector is consulted once per step during template rendering. Output: each \`step()\` call gets the right \`agent\` / \`model\` / \`runner\` fields.

### 3. Optional LLM-augmented refinement (gated)

A new \`--refine\` flag (alias \`--with-llm\`) that adds a single LLM pass after the deterministic render:

\`\`\`
ricky --mode local --spec-file my.md --refine
ricky --mode local --spec-file my.md --refine=sonnet  # explicit model
\`\`\`

Without \`--refine\`, behavior is unchanged — fast, deterministic, no model call.

With \`--refine\`, after the renderer produces an artifact:

- Send the rendered artifact + the spec to a model with a focused prompt: *"Refine this generated workflow's step task descriptions and acceptance gates to be specific and behavioral. Do not change the workflow shape, the agent assignments, or the step graph."*
- Apply the returned diff (or reject if the model wandered outside the allowlist of editable regions).
- Re-run the validator on the refined artifact.
- Cost cap: hard timeout (45s) + token budget (configurable, default 50k input / 8k output). On overflow, return the deterministic artifact as-is and warn.

Default refinement model: Sonnet. Override via \`--refine=<model>\`.

Acceptance test for this layer: a spec like the \`--version\` one would produce a \`post-implementation-file-gate\` whose command actually verifies \`node dist/bin/ricky.js --version | grep -Eq '^ricky [0-9]+\\\\.[0-9]+\\\\.[0-9]+$'\` (the spec's stated acceptance) instead of a generic source-shape grep.

## Where these plug in

- \`src/product/generation/skill-matcher.ts\` (new) — replaces the hardcoded set in \`skill-loader.ts\`.
- \`src/product/generation/tool-selector.ts\` (new) — consulted from \`template-renderer.ts\` during slot fill.
- \`src/product/generation/refine-with-llm.ts\` (new) — invoked from \`pipeline.ts\` after the existing render+validate, only when \`--refine\` is set.
- \`src/surfaces/cli/commands/cli-main.ts\` — parse \`--refine[=model]\`, thread through the handoff.
- \`src/local/entrypoint.ts\` \`toRawSpecPayload\` — already structured-json under the CLI sane-defaults change; adding a \`refine\` field is straightforward.

## Output shape additions

Generated workflow context artifacts (\`.workflow-artifacts/generated/<slug>/\`):

- \`skill-matches.json\` — ranked match list with confidence scores and trigger evidence (replaces the static \`loaded-skills.txt\`).
- \`tool-selection.json\` — per-step tool/model/runner decisions and the rule that fired.
- \`refinement.json\` (only when \`--refine\`) — \`{ model, input_tokens, output_tokens, edited_regions, diff_size, validator_passed }\`.

\`ricky --json\` includes these in the response so callers can audit the decisions.

## Test cases

Skill matcher (\`src/product/generation/skill-matcher.test.ts\`):
1. A spec that mentions "github primitive" matches the github skill above the relay-80-100 default.
2. A spec with no skill-relevant content falls back to the project default (\`writing-agent-relay-workflows\`).
3. Empty / missing skill registry → no skills loaded, no error, warning recorded.
4. Confidence below threshold → not selected even if it's the top match.

Tool selector (\`src/product/generation/tool-selector.test.ts\`):
1. Spec hint \`"use claude"\` → all agent steps get \`runner: 'claude'\`.
2. Spec hint \`"with codex"\` on a single step → only that step gets \`codex\`, others stay default.
3. Skill-pack metadata \`preferredRunner: 'opencode'\` → applied unless spec overrides.
4. No hints → project default runner.

Refinement (\`src/product/generation/refine-with-llm.test.ts\`):
1. Refinement returns a valid edit that passes the validator → applied.
2. Refinement edits outside the allowlist (changes the step graph) → rejected, warning, deterministic artifact returned unchanged.
3. Refinement timeout → deterministic artifact returned, warning includes elapsed ms.
4. Token budget exceeded → deterministic artifact returned, warning includes attempted vs max tokens.
5. Model unavailable / API error → deterministic artifact returned, warning surfaced, exit code unchanged.

End-to-end (manual):
- \`ricky --mode local --spec-file specs/cli-version-from-package-json.md\` → fast deterministic artifact, today's behavior.
- \`... --refine\` → same workflow shape but with sharper gate commands and step task descriptions tied to the spec's acceptance criteria.

## Out of scope

- Full agentic generation (LLM writes the workflow from scratch, not refines a scaffold). Different product, different latency budget.
- Skill authoring tooling. Just consumption.
- Cross-spec retrieval / RAG. The refinement pass sees only the spec + scaffold.
- Caching refinement output across invocations.

## Acceptance

- Skill matcher selects from the actual skill registry; same \`--version\` spec selects different skills than a "github webhook handler" spec.
- Tool selector produces per-step runner/model assignments visible in \`tool-selection.json\`.
- \`ricky --refine\` produces a refined artifact whose deterministic gates align with the spec's stated acceptance criteria. The unrefined path stays bit-for-bit unchanged.
- All existing generation tests still pass; ~14 new tests above pass.
- A vague spec that today produces a passable scaffold and a tightly-scoped one (like \`--version\`) that today produces a *near-correct* scaffold both produce *behavior-grounded* gates after \`--refine\`.

Tool selection: runner=@agent-relay/sdk; concurrency=2; rule=project default runner @agent-relay/sdk.

Write .workflow-artifacts/generated/spec-improve-generated-workflow-quality-skill-pa/review-codex.md ending with REVIEW_COMPLETE.`,
      verification: { type: 'file_exists', value: ".workflow-artifacts/generated/spec-improve-generated-workflow-quality-skill-pa/review-codex.md" },
    })

    .step("read-review-feedback", {
      type: 'deterministic',
      dependsOn: ["review-claude", "review-codex"],
      command: "test -f '.workflow-artifacts/generated/spec-improve-generated-workflow-quality-skill-pa/review-claude.md' && test -f '.workflow-artifacts/generated/spec-improve-generated-workflow-quality-skill-pa/review-codex.md' && cat '.workflow-artifacts/generated/spec-improve-generated-workflow-quality-skill-pa/review-claude.md' '.workflow-artifacts/generated/spec-improve-generated-workflow-quality-skill-pa/review-codex.md' > '.workflow-artifacts/generated/spec-improve-generated-workflow-quality-skill-pa/review-feedback.md'",
      captureOutput: true,
      failOnError: true,
    })

    .step('fix-loop', {
      agent: 'validator-claude',
      dependsOn: ['read-review-feedback'],

      task: `Run the 80-to-100 fix loop.

Inputs:
- .workflow-artifacts/generated/spec-improve-generated-workflow-quality-skill-pa/review-feedback.md
- initial validation output from the previous deterministic step

Fix only concrete review or validation findings. Preserve the declared target boundary:
- dist/bin/ricky.js
- tool/model/runner
- specs/cli-version-from-package-json.md

Tool selection: runner=@agent-relay/sdk; concurrency=1; rule=project default runner @agent-relay/sdk.

Re-run typecheck and tests before handing off to post-fix validation.`,
    })

    .step("post-fix-verification-gate", {
      type: 'deterministic',
      dependsOn: ["fix-loop"],
      command: "test -f 'src/product/generation/skill-matcher.ts' && test -f 'src/product/generation/tool-selector.ts' && test -f 'src/product/generation/refine-with-llm.ts' && grep -Eq '\\brefine\\b|--refine' src/surfaces/cli/commands/cli-main.ts",
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
# Spec: Improve generated-workflow quality (skill-pack matcher, CLI-tool selector, optional LLM augmentation)

## Problem

Ricky's \`generate\` step is fast (~milliseconds) because it's pure code: spec parser → pattern detector → template renderer → validator. No LLM, no network. That's a feature — most of the time you want a deterministic scaffold.

But the speed comes from skipping three decisions the renderer should be making, and the cost shows up in the produced workflow:

1. **Skill matching is hardcoded.** \`src/product/generation/skill-loader.ts\` declares \`AVAILABLE_PREREQUISITES = new Set(['@agent-relay/sdk', 'embedded-relay-typescript-template'])\`. There's no actual matcher against the rich PRPM-style skill registry; the same two skills get loaded regardless of what the spec is about.

2. **CLI-tool / agent selection is absent.** Generated workflows always use \`@agent-relay/sdk\` agent steps with no model or runtime choice. A spec that calls for \`claude\` (e.g. "use Claude to refactor X") or \`codex\` (e.g. "have codex audit Y") generates the same workflow shape — agent identity is left to runtime defaults.

3. **Step task descriptions are echoed spec text.** The template renderer's slot-fillers paste the spec's prose into each agent step. For tightly-scoped specs that's enough; for vague specs the agents do all the heavy lifting at runtime, often with under-specified instructions.

   This one bites in another way: deterministic gates generated from spec acceptance criteria can be too coarse. The current \`--version\` workflow generated \`grep -Eq 'export|function|class|workflow(' dist/bin/ricky.js\` as a post-implementation file gate, which fails on intentionally-minimal bin scripts that have none of those tokens. The grep was inferred from "primary artifact" without any behavioral grounding from the spec's actual acceptance text.

We need three additions: a skill matcher, a tool/agent selector, and an optional LLM-augmented refinement pass. All three should be additive — the fast deterministic path stays the default.

## Behavior we want

### 1. Skill-pack matcher

Replace the hardcoded \`AVAILABLE_PREREQUISITES\` set with a registry-backed matcher in \`src/product/generation/skill-matcher.ts\`:

- **Registry source**: read installed PRPM packages (or whatever the canonical skill registry is — \`~/.claude/skills/\` and project-local \`skills/\`). Cache the descriptor list at process start.
- **Matching**: for each skill, evaluate its \`description\` and triggers (filename patterns, keyword lists, file-mentions in the spec) against the normalized spec. Return ranked matches with confidence scores.
- **Selection**: pick the top N matches above a confidence threshold (default: 3 skills, ≥ 0.4 confidence). Ties broken by skill update-recency.
- **Output**: each selected skill's \`loaded-skills.txt\` artifact lists the matched skill IDs and why they were chosen (the trigger that fired).

Surfaces in the generated workflow as a \`pre-implementation\` step that loads the matched skills' SKILL.md files into the agent's context.

### 2. CLI-tool / agent selector

A \`tool-selector.ts\` companion that decides:

- **Which CLI tool runs each agent step** (\`claude\` / \`codex\` / \`cursor\` / \`opencode\` / generic \`@agent-relay/sdk\`). Defaults to the project's agent-relay default; overrides come from explicit spec hints (\`use claude to ...\`) or skill-pack metadata (a skill can declare its preferred runner).
- **Which model the runner targets**. Spec-level hints (\`with sonnet\`, \`via opus 4.6\`) override skill defaults override project defaults.
- **Concurrency** for parallelizable steps — currently always 1.

The selector is consulted once per step during template rendering. Output: each \`step()\` call gets the right \`agent\` / \`model\` / \`runner\` fields.

### 3. Optional LLM-augmented refinement (gated)

A new \`--refine\` flag (alias \`--with-llm\`) that adds a single LLM pass after the deterministic render:

\`\`\`
ricky --mode local --spec-file my.md --refine
ricky --mode local --spec-file my.md --refine=sonnet  # explicit model
\`\`\`

Without \`--refine\`, behavior is unchanged — fast, deterministic, no model call.

With \`--refine\`, after the renderer produces an artifact:

- Send the rendered artifact + the spec to a model with a focused prompt: *"Refine this generated workflow's step task descriptions and acceptance gates to be specific and behavioral. Do not change the workflow shape, the agent assignments, or the step graph."*
- Apply the returned diff (or reject if the model wandered outside the allowlist of editable regions).
- Re-run the validator on the refined artifact.
- Cost cap: hard timeout (45s) + token budget (configurable, default 50k input / 8k output). On overflow, return the deterministic artifact as-is and warn.

Default refinement model: Sonnet. Override via \`--refine=<model>\`.

Acceptance test for this layer: a spec like the \`--version\` one would produce a \`post-implementation-file-gate\` whose command actually verifies \`node dist/bin/ricky.js --version | grep -Eq '^ricky [0-9]+\\\\.[0-9]+\\\\.[0-9]+$'\` (the spec's stated acceptance) instead of a generic source-shape grep.

## Where these plug in

- \`src/product/generation/skill-matcher.ts\` (new) — replaces the hardcoded set in \`skill-loader.ts\`.
- \`src/product/generation/tool-selector.ts\` (new) — consulted from \`template-renderer.ts\` during slot fill.
- \`src/product/generation/refine-with-llm.ts\` (new) — invoked from \`pipeline.ts\` after the existing render+validate, only when \`--refine\` is set.
- \`src/surfaces/cli/commands/cli-main.ts\` — parse \`--refine[=model]\`, thread through the handoff.
- \`src/local/entrypoint.ts\` \`toRawSpecPayload\` — already structured-json under the CLI sane-defaults change; adding a \`refine\` field is straightforward.

## Output shape additions

Generated workflow context artifacts (\`.workflow-artifacts/generated/<slug>/\`):

- \`skill-matches.json\` — ranked match list with confidence scores and trigger evidence (replaces the static \`loaded-skills.txt\`).
- \`tool-selection.json\` — per-step tool/model/runner decisions and the rule that fired.
- \`refinement.json\` (only when \`--refine\`) — \`{ model, input_tokens, output_tokens, edited_regions, diff_size, validator_passed }\`.

\`ricky --json\` includes these in the response so callers can audit the decisions.

## Test cases

Skill matcher (\`src/product/generation/skill-matcher.test.ts\`):
1. A spec that mentions "github primitive" matches the github skill above the relay-80-100 default.
2. A spec with no skill-relevant content falls back to the project default (\`writing-agent-relay-workflows\`).
3. Empty / missing skill registry → no skills loaded, no error, warning recorded.
4. Confidence below threshold → not selected even if it's the top match.

Tool selector (\`src/product/generation/tool-selector.test.ts\`):
1. Spec hint \`"use claude"\` → all agent steps get \`runner: 'claude'\`.
2. Spec hint \`"with codex"\` on a single step → only that step gets \`codex\`, others stay default.
3. Skill-pack metadata \`preferredRunner: 'opencode'\` → applied unless spec overrides.
4. No hints → project default runner.

Refinement (\`src/product/generation/refine-with-llm.test.ts\`):
1. Refinement returns a valid edit that passes the validator → applied.
2. Refinement edits outside the allowlist (changes the step graph) → rejected, warning, deterministic artifact returned unchanged.
3. Refinement timeout → deterministic artifact returned, warning includes elapsed ms.
4. Token budget exceeded → deterministic artifact returned, warning includes attempted vs max tokens.
5. Model unavailable / API error → deterministic artifact returned, warning surfaced, exit code unchanged.

End-to-end (manual):
- \`ricky --mode local --spec-file specs/cli-version-from-package-json.md\` → fast deterministic artifact, today's behavior.
- \`... --refine\` → same workflow shape but with sharper gate commands and step task descriptions tied to the spec's acceptance criteria.

## Out of scope

- Full agentic generation (LLM writes the workflow from scratch, not refines a scaffold). Different product, different latency budget.
- Skill authoring tooling. Just consumption.
- Cross-spec retrieval / RAG. The refinement pass sees only the spec + scaffold.
- Caching refinement output across invocations.

## Acceptance

- Skill matcher selects from the actual skill registry; same \`--version\` spec selects different skills than a "github webhook handler" spec.
- Tool selector produces per-step runner/model assignments visible in \`tool-selection.json\`.
- \`ricky --refine\` produces a refined artifact whose deterministic gates align with the spec's stated acceptance criteria. The unrefined path stays bit-for-bit unchanged.
- All existing generation tests still pass; ~14 new tests above pass.
- A vague spec that today produces a passable scaffold and a tightly-scoped one (like \`--version\`) that today produces a *near-correct* scaffold both produce *behavior-grounded* gates after \`--refine\`.

Tool selection: runner=@agent-relay/sdk; concurrency=2; rule=project default runner @agent-relay/sdk.

Write .workflow-artifacts/generated/spec-improve-generated-workflow-quality-skill-pa/final-review-claude.md ending with FINAL_REVIEW_CLAUDE_PASS.`,
      verification: { type: 'file_exists', value: ".workflow-artifacts/generated/spec-improve-generated-workflow-quality-skill-pa/final-review-claude.md" },
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
# Spec: Improve generated-workflow quality (skill-pack matcher, CLI-tool selector, optional LLM augmentation)

## Problem

Ricky's \`generate\` step is fast (~milliseconds) because it's pure code: spec parser → pattern detector → template renderer → validator. No LLM, no network. That's a feature — most of the time you want a deterministic scaffold.

But the speed comes from skipping three decisions the renderer should be making, and the cost shows up in the produced workflow:

1. **Skill matching is hardcoded.** \`src/product/generation/skill-loader.ts\` declares \`AVAILABLE_PREREQUISITES = new Set(['@agent-relay/sdk', 'embedded-relay-typescript-template'])\`. There's no actual matcher against the rich PRPM-style skill registry; the same two skills get loaded regardless of what the spec is about.

2. **CLI-tool / agent selection is absent.** Generated workflows always use \`@agent-relay/sdk\` agent steps with no model or runtime choice. A spec that calls for \`claude\` (e.g. "use Claude to refactor X") or \`codex\` (e.g. "have codex audit Y") generates the same workflow shape — agent identity is left to runtime defaults.

3. **Step task descriptions are echoed spec text.** The template renderer's slot-fillers paste the spec's prose into each agent step. For tightly-scoped specs that's enough; for vague specs the agents do all the heavy lifting at runtime, often with under-specified instructions.

   This one bites in another way: deterministic gates generated from spec acceptance criteria can be too coarse. The current \`--version\` workflow generated \`grep -Eq 'export|function|class|workflow(' dist/bin/ricky.js\` as a post-implementation file gate, which fails on intentionally-minimal bin scripts that have none of those tokens. The grep was inferred from "primary artifact" without any behavioral grounding from the spec's actual acceptance text.

We need three additions: a skill matcher, a tool/agent selector, and an optional LLM-augmented refinement pass. All three should be additive — the fast deterministic path stays the default.

## Behavior we want

### 1. Skill-pack matcher

Replace the hardcoded \`AVAILABLE_PREREQUISITES\` set with a registry-backed matcher in \`src/product/generation/skill-matcher.ts\`:

- **Registry source**: read installed PRPM packages (or whatever the canonical skill registry is — \`~/.claude/skills/\` and project-local \`skills/\`). Cache the descriptor list at process start.
- **Matching**: for each skill, evaluate its \`description\` and triggers (filename patterns, keyword lists, file-mentions in the spec) against the normalized spec. Return ranked matches with confidence scores.
- **Selection**: pick the top N matches above a confidence threshold (default: 3 skills, ≥ 0.4 confidence). Ties broken by skill update-recency.
- **Output**: each selected skill's \`loaded-skills.txt\` artifact lists the matched skill IDs and why they were chosen (the trigger that fired).

Surfaces in the generated workflow as a \`pre-implementation\` step that loads the matched skills' SKILL.md files into the agent's context.

### 2. CLI-tool / agent selector

A \`tool-selector.ts\` companion that decides:

- **Which CLI tool runs each agent step** (\`claude\` / \`codex\` / \`cursor\` / \`opencode\` / generic \`@agent-relay/sdk\`). Defaults to the project's agent-relay default; overrides come from explicit spec hints (\`use claude to ...\`) or skill-pack metadata (a skill can declare its preferred runner).
- **Which model the runner targets**. Spec-level hints (\`with sonnet\`, \`via opus 4.6\`) override skill defaults override project defaults.
- **Concurrency** for parallelizable steps — currently always 1.

The selector is consulted once per step during template rendering. Output: each \`step()\` call gets the right \`agent\` / \`model\` / \`runner\` fields.

### 3. Optional LLM-augmented refinement (gated)

A new \`--refine\` flag (alias \`--with-llm\`) that adds a single LLM pass after the deterministic render:

\`\`\`
ricky --mode local --spec-file my.md --refine
ricky --mode local --spec-file my.md --refine=sonnet  # explicit model
\`\`\`

Without \`--refine\`, behavior is unchanged — fast, deterministic, no model call.

With \`--refine\`, after the renderer produces an artifact:

- Send the rendered artifact + the spec to a model with a focused prompt: *"Refine this generated workflow's step task descriptions and acceptance gates to be specific and behavioral. Do not change the workflow shape, the agent assignments, or the step graph."*
- Apply the returned diff (or reject if the model wandered outside the allowlist of editable regions).
- Re-run the validator on the refined artifact.
- Cost cap: hard timeout (45s) + token budget (configurable, default 50k input / 8k output). On overflow, return the deterministic artifact as-is and warn.

Default refinement model: Sonnet. Override via \`--refine=<model>\`.

Acceptance test for this layer: a spec like the \`--version\` one would produce a \`post-implementation-file-gate\` whose command actually verifies \`node dist/bin/ricky.js --version | grep -Eq '^ricky [0-9]+\\\\.[0-9]+\\\\.[0-9]+$'\` (the spec's stated acceptance) instead of a generic source-shape grep.

## Where these plug in

- \`src/product/generation/skill-matcher.ts\` (new) — replaces the hardcoded set in \`skill-loader.ts\`.
- \`src/product/generation/tool-selector.ts\` (new) — consulted from \`template-renderer.ts\` during slot fill.
- \`src/product/generation/refine-with-llm.ts\` (new) — invoked from \`pipeline.ts\` after the existing render+validate, only when \`--refine\` is set.
- \`src/surfaces/cli/commands/cli-main.ts\` — parse \`--refine[=model]\`, thread through the handoff.
- \`src/local/entrypoint.ts\` \`toRawSpecPayload\` — already structured-json under the CLI sane-defaults change; adding a \`refine\` field is straightforward.

## Output shape additions

Generated workflow context artifacts (\`.workflow-artifacts/generated/<slug>/\`):

- \`skill-matches.json\` — ranked match list with confidence scores and trigger evidence (replaces the static \`loaded-skills.txt\`).
- \`tool-selection.json\` — per-step tool/model/runner decisions and the rule that fired.
- \`refinement.json\` (only when \`--refine\`) — \`{ model, input_tokens, output_tokens, edited_regions, diff_size, validator_passed }\`.

\`ricky --json\` includes these in the response so callers can audit the decisions.

## Test cases

Skill matcher (\`src/product/generation/skill-matcher.test.ts\`):
1. A spec that mentions "github primitive" matches the github skill above the relay-80-100 default.
2. A spec with no skill-relevant content falls back to the project default (\`writing-agent-relay-workflows\`).
3. Empty / missing skill registry → no skills loaded, no error, warning recorded.
4. Confidence below threshold → not selected even if it's the top match.

Tool selector (\`src/product/generation/tool-selector.test.ts\`):
1. Spec hint \`"use claude"\` → all agent steps get \`runner: 'claude'\`.
2. Spec hint \`"with codex"\` on a single step → only that step gets \`codex\`, others stay default.
3. Skill-pack metadata \`preferredRunner: 'opencode'\` → applied unless spec overrides.
4. No hints → project default runner.

Refinement (\`src/product/generation/refine-with-llm.test.ts\`):
1. Refinement returns a valid edit that passes the validator → applied.
2. Refinement edits outside the allowlist (changes the step graph) → rejected, warning, deterministic artifact returned unchanged.
3. Refinement timeout → deterministic artifact returned, warning includes elapsed ms.
4. Token budget exceeded → deterministic artifact returned, warning includes attempted vs max tokens.
5. Model unavailable / API error → deterministic artifact returned, warning surfaced, exit code unchanged.

End-to-end (manual):
- \`ricky --mode local --spec-file specs/cli-version-from-package-json.md\` → fast deterministic artifact, today's behavior.
- \`... --refine\` → same workflow shape but with sharper gate commands and step task descriptions tied to the spec's acceptance criteria.

## Out of scope

- Full agentic generation (LLM writes the workflow from scratch, not refines a scaffold). Different product, different latency budget.
- Skill authoring tooling. Just consumption.
- Cross-spec retrieval / RAG. The refinement pass sees only the spec + scaffold.
- Caching refinement output across invocations.

## Acceptance

- Skill matcher selects from the actual skill registry; same \`--version\` spec selects different skills than a "github webhook handler" spec.
- Tool selector produces per-step runner/model assignments visible in \`tool-selection.json\`.
- \`ricky --refine\` produces a refined artifact whose deterministic gates align with the spec's stated acceptance criteria. The unrefined path stays bit-for-bit unchanged.
- All existing generation tests still pass; ~14 new tests above pass.
- A vague spec that today produces a passable scaffold and a tightly-scoped one (like \`--version\`) that today produces a *near-correct* scaffold both produce *behavior-grounded* gates after \`--refine\`.

Tool selection: runner=@agent-relay/sdk; concurrency=2; rule=project default runner @agent-relay/sdk.

Write .workflow-artifacts/generated/spec-improve-generated-workflow-quality-skill-pa/final-review-codex.md ending with FINAL_REVIEW_CODEX_PASS.`,
      verification: { type: 'file_exists', value: ".workflow-artifacts/generated/spec-improve-generated-workflow-quality-skill-pa/final-review-codex.md" },
    })

    .step("final-review-pass-gate", {
      type: 'deterministic',
      dependsOn: ["final-review-claude", "final-review-codex"],
      command: "tail -n 1 '.workflow-artifacts/generated/spec-improve-generated-workflow-quality-skill-pa/final-review-claude.md' | tr -d '[:space:]*' | grep -Eq '^FINAL_REVIEW_CLAUDE_PASS$' && tail -n 1 '.workflow-artifacts/generated/spec-improve-generated-workflow-quality-skill-pa/final-review-codex.md' | tr -d '[:space:]*' | grep -Eq '^FINAL_REVIEW_CODEX_PASS$'",
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
      command: "git diff --name-only -- 'dist/bin/ricky.js' 'tool/model/runner' 'specs/cli-version-from-package-json.md' > '.workflow-artifacts/generated/spec-improve-generated-workflow-quality-skill-pa/git-diff.txt' && test -s '.workflow-artifacts/generated/spec-improve-generated-workflow-quality-skill-pa/git-diff.txt'",
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

      task: `Write .workflow-artifacts/generated/spec-improve-generated-workflow-quality-skill-pa/signoff.md.

Include:
- files changed
- dry-run command to execute before runtime launch
- deterministic validation commands
- review verdicts
- skill application boundary from .workflow-artifacts/generated/spec-improve-generated-workflow-quality-skill-pa/skill-application-boundary.json
- remaining risks or environmental blockers

Tool selection: runner=@agent-relay/sdk; concurrency=1; rule=project default runner @agent-relay/sdk.

End with GENERATED_WORKFLOW_READY.`,
      verification: { type: 'file_exists', value: ".workflow-artifacts/generated/spec-improve-generated-workflow-quality-skill-pa/signoff.md" },
    })

    .run({ cwd: process.cwd() });

  console.log(result.status);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
