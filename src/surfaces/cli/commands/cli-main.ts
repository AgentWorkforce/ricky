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
import type { ProviderStatus, RickyMode } from '../cli/mode-selector.js';
import type { RawHandoff, SpecInput } from '../../../local/request-normalizer.js';
import type { CloudGenerateRequest, CloudWorkflowSpecPayload } from '../../../cloud/api/request-types.js';
import type { ConnectProviderOptions, ConnectProviderResult, StoredAuth, WhoAmIResponse } from '@agent-relay/cloud';
import type { LocalRunMonitorState } from '../flows/local-run-monitor.js';
import { legacyLocalRunStatePath, localRunStatePath } from '../flows/local-run-monitor.js';
import type {
  CloudAgentReadiness,
  CloudImplementationAgent,
  CloudOptionalIntegration,
  CloudReadinessCheck,
  CloudReadinessSnapshot,
} from '../flows/cloud-workflow-flow.js';
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
import { defaultArtifactPathForWorkflowName } from '../flows/spec-intake-flow.js';
import { CLOUD_IMPLEMENTATION_AGENTS, CLOUD_OPTIONAL_INTEGRATIONS } from '../flows/cloud-workflow-flow.js';
import { resolvePreferWorkforcePersonaWorkflowWriter } from '../flows/workforce-persona-cli-preference.js';

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
  startFromStep?: string;
  previousRunId?: string;
  yes?: boolean;
  json?: boolean;
  quiet?: boolean;
  verbose?: boolean;
  autoFix?: number;
  refine?: false | { model?: string };
  login?: boolean;
  connectMissing?: boolean;
  workforcePersonaWriterCli?: boolean;
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
  if (parsed.startFromStep) result.startFromStep = parsed.startFromStep;
  if (parsed.previousRunId) result.previousRunId = parsed.previousRunId;
  if (parsed.yes) result.yes = true;
  if (parsed.json) result.json = true;
  if (parsed.quiet) result.quiet = true;
  if (parsed.verbose) result.verbose = true;
  if (parsed.autoFix !== undefined && parsed.autoFix > 0) result.autoFix = parsed.autoFix;
  if (parsed.refine) result.refine = parsed.refine;
  if (parsed.login) result.login = true;
  if (parsed.connectMissing) result.connectMissing = true;
  if (parsed.workforcePersonaWriterCli !== undefined) result.workforcePersonaWriterCli = parsed.workforcePersonaWriterCli;
  if (parsed.errors && parsed.errors.length > 0) result.errors = parsed.errors;
  return result;
}

