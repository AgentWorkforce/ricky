import type {
  AuthorizedWorkspaceScope,
  AuthorizedWorkspaceScopeResult,
  CloudWorkspaceContext,
} from './types.js';

type WorkspaceScopedQuery<T extends Record<string, unknown>> = Omit<T, 'workspaceId'> & {
  workspaceId: string;
};

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

export function createWorkspaceScopedQuery<T extends Record<string, unknown> = Record<string, never>>(
  workspaceId: string,
  query?: T,
): WorkspaceScopedQuery<T> {
  return {
    ...query,
    workspaceId,
  } as WorkspaceScopedQuery<T>;
}

export function assertWorkspaceMatch(resourceWorkspaceId: string, requestWorkspaceId: string): void {
  if (resourceWorkspaceId !== requestWorkspaceId) {
    throw new WorkspaceScopingError(resourceWorkspaceId, requestWorkspaceId);
  }
}

/**
 * Resolve a request's workspace scope against the caller's authorized scope.
 *
 * Denies cross-workspace access, and denies cross-project / cross-environment
 * access when the authorized scope pins those dimensions. When the authorized
 * scope pins a `projectId` or `environment` and the request omits it, the
 * authorized value is filled into the resolved scope (defaults to authorized
 * scope rather than rejecting). Callers that require the request to name a
 * project explicitly should compose with
 * `validateWorkspaceContext(..., { requireProject: true })`.
 */
export function resolveAuthorizedWorkspaceScope(
  authorizedScope: AuthorizedWorkspaceScope,
  requestedScope: CloudWorkspaceContext,
): AuthorizedWorkspaceScopeResult {
  if (authorizedScope.workspaceId !== requestedScope.workspaceId) {
    return {
      ok: false,
      error: 'Cross-workspace access denied.',
      status: 403,
      code: 'cross-workspace-access',
      path: 'workspace.workspaceId',
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
      code: 'cross-project-access',
      path: 'workspace.projectId',
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
      code: 'cross-environment-access',
      path: 'workspace.environment',
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
