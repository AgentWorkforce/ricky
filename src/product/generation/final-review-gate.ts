// Shared builder for the generated child-workflow `final-review-pass-gate`
// command.
//
// Why this exists: the original gate joined marker greps and a
// `test ! -f BLOCKED_NO_COMMIT.md` clause under `set -e` / `&&`. When an
// agent deliberately wrote BLOCKED_NO_COMMIT.md (the "I cannot proceed
// safely, do not commit" protocol), the gate aborted with a bare exit 1 and
// the captured output showed only the *successful* marker greps — masking
// the real cause. Operators saw "grep ... Command failed (exit code 1)"
// with the success markers in stdout and assumed a grep-target mismatch,
// and the auto-fix loop treated a deliberate "needs a human" signal as a
// retryable INVALID_ARTIFACT, looping for hours.
//
// This builder produces a gate command that:
//   1. Checks the BLOCKED sentinel FIRST and, if present, prints a distinct
//      `RICKY_CHILD_BLOCKED_NO_COMMIT` marker plus the agent's evidence to
//      stderr and exits with a dedicated code — so the failure is
//      attributable and can be routed to escalation rather than retry.
//   2. Runs each marker presence check quietly and, on failure, prints an
//      explicit `RICKY_CHILD_GATE_MISSING_MARKER: <detail>` line — so a
//      genuinely missing marker is diagnosable and never hidden behind a
//      previous check's matched-line output.

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export interface GateMarkerCheck {
  /**
   * A shell expression that exits 0 (and produces no stdout) when the marker
   * is present. Keep it quiet — matched lines must not leak into the gate's
   * captured output.
   */
  presenceTest: string;
  /**
   * Human/diagnostic detail appended after `RICKY_CHILD_GATE_MISSING_MARKER: `
   * when `presenceTest` fails.
   */
  missingDetail: string;
}

export interface FinalReviewPassGateOptions {
  /** Directory holding the child workflow's review/fix artifacts. */
  artifactsDir: string;
  /** Ordered marker presence checks (claude first, then codex, etc.). */
  checks: GateMarkerCheck[];
  /** Token echoed on success to satisfy the gate's output assertion. */
  successMarker: string;
}

export const GATE_BLOCKED_MARKER = 'RICKY_CHILD_BLOCKED_NO_COMMIT';
export const GATE_MISSING_MARKER_PREFIX = 'RICKY_CHILD_GATE_MISSING_MARKER';

/**
 * Build the multi-line shell script for `final-review-pass-gate`. Returned as
 * a single string so it can be embedded as a step `command` by either
 * renderer regardless of how that renderer assembles its command.
 */
export function buildFinalReviewPassGateCommand(options: FinalReviewPassGateOptions): string {
  const blockedPath = `${options.artifactsDir}/BLOCKED_NO_COMMIT.md`;
  const lines: string[] = [
    'set -e',
    `if [ -f ${shellQuote(blockedPath)} ]; then`,
    `  echo ${shellQuote(GATE_BLOCKED_MARKER)} >&2`,
    `  echo ${shellQuote(
      'Child workflow gate refused: an agent wrote BLOCKED_NO_COMMIT.md and did not produce a clean signoff. '
      + 'This needs a human decision, not an auto-retry. Evidence:',
    )} >&2`,
    `  cat ${shellQuote(blockedPath)} >&2`,
    '  exit 3',
    'fi',
  ];
  for (const check of options.checks) {
    lines.push(
      `if ! { ${check.presenceTest}; }; then`,
      `  echo ${shellQuote(`${GATE_MISSING_MARKER_PREFIX}: ${check.missingDetail}`)} >&2`,
      '  exit 1',
      'fi',
    );
  }
  lines.push(`echo ${options.successMarker}`);
  return lines.join('\n');
}
