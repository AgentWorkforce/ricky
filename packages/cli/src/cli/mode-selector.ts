export type RickyMode = 'local' | 'cloud' | 'both';
export type OnboardingChoice = RickyMode | 'explore';

export interface ProviderStatus {
  google: { connected: boolean };
  github: { connected: boolean };
}

export interface RickyConfig {
  mode: RickyMode;
  firstRunComplete: boolean;
  providers: ProviderStatus;
}

export interface ModeOption {
  choice: '1' | '2' | '3' | '4';
  value: OnboardingChoice;
  title: string;
  description: string;
}

export const DEFAULT_PROVIDER_STATUS: ProviderStatus = {
  google: { connected: false },
  github: { connected: false },
};

export const MODE_OPTIONS: ModeOption[] = [
  {
    choice: '1',
    value: 'local',
    title: 'Local / BYOH',
    description: 'run workflows against your local repo and tools',
  },
  {
    choice: '2',
    value: 'cloud',
    title: 'Cloud',
    description: 'run workflows on AgentWorkforce Cloud',
  },
  {
    choice: '3',
    value: 'both',
    title: 'Both',
    description: 'set up local now, connect Cloud later',
  },
  {
    choice: '4',
    value: 'explore',
    title: 'Just explore',
    description: 'skip setup, show me what Ricky can do',
  },
];

export function parseModeChoice(input: string): OnboardingChoice | null {
  const normalized = input.trim().toLowerCase();

  if (normalized === '') {
    return 'local';
  }

  const byNumber = MODE_OPTIONS.find((option) => option.choice === normalized);
  if (byNumber) {
    return byNumber.value;
  }

  if (
    normalized === 'local' ||
    normalized === 'local-byoh' ||
    normalized === 'local/byoh' ||
    normalized === 'local / byoh' ||
    normalized === 'byoh'
  ) {
    return 'local';
  }

  if (normalized === 'cloud' || normalized === 'both' || normalized === 'explore') {
    return normalized;
  }

  if (normalized === 'just explore') {
    return 'explore';
  }

  return null;
}

export function isRickyMode(value: string | undefined): value is RickyMode {
  return value === 'local' || value === 'cloud' || value === 'both';
}

export function toRickyMode(choice: OnboardingChoice): RickyMode {
  return choice === 'explore' ? 'local' : choice;
}

export function renderModeSelection(): string {
  return [
    '  How would you like to use Ricky?',
    '',
    '  > [1] Local / BYOH  — run workflows against your local repo and tools',
    '    [2] Cloud         — run workflows on AgentWorkforce Cloud',
    '    [3] Both          — set up local now, connect Cloud later',
    '    [4] Just explore  — skip setup, show me what Ricky can do',
    '',
    '  Choice [1]:',
  ].join('\n');
}

export function renderModeSelector(): string {
  return renderModeSelection();
}

export function renderModeResult(choice: OnboardingChoice): string {
  switch (choice) {
    case 'local':
      return [
        '  Local / BYOH mode selected.',
        '',
        '  In this mode, Ricky will:',
        '  - generate workflows into your local repo',
        '  - validate workflows using local tools (tsc, vitest, agent-relay)',
        '  - run workflows via local agent-relay',
        '  - return artifacts and logs locally',
        '',
        '  No Cloud credentials required.',
        '',
        '  Give Ricky a spec, a workflow artifact, or a Claude/MCP handoff and continue locally.',
        '  From this CLI, use inline, file, or stdin spec handoff.',
        '',
        '  Next steps:',
        '  - Inline: npm start -- --mode local --spec "generate a workflow for package checks"',
        '  - File:   npm start -- --mode local --spec-file ./path/to/spec.md',
        '  - Stdin:  printf "%s\\n" "run workflows/release.workflow.ts" | npm start -- --mode local --stdin',
        '  - Use `npm start -- --help` to see the currently implemented CLI surface',
        '  - Cloud guidance is available with: npx agent-relay cloud connect google',
        '',
        '  Ready to go!',
      ].join('\n');
    case 'cloud':
      return [
        '  Cloud mode selected.',
        '',
        '  In this mode, Ricky will:',
        '  - generate and run workflows on AgentWorkforce Cloud',
        '  - return downloadable artifacts and execution results',
        '  - support proactive failure notifications',
        '',
        '  Connect providers such as Google, then continue with hosted workflow generation and execution.',
        '',
        "  Let's connect your Cloud providers.",
        '',
        '  Step 1: Connect Google (required for Cloud execution)',
        '  Run: npx agent-relay cloud connect google',
        '',
        '  Step 2: Connect GitHub (optional, for repo-connected workflows)',
        '  Visit your Cloud dashboard to install the GitHub app:',
        '  Open your AgentWorkforce Cloud settings -> Integrations -> GitHub',
        '  The GitHub app is installed through the Cloud dashboard / Nango-backed connection flow.',
        '',
        '  After connecting, verify with:',
        '  $ npm start -- --mode cloud',
        '',
        '  Need help? See: npm start -- --help',
      ].join('\n');
    case 'both':
      return [
        '  Local + Cloud mode selected.',
        '',
        '  Local mode is ready now - you can start generating and running',
        '  workflows immediately against your local repo.',
        '',
        '  To also enable Cloud execution, connect providers when ready:',
        '  - Google:  npx agent-relay cloud connect google',
        '  - GitHub:  Cloud dashboard -> Integrations -> GitHub',
        '',
        '  Next steps:',
        '  - Inline local handoff: npm start -- --mode local --spec "generate a workflow for package checks"',
        '  - File local handoff:   npm start -- --mode local --spec-file ./path/to/spec.md',
        '  - Cloud setup:               npx agent-relay cloud connect google',
        '  - See the current CLI help:  npm start -- --help',
      ].join('\n');
    case 'explore':
      return [
        '  Explore mode - no setup needed.',
        '',
        "  Here's what Ricky can do:",
        '',
        '  Today\'s implemented surface is onboarding, mode selection, and local spec handoff.',
        '  Local handoff accepts --spec, --spec-file, and --stdin.',
        '',
        '  See the current CLI help: npm start -- --help',
        '  For Cloud setup:       npx agent-relay cloud connect google',
      ].join('\n');
  }
}

export function renderCompactHeader(mode: RickyMode, providerStatus: ProviderStatus = DEFAULT_PROVIDER_STATUS): string {
  if (mode === 'cloud') {
    const googleStatus = providerStatus.google.connected ? 'google connected' : 'google not connected';
    return `ricky · cloud mode · ${googleStatus}`;
  }

  if (mode === 'both') {
    const cloudStatus = providerStatus.google.connected ? 'cloud connected' : 'cloud not connected';
    return `ricky · local + cloud mode · local ready · ${cloudStatus}`;
  }

  return 'ricky · local mode · ready';
}
