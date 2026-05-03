/**
 * Bounded interactive Ricky CLI entry surface.
 *
 * Composes onboarding, local/BYOH execution, Cloud generation,
 * and runtime failure diagnosis into a single deterministic entrypoint.
 *
 * Design invariants:
 * - Local and Cloud paths are distinct and truthful — no silent fallback.
 * - Local failures surface runtime diagnosis guidance, not raw errors.
 * - Cloud failures surface bounded recovery guidance, not fake success.
 * - All side-effecting dependencies are injectable for deterministic tests.
 */

import type { OnboardingResult, RickyConfigStore } from '../cli/onboarding.js';
import type { RickyMode } from '../cli/mode-selector.js';
import type { CloudExecutor, CloudGenerateResult } from '../../../cloud/api/generate-endpoint.js';
import type { CloudGenerateRequest, CloudGenerateRequestBody } from '../../../cloud/api/request-types.js';
import type {
  CloudWorkflowFlowDeps,
  CloudImplementationAgent,
  CloudOptionalIntegration,
  CloudLoginRequirement,
  CloudAgentReadiness,
  CloudReadinessCheck,
  CloudReadinessSnapshot,
  CloudRunConfirmation,
  MissingCloudAgentAction,
} from '../flows/cloud-workflow-flow.js';
import type { CloudWorkflowSummary } from '../flows/workflow-summary.js';
import type { LocalWorkflowFlowDeps, LocalWorkflowFlowResult } from '../flows/local-workflow-flow.js';
import type { LocalExecutor, LocalEntrypointOptions, LocalExecutorOptions, LocalResponse } from '../../../local/entrypoint.js';
import type { RawHandoff } from '../../../local/request-normalizer.js';
import type { Diagnosis, DiagnosticSignal } from '../../../runtime/diagnostics/failure-diagnosis.js';
import type { ConnectProviderOptions, ConnectProviderResult, StoredAuth, WhoAmIResponse } from '@agent-relay/cloud';

import {
  renderRecoveryGuidance,
  renderWorkflowGenerationFailureRecovery,
  runOnboarding,
} from '../cli/onboarding.js';
import { toRickyMode } from '../cli/mode-selector.js';
import type { ProviderStatus } from '../cli/mode-selector.js';
import { handleCloudGenerate } from '../../../cloud/api/generate-endpoint.js';
import { runLocal } from '../../../local/entrypoint.js';
import { diagnose } from '../../../runtime/diagnostics/failure-diagnosis.js';
import { prepareCloudWorkflowReadiness, runCloudWorkflowFlow } from '../flows/cloud-workflow-flow.js';
import {
  createInquirerLocalWorkflowPrompts,
  runLocalPreflight,
  runLocalWorkflowFlow,
} from '../flows/local-workflow-flow.js';
import { runSpecIntakeFlow, type CapturedWorkflowSpec, type SpecIntakePrompts } from '../flows/spec-intake-flow.js';
import {
  createInquirerPromptKit,
  isPromptCancellation,
  type PromptKit,
} from '../prompts/index.js';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { DEFAULT_AUTO_FIX_ATTEMPTS } from '../../../shared/constants.js';

// ---------------------------------------------------------------------------
// Interactive CLI result contract
// ---------------------------------------------------------------------------

export interface InteractiveCliResult {
  /** Whether the interactive session completed without fatal errors. */
  ok: boolean;
  /** The resolved execution mode after onboarding. */
  mode: RickyMode;
  /** Onboarding output (banner, welcome, mode selection). */
  onboarding: OnboardingResult;
  /** Local execution result, if the local path was taken. */
  localResult?: LocalResponse;
  /** Cloud generation result, if the cloud path was taken. */
  cloudResult?: CloudGenerateResult;
  /** Guided Cloud readiness summary, if Cloud mode reached run confirmation. */
  cloudSummary?: CloudWorkflowSummary;
  /** Guided local workflow result, if local mode used the hand-holding flow. */
  localWorkflowResult?: LocalWorkflowFlowResult;
  /** Runtime diagnoses surfaced for local failures. */
  diagnoses: Diagnosis[];
  /** Recovery guidance lines surfaced to the user. */
  guidance: string[];
  /** True when Ricky only completed onboarding / mode selection and did not execute. */
  awaitingInput?: boolean;
}

export type ConnectToolChoice = 'cloud' | 'agents' | 'integrations';
export type RelayCloudConnectProvider = (options: ConnectProviderOptions) => Promise<ConnectProviderResult>;
export type RelayCloudAuthenticator = () => Promise<StoredAuth>;
export type CloudIntegrationConnectResult = {
  integration: CloudOptionalIntegration;
  status: 'link-opened' | 'link-created' | 'failed';
  url?: string;
  message?: string;
  endpoint?: string;
  statusCode?: number;
};
export type CloudIntegrationConnector = (integrations: CloudOptionalIntegration[]) => Promise<CloudIntegrationConnectResult[]>;

const CONNECT_OPTIONAL_INTEGRATIONS: readonly CloudOptionalIntegration[] = ['slack', 'github', 'notion', 'linear'];
const CONNECT_INTEGRATION_LABELS: Record<CloudOptionalIntegration, string> = {
  slack: 'Slack',
  github: 'GitHub',
  notion: 'Notion',
  linear: 'Linear',
};

// ---------------------------------------------------------------------------
// Dependencies — all injectable for deterministic testing
// ---------------------------------------------------------------------------

export interface InteractiveCliDeps extends CloudWorkflowFlowDeps {
  /** Onboarding runner — defaults to the real runOnboarding. */
  onboard?: (options: {
    input?: NodeJS.ReadableStream;
    output?: NodeJS.WritableStream;
    isTTY?: boolean;
    mode?: RickyMode;
    configStore?: RickyConfigStore;
    verbose?: boolean;
    signal?: AbortSignal;
  }) => Promise<OnboardingResult>;

  /** Caller workspace path for local artifact generation. Defaults to INIT_CWD or process.cwd(). */
  cwd?: string;

  /** Local executor for the BYOH path. */
  localExecutor?: LocalExecutor;

  /** Cloud executor for the hosted generation path. */
  cloudExecutor?: CloudExecutor;

  /** Diagnostic engine — defaults to the real diagnose function. */
  diagnoseFn?: (signal: DiagnosticSignal) => Diagnosis | null;

  /** The raw handoff to execute (spec, source, mode). */
  handoff?: RawHandoff;

  /** Cloud request context — required when mode is 'cloud'. */
  cloudRequest?: CloudGenerateRequest;

  /** Config store override for onboarding. */
  configStore?: RickyConfigStore;

  /** Provider status override for the compact first screen. */
  providerStatus?: ProviderStatus;

  /** Explicit mode override — skips interactive selection. */
  mode?: RickyMode;

  /** Overrides env/CLI derivation when tests inject Ricky-owned executors. */
  preferWorkforcePersonaWorkflowWriter?: undefined | boolean;

  /** Guided local prompt/runtime dependencies. Present only for interactive hand-holding mode. */
  localWorkflow?: Omit<LocalWorkflowFlowDeps, 'cwd' | 'runLocalFn'>;

  /** Optional injected prompt for Connect tools second-step selection. */
  selectConnectTools?: () => Promise<ConnectToolChoice[]>;

  /** Optional injected Inquirer prompt wrapper for deterministic prompt tests. */
  promptKit?: PromptKit;

  /** Optional injected prompt for selecting concrete optional integrations. */
  selectConnectIntegrations?: () => Promise<CloudOptionalIntegration[]>;

  /** Optional injected confirmation before launching Daytona-backed Cloud agent auth. */
  confirmCloudAgentProviderAuth?: (providers: CloudImplementationAgent[]) => Promise<boolean>;

  /** Optional injected Nango connect-link connector for Slack/GitHub/Notion/Linear. */
  connectCloudIntegrations?: CloudIntegrationConnector;

  /** Relay Cloud connector override for deterministic Connect tools tests. */
  connectProvider?: RelayCloudConnectProvider;

  /** Relay Cloud account login override for deterministic Connect tools tests. */
  ensureCloudAuthenticated?: RelayCloudAuthenticator;

  /** Cloud API URL override passed through to the Relay Cloud connector. */
  connectApiUrl?: string;

