// Shared builder for the generated child-workflow `final-review-pass-gate`.
// It verifies structural completion evidence only: expected artifact files
// exist and no agent raised BLOCKED_NO_COMMIT.md. Behavioral proof remains in
// the following hard validation gate.

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export interface FinalReviewPassGateOptions {
  /** Directory holding the child workflow's review/fix artifacts. */
  artifactsDir: string;
  /** Expected non-empty final fix artifacts. */
  requiredFiles: string[];
}

export const GATE_BLOCKED_MARKER = 'RICKY_CHILD_BLOCKED_NO_COMMIT';
export const GATE_MISSING_ARTIFACT_PREFIX = 'RICKY_CHILD_GATE_MISSING_ARTIFACT';

/**
 * Build the multi-line shell script for `final-review-pass-gate`.
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
    // `set -e` is active above. A failing `cat` (file removed between the
    // `-f` check and this read, file not readable, etc.) would terminate
    // the script before `exit 3` and regress blocked routing back to a
    // generic non-attributable exit. Guard the cat so we always reach
    // `exit 3`; emit a fallback marker on stderr if the evidence couldn't
    // be read so the blocked routing is still observable.
    `  if ! cat ${shellQuote(blockedPath)} >&2; then`,
    `    echo ${shellQuote(`${GATE_BLOCKED_MARKER}: unable to read BLOCKED_NO_COMMIT.md evidence`)} >&2`,
    '  fi',
    '  exit 3',
    'fi',
  ];
  for (const file of options.requiredFiles) {
    lines.push(
      `if [ ! -s ${shellQuote(file)} ]; then`,
      `  echo ${shellQuote(`${GATE_MISSING_ARTIFACT_PREFIX}: ${file}`)} >&2`,
      '  exit 1',
      'fi',
    );
  }
  for (const file of options.requiredFiles.filter((candidate) => candidate.endsWith('-status.json'))) {
    lines.push(
      `node -e ${shellQuote(`const fs=require('node:fs'); const parsed=JSON.parse(fs.readFileSync(${JSON.stringify(file)}, 'utf8')); if (!['fixed','no_issues_found'].includes(parsed.status)) throw new Error('${file} must declare status fixed or no_issues_found'); if (typeof parsed.summary !== 'string' || parsed.summary.trim().length === 0) throw new Error('${file} must include a non-empty summary');`)}`,
    );
  }
  lines.push("echo 'RICKY_CHILD_FINAL_REVIEW_FILES_READY'");
  return lines.join('\n');
}
