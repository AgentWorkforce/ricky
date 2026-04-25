export interface WelcomeOptions {
  isFirstRun?: boolean;
}

export function renderWelcome(options: WelcomeOptions = {}): string {
  if (options.isFirstRun ?? false) {
    return [
      'Ricky helps you generate, debug, recover, and run workflows.',
      'You can start locally, bring your own harness, or connect Cloud providers.',
      'Hand Ricky the spec. You should not need to hand-write workflows.',
    ].join('\n');
  }

  return 'Ricky is ready. Continue locally, connect Cloud, or hand over the next workflow spec.';
}
