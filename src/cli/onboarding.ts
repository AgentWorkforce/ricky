import { chooseBannerVariant, renderBanner, shouldShowBanner } from './ascii-art';
import { renderModeSelector } from './mode-selector';
import { renderWelcome } from './welcome';

export interface OnboardingContext {
  isFirstRun?: boolean;
  isTTY?: boolean;
  quiet?: boolean;
  noBanner?: boolean;
  forceOnboarding?: boolean;
  columns?: number;
  blockedReason?: string | null;
}

export function renderCloudGuidance(): string {
  return [
    'Cloud next steps:',
    '  npx agent-relay cloud connect google',
    '  For GitHub and other dashboard-managed integrations, use the Cloud dashboard / Nango-backed connection flow.',
  ].join('\n');
}

export function renderHandoffGuidance(): string {
  return [
    'Spec handoff:',
    '  Already worked through the problem in Claude? Hand Ricky the spec directly.',
    '  Using MCP? Pass Ricky the structured request instead of rewriting it by hand.',
  ].join('\n');
}

export function renderRecoveryGuidance(blockedReason?: string | null): string {
  if (!blockedReason) {
    return [
      'Recovery:',
      '  If local runtime setup is incomplete or Cloud is not connected yet, Ricky should say what is blocked and show the nearest useful next step.',
    ].join('\n');
  }

  return [
    'Recovery:',
    `  Ricky can continue, but something is blocked: ${blockedReason}`,
    '  You can fix the local runtime issue or continue with Cloud setup instead.',
  ].join('\n');
}

export function renderOnboarding(context: OnboardingContext = {}): string {
  const sections: string[] = [];
  const showBanner = shouldShowBanner(context);

  if (showBanner) {
    sections.push(renderBanner(chooseBannerVariant(context.columns)));
  }

  sections.push(renderWelcome({ isFirstRun: context.isFirstRun }));
  sections.push(renderModeSelector());
  sections.push(renderCloudGuidance());
  sections.push(renderHandoffGuidance());
  sections.push(renderRecoveryGuidance(context.blockedReason));

  return sections.join('\n\n');
}