function parseRefine(argv: string[]): undefined | false | { model?: string } {
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
  // Opt-in: refinement runs only when --refine / --with-llm is set.
  return undefined;
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
    'ricky CLI — workflow generation and runs',
    '',
    'Happy path:',
    '  ricky                                               Start guided mode',
    '  ricky local --spec <text>                           Write a workflow artifact',
    '  ricky run --artifact <path> --background            Run it in the background',
    '  ricky status --run <run-id>                         Check progress',
    '',
    'Common commands:',
    '  ricky status                                        Show local and Cloud readiness',
    '  ricky connect cloud                                 Connect AgentWorkforce Cloud',
    '  ricky cloud --spec <text>                           Generate with Cloud',
    '  ricky run --artifact <path>                         Run attached in this terminal',
    '',
    'Usage:',
    '  ricky local --spec-file <path> --run                Generate, then run locally',
    '  ricky --mode <mode>                                 Mode preset: local | cloud | both',
    '  ricky --mode local --spec <text>                    Generate artifact only',
    '  ricky --mode local --spec <text> --run              Generate, then execute',
    '  ricky --mode local --spec-file <path>               Generate from file',
    '  ricky --mode local --stdin                          Generate from stdin',
    '  ricky run <artifact>                                Execute existing artifact',
    '  ricky help                                          This help text',
    '  ricky version                                       Version',
    '',
    'Common options:',
    '  --mode <mode>       Set mode (local, cloud, both)',
    '  --spec <text>       Inline spec text',
    '  --spec-file <path>  Read spec from a file',
    '  --artifact <path>   Execute an existing artifact (implies --run)',
    '  --run               Execute the generated artifact after generation',
    '  --no-run            Generate only and print the run command',
    '  --background        Return a run id immediately; use status --run to watch',
    '  --foreground        Keep the local run attached to this process',
    '  --start-from <step> Resume a workflow from a specific step',
    '  --previous-run-id <id> Reuse prior run context when resuming',
    '  --json              Print results as JSON',
    '  --help, -h          Show help',
    '  --version, -v       Show version',
    '',
    'More options:',
    '  --workflow <path>   Alias for --artifact',
    '  --name <name>       Workflow name for summaries and metadata',
    '  --refine[=model]    Optional LLM pass; off by default',
    '  --no-refine         Disable refinement; emit only the deterministic artifact',
    '  --with-llm[=model]  Alias for --refine',
    '  --workforce-persona Use Workforce personas to author the workflow',
    '  --no-workforce-persona Disable Workforce persona authoring',
    '  --auto-fix[=N]      Local diagnose/repair/resume loop (default 3 attempts, max 10)',
    '  --no-auto-fix       Disable the repair loop; first failure surfaces immediately',
    '  --repair[=N]        Alias for --auto-fix',
    '  --login             Power-user Cloud: re-probe readiness after a real Cloud login',
    '  --connect-missing   Power-user Cloud: re-probe readiness after connecting missing agents',
    '  --yes               Skip non-destructive run confirmations only',
    '  --quiet             Print only essential output',
    '  --verbose           Include diagnostic detail for unexpected failures',
    '  --stdin             Read spec from stdin',
    '',
    'What you get back:',
    '  Without --run:  artifact path on disk, logs, warnings, and the exact',
    '                  run commands, including the background form.',
    '  With --run:     generation result + execution result. On failure, a classified',
    '                  blocker code (e.g. MISSING_BINARY, MISSING_ENV_VAR) with',
    '                  shell-ready recovery steps and exit code 2.',
    '  Background:     a Ricky run id and `ricky status --run <run-id>` command.',
    '  Cloud mode:     generated artifact from AgentWorkforce Cloud. This CLI does',
    '                  not stream Cloud execution results.',
    '',
    'Examples:',
    '  ricky --mode local --spec "generate a workflow for package checks"',
    '  ricky --mode local --spec "generate a workflow for package checks" --run',
    '  ricky --mode local --spec-file ./my-spec.md',
    '  printf "%s\\n" "run workflows/release.workflow.ts" | ricky --mode local --stdin',
    '  ricky run --artifact workflows/generated/package-checks.ts --background',
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
  const runAutoFix = parsed.autoFix && stageMode === 'run'
    ? { autoFix: { maxAttempts: parsed.autoFix } }
    : {};
  const retry = retryMetadataFor(parsed);

  if (parsed.artifact !== undefined) {
    return {
      source: 'workflow-artifact',
      artifactPath: parsed.artifact,
      invocationRoot,
      mode: handoffMode,
      stageMode: 'run',
      ...(parsed.autoFix ? { autoFix: { maxAttempts: parsed.autoFix } } : {}),
      ...(parsed.refine ? { refine: parsed.refine } : {}),
      ...(retry ? { retry } : {}),
      metadata: cliMetadataFor(parsed, 'artifact'),
    };
  }

  if (parsed.spec !== undefined) {
    if (parsed.spec.trim().length === 0) {
      throw new Error('Inline spec is empty.');
    }

    return {
      source: 'cli',
      spec: cliSpecInputFor(parsed, parsed.spec),
      invocationRoot,
      ...(parsed.specFile ? { specFile: parsed.specFile } : {}),
      mode: handoffMode,
      stageMode,
      ...runAutoFix,
      ...(parsed.refine ? { refine: parsed.refine } : {}),
      ...(retry ? { retry } : {}),
      cliMetadata: cliMetadataFor(parsed, 'inline-spec'),
    };
  }

  if (parsed.specFile) {
    const readText = deps.readFileText ?? ((path: string) => readFile(path, 'utf8'));
    const specFilePath = resolveSpecFilePath(parsed.specFile, invocationRoot);
    const spec = await readText(specFilePath);
    return {
      source: 'cli',
      spec: cliSpecInputFor(parsed, spec),
      specFile: specFilePath,
      invocationRoot,
      mode: handoffMode,
      stageMode,
      ...runAutoFix,
      ...(parsed.refine ? { refine: parsed.refine } : {}),
      ...(retry ? { retry } : {}),
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
      spec: cliSpecInputFor(parsed, spec),
      invocationRoot,
      mode: handoffMode,
      stageMode,
      ...runAutoFix,
      ...(parsed.refine ? { refine: parsed.refine } : {}),
      ...(retry ? { retry } : {}),
      cliMetadata: cliMetadataFor(parsed, 'stdin'),
    };
  }

  return undefined;
}

