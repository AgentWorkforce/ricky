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
    // Open-question scanning runs against the original description only.
    // The combined `text` above concatenates extracted constraints, evidence,
    // and acceptance-gate fragments after the description — those are bare
    // lines without markdown headings, so a multi-line question accumulator
    // would keep pulling them into the trailing Open Questions item once the
    // section was opened. The other clarification detectors are line-fragment
    // tolerant and continue to use the broader combined text.
    questions.push(...explicitOpenQuestionQuestions(spec.description, text));
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

function explicitOpenQuestionQuestions(description: string, combinedText: string): ClarificationQuestion[] {
  const lower = textWithoutClarificationAnswerSections(combinedText).toLowerCase();
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

  const answeredQuestions = answeredClarificationQuestions(combinedText);
  const openLines = openQuestionLines(description)
    .map(questionFromOpenQuestionLine)
    .filter((line): line is string => Boolean(line));
  const questionLines = openLines
    .filter((line) => !answeredQuestions.has(normalizeQuestion(line)));

  if (questionLines.length > 0) {
    return questionLines.map((line, index) => ({
      id: `open-question-${index + 1}`,
      question: line,
      reason: 'The spec contains an explicit unresolved question.',
      blocking: true,
    }));
  }

  if (openLines.length > 0 && answeredQuestions.size > 0) return [];

  return [{
    id: 'resolve-open-questions',
    question: 'What should Ricky decide for the unresolved or TBD parts of this workflow spec?',
    reason: 'The spec contains explicit unresolved markers such as open questions, TBD, or unclear requirements.',
    blocking: true,
  }];
}

