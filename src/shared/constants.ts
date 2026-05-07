import type { WorkflowValidationPolicy } from './models/workflow-config.js';

export const CHANNEL_PREFIX = 'wf-ricky-';

export const WAVE_FOLDER_NAMES = [
  'wave0-foundation',
  'wave1-runtime',
  'wave2-product',
  'wave3-cloud-api',
  'wave4-local-byoh',
  'wave5-scale-and-ops',
] as const;

export const DEFAULT_MAX_CONCURRENCY = 4;

// Outer wall-clock budget for the entire workflow run. Sized to comfortably
// exceed the longest sequential path of per-step budgets below so that the
// outer process killer never fires before per-step timeouts can do their job.
// Per-step timeouts are the meaningful constraint; this is a safety net.
export const DEFAULT_RUN_TIMEOUT_MS = 14_400_000; // 4 h

export const DEFAULT_TIMEOUT_MS = DEFAULT_RUN_TIMEOUT_MS;

// Per-step budgets for generated workflows. Tuned so that:
//   - implement/fix-loop steps (real codex code-writing) get ~20 min each
//   - lead-plan and review steps get ~10 min each
//   - the sum of the longest sequential path is < DEFAULT_RUN_TIMEOUT_MS
// Bumping any of these requires a corresponding bump to DEFAULT_RUN_TIMEOUT_MS.
export const DEFAULT_STEP_TIMEOUT_MS = 600_000; // 10 min — generic agent step
export const DEFAULT_LEAD_PLAN_TIMEOUT_MS = 600_000; // 10 min — single planner
export const DEFAULT_IMPLEMENT_TIMEOUT_MS = 1_200_000; // 20 min — codex implementation
export const DEFAULT_REVIEW_TIMEOUT_MS = 600_000; // 10 min — per reviewer
export const DEFAULT_FIX_LOOP_TIMEOUT_MS = 1_200_000; // 20 min — bounded fix loop

export const DEFAULT_RETRY_MAX_ATTEMPTS = 2;

export const DEFAULT_AUTO_FIX_ATTEMPTS = 7;

export const DEFAULT_RETRY_BACKOFF_MS = 1_000;

export const DEFAULT_VALIDATION_POLICY = {
  mode: 'standard',
  requireFileExistsGate: true,
  requireTypecheck: true,
  requireReview: true,
  allowUntrackedFiles: false,
} as const satisfies WorkflowValidationPolicy;

export const TERMINAL_STEP_STATUSES = ['passed', 'failed', 'skipped', 'cancelled', 'timed_out'] as const;

export const TERMINAL_RUN_STATUSES = ['passed', 'failed', 'cancelled', 'timed_out'] as const;

export const VERIFICATION_TYPES = [
  'exit_code',
  'file_exists',
  'output_contains',
  'artifact_exists',
  'deterministic_gate',
  'routing_assertion',
  'custom',
] as const;
