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

export const DEFAULT_RUN_TIMEOUT_MS = 600_000;

export const DEFAULT_TIMEOUT_MS = DEFAULT_RUN_TIMEOUT_MS;

export const DEFAULT_STEP_TIMEOUT_MS = 300_000;

export const DEFAULT_RETRY_MAX_ATTEMPTS = 2;

export const DEFAULT_RETRY_BACKOFF_MS = 1_000;

export const DEFAULT_VALIDATION_POLICY = {
  mode: 'standard',
  requireFileExistsGate: true,
  requireTypecheck: true,
  requireReview: true,
  allowUntrackedFiles: false,
} as const satisfies WorkflowValidationPolicy;

export const TERMINAL_STEP_STATUSES = ['passed', 'failed', 'skipped', 'timed_out'] as const;

export const TERMINAL_RUN_STATUSES = ['passed', 'failed', 'timed_out'] as const;

export const VERIFICATION_TYPES = ['exit_code', 'file_exists', 'output_contains', 'custom'] as const;
