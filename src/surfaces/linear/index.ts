export {
  classifyLinearMentionEvent,
  isAgentSessionEvent,
} from './event-types.js';
export type {
  AgentActivity,
  AgentActivityKind,
  AgentSessionEvent,
  AgentSessionEventType,
  AgentSessionTrigger,
  AssignmentEvent,
  CommentMentionEvent,
  IssueMentionEvent,
  LinearMentionEvent,
} from './event-types.js';
export {
  buildLinearWorkflow,
} from './workflow-builder.js';
export type {
  BuildLinearWorkflowInput,
  BuildLinearWorkflowResult,
} from './workflow-builder.js';
export {
  linearStatusSummary,
  renderLinearStatus,
} from './status.js';
export type {
  LinearReadinessSnapshot,
  LinearStatusSummary,
} from './status.js';
export {
  getLinearConnectGuidance,
  renderLinearConnectGuidance,
} from './connect.js';

import type { AgentActivity, AgentSessionEvent } from './event-types.js';
import { classifyLinearMentionEvent, isAgentSessionEvent } from './event-types.js';
import { buildLinearWorkflow, type BuildLinearWorkflowResult } from './workflow-builder.js';
import type { SessionEndReason } from '../../cloud/api/linear-agent-types.js';

export type LinearMentionHandleStatus = 'completed' | 'completed_no_changes' | 'failed' | 'ignored';

export interface LinearMentionHandleInput {
  payload: unknown;
  rawBody?: string;
  headers?: Record<string, string | string[] | undefined>;
  repoTarget?: {
    owner: string;
    repo: string;
    defaultBranch: string;
  };
}

export interface LinearMentionHandleResult {
  status: LinearMentionHandleStatus;
  sessionId?: string;
  reason: SessionEndReason;
}

export interface LinearMentionDeps {
  signatureVerifier: (input: LinearMentionHandleInput) => boolean | Promise<boolean>;
  dedupStore: {
    markIfAbsent: (webhookId: string) => boolean | Promise<boolean>;
  };
  githubInstallProbe: (event: AgentSessionEvent) => boolean | Promise<boolean>;
  agentRegistry: {
    list: (query: {
      scope: string;
      actor: AgentSessionEvent['actor'];
    }) => Promise<ReadonlyArray<{ id: string; name: string; capabilities: string[] }>>;
  };
  workflowRunner: (workflow: BuildLinearWorkflowResult, event: AgentSessionEvent) => Promise<{
    status: Exclude<LinearMentionHandleStatus, 'ignored'>;
    prUrl?: string;
    summary?: string;
  }>;
  activityWriter: {
    write: (activity: AgentActivity) => void | Promise<void>;
    endSession: (params: { sessionId: string; reason: SessionEndReason }) => void | Promise<void>;
  };
  clock?: () => Date;
  logger?: { warn?: (message: string, metadata?: Record<string, unknown>) => void };
}

export async function handleLinearMention(
  input: LinearMentionHandleInput,
  deps: LinearMentionDeps,
): Promise<LinearMentionHandleResult> {
  const verified = await deps.signatureVerifier(input);
  if (!verified) {
    return { status: 'failed', reason: 'failed' };
  }

  let event: AgentSessionEvent | undefined;
  try {
    if (!isAgentSessionEvent(input.payload)) {
      deps.logger?.warn?.('Ignoring non-AgentSessionEvent Linear payload.');
      return { status: 'ignored', reason: 'completed_no_changes' };
    }

    event = input.payload;
    const accepted = await deps.dedupStore.markIfAbsent(event.webhookId);
    if (!accepted) {
      return { status: 'ignored', sessionId: event.sessionId, reason: 'completed_no_changes' };
    }

    if (event.type === 'prompted') {
      await writeActivity(
        deps,
        event,
        'response',
        'Prompt received for an existing Linear Agent Session. Cloud should route it to the active session instead of starting a new workflow.',
      );
      return { status: 'ignored', sessionId: event.sessionId, reason: 'completed_no_changes' };
    }

    classifyLinearMentionEvent(event);

    const githubReady = await deps.githubInstallProbe(event);
    if (!githubReady) {
      const reason: SessionEndReason = 'awaiting_github_install';
      await writeActivity(deps, event, 'response', 'Install the GitHub App before Ricky can open a pull request from Linear.');
      await deps.activityWriter.endSession({ sessionId: event.sessionId, reason });
      return { status: 'failed', sessionId: event.sessionId, reason };
    }

    const connectedAgents = await deps.agentRegistry.list({
      scope: event.workspaceId ?? event.organizationId,
      actor: event.actor,
    });
    if (connectedAgents.length === 0) {
      const reason: SessionEndReason = 'awaiting_agent_connect';
      await writeActivity(deps, event, 'response', `No connected Cloud implementation agents were found for ${event.actor.name ?? event.actor.linearUserId}.`);
      await deps.activityWriter.endSession({ sessionId: event.sessionId, reason });
      return { status: 'failed', sessionId: event.sessionId, reason };
    }

    const workflow = buildLinearWorkflow({
      issue: {
        id: event.issue.id,
        title: event.issue.title,
        description: event.issue.description ?? '',
        labels: event.issue.labels ?? [],
        comments: event.issue.comments ?? [],
        ...(event.issue.project ? { project: event.issue.project } : {}),
      },
      repoTarget: input.repoTarget,
      connectedAgents,
      actor: {
        linearUserId: event.actor.linearUserId,
        cloudUserId: event.actor.cloudUserId ?? event.actor.linearUserId,
      },
    });
    await writeActivity(deps, event, 'thought', workflow.rationale);
    await writeActivity(deps, event, 'action', 'Generating workflow on AgentWorkforce Cloud.');
    const run = await deps.workflowRunner(workflow, event);
    if (run.status === 'failed') {
      await writeActivity(deps, event, 'error', run.summary ?? 'The Cloud workflow failed.');
      await deps.activityWriter.endSession({ sessionId: event.sessionId, reason: 'failed' });
      return { status: 'failed', sessionId: event.sessionId, reason: 'failed' };
    }

    const reason: SessionEndReason = run.status === 'completed_no_changes' ? 'completed_no_changes' : 'completed';
    const body = run.prUrl
      ? `Workflow completed and opened a PR: ${run.prUrl}`
      : run.summary ?? 'Workflow completed with no code changes needed.';
    await writeActivity(deps, event, 'response', body, run.prUrl ? { prUrl: run.prUrl } : undefined);
    await deps.activityWriter.endSession({ sessionId: event.sessionId, reason });
    return { status: run.status, sessionId: event.sessionId, reason };
  } catch (error) {
    if (event) {
      await writeActivity(deps, event, 'error', error instanceof Error ? error.message : String(error));
      await deps.activityWriter.endSession({ sessionId: event.sessionId, reason: 'failed' });
    }
    return { status: 'failed', ...(event ? { sessionId: event.sessionId } : {}), reason: 'failed' };
  }
}

async function writeActivity(
  deps: LinearMentionDeps,
  event: AgentSessionEvent,
  kind: AgentActivity['kind'],
  body: string,
  metadata?: Record<string, unknown>,
): Promise<void> {
  await deps.activityWriter.write({
    sessionId: event.sessionId,
    kind,
    body,
    createdAt: (deps.clock?.() ?? new Date()).toISOString(),
    ...(metadata ? { metadata } : {}),
  });
}
