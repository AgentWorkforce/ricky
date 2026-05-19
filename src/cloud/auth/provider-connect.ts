import type { ProviderConnectGuidance, ProviderType } from './types.js';

export const GOOGLE_CONNECT_COMMAND = 'npx agent-relay cloud connect google';
export const CLOUD_INTEGRATIONS_DASHBOARD_URL = '/dashboard/integrations';

function createConnectInstructions(...instructions: string[]): readonly string[] {
  return Object.freeze(instructions);
}

function freezeGuidance<T extends ProviderConnectGuidance>(guidance: T): T {
  return Object.freeze(guidance);
}

export const GOOGLE_CONNECT_INSTRUCTIONS = createConnectInstructions(
  `Run: ${GOOGLE_CONNECT_COMMAND}`,
  'Follow the OAuth consent flow in your browser.',
  'Once connected, Cloud workflows can access Google-integrated services.',
);

export const GITHUB_CONNECT_INSTRUCTIONS = createConnectInstructions(
  'Open the Cloud dashboard integrations page.',
  'Click "Connect GitHub" to start the Nango-backed GitHub App installation.',
  'Select the repositories you want Ricky to access.',
  'GitHub connection is managed through the Cloud dashboard, not the CLI.',
);

export const LINEAR_CONNECT_DASHBOARD_URL = '/dashboard/integrations/linear';

export const LINEAR_CONNECT_INSTRUCTIONS = createConnectInstructions(
  'Open the Cloud dashboard Linear integration page.',
  'Click "Connect Linear" to install the Ricky OAuth Actor app.',
  'Choose the Linear workspace where Ricky should receive AgentSession events.',
  'Linear connection is managed through the Cloud dashboard, not the CLI.',
);

export const GOOGLE_CONNECT_GUIDANCE = freezeGuidance({
  kind: 'cli',
  provider: 'google',
  command: GOOGLE_CONNECT_COMMAND,
  instructions: GOOGLE_CONNECT_INSTRUCTIONS,
});

export const GITHUB_CONNECT_GUIDANCE = freezeGuidance({
  kind: 'dashboard',
  provider: 'github',
  dashboardUrl: CLOUD_INTEGRATIONS_DASHBOARD_URL,
  instructions: GITHUB_CONNECT_INSTRUCTIONS,
});

export const LINEAR_CONNECT_GUIDANCE = freezeGuidance({
  kind: 'dashboard',
  provider: 'linear',
  dashboardUrl: LINEAR_CONNECT_DASHBOARD_URL,
  instructions: LINEAR_CONNECT_INSTRUCTIONS,
});

const SLACK_CONNECT_GUIDANCE = freezeGuidance({
  kind: 'dashboard',
  provider: 'slack',
  dashboardUrl: CLOUD_INTEGRATIONS_DASHBOARD_URL,
  instructions: createConnectInstructions(
    'Open the Cloud dashboard integrations page.',
    'Choose slack from optional integrations.',
    'Complete the hosted connection flow.',
    'slack connection is managed through the Cloud dashboard, not the CLI.',
  ),
});

const NOTION_CONNECT_GUIDANCE = freezeGuidance({
  kind: 'dashboard',
  provider: 'notion',
  dashboardUrl: CLOUD_INTEGRATIONS_DASHBOARD_URL,
  instructions: createConnectInstructions(
    'Open the Cloud dashboard integrations page.',
    'Choose notion from optional integrations.',
    'Complete the hosted connection flow.',
    'notion connection is managed through the Cloud dashboard, not the CLI.',
  ),
});

const PROVIDER_CONNECT_GUIDANCE = Object.freeze({
  google: GOOGLE_CONNECT_GUIDANCE,
  github: GITHUB_CONNECT_GUIDANCE,
  slack: SLACK_CONNECT_GUIDANCE,
  notion: NOTION_CONNECT_GUIDANCE,
  linear: LINEAR_CONNECT_GUIDANCE,
} satisfies Record<ProviderType, ProviderConnectGuidance>);

export function getProviderConnectGuidance(provider: ProviderType): ProviderConnectGuidance {
  return PROVIDER_CONNECT_GUIDANCE[provider];
}
