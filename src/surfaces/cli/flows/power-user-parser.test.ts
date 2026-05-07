import { describe, expect, it } from 'vitest';

import { parsePowerUserArgs } from './power-user-parser.js';

describe('power user parser defaults', () => {
  it('keeps auto-fix default-on and refinement omitted when flags are absent', () => {
    const parsed = parsePowerUserArgs(['local', '--spec', 'build a workflow', '--run']);

    expect(parsed).toMatchObject({
      command: 'run',
      surface: 'local',
      mode: 'local',
      spec: 'build a workflow',
      runRequested: true,
      autoFix: 7,
    });
    expect(parsed).not.toHaveProperty('refine');
  });

  it('parses explicit auto-fix and refinement opt-ins', () => {
    expect(parsePowerUserArgs(['local', '--spec', 'build a workflow', '--run', '--auto-fix=5'])).toMatchObject({
      autoFix: 5,
    });
    expect(parsePowerUserArgs(['local', '--spec', 'build a workflow', '--refine=sonnet'])).toMatchObject({
      refine: { model: 'sonnet' },
    });
  });

  it('parses the workflow one-shot command for local execution and Cloud generation', () => {
    expect(parsePowerUserArgs(['workflow', '--spec-file', './SPEC.md', '--run'])).toMatchObject({
      command: 'run',
      surface: 'workflow',
      mode: 'local',
      specFile: './SPEC.md',
      runRequested: true,
    });

    const cloud = parsePowerUserArgs(['workflow', '--spec-file', './SPEC.md', '--mode', 'cloud']);
    expect(cloud).toMatchObject({
      command: 'run',
      surface: 'workflow',
      mode: 'cloud',
      specFile: './SPEC.md',
    });
    expect(cloud).not.toHaveProperty('runRequested');
  });

  it('reports invalid workflow mode values instead of defaulting to local', () => {
    expect(parsePowerUserArgs(['workflow', '--spec-file', './SPEC.md', '--mode', 'clodu'])).toMatchObject({
      command: 'run',
      surface: 'workflow',
      specFile: './SPEC.md',
      errors: ['--mode must be one of: local, cloud, or both.'],
    });
    expect(parsePowerUserArgs(['workflow', '--spec-file', './SPEC.md', '--mode'])).toMatchObject({
      errors: ['--mode must be one of: local, cloud, or both.'],
    });
  });

  it('honors explicit auto-fix and refinement disables', () => {
    const parsed = parsePowerUserArgs(['local', '--spec', 'build a workflow', '--run', '--no-auto-fix', '--no-refine']);

    expect(parsed).not.toHaveProperty('autoFix');
    expect(parsed).not.toHaveProperty('refine');
  });

  it('parses manual resume flags without confusing their values for artifact paths', () => {
    const parsed = parsePowerUserArgs([
      'run',
      '--start-from',
      'self-review-pass-gate',
      '--previous-run-id',
      'relay-run-123',
      'workflows/generated/review.ts',
    ]);

    expect(parsed).toMatchObject({
      command: 'run',
      artifact: 'workflows/generated/review.ts',
      startFromStep: 'self-review-pass-gate',
      previousRunId: 'relay-run-123',
    });
  });

  it('parses ricky run artifact --cloud as Cloud execution shorthand', () => {
    expect(parsePowerUserArgs(['run', 'workflows/generated/review.ts', '--cloud'])).toMatchObject({
      command: 'run',
      surface: 'legacy',
      mode: 'cloud',
      artifact: 'workflows/generated/review.ts',
      runRequested: true,
    });
  });

  it('treats bare connect --cloud as the standard Cloud targets', () => {
    expect(parsePowerUserArgs(['connect', 'agents', '--cloud'])).toMatchObject({
      command: 'connect',
      surface: 'connect',
      connectTarget: 'agents',
      cloudTargets: ['claude', 'codex', 'opencode', 'gemini'],
    });

    expect(parsePowerUserArgs(['connect', 'integrations', '--cloud'])).toMatchObject({
      command: 'connect',
      surface: 'connect',
      connectTarget: 'integrations',
      cloudTargets: ['slack', 'github', 'notion', 'linear'],
    });
  });

  it('parses inline --cloud target lists for connect commands', () => {
    expect(parsePowerUserArgs(['connect', 'agents', '--cloud=claude,codex'])).toMatchObject({
      cloudTargets: ['claude', 'codex'],
    });
  });

  it('requires --run for power-user workflow artifact execution', () => {
    const preview = parsePowerUserArgs(['local', '--workflow', 'workflows/generated/review.ts']);
    expect(preview).toMatchObject({
      command: 'run',
      surface: 'local',
      mode: 'local',
      artifact: 'workflows/generated/review.ts',
    });
    expect(preview).not.toHaveProperty('runRequested');

    expect(parsePowerUserArgs(['local', '--workflow', 'workflows/generated/review.ts', '--run'])).toMatchObject({
      artifact: 'workflows/generated/review.ts',
      runRequested: true,
    });
    expect(parsePowerUserArgs(['run', 'workflows/generated/review.ts'])).toMatchObject({
      artifact: 'workflows/generated/review.ts',
      runRequested: true,
    });
  });
});
