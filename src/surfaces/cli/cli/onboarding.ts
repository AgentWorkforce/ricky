import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline/promises';

import { chooseBannerVariant, renderBanner, shouldShowBanner, shouldUseColor } from './ascii-art.js';
import {
  DEFAULT_PROVIDER_STATUS,
  isRickyMode,
  parseModeChoice,
  renderCompactHeader,
  renderModeResult,
  renderModeSelection,
  renderModeSelector,
  toRickyMode,
  type OnboardingChoice,
  type ProviderStatus,
  type RickyConfig,
  type RickyMode,
} from './mode-selector.js';
import { renderWelcome } from './welcome.js';
import {
  createInquirerPromptShell,
  isPromptCancellation,
  type PromptShell,
} from '../prompts/index.js';

export interface OnboardingContext {
  isFirstRun?: boolean;
  isTTY?: boolean;
  quiet?: boolean;
  noBanner?: boolean;
  forceOnboarding?: boolean;
  columns?: number;
  blockedReason?: string | null;
  mode?: RickyMode;
  choice?: OnboardingChoice;
  providerStatus?: ProviderStatus;
  env?: { RICKY_BANNER?: string; NO_COLOR?: string };
}

export interface RickyConfigStore {
  readProjectConfig(): Promise<RickyConfig | null>;
  readGlobalConfig(): Promise<RickyConfig | null>;
  writeProjectConfig(config: RickyConfig): Promise<void>;
}

export interface OnboardingOptions {
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
  isTTY?: boolean;
  quiet?: boolean;
  verbose?: boolean;
  noBanner?: boolean;
  mode?: RickyMode;
  showBanner?: boolean;
  columns?: number;
  env?: NodeJS.ProcessEnv;
  configStore?: RickyConfigStore;
  providerStatus?: ProviderStatus;
  promptShell?: PromptShell;
  signal?: AbortSignal;
  firstRun?: boolean;
  skipFirstRunPersistence?: boolean;
  compactForExecution?: boolean;
}

export interface OnboardingResult {
  mode: OnboardingChoice;
  firstRun: boolean;
  bannerShown: boolean;
  output: string;
}

const DEFAULT_CONFIG: RickyConfig = {
  mode: 'local',
  firstRunComplete: false,
  providers: DEFAULT_PROVIDER_STATUS,
};

class FileConfigStore implements RickyConfigStore {
  private readonly projectPath = join(process.cwd(), '.ricky', 'config.json');
  private readonly globalPath = join(homedir(), '.config', 'ricky', 'config.json');

  async readProjectConfig(): Promise<RickyConfig | null> {
    return readConfigFile(this.projectPath);
  }

  async readGlobalConfig(): Promise<RickyConfig | null> {
    return readConfigFile(this.globalPath);
  }

  async writeProjectConfig(config: RickyConfig): Promise<void> {
    await mkdir(dirname(this.projectPath), { recursive: true });
    await writeFile(this.projectPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  }
}

async function readConfigFile(path: string): Promise<RickyConfig | null> {
  try {
    const raw = await readFile(path, 'utf8');
    return normalizeConfig(JSON.parse(raw));
  } catch {
    return null;
  }
}

function normalizeConfig(value: unknown): RickyConfig | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const candidate = value as Partial<RickyConfig>;
  if (!isRickyMode(candidate.mode)) {
    return null;
  }

  return {
    mode: candidate.mode,
    firstRunComplete: candidate.firstRunComplete === true,
    providers: {
      google: { connected: candidate.providers?.google?.connected === true },
      github: { connected: candidate.providers?.github?.connected === true },
    },
  };
}

function resolveModeOverride(options: OnboardingOptions): RickyMode | null {
  if (options.mode) {
    return options.mode;
  }

  const envMode = options.env?.RICKY_MODE ?? process.env.RICKY_MODE;
  return isRickyMode(envMode) ? envMode : null;
}

function writeOutput(output: NodeJS.WritableStream | undefined, text: string): void {
  output?.write(text);
}

function streamIsTTY(input: NodeJS.ReadableStream): boolean {
  return (input as NodeJS.ReadableStream & { isTTY?: boolean }).isTTY === true;
}

