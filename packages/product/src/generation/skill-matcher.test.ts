import { describe, expect, it } from 'vitest';

import type { NormalizedWorkflowSpec, RawSpecPayload } from '../spec-intake/types.js';
import { matchSkills, type SkillRegistryDescriptor } from './skill-matcher.js';

describe('skill matcher', () => {
  it('matches a github primitive skill above the default workflow skill', () => {
    const matches = matchSkills(spec('Generate a github primitive webhook handler.'), {
      registry: registry([
        { id: 'github-primitive', description: 'Use for github primitive webhook handlers and GitHub APIs.' },
        { id: 'writing-agent-relay-workflows', description: 'Use for agent relay workflow authoring.' },
      ]),
    });

    expect(matches[0]).toMatchObject({ id: 'github-primitive' });
    expect(matches[0].confidence).toBeGreaterThanOrEqual(0.4);
  });

  it('falls back to the project default when no skill-relevant content matches', () => {
    const matches = matchSkills(spec('Update a small README sentence.'), {
      registry: registry([
        { id: 'writing-agent-relay-workflows', description: 'Use for agent relay workflow authoring.' },
      ]),
    });

    expect(matches).toEqual([
      expect.objectContaining({
        id: 'writing-agent-relay-workflows',
        reason: expect.stringContaining('Project default'),
      }),
    ]);
  });

  it('returns no skills for an empty registry', () => {
    expect(matchSkills(spec('Generate a workflow.'), { registry: [] })).toEqual([]);
  });

  it('does not select below-threshold matches when fallback is disabled', () => {
    const matches = matchSkills(spec('Tiny unrelated request.'), {
      registry: registry([{ id: 'github-primitive', description: 'GitHub webhook APIs.' }]),
      threshold: 0.9,
      defaultSkillId: null,
    });

    expect(matches).toEqual([]);
  });
});

function registry(entries: Array<Partial<SkillRegistryDescriptor> & { id: string }>): SkillRegistryDescriptor[] {
  return entries.map((entry) => ({
    name: entry.id,
    path: `/skills/${entry.id}/SKILL.md`,
    description: entry.description ?? '',
    keywords: entry.keywords ?? [],
    filePatterns: entry.filePatterns ?? [],
    updatedAt: entry.updatedAt,
    preferredRunner: entry.preferredRunner,
    ...entry,
  }));
}

function spec(description: string): NormalizedWorkflowSpec {
  const rawPayload: RawSpecPayload = {
    kind: 'natural_language',
    surface: 'cli',
    receivedAt: '2026-04-26T00:00:00.000Z',
    text: description,
  };
  const providerContext = { surface: 'cli' as const, metadata: {} };
  return {
    intent: 'generate',
    description,
    targetRepo: null,
    targetContext: null,
    targetFiles: [],
    desiredAction: { kind: 'generate', summary: description, targetFiles: [] },
    constraints: [],
    evidenceRequirements: [],
    requiredEvidence: [],
    acceptanceGates: [],
    acceptanceCriteria: [],
    executionPreference: 'auto',
    providerContext,
    sourceSpec: {
      surface: 'cli',
      intent: { primary: 'generate', signals: [] },
      description,
      targetFiles: [],
      constraints: [],
      evidenceRequirements: [],
      acceptanceGates: [],
      providerContext,
      rawPayload,
      parseConfidence: 'high',
      parseWarnings: [],
    },
  };
}
