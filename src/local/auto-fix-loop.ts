import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { delimiter, dirname, isAbsolute, join, resolve } from 'node:path';

import type { LocalInvocationRequest } from './request-normalizer.js';
import type { LocalClassifiedBlocker, LocalResponse } from './entrypoint.js';
import { classifyFailure as defaultClassifyFailure } from '../runtime/failure/classifier.js';
import type { FailureClassification } from '../runtime/failure/types.js';
import { debugWorkflowRun as defaultDebugWorkflowRun } from '../product/specialists/debugger/debugger.js';
import type { DebuggerResult } from '../product/specialists/debugger/types.js';
import type { WorkflowRunEvidence, WorkflowStepEvidence } from '../shared/models/workflow-evidence.js';
import { repairWorkflowWithWorkforcePersona } from '../product/generation/workforce-persona-repairer.js';

export interface AutoFixAttemptSummary {
  attempt: number;
  status: 'ok' | 'blocker' | 'error';
  blocker_code?: string;
  run_id?: string;
  tracking_run_id?: string;
  failed_step?: string;
  applied_fix?: Record<string, unknown>;
  fix_error?: string;
  warning?: string;
}

export interface WorkflowRepairInput {
  request: LocalInvocationRequest;
  response: LocalResponse;
  evidence: WorkflowRunEvidence;
  classification: FailureClassification;
  debuggerResult: DebuggerResult;
  artifactPath: string;
  artifactContent: string;
  cwd: string;
  failedStep?: string;
  runId?: string;
  attempt: number;
  maxAttempts: number;
}

export interface WorkflowRepairResult {
  applied: boolean;
  content?: string;
  artifactPath?: string;
  summary: string;
  warnings?: string[];
  runId?: string | null;
}

interface AutoFixEscalationContext {
  request: LocalInvocationRequest;
  response: LocalResponse;
  debuggerResult: DebuggerResult;
  reason: string;
  trackingRunId: string;
  artifactPath?: string;
  failedStep?: string;
}

export interface RunWithAutoFixOptions {
  maxAttempts: number;
  runSingleAttempt: (request: LocalInvocationRequest) => Promise<LocalResponse>;
  classifyFailure?: (evidence: WorkflowRunEvidence) => FailureClassification;
  debugWorkflowRun?: (input: {
    evidence: WorkflowRunEvidence;
    classification: FailureClassification;
  }) => DebuggerResult;
  workflowRepairer?: (input: WorkflowRepairInput) => Promise<WorkflowRepairResult>;
  artifactWriter?: (artifactPath: string, content: string, cwd: string) => Promise<void>;
  repairRunner?: (command: string, cwd: string) => Promise<{ exitCode: number }>;
  sleep?: (ms: number) => Promise<void>;
}

const DEFAULT_BACKOFF_MS = 500;

