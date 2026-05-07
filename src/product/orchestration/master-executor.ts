import type {
  ChildRunner,
  ChildWorkflowGate,
  ChildWorkflowPlan,
  ChildWorkflowRunResult,
  MasterExecutionPlan,
  MasterExecutionResult,
  MasterExecutorDecision,
  MasterExecutorOptions,
} from './types.js';

export const DEFAULT_MASTER_EXECUTOR_OPTIONS: Readonly<MasterExecutorOptions> = {
  maxConcurrency: 2,
  resume: false,
  failurePolicy: 'stop',
};

const SPLIT_TARGET_FILE_THRESHOLD = 4;

type RuntimeOptions = MasterExecutorOptions & {
  now: () => Date;
};

interface PendingChild {
  child: ChildWorkflowPlan;
  controller: AbortController;
}

export async function runMasterExecution(
  plan: MasterExecutionPlan,
  runner: ChildRunner,
  options: Partial<MasterExecutorOptions> = {},
): Promise<MasterExecutionResult> {
  const resolvedOptions = resolveOptions(options);
  const startedAtDate = resolvedOptions.now();
  const startedAt = startedAtDate.toISOString();
  const childResults: ChildWorkflowRunResult[] = [];
  const finishedByChildId = new Map<string, ChildWorkflowRunResult>();
  const activeControllers = new Set<AbortController>();
  let haltedByFailure: ChildWorkflowRunResult | undefined;

  for (const wave of executionWaves(plan.children)) {
    if (haltedByFailure) {
      break;
    }

    const unfinishedWave = wave.filter((child) => !finishedByChildId.has(child.id));
    const readyChildren = unfinishedWave.filter((child) => dependenciesSatisfied(child, finishedByChildId));
    const blockedByDependency = unfinishedWave.filter((child) => !dependenciesSatisfied(child, finishedByChildId));
    for (const child of blockedByDependency) {
      const cancelled = cancelledRun(child, resolvedOptions, 'A dependency did not complete successfully.');
      childResults.push(cancelled);
      finishedByChildId.set(child.id, cancelled);
    }

    const runChild = async (child: ChildWorkflowPlan): Promise<void> => {
      if (haltedByFailure && resolvedOptions.failurePolicy === 'stop') {
        return;
      }

      const pending = startChild(child, resolvedOptions, activeControllers);
      try {
        const resumeSkip = await maybeResumeSkip(child, resolvedOptions);
        if (resumeSkip) {
          childResults.push(resumeSkip);
          finishedByChildId.set(child.id, resumeSkip);
          return;
        }

        const result = normalizeRunResult(await runner(child, {
          attempt: 1,
          resume: resolvedOptions.resume,
          abortSignal: pending.controller.signal,
        }), child, resolvedOptions);

        childResults.push(result);
        finishedByChildId.set(child.id, result);

        if (resultBlocksProgress(result) && resolvedOptions.failurePolicy === 'stop') {
          haltedByFailure = result;
          abortActive(activeControllers);
        }
      } catch (error) {
        const failed = failedRunFromError(child, error, resolvedOptions);
        childResults.push(failed);
        finishedByChildId.set(child.id, failed);
        if (resolvedOptions.failurePolicy === 'stop') {
          haltedByFailure = failed;
          abortActive(activeControllers);
        }
      } finally {
        activeControllers.delete(pending.controller);
      }
    };

    await runWaveRespectingParallelizable(readyChildren, resolvedOptions.maxConcurrency, runChild);

    if (resolvedOptions.failurePolicy === 'continue') {
      cancelDependentsOfFailedChildren(plan.children, childResults, finishedByChildId, resolvedOptions);
    }
  }

  if (haltedByFailure) {
    cancelUnstartedDependents(plan.children, childResults, finishedByChildId, resolvedOptions);
  }

  const completedAtDate = resolvedOptions.now();
  const completedAt = completedAtDate.toISOString();
  const orderedChildResults = orderChildResults(plan.children, childResults);

  return {
    plan,
    childResults: orderedChildResults,
    decision: classifyDecision(plan.children, orderedChildResults),
    startedAt,
    completedAt,
    durationMs: Math.max(0, completedAtDate.getTime() - startedAtDate.getTime()),
    resumed: resolvedOptions.resume,
  };
}

