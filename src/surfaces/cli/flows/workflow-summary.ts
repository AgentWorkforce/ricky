import type { LocalResponse } from '../../../local/entrypoint.js';
import type { CloudGenerateResult } from '../../../cloud/api/generate-endpoint.js';
import type { RickyMode } from '../cli/mode-selector.js';
import type { LocalPreflightResult } from './local-workflow-flow.js';
import type { CapturedWorkflowSpec } from './spec-intake-flow.js';

export interface WorkflowSummaryAgent {
  name: string;
  job: string;
}

export interface WorkflowSummary {
  artifactPath: string;
  goal: string;
  agents: WorkflowSummaryAgent[];
  jobs: string[];
  desiredOutcome: string;
  sideEffects: string[];
  missingLocalBlockers: string[];
  command: string;
}

export function buildWorkflowSummary(input: {
  capture: CapturedWorkflowSpec;
  localResult?: LocalResponse;
  preflight: LocalPreflightResult;
  artifactPath?: string;
}): WorkflowSummary {
  const artifactPath = input.artifactPath ?? resolveArtifactPath(input.localResult, input.capture);
  const agents = resolveAgents(input.localResult);
  const blockers = input.preflight.checks
    .filter((check) => check.status === 'missing' && check.blocker)
    .map((check) => `${check.label}: ${check.recovery ?? 'Install or configure this before running locally.'}`);

  const sideEffects = [
    ...(input.capture.source === 'workflow-artifact' ? [] : [`Write workflow artifact ${artifactPath}`]),
    'Run local shell commands declared by the workflow',
    'Write run state, logs, evidence, and generated metadata under .workflow-artifacts/',
    'Apply only bounded non-destructive auto-fixes when explicitly running with repair enabled',
  ];

  return {
    artifactPath,
    goal: summarizeGoal(input.capture.spec),
    agents,
    jobs: agents.map((agent) => `${agent.name}: ${agent.job}`),
    desiredOutcome: 'A completed local Agent Relay run with evidence, logs, artifacts, and a final outcome summary.',
    sideEffects,
    missingLocalBlockers: blockers,
    command: `npx --no-install agent-relay run ${artifactPath}`,
  };
}

export function renderWorkflowSummary(summary: WorkflowSummary, _options?: unknown): string[] {
  return [
    `Ricky wrote: ${summary.artifactPath}`,
    '',
    'What this workflow will do',
    `  ${summary.goal}`,
    '',
    'Agents',
    ...summary.agents.map((agent) => `  ${agent.name}: ${agent.job}`),
    '',
    'Desired outcome',
    `  ${summary.desiredOutcome}`,
    '',
    'Side effects',
    ...summary.sideEffects.map((effect) => `  ${effect}`),
    ...(summary.missingLocalBlockers.length > 0
      ? ['', 'Missing local blockers', ...summary.missingLocalBlockers.map((blocker) => `  ${blocker}`)]
      : []),
    '',
    `Run command: ${summary.command}`,
  ];
}

export function localWorkflowSummary(
  localResult: LocalResponse,
  options: {
    mode?: string;
    workflowName?: string;
    runRequested?: boolean;
    yes?: boolean;
    quiet?: boolean;
  } = {},
): WorkflowSummary {
  const artifactPath = localResult.generation?.artifact?.path ?? localResult.artifacts[0]?.path ?? 'workflows/generated/local-workflow.ts';
  const agents = resolveAgents(localResult);
  return {
    artifactPath,
    goal: options.workflowName ?? localResult.generation?.artifact?.workflow_id ?? 'Run the generated local workflow.',
    agents,
    jobs: agents.map((agent) => `${agent.name}: ${agent.job}`),
    desiredOutcome: localResult.execution
      ? 'A completed local Agent Relay execution with logs and evidence.'
      : 'A generated local workflow artifact ready for explicit execution.',
    sideEffects: localResult.execution
      ? ['Write workflow artifact', 'Run local agent-relay execution', 'Write local run evidence and logs']
      : ['Write workflow artifact only'],
    missingLocalBlockers: localResult.ok ? [] : localResult.warnings,
    command: localResult.generation?.next?.run_command ?? `npx --no-install agent-relay run ${artifactPath}`,
  };
}

