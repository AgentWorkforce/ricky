import { PassThrough } from 'node:stream';
import { readFile } from 'node:fs/promises';
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
  renderWorkflowGenerationFailureRecovery,
  runOnboarding,
  shouldShowBanner,
  type RickyConfig,
  type RickyConfigStore,
} from './index.js';

describe('Ricky CLI onboarding', () => {
  it('renders first-run onboarding with the full banner by default', () => {
    const output = renderOnboarding({ isFirstRun: true, isTTY: true, env: {} });

    expect(output).toContain('RRRR');
    expect(output).toContain("Welcome to Ricky! Let's get you set up.");
    expect(output).toContain('Ricky generates workflow artifacts for your repo.');
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
    expect(output).toContain('Ready to hand over a spec.');
    expect(output).toContain('Cloud mode generates workflow artifacts through AgentWorkforce Cloud.');
  });

  it('keeps artifact-only onboarding copy from promising automatic execution', () => {
    const output = [
      renderWelcome({ isFirstRun: true }),
      renderModeResult('local'),
      renderHandoffGuidance(),
      renderOnboarding({ isFirstRun: true, isTTY: true, mode: 'local', env: {} }),
    ].join('\n');

    expect(output).toContain('Ricky generates workflow artifacts for your repo.');
    expect(output).toContain('Running a generated artifact is a separate, opt-in step.');
    expect(output).toContain('Generation does not execute anything');
    expect(output).toContain('Nothing is executed at this stage.');
    expect(output).not.toMatch(/automatic execution/i);
    expect(output).not.toMatch(/automatically execute/i);
    expect(output).not.toMatch(/execution (runs|starts|launches) by default/i);
    expect(output).not.toContain('npx ricky generate');
  });

  it('uses real Google Cloud guidance and honest GitHub dashboard guidance', () => {
    const output = `${renderCloudGuidance()}\n${renderModeResult('cloud')}`;

    expect(output).toContain('npx agent-relay cloud connect google');
    expect(output).toContain('Cloud dashboard');
    expect(output).not.toContain('github/connect/local');
  });

  it('includes spec handoff language without overclaiming', () => {
    const output = renderHandoffGuidance();

    expect(output).toContain('Give Ricky a spec');
    expect(output).toContain('Generation does not execute anything');
    expect(output).toContain('npm start -- --mode local --spec "generate a workflow for package checks"');
    expect(output).toContain('npm start -- --mode local --spec-file ./path/to/spec.md');
    expect(output).toContain('npm start -- --mode local --stdin');
    expect(output).toContain('requires npm-linked CLI');
    expect(output).not.toContain('npx ricky generate --spec');
    expect(output).not.toContain('npx ricky generate --spec-file');
    expect(output).not.toMatch(/rerun.*later/i);
  });

  it('includes a recovery path when the local runtime is blocked', () => {
    const output = renderRecoveryGuidance('agent-relay is missing');

    expect(output).toContain('Blocked: agent-relay is missing');
    expect(output).toContain('Fix the issue above, then retry the same command.');
  });

  it('names the real supported local handoff inputs in recovery guidance', () => {
    const output = `${renderRecoveryGuidance()}\n${renderWorkflowGenerationFailureRecovery()}\n${renderSuggestedNextAction('local')}`;

    expect(output).toContain('--spec');
    expect(output).toContain('--spec-file');
    expect(output).toContain('--stdin');
    expect(output).toContain('npm start -- --mode local --spec "<rephrased spec>"');
    expect(output).toContain('shell-ready');
    expect(output).toContain('npm start -- --mode local --spec-file ./path/to/spec.md');
    expect(output).toContain('npm start -- --mode local --stdin');
    expect(output).not.toContain('npx ricky generate');
    expect(output).not.toContain('spec-stdin');
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
      'Next: run a local handoff with `npm start -- --mode local --spec "<workflow spec>"`, `--spec-file`, or `--stdin`.',
    );
    expect(renderSuggestedNextAction('cloud')).toContain('connect Google with `npx agent-relay cloud connect google`');
  });

  it('suppresses the banner via env option without reading process.env', () => {
    expect(shouldShowBanner({ isTTY: true, env: { RICKY_BANNER: '0' } })).toBe(false);
    expect(shouldShowBanner({ isTTY: true, env: {} })).toBe(true);
    expect(shouldShowBanner({ isTTY: true, rickyBanner: '0' })).toBe(false);
  });

  it('keeps the cofounder readiness checklist aligned with issue #7 readiness areas', async () => {
    const checklist = await readFile(
      new URL('../../../../docs/product/ricky-cofounder-interactive-readiness-checklist.md', import.meta.url),
      'utf8',
    );

    for (const area of [
      'First-run onboarding clarity',
      'Local mode selection clarity',
      'Spec handoff works immediately',
      'Generated artifact appears where promised',
      'Next command points to a real file',
      'Execution-vs-generation distinction is understandable',
      'Recovery guidance is truthful when something fails',
    ].entries()) {
      const [index, heading] = area;
      expect(checklist).toContain(`## ${index + 1}. ${heading}`);
    }

    expect(checklist).toContain('live cofounder testing');
    expect(checklist).toContain('generation-only must not look like an');
    expect(checklist).toMatch(/first-run onboarding/i);
    expect(checklist).toContain('interactive/local onboarding');
    expect(checklist).toContain('Generation: ok');
    expect(checklist).toContain('Execution: not requested');
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

  it('suppresses first-run onboarding copy when a live handoff execution is already in flight', async () => {
    const store = mockConfigStore();
    const output = new PassThrough();

    const result = await runOnboarding({
      input: inputStream(''),
      output,
      isTTY: true,
      mode: 'local',
      configStore: store,
      compactForExecution: true,
      skipFirstRunPersistence: true,
    });

    expect(result.mode).toBe('local');
    expect(result.firstRun).toBe(true);
    expect(result.output).toBe('');
    expect(store.written).toBeNull();
    expect(output.read()?.toString() ?? '').toBe('');
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
