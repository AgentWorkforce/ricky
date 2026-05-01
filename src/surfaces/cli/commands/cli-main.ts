/**
 * Ricky CLI command surface.
 *
 * Thin command-layer entry that wraps the interactive CLI entrypoint
 * with argument parsing for help, mode override, and version display.
 *
 * Design invariants:
 * - All side-effecting dependencies are injectable for deterministic tests.
 * - No invented commands — only surfaces what the codebase actually implements.
 * - Local/cloud routing defers to the interactive entrypoint — no silent fallback.
 * - The bin/start script surface is truthful: private package, linked CLI path only.
 */

import type { InteractiveCliDeps, InteractiveCliResult } from '../entrypoint/interactive-cli.js';
import type { CloudIntegrationConnector } from '../entrypoint/interactive-cli.js';
import type { RickyMode } from '../cli/mode-selector.js';
import type { RawHandoff } from '../../../local/request-normalizer.js';
import type { CloudGenerateRequest, CloudWorkflowSpecPayload } from '../../../cloud/api/request-types.js';
import type { ConnectProviderOptions, ConnectProviderResult, StoredAuth } from '@agent-relay/cloud';
import type { LocalRunMonitorState } from '../flows/local-run-monitor.js';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { defaultCloudIntegrationConnector, runInteractiveCli } from '../entrypoint/interactive-cli.js';
import { parsePowerUserArgs, type ConnectTarget, type PowerUserSurface } from '../flows/power-user-parser.js';
import {
  cloudPowerUserWorkflowSummary,
  localPowerUserWorkflowSummary,
  renderPowerUserWorkflowJson,
  renderPowerUserWorkflowSummary,
} from '../flows/workflow-summary.js';
import { runLocalPreflight, type LocalPreflightCheck, type LocalPreflightResult } from '../flows/local-workflow-flow.js';

// ---------------------------------------------------------------------------
// Parsed CLI arguments
// ---------------------------------------------------------------------------

export interface ParsedArgs {
  command: 'run' | 'help' | 'version' | 'status' | 'connect';
  surface?: PowerUserSurface;
  mode?: RickyMode;
  connectTarget?: ConnectTarget;
  cloudTargets?: string[];
  runId?: string;
  spec?: string;
  specFile?: string;
  artifact?: string;
  stdin?: boolean;
  workflowName?: string;
  runRequested?: boolean;
  noRun?: boolean;
  background?: boolean;
  foreground?: boolean;
  yes?: boolean;
  json?: boolean;
  quiet?: boolean;
  verbose?: boolean;
  autoFix?: number;
  refine?: false | { model?: string };
  login?: boolean;
  connectMissing?: boolean;
  errors?: string[];
}

// ---------------------------------------------------------------------------
// CLI result contract
// ---------------------------------------------------------------------------

export interface CliMainResult {
  /** Exit code — 0 for success, 1 for user-facing errors. */
  exitCode: number;
  /** Output lines written to stdout. */
  output: string[];
  /** Interactive CLI result when the run command was executed. */
  interactiveResult?: InteractiveCliResult;
}

export type RelayCloudConnectProvider = (options: ConnectProviderOptions) => Promise<ConnectProviderResult>;
export type RelayCloudAuthenticator = () => Promise<StoredAuth>;

// ---------------------------------------------------------------------------
// Injectable dependencies
// ---------------------------------------------------------------------------

export interface CliMainDeps extends InteractiveCliDeps {
  /** Override argv for testing — defaults to process.argv.slice(2). */
  argv?: string[];
  /** Override the interactive runner for testing. */
  runInteractive?: (deps: InteractiveCliDeps) => Promise<InteractiveCliResult>;
  /** Package version string — defaults to '0.0.0'. */
  version?: string;
  /** File reader override for testing spec-file handoffs. */
  readFileText?: (path: string) => Promise<string>;
  /** Package.json reader override for deterministic version tests. */
  readPackageJsonText?: (path: string) => string;
  /** Relay Cloud connector override for deterministic connect command tests. */
  connectProvider?: RelayCloudConnectProvider;
  /** Relay Cloud account login override for deterministic connect command tests. */
  ensureCloudAuthenticated?: RelayCloudAuthenticator;
  /** Nango connect-link connector override for deterministic integration command tests. */
  connectCloudIntegrations?: CloudIntegrationConnector;
  /** Cloud API URL override passed through to the Relay Cloud connector. */
  connectApiUrl?: string;
  /** Provider auth timeout override passed through to the Relay Cloud connector. */
  connectTimeoutMs?: number;
}

let cachedPackageVersion: string | undefined;

// ---------------------------------------------------------------------------
// Argument parsing — deterministic, no external deps
// ---------------------------------------------------------------------------

export function parseArgs(argv: string[]): ParsedArgs {
  const parsed = parsePowerUserArgs(argv);
  const result: ParsedArgs = { command: parsed.command };
  if (parsed.surface && parsed.surface !== 'legacy') result.surface = parsed.surface;
  if (parsed.mode) result.mode = parsed.mode;
  if (parsed.connectTarget) result.connectTarget = parsed.connectTarget;
  if (parsed.cloudTargets) result.cloudTargets = parsed.cloudTargets;
  if (parsed.runId) result.runId = parsed.runId;
  if (parsed.spec !== undefined) result.spec = parsed.spec;
  if (parsed.specFile !== undefined) result.specFile = parsed.specFile;
  if (parsed.artifact !== undefined) result.artifact = parsed.artifact;
  if (parsed.stdin) result.stdin = true;
  if (parsed.workflowName !== undefined) result.workflowName = parsed.workflowName;
  if (parsed.runRequested) result.runRequested = true;
  if (parsed.noRun) result.noRun = true;
  if (parsed.background) result.background = true;
  if (parsed.foreground) result.foreground = true;
  if (parsed.yes) result.yes = true;
  if (parsed.json) result.json = true;
  if (parsed.quiet) result.quiet = true;
  if (parsed.verbose) result.verbose = true;
  if (parsed.autoFix !== undefined && parsed.autoFix > 0) result.autoFix = parsed.autoFix;
  if (parsed.refine) result.refine = parsed.refine;
  if (parsed.login) result.login = true;
  if (parsed.connectMissing) result.connectMissing = true;
  if (parsed.errors && parsed.errors.length > 0) result.errors = parsed.errors;
  return result;
}