function shouldUsePromptShell(
  options: OnboardingOptions,
  input: NodeJS.ReadableStream,
  output: NodeJS.WritableStream,
): boolean {
  if (options.promptShell) return true;
  return options.input === undefined && options.output === undefined && input === process.stdin && output === process.stdout;
}

export function renderCloudGuidance(): string {
  return [
    'Cloud provider guidance:',
    '  Cloud mode generates workflow artifacts through AgentWorkforce Cloud.',
    '  This CLI does not stream Cloud execution results — it returns the',
    '  generated artifact and any follow-up actions the Cloud endpoint suggests.',
    '',
    '  Connect Google for Cloud generation:',
    '  $ npx agent-relay cloud connect google',
    '',
    '  Connect GitHub for repo-connected workflows:',
    '  Open your AgentWorkforce Cloud settings -> Integrations -> GitHub',
    '  The GitHub app is installed through the Cloud dashboard.',
  ].join('\n');
}

export function renderHandoffGuidance(): string {
  return [
    'Spec handoff:',
    '  Give Ricky a spec. Ricky generates a workflow artifact and writes it to disk.',
    '  Generation does not execute anything — it returns the artifact path.',
    '  Add --run to also execute the generated artifact through @agent-relay/sdk/workflows.',
    '',
    '  Direct CLI handoff:',
    '',
    '  Generate only (default):',
    '  $ ricky --mode local --spec "generate a workflow for package checks"',
    '',
    '  Generate + execute:',
    '  $ ricky --mode local --spec "generate a workflow for package checks" --run',
    '',
    '  From file:',
    '  $ ricky --mode local --spec-file ./path/to/spec.md',
    '',
    '  From stdin:',
    '  $ printf "%s\\n" "run workflows/release.workflow.ts" | ricky --mode local --stdin',
    '',
    '  Run an existing artifact:',
    '  $ ricky run workflows/generated/<file>.ts',
    '',
    '  MCP handoff:',
    '  Use `ricky.generate` with the same spec payload; Ricky normalizes it like CLI input.',
  ].join('\n');
}

export function renderInterruptedSetupRecovery(): string {
  return [
    '  It looks like setup was interrupted.',
    '  Rerun `ricky`, or use `ricky --mode local` to skip mode selection.',
  ].join('\n');
}

export function renderNonInteractiveSetupError(): string {
  return [
    '  Error: Ricky has not been configured yet.',
    '',
    '  Run `ricky` interactively to complete first-run setup,',
    '  or set RICKY_MODE=local to skip setup and use local mode.',
  ].join('\n');
}

export function renderRecoveryGuidance(blockedReason?: string | null): string {
  if (!blockedReason) {
    return [
      'Recovery:',
      '  Setup interrupted?',
      '    Rerun: ricky',
      '    Or skip to local: ricky --mode local',
      '',
      '  Generation failed (no artifact was written)?',
      '    Rephrase the spec and retry:',
      '    $ ricky --mode local --spec "<rephrased spec>"',
      '    $ ricky --mode local --spec-file ./path/to/spec.md',
      '    $ printf "%s\\n" "<rephrased spec>" | ricky --mode local --stdin',
      '',
      '  Execution failed (artifact was generated but --run failed)?',
      '    Ricky prints a blocker code (e.g. MISSING_BINARY, MISSING_ENV_VAR)',
      '    with shell-ready recovery steps. Run those steps, then retry with --run.',
      '',
      '  Cloud blocked?',
      '    Continue locally: ricky --mode local',
    ].join('\n');
  }

  return [
    'Recovery:',
    `  Blocked: ${blockedReason}`,
    '  Fix the issue above, then retry the same command.',
    '  If Ricky printed a blocker code (e.g. MISSING_BINARY, MISSING_ENV_VAR),',
    '  run the shell commands it listed, then retry.',
    '  To skip Cloud and continue locally: ricky --mode local',
  ].join('\n');
}

export function renderProviderConnectFailureRecovery(provider = 'google'): string {
  if (provider !== 'google') {
    return renderRecoveryGuidance('provider connection failed');
  }

  return [
    '  Google connect failed. Common causes:',
    '  - Network connectivity issue',
    '  - Browser did not complete OAuth flow',
    '  - Expired or revoked credentials',
    '',
    '  Try again: npx agent-relay cloud connect google',
    '  Or continue in local mode: ricky --mode local',
  ].join('\n');
}

