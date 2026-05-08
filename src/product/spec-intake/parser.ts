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

import type { Confidence } from '../../runtime/failure/types.js';

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
    'make',
    'workflow for',
    'workflow to',
    'workflow that',
    'need a workflow',
    'new workflow',
    'new ricky workflow',
    'build a workflow',
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
    'failed run',
    'failed-run',
    'timed out',
    'timeout',
    'verification failed',
    'exit code',
  ],
  coordinate: [
    'coordinate',
    'orchestrate',
    'run together',
    'sequence',
    'manage',
    'parallel',
    'agents',
    'multi-agent',
    'multiple agents',
    'workers',
    'lead agent',
    'agent handoff',
    'handoff between agents',
    'swarm',
  ],
  execute: [
    'run',
    'execute',
    'launch',
    'start',
    'kick off',
    'invoke',
    'ready to run',
    'rerun',
    'restart',
    'ready artifact',
    'ready workflow',
    'workflow artifact',
  ],
};

const SURFACE_LABELS: Record<InputSurface, string> = {
  claude_handoff: 'Claude handoff',
  cli: 'CLI',
  mcp: 'MCP',
  slack: 'Slack',
  web: 'web',
  api: 'API',
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
const DESCRIPTION_KEYS = [
  'description',
  'prompt',
  'spec',
  'text',
  'message',
  'input',
  'request',
  'summary',
  'title',
  'name',
  'goal',
  'objective',
  'instructions',
  'instruction',
  'handoff',
  'claudeHandoff',
  'claude_handoff',
  'claudeMessage',
  'claude_message',
  'cliInput',
  'cli_input',
  'command',
  'commandText',
  'command_text',
  'slashCommandText',
  'slash_command_text',
  'webInput',
  'web_input',
  'apiRequest',
  'api_request',
  'slackText',
  'slack_text',
  'task',
];
const STRUCTURED_TEXT_KEYS = [
  'path',
  'file',
  'text',
  'title',
  'workflowFile',
  'workflowPath',
  'artifactPath',
  'artifact_path',
  'readyArtifact',
  'ready_artifact',
  'command',
  'expected',
  'description',
  'summary',
  'name',
  'goal',
  'objective',
  'instructions',
  'handoff',
  'task',
  'constraint',
  'requirement',
  'gate',
  'criterion',
  'criteria',
  'value',
];
const READY_ARTIFACT_KEYS = [
  'readyArtifact',
  'ready_artifact',
  'readyWorkflow',
  'ready_workflow',
  'providedArtifact',
  'provided_artifact',
  'workflowFile',
  'workflowPath',
  'artifactPath',
  'artifact_path',
];
const FAILED_RUN_KEYS = [
  'failedRunId',
  'failed_run_id',
  'runId',
  'run_id',
  'workflowRunId',
  'workflow_run_id',
  'failureEvidence',
  'failure_evidence',
  'stackTrace',
  'stack_trace',
  'stderr',
  'stdout',
  'logs',
  'logPath',
  'log_path',
  'evidencePath',
  'evidence_path',
];
const COORDINATION_KEYS = [
  'agents',
  'workers',
  'assignees',
  'participants',
  'handoffs',
  'handoff',
  'coordination',
  'orchestration',
  'swarm',
  'parallelAgents',
  'parallel_agents',
];
const SPEC_SHAPE_KEYS = [
  'spec',
  'workflowSpec',
  'workflow_spec',
  'goal',
  'objective',
  'instructions',
  'constraints',
  'requirements',
  'nonGoals',
  'non_goals',
  'acceptanceGates',
  'acceptance_gates',
  'acceptanceCriteria',
  'acceptance_criteria',
  'requiredEvidence',
  'required_evidence',
  'verificationCommands',
  'verification_commands',
];

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

  const structuredText = [
    fallbackText,
    stringifySelected(data, [
      'spec',
      'workflowSpec',
      'workflow_spec',
      'prompt',
      'description',
      'title',
      'text',
      'message',
      'input',
      'handoff',
      'claudeHandoff',
      'goal',
      'objective',
      'evidence',
      'requiredEvidence',
      'readyArtifact',
      'ready_artifact',
      'artifact',
      'runId',
      'failedRunId',
    ]),
  ].join('\n');
  const shapeIntent = inferIntentFromStructuredShape(data, fallbackText);
  if (shapeIntent.primary === 'debug' || shapeIntent.primary === 'execute' || shapeIntent.primary === 'coordinate') {
    return shapeIntent;
  }

  const textIntent = detectIntent(structuredText);
  if (textIntent.primary !== 'clarify' && textIntent.primary !== 'unknown') return textIntent;
  if (shapeIntent.primary !== 'unknown') return shapeIntent;
  return textIntent;
}

