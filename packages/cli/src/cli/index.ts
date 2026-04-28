export {
  RICKY_BANNER,
  RICKY_COMPACT_BANNER,
  chooseBannerVariant,
  renderBanner,
  shouldShowBanner,
  shouldUseColor,
} from './ascii-art.js';
export type { BannerVariant, RenderBannerOptions, ShouldShowBannerOptions } from './ascii-art.js';

export { FIRST_RUN_WELCOME, RETURNING_USER_WELCOME, renderWelcome } from './welcome.js';
export type { WelcomeOptions } from './welcome.js';

export {
  DEFAULT_PROVIDER_STATUS,
  MODE_OPTIONS,
  isRickyMode,
  parseModeChoice,
  renderCompactHeader,
  renderModeResult,
  renderModeSelection,
  renderModeSelector,
  toRickyMode,
} from './mode-selector.js';
export type { ModeOption, OnboardingChoice, ProviderStatus, RickyConfig, RickyMode } from './mode-selector.js';

export {
  renderCloudGuidance,
  renderHandoffGuidance,
  renderInterruptedSetupRecovery,
  renderNonInteractiveSetupError,
  renderOnboarding,
  renderProviderConnectFailureRecovery,
  renderRecoveryGuidance,
  renderSuggestedNextAction,
  renderWorkflowGenerationFailureRecovery,
  runOnboarding,
} from './onboarding.js';
export type { OnboardingContext, OnboardingOptions, OnboardingResult, RickyConfigStore } from './onboarding.js';
