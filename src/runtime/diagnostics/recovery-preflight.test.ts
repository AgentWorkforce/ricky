import { describe, expect, it } from 'vitest';

import type { ActiveRunSnapshot } from '../types.js';
import {
  BlockerClass,
  FailureTaxonomyCategory,
  RecoveryDecision,
  RerunMode,
  runRuntimePreflight,
} from './index.js';

const STARTED_AT = '2026-04-27T00:00:00.000Z';

describe('runRuntimePreflight', () => {
  it('covers stale relay state, missing config, unsupported validation, active run, and repo mismatch', () => {
    const result = runRuntimePreflight({
      cwd: '/repo',
      requestedRunId: 'run-1',
      requestedWorkflowFile: 'workflows/recovery.ts',
      relayState: [{ path: '.agent-relay', present: true, stale: true, ageMs: 120_000 }],
      requiredConfig: [{ path: '.ricky/config.json', present: false, description: 'Ricky local config' }],
      validationCommands: [
        {
          command: 'npm run prove:missing',
          supported: false,
          reason: 'missing script: prove:missing',
        },
      ],
      repoValidation: {
        command: 'npx tsc --noEmit',
        meaningful: false,
        reason: 'repo has package-level tsconfig only',
      },
      activeRuns: [activeRun()],
    });

    expect(result.ok).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toEqual([
      'stale_relay_state',
      'missing_config',
      'unsupported_validation_command',
      'already_running',
      'repo_validation_mismatch',
    ]);
    expect(result.issues.every((issue) => issue.destructiveCleanupAllowed === false)).toBe(true);
    expect(result.issues.every((issue) => issue.operatorAction)).toBe(true);
  });

  it('blocks environment and active-run issues before rerun or cleanup', () => {
    const result = runRuntimePreflight({
      cwd: '/repo',
      requestedWorkflowFile: 'workflows/recovery.ts',
      relayState: [{ path: '.relay', present: true }],
      requiredConfig: [{ path: '.ricky/config.json', present: false }],
      activeRuns: [activeRun()],
    });

    expect(result.issues).toContainEqual(
      expect.objectContaining({
        code: 'stale_relay_state',
        blockerClass: BlockerClass.StaleRelayState,
        taxonomyCategory: FailureTaxonomyCategory.EnvironmentRelayStateContaminated,
        blocking: true,
        recommendation: expect.objectContaining({
          decision: RecoveryDecision.BlockRerun,
          rerunMode: RerunMode.None,
          rerunAllowed: false,
        }),
      }),
    );
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        code: 'missing_config',
        blockerClass: BlockerClass.MissingConfig,
        taxonomyCategory: FailureTaxonomyCategory.EnvironmentMissingConfig,
        blocking: true,
      }),
    );
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        code: 'already_running',
        blockerClass: BlockerClass.AlreadyRunning,
        taxonomyCategory: FailureTaxonomyCategory.EnvironmentAlreadyRunning,
        blocking: true,
      }),
    );
  });

  it('allows rerun only after validation strategy issues are replaced with truthful gates', () => {
    const result = runRuntimePreflight({
      cwd: '/repo',
      validationCommands: [{ command: 'agent-relay validate --all', supported: false }],
      repoValidation: { command: 'npx tsc --noEmit', meaningful: false },
    });

    expect(result.issues).toEqual([
      expect.objectContaining({
        code: 'unsupported_validation_command',
        taxonomyCategory: FailureTaxonomyCategory.ValidationStrategyUnsupportedCommand,
        blocking: false,
        recommendation: expect.objectContaining({
          decision: RecoveryDecision.ReplaceValidation,
          rerunMode: RerunMode.FullRerun,
          rerunAllowed: true,
          requiresMutation: false,
        }),
      }),
      expect.objectContaining({
        code: 'repo_validation_mismatch',
        taxonomyCategory: FailureTaxonomyCategory.ValidationStrategyRepoMismatch,
        blocking: false,
        recommendation: expect.objectContaining({
          decision: RecoveryDecision.ReplaceValidation,
          rerunMode: RerunMode.FullRerun,
          rerunAllowed: true,
          requiresMutation: false,
        }),
      }),
    ]);
  });

  it('passes when all observed environment inputs are clean', () => {
    const result = runRuntimePreflight({
      cwd: '/repo',
      requestedWorkflowFile: 'workflows/recovery.ts',
      relayState: [{ path: '.agent-relay', present: false }],
      requiredConfig: [{ path: '.ricky/config.json', present: true }],
      validationCommands: [{ command: 'npx vitest run packages/runtime/src', supported: true }],
      repoValidation: { command: 'npx vitest run packages/runtime/src', meaningful: true },
      activeRuns: [
        {
          ...activeRun(),
          runId: 'other-run',
          workflowFile: 'workflows/other.ts',
        },
      ],
    });

    expect(result).toEqual({ ok: true, issues: [] });
  });
});

function activeRun(): ActiveRunSnapshot {
  return {
    runId: 'run-1',
    workflowFile: 'workflows/recovery.ts',
    cwd: '/repo',
    status: 'running',
    startedAt: STARTED_AT,
    retry: { attempt: 1 },
    invocation: {
      command: 'agent-relay',
      args: ['run', 'workflows/recovery.ts'],
      cwd: '/repo',
    },
  };
}