function inferIntentFromStructuredShape(data: Record<string, unknown>, fallbackText: string): IntentSignal {
  const records = collectCandidateRecords(data);
  const text = [
    fallbackText,
    ...records.map((record) => stringifySelected(record, [...FAILED_RUN_KEYS, ...READY_ARTIFACT_KEYS, ...COORDINATION_KEYS])),
  ].join('\n');

  if (records.some((record) => hasAnyRecordValue(record, FAILED_RUN_KEYS)) || /\b(failed run|stack trace|traceback|stderr|exit code [1-9])\b/i.test(text)) {
    return {
      primary: 'debug',
      signals: ['shape:failed-run-evidence'],
    };
  }

  if (records.some((record) => hasWorkflowArtifactValue(record, READY_ARTIFACT_KEYS))) {
    return {
      primary: 'execute',
      signals: ['shape:ready-artifact'],
    };
  }

  if (records.some((record) => hasAnyRecordValue(record, COORDINATION_KEYS))) {
    return {
      primary: 'coordinate',
      signals: ['shape:agent-coordination'],
    };
  }

  if (records.some((record) => hasAnyRecordValue(record, SPEC_SHAPE_KEYS))) {
    return {
      primary: 'generate',
      signals: ['shape:workflow-spec'],
    };
  }

  return { primary: 'unknown', signals: [] };
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

  const generateSignals = matches.find((match) => match.intent === 'generate')?.signals ?? [];
  const explicitGenerateWorkflow = isExplicitGenerateWorkflowRequest(haystack, generateSignals);

  const failedRunSignals = matches.find((match) => match.intent === 'debug')?.signals ?? [];
  const explicitExecuteArtifact = isExplicitExecuteArtifactRequest(haystack);
  if (
    !explicitGenerateWorkflow &&
    !explicitExecuteArtifact &&
    failedRunSignals.some((signal) => /failed|failure|stack trace|run id|timed out|timeout|exit code/i.test(signal))
  ) {
    return {
      primary: 'debug',
      secondary: matches.find((match) => match.intent !== 'debug')?.intent,
      signals: failedRunSignals,
    };
  }

  const executeSignals = matches.find((match) => match.intent === 'execute')?.signals ?? [];
  if (
    executeSignals.length > 0 &&
    !explicitGenerateWorkflow &&
    !/\b(?:generate|create|build|author|write|scaffold|make)\b/.test(haystack)
  ) {
    return {
      primary: 'execute',
      secondary: matches.find((match) => match.intent !== 'execute')?.intent,
      signals: executeSignals,
    };
  }

  const coordinationSignals = matches.find((match) => match.intent === 'coordinate')?.signals ?? [];
  if (coordinationSignals.some((signal) => /agents?|workers|handoff|swarm|parallel|orchestrate|coordinate/i.test(signal))) {
    const explicitNewWorkflow = generateSignals.some((signal) => /new workflow|build a workflow|workflow spec|scaffold/i.test(signal));
    if (!explicitNewWorkflow) {
      return {
        primary: 'coordinate',
        secondary: matches.find((match) => match.intent !== 'coordinate')?.intent,
        signals: coordinationSignals,
      };
    }
  }

  const [first, second] = matches;
  return {
    primary: first.intent,
    secondary: second?.intent,
    signals: first.signals,
  };
}

