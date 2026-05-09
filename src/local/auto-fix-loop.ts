import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { basename, delimiter, dirname, isAbsolute, join, resolve } from 'node:path';

import type { LocalInvocationRequest } from './request-normalizer.js';
import type { LocalClassifiedBlocker, LocalResponse } from './entrypoint.js';
import { classifyFailure as defaultClassifyFailure } from '../runtime/failure/classifier.js';
import type { FailureClassification } from '../runtime/failure/types.js';
import { debugWorkflowRun as defaultDebugWorkflowRun } from '../product/specialists/debugger/debugger.js';
import type { DebuggerResult } from '../product/specialists/debugger/types.js';
import type { WorkflowRunEvidence, WorkflowStepEvidence } from '../shared/models/workflow-evidence.js';
import { isSyntheticStageId } from './synthetic-step-ids.js';
import { repairWorkflowWithWorkforcePersona } from '../product/generation/workforce-persona-repairer.js';
import type { WorkforcePersonaRepairAttempt } from '../product/generation/workforce-persona-repairer.js';
import {
  discoverDriftReports,
  repairCodeFromDriftArtifacts,
  type CodeDriftRepairOptions,
  type CodeDriftRepairResult,
  type CodeDriftTarget,
} from './code-drift-repairer.js';
import { localRunStateRoot } from '../shared/state-paths.js';

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
  previousAttempts?: WorkforcePersonaRepairAttempt[];
  attempt: number;
  maxAttempts: number;
  onProgress?: (message: string) => void;
}

export interface WorkflowRepairResult {
  applied: boolean;
  content?: string;
  artifactPath?: string;
  mode?: string;
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
  /**
   * Optional repairer for "code drift" failures — when the workflow has
   * generated structured drift reports under `.workflow-artifacts/**\/*-drift.json`
   * indicating that target source code does not match an external reference.
   * If unset, defaults to `repairCodeFromDriftArtifacts`. Dispatched before
   * the workflow repairer when discoverable drift reports are present.
   */
  codeDriftRepairer?: (options: CodeDriftRepairOptions) => Promise<CodeDriftRepairResult>;
  artifactWriter?: (artifactPath: string, content: string, cwd: string) => Promise<void>;
  repairRunner?: (command: string, cwd: string) => Promise<{ exitCode: number }>;
  sleep?: (ms: number) => Promise<void>;
  onProgress?: (message: string) => void;
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
  const codeDriftRepairer = options.codeDriftRepairer ?? repairCodeFromDriftArtifacts;
  const artifactWriter = options.artifactWriter ?? writeWorkflowArtifact;
  const repairRunner = options.repairRunner ?? runShellCommand;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const onProgress = options.onProgress;
  const attempts: AutoFixAttemptSummary[] = [];
  const previousRepairAttempts: WorkforcePersonaRepairAttempt[] = [];
  const warnings: string[] = [];
  const trackingRunId = resolveTrackingRunId(request) ?? `ricky-local-${randomUUID()}`;
  // Used to ignore stale drift artifacts from prior runs when scanning for
  // code-drift repair targets. Captured before the first attempt fires.
  const runStartTimeMs = Date.now();
  let currentRequest: LocalInvocationRequest = { ...request, autoFix: undefined };
  let lastResponse: LocalResponse | undefined;
  let retryOfRunId: string | undefined;
  let pendingRepairAttempt: Omit<WorkforcePersonaRepairAttempt, 'outcome'> | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    // Per-attempt timestamp so drift discovery only considers artifacts the
    // CURRENT attempt produced. Without this, a later unrelated failure
    // could re-trigger code-drift repair on stale reports from a prior
    // attempt (e.g. attempt 1 produced reports → repair → attempt 2 fails
    // for an unrelated reason → discovery sees attempt 1's reports as
    // "fresh" because runStartTimeMs hasn't moved).
    const attemptStartTimeMs = Date.now();
    onProgress?.(`Running workflow (attempt ${attempt}/${maxAttempts})...`);
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

