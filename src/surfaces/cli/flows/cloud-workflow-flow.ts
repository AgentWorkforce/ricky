import type { CloudGenerateRequest } from '../../../cloud/api/request-types.js';
import type { CloudWorkflowSummary } from './workflow-summary.js';

import { renderCloudWorkflowSummary } from './workflow-summary.js';

export type CloudImplementationAgent = 'claude' | 'codex' | 'opencode' | 'gemini';
export type CloudOptionalIntegration = 'slack' | 'github' | 'notion' | 'linear';
export type CloudLoginRequirement = 'account' | 'credentials' | 'workspace';

export interface CloudReadinessCheck {
  connected: boolean;
  label?: string;
  recovery?: string;
}

export interface CloudAgentReadiness extends CloudReadinessCheck {
  capable: boolean;
}

export interface CloudReadinessSnapshot {
  account: CloudReadinessCheck;
  credentials: CloudReadinessCheck;
  workspace: CloudReadinessCheck;
  agents: Record<CloudImplementationAgent, CloudAgentReadiness>;
  integrations: Record<CloudOptionalIntegration, CloudReadinessCheck>;
}

export type MissingCloudAgentAction =
  | { action: 'connect-all' }
  | { action: 'choose'; agents: CloudImplementationAgent[] }
  | { action: 'continue-connected' }
  | { action: 'go-back' };

export type OptionalIntegrationSelection =
  | { action: 'connect'; integrations: CloudOptionalIntegration[] }
  | { action: 'skip-all' }
  | { action: 'go-back' };

export type CloudRunConfirmation =
  | { action: 'run-and-monitor' }
  | { action: 'show-command' }
  | { action: 'edit-first' };

export interface CloudWorkflowFlowDeps {
  checkCloudReadiness?: () => Promise<CloudReadinessSnapshot>;
  recoverCloudLogin?: (params: {
    missing: CloudLoginRequirement[];
    readiness: CloudReadinessSnapshot;
  }) => Promise<void>;
  promptMissingCloudAgents?: (params: {
    availableAgents: CloudImplementationAgent[];
    missingAgents: CloudImplementationAgent[];
    readiness: CloudReadinessSnapshot;
  }) => Promise<MissingCloudAgentAction>;
  connectCloudAgents?: (agents: CloudImplementationAgent[]) => Promise<void>;
  selectOptionalCloudIntegrations?: (params: {
    connectedIntegrations: CloudOptionalIntegration[];
    missingIntegrations: CloudOptionalIntegration[];
    relevantIntegrations: CloudOptionalIntegration[];
    readiness: CloudReadinessSnapshot;
  }) => Promise<OptionalIntegrationSelection>;
  connectOptionalCloudIntegrations?: (integrations: CloudOptionalIntegration[]) => Promise<void>;
  confirmCloudRun?: (summary: CloudWorkflowSummary) => Promise<CloudRunConfirmation | boolean>;
}

export type CloudWorkflowFlowResult =
  | {
      ok: true;
      request: CloudGenerateRequest;
      summary: CloudWorkflowSummary;
      guidance: string[];
    }
  | {
      ok: false;
      summary?: CloudWorkflowSummary;
      guidance: string[];
    };

export type CloudReadinessSetupResult =
  | {
      ok: true;
      readiness: CloudReadinessSnapshot;
      summary: CloudWorkflowSummary;
      guidance: string[];
    }
  | {
      ok: false;
      guidance: string[];
    };

export const CLOUD_IMPLEMENTATION_AGENTS: CloudImplementationAgent[] = [
  'claude',
  'codex',
  'opencode',
  'gemini',
];

export const CLOUD_OPTIONAL_INTEGRATIONS: CloudOptionalIntegration[] = [
  'slack',
  'github',
  'notion',
  'linear',
];

const LOGIN_LABELS: Record<CloudLoginRequirement, string> = {
  account: 'Cloud account',
  credentials: 'Cloud credentials',
  workspace: 'Cloud workspace',
};

const AGENT_LABELS: Record<CloudImplementationAgent, string> = {
  claude: 'Claude',
  codex: 'Codex',
  opencode: 'OpenCode',
  gemini: 'Gemini',
};