function isExplicitGenerateWorkflowRequest(haystack: string, generateSignals: string[]): boolean {
  if (generateSignals.length === 0) return false;
  if (/\b(?:generate|create|build|author|write|scaffold)\b/.test(haystack) && /\bworkflow\b/.test(haystack)) {
    return true;
  }

  return generateSignals.some((signal) => /new workflow|build a workflow|workflow spec|scaffold/i.test(signal));
}

function isExplicitExecuteArtifactRequest(haystack: string): boolean {
  if (!/\b(?:run|execute|launch|start|kick off|invoke|rerun|restart)\b/.test(haystack)) return false;
  if (!/\b(?:ready artifact|ready workflow|workflow artifact|artifact path)\b/.test(haystack)) return false;
  if (!/(?:^|\s)(?:[./~]?[\w@.-]+\/)*workflows\/.+\.(?:ts|js|yaml|yml)\b|(?:^|\s)[\w@./~-]+\.workflow\.(?:ts|js|yaml|yml)\b/.test(haystack)) {
    return false;
  }

  return !/\b(?:failed run|run id|stack trace|traceback|stdout|stderr|logs?|evidence|verification failed|timed out|timeout|exit code)\b/.test(
    haystack,
  );
}

function normalizeIntent(value: string): IntentKind {
  const normalized = value.toLowerCase().replace(/[-\s]/g, '_');
  if (normalized.includes('debug') || normalized.includes('fix') || normalized.includes('failure')) return 'debug';
  if (normalized.includes('coordinate') || normalized.includes('orchestrate')) return 'coordinate';
  if (normalized.includes('execute') || normalized.includes('run') || normalized.includes('start')) return 'execute';
  if (
    normalized.includes('generate') ||
    normalized.includes('create') ||
    normalized.includes('author') ||
    normalized.includes('new_workflow')
  ) {
    return 'generate';
  }
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
  const requestRecord = readRecord(data, ['request', 'body', 'payload', 'input', 'message', 'event']) ?? data;
  const specRecord =
    readRecord(requestRecord, ['spec', 'workflowSpec', 'workflow_spec', 'body']) ??
    readRecord(data, ['spec', 'workflowSpec', 'workflow_spec']) ??
    requestRecord;
  let description =
    readString(specRecord, DESCRIPTION_KEYS) ??
    readString(data, DESCRIPTION_KEYS) ??
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
      'artifact_path',
      'readyArtifact',
      'ready_artifact',
      'path',
    ]),
    ...readStringArray(data, [
      'targetFiles',
      'target_files',
      'files',
      'paths',
      'workflowFile',
      'workflowPath',
      'artifact',
      'artifacts',
      'artifactPath',
      'artifact_path',
      'readyArtifact',
      'ready_artifact',
      'path',
    ]),
    ...readStringArray(specRecord, ['readyWorkflow', 'ready_workflow', 'providedArtifact', 'provided_artifact']),
    ...readStringArray(data, ['readyWorkflow', 'ready_workflow', 'providedArtifact', 'provided_artifact']),
    ...extractTargetFiles(description),
  ];
  const constraints = [
    ...readStringArray(specRecord, ['constraints', 'requirements', 'requirementsList', 'nonGoals', 'non_goals']),
    ...readStringArray(data, ['constraints', 'requirements', 'requirementsList', 'nonGoals', 'non_goals']),
    ...extractConstraints(description),
  ];
  const evidenceRequirements = [
    ...readStringArray(specRecord, [
      'evidenceRequirements',
      'requiredEvidence',
      'required_evidence',
      'evidence',
      'logs',
      'verificationCommands',
      'verification_commands',
    ]),
    ...readStringArray(data, [
      'evidenceRequirements',
      'requiredEvidence',
      'required_evidence',
      'evidence',
      'logs',
      'verificationCommands',
      'verification_commands',
    ]),
    ...runEvidenceRequirement(specRecord),
    ...runEvidenceRequirement(data),
    ...extractEvidenceRequirements(freeText),
  ];
  const acceptanceGates = [
    ...readStringArray(specRecord, [
      'acceptanceGates',
      'acceptance_gates',
      'acceptanceCriteria',
      'acceptance_criteria',
      'acceptance',
      'gates',
      'doneWhen',
      'done_when',
      'successCriteria',
      'success_criteria',
      'definitionOfDone',
      'definition_of_done',
    ]),
    ...readStringArray(data, [
      'acceptanceGates',
      'acceptance_gates',
      'acceptanceCriteria',
      'acceptance_criteria',
      'acceptance',
      'gates',
      'doneWhen',
      'done_when',
      'successCriteria',
      'success_criteria',
      'definitionOfDone',
      'definition_of_done',
    ]),
    ...extractAcceptanceGates(freeText),
  ];

  const targetRepo =
    readString(specRecord, ['targetRepo', 'target_repo', 'repo', 'repository']) ??
    readString(data, ['targetRepo', 'target_repo', 'repo', 'repository']) ??
    extractTargetRepo(freeText);

  const targetContext =
    readString(specRecord, [
      'targetContext',
      'target_context',
      'context',
      'workspace',
      'project',
      'runId',
      'failedRunId',
      'workflowRunId',
      'workflowId',
      'workflowName',
    ]) ??
    readString(data, [
      'targetContext',
      'target_context',
      'context',
      'workspace',
      'project',
      'runId',
      'failedRunId',
      'workflowRunId',
      'workflowId',
      'workflowName',
    ]) ??
    extractTargetContext(freeText);

  if (!description) {
    description = synthesizeDescription(data, specRecord, {
      targetRepo,
      targetContext,
      targetFiles,
      constraints,
      evidenceRequirements,
      acceptanceGates,
    });
  }

  const warnings: string[] = [];
  if (!description) {
    warnings.push('Structured payload did not include a recognizable description, prompt, spec, text, request, artifact, or run field.');
  }

  return {
    description,
    targetRepo,
    targetContext,
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
  constraints.push(...extractNonGoalSectionItems(text));
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

function extractNonGoalSectionItems(text: string): string[] {
  const constraints: string[] = [];
  const lines = text.split(/\r?\n/);
  let inNonGoalSection = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    const markdownHeading = /^#{1,6}\s+(.+?)\s*$/.exec(line)?.[1]?.replace(/#+$/, '').trim();
    const plainHeading = /^[A-Za-z][A-Za-z0-9 /_-]*:\s*$/.exec(line)?.[0]?.replace(/:\s*$/, '').trim();
    const heading = markdownHeading ?? plainHeading ?? '';
    if (heading) {
      inNonGoalSection = /\b(non[- ]?goals?|out[- ]of[- ]scope|not in scope|out of scope)\b/i.test(heading);
      continue;
    }
    if (!inNonGoalSection) continue;
    if (!line) continue;
    const item = stripBullet(line);
    if (item && item !== line) constraints.push(`Non-goal: ${item}`);
  }

  return constraints;
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
  const nested =
    readRecord(record, ['request', 'body', 'payload', 'input', 'message', 'event']) ??
    readRecord(record, ['spec', 'workflowSpec', 'workflow_spec']) ??
    {};
  return {
    surface: payload.surface,
    surfaceLabel: SURFACE_LABELS[payload.surface],
    toolName: payload.kind === 'mcp' ? payload.toolName : undefined,
    provider:
      readString(record, ['provider', 'providerName', 'modelProvider', 'provider_name', 'model_provider']) ??
      readString(nested, ['provider', 'providerName', 'modelProvider', 'provider_name', 'model_provider']) ??
      stringMetadata(payload, 'provider'),
    channel:
      readString(record, ['channel', 'channelId', 'channel_id']) ??
      readString(nested, ['channel', 'channelId', 'channel_id']) ??
      stringMetadata(payload, 'channel') ??
      stringMetadata(payload, 'channelId') ??
      stringMetadata(payload, 'channel_id'),
    threadId:
      readString(record, ['threadId', 'thread_ts', 'threadTs', 'messageId', 'message_ts']) ??
      readString(nested, ['threadId', 'thread_ts', 'threadTs', 'messageId', 'message_ts']) ??
      stringMetadata(payload, 'threadId') ??
      stringMetadata(payload, 'thread_ts') ??
      stringMetadata(payload, 'messageId'),
    userId:
      readString(record, ['userId', 'user_id', 'user', 'actor', 'actorId', 'actor_id']) ??
      readString(nested, ['userId', 'user_id', 'user', 'actor', 'actorId', 'actor_id']) ??
      stringMetadata(payload, 'userId') ??
      stringMetadata(payload, 'user_id') ??
      stringMetadata(payload, 'actor'),
    workspaceId:
      readString(record, ['workspaceId', 'workspace_id', 'workspace', 'teamId', 'team_id']) ??
      readString(nested, ['workspaceId', 'workspace_id', 'workspace', 'teamId', 'team_id']) ??
      stringMetadata(payload, 'workspaceId') ??
      stringMetadata(payload, 'workspace_id') ??
      stringMetadata(payload, 'teamId') ??
      stringMetadata(payload, 'team_id'),
    requestId: payload.requestId,
    metadata: payload.metadata ?? {},
  };
}

