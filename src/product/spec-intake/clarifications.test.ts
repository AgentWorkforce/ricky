import { describe, expect, it } from 'vitest';

import { analyzeClarificationNeeds, normalizeSpec, parseSpec } from './index.js';
import type { RawSpecPayload } from './types.js';

const RECEIVED_AT = '2026-05-15T00:00:00.000Z';

function cliStructured(description: string): RawSpecPayload {
  return {
    kind: 'structured_json',
    surface: 'cli',
    receivedAt: RECEIVED_AT,
    requestId: 'cli-request',
    data: {
      intent: 'generate',
      description,
    },
  };
}

function questionsFor(spec: string): string[] {
  const parsed = parseSpec(cliStructured(spec));
  const { normalized, issues } = normalizeSpec(parsed);
  return analyzeClarificationNeeds(normalized, issues).map((q) => q.question);
}

describe('analyzeClarificationNeeds', () => {
  it('coalesces multi-line numbered Open Questions into one question per item', () => {
    const spec = [
      '# Gap spec',
      '',
      'Generate a workflow to close PR 39 gaps.',
      '',
      '## Open Questions',
      '',
      '1. Should the skill contracts be changed to match current runtime names',
      '   (`LAYOUT.md`, YAML frontmatter), or should runtime change to match skills',
      '   (`.layout.md`, `window`/`generated` header)?',
      '2. Should digest generation remain generic in `cloud`, or should adapter',
      '   `digest()` handlers own all provider-specific bullet rendering?',
      '3. Is `/.skills/activity-summary.md` intended to be a mounted runtime artifact,',
      '   or only an installed-agent skill? Current evals imply a mounted artifact.',
      '4. Is `by-edited` mandatory for every resource with an update timestamp, or only',
      '   for resources used by activity-summary fallbacks?',
      '5. Should writeback status history be durable enough to list succeeded/failed',
      '   operations, or should only pending/dead be exposed to agents?',
    ].join('\n');

    const questions = questionsFor(spec);

    // Each numbered item collapses to a single coalesced question — none of the
    // mid-question continuation lines should appear as standalone fragments.
    // We match against plain-text substrings because the mdast walker emits
    // inline-code values without the surrounding backticks.
    expect(questions).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Should the skill contracts be changed to match current runtime names'),
        expect.stringContaining('should runtime change to match skills'),
        expect.stringContaining('Should digest generation remain generic in'),
        expect.stringContaining('intended to be a mounted runtime artifact'),
        expect.stringContaining('mandatory for every resource'),
        expect.stringContaining('Should writeback status history be durable enough'),
      ]),
    );

    // Regression: pre-fix the user saw only the wrapped tail of each item.
    for (const q of questions) {
      expect(q).not.toMatch(/^Please clarify: \(`\.layout\.md`/);
      expect(q).not.toMatch(/^Please clarify: `digest\(\)` handlers/);
      expect(q).not.toMatch(/^Please clarify: for resources used by activity-summary fallbacks\?$/);
      expect(q).not.toMatch(/^Please clarify: operations, or should only pending\/dead/);
    }
  });

  it('does not cap the number of open questions surfaced from the spec', () => {
    const items = Array.from({ length: 6 }, (_, i) => `${i + 1}. Should we pick option ${i + 1}?`);
    const spec = ['Generate a workflow.', '', '## Open Questions', '', ...items].join('\n');

    const questions = questionsFor(spec);
    // 6 numbered open questions should all be surfaced (pre-fix the slice
    // capped this at 3, hiding the rest until the user re-ran).
    const openQuestionMatches = questions.filter((q) => /Should we pick option \d/.test(q));
    expect(openQuestionMatches).toHaveLength(6);
  });

  it('resolves execution preference by first-mention position, not fixed priority order', () => {
    // Regression: when the declared value mentions both "cloud" and "local",
    // the function used to return 'local' regardless of which one appeared
    // first. The author of `Execution preference: cloud. Local is a follow-up.`
    // means cloud — the trailing prose about "local follow-up" should not
    // invert the declaration.
    const cloudFirst = [
      'Generate a workflow.',
      '',
      'Execution preference: cloud. Local is a follow-up.',
    ].join('\n');
    const localFirst = [
      'Generate a workflow.',
      '',
      'Execution preference: local/BYOH first. Cloud promotion is a follow-up.',
    ].join('\n');

    const cloudNormalized = normalizeSpec(parseSpec(cliStructured(cloudFirst))).normalized;
    expect(cloudNormalized.executionPreference).toBe('cloud');

    const localNormalized = normalizeSpec(parseSpec(cliStructured(localFirst))).normalized;
    expect(localNormalized.executionPreference).toBe('local');
  });

  it('does not surface the execution-mode conflict when the spec declares Execution preference: local', () => {
    const spec = [
      'Generate a workflow that touches the local relayfile mount and the hosted cloud runtime.',
      '',
      'Execution preference: local/BYOH first. Cloud promotion is a follow-up.',
      '',
      'No destructive actions; pause for approval before commits or pushes.',
    ].join('\n');

    const parsed = parseSpec(cliStructured(spec));
    const { normalized, issues } = normalizeSpec(parsed);

    expect(normalized.executionPreference).toBe('local');
    const questions = analyzeClarificationNeeds(normalized, issues);
    expect(questions.some((q) => /locally\/BYOH, in Cloud/i.test(q.question))).toBe(false);
  });

  it('skips items already answered in a Clarification answers block', () => {
    const spec = [
      'Generate a workflow.',
      '',
      '## Open Questions',
      '',
      '1. Should we pick option A or option B?',
      '2. Should we keep the old behavior?',
      '',
      'Clarification answers:',
      '- Should we pick option A or option B?: option A',
    ].join('\n');

    const questions = questionsFor(spec);
    expect(questions.some((q) => /option A or option B/.test(q))).toBe(false);
    expect(questions.some((q) => /keep the old behavior/.test(q))).toBe(true);
  });

  it('skips items already answered in a Best-judgement clarifications block', () => {
    const spec = [
      'Generate a workflow.',
      '',
      '## Open Questions',
      '',
      '1. Should we pick option A or option B?',
      '2. Should we keep the old behavior?',
      '',
      'Best-judgement clarifications:',
      '- Should we pick option A or option B?: option A',
    ].join('\n');

    const questions = questionsFor(spec);
    expect(questions.some((q) => /option A or option B/.test(q))).toBe(false);
    expect(questions.some((q) => /keep the old behavior/.test(q))).toBe(true);
  });

  it('terminates paragraph-style Open questions sections at the next heading', () => {
    const spec = [
      'Generate a workflow.',
      '',
      'Open questions:',
      '',
      '1. Should we pick option A or option B?',
      '',
      '## Scope',
      '',
      '- Use the current repository.',
    ].join('\n');

    const questions = questionsFor(spec);
    expect(questions.some((q) => /option A or option B/.test(q))).toBe(true);
    expect(questions.some((q) => /Use the current repository/.test(q))).toBe(false);
  });

  it('uses Best-judgement clarifications to answer the execution-mode conflict', () => {
    const spec = [
      'Generate a workflow that touches the local relayfile mount and the hosted cloud runtime.',
      '',
      'Best-judgement clarifications:',
      '- Should this workflow run locally/BYOH, in Cloud, or generate artifacts for both paths?: local/BYOH',
    ].join('\n');

    const parsed = parseSpec(cliStructured(spec));
    const { normalized, issues } = normalizeSpec(parsed);

    expect(normalized.executionPreference).toBe('local');
    const questions = analyzeClarificationNeeds(normalized, issues);
    expect(questions.some((q) => /locally\/BYOH, in Cloud/i.test(q.question))).toBe(false);
  });
});
