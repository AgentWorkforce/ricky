import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('generated workflow hygiene', () => {
  it('keeps only active generated workflows under source control', () => {
    const generatedDir = join(process.cwd(), 'workflows', 'generated');
    const generatedWorkflows = readdirSync(generatedDir)
      .filter((entry) => entry.endsWith('.ts'))
      .sort();

    expect(generatedWorkflows).toEqual(['ricky-i-want-to-clean-up-the-codebase-to-remove-outdat.ts']);

    const workflowBody = readFileSync(
      join(generatedDir, 'ricky-i-want-to-clean-up-the-codebase-to-remove-outdat.ts'),
      'utf8',
    );
    expect(workflowBody).toContain('IMPLEMENTATION_WORKFLOW_CONTRACT');
    expect(workflowBody).toContain('git diff gate comparing git diff --name-status');
    expect(workflowBody).toContain('Codex structural marker gate');
    expect(workflowBody).toContain('must not be presented as independent review evidence');
    expect(workflowBody).not.toContain('.agent("reviewer-codex"');
  });

  it('hard-gates cleanup evidence before signoff', () => {
    const workflowBody = readFileSync(
      join(process.cwd(), 'workflows', 'generated', 'ricky-i-want-to-clean-up-the-codebase-to-remove-outdat.ts'),
      'utf8',
    );

    expect(workflowBody).toContain('lead plan missing required marker');
    expect(workflowBody).toContain("verification: { type: 'output_contains', value: 'GENERATION_LEAD_PLAN_READY' }");
    expect(workflowBody).toContain("dependsOn: ['lead-plan-gate']");
    expect(workflowBody).toContain('cleanup-report.md');
    expect(workflowBody).toContain('cleanup-diff-inventory.txt');
    expect(workflowBody).toContain('validation-evidence.md');
    expect(workflowBody).toContain('basename referenced by');
    expect(workflowBody).toContain('status-prefixed changed-file inventory and command summaries');
  });
});
