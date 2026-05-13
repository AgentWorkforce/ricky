import type { NormalizedWorkflowSpec } from '../spec-intake/types.js';
import type { SwarmPattern } from '../../shared/models/workflow-config.js';
import type {
  GenerationInput,
  GenerationIssue,
  GenerationResult,
  GenerationValidationResult,
  PatternDecision,
  PlannedCheck,
  RenderedArtifact,
  SkillContext,
  WorkflowExecutionRoute,
  WorkforcePersonaGenerationMetadata,
} from './types.js';
import { selectPattern } from './pattern-selector.js';
import { refineWithLlm } from './refine-with-llm.js';
import { loadSkills } from './skill-loader.js';
import { renderMasterExecutionWorkflow, shouldUseMasterExecutionWorkflow } from './master-workflow-renderer.js';
import { renderWorkflow } from './template-renderer.js';
import {
  applyPersonaArtifactToRenderedArtifact,
  hasExplicitWorkflowRunCwd,
  writeWorkflowWithWorkforcePersona,
  WorkforcePersonaClarificationError,
  WorkforcePersonaWriterError,
  type WorkforcePersonaPrewriteRepairAttempt,
  type WorkforcePersonaResolver,
} from './workforce-persona-writer.js';
import { createRickyLocalPersonaResolver } from './ricky-local-persona-resolver.js';
import {
  renderReviewFixesForWriter,
  reviewWorkflowWithWorkforcePersona,
  type WorkforcePersonaReviewResult,
} from './workforce-persona-reviewer.js';
import type { WorkforcePersonaReviewSummary } from './types.js';

const DEFAULT_WORKFORCE_PERSONA_PREWRITE_REPAIR_ATTEMPTS = 4;
const MAX_WORKFORCE_PERSONA_PREWRITE_REPAIR_ATTEMPTS = 8;

export function generate(input: GenerationInput): GenerationResult {
  const skillContext = loadSkills(input.spec, input.skillOverrides, input.templateOverride);
  const patternDecision = selectPattern(input.spec, input.patternOverride, skillContext);
  const masterWorkflow = shouldUseMasterExecutionWorkflow(input.spec)
    ? renderMasterExecutionWorkflow({
        spec: input.spec,
        pattern: patternDecision,
        skills: skillContext,
        artifactPath: input.artifactPath,
      })
    : null;
  const artifact = masterWorkflow?.artifact ?? renderWorkflow({
    spec: input.spec,
    pattern: patternDecision,
    skills: skillContext,
    artifactPath: input.artifactPath,
  });
  let finalArtifact = artifact;
  let refinement = null;
  if (input.refine && !masterWorkflow) {
    const refined = refineWithLlm(input.spec, artifact, {
      model: input.refine.model,
      validate: (candidate) => validateGeneratedArtifact(candidate, patternDecision, skillContext, input.spec),
    });
    finalArtifact = refined.artifact;
    refinement = refined.metadata;
  }
  const validation = validateGeneratedArtifact(finalArtifact, patternDecision, skillContext, input.spec);
  const plannedChecks = buildPlannedChecks(finalArtifact, input.dryRunEnabled !== false);

  return {
    success: validation.valid,
    artifact: finalArtifact,
    ...(masterWorkflow ? { masterExecutionPlan: masterWorkflow.plan } : {}),
    patternDecision,
    skillContext,
    toolSelection: {
      selections: finalArtifact.toolSelections,
      defaultRunner: '@agent-relay/sdk',
      issues: [],
    },
    refinement,
    workforcePersona: null,
    validation,
    dryRunCommand: input.dryRunEnabled === false ? null : dryRunCommand(finalArtifact.artifactPath),
    deterministicValidationCommands: plannedChecks
      .filter((check) => check.stage !== 'dry_run')
      .map((check) => check.command),
    plannedChecks,
    executionRoute: resolveExecutionRoute(input.spec, finalArtifact),
    generatedAt: new Date().toISOString(),
  };
}

