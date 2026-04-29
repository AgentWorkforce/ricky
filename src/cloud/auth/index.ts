export type {
  AuthValidationResult,
  AuthorizedWorkspaceScope,
  AuthorizedWorkspaceScopeResult,
  CloudAuthContext,
  CloudRequestMode,
  CloudRequestValidationOptions,
  CloudRequestValidationResult,
  CloudTokenType,
  CloudWorkspaceContext,
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

export { getProviderConnectGuidance } from './provider-connect.js';
