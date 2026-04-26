import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline/promises';

import { chooseBannerVariant, renderBanner, shouldShowBanner, shouldUseColor } from './ascii-art';
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
} from './mode-selector';
import { renderWelcome } from './welcome';

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
  env?: { RICKY_BANNER?: string };
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
  noBanner?: boolean;
  mode?: RickyMode;
  showBanner?: boolean;
  columns?: number;
  env?: NodeJS.ProcessEnv;
  configStore?: RickyConfigStore;
  firstRun?: boolean;
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

export function renderCloudGuidance(): string {
  return [
    'Cloud provider guidance:',
    '  Connect providers such as Google, then continue with hosted workflow generation and execution.',
    '',
    '  Connect Google for Cloud execution:',
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
    '  Tip: You can hand specs from Claude directly to Ricky.',
    '  In a Claude session, ask Claude to write a workflow spec.',
    '  Hand Ricky the spec directly.',
    '  From the CLI:',
    '  $ npx ricky generate --spec "describe your workflow"',
    '  $ npx ricky generate --spec-file <path>',
    '  $ cat spec.md | npx ricky generate --spec-stdin',
    '',
    '  Using MCP? Invoke ricky.generate with the same spec, mode, and source fields.',
  ].join('\n');
}

export function renderInterruptedSetupRecovery(): string {
  return [
    '  It looks like setup was interrupted.',
    '  Run `npx ricky setup` to restart, or use --mode local to skip setup.',
  ].join('\n');
}

export function renderNonInteractiveSetupError(): string {
  return [
    '  Error: Ricky has not been configured yet.',
    '',
    '  Run `npx ricky` interactively to complete first-run setup,',
    '  or set RICKY_MODE=local to skip setup and use local mode.',
  ].join('\n');
}

export function renderRecoveryGuidance(blockedReason?: string | null): string {
  if (!blockedReason) {
    return [
      'Recovery:',
      '  If setup is interrupted, run `npx ricky setup` to restart.',
      '  If Cloud setup is blocked, continue in local mode: npx ricky --mode local',
      '  Ricky should say what is blocked and show the nearest useful next step.',
    ].join('\n');
  }

  return [
    'Recovery:',
    `  Ricky can continue, but something is blocked: ${blockedReason}`,
    '  fix the local runtime issue or continue with Cloud setup instead.',
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
    '  Or continue in local mode: npx ricky --mode local',
  ].join('\n');
}

export function renderWorkflowGenerationFailureRecovery(): string {
  return [
    '  Workflow generation failed.',
    '',
    '  You can ask Ricky to debug the failed workflow:',
    '  $ npx ricky debug --workflow <path>',
    '',
    '  Or rerun locally after editing the spec:',
    '  $ npx ricky generate --spec-file spec.md --mode local',
  ].join('\n');
}

export function renderSuggestedNextAction(mode: RickyMode): string {
  if (mode === 'cloud') {
    return 'Next: run `npx ricky status` or connect Google with `npx agent-relay cloud connect google`.';
  }

  if (mode === 'both') {
    return 'Next: generate locally with `npx ricky generate --spec "your spec here"` or check Cloud with `npx ricky status`.';
  }

  return 'Next: generate locally with `npx ricky generate --spec "your spec here"`.';
}

export function renderOnboarding(context: OnboardingContext = {}): string {
  const firstRun = context.isFirstRun ?? true;
  const mode = context.mode ?? (context.choice && context.choice !== 'explore' ? context.choice : 'local');
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
  const projectConfig = await configStore.readProjectConfig();
  const globalConfig = projectConfig ? null : await configStore.readGlobalConfig();
  const config = projectConfig ?? globalConfig ?? DEFAULT_CONFIG;
  const firstRun = options.firstRun ?? config.firstRunComplete !== true;

  if (options.quiet === true) {
    return {
      mode: modeOverride ?? config.mode,
      firstRun,
      bannerShown: false,
      output: '',
    };
  }

  if (firstRun && !isTTY && !modeOverride) {
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
  const resolvedEnv = options.env ?? process.env;
  const bannerShown =
    (firstRun || options.showBanner === true) &&
    shouldShowBanner({ isTTY, quiet: options.quiet, noBanner: options.noBanner, env: resolvedEnv });

  if (bannerShown) {
    sections.push(
      renderBanner({
        variant: chooseBannerVariant(options.columns),
        color: shouldUseColor({ isTTY, noColor: options.env?.NO_COLOR !== undefined }),
      }),
    );
  }

  if (!firstRun) {
    const mode = modeOverride ?? config.mode;
    sections.push(renderCompactHeader(mode, config.providers));
    sections.push(renderWelcome({ isFirstRun: false }));
    sections.push(renderSuggestedNextAction(mode));
    const text = `${sections.join('\n')}\n`;
    writeOutput(output, text);
    return { mode, firstRun: false, bannerShown, output: text };
  }

  sections.push(renderWelcome());

  let choice: OnboardingChoice;
  const isOverride = modeOverride !== null;
  if (isOverride) {
    choice = modeOverride;
  } else {
    sections.push(renderModeSelection());
    const promptText = `${sections.join('\n\n')} `;
    writeOutput(output, promptText);
    choice = await readChoice(input, output);
    sections.length = 0;
    sections.push(promptText.trimEnd());
  }

  sections.push(renderModeResult(choice));
  sections.push(renderHandoffGuidance());
  sections.push(renderRecoveryGuidance());

  // Only persist config for interactive selections, not per-invocation overrides
  // (options.mode, RICKY_MODE). Overrides are ephemeral execution context.
  if (!isOverride && choice !== 'explore') {
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

      output.write('\nPlease choose 1, 2, 3, or 4.\n\n  Choice [1]: ');
    }
  } finally {
    readline.close();
  }
}
