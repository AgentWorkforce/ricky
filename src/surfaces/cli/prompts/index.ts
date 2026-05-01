import { select } from '@inquirer/prompts';

export type PromptShellChoice = 'local' | 'cloud' | 'status' | 'connect' | 'exit';

export interface PromptShellRuntime {
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
  signal?: AbortSignal;
}

export interface PromptShell {
  selectFirstScreen(runtime?: PromptShellRuntime): Promise<PromptShellChoice>;
}

export interface InquirerPromptShellDeps {
  selectPrompt?: SelectPrompt;
}

export class PromptCancelledError extends Error {
  readonly kind: 'abort' | 'exit';

  constructor(kind: 'abort' | 'exit') {
    super(kind === 'abort' ? 'Prompt aborted.' : 'Prompt cancelled.');
    this.name = 'PromptCancelledError';
    this.kind = kind;
  }
}

type SelectPrompt = <Value>(
  config: {
    message: string;
    choices: readonly {
      value: Value;
      name?: string;
      description?: string;
      short?: string;
    }[];
    default?: Value;
    pageSize?: number;
    loop?: boolean;
  },
  context?: {
    input?: NodeJS.ReadableStream;
    output?: NodeJS.WritableStream;
    clearPromptOnDone?: boolean;
    signal?: AbortSignal;
  },
) => Promise<Value>;

export const FIRST_SCREEN_PROMPT_CHOICES: readonly {
  value: PromptShellChoice;
  name: string;
  description: string;
}[] = [
  {
    value: 'local',
    name: 'Local',
    description: 'Generate workflow artifacts in this repo without Cloud credentials.',
  },
  {
    value: 'cloud',
    name: 'Cloud',
    description: 'Use AgentWorkforce Cloud when credentials and providers are ready.',
  },
  {
    value: 'status',
    name: 'Status',
    description: 'Show local readiness and known provider connection state.',
  },
  {
    value: 'connect',
    name: 'Connect tools',
    description: 'Show provider setup commands and dashboard guidance.',
  },
  {
    value: 'exit',
    name: 'Exit',
    description: 'Leave without generating or executing anything.',
  },
];

export function createInquirerPromptShell(deps: InquirerPromptShellDeps = {}): PromptShell {
  const selectPrompt = deps.selectPrompt ?? select;

  return {
    async selectFirstScreen(runtime = {}) {
      try {
        return await selectPrompt<PromptShellChoice>(
          {
            message: 'Ricky',
            choices: FIRST_SCREEN_PROMPT_CHOICES,
            default: 'local',
            pageSize: FIRST_SCREEN_PROMPT_CHOICES.length,
            loop: false,
          },
          {
            input: runtime.input,
            output: runtime.output,
            signal: runtime.signal,
          },
        );
      } catch (error) {
        throw normalizePromptError(error, runtime.signal);
      }
    },
  };
}

export function isPromptCancellation(error: unknown): error is PromptCancelledError {
  if (error instanceof PromptCancelledError) return true;
  if (!(error instanceof Error)) return false;
  return error.name === 'AbortPromptError' || error.name === 'ExitPromptError';
}

function normalizePromptError(error: unknown, signal?: AbortSignal): Error {
  if (signal?.aborted === true) {
    return new PromptCancelledError('abort');
  }

  if (error instanceof Error && (error.name === 'AbortPromptError' || error.name === 'ExitPromptError')) {
    return new PromptCancelledError(error.name === 'AbortPromptError' ? 'abort' : 'exit');
  }

  return error instanceof Error ? error : new Error(String(error));
}
