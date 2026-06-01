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

  it('parses review-depth overrides and rejects invalid tiers', () => {
    expect(parsePowerUserArgs(['local', '--spec', 'build a workflow', '--review-depth=light'])).toMatchObject({
      reviewDepth: 'light',
    });
    expect(parsePowerUserArgs(['local', '--spec', 'build a workflow', '--review-depth', 'deep'])).toMatchObject({
      reviewDepth: 'deep',
    });
    expect(parsePowerUserArgs(['local', '--spec', 'build a workflow', '--review-depth', 'fast']).errors).toContain(
      '--review-depth must be one of: light, standard, deep, auto (received fast).',
    );
  });

  it('parses best-judgement clarification handling for local generation', () => {
    expect(parsePowerUserArgs(['local', '--spec', 'build a workflow', '--best-judgement'])).toMatchObject({
      command: 'run',
      surface: 'local',
      mode: 'local',
      bestJudgement: true,
    });
    expect(parsePowerUserArgs(['workflow', '--spec-file', './SPEC.md', '--best-judgment'])).toMatchObject({
      command: 'run',
      surface: 'workflow',
      mode: 'local',
      specFile: './SPEC.md',
      bestJudgement: true,
    });
  });

  it('parses --input KEY=VALUE flags into an inputs record', () => {
    const parsed = parsePowerUserArgs([
      'local', '--spec-file', './_review.md', '--run',
      '--input', 'TARGET_SPEC=specs/021-sentry.md',
      '--input', 'DIFF_RANGE=abc..HEAD',
    ]);
    expect(parsed.inputs).toEqual({
      TARGET_SPEC: 'specs/021-sentry.md',
      DIFF_RANGE: 'abc..HEAD',
    });
    expect(parsed).not.toHaveProperty('errors');
  });

  it('accepts the --input=KEY=VALUE inline form and an empty value', () => {
    const parsed = parsePowerUserArgs([
      'local', '--spec-file', './_review.md', '--run',
      '--input=TARGET_SPEC=',
    ]);
    expect(parsed.inputs).toEqual({ TARGET_SPEC: '' });
  });

  it('reports an error for a malformed --input without KEY=VALUE', () => {
    const parsed = parsePowerUserArgs([
      'local', '--spec-file', './_review.md', '--run',
      '--input', 'NOTAPAIR',
    ]);
    expect(parsed.errors).toBeDefined();
    expect(parsed.errors?.some((e) => e.includes('KEY=VALUE'))).toBe(true);
  });

  it('reports an error for an invalid --input env var name', () => {
    const parsed = parsePowerUserArgs([
      'local', '--spec-file', './_review.md', '--run',
      '--input', '1BAD=value',
    ]);
    expect(parsed.errors?.some((e) => e.includes('not a valid environment variable name'))).toBe(true);
  });

  it('does not consume a following flag when --input has no value (keeps --run intact)', () => {
    const parsed = parsePowerUserArgs([
      'local', '--spec-file', './_review.md', '--input', '--run',
    ]);
    // --run must still be recognized, not swallowed as the --input value.
    expect(parsed.runRequested).toBe(true);
    expect(parsed.errors?.some((e) => e.includes('--input requires a KEY=VALUE'))).toBe(true);
    expect(parsed.inputs).toBeUndefined();
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

  it('parses --no-auto-salvage as an explicit opt-out flag', () => {
    const enabled = parsePowerUserArgs(['local', '--spec-file', './spec.md', '--run']);
    expect(enabled).not.toHaveProperty('noAutoSalvage');

    const disabled = parsePowerUserArgs(['local', '--spec-file', './spec.md', '--run', '--no-auto-salvage']);
    expect(disabled).toMatchObject({ noAutoSalvage: true });
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

  it('rejects unknown status targets', () => {
    expect(parsePowerUserArgs(['status', 'foo', '--json'])).toMatchObject({
      command: 'status',
      surface: 'status',
      json: true,
      errors: ['unknown status target: foo'],
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