function extractTargetRepo(text: string): string | undefined {
  const repoMatch =
    text.match(/\b(?:repo|repository)\s*[:=]?\s*([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)/i) ??
    text.match(/\bgithub\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)/i);
  return repoMatch?.[1];
}

function extractTargetContext(text: string): string | undefined {
  const contextMatch = text.match(/\b(?:context|project|workspace)\s*[:=]\s*([^\n.;]+)/i);
  if (contextMatch?.[1]) return contextMatch[1].trim();

  const runMatch = text.match(/\b(?:failed\s+)?(?:workflow\s+)?run(?:\s+id)?\s*[:=]?\s*([A-Za-z0-9_.:-]+)/i);
  return runMatch?.[1] ? `run:${runMatch[1]}` : undefined;
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
  const labelPattern = [...labels].sort((a, b) => b.length - a.length).map(escapeRegExp).join('|');
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
    if (Array.isArray(value)) {
      const text = value
        .map((item) => {
          if (typeof item === 'string') return item;
          if (isRecord(item)) return readString(item, STRUCTURED_TEXT_KEYS);
          return undefined;
        })
        .filter((item): item is string => Boolean(item))
        .join('\n');
      if (text.trim()) return text.trim();
    }
  }
  return undefined;
}

function readStringArray(data: Record<string, unknown>, keys: string[]): string[] {
  const values: string[] = [];
  for (const key of keys) {
    const value = data[key];
    if (Array.isArray(value)) {
      values.push(
        ...value.map((item) =>
          typeof item === 'string'
            ? item
            : isRecord(item)
              ? readString(item, STRUCTURED_TEXT_KEYS)
              : undefined,
        )
          .filter((item): item is string => Boolean(item)),
      );
      continue;
    }
    if (isRecord(value)) {
      const nested = readString(value, STRUCTURED_TEXT_KEYS);
      if (nested) values.push(nested);
      continue;
    }
    if (typeof value === 'string' && value.trim()) values.push(value.trim());
  }
  return dedupe(values);
}

