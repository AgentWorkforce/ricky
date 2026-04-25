/**
 * Ricky local/BYOH entrypoint.
 *
 * Ties together request normalization, spec intake, workflow generation,
 * and local runtime coordination. Returns artifacts, logs, warnings, and
 * suggested next actions — without routing through Cloud by default.
 */

import type { ArtifactReader, LocalInvocationRequest, RawHandoff } from './request-normalizer';
import { normalizeRequest } from './request-normalizer';

// ---------------------------------------------------------------------------
// Local response contract
// ---------------------------------------------------------------------------

export interface LocalResponseArtifact {
  /** Relative path to the generated or consumed artifact. */
  path: string;
  /** MIME type hint (e.g. 'text/typescript', 'application/json'). */
  type?: string;
  /** Artifact content when available inline. */
  content?: string;
}

export interface LocalResponse {
  /** Whether the local invocation succeeded. */
  ok: boolean;
  /** Generated or consumed artifacts. */
  artifacts: LocalResponseArtifact[];
  /** Structured log entries from the local run. */
  logs: string[];
  /** Non-fatal warnings surfaced during execution. */
  warnings: string[];
  /** Suggested next actions for the user. */
  nextActions: string[];
}

// ---------------------------------------------------------------------------
// Execution adapter — injectable seam for generation + runtime coordination
// ---------------------------------------------------------------------------

/**
 * The executor is the seam between the entrypoint and actual work.
 * Inject a fake in tests; wire the real agent-relay runtime in production.
 */
export interface LocalExecutor {
  /**
   * Run the local workflow generation and execution pipeline.
   * Receives the normalized request and returns the local response contract.
   */
  execute(request: LocalInvocationRequest): Promise<LocalResponse>;
}

// ---------------------------------------------------------------------------
// Default executor stub — keeps the entrypoint functional before the full
// agent-relay runtime adapter is wired.
// ---------------------------------------------------------------------------

export const defaultExecutor: LocalExecutor = {
  async execute(request: LocalInvocationRequest): Promise<LocalResponse> {
    const artifacts: LocalResponseArtifact[] = [];
    const logs: string[] = [];
    const warnings: string[] = [];
    const nextActions: string[] = [];

    logs.push(`[local] received spec from ${request.source}`);
    logs.push(`[local] mode: ${request.mode}`);

    if (request.specPath) {
      logs.push(`[local] spec path: ${request.specPath}`);
    }

    if (request.mode === 'cloud') {
      warnings.push(
        'Cloud mode was requested but this is the local/BYOH entrypoint. ' +
          'Use the Cloud API surface for hosted execution.',
      );
      nextActions.push('Switch to Cloud API or re-invoke with mode=local.');
      return { ok: false, artifacts, logs, warnings, nextActions };
    }

    // Stub: in production this calls the agent-relay local runtime
    logs.push('[local] spec intake complete');
    logs.push('[local] workflow generation: stub (wire agent-relay runtime)');

    nextActions.push('Wire the agent-relay local runtime adapter to execute generated workflows.');
    if (request.mode === 'both') {
      nextActions.push('After local validation, optionally promote to Cloud execution.');
    }

    return { ok: true, artifacts, logs, warnings, nextActions };
  },
};

// ---------------------------------------------------------------------------
// Entrypoint options
// ---------------------------------------------------------------------------

export interface LocalEntrypointOptions {
  executor?: LocalExecutor;
  artifactReader?: ArtifactReader;
}

// ---------------------------------------------------------------------------
// Entrypoint
// ---------------------------------------------------------------------------

/**
 * Main local/BYOH entrypoint.
 *
 * 1. Normalizes the raw handoff into a LocalInvocationRequest.
 * 2. Validates that the request is suitable for local execution.
 * 3. Delegates to the executor for generation + runtime coordination.
 * 4. Returns the unified local response contract.
 */
export async function runLocal(
  handoff: RawHandoff,
  options: LocalEntrypointOptions = {},
): Promise<LocalResponse> {
  const { executor = defaultExecutor, artifactReader } = options;

  // Normalize
  let request: LocalInvocationRequest;
  try {
    request = await normalizeRequest(handoff, artifactReader);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      artifacts: [],
      logs: [`[local] normalization failed: ${message}`],
      warnings: [`Failed to normalize handoff from source '${handoff.source}'.`],
      nextActions: ['Check the spec content or artifact path and retry.'],
    };
  }

  // Validate: local/BYOH entrypoint should not silently route to Cloud
  const warnings: string[] = [];
  if (request.mode === 'cloud') {
    warnings.push(
      'This is the local/BYOH entrypoint. Cloud-only requests should use the Cloud API surface.',
    );
  }

  // Execute
  const response = await executor.execute(request);

  // Merge any entrypoint-level warnings
  if (warnings.length > 0) {
    response.warnings.unshift(...warnings);
  }

  return response;
}