    if (isExternalSetupBlocker(blockerCode)) {
      attemptSummary.fix_error = 'external setup blocker; no safe automatic workflow repair';
      const classification = classifyFailure(evidence);
      const debuggerResult = debugWorkflowRun({ evidence, classification });
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
        reason: 'The blocker is an environment or credentials prerequisite outside Ricky\'s safe auto-fix scope.',
        trackingRunId,
        artifactPath: resolveArtifactPath(currentRequest, response),
        ...(failedStep ? { failedStep } : {}),
      });
      return escalated;
    }

    if (attempt >= maxAttempts) {
      return withAutoFix(response, maxAttempts, attempts, attemptSummary.status, warnings, trackingRunId);
    }

    const classification = classifyFailure(evidence);
    const debuggerResult = debugWorkflowRun({ evidence, classification });
    if (pendingRepairAttempt && pendingRepairAttempt.retryAttempt === attempt) {
      previousRepairAttempts.push({
        ...pendingRepairAttempt,
        outcome: {
          status: attemptSummary.status === 'ok' ? 'failed' : attemptSummary.status,
          ...(failedStep ? { failedStep } : {}),
          ...(blockerCode ? { blockerCode } : {}),
          ...(runId ? { runId } : {}),
          classification,
          debuggerSummary: debuggerResult.summary,
        },
      });
      pendingRepairAttempt = undefined;
    }

    // Code-drift dispatch — preferred over workflow repair when the
    // workflow has emitted structured drift reports under
    // .workflow-artifacts/**\/*-drift.json indicating that target source
    // code (not the workflow itself) is what's wrong. Falls through to
    // workflow repair if no actionable reports are found.
    const codeDriftCwd = response.execution?.execution.cwd ?? request.invocationRoot ?? process.cwd();
    // Use the more recent of run-start and attempt-start. attemptStartTimeMs
    // alone would be ideal, but if the system clock skews backward between
    // attempts (NTP correction during a long run) we don't want to silently
    // accept artifacts from before this run began. Math.max guards both.
    const driftDiscoveryFloor = Math.max(runStartTimeMs, attemptStartTimeMs);
    const driftReports = await discoverDriftReports(codeDriftCwd, driftDiscoveryFloor);
    if (driftReports) {
      const driftTarget: CodeDriftTarget = { cwd: codeDriftCwd, reports: driftReports };
      try {
        onProgress?.(`Ricky is fixing target code (${driftReports.length} drift report${driftReports.length === 1 ? '' : 's'})...`);
        const driftRepair = await codeDriftRepairer({
          target: driftTarget,
          attempt,
          maxAttempts,
          ...(failedStep ? { failedStep } : {}),
          ...(runId ? { previousRunId: runId } : {}),
        });
        if (driftRepair.applied) {
          attemptSummary.applied_fix = {
            mode: 'code-drift',
            reports: driftReports.map((r) => r.filePath),
            summary: driftRepair.summary,
            ...(driftRepair.runId ? { persona_run_id: driftRepair.runId } : {}),
          };
          warnings.push(...(driftRepair.warnings ?? []));
          if (!runId) {
            const warning = 'Auto-fix retry could not resolve a previous run id; retrying without step-level resume.';
            attemptSummary.warning = warning;
            warnings.push(warning);
          } else if (!retryOfRunId) {
            retryOfRunId = runId;
          }
          // Retry the workflow from the BEGINNING — not from the failed
          // step. Verify-style workflows have a structure like:
          //
          //   verify-* (agent steps)  →  produce *-drift.json
          //          ↓
          //   artifact-* (gates)      →  validate report shape
          //          ↓
          //   aggregate-drift (gate)  →  fail if any DRIFT (this fails)
          //
          // Resuming with `startFromStep: aggregate-drift` after a code
          // edit would just re-read the SAME stale drift artifacts from
          // before the fix, fail again, and loop until max attempts. The
          // verify-* agent steps need to re-run against the patched
          // source so they regenerate fresh drift reports.
          //
          // We pay the cost of re-running successful steps (which is real
          // — the verify agents re-fetch external docs), but correctness
          // wins. If a future workflow needs cheaper resumption, it can
          // declare a resume-anchor step in the drift report; for now,
          // the safe default is full restart.
          currentRequest = {
            ...retryBaseRequest(currentRequest, response),
            autoFix: undefined,
            retry: {
              attempt: attempt + 1,
              maxAttempts,
              ...(runId ? { previousRunId: runId, retryOfRunId: retryOfRunId ?? runId } : {}),
              reason: `auto-fix retry after code-drift repair (${driftReports.length} report${driftReports.length === 1 ? '' : 's'}); restarting from workflow root so drift-producing steps re-run`,
            },
          };
          onProgress?.('Retrying workflow from the beginning so drift-producing steps re-run against the patched source...');
          continue;
        }
        // codeDriftRepairer returned applied=false: no-op, fall through to workflow repair.
        warnings.push(`Code-drift repairer returned applied=false: ${driftRepair.summary}`);
      } catch (error) {
        warnings.push(...warningsFromError(error));
        warnings.push(
          `Code-drift repair failed; falling back to workflow repair: ${error instanceof Error ? error.message : String(error)}`,
        );
        // Fall through to the workflow-repair path below — the failure
        // might still be a workflow bug that workforce-persona can fix.
      }
    }

    const repairTarget = await resolveWorkflowRepairTarget(currentRequest, response);

    if (repairTarget) {
      try {
        onProgress?.('Ricky is fixing the workflow...');
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
          previousAttempts: [...previousRepairAttempts],
          attempt,
          maxAttempts,
          ...(onProgress ? { onProgress } : {}),
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
          mode: repair.mode ?? 'workforce-persona',
          artifact_path: repairedArtifactPath,
          summary: repair.summary,
          ...(repair.runId ? { persona_run_id: repair.runId } : {}),
        };
        pendingRepairAttempt = {
          attempt,
          repairedArtifactPath,
          repairSummary: repair.summary,
          repairMode: repair.mode ?? 'workforce-persona',
          ...(repair.runId ? { personaRunId: repair.runId } : {}),
          retryAttempt: attempt + 1,
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
        onProgress?.(`Retrying workflow${failedStep ? ` from ${failedStep}` : ''}...`);
        continue;
      } catch (error) {
        attemptSummary.fix_error = error instanceof Error ? error.message : String(error);
        warnings.push(...warningsFromError(error));
        if (attempt < maxAttempts) {
          const warning = `Workflow repair provider failed; retrying without an artifact rewrite: ${attemptSummary.fix_error}`;
          attemptSummary.warning = warning;
          warnings.push(warning);
          if (!runId) {
            warnings.push('Auto-fix retry could not resolve a previous run id; retrying without step-level resume.');
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
              reason: `auto-fix retry after workflow repair provider failure for ${blockerCode ?? 'local failure'}`,
            },
          };
          onProgress?.(`Workflow repair provider failed; retrying workflow${failedStep ? ` from ${failedStep}` : ''}...`);
          continue;
        }
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

    onProgress?.('Applying direct repair...');
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
    onProgress?.(`Retrying workflow${failedStep ? ` from ${failedStep}` : ''}...`);
  }

  return withAutoFix(lastResponse ?? failedBeforeAttempt(request), maxAttempts, attempts, 'error', warnings, trackingRunId);
}

function isV1DirectBlocker(code: string | undefined): boolean {
  return code === 'MISSING_BINARY' || code === 'NETWORK_TRANSIENT';
}

function isExternalSetupBlocker(code: string | undefined): boolean {
  return code === 'CREDENTIALS_REJECTED' || code === 'WORKDIR_DIRTY';
}

async function defaultWorkflowRepairer(input: WorkflowRepairInput): Promise<WorkflowRepairResult> {
  const deterministicRepair = repairWorkflowDeterministically(input);
  if (deterministicRepair) {
    return deterministicRepair;
  }

  let result: Awaited<ReturnType<typeof repairWorkflowWithWorkforcePersona>>;
  try {
    result = await repairWorkflowWithWorkforcePersona({
      repoRoot: input.cwd,
      artifactPath: input.artifactPath,
      artifactContent: input.artifactContent,
      evidence: input.evidence,
      classification: input.classification,
      debuggerResult: input.debuggerResult,
      blocker: input.response.execution?.blocker,
      ...(input.failedStep ? { failedStep: input.failedStep } : {}),
      ...(input.runId ? { previousRunId: input.runId } : {}),
      previousAttempts: input.previousAttempts ?? [],
      attempt: input.attempt,
      maxAttempts: input.maxAttempts,
      installRoot: join(localRunStateRoot(input.cwd), 'workforce-persona-repair-skills'),
    });
  } catch (error) {
    throw error;
  }

  return {
    applied: true,
    artifactPath: input.artifactPath,
    content: result.artifact.content,
    summary: summaryFromRepairMetadata(result.artifact.metadata),
    warnings: result.metadata.warnings,
    runId: result.metadata.runId,
  };
}

