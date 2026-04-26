import { describe, expect, it, vi } from 'vitest';

import type { OnboardingResult } from '../cli/onboarding.js';
import type { CloudGenerateRequest } from '@ricky/cloud/api/request-types.js';
import type { LocalResponse } from '@ricky/local/entrypoint.js';
import { BlockerClass } from '@ricky/runtime/diagnostics/failure-diagnosis.js';
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
  });

  it('stops cleanly after onboarding when no handoff was provided', async () => {
    const result = await runInteractiveCli({
      onboard: vi.fn().mockResolvedValue(onboarding('local')),
    });

    expect(result.ok).toBe(true);
    expect(result.awaitingInput).toBe(true);
    expect(result.localResult).toBeUndefined();
    expect(result.guidance.join('\n')).toMatch(/ready for a real spec or workflow handoff/i);
    expect(result.guidance.join('\n')).toMatch(/command layer is still limited/i);
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
    expect(result.guidance.join('\n')).toMatch(/Workflow generation failed/i);
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
    expect(result.guidance.join('\n')).toMatch(/Workflow generation failed/i);
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
});
