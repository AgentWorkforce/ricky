import { describe, expect, it } from 'vitest';

import type { NormalizedWorkflowSpec, RawSpecPayload } from '../spec-intake/types.js';
import type { SkillContext, WorkflowTask } from './types.js';
import { selectToolsForSteps } from './tool-selector.js';

describe('tool selector', () => {
  it('applies a global use claude hint to all agent steps', () => {
    const result = selectToolsForSteps(spec('Use claude to implement the workflow.'), tasks(), emptySkills());

    expect(result.selections.every((selection) => selection.runner === 'claude')).toBe(true);
  });

  it('applies a single-step codex hint only to the matching step', () => {
    const result = selectToolsForSteps(
      spec('Use defaults. With codex on implement-artifact only.'),
      tasks(),
      emptySkills(),
    );

    expect(result.selections.find((selection) => selection.stepId === 'implement-artifact')?.runner).toBe('codex');
    expect(result.selections.find((selection) => selection.stepId === 'review-claude')?.runner).toBe('@agent-relay/sdk');
  });

  it('uses skill preferredRunner unless the spec overrides it', () => {
    const skills = emptySkills();
    skills.skills = [
      {
        name: 'opencode-skill',
        path: '/skills/opencode-skill/SKILL.md',
        loaded: true,
        applicable: true,
        prerequisitesMet: true,
        missingPrerequisites: [],
        preferredRunner: 'opencode',
      },
    ];

    expect(selectToolsForSteps(spec('Generate normally.'), tasks(), skills).selections[0].runner).toBe('opencode');
    expect(selectToolsForSteps(spec('Use claude for this workflow.'), tasks(), skills).selections[0].runner).toBe('claude');
  });

  it('applies spec model hints before skill and project defaults', () => {
    const skills = emptySkills();
    skills.skills = [
      {
        name: 'model-skill',
        path: '/skills/model-skill/SKILL.md',
        loaded: true,
        applicable: true,
        prerequisitesMet: true,
        missingPrerequisites: [],
        preferredModel: 'skill-default',
      },
    ];

    expect(
      selectToolsForSteps(spec('Use claude via opus 4.6 for this workflow.'), tasks(), skills, {
        projectDefaultModel: 'project-default',
      }).selections[0].model,
    ).toBe('opus-4.6');
    expect(selectToolsForSteps(spec('Generate normally.'), tasks(), skills).selections[0].model).toBe('skill-default');
  });

  it('ignores runner and model examples inside quoted documentation text', () => {
    const result = selectToolsForSteps(
      spec('Document examples like "use Claude to refactor X", `with sonnet`, and `via opus 4.6`, but generate normally.'),
      tasks(),
      emptySkills(),
    );

    expect(result.selections[0]).toMatchObject({ runner: '@agent-relay/sdk' });
    expect(result.selections[0].model).toBeUndefined();
  });

  it('falls back to the project default runner when there are no hints', () => {
    const result = selectToolsForSteps(spec('Generate normally.'), tasks(), emptySkills(), {
      projectDefaultRunner: 'codex',
    });

    expect(result.selections.every((selection) => selection.runner === 'codex')).toBe(true);
  });
});

function tasks(): WorkflowTask[] {
  return [
    { id: 'implement-artifact', name: 'Implement artifact', agentRole: 'impl-primary-codex', description: '', dependsOn: [] },
    { id: 'review-claude', name: 'Review with Claude', agentRole: 'reviewer-claude', description: '', dependsOn: [] },
  ];
}

function emptySkills(): SkillContext {
  return {
    skills: [],
    templates: [],
    loadWarnings: [],
    applicableSkillNames: [],
    applicationEvidence: [],
    matches: [],
    issues: [],
  };
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
