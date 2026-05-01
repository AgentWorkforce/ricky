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

export type AuthValidationResult =
  | { ok: true; context: CloudAuthContext }
  | { ok: false; error: string; status: number };

export type WorkspaceScopingResult =
  | { ok: true; workspaceId: string; projectId?: string; environment?: string }
  | { ok: false; error: string; status: number };

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
  | { ok: false; error: string; status: number };

export type ProviderType = 'google' | 'github' | 'slack' | 'notion' | 'linear';

export interface ProviderConnectionState {
  provider: ProviderType;
  connected: boolean;
}

export type ProviderConnectionValidationResult =
  | { ok: true; connection: ProviderConnectionState }
  | { ok: false; error: string; status: number };

export type CloudRequestValidationResult =
  | {
      ok: true;
      auth: CloudAuthContext;
      workspace: CloudWorkspaceContext;
      mode: CloudRequestMode;
      providerConnection?: ProviderConnectionState;
    }
  | { ok: false; error: string; status: number };

export interface CloudRequestValidationOptions {
  /** Request execution mode. Defaults to 'cloud'. */
  mode?: CloudRequestMode | string;
  /** Require a non-empty projectId in the workspace context. */
  requireProject?: boolean;
  /** Require a connected provider before accepting the request. */
  requiredProvider?: ProviderType;
  /** Current provider connection state for provider-backed requests. */
  providerConnection?: ProviderConnectionState;
}

export interface ProviderConnectGuidance {
  provider: ProviderType;
  command?: string;
  dashboardUrl?: string;
  instructions: string[];
}
