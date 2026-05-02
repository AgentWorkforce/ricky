import { describe, expect, it, vi } from 'vitest';

import type { CloudGenerateRequest } from '../../../cloud/api/request-types.js';
import type { CloudReadinessSnapshot } from './cloud-workflow-flow.js';
import { prepareCloudWorkflowReadiness, runCloudWorkflowFlow } from './cloud-workflow-flow.js';

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

describe('prepareCloudWorkflowReadiness', () => {
  it('recovers missing login through the injected mechanism and re-checks readiness', async () => {
    const first = readyReadiness();
    first.account = { connected: false };
    first.credentials = { connected: false };

    const snapshots = [first, readyReadiness()];
    const checkCloudReadiness = vi.fn().mockImplementation(async () => snapshots.shift()!);
    const recoverCloudLogin = vi.fn().mockResolvedValue(undefined);

    const result = await prepareCloudWorkflowReadiness(request(), {
      checkCloudReadiness,
      recoverCloudLogin,
    });

    expect(result.ok).toBe(true);
    expect(recoverCloudLogin).toHaveBeenCalledWith(expect.objectContaining({
      missing: ['account', 'credentials'],
    }));
    expect(checkCloudReadiness).toHaveBeenCalledTimes(2);
  });

  it('connects all missing agents and summarizes only actually capable agents after re-check', async () => {
    const first = readyReadiness();
    first.agents = {
      claude: { connected: false, capable: false },
      codex: { connected: false, capable: false },
      opencode: { connected: false, capable: false },
      gemini: { connected: false, capable: false },
    };

    const second = readyReadiness();
    second.agents = {
      claude: { connected: false, capable: false },
      codex: { connected: true, capable: true },
      opencode: { connected: true, capable: false },
      gemini: { connected: false, capable: false },
    };

    const snapshots = [first, second];
    const checkCloudReadiness = vi.fn().mockImplementation(async () => snapshots.shift()!);
    const connectCloudAgents = vi.fn().mockResolvedValue(undefined);

    const result = await prepareCloudWorkflowReadiness(request(), {
      checkCloudReadiness,
      promptMissingCloudAgents: vi.fn().mockResolvedValue({ action: 'connect-all' }),
      connectCloudAgents,
    });

    expect(result.ok).toBe(true);
    expect(connectCloudAgents).toHaveBeenCalledWith(['claude', 'codex', 'opencode', 'gemini']);
    if (result.ok) {
      expect(result.summary.availableAgents).toEqual(['codex']);
      expect(result.summary.lines.join('\n')).toContain('Agents available: Codex');
      expect(result.summary.lines.join('\n')).not.toContain('OpenCode');
    }
  });

  it('allows continuing with connected capable agents and reports relevant skipped integrations only', async () => {
    const readiness = readyReadiness();
    readiness.agents = {
      claude: { connected: false, capable: false },
      codex: { connected: true, capable: true },
      opencode: { connected: false, capable: false },
      gemini: { connected: false, capable: false },
    };

    const result = await prepareCloudWorkflowReadiness(
      request('Post to Slack and update Linear.'),
      {
        checkCloudReadiness: vi.fn().mockResolvedValue(readiness),
        promptMissingCloudAgents: vi.fn().mockResolvedValue({ action: 'continue-connected' }),
        selectOptionalCloudIntegrations: vi.fn().mockResolvedValue({ action: 'skip-all' }),
      },
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.summary.availableAgents).toEqual(['codex']);
      expect(result.summary.caveats).toEqual([
        'Slack was skipped, so Cloud will not use Slack-backed context for this run.',
        'Linear was skipped, so Cloud will not use Linear-backed context for this run.',
      ]);
      expect(result.summary.caveats.join('\n')).not.toContain('GitHub');
      expect(result.summary.caveats.join('\n')).not.toContain('Notion');
    }
  });

  it('returns to mode selection without falling back when agent setup goes back', async () => {
    const readiness = readyReadiness();
    readiness.agents = {
      claude: { connected: false, capable: false },
      codex: { connected: false, capable: false },
      opencode: { connected: false, capable: false },
      gemini: { connected: false, capable: false },
    };

    const result = await prepareCloudWorkflowReadiness(request(), {
      checkCloudReadiness: vi.fn().mockResolvedValue(readiness),
      promptMissingCloudAgents: vi.fn().mockResolvedValue({ action: 'go-back' }),
    });

    expect(result.ok).toBe(false);
    expect(result.guidance.join('\n')).toContain('No local fallback was attempted');
  });
});
