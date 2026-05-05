import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('generated workflow hygiene', () => {
  const deletedSkillMirrorPath = ['.claude', 'skills', 'writing-agent-relay-workflows', 'SKILL.md'].join('/');

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
    expect(workflowBody).toContain('cleanup-candidate-prescan.txt');
    expect(workflowBody).toContain('cite that exact path in');
    expect(workflowBody).toContain('CLEANUP_CANDIDATE_PRESCAN_OK');
    expect(workflowBody).toContain('cleanup-evidence-sanity-gate');
    expect(workflowBody).toContain('CLEANUP_EVIDENCE_SANITY_GATE_OK');
    expect(workflowBody).toContain('final-artifact-consistency-gate');
    expect(workflowBody).toContain('FINAL_ARTIFACT_CONSISTENCY_GATE_OK');
    expect(workflowBody).toContain('final-review-codex marker missing pass sentinel');
    expect(workflowBody).not.toContain("['final-review-codex.md', read('final-review-codex.md')]");
    expect(workflowBody).not.toContain('timeoutMs: 300_000');
    expect(workflowBody).toContain('Tracked agent config files');
    expect(workflowBody).toContain('Relaycast permission references');
    expect(workflowBody).toContain('obsolete package-split workflow cleanup delta');
    expect(workflowBody).toContain("'03-shared-models' + '-and-config.ts'");
    expect(workflowBody).not.toContain(deletedSkillMirrorPath);
    expect(workflowBody).not.toContain('.agent("reviewer-codex"');
  });

  it('hard-gates cleanup evidence before signoff', () => {
    const workflowBody = readFileSync(
      join(process.cwd(), 'workflows', 'generated', 'ricky-i-want-to-clean-up-the-codebase-to-remove-outdat.ts'),
      'utf8',
    );

    expect(workflowBody).toContain('lead plan missing required marker');
    expect(workflowBody).toContain("verification: { type: 'output_contains', value: 'GENERATION_LEAD_PLAN_READY' }");
    expect(workflowBody).toContain('dependsOn: ["lead-plan-gate"]');
    expect(workflowBody).toContain("dependsOn: ['cleanup-candidate-prescan']");
    expect(workflowBody).toContain('cleanup-report.md');
    expect(workflowBody).toContain('cleanup-diff-inventory.txt');
    expect(workflowBody).toContain('validation-evidence.md');
    expect(workflowBody).toContain('manifest lacks status-prefixed changed paths');
    expect(workflowBody).toContain('validation evidence missing deterministic command names');
    expect(workflowBody).toContain('No active references found for:');
    expect(workflowBody).toContain('status-prefixed changed-file inventory and command summaries');
    expect(workflowBody).toContain('missing manifest path');
    expect(workflowBody).toContain('mentions stale non-manifest target');
    expect(workflowBody).toContain("['review-feedback.md', read('review-feedback.md')]");
    expect(workflowBody).toContain("['fix-loop-report.md', read('fix-loop-report.md')]");
  });
});
