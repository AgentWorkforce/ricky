import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { NormalizedWorkflowSpec, RawSpecPayload } from '../spec-intake/types.js';
import { loadSkillRegistry, matchSkills, resetSkillRegistryCache, type SkillRegistryDescriptor } from './skill-matcher.js';

const originalCwd = process.cwd();
const repoRoot = originalCwd.endsWith('/src/product') ? resolve(originalCwd, '../..') : originalCwd;

afterEach(() => {
  process.chdir(originalCwd);
  resetSkillRegistryCache();
});

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

  it('falls back to the project workflow-generation defaults when no skill-relevant content matches', () => {
    const matches = matchSkills(spec('Update a small README sentence.'), {
      registry: registry([
        { id: 'choosing-swarm-patterns', description: 'Use for Agent Relay workflow pattern selection.' },
        { id: 'writing-agent-relay-workflows', description: 'Use for agent relay workflow authoring.' },
        { id: 'relay-80-100-workflow', description: 'Use for end-to-end workflow validation.' },
      ]),
    });

    expect(matches).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'choosing-swarm-patterns',
          reason: expect.stringContaining('Project default'),
        }),
        expect.objectContaining({
          id: 'writing-agent-relay-workflows',
          reason: expect.stringContaining('Project default'),
        }),
        expect.objectContaining({
          id: 'relay-80-100-workflow',
          reason: expect.stringContaining('Project default'),
        }),
      ]),
    );
  });

  it('returns no skills for an empty registry', () => {
    expect(matchSkills(spec('Generate a workflow.'), { registry: [] })).toEqual([]);
  });

  it('preserves top-ranked matches when the caller explicitly caps maxMatches', () => {
    const matches = matchSkills(spec('Generate a github primitive webhook handler.'), {
      registry: registry([
        { id: 'github-primitive', description: 'Use for github primitive webhook handlers and GitHub APIs.' },
        { id: 'choosing-swarm-patterns', description: 'Use for Agent Relay workflow pattern selection.' },
        { id: 'writing-agent-relay-workflows', description: 'Use for agent relay workflow authoring.' },
        { id: 'relay-80-100-workflow', description: 'Use for end-to-end workflow validation.' },
      ]),
      maxMatches: 1,
    });

    expect(matches).toEqual([
      expect.objectContaining({ id: 'github-primitive' }),
    ]);
  });

  it('does not select below-threshold matches when fallback is disabled', () => {
    const matches = matchSkills(spec('Tiny unrelated request.'), {
      registry: registry([{ id: 'github-primitive', description: 'GitHub webhook APIs.' }]),
      threshold: 0.9,
      defaultSkillId: null,
    });

    expect(matches).toEqual([]);
  });

  it('produces stable ordering for equal-confidence skills regardless of updatedAt', () => {
    const matches = matchSkills(spec('Generate a github primitive webhook handler with relay workflows.'), {
      registry: registry([
        { id: 'beta-skill', description: 'Use for github primitive webhook handlers.', updatedAt: '2026-04-30T00:00:00.000Z' },
        { id: 'alpha-skill', description: 'Use for github primitive webhook handlers.', updatedAt: '2020-01-01T00:00:00.000Z' },
      ]),
      defaultSkillId: null,
    });

    expect(matches.length).toBeGreaterThanOrEqual(2);
    expect(matches[0].id).toBe('alpha-skill');
    expect(matches[1].id).toBe('beta-skill');

    const reversed = matchSkills(spec('Generate a github primitive webhook handler with relay workflows.'), {
      registry: registry([
        { id: 'alpha-skill', description: 'Use for github primitive webhook handlers.', updatedAt: '2020-01-01T00:00:00.000Z' },
        { id: 'beta-skill', description: 'Use for github primitive webhook handlers.', updatedAt: '2026-04-30T00:00:00.000Z' },
      ]),
      defaultSkillId: null,
    });

    expect(reversed[0].id).toBe('alpha-skill');
    expect(reversed[1].id).toBe('beta-skill');
  });

  it('discovers project skills when invoked from a nested source directory', () => {
    process.chdir(resolve(repoRoot, 'src/product'));
    resetSkillRegistryCache();

    const skills = loadSkillRegistry();

    expect(skills).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'choosing-swarm-patterns',
          path: expect.stringMatching(new RegExp(`^${escapeRegExp(repoRoot)}/.*skills/choosing-swarm-patterns/SKILL\\.md$`)),
        }),
        expect.objectContaining({
          id: 'writing-agent-relay-workflows',
          path: expect.stringMatching(new RegExp(`^${escapeRegExp(repoRoot)}/.*skills/writing-agent-relay-workflows/SKILL\\.md$`)),
        }),
      ]),
    );
  });

  it('discovers bundled package skills when invoked outside a project tree', () => {
    const emptyProject = mkdtempSync(join(tmpdir(), 'ricky-empty-project-'));
    try {
      process.chdir(emptyProject);
      resetSkillRegistryCache();

      const skills = loadSkillRegistry();

      expect(skills).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: 'choosing-swarm-patterns' }),
          expect.objectContaining({ id: 'writing-agent-relay-workflows' }),
          expect.objectContaining({ id: 'relay-80-100-workflow' }),
        ]),
      );
    } finally {
      process.chdir(originalCwd);
      rmSync(emptyProject, { recursive: true, force: true });
      resetSkillRegistryCache();
    }
  });
});

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

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
