/**
 * Cloud generate response types for POST /api/v1/ricky/workflows/generate.
 *
 * The response always includes the artifact bundle, any warnings or
 * assumptions the generator made, and suggested follow-up actions.
 */

// ---------------------------------------------------------------------------
// Artifact bundle
// ---------------------------------------------------------------------------

export interface CloudArtifact {
  /** Relative path for the generated artifact. */
  path: string;
  /** MIME type hint (e.g. 'text/typescript', 'application/json'). */
  type?: string;
  /** Artifact content when returned inline. */
  content?: string;
}

// ---------------------------------------------------------------------------
// Follow-up action
// ---------------------------------------------------------------------------

export interface CloudFollowUpAction {
  /** Machine-readable action key (e.g. 'deploy', 'review', 'test'). */
  action: string;
  /** Human-readable label for the action. */
  label: string;
  /** Optional description with more detail. */
  description?: string;
}

// ---------------------------------------------------------------------------
// Warning / assumption entry
// ---------------------------------------------------------------------------

export interface CloudWarning {
  /** Warning severity. */
  severity: 'info' | 'warning' | 'error';
  /** Human-readable warning message. */
  message: string;
}

// ---------------------------------------------------------------------------
// Assumption entry
// ---------------------------------------------------------------------------

export interface CloudAssumption {
  /** Stable key for the assumption, useful for caller-side review UI. */
  key: string;
  /** Human-readable assumption made while interpreting the spec. */
  message: string;
}

// ---------------------------------------------------------------------------
// Validation status
// ---------------------------------------------------------------------------

export interface CloudValidationIssue {
  /** Machine-readable validation issue key. */
  code: string;
  /** Human-readable validation issue message. */
  message: string;
  /** Optional field path associated with the issue. */
  path?: string;
}

export interface CloudValidationStatus {
  /** Whether the request/spec passed endpoint-level validation. */
  ok: boolean;
  /** Validation lifecycle status for grepable API clients and tests. */
  status: 'passed' | 'failed' | 'skipped';
  /** Validation issues discovered before or during generation. */
  issues: CloudValidationIssue[];
}

// ---------------------------------------------------------------------------
// Run receipt
// ---------------------------------------------------------------------------

export interface CloudRunReceipt {
  /** Whether execution/run behavior was requested by the caller. */
  executionRequested: boolean;
  /** Request correlation ID for generation, and run correlation when no run exists. */
  requestId: string;
  /** Cloud run ID when a future generate-and-run flow queues execution. */
  runId?: string;
  /** Run status. Generate-only responses should use 'not_requested'. */
  status: 'not_requested' | 'queued' | 'running' | 'succeeded' | 'failed' | 'skipped';
  /** Optional link or route for retrieving run details. */
  receiptUrl?: string;
}

// ---------------------------------------------------------------------------
// Full Cloud generate response
// ---------------------------------------------------------------------------

export interface CloudGenerateResponse {
  /** Whether the generation succeeded. */
  ok: boolean;
  /** HTTP-like status code for the response. */
  status: number;
  /** The generated artifact bundle. */
  artifacts: CloudArtifact[];
  /** Warnings and assumptions surfaced during generation. */
  warnings: CloudWarning[];
  /** Explicit assumptions made while interpreting or generating from the spec. */
  assumptions: CloudAssumption[];
  /** Validation status for auth/workspace/spec checks and executor validation. */
  validation: CloudValidationStatus;
  /** Run receipt fields, present even when execution is not requested. */
  runReceipt: CloudRunReceipt;
  /** Suggested follow-up actions for the caller. */
  followUpActions: CloudFollowUpAction[];
  /** Request ID for traceability. */
  requestId: string;
}