function parseRefine(argv: string[]): false | { model?: string } {
  // Explicit opt-out wins over everything.
  if (argv.includes('--no-refine') || argv.includes('--no-with-llm')) return false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg !== '--refine' && arg !== '--with-llm' && !arg.startsWith('--refine=') && !arg.startsWith('--with-llm=')) {
      continue;
    }
    if (arg.includes('=')) {
      const value = arg.slice(arg.indexOf('=') + 1).trim();
      return value ? { model: value } : {};
    }
    const next = argv[index + 1];
    return next && !next.startsWith('--') ? { model: next } : {};
  }
  // Default-on: refinement runs with the default model and falls back to the
  // deterministic artifact when API creds / timeouts / token budgets fail.
  return {};
}

function readFlagValue(argv: string[], flag: string): string | undefined {
  const index = argv.indexOf(flag);
  if (index === -1) {
    return undefined;
  }

  const value = argv[index + 1];
  if (!value || value.startsWith('--')) {
    return undefined;
  }

  return value;
}

function readRunArtifactPositional(argv: string[]): string | undefined {
  if (argv[0] !== 'run') return undefined;
  for (let index = 1; index < argv.length; index += 1) {
    const candidate = argv[index];
    const previous = argv[index - 1];
    if (!candidate || candidate.startsWith('--')) continue;
    if ((previous === '--auto-fix' || previous === '--repair') && isAutoFixValue(candidate)) continue;
    if (candidate === 'help' || candidate === 'version') continue;
    return candidate;
  }
  return undefined;
}

function parseAutoFix(argv: string[]): number | undefined {
  // Explicit opt-out wins over everything.
  if (argv.includes('--no-auto-fix') || argv.includes('--no-repair')) return undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg !== '--auto-fix' && arg !== '--repair' && !arg.startsWith('--auto-fix=') && !arg.startsWith('--repair=')) {
      continue;
    }

    let rawValue: string | undefined;
    if (arg.includes('=')) {
      rawValue = arg.slice(arg.indexOf('=') + 1);
    } else {
      const next = argv[index + 1];
      rawValue = next && !next.startsWith('--') ? next : undefined;
    }

    if (rawValue === undefined || rawValue === '') return 3;
    const parsed = Number.parseInt(rawValue, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
    return Math.min(10, Math.max(1, parsed));
  }
  // Default-on: 3 attempts of diagnose/repair/resume on directly-fixable
  // blockers (MISSING_BINARY, NETWORK_TRANSIENT). Disable with --no-auto-fix.
  return 3;
}

function readPackageVersion(readPackageJsonText?: (path: string) => string): string | undefined {
  if (!readPackageJsonText && cachedPackageVersion !== undefined) {
    return cachedPackageVersion;
  }

  const readText = readPackageJsonText ?? ((path: string) => readFileSync(path, 'utf8'));
  let currentDir = dirname(fileURLToPath(import.meta.url));

  while (true) {
    try {
      const packageJson = JSON.parse(readText(join(currentDir, 'package.json'))) as {
        name?: unknown;
        version?: unknown;
      };
      if (packageJson.name === '@agentworkforce/ricky') {
        const version = typeof packageJson.version === 'string' ? packageJson.version : undefined;
        if (!readPackageJsonText) {
          cachedPackageVersion = version;
        }
        return version;
      }
    } catch {
      // Keep walking upward; unreadable or invalid package.json files are not fatal.
    }

    const parentDir = dirname(currentDir);
    if (parentDir === currentDir) {
      return undefined;
    }
    currentDir = parentDir;
  }
}

// ---------------------------------------------------------------------------
// Help text
// ---------------------------------------------------------------------------

export function renderHelp(): string[] {
  return [
    'ricky CLI — workflow artifact generation',
    '',
    'What Ricky does:',
    '  generate   Ricky writes a workflow artifact into workflows/generated/ in your repo.',
    '             This is the default. Nothing is executed.',
    '  execute    Only with --run or `ricky run <artifact>`.',
    '             Launches the artifact through local agent-relay.',
    '',
    'Usage:',
    '  ricky                                               Interactive session (default)',
    '  ricky local --spec <text>                           Generate a local workflow artifact',
    '  ricky local --spec-file <path> --run                Generate, then run locally',
    '  ricky cloud --spec <text>                           Generate with AgentWorkforce Cloud',
    '  ricky status                                        Show local and Cloud readiness',
    '  ricky connect cloud                                 Show Cloud connection recovery',
    '  ricky connect agents --cloud                        Show Cloud agent connection recovery',
    '  ricky connect integrations --cloud                  Show Cloud integration recovery',
    '  ricky --mode <mode>                                 Mode preset: local | cloud | both',
    '  ricky --mode local --spec <text>                    Generate artifact only',
    '  ricky --mode local --spec <text> --run              Generate, then execute',
    '  ricky --mode local --spec-file <path>               Generate from file',
    '  ricky --mode local --stdin                          Generate from stdin',
    '  ricky run <artifact>                                Execute existing artifact',
    '  ricky help                                          This help text',
    '  ricky version                                       Version',
    '',
    'Options:',
    '  --mode <mode>       Set mode (local, cloud, both)',
    '  --spec <text>       Inline spec text',
    '  --spec-file <path>  Read spec from a file',
    '  --workflow <path>   Run an existing workflow artifact',
    '  --name <name>       Workflow name for summaries and metadata',
    '  --artifact <path>   Execute an existing artifact (implies --run)',
    '  --run               Execute the generated artifact after generation',
    '  --no-run            Generate only and print the run command',
    '  --background        Request detached/background monitoring metadata',
    '  --foreground        Keep the local run attached to this process',
    '  --refine[=model]    Refine generated task text and gates with an LLM pass (default on)',
    '  --no-refine         Disable refinement; emit only the deterministic artifact',
    '  --with-llm[=model]  Alias for --refine',
    '  --auto-fix[=N]      Local diagnose/repair/resume loop (default 3 attempts, max 10)',
    '  --no-auto-fix       Disable the repair loop; first failure surfaces immediately',
    '  --repair[=N]        Alias for --auto-fix',
    '  --login             Power-user Cloud: re-probe readiness after a real Cloud login',
    '  --connect-missing   Power-user Cloud: re-probe readiness after connecting missing agents',
    '  --yes               Skip non-destructive run confirmations only',
    '  --json              Print results as JSON',
    '  --quiet             Print only essential output',
    '  --verbose           Include diagnostic detail for unexpected failures',
    '  --stdin             Read spec from stdin',
    '  --help, -h          Show help',
    '  --version, -v       Show version',
    '',
    'What you get back:',
    '  Without --run:  artifact path on disk, logs, warnings, and the exact',
    '                  `npx --no-install agent-relay run ...` command to run it yourself.',
    '  With --run:     generation result + execution result. On failure, a classified',
    '                  blocker code (e.g. MISSING_BINARY, MISSING_ENV_VAR) with',
    '                  shell-ready recovery steps and exit code 2.',
    '  Cloud mode:     generated artifact from AgentWorkforce Cloud. This CLI does',
    '                  not stream Cloud execution results.',
    '',
    'Examples:',
    '  ricky --mode local --spec "generate a workflow for package checks"',
    '  ricky --mode local --spec "generate a workflow for package checks" --run',
    '  ricky --mode local --spec-file ./my-spec.md',
    '  printf "%s\\n" "run workflows/release.workflow.ts" | ricky --mode local --stdin',
    '  ricky run workflows/generated/package-checks.ts',
  ];
}

