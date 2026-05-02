import { describe, expect, it } from 'vitest';

import {
  buildWorkflowSummary,
  cloudPowerUserWorkflowSummary,
  renderPowerUserWorkflowSummary,
  renderWorkflowSummary,
} from './workflow-summary.js';

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
    expect(summary.jobs).toEqual(['codex: Run deterministic checks']);
    expect(summary.plan).toEqual([
      'Generate workflow artifact workflows/generated/release-health.ts through the existing local generation pipeline.',
      'Run assigned jobs with codex.',
      'Monitor the run, preserve evidence, and stop before destructive actions or commits.',
    ]);
    expect(summary.desiredOutcome).toContain('completed local Agent Relay run');
    expect(summary.sideEffects.join('\n')).toContain('.workflow-artifacts/');
    expect(summary.missingLocalBlockers).toEqual(['agent-relay: npm install']);
    const rendered = renderWorkflowSummary(summary).join('\n');
    expect(rendered).toContain('Ricky wrote: workflows/generated/release-health.ts');
    expect(rendered).toContain('Plan\n  1. Generate workflow artifact workflows/generated/release-health.ts');
  });

  it('prints a Cloud run command when a generated Cloud artifact is not run immediately', () => {
    const summary = cloudPowerUserWorkflowSummary({
      artifacts: [{ path: 'workflows/generated/cloud-release.ts', type: 'text/typescript' }],
      warnings: [],
      assumptions: [],
      validation: { ok: true, status: 'passed', issues: [] },
      followUpActions: [],
    }, {
      mode: 'cloud',
      workflowName: 'cloud-release',
      runRequested: false,
    });

    expect(summary.runCommand).toBe('ricky cloud --workflow workflows/generated/cloud-release.ts --run');
    expect(renderPowerUserWorkflowSummary(summary, { mode: 'cloud', runRequested: false }).join('\n')).toContain(
      'Run: ricky cloud --workflow workflows/generated/cloud-release.ts --run',
    );
  });
});
