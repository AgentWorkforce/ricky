import { describe, expect, it, vi } from 'vitest';

import type { OnboardingResult } from '../cli/onboarding.js';
import type { CloudGenerateRequest } from '@ricky/cloud/api/request-types';
import type { LocalResponse } from '@ricky/local/entrypoint';
import { BlockerClass } from '@ricky/runtime/diagnostics/failure-diagnosis';
import { runInteractiveCli } from './interactive-cli.js';

function onboarding(mode: OnboardingResult['mode']): OnboardingResult {
  return {
    mode,
    firstRun: false,
    bannerShown: false,
    output: `mode=${mode}`,
  };
}

function cloudRequest(): CloudGenerateRequest {
  return {
    auth: {
      token: 'token-123',
    },
    workspace: {
      workspaceId: 'workspace-1',
    },
    body: {
      spec: 'Build a workflow',
      mode: 'cloud',
    },
  };
}

describe('runInteractiveCli', () => {
  it('routes local mode to the local entrypoint and succeeds', async () => {
    const localResponse: LocalResponse = {
      ok: true,
      artifacts: [{ path: 'out/workflow.ts', type: 'text/typescript' }],
      logs: ['[local] ok'],
      warnings: [],
      nextActions: ['Review workflow'],
    };

    const result = await runInteractiveCli({
      onboard: vi.fn().mockResolvedValue(onboarding('local')),
      handoff: { source: 'cli', spec: 'Build a workflow', mode: 'local' },
      localExecutor: {
        execute: vi.fn().mockResolvedValue(localResponse),
      },
    });

    expect(result.ok).toBe(true);
    expect(result.mode).toBe('local');
    expect(result.localResult).toEqual(localResponse);
    expect(result.cloudResult).toBeUndefined();
    expect(result.diagnoses).toEqual([]);
    expect(result.guidance).toEqual([]);
    expect(result.awaitingInput).toBe(false);
  });

  it('passes deps.cwd as invocationRoot to an injected local executor when the handoff omits it', async () => {
    const localResponse: LocalResponse = {
      ok: true,
      artifacts: [{ path: 'workflows/generated/from-injected-executor.ts', type: 'text/typescript' }],
      logs: [],
      warnings: [],
      nextActions: [],
    };
    const execute = vi.fn().mockResolvedValue(localResponse);

    const result = await runInteractiveCli({
      onboard: vi.fn().mockResolvedValue(onboarding('local')),
      cwd: '/caller-repo',
      handoff: { source: 'cli', spec: 'Build a workflow', mode: 'local' },
      localExecutor: { execute },
    });

    expect(result.ok).toBe(true);
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'cli',
        spec: 'Build a workflow',
        invocationRoot: '/caller-repo',
      }),
    );
  });

  it('uses INIT_CWD for the default local executor so generated workflows land in the caller repo', async () => {
    const { mkdtemp, rm, access } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const tempRepo = await mkdtemp(join(tmpdir(), 'ricky-user-repo-'));
    const originalInitCwd = process.env.INIT_CWD;

    process.env.INIT_CWD = tempRepo;

    try {
      const result = await runInteractiveCli({
        onboard: vi.fn().mockResolvedValue(onboarding('local')),
        handoff: { source: 'cli', spec: 'generate a workflow for package checks', mode: 'local' },
      });

      expect(result.ok).toBe(true);
      expect(result.localResult?.artifacts[0].path).toBe('workflows/generated/ricky-generate-a-workflow-for-package-checks.ts');
      expect(result.localResult?.logs).toEqual(
        expect.arrayContaining([
          '[local] wrote workflow artifact: workflows/generated/ricky-generate-a-workflow-for-package-checks.ts',
        ]),
      );
      expect(result.localResult?.nextActions).toContain(
        'Run the generated workflow locally: npx --no-install agent-relay run workflows/generated/ricky-generate-a-workflow-for-package-checks.ts',
      );
      await expect(access(join(tempRepo, 'workflows/generated/ricky-generate-a-workflow-for-package-checks.ts'))).resolves.toBeUndefined();
    } finally {
      if (originalInitCwd === undefined) {
        delete process.env.INIT_CWD;
      } else {
        process.env.INIT_CWD = originalInitCwd;
      }
      await rm(tempRepo, { recursive: true, force: true });
    }
  });

  it('returns a user-facing response for a structured local CLI spec without Cloud credentials', async () => {
    const { mkdtemp, rm, access } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const tempRepo = await mkdtemp(join(tmpdir(), 'ricky-structured-cli-spec-'));

    try {
      const result = await runInteractiveCli({
        onboard: vi.fn().mockResolvedValue(onboarding('local')),
        cwd: tempRepo,
        handoff: {
          source: 'cli',
          requestId: 'req-structured-cli-spec',
          spec: {
            description:
              'generate a local workflow for packages/local/src/proof/local-entrypoint-proof.ts with deterministic validation evidence',
            targetFiles: ['packages/local/src/proof/local-entrypoint-proof.ts'],
            acceptanceGates: ['npx vitest run packages/local/src/proof/local-entrypoint-proof.test.ts'],
          },
          cliMetadata: { argv: ['ricky', 'run', '--mode', 'local', '--spec'] },
        },
      });

      const artifact = result.localResult?.artifacts[0];

      expect(result.ok).toBe(true);
      expect(result.mode).toBe('local');
      expect(result.cloudResult).toBeUndefined();
      expect(result.guidance).toEqual([]);
      expect(artifact).toMatchObject({
        path: expect.stringMatching(/^workflows\/generated\/.+\.ts$/),
        type: 'text/typescript',
      });
      expect(artifact?.content).toContain('workflow(');
      expect(result.localResult?.logs).toEqual(
        expect.arrayContaining([
          '[local] received spec from cli',
          '[local] spec intake route: generate',
          '[local] workflow generation: passed',
          '[local] runtime launch skipped: returning generated artifact only',
        ]),
      );
      expect(result.localResult?.nextActions[0]).toMatch(/^Run the generated workflow locally:/);
      expect(result.localResult?.warnings.some((warning) => warning.includes('Cloud API surface'))).toBe(false);
      await expect(access(join(tempRepo, artifact!.path))).resolves.toBeUndefined();
    } finally {
      await rm(tempRepo, { recursive: true, force: true });
    }
  });

  it('prefers the explicit handoff invocation root when creating the default local executor', async () => {
    const { mkdtemp, rm, access } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const tempRepo = await mkdtemp(join(tmpdir(), 'ricky-handoff-root-'));

    try {
      const result = await runInteractiveCli({
        onboard: vi.fn().mockResolvedValue(onboarding('local')),
        handoff: {
          source: 'cli',
          spec: 'generate a workflow for package checks',
          mode: 'local',
          invocationRoot: tempRepo,
        },
      });

      const artifactPath = 'workflows/generated/ricky-generate-a-workflow-for-package-checks.ts';
      expect(result.ok).toBe(true);
      expect(result.localResult?.artifacts[0].path).toBe(artifactPath);
      expect(result.localResult?.nextActions).toContain(
        `Run the generated workflow locally: npx --no-install agent-relay run ${artifactPath}`,
      );
      await expect(access(join(tempRepo, artifactPath))).resolves.toBeUndefined();
    } finally {
      await rm(tempRepo, { recursive: true, force: true });
    }
  });

  it('resolves an existing handoff invocationRoot before passing it to an injected local executor', async () => {
    const { isAbsolute } = await import('node:path');
    const localResponse: LocalResponse = {
      ok: true,
      artifacts: [{ path: 'workflows/generated/from-relative-root.ts', type: 'text/typescript' }],
      logs: [],
      warnings: [],
      nextActions: [],
    };
    const execute = vi.fn().mockResolvedValue(localResponse);

    const result = await runInteractiveCli({
      onboard: vi.fn().mockResolvedValue(onboarding('local')),
      handoff: {
        source: 'cli',
        spec: 'Build a workflow',
        mode: 'local',
        invocationRoot: './relative-caller-repo',
      },
      localExecutor: { execute },
    });

    expect(result.ok).toBe(true);
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        invocationRoot: expect.stringMatching(/relative-caller-repo$/),
      }),
    );
    expect(execute.mock.calls[0][0].invocationRoot).not.toBe('./relative-caller-repo');
    expect(isAbsolute(execute.mock.calls[0][0].invocationRoot!)).toBe(true);
  });

  it('stops cleanly after onboarding when no handoff was provided', async () => {
    const localExecutor = { execute: vi.fn() };

    const result = await runInteractiveCli({
      onboard: vi.fn().mockResolvedValue(onboarding('local')),
      localExecutor,
    });

    expect(result.ok).toBe(true);
    expect(result.awaitingInput).toBe(true);
    expect(result.localResult).toBeUndefined();
    expect(result.guidance.join('\n')).toMatch(/No spec provided/i);
    expect(result.guidance.join('\n')).toMatch(/ricky --mode local --spec/i);
    expect(result.guidance.join('\n')).toMatch(/--spec-file/i);
    expect(result.guidance.join('\n')).toMatch(/--stdin/i);
    expect(localExecutor.execute).not.toHaveBeenCalled();
  });

  it('surfaces runtime diagnosis guidance when local execution fails', async () => {
    const result = await runInteractiveCli({
      onboard: vi.fn().mockResolvedValue(onboarding('local')),
      handoff: { source: 'cli', spec: 'Broken workflow', mode: 'local' },
      localExecutor: {
        execute: vi.fn().mockResolvedValue({
          ok: false,
          artifacts: [],
          logs: ['handoff stalled waiting for ack'],
          warnings: ['no progress reported in 30s'],
          nextActions: ['Retry'],
        }),
      },
    });

    expect(result.ok).toBe(false);
    expect(result.localResult?.ok).toBe(false);
    expect(result.diagnoses.length).toBeGreaterThan(0);
    expect(result.diagnoses.map((d) => d.blockerClass)).toContain(
      BlockerClass.RuntimeHandoffStall,
    );
    expect(result.guidance.join('\n')).toMatch(/Runtime handoff stall|Opaque progress/i);
  });

  it('falls back to generic recovery guidance when no diagnosis matches', async () => {
    const result = await runInteractiveCli({
      onboard: vi.fn().mockResolvedValue(onboarding('local')),
      handoff: { source: 'cli', spec: 'Broken workflow', mode: 'local' },
      localExecutor: {
        execute: vi.fn().mockResolvedValue({
          ok: false,
          artifacts: [],
          logs: ['something odd happened'],
          warnings: ['totally unknown error'],
          nextActions: ['Retry'],
        }),
      },
      diagnoseFn: vi.fn().mockReturnValue(null),
    });

    expect(result.ok).toBe(false);
    expect(result.diagnoses).toEqual([]);
    expect(result.guidance.join('\n')).toMatch(/Recovery:/);
  });

  it('routes cloud mode to Cloud generate and succeeds', async () => {
    const result = await runInteractiveCli({
      onboard: vi.fn().mockResolvedValue(onboarding('cloud')),
      cloudRequest: cloudRequest(),
      cloudExecutor: {
        generate: vi.fn().mockResolvedValue({
          artifacts: [{ path: 'cloud/workflow.ts', type: 'text/typescript' }],
          warnings: [],
          followUpActions: [{
            action: 'deploy',
            label: 'Deploy',
            description: 'Deploy workflow',
          }],
        }),
      },
    });

    expect(result.ok).toBe(true);
    expect(result.mode).toBe('cloud');
    expect(result.localResult).toBeUndefined();
    expect(result.cloudResult?.artifacts).toHaveLength(1);
    expect(result.guidance).toEqual([]);
  });

  it('surfaces bounded guidance when cloud request context is missing', async () => {
    const result = await runInteractiveCli({
      onboard: vi.fn().mockResolvedValue(onboarding('cloud')),
    });

    expect(result.ok).toBe(false);
    expect(result.cloudResult).toBeUndefined();
    expect(result.guidance.join('\n')).toMatch(/Cloud mode selected but no Cloud request context was provided/i);
  });

  it('surfaces workflow generation recovery on cloud executor failure response', async () => {
    const result = await runInteractiveCli({
      onboard: vi.fn().mockResolvedValue(onboarding('cloud')),
      cloudRequest: cloudRequest(),
      cloudExecutor: {
        generate: vi.fn().mockRejectedValue(new Error('provider offline')),
      },
    });

    expect(result.ok).toBe(false);
    expect(result.guidance.join('\n')).toMatch(/Generation failed/i);
    expect(result.guidance.join('\n')).toMatch(/provider offline/i);
  });

  it('in both mode, runs cloud after a successful local pass when cloud context exists', async () => {
    const result = await runInteractiveCli({
      onboard: vi.fn().mockResolvedValue(onboarding('both')),
      handoff: { source: 'cli', spec: 'Build workflow', mode: 'both' },
      cloudRequest: {
        ...cloudRequest(),
        body: { spec: 'Build workflow', mode: 'both' },
      },
      localExecutor: {
        execute: vi.fn().mockResolvedValue({
          ok: true,
          artifacts: [{ path: 'local/workflow.ts', type: 'text/typescript' }],
          logs: ['ok'],
          warnings: [],
          nextActions: ['Promote to cloud'],
        }),
      },
      cloudExecutor: {
        generate: vi.fn().mockResolvedValue({
          artifacts: [{ path: 'cloud/workflow.ts', type: 'text/typescript' }],
          warnings: [],
          followUpActions: [],
        }),
      },
    });

    expect(result.ok).toBe(true);
    expect(result.mode).toBe('both');
    expect(result.localResult?.ok).toBe(true);
    expect(result.cloudResult?.artifacts).toHaveLength(1);
  });

  it('surfaces bounded recovery when cloud executor returns ok:false response', async () => {
    const result = await runInteractiveCli({
      onboard: vi.fn().mockResolvedValue(onboarding('cloud')),
      cloudRequest: cloudRequest(),
      cloudExecutor: {
        generate: vi.fn().mockResolvedValue({
          artifacts: [],
          warnings: [{ severity: 'error', message: 'quota exceeded' }],
          followUpActions: [{ action: 'upgrade', label: 'Upgrade', description: 'Upgrade plan' }],
          validation: { ok: false, status: 'failed', issues: [{ code: 'quota', message: 'exceeded', path: 'body' }] },
        }),
      },
    });

    expect(result.ok).toBe(false);
    expect(result.cloudResult).toBeDefined();
    expect(result.cloudResult?.warnings).toHaveLength(1);
    expect(result.guidance.join('\n')).toMatch(/Generation failed/i);
    expect(result.guidance.join('\n')).toMatch(/quota exceeded/i);
  });

  it('maps explore onboarding choice to local mode', async () => {
    const result = await runInteractiveCli({
      onboard: vi.fn().mockResolvedValue(onboarding('explore')),
    });

    expect(result.mode).toBe('local');
    expect(result.ok).toBe(true);
    expect(result.awaitingInput).toBe(true);
  });

  it('uses injected diagnoseFn when it returns a match', async () => {
    const customDiagnosis = {
      blockerClass: BlockerClass.StaleRelayState,
      label: 'Stale relay state',
      unblocker: {
        action: 'Invalidate relay cache',
        rationale: 'Relay is stale',
        automatable: true,
      },
    };

    const result = await runInteractiveCli({
      onboard: vi.fn().mockResolvedValue(onboarding('local')),
      handoff: { source: 'cli', spec: 'Stale workflow', mode: 'local' },
      localExecutor: {
        execute: vi.fn().mockResolvedValue({
          ok: false,
          artifacts: [],
          logs: ['relay stale detected'],
          warnings: ['relay outdated'],
          nextActions: ['Retry'],
        }),
      },
      diagnoseFn: vi.fn().mockReturnValue(customDiagnosis),
    });

    expect(result.ok).toBe(false);
    expect(result.diagnoses).toContainEqual(customDiagnosis);
    expect(result.guidance.join('\n')).toMatch(/Stale relay state/);
    expect(result.guidance.join('\n')).toMatch(/Invalidate relay cache/);
  });

  it('passes classified local execution blockers and evidence into interactive diagnosis guidance', async () => {
    const customDiagnosis = {
      blockerClass: BlockerClass.RuntimeHandoffStall,
      label: 'Local runtime dependency missing',
      unblocker: {
        action: 'Install agent-relay and rerun the generated artifact command',
        rationale: 'The local execution stage returned a MISSING_BINARY blocker with runtime stderr evidence.',
        automatable: false,
      },
    };
    const diagnoseFn = vi.fn().mockImplementation((signal) => (
      signal.source === 'local-blocker' ? customDiagnosis : null
    ));

    const result = await runInteractiveCli({
      onboard: vi.fn().mockResolvedValue(onboarding('local')),
      handoff: { source: 'cli', spec: 'Build workflow', mode: 'local', stageMode: 'run' },
      localExecutor: {
        execute: vi.fn().mockResolvedValue({
          ok: false,
          artifacts: [{ path: 'workflows/generated/issue-3.ts', type: 'text/typescript' }],
          logs: [],
          warnings: [],
          nextActions: ['npm install', 'npx --no-install agent-relay run workflows/generated/issue-3.ts'],
          exitCode: 2,
          generation: {
            stage: 'generate',
            status: 'ok',
            artifact: {
              path: 'workflows/generated/issue-3.ts',
              workflow_id: 'wf-issue-3',
              spec_digest: 'digest-issue-3',
            },
            next: {
              run_command: 'npx --no-install agent-relay run workflows/generated/issue-3.ts',
              run_mode_hint: 'ricky run --artifact workflows/generated/issue-3.ts',
            },
          },
          execution: {
            stage: 'execute',
            status: 'blocker',
            execution: {
              workflow_id: 'wf-issue-3',
              artifact_path: 'workflows/generated/issue-3.ts',
              command: 'npx --no-install agent-relay run workflows/generated/issue-3.ts',
              workflow_file: 'workflows/generated/issue-3.ts',
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
              message: 'Runtime dependency is unavailable: agent-relay: command not found.',
              detected_at: '2026-01-01T00:00:00.000Z',
              detected_during: 'launch',
              recovery: {
                actionable: true,
                steps: ['npm install', 'npx --no-install agent-relay run workflows/generated/issue-3.ts'],
              },
              context: {
                missing: ['agent-relay'],
                found: ['cwd=/repo'],
              },
            },
            evidence: {
              outcome_summary: 'Workflow blocked during local runtime execution.',
              failed_step: { id: 'runtime-launch', name: 'Local runtime execution' },
              exit_code: 127,
              logs: {
                tail: ['agent-relay: command not found'],
                truncated: false,
              },
              side_effects: {
                files_written: ['workflows/generated/issue-3.ts'],
                commands_invoked: ['npx --no-install agent-relay run workflows/generated/issue-3.ts'],
              },
              assertions: [
                {
                  name: 'runtime_exit_code',
                  status: 'fail',
                  detail: 'Runtime exit code: 127.',
                },
              ],
            },
          },
        } satisfies LocalResponse),
      },
      diagnoseFn,
    });

    expect(result.ok).toBe(false);
    expect(result.diagnoses).toEqual([customDiagnosis]);
    expect(result.guidance.join('\n')).toContain('[Local runtime dependency missing]');
    expect(result.guidance.join('\n')).toContain(
      'Install agent-relay and rerun the generated artifact command',
    );
    expect(result.guidance.join('\n')).not.toContain('Recovery:');
    expect(diagnoseFn).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'local-blocker',
        message: 'Runtime dependency is unavailable: agent-relay: command not found.',
        meta: {
          code: 'MISSING_BINARY',
          category: 'dependency',
          detectedDuring: 'launch',
        },
      }),
    );
    expect(diagnoseFn).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'local-evidence',
        message: 'Workflow blocked during local runtime execution.',
      }),
    );
    expect(diagnoseFn).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'local-runtime-tail',
        message: 'agent-relay: command not found',
      }),
    );
  });

  it('in both mode, skips cloud when local execution fails', async () => {
    const cloudExecutor = { generate: vi.fn() };

    const result = await runInteractiveCli({
      onboard: vi.fn().mockResolvedValue(onboarding('both')),
      handoff: { source: 'cli', spec: 'Failing workflow', mode: 'both' },
      cloudRequest: cloudRequest(),
      localExecutor: {
        execute: vi.fn().mockResolvedValue({
          ok: false,
          artifacts: [],
          logs: ['something broke'],
          warnings: ['local failure'],
          nextActions: ['Fix and retry'],
        }),
      },
      cloudExecutor,
      diagnoseFn: vi.fn().mockReturnValue(null),
    });

    expect(result.ok).toBe(false);
    expect(result.mode).toBe('both');
    expect(result.localResult?.ok).toBe(false);
    expect(result.cloudResult).toBeUndefined();
    expect(cloudExecutor.generate).not.toHaveBeenCalled();
  });

  it('propagates onboarding failure as a rejected promise', async () => {
    await expect(
      runInteractiveCli({
        onboard: vi.fn().mockRejectedValue(new Error('TTY not available')),
      }),
    ).rejects.toThrow('TTY not available');
  });

  it('passes mode override through to onboarding', async () => {
    const onboardFn = vi.fn().mockResolvedValue(onboarding('cloud'));

    await runInteractiveCli({
      onboard: onboardFn,
      mode: 'cloud',
      cloudRequest: cloudRequest(),
      cloudExecutor: {
        generate: vi.fn().mockResolvedValue({
          artifacts: [],
          warnings: [],
          followUpActions: [],
        }),
      },
    });

    expect(onboardFn).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'cloud' }),
    );
  });

  // -------------------------------------------------------------------------
  // Journey proof coverage — default, local, setup, welcome, status, generate
  // -------------------------------------------------------------------------

  describe('journey proof coverage', () => {
    it('default journey: no handoff → awaitingInput with recovery guidance', async () => {
      const result = await runInteractiveCli({
        onboard: vi.fn().mockResolvedValue(onboarding('local')),
      });

      expect(result.ok).toBe(true);
      expect(result.awaitingInput).toBe(true);
      expect(result.localResult).toBeUndefined();
      expect(result.mode).toBe('local');
      expect(result.guidance.join('\n')).toContain('--spec');
      expect(result.guidance.join('\n')).toContain('--spec-file');
      expect(result.guidance.join('\n')).toContain('--stdin');
    });

    it('local journey: inline spec handoff → successful execution with artifacts', async () => {
      const localResponse: LocalResponse = {
        ok: true,
        artifacts: [{ path: 'workflows/my-workflow.ts', type: 'text/typescript' }],
        logs: ['[local] workflow generated'],
        warnings: [],
        nextActions: ['Run the workflow locally'],
      };

      const result = await runInteractiveCli({
        onboard: vi.fn().mockResolvedValue(onboarding('local')),
        handoff: { source: 'cli', spec: 'build a CI workflow', mode: 'local' },
        localExecutor: { execute: vi.fn().mockResolvedValue(localResponse) },
      });

      expect(result.ok).toBe(true);
      expect(result.awaitingInput).toBe(false);
      expect(result.localResult?.ok).toBe(true);
      expect(result.localResult?.artifacts).toHaveLength(1);
      expect(result.guidance).toEqual([]);
    });

    it('setup journey: first-run onboarding is invoked with correct parameters', async () => {
      const onboardFn = vi.fn().mockResolvedValue(onboarding('local'));

      await runInteractiveCli({
        onboard: onboardFn,
        mode: 'local',
        handoff: { source: 'cli', spec: 'test', mode: 'local' },
        localExecutor: {
          execute: vi.fn().mockResolvedValue({
            ok: true, artifacts: [], logs: [], warnings: [], nextActions: [],
          }),
        },
      });

      expect(onboardFn).toHaveBeenCalledWith(
        expect.objectContaining({
          mode: 'local',
          compactForExecution: true,
          skipFirstRunPersistence: true,
        }),
      );
    });

    it('welcome journey: onboarding result carries firstRun and bannerShown state', async () => {
      const firstRunResult = await runInteractiveCli({
        onboard: vi.fn().mockResolvedValue({
          mode: 'local',
          firstRun: true,
          bannerShown: true,
          output: 'Welcome to Ricky',
        }),
      });

      const returningResult = await runInteractiveCli({
        onboard: vi.fn().mockResolvedValue({
          mode: 'local',
          firstRun: false,
          bannerShown: false,
          output: 'Ricky is ready',
        }),
      });

      expect(firstRunResult.onboarding.firstRun).toBe(true);
      expect(firstRunResult.onboarding.bannerShown).toBe(true);
      expect(returningResult.onboarding.firstRun).toBe(false);
      expect(returningResult.onboarding.bannerShown).toBe(false);
    });

    it('status journey: mode is correctly resolved from onboarding choice', async () => {
      const localResult = await runInteractiveCli({
        onboard: vi.fn().mockResolvedValue(onboarding('local')),
      });
      const cloudResult = await runInteractiveCli({
        onboard: vi.fn().mockResolvedValue(onboarding('cloud')),
        cloudRequest: cloudRequest(),
        cloudExecutor: {
          generate: vi.fn().mockResolvedValue({
            artifacts: [], warnings: [], followUpActions: [],
          }),
        },
      });
      const bothResult = await runInteractiveCli({
        onboard: vi.fn().mockResolvedValue(onboarding('both')),
      });
      const exploreResult = await runInteractiveCli({
        onboard: vi.fn().mockResolvedValue(onboarding('explore')),
      });

      expect(localResult.mode).toBe('local');
      expect(cloudResult.mode).toBe('cloud');
      expect(bothResult.mode).toBe('both');
      expect(exploreResult.mode).toBe('local'); // explore maps to local
    });

    it('generate journey: spec handoff creates a generated workflow artifact', async () => {
      const result = await runInteractiveCli({
        onboard: vi.fn().mockResolvedValue(onboarding('local')),
        handoff: {
          source: 'cli',
          spec: 'generate a workflow for package checks',
          mode: 'local',
          cliMetadata: { handoff: 'inline-spec' },
        },
        localExecutor: {
          execute: vi.fn().mockResolvedValue({
            ok: true,
            artifacts: [{ path: 'workflows/generated/package-checks.ts', type: 'text/typescript' }],
            logs: ['[local] workflow generation: passed'],
            warnings: [],
            nextActions: [
              'Run the generated workflow locally',
              'Inspect the generated workflow artifact',
            ],
          }),
        },
      });

      expect(result.ok).toBe(true);
      expect(result.awaitingInput).toBe(false);
      expect(result.localResult?.artifacts[0].path).toContain('package-checks');
      expect(result.localResult?.nextActions).toHaveLength(2);
      expect(result.diagnoses).toEqual([]);
      expect(result.guidance).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // Fixture proof coverage — inline spec, spec-file, stdin, missing spec
  // -------------------------------------------------------------------------

  describe('fixture proof coverage', () => {
    it('fixture: inline spec handoff metadata is correct', async () => {
      const executor = vi.fn().mockResolvedValue({
        ok: true, artifacts: [], logs: [], warnings: [], nextActions: [],
      });

      await runInteractiveCli({
        onboard: vi.fn().mockResolvedValue(onboarding('local')),
        handoff: {
          source: 'cli',
          spec: 'inline spec text',
          mode: 'local',
          cliMetadata: { handoff: 'inline-spec' },
        },
        localExecutor: { execute: executor },
      });

      expect(executor).toHaveBeenCalledWith(
        expect.objectContaining({
          source: 'cli',
          spec: 'inline spec text',
          mode: 'local',
        }),
      );
    });

    it('fixture: spec-file handoff metadata is correct', async () => {
      const executor = vi.fn().mockResolvedValue({
        ok: true, artifacts: [], logs: [], warnings: [], nextActions: [],
      });

      await runInteractiveCli({
        onboard: vi.fn().mockResolvedValue(onboarding('local')),
        handoff: {
          source: 'cli',
          spec: 'file spec content',
          specFile: './spec.md',
          mode: 'local',
          cliMetadata: { handoff: 'spec-file' },
        },
        localExecutor: { execute: executor },
      });

      expect(executor).toHaveBeenCalledWith(
        expect.objectContaining({
          source: 'cli',
          spec: 'file spec content',
          specPath: './spec.md',
          sourceMetadata: {
            cli: {
              handoff: 'spec-file',
              specFile: './spec.md',
            },
          },
        }),
      );
    });

    it('fixture: stdin handoff metadata is correct', async () => {
      const executor = vi.fn().mockResolvedValue({
        ok: true, artifacts: [], logs: [], warnings: [], nextActions: [],
      });

      await runInteractiveCli({
        onboard: vi.fn().mockResolvedValue(onboarding('local')),
        handoff: {
          source: 'cli',
          spec: 'stdin piped content',
          mode: 'local',
          cliMetadata: { handoff: 'stdin' },
        },
        localExecutor: { execute: executor },
      });

      expect(executor).toHaveBeenCalledWith(
        expect.objectContaining({
          source: 'cli',
          spec: 'stdin piped content',
        }),
      );
    });

    it('fixture: missing spec produces awaiting-input with recovery guidance', async () => {
      const result = await runInteractiveCli({
        onboard: vi.fn().mockResolvedValue(onboarding('local')),
        // no handoff provided
      });

      expect(result.ok).toBe(true);
      expect(result.awaitingInput).toBe(true);
      expect(result.localResult).toBeUndefined();
      const guidance = result.guidance.join('\n');
      expect(guidance).toContain('No spec provided');
      expect(guidance).toContain('--spec');
      expect(guidance).toContain('--spec-file');
      expect(guidance).toContain('--stdin');
    });

    it('fixture: missing spec recovery names supported inputs without obsolete command forms', async () => {
      const result = await runInteractiveCli({
        onboard: vi.fn().mockResolvedValue(onboarding('local')),
      });
      const guidance = result.guidance.join('\n');

      expect(result.ok).toBe(true);
      expect(result.awaitingInput).toBe(true);
      expect(guidance).toContain('ricky --mode local --spec');
      expect(guidance).toContain('ricky --mode local --spec-file');
      expect(guidance).toContain('--stdin');
      expect(guidance).not.toContain('npx ricky generate');
      expect(guidance).not.toContain('spec-stdin');
    });

    it('fixture: local failure with diagnosis produces structured recovery', async () => {
      const result = await runInteractiveCli({
        onboard: vi.fn().mockResolvedValue(onboarding('local')),
        handoff: { source: 'cli', spec: 'broken spec', mode: 'local' },
        localExecutor: {
          execute: vi.fn().mockResolvedValue({
            ok: false,
            artifacts: [],
            logs: ['timeout waiting for agent'],
            warnings: ['handoff stalled waiting for ack'],
            nextActions: [],
          }),
        },
      });

      expect(result.ok).toBe(false);
      expect(result.diagnoses.length).toBeGreaterThan(0);
      expect(result.guidance.length).toBeGreaterThan(0);
      // No stack traces in guidance
      expect(result.guidance.join('\n')).not.toMatch(/\n\s+at /);
    });
  });

  // -------------------------------------------------------------------------
  // Regression proof coverage for issue #1 and #2
  // -------------------------------------------------------------------------

  describe('regression: default local executor writes into caller repo root', () => {
    it('writes artifact into deps.cwd when no explicit executor is provided', async () => {
      const { mkdtemp, rm, access, readFile } = await import('node:fs/promises');
      const { tmpdir } = await import('node:os');
      const { join } = await import('node:path');
      const tempRepo = await mkdtemp(join(tmpdir(), 'ricky-cwd-test-'));

      try {
        const result = await runInteractiveCli({
          onboard: vi.fn().mockResolvedValue(onboarding('local')),
          cwd: tempRepo,
          handoff: { source: 'cli', spec: 'generate a workflow for cwd test', mode: 'local' },
        });

        expect(result.ok).toBe(true);
        expect(result.localResult?.artifacts[0].path).toMatch(/^workflows\/generated\//);

        // Artifact physically exists at cwd-based path
        const artifactPath = result.localResult!.artifacts[0].path;
        await expect(access(join(tempRepo, artifactPath))).resolves.toBeUndefined();

        // Content was written
        const content = await readFile(join(tempRepo, artifactPath), 'utf8');
        expect(content).toContain('workflow(');

        // Next action uses the same relative path
        expect(result.localResult?.nextActions).toContain(
          `Run the generated workflow locally: npx --no-install agent-relay run ${artifactPath}`,
        );
      } finally {
        await rm(tempRepo, { recursive: true, force: true });
      }
    });

    it('writes artifact into handoff.invocationRoot when deps.cwd is not provided', async () => {
      const { mkdtemp, rm, access, readFile } = await import('node:fs/promises');
      const { tmpdir } = await import('node:os');
      const { join } = await import('node:path');
      const tempRepo = await mkdtemp(join(tmpdir(), 'ricky-invocationroot-test-'));

      try {
        const result = await runInteractiveCli({
          onboard: vi.fn().mockResolvedValue(onboarding('local')),
          handoff: {
            source: 'cli',
            spec: 'generate a workflow for invocationRoot test',
            mode: 'local',
            invocationRoot: tempRepo,
          },
        });

        expect(result.ok).toBe(true);
        expect(result.localResult?.artifacts[0].path).toMatch(/^workflows\/generated\//);

        // Artifact physically exists at invocationRoot-based path
        const artifactPath = result.localResult!.artifacts[0].path;
        await expect(access(join(tempRepo, artifactPath))).resolves.toBeUndefined();

        // Content was written
        const content = await readFile(join(tempRepo, artifactPath), 'utf8');
        expect(content).toContain('workflow(');

        // Next action uses the same relative path
        expect(result.localResult?.nextActions).toContain(
          `Run the generated workflow locally: npx --no-install agent-relay run ${artifactPath}`,
        );
      } finally {
        await rm(tempRepo, { recursive: true, force: true });
      }
    });

    it('prefers handoff.invocationRoot over deps.cwd for local artifact generation', async () => {
      const { mkdtemp, rm, access } = await import('node:fs/promises');
      const { tmpdir } = await import('node:os');
      const { join } = await import('node:path');
      const tempRepo = await mkdtemp(join(tmpdir(), 'ricky-invocationroot-wins-'));
      const tempPackageCwd = await mkdtemp(join(tmpdir(), 'ricky-package-cwd-'));

      try {
        const result = await runInteractiveCli({
          onboard: vi.fn().mockResolvedValue(onboarding('local')),
          cwd: tempPackageCwd,
          handoff: {
            source: 'cli',
            spec: 'generate a workflow for invocationRoot precedence test',
            mode: 'local',
            invocationRoot: tempRepo,
          },
        });

        expect(result.ok).toBe(true);
        const artifactPath = result.localResult!.artifacts[0].path;

        await expect(access(join(tempRepo, artifactPath))).resolves.toBeUndefined();
        await expect(access(join(tempPackageCwd, artifactPath))).rejects.toThrow();
        expect(result.localResult?.nextActions).toContain(
          `Run the generated workflow locally: npx --no-install agent-relay run ${artifactPath}`,
        );
      } finally {
        await rm(tempRepo, { recursive: true, force: true });
        await rm(tempPackageCwd, { recursive: true, force: true });
      }
    });

    it('no artifact appears in packages/cli/workflows/generated when using deterministic temp dir', async () => {
      const { mkdtemp, rm, access } = await import('node:fs/promises');
      const { tmpdir } = await import('node:os');
      const { join } = await import('node:path');
      const tempRepo = await mkdtemp(join(tmpdir(), 'ricky-no-cli-artifact-'));

      try {
        const result = await runInteractiveCli({
          onboard: vi.fn().mockResolvedValue(onboarding('local')),
          cwd: tempRepo,
          handoff: { source: 'cli', spec: 'generate a workflow for no-cli-artifact test', mode: 'local' },
        });

        expect(result.ok).toBe(true);
        const artifactPath = result.localResult!.artifacts[0].path;
        const artifactName = artifactPath.split('/').pop()!;

        // Artifact is in the temp repo
        await expect(access(join(tempRepo, artifactPath))).resolves.toBeUndefined();

        // Artifact is NOT in packages/cli/workflows/generated
        const cliWorkflowsPath = join(process.cwd(), 'packages/cli/workflows/generated');
        await expect(access(join(cliWorkflowsPath, artifactName))).rejects.toThrow();
      } finally {
        await rm(tempRepo, { recursive: true, force: true });
      }
    });

    it('default local executor from stdin handoff writes into caller repo root via cwd', async () => {
      const { mkdtemp, rm, access, readFile } = await import('node:fs/promises');
      const { tmpdir } = await import('node:os');
      const { join } = await import('node:path');
      const tempRepo = await mkdtemp(join(tmpdir(), 'ricky-stdin-default-executor-'));

      try {
        const result = await runInteractiveCli({
          onboard: vi.fn().mockResolvedValue(onboarding('local')),
          cwd: tempRepo,
          handoff: {
            source: 'cli',
            spec: 'generate a workflow for stdin default executor test',
            mode: 'local',
            cliMetadata: { handoff: 'stdin' },
          },
        });

        expect(result.ok).toBe(true);
        expect(result.localResult?.artifacts[0].path).toMatch(/^workflows\/generated\//);

        const artifactPath = result.localResult!.artifacts[0].path;
        await expect(access(join(tempRepo, artifactPath))).resolves.toBeUndefined();

        const content = await readFile(join(tempRepo, artifactPath), 'utf8');
        expect(content).toContain('workflow(');

        expect(result.localResult?.nextActions).toContain(
          `Run the generated workflow locally: npx --no-install agent-relay run ${artifactPath}`,
        );

        // Artifact is NOT in packages/cli/workflows/generated
        const artifactName = artifactPath.split('/').pop()!;
        const cliPath = join(process.cwd(), 'packages/cli/workflows/generated', artifactName);
        await expect(access(cliPath)).rejects.toThrow();
      } finally {
        await rm(tempRepo, { recursive: true, force: true });
      }
    });

    it('default local executor from spec-file handoff writes into caller repo root via cwd', async () => {
      const { mkdtemp, rm, access, readFile } = await import('node:fs/promises');
      const { tmpdir } = await import('node:os');
      const { join } = await import('node:path');
      const tempRepo = await mkdtemp(join(tmpdir(), 'ricky-specfile-default-executor-'));

      try {
        const result = await runInteractiveCli({
          onboard: vi.fn().mockResolvedValue(onboarding('local')),
          cwd: tempRepo,
          handoff: {
            source: 'cli',
            spec: 'generate a workflow for spec-file default executor test',
            specFile: './my-spec.md',
            mode: 'local',
            cliMetadata: { handoff: 'spec-file' },
          },
        });

        expect(result.ok).toBe(true);
        expect(result.localResult?.artifacts[0].path).toMatch(/^workflows\/generated\//);

        const artifactPath = result.localResult!.artifacts[0].path;
        await expect(access(join(tempRepo, artifactPath))).resolves.toBeUndefined();

        const content = await readFile(join(tempRepo, artifactPath), 'utf8');
        expect(content).toContain('workflow(');

        expect(result.localResult?.nextActions).toContain(
          `Run the generated workflow locally: npx --no-install agent-relay run ${artifactPath}`,
        );

        // Artifact is NOT in packages/cli/workflows/generated
        const artifactName = artifactPath.split('/').pop()!;
        const cliPath = join(process.cwd(), 'packages/cli/workflows/generated', artifactName);
        await expect(access(cliPath)).rejects.toThrow();
      } finally {
        await rm(tempRepo, { recursive: true, force: true });
      }
    });

    it('artifact path in output matches physical file and next action command', async () => {
      const { mkdtemp, rm, access } = await import('node:fs/promises');
      const { tmpdir } = await import('node:os');
      const { join } = await import('node:path');
      const tempRepo = await mkdtemp(join(tmpdir(), 'ricky-path-match-'));

      try {
        const result = await runInteractiveCli({
          onboard: vi.fn().mockResolvedValue(onboarding('local')),
          cwd: tempRepo,
          handoff: { source: 'cli', spec: 'generate a workflow for path match test', mode: 'local' },
        });

        expect(result.ok).toBe(true);

        const artifactPath = result.localResult!.artifacts[0].path;
        const physicalPath = join(tempRepo, artifactPath);
        const runCommand = `npx --no-install agent-relay run ${artifactPath}`;

        // All three point to the same location
        await expect(access(physicalPath)).resolves.toBeUndefined();
        expect(result.localResult?.nextActions).toContain(
          `Run the generated workflow locally: ${runCommand}`,
        );
        expect(result.localResult?.logs).toContain(
          `[local] wrote workflow artifact: ${artifactPath}`,
        );
      } finally {
        await rm(tempRepo, { recursive: true, force: true });
      }
    });
  });
});
