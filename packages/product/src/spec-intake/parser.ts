import type {
  InputSurface,
  IntentKind,
  IntentSignal,
  McpPayload,
  NaturalLanguagePayload,
  ParsedSpec,
  ProviderContext,
  RawSpecPayload,
  StructuredJsonPayload,
} from './types.js';

import type { Confidence } from '@ricky/runtime/failure/types';

interface ExtractedFields {
  description: string;
  targetRepo?: string;
  targetContext?: string;
  targetFiles: string[];
  constraints: string[];
  evidenceRequirements: string[];
  acceptanceGates: string[];
  providerContext: ProviderContext;
  warnings: string[];
}

const INTENT_KEYWORDS: Record<Exclude<IntentKind, 'clarify' | 'unknown'>, string[]> = {
  generate: [
    'generate',
    'create',
    'write',
    'build',
    'author',
    'new workflow',
    'from spec',
    'workflow spec',
    'scaffold',
  ],
  debug: [
    'debug',
    'fix',
    'why did',
    'failing',
    'failed',
    'failure',
    'broken',
    'error',
    'investigate',
    'stack trace',
    'run id',
  ],
  coordinate: [
    'coordinate',
    'orchestrate',
    'run together',
    'sequence',
    'manage',
    'parallel',
    'agents',
    'handoff',
    'swarm',
  ],
  execute: ['run', 'execute', 'launch', 'start', 'kick off', 'rerun', 'restart', 'ready artifact'],
};

const MCP_TOOL_INTENTS: Record<string, IntentKind> = {
  'ricky.generate': 'generate',
  'ricky.workflow.generate': 'generate',
  'ricky.debug': 'debug',
  'ricky.workflow.debug': 'debug',
  'ricky.coordinate': 'coordinate',
  'ricky.workflow.coordinate': 'coordinate',
  'ricky.execute': 'execute',
  'ricky.workflow.execute': 'execute',
};

const PATH_PATTERN = /(?:^|\s)([./~]?[\w@.-]+(?:\/[\w@.-]+)+(?:\.[A-Za-z0-9]+)?)/g;

export function parseSpec(payload: RawSpecPayload): ParsedSpec {
  switch (payload.kind) {
    case 'natural_language':
      return parseNaturalLanguage(payload);
    case 'structured_json':
      return parseStructuredJson(payload);
    case 'mcp':
      return parseMcpPayload(payload);
  }
}

function parseNaturalLanguage(payload: NaturalLanguagePayload): ParsedSpec {
  const text = payload.text.trim();
  const intent = detectIntent(text);
  const fields = extractFieldsFromText(text, payload, buildProviderContext(payload));
  return buildParsedSpec(payload, fields, intent, confidenceFor(intent, text, false));
}

function parseStructuredJson(payload: StructuredJsonPayload): ParsedSpec {
  const fields = extractFieldsFromRecord(payload.data, payload, buildProviderContext(payload));
  const intent = detectIntentFromRecord(payload.data, fields.description);
  return buildParsedSpec(payload, fields, intent, confidenceFor(intent, fields.description, true));
}

function parseMcpPayload(payload: McpPayload): ParsedSpec {
  const providerContext = buildProviderContext(payload);
  const fields = extractFieldsFromRecord(payload.arguments, payload, providerContext);
  const mappedIntent = MCP_TOOL_INTENTS[payload.toolName];
  const detectedIntent = detectIntentFromRecord(payload.arguments, fields.description);
  const intent: IntentSignal = mappedIntent
    ? {
        primary: mappedIntent,
        secondary: detectedIntent.primary === mappedIntent ? undefined : detectedIntent.primary,
        signals: [`tool:${payload.toolName}`, ...detectedIntent.signals],
      }
    : {
        ...detectedIntent,
        signals: [`unknown_tool:${payload.toolName}`, ...detectedIntent.signals],
      };

  return buildParsedSpec(payload, fields, intent, confidenceFor(intent, fields.description, true));
}