  /** Provider auth timeout override passed through to the Relay Cloud connector. */
  connectTimeoutMs?: number;

  /** Cloud auth reader override for deterministic guided Cloud tests. */
  readCloudAuth?: () => Promise<StoredAuth | null>;

  /** Cloud profile/workspace resolver override for deterministic guided Cloud tests. */
  resolveCloudWorkspace?: (auth: StoredAuth) => Promise<string | undefined>;

  /** Stream overrides for non-interactive / test contexts. */
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
  isTTY?: boolean;
  verbose?: boolean;
  signal?: AbortSignal;

  /** Concise local-run progress updates for foreground CLI execution. */
  localProgress?: (message: string) => void;

  /** Foreground local workflow stdout/stderr passthrough. */
  localRuntimeOutput?: (stream: 'stdout' | 'stderr', line: string) => void;
}

function applyCliWorkforcePersonaPreferenceToLocalExecutor(
  preference: InteractiveCliDeps['preferWorkforcePersonaWorkflowWriter'],
  base: LocalExecutorOptions,
): LocalExecutorOptions {
  if (preference === undefined) return base;
  if (preference === false) return { ...base, workforcePersonaWriter: false };
  return { ...base, workforcePersonaWriter: {} };
}

function guidedLocalOptionsPreferringWorkforcePersona(
  preference: InteractiveCliDeps['preferWorkforcePersonaWorkflowWriter'],
): Pick<LocalEntrypointOptions, 'localExecutor'> | undefined {
  if (preference === undefined) return undefined;
  return {
    localExecutor: applyCliWorkforcePersonaPreferenceToLocalExecutor(preference, {}),
  };
}

// ---------------------------------------------------------------------------
// Local path — execute with diagnosis on failure
// ---------------------------------------------------------------------------

async function executeLocalPath(
  deps: InteractiveCliDeps,
  _mode: RickyMode,
): Promise<{
  localResult?: LocalResponse;
  diagnoses: Diagnosis[];
  guidance: string[];
  awaitingInput: boolean;
  localWorkflowResult?: LocalWorkflowFlowResult;
}> {
  if (!deps.handoff) {
    const localWorkflow = deps.localWorkflow ?? defaultLocalWorkflowDeps(deps);
    if (localWorkflow) {
      const defaultLocalOptions = deps.localExecutor
        ? { executor: deps.localExecutor }
        : guidedLocalOptionsPreferringWorkforcePersona(deps.preferWorkforcePersonaWorkflowWriter);
      const localWorkflowResult = await runLocalWorkflowFlow({
        ...localWorkflow,
        localOptions: localWorkflow.localOptions ?? defaultLocalOptions,
        cwd: resolveLocalInvocationRoot(deps),
        runLocalFn: runLocal,
      });
      return {
        localResult:
          localWorkflowResult.run ??
          localWorkflowResult.monitoredRun?.response ??
          localWorkflowResult.generation,
        diagnoses: [],
        guidance: [],
        awaitingInput: false,
        localWorkflowResult,
      };
    }

    return {
      diagnoses: [],
      guidance: [
        'No spec provided — nothing was generated, nothing was executed.',
        '',
        'To generate a workflow artifact (no execution):',
        '  ricky --mode local --spec "generate a workflow for package checks"',
        '  ricky --mode local --spec-file ./path/to/spec.md',
        '  printf "%s\\n" "<spec>" | ricky --mode local --stdin',
        '',
        'To generate and then execute:',
        '  Append --run to any command above.',
        '',
        'To execute an existing artifact:',
        '  ricky run workflows/generated/<file>.ts  (requires npm-linked CLI)',
        '  ricky run workflows/generated/<file>.ts',
      ],
      awaitingInput: true,
    };
  }

  const invocationRoot = resolveLocalInvocationRoot(deps);
  const handoff = withInvocationRoot(deps.handoff, invocationRoot);

  const localResult = await runLocal(handoff, {
    executor: deps.localExecutor,
    ...(deps.localProgress ? { onProgress: deps.localProgress } : {}),
    ...(deps.localRuntimeOutput ? { onRuntimeOutput: deps.localRuntimeOutput } : {}),
    localExecutor: deps.localExecutor
      ? undefined
      : applyCliWorkforcePersonaPreferenceToLocalExecutor(deps.preferWorkforcePersonaWorkflowWriter, {
          cwd: invocationRoot,
          returnGeneratedArtifactOnly: handoff.stageMode !== 'run',
        }),
  });

  const diagnoses: Diagnosis[] = [];
  const guidance: string[] = [];

  if (!localResult.ok) {
    // Attempt runtime diagnosis on each log/warning signal
    const signals = collectLocalDiagnosticSignals(localResult);

    const diagnoseFn = deps.diagnoseFn ?? diagnose;
    for (const signal of signals) {
      const d = diagnoseFn(signal);
      if (d) diagnoses.push(d);
    }

    if (diagnoses.length > 0) {
      // Surface structured diagnosis guidance instead of raw error
      for (const d of diagnoses) {
        guidance.push(`[${d.label}] ${d.unblocker.action}`);
        guidance.push(`  Rationale: ${d.unblocker.rationale}`);
      }
    } else {
      // No specific diagnosis matched — surface generic recovery guidance
      const firstWarning = localResult.warnings[0] ?? localResult.logs[0] ?? null;
      guidance.push(renderRecoveryGuidance(firstWarning));
    }
  }

  return { localResult, diagnoses, guidance, awaitingInput: false };
}

function collectLocalDiagnosticSignals(localResult: LocalResponse): DiagnosticSignal[] {
  const signals: DiagnosticSignal[] = [
    ...localResult.logs.map((msg) => ({ source: 'local-runtime', message: msg })),
    ...localResult.warnings.map((msg) => ({ source: 'local-runtime', message: msg })),
  ];

  const execution = localResult.execution;
  if (!execution) return signals;

  if (execution.blocker) {
    signals.push({
      source: 'local-blocker',
      message: execution.blocker.message,
      meta: {
        code: execution.blocker.code,
        category: execution.blocker.category,
        detectedDuring: execution.blocker.detected_during,
      },
    });
  }

  if (execution.evidence?.outcome_summary) {
    signals.push({ source: 'local-evidence', message: execution.evidence.outcome_summary });
  }

  for (const line of execution.evidence?.logs.tail ?? []) {
    signals.push({ source: 'local-runtime-tail', message: line });
  }

  return signals;
}

function resolveLocalInvocationRoot(deps: InteractiveCliDeps): string {
  if (deps.handoff?.invocationRoot) return resolve(deps.handoff.invocationRoot);
  if (deps.cwd) return resolve(deps.cwd);
  if (process.env.INIT_CWD) return resolve(process.env.INIT_CWD);
  return resolve(process.cwd());
}

function withInvocationRoot(handoff: RawHandoff, invocationRoot: string): RawHandoff {
  return { ...handoff, invocationRoot };
}

function defaultLocalWorkflowDeps(
  deps: InteractiveCliDeps,
): Omit<LocalWorkflowFlowDeps, 'cwd' | 'runLocalFn'> | undefined {
  const input = deps.input ?? process.stdin;
  const output = deps.output ?? process.stdout;
  const isTTY = deps.isTTY ?? ((input as NodeJS.ReadableStream & { isTTY?: boolean }).isTTY === true);
  const ownsTerminal = deps.input === undefined && deps.output === undefined && input === process.stdin && output === process.stdout;
  if (!isTTY || !ownsTerminal) return undefined;

  return {
    prompts: createInquirerLocalWorkflowPrompts({ input, output }),
    localOptions: deps.localExecutor
      ? { executor: deps.localExecutor }
      : guidedLocalOptionsPreferringWorkforcePersona(deps.preferWorkforcePersonaWorkflowWriter),
    onMonitorStarted: (state) => {
      output.write([
        '',
        'Ricky will run this in the background, monitor for issues, persist evidence, and keep auto-fixes bounded to non-destructive changes.',
        `  Workflow run id: ${state.runId}`,
        `  Status command: ${state.reattachCommand}`,
        `  Logs: ${state.logPath}`,
        `  Evidence: ${state.evidencePath}`,
        '',
      ].join('\n'));
    },
  };
}

// ---------------------------------------------------------------------------
// Cloud path — generate with bounded recovery on failure
// ---------------------------------------------------------------------------

