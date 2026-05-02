import { checkbox, select } from '@inquirer/prompts';

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
  promptKit?: PromptKit;
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

export interface PromptChoice<Value> {
  value: Value;
  name?: string;
  description?: string;
  short?: string;
  checked?: boolean;
  disabled?: boolean | string;
}

export interface SelectPromptConfig<Value> {
  message: string;
  choices: readonly PromptChoice<Value>[];
  default?: Value;
  pageSize?: number;
  loop?: boolean;
}

export interface CheckboxPromptConfig<Value> {
  message: string;
  choices: readonly PromptChoice<Value>[];
  pageSize?: number;
  loop?: boolean;
  required?: boolean;
}

export interface PromptKit {
  select<Value>(config: SelectPromptConfig<Value>, runtime?: PromptShellRuntime): Promise<Value>;
  checkbox<Value>(config: CheckboxPromptConfig<Value>, runtime?: PromptShellRuntime): Promise<Value[]>;
}

type SelectPrompt = <Value>(
  config: {
    message: string;
    choices: readonly PromptChoice<Value>[];
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

type CheckboxPrompt = <Value>(
  config: {
    message: string;
    choices: readonly PromptChoice<Value>[];
    pageSize?: number;
    loop?: boolean;
    required?: boolean;
  },
  context?: {
    input?: NodeJS.ReadableStream;
    output?: NodeJS.WritableStream;
    clearPromptOnDone?: boolean;
    signal?: AbortSignal;
  },
) => Promise<Value[]>;

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

export function createInquirerPromptKit(deps: {
  selectPrompt?: SelectPrompt;
  checkboxPrompt?: CheckboxPrompt;
} = {}): PromptKit {
  const selectPrompt = deps.selectPrompt ?? select;
  const checkboxPrompt = deps.checkboxPrompt ?? checkbox;

  return {
    async select<Value>(config: SelectPromptConfig<Value>, runtime: PromptShellRuntime = {}) {
      try {
        return await selectPrompt<Value>(config, {
          input: runtime.input,
          output: runtime.output,
          signal: runtime.signal,
        });
      } catch (error) {
        throw normalizePromptError(error, runtime.signal);
      }
    },

    async checkbox<Value>(config: CheckboxPromptConfig<Value>, runtime: PromptShellRuntime = {}) {
      try {
        return await checkboxPrompt<Value>(config, {
          input: runtime.input,
          output: runtime.output,
          signal: runtime.signal,
        });
      } catch (error) {
        throw normalizePromptError(error, runtime.signal);
      }
    },
  };
}

export function createInquirerPromptShell(deps: InquirerPromptShellDeps = {}): PromptShell {
  const promptKit = deps.promptKit ?? createInquirerPromptKit({ selectPrompt: deps.selectPrompt });

  return {
    async selectFirstScreen(runtime = {}) {
      return promptKit.select<PromptShellChoice>(
        {
          message: 'Ricky',
          choices: FIRST_SCREEN_PROMPT_CHOICES,
          default: 'local',
          pageSize: FIRST_SCREEN_PROMPT_CHOICES.length,
          loop: false,
        },
        runtime,
      );
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
