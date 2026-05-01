import { describe, expect, it, vi } from 'vitest';

import type { CloudGenerateRequest } from '../../../cloud/api/request-types.js';
import type { CloudReadinessSnapshot } from './cloud-workflow-flow.js';
import { runCloudWorkflowFlow } from './cloud-workflow-flow.js';

function readyReadiness(): CloudReadinessSnapshot {
  return {
    account: { connected: true },
    credentials: { connected: true },
    workspace: { connected: true },
    agents: {
      claude: { connected: true, capable: true },
      codex: { connected: true, capable: true },
      opencode: { connected: false, capable: false },
      gemini: { connected: false, capable: false },
    },
    integrations: {
      slack: { connected: false },
      github: { connected: false },
      notion: { connected: false },
      linear: { connected: false },
    },
  };
}

function request(spec = 'build a workflow'): CloudGenerateRequest {
  return {
    auth: { token: 'token-1' },
    workspace: { workspaceId: 'workspace-1' },
    body: { spec, mode: 'cloud', metadata: {} },
  };
}

describe('runCloudWorkflowFlow confirmation branches', () => {
  it('returns ok=true when confirmation is run-and-monitor', async () => {
    const confirmCloudRun = vi.fn().mockResolvedValue({ action: 'run-and-monitor' as const });
    const result = await runCloudWorkflowFlow(request(), {
      checkCloudReadiness: vi.fn().mockResolvedValue(readyReadiness()),
      confirmCloudRun,
    });

    expect(result.ok).toBe(true);
    expect(confirmCloudRun).toHaveBeenCalledTimes(1);
  });

  it('returns ok=false with show-command guidance when confirmation is show-command', async () => {
    const result = await runCloudWorkflowFlow(request(), {
      checkCloudReadiness: vi.fn().mockResolvedValue(readyReadiness()),
      confirmCloudRun: vi.fn().mockResolvedValue({ action: 'show-command' as const }),
    });

    expect(result.ok).toBe(false);
    expect(result.guidance.join('\n')).toContain('Cloud run command:');
    expect(result.guidance.join('\n')).toContain('ricky cloud --spec-file');
  });

  it('returns ok=false with edit-first guidance when confirmation is edit-first', async () => {
    const result = await runCloudWorkflowFlow(request(), {
      checkCloudReadiness: vi.fn().mockResolvedValue(readyReadiness()),
      confirmCloudRun: vi.fn().mockResolvedValue({ action: 'edit-first' as const }),
    });

    expect(result.ok).toBe(false);
    expect(result.guidance.join('\n')).toContain('edit the workflow first');
  });

  it('treats legacy boolean true as run-and-monitor and false as show-command', async () => {
    const ok = await runCloudWorkflowFlow(request(), {
      checkCloudReadiness: vi.fn().mockResolvedValue(readyReadiness()),
      confirmCloudRun: vi.fn().mockResolvedValue(true),
    });
    expect(ok.ok).toBe(true);

    const cancelled = await runCloudWorkflowFlow(request(), {
      checkCloudReadiness: vi.fn().mockResolvedValue(readyReadiness()),
      confirmCloudRun: vi.fn().mockResolvedValue(false),
    });
    expect(cancelled.ok).toBe(false);
    expect(cancelled.guidance.join('\n')).toContain('Cloud run command:');
  });
});
