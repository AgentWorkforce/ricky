import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const overnightScript = readFileSync('scripts/run-ricky-overnight.sh', 'utf8');

describe('overnight harness queue-exhaustion contract', () => {
  it('does not recover to complete when the runner exited before the active workflow log shows success', () => {
    expect(overnightScript).toContain(
      'if artifact_runner_logs_show_success "$ARTIFACT_DIR" && (',
    );
    expect(overnightScript).toContain(
      'artifact_checkpoint_indicates_queue_exhausted "$ARTIFACT_DIR" ||',
    );
    expect(overnightScript).toContain(
      'artifact_checkpoint_has_active_workflow "$ARTIFACT_DIR" &&',
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

  it('uses meaningful progress, not mere log growth, for idle timeout enforcement', () => {
    expect(overnightScript).toContain('if runner_output_idle_for_too_long "$last_progress_epoch" "$(date +%s)"; then');
    expect(overnightScript).toContain('workflow runner produced no meaningful progress for ${IDLE_TIMEOUT_SECONDS}s: $workflow_path');
  });

  it('does not quarantine runtime directories that still contain tracked repo files', () => {
    expect(overnightScript).toContain('path_contains_tracked_files()');
    expect(overnightScript).toContain('git ls-files -- "$candidate"');
    expect(overnightScript).toContain('leaving repo runtime state in place because git tracks files under it: $candidate');
  });

  it('restores quarantined runtime state when resume reconciles a dead prior artifact', () => {
    expect(overnightScript).toContain('restore_quarantined_runtime_state_for_artifact "$previous_artifact_dir"');
    expect(overnightScript).toContain('reconciled prior overnight artifact with no live process: $previous_artifact_dir');
  });

  it('trusts the active runner log when it clearly declares the expected workflow identity', () => {
    expect(overnightScript).toContain('runner_output_declares_expected_workflow()');
    expect(overnightScript).toContain('grep -Fq "Workflow');
    expect(overnightScript).toContain('$expected_workflow_name-workflow');
    expect(overnightScript).toContain('"$runner_output"');
    expect(overnightScript).toContain(
      'if runner_output_declares_expected_workflow "$runner_output" "$expected_workflow_name"; then',
    );
    expect(overnightScript).toContain(
      'runner_executed_unexpected_workflow "$workflow_path" "$workflow_runs_start_line" "$runner_output"',
    );
  });
});
