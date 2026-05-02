import type { RickyMode } from '../cli/mode-selector.js';
import { isRickyMode } from '../cli/mode-selector.js';
import { DEFAULT_AUTO_FIX_ATTEMPTS } from '../../../shared/constants.js';

export type PowerUserCommand = 'run' | 'help' | 'version' | 'status' | 'connect';
export type PowerUserSurface = 'legacy' | 'local' | 'cloud' | 'status' | 'connect';
export type ConnectTarget = 'cloud' | 'agents' | 'integrations';

const DEFAULT_CLOUD_AGENT_TARGETS = ['claude', 'codex', 'opencode', 'gemini'];
const DEFAULT_CLOUD_INTEGRATION_TARGETS = ['slack', 'github', 'notion', 'linear'];

export interface PowerUserParsedArgs {
  command: PowerUserCommand;
  surface: PowerUserSurface;
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
  /** Set only when the CLI passes --workforce-persona/--no-workforce-persona; omitted otherwise. */
  workforcePersonaWriterCli?: boolean;
  errors?: string[];
}

export function parsePowerUserArgs(argv: string[]): PowerUserParsedArgs {
  const first = argv[0]?.trim().toLowerCase();

  if (first === '--help' || first === '-h' || first === 'help') {
    return { command: 'help', surface: 'legacy' };
  }

  if (first === '--version' || first === '-v' || first === 'version') {
    return { command: 'version', surface: 'legacy' };
  }

  if (first === 'status') {
    const statusArgv = argv.slice(1);
    const parsed = withCommonFlags({ command: 'status', surface: 'status' }, statusArgv);
    const runId = readFlagValue(statusArgv, '--run');
    return {
      ...parsed,
      ...(runId ? { runId } : {}),
      ...(statusArgv.includes('--run') && !runId ? { errors: [...(parsed.errors ?? []), '--run requires a value.'] } : {}),
    };
  }

  if (first === 'connect') {
    return parseConnect(argv.slice(1));
  }

  const surface = first === 'local' || first === 'cloud' ? first : 'legacy';
  const effectiveArgv = surface === 'legacy' ? argv : argv.slice(1);
  const explicitMode = readMode(effectiveArgv);
  const mode = surface === 'local' || surface === 'cloud'
    ? surface
    : explicitMode;

  const parsed = withCommonFlags(
    {
      command: 'run',
      surface,
      ...(mode ? { mode } : {}),
    },
    effectiveArgv,
  );

  const spec = readFlagValue(effectiveArgv, '--spec');
  const specFile = readFlagValue(effectiveArgv, '--spec-file') ?? readFlagValue(effectiveArgv, '--file');
  const artifact = readFlagValue(effectiveArgv, '--workflow')
    ?? readFlagValue(effectiveArgv, '--artifact')
    ?? readRunArtifactPositional(argv);
  const workflowName = readFlagValue(effectiveArgv, '--name');
  const stdin = effectiveArgv.includes('--stdin');
  const noRun = effectiveArgv.includes('--no-run');
  const runRequested = (
    effectiveArgv.includes('--run') ||
    effectiveArgv.includes('--generate-and-run') ||
    (surface === 'legacy' && artifact !== undefined)
  ) && !noRun;
  const startFromStep = readFlagValue(effectiveArgv, '--start-from');
  const previousRunId = readFlagValue(effectiveArgv, '--previous-run-id') ?? readFlagValue(effectiveArgv, '--resume-from-run');
  const autoFix = parseAutoFix(effectiveArgv);
  const refine = parseRefine(effectiveArgv);
  const login = effectiveArgv.includes('--login');
  const connectMissing = effectiveArgv.includes('--connect-missing');
  const workforcePersonaWriterCli = parseWorkforcePersonaWriterCliFlag(effectiveArgv);

  const errors: string[] = [...(parsed.errors ?? [])];
  if (effectiveArgv.includes('--workforce-persona') && effectiveArgv.includes('--no-workforce-persona')) {
    errors.push('--workforce-persona and --no-workforce-persona cannot be combined.');
  }
  for (const flag of ['--spec', '--spec-file', '--file', '--artifact', '--workflow', '--name', '--start-from', '--previous-run-id', '--resume-from-run']) {
    if (effectiveArgv.includes(flag) && readFlagValue(effectiveArgv, flag) === undefined) {
      errors.push(`${flag} requires a value.`);
    }
  }
  if (artifact && (spec !== undefined || specFile !== undefined || stdin)) {
    errors.push('Artifact execution cannot be combined with --spec, --spec-file, --file, or --stdin.');
  }
  if (effectiveArgv.includes('--run') && noRun) {
    errors.push('--run and --no-run cannot be combined.');
  }
  if (parsed.background && parsed.foreground) {
    errors.push('--background and --foreground cannot be combined.');
  }

  return {
    ...parsed,
    ...(spec !== undefined ? { spec } : {}),
    ...(specFile !== undefined ? { specFile } : {}),
    ...(artifact !== undefined ? { artifact } : {}),
    ...(workflowName !== undefined ? { workflowName } : {}),
    ...(stdin ? { stdin: true } : {}),
    ...(runRequested ? { runRequested: true } : {}),
    ...(noRun ? { noRun: true } : {}),
    ...(startFromStep !== undefined ? { startFromStep } : {}),
    ...(previousRunId !== undefined ? { previousRunId } : {}),
    ...(autoFix !== undefined && autoFix > 0 ? { autoFix } : {}),
    ...(refine ? { refine } : {}),
    ...(login ? { login: true } : {}),
    ...(connectMissing ? { connectMissing: true } : {}),
    ...(workforcePersonaWriterCli !== undefined ? { workforcePersonaWriterCli } : {}),
    ...(errors.length > 0 ? { errors } : {}),
  };
}

