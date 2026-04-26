/**
 * Ricky Failure Diagnosis Engine
 *
 * Classifies runtime blockers into distinct classes and returns
 * class-specific unblocker guidance. Deterministic, pure, no side effects.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BlockerClass =
  | 'runtime-handoff-stall'
  | 'opaque-progress'
  | 'stale-relay-state'
  | 'control-flow-breakage'
  | 'repo-validation-mismatch';

export interface UnblockerGuidance {
  blockerClass: BlockerClass;
  automatable: boolean;
  summary: string;
  steps: string[];
}

export interface DiagnosisInput {
  errorMessage: string;
  context?: Record<string, unknown>;
}

export interface DiagnosisResult {
  input: DiagnosisInput;
  guidance: UnblockerGuidance;
}

// ---------------------------------------------------------------------------
// Rules — first-match dispatch
// ---------------------------------------------------------------------------

interface Rule {
  blockerClass: BlockerClass;
  test: (input: DiagnosisInput) => boolean;
  guidance: UnblockerGuidance;
}

const RULES: Rule[] = [
  {
    blockerClass: 'runtime-handoff-stall',
    test: (i) =>
      /handoff.*(stall|timeout|stuck)/i.test(i.errorMessage) ||
      /stall.*handoff/i.test(i.errorMessage),
    guidance: {
      blockerClass: 'runtime-handoff-stall',
      automatable: true,
      summary: 'Agent handoff stalled — restart the target agent and re-initiate the handoff.',
      steps: [
        'Terminate the stalled agent process.',
        'Clear any pending handoff tokens.',
        'Restart the target agent.',
        'Re-initiate the handoff from the originating agent.',
      ],
    },
  },
  {
    blockerClass: 'opaque-progress',
    test: (i) =>
      /opaque.*(progress|status)/i.test(i.errorMessage) ||
      /progress.*(opaque|unknown|invisible)/i.test(i.errorMessage) ||
      /no.*(progress|status).*(visible|available)/i.test(i.errorMessage),
    guidance: {
      blockerClass: 'opaque-progress',
      automatable: true,
      summary: 'Progress is not observable — inject a progress probe to surface status.',
      steps: [
        'Attach a progress probe to the running task.',
        'Poll the probe at a fixed interval.',
        'If the probe returns no update after 3 cycles, escalate.',
      ],
    },
  },
  {
    blockerClass: 'stale-relay-state',
    test: (i) =>
      /stale.*(relay|state|cache)/i.test(i.errorMessage) ||
      /relay.*(stale|outdated|expired)/i.test(i.errorMessage),
    guidance: {
      blockerClass: 'stale-relay-state',
      automatable: true,
      summary: 'Relay state is stale — invalidate the relay cache and refresh.',
      steps: [
        'Invalidate the relay state cache.',
        'Request a fresh state snapshot from the relay.',
        'Verify the new state before resuming.',
      ],
    },
  },
  {
    blockerClass: 'control-flow-breakage',
    test: (i) =>
      /control.?flow.*(break|broken|corrupt|invalid)/i.test(i.errorMessage) ||
      /(break|broken|corrupt).*(control.?flow)/i.test(i.errorMessage),
    guidance: {
      blockerClass: 'control-flow-breakage',
      automatable: false,
      summary: 'Control flow is broken — manual rollback to the last checkpoint is required.',
      steps: [
        'Identify the last known-good checkpoint.',
        'Rollback execution state to that checkpoint.',
        'Review the control flow graph for the broken segment.',
        'Apply a manual fix before resuming.',
      ],
    },
  },
  {
    blockerClass: 'repo-validation-mismatch',
    test: (i) =>
      /repo.*(valid|mismatch|integrity)/i.test(i.errorMessage) ||
      /validation.*(mismatch|fail|repo)/i.test(i.errorMessage) ||
      /mismatch.*(repo|validation)/i.test(i.errorMessage),
    guidance: {
      blockerClass: 'repo-validation-mismatch',
      automatable: true,
      summary: 'Repository validation failed — re-run validation with --repair flag.',
      steps: [
        'Run repository validation with the --repair flag.',
        'Review the repair report for any unresolved issues.',
        'If issues remain, reset to the last validated commit.',
      ],
    },
  },
];

// ---------------------------------------------------------------------------
// Fallback
// ---------------------------------------------------------------------------

const FALLBACK_GUIDANCE: UnblockerGuidance = {
  blockerClass: 'control-flow-breakage',
  automatable: false,
  summary: 'Unrecognised failure — treat as control-flow breakage and rollback.',
  steps: [
    'Capture full error context for manual review.',
    'Rollback to the last checkpoint.',
    'Escalate to an operator for triage.',
  ],
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Diagnose a single failure input. Returns the first matching blocker class
 * and its unblocker guidance. Falls back to control-flow-breakage if no rule
 * matches.
 */
export function diagnose(input: DiagnosisInput): DiagnosisResult {
  for (const rule of RULES) {
    if (rule.test(input)) {
      return { input, guidance: rule.guidance };
    }
  }
  return { input, guidance: FALLBACK_GUIDANCE };
}

/**
 * Diagnose a batch of failure inputs. Order is preserved.
 */
export function diagnoseBatch(inputs: DiagnosisInput[]): DiagnosisResult[] {
  return inputs.map(diagnose);
}
