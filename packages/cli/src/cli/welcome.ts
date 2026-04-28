export interface WelcomeOptions {
  isFirstRun?: boolean;
}

export const FIRST_RUN_WELCOME = [
  "  Welcome to Ricky! Let's get you set up.",
  '',
  '  Ricky generates workflow artifacts for your repo.',
  '  Running a generated artifact is a separate, opt-in step.',
  '',
  '  What happens by default:',
  '    You give Ricky a spec → Ricky writes a workflow artifact to disk',
  '    → Ricky prints the exact command to run it yourself.',
  '',
  '  Execution only happens when you explicitly pass --run or invoke',
  '  `ricky run <artifact>` (requires npm-linked CLI).',
].join('\n');

export const RETURNING_USER_WELCOME =
  'Ricky is ready. Continue locally, connect Cloud, or hand over the next workflow spec.';

export function renderWelcome(options: WelcomeOptions = { isFirstRun: true }): string {
  if (options.isFirstRun === false) {
    return RETURNING_USER_WELCOME;
  }

  return FIRST_RUN_WELCOME;
}
