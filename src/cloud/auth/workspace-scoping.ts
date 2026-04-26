import type {
  AuthorizedWorkspaceScope,
  AuthorizedWorkspaceScopeResult,
  CloudWorkspaceContext,
} from './types';

export class WorkspaceScopingError extends Error {
  readonly workspaceId: string;
  readonly requestedWorkspaceId: string;

  constructor(workspaceId: string, requestedWorkspaceId: string) {
    super(
      `Workspace mismatch: resource belongs to ${workspaceId}, request targeted ${requestedWorkspaceId}.`,
    );
    this.name = 'WorkspaceScopingError';
    this.workspaceId = workspaceId;
    this.requestedWorkspaceId = requestedWorkspaceId;
  }
}

export function scopeToWorkspace<T extends { workspaceId: string }>(
  resource: T,
  requestedWorkspaceId: string,
): T | null {
  return resource.workspaceId === requestedWorkspaceId ? resource : null;
}

export function createWorkspaceScopedQuery(workspaceId: string): { workspaceId: string } {
  return { workspaceId };
}

export function assertWorkspaceMatch(resourceWorkspaceId: string, requestWorkspaceId: string): void {
  if (resourceWorkspaceId !== requestWorkspaceId) {
    throw new WorkspaceScopingError(resourceWorkspaceId, requestWorkspaceId);
  }
}

export function resolveAuthorizedWorkspaceScope(
  authorizedScope: AuthorizedWorkspaceScope,
  requestedScope: CloudWorkspaceContext,
): AuthorizedWorkspaceScopeResult {
  if (authorizedScope.workspaceId !== requestedScope.workspaceId) {
    return {
      ok: false,
      error: 'Cross-workspace access denied.',
      status: 403,
    };
  }

  if (
    authorizedScope.projectId !== undefined &&
    requestedScope.projectId !== undefined &&
    authorizedScope.projectId !== requestedScope.projectId
  ) {
    return {
      ok: false,
      error: 'Cross-project access denied.',
      status: 403,
    };
  }

  if (
    authorizedScope.environment !== undefined &&
    requestedScope.environment !== undefined &&
    authorizedScope.environment !== requestedScope.environment
  ) {
    return {
      ok: false,
      error: 'Cross-environment access denied.',
      status: 403,
    };
  }

  return {
    ok: true,
    scope: {
      workspaceId: requestedScope.workspaceId,
      projectId: requestedScope.projectId ?? authorizedScope.projectId,
      environment: requestedScope.environment ?? authorizedScope.environment,
    },
  };
}
