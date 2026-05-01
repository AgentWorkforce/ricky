import { describe, expect, it } from 'vitest';

import { buildWorkflowSummary, renderWorkflowSummary } from './workflow-summary.js';

describe('workflow summary', () => {
  it('names artifact, goal, agents, desired outcome, side effects, and local blockers', () => {
    const summary = buildWorkflowSummary({
      capture: {
        source: 'editor',
        workflowName: 'release-health',
        spec: 'Verify release health across tests.',
      },
      localResult: {
        ok: true,
        artifacts: [{
          path: 'workflows/generated/release-health.ts',
          content: "workflow('release').agent('codex', { role: 'Run deterministic checks' })",
        }],
        logs: [],
        warnings: [],
        nextActions: [],
        generation: {
          stage: 'generate',
          status: 'ok',
          artifact: {
            path: 'workflows/generated/release-health.ts',
            workflow_id: 'wf-release',
            spec_digest: 'digest',
          },
        },
      },
      preflight: {
        cwd: '/repo',
        repoRoot: '/repo',
        packageManager: 'npm',
        specLocations: [],
        workflowArtifacts: [],
        blockers: ['agent-relay'],
        checks: [
          {
            id: 'agent-relay',
            label: 'agent-relay',
            status: 'missing',
            blocker: true,
            recovery: 'npm install',
          },
        ],
      },
    });

    expect(summary.artifactPath).toBe('workflows/generated/release-health.ts');
    expect(summary.goal).toBe('Verify release health across tests.');
    expect(summary.agents).toEqual([{ name: 'codex', job: 'Run deterministic checks' }]);
    expect(summary.desiredOutcome).toContain('completed local Agent Relay run');
    expect(summary.sideEffects.join('\n')).toContain('.workflow-artifacts/');
    expect(summary.missingLocalBlockers).toEqual(['agent-relay: npm install']);
    expect(renderWorkflowSummary(summary).join('\n')).toContain('Ricky wrote: workflows/generated/release-health.ts');
  });
});
