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
    description: 'generate workflows for your local repo and tools',
  },
  {
    choice: '2',
    value: 'cloud',
    title: 'Cloud',
    description: 'generate workflows through AgentWorkforce Cloud',
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
    '  > [1] Local / BYOH  — generate workflows for your local repo and tools',
    '    [2] Cloud         — generate workflows through AgentWorkforce Cloud',
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
        '  Two distinct stages — generation runs by default, execution is opt-in:',
        '  1. Generate — Ricky writes a workflow artifact into workflows/generated/ in your repo',
        '                and prints the exact run command for the next step.',
        '  2. Execute — only when you pass --run (with --spec/--spec-file/--stdin) or use',
        '                `ricky run <artifact>` (requires npm-linked CLI) to launch through',
        '                local agent-relay.',
        '',
        '  What you get back: the generated artifact path, logs, and warnings.',
        '  With --run, you also get classified blockers and execution evidence',
        '  (stdout/stderr log paths, exit code, duration).',
        '',
        '  No Cloud credentials required.',
        '',
        '  Next steps:',
        '  - Inline (generate): npm start -- --mode local --spec "generate a workflow for package checks"',
        '  - Generate + run:    npm start -- --mode local --spec "..." --run',
        '  - File:              npm start -- --mode local --spec-file ./path/to/spec.md',
        '  - Stdin:             printf "%s\\n" "run workflows/release.workflow.ts" | npm start -- --mode local --stdin',
        '  - Run an artifact:   ricky run workflows/generated/<file>.ts  (requires npm-linked CLI)',
        '  - See the current CLI help: npm start -- --help',
        '',
        '  Ready to hand over a spec.',
      ].join('\n');
    case 'cloud':
      return [
        '  Cloud mode selected.',
        '',
        '  In this mode, Ricky will:',
        '  - hand workflow generation requests to AgentWorkforce Cloud',
        '  - return generated artifacts and any follow-up actions the Cloud endpoint suggests',
        '',
        '  Note: this CLI slice does not stream Cloud execution evidence — what you see is',
        '  what the Cloud generate endpoint returns.',
        '',
        '  Connect providers such as Google, then continue with hosted workflow generation.',
        '',
        "  Let's connect your Cloud providers.",
        '',
        '  Step 1: Connect Google (required for Cloud generation)',
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
        '  Local mode is ready now — generation runs by default, execution is opt-in via --run.',
        '  Cloud is not connected until you complete provider setup below.',
        '',
        '  To also enable Cloud generation, connect providers when ready:',
        '  - Google:  npx agent-relay cloud connect google',
        '  - GitHub:  Cloud dashboard -> Integrations -> GitHub',
        '',
        '  Next steps:',
        '  - Inline local handoff: npm start -- --mode local --spec "generate a workflow for package checks"',
        '  - Generate + run:       npm start -- --mode local --spec "..." --run',
        '  - File local handoff:   npm start -- --mode local --spec-file ./path/to/spec.md',
        '  - Cloud setup:          npx agent-relay cloud connect google',
        '  - See the current CLI help:  npm start -- --help',
      ].join('\n');
    case 'explore':
      return [
        '  Explore mode - no setup needed.',
        '',
        "  Here's what Ricky exposes today:",
        '',
        '  - Onboarding, mode selection, and local spec handoff (--spec, --spec-file, --stdin).',
        '  - Local generation writes a workflow artifact into workflows/generated/ in your repo.',
        '  - Local execution is opt-in: pass --run with a spec, or `ricky run <artifact>`',
        '    (ricky run requires the CLI to be npm-linked).',
        '  - Cloud generation is wired through `--mode cloud` once providers are connected.',
        '',
        '  Anything not in that list is not part of the current CLI slice.',
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
