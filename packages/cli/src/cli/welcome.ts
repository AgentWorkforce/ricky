export interface WelcomeOptions {
  isFirstRun?: boolean;
}

export const FIRST_RUN_WELCOME = [
  "  Welcome to Ricky! Let's get you set up.",
  '',
  '  Ricky helps you generate, debug, recover, and run workflows.',
  '  You can start locally, bring your own harness, or connect Cloud providers.',
  '  Tell Ricky what you want done. You should not need to hand-write workflows.',
  '',
  '  Today, locally, Ricky generates a workflow artifact into your repo.',
  '  Executing it is a separate, opt-in step (--run, or `ricky run <artifact>`).',
  '  Ricky will print the exact next command after generation.',
].join('\n');

export const RETURNING_USER_WELCOME =
  'Ricky is ready. Continue locally, connect Cloud, or hand over the next workflow spec.';

export function renderWelcome(options: WelcomeOptions = { isFirstRun: true }): string {
  if (options.isFirstRun === false) {
    return RETURNING_USER_WELCOME;
  }

  return FIRST_RUN_WELCOME;
}
