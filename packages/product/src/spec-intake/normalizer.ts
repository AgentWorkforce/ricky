import type {
  DesiredAction,
  ExecutionPreference,
  IntentKind,
  NormalizedAcceptanceGate,
  NormalizedConstraint,
  NormalizedEvidenceRequirement,
  NormalizedWorkflowSpec,
  ParsedSpec,
  ValidationIssue,
} from './types.js';

import type { VerificationType } from '@ricky/shared/models/workflow-evidence.js';

export function normalizeSpec(parsed: ParsedSpec): { normalized: NormalizedWorkflowSpec; issues: ValidationIssue[] } {
  const intent = resolveIntent(parsed);
  const constraints = normalizeConstraints(parsed.constraints);
  const evidenceRequirements = normalizeEvidenceRequirements(parsed.evidenceRequirements);
  const acceptanceGates = normalizeAcceptanceGates(parsed.acceptanceGates);
  const normalized: NormalizedWorkflowSpec = {
    intent,
    description: parsed.description.trim(),
    targetRepo: parsed.targetRepo ?? null,
    targetContext: parsed.targetContext ?? null,
    targetFiles: parsed.targetFiles,
    desiredAction: buildDesiredAction(parsed, intent),
    constraints,
    evidenceRequirements,
    requiredEvidence: evidenceRequirements,
    acceptanceGates,
    acceptanceCriteria: acceptanceGates,
    executionPreference: inferExecutionPreference(parsed),
    providerContext: parsed.providerContext,
    sourceSpec: parsed,
  };

  return {
    normalized,
    issues: validateNormalized(normalized),
  };
}

function resolveIntent(parsed: ParsedSpec): IntentKind {
  if (parsed.intent.primary === 'unknown') return parsed.description.trim() ? 'clarify' : 'unknown';

  const hasFailureEvidence =
    parsed.evidenceRequirements.length > 0 ||
    parsed.targetFiles.some((file) => /(?:log|evidence|run|failed|failure)/i.test(file)) ||
    /\b(?:failed|failure|error|stack trace|run id)\b/i.test(parsed.description);

  if (hasFailureEvidence && parsed.intent.primary === 'generate' && parsed.intent.secondary === 'debug') {
    return 'debug';
  }

  return parsed.intent.primary;
}

function buildDesiredAction(parsed: ParsedSpec, intent: IntentKind): DesiredAction {
  const workflowFileHint = findWorkflowFileHint(parsed);
  const summary = summarizeAction(parsed.description, intent);
  return {
    kind: intent,
    summary,
    workflowFileHint,
    specText: intent === 'generate' ? parsed.description : undefined,
    targetFiles: parsed.targetFiles,
  };
}

function normalizeConstraints(raw: string[]): NormalizedConstraint[] {
  return raw.map((constraint) => ({
    constraint,
    category: categorizeConstraint(constraint),
  }));
}

function normalizeEvidenceRequirements(raw: string[]): NormalizedEvidenceRequirement[] {
  return raw.map((requirement) => ({
    requirement,
    verificationType: mapVerificationType(requirement),
  }));
}

function normalizeAcceptanceGates(raw: string[]): NormalizedAcceptanceGate[] {
  return raw.map((gate) => ({
    gate,
    kind: classifyAcceptanceGate(gate),
  }));
}

function inferExecutionPreference(parsed: ParsedSpec): ExecutionPreference {
  const text = [parsed.description, parsed.targetContext, ...parsed.constraints].filter(Boolean).join('\n').toLowerCase();
  if (/\b(local|byoh|on this machine)\b/.test(text)) return 'local';
  if (/\b(cloud|hosted|remote)\b/.test(text) || parsed.surface === 'api' || parsed.surface === 'web') return 'cloud';
  return 'auto';
}

function validateNormalized(spec: NormalizedWorkflowSpec): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!spec.description) {
    issues.push({
      severity: 'error',
      field: 'description',
      message: 'A non-empty workflow request description is required.',
      suggestion: 'Provide the workflow goal, failure context, or artifact to run.',
    });
  }

  if (spec.intent === 'unknown') {
    issues.push({
      severity: 'warning',
      field: 'intent',
      message: 'The request intent could not be determined.',
      suggestion: 'Specify whether Ricky should generate, debug, coordinate, or execute.',
    });
  } else if (spec.intent === 'clarify') {
    issues.push({
      severity: 'warning',
      field: 'intent',
      message: 'The request is ambiguous enough to require clarification.',
      suggestion: 'Ask for the missing workflow goal or target artifact.',
    });
  }

  if ((spec.intent === 'generate' || spec.intent === 'execute') && spec.targetRepo === null) {
    issues.push({
      severity: 'info',
      field: 'targetRepo',
      message: 'No target repository was provided.',
      suggestion: 'Use the current repository unless the caller provides one.',
    });
  }

  return issues;
}

function categorizeConstraint(constraint: string): NormalizedConstraint['category'] {
  if (/\b(file|repo|typescript|node|api|mcp|slack|cli|network|llm|dependency|package)\b/i.test(constraint)) {
    return 'technical';
  }
  if (/\b(only|own|scope|do not modify|do not touch|non-goal|exclude)\b/i.test(constraint)) return 'scope';
  if (/\b(timeout|deadline|minutes?|hours?|today|tomorrow|before|after)\b/i.test(constraint)) return 'timeline';
  if (/\b(test|typecheck|review|evidence|acceptance|quality|deterministic)\b/i.test(constraint)) return 'quality';
  return 'other';
}

function mapVerificationType(requirement: string): VerificationType {
  if (/\b(exit code|exit_code|status code)\b/i.test(requirement)) return 'exit_code';
  if (/\b(file exists|file_exists|created file|path exists)\b/i.test(requirement)) return 'file_exists';
  if (/\b(output contains|stdout|stderr|contains)\b/i.test(requirement)) return 'output_contains';
  if (/\b(artifact exists|artifact_exists|artifact)\b/i.test(requirement)) return 'artifact_exists';
  if (/\b(deterministic|gate)\b/i.test(requirement)) return 'deterministic_gate';
  if (/\b(route|routing)\b/i.test(requirement)) return 'routing_assertion';
  return 'custom';
}

function classifyAcceptanceGate(gate: string): NormalizedAcceptanceGate['kind'] {
  if (/\b(typecheck|test|file exists|deterministic|exit code|command)\b/i.test(gate)) return 'deterministic';
  if (/\b(review|approval|signoff)\b/i.test(gate)) return 'review';
  if (/\b(proof|evidence|artifact)\b/i.test(gate)) return 'proof';
  return 'custom';
}

function findWorkflowFileHint(parsed: ParsedSpec): string | undefined {
  return parsed.targetFiles.find((file) =>
    /(?:^|\/)workflows\/.+\.(?:ts|js)$|\.workflow\.(?:ts|js|yaml|yml)$/i.test(file),
  );
}

function summarizeAction(description: string, intent: IntentKind): string {
  const trimmed = description.trim().replace(/\s+/g, ' ');
  if (trimmed.length > 0) return trimmed.length > 180 ? `${trimmed.slice(0, 177)}...` : trimmed;
  return `No description supplied for ${intent} request.`;
}
