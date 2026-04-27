import { describe, expect, it, vi } from 'vitest';

import type { InteractiveCliResult } from '../entrypoint/interactive-cli.js';
import type { OnboardingResult } from '../cli/onboarding.js';
import { cliMain, parseArgs, renderHelp } from './cli-main.js';

// ---------------------------------------------------------------------------
// parseArgs
// ---------------------------------------------------------------------------

describe('parseArgs', () => {
  it('defaults to run command with no args', () => {
    expect(parseArgs([])).toEqual({ command: 'run' });
  });

  it('parses help flag', () => {
    expect(parseArgs(['--help'])).toEqual({ command: 'help' });
    expect(parseArgs(['-h'])).toEqual({ command: 'help' });
    expect(parseArgs(['help'])).toEqual({ command: 'help' });
  });

  it('parses version flag', () => {
    expect(parseArgs(['--version'])).toEqual({ command: 'version' });
    expect(parseArgs(['-v'])).toEqual({ command: 'version' });
    expect(parseArgs(['version'])).toEqual({ command: 'version' });
  });

  it('parses --mode flag with valid mode', () => {
    expect(parseArgs(['--mode', 'local'])).toEqual({ command: 'run', mode: 'local' });
    expect(parseArgs(['--mode', 'cloud'])).toEqual({ command: 'run', mode: 'cloud' });
    expect(parseArgs(['--mode', 'both'])).toEqual({ command: 'run', mode: 'both' });
  });

  it('ignores --mode with invalid value', () => {
    expect(parseArgs(['--mode', 'invalid'])).toEqual({ command: 'run' });
  });

  it('ignores --mode with no value', () => {
    expect(parseArgs(['--mode'])).toEqual({ command: 'run' });
  });

  it('parses local spec handoff flags', () => {
    expect(parseArgs(['--mode', 'local', '--spec', 'build a workflow'])).toEqual({
      command: 'run',
      mode: 'local',
      spec: 'build a workflow',
    });
    expect(parseArgs(['--spec-file', './spec.md'])).toEqual({
      command: 'run',
      specFile: './spec.md',
    });
    expect(parseArgs(['--stdin'])).toEqual({
      command: 'run',
      stdin: true,
    });
  });

  it('reports missing values for spec flags', () => {
    expect(parseArgs(['--spec'])).toEqual({
      command: 'run',
      errors: ['--spec requires a value.'],
    });
  });
});

// ---------------------------------------------------------------------------
// renderHelp
// ---------------------------------------------------------------------------

describe('renderHelp', () => {
  it('returns an array of help lines', () => {
    const lines = renderHelp();
    expect(lines.length).toBeGreaterThan(0);
    expect(lines[0]).toMatch(/ricky/);
    expect(lines.some((l) => l.includes('--mode'))).toBe(true);
    expect(lines.some((l) => l.includes('--help'))).toBe(true);
  });

  it('shows the current local handoff journey without obsolete generate guidance', () => {
    const helpText = renderHelp().join('\n');

    expect(helpText).toContain('npm start -- --mode local --spec <text>');
    expect(helpText).toContain('npm start -- --mode local --spec-file <path>');
    expect(helpText).toContain('npm start -- --mode local --stdin');
    expect(helpText).toContain(
      'npm start -- --mode local --spec "generate a workflow for package checks"',
    );
    expect(helpText).not.toContain('npx ricky generate');
    expect(helpText).not.toMatch(/rerun.*later/i);
  });
});

// ---------------------------------------------------------------------------
// cliMain
// ---------------------------------------------------------------------------

function fakeInteractiveResult(overrides: Partial<InteractiveCliResult> = {}): InteractiveCliResult {
  const onboarding: OnboardingResult = {
    mode: 'local',
    firstRun: false,
    bannerShown: false,
    output: 'mode=local',
  };
  return {
    ok: true,
    mode: 'local',
    onboarding,
    diagnoses: [],
    guidance: [],
    ...overrides,
  };
}

