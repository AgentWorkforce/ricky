import { afterEach, describe, expect, it, vi } from 'vitest';

describe('runLocal turn-context adapter resilience', () => {
  afterEach(() => {
    vi.doUnmock('@agent-assistant/turn-context');
    vi.resetModules();
  });

  it('keeps local generation working when the shared turn-context assembler throws', async () => {
    vi.resetModules();
    vi.doMock('@agent-assistant/turn-context', () => ({
      createTurnContextAssembler: () => ({
        async assemble(): Promise<never> {
          throw new Error('shared adapter unavailable');
        },
      }),
    }));

    const { runLocal } = await import('./index.js');
    const writes: Array<{ path: string; content: string; cwd: string }> = [];
    const result = await runLocal(
      { source: 'cli', spec: 'generate a workflow for turn context resilience' },
      {
        localExecutor: {
          cwd: '/adapter-resilience',
          artifactWriter: {
            async writeArtifact(path: string, content: string, cwd: string): Promise<void> {
              writes.push({ path, content, cwd });
            },
          },
          returnGeneratedArtifactOnly: true,
        },
      },
    );

    expect(result.ok).toBe(true);
    expect(writes.filter((write) => /^workflows\/generated\/.+\.ts$/.test(write.path))).toHaveLength(1);
    expect(result.logs).toEqual(
      expect.arrayContaining([
        '[local] turn context adapter skipped: shared adapter unavailable',
        '[local] workflow generation: passed',
      ]),
    );
  });
});
