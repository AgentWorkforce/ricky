import { describe, expect, it, vi } from 'vitest';

import {
  handleLinearMention,
  type LinearMentionDeps,
} from '../index.js';
import type { AgentActivity, AgentSessionEvent } from '../event-types.js';

const event: AgentSessionEvent = {
  id: 'event-1',
  webhookId: 'webhook-1',
  type: 'created',
  sessionId: 'session-1',
  organizationId: 'org-1',
  workspaceId: 'workspace-1',
  trigger: 'issue_mention',
  actor: { linearUserId: 'linear-user-1', cloudUserId: 'cloud-user-1', name: 'A User' },
  issue: {
    id: 'issue-1',
    title: 'Fix generated workflow',
    description: 'Run the repair path.',
    labels: ['bug'],
  },
  createdAt: '2026-05-06T00:00:00.000Z',
};

function deps(overrides: Partial<LinearMentionDeps> = {}): LinearMentionDeps & {
  activities: AgentActivity[];
  ended: Array<{ sessionId: string; reason: string }>;
} {
  const activities: AgentActivity[] = [];
  const ended: Array<{ sessionId: string; reason: string }> = [];
  return {
    activities,
    ended,
    signatureVerifier: vi.fn().mockResolvedValue(true),
    dedupStore: {
      has: vi.fn().mockResolvedValue(false),
      mark: vi.fn().mockResolvedValue(undefined),
    },
    githubInstallProbe: vi.fn().mockResolvedValue(true),
    agentRegistry: {
      list: vi.fn().mockResolvedValue([{ id: 'codex', name: 'Codex', capabilities: ['implementation'] }]),
    },
    workflowRunner: vi.fn().mockResolvedValue({
      status: 'completed',
      prUrl: 'https://github.example/pr/1',
      summary: 'Opened PR.',
    }),
    activityWriter: {
      write: vi.fn(async (activity: AgentActivity) => {
        activities.push(activity);
      }),
      endSession: vi.fn(async (params) => {
        ended.push(params);
      }),
    },
    clock: () => new Date('2026-05-06T00:00:00.000Z'),
    ...overrides,
  };
}

describe('handleLinearMention', () => {
  it('fails before dedup when signature verification fails', async () => {
    const d = deps({ signatureVerifier: vi.fn().mockResolvedValue(false) });

    const result = await handleLinearMention({ payload: event }, d);

    expect(result).toEqual({ status: 'failed', reason: 'failed' });
    expect(d.dedupStore.has).not.toHaveBeenCalled();
  });

  it('returns no-change ignored result on dedup hits', async () => {
    const d = deps({
      dedupStore: {
        has: vi.fn().mockResolvedValue(true),
        mark: vi.fn(),
      },
    });

    const result = await handleLinearMention({ payload: event }, d);

    expect(result).toEqual({ status: 'ignored', sessionId: 'session-1', reason: 'completed_no_changes' });
    expect(d.dedupStore.mark).not.toHaveBeenCalled();
  });

  it('checks GitHub readiness before connected agents', async () => {
    const d = deps({ githubInstallProbe: vi.fn().mockResolvedValue(false) });

    const result = await handleLinearMention({ payload: event }, d);

    expect(result.reason).toBe('failed');
    expect(d.githubInstallProbe).toHaveBeenCalledTimes(1);
    expect(d.agentRegistry.list).not.toHaveBeenCalled();
    expect(d.activities[0]).toMatchObject({ kind: 'response' });
  });

  it('fails readiness after GitHub when no capable Cloud agents are connected', async () => {
    const d = deps({
      agentRegistry: {
        list: vi.fn().mockResolvedValue([]),
      },
    });

    const result = await handleLinearMention({ payload: event }, d);

    expect(result).toEqual({ status: 'failed', sessionId: 'session-1', reason: 'failed' });
    expect(d.githubInstallProbe).toHaveBeenCalledTimes(1);
    expect(d.agentRegistry.list).toHaveBeenCalledWith({
      scope: 'workspace-1',
      actor: event.actor,
    });
    expect(d.workflowRunner).not.toHaveBeenCalled();
    expect(d.activities).toEqual([
      expect.objectContaining({
        kind: 'response',
        body: 'No connected Cloud implementation agents were found for A User.',
      }),
    ]);
    expect(d.ended).toEqual([{ sessionId: 'session-1', reason: 'failed' }]);
  });

  it('mirrors workflow lifecycle to thought, action, response, and error activities', async () => {
    const completed = deps();

    await expect(handleLinearMention({
      payload: event,
      repoTarget: { owner: 'AgentWorkforce', repo: 'ricky', defaultBranch: 'main' },
    }, completed)).resolves.toMatchObject({ reason: 'completed' });

    expect(completed.activities.map((activity) => activity.kind)).toEqual(['thought', 'action', 'response']);

    const failed = deps({
      workflowRunner: vi.fn().mockResolvedValue({ status: 'failed', summary: 'Typecheck failed.' }),
    });

    await expect(handleLinearMention({
      payload: { ...event, webhookId: 'webhook-error' },
      repoTarget: { owner: 'AgentWorkforce', repo: 'ricky', defaultBranch: 'main' },
    }, failed)).resolves.toMatchObject({ reason: 'failed' });

    expect(failed.activities.map((activity) => activity.kind)).toEqual(['thought', 'action', 'error']);
  });

  it('reaches completed, completed_no_changes, and failed terminal reasons', async () => {
    const completed = deps();
    await expect(handleLinearMention({
      payload: event,
      repoTarget: { owner: 'AgentWorkforce', repo: 'ricky', defaultBranch: 'main' },
    }, completed)).resolves.toMatchObject({ reason: 'completed' });

    const noChanges = deps({
      workflowRunner: vi.fn().mockResolvedValue({ status: 'completed_no_changes', summary: 'No diff.' }),
    });
    await expect(handleLinearMention({
      payload: { ...event, webhookId: 'webhook-2' },
      repoTarget: { owner: 'AgentWorkforce', repo: 'ricky', defaultBranch: 'main' },
    }, noChanges)).resolves.toMatchObject({ reason: 'completed_no_changes' });

    const failed = deps({
      workflowRunner: vi.fn().mockResolvedValue({ status: 'failed', summary: 'Typecheck failed.' }),
    });
    await expect(handleLinearMention({
      payload: { ...event, webhookId: 'webhook-3' },
      repoTarget: { owner: 'AgentWorkforce', repo: 'ricky', defaultBranch: 'main' },
    }, failed)).resolves.toMatchObject({ reason: 'failed' });
  });
});