function textWithoutClarificationAnswerSections(text: string): string {
  const retained: string[] = [];
  let inAnswerSection = false;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = stripListMarker(rawLine.trim());
    if (!line) {
      inAnswerSection = false;
      retained.push(rawLine);
      continue;
    }

    if (/^(#{1,6}\s*)?(clarification answers?|resolved clarifications?)\s*:?\s*$/i.test(line)) {
      inAnswerSection = true;
      continue;
    }

    if (/^(#{1,6}\s*)?[A-Z][\w\s/-]{2,80}:$/.test(line)) {
      inAnswerSection = false;
    }

    if (!inAnswerSection) retained.push(rawLine);
  }

  return retained.join('\n');
}

function openQuestionLines(text: string): string[] {
  const lines = text.split(/\r?\n/);
  const questionLines: string[] = [];
  let inOpenQuestionSection = false;
  let inClarificationAnswerSection = false;
  // Accumulator for the current numbered/bulleted question inside the Open
  // Questions section. Multi-line markdown items are common (the source spec
  // typically wraps questions across 2-4 lines), so we buffer continuation
  // lines until a blank line, a new list marker, or a section boundary, then
  // emit a single coalesced question. Without this, the tail line of each
  // wrapped question (the one that ends with "?") becomes its own clarification
  // and the user sees truncated fragments instead of full questions.
  let pendingItem: string[] | null = null;
  const flushPending = () => {
    if (!pendingItem) return;
    const joined = pendingItem.join(' ').replace(/\s+/g, ' ').trim();
    if (joined) questionLines.push(joined);
    pendingItem = null;
  };

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    const line = stripListMarker(trimmed);
    if (!line) {
      // Blank lines flush the current question but do NOT exit the Open
      // Questions section. Markdown convention places a blank line between
      // the heading and the list, and many specs separate items with blank
      // lines; treating blank lines as section terminators dropped us back to
      // the explicit-`?` path and surfaced only the wrapped tail of each
      // multi-line item. The clarification-answer section is similarly
      // closed only by a real new heading.
      flushPending();
      continue;
    }

    if (/^(#{1,6}\s*)?(clarification answers?|resolved clarifications?)\s*:?\s*$/i.test(line)) {
      flushPending();
      inOpenQuestionSection = false;
      inClarificationAnswerSection = true;
      continue;
    }

    if (/^(#{1,6}\s*)?(open questions?|questions?|clarifications needed|unresolved|tbd)\s*:?\s*$/i.test(line)) {
      flushPending();
      inOpenQuestionSection = true;
      inClarificationAnswerSection = false;
      continue;
    }

    if (/^(#{1,6}\s*)?[A-Z][\w\s/-]{2,80}:$/.test(line) && !/^(tbd|todo|unclear|unspecified|open question)/i.test(line)) {
      flushPending();
      inOpenQuestionSection = false;
      inClarificationAnswerSection = false;
    }

    // A new markdown heading (other than the open-questions / clarification-
    // answers headings already handled above) closes the open-questions
    // section. Previously blank lines did this implicitly; now that we keep
    // wrapping items together across blank lines, we need an explicit
    // boundary so a later "## Cross-Repo Work Plan" section doesn't keep
    // pulling lines into the Open Questions bucket.
    if (/^#{1,6}\s+\S/.test(trimmed)) {
      flushPending();
      inOpenQuestionSection = false;
      inClarificationAnswerSection = false;
      continue;
    }

    if (inClarificationAnswerSection) continue;

    if (inOpenQuestionSection) {
      const startsNewItem = /^(?:[-*+]\s+|\d+[.)]\s+|\[[ xX]\]\s+)/.test(trimmed);
      if (startsNewItem) {
        flushPending();
        pendingItem = [line];
      } else if (pendingItem) {
        pendingItem.push(line);
      } else {
        pendingItem = [line];
      }
      continue;
    }

    const explicitQuestion = line.endsWith('?');
    const unresolvedItem = /^(?:tbd|todo|unclear|unspecified|not sure|decide later|open question)\b/i.test(line) ||
      /\b(?:tbd|unclear|unspecified|not sure|decide later|\?\?\?)\b/i.test(line);
    if (explicitQuestion || unresolvedItem) {
      questionLines.push(line);
    }
  }

  flushPending();
  return questionLines;
}

function answeredClarificationQuestions(text: string): Set<string> {
  const answered = new Set<string>();
  let inAnswerSection = false;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = stripListMarker(rawLine.trim());
    if (!line) {
      inAnswerSection = false;
      continue;
    }

    if (/^(#{1,6}\s*)?(clarification answers?|resolved clarifications?)\s*:?\s*$/i.test(line)) {
      inAnswerSection = true;
      continue;
    }

    if (/^(#{1,6}\s*)?[A-Z][\w\s/-]{2,80}:$/.test(line)) {
      inAnswerSection = false;
    }

    if (!inAnswerSection) continue;

    const answeredQuestion = questionFromAnswerLine(line);
    if (answeredQuestion) answered.add(normalizeQuestion(answeredQuestion));
  }

  return answered;
}

function questionFromAnswerLine(line: string): string | null {
  const questionMatch = line.match(/^(.+\?)\s*[:=-]\s*\S/);
  if (questionMatch) return questionMatch[1].trim();

  const generatedQuestion = questionFromOpenQuestionLine(line);
  return generatedQuestion?.endsWith('?') ? generatedQuestion : null;
}

function questionFromOpenQuestionLine(line: string): string | null {
  const cleaned = stripListMarker(line)
    .replace(/^(?:open question|question|tbd|todo|unclear|unspecified|not sure|decide later)\s*[:\u2014-]?\s*/i, '')
    .replace(/^todo:\s*(?:decide|choose|clarify|ask)\s*[:\u2014-]?\s*/i, '')
    .trim();
  if (!cleaned || /^open questions?$/i.test(cleaned)) return null;
  if (cleaned.endsWith('?')) return cleaned;

  const whether = cleaned.match(/^whether\s+(.+)$/i);
  if (whether) return `Should ${lowercaseFirst(whether[1])}?`;

  if (/^(?:decide|choose|clarify|confirm|select)\b/i.test(cleaned)) {
    return `Please clarify: ${cleaned.replace(/[.\u3002]+$/, '')}?`;
  }

  return `Please clarify: ${cleaned.replace(/[.\u3002]+$/, '')}?`;
}

function stripListMarker(line: string): string {
  return line
    .replace(/^[-*+]\s+/, '')
    .replace(/^\d+[.)]\s+/, '')
    .replace(/^\[[ xX]\]\s+/, '')
    .trim();
}

function lowercaseFirst(value: string): string {
  return value.charAt(0).toLowerCase() + value.slice(1);
}

function normalizeQuestion(value: string): string {
  return value
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[?!.\u3002]+$/g, '')
    .trim();
}

function executionModeConflictQuestion(
  spec: NormalizedWorkflowSpec,
  text: string,
): ClarificationQuestion | null {
  const mentionsLocal = /\b(local|byoh|on this machine)\b/i.test(text);
  const mentionsCloud = /\b(cloud|hosted|remote)\b/i.test(text);
  if (hasExplicitExecutionModeChoice(spec) || hasAnsweredExecutionModeConflict(text)) return null;
  if (!mentionsLocal || !mentionsCloud || spec.executionPreference !== 'auto') return null;

  return {
    id: 'execution-mode-conflict',
    question: 'Should this workflow run locally/BYOH, in Cloud, or generate artifacts for both paths?',
    reason: 'The spec mentions both local and Cloud execution without a clear preference.',
    blocking: true,
    defaultAssumption: 'Generate for local/BYOH first and keep Cloud promotion as a follow-up.',
  };
}

function hasExplicitExecutionModeChoice(spec: NormalizedWorkflowSpec): boolean {
  const mode = metadataString(spec.providerContext.metadata, 'mode');
  const preference =
    metadataString(spec.providerContext.metadata, 'executionPreference') ??
    metadataString(spec.providerContext.metadata, 'execution_preference');
  return [mode, preference].some((value) => (
    value !== undefined &&
    /^(local|byoh|cloud|hosted|remote|both)$/i.test(value.trim())
  ));
}

function hasAnsweredExecutionModeConflict(text: string): boolean {
  let inAnswerSection = false;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = stripListMarker(rawLine.trim());
    if (!line) {
      inAnswerSection = false;
      continue;
    }
    if (/^(#{1,6}\s*)?(clarification answers?|resolved clarifications?)\s*:?\s*$/i.test(line)) {
      inAnswerSection = true;
      continue;
    }
    if (/^(#{1,6}\s*)?[A-Z][\w\s/-]{2,80}:$/.test(line)) {
      inAnswerSection = false;
    }
    if (
      inAnswerSection &&
      /should this workflow run locally\/byoh, in cloud, or generate artifacts for both paths\?/i.test(line) &&
      /:\s*\S/.test(line)
    ) {
      return true;
    }
  }
  return false;
}

function metadataString(metadata: Record<string, unknown>, key: string): string | undefined {
  const value = metadata[key];
  return typeof value === 'string' ? value : undefined;
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
