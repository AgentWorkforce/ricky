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
 * - The bin/start script surface is truthful: private package, no published CLI.
 */

import type { InteractiveCliDeps, InteractiveCliResult } from '../entrypoint/interactive-cli.js';
import type { RickyMode } from '../cli/mode-selector.js';
import type { RawHandoff } from '@ricky/local/request-normalizer.js';
import { readFile } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
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
  stdin?: boolean;
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
  const stdin = argv.includes('--stdin');

  const errors: string[] = [];
  for (const flag of ['--spec', '--spec-file', '--file']) {
    if (argv.includes(flag) && readFlagValue(argv, flag) === undefined) {
      errors.push(`${flag} requires a value.`);
    }
  }

  const parsed: ParsedArgs = { command: 'run' };
  if (mode) parsed.mode = mode;
  if (spec !== undefined) parsed.spec = spec;
  if (specFile !== undefined) parsed.specFile = specFile;
  if (stdin) parsed.stdin = true;
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

// ---------------------------------------------------------------------------
// Help text
// ---------------------------------------------------------------------------

export function renderHelp(): string[] {
  return [
    'ricky CLI — workflow reliability, coordination, and authoring',
    '',
    'Usage:',
    '  npm start --                         Start interactive session (default)',
    '  npm start -- --mode <mode>           Start with mode preset: local | cloud | both',
    '  npm start -- --mode local --spec <text>',
    '  npm start -- --mode local --spec-file <path>',
    '  npm start -- --mode local --stdin    Read spec text from stdin',
    '  npm start -- help                    Show this help text',
    '  npm start -- version                 Show version',
    '',
    'Options:',
    '  --mode <mode>       Override execution mode (local, cloud, both)',
    '  --spec <text>       Hand inline spec text to the local/BYOH path',
    '  --spec-file <path>  Read spec text from a file and hand it to the local/BYOH path',
    '  --stdin             Read spec text from stdin and hand it to the local/BYOH path',
    '  --help, -h          Show help',
    '  --version, -v       Show version',
    '',
    'Examples:',
    '  npm start -- --mode local',
    '  npm start -- --mode local --spec "generate a workflow for package checks"',
    '  printf "%s\\n" "run workflows/release.workflow.ts" | npm start -- --mode local --stdin',
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
  return parsed.spec !== undefined || parsed.specFile !== undefined || parsed.stdin === true;
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
      cliMetadata: { handoff: 'stdin' },
    };
  }

  return undefined;
}

function resolveInvocationRoot(explicitCwd?: string): string {
  const processCwd = process.cwd();
  if (process.env.INIT_CWD && (!explicitCwd || explicitCwd === processCwd)) {
    return process.env.INIT_CWD;
  }
  return explicitCwd ?? processCwd;
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

  if (interactiveResult.guidance.length > 0) {
    output.push(...interactiveResult.guidance);
  }

  if (cliHandoff && interactiveResult.guidance.length === 0 && interactiveResult.localResult) {
    output.push(interactiveResult.localResult.ok ? 'Local handoff completed.' : 'Local handoff failed.');
    for (const artifact of interactiveResult.localResult.artifacts) {
      output.push(`  Artifact: ${artifact.path}`);
    }
    for (const action of interactiveResult.localResult.nextActions) {
      output.push(`  Next: ${action}`);
    }
  }

  return {
    exitCode: interactiveResult.ok ? 0 : 1,
    output,
    interactiveResult,
  };
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
