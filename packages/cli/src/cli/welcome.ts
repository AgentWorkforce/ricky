export interface WelcomeOptions {
  isFirstRun?: boolean;
}

export const FIRST_RUN_WELCOME = [
  "  Welcome to Ricky! Let's get you set up.",
  '',
  '  Ricky generates and runs workflow artifacts for your repo.',
  '  Start locally or connect Cloud providers — tell Ricky what you want done.',
  '',
  '  Today, locally, Ricky generates a workflow artifact into your repo.',
  '  Executing it is a separate, opt-in step (--run, or `ricky run <artifact>`',
  '  if the CLI is npm-linked).',
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