async function renderCloudAwaitingSpecGuidance(deps: InteractiveCliDeps): Promise<string[]> {
  const lines = [
    'Cloud mode selected.',
    '',
    'Cloud needs a workflow spec before Ricky can generate or run anything.',
  ];

  const readiness = deps.checkCloudReadiness ? await deps.checkCloudReadiness() : null;
  if (readiness) {
    lines.push('');
    lines.push('Cloud readiness');
    lines.push(`  Account:     ${readiness.account.connected ? 'connected' : 'missing'}`);
    lines.push(`  Credentials: ${readiness.credentials.connected ? 'connected' : 'missing'}`);
    lines.push(`  Workspace:   ${readiness.workspace.connected ? 'selected' : 'missing'}`);
    lines.push(`  Agents:      ${cloudAgentReadinessLine(readiness)}`);

    if (!readiness.account.connected || !readiness.credentials.connected || !readiness.workspace.connected) {
      lines.push('');
      lines.push('Cloud account setup');
      lines.push('  Ricky did not attempt a Cloud login automatically.');
      lines.push('  Run: ricky connect cloud');
    }
  }

  lines.push('');
  lines.push('Next');
  lines.push('  ricky connect cloud');
  lines.push('  ricky status');
  lines.push('  ricky cloud --spec-file ./spec.md --no-run');
  lines.push('  ricky cloud --spec "describe the workflow outcome" --run');
  lines.push('');
  lines.push('No local fallback was attempted.');
  return lines;
}

function cloudAgentReadinessLine(readiness: Awaited<ReturnType<NonNullable<InteractiveCliDeps['checkCloudReadiness']>>>): string {
  const connected = Object.entries(readiness.agents)
    .filter(([, state]) => state.connected && state.capable)
    .map(([agent]) => agent);
  return connected.length > 0 ? connected.join(', ') : 'none connected';
}

async function compactShellChoiceGuidance(choice: OnboardingResult['mode'], deps: InteractiveCliDeps): Promise<string[]> {
  if (choice === 'status') {
    return [
      'Status selected.',
      '',
      'Run:',
      '  ricky status',
      '  ricky status --json',
      '',
      'Next:',
      '  ricky local --spec-file ./spec.md --no-run',
      '  ricky connect cloud',
    ];
  }

  if (choice === 'connect') {
    const selectedTools = await selectConnectToolChoices(deps);
    if (!selectedTools) {
      return [
        'Connect tools selected.',
        '',
        'Cloud account:',
        '  ricky connect cloud',
        '  Opens the AgentWorkforce Cloud login flow.',
        '',
        'Cloud agents:',
        '  ricky connect agents --cloud claude,codex,opencode,gemini',
        '',
        'Optional integrations:',
        '  ricky connect integrations --cloud slack,github,notion,linear',
        '  Open AgentWorkforce Cloud dashboard -> Integrations for GitHub, Slack, Notion, and Linear.',
        '',
        'Check readiness:',
        '  ricky status',
        '',
        'No connection was attempted because Ricky does not own an interactive terminal in this context.',
      ];
    }
    if (selectedTools && selectedTools.length === 0) {
      return [
        'Connect tools cancelled.',
        '',
        'No connection was attempted.',
        '',
        'Run:',
        '  ricky connect cloud',
        '  ricky status',
      ];
    }

    return runSelectedConnectTools(selectedTools, deps);
  }

  if (choice === 'exit') {
    return ['Exited. Nothing was generated or executed.'];
  }

  return [];
}

async function runSelectedConnectTools(selectedTools: ConnectToolChoice[], deps: InteractiveCliDeps): Promise<string[]> {
  const lines = [
    'Connect tools selected.',
    '',
  ];

  for (const tool of selectedTools) {
    if (tool === 'cloud') {
      const result = await connectCloudAccount(deps);
      lines.push(...renderCloudAccountAttempt(result), '');
    }

    if (tool === 'integrations') {
      const integrations = await selectConnectIntegrationChoices(deps);
      const result = await connectCloudIntegrationsViaNango(integrations, deps);
      lines.push(...renderConnectIntegrations(result), '');
    }

    if (tool === 'agents') {
      const providers: CloudImplementationAgent[] = ['claude', 'codex', 'opencode', 'gemini'];
      const shouldConnectAgents = await confirmCloudAgentProviderAuth(providers, deps);
      if (!shouldConnectAgents) {
        lines.push(
          'Cloud agents:',
          '  Skipped.',
          '  No Daytona provider auth sandbox was opened.',
          '  Run: ricky connect agents --cloud claude,codex,opencode,gemini',
          '',
        );
      } else {
        const result = await connectRelayProviders({
          label: 'Cloud agents',
          providers,
          recoveryCommand: 'ricky connect agents --cloud claude,codex,opencode,gemini',
          deps,
        });
        lines.push(...renderConnectAttempt(result), '');
      }
    }
  }

  lines.push(
    'Check readiness:',
    '  ricky status',
  );
  return lines;
}

function renderConnectIntegrations(results: CloudIntegrationConnectResult[]): string[] {
  if (results.length === 0) {
    return [
      'Optional integrations:',
      '  Skipped.',
    ];
  }

  const selected = results.map((result) => result.integration);
  const selectedLabels = selected.map((integration) => CONNECT_INTEGRATION_LABELS[integration]).join(', ');
  const lines = [
    'Optional integrations:',
    `  Selected: ${selectedLabels}`,
  ];

  for (const result of results) {
    const label = CONNECT_INTEGRATION_LABELS[result.integration];
    if (result.status === 'link-opened') {
      lines.push(`  ${label}: opened Nango connect link.`);
    } else if (result.status === 'link-created') {
      lines.push(`  ${label}: ${result.url}`);
    } else {
      const detail = result.endpoint && result.statusCode
        ? `${result.message ?? 'Could not create Nango connect link.'} (${result.endpoint} -> ${result.statusCode})`
        : result.message ?? 'Could not create Nango connect link.';
      lines.push(`  ${label}: ${detail}`);
    }
  }

  lines.push('  Ricky never uses Daytona for optional integrations.');
  return lines;
}

async function connectCloudIntegrationsViaNango(
  integrations: CloudOptionalIntegration[],
  deps: InteractiveCliDeps,
): Promise<CloudIntegrationConnectResult[]> {
  if (integrations.length === 0) return [];
  const connector = deps.connectCloudIntegrations ?? defaultCloudIntegrationConnector;
  return connector(integrations);
}

interface ConnectAttemptResult {
  label: string;
  connectedProviders: string[];
  failedProviders: Array<{ provider: string; message: string }>;
  recoveryCommand: string;
  connectorUnavailable?: boolean;
}

interface CloudAccountAttemptResult {
  connected: boolean;
  message?: string;
}

