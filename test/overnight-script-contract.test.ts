import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const overnightScript = readFileSync('scripts/run-ricky-overnight.sh', 'utf8');

describe('overnight harness queue-exhaustion contract', () => {
  it('reports stale-only queue exhaustion as blocked with a migration-specific reason', () => {
    expect(overnightScript).toContain(
      'mark_status "blocked" "queue exhausted because remaining workflows are migration-blocked stale workflows: stale=${effective_removed_stale}, satisfied=${effective_removed_satisfied}, missing=${effective_removed_missing}"',
    );
  });

  it('still distinguishes missing-workflow exhaustion from clean no-op completion', () => {
    expect(overnightScript).toContain(
      'mark_status "blocked" "queue exhausted because remaining workflows are missing: stale=${effective_removed_stale}, satisfied=${effective_removed_satisfied}, missing=${effective_removed_missing}"',
    );
    expect(overnightScript).toContain(
      'mark_status "complete" "queue exhausted with no actionable workflows after repo-state filtering"',
    );
  });

  it('captures stale workflow identities in the artifact summary path', () => {
    expect(overnightScript).toContain('stale_workflows:');
    expect(overnightScript).toContain("$(sort -u \"$STALE_FILE\" 2>/dev/null | sed 's/^/  - /' || true)");
  });
});
