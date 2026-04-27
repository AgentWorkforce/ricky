/**
 * Bounded interactive Ricky CLI entry surface.
 *
 * Composes onboarding, local/BYOH execution, Cloud generation,
 * and runtime failure diagnosis into a single deterministic entrypoint.
 *
 * Design invariants:
 * - Local and Cloud paths are distinct and truthful — no silent fallback.
 * - Local failures surface runtime diagnosis guidance, not raw errors.
 * - Cloud failures surface bounded recovery guidance, not fake success.
 * - All side-effecting dependencies are injectable for deterministic tests.
 */

import type { OnboardingResult, RickyConfigStore } from '../cli/onboarding.js';
import type { RickyMode } from '../cli/mode-selector.js';
import type { CloudExecutor, CloudGenerateResult } from '@ricky/cloud/api/generate-endpoint.js';
import type { CloudGenerateRequest } from '@ricky/cloud/api/request-types.js';
import type { LocalExecutor, LocalResponse } from '@ricky/local/entrypoint.js';
import type { RawHandoff } from '@ricky/local/request-normalizer.js';
import type { Diagnosis, DiagnosticSignal } from '@ricky/runtime/diagnostics/failure-diagnosis.js';

import {
  renderRecoveryGuidance,
  renderWorkflowGenerationFailureRecovery,
  runOnboarding,
} from '../cli/onboarding.js';
import { toRickyMode } from '../cli/mode-selector.js';
import { handleCloudGenerate } from '@ricky/cloud/api/generate-endpoint.js';
import { runLocal } from '@ricky/local/entrypoint.js';
import { diagnose } from '@ricky/runtime/diagnostics/failure-diagnosis.js';
import { resolve } from 'node:path';

// ---------------------------------------------------------------------------
// Interactive CLI result contract
// ---------------------------------------------------------------------------

export interface InteractiveCliResult {
  /** Whether the interactive session completed without fatal errors. */
  ok: boolean;
  /** The resolved execution mode after onboarding. */
  mode: RickyMode;
  /** Onboarding output (banner, welcome, mode selection). */
  onboarding: OnboardingResult;
  /** Local execution result, if the local path was taken. */
  localResult?: LocalResponse;
  /** Cloud generation result, if the cloud path was taken. */
  cloudResult?: CloudGenerateResult;
  /** Runtime diagnoses surfaced for local failures. */
  diagnoses: Diagnosis[];
  /** Recovery guidance lines surfaced to the user. */
  guidance: string[];
  /** True when Ricky only completed onboarding / mode selection and did not execute. */
  awaitingInput?: boolean;
}

// ---------------------------------------------------------------------------
// Dependencies — all injectable for deterministic testing
// ---------------------------------------------------------------------------

export interface InteractiveCliDeps {
  /** Onboarding runner — defaults to the real runOnboarding. */
  onboard?: (options: {
    input?: NodeJS.ReadableStream;
    output?: NodeJS.WritableStream;
    isTTY?: boolean;
    mode?: RickyMode;
    configStore?: RickyConfigStore;
  }) => Promise<OnboardingResult>;

  /** Caller workspace path for local artifact generation. Defaults to INIT_CWD or process.cwd(). */
  cwd?: string;

  /** Local executor for the BYOH path. */
  localExecutor?: LocalExecutor;

  /** Cloud executor for the hosted generation path. */
  cloudExecutor?: CloudExecutor;

  /** Diagnostic engine — defaults to the real diagnose function. */
  diagnoseFn?: (signal: DiagnosticSignal) => Diagnosis | null;

  /** The raw handoff to execute (spec, source, mode). */
  handoff?: RawHandoff;

  /** Cloud request context — required when mode is 'cloud'. */
  cloudRequest?: CloudGenerateRequest;

  /** Config store override for onboarding. */
  configStore?: RickyConfigStore;

  /** Explicit mode override — skips interactive selection. */
  mode?: RickyMode;

  /** Stream overrides for non-interactive / test contexts. */
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
  isTTY?: boolean;
}

// ---------------------------------------------------------------------------
// Local path — execute with diagnosis on failure
// ---------------------------------------------------------------------------

