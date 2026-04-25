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
  /** Suggested follow-up actions for the caller. */
  followUpActions: CloudFollowUpAction[];
  /** Request ID for traceability. */
  requestId: string;
}