function resolveOptions(options: Partial<MasterExecutorOptions>): RuntimeOptions {
  const merged = {
    ...DEFAULT_MASTER_EXECUTOR_OPTIONS,
    ...options,
    now: options.now ?? (() => new Date()),
  };

  return {
    ...merged,
    maxConcurrency: boundedConcurrency(merged.maxConcurrency),
  };
}

function boundedConcurrency(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_MASTER_EXECUTOR_OPTIONS.maxConcurrency;
  }
  return Math.max(1, Math.floor(value));
}

function executionWaves(children: readonly ChildWorkflowPlan[]): ChildWorkflowPlan[][] {
  const byWave = new Map<number, ChildWorkflowPlan[]>();
  for (const child of children) {
    const wave = byWave.get(child.wave) ?? [];
    wave.push(child);
    byWave.set(child.wave, wave);
  }

  return [...byWave.entries()]
    .sort(([left], [right]) => left - right)
    .map(([, wave]) => wave);
}

function dependenciesSatisfied(
  child: ChildWorkflowPlan,
  finishedByChildId: ReadonlyMap<string, ChildWorkflowRunResult>,
): boolean {
  return child.dependsOn.every((dependencyId) => {
    const dependency = finishedByChildId.get(dependencyId);
    if (!dependency) return false;
    if (dependency.status !== 'passed' && dependency.status !== 'skipped') return false;
    return dependency.evidence.gateResults.every((gateResult) => gateResult.passed);
  });
}

async function maybeResumeSkip(
  child: ChildWorkflowPlan,
  options: RuntimeOptions,
): Promise<ChildWorkflowRunResult | undefined> {
  if (!options.resume || !options.signoffArtifactReader) {
    return undefined;
  }

  const artifact = await options.signoffArtifactReader(child.signoffArtifactPath);
  if (!artifact?.includes(child.signoffMarker)) {
    return undefined;
  }

  const completedAtDate = options.now();
  const requiredGates = child.gates.filter((gate) => gate.required);
  options.logger?.({
    kind: 'resume_skip',
    childId: child.id,
    message: `Skipping ${child.id}; signoff marker is already present.`,
  });

  return {
    childId: child.id,
    status: 'skipped',
    attempt: 0,
    startedAt: completedAtDate.toISOString(),
    completedAt: completedAtDate.toISOString(),
    durationMs: 0,
    evidence: {
      signoffPresent: true,
      markerPresent: true,
      changedFiles: child.targetFiles,
      gateResults: requiredGates.map((gate) => ({ gateId: gate.id, kind: gate.kind, passed: true })),
      rawNotes: 'Skipped during resume because the signoff artifact contains the required marker.',
    },
  };
}

function startChild(
  child: ChildWorkflowPlan,
  options: RuntimeOptions,
  activeControllers?: Set<AbortController>,
): PendingChild {
  options.logger?.({
    kind: 'child_start',
    childId: child.id,
    message: `Starting ${child.id}.`,
  });

  const pending = { child, controller: new AbortController() };
  activeControllers?.add(pending.controller);
  return pending;
}

function normalizeRunResult(
  result: ChildWorkflowRunResult,
  child: ChildWorkflowPlan,
  options: RuntimeOptions,
): ChildWorkflowRunResult {
  const gateResults = mergeGateResults(child, result.evidence.gateResults);
  const normalized: ChildWorkflowRunResult = {
    ...result,
    evidence: {
      ...result.evidence,
      gateResults,
    },
  };

  options.logger?.({
    kind: 'child_complete',
    childId: child.id,
    message: `${child.id} completed with status ${normalized.status}.`,
  });

  return normalized;
}

function mergeGateResults(
  child: ChildWorkflowPlan,
  gateResults: ChildWorkflowRunResult['evidence']['gateResults'],
): ChildWorkflowRunResult['evidence']['gateResults'] {
  const observed = new Map<string, ChildWorkflowRunResult['evidence']['gateResults'][number]>();
  for (const gateResult of gateResults) {
    observed.set(gateResult.gateId, gateResult);
  }

  return child.gates
    .filter((gate) => gate.required)
    .map((gate) => observed.get(gate.id) ?? {
      gateId: gate.id,
      kind: gate.kind,
      passed: false,
      detail: 'Required gate was not reported by the child runner.',
    });
}

