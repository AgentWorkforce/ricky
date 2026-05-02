import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';

import type { OnboardingResult } from '../cli/onboarding.js';
import type { CloudGenerateRequest } from '../../../cloud/api/request-types.js';
import type { CloudReadinessSnapshot } from '../flows/cloud-workflow-flow.js';
import type { LocalResponse } from '../../../local/entrypoint.js';
import { BlockerClass } from '../../../runtime/diagnostics/failure-diagnosis.js';
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

function readyCloudReadiness(overrides: Partial<CloudReadinessSnapshot> = {}): CloudReadinessSnapshot {
  return {
    account: { connected: true },
    credentials: { connected: true },
    workspace: { connected: true },
    agents: {
      claude: { connected: true, capable: true },
      codex: { connected: true, capable: true },
      opencode: { connected: true, capable: true },
      gemini: { connected: true, capable: true },
    },
    integrations: {
      slack: { connected: false },
      github: { connected: false },
      notion: { connected: false },
      linear: { connected: false },
    },
    ...overrides,
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
        'Run the generated workflow locally: ricky run workflows/generated/ricky-generate-a-workflow-for-package-checks.ts',
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
        `Run the generated workflow locally: ricky run ${artifactPath}`,
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

  it('runs the guided local hand-holding flow when prompt dependencies are provided without a handoff', async () => {
    const localResponse: LocalResponse = {
      ok: true,
      artifacts: [{ path: 'workflows/generated/guided.ts', type: 'text/typescript' }],
      logs: ['generated'],
      warnings: [],
      nextActions: ['Run later'],
      generation: {
        stage: 'generate',
        status: 'ok',
        artifact: {
          path: 'workflows/generated/guided.ts',
          workflow_id: 'wf-guided',
          spec_digest: 'digest-guided',
        },
        next: {
          run_command: 'ricky run workflows/generated/guided.ts',
          run_mode_hint: 'ricky run workflows/generated/guided.ts',
        },
      },
      exitCode: 0,
    };
    const execute = vi.fn().mockResolvedValue(localResponse);

    const result = await runInteractiveCli({
      onboard: vi.fn().mockResolvedValue(onboarding('local')),
      cwd: '/repo',
      localWorkflow: {
        localOptions: {
          executor: { execute },
        },
        prompts: {
          selectSpecSource: async () => 'editor',
          inputSpecFilePath: async () => 'SPEC.md',
          editSpec: async () => 'Generate a guided workflow.',
          inputWorkflowName: async () => 'Guided',
          inputGoal: async () => 'generate guided workflow',
          approveGeneratedSpec: async () => 'approve',
          inputWorkflowArtifactPath: async () => 'workflows/generated/guided.ts',
          confirmRun: async () => 'not-now',
        },
      },
    });

    expect(result.ok).toBe(true);
    expect(result.awaitingInput).toBe(false);
    expect(result.localWorkflowResult?.confirmation).toBe('not-now');
    expect(result.localWorkflowResult?.summary.artifactPath).toBe('workflows/generated/guided.ts');
    expect(result.localResult).toBe(localResponse);
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({
      source: 'cli',
      mode: 'local',
      stageMode: 'generate',
    }));
  });

  it('threads Workforce persona preference into guided local workflow generation', async () => {
    const execute = vi.fn().mockResolvedValue({
      ok: true,
      artifacts: [{ path: 'workflows/generated/guided.ts', type: 'text/typescript' }],
      logs: ['generated'],
      warnings: [],
      nextActions: ['Run later'],
      generation: {
        stage: 'generate',
        status: 'ok',
        artifact: {
          path: 'workflows/generated/guided.ts',
          workflow_id: 'wf-guided',
          spec_digest: 'digest-guided',
        },
        next: {
          run_command: 'ricky run workflows/generated/guided.ts',
          run_mode_hint: 'ricky run workflows/generated/guided.ts',
        },
      },
      exitCode: 0,
    });
    const result = await runInteractiveCli({
      onboard: vi.fn().mockResolvedValue(onboarding('local')),
      cwd: '/repo',
      preferWorkforcePersonaWorkflowWriter: true,
      localWorkflow: {
        prompts: {
          selectSpecSource: async () => 'editor',
          inputSpecFilePath: async () => 'SPEC.md',
          editSpec: async () => 'Generate a guided workflow.',
          inputWorkflowName: async () => 'Guided',
          inputGoal: async () => 'generate guided workflow',
          approveGeneratedSpec: async () => 'approve',
          inputWorkflowArtifactPath: async () => 'workflows/generated/guided.ts',
          confirmRun: async () => 'not-now',
        },
      },
      localExecutor: {
        execute,
      },
    });

    expect(result.localWorkflowResult?.generation?.ok).toBe(true);
    expect(result.localWorkflowResult?.generation?.logs).toContain('generated');
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({
      source: 'cli',
      stageMode: 'generate',
    }));
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

  it('keeps interactive Cloud selection useful when no spec/request context exists yet', async () => {
    const result = await runInteractiveCli({
      onboard: vi.fn().mockResolvedValue(onboarding('cloud')),
      checkCloudReadiness: vi.fn().mockResolvedValue(
        readyCloudReadiness({
          account: { connected: false },
          credentials: { connected: false },
          workspace: { connected: false },
          agents: {
            claude: { connected: false, capable: false },
            codex: { connected: false, capable: false },
            opencode: { connected: false, capable: false },
            gemini: { connected: false, capable: false },
          },
        }),
      ),
    });

    expect(result.ok).toBe(true);
    expect(result.awaitingInput).toBe(true);
    expect(result.cloudResult).toBeUndefined();
    expect(result.guidance.join('\n')).toContain('Cloud mode selected.');
    expect(result.guidance.join('\n')).toContain('Cloud needs a workflow spec');
    expect(result.guidance.join('\n')).toContain('Account:     missing');
    expect(result.guidance.join('\n')).toContain('Agents:      none connected');
    expect(result.guidance.join('\n')).toContain('Cloud account setup');
    expect(result.guidance.join('\n')).toContain('ricky connect cloud');
    expect(result.guidance.join('\n')).toContain('ricky cloud --spec-file ./spec.md --no-run');
    expect(result.guidance.join('\n')).toContain('No local fallback was attempted.');
  });

  it('continues Cloud selection into shared spec intake and Cloud generation when context is ready', async () => {
    const previousToken = process.env.AGENTWORKFORCE_CLOUD_TOKEN;
    const previousWorkspace = process.env.AGENTWORKFORCE_CLOUD_WORKSPACE;
    process.env.AGENTWORKFORCE_CLOUD_TOKEN = 'token-from-env';
    process.env.AGENTWORKFORCE_CLOUD_WORKSPACE = 'workspace-from-env';
    const generate = vi.fn().mockResolvedValue({
      artifacts: [{ path: 'cloud/generated/workflow.ts', type: 'text/typescript' }],
      warnings: [],
      followUpActions: [],
    });

    try {
      const result = await runInteractiveCli({
        onboard: vi.fn().mockResolvedValue(onboarding('cloud')),
        cwd: process.cwd(),
        checkCloudReadiness: vi.fn().mockResolvedValue(readyCloudReadiness()),
        confirmCloudRun: vi.fn().mockResolvedValue({ action: 'run-and-monitor' }),
        cloudExecutor: { generate },
        localWorkflow: {
          prompts: {
            selectSpecSource: async () => 'editor',
            inputSpecFilePath: async () => 'SPEC.md',
            editSpec: async () => 'Generate a Cloud workflow from the interactive menu.',
            inputWorkflowName: async () => 'interactive-cloud-workflow',
            inputGoal: async () => 'generate cloud workflow',
            approveGeneratedSpec: async () => 'approve',
            inputWorkflowArtifactPath: async () => 'workflows/generated/cloud.ts',
            confirmRun: async () => 'not-now',
          },
        },
      });

      expect(result.ok).toBe(true);
      expect(generate).toHaveBeenCalledWith(expect.objectContaining({
        auth: { token: 'token-from-env' },
        workspace: { workspaceId: 'workspace-from-env' },
        body: expect.objectContaining({
          spec: 'Generate a Cloud workflow from the interactive menu.',
          mode: 'cloud',
          metadata: expect.objectContaining({
            workflowName: 'interactive-cloud-workflow',
          }),
        }),
      }));
      expect(result.cloudResult?.artifacts[0]?.path).toBe('cloud/generated/workflow.ts');
    } finally {
      if (previousToken === undefined) delete process.env.AGENTWORKFORCE_CLOUD_TOKEN;
      else process.env.AGENTWORKFORCE_CLOUD_TOKEN = previousToken;
      if (previousWorkspace === undefined) delete process.env.AGENTWORKFORCE_CLOUD_WORKSPACE;
      else process.env.AGENTWORKFORCE_CLOUD_WORKSPACE = previousWorkspace;
    }
  });

  it('completes guided Cloud readiness recovery before reaching spec intake prompts', async () => {
    const previousToken = process.env.AGENTWORKFORCE_CLOUD_TOKEN;
    const previousWorkspace = process.env.AGENTWORKFORCE_CLOUD_WORKSPACE;
    delete process.env.AGENTWORKFORCE_CLOUD_TOKEN;
    delete process.env.AGENTWORKFORCE_CLOUD_WORKSPACE;

    const order: string[] = [];
    const state = {
      loggedIn: false,
      agentReady: false,
      githubReady: false,
    };
    const auth = {
      accessToken: 'token-after-recovery',
      refreshToken: 'refresh-token',
      accessTokenExpiresAt: new Date(Date.now() + 60_000).toISOString(),
      apiUrl: 'https://cloud.example.test',
    };
    const readiness = (): CloudReadinessSnapshot => readyCloudReadiness({
      account: { connected: state.loggedIn },
      credentials: { connected: state.loggedIn },
      workspace: { connected: state.loggedIn },
      agents: {
        claude: { connected: false, capable: false },
        codex: { connected: state.agentReady, capable: state.agentReady },
        opencode: { connected: false, capable: false },
        gemini: { connected: false, capable: false },
      },
      integrations: {
        slack: { connected: false },
        github: { connected: state.githubReady },
        notion: { connected: false },
        linear: { connected: false },
      },
    });
    const recoverCloudLogin = vi.fn().mockImplementation(async () => {
      order.push('recover-login');
      state.loggedIn = true;
    });
    const promptMissingCloudAgents = vi.fn().mockImplementation(async () => {
      order.push('prompt-agents');
      return { action: 'choose' as const, agents: ['codex' as const] };
    });
    const connectCloudAgents = vi.fn().mockImplementation(async () => {
      order.push('connect-agents');
      state.agentReady = true;
    });
    const selectOptionalCloudIntegrations = vi.fn().mockImplementation(async () => {
      order.push('select-integrations');
      return { action: 'connect' as const, integrations: ['github' as const] };
    });
    const connectCloudIntegrations = vi.fn().mockImplementation(async () => {
      order.push('connect-integrations');
      state.githubReady = true;
      return [{ integration: 'github' as const, status: 'link-created' as const, url: 'https://nango.example/github' }];
    });
    const generate = vi.fn().mockResolvedValue({
      artifacts: [{ path: 'cloud/generated/readiness-first.ts', type: 'text/typescript' }],
      warnings: [],
      followUpActions: [],
    });

    try {
      const result = await runInteractiveCli({
        onboard: vi.fn().mockResolvedValue(onboarding('cloud')),
        cwd: process.cwd(),
        readCloudAuth: vi.fn().mockImplementation(async () => state.loggedIn ? auth : null),
        resolveCloudWorkspace: vi.fn().mockImplementation(async () => state.loggedIn ? 'workspace-after-recovery' : undefined),
        checkCloudReadiness: vi.fn().mockImplementation(async () => readiness()),
        recoverCloudLogin,
        promptMissingCloudAgents,
        connectCloudAgents,
        selectOptionalCloudIntegrations,
        connectCloudIntegrations,
        confirmCloudRun: vi.fn().mockResolvedValue({ action: 'run-and-monitor' }),
        cloudExecutor: { generate },
        localWorkflow: {
          prompts: {
            selectSpecSource: async () => {
              order.push('spec-source');
              return 'editor';
            },
            inputSpecFilePath: async () => 'SPEC.md',
            editSpec: async () => {
              order.push('spec-edit');
              return 'Use GitHub context after readiness finishes.';
            },
            inputWorkflowName: async () => 'readiness-first',
            inputGoal: async () => 'generate cloud workflow',
            approveGeneratedSpec: async () => 'approve',
            inputWorkflowArtifactPath: async () => 'workflows/generated/cloud.ts',
            confirmRun: async () => 'not-now',
          },
        },
      });

      expect(result.ok).toBe(true);
      expect(order).toEqual(expect.arrayContaining([
        'recover-login',
        'prompt-agents',
        'connect-agents',
        'select-integrations',
        'connect-integrations',
        'spec-source',
        'spec-edit',
      ]));
      expect(order.indexOf('recover-login')).toBeLessThan(order.indexOf('spec-source'));
      expect(order.indexOf('connect-agents')).toBeLessThan(order.indexOf('spec-source'));
      expect(order.indexOf('connect-integrations')).toBeLessThan(order.indexOf('spec-source'));
      expect(selectOptionalCloudIntegrations).toHaveBeenCalledTimes(1);
      expect(connectCloudIntegrations).toHaveBeenCalledWith(['github']);
      expect(generate).toHaveBeenCalledWith(expect.objectContaining({
        auth: { token: 'token-after-recovery' },
        workspace: { workspaceId: 'workspace-after-recovery' },
      }));
    } finally {
      if (previousToken === undefined) delete process.env.AGENTWORKFORCE_CLOUD_TOKEN;
      else process.env.AGENTWORKFORCE_CLOUD_TOKEN = previousToken;
      if (previousWorkspace === undefined) delete process.env.AGENTWORKFORCE_CLOUD_WORKSPACE;
      else process.env.AGENTWORKFORCE_CLOUD_WORKSPACE = previousWorkspace;
    }
  });

  it('does not reach guided Cloud spec intake when login recovery remains incomplete', async () => {
    const selectSpecSource = vi.fn();

    const result = await runInteractiveCli({
      onboard: vi.fn().mockResolvedValue(onboarding('cloud')),
      readCloudAuth: vi.fn().mockResolvedValue(null),
      resolveCloudWorkspace: vi.fn().mockResolvedValue(undefined),
      checkCloudReadiness: vi.fn().mockResolvedValue(
        readyCloudReadiness({
          account: { connected: false },
          credentials: { connected: false },
          workspace: { connected: false },
        }),
      ),
      recoverCloudLogin: vi.fn().mockResolvedValue(undefined),
      localWorkflow: {
        prompts: {
          selectSpecSource,
          inputSpecFilePath: async () => 'SPEC.md',
          editSpec: async () => 'Should not be requested.',
          inputWorkflowName: async () => 'should-not-run',
          inputGoal: async () => 'should not run',
          approveGeneratedSpec: async () => 'approve',
          inputWorkflowArtifactPath: async () => 'workflows/generated/cloud.ts',
          confirmRun: async () => 'not-now',
        },
      },
    });

    expect(result.awaitingInput).toBe(true);
    expect(result.guidance.join('\n')).toContain('Cloud login is still incomplete after recovery');
    expect(result.guidance.join('\n')).toContain('Ricky did not ask for a workflow spec');
    expect(selectSpecSource).not.toHaveBeenCalled();
  });

  it('reconciles Cloud workspace from stored credentials instead of prompting for an id', async () => {
    const previousToken = process.env.AGENTWORKFORCE_CLOUD_TOKEN;
    const previousWorkspace = process.env.AGENTWORKFORCE_CLOUD_WORKSPACE;
    delete process.env.AGENTWORKFORCE_CLOUD_TOKEN;
    delete process.env.AGENTWORKFORCE_CLOUD_WORKSPACE;
    const auth = {
      accessToken: 'token-from-auth',
      refreshToken: 'refresh-token',
      accessTokenExpiresAt: new Date(Date.now() + 60_000).toISOString(),
      apiUrl: 'https://cloud.example.test',
    };
    const resolveCloudWorkspace = vi.fn().mockResolvedValue('workspace-from-profile');
    const generate = vi.fn().mockResolvedValue({
      artifacts: [{ path: 'cloud/generated/profile-workspace.ts', type: 'text/typescript' }],
      warnings: [],
      followUpActions: [],
    });

    try {
      const result = await runInteractiveCli({
        onboard: vi.fn().mockResolvedValue(onboarding('cloud')),
        cwd: process.cwd(),
        readCloudAuth: vi.fn().mockResolvedValue(auth),
        resolveCloudWorkspace,
        checkCloudReadiness: vi.fn().mockResolvedValue(readyCloudReadiness()),
        confirmCloudRun: vi.fn().mockResolvedValue({ action: 'run-and-monitor' }),
        cloudExecutor: { generate },
        localWorkflow: {
          prompts: {
            selectSpecSource: async () => 'editor',
            inputSpecFilePath: async () => 'SPEC.md',
            editSpec: async () => 'Generate a Cloud workflow with reconciled workspace.',
            inputWorkflowName: async () => 'profile-workspace',
            inputGoal: async () => 'generate cloud workflow',
            approveGeneratedSpec: async () => 'approve',
            inputWorkflowArtifactPath: async () => 'workflows/generated/cloud.ts',
            confirmRun: async () => 'not-now',
          },
        },
      });

      expect(result.ok).toBe(true);
      expect(resolveCloudWorkspace).toHaveBeenCalledWith(auth);
      expect(generate).toHaveBeenCalledWith(expect.objectContaining({
        auth: { token: 'token-from-auth' },
        workspace: { workspaceId: 'workspace-from-profile' },
      }));
    } finally {
      if (previousToken === undefined) delete process.env.AGENTWORKFORCE_CLOUD_TOKEN;
      else process.env.AGENTWORKFORCE_CLOUD_TOKEN = previousToken;
      if (previousWorkspace === undefined) delete process.env.AGENTWORKFORCE_CLOUD_WORKSPACE;
      else process.env.AGENTWORKFORCE_CLOUD_WORKSPACE = previousWorkspace;
    }
  });

  it('recovers missing Cloud login through the injected login mechanism and re-checks readiness', async () => {
    const snapshots = [
      readyCloudReadiness({
        account: { connected: false },
        credentials: { connected: false },
        workspace: { connected: true },
      }),
      readyCloudReadiness(),
    ];
    const checkCloudReadiness = vi.fn().mockImplementation(async () => snapshots.shift()!);
    const recoverCloudLogin = vi.fn().mockResolvedValue(undefined);
    const generate = vi.fn().mockResolvedValue({
      artifacts: [{ path: 'cloud/workflow.ts', type: 'text/typescript' }],
      warnings: [],
      followUpActions: [],
    });

    const result = await runInteractiveCli({
      onboard: vi.fn().mockResolvedValue(onboarding('cloud')),
      cloudRequest: cloudRequest(),
      checkCloudReadiness,
      recoverCloudLogin,
      cloudExecutor: { generate },
    });

    expect(result.ok).toBe(true);
    expect(recoverCloudLogin).toHaveBeenCalledWith(
      expect.objectContaining({ missing: ['account', 'credentials'] }),
    );
    expect(checkCloudReadiness).toHaveBeenCalledTimes(2);
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it('blocks Cloud mode when login remains missing after recovery without falling back locally', async () => {
    const recoverCloudLogin = vi.fn().mockResolvedValue(undefined);
    const localExecutor = { execute: vi.fn() };

    const result = await runInteractiveCli({
      onboard: vi.fn().mockResolvedValue(onboarding('cloud')),
      cloudRequest: cloudRequest(),
      localExecutor,
      checkCloudReadiness: vi.fn().mockResolvedValue(
        readyCloudReadiness({
          account: { connected: true },
          credentials: { connected: false },
          workspace: { connected: true },
        }),
      ),
      recoverCloudLogin,
      cloudExecutor: {
        generate: vi.fn(),
      },
    });

    expect(result.ok).toBe(false);
    expect(result.cloudResult).toBeUndefined();
    expect(result.guidance.join('\n')).toContain('Cloud login is still incomplete');
    expect(result.guidance.join('\n')).toContain('No local fallback was attempted');
    expect(localExecutor.execute).not.toHaveBeenCalled();
  });

  it('prompts for missing Cloud agents, connects chosen agents, and confirms with actual availability', async () => {
    const first = readyCloudReadiness({
      agents: {
        claude: { connected: false, capable: false },
        codex: { connected: false, capable: false },
        opencode: { connected: false, capable: false },
        gemini: { connected: false, capable: false },
      },
    });
    const second = readyCloudReadiness({
      agents: {
        claude: { connected: false, capable: false },
        codex: { connected: true, capable: true },
        opencode: { connected: false, capable: false },
        gemini: { connected: false, capable: false },
      },
    });
    const snapshots = [first, second];
    const checkCloudReadiness = vi.fn().mockImplementation(async () => snapshots.shift()!);
    const promptMissingCloudAgents = vi.fn().mockResolvedValue({ action: 'choose', agents: ['codex'] });
    const connectCloudAgents = vi.fn().mockResolvedValue(undefined);
    const confirmCloudRun = vi.fn().mockResolvedValue(true);

    const result = await runInteractiveCli({
      onboard: vi.fn().mockResolvedValue(onboarding('cloud')),
      cloudRequest: cloudRequest(),
      checkCloudReadiness,
      promptMissingCloudAgents,
      connectCloudAgents,
      confirmCloudRun,
      cloudExecutor: {
        generate: vi.fn().mockResolvedValue({
          artifacts: [{ path: 'cloud/workflow.ts', type: 'text/typescript' }],
          warnings: [],
          followUpActions: [],
        }),
      },
    });

    expect(result.ok).toBe(true);
    expect(promptMissingCloudAgents).toHaveBeenCalledWith(
      expect.objectContaining({
        availableAgents: [],
        missingAgents: ['claude', 'codex', 'opencode', 'gemini'],
      }),
    );
    expect(connectCloudAgents).toHaveBeenCalledWith(['codex']);
    expect(result.cloudSummary?.availableAgents).toEqual(['codex']);
    expect(confirmCloudRun).toHaveBeenCalledWith(
      expect.objectContaining({ availableAgents: ['codex'] }),
    );
  });

  it('requires at least one capable implementation agent before Cloud execution', async () => {
    const generate = vi.fn();

    const result = await runInteractiveCli({
      onboard: vi.fn().mockResolvedValue(onboarding('cloud')),
      cloudRequest: cloudRequest(),
      checkCloudReadiness: vi.fn().mockResolvedValue(
        readyCloudReadiness({
          agents: {
            claude: { connected: true, capable: false },
            codex: { connected: false, capable: false },
            opencode: { connected: false, capable: false },
            gemini: { connected: false, capable: false },
          },
        }),
      ),
      promptMissingCloudAgents: vi.fn().mockResolvedValue({ action: 'continue-connected' }),
      cloudExecutor: { generate },
    });

    expect(result.ok).toBe(false);
    expect(result.guidance.join('\n')).toContain('none are capable implementation agents');
    expect(generate).not.toHaveBeenCalled();
  });

  it('allows skipping optional integrations and explains skipped tools only when relevant', async () => {
    const request = {
      ...cloudRequest(),
      body: {
        ...cloudRequest().body,
        spec: 'Build a workflow that posts to Slack and updates Linear.',
      },
    };
    const result = await runInteractiveCli({
      onboard: vi.fn().mockResolvedValue(onboarding('cloud')),
      cloudRequest: request,
      checkCloudReadiness: vi.fn().mockResolvedValue(readyCloudReadiness()),
      selectOptionalCloudIntegrations: vi.fn().mockResolvedValue({ action: 'skip-all' }),
      cloudExecutor: {
        generate: vi.fn().mockResolvedValue({
          artifacts: [{ path: 'cloud/workflow.ts', type: 'text/typescript' }],
          warnings: [],
          followUpActions: [],
        }),
      },
    });

    expect(result.ok).toBe(true);
    expect(result.guidance.join('\n')).toContain('Slack was skipped');
    expect(result.guidance.join('\n')).toContain('Linear was skipped');
    expect(result.guidance.join('\n')).not.toContain('GitHub was skipped');
    expect(result.guidance.join('\n')).not.toContain('Notion was skipped');
  });

  it('routes guided dynamic optional integration choices through the default Nango connector', async () => {
    const previousToken = process.env.AGENTWORKFORCE_CLOUD_TOKEN;
    const previousWorkspace = process.env.AGENTWORKFORCE_CLOUD_WORKSPACE;
    process.env.AGENTWORKFORCE_CLOUD_TOKEN = 'token-from-env';
    process.env.AGENTWORKFORCE_CLOUD_WORKSPACE = 'workspace-from-env';
    const missingGitHub = readyCloudReadiness({
      integrations: {
        slack: { connected: false },
        github: { connected: false },
        notion: { connected: false },
        linear: { connected: false },
      },
    });
    const connectedGitHub = readyCloudReadiness({
      integrations: {
        slack: { connected: false },
        github: { connected: true },
        notion: { connected: false },
        linear: { connected: false },
      },
    });
    const snapshots = [missingGitHub, missingGitHub, connectedGitHub];
    const checkCloudReadiness = vi.fn().mockImplementation(async () => snapshots.shift() ?? connectedGitHub);
    const selectOptionalCloudIntegrations = vi.fn().mockResolvedValue({ action: 'connect', integrations: ['github'] });
    const connectCloudIntegrations = vi.fn().mockResolvedValue([
      { integration: 'github', status: 'link-created', url: 'https://nango.example/github' },
    ]);
    const connectProvider = vi.fn().mockResolvedValue({ provider: 'google', success: true });
    const confirmCloudAgentProviderAuth = vi.fn().mockResolvedValue(true);
    const generate = vi.fn().mockResolvedValue({
      artifacts: [{ path: 'cloud/generated/dynamic-integrations.ts', type: 'text/typescript' }],
      warnings: [],
      followUpActions: [],
    });

    try {
      const result = await runInteractiveCli({
        onboard: vi.fn().mockResolvedValue(onboarding('cloud')),
        cwd: process.cwd(),
        checkCloudReadiness,
        selectOptionalCloudIntegrations,
        connectCloudIntegrations,
        connectProvider,
        confirmCloudAgentProviderAuth,
        confirmCloudRun: vi.fn().mockResolvedValue({ action: 'run-and-monitor' }),
        cloudExecutor: { generate },
        localWorkflow: {
          prompts: {
            selectSpecSource: async () => 'editor',
            inputSpecFilePath: async () => 'SPEC.md',
            editSpec: async () => 'Use GitHub context for the workflow.',
            inputWorkflowName: async () => 'dynamic-integrations',
            inputGoal: async () => 'generate cloud workflow',
            approveGeneratedSpec: async () => 'approve',
            inputWorkflowArtifactPath: async () => 'workflows/generated/cloud.ts',
            confirmRun: async () => 'not-now',
          },
        },
      });

      expect(result.ok).toBe(true);
      expect(selectOptionalCloudIntegrations).toHaveBeenCalledWith(expect.objectContaining({
        missingIntegrations: ['slack', 'github', 'notion', 'linear'],
        relevantIntegrations: [],
      }));
      expect(connectCloudIntegrations).toHaveBeenCalledWith(['github']);
      expect(connectProvider).not.toHaveBeenCalled();
      expect(confirmCloudAgentProviderAuth).not.toHaveBeenCalled();
      expect(result.cloudSummary?.connectedIntegrations).toEqual(['github']);
    } finally {
      if (previousToken === undefined) delete process.env.AGENTWORKFORCE_CLOUD_TOKEN;
      else process.env.AGENTWORKFORCE_CLOUD_TOKEN = previousToken;
      if (previousWorkspace === undefined) delete process.env.AGENTWORKFORCE_CLOUD_WORKSPACE;
      else process.env.AGENTWORKFORCE_CLOUD_WORKSPACE = previousWorkspace;
    }
  });

  it('passes available agents and integration caveats into the Cloud request metadata', async () => {
    const generate = vi.fn().mockResolvedValue({
      artifacts: [{ path: 'cloud/workflow.ts', type: 'text/typescript' }],
      warnings: [],
      followUpActions: [],
    });

    await runInteractiveCli({
      onboard: vi.fn().mockResolvedValue(onboarding('cloud')),
      cloudRequest: {
        ...cloudRequest(),
        body: { ...cloudRequest().body, spec: 'Use GitHub context for a repo workflow.' },
      },
      checkCloudReadiness: vi.fn().mockResolvedValue(
        readyCloudReadiness({
          agents: {
            claude: { connected: false, capable: false },
            codex: { connected: true, capable: true },
            opencode: { connected: false, capable: false },
            gemini: { connected: false, capable: false },
          },
        }),
      ),
      selectOptionalCloudIntegrations: vi.fn().mockResolvedValue({ action: 'skip-all' }),
      cloudExecutor: { generate },
    });

    expect(generate).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          metadata: expect.objectContaining({
            cloudReadiness: expect.objectContaining({
              availableAgents: ['codex'],
              connectedIntegrations: [],
              caveats: ['GitHub was skipped, so Cloud will not use GitHub-backed context for this run.'],
            }),
          }),
        }),
      }),
    );
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

  it('stops cleanly for compact shell-only choices', async () => {
    const localExecutor = { execute: vi.fn() };

    const result = await runInteractiveCli({
      onboard: vi.fn().mockResolvedValue(onboarding('status')),
      localExecutor,
    });

    expect(result.ok).toBe(true);
    expect(result.mode).toBe('local');
    expect(result.awaitingInput).toBe(true);
    expect(result.localResult).toBeUndefined();
    expect(result.guidance.join('\n')).toContain('ricky status --json');
    expect(localExecutor.execute).not.toHaveBeenCalled();
  });

  it('passes cancellation controls through to onboarding', async () => {
    const signal = new AbortController().signal;
    const onboard = vi.fn().mockResolvedValue(onboarding('local'));

    await runInteractiveCli({
      onboard,
      signal,
      verbose: true,
    });

    expect(onboard).toHaveBeenCalledWith(expect.objectContaining({
      signal,
      verbose: true,
    }));
  });

  it('prints concise cancellation when a compact follow-up prompt is cancelled', async () => {
    const output = new PassThrough();
    const selectConnectTools = vi.fn().mockRejectedValue(
      Object.assign(new Error('User force closed the prompt'), { name: 'ExitPromptError' }),
    );

    const result = await runInteractiveCli({
      onboard: vi.fn().mockResolvedValue(onboarding('connect')),
      output,
      selectConnectTools,
    });

    expect(result.ok).toBe(true);
    expect(result.awaitingInput).toBe(true);
    expect(result.guidance).toEqual(['Cancelled. Nothing was generated or executed.']);
    expect(output.read()?.toString()).toBe('\nCancelled.\n');
  });

  it('rethrows compact follow-up prompt cancellation when verbose is set', async () => {
    await expect(runInteractiveCli({
      onboard: vi.fn().mockResolvedValue(onboarding('connect')),
      verbose: true,
      selectConnectTools: vi.fn().mockRejectedValue(
        Object.assign(new Error('User force closed the prompt'), { name: 'ExitPromptError' }),
      ),
    })).rejects.toThrow('User force closed the prompt');
  });

  it('prints actionable guidance for the Connect tools first-screen choice when no terminal is owned', async () => {
    const result = await runInteractiveCli({
      onboard: vi.fn().mockResolvedValue(onboarding('connect')),
    });

    expect(result.ok).toBe(true);
    expect(result.awaitingInput).toBe(true);
    expect(result.guidance.join('\n')).toContain('Connect tools selected.');
    expect(result.guidance.join('\n')).toContain('ricky connect cloud');
    expect(result.guidance.join('\n')).toContain('AgentWorkforce Cloud login flow');
    expect(result.guidance.join('\n')).toContain('ricky connect agents --cloud claude,codex,opencode,gemini');
    expect(result.guidance.join('\n')).toContain('ricky connect integrations --cloud slack,github,notion,linear');
    expect(result.guidance.join('\n')).toContain('No connection was attempted because Ricky does not own an interactive terminal in this context.');
  });

  it('asks which tools to connect before running the selected connector paths', async () => {
    const selectConnectTools = vi.fn().mockResolvedValue(['agents']);
    const connectProvider = vi.fn(async (options: { provider: string }) => ({
      provider: options.provider,
      success: true,
    }));

    const result = await runInteractiveCli({
      onboard: vi.fn().mockResolvedValue(onboarding('connect')),
      selectConnectTools,
      connectProvider,
    });

    expect(selectConnectTools).toHaveBeenCalledTimes(1);
    expect(connectProvider.mock.calls.map(([options]) => options.provider)).toEqual(['claude', 'codex', 'opencode', 'gemini']);
    expect(result.guidance.join('\n')).toContain('Connect tools selected.');
    expect(result.guidance.join('\n')).toContain('Cloud agents:');
    expect(result.guidance.join('\n')).toContain('Connected: claude, codex, opencode, gemini');
    expect(result.guidance.join('\n')).not.toContain('Cloud account:');
    expect(result.guidance.join('\n')).not.toContain('Optional integrations:');
  });

  it('confirms before launching Daytona-backed Cloud agent auth from Connect tools', async () => {
    const selectConnectTools = vi.fn().mockResolvedValue(['agents']);
    const confirmCloudAgentProviderAuth = vi.fn().mockResolvedValue(false);
    const connectProvider = vi.fn(async (options: { provider: string }) => ({
      provider: options.provider,
      success: true,
    }));

    const result = await runInteractiveCli({
      onboard: vi.fn().mockResolvedValue(onboarding('connect')),
      selectConnectTools,
      confirmCloudAgentProviderAuth,
      connectProvider,
    });

    expect(confirmCloudAgentProviderAuth).toHaveBeenCalledWith(['claude', 'codex', 'opencode', 'gemini']);
    expect(connectProvider).not.toHaveBeenCalled();
    const guidance = result.guidance.join('\n');
    expect(guidance).toContain('Cloud agents:');
    expect(guidance).toContain('No Daytona provider auth sandbox was opened.');
  });

  it('runs Cloud login before optional integrations when both connector paths are selected', async () => {
    const selectConnectTools = vi.fn().mockResolvedValue(['cloud', 'integrations']);
    const selectConnectIntegrations = vi.fn().mockResolvedValue(['slack', 'notion']);
    const connectCloudIntegrations = vi.fn().mockResolvedValue([
      { integration: 'slack', status: 'link-opened', url: 'https://nango.example/slack' },
      { integration: 'notion', status: 'link-created', url: 'https://nango.example/notion' },
    ]);
    const connectProvider = vi.fn().mockResolvedValue({ provider: 'google', success: true });
    const ensureCloudAuthenticated = vi.fn().mockResolvedValue({
      accessToken: 'token',
      refreshToken: 'refresh',
      accessTokenExpiresAt: new Date(Date.now() + 60_000).toISOString(),
      apiUrl: 'https://cloud.example.test',
    });

    const result = await runInteractiveCli({
      onboard: vi.fn().mockResolvedValue(onboarding('connect')),
      selectConnectTools,
      selectConnectIntegrations,
      connectCloudIntegrations,
      connectProvider,
      ensureCloudAuthenticated,
    });

    expect(selectConnectIntegrations).toHaveBeenCalledTimes(1);
    expect(connectCloudIntegrations).toHaveBeenCalledWith(['slack', 'notion']);
    expect(ensureCloudAuthenticated).toHaveBeenCalledTimes(1);
    expect(connectProvider).not.toHaveBeenCalled();
    const guidance = result.guidance.join('\n');
    expect(guidance).toContain('Optional integrations:');
    expect(guidance).toContain('Selected: Slack, Notion');
    expect(guidance).toContain('Slack: opened Nango connect link.');
    expect(guidance).toContain('Notion: https://nango.example/notion');
    expect(guidance).toContain('Ricky never uses Daytona for optional integrations.');
    expect(guidance.indexOf('Cloud account:')).toBeLessThan(guidance.indexOf('Optional integrations:'));
  });

  it('routes optional integrations to Nango without launching Daytona-backed agent auth', async () => {
    const selectConnectTools = vi.fn().mockResolvedValue(['integrations']);
    const selectConnectIntegrations = vi.fn().mockResolvedValue(['github']);
    const connectCloudIntegrations = vi.fn().mockResolvedValue([
      { integration: 'github', status: 'link-created', url: 'https://nango.example/github' },
    ]);
    const confirmCloudAgentProviderAuth = vi.fn().mockResolvedValue(true);
    const connectProvider = vi.fn().mockResolvedValue({ provider: 'google', success: true });

    const result = await runInteractiveCli({
      onboard: vi.fn().mockResolvedValue(onboarding('connect')),
      selectConnectTools,
      selectConnectIntegrations,
      connectCloudIntegrations,
      confirmCloudAgentProviderAuth,
      connectProvider,
    });

    expect(connectCloudIntegrations).toHaveBeenCalledWith(['github']);
    expect(confirmCloudAgentProviderAuth).not.toHaveBeenCalled();
    expect(connectProvider).not.toHaveBeenCalled();
    const guidance = result.guidance.join('\n');
    expect(guidance).toContain('Optional integrations:');
    expect(guidance).toContain('GitHub: https://nango.example/github');
    expect(guidance).toContain('Ricky never uses Daytona for optional integrations.');
    expect(guidance).not.toContain('Cloud agents:');
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
      label: 'Relay SDK workflow runner missing',
      unblocker: {
        action: 'Install dependencies and rerun the generated artifact through Ricky',
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
          nextActions: ['npm install', 'ricky run workflows/generated/issue-3.ts'],
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
              run_command: 'ricky run workflows/generated/issue-3.ts',
              run_mode_hint: 'ricky run workflows/generated/issue-3.ts',
            },
          },
          execution: {
            stage: 'execute',
            status: 'blocker',
            execution: {
              workflow_id: 'wf-issue-3',
              artifact_path: 'workflows/generated/issue-3.ts',
              command: '@agent-relay/sdk/workflows runScriptWorkflow workflows/generated/issue-3.ts',
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
              message: 'Runtime dependency is unavailable: @agent-relay/sdk/workflows runtime.',
              detected_at: '2026-01-01T00:00:00.000Z',
              detected_during: 'launch',
              recovery: {
                actionable: true,
                steps: ['npm install', 'ricky run workflows/generated/issue-3.ts'],
              },
              context: {
                missing: ['@agent-relay/sdk/workflows runtime'],
                found: ['cwd=/repo'],
              },
            },
            evidence: {
              outcome_summary: 'Workflow blocked during local runtime execution.',
              failed_step: { id: 'runtime-launch', name: 'Local runtime execution' },
              exit_code: 127,
              logs: {
                tail: ['@agent-relay/sdk/workflows runtime unavailable'],
                truncated: false,
              },
              side_effects: {
                files_written: ['workflows/generated/issue-3.ts'],
                commands_invoked: ['@agent-relay/sdk/workflows runScriptWorkflow workflows/generated/issue-3.ts'],
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
    expect(result.guidance.join('\n')).toContain('[Relay SDK workflow runner missing]');
    expect(result.guidance.join('\n')).toContain(
      'Install dependencies and rerun the generated artifact through Ricky',
    );
    expect(result.guidance.join('\n')).not.toContain('Recovery:');
    expect(diagnoseFn).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'local-blocker',
        message: 'Runtime dependency is unavailable: @agent-relay/sdk/workflows runtime.',
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
        message: '@agent-relay/sdk/workflows runtime unavailable',
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
          `Run the generated workflow locally: ricky run ${artifactPath}`,
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
          `Run the generated workflow locally: ricky run ${artifactPath}`,
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
          `Run the generated workflow locally: ricky run ${artifactPath}`,
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
          `Run the generated workflow locally: ricky run ${artifactPath}`,
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
          `Run the generated workflow locally: ricky run ${artifactPath}`,
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
        const runCommand = `ricky run ${artifactPath}`;

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
