import { describe, expect, it } from 'vitest';

import {
  buildSpecFromGoal,
  runSpecIntakeFlow,
  specCaptureToHandoff,
} from './spec-intake-flow.js';

describe('spec intake flow', () => {
  it('reads a spec file through the injected filesystem seam and derives the default workflow name', async () => {
    const readFileText = async (path: string) => `Loaded from ${path}`;

    const capture = await runSpecIntakeFlow({
      cwd: '/repo',
      readFileText,
      prompts: {
        selectSpecSource: async () => 'spec-file',
        inputSpecFilePath: async ({ defaultPath }) => defaultPath ?? 'docs/release-checklist.md',
        editSpec: async () => 'unused',
        inputWorkflowName: async ({ defaultName }) => defaultName,
        inputGoal: async () => 'unused',
        approveGeneratedSpec: async () => 'approve',
        inputWorkflowArtifactPath: async () => 'unused',
      },
      preflight: {
        cwd: '/repo',
        repoRoot: '/repo',
        packageManager: 'npm',
        checks: [],
        specLocations: [{ path: 'docs/release-checklist.md', kind: 'file' }],
        workflowArtifacts: [],
        blockers: [],
      },
    });

    expect(capture).toMatchObject({
      source: 'spec-file',
      workflowName: 'release-checklist',
      specPath: '/repo/docs/release-checklist.md',
    });
    expect(capture.spec).toBe('Loaded from /repo/docs/release-checklist.md');
  });

  it('turns a goal into an approved local generation handoff', async () => {
    const capture = await runSpecIntakeFlow({
      cwd: '/repo',
      prompts: {
        selectSpecSource: async () => 'goal',
        inputSpecFilePath: async () => 'SPEC.md',
        editSpec: async ({ initialValue }) => `${initialValue}\nEdited: yes`,
        inputWorkflowName: async () => 'Release Health',
        inputGoal: async () => 'verify release health before packaging',
        approveGeneratedSpec: async () => 'approve',
        inputWorkflowArtifactPath: async () => 'workflows/generated/release-health.ts',
      },
    });

    expect(capture.source).toBe('goal');
    expect(capture.workflowName).toBe('release-health');
    expect(capture.spec).toContain('Goal: verify release health before packaging');
    expect(capture.generatedFromGoal?.approved).toBe(true);

    const handoff = specCaptureToHandoff(capture, '/repo', {
      outputPath: 'workflows/generated/release-health.ts',
    });

    expect(handoff).toMatchObject({
      source: 'cli',
      invocationRoot: '/repo',
      mode: 'local',
      stageMode: 'generate',
    });
    expect(handoff.source === 'cli' ? handoff.spec : undefined).toMatchObject({
      workflowName: 'release-health',
      artifactPath: 'workflows/generated/release-health.ts',
    });
  });

  it('uses the approved workflow name as the default generated artifact path', async () => {
    const capture = await runSpecIntakeFlow({
      cwd: '/repo',
      prompts: {
        selectSpecSource: async () => 'goal',
        inputSpecFilePath: async () => 'SPEC.md',
        editSpec: async ({ initialValue }) => initialValue ?? '',
        inputWorkflowName: async () => 'Repo Tidying',
        inputGoal: async () => 'I want to clean up the codebase to remove outdated and unused files',
        approveGeneratedSpec: async () => 'approve',
        inputWorkflowArtifactPath: async () => 'unused',
      },
    });

    const handoff = specCaptureToHandoff(capture, '/repo');

    expect(capture.workflowName).toBe('repo-tidying');
    expect(handoff.source === 'cli' ? handoff.spec : undefined).toMatchObject({
      workflowName: 'repo-tidying',
      artifactPath: 'workflows/generated/repo-tidying.ts',
    });
  });

  it('builds safety and evidence expectations into goal specs', () => {
    const spec = buildSpecFromGoal('fix failing tests', ['Run vitest and typecheck']);

    expect(spec).toContain('Apply only bounded, non-destructive fixes automatically.');
    expect(spec).toContain('Pause before credentials, destructive actions, dependency upgrades, commits, or pushes.');
    expect(spec).toContain('Run vitest and typecheck');
  });
});
