import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    exclude: [
      ...configDefaults.exclude,
      '.claude/**',
      '.workflow-artifacts/**',
      '.agent-relay/**',
      '.agent-relay.stale.*/**',
      'dist/**',
      'tmp/**',
    ],
    globals: true,
    setupFiles: ['test/setup.ts'],
  },
});
