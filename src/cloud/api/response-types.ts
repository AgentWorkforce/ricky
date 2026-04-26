/**
 * Cloud Generate – Response types
 */

export interface CloudArtifact {
  id: string;
  name: string;
  content: string;
  mimeType?: string;
}

export interface CloudWarning {
  code: string;
  message: string;
}

export interface CloudAssumption {
  key: string;
  value: string;
  reason?: string;
}

export interface CloudFollowUpAction {
  label: string;
  action: string;
  payload?: Record<string, unknown>;
}

export interface CloudValidationIssue {
  field: string;
  message: string;
}

export interface CloudValidationStatus {
  valid: boolean;
  issues: CloudValidationIssue[];
}

export interface CloudRunReceipt {
  requestId: string;
  startedAt: string;
  completedAt: string;
  durationMs: number;
}

export interface CloudGenerateResponse {
  ok: boolean;
  artifacts: CloudArtifact[];
  warnings: CloudWarning[];
  assumptions: CloudAssumption[];
  followUpActions: CloudFollowUpAction[];
  validation: CloudValidationStatus;
  receipt: CloudRunReceipt;
  error?: string;
}