async function runWaveRespectingParallelizable(
  items: readonly ChildWorkflowPlan[],
  maxConcurrency: number,
  worker: (item: ChildWorkflowPlan) => Promise<void>,
): Promise<void> {
  const inFlight = new Set<Promise<void>>();
  const limit = Math.max(1, Math.floor(maxConcurrency));

  for (const child of items) {
    if (!child.parallelizable) {
      while (inFlight.size > 0) {
        await Promise.race(inFlight);
      }
      await worker(child);
      continue;
    }

    while (inFlight.size >= limit) {
      await Promise.race(inFlight);
    }

    let task!: Promise<void>;
    task = (async () => {
      try {
        await worker(child);
      } finally {
        inFlight.delete(task);
      }
    })();
    inFlight.add(task);
  }

  while (inFlight.size > 0) {
    await Promise.race(inFlight);
  }
}

function resultBlocksProgress(result: ChildWorkflowRunResult): boolean {
  return !childResultComplete(result);
}

function abortActive(activeControllers: ReadonlySet<AbortController>): void {
  for (const controller of activeControllers) {
    controller.abort();
  }
}

function failedRunFromError(
  child: ChildWorkflowPlan,
  error: unknown,
  options: RuntimeOptions,
): ChildWorkflowRunResult {
  const completedAtDate = options.now();
  const message = error instanceof Error ? error.message : String(error);

  return {
    childId: child.id,
    status: hasEnvBlockHint(message) ? 'blocked' : 'failed',
    attempt: 1,
    startedAt: completedAtDate.toISOString(),
    completedAt: completedAtDate.toISOString(),
    durationMs: 0,
    evidence: {
      signoffPresent: false,
      markerPresent: false,
      changedFiles: [],
      gateResults: child.gates
        .filter((gate) => gate.required)
        .map((gate) => ({ gateId: gate.id, kind: gate.kind, passed: false, detail: message })),
    },
    ...(hasEnvBlockHint(message) ? { blockedReason: message } : { errorMessage: message }),
  };
}

function cancelDependentsOfFailedChildren(
  children: readonly ChildWorkflowPlan[],
  childResults: ChildWorkflowRunResult[],
  finishedByChildId: Map<string, ChildWorkflowRunResult>,
  options: RuntimeOptions,
): void {
  const failedIds = new Set(
    childResults
      .filter((result) => result.status === 'failed' || result.status === 'blocked' || result.status === 'cancelled')
      .map((result) => result.childId),
  );

  for (const child of children) {
    if (finishedByChildId.has(child.id)) {
      continue;
    }

    if (child.dependsOn.some((dependencyId) => failedIds.has(dependencyId))) {
      const cancelled = cancelledRun(child, options, 'An upstream dependency did not complete successfully.');
      childResults.push(cancelled);
      finishedByChildId.set(child.id, cancelled);
      failedIds.add(child.id);
    }
  }
}

function cancelUnstartedDependents(
  children: readonly ChildWorkflowPlan[],
  childResults: ChildWorkflowRunResult[],
  finishedByChildId: Map<string, ChildWorkflowRunResult>,
  options: RuntimeOptions,
): void {
  for (const child of children) {
    if (finishedByChildId.has(child.id)) {
      continue;
    }

    const cancelled = cancelledRun(child, options, 'Execution stopped after an earlier child did not complete.');
    childResults.push(cancelled);
    finishedByChildId.set(child.id, cancelled);
  }
}

function cancelledRun(child: ChildWorkflowPlan, options: RuntimeOptions, reason: string): ChildWorkflowRunResult {
  const completedAtDate = options.now();
  return {
    childId: child.id,
    status: 'cancelled',
    attempt: 0,
    startedAt: completedAtDate.toISOString(),
    completedAt: completedAtDate.toISOString(),
    durationMs: 0,
    evidence: {
      signoffPresent: false,
      markerPresent: false,
      changedFiles: [],
      gateResults: child.gates
        .filter((gate) => gate.required)
        .map((gate) => ({ gateId: gate.id, kind: gate.kind, passed: false, detail: reason })),
      rawNotes: reason,
    },
    errorMessage: reason,
  };
}