function buildParsedSpec(
  payload: RawSpecPayload,
  fields: ExtractedFields,
  intent: IntentSignal,
  parseConfidence: Confidence,
): ParsedSpec {
  const parseWarnings = [...fields.warnings];
  if (!fields.description) {
    parseWarnings.push('No non-empty description was provided.');
  }
  if (intent.primary === 'unknown') {
    parseWarnings.push('No deterministic intent signal was found.');
  }

  return {
    surface: payload.surface,
    intent,
    description: fields.description,
    targetRepo: fields.targetRepo,
    targetContext: fields.targetContext,
    targetFiles: fields.targetFiles,
    constraints: dedupe(fields.constraints),
    evidenceRequirements: dedupe(fields.evidenceRequirements),
    acceptanceGates: dedupe(fields.acceptanceGates),
    providerContext: fields.providerContext,
    rawPayload: payload,
    parseConfidence,
    parseWarnings: dedupe(parseWarnings),
  };
}

function detectIntentFromRecord(data: Record<string, unknown>, fallbackText: string): IntentSignal {
  const explicitIntent = readString(data, ['intent', 'action', 'route', 'target']);
  if (explicitIntent) {
    const normalized = normalizeIntent(explicitIntent);
    if (normalized !== 'unknown') {
      return {
        primary: normalized,
        signals: [`intent:${explicitIntent}`],
      };
    }
  }

  return detectIntent([fallbackText, stringifySelected(data, ['spec', 'prompt', 'description', 'evidence'])].join('\n'));
}

export function detectIntent(text: string): IntentSignal {
  const haystack = text.toLowerCase();
  const matches = Object.entries(INTENT_KEYWORDS)
    .map(([intent, keywords]) => ({
      intent: intent as Exclude<IntentKind, 'clarify' | 'unknown'>,
      signals: keywords.filter((keyword) => haystack.includes(keyword)),
    }))
    .filter((match) => match.signals.length > 0)
    .sort((a, b) => b.signals.length - a.signals.length);

  if (matches.length === 0) {
    return { primary: text.trim() ? 'clarify' : 'unknown', signals: [] };
  }

  const [first, second] = matches;
  return {
    primary: first.intent,
    secondary: second?.intent,
    signals: first.signals,
  };
}

function normalizeIntent(value: string): IntentKind {
  const normalized = value.toLowerCase().replace(/[-\s]/g, '_');
  if (normalized.includes('debug') || normalized.includes('fix') || normalized.includes('failure')) return 'debug';
  if (normalized.includes('coordinate') || normalized.includes('orchestrate')) return 'coordinate';
  if (normalized.includes('execute') || normalized.includes('run') || normalized.includes('start')) return 'execute';
  if (normalized.includes('generate') || normalized.includes('create') || normalized.includes('author')) return 'generate';
  if (normalized.includes('clarify')) return 'clarify';
  return 'unknown';
}

function extractFieldsFromText(
  text: string,
  payload: RawSpecPayload,
  providerContext: ProviderContext,
): ExtractedFields {
  const targetRepo = extractTargetRepo(text);
  return {
    description: text,
    targetRepo,
    targetContext: extractTargetContext(text),
    targetFiles: excludeRepoSlug(extractTargetFiles(text), targetRepo),
    constraints: extractConstraints(text),
    evidenceRequirements: extractEvidenceRequirements(text),
    acceptanceGates: extractAcceptanceGates(text),
    providerContext,
    warnings: payload.surface === 'api' || payload.surface === 'web' ? [] : [],
  };
}

