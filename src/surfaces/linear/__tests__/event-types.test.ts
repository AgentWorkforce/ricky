import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  classifyLinearMentionEvent,
  isAgentSessionEvent,
  type AgentActivity,
  type AgentSessionEvent,
} from '../event-types.js';

const schema = JSON.parse(readFileSync(
  fileURLToPath(new URL('./__fixtures__/linear-agent-session-event.schema.json', import.meta.url)),
  'utf8',
)) as { required: string[] };

const baseEvent: AgentSessionEvent = {
  id: 'event-1',
  webhookId: 'webhook-1',
  type: 'created',
  sessionId: 'session-1',
  organizationId: 'org-1',
  trigger: 'issue_mention',
  actor: { linearUserId: 'linear-user-1', cloudUserId: 'cloud-user-1' },
  issue: { id: 'issue-1', title: 'Ship Linear integration', labels: ['linear'] },
  createdAt: '2026-05-06T00:00:00.000Z',
};

describe('Linear event types', () => {
  it('matches the checked-in AgentSessionEvent schema fixture required fields', () => {
    expect(schema.required).toEqual([
      'id',
      'webhookId',
      'type',
      'sessionId',
      'organizationId',
      'trigger',
      'actor',
      'issue',
      'createdAt',
    ]);
    expect(isAgentSessionEvent(baseEvent)).toBe(true);
  });

  it('classifies issue mentions, comment mentions, and assignments', () => {
    expect(classifyLinearMentionEvent({ ...baseEvent, trigger: 'issue_mention' }).classification).toBe('issue_mention');
    expect(classifyLinearMentionEvent({ ...baseEvent, trigger: 'comment_mention' }).classification).toBe('comment_mention');
    expect(classifyLinearMentionEvent({ ...baseEvent, trigger: 'assignment' }).classification).toBe('assignment');
  });

  it('keeps AgentActivity kind constrained to Linear activity variants', () => {
    const activity: AgentActivity = {
      sessionId: 'session-1',
      kind: 'thought',
      body: 'Selected pipeline.',
      createdAt: '2026-05-06T00:00:00.000Z',
    };

    expect(activity.kind).toBe('thought');
  });
});
