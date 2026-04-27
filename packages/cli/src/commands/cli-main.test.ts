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

  it('returns a generated workflow artifact to the user without requiring immediate runtime launch', async () => {
    const result = await cliMain({
      argv: ['--mode', 'local', '--spec', 'generate a workflow for package checks'],
      onboard: vi.fn().mockResolvedValue({
        mode: 'local',
        firstRun: false,
        bannerShown: false,
        output: 'mode=local',
      }),
      localExecutor: {
        execute: vi.fn().mockResolvedValue({
          ok: true,
          artifacts: [{ path: 'workflows/generated/package-checks.ts', type: 'text/typescript' }],
          logs: ['[local] workflow generation: passed'],
          warnings: [],
          nextActions: [
            'Run the generated workflow locally: npx --no-install agent-relay run workflows/generated/package-checks.ts',
            'Inspect the generated workflow artifact and choose whether to run it locally.',
          ],
        }),
      },
    });

    const output = result.output.join('\n');
    expect(result.exitCode).toBe(0);
    expect(output).toContain('Local handoff completed.');
    expect(output).toContain('Artifact: workflows/generated/package-checks.ts');
    expect(output).toContain('Next: Run the generated workflow locally: npx --no-install agent-relay run workflows/generated/package-checks.ts');
    expect(output).toContain('Next: Inspect the generated workflow artifact and choose whether to run it locally.');
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

  // -------------------------------------------------------------------------
  // Proof: spec fixture coverage — inline, spec-file, stdin, missing, recovery
  // -------------------------------------------------------------------------

  describe('spec fixture proof coverage', () => {
    it('reads spec from --spec-file via injected file reader', async () => {
      const runner = vi.fn().mockResolvedValue(fakeInteractiveResult());

      await cliMain({
        argv: ['--mode', 'local', '--spec-file', './my-spec.md'],
        runInteractive: runner,
        readFileText: vi.fn().mockResolvedValue('workflow spec from file'),
      });

      expect(runner).toHaveBeenCalledWith(
        expect.objectContaining({
          mode: 'local',
          handoff: expect.objectContaining({
            source: 'cli',
            spec: 'workflow spec from file',
            specFile: './my-spec.md',
            mode: 'local',
            cliMetadata: { handoff: 'spec-file' },
          }),
        }),
      );
    });

    it('reads spec from stdin when --stdin is provided', async () => {
      const { Readable } = await import('node:stream');
      const input = Readable.from(['stdin workflow content']);
      const runner = vi.fn().mockResolvedValue(fakeInteractiveResult());

      await cliMain({
        argv: ['--mode', 'local', '--stdin'],
        runInteractive: runner,
        input,
      });

      expect(runner).toHaveBeenCalledWith(
        expect.objectContaining({
          mode: 'local',
          handoff: expect.objectContaining({
            source: 'cli',
            spec: 'stdin workflow content',
            mode: 'local',
            cliMetadata: { handoff: 'stdin' },
          }),
        }),
      );
    });

    it('returns recovery when spec-file read fails (missing file)', async () => {
      const result = await cliMain({
        argv: ['--mode', 'local', '--spec-file', './nonexistent.md'],
        readFileText: vi.fn().mockRejectedValue(new Error('ENOENT: no such file or directory')),
      });

      expect(result.exitCode).toBe(1);
      expect(result.output.join('\n')).toContain('CLI input blocker:');
      expect(result.output.join('\n')).toContain('ENOENT');
      expect(result.output.join('\n')).toContain('provide one of --spec, --spec-file, or --stdin');
    });

    it('returns recovery when inline spec is empty', async () => {
      const result = await cliMain({
        argv: ['--mode', 'local', '--spec', '   '],
      });

      expect(result.exitCode).toBe(1);
      expect(result.output.join('\n')).toContain('CLI input blocker:');
      expect(result.output.join('\n')).toContain('Inline spec is empty');
    });

    it('returns recovery when stdin spec is empty', async () => {
      const { Readable } = await import('node:stream');
      const input = Readable.from(['   ']);

      const result = await cliMain({
        argv: ['--mode', 'local', '--stdin'],
        input,
      });

      expect(result.exitCode).toBe(1);
      expect(result.output.join('\n')).toContain('CLI input blocker:');
      expect(result.output.join('\n')).toContain('Stdin spec is empty');
    });

    it('defaults to local mode when spec is provided without explicit --mode', async () => {
      const runner = vi.fn().mockResolvedValue(fakeInteractiveResult());

      await cliMain({
        argv: ['--spec', 'a workflow'],
        runInteractive: runner,
      });

      expect(runner).toHaveBeenCalledWith(
        expect.objectContaining({
          mode: 'local',
          handoff: expect.objectContaining({
            mode: 'local',
            spec: 'a workflow',
          }),
        }),
      );
    });

    it('rejects cloud mode with spec handoff', async () => {
      const result = await cliMain({
        argv: ['--mode', 'cloud', '--spec', 'a workflow'],
      });

      expect(result.exitCode).toBe(1);
      expect(result.output.join('\n')).toContain('Cloud mode does not accept CLI spec handoff');
    });

    it('handles --file alias for --spec-file', async () => {
      const runner = vi.fn().mockResolvedValue(fakeInteractiveResult());

      await cliMain({
        argv: ['--mode', 'local', '--file', './alias-spec.md'],
        runInteractive: runner,
        readFileText: vi.fn().mockResolvedValue('aliased file content'),
      });

      expect(runner).toHaveBeenCalledWith(
        expect.objectContaining({
          handoff: expect.objectContaining({
            spec: 'aliased file content',
            specFile: './alias-spec.md',
            cliMetadata: { handoff: 'spec-file' },
          }),
        }),
      );
    });
  });
});
