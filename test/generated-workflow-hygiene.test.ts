import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('generated workflow hygiene', () => {
  it('keeps a single current cleanup workflow with the implementation contract', () => {
    const generatedDir = join(process.cwd(), 'workflows', 'generated');
    const cleanupWorkflows = readdirSync(generatedDir)
      .filter((entry) => /clean-up-the-codebase-to-remove/.test(entry))
      .sort();

    expect(cleanupWorkflows).toEqual(['ricky-i-want-to-clean-up-the-codebase-to-remove-outdat.ts']);

    const workflowBody = readFileSync(join(generatedDir, cleanupWorkflows[0]), 'utf8');
    expect(workflowBody).toContain('IMPLEMENTATION_WORKFLOW_CONTRACT');
    expect(workflowBody).toContain('git diff gate comparing git diff --name-status');
  });
});
