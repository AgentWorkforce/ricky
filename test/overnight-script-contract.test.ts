import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const overnightScript = readFileSync('scripts/run-ricky-overnight.sh', 'utf8');

describe('overnight harness queue-exhaustion contract', () => {
  it('does not recover to complete when the runner exited before the active workflow log shows success', () => {
    expect(overnightScript).toContain(
      'if artifact_runner_logs_show_success "$ARTIFACT_DIR" && (',
    );
    expect(overnightScript).toContain(
      'artifact_active_workflow_runner_log_shows_success "$ARTIFACT_DIR"',
    );
  });

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

  it('waits on the detached launcher wrapper instead of the detached runner pid', () => {
    expect(overnightScript).toContain('RUNNER_WAIT_PID=""');
    expect(overnightScript).toContain('raise SystemExit(proc.wait())');
    expect(overnightScript).toContain('waitpid($pid, 0); exit($? >> 8);');
    expect(overnightScript).toContain('if ! wait "${RUNNER_WAIT_PID:-$runner_pid}"; then');
  });

  it('briefly waits for fallback launchers to record the detached child pid before declaring startup failure', () => {
    expect(overnightScript).toContain('while [[ ! -s "$runner_pid_file" && "$pid_wait_attempt" -lt 20 ]]; do');
    expect(overnightScript).toContain('sleep 0.1');
  });
});
