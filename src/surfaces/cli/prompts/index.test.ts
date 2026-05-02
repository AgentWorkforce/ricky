import { describe, expect, it, vi } from 'vitest';

import {
  FIRST_SCREEN_PROMPT_CHOICES,
  PromptCancelledError,
  createInquirerPromptShell,
} from './index.js';

describe('createInquirerPromptShell', () => {
  it('uses the injected select prompt and returns the compact first-screen choice', async () => {
    const selectPrompt = vi.fn().mockResolvedValue('status');
    const shell = createInquirerPromptShell({ selectPrompt });

    await expect(shell.selectFirstScreen()).resolves.toBe('status');
    expect(selectPrompt).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Ricky',
        choices: FIRST_SCREEN_PROMPT_CHOICES,
        default: 'local',
        pageSize: FIRST_SCREEN_PROMPT_CHOICES.length,
        loop: false,
      }),
      expect.any(Object),
    );
  });

  it('normalizes AbortController cancellation into PromptCancelledError', async () => {
    const controller = new AbortController();
    const selectPrompt = vi.fn(async (_config: unknown, context?: { signal?: AbortSignal }) => {
      expect(context?.signal).toBe(controller.signal);
      controller.abort();
      throw Object.assign(new Error('Prompt aborted'), { name: 'AbortPromptError' });
    });
    const shell = createInquirerPromptShell({ selectPrompt });

    await expect(shell.selectFirstScreen({ signal: controller.signal })).rejects.toMatchObject({
      kind: 'abort',
    });
    await expect(shell.selectFirstScreen({ signal: controller.signal })).rejects.toBeInstanceOf(PromptCancelledError);
  });
});
