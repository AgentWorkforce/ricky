import type {
  AuthValidationResult,
  CloudAuthContext,
  CloudRequestMode,
  CloudRequestValidationOptions,
  CloudRequestValidationResult,
  CloudWorkspaceContext,
  ProviderConnectionState,
  ProviderConnectionValidationResult,
  ProviderType,
  RequestModeValidationResult,
  WorkspaceScopingResult,
} from './types.js';

const VALID_TOKEN_TYPES = new Set(['bearer', 'api-key']);
const VALID_REQUEST_MODES = new Set(['cloud', 'both']);

export function validateAuthContext(auth: CloudAuthContext | undefined): AuthValidationResult {
  if (!auth || typeof auth.token !== 'string' || !auth.token.trim()) {
    return { ok: false, error: 'Missing or empty auth token.', status: 401 };
  }

  if (auth.tokenType !== undefined && !VALID_TOKEN_TYPES.has(auth.tokenType)) {
    return { ok: false, error: 'Invalid auth token type.', status: 400 };
  }

  return {
    ok: true,
    context: {
      token: auth.token,
      tokenType: auth.tokenType ?? 'bearer',
    },
  };
}

export function validateWorkspaceContext(
  workspace: CloudWorkspaceContext | undefined,
  options: { requireProject?: boolean } = {},
): WorkspaceScopingResult {
  if (!workspace || typeof workspace.workspaceId !== 'string' || !workspace.workspaceId.trim()) {
    return { ok: false, error: 'Missing or empty workspace ID.', status: 400 };
  }

  if (workspace.projectId !== undefined && (typeof workspace.projectId !== 'string' || !workspace.projectId.trim())) {
    return { ok: false, error: 'Missing or empty project ID.', status: 400 };
  }

  if (options.requireProject && !workspace.projectId?.trim()) {
    return { ok: false, error: 'Missing or empty project ID.', status: 400 };
  }

  return {
    ok: true,
    workspaceId: workspace.workspaceId,
    projectId: workspace.projectId,
    environment: workspace.environment,
  };
}

export function validateRequestMode(mode: CloudRequestMode | string | undefined): RequestModeValidationResult {
  const resolvedMode = mode ?? 'cloud';

  if (!VALID_REQUEST_MODES.has(resolvedMode)) {
    return { ok: false, error: 'Invalid request mode.', status: 400 };
  }

  return { ok: true, mode: resolvedMode as CloudRequestMode };
}

export function validateProviderConnectionState(
  connection: ProviderConnectionState | undefined,
  requiredProvider: ProviderType,
): ProviderConnectionValidationResult {
  if (!connection) {
    return {
      ok: false,
      error: `Missing ${requiredProvider} provider connection state.`,
      status: 409,
    };
  }

  if (connection.provider !== requiredProvider) {
    return {
      ok: false,
      error: `Provider connection mismatch: expected ${requiredProvider}.`,
      status: 400,
    };
  }

  if (connection.connected !== true) {
    return {
      ok: false,
      error: `${requiredProvider} provider is not connected.`,
      status: 409,
    };
  }

  return { ok: true, connection };
}

export function validateCloudRequest(
  auth: CloudAuthContext | undefined,
  workspace: CloudWorkspaceContext | undefined,
  options: CloudRequestValidationOptions = {},
): CloudRequestValidationResult {
  const authResult = validateAuthContext(auth);
  if (!authResult.ok) {
    return authResult;
  }

  const workspaceResult = validateWorkspaceContext(workspace, {
    requireProject: options.requireProject,
  });
  if (!workspaceResult.ok) {
    return workspaceResult;
  }

  const modeResult = validateRequestMode(options.mode);
  if (!modeResult.ok) {
    return modeResult;
  }

  let providerConnection: ProviderConnectionState | undefined;
  if (options.requiredProvider) {
    const providerResult = validateProviderConnectionState(
      options.providerConnection,
      options.requiredProvider,
    );
    if (!providerResult.ok) {
      return providerResult;
    }
    providerConnection = providerResult.connection;
  }

  return {
    ok: true,
    auth: authResult.context,
    workspace: {
      workspaceId: workspaceResult.workspaceId,
      projectId: workspaceResult.projectId,
      environment: workspaceResult.environment,
    },
    mode: modeResult.mode,
    providerConnection,
  };
}
