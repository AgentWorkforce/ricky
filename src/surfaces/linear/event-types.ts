import { z } from 'zod';

import type {
  AgentActivity,
  AgentActivityKind,
  AgentSessionEvent,
  AgentSessionEventType,
  AgentSessionTrigger,
  LinearActor,
  LinearIssueContext,
} from '../../cloud/api/linear-agent-types.js';

export type {
  AgentActivity,
  AgentActivityKind,
  AgentSessionEvent,
  AgentSessionEventType,
  AgentSessionTrigger,
  LinearActor,
  LinearIssueContext,
};

export const LinearActorSchema: z.ZodType<LinearActor> = z.object({
  linearUserId: z.string().min(1),
  cloudUserId: z.string().optional(),
  name: z.string().optional(),
});

export const LinearIssueContextSchema: z.ZodType<LinearIssueContext> = z.object({
  id: z.string().min(1),
  identifier: z.string().optional(),
  title: z.string().min(1),
  description: z.string().optional(),
  labels: z.array(z.string()).optional(),
  comments: z.array(z.string()).optional(),
  project: z.string().optional(),
  url: z.string().optional(),
});

export const AgentSessionEventSchema: z.ZodType<AgentSessionEvent> = z.object({
  id: z.string().min(1),
  webhookId: z.string().min(1),
  type: z.enum(['created', 'prompted']),
  sessionId: z.string().min(1),
  organizationId: z.string().min(1),
  workspaceId: z.string().optional(),
  trigger: z.enum(['issue_mention', 'comment_mention', 'assignment']),
  actor: LinearActorSchema,
  issue: LinearIssueContextSchema,
  prompt: z.string().optional(),
  createdAt: z.string().min(1),
});

export const AgentActivitySchema: z.ZodType<AgentActivity> = z.object({
  id: z.string().optional(),
  sessionId: z.string().min(1),
  kind: z.enum(['thought', 'action', 'response', 'error']),
  body: z.string(),
  createdAt: z.string().min(1),
  metadata: z.record(z.unknown()).optional(),
});

export interface IssueMentionEvent {
  classification: 'issue_mention';
  event: AgentSessionEvent & { trigger: 'issue_mention' };
}

export interface CommentMentionEvent {
  classification: 'comment_mention';
  event: AgentSessionEvent & { trigger: 'comment_mention' };
}

export interface AssignmentEvent {
  classification: 'assignment';
  event: AgentSessionEvent & { trigger: 'assignment' };
}

export type LinearMentionEvent = IssueMentionEvent | CommentMentionEvent | AssignmentEvent;

export function isAgentSessionEvent(value: unknown): value is AgentSessionEvent {
  return AgentSessionEventSchema.safeParse(value).success;
}

export function classifyLinearMentionEvent(event: AgentSessionEvent): LinearMentionEvent {
  if (event.trigger === 'issue_mention') {
    return { classification: 'issue_mention', event: event as AgentSessionEvent & { trigger: 'issue_mention' } };
  }
  if (event.trigger === 'comment_mention') {
    return { classification: 'comment_mention', event: event as AgentSessionEvent & { trigger: 'comment_mention' } };
  }
  return { classification: 'assignment', event: event as AgentSessionEvent & { trigger: 'assignment' } };
}