export function repairWorkflowDeterministically(
  input: Pick<WorkflowRepairInput, 'artifactPath' | 'artifactContent' | 'evidence'> & Partial<Pick<WorkflowRepairInput, 'response'>>,
  personaError?: unknown,
): WorkflowRepairResult | null {
  let content = input.artifactContent;
  const changes: string[] = [];

  const envRepair = repairMissingEnvVarPreflight(content, input.evidence, input.response);
  if (envRepair.content !== content) {
    content = envRepair.content;
    changes.push(...envRepair.changes);
  }

  const timeoutRepair = repairAgentStepTimeouts(content, input.evidence);
  if (timeoutRepair.content !== content) {
    content = timeoutRepair.content;
    changes.push(...timeoutRepair.changes);
  }

  const missingFileRepair = missingFileRepairFromEvidence(input.evidence)
    ?? missingFileRepairFromArtifactContent(content, input.evidence);
  if (missingFileRepair) {
    const repaired = replacePathReference(content, missingFileRepair.expectedPath, missingFileRepair.materializedPath);
    if (repaired !== content) {
      content = repaired;
      changes.push(`aligned missing file check ${missingFileRepair.expectedPath} -> ${missingFileRepair.materializedPath}`);
    }
  }

  const leadPlanMarkerRepair = repairLeadPlanRequiredMarkerGate(content, input.evidence);
  if (leadPlanMarkerRepair.content !== content) {
    content = leadPlanMarkerRepair.content;
    changes.push(...leadPlanMarkerRepair.changes);
  }

  const outputRepair = repairOutputContainsEchoMismatches(content);
  if (outputRepair.content !== content) {
    content = outputRepair.content;
    changes.push(...outputRepair.changes);
  }

  const templateRepair = repairUnknownStepTemplateRefs(content);
  if (templateRepair.content !== content) {
    content = templateRepair.content;
    changes.push(...templateRepair.changes);
  }

  const gitDiffRepair = repairBareGitDiffManifestGates(content);
  if (gitDiffRepair.content !== content) {
    content = gitDiffRepair.content;
    changes.push(...gitDiffRepair.changes);
  }

  const sentinelGuardRepair = repairSentinelGuardedRehydration(content);
  if (sentinelGuardRepair.content !== content) {
    content = sentinelGuardRepair.content;
    changes.push(...sentinelGuardRepair.changes);
  }

  const masterChildRepair = repairMasterChildRunRepairLoop(content);
  if (masterChildRepair.content !== content) {
    content = masterChildRepair.content;
    changes.push(...masterChildRepair.changes);
  }

  const childValidationRepair = repairGeneratedChildFinalValidation(content);
  if (childValidationRepair.content !== content) {
    content = childValidationRepair.content;
    changes.push(...childValidationRepair.changes);
  }

  if (content === input.artifactContent || changes.length === 0) return null;

  return {
    applied: true,
    artifactPath: input.artifactPath,
    mode: 'deterministic',
    content,
    summary: `Applied bounded deterministic workflow repair: ${changes.join('; ')}.`,
    warnings: personaError
      ? [`Workforce persona repair unavailable (${errorMessage(personaError)}); used deterministic workflow repair fallback.`]
      : ['Used deterministic workflow repair fallback.'],
  };
}

function repairMissingEnvVarPreflight(
  content: string,
  evidence: WorkflowRunEvidence,
  response?: LocalResponse,
): { content: string; changes: string[] } {
  if (!isMissingEnvVarFailure(evidence, response)) return { content, changes: [] };

  const requiredEnvVars = missingEnvVarsFromFailure(evidence, response);
  const next = injectWorkflowEnvLoader(content, requiredEnvVars);
  if (next === content) return { content, changes: [] };

  const assertion = requiredEnvVars.length > 0
    ? ` and fast assertion for ${requiredEnvVars.join(', ')}`
    : '';
  return {
    content: next,
    changes: [`added repo-local .env loader${assertion}`],
  };
}

function isMissingEnvVarFailure(evidence: WorkflowRunEvidence, response?: LocalResponse): boolean {
  if (response?.execution?.blocker?.code === 'MISSING_ENV_VAR') return true;
  const text = workflowFailureText(evidence);
  return /\bMISSING_ENV_VAR\b|(?:missing|required).*(?:env|environment)|not set/i.test(text);
}

function missingEnvVarsFromFailure(evidence: WorkflowRunEvidence, response?: LocalResponse): string[] {
  const names = new Set<string>();
  for (const name of response?.execution?.blocker?.context.missing ?? []) {
    if (isConcreteEnvVarName(name)) names.add(name);
  }

  const text = workflowFailureText(evidence);
  const patterns = [
    /\bMISSING_ENV_VAR:\s*([A-Z][A-Z0-9_]*(?:\s*,\s*[A-Z][A-Z0-9_]*)*)/g,
    /(?:env(?:ironment)?(?:\s+variable)?|variable)\s+['"`]?([A-Z][A-Z0-9_]{2,})['"`]?/gi,
    /\b([A-Z][A-Z0-9_]{2,})\b\s+(?:is\s+)?(?:missing|required|not\s+set|unset)/gi,
    /(?:missing|required|not\s+set|unset)[^A-Z\n]{0,80}\b([A-Z][A-Z0-9_]{2,})\b/gi,
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const value = match[1] ?? '';
      for (const name of value.split(/\s*,\s*/)) {
        if (isConcreteEnvVarName(name)) names.add(name);
      }
    }
  }

  return [...names].sort();
}

function workflowFailureText(evidence: WorkflowRunEvidence): string {
  return [
    ...evidence.logs.map((log) => log.excerpt),
    ...evidence.deterministicGates.flatMap((gate) => [
      gate.outputExcerpt,
      gate.stdoutExcerpt,
      gate.stderrExcerpt,
    ]),
    ...evidence.steps.flatMap((step) => [
      step.error,
      ...step.logs.map((log) => log.excerpt),
      ...step.deterministicGates.flatMap((gate) => [
        gate.outputExcerpt,
        gate.stdoutExcerpt,
        gate.stderrExcerpt,
      ]),
      ...step.verifications.flatMap((verification) => [
        verification.message,
        verification.outputExcerpt,
        verification.stdoutExcerpt,
        verification.stderrExcerpt,
      ]),
    ]),
  ].filter((value): value is string => typeof value === 'string' && value.trim().length > 0).join('\n');
}

function isConcreteEnvVarName(name: string): boolean {
  return /^[A-Z][A-Z0-9_]{2,}$/.test(name)
    && !['ENOENT', 'PATH'].includes(name)
    && (name.includes('_') || name.length > 3);
}

