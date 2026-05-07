export type SessionEndReason = 'completed' | 'completed_no_changes' | 'failed';

export type AgentSessionEventType = 'created' | 'prompted';

export type AgentSessionTrigger = 'issue_mention' | 'comment_mention' | 'assignment';

export type AgentActivityKind = 'thought' | 'action' | 'response' | 'error';

export interface LinearActor {
  linearUserId: string;
  cloudUserId?: string;
  name?: string;
}

export interface LinearIssueContext {
  id: string;
  identifier?: string;
  title: string;
  description?: string;
  labels?: string[];
  comments?: string[];
  project?: string;
  url?: string;
}

export interface AgentSessionEvent {
  id: string;
  webhookId: string;
  type: AgentSessionEventType;
  sessionId: string;
  organizationId: string;
  workspaceId?: string;
  trigger: AgentSessionTrigger;
  actor: LinearActor;
  issue: LinearIssueContext;
  prompt?: string;
  createdAt: string;
}

export interface AgentActivity {
  id?: string;
  sessionId: string;
  kind: AgentActivityKind;
  body: string;
  createdAt: string;
  metadata?: Record<string, unknown>;
}

export interface LinearRepoTarget {
  owner: string;
  repo: string;
  defaultBranch: string;
}

export interface LinearWorkflowSummary {
  artifactPath: string;
  pattern: 'pipeline' | 'supervisor' | 'dag';
  selectedAgents: ReadonlyArray<string>;
  rationale: string;
}

export interface LinearMentionRequest {
  provider: 'linear';
  event: AgentSessionEvent;
  repoTarget?: LinearRepoTarget | null;
  receivedAt: string;
}

export interface LinearMentionResponse {
  status: 'completed' | 'completed_no_changes' | 'failed' | 'ignored';
  sessionId?: string;
  reason: SessionEndReason;
  workflow?: LinearWorkflowSummary;
  prUrl?: string;
}

export interface RickyLinearSession {
  sessionId: string;
  workspaceId: string;
  organizationId: string;
  actor: LinearActor;
  issue: LinearIssueContext;
  status: 'running' | 'ended';
  reason?: SessionEndReason;
  startedAt: string;
  endedAt?: string;
  activities: AgentActivity[];
}

export interface LinearAgentActivityPostPayload {
  sessionId: string;
  activity: AgentActivity;
}
