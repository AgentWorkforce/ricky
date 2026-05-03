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
} from './types.js';
import { selectPattern } from './pattern-selector.js';
import { refineWithLlm } from './refine-with-llm.js';
import { loadSkills } from './skill-loader.js';
import { renderWorkflow } from './template-renderer.js';
import {
  applyPersonaArtifactToRenderedArtifact,
  writeWorkflowWithWorkforcePersona,
  WorkforcePersonaWriterError,
} from './workforce-persona-writer.js';

export function generate(input: GenerationInput): GenerationResult {
  const patternDecision = selectPattern(input.spec, input.patternOverride);
  const skillContext = loadSkills(input.spec, input.skillOverrides, input.templateOverride);
  const artifact = renderWorkflow({
    spec: input.spec,
    pattern: patternDecision,
    skills: skillContext,
    artifactPath: input.artifactPath,
  });
  let finalArtifact = artifact;
  let refinement = null;
  if (input.refine) {
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
    const personaResult = await writeWorkflowWithWorkforcePersona(input.spec, {
      repoRoot: input.workforcePersonaWriter?.repoRoot ?? process.cwd(),
      workflowName: input.workforcePersonaWriter?.workflowName ?? artifact.workflowId,
      targetMode,
      outputPath: artifact.artifactPath,
      relevantFiles: input.workforcePersonaWriter?.relevantFiles,
      timeoutSeconds: input.workforcePersonaWriter?.timeoutSeconds,
      installSkills: input.workforcePersonaWriter?.installSkills,
      installRoot: input.workforcePersonaWriter?.installRoot,
      tier: input.workforcePersonaWriter?.tier,
      personaIntentCandidates: input.workforcePersonaWriter?.personaIntentCandidates,
      resolver: input.workforcePersonaWriter?.resolver,
    });
    const finalArtifact = applyPersonaArtifactToRenderedArtifact(artifact, personaResult);
    const validation = validateGeneratedArtifact(finalArtifact, baseResult.patternDecision, baseResult.skillContext, input.spec);
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
      workforcePersona: personaResult.metadata,
    };
  } catch (error) {
    const writerError = error instanceof WorkforcePersonaWriterError ? error : null;
    const issue = blockingIssue(
      'rendering',
      'WORKFORCE_PERSONA_WRITER_FAILED',
      writerError?.message ?? `Workforce persona writer failed: ${error instanceof Error ? error.message : String(error)}`,
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
      validation,
      workforcePersona: {
        personaId: 'unresolved',
        tier: 'unknown',
        harness: 'unknown',
        model: 'unknown',
        promptDigest: '',
        warnings: writerError?.warnings ?? [],
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
  if (!/\bgrep\b/.test(content)) {
    issues.push(blockingIssue('validation', 'GREP_GATE_MISSING', 'Rendered workflow has no grep sanity gate.'));
  }
  if (!/npx tsc --noEmit/.test(content)) {
    issues.push(blockingIssue('validation', 'TYPECHECK_GATE_MISSING', 'Rendered workflow has no typecheck gate.'));
  }
  if (!/vitest|npm test/.test(content)) {
    issues.push(blockingIssue('validation', 'TEST_GATE_MISSING', 'Rendered workflow has no test gate.'));
  }
  if (!/git diff --name-only/.test(content)) {
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
  if (!/\.run\(\{ cwd: process\.cwd\(\) \}\)/.test(content)) {
    issues.push(blockingIssue('validation', 'RUN_CWD_MISSING', 'Rendered workflow does not run with explicit cwd.'));
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

  for (const requiredRenderingSkill of ['writing-agent-relay-workflows', 'relay-80-100-workflow']) {
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
