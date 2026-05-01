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
      autoFix: 3,
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
});
