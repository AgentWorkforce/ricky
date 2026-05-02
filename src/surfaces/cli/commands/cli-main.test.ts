import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { InteractiveCliResult } from '../entrypoint/interactive-cli.js';
import type { OnboardingResult } from '../cli/onboarding.js';
import type { LocalResponse } from '../../../local/entrypoint.js';
import { cliMain, parseArgs, renderHelp } from './cli-main.js';

// ---------------------------------------------------------------------------
// parseArgs
// ---------------------------------------------------------------------------

describe('parseArgs', () => {
  // Auto-fix is default-on for local run flows. Refinement stays opt-in so
  // omitted generation flags remain fast and deterministic.
  const RUN_DEFAULTS = { autoFix: 3 };

  it('defaults to run command with auto-fix enabled and refinement omitted', () => {
    expect(parseArgs([])).toEqual({ command: 'run', ...RUN_DEFAULTS });
    expect(parseArgs([])).not.toHaveProperty('refine');
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
    expect(parseArgs(['--mode', 'local'])).toEqual({ command: 'run', mode: 'local', ...RUN_DEFAULTS });
    expect(parseArgs(['--mode', 'cloud'])).toEqual({ command: 'run', mode: 'cloud', ...RUN_DEFAULTS });
    expect(parseArgs(['--mode', 'both'])).toEqual({ command: 'run', mode: 'both', ...RUN_DEFAULTS });
  });

  it('ignores --mode with invalid value', () => {
    expect(parseArgs(['--mode', 'invalid'])).toEqual({ command: 'run', ...RUN_DEFAULTS });
  });

  it('ignores --mode with no value', () => {
    expect(parseArgs(['--mode'])).toEqual({ command: 'run', ...RUN_DEFAULTS });
  });

  it('parses local spec handoff flags', () => {
    expect(parseArgs(['--mode', 'local', '--spec', 'build a workflow'])).toEqual({
      command: 'run',
      mode: 'local',
      spec: 'build a workflow',
      ...RUN_DEFAULTS,
    });
    expect(parseArgs(['--spec-file', './spec.md'])).toEqual({
      command: 'run',
      specFile: './spec.md',
      ...RUN_DEFAULTS,
    });
    expect(parseArgs(['--stdin'])).toEqual({
      command: 'run',
      stdin: true,
      ...RUN_DEFAULTS,
    });
  });

  it('parses opt-in local run behavior and artifact execution', () => {
    expect(parseArgs(['--mode', 'local', '--spec', 'build a workflow', '--run'])).toEqual({
      command: 'run',
      mode: 'local',
      spec: 'build a workflow',
      runRequested: true,
      ...RUN_DEFAULTS,
    });
    expect(parseArgs(['run', 'workflows/generated/example.ts'])).toEqual({
      command: 'run',
      artifact: 'workflows/generated/example.ts',
      runRequested: true,
      ...RUN_DEFAULTS,
    });
    expect(parseArgs(['run', '--artifact', 'workflows/generated/example.ts', '--json'])).toEqual({
      command: 'run',
      artifact: 'workflows/generated/example.ts',
      runRequested: true,
      json: true,
      ...RUN_DEFAULTS,
    });
  });

  it('parses --auto-fix attempts and treats zero as disabled', () => {
    expect(parseArgs(['run', 'workflows/generated/example.ts', '--auto-fix'])).toMatchObject({
      command: 'run',
      artifact: 'workflows/generated/example.ts',
      runRequested: true,
      autoFix: 3,
    });
    expect(parseArgs(['run', 'workflows/generated/example.ts', '--auto-fix=5'])).toMatchObject({
      autoFix: 5,
    });
    expect(parseArgs(['run', 'workflows/generated/example.ts', '--repair=50'])).toMatchObject({
      autoFix: 10,
    });
    expect(parseArgs(['run', 'workflows/generated/example.ts', '--auto-fix=0'])).toMatchObject({
      command: 'run',
      artifact: 'workflows/generated/example.ts',
      runRequested: true,
    });
    expect(parseArgs(['run', '--auto-fix', '5', 'workflows/generated/example.ts'])).toMatchObject({
      artifact: 'workflows/generated/example.ts',
      autoFix: 5,
    });
  });

  it('parses manual resume flags for workflow runs', () => {
    expect(parseArgs([
      'run',
      '--artifact',
      'workflows/generated/example.ts',
      '--start-from',
      'self-review-pass-gate',
      '--previous-run-id',
      'relay-run-123',
    ])).toMatchObject({
      command: 'run',
      artifact: 'workflows/generated/example.ts',
      runRequested: true,
      startFromStep: 'self-review-pass-gate',
      previousRunId: 'relay-run-123',
    });

    expect(parseArgs(['run', '--start-from', 'step-a', 'workflows/generated/example.ts'])).toMatchObject({
      artifact: 'workflows/generated/example.ts',
      startFromStep: 'step-a',
    });
  });

  it('parses --refine and --with-llm model hints', () => {
    expect(parseArgs(['--spec', 'build a workflow', '--refine'])).toMatchObject({
      command: 'run',
      spec: 'build a workflow',
      refine: {},
    });
    expect(parseArgs(['--spec-file', './spec.md', '--refine=sonnet'])).toMatchObject({
      command: 'run',
      specFile: './spec.md',
      refine: { model: 'sonnet' },
    });
    expect(parseArgs(['--stdin', '--with-llm', 'opus'])).toMatchObject({
      command: 'run',
      stdin: true,
      refine: { model: 'opus' },
    });
  });

  it('omits refine when no refinement flag is supplied', () => {
    const parsed = parseArgs(['--spec', 'build a workflow']);

    expect(parsed).toMatchObject({
      command: 'run',
      spec: 'build a workflow',
      autoFix: 3,
    });
    expect(parsed).not.toHaveProperty('refine');
  });

  it('disables auto-fix when --no-auto-fix or --no-repair is passed', () => {
    const opted = parseArgs(['run', 'workflows/generated/example.ts', '--no-auto-fix']);
    expect(opted).not.toHaveProperty('autoFix');
    expect(opted).not.toHaveProperty('refine');
    const repairOpt = parseArgs(['run', 'workflows/generated/example.ts', '--no-repair']);
    expect(repairOpt).not.toHaveProperty('autoFix');
  });

  it('disables refine when --no-refine or --no-with-llm is passed', () => {
    const opted = parseArgs(['--spec', 'build a workflow', '--no-refine']);
    expect(opted).not.toHaveProperty('refine');
    expect(opted).toMatchObject({ autoFix: 3 });
    const noLlm = parseArgs(['--spec', 'build a workflow', '--no-with-llm']);
    expect(noLlm).not.toHaveProperty('refine');
  });

  it('reports missing values for spec flags', () => {
    expect(parseArgs(['--spec'])).toMatchObject({
      command: 'run',
      errors: ['--spec requires a value.'],
    });
  });

  it('parses quiet power-user local and cloud commands', () => {
    expect(parseArgs(['local', '--spec', 'build a workflow', '--name', 'release-health', '--no-run'])).toMatchObject({
      command: 'run',
      surface: 'local',
      mode: 'local',
      spec: 'build a workflow',
      workflowName: 'release-health',
      noRun: true,
      autoFix: 3,
    });

    expect(parseArgs(['cloud', '--workflow', 'workflows/generated/release-health.ts', '--run', '--yes', '--json'])).toMatchObject({
      command: 'run',
      surface: 'cloud',
      mode: 'cloud',
      artifact: 'workflows/generated/release-health.ts',
      runRequested: true,
      yes: true,
      json: true,
    });
  });

  it('parses power-user run modes, verbose output, and conflicting run-mode recovery', () => {
    expect(parseArgs(['local', '--spec', 'build a workflow', '--run', '--background', '--verbose'])).toMatchObject({
      command: 'run',
      surface: 'local',
      mode: 'local',
      runRequested: true,
      background: true,
      verbose: true,
    });

    expect(parseArgs(['local', '--spec', 'build a workflow', '--run', '--foreground'])).toMatchObject({
      foreground: true,
    });

    expect(parseArgs(['local', '--spec', 'build a workflow', '--background', '--foreground'])).toMatchObject({
      errors: ['--background and --foreground cannot be combined.'],
    });
  });

  it('parses --login and --connect-missing power-user recovery flags', () => {
    expect(parseArgs(['cloud', '--spec', 'build a workflow', '--login'])).toMatchObject({
      command: 'run',
      surface: 'cloud',
      login: true,
    });
    expect(parseArgs(['cloud', '--spec', 'build a workflow', '--connect-missing'])).toMatchObject({
      command: 'run',
      surface: 'cloud',
      connectMissing: true,
    });
  });

  it('parses Workforce persona writer flags and conflict recovery', () => {
    expect(parseArgs(['local', '--spec', 'x', '--workforce-persona'])).toMatchObject({
      workforcePersonaWriterCli: true,
    });
    expect(parseArgs(['--mode', 'local', '--spec', 'x', '--no-workforce-persona'])).toMatchObject({
      workforcePersonaWriterCli: false,
    });
    expect(parseArgs(['local', '--spec', 'x', '--workforce-persona', '--no-workforce-persona'])).toMatchObject({
      errors: ['--workforce-persona and --no-workforce-persona cannot be combined.'],
    });
  });

  it('parses status and connect commands', () => {
    expect(parseArgs(['status', '--json'])).toEqual({
      command: 'status',
      surface: 'status',
      json: true,
    });
    expect(parseArgs(['status', '--run', 'ricky-local-123', '--json'])).toEqual({
      command: 'status',
      surface: 'status',
      runId: 'ricky-local-123',
      json: true,
    });
    expect(parseArgs(['connect', 'agents', '--cloud', 'claude,codex'])).toMatchObject({
      command: 'connect',
      surface: 'connect',
      connectTarget: 'agents',
      cloudTargets: ['claude', 'codex'],
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
    expect(lines.some((l) => l.includes('--auto-fix'))).toBe(true);
    expect(lines.some((l) => l.includes('--help'))).toBe(true);
  });

  it('shows the current local handoff journey without obsolete generate guidance', () => {
    const helpText = renderHelp().join('\n');

    expect(helpText).toContain('ricky --mode local --spec <text>');
    expect(helpText).toContain('ricky --mode local --spec-file <path>');
    expect(helpText).toContain('ricky --mode local --stdin');
    expect(helpText).toContain(
      'ricky --mode local --spec "generate a workflow for package checks"',
    );
    expect(helpText).not.toContain('npx ricky generate');
    expect(helpText).not.toMatch(/rerun.*later/i);
  });

  it('states that spec handoff returns an artifact unless execution is explicitly requested', () => {
    const helpText = renderHelp().join('\n');

    expect(helpText).toContain('Happy path:');
    expect(helpText).toContain('ricky local --spec <text>');
    expect(helpText).toContain('ricky run --artifact <path> --background');
    expect(helpText).toContain('ricky status --run <run-id>');
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
  const runCommand = `ricky run --artifact ${artifactPath}`;
  const sdkCommand = `@agent-relay/sdk/workflows runScriptWorkflow ${artifactPath}`;
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
        run_command: runCommand,
        run_mode_hint: runCommand,
      },
    },
    execution: {
      stage: 'execute',
      status: 'success',
      execution: {
        workflow_id: 'wf-issue-3',
        artifact_path: artifactPath,
        command: sdkCommand,
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
          commands_invoked: [sdkCommand],
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

async function withCloudEnvCleared<T>(fn: () => Promise<T>): Promise<T> {
  const previous = {
    agentWorkforceToken: process.env.AGENTWORKFORCE_CLOUD_TOKEN,
    rickyToken: process.env.RICKY_CLOUD_TOKEN,
    agentWorkforceWorkspace: process.env.AGENTWORKFORCE_CLOUD_WORKSPACE,
    rickyWorkspace: process.env.RICKY_CLOUD_WORKSPACE,
  };
  delete process.env.AGENTWORKFORCE_CLOUD_TOKEN;
  delete process.env.RICKY_CLOUD_TOKEN;
  delete process.env.AGENTWORKFORCE_CLOUD_WORKSPACE;
  delete process.env.RICKY_CLOUD_WORKSPACE;

  try {
    return await fn();
  } finally {
    restoreEnv('AGENTWORKFORCE_CLOUD_TOKEN', previous.agentWorkforceToken);
    restoreEnv('RICKY_CLOUD_TOKEN', previous.rickyToken);
    restoreEnv('AGENTWORKFORCE_CLOUD_WORKSPACE', previous.agentWorkforceWorkspace);
    restoreEnv('RICKY_CLOUD_WORKSPACE', previous.rickyWorkspace);
  }
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}

describe('cliMain', () => {
  it('returns help output with exit code 0 for --help', async () => {
    const result = await cliMain({ argv: ['--help'] });
    expect(result.exitCode).toBe(0);
    expect(result.output[0]).toMatch(/ricky/);
    expect(result.interactiveResult).toBeUndefined();
  });

  it('returns version output with exit code 0 for --version', async () => {
    const result = await cliMain({ argv: ['--version'], version: '9.9.9' });
    expect(result.exitCode).toBe(0);
    expect(result.output).toEqual(['ricky 9.9.9']);
  });

  it('reads version from the package.json when not provided', async () => {
    const packageJsonPath = fileURLToPath(new URL('../../../../package.json', import.meta.url));
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as { version: string };

    const result = await cliMain({ argv: ['--version'] });

    expect(result.exitCode).toBe(0);
    expect(result.output).toEqual([`ricky ${packageJson.version}`]);
  });

  it('falls back to 0.0.0 when package.json lookup fails', async () => {
    const result = await cliMain({
      argv: ['version'],
      readPackageJsonText: vi.fn(() => {
        throw new Error('package lookup failed');
      }),
    });

    expect(result.exitCode).toBe(0);
    expect(result.output).toEqual(['ricky 0.0.0']);
  });

  it('delegates to interactive runner with no args', async () => {
    const runner = vi.fn().mockResolvedValue(fakeInteractiveResult());
    const result = await cliMain({ argv: [], runInteractive: runner });

    expect(runner).toHaveBeenCalledTimes(1);
    expect(result.exitCode).toBe(0);
    expect(result.interactiveResult?.ok).toBe(true);
  });

  it('passes stored Cloud auth into the compact first-screen provider status', async () => {
    const runner = vi.fn().mockResolvedValue(fakeInteractiveResult());
    await cliMain({
      argv: [],
      runInteractive: runner,
      readCloudAuth: vi.fn().mockResolvedValue({
        accessToken: 'stored-token',
        refreshToken: 'stored-refresh',
        accessTokenExpiresAt: new Date(Date.now() + 60_000).toISOString(),
        apiUrl: 'https://cloud.example.test',
      }),
    });

    expect(runner).toHaveBeenCalledWith(expect.objectContaining({
      providerStatus: expect.objectContaining({
        google: { connected: true },
      }),
    }));
  });

  it('prefers Workforce persona workflow authoring for CLI generation by default', async () => {
    const runner = vi.fn().mockResolvedValue(fakeInteractiveResult());

    await cliMain({
      argv: [],
      runInteractive: runner,
      readCloudAuth: async () => null,
    });

    expect(runner).toHaveBeenCalledWith(expect.objectContaining({
      preferWorkforcePersonaWorkflowWriter: true,
    }));
  });

  it('allows CLI callers to disable Workforce persona workflow authoring explicitly', async () => {
    const runner = vi.fn().mockResolvedValue(fakeInteractiveResult());

    await cliMain({
      argv: ['local', '--spec', 'build a workflow', '--no-workforce-persona'],
      runInteractive: runner,
    });

    expect(runner).toHaveBeenCalledWith(expect.objectContaining({
      preferWorkforcePersonaWorkflowWriter: false,
    }));
  });

  it('renders the full status dashboard after selecting Status interactively', async () => {
    const runner = vi.fn().mockResolvedValue(fakeInteractiveResult({
      onboarding: {
        mode: 'status',
        firstRun: false,
        bannerShown: false,
        output: 'mode=status',
      },
      guidance: ['Status selected.', 'Run:', '  ricky status --json'],
      awaitingInput: true,
    }));

    const result = await cliMain({
      argv: [],
      runInteractive: runner,
      readCloudAuth: async () => null,
    });
    const output = result.output.join('\n');

    expect(output).toContain('Ricky status');
    expect(output).toContain('╭─ Local tools');
    expect(output).toContain('╭─ AgentWorkforce Cloud');
    expect(output).toContain('Account:     not connected');
    expect(output).not.toContain('Status selected.');
    expect(output).not.toContain('ricky status --json');
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

  it('prints the background monitor run id and status command after guided local background run', async () => {
    const localResult = stagedLocalResult({
      execution: {
        ...stagedLocalResult().execution!,
        execution: {
          ...stagedLocalResult().execution!.execution,
          workflow_id: 'wf-background',
          run_id: 'relay-run-background',
        },
      },
    });
    const monitoredRun = {
      runId: 'ricky-local-background',
      status: 'completed',
      artifactPath: 'workflows/generated/background.ts',
      artifactDir: '/repo/.workflow-artifacts/ricky-local-runs/ricky-local-background',
      statePath: '/repo/.workflow-artifacts/ricky-local-runs/ricky-local-background/state.json',
      logPath: '/repo/.workflow-artifacts/ricky-local-runs/ricky-local-background/run.log',
      evidencePath: '/repo/.workflow-artifacts/ricky-local-runs/ricky-local-background/evidence.json',
      fixesPath: '/repo/.workflow-artifacts/ricky-local-runs/ricky-local-background/fixes.json',
      reattachCommand: 'ricky status --run ricky-local-background',
      response: localResult,
    } as const;
    const runner = vi.fn().mockResolvedValue(fakeInteractiveResult({
      localResult,
      localWorkflowResult: {
        preflight: {} as never,
        capture: {} as never,
        generation: stagedLocalResult({ execution: undefined }),
        summary: {
          artifactPath: 'workflows/generated/background.ts',
          goal: 'Background workflow',
          agents: [],
          jobs: [],
          desiredOutcome: 'Complete locally.',
          sideEffects: [],
          missingLocalBlockers: [],
          command: 'ricky run --artifact workflows/generated/background.ts',
        },
        confirmation: 'background',
        monitoredRun,
        command: 'ricky run --artifact workflows/generated/background.ts',
      },
    }));

    const result = await cliMain({ argv: [], runInteractive: runner });
    const output = result.output.join('\n');

    expect(output).toContain('Background monitor');
    expect(output).toContain('Workflow run id: ricky-local-background');
    expect(output).toContain('Runtime workflow id: wf-background');
    expect(output).toContain('Runtime run id: relay-run-background');
    expect(output).toContain('Status command: ricky status --run ricky-local-background');
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

  it('uses --name as the generated local artifact identity', async () => {
    const runner = vi.fn().mockResolvedValue(fakeInteractiveResult());

    await cliMain({
      argv: ['local', '--spec', 'clean up unused files', '--name', 'repo-tidying', '--no-run'],
      cwd: '/repo-root',
      runInteractive: runner,
    });

    const handoff = runner.mock.calls[0][0].handoff;
    expect(handoff).toMatchObject({
      source: 'cli',
      stageMode: 'generate',
      cliMetadata: expect.objectContaining({ workflowName: 'repo-tidying' }),
    });
    expect(handoff.spec).toMatchObject({
      workflowName: 'repo-tidying',
      artifactPath: 'workflows/generated/repo-tidying.ts',
    });
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

  it('keeps relative artifact run targets user-facing while passing invocationRoot for reads', async () => {
    const runner = vi.fn().mockResolvedValue(fakeInteractiveResult());

    await cliMain({
      argv: ['run', 'workflows/generated/example.ts'],
      cwd: '/repo-root',
      runInteractive: runner,
    });

    expect(runner).toHaveBeenCalledWith(
      expect.objectContaining({
        cwd: '/repo-root',
        mode: 'local',
        handoff: expect.objectContaining({
          source: 'workflow-artifact',
          artifactPath: 'workflows/generated/example.ts',
          invocationRoot: '/repo-root',
          stageMode: 'run',
        }),
      }),
    );
  });

  it('threads --auto-fix through artifact execution handoff', async () => {
    const runner = vi.fn().mockResolvedValue(fakeInteractiveResult());

    await cliMain({
      argv: ['run', 'workflows/generated/example.ts', '--auto-fix=5'],
      cwd: '/repo-root',
      runInteractive: runner,
    });

    expect(runner).toHaveBeenCalledWith(
      expect.objectContaining({
        handoff: expect.objectContaining({
          source: 'workflow-artifact',
          autoFix: { maxAttempts: 5 },
        }),
      }),
    );
  });

  it('threads manual resume flags through artifact execution handoff retry metadata', async () => {
    const runner = vi.fn().mockResolvedValue(fakeInteractiveResult());

    await cliMain({
      argv: [
        'run',
        '--artifact',
        'workflows/generated/example.ts',
        '--start-from',
        'self-review-pass-gate',
        '--previous-run-id',
        'relay-run-123',
      ],
      cwd: '/repo-root',
      runInteractive: runner,
    });

    expect(runner).toHaveBeenCalledWith(
      expect.objectContaining({
        handoff: expect.objectContaining({
          source: 'workflow-artifact',
          artifactPath: 'workflows/generated/example.ts',
          retry: {
            attempt: 1,
            reason: 'manual resume requested from Ricky CLI',
            startFromStep: 'self-review-pass-gate',
            previousRunId: 'relay-run-123',
            retryOfRunId: 'relay-run-123',
          },
        }),
      }),
    );
  });

  it('threads --auto-fix through spec-file generate-and-run handoff', async () => {
    const runner = vi.fn().mockResolvedValue(fakeInteractiveResult());

    await cliMain({
      argv: ['--mode', 'local', '--spec-file', './spec.md', '--run', '--auto-fix'],
      cwd: '/repo-root',
      readFileText: vi.fn().mockResolvedValue('build a workflow'),
      runInteractive: runner,
    });

    expect(runner).toHaveBeenCalledWith(
      expect.objectContaining({
        handoff: expect.objectContaining({
          source: 'cli',
          stageMode: 'run',
          autoFix: { maxAttempts: 3 },
        }),
      }),
    );
  });

  it('uses default auto-fix but no refinement in generated run handoff metadata when flags are omitted', async () => {
    const runner = vi.fn().mockResolvedValue(fakeInteractiveResult());

    await cliMain({
      argv: ['--mode', 'local', '--spec', 'build a workflow', '--run', '--name', 'release-health'],
      cwd: '/repo-root',
      runInteractive: runner,
    });

    const handoff = runner.mock.calls[0][0].handoff;
    expect(handoff).toMatchObject({
      source: 'cli',
      stageMode: 'run',
      autoFix: { maxAttempts: 3 },
      cliMetadata: {
        handoff: 'inline-spec',
        workflowName: 'release-health',
      },
    });
    expect(handoff).not.toHaveProperty('refine');
  });

  it('threads explicit refinement opt-in through generated handoff metadata', async () => {
    const runner = vi.fn().mockResolvedValue(fakeInteractiveResult());

    await cliMain({
      argv: ['--mode', 'local', '--spec', 'build a workflow', '--run', '--refine=sonnet'],
      cwd: '/repo-root',
      runInteractive: runner,
    });

    expect(runner.mock.calls[0][0].handoff).toMatchObject({
      source: 'cli',
      stageMode: 'run',
      autoFix: { maxAttempts: 3 },
      refine: { model: 'sonnet' },
      cliMetadata: { handoff: 'inline-spec' },
    });
  });

  it('honors explicit auto-fix and refinement disable in generated handoffs', async () => {
    const runner = vi.fn().mockResolvedValue(fakeInteractiveResult());

    await cliMain({
      argv: ['--mode', 'local', '--spec', 'build a workflow', '--run', '--no-auto-fix', '--no-refine'],
      cwd: '/repo-root',
      runInteractive: runner,
    });

    const handoff = runner.mock.calls[0][0].handoff;
    expect(handoff).toMatchObject({
      source: 'cli',
      stageMode: 'run',
      cliMetadata: { handoff: 'inline-spec' },
    });
    expect(handoff).not.toHaveProperty('autoFix');
    expect(handoff).not.toHaveProperty('refine');
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

  it('prefers INIT_CWD over the root package cwd when capturing the caller repo root', async () => {
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

  it('runs ricky --mode local with an inline spec through local execution', async () => {
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
            run_command: 'ricky run --artifact workflows/generated/example.ts',
            run_mode_hint: 'ricky run --artifact workflows/generated/example.ts',
          },
        },
        execution: {
          stage: 'execute',
          status: 'blocker',
          execution: {
            workflow_id: 'wf-example',
            artifact_path: 'workflows/generated/example.ts',
            command: '@agent-relay/sdk/workflows runScriptWorkflow workflows/generated/example.ts',
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
      expect(output).toContain('Execution: success — artifact ran through the Relay SDK workflow runner.');
      expect(output).toContain('  Author: deterministic generator');
      expect(generationIndex).toBeGreaterThan(-1);
      expect(executionIndex).toBeGreaterThan(generationIndex);
      expect(output).toContain('  Artifact: workflows/generated/issue-3.ts');
      expect(output).toContain('  workflow_id: wf-issue-3');
      expect(output).toContain('--- execution ---');
      expect(output).toContain('stage: execute');
      expect(output).toContain('status: success');
      expect(output).toContain('  command: @agent-relay/sdk/workflows runScriptWorkflow workflows/generated/issue-3.ts');
      expect(output).toContain('  outcome_summary: Workflow completed successfully with deterministic evidence.');
    });

    it('prints Workforce persona author metadata when the workflow was persona-authored', async () => {
      const personaResult = stagedLocalResult({
        generation: {
          ...stagedLocalResult().generation!,
          decisions: {
            workforce_persona: {
              personaId: 'agent-relay-workflow',
              tier: 'pro',
              harness: 'codex',
              model: 'gpt-5.5',
            },
          },
        },
        execution: undefined,
      });
      const runner = vi.fn().mockResolvedValue(fakeInteractiveResult({
        ok: true,
        localResult: personaResult,
      }));

      const result = await cliMain({
        argv: ['--mode', 'local', '--spec', 'build a workflow'],
        runInteractive: runner,
      });

      expect(result.output.join('\n')).toContain('  Author: agent-relay-workflow@pro (gpt-5.5) via codex');
    });

    it('keeps stop-after-generation human output artifact-only when no execution stage is returned', async () => {
      const artifactOnly = stagedLocalResult({
        execution: undefined,
        nextActions: [
          'Run the generated workflow locally: ricky run --artifact workflows/generated/issue-3.ts',
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
        '  To execute this artifact: ricky run --artifact workflows/generated/issue-3.ts',
      );
      expect(output).not.toContain('--- execution ---');
      expect(output).not.toContain('outcome_summary:');
      expect(output).not.toContain('blocker_code:');
    });
  });

  it('renders auto-fix escalation options when Ricky cannot choose one safe fix', async () => {
    const localResult = stagedLocalResult({
      ok: false,
      warnings: ['runtime blocked'],
      nextActions: ['Set TEST_TOKEN'],
      exitCode: 2,
      execution: {
        ...stagedLocalResult().execution!,
        status: 'blocker',
        blocker: {
          code: 'MISSING_ENV_VAR',
          category: 'environment',
          message: 'TEST_TOKEN is missing',
          detected_at: '2026-01-01T00:00:00.000Z',
          detected_during: 'launch',
          recovery: {
            actionable: true,
            steps: ['export TEST_TOKEN=...'],
          },
          context: {
            missing: ['TEST_TOKEN'],
            found: [],
          },
        },
        evidence: {
          ...stagedLocalResult().execution!.evidence!,
          logs: {
            ...stagedLocalResult().execution!.evidence!.logs,
            tail: ['missing TEST_TOKEN in step runtime-launch'],
            truncated: false,
          },
        },
      },
      auto_fix: {
        max_attempts: 3,
        final_status: 'blocker',
        resumed: false,
        run_id: 'ricky-local-options',
        attempts: [{ attempt: 1, status: 'blocker', blocker_code: 'MISSING_ENV_VAR' }],
        escalation: {
          summary: 'Ricky checked the logs but the next safe fix is ambiguous.',
          log_tail: ['missing TEST_TOKEN in step runtime-launch'],
          options: [
            {
              label: 'Try recovery step',
              description: 'export TEST_TOKEN=...',
              command: 'export TEST_TOKEN=...',
            },
            {
              label: 'Check run status and saved logs',
              description: 'Inspect persisted evidence.',
              command: 'ricky status --run ricky-local-options',
            },
          ],
        },
      },
    });
    const runner = vi.fn().mockResolvedValue(fakeInteractiveResult({ ok: false, localResult }));

    const result = await cliMain({
      argv: ['run', '--artifact', 'workflows/generated/issue-3.ts'],
      runInteractive: runner,
    });

    const output = result.output.join('\n');
    expect(output).toContain('Ricky reviewed the logs and could not choose one safe fix.');
    expect(output).toContain('Relevant logs:');
    expect(output).toContain('missing TEST_TOKEN in step runtime-launch');
    expect(output).toContain('Options:');
    expect(output).toContain('1. Try recovery step: export TEST_TOKEN=...');
    expect(output).toContain('export TEST_TOKEN=...');
    expect(output).toContain('ricky status --run ricky-local-options');
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
            'Run the generated workflow locally: ricky run --artifact workflows/generated/package-checks.ts',
            'Inspect the generated workflow artifact and choose whether to run it locally.',
          ],
        }),
      },
    });

    const output = result.output.join('\n');
    expect(result.exitCode).toBe(0);
    expect(output).toContain('Artifact returned.');
    expect(output).toContain('Artifact: workflows/generated/package-checks.ts');
    expect(output).toContain('Next: Run the generated workflow locally: ricky run --artifact workflows/generated/package-checks.ts');
    expect(output).toContain('Next: Inspect the generated workflow artifact and choose whether to run it locally.');
  });

  it('keeps ricky --mode local blocked until a real spec or file is provided', async () => {
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
    expect(output).toContain('ricky --mode local --spec');
    expect(output).toContain('ricky --mode local --spec-file');
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

  it('renders compact power-user local JSON with run command when --run is omitted', async () => {
    const artifactOnly = stagedLocalResult({
      execution: undefined,
      nextActions: [
        'Run the generated workflow locally: ricky run --artifact workflows/generated/issue-3.ts',
      ],
    });
    const runner = vi.fn().mockResolvedValue(
      fakeInteractiveResult({
        ok: true,
        localResult: artifactOnly,
      }),
    );

    const result = await cliMain({
      argv: ['local', '--spec', 'build a workflow', '--name', 'issue-3', '--json'],
      runInteractive: runner,
    });

    expect(result.exitCode).toBe(0);
    expect(runner).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'local',
        handoff: expect.objectContaining({
          stageMode: 'generate',
          cliMetadata: expect.objectContaining({ workflowName: 'issue-3' }),
        }),
      }),
    );
    const parsed = JSON.parse(result.output.join('\n'));
    expect(parsed).toMatchObject({
      mode: 'local',
      workflowName: 'issue-3',
      workflowPath: 'workflows/generated/issue-3.ts',
      status: 'ok',
      warnings: [],
      nextActions: expect.arrayContaining([
        'Run the generated workflow locally: ricky run --artifact workflows/generated/issue-3.ts',
      ]),
    });
  });

  it('renders one-line --yes summary for power-user local run confirmation only', async () => {
    const runner = vi.fn().mockResolvedValue(
      fakeInteractiveResult({
        ok: true,
        localResult: stagedLocalResult(),
      }),
    );

    const result = await cliMain({
      argv: ['local', '--spec', 'build a workflow', '--run', '--yes', '--quiet'],
      runInteractive: runner,
    });

    expect(result.exitCode).toBe(0);
    expect(result.output).toEqual(['Ricky local: issue-3 run success.']);
    expect(runner.mock.calls[0][0].handoff).toMatchObject({
      stageMode: 'run',
      cliMetadata: expect.objectContaining({ yes: 'non-destructive-confirmations-only' }),
    });
  });

  it('threads power-user background and foreground run-mode metadata without unsafe approvals', async () => {
    const runner = vi.fn().mockResolvedValue(
      fakeInteractiveResult({
        ok: true,
        localResult: stagedLocalResult(),
      }),
    );

    await cliMain({
      argv: ['local', '--spec', 'build a workflow', '--run', '--background', '--yes'],
      runInteractive: runner,
    });
    await cliMain({
      argv: ['local', '--spec', 'build a workflow', '--run', '--foreground'],
      runInteractive: runner,
    });

    expect(runner.mock.calls[0][0].handoff.cliMetadata).toMatchObject({
      runMode: 'background',
      yes: 'non-destructive-confirmations-only',
    });
    expect(runner.mock.calls[1][0].handoff.cliMetadata).toMatchObject({
      runMode: 'foreground',
    });
  });

  it('derives power-user cloud inline requests from stored auth and workspace without injected cloudRequest', async () => {
    await withCloudEnvCleared(async () => {
      const runner = vi.fn().mockResolvedValue(fakeInteractiveResult({ mode: 'cloud' }));
      const auth = {
        accessToken: 'stored-token',
        refreshToken: 'stored-refresh',
        accessTokenExpiresAt: new Date(Date.now() + 60_000).toISOString(),
        apiUrl: 'https://cloud.example.test',
      };
      const resolveCloudWorkspace = vi.fn().mockResolvedValue('workspace-from-cloud-profile');

      const result = await cliMain({
        argv: ['cloud', '--spec', 'build a workflow', '--run', '--name', 'cloud-power', '--json'],
        runInteractive: runner,
        readCloudAuth: vi.fn().mockResolvedValue(auth),
        resolveCloudWorkspace,
      });

      expect(result.exitCode).toBe(0);
      expect(resolveCloudWorkspace).toHaveBeenCalledWith(auth);
      expect(runner).toHaveBeenCalledWith(
        expect.objectContaining({
          mode: 'cloud',
          cloudRequest: {
            auth: { token: 'stored-token' },
            workspace: { workspaceId: 'workspace-from-cloud-profile' },
            body: {
              spec: 'build a workflow',
              mode: 'cloud',
              metadata: {
                workflowName: 'cloud-power',
                cli: {
                  handoff: 'inline-spec',
                  workflowName: 'cloud-power',
                },
              },
            },
          },
        }),
      );
      expect(runner.mock.calls[0][0]).not.toHaveProperty('handoff');
    });
  });

  it('derives power-user cloud spec-file requests from stored auth and workspace without injected cloudRequest', async () => {
    await withCloudEnvCleared(async () => {
      const runner = vi.fn().mockResolvedValue(fakeInteractiveResult({ mode: 'cloud' }));
      const readFileText = vi.fn().mockResolvedValue('workflow spec from file');

      const result = await cliMain({
        argv: ['cloud', '--spec-file', './spec.md', '--no-run', '--json'],
        cwd: '/repo-root',
        runInteractive: runner,
        readFileText,
        readCloudAuth: vi.fn().mockResolvedValue({
          accessToken: 'stored-token',
          refreshToken: 'stored-refresh',
          accessTokenExpiresAt: new Date(Date.now() + 60_000).toISOString(),
          apiUrl: 'https://cloud.example.test',
        }),
        resolveCloudWorkspace: vi.fn().mockResolvedValue('workspace-from-cloud-profile'),
      });

      expect(result.exitCode).toBe(0);
      expect(readFileText).toHaveBeenCalledWith('/repo-root/spec.md');
      expect(runner).toHaveBeenCalledWith(
        expect.objectContaining({
          mode: 'cloud',
          cloudRequest: expect.objectContaining({
            auth: { token: 'stored-token' },
            workspace: { workspaceId: 'workspace-from-cloud-profile' },
            body: {
              spec: 'workflow spec from file',
              specPath: '/repo-root/spec.md',
              mode: 'cloud',
              metadata: {
                cli: {
                  handoff: 'spec-file',
                },
              },
            },
          }),
        }),
      );
      expect(runner.mock.calls[0][0]).not.toHaveProperty('handoff');
    });
  });

  it('renders a Cloud run command when power-user Cloud generation does not run immediately', async () => {
    const runner = vi.fn().mockResolvedValue(fakeInteractiveResult({
      mode: 'cloud',
      cloudResult: {
        artifacts: [{ path: 'workflows/generated/cloud-release.ts', type: 'text/typescript' }],
        warnings: [],
        assumptions: [],
        validation: { ok: true, status: 'passed', issues: [] },
        followUpActions: [],
      },
    }));

    const result = await cliMain({
      argv: ['cloud', '--spec', 'build a cloud workflow', '--name', 'cloud-release'],
      runInteractive: runner,
      cloudRequest: {
        auth: { token: 'stored-token' },
        workspace: { workspaceId: 'workspace-from-test' },
        body: { spec: 'placeholder', mode: 'cloud' },
      },
    });

    const output = result.output.join('\n');
    expect(result.exitCode).toBe(0);
    expect(output).toContain('Ricky cloud: cloud-release generated; run when ready.');
    expect(output).toContain('Workflow: workflows/generated/cloud-release.ts');
    expect(output).toContain('Run: ricky cloud --workflow workflows/generated/cloud-release.ts --run');
  });

  it('fails power-user cloud non-interactively with recovery commands when Cloud context is missing', async () => {
    await withCloudEnvCleared(async () => {
      const runner = vi.fn();

      const result = await cliMain({
        argv: ['cloud', '--spec', 'build a workflow', '--json'],
        runInteractive: runner,
        readCloudAuth: async () => null,
      });

      expect(result.exitCode).toBe(1);
      expect(runner).not.toHaveBeenCalled();
      const parsed = JSON.parse(result.output.join('\n'));
      expect(parsed).toMatchObject({
        mode: 'cloud',
        status: 'blocked',
        warnings: expect.arrayContaining([
          'Cloud mode requires a connected AgentWorkforce Cloud account.',
          'Run `ricky connect cloud`, then retry the Cloud command.',
          'No local fallback was attempted.',
        ]),
        nextActions: expect.arrayContaining(['ricky connect cloud', 'ricky status']),
      });
    });
  });

  it('ricky status derives Local block from runLocalPreflight rather than hard-coded constants', async () => {
    const { mkdtemp, mkdir, rm, writeFile, chmod } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');

    const repoWithAgentRelay = await mkdtemp(join(tmpdir(), 'ricky-status-found-'));
    const repoWithoutAgentRelay = await mkdtemp(join(tmpdir(), 'ricky-status-missing-'));
    const previousPath = process.env.PATH;
    process.env.PATH = '';
    try {
      await mkdir(join(repoWithAgentRelay, '.git'), { recursive: true });
      await mkdir(join(repoWithAgentRelay, 'node_modules', '.bin'), { recursive: true });
      await writeFile(join(repoWithAgentRelay, 'node_modules/.bin/agent-relay'), '#!/bin/sh\n', 'utf8');
      await chmod(join(repoWithAgentRelay, 'node_modules/.bin/agent-relay'), 0o755);

      await mkdir(join(repoWithoutAgentRelay, '.git'), { recursive: true });

      const found = await cliMain({ argv: ['status', '--json'], cwd: repoWithAgentRelay, readCloudAuth: async () => null });
      const missing = await cliMain({ argv: ['status', '--json'], cwd: repoWithoutAgentRelay, readCloudAuth: async () => null });

      const foundJson = JSON.parse(found.output.join('\n'));
      const missingJson = JSON.parse(missing.output.join('\n'));

      expect(foundJson.local.repo).toBe(repoWithAgentRelay);
      expect(foundJson.local.agentRelay).toMatch(/^found/);
      expect(missingJson.local.repo).toBe(repoWithoutAgentRelay);
      expect(missingJson.local.agentRelay).toBe('missing');
    } finally {
      process.env.PATH = previousPath;
      await rm(repoWithAgentRelay, { recursive: true, force: true });
      await rm(repoWithoutAgentRelay, { recursive: true, force: true });
    }
  });

  it('ricky status reads stored Relay Cloud auth and reconciles the workspace', async () => {
    const readCloudAuth = vi.fn().mockResolvedValue({
      accessToken: 'stored-token',
      refreshToken: 'stored-refresh',
      accessTokenExpiresAt: new Date(Date.now() + 60_000).toISOString(),
      apiUrl: 'https://cloud.example.test',
    });
    const resolveCloudWorkspace = vi.fn().mockResolvedValue('workspace-from-cloud-profile');
    const fetchMock = vi.fn(async (url: string) => {
      if (url === 'https://cloud.example.test/api/v1/cloud-agents') {
        return new Response(JSON.stringify({
          agents: [
            { harness: 'anthropic', displayName: 'Claude', status: 'connected', credentialStoredAt: '2026-01-01T00:00:00.000Z' },
            { harness: 'openai', displayName: 'Codex', status: 'connected', credentialStoredAt: '2026-01-01T00:00:00.000Z' },
            { harness: 'google/gemini', displayName: 'Gemini', status: 'connected', credentialStoredAt: '2026-01-01T00:00:00.000Z' },
          ],
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (url.endsWith('/integrations/slack')) {
        return new Response(JSON.stringify({ connectionId: 'slack-conn', providerConfigKey: 'slack-sage' }), { status: 200 });
      }
      if (url.endsWith('/integrations/github')) {
        return new Response(JSON.stringify({ connectionId: 'github-conn', providerConfigKey: 'github' }), { status: 200 });
      }
      if (url.endsWith('/integrations/notion')) {
        return new Response(JSON.stringify({ connectionId: null, providerConfigKey: null }), { status: 200 });
      }
      if (url.endsWith('/integrations/linear')) {
        return new Response(JSON.stringify({ connectionId: 'linear-conn', providerConfigKey: 'linear' }), { status: 200 });
      }
      return new Response(JSON.stringify({ error: 'not found' }), { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);

    try {
      const json = await cliMain({
        argv: ['status', '--json'],
        cwd: '/repo-root',
        readCloudAuth,
        resolveCloudWorkspace,
      });
      const parsed = JSON.parse(json.output.join('\n'));

      expect(readCloudAuth).toHaveBeenCalledTimes(1);
      expect(resolveCloudWorkspace).toHaveBeenCalledWith(expect.objectContaining({
        accessToken: 'stored-token',
      }));
      expect(fetchMock).toHaveBeenCalledWith('https://cloud.example.test/api/v1/cloud-agents', expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer stored-token' }),
      }));
      expect(fetchMock).toHaveBeenCalledWith(
        'https://cloud.example.test/api/v1/workspaces/workspace-from-cloud-profile/integrations/github',
        expect.objectContaining({ method: 'GET' }),
      );
      expect(parsed.cloud).toMatchObject({
        account: 'connected',
        workspace: 'workspace-from-cloud-profile',
        agents: 'connected: Claude, Codex, Gemini; missing: OpenCode',
      });
      expect(parsed.integrations.slack).toBe('connected (slack-sage)');
      expect(parsed.integrations.github).toBe('connected (github)');
      expect(parsed.integrations.notion).toBe('not connected');
      expect(parsed.integrations.linear).toBe('connected (linear)');

      const human = await cliMain({
        argv: ['status'],
        cwd: '/repo-root',
        readCloudAuth,
        resolveCloudWorkspace,
      });
      expect(human.output.join('\n')).toContain('Account:     connected');
      expect(human.output.join('\n')).toContain('Workspace:   workspace-from-cloud-profile');
      expect(human.output.join('\n')).toContain('Agents:      connected: Claude, Codex, Gemini; missing: OpenCode');
      expect(human.output.join('\n')).toContain('Slack:       connected (slack-sage)');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('ricky status treats rejected stored Cloud auth as not authenticated', async () => {
    const readCloudAuth = vi.fn().mockResolvedValue({
      accessToken: 'expired-token',
      refreshToken: 'stored-refresh',
      accessTokenExpiresAt: new Date(Date.now() + 60_000).toISOString(),
      apiUrl: 'https://cloud.example.test',
    });
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 }));
    vi.stubGlobal('fetch', fetchMock);

    try {
      const json = await cliMain({
        argv: ['status', '--json'],
        cwd: '/repo-root',
        readCloudAuth,
        resolveCloudWorkspace: vi.fn().mockResolvedValue('workspace-from-cloud-profile'),
      });
      const parsed = JSON.parse(json.output.join('\n'));

      expect(parsed.cloud.account).toBe('not connected (Cloud login required)');
      expect(parsed.cloud.agents).toBe('not connected (Cloud login required)');
      expect(parsed.integrations.github).toBe('not connected (Cloud login required)');
      expect(parsed.warnings.join('\n')).toContain('Cloud auth was rejected');
      expect(parsed.nextActions).toContain('ricky connect cloud');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('ricky status --run reads persisted monitor progress by run id', async () => {
    const { mkdir, mkdtemp, rm, writeFile } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const repo = await mkdtemp(join(tmpdir(), 'ricky-status-run-'));
    const runId = 'ricky-local-status-fixture';
    const artifactDir = join(repo, '.workflow-artifacts', 'ricky-local-runs', runId);
    const statePath = join(artifactDir, 'state.json');
    const response = stagedLocalResult({
      execution: {
        ...stagedLocalResult().execution!,
        execution: {
          ...stagedLocalResult().execution!.execution,
          workflow_id: 'wf-status-fixture',
          run_id: 'relay-run-status-fixture',
        },
      },
    });

    try {
      await mkdir(artifactDir, { recursive: true });
      await writeFile(statePath, JSON.stringify({
        runId,
        status: 'running',
        artifactPath: 'workflows/generated/status-fixture.ts',
        artifactDir,
        statePath,
        logPath: join(artifactDir, 'run.log'),
        evidencePath: join(artifactDir, 'evidence.json'),
        fixesPath: join(artifactDir, 'fixes.json'),
        reattachCommand: `ricky status --run ${runId}`,
        response,
      }), 'utf8');

      const human = await cliMain({ argv: ['status', '--run', runId], cwd: repo });
      expect(human.output.join('\n')).toContain(`Run id:    ${runId}`);
      expect(human.output.join('\n')).toContain('Status:    running');
      expect(human.output.join('\n')).toContain('workflow_id: wf-status-fixture');
      expect(human.output.join('\n')).toContain('run_id: relay-run-status-fixture');
      expect(human.output.join('\n')).toContain(`ricky status --run ${runId}`);

      const json = await cliMain({ argv: ['status', '--run', runId, '--json'], cwd: repo });
      expect(JSON.parse(json.output.join('\n'))).toMatchObject({
        runId,
        status: 'running',
        response: {
          execution: {
            execution: {
              workflow_id: 'wf-status-fixture',
              run_id: 'relay-run-status-fixture',
            },
          },
        },
      });
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });

  it('ricky status --run explains that a blocked monitor state is historical and gives a rerun command', async () => {
    const { mkdir, mkdtemp, rm, writeFile } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const repo = await mkdtemp(join(tmpdir(), 'ricky-status-blocked-run-'));
    const runId = 'ricky-local-blocked-fixture';
    const artifactPath = 'workflows/generated/blocked.ts';
    const artifactDir = join(repo, '.workflow-artifacts', 'ricky-local-runs', runId);
    const statePath = join(artifactDir, 'state.json');
    const response = stagedLocalResult({
      ok: false,
      execution: {
        ...stagedLocalResult().execution!,
        status: 'blocker',
        execution: {
          ...stagedLocalResult().execution!.execution,
          command: `npx --no-install agent-relay run ${artifactPath}`,
        },
        evidence: {
          outcome_summary: 'Runtime package "agent-relay" is not installed in this workspace.',
          logs: { tail: ['Runtime package "agent-relay" is not installed in this workspace.'], truncated: false },
          side_effects: {
            files_written: [],
            commands_invoked: [`npx --no-install agent-relay run ${artifactPath}`],
          },
          assertions: [{ name: 'runtime_precheck', status: 'fail', detail: 'missing package' }],
        },
      },
    });

    try {
      await mkdir(artifactDir, { recursive: true });
      await writeFile(statePath, JSON.stringify({
        runId,
        status: 'blocked',
        artifactPath,
        artifactDir,
        statePath,
        logPath: join(artifactDir, 'run.log'),
        evidencePath: join(artifactDir, 'evidence.json'),
        fixesPath: join(artifactDir, 'fixes.json'),
        reattachCommand: `ricky status --run ${runId}`,
        response,
      }), 'utf8');

      const human = await cliMain({ argv: ['status', '--run', runId], cwd: repo });
      const output = human.output.join('\n');
      expect(output).toContain('Status:    blocked');
      expect(output).toContain('This run has finished with persisted evidence; its status will not change.');
      expect(output).toContain('New runs can use agent-relay on PATH when node_modules/.bin/agent-relay is absent.');
      expect(output).toContain(`ricky run ${artifactPath}`);
      expect(output).toContain('If you choose background monitoring again, use the new run id Ricky prints.');
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });

  it('ricky connect cloud invokes the Relay Cloud account login flow', async () => {
    const connectProvider = vi.fn().mockResolvedValue({ provider: 'google', success: true });
    const ensureCloudAuthenticated = vi.fn().mockResolvedValue({
      accessToken: 'token',
      refreshToken: 'refresh',
      accessTokenExpiresAt: new Date(Date.now() + 60_000).toISOString(),
      apiUrl: 'https://cloud.example.test',
    });

    const result = await cliMain({
      argv: ['connect', 'cloud', '--json'],
      connectProvider,
      ensureCloudAuthenticated,
    });

    expect(result.exitCode).toBe(0);
    expect(ensureCloudAuthenticated).toHaveBeenCalledTimes(1);
    expect(connectProvider).not.toHaveBeenCalled();
    const parsed = JSON.parse(result.output.join('\n'));
    expect(parsed).toMatchObject({
      target: 'cloud',
      status: 'connected',
      connectedProviders: ['cloud'],
      nextActions: ['ricky status'],
    });
  });

  it('ricky connect agents invokes the Relay Cloud connector for each requested provider', async () => {
    const connectProvider = vi.fn(async (options: { provider: string }) => ({
      provider: options.provider,
      success: true,
    }));

    const result = await cliMain({
      argv: ['connect', 'agents', '--cloud', 'claude,codex', '--json'],
      connectProvider,
    });

    expect(result.exitCode).toBe(0);
    expect(connectProvider.mock.calls.map(([options]) => options.provider)).toEqual(['claude', 'codex']);
    const parsed = JSON.parse(result.output.join('\n'));
    expect(parsed).toMatchObject({
      target: 'agents',
      status: 'connected',
      connectedProviders: ['claude', 'codex'],
    });
  });

  it('ricky connect agents --cloud connects the standard Cloud agent set', async () => {
    const connectProvider = vi.fn(async (options: { provider: string }) => ({
      provider: options.provider,
      success: true,
    }));

    const result = await cliMain({
      argv: ['connect', 'agents', '--cloud', '--json'],
      connectProvider,
    });

    expect(result.exitCode).toBe(0);
    expect(connectProvider.mock.calls.map(([options]) => options.provider)).toEqual([
      'claude',
      'codex',
      'opencode',
      'gemini',
    ]);
    expect(JSON.parse(result.output.join('\n'))).toMatchObject({
      target: 'agents',
      status: 'connected',
      connectedProviders: ['claude', 'codex', 'opencode', 'gemini'],
    });
  });

  it('ricky connect integrations --cloud connects the standard optional integration set', async () => {
    const connectCloudIntegrations = vi.fn().mockResolvedValue([
      { integration: 'slack', status: 'link-opened', url: 'https://nango.example/slack' },
      { integration: 'github', status: 'link-opened', url: 'https://nango.example/github' },
      { integration: 'notion', status: 'link-opened', url: 'https://nango.example/notion' },
      { integration: 'linear', status: 'link-opened', url: 'https://nango.example/linear' },
    ]);

    const result = await cliMain({
      argv: ['connect', 'integrations', '--cloud', '--json'],
      connectCloudIntegrations,
      readCloudAuth: async () => ({
        accessToken: 'stored-token',
        refreshToken: 'stored-refresh',
        accessTokenExpiresAt: new Date(Date.now() + 60_000).toISOString(),
        apiUrl: 'https://cloud.example',
      }),
    });

    expect(result.exitCode).toBe(0);
    expect(connectCloudIntegrations).toHaveBeenCalledWith(['slack', 'github', 'notion', 'linear']);
    expect(JSON.parse(result.output.join('\n'))).toMatchObject({
      target: 'integrations',
      status: 'connected',
      connectedProviders: ['slack', 'github', 'notion', 'linear'],
    });
  });

  it('ricky connect reports failed Relay Cloud connector attempts without claiming success', async () => {
    const connectProvider = vi.fn().mockRejectedValue(new Error('connectProvider requires an interactive terminal (TTY).'));

    const result = await cliMain({
      argv: ['connect', 'agents', '--cloud', 'claude', '--json'],
      connectProvider,
    });

    expect(result.exitCode).toBe(1);
    const parsed = JSON.parse(result.output.join('\n'));
    expect(parsed).toMatchObject({
      target: 'agents',
      status: 'failed',
      failedProviders: [
        {
          provider: 'claude',
          message: 'connectProvider requires an interactive terminal (TTY).',
        },
      ],
      nextActions: expect.arrayContaining(['npx agent-relay cloud connect claude', 'ricky status']),
    });
  });

  it('ricky connect integrations creates Nango connect links without using provider auth', async () => {
    const connectProvider = vi.fn().mockResolvedValue({ provider: 'slack', success: true });
    const connectCloudIntegrations = vi.fn().mockResolvedValue([
      { integration: 'slack', status: 'link-opened', url: 'https://nango.example/slack' },
      { integration: 'github', status: 'link-created', url: 'https://nango.example/github' },
    ]);

    const result = await cliMain({
      argv: ['connect', 'integrations', '--cloud', 'slack,github', '--json'],
      connectProvider,
      connectCloudIntegrations,
      readCloudAuth: async () => ({
        accessToken: 'stored-token',
        refreshToken: 'stored-refresh',
        accessTokenExpiresAt: new Date(Date.now() + 60_000).toISOString(),
        apiUrl: 'https://cloud.example',
      }),
    });

    expect(result.exitCode).toBe(0);
    expect(connectProvider).not.toHaveBeenCalled();
    expect(connectCloudIntegrations).toHaveBeenCalledWith(['slack', 'github']);
    const parsed = JSON.parse(result.output.join('\n'));
    expect(parsed).toMatchObject({
      target: 'integrations',
      status: 'connected',
      connectedProviders: ['slack', 'github'],
      nextActions: ['ricky status'],
    });
  });

  it('fails ricky connect integrations --json without stored Cloud auth instead of opening login flow', async () => {
    const connectCloudIntegrations = vi.fn();

    const result = await cliMain({
      argv: ['connect', 'integrations', '--cloud', 'slack,github', '--json'],
      connectCloudIntegrations,
      readCloudAuth: async () => null,
    });

    expect(result.exitCode).toBe(1);
    expect(connectCloudIntegrations).not.toHaveBeenCalled();
    expect(JSON.parse(result.output.join('\n'))).toMatchObject({
      target: 'integrations',
      status: 'failed',
      nextActions: ['ricky connect cloud', 'ricky connect integrations --cloud slack,github,notion,linear', 'ricky status'],
      failedProviders: [
        {
          provider: 'slack',
          message: 'Cloud login is required before Ricky can request a Nango connect link.',
        },
        {
          provider: 'github',
          message: 'Cloud login is required before Ricky can request a Nango connect link.',
        },
      ],
    });
  });

  it('wires power-user --login recoverCloudLogin shim into interactive deps', async () => {
    const runner = vi.fn().mockResolvedValue(fakeInteractiveResult({ mode: 'cloud' }));
    await cliMain({
      argv: ['cloud', '--spec', 'build a workflow', '--login'],
      runInteractive: runner,
      cloudRequest: {
        auth: { token: 'stored-token' },
        workspace: { workspaceId: 'workspace-from-test' },
        body: { spec: 'placeholder', mode: 'cloud' },
      },
    });
    const deps = runner.mock.calls[0][0];
    expect(typeof deps.recoverCloudLogin).toBe('function');
  });

  it('wires power-user --connect-missing connectCloudAgents shim into interactive deps', async () => {
    const runner = vi.fn().mockResolvedValue(fakeInteractiveResult({ mode: 'cloud' }));
    await cliMain({
      argv: ['cloud', '--spec', 'build a workflow', '--connect-missing'],
      runInteractive: runner,
      cloudRequest: {
        auth: { token: 'stored-token' },
        workspace: { workspaceId: 'workspace-from-test' },
        body: { spec: 'placeholder', mode: 'cloud' },
      },
    });
    const deps = runner.mock.calls[0][0];
    expect(typeof deps.connectCloudAgents).toBe('function');
  });

  it('renders status and connect surfaces without invoking interactive runner', async () => {
    const runner = vi.fn();
    const ensureCloudAuthenticated = vi.fn().mockResolvedValue({
      accessToken: 'token',
      refreshToken: 'refresh',
      accessTokenExpiresAt: new Date(Date.now() + 60_000).toISOString(),
      apiUrl: 'https://cloud.example.test',
    });
    const status = await cliMain({
      argv: ['status', '--json'],
      cwd: '/repo-root',
      runInteractive: runner,
      readCloudAuth: async () => null,
    });
    const connect = await cliMain({ argv: ['connect', 'cloud', '--quiet'], runInteractive: runner, ensureCloudAuthenticated });

    expect(status.exitCode).toBe(0);
    expect(JSON.parse(status.output.join('\n'))).toMatchObject({
      mode: 'local',
      local: { repo: '/repo-root' },
      nextActions: expect.arrayContaining(['ricky connect cloud']),
    });
    expect(connect.exitCode).toBe(0);
    expect(connect.output).toEqual(['Ricky connect cloud: connected.']);
    expect(runner).not.toHaveBeenCalled();
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

  describe('regression: issues #1 and #2 — cliMain invocation root for all handoff types', () => {
    it('cliMain with inline spec resolves invocationRoot from cwd and passes it through to the interactive runner', async () => {
      const runner = vi.fn().mockResolvedValue(fakeInteractiveResult());

      await cliMain({
        argv: ['--mode', 'local', '--spec', 'test invocation root inline'],
        cwd: '/inline-repo-root',
        runInteractive: runner,
      });

      const deps = runner.mock.calls[0][0];
      expect(deps.cwd).toBe('/inline-repo-root');
      expect(deps.handoff.invocationRoot).toBe('/inline-repo-root');
      expect(deps.handoff.source).toBe('cli');
      expect(deps.handoff.cliMetadata).toEqual({ handoff: 'inline-spec' });
    });

    it('cliMain with spec-file resolves the file path against invocationRoot and passes both through', async () => {
      const runner = vi.fn().mockResolvedValue(fakeInteractiveResult());
      const readFileText = vi.fn().mockResolvedValue('spec from file content');

      await cliMain({
        argv: ['--mode', 'local', '--spec-file', './specs/my-workflow.md'],
        cwd: '/specfile-repo-root',
        runInteractive: runner,
        readFileText,
      });

      // readFileText is called with the spec-file resolved against the invocationRoot
      expect(readFileText).toHaveBeenCalledWith('/specfile-repo-root/specs/my-workflow.md');

      const deps = runner.mock.calls[0][0];
      expect(deps.cwd).toBe('/specfile-repo-root');
      expect(deps.handoff.invocationRoot).toBe('/specfile-repo-root');
      expect(deps.handoff.spec).toBe('spec from file content');
      expect(deps.handoff.specFile).toBe('/specfile-repo-root/specs/my-workflow.md');
      expect(deps.handoff.cliMetadata).toEqual({ handoff: 'spec-file' });
    });

    it('cliMain with stdin passes invocationRoot from cwd through to the interactive runner', async () => {
      const { Readable } = await import('node:stream');
      const input = Readable.from(['stdin workflow spec']);
      const runner = vi.fn().mockResolvedValue(fakeInteractiveResult());

      await cliMain({
        argv: ['--mode', 'local', '--stdin'],
        cwd: '/stdin-repo-root',
        runInteractive: runner,
        input,
      });

      const deps = runner.mock.calls[0][0];
      expect(deps.cwd).toBe('/stdin-repo-root');
      expect(deps.handoff.invocationRoot).toBe('/stdin-repo-root');
      expect(deps.handoff.spec).toBe('stdin workflow spec');
      expect(deps.handoff.cliMetadata).toEqual({ handoff: 'stdin' });
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
          argv: ['--mode', 'local', '--spec', 'generate a workflow for test coverage', '--no-workforce-persona'],
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
          a.includes('ricky run --artifact'),
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
          argv: ['--mode', 'local', '--spec-file', './workflow-spec.md', '--no-workforce-persona'],
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
          a.includes('ricky run --artifact'),
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
          argv: ['--mode', 'local', '--stdin', '--no-workforce-persona'],
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
          a.includes('ricky run --artifact'),
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