function renderCliArgumentRecovery(errors: string[]): string[] {
  return [
    'CLI input blocker:',
    ...errors.map((error) => `  - ${error}`),
    '',
    'Recovery:',
    '  Use `ricky --help` for the currently implemented flags.',
    '  For local handoff, provide one of --spec, --spec-file, or --stdin.',
  ];
}

async function readStreamText(input: NodeJS.ReadableStream): Promise<string> {
  input.setEncoding('utf8');
  let text = '';
  for await (const chunk of input) {
    text += chunk;
  }
  return text;
}

function hasSpecHandoffArgs(parsed: ParsedArgs): boolean {
  return parsed.spec !== undefined || parsed.specFile !== undefined || parsed.stdin === true || parsed.artifact !== undefined;
}

async function buildCliHandoff(parsed: ParsedArgs, deps: CliMainDeps): Promise<RawHandoff | undefined> {
  if (!hasSpecHandoffArgs(parsed)) {
    return undefined;
  }

  if (parsed.mode === 'cloud') {
    if (parsed.surface === 'cloud') {
      return undefined;
    }
    throw new Error('Cloud mode does not accept CLI spec handoff in this local slice. Use `ricky cloud --spec ...` for Cloud generation or --mode local for local generation.');
  }

  const handoffMode = parsed.mode ?? 'local';
  const invocationRoot = resolveInvocationRoot(deps.cwd);
  const stageMode = parsed.runRequested ? 'run' : 'generate';

  if (parsed.artifact !== undefined) {
    return {
      source: 'workflow-artifact',
      artifactPath: parsed.artifact,
      invocationRoot,
      mode: handoffMode,
      stageMode: 'run',
      ...(parsed.autoFix ? { autoFix: { maxAttempts: parsed.autoFix } } : {}),
      ...(parsed.refine ? { refine: parsed.refine } : {}),
      metadata: cliMetadataFor(parsed, 'artifact'),
    };
  }

  if (parsed.spec !== undefined) {
    if (parsed.spec.trim().length === 0) {
      throw new Error('Inline spec is empty.');
    }

    return {
      source: 'cli',
      spec: parsed.spec,
      invocationRoot,
      ...(parsed.specFile ? { specFile: parsed.specFile } : {}),
      mode: handoffMode,
      stageMode,
      ...(parsed.autoFix ? { autoFix: { maxAttempts: parsed.autoFix } } : {}),
      ...(parsed.refine ? { refine: parsed.refine } : {}),
      cliMetadata: cliMetadataFor(parsed, 'inline-spec'),
    };
  }

  if (parsed.specFile) {
    const readText = deps.readFileText ?? ((path: string) => readFile(path, 'utf8'));
    const specFilePath = resolveSpecFilePath(parsed.specFile, invocationRoot);
    const spec = await readText(specFilePath);
    return {
      source: 'cli',
      spec,
      specFile: specFilePath,
      invocationRoot,
      mode: handoffMode,
      stageMode,
      ...(parsed.autoFix ? { autoFix: { maxAttempts: parsed.autoFix } } : {}),
      ...(parsed.refine ? { refine: parsed.refine } : {}),
      cliMetadata: cliMetadataFor(parsed, 'spec-file'),
    };
  }

  if (parsed.stdin) {
    const spec = await readStreamText(deps.input ?? process.stdin);
    if (spec.trim().length === 0) {
      throw new Error('Stdin spec is empty.');
    }

    return {
      source: 'cli',
      spec,
      invocationRoot,
      mode: handoffMode,
      stageMode,
      ...(parsed.autoFix ? { autoFix: { maxAttempts: parsed.autoFix } } : {}),
      ...(parsed.refine ? { refine: parsed.refine } : {}),
      cliMetadata: cliMetadataFor(parsed, 'stdin'),
    };
  }

  return undefined;
}

function cliMetadataFor(parsed: ParsedArgs, handoff: string): Record<string, unknown> {
  return {
    handoff,
    ...(parsed.workflowName ? { workflowName: parsed.workflowName } : {}),
    ...(parsed.background ? { runMode: 'background' } : {}),
    ...(parsed.foreground ? { runMode: 'foreground' } : {}),
    ...(parsed.yes ? { yes: 'non-destructive-confirmations-only' } : {}),
  };
}

function resolveInvocationRoot(explicitCwd?: string): string {
  const processCwd = resolve(process.cwd());
  const explicit = explicitCwd ? resolve(explicitCwd) : undefined;
  const initCwd = process.env.INIT_CWD ? resolve(process.env.INIT_CWD) : undefined;

  if (initCwd && (!explicit || explicit === processCwd || explicit === cliPackageRoot())) {
    return initCwd;
  }

  return explicit ?? initCwd ?? processCwd;
}

function cliPackageRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), '../..');
}

function resolveSpecFilePath(specFile: string, invocationRoot: string): string {
  return isAbsolute(specFile) ? specFile : resolve(invocationRoot, specFile);
}

