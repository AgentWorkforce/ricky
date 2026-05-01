import { PassThrough } from 'node:stream';
import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';

import {
  CLOUD_MODE,
  FIRST_CLASS_RICKY_MODES,
  LOCAL_BYOH_MODE,
  RICKY_ASCII_ART_WELCOME,
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

    expect(RICKY_ASCII_ART_WELCOME).toContain('RICKY');
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
    const localIndex = output.indexOf('> [1] Local / BYOH');
    const cloudIndex = output.indexOf('[2] Cloud');

    expect(FIRST_CLASS_RICKY_MODES).toEqual([LOCAL_BYOH_MODE, CLOUD_MODE]);
    expect(LOCAL_BYOH_MODE.description).toContain('without Cloud credentials');
    expect(CLOUD_MODE.description).toContain('AgentWorkforce Cloud');
    expect(LOCAL_BYOH_MODE.nextAction).toContain('ricky --mode local --spec');
    expect(CLOUD_MODE.nextAction).toContain('npx agent-relay cloud connect google');
    expect(output).toContain('Local / BYOH');
    expect(output).toContain('Cloud');
    expect(output).toContain('Status');
    expect(output).toContain('Connect tools');
    expect(output).toContain('Exit');
    expect(localIndex).toBeGreaterThanOrEqual(0);
    expect(cloudIndex).toBeGreaterThan(localIndex);
    expect(output).toContain('Ready to hand over a spec.');
    expect(output).toContain('Cloud mode generates workflow artifacts through AgentWorkforce Cloud.');
  });

  it('keeps local/BYOH as the default first-run contract without subordinating it to Cloud', () => {
    const output = renderOnboarding({ isFirstRun: true, isTTY: true, env: {} });

    expect(output).toContain('  > [1] Local / BYOH   — generate workflow artifacts for your local repo');
    expect(output).toContain('    [2] Cloud          — generate workflow artifacts through AgentWorkforce Cloud');
    expect(output).toContain('    [3] Status         — show local readiness and known provider state');
    expect(output).toContain('    [4] Connect tools  — show provider setup commands and dashboard guidance');
    expect(output).toContain('    [5] Exit           — leave without generating or executing anything');
    expect(output).toContain('  Choice [1]:');
    expect(output.indexOf('  > [1] Local / BYOH')).toBeLessThan(output.indexOf('    [2] Cloud'));
    expect(output.indexOf('Local / BYOH mode selected.')).toBeLessThan(output.indexOf('Cloud provider guidance:'));
    expect(output).toContain('No Cloud credentials required.');
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
    expect(output).toContain('Nango-backed connection flow');
    expect(output).not.toContain('github/connect/local');
  });

  it('includes spec handoff language without overclaiming', () => {
    const output = renderHandoffGuidance();

    expect(output).toContain('Give Ricky a spec');
    expect(output).toContain('Generation does not execute anything');
    expect(output).toContain('Direct CLI handoff:');
    expect(output).toContain('ricky --mode local --spec "generate a workflow for package checks"');
    expect(output).toContain('ricky --mode local --spec-file ./path/to/spec.md');
    expect(output).toContain('ricky --mode local --stdin');
    expect(output).toContain('MCP handoff:');
    expect(output).toContain('Use `ricky.generate` with the same spec payload');
    expect(output).toContain('ricky run --artifact workflows/generated/<file>.ts');
    expect(output).not.toContain('Or without linking: ricky run');
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
    expect(output).toContain('ricky --mode local --spec "<rephrased spec>"');
    expect(output).toContain('shell-ready');
    expect(output).toContain('ricky --mode local --spec-file ./path/to/spec.md');
    expect(output).toContain('ricky --mode local --stdin');
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
      'Next: run a local handoff with `ricky --mode local --spec "<workflow spec>"`, `--spec-file`, or `--stdin`.',
    );
    expect(renderSuggestedNextAction('cloud')).toContain('connect Google with `npx agent-relay cloud connect google`');
  });

  it('suppresses the banner via env option without reading process.env', () => {
    expect(shouldShowBanner({ isTTY: true, env: { RICKY_BANNER: '0' } })).toBe(false);
    expect(shouldShowBanner({ isTTY: true, env: {} })).toBe(true);
    expect(shouldShowBanner({ isTTY: true, rickyBanner: '0' })).toBe(false);
  });

  it('renders deterministic output when env is omitted from renderOnboarding', () => {
    // renderOnboarding is a pure renderer — omitting env must not read process.env.RICKY_BANNER
    const output = renderOnboarding({ isFirstRun: true, isTTY: true });

    expect(output).toContain('RRRR');
    expect(output).toContain("Welcome to Ricky! Let's get you set up.");
  });

  it('does not fall back to process.env when env is omitted from shouldShowBanner', () => {
    // shouldShowBanner must be a pure function of its inputs — no ambient process.env reads
    expect(shouldShowBanner({ isTTY: true })).toBe(true);
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
      input: inputStream('explore'),
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

  it('presents the compact first-screen menu for returning users when an interactive prompt shell is available', async () => {
    const store = mockConfigStore({
      mode: 'local',
      firstRunComplete: true,
      providers: { google: { connected: false }, github: { connected: false } },
    });
    const output = new PassThrough();
    const promptShell = {
      selectFirstScreen: vi.fn().mockResolvedValue('cloud' as const),
    };

    const result = await runOnboarding({
      output,
      isTTY: true,
      configStore: store,
      promptShell,
    });

    expect(result.firstRun).toBe(false);
    expect(result.mode).toBe('cloud');
    expect(promptShell.selectFirstScreen).toHaveBeenCalledTimes(1);
    expect(store.written).toBeNull();
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

  it('uses an injected prompt shell for the compact first screen', async () => {
    const store = mockConfigStore();
    const output = new PassThrough();
    const promptShell = {
      selectFirstScreen: vi.fn().mockResolvedValue('status' as const),
    };

    const result = await runOnboarding({
      output,
      isTTY: true,
      configStore: store,
      promptShell,
    });

    expect(promptShell.selectFirstScreen).toHaveBeenCalledWith(
      expect.objectContaining({ output }),
    );
    expect(result.mode).toBe('status');
    expect(result.output).toContain('Status');
    expect(result.output).toContain('Local generation: ready');
    expect(store.written).toBeNull();
  });

  it('handles prompt cancellation with a concise line by default', async () => {
    const store = mockConfigStore();
    const output = new PassThrough();
    const promptShell = {
      selectFirstScreen: vi.fn().mockRejectedValue(
        Object.assign(new Error('User force closed the prompt'), { name: 'ExitPromptError' }),
      ),
    };

    const result = await runOnboarding({
      output,
      isTTY: true,
      configStore: store,
      promptShell,
    });

    expect(result.mode).toBe('exit');
    expect(result.output).toContain('Cancelled.');
    expect(store.written).toBeNull();
  });

  it('rethrows prompt cancellation in verbose mode', async () => {
    const promptShell = {
      selectFirstScreen: vi.fn().mockRejectedValue(
        Object.assign(new Error('User force closed the prompt'), { name: 'ExitPromptError' }),
      ),
    };

    await expect(
      runOnboarding({
        output: new PassThrough(),
        isTTY: true,
        configStore: mockConfigStore(),
        promptShell,
        verbose: true,
      }),
    ).rejects.toThrow('User force closed the prompt');
  });

  it('honors NO_COLOR from resolved env (injected or ambient process.env)', async () => {
    const store = mockConfigStore({
      mode: 'local',
      firstRunComplete: false,
      providers: { google: { connected: false }, github: { connected: false } },
    });
    const output = new PassThrough();

    // When NO_COLOR is set in the injected env, banner output must contain no ANSI escapes
    const injectedEnvResult = await runOnboarding({
      input: inputStream('1'),
      output,
      isTTY: true,
      env: { NO_COLOR: '1' },
      configStore: store,
    });

    expect(injectedEnvResult.bannerShown).toBe(true);
    expect(injectedEnvResult.output).not.toMatch(/\x1b\[/);

    const ambientOutput = new PassThrough();
    const previousNoColor = process.env.NO_COLOR;
    process.env.NO_COLOR = '1';

    try {
      const ambientEnvResult = await runOnboarding({
        input: inputStream('1'),
        output: ambientOutput,
        isTTY: true,
        configStore: store,
      });

      expect(ambientEnvResult.bannerShown).toBe(true);
      expect(ambientEnvResult.output).not.toMatch(/\x1b\[/);
    } finally {
      if (previousNoColor === undefined) {
        delete process.env.NO_COLOR;
      } else {
        process.env.NO_COLOR = previousNoColor;
      }
    }
  });

  it('renders colored banner when NO_COLOR is absent from resolved env', async () => {
    const store = mockConfigStore({
      mode: 'local',
      firstRunComplete: false,
      providers: { google: { connected: false }, github: { connected: false } },
    });
    const output = new PassThrough();

    const result = await runOnboarding({
      input: inputStream('1'),
      output,
      isTTY: true,
      env: {},
      configStore: store,
    });

    expect(result.bannerShown).toBe(true);
    // With isTTY true and no NO_COLOR, ANSI escape sequences should be present
    expect(result.output).toMatch(/\x1b\[/);
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