const INTEGRATION_LABELS: Record<CloudOptionalIntegration, string> = {
  slack: 'Slack',
  github: 'GitHub',
  notion: 'Notion',
  linear: 'Linear',
};

export async function runCloudWorkflowFlow(
  request: CloudGenerateRequest,
  deps: CloudWorkflowFlowDeps = {},
): Promise<CloudWorkflowFlowResult> {
  const setup = await prepareCloudWorkflowReadiness(request, deps);
  if (!setup.ok) return setup;

  const { summary } = setup;

  const confirmation = deps.confirmCloudRun
    ? normalizeCloudConfirmation(await deps.confirmCloudRun(summary))
    : ({ action: 'run-and-monitor' } as CloudRunConfirmation);

  if (confirmation.action === 'show-command') {
    return {
      ok: false,
      summary,
      guidance: [
        ...summary.lines,
        'Cloud run command:',
        `  ricky cloud --spec-file ${request.body.specPath ?? './spec.md'} --no-run`,
        'Run that command when ready. No local fallback was attempted.',
      ],
    };
  }

  if (confirmation.action === 'edit-first') {
    return {
      ok: false,
      summary,
      guidance: [
        ...summary.lines,
        'Cloud run paused so you can edit the workflow first.',
        'Re-invoke `ricky cloud` after the edits to retry. No local fallback was attempted.',
      ],
    };
  }

  return {
    ok: true,
    request: withCloudMetadata(request, summary),
    summary,
    guidance: summary.caveats.length > 0 ? summary.lines : [],
  };
}

export async function prepareCloudWorkflowReadiness(
  request: CloudGenerateRequest,
  deps: CloudWorkflowFlowDeps = {},
): Promise<CloudReadinessSetupResult> {
  const checkReadiness = deps.checkCloudReadiness ?? (() => Promise.resolve(inferReadinessFromRequest(request)));
  let readiness = await checkReadiness();

  const loginGuidance = await recoverMissingLogin(readiness, deps, checkReadiness);
  if (!loginGuidance.ok) return { ok: false, guidance: loginGuidance.guidance };
  readiness = loginGuidance.readiness;

  const agentGuidance = await resolveMissingAgents(readiness, deps, checkReadiness);
  if (!agentGuidance.ok) return { ok: false, guidance: agentGuidance.guidance };
  readiness = agentGuidance.readiness;

  let availableAgents = capableAgents(readiness);
  if (availableAgents.length === 0) {
    return {
      ok: false,
      guidance: [
        'Cloud execution requires at least one capable implementation agent.',
        'Connect Claude, Codex, OpenCode, or Gemini before retrying Cloud mode.',
      ],
    };
  }

  const integrationGuidance = await resolveOptionalIntegrations(request, readiness, deps, checkReadiness);
  if (!integrationGuidance.ok) return { ok: false, guidance: integrationGuidance.guidance };
  readiness = integrationGuidance.readiness;
  availableAgents = capableAgents(readiness);

  const summary = renderCloudWorkflowSummary({
    readiness,
    availableAgents,
    selectedIntegrations: integrationGuidance.selectedIntegrations,
    skippedIntegrations: integrationGuidance.skippedIntegrations,
    relevantSkippedIntegrations: integrationGuidance.relevantSkippedIntegrations,
  });

  return {
    ok: true,
    readiness,
    summary,
    guidance: summary.caveats.length > 0 ? summary.lines : [],
  };
}

function normalizeCloudConfirmation(value: CloudRunConfirmation | boolean): CloudRunConfirmation {
  if (typeof value === 'boolean') {
    return value ? { action: 'run-and-monitor' } : { action: 'show-command' };
  }
  return value;
}

async function recoverMissingLogin(
  readiness: CloudReadinessSnapshot,
  deps: CloudWorkflowFlowDeps,
  checkReadiness: () => Promise<CloudReadinessSnapshot>,
): Promise<{ ok: true; readiness: CloudReadinessSnapshot } | { ok: false; guidance: string[] }> {
  const missing = missingLoginRequirements(readiness);
  if (missing.length === 0) return { ok: true, readiness };

  if (!deps.recoverCloudLogin) {
    return {
      ok: false,
      guidance: [
        `Cloud login is incomplete: ${missing.map((item) => LOGIN_LABELS[item]).join(', ')}.`,
        'Run the Cloud login flow, then retry Cloud mode. No local fallback was attempted.',
      ],
    };
  }

  await deps.recoverCloudLogin({ missing, readiness });
  const refreshed = await checkReadiness();
  const stillMissing = missingLoginRequirements(refreshed);
  if (stillMissing.length > 0) {
    return {
      ok: false,
      guidance: [
        `Cloud login is still incomplete after recovery: ${stillMissing.map((item) => LOGIN_LABELS[item]).join(', ')}.`,
        'Retry the Cloud login flow or choose local mode explicitly. No local fallback was attempted.',
      ],
    };
  }

  return { ok: true, readiness: refreshed };
}