export function cloudWorkflowSummary(
  cloudResult: {
    artifacts: Array<{ path: string }>;
    warnings: Array<{ severity: string; message: string }>;
    followUpActions: Array<{ label: string; description?: string }>;
  } | undefined,
  options: {
    mode?: string;
    workflowName?: string;
    runRequested?: boolean;
    yes?: boolean;
    quiet?: boolean;
    guidance?: string[];
  } = {},
): WorkflowSummary {
  const artifactPath = cloudResult?.artifacts[0]?.path ?? 'AgentWorkforce Cloud';
  const warnings = cloudResult?.warnings.map((warning) => `${warning.severity}: ${warning.message}`) ?? [];
  const guidance = options.guidance ?? [];
  return {
    artifactPath,
    goal: options.workflowName ?? 'Generate the requested workflow through AgentWorkforce Cloud.',
    agents: [
      {
        name: 'Cloud implementation agents',
        job: 'Run with the connected capable agents listed in the Cloud readiness summary.',
      },
    ],
    jobs: ['Cloud implementation agents: Run hosted workflow generation.'],
    desiredOutcome: 'A Cloud-generated workflow artifact with follow-up actions from AgentWorkforce Cloud.',
    sideEffects: ['Send the explicit Cloud generate request', 'Do not execute local workflows unless local mode is selected explicitly'],
    missingLocalBlockers: [...warnings, ...guidance],
    command: 'ricky --mode cloud',
  };
}

export function renderWorkflowJson(summary: WorkflowSummary): string {
  return JSON.stringify(summary, null, 2);
}

export function cloudRecoveryActions(): string[] {
  return [
    'Run the Cloud login flow if account, credentials, or workspace are missing.',
    'Connect at least one implementation agent: Claude, Codex, OpenCode, or Gemini.',
    'Connect optional integrations only when the workflow needs those tools.',
  ];
}

export interface PowerUserWorkflowSummary {
  mode: RickyMode;
  workflowName?: string;
  workflowPath?: string;
  runId?: string;
  status?: string;
  evidencePath?: string;
  cloudUrl?: string;
  runCommand?: string;
  warnings: string[];
  nextActions: string[];
}

export interface PowerUserWorkflowSummaryOptions {
  mode: RickyMode;
  workflowName?: string;
  quiet?: boolean;
  yes?: boolean;
  runRequested?: boolean;
}

export function localPowerUserWorkflowSummary(
  localResult: LocalResponse,
  options: PowerUserWorkflowSummaryOptions,
): PowerUserWorkflowSummary {
  const workflowPath = localResult.execution?.execution.workflow_file
    ?? localResult.generation?.artifact?.path
    ?? localResult.artifacts[0]?.path;
  const evidencePath = localResult.execution?.evidence?.logs.stdout_path
    ?? localResult.execution?.evidence?.logs.stderr_path;
  const runCommand = localResult.generation?.next?.run_command
    ?? (workflowPath ? `npx --no-install agent-relay run ${workflowPath}` : undefined);

  return {
    mode: options.mode,
    workflowName: options.workflowName ?? workflowNameFromPath(workflowPath),
    workflowPath,
    runId: localResult.execution?.execution.run_id,
    status: localResult.execution?.status ?? localResult.generation?.status ?? (localResult.ok ? 'ok' : 'error'),
    evidencePath,
    runCommand,
    warnings: localResult.warnings,
    nextActions: localResult.nextActions,
  };
}

export function cloudPowerUserWorkflowSummary(
  cloudResult: CloudGenerateResult | undefined,
  options: PowerUserWorkflowSummaryOptions & { guidance?: string[] },
): PowerUserWorkflowSummary {
  const workflowPath = cloudResult?.artifacts[0]?.path;
  const runReceipt = cloudResult?.runReceipt;
  const warningMessages = [
    ...(cloudResult?.warnings.map((warning) => warning.message) ?? []),
    ...(options.guidance ?? []),
  ];
  const followUpActions = cloudResult?.followUpActions.map((action) => (
    action.description ? `${action.label}: ${action.description}` : action.label
  )) ?? [];

  return {
    mode: options.mode,
    workflowName: options.workflowName ?? workflowNameFromPath(workflowPath),
    workflowPath,
    runId: runReceipt?.runId,
    status: runReceipt?.status ?? (cloudResult ? 'generated' : 'blocked'),
    cloudUrl: runReceipt?.receiptUrl,
    warnings: warningMessages,
    nextActions: followUpActions.length > 0 ? followUpActions : [
      'ricky connect cloud',
      'ricky status',
      'ricky cloud --spec-file ./spec.md --no-run',
    ],
  };
}

