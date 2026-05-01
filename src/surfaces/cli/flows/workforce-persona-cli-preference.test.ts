import { afterEach, describe, expect, it } from 'vitest';

import { resolvePreferWorkforcePersonaWorkflowWriter } from './workforce-persona-cli-preference.js';

describe('resolvePreferWorkforcePersonaWorkflowWriter', () => {
  const prev = process.env.RICKY_WORKFORCE_PERSONA_CLI;

  afterEach(() => {
    if (prev === undefined) delete process.env.RICKY_WORKFORCE_PERSONA_CLI;
    else process.env.RICKY_WORKFORCE_PERSONA_CLI = prev;
  });

  it('defaults to Workforce persona authoring when neither flags nor env are set', () => {
    delete process.env.RICKY_WORKFORCE_PERSONA_CLI;
    expect(resolvePreferWorkforcePersonaWorkflowWriter({})).toBe(true);
  });

  it('--workforce-persona wins over disabling env', () => {
    process.env.RICKY_WORKFORCE_PERSONA_CLI = '0';
    expect(resolvePreferWorkforcePersonaWorkflowWriter({ workforcePersonaWriterCli: true })).toBe(true);
  });

  it('--no-workforce-persona wins over enabling env', () => {
    process.env.RICKY_WORKFORCE_PERSONA_CLI = '1';
    expect(resolvePreferWorkforcePersonaWorkflowWriter({ workforcePersonaWriterCli: false })).toBe(false);
  });

  it('respects env when flag absent', () => {
    delete process.env.RICKY_WORKFORCE_PERSONA_CLI;
    expect(resolvePreferWorkforcePersonaWorkflowWriter({})).toBe(true);
    process.env.RICKY_WORKFORCE_PERSONA_CLI = '1';
    expect(resolvePreferWorkforcePersonaWorkflowWriter({})).toBe(true);
    process.env.RICKY_WORKFORCE_PERSONA_CLI = 'false';
    expect(resolvePreferWorkforcePersonaWorkflowWriter({})).toBe(false);
  });
});
