/**
 * Ricky Cloud generate endpoint handler.
 *
 * Bounded Cloud generate contract around POST /api/v1/ricky/workflows/generate.
 * Requires explicit auth and workspace context — no implicit credential
 * resolution or ambient Cloud runtime dependency.
 *
 * This module is a pure request→response handler. It does NOT start a server
 * or depend on a live Cloud runtime. Transport binding (Express, Hono, etc.)
 * is the caller's responsibility.
 */

import type { CloudGenerateRequest } from './request-types';
import type {
  CloudArtifact,
  CloudFollowUpAction,
  CloudGenerateResponse,
  CloudWarning,
} from './response-types';

// ---------------------------------------------------------------------------
// Route constant
// ---------------------------------------------------------------------------

export const CLOUD_GENERATE_ROUTE = '/api/v1/ricky/workflows/generate' as const;

// ---------------------------------------------------------------------------
// Cloud executor — injectable seam for actual generation work
// ---------------------------------------------------------------------------

export interface CloudGenerateResult {
  artifacts: CloudArtifact[];
  warnings: CloudWarning[];
  followUpActions: CloudFollowUpAction[];
}

/**
 * The executor is the seam between the endpoint handler and actual Cloud work.
 * Inject a fake in tests; wire the real Cloud runtime in production.
 */
export interface CloudExecutor {
  generate(request: CloudGenerateRequest): Promise<CloudGenerateResult>;
}

// ---------------------------------------------------------------------------
// Default executor stub — keeps the endpoint functional before the full
// Cloud runtime adapter is wired.
// ---------------------------------------------------------------------------

export const defaultCloudExecutor: CloudExecutor = {
  async generate(request: CloudGenerateRequest): Promise<CloudGenerateResult> {
    const warnings: CloudWarning[] = [];
    const followUpActions: CloudFollowUpAction[] = [];

    warnings.push({
      severity: 'info',
      message: `Cloud generate stub: received spec (${request.body.spec.length} chars) for workspace ${request.workspace.workspaceId}.`,
    });

    followUpActions.push({
      action: 'wire-runtime',
      label: 'Wire Cloud Runtime',
      description: 'Connect the real Cloud generation runtime to replace this stub.',
    });

    if (request.body.mode === 'both') {
      followUpActions.push({
        action: 'run-local',
        label: 'Run Local',
        description: 'Also run the local/BYOH pipeline for validation before Cloud deploy.',
      });
    }

    return { artifacts: [], warnings, followUpActions };
  },
};

// ---------------------------------------------------------------------------
// Request validation
// ---------------------------------------------------------------------------

interface ValidationFailure {
  ok: false;
  response: CloudGenerateResponse;
}

interface ValidationSuccess {
  ok: true;
}

type ValidationResult = ValidationFailure | ValidationSuccess;

function generateRequestId(): string {
  return `ricky-cloud-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function validateRequest(
  request: CloudGenerateRequest,
  requestId: string,
): ValidationResult {
  // Auth is required and must have a non-empty token
  if (!request.auth?.token) {
    return {
      ok: false,
      response: {
        ok: false,
        status: 401,
        artifacts: [],
        warnings: [{ severity: 'error', message: 'Missing or empty auth token.' }],
        followUpActions: [],
        requestId,
      },
    };
  }

  // Workspace is required
  if (!request.workspace?.workspaceId) {
    return {
      ok: false,
      response: {
        ok: false,
        status: 400,
        artifacts: [],
        warnings: [{ severity: 'error', message: 'Missing or empty workspace ID.' }],
        followUpActions: [],
        requestId,
      },
    };
  }

  // Body spec is required
  if (!request.body?.spec) {
    return {
      ok: false,
      response: {
        ok: false,
        status: 400,
        artifacts: [],
        warnings: [{ severity: 'error', message: 'Missing or empty spec in request body.' }],
        followUpActions: [],
        requestId,
      },
    };
  }

  return { ok: true };
}

// ---------------------------------------------------------------------------
// Endpoint handler options
// ---------------------------------------------------------------------------

export interface CloudGenerateEndpointOptions {
  executor?: CloudExecutor;
  /** Override request ID generation for deterministic tests. */
  requestIdFactory?: () => string;
}

// ---------------------------------------------------------------------------
// Endpoint handler
// ---------------------------------------------------------------------------

/**
 * Handle a Cloud generate request.
 *
 * 1. Validates auth, workspace, and body.
 * 2. Delegates to the injected executor.
 * 3. Returns the unified Cloud response contract.
 *
 * This is a pure function — no server, no middleware, no Cloud runtime dependency.
 */
export async function handleCloudGenerate(
  request: CloudGenerateRequest,
  options: CloudGenerateEndpointOptions = {},
): Promise<CloudGenerateResponse> {
  const { executor = defaultCloudExecutor, requestIdFactory = generateRequestId } = options;
  const requestId = requestIdFactory();

  // Validate
  const validation = validateRequest(request, requestId);
  if (!validation.ok) {
    return validation.response;
  }

  // Execute
  try {
    const result = await executor.generate(request);
    return {
      ok: true,
      status: 200,
      artifacts: result.artifacts,
      warnings: result.warnings,
      followUpActions: result.followUpActions,
      requestId,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      status: 500,
      artifacts: [],
      warnings: [{ severity: 'error', message: `Cloud generation failed: ${message}` }],
      followUpActions: [
        { action: 'retry', label: 'Retry', description: 'Retry the Cloud generate request.' },
      ],
      requestId,
    };
  }
}
