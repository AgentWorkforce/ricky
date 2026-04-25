export {
  RICKY_BANNER,
  RICKY_COMPACT_BANNER,
  chooseBannerVariant,
  renderBanner,
  shouldShowBanner,
  shouldUseColor,
} from './ascii-art';
export type { BannerVariant, RenderBannerOptions, ShouldShowBannerOptions } from './ascii-art';

export { FIRST_RUN_WELCOME, RETURNING_USER_WELCOME, renderWelcome } from './welcome';
export type { WelcomeOptions } from './welcome';

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
} from './mode-selector';
export type { ModeOption, OnboardingChoice, ProviderStatus, RickyConfig, RickyMode } from './mode-selector';

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
} from './onboarding';
export type { OnboardingContext, OnboardingOptions, OnboardingResult, RickyConfigStore } from './onboarding';