function collectCandidateRecords(data: Record<string, unknown>): Record<string, unknown>[] {
  const records = [data];
  for (const key of ['request', 'body', 'payload', 'input', 'message', 'event', 'spec', 'workflowSpec', 'workflow_spec']) {
    const nested = data[key];
    if (isRecord(nested)) records.push(nested);
  }
  return records;
}

function hasAnyRecordValue(data: Record<string, unknown>, keys: string[]): boolean {
  return keys.some((key) => {
    const value = data[key];
    if (value === undefined || value === null) return false;
    if (typeof value === 'string') return value.trim().length > 0;
    if (Array.isArray(value)) return value.length > 0;
    if (isRecord(value)) return Object.keys(value).length > 0;
    return true;
  });
}

function hasWorkflowArtifactValue(data: Record<string, unknown>, keys: string[]): boolean {
  return keys.some((key) => readStringArray(data, [key]).some(isWorkflowArtifact));
}

function runEvidenceRequirement(data: Record<string, unknown>): string[] {
  const runId = readString(data, ['failedRunId', 'failed_run_id', 'runId', 'run_id', 'workflowRunId', 'workflow_run_id']);
  const logPath = readString(data, ['logPath', 'log_path', 'logsPath', 'logs_path', 'evidencePath', 'evidence_path']);
  return [
    runId ? `Failed run evidence must be available for run ${runId}.` : undefined,
    logPath ? `Failure evidence is available at ${logPath}.` : undefined,
  ].filter((requirement): requirement is string => Boolean(requirement));
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

function synthesizeDescription(
  data: Record<string, unknown>,
  specRecord: Record<string, unknown>,
  fields: {
    targetRepo?: string;
    targetContext?: string;
    targetFiles: string[];
    constraints: string[];
    evidenceRequirements: string[];
    acceptanceGates: string[];
  },
): string {
  const explicitIntent = readString(data, ['intent', 'action', 'route', 'target']) ??
    readString(specRecord, ['intent', 'action', 'route', 'target']);
  const runId = readString(data, ['failedRunId', 'failed_run_id', 'runId', 'run_id', 'workflowRunId', 'workflow_run_id']) ??
    readString(specRecord, ['failedRunId', 'failed_run_id', 'runId', 'run_id', 'workflowRunId', 'workflow_run_id']);
  const artifact = fields.targetFiles.find((file) => isWorkflowArtifact(file)) ?? fields.targetFiles[0];
  const evidenceRequirements = dedupe(fields.evidenceRequirements);
  const acceptanceGates = dedupe(fields.acceptanceGates);
  const constraints = dedupe(fields.constraints);
  const parts: string[] = [];

  const normalizedIntent = explicitIntent ? normalizeIntent(explicitIntent) : 'unknown';
  if (normalizedIntent !== 'unknown') parts.push(`${capitalize(normalizedIntent)} Ricky workflow request.`);
  if (artifact) parts.push(`Target artifact: ${artifact}.`);
  if (runId) parts.push(`Failed run ID: ${runId}.`);
  if (fields.targetRepo) parts.push(`Target repo: ${fields.targetRepo}.`);
  if (fields.targetContext) parts.push(`Target context: ${fields.targetContext}.`);
  if (evidenceRequirements.length > 0) {
    parts.push(`Required evidence: ${evidenceRequirements.join('; ')}`);
  }
  if (acceptanceGates.length > 0) {
    parts.push(`Acceptance criteria: ${acceptanceGates.join('; ')}`);
  }
  if (constraints.length > 0) {
    parts.push(`Constraints: ${constraints.join('; ')}`);
  }

  return parts.join(' ').trim();
}

function isWorkflowArtifact(value: string): boolean {
  return /(?:^|\/)workflows\/.+\.(?:ts|js|yaml|yml)$|\.workflow\.(?:ts|js|yaml|yml)$/i.test(value);
}

function capitalize(value: string): string {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
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
