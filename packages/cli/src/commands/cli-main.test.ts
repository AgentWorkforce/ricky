import { describe, expect, it, vi } from 'vitest';

import type { InteractiveCliResult } from '../entrypoint/interactive-cli.js';
import type { OnboardingResult } from '../cli/onboarding.js';
import type { LocalResponse } from '@ricky/local/entrypoint.js';
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

  it('parses opt-in local run behavior and artifact execution', () => {
    expect(parseArgs(['--mode', 'local', '--spec', 'build a workflow', '--run'])).toEqual({
      command: 'run',
      mode: 'local',
      spec: 'build a workflow',
      runRequested: true,
    });
    expect(parseArgs(['run', 'workflows/generated/example.ts'])).toEqual({
      command: 'run',
      artifact: 'workflows/generated/example.ts',
      runRequested: true,
    });
    expect(parseArgs(['run', '--artifact', 'workflows/generated/example.ts', '--json'])).toEqual({
      command: 'run',
      artifact: 'workflows/generated/example.ts',
      runRequested: true,
      json: true,
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

  it('states that spec handoff returns an artifact unless execution is explicitly requested', () => {
    const helpText = renderHelp().join('\n');

    expect(helpText).toContain('generate   Ricky writes a workflow artifact');
    expect(helpText).toContain('This is the default. Nothing is executed.');
    expect(helpText).toContain('Only with --run or `ricky run <artifact>`');
    expect(helpText).toContain('Without --run:  artifact path on disk');
    expect(helpText).not.toMatch(/automatic execution/i);
    expect(helpText).not.toMatch(/automatically execute/i);
    expect(helpText).not.toMatch(/execution (runs|starts|launches) by default/i);
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

function stagedLocalResult(overrides: Partial<LocalResponse> = {}): LocalResponse {
  const artifactPath = 'workflows/generated/issue-3.ts';
  return {
    ok: true,
    artifacts: [{ path: artifactPath, type: 'text/typescript', content: 'workflow("issue-3")' }],
    logs: [],
    warnings: [],
    nextActions: ['Inspect generated artifacts and local run evidence.'],
    exitCode: 0,
    generation: {
      stage: 'generate',
      status: 'ok',
      artifact: {
        path: artifactPath,
        workflow_id: 'wf-issue-3',
        spec_digest: 'digest-issue-3',
      },
      next: {
        run_command: `npx --no-install agent-relay run ${artifactPath}`,
        run_mode_hint: `ricky run --artifact ${artifactPath}`,
      },
    },
    execution: {
      stage: 'execute',
      status: 'success',
      execution: {
        workflow_id: 'wf-issue-3',
        artifact_path: artifactPath,
        command: `npx --no-install agent-relay run ${artifactPath}`,
        workflow_file: artifactPath,
        cwd: '/repo',
        started_at: '2026-01-01T00:00:00.000Z',
        finished_at: '2026-01-01T00:00:01.000Z',
        duration_ms: 1000,
        steps_completed: 1,
        steps_total: 1,
      },
      evidence: {
        outcome_summary: 'Workflow completed successfully with deterministic evidence.',
        artifacts_produced: [{ path: artifactPath, kind: 'workflow', bytes: 128 }],
        logs: {
          stdout_path: '/repo/.workflow-artifacts/ricky-local-runs/run-1/stdout.log',
          stderr_path: '/repo/.workflow-artifacts/ricky-local-runs/run-1/stderr.log',
          truncated: false,
        },
        side_effects: {
          files_written: [
            artifactPath,
            '/repo/.workflow-artifacts/ricky-local-runs/run-1/stdout.log',
            '/repo/.workflow-artifacts/ricky-local-runs/run-1/stderr.log',
          ],
          commands_invoked: [`npx --no-install agent-relay run ${artifactPath}`],
          network_calls: [],
        },
        assertions: [
          {
            name: 'runtime_exit_code',
            status: 'pass',
            detail: 'Runtime exited with code 0.',
          },
        ],
        workflow_steps: [
          {
            id: 'runtime-launch',
            name: 'Local runtime execution',
            status: 'pass',
            duration_ms: 1000,
          },
        ],
      },
    },
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

  it('captures the caller repo root at the CLI boundary and passes it through the handoff deps', async () => {
    const runner = vi.fn().mockResolvedValue(fakeInteractiveResult());

    await cliMain({
      argv: ['--mode', 'local', '--spec', 'build a workflow'],
      cwd: '/repo-root',
      runInteractive: runner,
    });

    expect(runner).toHaveBeenCalledWith(
      expect.objectContaining({
        cwd: '/repo-root',
        handoff: expect.objectContaining({
          source: 'cli',
          spec: 'build a workflow',
          invocationRoot: '/repo-root',
        }),
      }),
    );
  });

  it('prefers INIT_CWD over an injected package cwd when capturing the caller repo root', async () => {
    const runner = vi.fn().mockResolvedValue(fakeInteractiveResult());
    const originalInitCwd = process.env.INIT_CWD;

    process.env.INIT_CWD = '/caller-repo-from-init-cwd';

    try {
      await cliMain({
        argv: ['--mode', 'local', '--spec', 'build a workflow'],
        cwd: process.cwd(),
        runInteractive: runner,
      });
    } finally {
      if (originalInitCwd === undefined) {
        delete process.env.INIT_CWD;
      } else {
        process.env.INIT_CWD = originalInitCwd;
      }
    }

    expect(runner).toHaveBeenCalledWith(
      expect.objectContaining({
        cwd: '/caller-repo-from-init-cwd',
        handoff: expect.objectContaining({
          source: 'cli',
          invocationRoot: '/caller-repo-from-init-cwd',
        }),
      }),
    );
  });

  it('prefers INIT_CWD over the CLI package root when capturing the caller repo root', async () => {
    const { join } = await import('node:path');
    const runner = vi.fn().mockResolvedValue(fakeInteractiveResult());
    const originalInitCwd = process.env.INIT_CWD;

    process.env.INIT_CWD = '/caller-repo-from-init-cwd';

    try {
      const packageCwd = process.cwd().endsWith('/packages/cli')
        ? process.cwd()
        : join(process.cwd(), 'packages/cli');

      await cliMain({
        argv: ['--mode', 'local', '--spec', 'build a workflow'],
        cwd: packageCwd,
        runInteractive: runner,
      });
    } finally {
      if (originalInitCwd === undefined) {
        delete process.env.INIT_CWD;
      } else {
        process.env.INIT_CWD = originalInitCwd;
      }
    }

    expect(runner).toHaveBeenCalledWith(
      expect.objectContaining({
        cwd: '/caller-repo-from-init-cwd',
        handoff: expect.objectContaining({
          source: 'cli',
          invocationRoot: '/caller-repo-from-init-cwd',
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
    expect(output).toContain('Artifact returned.');
    expect(output).toContain('Artifact: out/workflow.ts');
    expect(output).toContain('Next: Review workflow');
    expect(output).not.toMatch(/rerun.*later/i);
    expect(result.interactiveResult?.awaitingInput).toBe(false);
    expect(result.interactiveResult?.localResult?.ok).toBe(true);
  });

  it('passes --run into the local handoff and preserves blocker exit code 2 in JSON output', async () => {
    const runner = vi.fn().mockResolvedValue(fakeInteractiveResult({
      ok: false,
      localResult: {
        ok: false,
        artifacts: [{ path: 'workflows/generated/example.ts', type: 'text/typescript' }],
        logs: [],
        warnings: ['Runtime package "agent-relay" is not installed in this workspace.'],
        nextActions: ['npm install'],
        exitCode: 2,
        generation: {
          stage: 'generate',
          status: 'ok',
          artifact: {
            path: 'workflows/generated/example.ts',
            workflow_id: 'wf-example',
            spec_digest: 'abc123',
          },
          next: {
            run_command: 'npx --no-install agent-relay run workflows/generated/example.ts',
            run_mode_hint: 'ricky run --artifact workflows/generated/example.ts',
          },
        },
        execution: {
          stage: 'execute',
          status: 'blocker',
          execution: {
            workflow_id: 'wf-example',
            artifact_path: 'workflows/generated/example.ts',
            command: 'npx --no-install agent-relay run workflows/generated/example.ts',
            workflow_file: 'workflows/generated/example.ts',
            cwd: '/repo',
            started_at: '2026-01-01T00:00:00.000Z',
            finished_at: '2026-01-01T00:00:00.000Z',
            duration_ms: 0,
            steps_completed: 0,
            steps_total: 1,
          },
          blocker: {
            code: 'MISSING_BINARY',
            category: 'dependency',
            message: 'Runtime package "agent-relay" is not installed in this workspace.',
            detected_at: '2026-01-01T00:00:00.000Z',
            detected_during: 'precheck',
            recovery: {
              actionable: true,
              steps: ['npm install'],
            },
            context: {
              missing: ['node_modules/.bin/agent-relay'],
              found: ['npx'],
            },
          },
        },
      },
    }));

    const result = await cliMain({
      argv: ['--mode', 'local', '--spec', 'build a workflow', '--run', '--json'],
      runInteractive: runner,
    });

    expect(runner.mock.calls[0][0].handoff).toMatchObject({
      source: 'cli',
      stageMode: 'run',
    });
    expect(result.exitCode).toBe(2);
    const parsed = JSON.parse(result.output.join('\n'));
    expect(parsed[0]).toMatchObject({ stage: 'generate', status: 'ok' });
    expect(parsed[1]).toMatchObject({ stage: 'execute', status: 'blocker' });
    expect(parsed[1].blocker.recovery.steps).toEqual(['npm install']);
  });

  describe('regression: issue #3 staged local output', () => {
    it('distinguishes artifact generation from execution result in human CLI output', async () => {
      const runner = vi.fn().mockResolvedValue(
        fakeInteractiveResult({
          ok: true,
          localResult: stagedLocalResult(),
        }),
      );

      const result = await cliMain({
        argv: ['--mode', 'local', '--spec', 'build a workflow', '--run'],
        runInteractive: runner,
      });

      const output = result.output.join('\n');
      const generationIndex = result.output.indexOf('stage: generate');
      const executionIndex = result.output.indexOf('--- execution ---');

      expect(result.exitCode).toBe(0);
      expect(output).toContain('Generation: ok — artifact written to disk.');
      expect(output).toContain('Execution: success — artifact ran through local agent-relay.');
      expect(generationIndex).toBeGreaterThan(-1);
      expect(executionIndex).toBeGreaterThan(generationIndex);
      expect(output).toContain('  Artifact: workflows/generated/issue-3.ts');
      expect(output).toContain('  workflow_id: wf-issue-3');
      expect(output).toContain('--- execution ---');
      expect(output).toContain('stage: execute');
      expect(output).toContain('status: success');
      expect(output).toContain('  command: npx --no-install agent-relay run workflows/generated/issue-3.ts');
      expect(output).toContain('  outcome_summary: Workflow completed successfully with deterministic evidence.');
    });

    it('keeps stop-after-generation human output artifact-only when no execution stage is returned', async () => {
      const artifactOnly = stagedLocalResult({
        execution: undefined,
        nextActions: [
          'Run the generated workflow locally: npx --no-install agent-relay run workflows/generated/issue-3.ts',
          'Inspect the generated workflow artifact and choose whether to run it locally.',
        ],
      });
      const runner = vi.fn().mockResolvedValue(
        fakeInteractiveResult({
          ok: true,
          localResult: artifactOnly,
        }),
      );

      const result = await cliMain({
        argv: ['--mode', 'local', '--spec', 'build a workflow'],
        runInteractive: runner,
      });

      const output = result.output.join('\n');
      expect(result.exitCode).toBe(0);
      expect(output).toContain('stage: generate');
      expect(output).toContain('status: ok');
      expect(output).toContain('  Artifact: workflows/generated/issue-3.ts');
      expect(output).toContain(
        '  To execute this artifact: npx --no-install agent-relay run workflows/generated/issue-3.ts',
      );
      expect(output).not.toContain('--- execution ---');
      expect(output).not.toContain('outcome_summary:');
      expect(output).not.toContain('blocker_code:');
    });
  });

  describe('regression: issues #4 and #7 user-facing contracts', () => {
    it('labels generated artifacts as generation output, not execution evidence', async () => {
      const artifactOnly = stagedLocalResult({
        execution: undefined,
        nextActions: [],
      });
      const runner = vi.fn().mockResolvedValue(
        fakeInteractiveResult({
          ok: true,
          localResult: artifactOnly,
        }),
      );

      const result = await cliMain({
        argv: ['--mode', 'local', '--spec', 'generate a workflow for package checks'],
        runInteractive: runner,
      });

      const output = result.output.join('\n');
      const generationIndex = result.output.indexOf('stage: generate');
      const artifactIndex = result.output.indexOf('  Artifact: workflows/generated/issue-3.ts');
      const linkedCliIndex = result.output.indexOf('  Or with linked CLI: ricky run --artifact workflows/generated/issue-3.ts');

      expect(result.exitCode).toBe(0);
      expect(output).toContain('Generation: ok — artifact written to disk.');
      expect(output).toContain('Execution: not requested.');
      expect(generationIndex).toBeGreaterThan(-1);
      expect(artifactIndex).toBeGreaterThan(generationIndex);
      expect(linkedCliIndex).toBeGreaterThan(artifactIndex);
      expect(output).toContain('  workflow_id: wf-issue-3');
      expect(output).toContain('  spec_digest: digest-issue-3');
      expect(output).not.toContain('--- execution ---');
      expect(output).not.toContain('Execution: success');
      expect(output).not.toContain('outcome_summary:');
      expect(output).not.toContain('stdout_path:');
      expect(output).not.toContain('stderr_path:');
    });

    it('prints recovery guidance with the implemented spec inputs', async () => {
      const result = await cliMain({ argv: ['--spec'] });
      const output = result.output.join('\n');

      expect(result.exitCode).toBe(1);
      expect(output).toContain('CLI input blocker:');
      expect(output).toContain('--spec requires a value.');
      expect(output).toContain('For local handoff, provide one of --spec, --spec-file, or --stdin.');
      expect(output).not.toContain('npx ricky generate');
      expect(output).not.toContain('spec-stdin');
    });
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
    expect(output).toContain('Artifact returned.');
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
    expect(output).toContain('No spec provided');
    expect(output).toContain('npm start -- --mode local --spec');
    expect(output).toContain('npm start -- --mode local --spec-file');
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
      const readFileText = vi.fn().mockResolvedValue('workflow spec from file');

      await cliMain({
        argv: ['--mode', 'local', '--spec-file', './my-spec.md'],
        runInteractive: runner,
        readFileText,
      });

      expect(readFileText).toHaveBeenCalledWith(expect.stringMatching(/my-spec\.md$/));

      expect(runner).toHaveBeenCalledWith(
        expect.objectContaining({
          mode: 'local',
          handoff: expect.objectContaining({
            source: 'cli',
            spec: 'workflow spec from file',
            specFile: expect.stringMatching(/my-spec\.md$/),
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
      const readFileText = vi.fn().mockResolvedValue('aliased file content');

      await cliMain({
        argv: ['--mode', 'local', '--file', './alias-spec.md'],
        runInteractive: runner,
        readFileText,
      });

      expect(readFileText).toHaveBeenCalledWith(expect.stringMatching(/alias-spec\.md$/));

      expect(runner).toHaveBeenCalledWith(
        expect.objectContaining({
          handoff: expect.objectContaining({
            spec: 'aliased file content',
            specFile: expect.stringMatching(/alias-spec\.md$/),
            cliMetadata: { handoff: 'spec-file' },
          }),
        }),
      );
    });
  });

  // ---------------------------------------------------------------------------
  // Regression proof coverage for issue #1 and #2
  // ---------------------------------------------------------------------------

  describe('regression: invocation root passthrough for all handoff types', () => {
    it('passes invocationRoot through inline-spec handoff to the interactive runner', async () => {
      const runner = vi.fn().mockResolvedValue(fakeInteractiveResult());

      await cliMain({
        argv: ['--mode', 'local', '--spec', 'build a workflow'],
        cwd: '/caller-repo-inline',
        runInteractive: runner,
      });

      expect(runner).toHaveBeenCalledWith(
        expect.objectContaining({
          cwd: '/caller-repo-inline',
          handoff: expect.objectContaining({
            source: 'cli',
            spec: 'build a workflow',
            invocationRoot: '/caller-repo-inline',
            cliMetadata: { handoff: 'inline-spec' },
          }),
        }),
      );
    });

    it('passes invocationRoot through spec-file handoff to the interactive runner', async () => {
      const runner = vi.fn().mockResolvedValue(fakeInteractiveResult());
      const readFileText = vi.fn().mockResolvedValue('file content from spec-file');

      await cliMain({
        argv: ['--mode', 'local', '--spec-file', './my-spec.md'],
        cwd: '/caller-repo-specfile',
        runInteractive: runner,
        readFileText,
      });

      expect(readFileText).toHaveBeenCalledWith('/caller-repo-specfile/my-spec.md');

      expect(runner).toHaveBeenCalledWith(
        expect.objectContaining({
          cwd: '/caller-repo-specfile',
          handoff: expect.objectContaining({
            source: 'cli',
            spec: 'file content from spec-file',
            specFile: '/caller-repo-specfile/my-spec.md',
            invocationRoot: '/caller-repo-specfile',
            cliMetadata: { handoff: 'spec-file' },
          }),
        }),
      );
    });

    it('passes invocationRoot through stdin handoff to the interactive runner', async () => {
      const { Readable } = await import('node:stream');
      const input = Readable.from(['stdin content']);
      const runner = vi.fn().mockResolvedValue(fakeInteractiveResult());

      await cliMain({
        argv: ['--mode', 'local', '--stdin'],
        cwd: '/caller-repo-stdin',
        runInteractive: runner,
        input,
      });

      expect(runner).toHaveBeenCalledWith(
        expect.objectContaining({
          cwd: '/caller-repo-stdin',
          handoff: expect.objectContaining({
            source: 'cli',
            spec: 'stdin content',
            invocationRoot: '/caller-repo-stdin',
            cliMetadata: { handoff: 'stdin' },
          }),
        }),
      );
    });
  });

  describe('regression: artifact paths written relative to caller repo', () => {
    it('writes artifact into caller repo root when using inline spec with local executor', async () => {
      const { mkdtemp, rm, access, readFile } = await import('node:fs/promises');
      const { tmpdir } = await import('node:os');
      const { join } = await import('node:path');
      const tempRepo = await mkdtemp(join(tmpdir(), 'ricky-inline-repo-'));

      try {
        const result = await cliMain({
          argv: ['--mode', 'local', '--spec', 'generate a workflow for test coverage'],
          cwd: tempRepo,
          onboard: vi.fn().mockResolvedValue({
            mode: 'local',
            firstRun: false,
            bannerShown: false,
            output: 'mode=local',
          }),
        });

        expect(result.exitCode).toBe(0);
        expect(result.interactiveResult?.localResult?.ok).toBe(true);

        const artifact = result.interactiveResult?.localResult?.artifacts[0];
        expect(artifact).toBeDefined();
        expect(artifact?.path).toMatch(/^workflows\/generated\//);

        // Artifact physically exists in caller repo
        const artifactFullPath = join(tempRepo, artifact!.path);
        await expect(access(artifactFullPath)).resolves.toBeUndefined();

        // Artifact content was written
        const content = await readFile(artifactFullPath, 'utf8');
        expect(content).toContain('workflow(');

        // Next action command points to the same relative path
        const runAction = result.interactiveResult?.localResult?.nextActions.find((a) =>
          a.includes('npx --no-install agent-relay run'),
        );
        expect(runAction).toContain(artifact?.path);

        // Artifact is NOT in packages/cli/workflows/generated
        const cliWorkflowsPath = join(process.cwd(), 'packages/cli/workflows/generated');
        const artifactName = artifact!.path.split('/').pop()!;
        const wrongPath = join(cliWorkflowsPath, artifactName);
        await expect(access(wrongPath)).rejects.toThrow();
      } finally {
        await rm(tempRepo, { recursive: true, force: true });
      }
    });

    it('writes artifact into caller repo root when using spec-file with local executor', async () => {
      const { mkdtemp, rm, access, readFile } = await import('node:fs/promises');
      const { tmpdir } = await import('node:os');
      const { join } = await import('node:path');
      const tempRepo = await mkdtemp(join(tmpdir(), 'ricky-specfile-repo-'));

      try {
        const result = await cliMain({
          argv: ['--mode', 'local', '--spec-file', './workflow-spec.md'],
          cwd: tempRepo,
          readFileText: vi.fn().mockResolvedValue('generate a workflow for specfile test'),
          onboard: vi.fn().mockResolvedValue({
            mode: 'local',
            firstRun: false,
            bannerShown: false,
            output: 'mode=local',
          }),
        });

        expect(result.exitCode).toBe(0);
        expect(result.interactiveResult?.localResult?.ok).toBe(true);

        const artifact = result.interactiveResult?.localResult?.artifacts[0];
        expect(artifact).toBeDefined();
        expect(artifact?.path).toMatch(/^workflows\/generated\//);

        // Artifact physically exists in caller repo
        const artifactFullPath = join(tempRepo, artifact!.path);
        await expect(access(artifactFullPath)).resolves.toBeUndefined();

        // Artifact content was written
        const content = await readFile(artifactFullPath, 'utf8');
        expect(content).toContain('workflow(');

        // Next action command points to the same relative path
        const runAction = result.interactiveResult?.localResult?.nextActions.find((a) =>
          a.includes('npx --no-install agent-relay run'),
        );
        expect(runAction).toContain(artifact?.path);

        // Artifact is NOT in packages/cli/workflows/generated
        const cliWorkflowsPath = join(process.cwd(), 'packages/cli/workflows/generated');
        const artifactName = artifact!.path.split('/').pop()!;
        const wrongPath = join(cliWorkflowsPath, artifactName);
        await expect(access(wrongPath)).rejects.toThrow();
      } finally {
        await rm(tempRepo, { recursive: true, force: true });
      }
    });

    it('writes artifact into caller repo root when using stdin with local executor', async () => {
      const { mkdtemp, rm, access, readFile } = await import('node:fs/promises');
      const { tmpdir } = await import('node:os');
      const { join } = await import('node:path');
      const { Readable } = await import('node:stream');
      const tempRepo = await mkdtemp(join(tmpdir(), 'ricky-stdin-repo-'));
      const input = Readable.from(['generate a workflow for stdin test']);

      try {
        const result = await cliMain({
          argv: ['--mode', 'local', '--stdin'],
          cwd: tempRepo,
          input,
          onboard: vi.fn().mockResolvedValue({
            mode: 'local',
            firstRun: false,
            bannerShown: false,
            output: 'mode=local',
          }),
        });

        expect(result.exitCode).toBe(0);
        expect(result.interactiveResult?.localResult?.ok).toBe(true);

        const artifact = result.interactiveResult?.localResult?.artifacts[0];
        expect(artifact).toBeDefined();
        expect(artifact?.path).toMatch(/^workflows\/generated\//);

        // Artifact physically exists in caller repo
        const artifactFullPath = join(tempRepo, artifact!.path);
        await expect(access(artifactFullPath)).resolves.toBeUndefined();

        // Artifact content was written
        const content = await readFile(artifactFullPath, 'utf8');
        expect(content).toContain('workflow(');

        // Next action command points to the same relative path
        const runAction = result.interactiveResult?.localResult?.nextActions.find((a) =>
          a.includes('npx --no-install agent-relay run'),
        );
        expect(runAction).toContain(artifact?.path);

        // Artifact is NOT in packages/cli/workflows/generated
        const cliWorkflowsPath = join(process.cwd(), 'packages/cli/workflows/generated');
        const artifactName = artifact!.path.split('/').pop()!;
        const wrongPath = join(cliWorkflowsPath, artifactName);
        await expect(access(wrongPath)).rejects.toThrow();
      } finally {
        await rm(tempRepo, { recursive: true, force: true });
      }
    });
  });
});