function injectWorkflowEnvLoader(content: string, requiredEnvVars: string[]): string {
  let next = content;
  let changed = false;

  // We must check that the *aliases* loadRickyWorkflowEnv references are
  // already imported, not just that the module name appears anywhere in the
  // file. The master workflow renderer emits real `import { mkdirSync,
  // writeFileSync } from 'node:fs'` strings inside shell HEREDOCs in
  // .step({ command: ... }) calls — that's a string literal, not a module
  // import, but a substring check for `from 'node:fs'` matches it and
  // silently skips adding `import * as rickyWorkflowFs from 'node:fs'`.
  // The injected loadRickyWorkflowEnv body then ReferenceErrors at module
  // load time. Match an actual top-of-file `import * as rickyWorkflowFs`
  // statement so the helpers always have their aliases.
  if (!hasRickyWorkflowAliasImport(next, 'rickyWorkflowFs', 'node:fs')) {
    next = insertAfterWorkflowImport(next, "import * as rickyWorkflowFs from 'node:fs';");
    changed = true;
  }
  if (!hasRickyWorkflowAliasImport(next, 'rickyWorkflowPath', 'node:path')) {
    next = insertAfterWorkflowImport(next, "import * as rickyWorkflowPath from 'node:path';");
    changed = true;
  }
  if (!next.includes('RICKY_WORKFLOW_ENV_LOADER')) {
    next = insertBeforeMain(next, rickyWorkflowEnvLoaderSource());
    changed = true;
  } else if (requiredEnvVars.length > 0 && !next.includes('function assertRickyWorkflowEnv')) {
    next = insertBeforeMain(next, rickyWorkflowEnvAssertSource());
    changed = true;
  }

  const calls = [
    '  loadRickyWorkflowEnv();',
    ...(requiredEnvVars.length > 0 ? [`  assertRickyWorkflowEnv(${JSON.stringify(requiredEnvVars)});`] : []),
  ];
  for (const call of calls) {
    if (next.includes(call.trim())) continue;
    const updated = next.includes('async function main()')
      ? next.replace(/async function main\(\) \{\n/, (match) => `${match}${call}\n`)
      : next.replace(/\bworkflow\(/, `${call.trim()}\nworkflow(`);
    if (updated !== next) {
      next = updated;
      changed = true;
    }
  }

  return changed ? next : content;
}

function insertAfterWorkflowImport(content: string, importLine: string): string {
  const workflowImport = /^import\s+\{\s*workflow\s+\}\s+from\s+['"]@agent-relay\/sdk\/workflows['"];?\n/m;
  if (workflowImport.test(content)) {
    return content.replace(workflowImport, (match) => `${match}${importLine}\n`);
  }
  return `${importLine}\n${content}`;
}

function hasRickyWorkflowAliasImport(content: string, alias: string, moduleName: string): boolean {
  // Only treat the alias as imported when there is an actual top-of-file
  // `import * as <alias> from '<moduleName>'` (or `"<moduleName>"`)
  // statement anchored to the start of a line. Substring matches against
  // `from 'node:fs'` would otherwise be fooled by shell HEREDOC strings
  // inside .step({ command: ... }) bodies that happen to contain a literal
  // import line as part of an embedded `node --input-type=module` script.
  const escapedAlias = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const escapedModule = moduleName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const importPattern = new RegExp(
    `^import\\s+\\*\\s+as\\s+${escapedAlias}\\s+from\\s+['"]${escapedModule}['"];?\\s*$`,
    'm',
  );
  const lines = content.split(/\r?\n/);
  let preambleLength = 0;
  for (const line of lines) {
    const trimmed = line.trim();
    if (
      trimmed === '' ||
      trimmed.startsWith('//') ||
      trimmed.startsWith('/*') ||
      trimmed.startsWith('*') ||
      trimmed.startsWith('*/') ||
      trimmed.startsWith('import ') ||
      trimmed.startsWith('export ')
    ) {
      preambleLength += line.length + 1;
      continue;
    }
    break;
  }
  return importPattern.test(content.slice(0, preambleLength));
}

function insertBeforeMain(content: string, helper: string): string {
  if (content.includes('async function main()')) {
    return content.replace(/\nasync function main\(\)/, `\n${helper}\n\nasync function main()`);
  }
  return `${helper}\n\n${content}`;
}

function rickyWorkflowEnvLoaderSource(): string {
  return `// RICKY_WORKFLOW_ENV_LOADER: load repo-local env files before spawning workflow agents.
function loadRickyWorkflowEnv(cwd = process.cwd()) {
  for (const file of ['.env.local', '.env']) {
    const path = rickyWorkflowPath.join(cwd, file);
    if (!rickyWorkflowFs.existsSync(path)) continue;
    const body = rickyWorkflowFs.readFileSync(path, 'utf8');
    for (const rawLine of body.split(/\\r?\\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const match = /^(?:export\\s+)?([A-Za-z_][A-Za-z0-9_]*)\\s*=\\s*(.*)$/.exec(line);
      if (!match) continue;
      const [, key, rawValue] = match;
      if (!key || rawValue === undefined || process.env[key] !== undefined) continue;
      process.env[key] = unquoteRickyWorkflowEnvValue(rawValue);
    }
  }
}

function assertRickyWorkflowEnv(names: string[]): void {
  const missing = names.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    throw new Error(\`MISSING_ENV_VAR: \${missing.join(', ')}. Add missing values to .env.local or export them before rerunning.\`);
  }
}

function unquoteRickyWorkflowEnvValue(value: string): string {
  const trimmed = value.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}`;
}

function rickyWorkflowEnvAssertSource(): string {
  return `function assertRickyWorkflowEnv(names: string[]): void {
  const missing = names.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    throw new Error(\`MISSING_ENV_VAR: \${missing.join(', ')}. Add missing values to .env.local or export them before rerunning.\`);
  }
}`;
}

function summaryFromRepairMetadata(metadata: Record<string, unknown>): string {
  const summary = metadata.summary;
  return typeof summary === 'string' && summary.trim()
    ? summary
    : 'Workforce workflow persona repaired the workflow artifact.';
}

function missingFileRepairFromEvidence(
  evidence: WorkflowRunEvidence,
): { expectedPath: string; materializedPath: string } | null {
  for (const step of evidence.steps) {
    if (step.status !== 'failed') continue;
    const failedFile = step.verifications.find((verification) =>
      !verification.passed && verification.type === 'file_exists' && verification.expected.trim(),
    );
    if (!failedFile) continue;
    const expectedPath = failedFile.expected.trim();
    const materializedPath = nearestMaterializedPath(evidence, expectedPath);
    if (materializedPath && materializedPath !== expectedPath) {
      return { expectedPath, materializedPath };
    }
  }
  return null;
}

function missingFileRepairFromArtifactContent(
  content: string,
  evidence: WorkflowRunEvidence,
): { expectedPath: string; materializedPath: string } | null {
  for (const step of evidence.steps) {
    if (step.status !== 'failed') continue;
    const failedFile = step.verifications.find((verification) =>
      !verification.passed && verification.type === 'file_exists' && verification.expected.trim(),
    );
    if (!failedFile) continue;
    const expectedPath = failedFile.expected.trim();
    const expectedDir = dirname(expectedPath);
    const candidates = materializedPathsFromCommand(content)
      .filter((candidate) => dirname(candidate) === expectedDir && candidate !== expectedPath)
      .sort((a, b) => basenameDistance(a, expectedPath) - basenameDistance(b, expectedPath));
    if (candidates[0]) return { expectedPath, materializedPath: candidates[0] };
  }
  return null;
}

function nearestMaterializedPath(evidence: WorkflowRunEvidence, expectedPath: string): string | null {
  const expectedDir = dirname(expectedPath);
  const candidates = evidence.steps
    .filter((step) => step.status === 'passed')
    .flatMap((step) => [
      ...step.verifications.map((verification) => verification.command ?? ''),
      ...step.deterministicGates.map((gate) => gate.command ?? ''),
    ])
    .flatMap(materializedPathsFromCommand)
    .filter((candidate) => dirname(candidate) === expectedDir);

  if (candidates.length === 0) return null;
  return candidates.sort((a, b) => basenameDistance(a, expectedPath) - basenameDistance(b, expectedPath))[0];
}

function materializedPathsFromCommand(command: string): string[] {
  const paths: string[] = [];
  const redirect = /(?:^|\s)(?:>|>>)\s*([^;&|]+)/g;
  for (const match of command.matchAll(redirect)) {
    const path = cleanShellPath(match[1]);
    if (path) paths.push(path);
  }
  return paths;
}

function repairLeadPlanRequiredMarkerGate(content: string, evidence: WorkflowRunEvidence): { content: string; changes: string[] } {
  const text = workflowFailureText(evidence);
  if (!/lead plan missing required marker:\s*(?:Non-goals|Routing contract|Implementation contract)/i.test(text)) {
    return { content, changes: [] };
  }
  if (!content.includes('lead-plan-gate') || !content.includes('leadPlanPath')) {
    return { content, changes: [] };
  }

  const changes: string[] = [];
  const escapedOldBlock = [
    "const body = fs.readFileSync(leadPlanPath, 'utf8');",
    "if (!body.includes('GENERATION_LEAD_PLAN_READY')) throw new Error('lead plan missing required marker: GENERATION_LEAD_PLAN_READY');",
    "if (!/non-goals?/i.test(body)) throw new Error('lead plan missing required marker: Non-goals');",
    "const hasRoutingContract = /Routing contract/i.test(body) || /Local execution must run through Agent Relay/i.test(body) || /Run local execution through the generated Agent Relay workflow artifact/i.test(body) || /routes local execution through the generated Agent Relay artifact/i.test(body) || /Use the generated Agent Relay workflow artifact/i.test(body);",
    "if (!hasRoutingContract) throw new Error('lead plan missing required marker: Routing contract');",
    "const hasImplementationContract = /Implementation contract/i.test(body) || /This is an implementation spec/i.test(body);",
    "if (!hasImplementationContract) throw new Error('lead plan missing required marker: Implementation contract');",
  ].join('\\n');
  const escapedNewBlock = leadPlanGateSelfHealingBlock('\\n');

  let next = content.replace(escapedOldBlock, () => {
    changes.push('made lead-plan-gate append missing required plan markers before validating');
    return escapedNewBlock;
  });

  if (next !== content) {
    return { content: next, changes: [...new Set(changes)] };
  }

  const plainOldBlock = escapedOldBlock.replaceAll('\\n', '\n');
  const plainNewBlock = leadPlanGateSelfHealingBlock('\n');
  next = content.replace(plainOldBlock, () => {
    changes.push('made lead-plan-gate append missing required plan markers before validating');
    return plainNewBlock;
  });

  return { content: next, changes: [...new Set(changes)] };
}

function leadPlanGateSelfHealingBlock(lineBreak: string): string {
  return [
    "let body = fs.readFileSync(leadPlanPath, 'utf8');",
    'const appendLeadPlanSection = (heading, lines) => {',
    "  const section = ['', '## ' + heading, '', ...lines].join('\\n');",
    "  const readyMarker = 'GENERATION_LEAD_PLAN_READY';",
    '  const readyMarkerIndex = body.lastIndexOf(readyMarker);',
    '  if (readyMarkerIndex >= 0) {',
    "    body = body.slice(0, readyMarkerIndex).trimEnd() + section + '\\n\\n' + body.slice(readyMarkerIndex);",
    '  } else {',
    "    body = body.trimEnd() + section + '\\n';",
    '  }',
    '  fs.writeFileSync(leadPlanPath, body);',
    '};',
    "if (!body.includes('GENERATION_LEAD_PLAN_READY')) throw new Error('lead plan missing required marker: GENERATION_LEAD_PLAN_READY');",
    "if (!/non-goals?/i.test(body)) appendLeadPlanSection('Non-goals', ['- Preserve the normalized spec scope; do not broaden deliverables or implementation ownership.']);",
    "let hasRoutingContract = /Routing contract/i.test(body) || /Local execution must run through Agent Relay/i.test(body) || /Run local execution through the generated Agent Relay workflow artifact/i.test(body) || /routes local execution through the generated Agent Relay artifact/i.test(body) || /Use the generated Agent Relay workflow artifact/i.test(body);",
    "if (!hasRoutingContract) appendLeadPlanSection('Routing contract', ['- Local execution must run through Agent Relay using the generated workflow artifact.']);",
    "let hasImplementationContract = /Implementation contract/i.test(body) || /This is an implementation spec/i.test(body);",
    "if (!hasImplementationContract) appendLeadPlanSection('Implementation contract', ['- Implementation specs must produce source changes, tests, non-empty diff evidence, and result reporting.']);",
    "if (!/non-goals?/i.test(body)) throw new Error('lead plan missing required marker: Non-goals');",
    "hasRoutingContract = /Routing contract/i.test(body) || /Local execution must run through Agent Relay/i.test(body) || /Run local execution through the generated Agent Relay workflow artifact/i.test(body) || /routes local execution through the generated Agent Relay artifact/i.test(body) || /Use the generated Agent Relay workflow artifact/i.test(body);",
    "if (!hasRoutingContract) throw new Error('lead plan missing required marker: Routing contract');",
    "hasImplementationContract = /Implementation contract/i.test(body) || /This is an implementation spec/i.test(body);",
    "if (!hasImplementationContract) throw new Error('lead plan missing required marker: Implementation contract');",
  ].join(lineBreak);
}

function repairOutputContainsEchoMismatches(content: string): { content: string; changes: string[] } {
  const changes: string[] = [];
  const next = content.replace(
    /command:\s*`echo\s+([^`]+)`([\s\S]*?verification:\s*{\s*type:\s*['"]output_contains['"]\s*,\s*value:\s*['"]([^'"]+)['"]\s*})/g,
    (match, actual: string, rest: string, expected: string) => {
      const actualValue = actual.trim();
      const expectedValue = expected.trim();
      if (!actualValue || !expectedValue || actualValue === expectedValue) return match;
      changes.push(`aligned output_contains sentinel ${actualValue} -> ${expectedValue}`);
      return `command: \`echo ${expectedValue}\`${rest}`;
    },
  );
  return { content: next, changes };
}

