# Spec: Improve generated-workflow quality (skill-pack matcher, CLI-tool selector, optional LLM augmentation)

## Problem

Ricky's `generate` step is fast (~milliseconds) because it's pure code: spec parser → pattern detector → template renderer → validator. No LLM, no network. That's a feature — most of the time you want a deterministic scaffold.

But the speed comes from skipping three decisions the renderer should be making, and the cost shows up in the produced workflow:

1. **Skill matching is hardcoded.** `src/product/generation/skill-loader.ts` declares `AVAILABLE_PREREQUISITES = new Set(['@agent-relay/sdk', 'embedded-relay-typescript-template'])`. There's no actual matcher against the rich PRPM-style skill registry; the same two skills get loaded regardless of what the spec is about.

2. **CLI-tool / agent selection is absent.** Generated workflows always use `@agent-relay/sdk` agent steps with no model or runtime choice. A spec that calls for `claude` (e.g. "use Claude to refactor X") or `codex` (e.g. "have codex audit Y") generates the same workflow shape — agent identity is left to runtime defaults.

3. **Step task descriptions are echoed spec text.** The template renderer's slot-fillers paste the spec's prose into each agent step. For tightly-scoped specs that's enough; for vague specs the agents do all the heavy lifting at runtime, often with under-specified instructions.

   This one bites in another way: deterministic gates generated from spec acceptance criteria can be too coarse. The current `--version` workflow generated `grep -Eq 'export|function|class|workflow(' dist/bin/ricky.js` as a post-implementation file gate, which fails on intentionally-minimal bin scripts that have none of those tokens. The grep was inferred from "primary artifact" without any behavioral grounding from the spec's actual acceptance text.

We need three additions: a skill matcher, a tool/agent selector, and an optional LLM-augmented refinement pass. All three should be additive — the fast deterministic path stays the default.

## Behavior we want

### 1. Skill-pack matcher

Replace the hardcoded `AVAILABLE_PREREQUISITES` set with a registry-backed matcher in `src/product/generation/skill-matcher.ts`:

- **Registry source**: read installed PRPM packages (or whatever the canonical skill registry is — `~/.claude/skills/` and project-local `skills/`). Cache the descriptor list at process start.
- **Matching**: for each skill, evaluate its `description` and triggers (filename patterns, keyword lists, file-mentions in the spec) against the normalized spec. Return ranked matches with confidence scores.
- **Selection**: pick the top N matches above a confidence threshold (default: 3 skills, ≥ 0.4 confidence). Ties broken by skill update-recency.
- **Output**: each selected skill's `loaded-skills.txt` artifact lists the matched skill IDs and why they were chosen (the trigger that fired).

Surfaces in the generated workflow as a `pre-implementation` step that loads the matched skills' SKILL.md files into the agent's context.

### 2. CLI-tool / agent selector

A `tool-selector.ts` companion that decides:

- **Which CLI tool runs each agent step** (`claude` / `codex` / `cursor` / `opencode` / generic `@agent-relay/sdk`). Defaults to the project's agent-relay default; overrides come from explicit spec hints (`use claude to ...`) or skill-pack metadata (a skill can declare its preferred runner).
- **Which model the runner targets**. Spec-level hints (`with sonnet`, `via opus 4.6`) override skill defaults override project defaults.
- **Concurrency** for parallelizable steps — currently always 1.

The selector is consulted once per step during template rendering. Output: each `step()` call gets the right `agent` / `model` / `runner` fields.

### 3. Optional LLM-augmented refinement (gated)

A new `--refine` flag (alias `--with-llm`) that adds a single LLM pass after the deterministic render:

```
ricky --mode local --spec-file my.md --refine
ricky --mode local --spec-file my.md --refine=sonnet  # explicit model
```

Without `--refine`, behavior is unchanged — fast, deterministic, no model call.

With `--refine`, after the renderer produces an artifact:

- Send the rendered artifact + the spec to a model with a focused prompt: *"Refine this generated workflow's step task descriptions and acceptance gates to be specific and behavioral. Do not change the workflow shape, the agent assignments, or the step graph."*
- Apply the returned diff (or reject if the model wandered outside the allowlist of editable regions).
- Re-run the validator on the refined artifact.
- Cost cap: hard timeout (45s) + token budget (configurable, default 50k input / 8k output). On overflow, return the deterministic artifact as-is and warn.