function classifyDecision(
  children: readonly ChildWorkflowPlan[],
  childResults: readonly ChildWorkflowRunResult[],
): MasterExecutorDecision {
  const blocked = childResults.find((result) => result.status === 'blocked');
  if (blocked) {
    return {
      kind: 'blocked',
      childId: blocked.childId,
      missing: extractMissingNames(blocked.blockedReason ?? blocked.errorMessage ?? ''),
    };
  }

  for (const result of childResults) {
    if ((result.status === 'passed' || result.status === 'skipped') && !childResultComplete(result)) {
      return {
        kind: 'repair',
        childId: result.childId,
        reason: `Child ${result.childId} completed without satisfying all required evidence gates.`,
      };
    }

    if (result.status === 'failed' && result.evidence.signoffPresent && !result.evidence.markerPresent) {
      return {
        kind: 'repair',
        childId: result.childId,
        reason: result.errorMessage ?? `Child ${result.childId} wrote signoff evidence without the required marker.`,
      };
    }
  }

  for (const result of childResults) {
    const child = children.find((candidate) => candidate.id === result.childId);
    if (!child || result.status !== 'failed') {
      continue;
    }

    if (child.targetFiles.length > SPLIT_TARGET_FILE_THRESHOLD) {
      return {
        kind: 'split',
        childId: result.childId,
        reason: `Child ${result.childId} failed with ${child.targetFiles.length} target files, which exceeds the split threshold of ${SPLIT_TARGET_FILE_THRESHOLD}.`,
      };
    }

    const failedGateKinds = new Set(
      result.evidence.gateResults
        .filter((gateResult) => !gateResult.passed)
        .map((gateResult) => gateResult.kind),
    );
    if (result.attempt >= child.retryPolicy.maxAttempts && failedGateKinds.size >= 2) {
      return {
        kind: 'split',
        childId: result.childId,
        reason: `Child ${result.childId} exhausted retry budget with multiple failed gate kinds.`,
      };
    }
  }

  for (const result of childResults) {
    const child = children.find((candidate) => candidate.id === result.childId);
    if (!child || result.status !== 'failed') {
      continue;
    }

    const message = result.errorMessage ?? '';
    if (
      result.attempt < child.retryPolicy.maxAttempts &&
      !result.evidence.signoffPresent &&
      !hasEnvBlockHint(message)
    ) {
      return {
        kind: 'retry',
        childId: result.childId,
        reason: result.errorMessage ?? `Child ${result.childId} failed before signoff was written.`,
      };
    }
  }

  if (children.length > 0 && children.every((child) => childComplete(child, childResults))) {
    return { kind: 'complete' };
  }

  const incomplete = childResults.find((result) => !childResultComplete(result));
  return {
    kind: 'escalate',
    childId: incomplete?.childId,
    reason: incomplete
      ? `Child ${incomplete.childId} did not satisfy all required evidence gates.`
      : 'No executable child results were recorded.',
  };
}

function childComplete(child: ChildWorkflowPlan, childResults: readonly ChildWorkflowRunResult[]): boolean {
  const result = childResults.find((candidate) => candidate.childId === child.id);
  if (!result) {
    return false;
  }

  return childResultComplete(result);
}

function childResultComplete(result: ChildWorkflowRunResult): boolean {
  if (result.status !== 'passed' && result.status !== 'skipped') {
    return false;
  }

  return result.evidence.gateResults.every((gateResult) => gateResult.passed);
}

function orderChildResults(
  children: readonly ChildWorkflowPlan[],
  childResults: readonly ChildWorkflowRunResult[],
): readonly ChildWorkflowRunResult[] {
  const remaining = [...childResults];
  const ordered: ChildWorkflowRunResult[] = [];

  for (const child of children) {
    const resultIndex = remaining.findIndex((result) => result.childId === child.id);
    if (resultIndex === -1) {
      continue;
    }

    const [result] = remaining.splice(resultIndex, 1);
    ordered.push(result);
  }

  return [...ordered, ...remaining];
}

function extractMissingNames(text: string): readonly string[] {
  const missing = new Set<string>();
  const envVarPattern = /MISSING_ENV_VAR:\s*([A-Z_][A-Z0-9_]*)/g;
  let match: RegExpExecArray | null;
  while ((match = envVarPattern.exec(text)) !== null) {
    missing.add(match[1]);
  }

  return [...missing];
}

function hasEnvBlockHint(text: string): boolean {
  return /MISSING_ENV_VAR:\s*[A-Z_][A-Z0-9_]*/.test(text);
}