export async function runWithAutoFix(
  request: LocalInvocationRequest,
  options: RunWithAutoFixOptions,
): Promise<LocalResponse> {
  const maxAttempts = clampAttempts(options.maxAttempts);
  const classifyFailure = options.classifyFailure ?? defaultClassifyFailure;
  const debugWorkflowRun = options.debugWorkflowRun ?? defaultDebugWorkflowRun;
  const workflowRepairer = options.workflowRepairer ?? defaultWorkflowRepairer;
  const artifactWriter = options.artifactWriter ?? writeWorkflowArtifact;
  const repairRunner = options.repairRunner ?? runShellCommand;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const attempts: AutoFixAttemptSummary[] = [];
  const warnings: string[] = [];
  const trackingRunId = resolveTrackingRunId(request) ?? `ricky-local-${randomUUID()}`;
  let currentRequest: LocalInvocationRequest = { ...request, autoFix: undefined };
  let lastResponse: LocalResponse | undefined;
  let retryOfRunId: string | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const response = await options.runSingleAttempt(currentRequest);
    lastResponse = response;

    if (response.ok) {
      const summary: AutoFixAttemptSummary = {
        attempt,
        status: 'ok',
        ...(trackingRunId ? { tracking_run_id: trackingRunId } : {}),
        ...runIdPart(resolveRunId(response)),
      };
      attempts.push(summary);
      return withAutoFix(response, maxAttempts, attempts, 'ok', warnings, trackingRunId);
    }

    const evidence = localResponseToWorkflowRunEvidence(response, attempt);
    const failedStep = failedStepFromEvidence(evidence);
    const runId = resolveRunId(response);
    const blockerCode = response.execution?.blocker?.code;
    const attemptSummary: AutoFixAttemptSummary = {
      attempt,
      status: response.execution?.status === 'blocker' ? 'blocker' : 'error',
      ...(blockerCode ? { blocker_code: blockerCode } : {}),
      ...(failedStep ? { failed_step: failedStep } : {}),
      ...(trackingRunId ? { tracking_run_id: trackingRunId } : {}),
      ...runIdPart(runId),
    };
    attempts.push(attemptSummary);

    if (attempt >= maxAttempts) {
      return withAutoFix(response, maxAttempts, attempts, attemptSummary.status, warnings, trackingRunId);
    }

    const classification = classifyFailure(evidence);
    const debuggerResult = debugWorkflowRun({ evidence, classification });
    const repairTarget = await resolveWorkflowRepairTarget(currentRequest, response);

    if (repairTarget) {
      try {
        const repair = await workflowRepairer({
          request: currentRequest,
          response,
          evidence,
          classification,
          debuggerResult,
          artifactPath: repairTarget.artifactPath,
          artifactContent: repairTarget.artifactContent,
          cwd: repairTarget.cwd,
          ...(failedStep ? { failedStep } : {}),
          ...(runId ? { runId } : {}),
          attempt,
          maxAttempts,
        });

        if (!repair.applied || !repair.content) {
          attemptSummary.fix_error = repair.summary || 'Workforce persona repair did not return a repaired workflow artifact.';
          const escalated = withAutoFix(response, maxAttempts, attempts, attemptSummary.status, warnings, trackingRunId);
          escalated.nextActions = [
            ...escalated.nextActions,
            debuggerResult.summary,
            ...debuggerResult.recommendation.steps.map((step) => step.description),
          ];
          attachEscalationOptions(escalated, {
            request: currentRequest,
            response,
            debuggerResult,
            reason: attemptSummary.fix_error,
            trackingRunId,
            artifactPath: repairTarget.artifactPath,
            ...(failedStep ? { failedStep } : {}),
          });
          return escalated;
        }

        const repairedArtifactPath = repair.artifactPath ?? repairTarget.artifactPath;
        await artifactWriter(repairedArtifactPath, repair.content, repairTarget.cwd);
        attemptSummary.applied_fix = {
          mode: 'workforce-persona',
          artifact_path: repairedArtifactPath,
          summary: repair.summary,
          ...(repair.runId ? { persona_run_id: repair.runId } : {}),
        };
        warnings.push(...(repair.warnings ?? []));

        if (!runId) {
          const warning = 'Auto-fix retry could not resolve a previous run id; retrying without step-level resume.';
          attemptSummary.warning = warning;
          warnings.push(warning);
        } else if (!retryOfRunId) {
          retryOfRunId = runId;
        }

        currentRequest = {
          ...retryBaseRequest(currentRequest, response, repairedArtifactPath, repair.content),
          autoFix: undefined,
          retry: {
            attempt: attempt + 1,
            maxAttempts,
            ...(runId ? { previousRunId: runId, retryOfRunId: retryOfRunId ?? runId } : {}),
            ...(failedStep ? { startFromStep: failedStep } : {}),
            reason: `auto-fix retry after Workforce workflow persona repair for ${blockerCode ?? 'local failure'}`,
          },
        };
        continue;
      } catch (error) {
        attemptSummary.fix_error = error instanceof Error ? error.message : String(error);
        const escalated = withAutoFix(response, maxAttempts, attempts, attemptSummary.status, warnings, trackingRunId);
        escalated.nextActions = [
          ...escalated.nextActions,
          'Ricky could not apply the Workforce workflow persona repair automatically.',
          debuggerResult.summary,
          ...debuggerResult.recommendation.steps.map((step) => step.description),
        ];
        attachEscalationOptions(escalated, {
          request: currentRequest,
          response,
          debuggerResult,
          reason: attemptSummary.fix_error,
          trackingRunId,
          artifactPath: repairTarget.artifactPath,
          ...(failedStep ? { failedStep } : {}),
        });
        return escalated;
      }
    }

    const repairMode = isV1DirectBlocker(blockerCode) ? 'direct' : debuggerResult.repairMode;
    if (repairMode !== 'direct') {
      const guided = withAutoFix(response, maxAttempts, attempts, attemptSummary.status, warnings, trackingRunId);
      guided.nextActions = [
        ...guided.nextActions,
        debuggerResult.summary,
        ...debuggerResult.recommendation.steps.map((step) => step.description),
      ];
      attachEscalationOptions(guided, {
        request: currentRequest,
        response,
        debuggerResult,
        reason: 'Ricky could not identify a safe automatic workflow repair target.',
        trackingRunId,
        ...(failedStep ? { failedStep } : {}),
      });
      return guided;
    }

    const fix = await applyDirectRepair(response.execution?.blocker, {
      cwd: response.execution?.execution.cwd ?? request.invocationRoot ?? process.cwd(),
      repairRunner,
      sleep,
    });
    attemptSummary.applied_fix = { mode: 'direct', steps: fix.steps, exit_code: fix.exitCode };

    if (fix.exitCode !== 0) {
      attemptSummary.fix_error = fix.error ?? 'direct repair failed';
      const escalated = withAutoFix(response, maxAttempts, attempts, attemptSummary.status, warnings, trackingRunId);
      escalated.nextActions = [
        ...escalated.nextActions,
        ...(response.execution?.blocker?.recovery.steps ?? []),
      ];
      attachEscalationOptions(escalated, {
        request: currentRequest,
        response,
        debuggerResult,
        reason: attemptSummary.fix_error,
        trackingRunId,
        artifactPath: resolveArtifactPath(currentRequest, response),
        ...(failedStep ? { failedStep } : {}),
      });
      return escalated;
    }

    if (!runId) {
      const warning = 'Auto-fix retry could not resolve a previous run id; retrying without step-level resume.';
      attemptSummary.warning = warning;
      warnings.push(warning);
    } else if (!retryOfRunId) {
      retryOfRunId = runId;
    }

    currentRequest = {
      ...retryBaseRequest(currentRequest, response),
      autoFix: undefined,
      retry: {
        attempt: attempt + 1,
        maxAttempts,
        ...(runId ? { previousRunId: runId, retryOfRunId: retryOfRunId ?? runId } : {}),
        ...(failedStep ? { startFromStep: failedStep } : {}),
        reason: `auto-fix retry after ${blockerCode ?? 'local failure'}`,
      },
    };
  }

  return withAutoFix(lastResponse ?? failedBeforeAttempt(request), maxAttempts, attempts, 'error', warnings, trackingRunId);
}

