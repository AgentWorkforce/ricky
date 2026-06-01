import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  buildFinalReviewPassGateCommand,
  GATE_BLOCKED_MARKER,
  GATE_MISSING_ARTIFACT_PREFIX,
} from './final-review-gate.js';

const ARTIFACTS = '.workflow-artifacts/generated/demo/update-last-week';

function gate(overrides: { successMarker?: string } = {}): string {
  void overrides;
  return buildFinalReviewPassGateCommand({
    artifactsDir: ARTIFACTS,
    requiredFiles: [
      `${ARTIFACTS}/claude-final-fix.md`,
      `${ARTIFACTS}/codex-final-fix.md`,
      `${ARTIFACTS}/claude-final-fix-status.json`,
      `${ARTIFACTS}/codex-final-fix-status.json`,
    ],
  });
}

describe('buildFinalReviewPassGateCommand', () => {
  it('checks the BLOCKED sentinel before artifact file checks', () => {
    const command = gate();
    const blockedIdx = command.indexOf('BLOCKED_NO_COMMIT.md');
    const firstFileIdx = command.indexOf(`${ARTIFACTS}/claude-final-fix.md`);
    expect(blockedIdx).toBeGreaterThan(-1);
    expect(firstFileIdx).toBeGreaterThan(-1);
    expect(blockedIdx).toBeLessThan(firstFileIdx);
  });

  it('emits a distinct, greppable marker plus the agent evidence when blocked', () => {
    const command = gate();
    expect(command).toContain(`echo '${GATE_BLOCKED_MARKER}' >&2`);
    expect(command).toContain(`cat '${ARTIFACTS}/BLOCKED_NO_COMMIT.md' >&2`);
    // Distinct exit code so the failure is attributable, not a generic exit 1.
    expect(command).toContain('exit 3');
  });

  it('checks non-empty expected artifacts with explicit diagnostics', () => {
    const command = gate();
    expect(command).toContain(`if [ ! -s '${ARTIFACTS}/claude-final-fix.md' ]; then`);
    expect(command).toContain(`if [ ! -s '${ARTIFACTS}/codex-final-fix.md' ]; then`);
    expect(command).toContain(`${GATE_MISSING_ARTIFACT_PREFIX}: ${ARTIFACTS}/claude-final-fix.md`);
    expect(command).toContain(`${GATE_MISSING_ARTIFACT_PREFIX}: ${ARTIFACTS}/codex-final-fix.md`);
    expect(command).not.toContain('grep');
  });

  it('parses final fix status JSON and rejects blocked statuses', () => {
    const command = gate();
    expect(command).toContain(`${ARTIFACTS}/claude-final-fix-status.json`);
    expect(command).toContain(`${ARTIFACTS}/codex-final-fix-status.json`);
    expect(command).toContain('includes(parsed.status)');
    expect(command).toContain('parsed.summary');
  });

  it('embeds status paths as JSON string literals inside node assertions', () => {
    const base = join(tmpdir(), "ricky-final-review-gate-quote's");
    mkdirSync(base, { recursive: true });
    const quoted = join(base, 'claude-final-fix-status.json');
    writeFileSync(quoted, '{"status":"fixed","summary":"quoted path passed"}\n');

    const command = buildFinalReviewPassGateCommand({
      artifactsDir: base,
      requiredFiles: [quoted],
    });

    expect(execFileSync('bash', ['-lc', command], { encoding: 'utf8' })).toContain('RICKY_CHILD_FINAL_REVIEW_FILES_READY');
    expect(command).not.toContain(`throw new Error('${quoted}`);
  });

  it('echoes a structural success marker last', () => {
    const command = gate();
    expect(command.trimEnd().endsWith("echo 'RICKY_CHILD_FINAL_REVIEW_FILES_READY'")).toBe(true);
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
