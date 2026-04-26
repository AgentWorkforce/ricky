import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';

import {
  chooseBannerVariant,
  renderBanner,
  renderCloudGuidance,
  renderHandoffGuidance,
  renderModeResult,
  renderOnboarding,
  renderRecoveryGuidance,
  renderSuggestedNextAction,
  renderWelcome,
  runOnboarding,
  shouldShowBanner,
  type RickyConfig,
  type RickyConfigStore,
} from './index';

describe('Ricky CLI onboarding', () => {
  it('renders first-run onboarding with the full banner by default', () => {
    const output = renderOnboarding({ isFirstRun: true, isTTY: true, env: {} });

    expect(output).toContain('RRRR');
    expect(output).toContain("Welcome to Ricky! Let's get you set up.");
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
    const output = renderOnboarding({ isFirstRun: true, isTTY: true, env: {} });

    expect(output).toContain('Local / BYOH');
    expect(output).toContain('Cloud');
    expect(output).toContain('Give Ricky a spec, a workflow artifact, or a Claude/MCP handoff and continue locally.');
    expect(output).toContain('Connect providers such as Google, then continue with hosted workflow generation and execution.');
  });

  it('uses real Google Cloud guidance and honest GitHub dashboard guidance', () => {
    const output = `${renderCloudGuidance()}\n${renderModeResult('cloud')}`;

    expect(output).toContain('npx agent-relay cloud connect google');
    expect(output).toContain('Cloud dashboard');
    expect(output).toContain('Nango-backed connection flow');
    expect(output).not.toContain('github/connect/local');
  });

  it('includes Claude and MCP handoff language', () => {
    const output = renderHandoffGuidance();

    expect(output).toContain('Claude');
    expect(output).toContain('MCP');
    expect(output).toContain('user-facing generate/debug command layer is not exposed yet');
    expect(output).toContain('ricky.generate');
    expect(output).not.toContain('npx ricky generate --spec-file');
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

  it('keeps local next action honest and Cloud next action provider-aware', () => {
    expect(renderSuggestedNextAction('local')).toBe(
      'Next: rerun Ricky when you have a concrete spec or workflow artifact ready to hand off.',
    );
    expect(renderSuggestedNextAction('cloud')).toContain('connect Google with `npx agent-relay cloud connect google`');
  });

  it('suppresses the banner via env option without reading process.env', () => {
    expect(shouldShowBanner({ isTTY: true, env: { RICKY_BANNER: '0' } })).toBe(false);
    expect(shouldShowBanner({ isTTY: true, env: {} })).toBe(true);
    expect(shouldShowBanner({ isTTY: true, rickyBanner: '0' })).toBe(false);
  });
});

function mockConfigStore(config: RickyConfig | null = null): RickyConfigStore & { written: RickyConfig | null } {
  const store = {
    written: null as RickyConfig | null,
    async readProjectConfig() {
      return config;
    },
    async readGlobalConfig() {
      return null;
    },
    async writeProjectConfig(c: RickyConfig) {
      store.written = c;
    },
  };
  return store;
}

function inputStream(text: string): PassThrough {
  const stream = new PassThrough();
  stream.end(`${text}\n`);
  return stream;
}

describe('runOnboarding', () => {
  it('runs first-run flow with interactive mode selection and persists config', async () => {
    const store = mockConfigStore();
    const output = new PassThrough();

    const result = await runOnboarding({
      input: inputStream('1'),
      output,
      isTTY: true,
      configStore: store,
    });

    expect(result.firstRun).toBe(true);
    expect(result.mode).toBe('local');
    expect(result.output).toContain('Local / BYOH mode selected.');
    expect(result.output).toContain('Spec handoff:');
    expect(result.output).toContain('Recovery:');
    expect(store.written).not.toBeNull();
    expect(store.written!.mode).toBe('local');
    expect(store.written!.firstRunComplete).toBe(true);
  });

  it('does not persist config when mode comes from options.mode override', async () => {
    const store = mockConfigStore();
    const output = new PassThrough();

    const result = await runOnboarding({
      input: inputStream(''),
      output,
      isTTY: true,
      mode: 'cloud',
      configStore: store,
    });

    expect(result.mode).toBe('cloud');
    expect(result.firstRun).toBe(true);
    expect(store.written).toBeNull();
  });

  it('does not persist config when mode comes from RICKY_MODE env var', async () => {
    const store = mockConfigStore();
    const output = new PassThrough();

    const result = await runOnboarding({
      input: inputStream(''),
      output,
      isTTY: true,
      env: { RICKY_MODE: 'local' },
      configStore: store,
    });

    expect(result.mode).toBe('local');
    expect(result.firstRun).toBe(true);
    expect(store.written).toBeNull();
  });

  it('does not persist config for explore choice', async () => {
    const store = mockConfigStore();
    const output = new PassThrough();

    const result = await runOnboarding({
      input: inputStream('4'),
      output,
      isTTY: true,
      configStore: store,
    });

    expect(result.mode).toBe('explore');
    expect(store.written).toBeNull();
  });

  it('returns compact header for returning users', async () => {
    const store = mockConfigStore({
      mode: 'local',
      firstRunComplete: true,
      providers: { google: { connected: false }, github: { connected: false } },
    });
    const output = new PassThrough();

    const result = await runOnboarding({
      input: inputStream(''),
      output,
      isTTY: true,
      configStore: store,
    });

    expect(result.firstRun).toBe(false);
    expect(result.mode).toBe('local');
    expect(result.output).toContain('ricky · local mode · ready');
    expect(result.output).toContain('Ricky is ready.');
  });

  it('renders non-interactive setup error when TTY is false and no override', async () => {
    const store = mockConfigStore();
    const output = new PassThrough();

    const result = await runOnboarding({
      input: inputStream(''),
      output,
      isTTY: false,
      configStore: store,
    });

    expect(result.output).toContain('Error: Ricky has not been configured yet.');
    expect(result.output).toContain('RICKY_MODE=local');
    expect(result.mode).toBe('explore');
  });

  it('bypasses interactive prompt in non-TTY when RICKY_MODE is set', async () => {
    const store = mockConfigStore();
    const output = new PassThrough();

    const result = await runOnboarding({
      input: inputStream(''),
      output,
      isTTY: false,
      env: { RICKY_MODE: 'local' },
      configStore: store,
    });

    expect(result.mode).toBe('local');
    expect(result.output).not.toContain('Error:');
    expect(store.written).toBeNull();
  });

  it('returns empty output and skips config for quiet mode', async () => {
    const store = mockConfigStore();
    const output = new PassThrough();

    const result = await runOnboarding({
      input: inputStream(''),
      output,
      quiet: true,
      configStore: store,
    });

    expect(result.output).toBe('');
    expect(result.bannerShown).toBe(false);
    expect(store.written).toBeNull();
  });

  it('re-prompts on invalid input then accepts valid choice', async () => {
    const store = mockConfigStore();
    const output = new PassThrough();
    const input = new PassThrough();

    // Schedule writes so readline processes them sequentially
    setImmediate(() => {
      input.write('invalid\n');
      setImmediate(() => {
        input.write('2\n');
        input.end();
      });
    });

    const result = await runOnboarding({
      input,
      output,
      isTTY: true,
      configStore: store,
    });

    expect(result.mode).toBe('cloud');
    expect(store.written).not.toBeNull();
    expect(store.written!.mode).toBe('cloud');
  });

  it('respects options.mode override precedence over RICKY_MODE env', async () => {
    const store = mockConfigStore();
    const output = new PassThrough();

    const result = await runOnboarding({
      input: inputStream(''),
      output,
      isTTY: true,
      mode: 'both',
      env: { RICKY_MODE: 'cloud' },
      configStore: store,
    });

    expect(result.mode).toBe('both');
  });
});