function isV1DirectBlocker(code: string | undefined): boolean {
  return code === 'MISSING_BINARY' || code === 'NETWORK_TRANSIENT';
}

async function defaultWorkflowRepairer(input: WorkflowRepairInput): Promise<WorkflowRepairResult> {
  const result = await repairWorkflowWithWorkforcePersona({
    repoRoot: input.cwd,
    artifactPath: input.artifactPath,
    artifactContent: input.artifactContent,
    evidence: input.evidence,
    classification: input.classification,
    debuggerResult: input.debuggerResult,
    blocker: input.response.execution?.blocker,
    ...(input.failedStep ? { failedStep: input.failedStep } : {}),
    ...(input.runId ? { previousRunId: input.runId } : {}),
    attempt: input.attempt,
    maxAttempts: input.maxAttempts,
  });

  return {
    applied: true,
    artifactPath: input.artifactPath,
    content: result.artifact.content,
    summary: summaryFromRepairMetadata(result.artifact.metadata),
    warnings: result.metadata.warnings,
    runId: result.metadata.runId,
  };
}

function summaryFromRepairMetadata(metadata: Record<string, unknown>): string {
  const summary = metadata.summary;
  return typeof summary === 'string' && summary.trim()
    ? summary
    : 'Workforce workflow persona repaired the workflow artifact.';
}

