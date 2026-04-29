import type { Confidence } from '../../runtime/failure/types.js';
import type { NormalizedWorkflowSpec, RouteTarget, RoutingDecision, ValidationIssue } from './types.js';

export function routeSpec(normalized: NormalizedWorkflowSpec, issues: ValidationIssue[] = []): RoutingDecision {
  const blockingIssue = issues.find((issue) => issue.severity === 'error');
  if (blockingIssue) {
    return decision(
      'clarify',
      'high',
      `Cannot route until ${blockingIssue.field} is resolved: ${blockingIssue.message}`,
      normalized,
      blockingIssue.suggestion,
    );
  }

  switch (normalized.intent) {
    case 'generate':
      return decision('generate', normalized.description ? 'high' : 'low', 'Request asks Ricky to author a new workflow.', normalized);
    case 'debug':
      return routeDebug(normalized);
    case 'coordinate':
      return routeCoordinate(normalized);
    case 'execute':
      return routeExecute(normalized);
    case 'clarify':
      return decision(
        'clarify',
        'high',
        'Request is ambiguous and needs a targeted follow-up before Ricky can act.',
        normalized,
        'Ask whether Ricky should generate, debug, coordinate, or execute, and collect the missing target context.',
      );
    case 'unknown':
      return decision(
        'clarify',
        'low',
        'No deterministic intent signal was available.',
        normalized,
        'Ask the user for the desired Ricky action and the workflow target.',
      );
  }
}

function routeDebug(normalized: NormalizedWorkflowSpec): RoutingDecision {
  if (!hasFailureEvidence(normalized)) {
    return decision(
      'clarify',
      'medium',
      'Debug routing requires failed-run evidence, logs, or a run identifier.',
      normalized,
      'Provide a failed run ID, log excerpt, evidence artifact, or workflow path.',
    );
  }

  return decision(
    'debug',
    normalized.desiredAction.workflowFileHint ? 'high' : 'medium',
    'Request references failed workflow evidence and should go to the debugger.',
    normalized,
  );
}

function routeCoordinate(normalized: NormalizedWorkflowSpec): RoutingDecision {
  const multiAgent = /\b(agents?|parallel|sequence|handoff|together|orchestrate|coordinate)\b/i.test(normalized.description);
  return decision(
    'coordinate',
    multiAgent ? 'high' : 'medium',
    'Request spans coordination or orchestration across work units.',
    normalized,
  );
}

function routeExecute(normalized: NormalizedWorkflowSpec): RoutingDecision {
  if (!normalized.desiredAction.workflowFileHint) {
    return decision(
      'clarify',
      'medium',
      'Execution requires a recognized workflow artifact (workflows/**/*.ts or *.workflow.ts).',
      normalized,
      'Provide the workflow artifact path (e.g., workflows/my-workflow.ts or my.workflow.ts) to execute.',
    );
  }

  return decision(
    'execute',
    'high',
    'Request includes an executable workflow artifact target.',
    normalized,
  );
}

function hasFailureEvidence(normalized: NormalizedWorkflowSpec): boolean {
  const text = [
    normalized.description,
    normalized.targetContext,
    normalized.desiredAction.workflowFileHint,
    ...normalized.targetFiles,
    ...normalized.evidenceRequirements.map((requirement) => requirement.requirement),
  ]
    .filter(Boolean)
    .join('\n');

  return /\b(failed|failure|error|stack trace|run id|log|evidence|timed out|verification)\b/i.test(text);
}

function decision(
  target: RouteTarget,
  confidence: Confidence,
  reason: string,
  normalizedSpec: NormalizedWorkflowSpec,
  suggestedFollowUp?: string,
): RoutingDecision {
  return {
    target,
    confidence,
    reason,
    normalizedSpec,
    suggestedFollowUp,
  };
}
