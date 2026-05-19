export { PROVIDER_TYPES } from './types.js';
export type {
  AuthValidationResult,
  AuthorizedWorkspaceScope,
  AuthorizedWorkspaceScopeResult,
  CloudAuthContext,
  CloudRequestMode,
  CloudRequestValidationOptions,
  CloudRequestValidationResult,
  CloudTokenType,
  CloudValidationErrorCode,
  CloudValidationErrorPath,
  CloudValidationFailure,
  CloudWorkspaceContext,
  ProviderConnectCliGuidance,
  ProviderConnectDashboardGuidance,
  ProviderConnectGuidance,
  ProviderConnectionState,
  ProviderConnectionValidationResult,
  ProviderType,
  RequestModeValidationResult,
  WorkspaceScopingResult,
} from './types.js';

export {
  validateAuthContext,
  validateCloudRequest,
  validateProviderConnectionState,
  validateRequestMode,
  validateWorkspaceContext,
} from './request-validator.js';

export {
  WorkspaceScopingError,
  assertWorkspaceMatch,
  createWorkspaceScopedQuery,
  resolveAuthorizedWorkspaceScope,
  scopeToWorkspace,
} from './workspace-scoping.js';

export {
  CLOUD_INTEGRATIONS_DASHBOARD_URL,
  GITHUB_CONNECT_INSTRUCTIONS,
  GOOGLE_CONNECT_COMMAND,
  LINEAR_CONNECT_DASHBOARD_URL,
  LINEAR_CONNECT_INSTRUCTIONS,
  getProviderConnectGuidance,
} from './provider-connect.js';
