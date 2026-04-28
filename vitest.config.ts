import { existsSync } from 'node:fs';

import { configDefaults, defineConfig } from 'vitest/config';

const preCollapseWorkspaceLayout = existsSync(new URL('./packages', import.meta.url));
const includeFlatLayoutProof = process.env.RICKY_INCLUDE_FLAT_LAYOUT_PROOF === '1';

export default defineConfig({
  resolve: {
    conditions: ['development'],
  },
  test: {
    environment: 'node',
    include: ['packages/*/src/**/*.test.ts', 'test/**/*.test.ts'],
    exclude: [
      ...configDefaults.exclude,
      '.claude/**',
      '.workflow-artifacts/**',
      ...(preCollapseWorkspaceLayout && !includeFlatLayoutProof ? ['test/flat-layout-proof/**'] : []),
    ],
    globals: true,
    setupFiles: ['test/setup.ts'],
  },
});
