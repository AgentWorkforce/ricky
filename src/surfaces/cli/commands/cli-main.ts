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
import type { RickyMode } from '../cli/mode-selector.js';
import type { RawHandoff } from '../../../local/request-normalizer.js';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isRickyMode } from '../cli/mode-selector.js';
import { runInteractiveCli } from '../entrypoint/interactive-cli.js';

// ---------------------------------------------------------------------------
// Parsed CLI arguments
// ---------------------------------------------------------------------------

export interface ParsedArgs {
  command: 'run' | 'help' | 'version';
  mode?: RickyMode;
  spec?: string;
  specFile?: string;
  artifact?: string;
  stdin?: boolean;
  runRequested?: boolean;
  json?: boolean;
  autoFix?: number;
  refine?: false | { model?: string };
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
}

let cachedPackageVersion: string | undefined;

// ---------------------------------------------------------------------------
// Argument parsing — deterministic, no external deps
// ---------------------------------------------------------------------------

export function parseArgs(argv: string[]): ParsedArgs {
  const first = argv[0]?.trim().toLowerCase();

  if (first === '--help' || first === '-h' || first === 'help') {
    return { command: 'help' };
  }

  if (first === '--version' || first === '-v' || first === 'version') {
    return { command: 'version' };
  }

  // Check for --mode flag anywhere in argv
  const modeIdx = argv.indexOf('--mode');
  let mode: RickyMode | undefined;
  if (modeIdx !== -1 && argv[modeIdx + 1]) {
    const candidate = argv[modeIdx + 1];
    if (isRickyMode(candidate)) {
      mode = candidate;
    }
  }

  const spec = readFlagValue(argv, '--spec');
  const specFile = readFlagValue(argv, '--spec-file') ?? readFlagValue(argv, '--file');
  const artifact = readFlagValue(argv, '--artifact') ?? readRunArtifactPositional(argv);
  const stdin = argv.includes('--stdin');
  const runRequested = argv.includes('--run') || argv.includes('--generate-and-run') || artifact !== undefined;
  const json = argv.includes('--json');
  const autoFix = parseAutoFix(argv);
  const refine = parseRefine(argv);

  const errors: string[] = [];
  for (const flag of ['--spec', '--spec-file', '--file', '--artifact']) {
    if (argv.includes(flag) && readFlagValue(argv, flag) === undefined) {
      errors.push(`${flag} requires a value.`);
    }
  }
  if (artifact && (spec !== undefined || specFile !== undefined || stdin)) {
    errors.push('Artifact execution cannot be combined with --spec, --spec-file, --file, or --stdin.');
  }

  const parsed: ParsedArgs = { command: 'run' };
  if (mode) parsed.mode = mode;
  if (spec !== undefined) parsed.spec = spec;
  if (specFile !== undefined) parsed.specFile = specFile;
  if (artifact !== undefined) parsed.artifact = artifact;
  if (stdin) parsed.stdin = true;
  if (runRequested) parsed.runRequested = true;
  if (json) parsed.json = true;
  if (autoFix !== undefined && autoFix > 0) parsed.autoFix = autoFix;
  if (refine) parsed.refine = refine;
  if (errors.length > 0) parsed.errors = errors;
  return parsed;
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
    '  --artifact <path>   Execute an existing artifact (implies --run)',
    '  --run               Execute the generated artifact after generation',
    '  --refine[=model]    Refine generated task text and gates with an LLM pass (default on)',
    '  --no-refine         Disable refinement; emit only the deterministic artifact',
    '  --with-llm[=model]  Alias for --refine',
    '  --auto-fix[=N]      Local diagnose/repair/resume loop (default 3 attempts, max 10)',
    '  --no-auto-fix       Disable the repair loop; first failure surfaces immediately',
    '  --repair[=N]        Alias for --auto-fix',
    '  --json              Print results as JSON',
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
    throw new Error('Cloud mode does not accept CLI spec handoff in this local slice. Use --mode local or --mode both.');
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
      metadata: { handoff: 'artifact' },
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
      cliMetadata: { handoff: 'inline-spec' },
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
      cliMetadata: { handoff: 'spec-file' },
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
      cliMetadata: { handoff: 'stdin' },
    };
  }

  return undefined;
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
  const interactiveDeps: InteractiveCliDeps = {
    ...deps,
    cwd: resolveInvocationRoot(deps.cwd),
    ...(parsed.mode ? { mode: parsed.mode } : cliHandoff ? { mode: 'local' } : {}),
    ...(cliHandoff ? { handoff: cliHandoff } : {}),
  };

  const interactiveResult = await runner(interactiveDeps);
  const output: string[] = [];

  if (cliHandoff && interactiveResult.localResult) {
    if (parsed.json) {
      output.push(renderLocalJson(interactiveResult.localResult));
    } else {
      output.push(...renderLocalHuman(interactiveResult.localResult));
      if (!interactiveResult.localResult.generation && interactiveResult.guidance.length > 0) {
        output.push(...interactiveResult.guidance);
      }
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