function extractFieldsFromRecord(
  data: Record<string, unknown>,
  payload: RawSpecPayload,
  providerContext: ProviderContext,
): ExtractedFields {
  const requestRecord = readRecord(data, ['request', 'body']) ?? data;
  const specRecord =
    readRecord(requestRecord, ['spec', 'workflowSpec', 'workflow_spec', 'body']) ??
    readRecord(data, ['spec', 'workflowSpec', 'workflow_spec']) ??
    requestRecord;
  const description =
    readString(specRecord, ['description', 'prompt', 'spec', 'text', 'request', 'summary', 'goal', 'objective']) ??
    readString(data, ['description', 'prompt', 'spec', 'text', 'request', 'summary', 'goal', 'objective']) ??
    '';
  const freeText = [description, JSON.stringify(data)].join('\n');
  const targetFiles = [
    ...readStringArray(specRecord, [
      'targetFiles',
      'target_files',
      'files',
      'paths',
      'fileTargets',
      'workflowFile',
      'workflowPath',
      'artifact',
      'artifacts',
      'artifactPath',
      'readyArtifact',
    ]),
    ...extractTargetFiles(description),
  ];
  const constraints = [
    ...readStringArray(specRecord, ['constraints', 'requirements', 'nonGoals', 'non_goals']),
    ...extractConstraints(description),
  ];
  const evidenceRequirements = [
    ...readStringArray(specRecord, ['evidenceRequirements', 'requiredEvidence', 'evidence', 'verificationCommands']),
    ...runEvidenceRequirement(specRecord),
    ...extractEvidenceRequirements(freeText),
  ];
  const acceptanceGates = [
    ...readStringArray(specRecord, ['acceptanceGates', 'acceptanceCriteria', 'acceptance', 'gates']),
    ...extractAcceptanceGates(freeText),
  ];

  const warnings: string[] = [];
  if (!description) {
    warnings.push('Structured payload did not include a recognizable description, prompt, spec, text, or request field.');
  }

  const targetRepo = readString(specRecord, ['targetRepo', 'target_repo', 'repo', 'repository']) ?? extractTargetRepo(freeText);

  return {
    description,
    targetRepo,
    targetContext:
      readString(specRecord, [
        'targetContext',
        'target_context',
        'context',
        'workspace',
        'project',
        'runId',
        'failedRunId',
        'workflowId',
      ]) ??
      extractTargetContext(freeText),
    targetFiles: excludeRepoSlug(dedupe(targetFiles), targetRepo),
    constraints: dedupe(constraints),
    evidenceRequirements: dedupe(evidenceRequirements),
    acceptanceGates: dedupe(acceptanceGates),
    providerContext,
    warnings,
  };
}

export function extractConstraints(text: string): string[] {
  const constraints: string[] = [];
  const lines = text.split(/\r?\n/).map((line) => line.trim());
  for (const line of lines) {
    if (/^(constraint|constraints|must|must not|do not|only|avoid|requirement|required)\b/i.test(stripBullet(line))) {
      constraints.push(stripBullet(line));
    }
  }

  const inlinePatterns = [
    /\b(must(?: not)? [^.]+[.])/gi,
    /\b(do not [^.]+[.])/gi,
    /\b(only (?:touch|modify|change|edit) [^.]+[.])/gi,
  ];
  for (const pattern of inlinePatterns) {
    constraints.push(...matchesFor(text, pattern));
  }
  return dedupe(constraints);
}

export function extractEvidenceRequirements(text: string): string[] {
  const requirements = extractLabeledLines(text, [
    'evidence',
    'verification',
    'verify',
    'proof',
    'test',
    'tests',
    'required evidence',
  ]);

  if (/\b(typecheck|tsc --noEmit)\b/i.test(text)) requirements.push('TypeScript typecheck must pass.');
  if (/\b(vitest|test suite|unit tests?)\b/i.test(text)) requirements.push('Relevant tests must pass.');
  if (/\b(file_exists|artifact exists|artifact_exists)\b/i.test(text)) {
    requirements.push('Required artifact files must exist.');
  }
  return dedupe(requirements);
}

export function extractAcceptanceGates(text: string): string[] {
  const gates = extractLabeledLines(text, ['acceptance', 'acceptance criteria', 'gate', 'gates', 'done when']);
  if (/\b(success criteria|definition of done)\b/i.test(text)) {
    gates.push(...extractSentenceFragments(text, /\b(?:success criteria|definition of done)\b:?([^.]+)/gi));
  }
  return dedupe(gates);
}

function buildProviderContext(payload: RawSpecPayload): ProviderContext {
  const record = payload.kind === 'structured_json' ? payload.data : payload.kind === 'mcp' ? payload.arguments : {};
  return {
    surface: payload.surface,
    toolName: payload.kind === 'mcp' ? payload.toolName : undefined,
    provider: readString(record, ['provider', 'providerName', 'modelProvider']) ?? stringMetadata(payload, 'provider'),
    channel: readString(record, ['channel', 'channelId']) ?? stringMetadata(payload, 'channel'),
    threadId: readString(record, ['threadId', 'thread_ts', 'messageId']) ?? stringMetadata(payload, 'threadId'),
    userId: readString(record, ['userId', 'user', 'actor']) ?? stringMetadata(payload, 'userId'),
    workspaceId: readString(record, ['workspaceId', 'workspace']) ?? stringMetadata(payload, 'workspaceId'),
    requestId: payload.requestId,
    metadata: payload.metadata ?? {},
  };
}

