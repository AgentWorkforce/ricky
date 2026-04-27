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
    description: 'generate workflow artifacts for your local repo',
  },
  {
    choice: '2',
    value: 'cloud',
    title: 'Cloud',
    description: 'generate workflow artifacts through AgentWorkforce Cloud',
  },
  {
    choice: '3',
    value: 'both',
    title: 'Both',
    description: 'set up local generation now, connect Cloud later',
  },
  {
    choice: '4',
    value: 'explore',
    title: 'Just explore',
    description: 'skip setup, see what Ricky generates today',
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
    '  > [1] Local / BYOH  — generate workflow artifacts for your local repo',
    '    [2] Cloud         — generate workflow artifacts through AgentWorkforce Cloud',
    '    [3] Both          — set up local generation now, connect Cloud later',
    '    [4] Just explore  — skip setup, see what Ricky generates today',
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
        '  Generation (default):',
        '    Ricky writes a workflow artifact into workflows/generated/ in your repo.',
        '    You get back: the artifact path on disk, logs, and warnings.',
        '    Ricky prints the exact command to run the artifact yourself.',
        '    Nothing is executed at this stage.',
        '',
        '  Execution (opt-in only):',
        '    Pass --run with a spec, or use `ricky run <artifact>` (requires npm-linked CLI).',
        '    Execution launches the artifact through local agent-relay.',
        '    On failure, Ricky prints a classified blocker code and shell-ready recovery steps.',
        '',
        '  No Cloud credentials required.',
        '',
        '  Next steps:',
        '  - Generate only:  npm start -- --mode local --spec "generate a workflow for package checks"',
        '  - Generate + run: npm start -- --mode local --spec "..." --run',
        '  - From file:      npm start -- --mode local --spec-file ./path/to/spec.md',
        '  - From stdin:     printf "%s\\n" "run workflows/release.workflow.ts" | npm start -- --mode local --stdin',
        '  - Run existing:   ricky run workflows/generated/<file>.ts  (requires npm-linked CLI)',
        '  - CLI help:       npm start -- --help',
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
        '  Local generation is ready now. Execution is opt-in via --run.',
        '  Cloud is not connected until you complete provider setup below.',
        '',
        '  To also enable Cloud generation, connect providers when ready:',
        '  - Google:  npx agent-relay cloud connect google',
        '  - GitHub:  Cloud dashboard -> Integrations -> GitHub',
        '',
        '  Next steps:',
        '  - Generate only:  npm start -- --mode local --spec "generate a workflow for package checks"',
        '  - Generate + run: npm start -- --mode local --spec "..." --run',
        '  - From file:      npm start -- --mode local --spec-file ./path/to/spec.md',
        '  - Cloud setup:    npx agent-relay cloud connect google',
        '  - CLI help:       npm start -- --help',
      ].join('\n');
    case 'explore':
      return [
        '  Explore mode — no setup needed.',
        '',
        "  What Ricky does today:",
        '',
        '  - Accepts a spec via --spec, --spec-file, or --stdin.',
        '  - Generates a workflow artifact into workflows/generated/ in your repo.',
        '  - Prints the exact command to run the artifact. Does not execute it',
        '    unless you pass --run or use `ricky run <artifact>` (npm-linked CLI).',
        '  - Cloud generation is available via --mode cloud once providers are connected.',
        '',
        '  Anything not listed above is not part of the current CLI surface.',
        '',
        '  CLI help:    npm start -- --help',
        '  Cloud setup: npx agent-relay cloud connect google',
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