async function resolveWorkflowRepairTarget(
  request: LocalInvocationRequest,
  response: LocalResponse,
): Promise<{ artifactPath: string; artifactContent: string; cwd: string } | null> {
  const artifactPath = resolveArtifactPath(request, response);
  if (!artifactPath) return null;

  const cwd = response.execution?.execution.cwd ?? request.invocationRoot ?? process.cwd();
  const inlineArtifact = response.artifacts.find((candidate) => candidate.path === artifactPath && candidate.content);
  if (inlineArtifact?.content) {
    return { artifactPath, artifactContent: inlineArtifact.content, cwd };
  }

  if (request.source === 'workflow-artifact' && request.specPath === artifactPath && request.spec.trim()) {
    return { artifactPath, artifactContent: request.spec, cwd };
  }

  try {
    const absolutePath = isAbsolute(artifactPath) ? artifactPath : resolve(cwd, artifactPath);
    const artifactContent = await readFile(absolutePath, 'utf8');
    return { artifactPath, artifactContent, cwd };
  } catch {
    return null;
  }
}

function resolveArtifactPath(request: LocalInvocationRequest, response: LocalResponse): string | undefined {
  return (
    response.execution?.execution.workflow_file ??
    response.execution?.execution.artifact_path ??
    response.generation?.artifact?.path ??
    response.artifacts[0]?.path ??
    request.specPath
  );
}

async function writeWorkflowArtifact(artifactPath: string, content: string, cwd: string): Promise<void> {
  const absolutePath = isAbsolute(artifactPath) ? artifactPath : resolve(cwd, artifactPath);
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, content, 'utf8');
}

function retryBaseRequest(
  request: LocalInvocationRequest,
  response: LocalResponse,
  overrideArtifactPath?: string,
  overrideArtifactContent?: string,
): LocalInvocationRequest {
  const artifactPath = overrideArtifactPath ?? resolveArtifactPath(request, response);
  if (!artifactPath) return request;

  const artifact = response.artifacts.find((candidate) => candidate.path === artifactPath);
  return {
    ...request,
    source: 'workflow-artifact',
    spec: overrideArtifactContent ?? artifact?.content ?? request.spec,
    structuredSpec: undefined,
    specPath: artifactPath,
    stageMode: 'run',
    metadata: {
      ...request.metadata,
      autoFixGeneratedFrom: request.source,
    },
  };
}

function clampAttempts(value: number): number {
  return Math.min(10, Math.max(1, Math.trunc(value)));
}

function withAutoFix(
  response: LocalResponse,
  maxAttempts: number,
  attempts: AutoFixAttemptSummary[],
  finalStatus: 'ok' | 'blocker' | 'error',
  warnings: string[],
  trackingRunId: string | undefined,
): LocalResponse {
  return {
    ...response,
    warnings: [...response.warnings, ...warnings],
    auto_fix: {
      max_attempts: maxAttempts,
      attempts: attempts.map((attempt) => ({ ...attempt })),
      final_status: finalStatus,
      ...(trackingRunId ? { run_id: trackingRunId } : {}),
      resumed: attempts.length > 1,
    },
    exitCode: finalStatus === 'ok' ? 0 : response.exitCode ?? 2,
  };
}

function attachEscalationOptions(target: LocalResponse, context: AutoFixEscalationContext): void {
  if (!target.auto_fix) return;
  const escalation = buildAutoFixEscalation(context);
  target.auto_fix = {
    ...target.auto_fix,
    escalation,
  };
}

function buildAutoFixEscalation(context: AutoFixEscalationContext): NonNullable<NonNullable<LocalResponse['auto_fix']>['escalation']> {
  const recoverySteps = context.response.execution?.blocker?.recovery.steps ?? [];
  const options: NonNullable<NonNullable<LocalResponse['auto_fix']>['escalation']>['options'] = [];
  const artifactPath = context.artifactPath ?? resolveArtifactPath(context.request, context.response);
  const runCommand = artifactPath ? `ricky run --artifact ${artifactPath}` : undefined;

  if (runCommand) {
    options.push({
      label: 'Open the workflow and retry',
      description: context.failedStep
        ? `Inspect the workflow step "${context.failedStep}", apply the fix, then rerun attached so the full error is visible.`
        : 'Inspect the workflow artifact, apply the fix, then rerun attached so the full error is visible.',
      command: `${runCommand} --foreground --no-auto-fix`,
    });
  }

  for (const step of recoverySteps.slice(0, 3)) {
    options.push({
      label: 'Try recovery step',
      description: step,
      command: isShellLikeRecoveryStep(step) ? step : undefined,
    });
  }

  if (context.trackingRunId) {
    options.push({
      label: 'Check run status and saved logs',
      description: 'Use the Ricky run id to inspect the persisted evidence, log paths, and auto-fix attempts.',
      command: `ricky status --run ${context.trackingRunId}`,
    });
  }

  if (runCommand) {
    options.push({
      label: 'Retry with auto-fix disabled',
      description: 'Use this when you want the original blocker without another repair attempt.',
      command: `${runCommand} --no-auto-fix`,
    });
  }

  if (options.length === 0) {
    options.push({
      label: 'Inspect the logs',
      description: 'Review the log tail and blocker message, then rerun after applying the missing prerequisite.',
    });
  }

  return {
    summary: [
      'Ricky checked the run logs, classifier, and workflow debugger output, but could not choose one safe automatic fix.',
      `Reason: ${context.reason}`,
      `Debugger: ${context.debuggerResult.summary}`,
    ].join(' '),
    log_tail: relevantLogTail(context.response),
    options: dedupeOptions(options).slice(0, 5),
  };
}

