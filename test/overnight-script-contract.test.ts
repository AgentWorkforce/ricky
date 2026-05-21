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

  it('prunes empty marker files after writing the artifact summary', () => {
    expect(overnightScript).toContain('prune_empty_artifact_marker_files()');
    expect(overnightScript).toContain('for marker_file in "$FAILED_FILE" "$SKIPPED_FILE" "$STALE_FILE"; do');
    expect(overnightScript).toContain('[[ -f "$marker_file" && ! -s "$marker_file" ]] && rm -f "$marker_file"');
    expect(overnightScript).toContain('write_summary "$status"');
    expect(overnightScript).toContain('prune_empty_artifact_marker_files');
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

  it('finalizes checkpoint and summary when a stop condition is hit before the next workflow', () => {
    expect(overnightScript).toContain('SHOULD_FINALIZE_AND_EXIT="false"');
    expect(overnightScript).toContain('if should_stop_before_next_workflow; then');
    expect(overnightScript).toContain('SHOULD_FINALIZE_AND_EXIT="true"');
    expect(overnightScript).toContain('break 2');
    expect(overnightScript).toContain('if [[ "$SHOULD_FINALIZE_AND_EXIT" == "true" ]]; then');
    expect(overnightScript).toContain('finalize_current_artifact_checkpoint');
    expect(overnightScript).toContain('write_summary "$(cat "$STATUS_FILE")"');
  });

  it('uses meaningful progress, not mere log growth, for idle timeout enforcement', () => {
    expect(overnightScript).toContain('if runner_output_idle_for_too_long "$last_progress_epoch" "$(date +%s)"; then');
    expect(overnightScript).toContain('workflow runner produced no meaningful progress for ${IDLE_TIMEOUT_SECONDS}s: $workflow_path');
  });

  it('treats push rejection during delta capture as a blocking divergence instead of silently continuing', () => {
    expect(overnightScript).not.toContain('git push origin main || true');
    expect(overnightScript).toContain('if ! git push origin main >"$push_output_file" 2>&1; then');
    expect(overnightScript).toContain('push rejected after $workflow_path; local main diverged from origin/main (ahead=${ahead}, behind=${behind})');
    expect(overnightScript).toContain('mark_status "blocked" "push rejected after workflow delta capture: $workflow_path"');
    expect(overnightScript).toContain('mark_status "blocked" "push rejected after failed workflow delta capture: $workflow_path"');
    expect(overnightScript).toContain('mark_status "blocked" "push rejected after idle workflow delta capture: $workflow_path"');
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
    expect(overnightScript).toContain('grep -Fq "Starting workflow');
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

  it('does not treat wave13 as satisfied when a stored review is only ready but still explicitly FAIL', () => {
    expect(overnightScript).toContain('artifact_review_declares_pass()');
    expect(overnightScript).toContain("grep -Eq '^(PASS|\\*\\*PASS\\*\\*)$'");
    expect(overnightScript).toContain("! grep -Eq '^(FAIL|\\*\\*FAIL\\*\\*)$'");
    expect(overnightScript).toContain('.workflow-artifacts/wave13-master-executor/implement-master-executor/review-codex.md');
    expect(overnightScript).toContain('.workflow-artifacts/wave13-master-executor/implement-master-executor/review-claude.md');
  });
});
