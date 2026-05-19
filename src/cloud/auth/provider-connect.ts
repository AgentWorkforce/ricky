import type { ProviderConnectGuidance, ProviderType } from './types.js';

export const GOOGLE_CONNECT_COMMAND = 'npx agent-relay cloud connect google';
export const CLOUD_INTEGRATIONS_DASHBOARD_URL = '/dashboard/integrations';

function createConnectInstructions(...instructions: string[]): string[] {
  return Object.freeze(instructions) as string[];
}

function freezeGuidance<T extends ProviderConnectGuidance>(guidance: T): T {
  return Object.freeze(guidance);
}

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

export function getProviderConnectGuidance(provider: ProviderType): ProviderConnectGuidance {
  if (provider === 'google') {
    return freezeGuidance({
      kind: 'cli',
      provider: 'google',
      command: GOOGLE_CONNECT_COMMAND,
      instructions: createConnectInstructions(
        `Run: ${GOOGLE_CONNECT_COMMAND}`,
        'Follow the OAuth consent flow in your browser.',
        'Once connected, Cloud workflows can access Google-integrated services.',
      ),
    });
  }

  if (provider === 'github') {
    return freezeGuidance({
      kind: 'dashboard',
      provider: 'github',
      dashboardUrl: CLOUD_INTEGRATIONS_DASHBOARD_URL,
      instructions: GITHUB_CONNECT_INSTRUCTIONS,
    });
  }

  if (provider === 'linear') {
    return freezeGuidance({
      kind: 'dashboard',
      provider: 'linear',
      dashboardUrl: LINEAR_CONNECT_DASHBOARD_URL,
      instructions: LINEAR_CONNECT_INSTRUCTIONS,
    });
  }

  return freezeGuidance({
    kind: 'dashboard',
    provider,
    dashboardUrl: CLOUD_INTEGRATIONS_DASHBOARD_URL,
    instructions: createConnectInstructions(
      'Open the Cloud dashboard integrations page.',
      `Choose ${provider} from optional integrations.`,
      'Complete the hosted connection flow.',
      `${provider} connection is managed through the Cloud dashboard, not the CLI.`,
    ),
  });
}
