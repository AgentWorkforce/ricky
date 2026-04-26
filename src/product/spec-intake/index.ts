import { normalizeSpec } from './normalizer.js';
import { parseSpec } from './parser.js';
import { routeSpec } from './router.js';
import type { IntakeResult, RawSpecPayload, ValidationIssue } from './types.js';

export function intake(payload: RawSpecPayload): IntakeResult {
  const parsed = parseSpec(payload);
  const { normalized, issues } = normalizeSpec(parsed);
  const routing = routeSpec(normalized, issues);

  const allIssues = [...issues];
  if (
    routing.target === 'clarify' &&
    normalized.intent !== 'clarify' &&
    normalized.intent !== 'unknown' &&
    !issues.some((issue) => issue.severity === 'error')
  ) {
    allIssues.push({
      severity: 'warning',
      field: 'routing',
      message: routing.reason,
      suggestion: routing.suggestedFollowUp,
    });
  }

  return {
    success: !allIssues.some((issue) => issue.severity === 'error') && routing.target !== 'clarify',
    routing,
    validationIssues: allIssues,
    parseWarnings: parsed.parseWarnings,
    requestId: payload.requestId ?? `${payload.surface}-${payload.receivedAt}`,
    receivedAt: payload.receivedAt,
    processedAt: new Date().toISOString(),
  };
}

export { normalizeSpec } from './normalizer.js';
export {
  detectIntent,
  extractAcceptanceGates,
  extractConstraints,
  extractEvidenceRequirements,
  parseSpec,
} from './parser.js';
export { routeSpec } from './router.js';
export type {
  DesiredAction,
  ExecutionPreference,
  InputSurface,
  IntakeResult,
  IntentKind,
  IntentSignal,
  McpPayload,
  NaturalLanguagePayload,
  NormalizedAcceptanceGate,
  NormalizedConstraint,
  NormalizedEvidenceRequirement,
  NormalizedWorkflowSpec,
  ParsedSpec,
  ProviderContext,
  RawSpecBase,
  RawSpecPayload,
  RouteTarget,
  RoutingDecision,
  StructuredJsonPayload,
  ValidationIssue,
  ValidationSeverity,
} from './types.js';