function parseConnect(argv: string[]): PowerUserParsedArgs {
  const target = argv[0]?.trim().toLowerCase();
  const base = withCommonFlags({ command: 'connect', surface: 'connect' }, argv.slice(target ? 1 : 0));
  const errors: string[] = [...(base.errors ?? [])];

  if (target !== 'cloud' && target !== 'agents' && target !== 'integrations') {
    errors.push('connect requires one of: cloud, agents, integrations.');
    return { ...base, ...(errors.length > 0 ? { errors } : {}) };
  }

  const hasCloudFlag = hasFlag(argv, '--cloud');
  const cloudValue = readOptionalFlagValue(argv, '--cloud');
  const cloudTargets = resolveCloudTargets(target, hasCloudFlag, cloudValue);

  return {
    ...base,
    connectTarget: target,
    ...(cloudTargets && cloudTargets.length > 0 ? { cloudTargets } : {}),
    ...(errors.length > 0 ? { errors } : {}),
  };
}

function resolveCloudTargets(
  target: ConnectTarget,
  hasCloudFlag: boolean,
  cloudValue: string | undefined,
): string[] | undefined {
  if (cloudValue) return cloudValue.split(',').map((value) => value.trim()).filter(Boolean);
  if (!hasCloudFlag) return undefined;
  if (target === 'agents') return DEFAULT_CLOUD_AGENT_TARGETS;
  if (target === 'integrations') return DEFAULT_CLOUD_INTEGRATION_TARGETS;
  return undefined;
}

function withCommonFlags<T extends Omit<PowerUserParsedArgs, 'json' | 'quiet' | 'verbose' | 'yes' | 'background' | 'foreground'>>(
  parsed: T,
  argv: string[],
): T & Pick<PowerUserParsedArgs, 'json' | 'quiet' | 'verbose' | 'yes' | 'background' | 'foreground' | 'errors'> {
  const errors: string[] = [];
  return {
    ...parsed,
    ...(argv.includes('--json') ? { json: true } : {}),
    ...(argv.includes('--quiet') ? { quiet: true } : {}),
    ...(argv.includes('--verbose') ? { verbose: true } : {}),
    ...(argv.includes('--yes') ? { yes: true } : {}),
    ...(argv.includes('--background') ? { background: true } : {}),
    ...(argv.includes('--foreground') ? { foreground: true } : {}),
    ...(errors.length > 0 ? { errors } : {}),
  };
}

function readMode(argv: string[]): RickyMode | undefined {
  const modeIdx = argv.indexOf('--mode');
  if (modeIdx === -1) return undefined;
  const candidate = argv[modeIdx + 1];
  return candidate && isRickyMode(candidate) ? candidate : undefined;
}

function parseRefine(argv: string[]): undefined | false | { model?: string } {
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
  return undefined;
}

function parseWorkforcePersonaWriterCliFlag(argv: string[]): boolean | undefined {
  if (argv.includes('--no-workforce-persona')) return false;
  if (argv.includes('--workforce-persona')) return true;
  return undefined;
}

function parseAutoFix(argv: string[]): number | undefined {
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

    if (rawValue === undefined || rawValue === '') return DEFAULT_AUTO_FIX_ATTEMPTS;
    const parsed = Number.parseInt(rawValue, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
    return Math.min(10, Math.max(1, parsed));
  }
  return DEFAULT_AUTO_FIX_ATTEMPTS;
}

function readFlagValue(argv: string[], flag: string): string | undefined {
  const index = argv.indexOf(flag);
  if (index === -1) return undefined;

  const value = argv[index + 1];
  if (!value || value.startsWith('--')) return undefined;
  return value;
}

function readOptionalFlagValue(argv: string[], flag: string): string | undefined {
  const inline = argv.find((arg) => arg.startsWith(`${flag}=`));
  if (inline) {
    const value = inline.slice(flag.length + 1).trim();
    return value || undefined;
  }
  const index = argv.indexOf(flag);
  if (index === -1) return undefined;
  const value = argv[index + 1];
  return value && !value.startsWith('--') ? value : undefined;
}

function hasFlag(argv: string[], flag: string): boolean {
  return argv.includes(flag) || argv.some((arg) => arg.startsWith(`${flag}=`));
}

function readRunArtifactPositional(argv: string[]): string | undefined {
  if (argv[0] !== 'run') return undefined;
  for (let index = 1; index < argv.length; index += 1) {
    const candidate = argv[index];
    const previous = argv[index - 1];
    if (!candidate || candidate.startsWith('--')) continue;
    if (isValueForRunOption(previous, candidate)) continue;
    if (candidate === 'help' || candidate === 'version') continue;
    return candidate;
  }
  return undefined;
}

function isValueForRunOption(previous: string | undefined, candidate: string): boolean {
  if (!previous) return false;
  if ((previous === '--auto-fix' || previous === '--repair') && isAutoFixValue(candidate)) return true;
  return previous === '--start-from' || previous === '--previous-run-id' || previous === '--resume-from-run';
}

function isAutoFixValue(value: string): boolean {
  return /^-?\d+$/.test(value);
}
