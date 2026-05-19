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

import type {
  CloudGenerateMode,
  CloudGenerateRequest,
  CloudGenerationMode,
} from './request-types.js';
import type {
  CloudAssumption,
  CloudArtifact,
  CloudArtifactBundle,
  CloudFollowUpAction,
  CloudGenerateResponse,
  CloudRunReceipt,
  CloudValidationStatus,
  CloudWarning,
} from './response-types.js';
import type { WorkforcePersonaGenerationMetadata } from '../../product/generation/index.js';
import { validateCloudRequest } from '../auth/request-validator.js';

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

const VALID_GENERATION_MODES = new Set<CloudGenerationMode>([
  'generate-only',
  'generate-and-return-artifacts',
  'generate-and-run',
]);

function passedValidation(): CloudValidationStatus {
  return { ok: true, status: 'passed', issues: [] };
}

function missingGeneratedArtifactsValidation(
  validation: CloudValidationStatus | undefined,
): CloudValidationStatus {
  const issues = validation?.ok === false ? validation.issues : [];
  return {
    ok: false,
    status: 'failed',
    issues: [
      ...issues,
      {
        code: 'missing-generated-artifacts',
        message: 'Cloud generation produced no workflow artifacts.',
        path: 'artifacts',
      },
    ],
  };
}

function failedValidation(code: string, message: string, path: string): CloudValidationStatus {
  return { ok: false, status: 'failed', issues: [{ code, message, path }] };
}

function skippedValidation(): CloudValidationStatus {
  // Validation never ran (e.g., executor threw before producing a result).
  // Reporting `passed` would falsely claim the artifact bundle was checked.
  return { ok: false, status: 'skipped', issues: [] };
}

function notRequestedRunReceipt(requestId: string): CloudRunReceipt {
  return {
    executionRequested: false,
    requestId,
    status: 'not_requested',
  };
}

function runRequestedReceipt(requestId: string): CloudRunReceipt {
  return {
    executionRequested: true,
    requestId,
    status: 'skipped',
  };
}

function defaultRunReceipt(requestId: string, generationMode: CloudGenerationMode): CloudRunReceipt {
  return generationMode === 'generate-and-run'
    ? runRequestedReceipt(requestId)
    : notRequestedRunReceipt(requestId);
}

function resolveGenerationMode(
  generationMode: CloudGenerateRequest['body']['generationMode'],
): CloudGenerationMode {
  return generationMode ?? 'generate-and-return-artifacts';
}

function resolveTargetMode(mode: CloudGenerateRequest['body']['mode']): CloudGenerateMode {
  return mode ?? 'cloud';
}

function artifactBundle(
  artifacts: CloudArtifact[],
  request: CloudGenerateRequest,
): CloudArtifactBundle {
  return {
    artifacts,
    generationMode: resolveGenerationMode(request.body.generationMode),
    targetMode: resolveTargetMode(request.body.mode),
  };
}

function safeBundleMode(
  request: CloudGenerateRequest | undefined,
): { generationMode: CloudGenerationMode; targetMode: CloudGenerateMode } {
  // Echo the caller's requested mode only when it parses cleanly; invalid
  // values fall back to defaults so a shape-rejection response never carries
  // forward an unrecognized enum.
  const mode = request?.body?.mode;
  const targetMode: CloudGenerateMode =
    mode === 'cloud' || mode === 'both' ? mode : 'cloud';
  const generationMode = request?.body?.generationMode;
  const resolvedGenerationMode: CloudGenerationMode =
    generationMode !== undefined && VALID_GENERATION_MODES.has(generationMode)
      ? generationMode
      : 'generate-and-return-artifacts';
  return { generationMode: resolvedGenerationMode, targetMode };
}

function errorResponse(
  requestId: string,
  status: number,
  message: string,
  validation: CloudValidationStatus,
  request: CloudGenerateRequest | undefined,
): CloudGenerateResponse {
  const bundleMode = safeBundleMode(request);
  return {
    ok: false,
    status,
    artifacts: [],
    artifactBundle: {
      artifacts: [],
      ...bundleMode,
    },
    warnings: [{ severity: 'error', message }],
    assumptions: [],
    validation,
    runReceipt: defaultRunReceipt(requestId, bundleMode.generationMode),
    followUpActions: [],
    requestId,
  };
}

