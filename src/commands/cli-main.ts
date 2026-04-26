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
import { isRickyMode } from '../cli/mode-selector.js';
import { runInteractiveCli } from '../entrypoint/interactive-cli.js';

// ---------------------------------------------------------------------------
// Parsed CLI arguments
// ---------------------------------------------------------------------------

export interface ParsedArgs {
  command: 'run' | 'help' | 'version';
  mode?: RickyMode;
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

  return { command: 'run', mode };
}

// ---------------------------------------------------------------------------
// Help text
// ---------------------------------------------------------------------------

export function renderHelp(): string[] {
  return [
    'ricky — workflow reliability, coordination, and authoring',
    '',
    'Usage:',
    '  ricky                    Start interactive session (default)',
    '  ricky --mode <mode>      Start with mode preset: local | cloud | both',
    '  ricky help               Show this help text',
    '  ricky version            Show version',
    '',
    'Options:',
    '  --mode <mode>   Override execution mode (local, cloud, both)',
    '  --help, -h      Show help',
    '  --version, -v   Show version',
    '',
    'Examples:',
    '  npm start',
    '  npm start -- --mode local',
    '  npm start -- help',
  ];
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

  // Default: run interactive session
  const runner = deps.runInteractive ?? runInteractiveCli;
  const interactiveDeps: InteractiveCliDeps = {
    ...deps,
    ...(parsed.mode ? { mode: parsed.mode } : {}),
  };

  const interactiveResult = await runner(interactiveDeps);
  const output: string[] = [];

  if (interactiveResult.guidance.length > 0) {
    output.push(...interactiveResult.guidance);
  }

  return {
    exitCode: interactiveResult.ok ? 0 : 1,
    output,
    interactiveResult,
  };
}