async function resolveMissingAgents(
  readiness: CloudReadinessSnapshot,
  deps: CloudWorkflowFlowDeps,
  checkReadiness: () => Promise<CloudReadinessSnapshot>,
): Promise<{ ok: true; readiness: CloudReadinessSnapshot } | { ok: false; guidance: string[] }> {
  const missingAgents = CLOUD_IMPLEMENTATION_AGENTS.filter((agent) => !agentIsAvailable(readiness, agent));
  if (missingAgents.length === 0) return { ok: true, readiness };

  if (!deps.promptMissingCloudAgents) {
    if (capableAgents(readiness).length > 0) {
      return { ok: true, readiness };
    }

    return {
      ok: false,
      guidance: [
        'No capable Cloud implementation agents are connected.',
        'Connect Claude, Codex, OpenCode, or Gemini before retrying Cloud mode. No local fallback was attempted.',
      ],
    };
  }

  const selection = await deps.promptMissingCloudAgents({
    availableAgents: capableAgents(readiness),
    missingAgents,
    readiness,
  });

  if (selection.action === 'go-back') {
    return {
      ok: false,
      guidance: ['Cloud setup returned to mode selection. No local fallback was attempted.'],
    };
  }

  if (selection.action === 'continue-connected') {
    if (capableAgents(readiness).length === 0) {
      return {
        ok: false,
        guidance: [
          'Cannot continue with connected agents because none are capable implementation agents.',
          'Connect Claude, Codex, OpenCode, or Gemini before retrying Cloud mode.',
        ],
      };
    }
    return { ok: true, readiness };
  }

  const agentsToConnect = selection.action === 'connect-all' ? missingAgents : selection.agents;
  if (agentsToConnect.length > 0) {
    if (!deps.connectCloudAgents) {
      return {
        ok: false,
        guidance: [
          `Cloud agent connection was requested for ${agentsToConnect.map((agent) => AGENT_LABELS[agent]).join(', ')}, but no connector is configured.`,
          'Connect the agents through Cloud settings, then retry Cloud mode.',
        ],
      };
    }
    await deps.connectCloudAgents(agentsToConnect);
  }

  const refreshed = await checkReadiness();
  if (capableAgents(refreshed).length === 0) {
    return {
      ok: false,
      guidance: [
        'Cloud agent connection did not produce a capable implementation agent.',
        'At least one of Claude, Codex, OpenCode, or Gemini is required before Cloud execution.',
      ],
    };
  }

  return { ok: true, readiness: refreshed };
}

async function resolveOptionalIntegrations(
  request: CloudGenerateRequest,
  readiness: CloudReadinessSnapshot,
  deps: CloudWorkflowFlowDeps,
  checkReadiness: () => Promise<CloudReadinessSnapshot>,
): Promise<
  | {
      ok: true;
      readiness: CloudReadinessSnapshot;
      selectedIntegrations: CloudOptionalIntegration[];
      skippedIntegrations: CloudOptionalIntegration[];
      relevantSkippedIntegrations: CloudOptionalIntegration[];
    }
  | { ok: false; guidance: string[] }