async function buildCloudRequest(parsed: ParsedArgs, deps: CliMainDeps): Promise<CloudGenerateRequest | undefined> {
  if (parsed.mode !== 'cloud' || !hasSpecHandoffArgs(parsed)) {
    return deps.cloudRequest;
  }

  const cloudSpec = await readCloudSpec(parsed, deps);
  if (!deps.cloudRequest) {
    return undefined;
  }

  return {
    ...deps.cloudRequest,
    body: {
      ...deps.cloudRequest.body,
      spec: cloudSpec.spec,
      ...(cloudSpec.specPath ? { specPath: cloudSpec.specPath } : {}),
      mode: 'cloud',
      metadata: {
        ...deps.cloudRequest.body.metadata,
        ...(parsed.workflowName ? { workflowName: parsed.workflowName } : {}),
        cli: cliMetadataFor(parsed, cloudSpec.handoff),
      },
    },
  };
}

async function readCloudSpec(
  parsed: ParsedArgs,
  deps: CliMainDeps,
): Promise<{ spec: CloudWorkflowSpecPayload; specPath?: string; handoff: string }> {
  const invocationRoot = resolveInvocationRoot(deps.cwd);

  if (parsed.artifact !== undefined) {
    return {
      spec: {
        kind: 'structured',
        document: {
          intent: 'execute',
          workflowPath: parsed.artifact,
          ...(parsed.workflowName ? { workflowName: parsed.workflowName } : {}),
        },
        format: 'ricky-workflow',
      },
      specPath: parsed.artifact,
      handoff: 'artifact',
    };
  }

  if (parsed.spec !== undefined) {
    if (parsed.spec.trim().length === 0) {
      throw new Error('Inline spec is empty.');
    }
    return { spec: parsed.spec, handoff: 'inline-spec' };
  }

  if (parsed.specFile) {
    const readText = deps.readFileText ?? ((path: string) => readFile(path, 'utf8'));
    const specFilePath = resolveSpecFilePath(parsed.specFile, invocationRoot);
    const spec = await readText(specFilePath);
    if (spec.trim().length === 0) {
      throw new Error('Spec file is empty.');
    }
    return { spec, specPath: specFilePath, handoff: 'spec-file' };
  }

  if (parsed.stdin) {
    const spec = await readStreamText(deps.input ?? process.stdin);
    if (spec.trim().length === 0) {
      throw new Error('Stdin spec is empty.');
    }
    return { spec, handoff: 'stdin' };
  }

  throw new Error('Provide one of --spec, --spec-file, --stdin, or --workflow.');
}

async function renderStatus(parsed: ParsedArgs, cwd: string): Promise<string[]> {
  if (parsed.runId) {
    return renderRunMonitorStatus(parsed.runId, cwd, parsed);
  }

  const status = await statusPayload(cwd);
  if (parsed.json) {
    return [JSON.stringify(status, null, 2)];
  }
  if (parsed.quiet) {
    return [`Ricky status: local ${status.local.agentRelay}; cloud ${status.cloud.account}.`];
  }
  return [
    'Ricky status',
    '',
    'Local',
    `  Repo:        ${status.local.repo}`,
    `  agent-relay: ${status.local.agentRelay}`,
    `  Codex:       ${status.local.codex}`,
    `  Claude:      ${status.local.claude}`,
    '',
    'Cloud',
    `  Account:     ${status.cloud.account}`,
    `  Workspace:   ${status.cloud.workspace}`,
    `  Agents:      ${status.cloud.agents}`,
    '',
    'Integrations',
    `  Slack:       ${status.integrations.slack}`,
    `  GitHub:      ${status.integrations.github}`,
    `  Notion:      ${status.integrations.notion}`,
    `  Linear:      ${status.integrations.linear}`,
    '',
    'Next',
    ...status.nextActions.map((action) => `  ${action}`),
  ];
}

async function renderRunMonitorStatus(runId: string, cwd: string, parsed: ParsedArgs): Promise<string[]> {
  const statePath = join(cwd, '.workflow-artifacts', 'ricky-local-runs', runId, 'state.json');
  let state: LocalRunMonitorState;
  try {
    state = JSON.parse(await readFile(statePath, 'utf8')) as LocalRunMonitorState;
  } catch {
    const missing = {
      runId,
      status: 'not-found',
      statePath,
      recovery: [
        'Check the run id printed after choosing background monitoring.',
        'Run `ricky status` to inspect local readiness.',
      ],
    };
    return parsed.json
      ? [JSON.stringify(missing, null, 2)]
      : [
          'Ricky run status',
          '',
          `Run id: ${runId}`,
          'Status: not found',
          `State:  ${statePath}`,
          '',
          'Recovery',
          ...missing.recovery.map((item) => `  ${item}`),
        ];
  }

  if (parsed.json) {
    return [JSON.stringify(state, null, 2)];
  }
  if (parsed.quiet) {
    return [`Ricky run ${state.runId}: ${state.status}.`];
  }

  const lines = [
    'Ricky run status',
    '',
    `Run id:    ${state.runId}`,
    `Status:    ${state.status}`,
    `Artifact:  ${state.artifactPath}`,
    `State:     ${state.statePath}`,
    `Logs:      ${state.logPath}`,
    `Evidence:  ${state.evidencePath}`,
    `Fixes:     ${state.fixesPath}`,
  ];

  const execution = state.response?.execution;
  if (execution) {
    lines.push(
      '',
      'Execution',
      `  status: ${execution.status}`,
      `  workflow_id: ${execution.execution.workflow_id}`,
      `  run_id: ${execution.execution.run_id}`,
      `  command: ${execution.execution.command}`,
    );
    if (execution.evidence?.outcome_summary) {
      lines.push(`  outcome: ${execution.evidence.outcome_summary}`);
    }
  }

  lines.push('', 'Refresh', `  ${state.reattachCommand}`);
  return lines;
}

function statusValueFromCheck(checks: LocalPreflightCheck[], id: string): string {
  const check = checks.find((entry) => entry.id === id);
  if (!check) return 'unknown';
  if (check.status === 'found') return check.path ? `found (${check.path})` : 'found';
  if (check.status === 'missing') return 'missing';
  return check.detail ?? 'unknown';
}

