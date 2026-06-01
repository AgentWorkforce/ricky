import {
  LINEAR_CONNECT_DASHBOARD_URL,
  LINEAR_CONNECT_INSTRUCTIONS,
} from '../../cloud/auth/provider-connect.js';

export interface LinearConnectGuidance {
  provider: 'linear';
  dashboardUrl: string;
  instructions: readonly string[];
}

export { LINEAR_CONNECT_DASHBOARD_URL, LINEAR_CONNECT_INSTRUCTIONS };

export function getLinearConnectGuidance(): LinearConnectGuidance {
  return Object.freeze({
    provider: 'linear',
    dashboardUrl: LINEAR_CONNECT_DASHBOARD_URL,
    instructions: LINEAR_CONNECT_INSTRUCTIONS,
  });
}

export function renderLinearConnectGuidance(): string[] {
  const guidance = getLinearConnectGuidance();
  return [
    'Ricky connect linear',
    '',
    'Linear uses the Cloud dashboard to install the Ricky OAuth Actor app.',
    `Dashboard: ${guidance.dashboardUrl}`,
    '',
    'Next',
    ...guidance.instructions.map((instruction) => `  ${instruction}`),
    '  ricky status linear',
  ];
}