export async function generateWithWorkforcePersona(input: GenerationInput): Promise<GenerationResult> {
  const baseResult = generate({ ...input, workforcePersonaWriter: false });
  if (input.workforcePersonaWriter === false || !baseResult.artifact || !baseResult.success) {
    return baseResult;
  }

  const artifact = baseResult.artifact;
  const targetMode = input.workforcePersonaWriter?.targetMode ??
    (input.spec.executionPreference === 'cloud' ? 'cloud' : 'local');

  try {
    const resolver: WorkforcePersonaResolver = input.workforcePersonaWriter?.resolver ?? createRickyLocalPersonaResolver();
    const writerOptions = {
      repoRoot: input.workforcePersonaWriter?.repoRoot ?? process.cwd(),
      workflowName: input.workforcePersonaWriter?.workflowName ?? artifact.workflowId,
      targetMode,
      outputPath: artifact.artifactPath,
      relevantFiles: input.workforcePersonaWriter?.relevantFiles,
      timeoutSeconds: input.workforcePersonaWriter?.timeoutSeconds,
      installSkills: input.workforcePersonaWriter?.installSkills,
      installRoot: input.workforcePersonaWriter?.installRoot,
      tier: input.workforcePersonaWriter?.tier,
      ...(input.workforcePersonaWriter?.specPath ? { specPath: input.workforcePersonaWriter.specPath } : {}),
      personaIntentCandidates: input.workforcePersonaWriter?.personaIntentCandidates,
      resolver,
      skillContext: baseResult.skillContext,
    };
    const personaResult = await writeWorkflowWithWorkforcePersona(input.spec, writerOptions);
    let finalArtifact = applyPersonaArtifactToRenderedArtifact(artifact, personaResult);
    let validation = validateGeneratedArtifact(finalArtifact, baseResult.patternDecision, baseResult.skillContext, input.spec);
    let finalPersonaMetadata = personaResult.metadata;
    const repairAttempts = resolvePrewriteRepairAttempts(input.workforcePersonaWriter?.repairAttempts);
    const previousRepairAttempts: WorkforcePersonaPrewriteRepairAttempt[] = [];

    for (let repairAttempt = 1; !validation.valid && repairAttempt <= repairAttempts; repairAttempt += 1) {
      const requestedFixes = validation.errors;
      const repairResult = await writeWorkflowWithWorkforcePersona(input.spec, {
        ...writerOptions,
        tier: workforcePersonaTierForRepairAttempt(writerOptions.tier, repairAttempt),
        validationFeedback: {
          errors: requestedFixes,
          previousContent: finalArtifact.content,
          previousAttempts: previousRepairAttempts,
        },
      });
      const repairedArtifact = applyPersonaArtifactToRenderedArtifact(artifact, repairResult);
      const repairValidation = validateGeneratedArtifact(repairedArtifact, baseResult.patternDecision, baseResult.skillContext, input.spec);

      if (repairValidation.valid) {
        finalArtifact = repairedArtifact;
        validation = repairValidation;
        finalPersonaMetadata = {
          ...repairResult.metadata,
          warnings: [
            ...repairResult.metadata.warnings,
            'Ricky pre-write validation repaired the Workforce persona artifact before writing.',
          ],
        };
        break;
      }

      previousRepairAttempts.push({
        attempt: repairAttempt,
        requestedFixes,
        returnedErrors: repairValidation.errors,
      });
      finalArtifact = repairedArtifact;
      validation = repairValidation;
      finalPersonaMetadata = repairResult.metadata;
    }

    if (!validation.valid) {
      const fallbackMessage = `Ricky pre-write validation rejected the Workforce persona artifact after ${repairAttempts} repair attempt(s) (${validation.errors[0] ?? 'unknown validation error'}); used Ricky deterministic renderer instead.`;
      const fallbackIssue = warningIssue('validation', 'WORKFORCE_PERSONA_PREWRITE_REPAIR_FALLBACK', fallbackMessage);
      return {
        ...baseResult,
        success: true,
        validation: addValidationWarning(baseResult.validation, fallbackIssue),
        workforcePersona: {
          ...finalPersonaMetadata,
          warnings: [...finalPersonaMetadata.warnings, fallbackMessage],
        },
      };
    }

    let reviewSummary: WorkforcePersonaReviewSummary | undefined;
    if (workforcePersonaReviewEnabled(input)) {
      const reviewOutcome = await runWorkforcePersonaReviewPass(input, {
        baseWriterOptions: writerOptions,
        baseArtifact: artifact,
        baseSkillContext: baseResult.skillContext,
        basePatternDecision: baseResult.patternDecision,
        normalizedSpec: input.spec,
        previousRepairAttempts,
        currentArtifact: finalArtifact,
        currentValidation: validation,
        currentPersonaMetadata: finalPersonaMetadata,
      });
      if (reviewOutcome) {
        finalArtifact = reviewOutcome.finalArtifact;
        validation = reviewOutcome.validation;
        finalPersonaMetadata = reviewOutcome.personaMetadata;
        reviewSummary = reviewOutcome.reviewSummary;
      }
    }

    const plannedChecks = buildPlannedChecks(finalArtifact, input.dryRunEnabled !== false);

    return {
      ...baseResult,
      success: validation.valid,
      artifact: finalArtifact,
      validation,
      plannedChecks,
      deterministicValidationCommands: plannedChecks
        .filter((check) => check.stage !== 'dry_run')
        .map((check) => check.command),
      executionRoute: resolveExecutionRoute(input.spec, finalArtifact),
      workforcePersona: reviewSummary
        ? { ...finalPersonaMetadata, review: reviewSummary }
        : finalPersonaMetadata,
    };
  } catch (error) {
    if (error instanceof WorkforcePersonaClarificationError) {
      const issue = blockingIssue(
        'rendering',
        'WORKFORCE_PERSONA_NEEDS_CLARIFICATION',
        error.message,
      );
      const validation = {
        ...baseResult.validation,
        valid: false,
        errors: [...baseResult.validation.errors, issue.message],
        issues: [...baseResult.validation.issues, issue],
      };
      return {
        ...baseResult,
        success: false,
        artifact: null,
        clarificationQuestions: error.questions,
        validation,
        workforcePersona: null,
      };
    }
    // The workforce-persona writer failed (e.g. opencode/claude CLI errored,
    // timed out, or returned a non-completed status). We already have a
    // valid deterministic baseResult.artifact (the early-return at the top
    // of this function ensures baseResult.success === true and
    // baseResult.artifact is non-null), so fall back to it instead of
    // returning success: false. Returning success: false here previously
    // caused entrypoint.execute() to early-return without writing anything,
    // which then made the auto-fix loop chase a phantom artifact path
    // (retryBaseRequest promotes response.artifacts[0].path → request.specPath
    // → workflowFileForRoute returns it → gate skips generation → precheck
    // fails INVALID_ARTIFACT every retry until the auto-fix budget burns).
    //
    // This matches the validation-failure fallback above (lines 154-166),
    // which also returns success: true with the deterministic baseResult.
    const writerError = error instanceof WorkforcePersonaWriterError ? error : null;
    const fallbackMessage = `Workforce persona writer failed (${
      writerError?.message ?? (error instanceof Error ? error.message : String(error))
    }); used Ricky deterministic renderer instead.`;
    const fallbackIssue = warningIssue('rendering', 'WORKFORCE_PERSONA_WRITER_FAILED', fallbackMessage);
    return {
      ...baseResult,
      success: true,
      validation: addValidationWarning(baseResult.validation, fallbackIssue),
      workforcePersona: {
        personaId: 'unresolved',
        tier: 'unknown',
        harness: 'unknown',
        model: 'unknown',
        promptDigest: '',
        warnings: [...(writerError?.warnings ?? []), fallbackMessage],
        runId: null,
        source: 'package',
        selectedIntent: 'agent-relay-workflow',
        responseFormat: 'structured-json',
        outputPath: artifact.artifactPath,
        promptInputs: {
          workflowName: artifact.workflowId,
          targetMode,
          repoRoot: input.workforcePersonaWriter?.repoRoot ?? process.cwd(),
          relevantFileCount: input.workforcePersonaWriter?.relevantFiles?.length ?? input.spec.targetFiles.length,
        },
      },
    };
  }
}