async function statusPayload(cwd: string): Promise<{
  mode: RickyMode;
  local: { repo: string; agentRelay: string; codex: string; claude: string };
  cloud: { account: string; workspace: string; agents: string };
  integrations: Record<'slack' | 'github' | 'notion' | 'linear', string>;
  warnings: string[];
  nextActions: string[];
}> {
  let preflight: LocalPreflightResult | null = null;
  const warnings: string[] = [];
  try {
    preflight = await runLocalPreflight(cwd);
  } catch (error) {
    warnings.push(error instanceof Error ? error.message : String(error));
  }
  const checks = preflight?.checks ?? [];
  const hasCloudToken = Boolean(process.env.AGENTWORKFORCE_CLOUD_TOKEN || process.env.RICKY_CLOUD_TOKEN);
  const cloudWorkspace = process.env.AGENTWORKFORCE_CLOUD_WORKSPACE || process.env.RICKY_CLOUD_WORKSPACE || '';

  return {
    mode: 'local',
    local: {
      repo: preflight?.repoRoot ?? cwd,
      agentRelay: statusValueFromCheck(checks, 'agent-relay'),
      codex: statusValueFromCheck(checks, 'codex'),
      claude: statusValueFromCheck(checks, 'claude'),
    },
    cloud: {
      account: hasCloudToken ? 'configured' : 'not connected',
      workspace: cloudWorkspace || 'not selected',
      agents: hasCloudToken ? 'probe via Cloud readiness check' : 'not connected (login required)',
    },
    integrations: {
      slack: hasCloudToken ? 'probe via Cloud readiness check' : 'not connected (Cloud login required)',
      github: hasCloudToken ? 'probe via Cloud readiness check' : 'not connected (Cloud login required)',
      notion: hasCloudToken ? 'probe via Cloud readiness check' : 'not connected (Cloud login required)',
      linear: hasCloudToken ? 'probe via Cloud readiness check' : 'not connected (Cloud login required)',
    },
    warnings,
    nextActions: [
      'ricky local --spec-file ./spec.md --no-run',
      'ricky connect cloud',
    ],
  };
}

interface ConnectPayload {
  target: string;
  status: 'connected' | 'failed' | 'input-required' | 'manual-dashboard' | 'connector-unavailable';
  message: string;
  warnings: string[];
  nextActions: string[];
  connectedProviders?: string[];
  failedProviders?: Array<{ provider: string; message: string; endpoint?: string; statusCode?: number }>;
}

async function renderConnect(parsed: ParsedArgs, deps: CliMainDeps): Promise<{ exitCode: number; output: string[] }> {
  const payload = await connectPayload(parsed, deps);
  if (parsed.json) {
    return {
      exitCode: connectExitCode(payload),
      output: [JSON.stringify(payload, null, 2)],
    };
  }
  if (parsed.quiet) {
    return {
      exitCode: connectExitCode(payload),
      output: [`Ricky connect ${parsed.connectTarget ?? 'cloud'}: ${payload.status}.`],
    };
  }

  const output = [
    `Ricky connect ${parsed.connectTarget ?? 'cloud'}`,
    '',
    payload.message,
  ];
  if (payload.connectedProviders && payload.connectedProviders.length > 0) {
    output.push('', 'Connected', ...payload.connectedProviders.map((provider) => `  ${provider}`));
  }
  if (payload.failedProviders && payload.failedProviders.length > 0) {
    output.push('', 'Failed', ...payload.failedProviders.map((failure) => `  ${failure.provider}: ${failure.message}`));
  }
  if (payload.warnings.length > 0) {
    output.push('', 'Warnings', ...payload.warnings.map((warning) => `  ${warning}`));
  }
  output.push('', payload.status === 'connected' ? 'Next' : 'Recovery', ...payload.nextActions.map((action) => `  ${action}`));
  return {
    exitCode: connectExitCode(payload),
    output,
  };
}

function connectExitCode(payload: ConnectPayload): number {
  return payload.status === 'connected' || payload.status === 'manual-dashboard' ? 0 : 1;
}

async function connectPayload(parsed: ParsedArgs, deps: CliMainDeps): Promise<ConnectPayload> {
  if (parsed.connectTarget === 'agents') {
    const providers = parsed.cloudTargets ?? [];
    if (providers.length === 0) {
      return {
        target: 'agents',
        status: 'input-required',
        message: 'Choose at least one Cloud agent provider for Ricky to connect through Relay Cloud.',
        warnings: [],
        nextActions: [
          'ricky connect agents --cloud claude',
          'ricky connect agents --cloud claude,codex,gemini',
          'ricky status',
        ],
      };
    }
    return connectProviders({
      target: 'agents',
      providers,
      successMessage: 'Ricky connected the selected Cloud agent provider credentials through Relay Cloud.',
      deps,
      parsed,
    });
  }
  if (parsed.connectTarget === 'integrations') {
    return connectIntegrations(parsed, deps);
  }

  return connectCloudAccount(deps);
}