function retryMetadataFor(parsed: ParsedArgs): RawHandoff['retry'] | undefined {
  if (!parsed.startFromStep && !parsed.previousRunId) return undefined;
  return {
    attempt: 1,
    reason: 'manual resume requested from Ricky CLI',
    ...(parsed.startFromStep ? { startFromStep: parsed.startFromStep } : {}),
    ...(parsed.previousRunId ? { previousRunId: parsed.previousRunId, retryOfRunId: parsed.previousRunId } : {}),
  };
}

function cliSpecInputFor(parsed: ParsedArgs, spec: string): SpecInput {
  if (!parsed.workflowName) return spec;
  return {
    intent: 'generate',
    description: spec,
    workflowName: parsed.workflowName,
    name: parsed.workflowName,
    artifactPath: defaultArtifactPathForWorkflowName(parsed.workflowName),
  };
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

class CloudPowerUserSetupError extends Error {
  readonly guidance: string[];

  constructor(guidance: string[]) {
    super(guidance[0] ?? 'Cloud mode setup failed.');
    this.name = 'CloudPowerUserSetupError';
    this.guidance = guidance;
  }
}

async function buildCloudRequest(parsed: ParsedArgs, deps: CliMainDeps): Promise<CloudGenerateRequest | undefined> {
  if (parsed.mode !== 'cloud' || !hasSpecHandoffArgs(parsed)) {
    return deps.cloudRequest;
  }

  const cloudSpec = await readCloudSpec(parsed, deps);

  if (deps.cloudRequest) {
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

  return buildStoredCredentialCloudRequest(parsed, deps, cloudSpec);
}

async function buildStoredCredentialCloudRequest(
  parsed: ParsedArgs,
  deps: CliMainDeps,
  cloudSpec: Awaited<ReturnType<typeof readCloudSpec>>,
): Promise<CloudGenerateRequest> {
  const auth = await readStatusCloudAuth(deps);
  const token = resolveCloudRequestToken(auth);
  if (!token) {
    throw new CloudPowerUserSetupError([
      'Cloud mode requires a connected AgentWorkforce Cloud account.',
      'Run `ricky connect cloud`, then retry the Cloud command.',
      'No local fallback was attempted.',
    ]);
  }

  const workspaceId = await resolveStatusCloudWorkspaceId(deps, auth);
  if (!workspaceId) {
    throw new CloudPowerUserSetupError([
      'Cloud workspace could not be reconciled from your Cloud credentials.',
      'Run `ricky connect cloud`, then `ricky status` so Ricky can read the current Cloud workspace automatically.',
      'No local fallback was attempted.',
    ]);
  }

  return {
    auth: { token },
    workspace: { workspaceId },
    body: {
      spec: cloudSpec.spec,
      ...(cloudSpec.specPath ? { specPath: cloudSpec.specPath } : {}),
      mode: 'cloud',
      metadata: {
        ...(parsed.workflowName ? { workflowName: parsed.workflowName } : {}),
        cli: cliMetadataFor(parsed, cloudSpec.handoff),
      },
    },
  };
}

function resolveCloudRequestToken(auth: StoredAuth | null): string | undefined {
  const token = process.env.AGENTWORKFORCE_CLOUD_TOKEN ?? process.env.RICKY_CLOUD_TOKEN ?? auth?.accessToken;
  return token?.trim() || undefined;
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

async function renderStatus(parsed: ParsedArgs, cwd: string, deps: CliMainDeps = {}): Promise<string[]> {
  if (parsed.runId) {
    return renderRunMonitorStatus(parsed.runId, cwd, parsed);
  }

  const status = await statusPayload(cwd, deps);
  if (parsed.json) {
    return [JSON.stringify(status, null, 2)];
  }
  if (parsed.quiet) {
    return [`Ricky status: local ${status.local.agentRelay}; cloud ${status.cloud.account}.`];
  }
  return renderStatusHuman(status);
}

type StatusPayload = Awaited<ReturnType<typeof statusPayload>>;

function renderStatusHuman(status: StatusPayload): string[] {
  return [
    'Ricky status',
    renderStatusPanel('Local tools', [
      `Repo:        ${status.local.repo}`,
      statusRow('agent-relay', status.local.agentRelay),
      statusRow('Codex', status.local.codex),
      statusRow('Claude', status.local.claude),
    ]),
    renderStatusPanel('AgentWorkforce Cloud', [
      statusRow('Account', status.cloud.account),
      statusRow('Workspace', status.cloud.workspace),
      statusRow('Agents', status.cloud.agents),
    ]),
    renderStatusPanel('Optional integrations', [
      statusRow('Slack', status.integrations.slack),
      statusRow('GitHub', status.integrations.github),
      statusRow('Notion', status.integrations.notion),
      statusRow('Linear', status.integrations.linear),
    ]),
    ...(status.warnings.length > 0
      ? [renderStatusPanel('Attention', status.warnings.map((warning) => statusRow('Warning', warning)))]
      : []),
    renderStatusPanel('Next', status.nextActions.map((action) => `› ${action}`)),
  ].filter((line) => line.length > 0);
}

function renderStatusPanel(title: string, rows: string[]): string {
  return [
    '',
    `╭─ ${title}`,
    ...rows.map((row) => `│ ${row}`),
    '╰─',
  ].join('\n');
}

function statusRow(label: string, value: string): string {
  return `${statusIcon(value)} ${`${label}:`.padEnd(12)} ${value}`;
}

function statusIcon(value: string): string {
  const normalized = value.toLowerCase();
  if (normalized.includes('needs attention') || normalized.includes('missing')) return '!';
  if (normalized.startsWith('connected') || normalized.startsWith('found')) return '✓';
  if (normalized.includes('missing') || normalized.includes('not connected') || normalized.includes('not selected') || normalized.includes('failed')) return '○';
  if (normalized.includes('unknown') || normalized.includes('unavailable') || normalized.includes('returned http')) return '!';
  return '•';
}

async function renderRunMonitorStatus(runId: string, cwd: string, parsed: ParsedArgs): Promise<string[]> {
  const statePath = localRunStatePath(cwd, runId);
  const candidateStatePaths = [statePath, legacyLocalRunStatePath(cwd, runId)];
  let state: LocalRunMonitorState;
  let loadedStatePath = statePath;
  try {
    state = JSON.parse(await readFile(statePath, 'utf8')) as LocalRunMonitorState;
  } catch {
    try {
      loadedStatePath = candidateStatePaths[1];
      state = JSON.parse(await readFile(loadedStatePath, 'utf8')) as LocalRunMonitorState;
    } catch {
      const missing = {
        runId,
        status: 'not-found',
        statePath,
        checkedStatePaths: candidateStatePaths,
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
  }
  state = { ...state, statePath: state.statePath ?? loadedStatePath };

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

  lines.push(...runMonitorNextLines(state));
  lines.push('', 'Refresh', `  ${state.reattachCommand}`);
  return lines;
}

function runMonitorNextLines(state: LocalRunMonitorState): string[] {
  if (state.status !== 'blocked' && state.status !== 'failed') return [];

  const lines = [
    '',
    'Next',
    '  This run has finished with persisted evidence; its status will not change.',
  ];
  const outcome = state.response?.execution?.evidence?.outcome_summary ?? '';
  const command = state.response?.execution?.execution.command ?? '';
  if (
    outcome.includes('Runtime package "agent-relay" is not installed in this workspace') ||
    command.includes('npx --no-install agent-relay run')
  ) {
    lines.push('  New runs can use agent-relay on PATH when node_modules/.bin/agent-relay is absent.');
  }
  lines.push(`  ricky run ${state.artifactPath}`);
  lines.push('  If you choose background monitoring again, use the new run id Ricky prints.');
  return lines;
}

function statusValueFromCheck(checks: LocalPreflightCheck[], id: string): string {
  const check = checks.find((entry) => entry.id === id);
  if (!check) return 'unknown';
  if (check.status === 'found') return check.path ? `found (${check.path})` : 'found';
  if (check.status === 'missing') return 'missing';
  return check.detail ?? 'unknown';
}

async function statusPayload(cwd: string, deps: Pick<CliMainDeps, 'readCloudAuth' | 'resolveCloudWorkspace' | 'checkCloudReadiness'> = {}): Promise<{
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
  const cloudAuth = await readStatusCloudAuth(deps);
  const hasCloudToken = hasStatusCloudToken(cloudAuth);
  const cloudWorkspace = await resolveStatusCloudWorkspaceId(deps, cloudAuth);
  const readiness = hasCloudToken
    ? await readStatusCloudReadiness({ deps, auth: cloudAuth, workspaceId: cloudWorkspace, warnings })
    : undefined;
  const cloudAuthRejected = warnings.some((warning) => warning.includes('Cloud auth was rejected'));

  return {
    mode: 'local',
    local: {
      repo: preflight?.repoRoot ?? cwd,
      agentRelay: statusValueFromCheck(checks, 'agent-relay'),
      codex: statusValueFromCheck(checks, 'codex'),
      claude: statusValueFromCheck(checks, 'claude'),
    },
    cloud: {
      account: hasCloudToken && !cloudAuthRejected ? 'connected' : 'not connected (Cloud login required)',
      workspace: cloudAuthRejected ? 'not selected (Cloud login required)' : cloudWorkspace || 'not selected',
      agents: hasCloudToken && !cloudAuthRejected ? formatCloudAgentsStatus(readiness) : 'not connected (Cloud login required)',
    },
    integrations: {
      slack: hasCloudToken && !cloudAuthRejected ? formatCloudCheckStatus(readiness?.integrations.slack) : 'not connected (Cloud login required)',
      github: hasCloudToken && !cloudAuthRejected ? formatCloudCheckStatus(readiness?.integrations.github) : 'not connected (Cloud login required)',
      notion: hasCloudToken && !cloudAuthRejected ? formatCloudCheckStatus(readiness?.integrations.notion) : 'not connected (Cloud login required)',
      linear: hasCloudToken && !cloudAuthRejected ? formatCloudCheckStatus(readiness?.integrations.linear) : 'not connected (Cloud login required)',
    },
    warnings,
    nextActions: [
      'ricky local --spec-file ./spec.md --no-run',
      hasCloudToken && !cloudAuthRejected ? 'ricky cloud --spec-file ./spec.md --no-run' : 'ricky connect cloud',
    ],
  };
}

async function readStatusCloudReadiness(params: {
  deps: Pick<CliMainDeps, 'checkCloudReadiness'>;
  auth: StoredAuth | null;
  workspaceId: string | undefined;
  warnings: string[];
}): Promise<CloudReadinessSnapshot | undefined> {
  if (params.deps.checkCloudReadiness) {
    try {
      return await params.deps.checkCloudReadiness();
    } catch (error) {
      params.warnings.push(`Cloud readiness API failed: ${error instanceof Error ? error.message : String(error)}`);
      return undefined;
    }
  }

  if (!params.auth || !params.workspaceId) return undefined;
  try {
    return await fetchStatusCloudReadiness(params.auth, params.workspaceId, params.warnings);
  } catch (error) {
    params.warnings.push(`Cloud readiness API failed: ${error instanceof Error ? error.message : String(error)}`);
    return undefined;
  }
}

async function fetchStatusCloudReadiness(
  auth: StoredAuth,
  workspaceId: string,
  warnings: string[],
): Promise<CloudReadinessSnapshot> {
  let agents = defaultCloudAgentReadiness();
  try {
    agents = await fetchStatusCloudAgents(auth);
  } catch (error) {
    if (isCloudStatusHttpError(error, 401)) {
      throw new Error('Cloud auth was rejected. Run `ricky connect cloud` to refresh your login.');
    }
    warnings.push(`Cloud agents API failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  const integrations = await fetchStatusCloudIntegrations(auth, workspaceId);
  return {
    account: { connected: true },
    credentials: { connected: true },
    workspace: { connected: true, label: workspaceId },
    agents,
    integrations,
  };
}

type CloudAgentApiRecord = {
  displayName?: unknown;
  harness?: unknown;
  status?: unknown;
  credentialStoredAt?: unknown;
  lastAuthenticatedAt?: unknown;
  lastError?: unknown;
};

async function fetchStatusCloudAgents(auth: StoredAuth): Promise<Record<CloudImplementationAgent, CloudAgentReadiness>> {
  const body = await fetchStatusCloudJson(auth, '/api/v1/cloud-agents');
  const records = Array.isArray((body as { agents?: unknown }).agents)
    ? (body as { agents: CloudAgentApiRecord[] }).agents
    : [];
  const result = defaultCloudAgentReadiness();
  for (const record of records) {
    const agent = cloudAgentFromHarness(typeof record.harness === 'string' ? record.harness : undefined);
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

async function fetchStatusCloudIntegrations(
  auth: StoredAuth,
  workspaceId: string,
): Promise<Record<CloudOptionalIntegration, CloudReadinessCheck>> {
  const entries = await Promise.all(CLOUD_OPTIONAL_INTEGRATIONS.map(async (integration) => {
    try {
      const body = await fetchStatusCloudJson(
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

async function fetchStatusCloudJson(auth: StoredAuth, path: string): Promise<unknown> {
  const response = await fetch(cloudApiUrl(auth.apiUrl, path), {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${auth.accessToken}`,
    },
  });
  if (!response.ok) {
    throw new CloudStatusHttpError(`${path} returned HTTP ${response.status}`, response.status);
  }
  return response.json();
}

class CloudStatusHttpError extends Error {
  constructor(message: string, readonly statusCode: number) {
    super(message);
    this.name = 'CloudStatusHttpError';
  }
}

function isCloudStatusHttpError(error: unknown, statusCode: number): error is CloudStatusHttpError {
  return error instanceof CloudStatusHttpError && error.statusCode === statusCode;
}

function cloudApiUrl(apiUrl: string, path: string): string {
  const base = apiUrl.endsWith('/') ? apiUrl : `${apiUrl}/`;
  return new URL(path.replace(/^\//, ''), base).toString();
}

function defaultCloudAgentReadiness(): Record<CloudImplementationAgent, CloudAgentReadiness> {
  return {
    claude: { connected: false, capable: false },
    codex: { connected: false, capable: false },
    opencode: { connected: false, capable: false },
    gemini: { connected: false, capable: false },
  };
}

function cloudAgentFromHarness(harness: string | undefined): CloudImplementationAgent | undefined {
  const normalized = harness?.trim().toLowerCase();
  if (!normalized) return undefined;
  if (normalized.includes('claude') || normalized.includes('anthropic')) return 'claude';
  if (normalized.includes('codex') || normalized.includes('openai')) return 'codex';
  if (normalized.includes('opencode')) return 'opencode';
  if (normalized.includes('gemini') || normalized.includes('google')) return 'gemini';
  return undefined;
}

function formatCloudAgentsStatus(readiness: CloudReadinessSnapshot | undefined): string {
  if (!readiness) return 'unknown (Cloud readiness API unavailable)';
  const connected = CLOUD_IMPLEMENTATION_AGENTS.filter((agent) => readiness.agents[agent]?.connected === true);
  const capable = connected.filter((agent) => readiness.agents[agent]?.capable === true);
  const missing = CLOUD_IMPLEMENTATION_AGENTS.filter((agent) => readiness.agents[agent]?.connected !== true);
  if (connected.length === 0) return 'not connected';
  if (missing.length === 0 && capable.length === connected.length) {
    return `connected (${connected.map(formatCloudAgentName).join(', ')})`;
  }
  const parts = [`connected: ${connected.map(formatCloudAgentName).join(', ')}`];
  if (missing.length > 0) parts.push(`missing: ${missing.map(formatCloudAgentName).join(', ')}`);
  const incapable = connected.filter((agent) => readiness.agents[agent]?.capable !== true);
  if (incapable.length > 0) parts.push(`needs attention: ${incapable.map(formatCloudAgentName).join(', ')}`);
  return parts.join('; ');
}

function formatCloudCheckStatus(check: CloudReadinessCheck | undefined): string {
  if (!check) return 'unknown (Cloud readiness API unavailable)';
  if (check.connected) return check.label ? `connected (${check.label})` : 'connected';
  if (check.label === 'unknown') return `unknown${check.recovery ? ` (${check.recovery})` : ''}`;
  return check.recovery ? `not connected (${check.recovery})` : 'not connected';
}

function formatCloudAgentName(agent: CloudImplementationAgent): string {
  if (agent === 'claude') return 'Claude';
  if (agent === 'codex') return 'Codex';
  if (agent === 'opencode') return 'OpenCode';
  return 'Gemini';
}

async function readStatusCloudAuth(deps: Pick<CliMainDeps, 'readCloudAuth'> = {}): Promise<StoredAuth | null> {
  if (deps.readCloudAuth) return deps.readCloudAuth();
  try {
    const relayCloud = await import('@agent-relay/cloud');
    return await relayCloud.readStoredAuth();
  } catch {
    return null;
  }
}

function hasStatusCloudToken(auth: StoredAuth | null): boolean {
  return Boolean(
    auth?.accessToken ||
    process.env.AGENTWORKFORCE_CLOUD_TOKEN ||
    process.env.RICKY_CLOUD_TOKEN,
  );
}

async function resolveInteractiveProviderStatus(deps: Pick<CliMainDeps, 'readCloudAuth' | 'providerStatus'>): Promise<ProviderStatus | undefined> {
  if (deps.providerStatus) return deps.providerStatus;
  const auth = await readStatusCloudAuth(deps);
  return hasStatusCloudToken(auth)
    ? { google: { connected: true }, github: { connected: false } }
    : undefined;
}

async function resolveStatusCloudWorkspaceId(
  deps: Pick<CliMainDeps, 'resolveCloudWorkspace'>,
  auth: StoredAuth | null,
): Promise<string | undefined> {
  const explicit = process.env.AGENTWORKFORCE_CLOUD_WORKSPACE ?? process.env.RICKY_CLOUD_WORKSPACE;
  if (explicit?.trim()) return explicit.trim();
  if (!auth) return undefined;
  if (deps.resolveCloudWorkspace) return deps.resolveCloudWorkspace(auth);
  return readStatusCloudWorkspaceFromProfile(auth);
}

async function readStatusCloudWorkspaceFromProfile(auth: StoredAuth): Promise<string | undefined> {
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
      // Try the next known Cloud profile endpoint.
    }
  }
  return undefined;
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
      output: await renderStatus(parsed, resolveInvocationRoot(deps.cwd), deps),
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
    if (error instanceof CloudPowerUserSetupError) {
      const summary = cloudPowerUserWorkflowSummary(undefined, {
        mode: 'cloud',
        workflowName: parsed.workflowName,
        runRequested: parsed.runRequested,
        yes: parsed.yes,
        quiet: parsed.quiet,
        guidance: error.guidance,
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
    providerStatus: deps.providerStatus ?? await resolveInteractiveProviderStatus(deps),
    ...(parsed.mode ? { mode: parsed.mode } : cliHandoff ? { mode: 'local' } : {}),
    ...(cliHandoff ? { handoff: cliHandoff } : {}),
    ...(cloudRequest ? { cloudRequest } : {}),
    ...cloudRecoveryDeps,
    preferWorkforcePersonaWorkflowWriter:
      deps.preferWorkforcePersonaWorkflowWriter ??
      resolvePreferWorkforcePersonaWorkflowWriter({ workforcePersonaWriterCli: parsed.workforcePersonaWriterCli }),
  };

  const interactiveResult = await runner(interactiveDeps);
  const output: string[] = [];

  if (interactiveResult.onboarding.mode === 'status') {
    output.push(...await renderStatus({ command: 'status' }, resolveInvocationRoot(deps.cwd), deps));
  } else if (interactiveResult.localWorkflowResult) {
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
  if (result.generation?.generation) {
    lines.push(`Author: ${localGenerationAuthor(result.generation.generation)}`);
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
    'Run commands',
    `  ${result.command}`,
    `  ${result.command} --background`,
    '  ricky status --run <run-id>',
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
      lines.push('Execution: success — artifact ran through the Relay SDK workflow runner.');
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
    lines.push(`  Author: ${localGenerationAuthor(localResult.generation)}`);
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
      lines.push(`  To run in background: ${localResult.generation.next.run_command} --background`);
      lines.push('  Then check progress: ricky status --run <run-id>');
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
    if (localResult.auto_fix.escalation) {
      lines.push('Ricky reviewed the logs and could not choose one safe fix.');
      lines.push(`  ${localResult.auto_fix.escalation.summary}`);
      if (localResult.auto_fix.escalation.log_tail.length > 0) {
        lines.push('Relevant logs:');
        for (const tailLine of localResult.auto_fix.escalation.log_tail) {
          lines.push(`  ${tailLine}`);
        }
      }
      lines.push('Options:');
      localResult.auto_fix.escalation.options.forEach((option, index) => {
        lines.push(`  ${index + 1}. ${option.label}: ${option.description}`);
        if (option.command) lines.push(`     ${option.command}`);
      });
    }
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

function localGenerationAuthor(generation: NonNullable<InteractiveCliResult['localResult']>['generation']): string {
  const persona = generation?.decisions?.workforce_persona;
  if (!persona || typeof persona !== 'object') return 'deterministic generator';
  const record = persona as { personaId?: unknown; tier?: unknown; harness?: unknown; model?: unknown };
  const personaId = typeof record.personaId === 'string' && record.personaId.trim()
    ? record.personaId.trim()
    : 'Workforce persona';
  const tier = typeof record.tier === 'string' && record.tier.trim() ? `@${record.tier.trim()}` : '';
  const model = typeof record.model === 'string' && record.model.trim() ? ` (${record.model.trim()})` : '';
  const harness = typeof record.harness === 'string' && record.harness.trim() ? ` via ${record.harness.trim()}` : '';
  return `${personaId}${tier}${model}${harness}`;
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
