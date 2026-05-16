import { describe, expect, it } from 'vitest';

import {
  buildFinalReviewPassGateCommand,
  GATE_BLOCKED_MARKER,
  GATE_MISSING_MARKER_PREFIX,
} from './final-review-gate.js';

const ARTIFACTS = '.workflow-artifacts/generated/demo/update-last-week';

function gate(overrides: { successMarker?: string } = {}): string {
  return buildFinalReviewPassGateCommand({
    artifactsDir: ARTIFACTS,
    checks: [
      {
        presenceTest: `grep -qF RICKY_CHILD_CLAUDE_FINAL_FIX_READY '${ARTIFACTS}/claude-final-fix.md'`,
        missingDetail: `${ARTIFACTS}/claude-final-fix.md is missing RICKY_CHILD_CLAUDE_FINAL_FIX_READY`,
      },
      {
        presenceTest: `grep -qF RICKY_CHILD_CODEX_FINAL_FIX_READY '${ARTIFACTS}/codex-final-fix.md'`,
        missingDetail: `${ARTIFACTS}/codex-final-fix.md is missing RICKY_CHILD_CODEX_FINAL_FIX_READY`,
      },
    ],
    successMarker: overrides.successMarker ?? 'RICKY_CHILD_FRESH_EYES_LOOP_READY',
  });
}

describe('buildFinalReviewPassGateCommand', () => {
  it('checks the BLOCKED sentinel before any marker grep', () => {
    const command = gate();
    const blockedIdx = command.indexOf('BLOCKED_NO_COMMIT.md');
    const firstGrepIdx = command.indexOf('grep -qF RICKY_CHILD_CLAUDE_FINAL_FIX_READY');
    expect(blockedIdx).toBeGreaterThan(-1);
    expect(firstGrepIdx).toBeGreaterThan(-1);
    expect(blockedIdx).toBeLessThan(firstGrepIdx);
  });

  it('emits a distinct, greppable marker plus the agent evidence when blocked', () => {
    const command = gate();
    expect(command).toContain(`echo '${GATE_BLOCKED_MARKER}' >&2`);
    expect(command).toContain(`cat '${ARTIFACTS}/BLOCKED_NO_COMMIT.md' >&2`);
    // Distinct exit code so the failure is attributable, not a generic exit 1.
    expect(command).toContain('exit 3');
  });

  it('makes each marker check quiet with an explicit missing-marker diagnostic', () => {
    const command = gate();
    // Quiet grep — matched lines must not leak into captured output and look
    // like success while the command actually failed.
    expect(command).toContain('grep -qF RICKY_CHILD_CLAUDE_FINAL_FIX_READY');
    expect(command).not.toMatch(/grep -F RICKY_CHILD_CLAUDE_FINAL_FIX_READY(?!\w)/);
    expect(command).toContain(
      `${GATE_MISSING_MARKER_PREFIX}: ${ARTIFACTS}/claude-final-fix.md is missing RICKY_CHILD_CLAUDE_FINAL_FIX_READY`,
    );
    expect(command).toContain(
      `${GATE_MISSING_MARKER_PREFIX}: ${ARTIFACTS}/codex-final-fix.md is missing RICKY_CHILD_CODEX_FINAL_FIX_READY`,
    );
  });

  it('still echoes the success marker last so the gate can pass', () => {
    const command = gate();
    // shellQuote wraps the marker in single quotes for safe shell embedding.
    expect(command.trimEnd().endsWith("echo 'RICKY_CHILD_FRESH_EYES_LOOP_READY'")).toBe(true);
  });

  it('shell-quotes the success marker (defends against future callers passing metacharacters)', () => {
    const command = gate({ successMarker: 'DONE $(touch /tmp/pwned)' });
    expect(command).toContain("echo 'DONE $(touch /tmp/pwned)'");
    expect(command).not.toContain('echo DONE $(touch');
  });

  it('guards the blocked-evidence cat so a failing read does not short-circuit exit 3', () => {
    const command = gate();
    // The cat call must be inside an `if !` block (so set -e doesn't
    // terminate the script if cat itself fails) followed by an
    // unconditional `exit 3`.
    expect(command).toMatch(/if ! cat .* >&2; then[\s\S]*?fi[\s\S]*?exit 3/);
  });

  it('does not leave a trailing bare `test ! -f` clause that fails opaquely', () => {
    const command = gate();
    expect(command).not.toContain('test ! -f');
  });
});
