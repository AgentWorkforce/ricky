export type BannerVariant = 'full' | 'compact';

const FULL_BANNER = String.raw`RRRR   III   CCCC  K   K  Y   Y
R   R   I   C      K  K    Y Y
RRRR    I   C      KKK      Y
R  R    I   C      K  K     Y
R   R  III   CCCC  K   K    Y`;

const COMPACT_BANNER = 'ricky · workflow reliability for AgentWorkforce';

export function renderBanner(variant: BannerVariant = 'full'): string {
  return variant === 'compact' ? COMPACT_BANNER : FULL_BANNER;
}

export function chooseBannerVariant(columns?: number): BannerVariant {
  if (typeof columns === 'number' && columns > 0 && columns < 60) {
    return 'compact';
  }

  return 'full';
}

export function shouldShowBanner(options: {
  isFirstRun?: boolean;
  isTTY?: boolean;
  quiet?: boolean;
  noBanner?: boolean;
  forceOnboarding?: boolean;
} = {}): boolean {
  const {
    isFirstRun = false,
    isTTY = true,
    quiet = false,
    noBanner = false,
    forceOnboarding = false,
  } = options;

  if (!isTTY || quiet || noBanner) {
    return false;
  }

  return isFirstRun || forceOnboarding;
}
