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

import type { CloudGenerateRequest } from './request-types.js';
import type {
  CloudAssumption,
  CloudArtifact,
  CloudFollowUpAction,
  CloudGenerateResponse,
  CloudRunReceipt,
  CloudValidationStatus,
  CloudWarning,
} from './response-types.js';
import type { WorkforcePersonaGenerationMetadata } from '../../product/generation/index.js';
import {
  validateAuthContext,
  validateRequestMode,
  validateWorkspaceContext,
} from '../auth/request-validator.js';

// ---------------------------------------------------------------------------
// Route constant
// ---------------------------------------------------------------------------

export const CLOUD_GENERATE_ROUTE = '/api/v1/ricky/workflows/generate' as const;
export const CLOUD_GENERATE_METHOD = 'POST' as const;

// ---------------------------------------------------------------------------
// Cloud executor — injectable seam for actual generation work
// ---------------------------------------------------------------------------

export interface CloudGenerateResult {
  artifacts: CloudArtifact[];
  warnings: CloudWarning[];
  assumptions?: CloudAssumption[];
  validation?: CloudValidationStatus;
  runReceipt?: Omit<CloudRunReceipt, 'requestId'>;
  generationMetadata?: {
    workforcePersona?: WorkforcePersonaGenerationMetadata;
  };
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
    const assumptions: CloudAssumption[] = [];
    const followUpActions: CloudFollowUpAction[] = [];
    const specLength = describeSpec(request.body.spec).length;

    warnings.push({
      severity: 'info',
      message: `Cloud generate stub: received spec (${specLength} chars) for workspace ${request.workspace.workspaceId}.`,
    });

    assumptions.push({
      key: 'runtime-not-wired',
      message: 'The Cloud generation runtime is not wired yet, so no workflow artifacts were produced.',
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

    return { artifacts: [], warnings, assumptions, followUpActions };
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

function passedValidation(): CloudValidationStatus {
  return { ok: true, status: 'passed', issues: [] };
}

function failedValidation(code: string, message: string, path: string): CloudValidationStatus {
  return { ok: false, status: 'failed', issues: [{ code, message, path }] };
}

function notRequestedRunReceipt(requestId: string): CloudRunReceipt {
  return {
    executionRequested: false,
    requestId,
    status: 'not_requested',
  };
}

function errorResponse(
  requestId: string,
  status: number,
  message: string,
  validation: CloudValidationStatus,
): CloudGenerateResponse {
  return {
    ok: false,
    status,
    artifacts: [],
    warnings: [{ severity: 'error', message }],
    assumptions: [],
    validation,
    runReceipt: notRequestedRunReceipt(requestId),
    followUpActions: [],
    requestId,
  };
}

function describeSpec(spec: CloudGenerateRequest['body']['spec']): string {
  if (typeof spec === 'string') {
    return spec;
  }

  if (spec && typeof spec === 'object' && (spec as { kind?: string }).kind === 'natural-language') {
    const text = (spec as { text?: unknown }).text;
    return typeof text === 'string' ? text : '';
  }

  if (spec && typeof spec === 'object' && (spec as { kind?: string }).kind === 'structured') {
    const document = (spec as { document?: unknown }).document;
    return document && typeof document === 'object' ? JSON.stringify(document) : '';
  }

  return '';
}

function hasSpecPayload(spec: unknown): boolean {
  if (typeof spec === 'string') {
    return spec.trim().length > 0;
  }

  if (!spec || typeof spec !== 'object') {
    return false;
  }

  const kind = (spec as { kind?: unknown }).kind;

  if (kind === 'natural-language') {
    const text = (spec as { text?: unknown }).text;
    return typeof text === 'string' && text.trim().length > 0;
  }

  if (kind === 'structured') {
    const document = (spec as { document?: unknown }).document;
    return (
      !!document &&
      typeof document === 'object' &&
      !Array.isArray(document) &&
      Object.keys(document as Record<string, unknown>).length > 0
    );
  }

  return false;
}

function validationFailure(
  requestId: string,
  status: number,
  message: string,
  code: string,
  path: string,
): ValidationFailure {
  return {
    ok: false,
    response: errorResponse(
      requestId,
      status,
      message,
      failedValidation(code, message, path),
    ),
  };
}

function authIssueDescriptor(error: string): { code: string; path: string } {
  if (error.toLowerCase().includes('token type')) {
    return { code: 'invalid-auth-token-type', path: 'auth.tokenType' };
  }
  return { code: 'missing-auth-token', path: 'auth.token' };
}

function workspaceIssueDescriptor(error: string): { code: string; path: string } {
  const lower = error.toLowerCase();
  if (lower.includes('project id')) {
    return { code: 'invalid-project-id', path: 'workspace.projectId' };
  }
  if (lower.includes('environment')) {
    return { code: 'invalid-environment', path: 'workspace.environment' };
  }
  return { code: 'missing-workspace-id', path: 'workspace.workspaceId' };
}

function validateRequest(
  request: CloudGenerateRequest,
  requestId: string,
): ValidationResult {
  const authResult = validateAuthContext(request?.auth);
  if (!authResult.ok) {
    const { code, path } = authIssueDescriptor(authResult.error);
    return validationFailure(requestId, authResult.status, authResult.error, code, path);
  }

  const workspaceResult = validateWorkspaceContext(request?.workspace);
  if (!workspaceResult.ok) {
    const { code, path } = workspaceIssueDescriptor(workspaceResult.error);
    return validationFailure(requestId, workspaceResult.status, workspaceResult.error, code, path);
  }

  const modeResult = validateRequestMode(request?.body?.mode);
  if (!modeResult.ok) {
    return validationFailure(requestId, modeResult.status, modeResult.error, 'invalid-mode', 'body.mode');
  }

  if (!hasSpecPayload(request?.body?.spec)) {
    return validationFailure(
      requestId,
      400,
      'Missing or empty spec in request body.',
      'missing-spec',
      'body.spec',
    );
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
    const resultValidation = result.validation ?? passedValidation();
    const validationPassed = resultValidation.ok !== false;
    const artifacts = appendGenerationMetadataArtifacts(result.artifacts, result.generationMetadata);
    return {
      ok: validationPassed,
      status: validationPassed ? 200 : 422,
      artifacts,
      warnings: result.warnings,
      assumptions: result.assumptions ?? [],
      validation: resultValidation,
      runReceipt: {
        ...notRequestedRunReceipt(requestId),
        ...result.runReceipt,
        requestId,
      },
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
      assumptions: [],
      validation: passedValidation(),
      runReceipt: notRequestedRunReceipt(requestId),
      followUpActions: [
        { action: 'retry', label: 'Retry', description: 'Retry the Cloud generate request.' },
      ],
      requestId,
    };
  }
}

function appendGenerationMetadataArtifacts(
  artifacts: CloudArtifact[],
  metadata: CloudGenerateResult['generationMetadata'] | undefined,
): CloudArtifact[] {
  if (!metadata?.workforcePersona) return artifacts;
  const workflowArtifact = artifacts.find((artifact) => artifact.type === 'text/typescript') ?? artifacts[0];
  const basePath = workflowArtifact?.path.replace(/\.(?:ts|js|yaml|yml)$/i, '') ?? 'workflows/generated/workflow';
  return [
    ...artifacts,
    {
      path: `${basePath}.workforce-persona.json`,
      type: 'application/json',
      content: `${JSON.stringify(metadata.workforcePersona, null, 2)}\n`,
    },
  ];
}