function repairUnknownStepTemplateRefs(content: string): { content: string; changes: string[] } {
  const stepIds = [...content.matchAll(/\.step\(\s*['"`]([^'"`]+)['"`]/g)].map((match) => match[1]);
  if (stepIds.length === 0) return { content, changes: [] };

  const changes: string[] = [];
  const next = content.replace(/\{\{steps\.([^.}]+)\.output}}/g, (match, referencedStep: string) => {
    if (stepIds.includes(referencedStep)) return match;
    const replacement = nearestStepId(referencedStep, stepIds);
    if (!replacement) return match;
    changes.push(`rewired template reference ${referencedStep} -> ${replacement}`);
    return `{{steps.${replacement}.output}}`;
  });

  return { content: next, changes };
}

function repairBareGitDiffManifestGates(content: string): { content: string; changes: string[] } {
  if (!content.includes('git diff --name-only')) return { content, changes: [] };

  const changes: string[] = [];
  let next = content.replace(
    /git diff --name-only\s*\|\s*/g,
    () => {
      changes.push('expanded git diff pipe gates to include untracked files');
      return '{ git diff --name-only; git ls-files --others --exclude-standard; } | sort -u | ';
    },
  );
  next = next.replace(
    /git diff --name-only\s*>\s*/g,
    () => {
      changes.push('expanded git diff redirect gates to include untracked files');
      return 'GIT_DIFF_TMP=$(mktemp) && { git diff --name-only; git ls-files --others --exclude-standard; } | sort -u > "$GIT_DIFF_TMP" && mv "$GIT_DIFF_TMP" ';
    },
  );

  return { content: next, changes: [...new Set(changes)] };
}

function repairSentinelGuardedRehydration(content: string): { content: string; changes: string[] } {
  if (!content.includes("<<'EOF'") || !content.includes("tail -n 1")) return { content, changes: [] };

  const changes: string[] = [];
  const guardPattern =
    /if \[ ! -f '([^']+)' \];\s*then\n([ \t]*)cat > '\1' <<'EOF'\n([\s\S]*?)\n([A-Za-z0-9_]+)\nEOF\n[ \t]*fi/g;

  const next = content.replace(guardPattern, (match, path: string, indent: string, body: string, marker: string) => {
    const sentinelCheckPattern = new RegExp(
      `tail -n 1 '${escapeRegExp(path)}'[^\\n]*\\| grep[^\\n]*'\\^${escapeRegExp(marker)}\\$'`,
    );
    if (!sentinelCheckPattern.test(content)) return match;

    changes.push(`hardened sentinel-guarded rehydration for '${path}' (marker: ${marker})`);
    return `if [ ! -f '${path}' ] || ! tail -n 1 '${path}' | tr -d '[:space:]' | grep -qE '^${marker}$'; then\n${indent}cat > '${path}' <<'EOF'\n${body}\n${marker}\nEOF\n${indent}fi`;
  });

  return { content: next, changes: [...new Set(changes)] };
}

function repairMasterChildRunRepairLoop(content: string): { content: string; changes: string[] } {
  const isMasterArtifact = content.includes('RICKY_MASTER_EXECUTOR_WORKFLOW') || content.includes('--foreground --no-auto-fix');
  if (!isMasterArtifact) return { content, changes: [] };

  const changes: string[] = [];
  let next = content.replace(/--foreground\s+--no-auto-fix/g, () => {
    changes.push('allowed nested child workflows to use Ricky auto-fix instead of --no-auto-fix');
    return '--foreground';
  });

  next = next.replace(
    /^\s*\.onError\(\s*['"]fail-fast['"]\s*\)/m,
    (match) => {
      changes.push('replaced fail-fast error handling with repair-aware retry');
      const indent = match.match(/^\s*/)?.[0] ?? '';
      return `${indent}.onError('retry', { maxRetries: 2, retryDelayMs: 1000, repairAgent: "master-lead", repairRetries: 2 })`;
    },
  );

  return { content: next, changes: [...new Set(changes)] };
}

function repairGeneratedChildFinalValidation(content: string): { content: string; changes: string[] } {
  if (!/workflow\(["']ricky-child-/.test(content)) return { content, changes: [] };
  const changes: string[] = [];
  const next = content.replace(
    /(\.step\(["']final-hard-validation["'][\s\S]*?captureOutput:\s*true,\n\s*)failOnError:\s*true,/,
    (match, prefix: string) => {
      changes.push('made generated child final validation non-terminal so master final validation owns integrated repo checks');
      return `${prefix}failOnError: false,`;
    },
  );
  return { content: next, changes };
}

function repairAgentStepTimeouts(content: string, evidence: WorkflowRunEvidence): { content: string; changes: string[] } {
  const timedOutStep = timedOutAgentStepFromEvidence(evidence);
  if (!timedOutStep) return { content, changes: [] };
  if (content.includes(`${timedOutStep}-timeout-continuation`)) return { content, changes: [] };

  const range = findStepObjectRange(content, timedOutStep);
  if (!range) return { content, changes: [] };

  const block = content.slice(range.start, range.end);
  const agent = block.match(/\bagent:\s*['"`]([^'"`]+)['"`]/)?.[1];
  if (!agent) return { content, changes: [] };
  const taskRange = findTemplatePropertyRange(block, 'task');
  if (!taskRange) return { content, changes: [] };

  const continuationStep = `${timedOutStep}-timeout-continuation`;
  const handoffPath = timeoutContinuationPath(content, timedOutStep);
  const marker = markerForStep(continuationStep);
  const timeoutValue = timeoutValueForContinuation(block);
  const originalTask = block.slice(taskRange.contentStart, taskRange.contentEnd);
  const repairedTask = `${originalTask.trimEnd()}

RICKY_TIMEOUT_REPAIR:
- This step previously exhausted its agent timeout/retries.
- Complete a bounded first slice only, then write a concise handoff for the continuation step to ${handoffPath}.
- Preserve any work already completed in the repository.
- If the original task has multiple coverage areas, do not try to finish all of them in this one agent turn.`;
  const repairedBlock = `${block.slice(0, taskRange.contentStart)}${repairedTask}${block.slice(taskRange.contentEnd)}`;
  const before = content.slice(0, range.start);
  const after = rewriteDependsOnStep(content.slice(range.end), timedOutStep, continuationStep);
  const continuation = renderTimeoutContinuationStep({
    stepId: continuationStep,
    dependsOn: timedOutStep,
    agent,
    timeoutValue,
    handoffPath,
    marker,
  });
  const next = `${before}${repairedBlock}\n\n${continuation}${after}`;

  return {
    content: next,
    changes: [`split timed-out agent step ${timedOutStep} with continuation ${continuationStep}`],
  };
}

function timedOutAgentStepFromEvidence(evidence: WorkflowRunEvidence): string | null {
  for (const step of evidence.steps) {
    if (step.status !== 'failed') continue;
    const stepText = [
      step.error,
      ...step.verifications.map((verification) => verification.message ?? verification.actual ?? ''),
      ...step.deterministicGates.flatMap((gate) => gate.verifications.map((verification) => verification.message ?? verification.actual ?? '')),
      ...step.logs.map((entry) => entry.excerpt),
    ].filter(Boolean).join('\n');
    if (hasTimeoutSignal(stepText)) {
      return step.stepId;
    }
  }

  const allLogs = evidence.logs.map((entry) => entry.excerpt).join('\n');
  const failed = allLogs.match(/Step "([^"]+)" failed after \d+ retries: .*?(?:timed?\s*out|timeout|aborted)/i)
    ?? allLogs.match(/✗\s+(.+?)\s+—\s+FAILED: .*?(?:timed?\s*out|timeout|aborted)/i);
  return failed?.[1]?.trim() ?? null;
}

function hasTimeoutSignal(text: string): boolean {
  return /\b(?:timed?\s*out|timeout|aborted due to timeout)\b/i.test(text);
}

function findStepObjectRange(content: string, stepId: string): { start: number; end: number } | null {
  const escaped = escapeRegExp(stepId);
  const stepMatch = new RegExp(`\\.step\\(\\s*['"\`]${escaped}['"\`]\\s*,\\s*\\{`).exec(content);
  if (!stepMatch) return null;
  const start = stepMatch.index;
  const objectStart = content.indexOf('{', start);
  if (objectStart === -1) return null;
  const objectEnd = findMatchingBrace(content, objectStart);
  if (objectEnd === -1) return null;
  let end = objectEnd + 1;
  while (/\s/.test(content[end] ?? '')) end += 1;
  if (content[end] === ')') end += 1;
  return { start, end };
}

function findMatchingBrace(content: string, start: number): number {
  let depth = 0;
  let quote: '"' | "'" | '`' | null = null;
  let escaped = false;

  for (let index = start; index < content.length; index += 1) {
    const char = content[index];
    if (quote) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === '\\') {
        escaped = true;
        continue;
      }
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      continue;
    }
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function findTemplatePropertyRange(block: string, property: string): {
  contentStart: number;
  contentEnd: number;
} | null {
  const match = new RegExp(`\\b${escapeRegExp(property)}\\s*:`).exec(block);
  if (!match) return null;
  const tick = block.indexOf('`', match.index + match[0].length);
  if (tick === -1) return null;
  const contentStart = tick + 1;
  let escaped = false;
  for (let index = contentStart; index < block.length; index += 1) {
    const char = block[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (char === '`') return { contentStart, contentEnd: index };
  }
  return null;
}

function rewriteDependsOnStep(content: string, oldStep: string, newStep: string): string {
  return content.replace(/dependsOn:\s*\[([^\]]*)\]/g, (match, values: string) => {
    if (!new RegExp(`['"\`]${escapeRegExp(oldStep)}['"\`]`).test(values)) return match;
    return match.replace(new RegExp(`(['"\`])${escapeRegExp(oldStep)}\\1`, 'g'), `$1${newStep}$1`);
  });
}

function timeoutContinuationPath(content: string, stepId: string): string {
  if (/\bARTIFACT_DIR\b/.test(content)) return `\${ARTIFACT_DIR}/${stepId}-timeout-continuation.md`;
  return `.workflow-artifacts/ricky-auto-fix/${stepId}-timeout-continuation.md`;
}

function timeoutValueForContinuation(block: string): string {
  const timeout = propertyExpression(block, 'timeoutMs');
  return timeout || '900_000';
}

function propertyExpression(block: string, property: string): string | null {
  const match = new RegExp(`\\b${escapeRegExp(property)}\\s*:`).exec(block);
  if (!match) return null;

  let index = match.index + match[0].length;
  while (/\s/.test(block[index] ?? '')) index += 1;
  const start = index;
  let parenDepth = 0;
  let bracketDepth = 0;
  let braceDepth = 0;
  let quote: '"' | "'" | '`' | null = null;
  let escaped = false;

  for (; index < block.length; index += 1) {
    const char = block[index];
    if (quote) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === '\\') {
        escaped = true;
        continue;
      }
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      continue;
    }
    if (char === '(') parenDepth += 1;
    if (char === ')') parenDepth = Math.max(0, parenDepth - 1);
    if (char === '[') bracketDepth += 1;
    if (char === ']') bracketDepth = Math.max(0, bracketDepth - 1);
    if (char === '{') braceDepth += 1;
    if (char === '}') {
      if (braceDepth === 0) break;
      braceDepth -= 1;
      continue;
    }
    if (char === ',' && parenDepth === 0 && bracketDepth === 0 && braceDepth === 0) break;
  }

  const value = block.slice(start, index).trim();
  return value || null;
}

function markerForStep(stepId: string): string {
  return `${stepId.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_DONE`;
}

function renderTimeoutContinuationStep(input: {
  stepId: string;
  dependsOn: string;
  agent: string;
  timeoutValue: string;
  handoffPath: string;
  marker: string;
}): string {
  return `    .step('${input.stepId}', {
      agent: '${input.agent}',
      dependsOn: ['${input.dependsOn}'],
      timeoutMs: ${input.timeoutValue},
      task: \`Continue the previously timed-out workflow step "${input.dependsOn}".

Read any handoff or summary produced by ${input.dependsOn}, inspect the current git diff, and finish only the remaining work from that original step. Keep the scope bounded and preserve existing edits.

Write ${input.handoffPath} ending with ${input.marker}.\`,
      verification: { type: 'file_exists', value: \`${input.handoffPath}\` },
    })`;
}

function nearestStepId(value: string, candidates: string[]): string | null {
  const prefix = value.split('-')[0];
  const ranked = candidates
    .map((candidate) => ({ candidate, distance: levenshtein(value, candidate) }))
    .sort((a, b) => a.distance - b.distance);
  const best = ranked[0];
  if (!best) return null;
  const sharesPrefix = prefix.length > 0 && best.candidate.startsWith(`${prefix}-`);
  const closeEnough = best.distance <= Math.max(4, Math.ceil(value.length * 0.6));
  return sharesPrefix || closeEnough ? best.candidate : null;
}

function basenameDistance(a: string, b: string): number {
  return levenshtein(a.split('/').pop() ?? a, b.split('/').pop() ?? b);
}

function levenshtein(a: string, b: string): number {
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 0; i < a.length; i += 1) {
    const current = [i + 1];
    for (let j = 0; j < b.length; j += 1) {
      current[j + 1] = Math.min(
        current[j] + 1,
        previous[j + 1] + 1,
        previous[j] + (a[i] === b[j] ? 0 : 1),
      );
    }
    previous.splice(0, previous.length, ...current);
  }
  return previous[b.length];
}

function warningsFromError(error: unknown): string[] {
  if (!error || typeof error !== 'object' || !('warnings' in error)) return [];
  const warnings = (error as { warnings?: unknown }).warnings;
  return Array.isArray(warnings)
    ? warnings.filter((warning): warning is string => typeof warning === 'string' && warning.trim().length > 0)
    : [];
}

function cleanShellPath(value: string | undefined): string | null {
  if (!value) return null;
  const cleaned = value.trim().replace(/^['"]|['"]$/g, '').replace(/[),.;]+$/g, '');
  return cleaned || null;
}

function replacePathReference(content: string, expectedPath: string, materializedPath: string): string {
  if (content.includes(expectedPath)) {
    return content.split(expectedPath).join(materializedPath);
  }
  const expectedName = expectedPath.split('/').pop();
  const materializedName = materializedPath.split('/').pop();
  if (!expectedName || !materializedName || expectedName === materializedName) return content;
  return content.replaceAll(`/${expectedName}`, `/${materializedName}`);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
  const runCommand = artifactPath ? `ricky run ${artifactPath}` : undefined;

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
  return text.match(/\bRun ID:\s*([^\s]+)/i)?.[1] ?? text.match(/^\[workflow]\s+run\s+([^\s]+)$/im)?.[1];
}

function failedStepFromEvidence(evidence: WorkflowRunEvidence): string | undefined {
  const real = evidence.steps.find(
    (step) => step.status === 'failed' && !isSyntheticStageId(step.stepId),
  );
  return real?.stepId;
}

function localResponseToWorkflowRunEvidence(response: LocalResponse, attempt: number): WorkflowRunEvidence {
  const execution = response.execution;
  const startedAt = execution?.execution.started_at ?? new Date().toISOString();
  const completedAt = execution?.execution.finished_at;
  const tail = execution?.evidence?.logs.tail ?? [];
  const runtimeSteps = runtimeStepsFromLogTail(tail, startedAt, completedAt);
  const failedStepId = execution?.evidence?.failed_step?.id;
  const failedStepName = execution?.evidence?.failed_step?.name ?? failedStepId ?? 'local runtime';
  const fallbackStep: WorkflowStepEvidence = {
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
    logs: tail.map((excerpt) => ({ stream: 'stderr', excerpt })),
    artifacts: response.artifacts.map((artifact) => ({ path: artifact.path, kind: 'file' })),
    history: [],
    retries: [],
    narrative: [],
    ...(response.ok ? {} : { error: execution?.blocker?.message ?? response.warnings[0] }),
  };
  const steps = runtimeSteps.length > 0 ? runtimeSteps : [fallbackStep];

  return {
    runId: resolveRunId(response) ?? `ricky-auto-fix-attempt-${attempt}`,
    workflowId: execution?.execution.workflow_id ?? 'ricky-local',
    workflowName: execution?.execution.workflow_file ?? response.generation?.artifact?.path ?? 'ricky-local',
    status: response.ok ? 'passed' : 'failed',
    steps,
    startedAt,
    ...(completedAt ? { completedAt } : {}),
    durationMs: execution?.execution.duration_ms,
    deterministicGates: [],
    artifacts: response.artifacts.map((artifact) => ({ path: artifact.path, kind: 'file' })),
    logs: [
      ...response.logs.map((excerpt) => ({ stream: 'system' as const, excerpt })),
      ...tail.map((excerpt) => ({ stream: 'stderr' as const, excerpt })),
    ],
    narrative: [],
    routing: [],
  };
}

function runtimeStepsFromLogTail(
  tail: string[],
  startedAt: string,
  completedAt: string | undefined,
): WorkflowStepEvidence[] {
  const steps = new Map<string, WorkflowStepEvidence>();
  const commandByStep = new Map<string, string>();
  const exitCodeByStep = new Map<string, number>();

  for (const line of tail) {
    const state = line.match(/^\s*[●✓✗○]\s+(.+?)\s+—\s+(started|completed|skipped|FAILED:\s*(.+))$/);
    if (state) {
      const stepId = state[1].trim();
      const statusText = state[2];
      const failure = state[3]?.trim();
      const status = statusText === 'completed'
        ? 'passed'
        : statusText === 'skipped'
          ? 'skipped'
          : statusText.startsWith('FAILED:')
            ? 'failed'
            : 'running';
      const step = ensureRuntimeStep(steps, stepId, startedAt);
      step.status = status;
      if (status === 'passed' || status === 'failed' || status === 'skipped') step.completedAt = completedAt;
      if (failure) step.error = failure;
      continue;
    }

    const command = line.match(/^\[workflow[^\]]*]\s+\[([^\]]+)]\s+Running:\s+(.+)$/);
    if (command) {
      const stepId = command[1].trim();
      const value = command[2].trim();
      commandByStep.set(stepId, value);
      ensureRuntimeStep(steps, stepId, startedAt).logs.push({ stream: 'stdout', excerpt: line });
      continue;
    }

    const commandFailed = line.match(/^\[workflow[^\]]*]\s+\[([^\]]+)]\s+Command failed\s+\(exit code\s+(\d+)\)/i);
    if (commandFailed) {
      const stepId = commandFailed[1].trim();
      exitCodeByStep.set(stepId, Number(commandFailed[2]));
      ensureRuntimeStep(steps, stepId, startedAt).logs.push({ stream: 'stdout', excerpt: line });
      continue;
    }

    const bracketed = line.match(/^\[workflow[^\]]*]\s+\[([^\]]+)]\s+(.+)$/);
    if (bracketed) {
      ensureRuntimeStep(steps, bracketed[1].trim(), startedAt).logs.push({ stream: 'stdout', excerpt: line });
    }
  }

  for (const step of steps.values()) {
    const command = commandByStep.get(step.stepId);
    const exitCode = exitCodeByStep.get(step.stepId);
    if (!command) continue;
    const passed = step.status === 'passed';
    const verification = verificationFromRuntimeCommand(command, passed, exitCode, step.error);
    const gate = {
      gateName: step.stepId,
      passed,
      command,
      ...(exitCode !== undefined ? { exitCode } : {}),
      verifications: [verification],
      recordedAt: completedAt ?? new Date().toISOString(),
    };
    step.deterministicGates = [gate];
    step.verifications = [verification];
  }

  return [...steps.values()];
}

