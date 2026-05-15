import { fromMarkdown } from 'mdast-util-from-markdown';
import type { Heading, List, ListItem, Node, Paragraph, Parent, Root } from 'mdast';

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

// Markdown structures that head an "open questions" section. Matched against
// the plain text of a heading node (not the raw line) so prefix `#`s don't
// affect detection.
const OPEN_QUESTIONS_HEADING = /^(?:open questions?|questions?|clarifications needed|unresolved|tbd)\s*:?\s*$/i;
const CLARIFICATION_ANSWERS_HEADING = /^(?:clarification answers?|resolved clarifications?)\s*:?\s*$/i;
const UNRESOLVED_TOKEN = /^(?:tbd|todo|unclear|unspecified|not sure|decide later|open question)\b/i;
const UNRESOLVED_TOKEN_INLINE = /\b(?:tbd|unclear|unspecified|not sure|decide later|\?\?\?)\b/i;

/**
 * Collect candidate open-question lines from the spec description. Uses
 * `mdast-util-from-markdown` (per AGENTS.md: "Source-Text Analysis: Use
 * Grammar-Aware Parsers, Not Regex") so list-item coalescing is structural —
 * each `listItem` node already contains the full wrapped item text via the
 * paragraph children — and fenced code blocks (`code` nodes) are excluded by
 * construction. This replaces an earlier line-by-line state machine whose
 * blank-line and heading-boundary handling repeatedly emitted truncated
 * tails of multi-line numbered questions.
 */
function openQuestionLines(text: string): string[] {
  let tree: Root;
  try {
    tree = fromMarkdown(text);
  } catch {
    return [];
  }

  const questions: string[] = [];
  let inOpenQuestionSection = false;
  let openSectionDepth = 0;
  let inAnswersSection = false;
  let answersSectionDepth = 0;

  for (const child of tree.children) {
    if (child.type === 'heading') {
      const heading = child as Heading;
      const headingText = collectText(heading).trim();

      if (inOpenQuestionSection && heading.depth <= openSectionDepth) {
        inOpenQuestionSection = false;
      }
      if (inAnswersSection && heading.depth <= answersSectionDepth) {
        inAnswersSection = false;
      }

      if (CLARIFICATION_ANSWERS_HEADING.test(headingText)) {
        inAnswersSection = true;
        answersSectionDepth = heading.depth;
        inOpenQuestionSection = false;
        continue;
      }
      if (OPEN_QUESTIONS_HEADING.test(headingText)) {
        inOpenQuestionSection = true;
        openSectionDepth = heading.depth;
        inAnswersSection = false;
        continue;
      }
      continue;
    }

    // Authors often write "Clarification answers:" as a plain paragraph
    // (not a markdown heading) immediately under the Open Questions list,
    // following the interactive CLI's appended format. Treat that paragraph
    // as a soft section terminator so the answer Q/A lines don't get pulled
    // back in as new open questions.
    if (child.type === 'paragraph') {
      const para = collectText(child as Paragraph).trim();
      if (CLARIFICATION_ANSWERS_HEADING.test(para)) {
        inOpenQuestionSection = false;
        inAnswersSection = true;
        answersSectionDepth = openSectionDepth || 0;
        continue;
      }
    }

    if (inAnswersSection) continue;

    if (inOpenQuestionSection) {
      collectFromOpenQuestionBlock(child, questions);
      continue;
    }

    collectStandaloneUnresolved(child, questions);
  }

  return questions;
}

/**
 * Inside an "open questions" section: emit one candidate per list item, plus
 * any standalone paragraphs that are themselves a question or an unresolved
 * marker. Pure prose (intro sentences, trailing notes) is ignored.
 */
function collectFromOpenQuestionBlock(node: Node, out: string[]): void {
  if (node.type === 'list') {
    for (const item of (node as List).children as ListItem[]) {
      const itemText = collectText(item).replace(/\s+/g, ' ').trim();
      if (itemText) out.push(itemText);
    }
    return;
  }
  if (node.type === 'paragraph') {
    const text = collectText(node as Paragraph).replace(/\s+/g, ' ').trim();
    if (!text) return;
    if (text.endsWith('?') || UNRESOLVED_TOKEN.test(text) || UNRESOLVED_TOKEN_INLINE.test(text)) {
      out.push(text);
    }
  }
}

/**
 * Outside any open-questions section: still surface explicit questions and
 * unresolved markers found in plain paragraphs or list items so a TBD/`?`
 * line elsewhere in the spec is not silently dropped. Walks the subtree to
 * find paragraph nodes; `code` blocks are skipped via `collectText`.
 */
function collectStandaloneUnresolved(node: Node, out: string[]): void {
  if (node.type === 'paragraph') {
    const text = collectText(node as Paragraph).replace(/\s+/g, ' ').trim();
    if (!text) return;
    if (text.endsWith('?') || UNRESOLVED_TOKEN.test(text) || UNRESOLVED_TOKEN_INLINE.test(text)) {
      out.push(text);
    }
    return;
  }
  if (node.type === 'list') {
    for (const item of (node as List).children as ListItem[]) {
      const text = collectText(item).replace(/\s+/g, ' ').trim();
      if (!text) continue;
      if (text.endsWith('?') || UNRESOLVED_TOKEN.test(text) || UNRESOLVED_TOKEN_INLINE.test(text)) {
        out.push(text);
      }
    }
    return;
  }
  if (isParent(node)) {
    for (const child of node.children) collectStandaloneUnresolved(child, out);
  }
}

function collectText(node: Node): string {
  // Fenced code blocks must not contribute to detection — a `?` line inside
  // an example workflow body is not a real question to ask the user.
  if (node.type === 'code') return '';
  const candidate = (node as unknown as { value?: unknown }).value;
  if (typeof candidate === 'string') return candidate;
  if (isParent(node)) return node.children.map(collectText).join('');
  return '';
}

function isParent(node: Node): node is Parent {
  return Array.isArray((node as Parent).children);
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