export function renderPowerUserWorkflowSummary(
  summary: PowerUserWorkflowSummary,
  options: PowerUserWorkflowSummaryOptions,
): string[] {
  if (options.quiet) {
    return [oneLinePowerUserWorkflowSummary(summary, options)];
  }

  const lines = [oneLinePowerUserWorkflowSummary(summary, options)];
  if (options.yes && options.runRequested) {
    lines.push('Auto-confirmed: non-destructive run confirmation only.');
  }
  if (summary.workflowPath) lines.push(`Workflow: ${summary.workflowPath}`);
  if (summary.runCommand && !options.runRequested) lines.push(`Run: ${summary.runCommand}`);
  if (summary.runId) lines.push(`Run id: ${summary.runId}`);
  if (summary.evidencePath) lines.push(`Evidence: ${summary.evidencePath}`);
  if (summary.cloudUrl) lines.push(`Cloud: ${summary.cloudUrl}`);
  for (const warning of summary.warnings) {
    lines.push(`Warning: ${warning}`);
  }
  for (const action of summary.nextActions) {
    lines.push(`Next: ${action}`);
  }
  return lines;
}

export function renderPowerUserWorkflowJson(summary: PowerUserWorkflowSummary): string {
  return JSON.stringify(removeUndefined({
    mode: summary.mode,
    workflowName: summary.workflowName,
    workflowPath: summary.workflowPath,
    runId: summary.runId,
    status: summary.status,
    evidencePath: summary.evidencePath,
    cloudUrl: summary.cloudUrl,
    warnings: summary.warnings,
    nextActions: summary.nextActions,
  }), null, 2);
}

function oneLinePowerUserWorkflowSummary(
  summary: PowerUserWorkflowSummary,
  options: PowerUserWorkflowSummaryOptions,
): string {
  const name = summary.workflowName ?? summary.workflowPath ?? 'workflow';
  if (options.runRequested) {
    return `Ricky ${summary.mode}: ${name} run ${summary.status ?? 'requested'}.`;
  }
  if (summary.status === 'blocked' || summary.status === 'error') {
    return `Ricky ${summary.mode}: ${name} ${summary.status}.`;
  }
  return `Ricky ${summary.mode}: ${name} generated; run when ready.`;
}

function resolveArtifactPath(localResult: LocalResponse | undefined, capture: CapturedWorkflowSpec): string {
  return localResult?.generation?.artifact?.path ?? localResult?.artifacts[0]?.path ?? capture.artifactPath ?? capture.specPath ?? 'workflows/generated/local-workflow.ts';
}

