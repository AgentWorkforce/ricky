/**
 * Cloud Generate endpoint – pure request→response handler.
 * Route: POST /api/v1/ricky/workflows/generate
 */

import type { CloudGenerateRequest } from './request-types.js';
import type { CloudGenerateResponse } from './response-types.js';

export const CLOUD_GENERATE_ROUTE = 'POST /api/v1/ricky/workflows/generate' as const;

/** Injectable executor interface – seam between endpoint and Cloud runtime. */
export interface CloudExecutor {
  execute(request: CloudGenerateRequest): Promise<CloudGenerateResponse>;
}

export interface HandleCloudGenerateOptions {
  executor?: CloudExecutor;
  generateRequestId?: () => string;
}

function validateRequest(
  request: CloudGenerateRequest,
): string | null {
  if (!request.auth?.token) {
    return 'Missing auth token';
  }
  if (!request.workspace?.workspaceId) {
    return 'Missing workspace ID';
  }
  if (!request.body?.spec) {
    return 'Missing spec payload';
  }
  return null;
}

function makeErrorResponse(error: string, requestId: string, now: string): CloudGenerateResponse {
  return {
    ok: false,
    artifacts: [],
    warnings: [],
    assumptions: [],
    followUpActions: [],
    validation: { valid: false, issues: [{ field: 'request', message: error }] },
    receipt: {
      requestId,
      startedAt: now,
      completedAt: now,
      durationMs: 0,
    },
    error,
  };
}

/** Default stub executor – returns an empty successful response. */
export const defaultExecutor: CloudExecutor = {
  async execute(request: CloudGenerateRequest): Promise<CloudGenerateResponse> {
    const now = new Date().toISOString();
    return {
      ok: true,
      artifacts: [],
      warnings: [{ code: 'STUB', message: 'Default stub executor – no Cloud runtime wired' }],
      assumptions: [],
      followUpActions: [],
      validation: { valid: true, issues: [] },
      receipt: {
        requestId: request.requestId ?? 'default',
        startedAt: now,
        completedAt: now,
        durationMs: 0,
      },
    };
  },
};

/**
 * Pure handler – no server dependency. Transport binding is the caller's responsibility.
 */
export async function handleCloudGenerate(
  request: CloudGenerateRequest,
  options: HandleCloudGenerateOptions = {},
): Promise<CloudGenerateResponse> {
  const genId = options.generateRequestId ?? (() => crypto.randomUUID());
  const requestId = request.requestId ?? genId();
  const now = new Date().toISOString();

  const validationError = validateRequest(request);
  if (validationError) {
    return makeErrorResponse(validationError, requestId, now);
  }

  const executor = options.executor ?? defaultExecutor;

  try {
    const response = await executor.execute({ ...request, requestId });
    return response;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return makeErrorResponse(`Executor error: ${message}`, requestId, now);
  }
}