function resolvePrewriteRepairAttempts(value: number | undefined): number {
  if (value === undefined) return DEFAULT_WORKFORCE_PERSONA_PREWRITE_REPAIR_ATTEMPTS;
  if (!Number.isFinite(value)) return DEFAULT_WORKFORCE_PERSONA_PREWRITE_REPAIR_ATTEMPTS;
  return Math.max(0, Math.min(MAX_WORKFORCE_PERSONA_PREWRITE_REPAIR_ATTEMPTS, Math.floor(value)));
}

function workforcePersonaReviewEnabled(input: GenerationInput): boolean {
  const writerOptions = input.workforcePersonaWriter;
  if (writerOptions === false || writerOptions == null) return false;
  if (writerOptions.review === false) return false;
  const envFlag = process.env.RICKY_PERSONA_REVIEW;
  if (envFlag !== undefined) {
    const normalized = envFlag.trim().toLowerCase();
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  }
  return true;
}

interface WorkforcePersonaReviewPassInputs {
  baseWriterOptions: Parameters<typeof writeWorkflowWithWorkforcePersona>[1];
  baseArtifact: RenderedArtifact;
  baseSkillContext: SkillContext;
  basePatternDecision: PatternDecision;
  normalizedSpec: GenerationInput['spec'];
  previousRepairAttempts: WorkforcePersonaPrewriteRepairAttempt[];
  currentArtifact: RenderedArtifact;
  currentValidation: GenerationValidationResult;
  currentPersonaMetadata: WorkforcePersonaGenerationMetadata;
}

interface WorkforcePersonaReviewPassResult {
  finalArtifact: RenderedArtifact;
  validation: GenerationValidationResult;
  personaMetadata: WorkforcePersonaGenerationMetadata;
  reviewSummary: WorkforcePersonaReviewSummary;
}

