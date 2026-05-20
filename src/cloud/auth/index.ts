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
export type { WorkspaceScopedQuery } from './workspace-scoping.js';

export {
  CLOUD_INTEGRATIONS_DASHBOARD_URL,
  GITHUB_CONNECT_GUIDANCE,
  GITHUB_CONNECT_INSTRUCTIONS,
  GOOGLE_CONNECT_GUIDANCE,
  GOOGLE_CONNECT_COMMAND,
  GOOGLE_CONNECT_INSTRUCTIONS,
  LINEAR_CONNECT_GUIDANCE,
  LINEAR_CONNECT_DASHBOARD_URL,
  LINEAR_CONNECT_INSTRUCTIONS,
  NOTION_CONNECT_GUIDANCE,
  SLACK_CONNECT_GUIDANCE,
  getProviderConnectGuidance,
} from './provider-connect.js';
