/**
 * Cloud generate request types for POST /api/v1/ricky/workflows/generate.
 *
 * Every Cloud request requires explicit auth and workspace context —
 * there is no implicit fallback or ambient credential resolution.
 */

// ---------------------------------------------------------------------------
// Auth context — required on every Cloud request
// ---------------------------------------------------------------------------

export interface CloudAuthContext {
  /** Bearer token or API key for the Cloud API. */
  token: string;
  /** Optional token type hint (default: 'bearer'). */
  tokenType?: 'bearer' | 'api-key';
}

// ---------------------------------------------------------------------------
// Workspace context — scopes the request to a Cloud workspace
// ---------------------------------------------------------------------------

export interface CloudWorkspaceContext {
  /** The workspace ID this request targets. */
  workspaceId: string;
  /** Optional environment override (e.g. 'staging', 'production'). */
  environment?: string;
}

// ---------------------------------------------------------------------------
// Generate request body
// ---------------------------------------------------------------------------

export type CloudGenerateMode = 'cloud' | 'both';

export type CloudAutoFixApprovalBoundary =
  | 'code_push'
  | 'pr_create'
  | 'secrets'
  | 'billing'
  | 'external_write';

export interface CloudNaturalLanguageSpecPayload {
  kind: 'natural-language';
  text: string;
}

export interface CloudStructuredSpecPayload {
  kind: 'structured';
  document: Record<string, unknown>;
  format?: 'json' | 'yaml' | 'ricky-workflow';
}

export type CloudWorkflowSpecPayload =
  | string
  | CloudNaturalLanguageSpecPayload
  | CloudStructuredSpecPayload;

export interface CloudRickyAutoFixPolicy {
  /** Whether Ricky should diagnose and repair failed Cloud workflow runs. */
  enabled: boolean;
  /** Maximum bounded repair attempts when auto-fix is enabled. */
  maxAttempts?: number;
  /** Prefer AgentWorkforce's workflow-writer persona during repair. */
  preferWorkforcePersona?: boolean;
  /** Allow Cloud to fall back to OpenRouter when configured primary agents fail. */
  allowOpenRouterFallback?: boolean;
  /** Destructive or externally-visible actions that still require a human. */
  requireHumanApprovalFor?: CloudAutoFixApprovalBoundary[];
}

export interface CloudGenerateRequestBody {
  /** The natural-language prompt or structured workflow spec to generate from. */
  spec: CloudWorkflowSpecPayload;
  /** Optional file path hint for the spec origin. */
  specPath?: string;
  /** Execution mode — Cloud-only or both (local + Cloud). */
  mode?: CloudGenerateMode;
  /** Ricky supervision policy for executing existing workflow artifacts in Cloud. */
  autoFix?: CloudRickyAutoFixPolicy;
  /** Opaque metadata from the originating surface. */
  metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Full Cloud generate request — what the endpoint handler receives
// ---------------------------------------------------------------------------

export interface CloudGenerateRequest {
  /** Auth context — always required, never implicit. */
  auth: CloudAuthContext;
  /** Workspace scope — always required. */
  workspace: CloudWorkspaceContext;
  /** Request body with the spec and options. */
  body: CloudGenerateRequestBody;
}
