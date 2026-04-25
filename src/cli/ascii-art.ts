export type BannerVariant = 'full' | 'compact';

export const RICKY_BANNER = String.raw`        __
   ____/  \__        RICKY
  <__  _    _>
     \_\>--'
      /  \__
     / /\__/
    /_/  \_\
workflow reliability for AgentWorkforce`;

export const RICKY_COMPACT_BANNER = 'ricky · workflow reliability for AgentWorkforce';

const ANSI_CYAN = '\x1b[36m';
const ANSI_BOLD = '\x1b[1m';
const ANSI_DIM = '\x1b[2m';
const ANSI_RESET = '\x1b[0m';

export interface RenderBannerOptions {
  color?: boolean;
  variant?: BannerVariant;
}

export function chooseBannerVariant(columns?: number): BannerVariant {
  return typeof columns === 'number' && columns > 0 && columns < 60 ? 'compact' : 'full';
}

export function shouldUseColor(options: { color?: boolean; isTTY?: boolean; noColor?: boolean } = {}): boolean {
  if (typeof options.color === 'boolean') {
    return options.color;
  }

  const isTTY = options.isTTY ?? process.stdout.isTTY === true;
  const noColor = options.noColor ?? process.env.NO_COLOR !== undefined;
  return isTTY && !noColor;
}

export function renderBanner(options: RenderBannerOptions | BannerVariant = {}): string {
  const normalized = typeof options === 'string' ? { variant: options } : options;
  const variant = normalized.variant ?? 'full';

  if (variant === 'compact') {
    return RICKY_COMPACT_BANNER;
  }

  if (normalized.color !== true) {
    return RICKY_BANNER;
  }

  const lines = RICKY_BANNER.split('\n');
  return [
    `${ANSI_CYAN}${lines[0]}${ANSI_RESET}`,
    `${ANSI_CYAN}   ____/  \\__        ${ANSI_RESET}${ANSI_BOLD}RICKY${ANSI_RESET}`,
    ...lines.slice(2, -1).map((line) => `${ANSI_CYAN}${line}${ANSI_RESET}`),
    `${ANSI_DIM}${lines.at(-1) ?? ''}${ANSI_RESET}`,
  ].join('\n');
}

export function shouldShowBanner(options: {
  quiet?: boolean;
  noBanner?: boolean;
  isTTY?: boolean;
  isFirstRun?: boolean;
  forceOnboarding?: boolean;
} = {}): boolean {
  if (options.quiet === true || options.noBanner === true) {
    return false;
  }

  if (options.isTTY === false) {
    return false;
  }

  if (process.env.RICKY_BANNER === '0') {
    return false;
  }

  return true;
}
