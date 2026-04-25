export interface WelcomeOptions {
  isFirstRun?: boolean;
}

export function renderWelcome(options: WelcomeOptions = { isFirstRun: true }): string {
  if (options.isFirstRun === false) {
    return 'Ricky is ready. Continue locally, connect Cloud, or hand over the next workflow spec.';
  }

  return [
    "  Welcome to Ricky! Let's get you set up.",
    '',
    '  Ricky helps you generate, debug, recover, and run workflows.',
    '  You can start locally, bring your own harness, or connect Cloud providers.',
    '  Tell Ricky what you want done. You should not need to hand-write workflows.',
  ].join('\n');
}
