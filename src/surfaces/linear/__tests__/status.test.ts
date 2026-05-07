import { describe, expect, it } from 'vitest';

import { linearStatusSummary } from '../status.js';

describe('linearStatusSummary', () => {
  it('checks GitHub before connected agents', () => {
    const summary = linearStatusSummary({
      integrations: {
        github: { connected: false },
        linear: { connected: true, label: 'linear-ricky' },
      },
      agents: {
        codex: { connected: true, capable: true },
      },
    });

    expect(summary.ready).toBe(false);
    expect(summary.rows.map((row) => row.label)).toEqual(['GitHub App', 'Connected agents', 'Linear Actor app']);
    expect(summary.rows[1]).toMatchObject({
      status: 'blocked',
      message: 'not checked until GitHub App is installed',
    });
  });
});
