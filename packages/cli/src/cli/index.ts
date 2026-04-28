export {
  RICKY_ASCII_ART_WELCOME,
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
  CLOUD_MODE,
  DEFAULT_PROVIDER_STATUS,
  FIRST_CLASS_RICKY_MODES,
  LOCAL_BYOH_MODE,
  MODE_OPTIONS,
  RICKY_MODE_DEFINITIONS,
  isRickyMode,
  parseModeChoice,
  renderCompactHeader,
  renderModeResult,
  renderModeSelection,
  renderModeSelector,
  toRickyMode,
} from './mode-selector.js';
export type {
  ModeOption,
  OnboardingChoice,
  ProviderStatus,
  RickyConfig,
  RickyMode,
  RickyModeDefinition,
} from './mode-selector.js';

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
