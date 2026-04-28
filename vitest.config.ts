import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    exclude: [...configDefaults.exclude, '.claude/**', '.workflow-artifacts/**'],
    globals: true,
    setupFiles: ['test/setup.ts'],
  },
});
