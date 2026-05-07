import type { ClarificationQuestion, NormalizedWorkflowSpec, ValidationIssue } from './types.js';

export function analyzeClarificationNeeds(
  spec: NormalizedWorkflowSpec,
  issues: ValidationIssue[] = [],
): ClarificationQuestion[] {
  const questions: ClarificationQuestion[] = [];
  const text = [
    spec.description,
    spec.targetContext,
    ...spec.constraints.map((constraint) => constraint.constraint),
    ...spec.evidenceRequirements.map((requirement) => requirement.requirement),
    ...spec.acceptanceGates.map((gate) => gate.gate),
  ]
    .filter(Boolean)
    .join('\n');

  if (issues.some((issue) => issue.severity === 'error')) return questions;

  if (spec.intent === 'generate') {
    questions.push(...explicitOpenQuestionQuestions(text));
    const executionConflict = executionModeConflictQuestion(spec, text);
    if (executionConflict) questions.push(executionConflict);
    const riskySideEffect = riskySideEffectQuestion(text);
    if (riskySideEffect) questions.push(riskySideEffect);
  }

  return dedupeQuestions(questions);
}

export function blockingClarificationQuestions(questions: ClarificationQuestion[]): ClarificationQuestion[] {
  return questions.filter((question) => question.blocking);
}

function explicitOpenQuestionQuestions(text: string): ClarificationQuestion[] {
  const lower = text.toLowerCase();
  const unresolvedMarkers = [
    /\bopen questions?\b/,
    /\btbd\b/,
    /\btodo:\s*(decide|choose|clarify|ask)\b/,
    /\bunclear\b/,
    /\bunspecified\b/,
    /\bnot sure\b/,
    /\bdecide later\b/,
    /\?\?\?/,
  ];
  if (!unresolvedMarkers.some((pattern) => pattern.test(lower))) return [];

  const questionLines = text
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/^[-*]\s*/, ''))
    .filter((line) => line.endsWith('?'))
    .slice(0, 3);

  if (questionLines.length > 0) {
    return questionLines.map((line, index) => ({
      id: `open-question-${index + 1}`,
      question: line,
      reason: 'The spec contains an explicit unresolved question.',
      blocking: true,
    }));
  }

  return [{
    id: 'resolve-open-questions',
    question: 'What should Ricky decide for the unresolved or TBD parts of this workflow spec?',
    reason: 'The spec contains explicit unresolved markers such as open questions, TBD, or unclear requirements.',
    blocking: true,
  }];
}

function executionModeConflictQuestion(
  spec: NormalizedWorkflowSpec,
  text: string,
): ClarificationQuestion | null {
  const mentionsLocal = /\b(local|byoh|on this machine)\b/i.test(text);
  const mentionsCloud = /\b(cloud|hosted|remote)\b/i.test(text);
  if (!mentionsLocal || !mentionsCloud || spec.executionPreference !== 'auto') return null;

  return {
    id: 'execution-mode-conflict',
    question: 'Should this workflow run locally/BYOH, in Cloud, or generate artifacts for both paths?',
    reason: 'The spec mentions both local and Cloud execution without a clear preference.',
    blocking: true,
    defaultAssumption: 'Generate for local/BYOH first and keep Cloud promotion as a follow-up.',
  };
}

function riskySideEffectQuestion(text: string): ClarificationQuestion | null {
  const risky = /\b(deletes?|removes?|drops?|destroys?|resets?|migrates?|deploys?|publishes?|commits?|push(?:es)?|merges?|open pr|create pr)\b/i.test(text);
  const guarded = /\b(pause|ask|confirm|approval|approve|dry[- ]run|no destructive|non[- ]destructive|do not commit|do not push)\b/i.test(text);
  if (!risky || guarded) return null;

  return {
    id: 'side-effect-approval',
    question: 'Which side effects may the generated workflow perform automatically, and which ones require user approval first?',
    reason: 'The spec asks for potentially risky side effects without an approval boundary.',
    blocking: true,
    defaultAssumption: 'Run validation and write artifacts only; pause before destructive actions, commits, pushes, deploys, or PR creation.',
  };
}

function dedupeQuestions(questions: ClarificationQuestion[]): ClarificationQuestion[] {
  const byId = new Map<string, ClarificationQuestion>();
  for (const question of questions) {
    if (!byId.has(question.id)) byId.set(question.id, question);
  }
  return [...byId.values()];
}
