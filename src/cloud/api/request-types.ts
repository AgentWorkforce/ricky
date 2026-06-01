/**
 * Cloud generate request types for POST /api/v1/ricky/workflows/generate.
 *
 * Every Cloud request requires explicit auth and workspace context —
 * there is no implicit fallback or ambient credential resolution.
 */

import type {
  CloudAuthContext as CanonicalCloudAuthContext,
  CloudRequestMode,
  CloudWorkspaceContext as CanonicalCloudWorkspaceContext,
} from '../auth/types.js';

// ---------------------------------------------------------------------------
// Auth and workspace context — required on every Cloud request
// ---------------------------------------------------------------------------

export type CloudAuthContext = CanonicalCloudAuthContext;
export type CloudWorkspaceContext = CanonicalCloudWorkspaceContext;

// ---------------------------------------------------------------------------
// Generate request body
// ---------------------------------------------------------------------------

export type CloudGenerateMode = CloudRequestMode;

export type CloudGenerationMode =
  | 'generate-only'
  | 'generate-and-return-artifacts'
  | 'generate-and-run';

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
  format?: CloudStructuredSpecFormat;
}

export type CloudWorkflowSpecPayload =
  | string
  | CloudNaturalLanguageSpecPayload
  | CloudStructuredSpecPayload;

export type CloudStructuredSpecFormat = 'json' | 'yaml' | 'ricky-workflow';

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
  /** Target routing mode — Cloud-only or both local/BYOH + Cloud artifact paths. */
  mode?: CloudGenerateMode;
  /** Generation behavior — generate only, return artifacts, or request Cloud execution. */
  generationMode?: CloudGenerationMode;
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