async function connectCloudAccount(deps: InteractiveCliDeps): Promise<CloudAccountAttemptResult> {
  try {
    const authenticator = deps.ensureCloudAuthenticated ?? await loadRelayCloudAuthenticator();
    if (!authenticator) {
      return {
        connected: false,
        message: 'Relay Cloud login package could not be loaded.',
      };
    }
    await authenticator();
    return { connected: true };
  } catch (error) {
    return {
      connected: false,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

function renderCloudAccountAttempt(result: CloudAccountAttemptResult): string[] {
  if (result.connected) {
    return [
      'Cloud account:',
      '  Connected: Cloud login',
    ];
  }
  return [
    'Cloud account:',
    `  Failed: ${result.message ?? 'Cloud login did not complete.'}`,
    '  Recovery: ricky connect cloud',
  ];
}

async function connectRelayProviders(options: {
  label: string;
  providers: string[];
  recoveryCommand: string;
  deps: InteractiveCliDeps;
}): Promise<ConnectAttemptResult> {
  const connector = options.deps.connectProvider ?? await loadRelayCloudConnectProvider();
  const connectedProviders: string[] = [];
  const failedProviders: Array<{ provider: string; message: string }> = [];

  if (!connector) {
    return {
      label: options.label,
      connectedProviders,
      failedProviders,
      recoveryCommand: options.recoveryCommand,
      connectorUnavailable: true,
    };
  }

  for (const provider of options.providers) {
    try {
      const result = await connector({
        provider,
        ...(options.deps.connectApiUrl ? { apiUrl: options.deps.connectApiUrl } : {}),
        ...(options.deps.connectTimeoutMs ? { timeoutMs: options.deps.connectTimeoutMs } : {}),
        io: connectIo(Boolean(options.deps.connectProvider)),
      });
      connectedProviders.push(result.provider);
    } catch (error) {
      failedProviders.push({
        provider,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    label: options.label,
    connectedProviders,
    failedProviders,
    recoveryCommand: options.recoveryCommand,
  };
}

function renderConnectAttempt(result: ConnectAttemptResult): string[] {
  if (result.connectorUnavailable) {
    return [
      `${result.label}:`,
      '  Relay Cloud connect package could not be loaded; no connection was attempted.',
      `  Recovery: ${result.recoveryCommand}`,
    ];
  }

  const lines = [`${result.label}:`];
  if (result.connectedProviders.length > 0) {
    lines.push(`  Connected: ${result.connectedProviders.join(', ')}`);
  }
  for (const failed of result.failedProviders) {
    lines.push(`  Failed ${failed.provider}: ${failed.message}`);
  }
  if (result.failedProviders.length > 0) {
    lines.push(`  Recovery: ${result.recoveryCommand}`);
  }
  if (result.connectedProviders.length === 0 && result.failedProviders.length === 0) {
    lines.push('  No provider connection was attempted.');
  }
  return lines;
}

function connectIo(injectedConnector: boolean): ConnectProviderOptions['io'] {
  if (injectedConnector) {
    return {
      log: () => undefined,
      error: () => undefined,
    };
  }
  return {
    log: (...args: unknown[]) => console.log(...args),
    error: (...args: unknown[]) => console.error(...args),
  };
}

async function loadRelayCloudConnectProvider(): Promise<RelayCloudConnectProvider | undefined> {
  try {
    const relayCloud = await import('@agent-relay/cloud');
    return relayCloud.connectProvider;
  } catch {
    return undefined;
  }
}

async function loadRelayCloudAuthenticator(): Promise<RelayCloudAuthenticator | undefined> {
  try {
    const relayCloud = await import('@agent-relay/cloud');
    return () => relayCloud.ensureAuthenticated(relayCloud.defaultApiUrl());
  } catch {
    return undefined;
  }
}

export async function defaultCloudIntegrationConnector(
  integrations: CloudOptionalIntegration[],
): Promise<CloudIntegrationConnectResult[]> {
  const auth = await ensureCloudAuthForIntegrationConnect();
  if (!auth) {
    return integrations.map((integration) => ({
      integration,
      status: 'failed',
      message: 'Cloud login is required before Ricky can request a Nango connect link.',
    }));
  }
  const workspaceId = await resolveCloudWorkspaceId({}, auth);
  if (!workspaceId) {
    return integrations.map((integration) => ({
      integration,
      status: 'failed',
      message: 'Cloud workspace could not be reconciled from your Cloud credentials.',
    }));
  }

  const results: CloudIntegrationConnectResult[] = [];
  for (const integration of integrations) {
    try {
      const link = await createNangoConnectLink(auth, workspaceId, integration);
      if (!link.url) {
        results.push({
          integration,
          status: 'failed',
          message: link.message ?? 'Cloud did not return a Nango connect link.',
          endpoint: link.endpoint,
          statusCode: link.statusCode,
        });
        continue;
      }
      const opened = openBrowser(link.url);
      results.push({
        integration,
        status: opened ? 'link-opened' : 'link-created',
        url: link.url,
        ...(opened ? {} : { message: 'Open this Nango connect link in your browser.' }),
      });
    } catch (error) {
      results.push({
        integration,
        status: 'failed',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return results;
}

async function ensureCloudAuthForIntegrationConnect(): Promise<StoredAuth | null> {
  const relayCloud = await import('@agent-relay/cloud');
  try {
    return await relayCloud.ensureAuthenticated(relayCloud.defaultApiUrl());
  } catch {
    return readCloudAuth();
  }
}

async function createNangoConnectLink(
  auth: StoredAuth,
  workspaceId: string,
  integration: CloudOptionalIntegration,
): Promise<{ url?: string; message?: string; endpoint?: string; statusCode?: number }> {
  const relayCloud = await import('@agent-relay/cloud');
  const body = JSON.stringify({ integration, provider: integration, workspaceId, workspace: { workspaceId } });
  const candidates = [
    '/api/v1/integrations/nango/connect-link',
    '/api/v1/integrations/connect-link',
    '/api/v1/nango/connect-link',
  ];
  let lastFailure: { message?: string; endpoint?: string; statusCode?: number } = {};

  for (const path of candidates) {
    const { response } = await relayCloud.authorizedApiFetch(auth, path, {
      method: 'POST',
      body,
    });
    const payload = await response.json().catch(() => null) as {
      url?: unknown;
      connectUrl?: unknown;
      connectLink?: unknown;
      error?: unknown;
      message?: unknown;
    } | null;
    if (!response.ok) {
      lastFailure = {
        endpoint: path,
        statusCode: response.status,
        message: typeof payload?.message === 'string'
          ? payload.message
          : typeof payload?.error === 'string'
            ? payload.error
            : `Cloud returned ${response.status} ${response.statusText || 'without a connect link.'}`,
      };
      continue;
    }
    const url = payload?.connectUrl ?? payload?.connectLink ?? payload?.url;
    if (typeof url === 'string' && url.trim()) return { url: url.trim() };
    lastFailure = {
      endpoint: path,
      statusCode: response.status,
      message: 'Cloud returned a successful response without a Nango connect URL.',
    };
  }
  return lastFailure.message ? lastFailure : { message: 'Cloud did not return a Nango connect link.' };
}

function openBrowser(url: string): boolean {
  const command = process.platform === 'darwin'
    ? 'open'
    : process.platform === 'win32'
      ? 'cmd'
      : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  try {
    const child = spawn(command, args, { stdio: 'ignore', detached: true });
    child.unref();
    return true;
  } catch {
    return false;
  }
}

async function confirmCloudAgentProviderAuth(
  providers: CloudImplementationAgent[],
  deps: InteractiveCliDeps,
): Promise<boolean> {
  if (deps.confirmCloudAgentProviderAuth) {
    return deps.confirmCloudAgentProviderAuth(providers);
  }

  const inputStream = deps.input ?? process.stdin;
  const outputStream = deps.output ?? process.stdout;
  if (!ownsInteractiveTerminal(deps, inputStream, outputStream)) return true;

  const answer = await promptKitFor(deps).select<'yes' | 'skip'>(
    {
      message: 'Cloud agent connections open Daytona provider auth sandboxes. Continue?',
      choices: [
        { value: 'yes', name: 'Yes, connect Cloud agents' },
        { value: 'skip', name: 'No, skip Cloud agents' },
      ],
      default: 'skip',
      loop: false,
    },
    { input: inputStream, output: outputStream, signal: deps.signal },
  );
  return answer === 'yes';
}

async function selectConnectToolChoices(deps: InteractiveCliDeps): Promise<ConnectToolChoice[] | undefined> {
  if (deps.selectConnectTools) {
    return deps.selectConnectTools();
  }

  const input = deps.input ?? process.stdin;
  const output = deps.output ?? process.stdout;
  const isTTY = deps.isTTY ?? ((input as NodeJS.ReadableStream & { isTTY?: boolean }).isTTY === true);
  const ownsTerminal = deps.input === undefined && deps.output === undefined && input === process.stdin && output === process.stdout;
  if (!isTTY || !ownsTerminal) return undefined;

  const selected = await promptKitFor(deps).select<ConnectToolChoice | 'all'>(
    {
      message: 'What do you want to connect?',
      choices: [
        {
          value: 'cloud',
          name: 'Cloud account',
          description: 'Run AgentWorkforce Cloud login.',
        },
        {
          value: 'integrations',
          name: 'Optional integrations',
          description: 'Choose Slack, GitHub, Notion, and Linear Nango authorizations.',
        },
        {
          value: 'agents',
          name: 'Cloud agents',
          description: 'Open Daytona-backed Claude, Codex, OpenCode, and Gemini auth flows.',
        },
        {
          value: 'all',
          name: 'All setup steps',
          description: 'Cloud account, optional integrations, then Cloud agents.',
        },
      ],
      default: 'integrations',
      loop: false,
    },
    {
      input,
      output,
      signal: deps.signal,
    },
  );
  return selected === 'all' ? ['cloud', 'integrations', 'agents'] : [selected];
}

async function selectConnectIntegrationChoices(deps: InteractiveCliDeps): Promise<CloudOptionalIntegration[]> {
  if (deps.selectConnectIntegrations) {
    return deps.selectConnectIntegrations();
  }

  const input = deps.input ?? process.stdin;
  const output = deps.output ?? process.stdout;
  const isTTY = deps.isTTY ?? ((input as NodeJS.ReadableStream & { isTTY?: boolean }).isTTY === true);
  const ownsTerminal = deps.input === undefined && deps.output === undefined && input === process.stdin && output === process.stdout;
  if (!isTTY || !ownsTerminal) return [...CONNECT_OPTIONAL_INTEGRATIONS];

  return promptKitFor(deps).checkbox<CloudOptionalIntegration>(
    {
      message: 'Which optional integrations do you want to authorize?',
      choices: CONNECT_OPTIONAL_INTEGRATIONS.map((integration) => ({
        value: integration,
        name: CONNECT_INTEGRATION_LABELS[integration],
        checked: true,
      })),
    },
    {
      input,
      output,
      signal: deps.signal,
    },
  );
}

async function executeCloudPath(
  deps: InteractiveCliDeps,
): Promise<{
  ok: boolean;
  cloudResult?: CloudGenerateResult;
  cloudSummary?: CloudWorkflowSummary;
  guidance: string[];
  awaitingInput?: boolean;
}> {
  const guidance: string[] = [];
  let cloudRequest = deps.cloudRequest;
  let cloudFlowDeps: InteractiveCliDeps = deps;
  let guidedRequestPreparedReadiness = false;

  if (!cloudRequest) {
    cloudFlowDeps = withDefaultGuidedCloudDeps(deps);
    const guided = await buildGuidedCloudRequest(deps, cloudFlowDeps);
    if (!guided.ok) {
      guidance.push(...guided.guidance);
      return { ok: guided.awaitingInput !== false, guidance, awaitingInput: guided.awaitingInput };
    }
    cloudRequest = guided.request;
    guidedRequestPreparedReadiness = true;
  }

  try {
    const finalCloudFlowDeps = guidedRequestPreparedReadiness
      ? withoutGuidedReadinessRecoveryPrompts(cloudFlowDeps)
      : cloudFlowDeps;
    const flow = await runCloudWorkflowFlow(cloudRequest, finalCloudFlowDeps);
    if (!flow.ok) {
      return {
        ok: false,
        cloudSummary: flow.summary,
        guidance: flow.guidance,
      };
    }

    guidance.push(...flow.guidance);

    const response = await handleCloudGenerate(flow.request, {
      executor: deps.cloudExecutor,
    });

    if (!response.ok) {
      // Cloud generation failed — surface bounded recovery, not fake success
      guidance.push(renderWorkflowGenerationFailureRecovery());
      for (const w of response.warnings) {
        if (w.severity === 'error') {
          guidance.push(`  Cloud error: ${w.message}`);
        }
      }
      return {
        ok: false,
        cloudResult: {
          artifacts: response.artifacts,
          warnings: response.warnings,
          assumptions: response.assumptions,
          validation: response.validation,
          runReceipt: response.runReceipt,
          followUpActions: response.followUpActions,
        },
        guidance,
        cloudSummary: flow.summary,
      };
    }

    return {
      ok: true,
      cloudResult: {
        artifacts: response.artifacts,
        warnings: response.warnings,
        assumptions: response.assumptions,
        validation: response.validation,
        runReceipt: response.runReceipt,
        followUpActions: response.followUpActions,
      },
      guidance,
      cloudSummary: flow.summary,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    guidance.push(renderWorkflowGenerationFailureRecovery());
    guidance.push(`  Unexpected Cloud error: ${message}`);
    return { ok: false, guidance };
  }
}

type GuidedCloudRequestResult =
  | { ok: true; request: CloudGenerateRequest }
  | { ok: false; guidance: string[]; awaitingInput?: boolean };

async function buildGuidedCloudRequest(
  deps: InteractiveCliDeps,
  readinessDeps: InteractiveCliDeps,
): Promise<GuidedCloudRequestResult> {
  const promptDeps = cloudSpecPromptDeps(deps);
  if (!promptDeps) {
    return {
      ok: false,
      guidance: await renderCloudAwaitingSpecGuidance(deps),
      awaitingInput: true,
    };
  }

  const context = await resolveGuidedCloudContext(deps);
  if (!context.ok) return context;

  const readiness = await prepareCloudWorkflowReadiness(
    guidedCloudSetupRequest(context.auth, context.workspaceId),
    readinessDeps,
  );
  if (!readiness.ok) {
    return {
      ok: false,
      guidance: [
        ...readiness.guidance,
        'Cloud readiness did not complete, so Ricky did not ask for a workflow spec.',
      ],
      awaitingInput: true,
    };
  }

  const preflight = await runLocalPreflight(resolveLocalInvocationRoot(deps));
  const capture = await runSpecIntakeFlow({
    prompts: promptDeps,
    cwd: preflight.repoRoot,
    preflight,
  });

  return {
    ok: true,
    request: cloudRequestFromCapture(capture, context.auth, context.workspaceId),
  };
}

function guidedCloudSetupRequest(
  auth: { token: string },
  workspaceId: string,
): CloudGenerateRequest {
  return {
    auth,
    workspace: { workspaceId },
    body: {
      spec: 'Guided Cloud setup before workflow spec intake.',
      mode: 'cloud',
      metadata: {
        cli: {
          handoff: 'guided-cloud-readiness',
        },
      },
    },
  };
}

function cloudSpecPromptDeps(deps: InteractiveCliDeps): SpecIntakePrompts | undefined {
  if (deps.localWorkflow?.prompts) return deps.localWorkflow.prompts;

  const inputStream = deps.input ?? process.stdin;
  const outputStream = deps.output ?? process.stdout;
  if (!ownsInteractiveTerminal(deps, inputStream, outputStream)) return undefined;

  return createInquirerLocalWorkflowPrompts({ input: inputStream, output: outputStream });
}

async function resolveGuidedCloudContext(
  deps: InteractiveCliDeps,
): Promise<
  | { ok: true; auth: { token: string }; workspaceId: string }
  | { ok: false; guidance: string[]; awaitingInput?: boolean }
> {
  let auth = await readCloudAuth(deps);
  let workspaceId = await resolveCloudWorkspaceId(deps, auth);
  let readiness = await readGuidedCloudReadiness(deps, auth, workspaceId);
  const missingLogin = cloudLoginMissing(readiness);

  if (missingLogin.length > 0) {
    if (deps.recoverCloudLogin) {
      await deps.recoverCloudLogin({ missing: missingLogin, readiness });
    } else {
      const shouldLogin = await promptCloudLogin(deps, missingLogin.map((item) => CLOUD_LOGIN_LABELS[item]));
      if (!shouldLogin) {
        return {
          ok: false,
          guidance: [
            'Cloud setup returned to mode selection.',
            'Run `ricky connect cloud` or choose local mode explicitly.',
            'No local fallback was attempted.',
          ],
          awaitingInput: true,
        };
      }

      const login = await connectCloudAccount(deps);
      if (!login.connected) {
        return {
          ok: false,
          guidance: [
            ...renderCloudAccountAttempt(login),
            'Cloud login did not complete, so Ricky did not ask for a workflow spec.',
            'Choose local mode explicitly if you want to continue without Cloud.',
          ],
          awaitingInput: true,
        };
      }
    }

    auth = await readCloudAuth(deps);
    workspaceId = await resolveCloudWorkspaceId(deps, auth);
    readiness = await readGuidedCloudReadiness(deps, auth, workspaceId);
    const stillMissing = cloudLoginMissing(readiness);
    if (stillMissing.length > 0) {
      return {
        ok: false,
        guidance: [
          `Cloud login is still incomplete after recovery: ${stillMissing.map((item) => CLOUD_LOGIN_LABELS[item]).join(', ')}.`,
          'Cloud login did not complete, so Ricky did not ask for a workflow spec.',
          'No local fallback was attempted.',
        ],
        awaitingInput: true,
      };
    }
  }

  if (!workspaceId) {
    return {
      ok: false,
      guidance: [
        'Cloud workspace could not be reconciled from your Cloud credentials.',
        'Run `ricky connect cloud`, then `ricky status` so Ricky can read the current Cloud workspace automatically.',
        'No local fallback was attempted.',
      ],
      awaitingInput: true,
    };
  }

  const token = process.env.AGENTWORKFORCE_CLOUD_TOKEN ?? process.env.RICKY_CLOUD_TOKEN ?? auth?.accessToken;
  if (!token) {
    return {
      ok: false,
      guidance: [
        'Cloud login is still incomplete after recovery.',
        'Run `ricky connect cloud`, then retry Cloud mode.',
        'No local fallback was attempted.',
      ],
      awaitingInput: true,
    };
  }

  return { ok: true, auth: { token }, workspaceId };
}

async function readGuidedCloudReadiness(
  deps: InteractiveCliDeps,
  auth: StoredAuth | null,
  workspaceId: string | undefined,
  request?: CloudGenerateRequest,
): Promise<CloudReadinessSnapshot> {
  if (deps.checkCloudReadiness) return deps.checkCloudReadiness();
  const requestAuth = request ? cloudRequestAuthForReadiness(request, deps) : null;
  const effectiveAuth = auth ?? requestAuth;
  const effectiveWorkspaceId = workspaceId ?? request?.workspace?.workspaceId;
  const hasToken = Boolean(
    auth?.accessToken ||
    request?.auth?.token ||
    process.env.AGENTWORKFORCE_CLOUD_TOKEN ||
    process.env.RICKY_CLOUD_TOKEN,
  );
  const hasWorkspace = Boolean(effectiveWorkspaceId);
  if (effectiveAuth && effectiveWorkspaceId) {
    return fetchGuidedCloudReadiness(effectiveAuth, effectiveWorkspaceId, {
      fallbackToRequestReadiness: request !== undefined,
    });
  }

  return {
    account: { connected: hasToken },
    credentials: { connected: hasToken },
    workspace: { connected: hasWorkspace },
    agents: request ? optimisticRequestAgentReadiness() : defaultGuidedCloudAgentReadiness(),
    integrations: defaultGuidedCloudIntegrationReadiness(),
  };
}

function cloudRequestAuthForReadiness(
  request: CloudGenerateRequest,
  deps: Pick<InteractiveCliDeps, 'connectApiUrl'>,
): StoredAuth | null {
  const token = request.auth?.token?.trim();
  if (!token) return null;
  return {
    accessToken: token,
    refreshToken: '',
    accessTokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    apiUrl: deps.connectApiUrl ?? defaultCloudApiUrl(),
  };
}

function defaultCloudApiUrl(): string {
  try {
    const configured = process.env.CLOUD_API_URL?.trim();
    if (configured) return configured;
    return 'https://api.agentrelay.cloud';
  } catch {
    return 'https://api.agentrelay.cloud';
  }
}

async function fetchGuidedCloudReadiness(
  auth: StoredAuth,
  workspaceId: string,
  options: { fallbackToRequestReadiness?: boolean } = {},
): Promise<CloudReadinessSnapshot> {
  try {
    const [agents, integrations] = await Promise.all([
      fetchGuidedCloudAgents(auth),
      fetchGuidedCloudIntegrations(auth, workspaceId),
    ]);
    return {
      account: { connected: true },
      credentials: { connected: true },
      workspace: { connected: true, label: workspaceId },
      agents,
      integrations,
    };
  } catch (error) {
    if (options.fallbackToRequestReadiness) {
      return {
        account: { connected: true },
        credentials: { connected: true },
        workspace: { connected: true, label: workspaceId },
        agents: optimisticRequestAgentReadiness(),
        integrations: defaultGuidedCloudIntegrationReadiness(
          error instanceof Error ? error.message : String(error),
        ),
      };
    }
    return {
      account: { connected: Boolean(auth.accessToken) },
      credentials: { connected: Boolean(auth.accessToken) },
      workspace: { connected: Boolean(workspaceId), label: workspaceId },
      agents: defaultGuidedCloudAgentReadiness(
        error instanceof Error ? error.message : String(error),
      ),
      integrations: defaultGuidedCloudIntegrationReadiness(
        error instanceof Error ? error.message : String(error),
      ),
    };
  }
}

type GuidedCloudAgentApiRecord = {
  displayName?: unknown;
  harness?: unknown;
  provider?: unknown;
  status?: unknown;
  credentialStoredAt?: unknown;
  lastAuthenticatedAt?: unknown;
  lastError?: unknown;
};

async function fetchGuidedCloudAgents(auth: StoredAuth): Promise<Record<CloudImplementationAgent, CloudAgentReadiness>> {
  const body = await fetchGuidedCloudJson(auth, '/api/v1/cloud-agents');
  const records = Array.isArray((body as { agents?: unknown }).agents)
    ? (body as { agents: GuidedCloudAgentApiRecord[] }).agents
    : [];
  const result = defaultGuidedCloudAgentReadiness();
  for (const record of records) {
    const agent = cloudAgentFromProvider(
      typeof record.harness === 'string'
        ? record.harness
        : typeof record.provider === 'string'
          ? record.provider
          : undefined,
    );
    if (!agent) continue;
    const connected = record.status === 'connected' || Boolean(record.credentialStoredAt || record.lastAuthenticatedAt);
    result[agent] = {
      connected,
      capable: connected,
      ...(typeof record.displayName === 'string' && record.displayName.trim() ? { label: record.displayName.trim() } : {}),
      ...(typeof record.lastError === 'string' && record.lastError.trim() ? { recovery: record.lastError.trim() } : {}),
    };
  }
  return result;
}

async function fetchGuidedCloudIntegrations(
  auth: StoredAuth,
  workspaceId: string,
): Promise<Record<CloudOptionalIntegration, CloudReadinessCheck>> {
  const entries = await Promise.all(CONNECT_OPTIONAL_INTEGRATIONS.map(async (integration) => {
    try {
      const body = await fetchGuidedCloudJson(
        auth,
        `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/integrations/${integration}`,
      );
      const connectionId = typeof (body as { connectionId?: unknown }).connectionId === 'string'
        ? (body as { connectionId: string }).connectionId
        : '';
      const providerConfigKey = typeof (body as { providerConfigKey?: unknown }).providerConfigKey === 'string'
        ? (body as { providerConfigKey: string }).providerConfigKey
        : '';
      const connected = Boolean(connectionId.trim());
      const label = providerConfigKey.trim() || connectionId.trim();
      return [integration, {
        connected,
        ...(connected && label ? { label } : {}),
      }] as const;
    } catch (error) {
      return [integration, {
        connected: false,
        label: 'unknown',
        recovery: error instanceof Error ? error.message : String(error),
      }] as const;
    }
  }));
  return Object.fromEntries(entries) as Record<CloudOptionalIntegration, CloudReadinessCheck>;
}

async function fetchGuidedCloudJson(auth: StoredAuth, path: string): Promise<unknown> {
  const relayCloud = await import('@agent-relay/cloud');
  const { response } = await relayCloud.authorizedApiFetch(auth, path, { method: 'GET' });
  if (!response.ok) {
    throw new Error(`${path} returned HTTP ${response.status}`);
  }
  return response.json();
}

function optimisticRequestAgentReadiness(): Record<CloudImplementationAgent, CloudAgentReadiness> {
  return {
    claude: { connected: true, capable: true, label: 'provided request context' },
    codex: { connected: true, capable: true, label: 'provided request context' },
    opencode: { connected: true, capable: true, label: 'provided request context' },
    gemini: { connected: true, capable: true, label: 'provided request context' },
  };
}

function defaultGuidedCloudAgentReadiness(recovery?: string): Record<CloudImplementationAgent, CloudAgentReadiness> {
  return {
    claude: { connected: false, capable: false, ...(recovery ? { recovery } : {}) },
    codex: { connected: false, capable: false, ...(recovery ? { recovery } : {}) },
    opencode: { connected: false, capable: false, ...(recovery ? { recovery } : {}) },
    gemini: { connected: false, capable: false, ...(recovery ? { recovery } : {}) },
  };
}

function defaultGuidedCloudIntegrationReadiness(
  recovery?: string,
): Record<CloudOptionalIntegration, CloudReadinessCheck> {
  return {
    slack: { connected: false, ...(recovery ? { label: 'unknown', recovery } : {}) },
    github: { connected: false, ...(recovery ? { label: 'unknown', recovery } : {}) },
    notion: { connected: false, ...(recovery ? { label: 'unknown', recovery } : {}) },
    linear: { connected: false, ...(recovery ? { label: 'unknown', recovery } : {}) },
  };
}

function cloudAgentFromProvider(provider: string | undefined): CloudImplementationAgent | undefined {
  const normalized = provider?.trim().toLowerCase();
  if (!normalized) return undefined;
  if (normalized.includes('claude') || normalized.includes('anthropic')) return 'claude';
  if (normalized.includes('codex') || normalized.includes('openai')) return 'codex';
  if (normalized.includes('opencode')) return 'opencode';
  if (normalized.includes('gemini') || normalized.includes('google')) return 'gemini';
  return undefined;
}

const CLOUD_LOGIN_LABELS: Record<CloudLoginRequirement, string> = {
  account: 'Cloud account',
  credentials: 'Cloud credentials',
  workspace: 'Cloud workspace',
};

function cloudLoginMissing(readiness: CloudReadinessSnapshot): CloudLoginRequirement[] {
  const missing: CloudLoginRequirement[] = [];
  if (!readiness.account.connected) missing.push('account');
  if (!readiness.credentials.connected) missing.push('credentials');
  if (!readiness.workspace.connected) missing.push('workspace');
  return missing;
}

async function promptCloudLogin(deps: InteractiveCliDeps, missing: string[]): Promise<boolean> {
  if (deps.recoverCloudLogin) {
    return true;
  }
  const inputStream = deps.input ?? process.stdin;
  const outputStream = deps.output ?? process.stdout;
  if (!ownsInteractiveTerminal(deps, inputStream, outputStream)) return false;
  const answer = await promptKitFor(deps).select<'yes' | 'back'>(
    {
      message: `${missing.join(' and ')} missing. Log in now?`,
      choices: [
        { value: 'yes', name: 'Yes, open login' },
        { value: 'back', name: 'No, go back' },
      ],
      default: 'yes',
      loop: false,
    },
    { input: inputStream, output: outputStream, signal: deps.signal },
  );
  return answer === 'yes';
}

function promptKitFor(deps: Pick<InteractiveCliDeps, 'promptKit'>): PromptKit {
  return deps.promptKit ?? createInquirerPromptKit();
}

async function readCloudAuth(deps: Pick<InteractiveCliDeps, 'readCloudAuth'> = {}): Promise<StoredAuth | null> {
  if (deps.readCloudAuth) return deps.readCloudAuth();
  try {
    const relayCloud = await import('@agent-relay/cloud');
    return await relayCloud.readStoredAuth();
  } catch {
    return null;
  }
}

async function resolveCloudWorkspaceId(
  deps: Pick<InteractiveCliDeps, 'resolveCloudWorkspace'>,
  auth: StoredAuth | null,
): Promise<string | undefined> {
  const explicit = readCloudWorkspaceIdFromEnv();
  if (explicit) return explicit;
  if (!auth) return undefined;
  if (deps.resolveCloudWorkspace) return deps.resolveCloudWorkspace(auth);
  return readCloudWorkspaceFromProfile(auth);
}

function readCloudWorkspaceIdFromEnv(): string | undefined {
  const value = process.env.AGENTWORKFORCE_CLOUD_WORKSPACE ?? process.env.RICKY_CLOUD_WORKSPACE;
  return value?.trim() || undefined;
}

async function readCloudWorkspaceFromProfile(auth: StoredAuth): Promise<string | undefined> {
  const relayCloud = await import('@agent-relay/cloud');
  const candidates = ['/api/v1/auth/whoami', '/api/v1/whoami', '/api/v1/me'];
  for (const path of candidates) {
    try {
      const { response } = await relayCloud.authorizedApiFetch(auth, path, { method: 'GET' });
      if (!response.ok) continue;
      const profile = await response.json().catch(() => null) as Partial<WhoAmIResponse> | null;
      const workspaceId = profile?.currentWorkspace?.id;
      if (typeof workspaceId === 'string' && workspaceId.trim()) return workspaceId.trim();
    } catch {
      // Try the next known profile endpoint shape.
    }
  }
  return undefined;
}

function cloudRequestFromCapture(
  capture: CapturedWorkflowSpec,
  auth: { token: string },
  workspaceId: string,
): CloudGenerateRequest {
  const spec = capture.source === 'workflow-artifact'
    ? {
        kind: 'structured' as const,
        document: {
          intent: 'execute',
          workflowPath: capture.artifactPath ?? capture.specPath ?? capture.spec,
          workflowName: capture.workflowName,
        },
        format: 'ricky-workflow' as const,
      }
    : capture.spec;

  return {
    auth,
    workspace: { workspaceId },
    body: {
      spec,
      ...(capture.specPath ? { specPath: capture.specPath } : {}),
      mode: 'cloud',
      ...cloudRickyCaptureExecutionBodyFor(capture),
      metadata: {
        workflowName: capture.workflowName,
        ...cloudRickyCaptureExecutionMetadataFor(capture),
        cli: {
          handoff: capture.source,
          workflowName: capture.workflowName,
          ...(capture.generatedFromGoal ? { generatedFromGoal: capture.generatedFromGoal } : {}),
        },
      },
    },
  };
}

function cloudRickyCaptureExecutionBodyFor(capture: CapturedWorkflowSpec): Partial<CloudGenerateRequestBody> {
  if (capture.source !== 'workflow-artifact') return {};
  return {
    autoFix: {
      enabled: true,
      maxAttempts: DEFAULT_AUTO_FIX_ATTEMPTS,
      preferWorkforcePersona: true,
      allowOpenRouterFallback: true,
      requireHumanApprovalFor: ['code_push', 'pr_create', 'secrets', 'billing', 'external_write'],
    },
  };
}

function cloudRickyCaptureExecutionMetadataFor(capture: CapturedWorkflowSpec): Record<string, unknown> {
  if (capture.source !== 'workflow-artifact') return {};
  return {
    ricky: {
      optIn: true,
      runEndpoint: '/api/v1/ricky/runs',
    },
  };
}

function withDefaultGuidedCloudDeps(deps: InteractiveCliDeps, request?: CloudGenerateRequest): InteractiveCliDeps {
  const next: InteractiveCliDeps = { ...deps };
  const inputStream = deps.input ?? process.stdin;
  const outputStream = deps.output ?? process.stdout;
  const interactive = ownsInteractiveTerminal(deps, inputStream, outputStream);
  const connectedAgents = new Set<string>();

  if (!next.checkCloudReadiness) {
    next.checkCloudReadiness = async () => {
      const auth = await readCloudAuth(deps);
      const workspaceId = await resolveCloudWorkspaceId(deps, auth) ?? request?.workspace?.workspaceId;
      const readiness = await readGuidedCloudReadiness(deps, auth, workspaceId, request);
      return mergeSessionConnectedAgents(readiness, connectedAgents);
    };
  }

  if (!next.promptMissingCloudAgents && interactive) {
    next.promptMissingCloudAgents = async ({ availableAgents, missingAgents }) => {
      const choices = [
        { value: 'connect-all' as const, name: 'Connect all missing agents' },
        { value: 'choose' as const, name: 'Choose which agents to connect' },
        ...(availableAgents.length > 0
          ? [{ value: 'continue-connected' as const, name: 'Continue with connected agents' }]
          : []),
        { value: 'go-back' as const, name: 'Go back' },
      ];
      const action = await promptKitFor(deps).select<'connect-all' | 'choose' | 'continue-connected' | 'go-back'>({
        message: 'Connect missing Cloud agents now?',
        choices,
        default: availableAgents.length > 0 ? 'continue-connected' : 'connect-all',
        loop: false,
      }, { input: inputStream, output: outputStream, signal: deps.signal });
      if (action === 'choose') {
        const agents = await promptKitFor(deps).checkbox<CloudImplementationAgent>({
          message: 'Which Cloud agents should Ricky connect?',
          required: true,
          choices: missingAgents.map((agent) => ({ value: agent, name: agent })),
        }, { input: inputStream, output: outputStream, signal: deps.signal });
        return { action, agents } satisfies MissingCloudAgentAction;
      }
      return { action } satisfies MissingCloudAgentAction;
    };
  }

  if (!next.connectCloudAgents) {
    next.connectCloudAgents = async (agents) => {
      const shouldConnectAgents = await confirmCloudAgentProviderAuth(agents, deps);
      if (!shouldConnectAgents) return;

      const result = await connectRelayProviders({
        label: 'Cloud agents',
        providers: agents,
        recoveryCommand: `ricky connect agents --cloud ${agents.join(',')}`,
        deps,
      });
      for (const provider of result.connectedProviders) {
        connectedAgents.add(provider === 'anthropic' ? 'claude' : provider === 'openai' ? 'codex' : provider === 'google' ? 'gemini' : provider);
      }
    };
  }

  if (!next.selectOptionalCloudIntegrations && interactive) {
    next.selectOptionalCloudIntegrations = async ({ missingIntegrations, relevantIntegrations }) => {
      const integrations = await promptKitFor(deps).checkbox<CloudOptionalIntegration>({
        message: 'Select optional integrations to connect. Leave all unchecked to skip.',
        choices: missingIntegrations.map((integration) => ({
          value: integration,
          name: CONNECT_INTEGRATION_LABELS[integration],
          description: relevantIntegrations.includes(integration)
            ? 'Mentioned in this spec; skipping will be shown as a caveat.'
            : 'Optional for this run.',
        })),
      }, { input: inputStream, output: outputStream, signal: deps.signal });
      return integrations.length > 0 ? { action: 'connect', integrations } : { action: 'skip-all' };
    };
  }

  if (!next.connectOptionalCloudIntegrations) {
    next.connectOptionalCloudIntegrations = async (integrations) => {
      if (integrations.length > 0) {
        await connectCloudIntegrationsViaNango(integrations, deps);
      }
    };
  }

  if (!next.confirmCloudRun && interactive) {
    next.confirmCloudRun = async (summary) => {
      const action = await promptKitFor(deps).select<'run-and-monitor' | 'show-command' | 'edit-first'>({
        message: `${summary.lines.join('\n')}\nRun this workflow in AgentWorkforce Cloud?`,
        choices: [
          { value: 'run-and-monitor' as const, name: 'Yes, run in Cloud and monitor it' },
          { value: 'show-command' as const, name: 'Not now, show me the Cloud run command' },
          { value: 'edit-first' as const, name: 'Edit the workflow first' },
        ],
        default: 'run-and-monitor',
        loop: false,
      }, { input: inputStream, output: outputStream, signal: deps.signal });
      return { action } satisfies CloudRunConfirmation;
    };
  }

  return next;
}

function mergeSessionConnectedAgents(
  readiness: CloudReadinessSnapshot,
  connectedAgents: Set<string>,
): CloudReadinessSnapshot {
  if (connectedAgents.size === 0) return readiness;
  const agents = { ...readiness.agents };
  for (const provider of connectedAgents) {
    const agent = cloudAgentFromProvider(provider);
    if (!agent) continue;
    agents[agent] = {
      connected: true,
      capable: true,
      label: agents[agent]?.label ?? 'connected during this CLI session',
    };
  }
  return { ...readiness, agents };
}

function withoutGuidedReadinessRecoveryPrompts(deps: InteractiveCliDeps): InteractiveCliDeps {
  const {
    recoverCloudLogin: _recoverCloudLogin,
    promptMissingCloudAgents: _promptMissingCloudAgents,
    connectCloudAgents: _connectCloudAgents,
    selectOptionalCloudIntegrations: _selectOptionalCloudIntegrations,
    connectOptionalCloudIntegrations: _connectOptionalCloudIntegrations,
    ...rest
  } = deps;
  return rest;
}

function ownsInteractiveTerminal(
  deps: Pick<InteractiveCliDeps, 'input' | 'output' | 'isTTY'>,
  inputStream: NodeJS.ReadableStream,
  outputStream: NodeJS.WritableStream,
): boolean {
  const isTTY = deps.isTTY ?? ((inputStream as NodeJS.ReadableStream & { isTTY?: boolean }).isTTY === true);
  return isTTY && deps.input === undefined && deps.output === undefined && inputStream === process.stdin && outputStream === process.stdout;
}

// ---------------------------------------------------------------------------
// Main interactive CLI entrypoint
// ---------------------------------------------------------------------------

/**
 * Run the interactive Ricky CLI session.
 *
 * 1. Runs onboarding (banner, welcome, mode selection).
 * 2. Based on the resolved mode, executes the local or cloud path.
 * 3. On local failure, surfaces runtime diagnosis guidance.
 * 4. On cloud failure, surfaces bounded recovery guidance.
 * 5. Returns a unified result contract.
 */
export async function runInteractiveCli(
  deps: InteractiveCliDeps = {},
): Promise<InteractiveCliResult> {
  const onboard = deps.onboard ?? runOnboarding;

  // Step 1: Onboarding
  const onboarding = await onboard({
    input: deps.input,
    output: deps.output,
    isTTY: deps.isTTY,
    mode: deps.mode,
    configStore: deps.configStore,
    providerStatus: deps.providerStatus,
    compactForExecution: deps.handoff !== undefined,
    skipFirstRunPersistence: deps.handoff !== undefined,
    verbose: deps.verbose,
    signal: deps.signal,
  });
  const fallbackMode = onboarding.mode === 'status' || onboarding.mode === 'connect' || onboarding.mode === 'exit'
    ? 'local'
    : toRickyMode(onboarding.mode);

  try {
  if (onboarding.mode === 'status' || onboarding.mode === 'connect' || onboarding.mode === 'exit') {
    const guidance = await compactShellChoiceGuidance(onboarding.mode, deps);
    return {
      ok: true,
      mode: fallbackMode,
      onboarding,
      diagnoses: [],
      guidance,
      awaitingInput: true,
    };
  }

  const mode = toRickyMode(onboarding.mode);

  // Step 2: Route based on mode
  if (mode === 'cloud') {
    const cloud = await executeCloudPath(deps);
    return {
      ok: cloud.ok,
      mode,
      onboarding,
      cloudResult: cloud.cloudResult,
      cloudSummary: cloud.cloudSummary,
      diagnoses: [],
      guidance: cloud.guidance,
      awaitingInput: cloud.awaitingInput,
    };
  }

  if (mode === 'local' || mode === 'both') {
    const { localResult, diagnoses, guidance, awaitingInput, localWorkflowResult } = await executeLocalPath(deps, mode);

    // For 'both' mode, also attempt Cloud if local succeeded
    let cloudResult: CloudGenerateResult | undefined;
    if (mode === 'both' && localResult?.ok && deps.cloudRequest) {
      const cloud = await executeCloudPath(deps);
      cloudResult = cloud.cloudResult;
      const cloudSummary = cloud.cloudSummary;
      guidance.push(...cloud.guidance);
      return {
        ok: awaitingInput ? true : (localResult?.ok ?? false) && cloud.ok,
        mode,
        onboarding,
        localResult,
        cloudResult,
        cloudSummary,
        diagnoses,
        guidance,
        awaitingInput,
        localWorkflowResult,
      };
    }

    return {
      ok: awaitingInput ? true : (localResult?.ok ?? false),
      mode,
      onboarding,
      localResult,
      cloudResult,
      diagnoses,
      guidance,
      awaitingInput,
      localWorkflowResult,
    };
  }

  } catch (error) {
    if (!isPromptCancellation(error) || deps.verbose === true) {
      throw error;
    }

    writeCancellationLine(deps);
    return {
      ok: true,
      mode: fallbackMode,
      onboarding,
      diagnoses: [],
      guidance: ['Cancelled. Nothing was generated or executed.'],
      awaitingInput: true,
    };
  }

  // Unreachable for valid RickyMode, but TypeScript exhaustiveness
  return {
    ok: true,
    mode: fallbackMode,
    onboarding,
    diagnoses: [],
    guidance: [],
  };
}

function writeCancellationLine(deps: Pick<InteractiveCliDeps, 'output'>): void {
  const output = deps.output ?? process.stdout;
  output.write('\nCancelled.\n');
}