function summarizeGoal(spec: string): string {
  const firstLine = spec
    .split(/\r?\n/)
    .map((line) => line.replace(/^[-#*\s]+/, '').trim())
    .find(Boolean);
  return firstLine ?? 'Run the requested local workflow to completion.';
}

function resolveAgents(localResult: LocalResponse | undefined): WorkflowSummaryAgent[] {
  const fromDecisions = localResult?.generation?.decisions?.tool_selection;
  if (Array.isArray(fromDecisions)) {
    const agents = fromDecisions
      .map((selection) => {
        if (!selection || typeof selection !== 'object') return null;
        const record = selection as Record<string, unknown>;
        const name = typeof record.agent === 'string' ? record.agent : undefined;
        const runner = typeof record.runner === 'string' ? record.runner : undefined;
        if (!name && !runner) return null;
        return {
          name: name ?? runner ?? 'local-agent',
          job: `Run ${typeof record.stepId === 'string' ? record.stepId : 'workflow'} tasks with ${runner ?? 'the selected local runner'}.`,
        };
      })
      .filter((agent): agent is WorkflowSummaryAgent => agent !== null);
    if (agents.length > 0) return dedupeAgents(agents);
  }

  const content = localResult?.artifacts.find((artifact) => artifact.content)?.content;
  if (content) {
    const agents = parseAgentsFromArtifact(content);
    if (agents.length > 0) return agents;
  }

  return [
    {
      name: 'Codex',
      job: 'Implement or repair local workflow/code issues when the generated workflow assigns code tasks.',
    },
    {
      name: 'Claude',
      job: 'Review workflow structure, acceptance criteria, and final signoff when review tasks are present.',
    },
  ];
}

function parseAgentsFromArtifact(content: string): WorkflowSummaryAgent[] {
  const agents: WorkflowSummaryAgent[] = [];
  const pattern = /\.agent\(\s*['"`]([^'"`]+)['"`]\s*,\s*\{([\s\S]*?)\}\s*\)/g;
  for (const match of content.matchAll(pattern)) {
    const name = match[1];
    const body = match[2] ?? '';
    const role = /role:\s*['"`]([^'"`]+)['"`]/.exec(body)?.[1];
    agents.push({
      name,
      job: role ?? 'Run assigned workflow tasks.',
    });
  }
  return dedupeAgents(agents);
}

function dedupeAgents(agents: WorkflowSummaryAgent[]): WorkflowSummaryAgent[] {
  const seen = new Set<string>();
  const result: WorkflowSummaryAgent[] = [];
  for (const agent of agents) {
    const key = agent.name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(agent);
  }
  return result;
}

function workflowNameFromPath(path: string | undefined): string | undefined {
  if (!path) return undefined;
  const file = path.split('/').at(-1) ?? path;
  return file.replace(/\.(?:workflow\.)?(?:ts|js|yaml|yml)$/i, '');
}

function removeUndefined(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
}

export type CloudWorkflowSummaryAgent = 'claude' | 'codex' | 'opencode' | 'gemini';
export type CloudWorkflowSummaryIntegration = 'slack' | 'github' | 'notion' | 'linear';

export interface CloudWorkflowSummary {
  availableAgents: CloudWorkflowSummaryAgent[];
  connectedIntegrations: CloudWorkflowSummaryIntegration[];
  caveats: string[];
  lines: string[];
}

const CLOUD_AGENT_LABELS: Record<CloudWorkflowSummaryAgent, string> = {
  claude: 'Claude',
  codex: 'Codex',
  opencode: 'OpenCode',
  gemini: 'Gemini',
};

const CLOUD_INTEGRATION_LABELS: Record<CloudWorkflowSummaryIntegration, string> = {
  slack: 'Slack',
  github: 'GitHub',
  notion: 'Notion',
  linear: 'Linear',
};

export function renderCloudWorkflowSummary(params: {
  readiness: {
    integrations: Record<CloudWorkflowSummaryIntegration, { connected: boolean }>;
  };
  availableAgents: CloudWorkflowSummaryAgent[];
  selectedIntegrations: CloudWorkflowSummaryIntegration[];
  skippedIntegrations: CloudWorkflowSummaryIntegration[];
  relevantSkippedIntegrations: CloudWorkflowSummaryIntegration[];
}): CloudWorkflowSummary {
  const connectedIntegrations = params.selectedIntegrations.filter(
    (integration) => params.readiness.integrations[integration]?.connected === true,
  );
  const caveats = params.relevantSkippedIntegrations.map((integration) => {
    const label = CLOUD_INTEGRATION_LABELS[integration];
    return `${label} was skipped, so Cloud will not use ${label}-backed context for this run.`;
  });
  const agentLabels = params.availableAgents.map((agent) => CLOUD_AGENT_LABELS[agent]);
  const connectedIntegrationLabels = connectedIntegrations.map((integration) => CLOUD_INTEGRATION_LABELS[integration]);

  const lines = [
    'Cloud run summary:',
    `  Agents available: ${agentLabels.length > 0 ? agentLabels.join(', ') : 'none'}`,
    `  Optional integrations connected: ${
      connectedIntegrationLabels.length > 0 ? connectedIntegrationLabels.join(', ') : 'none'
    }`,
  ];

  for (const caveat of caveats) {
    lines.push(`  Caveat: ${caveat}`);
  }

  return {
    availableAgents: params.availableAgents,
    connectedIntegrations,
    caveats,
    lines,
  };
}
