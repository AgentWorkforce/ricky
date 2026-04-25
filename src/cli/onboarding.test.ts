import { describe, expect, it } from 'vitest';

import {
  chooseBannerVariant,
  renderBanner,
  renderCloudGuidance,
  renderHandoffGuidance,
  renderOnboarding,
  renderRecoveryGuidance,
  renderWelcome,
  shouldShowBanner,
} from './index';

describe('Ricky CLI onboarding', () => {
  it('renders first-run onboarding with the full banner by default', () => {
    const output = renderOnboarding({ isFirstRun: true, isTTY: true });

    expect(output).toContain('RRRR');
    expect(output).toContain('Ricky helps you generate, debug, recover, and run workflows.');
    expect(output).toContain('Local / BYOH');
    expect(output).toContain('Cloud');
  });

  it('renders a compact returning-user flow without the banner by default', () => {
    const output = renderOnboarding({ isFirstRun: false, isTTY: true });

    expect(output).not.toContain('RRRR');
    expect(output).toContain('Ricky is ready. Continue locally, connect Cloud, or hand over the next workflow spec.');
  });

  it('keeps local/BYOH and Cloud as co-equal options', () => {
    const output = renderOnboarding({ isFirstRun: true, isTTY: true });

    expect(output).toContain('Local / BYOH');
    expect(output).toContain('Cloud');
    expect(output).toContain('Give Ricky a spec, a workflow artifact, or a Claude/MCP handoff and continue locally.');
    expect(output).toContain('Connect providers such as Google, then continue with hosted workflow generation and execution.');
  });

  it('uses real Google Cloud guidance and honest GitHub dashboard guidance', () => {
    const output = renderCloudGuidance();

    expect(output).toContain('npx agent-relay cloud connect google');
    expect(output).toContain('Cloud dashboard / Nango-backed connection flow');
    expect(output).not.toContain('github/connect/local');
  });

  it('includes Claude and MCP handoff language', () => {
    const output = renderHandoffGuidance();

    expect(output).toContain('Claude');
    expect(output).toContain('MCP');
    expect(output).toContain('Hand Ricky the spec directly.');
  });

  it('includes a recovery path when the local runtime is blocked', () => {
    const output = renderRecoveryGuidance('agent-relay is missing');

    expect(output).toContain('blocked: agent-relay is missing');
    expect(output).toContain('fix the local runtime issue or continue with Cloud setup instead');
  });

  it('suppresses the banner for quiet, no-banner, and non-TTY invocations', () => {
    expect(shouldShowBanner({ isFirstRun: true, isTTY: true, quiet: true })).toBe(false);
    expect(shouldShowBanner({ isFirstRun: true, isTTY: true, noBanner: true })).toBe(false);
    expect(shouldShowBanner({ isFirstRun: true, isTTY: false })).toBe(false);
  });

  it('falls back to the compact banner for narrow terminals', () => {
    expect(chooseBannerVariant(50)).toBe('compact');
    expect(renderBanner('compact')).toContain('ricky · workflow reliability for AgentWorkforce');
  });

  it('renders a stable compact welcome for returning users', () => {
    expect(renderWelcome({ isFirstRun: false })).toContain('Ricky is ready.');
  });
});
