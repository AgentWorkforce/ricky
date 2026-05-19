/**
 * Canonical Cloud auth, workspace, and provider-connect value types.
 *
 * These types intentionally have no runtime or Cloud service dependency so
 * endpoint handlers can validate request shape deterministically.
 */

export type CloudTokenType = 'bearer' | 'api-key';

export interface CloudAuthContext {
  /** Bearer token or API key for the Cloud API. */
  token: string;
  /** Optional token type hint (default: 'bearer'). */
  tokenType?: CloudTokenType;
}

export interface CloudWorkspaceContext {
  /** The workspace ID this request targets. */
  workspaceId: string;
  /** Optional project ID inside the workspace. */
  projectId?: string;
  /** Optional environment override (e.g. 'staging', 'production'). */
  environment?: string;
}

export type CloudRequestMode = 'cloud' | 'both';

/**
 * Discriminated error codes emitted by the Cloud request validators.
 *
 * Endpoints map these to their own response contracts. Adding a new code is a
 * type-level change downstream callers can keep current via exhaustiveness
 * checks instead of substring-matching the user-facing `error` string.
 */
export type CloudValidationErrorCode =
  | 'missing-auth-token'
  | 'invalid-auth-token-type'
  | 'missing-workspace-id'
  | 'invalid-project-id'
  | 'invalid-environment'
  | 'invalid-mode'
  | 'missing-provider-connection'
  | 'invalid-provider-connection'
  | 'provider-not-connected'
  | 'invalid-required-provider';

export type CloudValidationErrorPath =
  | 'auth.token'
  | 'auth.tokenType'
  | 'workspace.workspaceId'
  | 'workspace.projectId'
  | 'workspace.environment'
  | 'body.mode'
  | 'providerConnection';

export interface CloudValidationFailure {
  ok: false;
  error: string;
  status: number;
  code: CloudValidationErrorCode;
  path: CloudValidationErrorPath;
}

export type AuthValidationResult =
  | { ok: true; context: CloudAuthContext }
  | CloudValidationFailure;

export type WorkspaceScopingResult =
  | { ok: true; workspaceId: string; projectId?: string; environment?: string }
  | CloudValidationFailure;

export interface AuthorizedWorkspaceScope {
  workspaceId: string;
  projectId?: string;
  environment?: string;
}

export type AuthorizedWorkspaceScopeResult =
  | { ok: true; scope: AuthorizedWorkspaceScope }
  | { ok: false; error: string; status: number };

export type RequestModeValidationResult =
  | { ok: true; mode: CloudRequestMode }
  | CloudValidationFailure;

export const PROVIDER_TYPES = ['google', 'github', 'slack', 'notion', 'linear'] as const;

export type ProviderType = (typeof PROVIDER_TYPES)[number];

export interface ProviderConnectionState {
  provider: ProviderType;
  connected: boolean;
}

export type ProviderConnectionValidationResult =
  | { ok: true; connection: ProviderConnectionState }
  | CloudValidationFailure;

export type CloudRequestValidationResult =
  | {
      ok: true;
      auth: CloudAuthContext;
      workspace: CloudWorkspaceContext;
      mode: CloudRequestMode;
      providerConnection?: ProviderConnectionState;
    }
  | CloudValidationFailure;

export interface CloudRequestValidationOptions {
  /** Request execution mode. Defaults to 'cloud'. */
  mode?: CloudRequestMode | string;
  /** Require a non-empty projectId in the workspace context. */
  requireProject?: boolean;
  /** Require a connected provider before accepting the request. */
  requiredProvider?: ProviderType;
  /** Current provider connection state for provider-backed request input. */
  providerConnection?: ProviderConnectionState | null;
}

interface ProviderConnectGuidanceBase {
  provider: ProviderType;
  instructions: string[];
}

export interface ProviderConnectCliGuidance extends ProviderConnectGuidanceBase {
  kind: 'cli';
  command: string;
  dashboardUrl?: undefined;
}

export interface ProviderConnectDashboardGuidance extends ProviderConnectGuidanceBase {
  kind: 'dashboard';
  dashboardUrl: string;
  command?: undefined;
}

export type ProviderConnectGuidance = ProviderConnectCliGuidance | ProviderConnectDashboardGuidance;
