import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    conditions: ['development'],
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    exclude: [
      ...configDefaults.exclude,
      '.claude/**',
      '.workflow-artifacts/**',
    ],
    globals: true,
    setupFiles: ['test/setup.ts'],
  },
});