function executorFailureWarning(requestId: string): CloudWarning {
  return {
    severity: 'error',
    message: `Cloud generation failed before validation completed. Retry the request or contact support with request ID ${requestId}.`,
  };
}

function missingGeneratedArtifactsWarning(): CloudWarning {
  return {
    severity: 'error',
    message: 'Cloud generation produced no workflow artifacts; the generation runtime may not be wired.',
  };
}

function warningsWithMissingArtifactBlocker(warnings: CloudWarning[]): CloudWarning[] {
  if (warnings.some((warning) => warning.severity === 'error')) {
    return warnings;
  }
  return [missingGeneratedArtifactsWarning(), ...warnings];
}

function followUpsWithRuntimeWiringAction(
  followUpActions: CloudFollowUpAction[],
): CloudFollowUpAction[] {
  if (followUpActions.length > 0) {
    return followUpActions;
  }
  return [
    {
      action: 'wire-runtime',
      label: 'Wire Cloud Runtime',
      description: 'Connect a generation runtime that returns validated workflow artifacts.',
    },
  ];
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
  request: CloudGenerateRequest | undefined,
): ValidationFailure {
  return {
    ok: false,
    response: errorResponse(
      requestId,
      status,
      message,
      failedValidation(code, message, path),
      request,
    ),
  };
}

function validateRequest(
  request: CloudGenerateRequest,
  requestId: string,
): ValidationResult {
  // Production wiring starts at the canonical Cloud request validator:
  // validateCloudRequest -> spec intake -> generation pipeline -> result mapping.
  // The validator returns discriminated `code` + `path` so we never have to
  // recover them by matching against the user-facing error string.
  const cloudRequestResult = validateCloudRequest(request?.auth, request?.workspace, {
    mode: request?.body?.mode,
  });
  if (!cloudRequestResult.ok) {
    return validationFailure(
      requestId,
      cloudRequestResult.status,
      cloudRequestResult.error,
      cloudRequestResult.code,
      cloudRequestResult.path,
      request,
    );
  }

  if (!hasSpecPayload(request?.body?.spec)) {
    return validationFailure(
      requestId,
      400,
      'Missing or empty spec in request body.',
      'missing-spec',
      'body.spec',
      request,
    );
  }

  const generationMode = request?.body?.generationMode;
  if (generationMode !== undefined && !VALID_GENERATION_MODES.has(generationMode)) {
    return validationFailure(
      requestId,
      400,
      'Invalid generation mode.',
      'invalid-generation-mode',
      'body.generationMode',
      request,
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
    const producedArtifacts = result.artifacts.length > 0;
    const resultValidation = producedArtifacts
      ? result.validation ?? passedValidation()
      : missingGeneratedArtifactsValidation(result.validation);
    const validationPassed = resultValidation.ok !== false;
    const artifacts = producedArtifacts
      ? appendGenerationMetadataArtifacts(result.artifacts, result.generationMetadata)
      : result.artifacts;
    const generationMode = resolveGenerationMode(request.body.generationMode);
    return {
      ok: validationPassed,
      status: validationPassed ? 200 : result.validation?.ok === false ? 422 : 500,
      artifacts,
      artifactBundle: artifactBundle(artifacts, request),
      warnings: producedArtifacts ? result.warnings : warningsWithMissingArtifactBlocker(result.warnings),
      assumptions: result.assumptions ?? [],
      validation: resultValidation,
      runReceipt: {
        ...defaultRunReceipt(requestId, generationMode),
        ...result.runReceipt,
        requestId,
      },
      followUpActions: producedArtifacts
        ? result.followUpActions
        : followUpsWithRuntimeWiringAction(result.followUpActions),
      requestId,
    };
  } catch {
    return {
      ok: false,
      status: 500,
      artifacts: [],
      artifactBundle: artifactBundle([], request),
      warnings: [executorFailureWarning(requestId)],
      assumptions: [],
      validation: skippedValidation(),
      runReceipt: defaultRunReceipt(requestId, resolveGenerationMode(request.body.generationMode)),
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