async function runWorkforcePersonaReviewPass(
  input: GenerationInput,
  inputs: WorkforcePersonaReviewPassInputs,
): Promise<WorkforcePersonaReviewPassResult | null> {
  const writerOptions = input.workforcePersonaWriter;
  if (writerOptions === false || writerOptions == null) return null;
  const reviewOptions = writerOptions.review === undefined ? {} : writerOptions.review;
  if (reviewOptions === false) return null;

  // Reviewer resolver precedence: explicit `review.resolver` overrides
  // everything; otherwise reuse the writer's custom resolver when the
  // caller provided one (so tests and integration callers do not need to
  // wire two parallel resolver mocks). Falls back to the Ricky-local
  // Claude resolver when neither is supplied.
  const reviewResolver = reviewOptions.resolver ?? inputs.baseWriterOptions.resolver;

  let review: WorkforcePersonaReviewResult;
  try {
    review = await reviewWorkflowWithWorkforcePersona(inputs.normalizedSpec, {
      repoRoot: inputs.baseWriterOptions.repoRoot,
      outputPath: inputs.baseArtifact.artifactPath,
      artifactContent: inputs.currentArtifact.content,
      workflowName: inputs.baseWriterOptions.workflowName ?? inputs.baseArtifact.workflowId,
      ...(reviewOptions.tier !== undefined ? { tier: reviewOptions.tier } : {}),
      ...(reviewOptions.timeoutSeconds !== undefined ? { timeoutSeconds: reviewOptions.timeoutSeconds } : {}),
      ...(reviewOptions.personaIntentCandidates ? { personaIntentCandidates: reviewOptions.personaIntentCandidates } : {}),
      ...(reviewResolver ? { resolver: reviewResolver } : {}),
      ...(writerOptions.installRoot !== undefined ? { installRoot: writerOptions.installRoot } : {}),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      finalArtifact: inputs.currentArtifact,
      validation: inputs.currentValidation,
      personaMetadata: appendPersonaWarning(
        inputs.currentPersonaMetadata,
        `Workforce persona review pass skipped: ${message}`,
      ),
      reviewSummary: {
        verdict: 'pass',
        summary: `Reviewer pass was skipped after error: ${message}`,
        personaId: 'unresolved',
        tier: 'unknown',
        harness: 'unknown',
        model: 'unknown',
        selectedIntent: 'review',
        runId: null,
        fixes: [],
        appliedFix: false,
        warnings: [message],
      },
    };
  }

  const reviewSummary: WorkforcePersonaReviewSummary = {
    verdict: review.verdict,
    summary: review.summary,
    personaId: review.metadata.personaId,
    tier: review.metadata.tier,
    harness: review.metadata.harness,
    model: review.metadata.model,
    selectedIntent: review.metadata.selectedIntent,
    runId: review.metadata.runId,
    fixes: review.fixes,
    appliedFix: false,
    warnings: review.metadata.warnings,
  };

  if (review.verdict === 'pass' || review.fixes.length === 0) {
    return {
      finalArtifact: inputs.currentArtifact,
      validation: inputs.currentValidation,
      personaMetadata: inputs.currentPersonaMetadata,
      reviewSummary,
    };
  }

  // Verdict is `fix` (or `block` with fixes): feed the structured fix list
  // back into a single writer repair attempt.
  const fixErrors = renderReviewFixesForWriter(review);
  let appliedArtifact = inputs.currentArtifact;
  let appliedValidation = inputs.currentValidation;
  let appliedMetadata = inputs.currentPersonaMetadata;

  try {
    const repairResult = await writeWorkflowWithWorkforcePersona(inputs.normalizedSpec, {
      ...inputs.baseWriterOptions,
      validationFeedback: {
        errors: fixErrors,
        previousContent: appliedArtifact.content,
        previousAttempts: inputs.previousRepairAttempts,
      },
    });
    const repairedArtifact = applyPersonaArtifactToRenderedArtifact(inputs.baseArtifact, repairResult);
    const repairedValidation = validateGeneratedArtifact(
      repairedArtifact,
      inputs.basePatternDecision,
      inputs.baseSkillContext,
      inputs.normalizedSpec,
    );

    if (repairedValidation.valid) {
      appliedArtifact = repairedArtifact;
      appliedValidation = repairedValidation;
      appliedMetadata = {
        ...repairResult.metadata,
        warnings: [
          ...repairResult.metadata.warnings,
          `Workforce persona reviewer (${review.metadata.model}) returned ${review.fixes.length} fix(es); writer repair attempt applied them.`,
        ],
      };
      reviewSummary.appliedFix = true;
    } else {
      appliedMetadata = appendPersonaWarning(
        inputs.currentPersonaMetadata,
        `Workforce persona reviewer fix attempt did not satisfy deterministic validation; kept the original writer artifact.`,
      );
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    appliedMetadata = appendPersonaWarning(
      inputs.currentPersonaMetadata,
      `Workforce persona reviewer fix attempt failed: ${message}.`,
    );
  }

  return {
    finalArtifact: appliedArtifact,
    validation: appliedValidation,
    personaMetadata: appliedMetadata,
    reviewSummary,
  };
}

function appendPersonaWarning(
  metadata: WorkforcePersonaGenerationMetadata,
  warning: string,
): WorkforcePersonaGenerationMetadata {
  return { ...metadata, warnings: [...metadata.warnings, warning] };
}

function workforcePersonaTierForRepairAttempt(tier: string | undefined, repairAttempt: number): string | undefined {
  return repairAttempt > 3 ? 'best' : tier;
}

export function validateGeneratedArtifact(
  artifact: RenderedArtifact,
  patternDecision: PatternDecision,
  skillContext: SkillContext,
  spec?: NormalizedWorkflowSpec,
): GenerationValidationResult {
  const issues: GenerationIssue[] = [...skillContext.issues];
  const content = artifact.content;
  const hasDeterministicGates = artifact.gates.some((gate) => gate.failOnError);
  const hasReviewStage = /review/i.test(content) && artifact.tasks.some((task) => /review/i.test(task.name) || /review/i.test(task.agentRole));

  if (!/workflow\(/.test(content)) {
    issues.push(blockingIssue('validation', 'WORKFLOW_BUILDER_MISSING', 'Rendered artifact does not call workflow().'));
  }
  if (!hasBalancedDelimiters(content)) {
    issues.push(blockingIssue('validation', 'SYNTAX_STRUCTURE_INVALID', 'Rendered artifact has unbalanced braces, brackets, or parentheses.'));
  }
  if (!content.includes(`.pattern("${patternDecision.pattern}")`) && !content.includes(`.pattern('${patternDecision.pattern}')`)) {
    issues.push(blockingIssue('validation', 'PATTERN_MISMATCH', `Rendered workflow does not use selected pattern ${patternDecision.pattern}.`));
  }
  if (artifact.channel === 'general' || !artifact.channel.startsWith('wf-ricky-')) {
    issues.push(blockingIssue('validation', 'DEDICATED_CHANNEL_MISSING', 'Rendered workflow must use a dedicated wf-ricky-* channel.'));
  }
  if (!hasDeterministicGates) {
    issues.push(blockingIssue('validation', 'DETERMINISTIC_GATE_MISSING', 'Rendered workflow has no failOnError deterministic gate.'));
  }
  if (!hasReviewStage) {
    issues.push(blockingIssue('validation', 'REVIEW_STAGE_MISSING', 'Rendered workflow has no review stage.'));
  }
  if (!artifact.gates.some((gate) => gate.verificationType === 'file_exists')) {
    issues.push(blockingIssue('validation', 'FILE_EXISTS_GATE_MISSING', 'Rendered workflow has no file_exists gate.'));
  }
  if (!hasDeterministicSanityGate(artifact)) {
    issues.push(blockingIssue(
      'validation',
      'GREP_GATE_MISSING',
      'Rendered workflow has no deterministic sanity gate such as grep, git grep, or an equivalent assertion.',
    ));
  }
  const unguardedRipgrepGates = artifact.gates.filter((gate) => usesRipgrep(gate.command) && !hasRipgrepFallback(gate.command));
  if (unguardedRipgrepGates.length > 0) {
    issues.push(blockingIssue(
      'validation',
      'RIPGREP_REQUIRES_FALLBACK',
      `Rendered workflow uses rg without a grep fallback in: ${unguardedRipgrepGates.map((gate) => gate.name).join(', ')}.`,
    ));
  }
  if (!/npx tsc --noEmit/.test(content)) {
    issues.push(blockingIssue('validation', 'TYPECHECK_GATE_MISSING', 'Rendered workflow has no typecheck gate.'));
  }
  if (!/vitest|npm test/.test(content)) {
    issues.push(blockingIssue('validation', 'TEST_GATE_MISSING', 'Rendered workflow has no test gate.'));
  }
  if (!/git diff --(?:name-only|name-status)/.test(content) && !/['"]diff['"],\s*['"]--name-status['"]/.test(content)) {
    issues.push(blockingIssue('validation', 'GIT_DIFF_GATE_MISSING', 'Rendered workflow has no git-diff gate.'));
  }
  if (!/80-to-100|80.?to.?100/i.test(content) || !/fix-loop/.test(content) || !/final-review/.test(content)) {
    issues.push(blockingIssue('validation', 'EIGHTY_TO_ONE_HUNDRED_LOOP_MISSING', 'Rendered workflow lacks the review/fix/final-review 80-to-100 loop.'));
  }
  if (!/prepare-context/.test(content)) {
    issues.push(blockingIssue('validation', 'CONTEXT_READ_MISSING', 'Rendered workflow does not include deterministic context preparation.'));
  }
  if (!/skill-application-boundary\.json/.test(content) || !/generation_time_only/.test(content) || !/runtimeEmbodiment/.test(content)) {
    issues.push(blockingIssue('validation', 'SKILL_BOUNDARY_EVIDENCE_MISSING', 'Rendered workflow does not expose generation-time skill boundary metadata.'));
  }
  if (!hasExplicitWorkflowRunCwd(content)) {
    issues.push(blockingIssue('validation', 'RUN_CWD_MISSING', 'Rendered workflow does not run with explicit cwd.'));
  }
  if (requiresRepairAwareRetry(content)) {
    issues.push(blockingIssue(
      'validation',
      'REPAIR_AWARE_RETRY_MISSING',
      'Rendered workflow must use retry error handling with repairAgent and repairRetries so repairable deterministic gates do not fail the workflow outright.',
    ));
  }

  if (spec && requiresImplementationWorkflow(spec)) {
    if (!/IMPLEMENTATION_WORKFLOW_CONTRACT/.test(content)) {
      issues.push(blockingIssue(
        'validation',
        'IMPLEMENTATION_CONTRACT_MISSING',
        'Implementation specs must render workflows with an explicit implementation contract, not planning-only artifacts.',
      ));
    }
    if (!/source changes|code changes|edit source|implementation diff|non-empty diff/i.test(content)) {
      issues.push(blockingIssue(
        'validation',
        'SOURCE_CHANGE_CONTRACT_MISSING',
        'Implementation workflow must explicitly require source/code changes and non-empty diff evidence.',
      ));
    }
    if (!/pull request|PR URL|gh pr create|gh pr view|result status|result location|explicit result|results?:/i.test(content)) {
      issues.push(blockingIssue(
        'validation',
        'RESULT_PR_REPORTING_MISSING',
        'Implementation workflow must report PR/result evidence or an explicit result status/location instead of only artifact paths.',
      ));
    }
    if (looksPlanningOnly(content)) {
      issues.push(blockingIssue(
        'validation',
        'PLANNING_ONLY_WORKFLOW_FOR_IMPLEMENTATION',
        'Rendered workflow looks planning-only for an implementation spec.',
      ));
    }
  }

  for (const skillName of skillContext.applicableSkillNames) {
    const stages = skillContext.applicationEvidence
      .filter((evidence) => evidence.skillName === skillName)
      .map((evidence) => evidence.stage);
    if (!stages.includes('generation_selection') || !stages.includes('generation_loading')) {
      issues.push(blockingIssue(
        'validation',
        'SKILL_LOAD_EVIDENCE_MISSING',
        `Loaded skill ${skillName} is missing selection/loading generation-time evidence.`,
      ));
    }
  }

  for (const requiredRenderingSkill of ['choosing-swarm-patterns', 'writing-agent-relay-workflows', 'relay-80-100-workflow']) {
    if (
      skillContext.applicableSkillNames.includes(requiredRenderingSkill) &&
      !artifact.skillApplicationEvidence.some(
        (evidence) => evidence.skillName === requiredRenderingSkill && evidence.stage === 'generation_rendering',
      )
    ) {
      issues.push(blockingIssue(
        'validation',
        'SKILL_RENDER_EVIDENCE_MISSING',
        `Loaded skill ${requiredRenderingSkill} is missing generation-rendering evidence in the artifact.`,
      ));
    }
  }

  if (artifact.skillApplicationEvidence.some((evidence) => evidence.behavior !== 'generation_time_only' || evidence.runtimeEmbodiment !== false)) {
    issues.push(blockingIssue('validation', 'SKILL_RUNTIME_EMBODIMENT_CLAIM', 'Skill evidence must not claim runtime agent embodiment.'));
  }

  const finalReviewPassGate = artifact.gates.find((gate) => gate.name === 'final-review-pass-gate');
  if (finalReviewPassGate) {
    for (const reviewName of ['final-review-claude', 'final-review-codex']) {
      const pathInContent = extractReviewOutputPath(content, reviewName);
      if (pathInContent && !finalReviewPassGate.command.includes(pathInContent)) {
        issues.push(blockingIssue(
          'validation',
          'REVIEW_PATH_MISMATCH',
          `Review step ${reviewName} writes to ${pathInContent} but final-review-pass-gate does not check that path.`,
        ));
      }
    }
  }

  const noTargetFiles = !artifact.gates.some((gate) =>
    gate.name === 'post-implementation-file-gate' &&
    gate.command.includes('output-manifest.txt'),
  ) && content.includes('output-manifest.txt');
  if (noTargetFiles) {
    const fileGate = artifact.gates.find((gate) => gate.name === 'post-implementation-file-gate');
    if (fileGate && !fileGate.command.includes('output-manifest')) {
      issues.push(blockingIssue(
        'validation',
        'NO_TARGET_GATE_MISMATCH',
        'Implementation references output-manifest.txt but file gate does not check the manifest.',
      ));
    }
  }

  const errors = issues.filter((issue) => issue.severity === 'error').map((issue) => issue.message);
  const warnings = issues.filter((issue) => issue.severity === 'warning').map((issue) => issue.message);

  return {
    valid: !issues.some((issue) => issue.blocking),
    errors,
    warnings,
    issues,
    hasDeterministicGates,
    hasReviewStage,
  };
}

function requiresRepairAwareRetry(content: string): boolean {
  if (/^\s*\.onError\(\s*['"]fail-fast['"]/m.test(content)) return true;
  const workflowErrorHandling = content
    .split('\n')
    .filter((line) => /^\s*\.onError\(/.test(line));
  if (workflowErrorHandling.length === 0) return true;

  return workflowErrorHandling.some((line) =>
    !/\.onError\(\s*['"]retry['"]\s*,\s*\{.*\brepairAgent\s*:.*\brepairRetries\s*:/.test(line),
  );
}

function hasDeterministicSanityGate(artifact: RenderedArtifact): boolean {
  return artifact.gates.some((gate) => gate.failOnError && isSanityGateCommand(gate.command));
}

function isSanityGateCommand(command: string): boolean {
  const normalized = command.replace(/\\\n/g, ' ').replace(/\s+/g, ' ').trim();
  if (!normalized) return false;

  return [
    /\b(?:git\s+grep|grep|rg)\b/,
    isInlineAssertionCommand(normalized),
    /\bawk\b.*\bexit\b/,
    /\btest\s+-s\s+['"]?[^'"\s]*output-manifest\.txt\b/,
    /\[\[\s+.+(?:==|=~)\s+.+\]\]/,
    /\bcase\b.+\bin\b.+\besac\b/,
  ].some((pattern) => typeof pattern === 'boolean' ? pattern : pattern.test(normalized));
}

function usesRipgrep(command: string): boolean {
  return /(?:^|[;&|()\s])rg(?:\s|$)/.test(command.replace(/\\\n/g, ' '));
}

function hasRipgrepFallback(command: string): boolean {
  const normalized = command.replace(/\\\n/g, ' ').replace(/\s+/g, ' ').trim();
  if (!usesRipgrep(normalized)) return true;
  const ifElseFallback = /\bif\b.*\b(?:command\s+-v|which)\s+rg\b.*\bthen\b.*\brg\b.*\belse\b.*\b(?:git\s+grep|grep)\b.*\bfi\b/.test(normalized);
  const andOrFallback = /\b(?:command\s+-v|which)\s+rg\b.*&&.*\brg\b.*\|\|.*\b(?:git\s+grep|grep)\b/.test(normalized);
  const plainOrFallback = /\brg\b.*\|\|.*\b(?:git\s+grep|grep)\b/.test(normalized);
  return ifElseFallback || andOrFallback || plainOrFallback;
}

function isInlineAssertionCommand(command: string): boolean {
  const invokesInlineRuntime =
    /\b(?:node|bun)\s+(?:--input-type=module\s+)?(?:-e|--eval)\b/.test(command) ||
    /\bpython3?\s+-c\b/.test(command) ||
    /\b(?:ruby|perl)\s+-e\b/.test(command);
  if (!invokesInlineRuntime) return false;

  const readsEvidence = [
    /\breadFileSync\b/,
    /\b(?:existsSync|statSync|accessSync)\b/,
    /\b(?:require|import)\s*\(\s*['"](?:node:)?fs/,
    /\bfrom\s+['"](?:node:)?fs\b/,
    /\bopen\b/,
    /\bPath\s*\(/,
    /\bFile\./,
    /\bARGV\b|\$ARGV\b|@ARGV\b/,
  ].some((pattern) => pattern.test(command));

  const canFailOnMismatch = [
    /\bassert\b/,
    /\bprocess\.exit\s*\(\s*1\s*\)/,
    /\bthrow\s+new\s+Error\b/,
    /\braise\b/,
    /\bdie\b/,
    /\bexit\s+1\b/,
    /\bexit\s*\(\s*1\s*\)/,
    /\bunless\b/,
    /\bif\b/,
  ].some((pattern) => pattern.test(command));

  return readsEvidence && canFailOnMismatch;
}

function requiresImplementationWorkflow(spec: NormalizedWorkflowSpec): boolean {
  const text = [
    spec.description,
    spec.targetContext,
    spec.desiredAction.summary,
    ...spec.constraints.map((constraint) => constraint.constraint),
    ...spec.acceptanceGates.map((gate) => gate.gate),
    ...spec.evidenceRequirements.map((requirement) => requirement.requirement),
  ].filter(Boolean).join('\n');

  const lower = text.toLowerCase();
  const explicitPlanningOnly =
    /\b(plan only|planning only|documentation only|docs only|mapping only)\b/.test(lower);
  const implementationTarget = spec.targetFiles.some((file) => !/\.(md|mdx|txt|adoc)$/i.test(file));
  const implementationSignal =
    /\b(implement|implementation|add|update|replace|migrate|wire|persist|dispatch|route|endpoint|schema|migration|service|webhook|writeback|runtime election|github writeback|webapp|backend|telegram|slack)\b/.test(lower);
  const verificationSignal =
    /\b(test|typecheck|build|acceptance|e2e|end-to-end|pr|pull request|github|diff|files? changed)\b/.test(lower);

  if (explicitPlanningOnly && !implementationTarget && !implementationSignal) return false;

  if (implementationTarget) return true;
  return implementationSignal && verificationSignal;
}

function looksPlanningOnly(content: string): boolean {
  const lower = content.toLowerCase();
  const planSignals = [
    /scaffold[^.\n]+plan/,
    /write the plan to/,
    /minimal[^.\n]+orchestration plan/,
    /create[^.\n]+mapping\.json/,
    /plan\.md/,
    /mapping\.json/,
  ].filter((pattern) => pattern.test(lower)).length;
  const implementationSignals = [
    /implementation_workflow_contract/,
    /source changes/,
    /code changes/,
    /gh pr create/,
    /pull request/,
    /non-empty diff/,
  ].filter((pattern) => pattern.test(lower)).length;

  return planSignals >= 3 && implementationSignals < 2;
}

export function buildPlannedChecks(artifact: RenderedArtifact, includeDryRun = true): PlannedCheck[] {
  const dryRun: PlannedCheck[] = includeDryRun
    ? [
        {
          name: 'dry-run',
          command: dryRunCommand(artifact.artifactPath),
          verificationType: 'exit_code',
          failOnError: true,
          stage: 'dry_run',
          environmentalPrerequisite: 'Requires @agent-relay/cli or agent-relay binary in PATH. Install via: npm install -g @agent-relay/cli',
        },
      ]
    : [];

  return [
    ...dryRun,
    ...artifact.gates.map((gate) => ({
      name: gate.name,
      command: gate.command,
      verificationType: gate.verificationType,
      failOnError: gate.failOnError,
      stage: gate.stage,
    })),
  ];
}

function resolveExecutionRoute(spec: NormalizedWorkflowSpec, artifact: RenderedArtifact): WorkflowExecutionRoute {
  const requestedPreference = spec.executionPreference;
  const invocationSurface = spec.providerContext.surface;
  const resolvedTarget = requestedPreference === 'cloud' ? 'cloud' : 'local';
  const artifactDelivery =
    resolvedTarget === 'cloud' ? 'cloud_artifact' : invocationSurface === 'cli' ? 'write_local_file' : 'return_artifact';
  const reason =
    requestedPreference === 'cloud'
      ? 'Spec requested cloud execution; generated artifact remains Relay TypeScript and can be handed to the Cloud runner.'
      : 'Spec is local or auto; generated artifact can be written locally or returned to MCP/API callers before execution.';

  return {
    requestedPreference,
    resolvedTarget,
    invocationSurface,
    artifactDelivery,
    runnerCommand: dryRunCommand(artifact.artifactPath),
    reason,
  };
}

function dryRunCommand(artifactPath: string): string {
  return `npx agent-relay run --dry-run ${artifactPath}`;
}

function extractReviewOutputPath(content: string, stepName: string): string | null {
  const pattern = new RegExp(`Write\\s+(\\S+/${stepName}\\.md)`);
  const match = pattern.exec(content);
  return match ? match[1] : null;
}

function hasBalancedDelimiters(content: string): boolean {
  const stack: string[] = [];
  const pairs: Record<string, string> = { ')': '(', ']': '[', '}': '{' };
  let inString: string | null = null;
  let escaped = false;
  let inTemplate = 0;

  for (let i = 0; i < content.length; i++) {
    const ch = content[i];
    if (escaped) { escaped = false; continue; }
    if (ch === '\\') { escaped = true; continue; }

    if (inString) {
      if (ch === inString && (inString !== '`' || inTemplate === 0)) inString = null;
      if (inString === '`' && ch === '$' && content[i + 1] === '{') inTemplate++;
      if (inString === '`' && ch === '}' && inTemplate > 0) inTemplate--;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { inString = ch; continue; }
    if (ch === '(' || ch === '[' || ch === '{') stack.push(ch);
    if (ch === ')' || ch === ']' || ch === '}') {
      if (stack.length === 0 || stack[stack.length - 1] !== pairs[ch]) return false;
      stack.pop();
    }
  }
  return stack.length === 0;
}

function blockingIssue(stage: GenerationIssue['stage'], code: string, message: string): GenerationIssue {
  return {
    severity: 'error',
    stage,
    code,
    message,
    blocking: true,
  };
}

function warningIssue(stage: GenerationIssue['stage'], code: string, message: string): GenerationIssue {
  return {
    severity: 'warning',
    stage,
    code,
    message,
    blocking: false,
  };
}

function addValidationWarning(
  validation: GenerationValidationResult,
  issue: GenerationIssue,
): GenerationValidationResult {
  return {
    ...validation,
    warnings: [...validation.warnings, issue.message],
    issues: [...validation.issues, issue],
  };
}
