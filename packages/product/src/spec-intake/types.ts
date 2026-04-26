import type { Confidence } from '@ricky/runtime/failure/types.js';
import type { VerificationType } from '@ricky/shared/models/workflow-evidence.js';

export type InputSurface = 'claude_handoff' | 'cli' | 'mcp' | 'slack' | 'web' | 'api';

export interface RawSpecBase {
  surface: InputSurface;
  receivedAt: string;
  requestId?: string;
  metadata?: Record<string, unknown>;
}

export interface NaturalLanguagePayload extends RawSpecBase {
  kind: 'natural_language';
  text: string;
}

export interface StructuredJsonPayload extends RawSpecBase {
  kind: 'structured_json';
  data: Record<string, unknown>;
}

export interface McpPayload extends RawSpecBase {
  kind: 'mcp';
  toolName: string;
  arguments: Record<string, unknown>;
}

export type RawSpecPayload = NaturalLanguagePayload | StructuredJsonPayload | McpPayload;

export type IntentKind = 'generate' | 'debug' | 'coordinate' | 'execute' | 'clarify' | 'unknown';

export interface IntentSignal {
  primary: IntentKind;
  secondary?: IntentKind;
  signals: string[];
}

export interface ProviderContext {
  surface: InputSurface;
  toolName?: string;
  provider?: string;
  channel?: string;
  threadId?: string;
  userId?: string;
  workspaceId?: string;
  requestId?: string;
  metadata: Record<string, unknown>;
}

export interface ParsedSpec {
  surface: InputSurface;
  intent: IntentSignal;
  description: string;
  targetRepo?: string;
  targetContext?: string;
  targetFiles: string[];
  constraints: string[];
  evidenceRequirements: string[];
  acceptanceGates: string[];
  providerContext: ProviderContext;
  rawPayload: RawSpecPayload;
  parseConfidence: Confidence;
  parseWarnings: string[];
}

export interface DesiredAction {
  kind: IntentKind;
  summary: string;
  workflowFileHint?: string;
  specText?: string;
  targetFiles: string[];
}

export interface NormalizedConstraint {
  constraint: string;
  category: 'technical' | 'scope' | 'timeline' | 'quality' | 'other';
}

export interface NormalizedEvidenceRequirement {
  requirement: string;
  verificationType: VerificationType;
}

export interface NormalizedAcceptanceGate {
  gate: string;
  kind: 'deterministic' | 'review' | 'proof' | 'custom';
}

export type ExecutionPreference = 'local' | 'cloud' | 'auto';

export interface NormalizedWorkflowSpec {
  intent: IntentKind;
  description: string;
  targetRepo: string | null;
  targetContext: string | null;
  targetFiles: string[];
  desiredAction: DesiredAction;
  constraints: NormalizedConstraint[];
  evidenceRequirements: NormalizedEvidenceRequirement[];
  requiredEvidence: NormalizedEvidenceRequirement[];
  acceptanceGates: NormalizedAcceptanceGate[];
  acceptanceCriteria: NormalizedAcceptanceGate[];
  executionPreference: ExecutionPreference;
  providerContext: ProviderContext;
  sourceSpec: ParsedSpec;
}

export type RouteTarget = 'generate' | 'debug' | 'coordinate' | 'execute' | 'clarify';

export interface RoutingDecision {
  target: RouteTarget;
  confidence: Confidence;
  reason: string;
  normalizedSpec: NormalizedWorkflowSpec;
  suggestedFollowUp?: string;
}

export type ValidationSeverity = 'error' | 'warning' | 'info';

export interface ValidationIssue {
  severity: ValidationSeverity;
  field: string;
  message: string;
  suggestion?: string;
}

export interface IntakeResult {
  success: boolean;
  routing: RoutingDecision | null;
  validationIssues: ValidationIssue[];
  parseWarnings: string[];
  requestId: string;
  receivedAt: string;
  processedAt: string;
}
