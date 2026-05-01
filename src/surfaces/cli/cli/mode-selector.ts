export type RickyMode = 'local' | 'cloud' | 'both';
export type OnboardingChoice = RickyMode | 'explore' | 'status' | 'connect' | 'exit';

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
  choice: '1' | '2' | '3' | '4' | '5';
  value: OnboardingChoice;
  title: string;
  description: string;
}

export interface RickyModeDefinition {
  value: RickyMode;
  title: string;
  description: string;
  nextAction: string;
}

export const DEFAULT_PROVIDER_STATUS: ProviderStatus = {
  google: { connected: false },
  github: { connected: false },
};

export const RICKY_MODE_DEFINITIONS = {
  local: {
    value: 'local',
    title: 'Local / BYOH',
    description: 'Generate workflow artifacts for this repo without Cloud credentials.',
    nextAction: 'Run `ricky --mode local --spec "<workflow spec>"`, use `--spec-file`, or pipe `--stdin`.',
  },
  cloud: {
    value: 'cloud',
    title: 'Cloud',
    description: 'Generate workflow artifacts through AgentWorkforce Cloud after provider setup.',
    nextAction: 'Connect Google with `npx agent-relay cloud connect google`, then run `ricky --mode cloud`.',
  },
  both: {
    value: 'both',
    title: 'Local + Cloud',
    description: 'Start locally now and keep Cloud available after provider setup.',
    nextAction: 'Run locally now, or connect Cloud with `npx agent-relay cloud connect google`.',
  },
} satisfies Record<RickyMode, RickyModeDefinition>;

export const LOCAL_BYOH_MODE = RICKY_MODE_DEFINITIONS.local;
export const CLOUD_MODE = RICKY_MODE_DEFINITIONS.cloud;
export const FIRST_CLASS_RICKY_MODES = [LOCAL_BYOH_MODE, CLOUD_MODE] as const;

export const MODE_OPTIONS: ModeOption[] = [
  {
    choice: '1',
    value: LOCAL_BYOH_MODE.value,
    title: LOCAL_BYOH_MODE.title,
    description: 'generate workflow artifacts for your local repo',
  },
  {
    choice: '2',
    value: CLOUD_MODE.value,
    title: CLOUD_MODE.title,
    description: 'generate workflow artifacts through AgentWorkforce Cloud',
  },
  {
    choice: '3',
    value: 'status',
    title: 'Status',
    description: 'show local readiness and known provider state',
  },
  {
    choice: '4',
    value: 'connect',
    title: 'Connect tools',
    description: 'show provider setup commands and dashboard guidance',
  },
  {
    choice: '5',
    value: 'exit',
    title: 'Exit',
    description: 'leave without generating or executing anything',
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

  if (
    normalized === 'cloud' ||
    normalized === 'both' ||
    normalized === 'explore' ||
    normalized === 'status' ||
    normalized === 'connect' ||
    normalized === 'exit'
  ) {
    return normalized;
  }

  if (normalized === 'connect tools' || normalized === 'connect-tools') {
    return 'connect';
  }

  if (normalized === 'quit') {
    return 'exit';
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
  if (choice === 'explore' || choice === 'status' || choice === 'connect' || choice === 'exit') {
    return 'local';
  }
  return choice;
}

export function renderModeSelection(): string {
  return [
    '  How would you like to use Ricky?',
    '',
    '  > [1] Local / BYOH   — generate workflow artifacts for your local repo',
    '    [2] Cloud          — generate workflow artifacts through AgentWorkforce Cloud',
    '    [3] Status         — show local readiness and known provider state',
    '    [4] Connect tools  — show provider setup commands and dashboard guidance',
    '    [5] Exit           — leave without generating or executing anything',
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
        '    Pass --run with a spec, or use `ricky run <artifact>`.',
        '    Execution launches the artifact through the Relay SDK workflow runner.',
        '    On failure, Ricky prints a classified blocker code and shell-ready recovery steps.',
        '',
        '  No Cloud credentials required.',
        '',
        '  Next steps:',
        '  - Generate only:  ricky --mode local --spec "generate a workflow for package checks"',
        '  - Generate + run: ricky --mode local --spec "..." --run',
        '  - From file:      ricky --mode local --spec-file ./path/to/spec.md',
        '  - From stdin:     printf "%s\\n" "run workflows/release.workflow.ts" | ricky --mode local --stdin',
        '  - Run existing:   ricky run workflows/generated/<file>.ts  (requires npm-linked CLI)',
        '  - CLI help:       ricky --help',
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
        '  $ ricky --mode cloud',
        '',
        '  Need help? See: ricky --help',
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
        '  - Generate only:  ricky --mode local --spec "generate a workflow for package checks"',
        '  - Generate + run: ricky --mode local --spec "..." --run',
        '  - From file:      ricky --mode local --spec-file ./path/to/spec.md',
        '  - Cloud setup:    npx agent-relay cloud connect google',
        '  - CLI help:       ricky --help',
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
        '  CLI help:    ricky --help',
        '  Cloud setup: npx agent-relay cloud connect google',
      ].join('\n');
    case 'status':
      return [
        '  Status',
        '',
        '  Local generation: ready',
        '  Cloud generation: requires AgentWorkforce Cloud credentials and provider setup',
        '',
        '  Ricky only reports provider state already present in local config.',
        '  It does not create Cloud credentials or infer dashboard state.',
      ].join('\n');
    case 'connect':
      return [
        '  Connect tools',
        '',
        '  Google:',
        '    npx agent-relay cloud connect google',
        '',
        '  GitHub:',
        '    Open AgentWorkforce Cloud settings -> Integrations -> GitHub',
        '',
        '  Ricky does not store or invent Cloud credentials in this prompt.',
      ].join('\n');
    case 'exit':
      return [
        '  Cancelled. Nothing was generated or executed.',
      ].join('\n');
  }
}

export function renderCompactHeader(mode: RickyMode, providerStatus: ProviderStatus = DEFAULT_PROVIDER_STATUS): string {
  if (mode === 'cloud') {
    const cloudStatus = providerStatus.google.connected ? 'cloud connected' : 'cloud not connected';
    return `ricky · cloud mode · ${cloudStatus}`;
  }

  if (mode === 'both') {
    const cloudStatus = providerStatus.google.connected ? 'cloud connected' : 'cloud not connected';
    return `ricky · local + cloud mode · local ready · ${cloudStatus}`;
  }

  return 'ricky · local mode · ready';
}