export function renderWorkflowGenerationFailureRecovery(): string {
  return [
    '  Generation failed — no workflow artifact was written to disk.',
    '  Nothing was executed.',
    '',
    '  Next steps:',
    '  - If using Cloud: check provider connection, then retry Cloud mode.',
    '  - If the spec was ambiguous: rephrase it (state the trigger, action, and target).',
    '  - To retry locally: ricky --mode local --spec "<clarified spec>"',
    '  - To use a file: ricky --mode local --spec-file ./path/to/spec.md',
    '  - To pipe stdin: printf "%s\\n" "<clarified spec>" | ricky --mode local --stdin',
  ].join('\n');
}

export function renderSuggestedNextAction(mode: RickyMode): string {
  if (mode === 'cloud') {
    return 'Next: connect Google with `npx agent-relay cloud connect google` or review `ricky --help`.';
  }

  if (mode === 'both') {
    return 'Next: choose your mode again with `ricky`, or connect Cloud with `npx agent-relay cloud connect google`.';
  }

  return 'Next: run a local handoff with `ricky --mode local --spec "<workflow spec>"`, `--spec-file`, or `--stdin`.';
}

export function renderOnboarding(context: OnboardingContext = {}): string {
  const firstRun = context.isFirstRun ?? true;
  const requestedMode = context.mode ?? (context.choice && context.choice !== 'explore' ? context.choice : 'local');
  const mode = isRickyMode(requestedMode) ? requestedMode : 'local';
  const choice = context.choice ?? mode;
  const isTTY = context.isTTY ?? true;
  const sections: string[] = [];
  const bannerShown =
    (firstRun || context.forceOnboarding === true) &&
    shouldShowBanner({ isTTY, quiet: context.quiet, noBanner: context.noBanner, env: context.env });

  if (context.quiet === true) {
    return '';
  }

  if (bannerShown) {
    sections.push(renderBanner({ variant: chooseBannerVariant(context.columns) }));
  }

  if (firstRun) {
    sections.push(renderWelcome());
    sections.push(renderModeSelector());
    sections.push(renderModeResult(choice));
    sections.push(renderCloudGuidance());
    sections.push(renderHandoffGuidance());
    sections.push(renderRecoveryGuidance(context.blockedReason));
    return sections.join('\n\n');
  }

  sections.push(renderCompactHeader(mode, context.providerStatus));
  sections.push(renderWelcome({ isFirstRun: false }));
  sections.push(renderSuggestedNextAction(mode));
  return sections.join('\n');
}

