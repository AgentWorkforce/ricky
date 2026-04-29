import type { ProviderConnectGuidance, ProviderType } from './types.js';

const GOOGLE_CONNECT_COMMAND = 'npx agent-relay cloud connect google';

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
