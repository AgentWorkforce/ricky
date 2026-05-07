import { describe, expect, it } from 'vitest';

import { buildLinearWorkflow } from '../workflow-builder.js';

function baseInput(agentCount: number) {
  return {
    issue: {
      title: 'Fix flaky import path handling',
      description: 'The generated workflow should normalize imports before running tests.',
      labels: ['bug', 'backend'],
      comments: ['Please keep the fix scoped.'],
    },
    repoTarget: { owner: 'AgentWorkforce', repo: 'ricky', defaultBranch: 'main' },
    connectedAgents: Array.from({ length: agentCount }, (_, index) => ({
      id: `agent-${index + 1}`,
      name: `Agent ${index + 1}`,
      capabilities: ['implementation', 'tests'],
    })),
    actor: { linearUserId: 'linear-user-1', cloudUserId: 'cloud-user-1' },
  };
}

describe('buildLinearWorkflow', () => {
  it('selects pipeline, supervisor, and dag from connected-agent count', () => {
    expect(buildLinearWorkflow(baseInput(1)).pattern).toBe('pipeline');
    expect(buildLinearWorkflow(baseInput(2)).pattern).toBe('supervisor');
    expect(buildLinearWorkflow(baseInput(3)).pattern).toBe('dag');
  });

  it('includes issue labels in the rationale and generated artifact', () => {
    const result = buildLinearWorkflow(baseInput(2));

    expect(result.rationale).toContain('bug, backend');
    expect(result.artifactContent).toContain('Respect issue labels: bug, backend');
    expect(result.selectedAgents).toEqual(['Agent 1', 'Agent 2']);
  });

  it('throws when repoTarget is missing', () => {
    expect(() => buildLinearWorkflow({ ...baseInput(1), repoTarget: null })).toThrow(/repoTarget/);
  });
});