async function executeLocalPath(
  deps: InteractiveCliDeps,
  _mode: RickyMode,
): Promise<{ localResult?: LocalResponse; diagnoses: Diagnosis[]; guidance: string[]; awaitingInput: boolean }> {
  if (!deps.handoff) {
    return {
      diagnoses: [],
      guidance: [
        'Local handoff blocker:',
        '  Ricky is ready for a real spec or workflow handoff.',
        '  no spec was provided for local execution, so nothing was generated and nothing was executed.',
        '  Current CLI command layer is limited to onboarding, mode selection, and local spec handoff.',
        '',
        'Recovery:',
        '  These commands generate a workflow artifact only. Add --run to also execute it.',
        '  Inline spec: npm start -- --mode local --spec "generate a workflow for package checks"',
        '  File spec:   npm start -- --mode local --spec-file ./path/to/spec.md',
        '  Stdin spec:  printf "%s\\n" "run workflows/release.workflow.ts" | npm start -- --mode local --stdin',
        '  Generate + run: append --run to any of the above (opt-in execution).',
        '  Run existing artifact: ricky run workflows/generated/<file>.ts',
        '',
        'Cloud setup guidance remains available through: npx agent-relay cloud connect google',
      ],
      awaitingInput: true,
    };
  }

  const localResult = await runLocal(deps.handoff, {
    executor: deps.localExecutor,
    localExecutor: deps.localExecutor
      ? undefined
      : {
          cwd: resolveLocalInvocationRoot(deps),
          returnGeneratedArtifactOnly: deps.handoff.stageMode !== 'run',
        },
  });

  const diagnoses: Diagnosis[] = [];
  const guidance: string[] = [];

  if (!localResult.ok) {
    // Attempt runtime diagnosis on each log/warning signal
    const signals: DiagnosticSignal[] = [
      ...localResult.logs.map((msg) => ({ source: 'local-runtime', message: msg })),
      ...localResult.warnings.map((msg) => ({ source: 'local-runtime', message: msg })),
    ];

    const diagnoseFn = deps.diagnoseFn ?? diagnose;
    for (const signal of signals) {
      const d = diagnoseFn(signal);
      if (d) diagnoses.push(d);
    }

    if (diagnoses.length > 0) {
      // Surface structured diagnosis guidance instead of raw error
      for (const d of diagnoses) {
        guidance.push(`[${d.label}] ${d.unblocker.action}`);
        guidance.push(`  Rationale: ${d.unblocker.rationale}`);
      }
    } else {
      // No specific diagnosis matched — surface generic recovery guidance
      const firstWarning = localResult.warnings[0] ?? localResult.logs[0] ?? null;
      guidance.push(renderRecoveryGuidance(firstWarning));
    }
  }

  return { localResult, diagnoses, guidance, awaitingInput: false };
}

function resolveLocalInvocationRoot(deps: InteractiveCliDeps): string {
  if (deps.handoff?.invocationRoot) return resolve(deps.handoff.invocationRoot);
  if (deps.cwd) return resolve(deps.cwd);
  if (process.env.INIT_CWD) return resolve(process.env.INIT_CWD);
  return resolve(process.cwd());
}

// ---------------------------------------------------------------------------
// Cloud path — generate with bounded recovery on failure
// ---------------------------------------------------------------------------

async function executeCloudPath(
  deps: InteractiveCliDeps,
): Promise<{ cloudResult?: CloudGenerateResult; guidance: string[] }> {
  const guidance: string[] = [];

  if (!deps.cloudRequest) {
    guidance.push('Cloud mode selected but no Cloud request context was provided.');
    guidance.push('Provide auth and workspace context to use Cloud generation.');
    return { guidance };
  }

  try {
    const response = await handleCloudGenerate(deps.cloudRequest, {
      executor: deps.cloudExecutor,
    });

    if (!response.ok) {
      // Cloud generation failed — surface bounded recovery, not fake success
      guidance.push(renderWorkflowGenerationFailureRecovery());
      for (const w of response.warnings) {
        if (w.severity === 'error') {
          guidance.push(`  Cloud error: ${w.message}`);
        }
      }
      return {
        cloudResult: {
          artifacts: response.artifacts,
          warnings: response.warnings,
          followUpActions: response.followUpActions,
        },
        guidance,
      };
    }

    return {
      cloudResult: {
        artifacts: response.artifacts,
        warnings: response.warnings,
        followUpActions: response.followUpActions,
      },
      guidance,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    guidance.push(renderWorkflowGenerationFailureRecovery());
    guidance.push(`  Unexpected Cloud error: ${message}`);
    return { guidance };
  }
}

// ---------------------------------------------------------------------------
// Main interactive CLI entrypoint
// ---------------------------------------------------------------------------

/**
 * Run the interactive Ricky CLI session.
 *
 * 1. Runs onboarding (banner, welcome, mode selection).
 * 2. Based on the resolved mode, executes the local or cloud path.
 * 3. On local failure, surfaces runtime diagnosis guidance.
 * 4. On cloud failure, surfaces bounded recovery guidance.
 * 5. Returns a unified result contract.
 */
export async function runInteractiveCli(
  deps: InteractiveCliDeps = {},
): Promise<InteractiveCliResult> {
  const onboard = deps.onboard ?? runOnboarding;

  // Step 1: Onboarding
  const onboarding = await onboard({
    input: deps.input,
    output: deps.output,
    isTTY: deps.isTTY,
    mode: deps.mode,
    configStore: deps.configStore,
    compactForExecution: deps.handoff !== undefined,
    skipFirstRunPersistence: deps.handoff !== undefined,
  });

  const mode = toRickyMode(onboarding.mode);

  // Step 2: Route based on mode
  if (mode === 'cloud') {
    const { cloudResult, guidance } = await executeCloudPath(deps);
    return {
      ok: cloudResult !== undefined && guidance.length === 0,
      mode,
      onboarding,
      cloudResult,
      diagnoses: [],
      guidance,
    };
  }

  if (mode === 'local' || mode === 'both') {
    const { localResult, diagnoses, guidance, awaitingInput } = await executeLocalPath(deps, mode);

    // For 'both' mode, also attempt Cloud if local succeeded
    let cloudResult: CloudGenerateResult | undefined;
    if (mode === 'both' && localResult?.ok && deps.cloudRequest) {
      const cloud = await executeCloudPath(deps);
      cloudResult = cloud.cloudResult;
      guidance.push(...cloud.guidance);
    }

    return {
      ok: awaitingInput ? true : (localResult?.ok ?? false),
      mode,
      onboarding,
      localResult,
      cloudResult,
      diagnoses,
      guidance,
      awaitingInput,
    };
  }

  // Unreachable for valid RickyMode, but TypeScript exhaustiveness
  return {
    ok: true,
    mode,
    onboarding,
    diagnoses: [],
    guidance: [],
  };
}