async function connectProviders(options: {
  target: 'agents';
  providers: string[];
  successMessage: string;
  deps: CliMainDeps;
  parsed: ParsedArgs;
}): Promise<ConnectPayload> {
  const connector = options.deps.connectProvider ?? await loadRelayCloudConnectProvider();
  const selected = options.providers.join(',');
  const connectCommand = `npx agent-relay cloud connect ${selected}`;

  if (!connector) {
    return {
      target: options.target,
      status: 'connector-unavailable',
      message:
        'Ricky could not load the Relay Cloud connect package, so no connection was attempted and no success was claimed.',
      warnings: ['Install @agent-relay/cloud or use the Agent Relay CLI command directly.'],
      nextActions: [
        connectCommand,
        'ricky status',
      ],
    };
  }

  const connectedProviders: string[] = [];
  const failedProviders: Array<{ provider: string; message: string }> = [];
  for (const provider of options.providers) {
    try {
      const result = await connector({
        provider,
        ...(options.deps.connectApiUrl ? { apiUrl: options.deps.connectApiUrl } : {}),
        ...(options.deps.connectTimeoutMs ? { timeoutMs: options.deps.connectTimeoutMs } : {}),
        io: connectIo(options.parsed, Boolean(options.deps.connectProvider)),
      });
      connectedProviders.push(result.provider);
    } catch (error) {
      failedProviders.push({
        provider,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (failedProviders.length > 0) {
    return {
      target: options.target,
      status: 'failed',
      message:
        'Ricky attempted the Relay Cloud connect flow, but one or more provider connections did not complete. No missing provider was marked connected.',
      warnings: [],
      nextActions: [
        connectCommand,
        'ricky status',
      ],
      ...(connectedProviders.length > 0 ? { connectedProviders } : {}),
      failedProviders,
    };
  }

  return {
    target: options.target,
    status: 'connected',
    message: options.successMessage,
    warnings: [],
    nextActions: ['ricky status'],
    connectedProviders,
  };
}

async function connectCloudAccount(deps: CliMainDeps): Promise<ConnectPayload> {
  const authenticator = deps.ensureCloudAuthenticated ?? await loadRelayCloudAuthenticator();
  if (!authenticator) {
    return {
      target: 'cloud',
      status: 'connector-unavailable',
      message:
        'Ricky could not load the Relay Cloud login package, so no Cloud login was attempted and no success was claimed.',
      warnings: ['Install @agent-relay/cloud or use the Agent Relay CLI command directly.'],
      nextActions: [
        'npx agent-relay cloud login',
        'ricky status',
      ],
    };
  }

  try {
    await authenticator();
    return {
      target: 'cloud',
      status: 'connected',
      message: 'Ricky connected your AgentWorkforce Cloud account through Relay Cloud login.',
      warnings: [],
      nextActions: ['ricky status'],
      connectedProviders: ['cloud'],
    };
  } catch (error) {
    return {
      target: 'cloud',
      status: 'failed',
      message: 'Ricky attempted the Relay Cloud login flow, but Cloud login did not complete.',
      warnings: [],
      nextActions: [
        'ricky connect cloud',
        'ricky status',
      ],
      failedProviders: [
        {
          provider: 'cloud',
          message: error instanceof Error ? error.message : String(error),
        },
      ],
    };
  }
}

async function connectIntegrations(parsed: ParsedArgs, deps: CliMainDeps): Promise<ConnectPayload> {
  const integrations = (parsed.cloudTargets && parsed.cloudTargets.length > 0
    ? parsed.cloudTargets
    : ['slack', 'github', 'notion', 'linear']
  ).filter((integration): integration is 'slack' | 'github' | 'notion' | 'linear' => (
    integration === 'slack' || integration === 'github' || integration === 'notion' || integration === 'linear'
  ));

  if (integrations.length === 0) {
    return {
      target: 'integrations',
      status: 'input-required',
      message: 'Choose at least one optional integration for Ricky to authorize through Nango.',
      warnings: [],
      nextActions: [
        'ricky connect integrations --cloud slack,github,notion,linear',
        'ricky status',
      ],
    };
  }

  const connector = deps.connectCloudIntegrations ?? defaultCloudIntegrationConnector;
  const results = await connector(integrations);
  const failedProviders = results
    .filter((result) => result.status === 'failed')
    .map((result) => ({
      provider: result.integration,
      message: result.message ?? 'Could not create Nango connect link.',
      ...(result.endpoint ? { endpoint: result.endpoint } : {}),
      ...(result.statusCode ? { statusCode: result.statusCode } : {}),
    }));

  return {
    target: 'integrations',
    status: failedProviders.length > 0 ? 'failed' : 'connected',
    message: failedProviders.length > 0
      ? 'Ricky attempted to create Nango connect links, but one or more optional integrations did not start.'
      : 'Ricky created Nango connect links for the selected optional integrations.',
    warnings: ['Ricky does not claim an integration is connected until Cloud readiness confirms it.'],
    nextActions: ['ricky status'],
    ...(failedProviders.length > 0 ? { failedProviders } : { connectedProviders: results.map((result) => result.integration) }),
  };
}

function connectIo(parsed: ParsedArgs, injectedConnector: boolean): ConnectProviderOptions['io'] {
  if (injectedConnector) {
    return {
      log: () => undefined,
      error: () => undefined,
    };
  }
  if (parsed.json) {
    return {
      log: (...args: unknown[]) => console.error(...args),
      error: (...args: unknown[]) => console.error(...args),
    };
  }
  if (parsed.quiet) {
    return {
      log: () => undefined,
      error: (...args: unknown[]) => console.error(...args),
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

// ---------------------------------------------------------------------------
// Main entry
// ---------------------------------------------------------------------------

/**
 * Run the Ricky CLI.
 *
 * Parses argv, dispatches to the appropriate handler:
 * - `help`    — prints usage and exits 0
 * - `version` — prints version and exits 0
 * - `run`     — delegates to the interactive CLI entrypoint
 */
export async function cliMain(deps: CliMainDeps = {}): Promise<CliMainResult> {
  const argv = deps.argv ?? process.argv.slice(2);
  const parsed = parseArgs(argv);

  if (parsed.command === 'help') {
    const output = renderHelp();
    return { exitCode: 0, output };
  }

  if (parsed.command === 'version') {
    const version = deps.version ?? readPackageVersion(deps.readPackageJsonText) ?? '0.0.0';
    return { exitCode: 0, output: [`ricky ${version}`] };
  }

  if (parsed.command === 'status') {
    if (parsed.errors && parsed.errors.length > 0) {
      return {
        exitCode: 1,
        output: renderCliArgumentRecovery(parsed.errors),
      };
    }
    return {
      exitCode: 0,
      output: await renderStatus(parsed, resolveInvocationRoot(deps.cwd)),
    };
  }

  if (parsed.command === 'connect') {
    if (parsed.errors && parsed.errors.length > 0) {
      return {
        exitCode: 1,
        output: renderCliArgumentRecovery(parsed.errors),
      };
    }
    return renderConnect(parsed, deps);
  }

  if (parsed.errors && parsed.errors.length > 0) {
    return {
      exitCode: 1,
      output: renderCliArgumentRecovery(parsed.errors),
    };
  }

  let cliHandoff: RawHandoff | undefined;
  try {
    cliHandoff = await buildCliHandoff(parsed, deps);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      exitCode: 1,
      output: renderCliArgumentRecovery([`Could not read spec handoff: ${message}`]),
    };
  }

  // Default: run interactive session
  const runner = deps.runInteractive ?? runInteractiveCli;
  let cloudRequest: CloudGenerateRequest | undefined;
  try {
    cloudRequest = await buildCloudRequest(parsed, deps);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      exitCode: 1,
      output: renderCliArgumentRecovery([`Could not read spec handoff: ${message}`]),
    };
  }

  if (parsed.surface === 'cloud' && !cloudRequest && !parsed.login && !parsed.connectMissing) {
    const guidance = [
      'Cloud mode selected but no Cloud request context was provided.',
      'Recovery: run `ricky connect cloud`, then `ricky status`.',
      'To stay local: run `ricky local --spec-file ./spec.md --no-run`.',
    ];
    const summary = cloudPowerUserWorkflowSummary(undefined, {
      mode: 'cloud',
      workflowName: parsed.workflowName,
      runRequested: parsed.runRequested,
      yes: parsed.yes,
      quiet: parsed.quiet,
      guidance,
    });
    return {
      exitCode: 1,
      output: parsed.json
        ? [renderPowerUserWorkflowJson(summary)]
        : renderPowerUserWorkflowSummary(summary, {
            mode: 'cloud',
            workflowName: parsed.workflowName,
            runRequested: parsed.runRequested,
            yes: parsed.yes,
            quiet: parsed.quiet,
          }),
    };
  }

  const cloudRecoveryDeps: Partial<InteractiveCliDeps> = {};
  if (parsed.login && !deps.recoverCloudLogin) {
    cloudRecoveryDeps.recoverCloudLogin = async () => {
      // Power-user --login runs inside the existing interactive recovery
      // contract. Direct provider auth is handled by `ricky connect ...`.
    };
  }
  if (parsed.connectMissing && !deps.connectCloudAgents) {
    cloudRecoveryDeps.connectCloudAgents = async () => {
      // Power-user --connect-missing re-probes readiness after the user runs
      // `ricky connect agents --cloud ...`; it never asserts fake success.
    };
  }

  const interactiveDeps: InteractiveCliDeps = {
    ...deps,
    cwd: resolveInvocationRoot(deps.cwd),
    ...(parsed.mode ? { mode: parsed.mode } : cliHandoff ? { mode: 'local' } : {}),
    ...(cliHandoff ? { handoff: cliHandoff } : {}),
    ...(cloudRequest ? { cloudRequest } : {}),
    ...cloudRecoveryDeps,
  };

  const interactiveResult = await runner(interactiveDeps);
  const output: string[] = [];

  if (interactiveResult.localWorkflowResult) {
    if (parsed.json) {
      output.push(renderLocalWorkflowJson(interactiveResult.localWorkflowResult));
    } else {
      output.push(...renderLocalWorkflowHuman(interactiveResult.localWorkflowResult));
    }
  } else if (cliHandoff && interactiveResult.localResult) {
    if (parsed.json && parsed.surface === 'local') {
      const summary = localPowerUserWorkflowSummary(interactiveResult.localResult, {
        mode: parsed.mode ?? 'local',
        workflowName: parsed.workflowName,
        runRequested: parsed.runRequested,
        yes: parsed.yes,
        quiet: parsed.quiet,
      });
      output.push(renderPowerUserWorkflowJson(summary));
    } else if (parsed.surface === 'local') {
      const summary = localPowerUserWorkflowSummary(interactiveResult.localResult, {
        mode: parsed.mode ?? 'local',
        workflowName: parsed.workflowName,
        runRequested: parsed.runRequested,
        yes: parsed.yes,
        quiet: parsed.quiet,
      });
      output.push(...renderPowerUserWorkflowSummary(summary, {
        mode: parsed.mode ?? 'local',
        workflowName: parsed.workflowName,
        runRequested: parsed.runRequested,
        yes: parsed.yes,
        quiet: parsed.quiet,
      }));
    } else if (parsed.json) {
      output.push(renderLocalJson(interactiveResult.localResult));
    } else {
      output.push(...renderLocalHuman(interactiveResult.localResult));
      if (!interactiveResult.localResult.generation && interactiveResult.guidance.length > 0) {
        output.push(...interactiveResult.guidance);
      }
    }
  } else if (parsed.surface === 'cloud' || parsed.mode === 'cloud') {
    const summary = cloudPowerUserWorkflowSummary(interactiveResult.cloudResult, {
      mode: 'cloud',
      workflowName: parsed.workflowName,
      runRequested: parsed.runRequested,
      yes: parsed.yes,
      quiet: parsed.quiet,
      guidance: interactiveResult.guidance,
    });
    if (parsed.json) {
      output.push(renderPowerUserWorkflowJson(summary));
    } else {
      output.push(...renderPowerUserWorkflowSummary(summary, {
        mode: 'cloud',
        workflowName: parsed.workflowName,
        runRequested: parsed.runRequested,
        yes: parsed.yes,
        quiet: parsed.quiet,
      }));
    }
  } else if (interactiveResult.guidance.length > 0) {
    output.push(...interactiveResult.guidance);
  }

  return {
    exitCode: interactiveResult.localResult?.exitCode ?? (interactiveResult.ok ? 0 : 1),
    output,
    interactiveResult,
  };
}

function renderLocalWorkflowJson(result: NonNullable<InteractiveCliResult['localWorkflowResult']>): string {
  return JSON.stringify({
    confirmation: result.confirmation,
    command: result.command,
    summary: result.summary,
    generation: result.generation,
    run: result.run,
    monitoredRun: result.monitoredRun,
  }, null, 2);
}

function renderLocalWorkflowHuman(result: NonNullable<InteractiveCliResult['localWorkflowResult']>): string[] {
  const lines = [
    'Ricky local workflow',
    '',
    `Goal: ${result.summary.goal}`,
    `Artifact: ${result.summary.artifactPath}`,
  ];

  if (result.generation?.generation?.artifact?.workflow_id) {
    lines.push(`Workflow id: ${result.generation.generation.artifact.workflow_id}`);
  }

  if (result.monitoredRun) {
    const execution = result.monitoredRun.response?.execution?.execution;
    lines.push(
      '',
      'Background monitor',
      `  Workflow run id: ${result.monitoredRun.runId}`,
      ...(execution?.workflow_id ? [`  Runtime workflow id: ${execution.workflow_id}`] : []),
      ...(execution?.run_id ? [`  Runtime run id: ${execution.run_id}`] : []),
      `  Status: ${result.monitoredRun.status}`,
      `  Status command: ${result.monitoredRun.reattachCommand}`,
      `  Logs: ${result.monitoredRun.logPath}`,
      `  Evidence: ${result.monitoredRun.evidencePath}`,
    );
    return lines;
  }

  if (result.run) {
    lines.push(...renderLocalHuman(result.run));
    return lines;
  }

  lines.push(
    '',
    'Run command',
    `  ${result.command}`,
  );
  return lines;
}

function renderLocalJson(localResult: NonNullable<InteractiveCliResult['localResult']>): string {
  const stages = [
    ...(localResult.generation ? [localResult.generation] : []),
    ...(localResult.execution ? [localResult.execution] : []),
  ];
  if (localResult.auto_fix) {
    return JSON.stringify({ stages, auto_fix: localResult.auto_fix }, null, 2);
  }
  return JSON.stringify(stages.length > 0 ? stages : localResult, null, 2);
}

function renderLocalHuman(localResult: NonNullable<InteractiveCliResult['localResult']>): string[] {
  const lines: string[] = [];
  if (localResult.ok) {
    if (localResult.execution?.status === 'success') {
      lines.push('Generation: ok — artifact written to disk.');
      lines.push('Execution: success — artifact ran through local agent-relay.');
    } else if (localResult.generation) {
      lines.push('Generation: ok — artifact written to disk.');
      lines.push('Execution: not requested. Pass --run to execute, or run the command printed below.');
    } else {
      lines.push('Artifact returned. No execution was attempted.');
    }
  } else {
    if (localResult.execution) {
      lines.push('Generation: ok — artifact written to disk.');
      lines.push(`Execution: failed (status: ${localResult.execution.status}).`);
    } else if (localResult.generation) {
      lines.push(`Generation: failed (status: ${localResult.generation.status}).`);
      lines.push('No artifact was written. Nothing was executed.');
    } else {
      lines.push('Local handoff failed.');
    }
  }

  if (localResult.generation) {
    lines.push(`stage: ${localResult.generation.stage}`);
    lines.push(`status: ${localResult.generation.status}`);
    if (localResult.generation.artifact) {
      lines.push(`  Artifact: ${localResult.generation.artifact.path}`);
      lines.push(`  workflow_id: ${localResult.generation.artifact.workflow_id}`);
      lines.push(`  spec_digest: ${localResult.generation.artifact.spec_digest}`);
    } else {
      for (const artifact of localResult.artifacts) {
        lines.push(`  Artifact: ${artifact.path}`);
      }
    }
    if (localResult.generation.next) {
      lines.push(`  To execute this artifact: ${localResult.generation.next.run_command}`);
      lines.push(`  Or with linked CLI: ${localResult.generation.next.run_mode_hint}`);
    }
    if (localResult.generation.error) {
      lines.push(`  Error: ${localResult.generation.error}`);
    }
  } else {
    for (const artifact of localResult.artifacts) {
      lines.push(`  Artifact: ${artifact.path}`);
    }
  }

  if (localResult.execution) {
    lines.push('--- execution ---');
    lines.push(`stage: ${localResult.execution.stage}`);
    lines.push(`status: ${localResult.execution.status}`);
    lines.push(`  command: ${localResult.execution.execution.command}`);
    lines.push(`  workflow_file: ${localResult.execution.execution.workflow_file}`);
    lines.push(`  cwd: ${localResult.execution.execution.cwd}`);
    if (localResult.execution.evidence) {
      lines.push(`  outcome_summary: ${localResult.execution.evidence.outcome_summary}`);
      if (localResult.execution.evidence.logs.stdout_path) {
        lines.push(`  stdout_path: ${localResult.execution.evidence.logs.stdout_path}`);
      }
      if (localResult.execution.evidence.logs.stderr_path) {
        lines.push(`  stderr_path: ${localResult.execution.evidence.logs.stderr_path}`);
      }
      for (const tailLine of localResult.execution.evidence.logs.tail ?? []) {
        lines.push(`  tail: ${tailLine}`);
      }
    }
    if (localResult.execution.blocker) {
      lines.push(`  blocker_code: ${localResult.execution.blocker.code}`);
      lines.push(`  blocker_category: ${localResult.execution.blocker.category}`);
      lines.push(`  blocker_message: ${localResult.execution.blocker.message}`);
      for (const step of localResult.execution.blocker.recovery.steps) {
        lines.push(`  Recovery: ${step}`);
      }
    }
  }

  if (localResult.auto_fix) {
    lines.push('--- auto-fix ---');
    for (const attempt of localResult.auto_fix.attempts) {
      const status = String(attempt.status ?? 'unknown');
      const label = `attempt ${String(attempt.attempt)}/${localResult.auto_fix.max_attempts}:`;
      const blocker = attempt.blocker_code ? ` (${String(attempt.blocker_code)})` : '';
      lines.push(label);
      lines.push(`  status: ${status}${blocker}`);
      if (attempt.applied_fix && typeof attempt.applied_fix === 'object') {
        const fix = attempt.applied_fix as { steps?: unknown; exit_code?: unknown };
        if (Array.isArray(fix.steps)) lines.push(`  applied fix: ${fix.steps.join(' && ')}`);
        if (fix.exit_code !== undefined) lines.push(`  fix outcome: ${fix.exit_code === 0 ? 'ok' : `exit ${String(fix.exit_code)}`}`);
      }
      if (attempt.warning) lines.push(`  warning: ${String(attempt.warning)}`);
    }
    const finalAttempt = localResult.auto_fix.attempts.at(-1);
    const finalBlocker = finalAttempt?.blocker_code ? ` Final blocker: ${String(finalAttempt.blocker_code)}.` : '';
    const final = autoFixFinalMessage(
      localResult.auto_fix.final_status,
      localResult.auto_fix.attempts.length,
      localResult.auto_fix.max_attempts,
      finalBlocker,
    );
    lines.push(final);
  }

  const shouldRenderNextActions =
    !localResult.generation ||
    localResult.generation.status !== 'ok' ||
    localResult.execution?.status === 'blocker';

  if (shouldRenderNextActions) {
    for (const action of localResult.nextActions) {
      lines.push(`  Next: ${action}`);
    }
  }
  return lines;
}

function isAutoFixValue(value: string): boolean {
  return /^-?\d+$/.test(value);
}

function autoFixFinalMessage(finalStatus: string, attempts: number, maxAttempts: number, finalBlocker: string): string {
  if (finalStatus === 'ok') {
    return `Auto-fix loop succeeded on attempt ${attempts}/${maxAttempts}.`;
  }
  if (attempts >= maxAttempts) {
    return `Auto-fix loop exhausted ${maxAttempts} attempts.${finalBlocker}`;
  }
  return `Auto-fix loop stopped with status ${finalStatus}.${finalBlocker}`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  cliMain()
    .then((result) => {
      if (result.output.length > 0) {
        process.stdout.write(`${result.output.join('\n')}\n`);
      }
      process.exitCode = result.exitCode;
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`${message}\n`);
      process.exitCode = 1;
    });
}