> {
  const connectedIntegrations = CLOUD_OPTIONAL_INTEGRATIONS.filter(
    (integration) => readiness.integrations[integration]?.connected === true,
  );
  const missingIntegrations = CLOUD_OPTIONAL_INTEGRATIONS.filter(
    (integration) => readiness.integrations[integration]?.connected !== true,
  );
  const relevantIntegrations = relevantOptionalIntegrations(request);

  if (!deps.selectOptionalCloudIntegrations || missingIntegrations.length === 0) {
    return {
      ok: true,
      readiness,
      selectedIntegrations: connectedIntegrations,
      skippedIntegrations: missingIntegrations,
      relevantSkippedIntegrations: missingIntegrations.filter((integration) => relevantIntegrations.includes(integration)),
    };
  }

  const selection = await deps.selectOptionalCloudIntegrations({
    connectedIntegrations,
    missingIntegrations,
    relevantIntegrations,
    readiness,
  });

  if (selection.action === 'go-back') {
    return {
      ok: false,
      guidance: ['Cloud integration setup returned to mode selection. No local fallback was attempted.'],
    };
  }

  if (selection.action === 'connect' && selection.integrations.length > 0) {
    if (!deps.connectOptionalCloudIntegrations) {
      return {
        ok: false,
        guidance: [
          `Optional integration connection was requested for ${selection.integrations
            .map((integration) => INTEGRATION_LABELS[integration])
            .join(', ')}, but no connector is configured.`,
          'Connect integrations through Cloud settings, then retry Cloud mode.',
        ],
      };
    }
    await deps.connectOptionalCloudIntegrations(selection.integrations);
    readiness = await checkReadiness();
  }

  const selectedIntegrations = CLOUD_OPTIONAL_INTEGRATIONS.filter(
    (integration) => readiness.integrations[integration]?.connected === true,
  );
  const skippedIntegrations = CLOUD_OPTIONAL_INTEGRATIONS.filter(
    (integration) => readiness.integrations[integration]?.connected !== true,
  );

  return {
    ok: true,
    readiness,
    selectedIntegrations,
    skippedIntegrations,
    relevantSkippedIntegrations: skippedIntegrations.filter((integration) => relevantIntegrations.includes(integration)),
  };
}

function missingLoginRequirements(readiness: CloudReadinessSnapshot): CloudLoginRequirement[] {
  const missing: CloudLoginRequirement[] = [];
  if (readiness.account.connected !== true) missing.push('account');
  if (readiness.credentials.connected !== true) missing.push('credentials');
  if (readiness.workspace.connected !== true) missing.push('workspace');
  return missing;
}

function capableAgents(readiness: CloudReadinessSnapshot): CloudImplementationAgent[] {
  return CLOUD_IMPLEMENTATION_AGENTS.filter((agent) => agentIsAvailable(readiness, agent));
}

function agentIsAvailable(readiness: CloudReadinessSnapshot, agent: CloudImplementationAgent): boolean {
  const state = readiness.agents[agent];
  return state?.connected === true && state.capable === true;
}

function relevantOptionalIntegrations(request: CloudGenerateRequest): CloudOptionalIntegration[] {
  const specText = describeSpec(request.body.spec).toLowerCase();
  return CLOUD_OPTIONAL_INTEGRATIONS.filter((integration) => specText.includes(integration));
}

function describeSpec(spec: CloudGenerateRequest['body']['spec']): string {
  if (typeof spec === 'string') return spec;
  if (spec.kind === 'natural-language') return spec.text;
  return JSON.stringify(spec.document);
}

function withCloudMetadata(
  request: CloudGenerateRequest,
  summary: CloudWorkflowSummary,
): CloudGenerateRequest {
  return {
    ...request,
    body: {
      ...request.body,
      metadata: {
        ...request.body.metadata,
        cloudReadiness: {
          availableAgents: summary.availableAgents,
          connectedIntegrations: summary.connectedIntegrations,
          skippedIntegrations: summary.skippedIntegrations,
          relevantSkippedIntegrations: summary.relevantSkippedIntegrations,
          caveats: summary.caveats,
        },
      },
    },
  };
}

function inferReadinessFromRequest(request: CloudGenerateRequest): CloudReadinessSnapshot {
  const hasToken = request.auth?.token?.trim().length > 0;
  const hasWorkspace = request.workspace?.workspaceId?.trim().length > 0;
  return {
    account: { connected: hasToken },
    credentials: { connected: hasToken },
    workspace: { connected: hasWorkspace },
    agents: {
      claude: { connected: true, capable: true },
      codex: { connected: true, capable: true },
      opencode: { connected: true, capable: true },
      gemini: { connected: true, capable: true },
    },
    integrations: {
      slack: { connected: false },
      github: { connected: false },
      notion: { connected: false },
      linear: { connected: false },
    },
  };
}