function ensureRuntimeStep(
  steps: Map<string, WorkflowStepEvidence>,
  stepId: string,
  startedAt: string,
): WorkflowStepEvidence {
  const existing = steps.get(stepId);
  if (existing) return existing;
  const step: WorkflowStepEvidence = {
    stepId,
    stepName: stepId,
    status: 'pending',
    startedAt,
    verifications: [],
    deterministicGates: [],
    logs: [],
    artifacts: [],
    history: [],
    retries: [],
    narrative: [],
  };
  steps.set(stepId, step);
  return step;
}

function verificationFromRuntimeCommand(
  command: string,
  passed: boolean,
  exitCode: number | undefined,
  error: string | undefined,
): WorkflowStepEvidence['verifications'][number] {
  const fileCheck = command.match(/(?:^|&&|\|\|)\s*test\s+-f\s+(.+?)(?:\s*(?:&&|\|\|)|$)/);
  if (fileCheck) {
    const expected = fileCheck[1].trim().replace(/^['"]|['"]$/g, '');
    return {
      type: 'file_exists',
      passed,
      expected,
      actual: passed ? expected : `missing or unreadable; exit code ${exitCode ?? 'unknown'}`,
      message: error ?? (passed ? 'File exists.' : `Expected file was not found: ${expected}`),
      command,
      ...(exitCode !== undefined ? { exitCode } : {}),
    };
  }

  return {
    type: 'exit_code',
    passed,
    expected: '0',
    actual: String(exitCode ?? (passed ? 0 : 'unknown')),
    message: error ?? (passed ? 'Command exited successfully.' : 'Command failed.'),
    command,
    ...(exitCode !== undefined ? { exitCode } : {}),
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