function isShellLikeRecoveryStep(step: string): boolean {
  return /^(?:npm|pnpm|yarn|bun|corepack|ricky|npx|agent-relay|export|test|command|gh)\b/.test(step.trim());
}

function relevantLogTail(response: LocalResponse): string[] {
  const lines = [
    ...(response.execution?.evidence?.logs.tail ?? []),
    ...response.logs,
    ...(response.warnings ?? []),
    response.execution?.evidence?.outcome_summary,
    response.execution?.blocker?.message,
  ].filter((line): line is string => Boolean(line && line.trim()));

  return [...new Set(lines)].slice(-8);
}

function dedupeOptions<T extends { label: string; description: string; command?: string }>(options: T[]): T[] {
  const seen = new Set<string>();
  const deduped: T[] = [];
  for (const option of options) {
    const key = `${option.label}\n${option.description}\n${option.command ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(option);
  }
  return deduped;
}

function failedBeforeAttempt(request: LocalInvocationRequest): LocalResponse {
  return {
    ok: false,
    artifacts: [],
    logs: [`[auto-fix] no attempts completed for ${request.source}`],
    warnings: ['Auto-fix loop did not complete an attempt.'],
    nextActions: ['Inspect local runtime setup and retry.'],
    exitCode: 1,
  };
}

async function applyDirectRepair(
  blocker: LocalClassifiedBlocker | undefined,
  options: {
    cwd: string;
    repairRunner: (command: string, cwd: string) => Promise<{ exitCode: number }>;
    sleep: (ms: number) => Promise<void>;
  },
): Promise<{ steps: string[]; exitCode: number; error?: string }> {
  if (!blocker) return { steps: [], exitCode: 1, error: 'missing blocker' };

  if (blocker.code === 'NETWORK_TRANSIENT' || blocker.code === 'NETWORK_UNREACHABLE') {
    await options.sleep(DEFAULT_BACKOFF_MS);
    return { steps: ['backoff retry'], exitCode: 0 };
  }

  if (blocker.code !== 'MISSING_BINARY') {
    return { steps: [], exitCode: 1, error: `unsupported direct repair for ${blocker.code}` };
  }

  const steps = repairCommandsForMissingBinary(blocker);
  for (const step of steps) {
    const result = await options.repairRunner(step, options.cwd);
    if (result.exitCode !== 0) {
      return { steps, exitCode: result.exitCode, error: `repair command failed: ${step}` };
    }
  }

  const verified = await verifyMissingBinary(blocker, options.cwd);
  return {
    steps,
    exitCode: verified ? 0 : 1,
    ...(verified ? {} : { error: 'missing binary verification failed' }),
  };
}

function repairCommandsForMissingBinary(blocker: LocalClassifiedBlocker): string[] {
  const installCommands = blocker.recovery.steps.filter((step) =>
    /^(?:npm|pnpm|yarn|bun|corepack)\b/.test(step.trim()) && !/\brun\b/.test(step),
  );
  return installCommands.length > 0 ? installCommands : blocker.recovery.steps;
}

async function verifyMissingBinary(blocker: LocalClassifiedBlocker, cwd: string): Promise<boolean> {
  for (const missing of blocker.context.missing) {
    if (missing.includes('/') || missing.includes('\\')) {
      const resolved = isAbsolute(missing) ? missing : resolve(cwd, missing);
      try {
        await access(resolved, constants.X_OK);
        return true;
      } catch {
        continue;
      }
    }
    if (await commandExists(missing, cwd)) return true;
  }
  return blocker.context.missing.length === 0;
}

async function commandExists(command: string, cwd: string): Promise<boolean> {
  const pathValue = process.env.PATH ?? '';
  for (const pathEntry of pathValue.split(delimiter)) {
    if (!pathEntry) continue;
    const candidate = join(pathEntry, command);
    try {
      await access(candidate, constants.X_OK);
      return true;
    } catch {
      // Continue.
    }
  }
  try {
    await access(resolve(cwd, 'node_modules', '.bin', command), constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function runShellCommand(command: string, cwd: string): Promise<{ exitCode: number }> {
  return new Promise((resolveResult) => {
    const child = spawn(command, { cwd, shell: true, stdio: 'ignore' });
    child.once('error', () => resolveResult({ exitCode: 1 }));
    child.once('exit', (code) => resolveResult({ exitCode: code ?? 1 }));
  });
}

function resolveRunId(response: LocalResponse): string | undefined {
  const fromStage = response.execution?.execution.run_id;
  if (fromStage) return fromStage;
  const text = [
    ...response.logs,
    ...(response.execution?.evidence?.logs.tail ?? []),
  ].join('\n');
  return text.match(/\bRun ID:\s*([^\s]+)/i)?.[1];
}

function failedStepFromEvidence(evidence: WorkflowRunEvidence): string | undefined {
  return evidence.steps.find((step) => step.status === 'failed')?.stepId;
}

function localResponseToWorkflowRunEvidence(response: LocalResponse, attempt: number): WorkflowRunEvidence {
  const execution = response.execution;
  const startedAt = execution?.execution.started_at ?? new Date().toISOString();
  const completedAt = execution?.execution.finished_at;
  const failedStepId = execution?.evidence?.failed_step?.id;
  const failedStepName = execution?.evidence?.failed_step?.name ?? failedStepId ?? 'local runtime';
  const step: WorkflowStepEvidence = {
    stepId: failedStepId ?? 'local-runtime',
    stepName: failedStepName,
    status: response.ok ? 'passed' : 'failed',
    startedAt,
    completedAt,
    durationMs: execution?.execution.duration_ms,
    verifications: (execution?.evidence?.assertions ?? []).map((assertion) => ({
      type: 'custom',
      passed: assertion.status === 'pass',
      expected: assertion.name,
      actual: assertion.detail,
      message: assertion.detail,
    })),
    deterministicGates: [],
    logs: (execution?.evidence?.logs.tail ?? []).map((excerpt) => ({ stream: 'stderr', excerpt })),
    artifacts: response.artifacts.map((artifact) => ({ path: artifact.path, kind: 'file' })),
    history: [],
    retries: [],
    narrative: [],
    ...(response.ok ? {} : { error: execution?.blocker?.message ?? response.warnings[0] }),
  };

  return {
    runId: resolveRunId(response) ?? `ricky-auto-fix-attempt-${attempt}`,
    workflowId: execution?.execution.workflow_id ?? 'ricky-local',
    workflowName: execution?.execution.workflow_file ?? response.generation?.artifact?.path ?? 'ricky-local',
    status: response.ok ? 'passed' : 'failed',
    steps: [step],
    startedAt,
    ...(completedAt ? { completedAt } : {}),
    durationMs: execution?.execution.duration_ms,
    deterministicGates: [],
    artifacts: response.artifacts.map((artifact) => ({ path: artifact.path, kind: 'file' })),
    logs: [
      ...response.logs.map((excerpt) => ({ stream: 'system' as const, excerpt })),
      ...(execution?.evidence?.logs.tail ?? []).map((excerpt) => ({ stream: 'stderr' as const, excerpt })),
    ],
    narrative: [],
    routing: [],
  };
}

function runIdPart(runId: string | undefined): { run_id?: string } {
  return runId ? { run_id: runId } : {};
}

function resolveTrackingRunId(request: LocalInvocationRequest): string | undefined {
  const fromMetadata = request.metadata.rickyRunId ?? request.metadata.runId;
  if (typeof fromMetadata === 'string' && fromMetadata.trim()) return fromMetadata;
  return request.requestId;
}