describe('cliMain', () => {
  it('returns help output with exit code 0 for --help', async () => {
    const result = await cliMain({ argv: ['--help'] });
    expect(result.exitCode).toBe(0);
    expect(result.output[0]).toMatch(/ricky/);
    expect(result.interactiveResult).toBeUndefined();
  });

  it('returns version output with exit code 0 for --version', async () => {
    const result = await cliMain({ argv: ['--version'], version: '1.2.3' });
    expect(result.exitCode).toBe(0);
    expect(result.output).toEqual(['ricky 1.2.3']);
  });

  it('defaults version to 0.0.0 when not provided', async () => {
    const result = await cliMain({ argv: ['version'] });
    expect(result.output).toEqual(['ricky 0.0.0']);
  });

  it('delegates to interactive runner with no args', async () => {
    const runner = vi.fn().mockResolvedValue(fakeInteractiveResult());
    const result = await cliMain({ argv: [], runInteractive: runner });

    expect(runner).toHaveBeenCalledTimes(1);
    expect(result.exitCode).toBe(0);
    expect(result.interactiveResult?.ok).toBe(true);
  });

  it('passes mode override to interactive runner', async () => {
    const runner = vi.fn().mockResolvedValue(fakeInteractiveResult({ mode: 'cloud' }));
    const result = await cliMain({
      argv: ['--mode', 'cloud'],
      runInteractive: runner,
    });

    expect(runner).toHaveBeenCalledTimes(1);
    const passedDeps = runner.mock.calls[0][0];
    expect(passedDeps.mode).toBe('cloud');
    expect(result.interactiveResult?.mode).toBe('cloud');
  });

  it('returns exit code 1 when interactive session fails', async () => {
    const runner = vi.fn().mockResolvedValue(
      fakeInteractiveResult({
        ok: false,
        guidance: ['Something went wrong'],
      }),
    );
    const result = await cliMain({ argv: [], runInteractive: runner });

    expect(result.exitCode).toBe(1);
    expect(result.output).toContain('Something went wrong');
  });

  it('includes guidance lines in output when present', async () => {
    const runner = vi.fn().mockResolvedValue(
      fakeInteractiveResult({
        ok: false,
        guidance: ['[Runtime handoff stall] Retry the handoff', '  Rationale: timeout detected'],
      }),
    );
    const result = await cliMain({ argv: [], runInteractive: runner });

    expect(result.output).toHaveLength(2);
    expect(result.output[0]).toMatch(/Runtime handoff stall/);
  });

  it('returns empty output array on successful run with no guidance', async () => {
    const runner = vi.fn().mockResolvedValue(fakeInteractiveResult());
    const result = await cliMain({ argv: [], runInteractive: runner });

    expect(result.output).toEqual([]);
    expect(result.exitCode).toBe(0);
  });

  it('passes inline local spec handoff to the interactive runner', async () => {
    const runner = vi.fn().mockResolvedValue(fakeInteractiveResult());

    await cliMain({
      argv: ['--mode', 'local', '--spec', 'build a workflow'],
      runInteractive: runner,
    });

    expect(runner).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'local',
        handoff: expect.objectContaining({
          source: 'cli',
          spec: 'build a workflow',
          mode: 'local',
        }),
      }),
    );
  });

  it('runs npm start -- --mode local with an inline spec through local execution', async () => {
    const result = await cliMain({
      argv: ['--mode', 'local', '--spec', 'build a workflow'],
      onboard: vi.fn().mockResolvedValue({
        mode: 'local',
        firstRun: false,
        bannerShown: false,
        output: 'mode=local',
      }),
      localExecutor: {
        execute: vi.fn().mockResolvedValue({
          ok: true,
          artifacts: [{ path: 'out/workflow.ts', type: 'text/typescript' }],
          logs: ['local execution accepted spec'],
          warnings: [],
          nextActions: ['Review workflow'],
        }),
      },
    });

    const output = result.output.join('\n');
    expect(result.exitCode).toBe(0);
    expect(output).toContain('Local handoff completed.');
    expect(output).toContain('Artifact: out/workflow.ts');
    expect(output).toContain('Next: Review workflow');
    expect(output).not.toContain('Local handoff blocker:');
    expect(output).not.toMatch(/rerun.*later/i);
    expect(result.interactiveResult?.awaitingInput).toBe(false);
    expect(result.interactiveResult?.localResult?.ok).toBe(true);
  });

  it('keeps npm start -- --mode local blocked until a real spec or file is provided', async () => {
    const result = await cliMain({
      argv: ['--mode', 'local'],
      onboard: vi.fn().mockResolvedValue({
        mode: 'local',
        firstRun: false,
        bannerShown: false,
        output: 'mode=local',
      }),
      localExecutor: {
        execute: vi.fn().mockResolvedValue({
          ok: true,
          artifacts: [],
          logs: [],
          warnings: [],
          nextActions: [],
        }),
      },
    });

    const output = result.output.join('\n');
    expect(result.exitCode).toBe(0);
    expect(output).toContain('Local handoff blocker:');
    expect(output).toContain('Inline spec: npm start -- --mode local --spec');
    expect(output).toContain('File spec:   npm start -- --mode local --spec-file');
    expect(output).toContain('Stdin spec:');
    expect(result.interactiveResult?.awaitingInput).toBe(true);
    expect(result.interactiveResult?.localResult).toBeUndefined();
  });

  it('returns recovery output when CLI spec flags are invalid', async () => {
    const result = await cliMain({ argv: ['--spec'] });

    expect(result.exitCode).toBe(1);
    expect(result.output.join('\n')).toContain('CLI input blocker:');
    expect(result.output.join('\n')).toContain('--spec requires a value.');
  });

  it('returns recovery output when a spec file flag has no file path', async () => {
    const result = await cliMain({ argv: ['--mode', 'local', '--spec-file'] });

    expect(result.exitCode).toBe(1);
    expect(result.output.join('\n')).toContain('CLI input blocker:');
    expect(result.output.join('\n')).toContain('--spec-file requires a value.');
    expect(result.output.join('\n')).toContain('provide one of --spec, --spec-file, or --stdin');
  });
});