export async function runOnboarding(options: OnboardingOptions = {}): Promise<OnboardingResult> {
  const input = options.input ?? process.stdin;
  const output = options.output ?? process.stdout;
  const isTTY = options.isTTY ?? streamIsTTY(input);
  const configStore = options.configStore ?? new FileConfigStore();
  const modeOverride = resolveModeOverride(options);
  const resolvedEnv = options.env ?? process.env;
  const projectConfig = await configStore.readProjectConfig();
  const globalConfig = projectConfig ? null : await configStore.readGlobalConfig();
  const config = projectConfig ?? globalConfig ?? DEFAULT_CONFIG;
  const providerStatus = options.providerStatus ?? config.providers;
  const firstRun = options.firstRun ?? config.firstRunComplete !== true;

  if (options.quiet === true) {
    return {
      mode: modeOverride ?? config.mode,
      firstRun,
      bannerShown: false,
      output: '',
    };
  }

  if (firstRun && (!isTTY || resolvedEnv.CI !== undefined) && !modeOverride) {
    const text = `${renderNonInteractiveSetupError()}\n`;
    writeOutput(output, text);
    return {
      mode: 'explore',
      firstRun,
      bannerShown: false,
      output: text,
    };
  }

  const sections: string[] = [];
  const bannerShown =
    (firstRun || options.showBanner === true) &&
    shouldShowBanner({ isTTY, quiet: options.quiet, noBanner: options.noBanner, env: resolvedEnv });

  if (bannerShown) {
    sections.push(
      renderBanner({
        variant: chooseBannerVariant(options.columns),
        color: shouldUseColor({ isTTY, noColor: resolvedEnv.NO_COLOR !== undefined }),
      }),
    );
  }

  if (!firstRun) {
    const fallbackMode = modeOverride ?? config.mode;
    if (options.compactForExecution === true && modeOverride) {
      return {
        mode: fallbackMode,
        firstRun: false,
        bannerShown: false,
        output: '',
      };
    }
    if (!modeOverride && options.compactForExecution !== true && shouldUsePromptShell(options, input, output)) {
      const headerLines = [
        renderCompactHeader(fallbackMode, providerStatus),
        renderWelcome({ isFirstRun: false }),
      ];
      const promptIntro = `${sections.concat(headerLines).join('\n\n')}`;
      writeOutput(output, `${promptIntro}\n\n`);
      try {
        const promptShell = options.promptShell ?? createInquirerPromptShell();
        const choice = await promptShell.selectFirstScreen({
          input,
          output,
          signal: options.signal,
        });
        return {
          mode: choice,
          firstRun: false,
          bannerShown,
          output: `${promptIntro}\n${renderModeResult(choice)}\n`,
        };
      } catch (error) {
        if (!isPromptCancellation(error) || options.verbose === true) {
          throw error;
        }
        const text = '\nCancelled.\n';
        writeOutput(output, text);
        return {
          mode: 'exit',
          firstRun: false,
          bannerShown,
          output: `${promptIntro}${text}`,
        };
      }
    }

    sections.push(renderCompactHeader(fallbackMode, providerStatus));
    sections.push(renderWelcome({ isFirstRun: false }));
    sections.push(renderSuggestedNextAction(fallbackMode));
    const text = `${sections.join('\n')}\n`;
    writeOutput(output, text);
    return { mode: fallbackMode, firstRun: false, bannerShown, output: text };
  }

  if (options.compactForExecution === true && modeOverride) {
    const text = '';
    return {
      mode: modeOverride,
      firstRun: true,
      bannerShown: false,
      output: text,
    };
  }

  sections.push(renderWelcome());

  let choice: OnboardingChoice;
  const isOverride = modeOverride !== null;
  if (isOverride) {
    choice = modeOverride;
  } else {
    if (shouldUsePromptShell(options, input, output)) {
      const promptIntro = sections.join('\n\n');
      writeOutput(output, `${promptIntro}\n\n`);
      try {
        const promptShell = options.promptShell ?? createInquirerPromptShell();
        choice = await promptShell.selectFirstScreen({
          input,
          output,
          signal: options.signal,
        });
      } catch (error) {
        if (!isPromptCancellation(error) || options.verbose === true) {
          throw error;
        }

        const text = '\nCancelled.\n';
        writeOutput(output, text);
        return {
          mode: 'exit',
          firstRun: true,
          bannerShown,
          output: `${promptIntro}${text}`,
        };
      }
      sections.length = 0;
      sections.push(promptIntro);
    } else {
      sections.push(renderModeSelection());
      const promptText = `${sections.join('\n\n')} `;
      writeOutput(output, promptText);
      choice = await readChoice(input, output);
      sections.length = 0;
      sections.push(promptText.trimEnd());
    }
  }

  sections.push(renderModeResult(choice));
  sections.push(renderHandoffGuidance());
  sections.push(renderRecoveryGuidance());

  // Only persist config for interactive selections, not per-invocation overrides
  // (options.mode, RICKY_MODE). Overrides are ephemeral execution context.
  if (!isOverride && isRickyMode(choice) && options.skipFirstRunPersistence !== true) {
    await configStore.writeProjectConfig({
      mode: toRickyMode(choice),
      firstRunComplete: true,
      providers: config.providers,
    });
  }

  const text = `${sections.join('\n\n')}\n`;
  if (modeOverride) {
    writeOutput(output, text);
  } else {
    writeOutput(output, `\n\n${sections.slice(1).join('\n\n')}\n`);
  }

  return {
    mode: choice,
    firstRun: true,
    bannerShown,
    output: text,
  };
}

async function readChoice(input: NodeJS.ReadableStream, output: NodeJS.WritableStream): Promise<OnboardingChoice> {
  const readline = createInterface({ input, output, terminal: false });

  try {
    while (true) {
      const answer = await readline.question('');
      const choice = parseModeChoice(answer);

      if (choice) {
        return choice;
      }

      output.write('\nPlease choose 1, 2, 3, 4, or 5.\n\n  Choice [1]: ');
    }
  } finally {
    readline.close();
  }
}
