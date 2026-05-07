import type { ProviderConnectGuidance, ProviderType } from './types.js';

const GOOGLE_CONNECT_COMMAND = 'npx agent-relay cloud connect google';

export const LINEAR_CONNECT_DASHBOARD_URL = '/dashboard/integrations/linear';

export const LINEAR_CONNECT_INSTRUCTIONS = [
  'Open the Cloud dashboard Linear integration page.',
  'Click "Connect Linear" to install the Ricky OAuth Actor app.',
  'Choose the Linear workspace where Ricky should receive AgentSession events.',
  'Linear connection is managed through the Cloud dashboard, not the CLI.',
];

export function getProviderConnectGuidance(provider: ProviderType): ProviderConnectGuidance {
  if (provider === 'google') {
    return {
      provider: 'google',
      command: GOOGLE_CONNECT_COMMAND,
      instructions: [
        `Run: ${GOOGLE_CONNECT_COMMAND}`,
        'Follow the OAuth consent flow in your browser.',
        'Once connected, Cloud workflows can access Google-integrated services.',
      ],
    };
  }

  if (provider === 'github') {
    return {
      provider: 'github',
      dashboardUrl: '/dashboard/integrations',
      instructions: [
        'Open the Cloud dashboard integrations page.',
        'Click "Connect GitHub" to start the Nango-backed GitHub App installation.',
        'Select the repositories you want Ricky to access.',
        'GitHub connection is managed through the Cloud dashboard, not the CLI.',
      ],
    };
  }

  if (provider === 'linear') {
    return {
      provider: 'linear',
      dashboardUrl: LINEAR_CONNECT_DASHBOARD_URL,
      instructions: LINEAR_CONNECT_INSTRUCTIONS,
    };
  }

  return {
    provider,
    dashboardUrl: '/dashboard/integrations',
    instructions: [
      'Open the Cloud dashboard integrations page.',
      `Choose ${provider} from optional integrations.`,
      'Complete the hosted connection flow.',
      `${provider} connection is managed through the Cloud dashboard, not the CLI.`,
    ],
  };
}