function extractTargetRepo(text: string): string | undefined {
  const repoMatch = text.match(/\b(?:repo|repository)\s*[:=]?\s*([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)/i);
  return repoMatch?.[1];
}

function extractTargetContext(text: string): string | undefined {
  const contextMatch = text.match(/\b(?:context|project|workspace)\s*[:=]\s*([^\n.;]+)/i);
  return contextMatch?.[1]?.trim();
}

function extractTargetFiles(text: string): string[] {
  const paths: string[] = [];
  for (const match of text.matchAll(PATH_PATTERN)) {
    const candidate = match[1];
    if (candidate && !candidate.startsWith('http')) {
      paths.push(candidate.replace(/[),.;:]$/, ''));
    }
  }
  return dedupe(paths);
}

function extractLabeledLines(text: string, labels: string[]): string[] {
  const labelPattern = labels.map(escapeRegExp).join('|');
  const pattern = new RegExp(`^(?:[-*]\\s*)?(?:${labelPattern})\\b\\s*:?\\s*(.+)$`, 'i');
  return text
    .split(/\r?\n/)
    .map((line) => stripBullet(line.trim()))
    .filter(Boolean)
    .map((line) => line.match(pattern)?.[1]?.trim())
    .filter((line): line is string => Boolean(line));
}

function extractSentenceFragments(text: string, pattern: RegExp): string[] {
  return matchesFor(text, pattern).map((match) => match.replace(/^[:\s]+/, '').trim());
}

function matchesFor(text: string, pattern: RegExp): string[] {
  return [...text.matchAll(pattern)].map((match) => match[1]?.trim()).filter((match): match is string => Boolean(match));
}

function confidenceFor(intent: IntentSignal, description: string, structured: boolean): Confidence {
  if (intent.primary === 'unknown') return 'low';
  if (intent.primary === 'clarify') return description.trim() ? 'medium' : 'low';
  if (structured && intent.signals.some((signal) => signal.startsWith('intent:') || signal.startsWith('tool:'))) {
    return 'high';
  }
  return intent.signals.length >= 2 || structured ? 'high' : 'medium';
}

function readRecord(data: Record<string, unknown>, keys: string[]): Record<string, unknown> | undefined {
  for (const key of keys) {
    const value = data[key];
    if (isRecord(value)) return value;
  }
  return undefined;
}

function readString(data: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = data[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  }
  return undefined;
}

function readStringArray(data: Record<string, unknown>, keys: string[]): string[] {
  for (const key of keys) {
    const value = data[key];
    if (Array.isArray(value)) {
      return value
        .map((item) =>
          typeof item === 'string'
            ? item
            : isRecord(item)
              ? readString(item, ['path', 'file', 'workflowFile', 'artifactPath', 'description', 'name'])
              : undefined,
        )
        .filter((item): item is string => Boolean(item));
    }
    if (isRecord(value)) {
      const nested = readString(value, ['path', 'file', 'workflowFile', 'artifactPath', 'description', 'name']);
      if (nested) return [nested];
    }
    if (typeof value === 'string' && value.trim()) return [value.trim()];
  }
  return [];
}

function runEvidenceRequirement(data: Record<string, unknown>): string[] {
  const runId = readString(data, ['failedRunId', 'runId', 'workflowRunId']);
  return runId ? [`Failed run evidence must be available for run ${runId}.`] : [];
}

function stringifySelected(data: Record<string, unknown>, keys: string[]): string {
  return keys
    .map((key) => data[key])
    .filter((value) => value !== undefined)
    .map((value) => (typeof value === 'string' ? value : JSON.stringify(value)))
    .join('\n');
}

function stringMetadata(payload: RawSpecPayload, key: string): string | undefined {
  const value = payload.metadata?.[key];
  return typeof value === 'string' ? value : undefined;
}

function stripBullet(line: string): string {
  return line.replace(/^[-*]\s*/, '').trim();
}

function dedupe(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function excludeRepoSlug(files: string[], targetRepo: string | undefined): string[] {
  if (!targetRepo) return files;
  return files.filter((file) => file !== targetRepo && !isRepoSlug(file));
}

function isRepoSlug(value: string): boolean {
  const parts = value.split('/');
  return parts.length === 2 && parts.every((part) => /^[\w@.-]+$/.test(part)) && !value.includes('.');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