Default refinement model: Sonnet. Override via `--refine=<model>`.

Acceptance test for this layer: a spec like the `--version` one would produce a `post-implementation-file-gate` whose command actually verifies `node dist/bin/ricky.js --version | grep -Eq '^ricky [0-9]+\\.[0-9]+\\.[0-9]+$'` (the spec's stated acceptance) instead of a generic source-shape grep.

## Where these plug in

- `src/product/generation/skill-matcher.ts` (new) — replaces the hardcoded set in `skill-loader.ts`.
- `src/product/generation/tool-selector.ts` (new) — consulted from `template-renderer.ts` during slot fill.
- `src/product/generation/refine-with-llm.ts` (new) — invoked from `pipeline.ts` after the existing render+validate, only when `--refine` is set.
- `src/surfaces/cli/commands/cli-main.ts` — parse `--refine[=model]`, thread through the handoff.
- `src/local/entrypoint.ts` `toRawSpecPayload` — already structured-json under the CLI sane-defaults change; adding a `refine` field is straightforward.

## Output shape additions

Generated workflow context artifacts (`.workflow-artifacts/generated/<slug>/`):

- `skill-matches.json` — ranked match list with confidence scores and trigger evidence (replaces the static `loaded-skills.txt`).
- `tool-selection.json` — per-step tool/model/runner decisions and the rule that fired.
- `refinement.json` (only when `--refine`) — `{ model, input_tokens, output_tokens, edited_regions, diff_size, validator_passed }`.

`ricky --json` includes these in the response so callers can audit the decisions.

## Test cases

Skill matcher (`src/product/generation/skill-matcher.test.ts`):
1. A spec that mentions "github primitive" matches the github skill above the relay-80-100 default.
2. A spec with no skill-relevant content falls back to the project default (`writing-agent-relay-workflows`).
3. Empty / missing skill registry → no skills loaded, no error, warning recorded.
4. Confidence below threshold → not selected even if it's the top match.

Tool selector (`src/product/generation/tool-selector.test.ts`):
1. Spec hint `"use claude"` → all agent steps get `runner: 'claude'`.
2. Spec hint `"with codex"` on a single step → only that step gets `codex`, others stay default.
3. Skill-pack metadata `preferredRunner: 'opencode'` → applied unless spec overrides.
4. No hints → project default runner.

Refinement (`src/product/generation/refine-with-llm.test.ts`):
1. Refinement returns a valid edit that passes the validator → applied.
2. Refinement edits outside the allowlist (changes the step graph) → rejected, warning, deterministic artifact returned unchanged.
3. Refinement timeout → deterministic artifact returned, warning includes elapsed ms.
4. Token budget exceeded → deterministic artifact returned, warning includes attempted vs max tokens.
5. Model unavailable / API error → deterministic artifact returned, warning surfaced, exit code unchanged.

End-to-end (manual):
- `ricky --mode local --spec-file specs/cli-version-from-package-json.md` → fast deterministic artifact, today's behavior.
- `... --refine` → same workflow shape but with sharper gate commands and step task descriptions tied to the spec's acceptance criteria.

## Out of scope

- Full agentic generation (LLM writes the workflow from scratch, not refines a scaffold). Different product, different latency budget.
- Skill authoring tooling. Just consumption.
- Cross-spec retrieval / RAG. The refinement pass sees only the spec + scaffold.
- Caching refinement output across invocations.

## Acceptance

- Skill matcher selects from the actual skill registry; same `--version` spec selects different skills than a "github webhook handler" spec.
- Tool selector produces per-step runner/model assignments visible in `tool-selection.json`.
- `ricky --refine` produces a refined artifact whose deterministic gates align with the spec's stated acceptance criteria. The unrefined path stays bit-for-bit unchanged.
- All existing generation tests still pass; ~14 new tests above pass.
- A vague spec that today produces a passable scaffold and a tightly-scoped one (like `--version`) that today produces a *near-correct* scaffold both produce *behavior-grounded* gates after `--refine`.
