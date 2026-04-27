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
import type { RawHandoff } from '@ricky/local/request-normalizer.js';
import { readFile } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
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
}

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
  if (errors.length > 0) parsed.errors = errors;
  return parsed;
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
  const candidate = argv[1];
  if (!candidate || candidate.startsWith('--')) return undefined;
  return candidate;
}

// ---------------------------------------------------------------------------
// Help text
// ---------------------------------------------------------------------------

export function renderHelp(): string[] {
  return [
    'ricky CLI — workflow reliability, coordination, and authoring',
    '',
    'Two distinct stages — generation runs by default, execution is opt-in:',
    '  generate  Ricky writes a workflow artifact into workflows/generated/ in your repo.',
    '  execute   Ricky launches the artifact through local agent-relay (only with --run',
    '            or `ricky run <artifact>`).',
    '',
    'Usage:',
    '  npm start --                         Start interactive session (default)',
    '  npm start -- --mode <mode>           Start with mode preset: local | cloud | both',
    '  npm start -- --mode local --spec <text>            Generate a workflow artifact only',
    '  npm start -- --mode local --spec <text> --run      Generate, then execute through agent-relay',
    '  ricky run <artifact>                               Execute an already-generated artifact',
    '  npm start -- --mode local --spec-file <path>',
    '  npm start -- --mode local --stdin    Read spec text from stdin',
    '  npm start -- help                    Show this help text',
    '  npm start -- version                 Show version',
    '',
    'Options:',
    '  --mode <mode>       Override execution mode (local, cloud, both)',
    '  --spec <text>       Hand inline spec text to the local/BYOH path',
    '  --spec-file <path>  Read spec text from a file and hand it to the local/BYOH path',
    '  --artifact <path>   Execute an existing local workflow artifact',
    '  --run               Continue from generated artifact into local runtime execution',
    '  --json              Print stage results as JSON',
    '  --stdin             Read spec text from stdin and hand it to the local/BYOH path',
    '  --help, -h          Show help',
    '  --version, -v       Show version',
    '',
    'Notes:',
    '  - Without --run, Ricky returns the generated artifact path and stops. The next',
    '    command Ricky prints is the exact `npx --no-install agent-relay run ...` to launch it.',
    '  - With --run, execution failures surface as classified blockers (MISSING_BINARY,',
    '    MISSING_ENV_VAR, INVALID_ARTIFACT, CREDENTIALS_REJECTED, WORKDIR_DIRTY,',
    '    NETWORK_UNREACHABLE, UNSUPPORTED_RUNTIME) with concrete recovery steps and exit code 2.',
    '  - Cloud mode generates through AgentWorkforce Cloud; this CLI slice does not stream',
    '    Cloud execution evidence.',
    '',
    'Examples:',
    '  npm start -- --mode local',
    '  npm start -- --mode local --spec "generate a workflow for package checks"',
    '  npm start -- --mode local --spec "generate a workflow for package checks" --run',
    '  printf "%s\\n" "run workflows/release.workflow.ts" | npm start -- --mode local --stdin',
    '  ricky run workflows/generated/package-checks.ts',
    '  npm start -- help',
  ];
}

function renderCliArgumentRecovery(errors: string[]): string[] {
  return [
    'CLI input blocker:',
    ...errors.map((error) => `  - ${error}`),
    '',
    'Recovery:',
    '  Use `npm start -- --help` for the currently implemented flags.',
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
      artifactPath: resolveSpecFilePath(parsed.artifact, invocationRoot),
      invocationRoot,
      mode: handoffMode,
      stageMode: 'run',
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
    const version = deps.version ?? '0.0.0';
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
  return JSON.stringify(stages.length > 0 ? stages : localResult, null, 2);
}

function renderLocalHuman(localResult: NonNullable<InteractiveCliResult['localResult']>): string[] {
  const lines: string[] = [];
  if (localResult.ok) {
    lines.push('Local handoff completed.');
    if (localResult.execution?.status === 'success') {
      lines.push('  Generation: ok. Execution: success.');
    } else if (localResult.generation) {
      lines.push('  Generation: ok. Execution: not requested (pass --run or use `ricky run <artifact>` to execute).');
    } else {
      lines.push('  Artifact returned. Execution was not attempted in this slice.');
    }
  } else {
    lines.push('Local handoff failed.');
    if (localResult.execution) {
      lines.push(`  Stage that failed: execute (status: ${localResult.execution.status}).`);
    } else if (localResult.generation) {
      lines.push(`  Stage that failed: generate (status: ${localResult.generation.status}).`);
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
      lines.push(`  Next: Run the generated workflow locally: ${localResult.generation.next.run_command}`);
      lines.push(`  Run mode: ${localResult.generation.next.run_mode_hint}`);
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
