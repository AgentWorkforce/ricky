import { readFileSync } from 'node:fs';
import {
  CHANNEL_PREFIX,
  DEFAULT_MAX_CONCURRENCY,
  DEFAULT_RETRY_BACKOFF_MS,
  DEFAULT_RETRY_MAX_ATTEMPTS,
  DEFAULT_TIMEOUT_MS,
} from '../../shared/constants.js';
import type { SwarmPattern } from '../../shared/models/workflow-config.js';
import type {
  DeterministicGate,
  PatternDecision,
  RenderedArtifact,
  SkillApplicationEvidence,
  SkillContext,
  ToolSelection,
  ToolSelectionContext,
  ToolRunner,
  WorkflowTask,
} from './types.js';
import type { NormalizedWorkflowSpec } from '../spec-intake/types.js';
import { selectToolsForSteps } from './tool-selector.js';

interface RenderWorkflowInput {
  spec: NormalizedWorkflowSpec;
  pattern: PatternDecision;
  skills: SkillContext;
  artifactPath?: string;
  toolSelection?: ToolSelectionContext;
}

interface TeamMemberSpec {
  name: string;
  cli: ToolRunner;
  role: string;
  interactive?: boolean;
  preset?: 'reviewer' | 'worker';
  retries: number;
  model?: string;
}

export function renderWorkflow(input: RenderWorkflowInput): RenderedArtifact {
  const slug = slugify(input.spec.description || input.spec.desiredAction.summary || 'generated-workflow');
  const workflowId = `ricky-${slug}`;
  const channel = `${CHANNEL_PREFIX}${slug}`;
  const artifactPath = input.artifactPath ?? `workflows/generated/${workflowId}.ts`;
  const fileName = artifactPath.split('/').at(-1) ?? `${workflowId}.ts`;
  const artifactsDir = `.workflow-artifacts/generated/${slug}`;
  const isCodeWorkflow = isCodeWritingWorkflow(input.spec);
  const team = buildTeam(input.pattern.pattern, isCodeWorkflow);
  const tasks = buildTasks(input.spec, isCodeWorkflow);
  const toolSelection = input.toolSelection ?? selectToolsForSteps(input.spec, tasks, input.skills);
  applyToolSelection(team, toolSelection.selections);
  const gates = buildGates(input.spec, artifactsDir, artifactPath, isCodeWorkflow, input.skills);
  const skillApplicationEvidence = buildRenderingSkillEvidence(input.skills, tasks, gates);
  const content = renderSource({
    spec: input.spec,
    pattern: input.pattern,
    skills: input.skills,
    skillApplicationEvidence,
    workflowId,
    channel,
    artifactsDir,
    team,
    tasks,
    gates,
    isCodeWorkflow,
    toolSelection,
  });

  return {
    fileName,
    artifactPath,
    workflowId,
    content,
    pattern: input.pattern.pattern,
    channel,
    taskCount: tasks.length,
    gateCount: gates.length,
    tasks,
    gates,
    skillApplicationEvidence,
    skillMatches: input.skills.matches,
    toolSelections: toolSelection.selections,
    artifactsDir,
  };
}

function renderSource(input: {
  spec: NormalizedWorkflowSpec;
  pattern: PatternDecision;
  skills: SkillContext;
  skillApplicationEvidence: SkillApplicationEvidence[];
  workflowId: string;
  channel: string;
  artifactsDir: string;
  team: TeamMemberSpec[];
  tasks: WorkflowTask[];
  gates: DeterministicGate[];
  isCodeWorkflow: boolean;
  toolSelection: ToolSelectionContext;
}): string {
  const onError = input.pattern.riskLevel === 'low' ? "'fail-fast'" : `'retry', { maxRetries: ${DEFAULT_RETRY_MAX_ATTEMPTS}, retryDelayMs: ${DEFAULT_RETRY_BACKOFF_MS} }`;
  const lines: string[] = [
    "import { workflow } from '@agent-relay/sdk/workflows';",
    '',
    'async function main() {',
    `  const result = await workflow(${literal(input.workflowId)})`,
    `    .description(${literal(input.spec.description)})`,
    `    .pattern(${literal(input.pattern.pattern)})`,
    `    .channel(${literal(input.channel)})`,
    `    .maxConcurrency(${maxConcurrency(input.pattern.pattern)})`,
    `    .timeout(${DEFAULT_TIMEOUT_MS})`,
    `    .onError(${onError})`,
    '',
    ...input.team.map(renderAgentLine),
    '',
    renderPrepareContextStep(input.spec, input.artifactsDir, input.pattern, input.skills, input.skillApplicationEvidence, input.toolSelection),
    '',
    renderGateStep(input.gates.find((gate) => gate.name === 'skill-boundary-metadata-gate')!),
    '',
    renderLeadPlanStep(input.spec, input.artifactsDir),
    '',
    renderImplementationStep(input.spec, input.isCodeWorkflow, input.artifactsDir, selectionFor(input.toolSelection, 'implement-artifact')),
    '',
    renderGateStep(input.gates.find((gate) => gate.name === 'post-implementation-file-gate')!),
    '',
    renderGateStep(input.gates.find((gate) => gate.name === 'initial-soft-validation')!),
    '',
    renderReviewStep('review-claude', 'reviewer-claude', ['initial-soft-validation'], input.spec, input.artifactsDir, selectionFor(input.toolSelection, 'review-claude')),
    '',
    renderReviewStep('review-codex', 'reviewer-codex', ['initial-soft-validation'], input.spec, input.artifactsDir, selectionFor(input.toolSelection, 'review-codex')),
    '',
    renderReadReviewStep(input.artifactsDir),
    '',
    renderFixLoopStep(input.spec, input.isCodeWorkflow, input.artifactsDir, selectionFor(input.toolSelection, 'fix-loop')),
    '',
    renderGateStep(input.gates.find((gate) => gate.name === 'post-fix-verification-gate')!),
    '',
    renderGateStep(input.gates.find((gate) => gate.name === 'post-fix-validation')!),
    '',
    renderReviewStep('final-review-claude', 'reviewer-claude', ['post-fix-validation'], input.spec, input.artifactsDir, selectionFor(input.toolSelection, 'final-review-claude'), true),
    '',
    renderReviewStep('final-review-codex', 'reviewer-codex', ['post-fix-validation'], input.spec, input.artifactsDir, selectionFor(input.toolSelection, 'final-review-codex'), true),
    '',
    renderGateStep(input.gates.find((gate) => gate.name === 'final-review-pass-gate')!),
    '',
    renderGateStep(input.gates.find((gate) => gate.name === 'final-hard-validation')!),
    '',
    renderGateStep(input.gates.find((gate) => gate.name === 'git-diff-gate')!),
    '',
    renderGateStep(input.gates.find((gate) => gate.name === 'regression-gate')!),
    '',
    renderFinalSignoffStep(input.artifactsDir, selectionFor(input.toolSelection, 'final-signoff')),
    '',
    '    .run({ cwd: process.cwd() });',
    '',
    '  console.log(result.status);',
    '}',
    '',
    'main().catch((error) => {',
    '  console.error(error);',
    '  process.exit(1);',
    '});',
  ];

  return `${lines.join('\n')}\n`;
}

function buildTeam(pattern: SwarmPattern, isCodeWorkflow: boolean): TeamMemberSpec[] {
  if (!isCodeWorkflow) {
    return [
      { name: 'lead-claude', cli: 'claude', interactive: false, role: 'Plans the generated workflow deliverables, boundaries, and verification gates.', retries: 1 },
      { name: 'author-codex', cli: 'codex', role: 'Writes the requested bounded artifact and keeps scope to declared files.', retries: 2 },
      { name: 'reviewer-claude', cli: 'claude', preset: 'reviewer', role: 'Reviews artifact quality, scope, and evidence.', retries: 1 },
      { name: 'reviewer-codex', cli: 'codex', preset: 'reviewer', role: 'Reviews implementation practicality and deterministic checks.', retries: 1 },
      { name: 'validator-claude', cli: 'claude', preset: 'worker', role: 'Applies bounded fixes and confirms final signoff evidence.', retries: 2 },
    ];
  }

  const implementationRole =
    pattern === 'dag'
      ? 'Primary implementer for independent file slices and code changes.'
      : 'Primary implementer for the generated code-writing workflow.';

  return [
    { name: 'lead-claude', cli: 'claude', interactive: false, role: 'Plans task shape, ownership, non-goals, and verification gates.', retries: 1 },
    { name: 'impl-primary-codex', cli: 'codex', role: implementationRole, retries: 2 },
    { name: 'impl-tests-codex', cli: 'codex', role: 'Adds or updates tests and validation coverage for the changed surface.', retries: 2 },
    { name: 'reviewer-claude', cli: 'claude', preset: 'reviewer', role: 'Reviews product fit, scope control, and workflow evidence quality.', retries: 1 },
    { name: 'reviewer-codex', cli: 'codex', preset: 'reviewer', role: 'Reviews TypeScript correctness, deterministic gates, and test coverage.', retries: 1 },
    { name: 'validator-claude', cli: 'claude', preset: 'worker', role: 'Runs the 80-to-100 fix loop and verifies final readiness.', retries: 2 },
  ];
}

function buildTasks(spec: NormalizedWorkflowSpec, isCodeWorkflow: boolean): WorkflowTask[] {
  const implementer = isCodeWorkflow ? 'impl-primary-codex' : 'author-codex';
  return [
    task('prepare-context', 'Prepare context', 'deterministic', 'Read or materialize the normalized spec and target context.', []),
    task('lead-plan', 'Lead plan', 'lead-claude', 'Plan deliverables, non-goals, ownership, and verification gates.', ['skill-boundary-metadata-gate']),
    task('implement-artifact', 'Implement artifact', implementer, describeImplementation(spec), ['lead-plan']),
    task('review-claude', 'Review with Claude', 'reviewer-claude', 'Review generated work against scope and evidence expectations.', ['initial-soft-validation']),
    task('review-codex', 'Review with Codex', 'reviewer-codex', 'Review generated work for code quality and deterministic checks.', ['initial-soft-validation']),
    task('read-review-feedback', 'Read review feedback', 'deterministic', 'Collect review verdicts before fixing.', ['review-claude', 'review-codex']),
    task('fix-loop', '80-to-100 fix loop', 'validator-claude', 'Apply bounded fixes from review and validation feedback.', ['read-review-feedback']),
    task('final-review-claude', 'Final review with Claude', 'reviewer-claude', 'Re-review the fixed state only.', ['post-fix-validation']),
    task('final-review-codex', 'Final review with Codex', 'reviewer-codex', 'Re-review implementation and validation after fixes.', ['post-fix-validation']),
    task('final-signoff', 'Final signoff', 'validator-claude', 'Write final evidence summary after hard deterministic gates.', ['regression-gate']),
  ];
}

function buildGates(
  spec: NormalizedWorkflowSpec,
  artifactsDir: string,
  artifactPath: string,
  isCodeWorkflow: boolean,
  skills: SkillContext,
): DeterministicGate[] {
  const outputManifest = `${artifactsDir}/output-manifest.txt`;
  const usingManifest = spec.targetFiles.length === 0;
  const targetFiles = usingManifest ? [outputManifest] : spec.targetFiles;
  const fileExistsCommand = targetFiles.map((file) => `test -f ${shellQuote(file)}`).join(' && ');
  const grepPattern = isCodeWorkflow ? 'export|function|class|workflow\\(' : '#|##|TODO|Acceptance|Deliverables';
  const grepCommand = usingManifest
    ? `test -s ${shellQuote(outputManifest)} && while IFS= read -r f; do test -f "$f"; done < ${shellQuote(outputManifest)}`
    : `grep -Eq ${shellQuote(grepPattern)} ${targetFiles.map(shellQuote).join(' ')}`;
  const gitDiffPath = `${artifactsDir}/git-diff.txt`;
  const gitDiffCommand = usingManifest
    ? buildManifestGitDiffCommand(outputManifest, gitDiffPath)
    : `{ git diff --name-only -- ${targetFiles.map(shellQuote).join(' ')}; git ls-files --others --exclude-standard -- ${targetFiles.map(shellQuote).join(' ')}; } > ${shellQuote(gitDiffPath)} && sort -u ${shellQuote(gitDiffPath)} -o ${shellQuote(gitDiffPath)} && test -s ${shellQuote(gitDiffPath)}`;
  const testCommand = deriveTestCommand(spec);
  const typecheckCommand = 'npx tsc --noEmit';
  const acceptanceCommands = spec.acceptanceGates.map((gate) => mapAcceptanceGateToCommand(gate.gate));
  const skillBoundaryPath = `${artifactsDir}/skill-application-boundary.json`;

  return [
    gate(
      'skill-boundary-metadata-gate',
      buildSkillBoundaryGateCommand(skillBoundaryPath, skills),
      'artifact_exists',
      true,
      ['prepare-context'],
      'pre_review',
    ),
    gate('post-implementation-file-gate', `${fileExistsCommand} && ${grepCommand}`, 'file_exists', true, ['implement-artifact'], 'pre_review'),
    gate('initial-soft-validation', [typecheckCommand, testCommand, ...acceptanceCommands].join(' && '), 'exit_code', false, ['post-implementation-file-gate'], 'pre_review'),
    gate('post-fix-verification-gate', `${fileExistsCommand} && ${grepCommand}`, 'file_exists', true, ['fix-loop'], 'post_fix'),
    gate('post-fix-validation', [typecheckCommand, testCommand].join(' && '), 'exit_code', false, ['post-fix-verification-gate'], 'post_fix'),
    gate(
      'final-review-pass-gate',
      [
        `tail -n 1 ${shellQuote(`${artifactsDir}/final-review-claude.md`)} | tr -d '[:space:]*' | grep -Eq '^FINAL_REVIEW_CLAUDE_PASS$'`,
        `tail -n 1 ${shellQuote(`${artifactsDir}/final-review-codex.md`)} | tr -d '[:space:]*' | grep -Eq '^FINAL_REVIEW_CODEX_PASS$'`,
      ].join(' && '),
      'output_contains',
      true,
      ['final-review-claude', 'final-review-codex'],
      'final',
    ),
    gate('final-hard-validation', [typecheckCommand, testCommand].join(' && '), 'deterministic_gate', true, ['final-review-pass-gate'], 'final'),
    gate('git-diff-gate', gitDiffCommand, 'artifact_exists', true, ['final-hard-validation'], 'final'),
    gate('regression-gate', isCodeWorkflow ? 'npx vitest run' : 'git diff --check', 'exit_code', true, ['git-diff-gate'], 'regression'),
  ];
}

function buildManifestGitDiffCommand(outputManifest: string, gitDiffPath: string): string {
  const quotedManifest = shellQuote(outputManifest);
  const quotedGitDiffPath = shellQuote(gitDiffPath);
  return [
    `test -s ${quotedManifest}`,
    `: > ${quotedGitDiffPath}`,
    `while IFS= read -r f; do { git diff --name-only -- "$f"; git ls-files --others --exclude-standard -- "$f"; } >> ${quotedGitDiffPath}; done < ${quotedManifest}`,
    `sort -u ${quotedGitDiffPath} -o ${quotedGitDiffPath}`,
    `test -s ${quotedGitDiffPath}`,
  ].join(' && ');
}

function buildSkillBoundaryGateCommand(skillBoundaryPath: string, skills: SkillContext): string {
  const quotedPath = shellQuote(skillBoundaryPath);
  const artifactsDir = skillBoundaryPath.replace(/\/skill-application-boundary\.json$/, '');
  const commands = [
    `test -f ${quotedPath}`,
    `test -f ${shellQuote(`${artifactsDir}/skill-matches.json`)}`,
    `test -f ${shellQuote(`${artifactsDir}/tool-selection.json`)}`,
    `grep -F ${shellQuote('generation_time_only')} ${quotedPath}`,
    `grep -F ${shellQuote('"runtimeEmbodiment":false')} ${quotedPath}`,
    ...skills.applicableSkillNames.map((skillName) => `grep -F ${shellQuote(skillName)} ${quotedPath}`),
  ];

  if (skills.applicableSkillNames.length > 0) {
    commands.push(
      `grep -F ${shellQuote('"stage":"generation_selection"')} ${quotedPath}`,
      `grep -F ${shellQuote('"stage":"generation_loading"')} ${quotedPath}`,
      `grep -F ${shellQuote('"effect":"metadata"')} ${quotedPath}`,
    );
  }

  if (skills.applicableSkillNames.includes('writing-agent-relay-workflows')) {
    commands.push(
      `grep -F ${shellQuote('"stage":"generation_rendering"')} ${quotedPath}`,
      `grep -F ${shellQuote('"effect":"workflow_contract"')} ${quotedPath}`,
    );
  }

  if (skills.applicableSkillNames.includes('relay-80-100-workflow')) {
    commands.push(
      `grep -F ${shellQuote('"stage":"generation_rendering"')} ${quotedPath}`,
      `grep -F ${shellQuote('"effect":"validation_gates"')} ${quotedPath}`,
    );
  }

  return commands.join(' && ');
}

function applyToolSelection(team: TeamMemberSpec[], selections: ToolSelection[]): void {
  for (const member of team) {
    const selection = selections.find((candidate) => candidate.agent === member.name);
    if (!selection) continue;
    if (selection.runner !== '@agent-relay/sdk') member.cli = selection.runner;
    if (selection.model) member.model = selection.model;
  }
}

function selectionFor(context: ToolSelectionContext, stepId: string): ToolSelection | undefined {
  return context.selections.find((selection) => selection.stepId === stepId);
}

function renderSelectionFields(selection?: ToolSelection): string {
  void selection;
  // The installed Agent Relay SDK exposes runner/model at the agent definition
  // layer, not on StepOptions. Per-step decisions remain auditable in
  // tool-selection.json while generated workflow TypeScript stays valid.
  return '';
}

function renderToolSelectionSummary(selection?: ToolSelection): string {
  if (!selection) return '';
  return [
    '',
    `Tool selection: runner=${selection.runner}${selection.model ? ` model=${selection.model}` : ''}; concurrency=${selection.concurrency}; rule=${selection.rule}.`,
  ].join('\n');
}

function renderAgentLine(member: TeamMemberSpec): string {
  const options = [`cli: ${literal(member.cli)}`, `role: ${literal(member.role)}`, `retries: ${member.retries}`];
  if (member.preset) options.splice(1, 0, `preset: ${literal(member.preset)}`);
  if (member.model) options.push(`model: ${literal(member.model)}`);
  return `    .agent(${literal(member.name)}, { ${options.join(', ')} })`;
}

function renderPrepareContextStep(
  spec: NormalizedWorkflowSpec,
  artifactsDir: string,
  pattern: PatternDecision,
  skills: SkillContext,
  skillApplicationEvidence: SkillApplicationEvidence[],
  toolSelection: ToolSelectionContext,
): string {
  const skillBoundary = {
    behavior: 'generation_time_only',
    runtimeEmbodiment: false,
    boundary: 'Skills influence Ricky generator selection, loading, template rendering, workflow contract, validation gates, and metadata. Generated runtime agents receive only the rendered workflow instructions; they do not load or embody skill files at runtime.',
    loadedSkills: skills.applicableSkillNames,
    applicationEvidence: normalizeSkillApplicationEvidenceForArtifact(skillApplicationEvidence),
  };
  const loadedSkillsReport = skills.matches.length > 0
    ? skills.matches.map((match) => {
        const evidence = match.evidence.map((item) => `${item.source}:${item.trigger}`).join(', ') || 'no trigger evidence';
        return `${match.id} confidence=${match.confidence} reason=${match.reason} evidence=${evidence}`;
      }).join('\n')
    : 'No skills matched the normalized spec.';
  const skillContextCommands = skills.matches
    .filter((match) => match.path)
    .flatMap((match) => {
      const skillContent = safeReadText(match.path);
      return [
        `printf '%s\\n' ${shellQuote(`\n# ${match.id}\nreason=${match.reason}\n`)} >> ${shellQuote(`${artifactsDir}/matched-skills.md`)}`,
        `printf '%s\\n' ${shellQuote(skillContent)} >> ${shellQuote(`${artifactsDir}/matched-skills.md`)}`,
      ];
    });
  const commands = [
    `mkdir -p ${shellQuote(artifactsDir)}`,
    `printf '%s\\n' ${shellQuote(spec.description)} > ${shellQuote(`${artifactsDir}/normalized-spec.txt`)}`,
    `printf '%s\\n' ${shellQuote(`pattern=${pattern.pattern}; reason=${pattern.reason}`)} > ${shellQuote(`${artifactsDir}/pattern-decision.txt`)}`,
    `printf '%s\\n' ${shellQuote(loadedSkillsReport)} > ${shellQuote(`${artifactsDir}/loaded-skills.txt`)}`,
    `printf '%s\\n' ${shellQuote(JSON.stringify(normalizeSkillMatchesForArtifact(skills.matches)))} > ${shellQuote(`${artifactsDir}/skill-matches.json`)}`,
    `printf '%s\\n' ${shellQuote(JSON.stringify(toolSelection.selections))} > ${shellQuote(`${artifactsDir}/tool-selection.json`)}`,
    `printf '%s\\n' ${shellQuote(JSON.stringify(skillBoundary))} > ${shellQuote(`${artifactsDir}/skill-application-boundary.json`)}`,
    `printf '%s\\n' ${shellQuote(skillBoundary.boundary)} > ${shellQuote(`${artifactsDir}/skill-runtime-boundary.txt`)}`,
    `: > ${shellQuote(`${artifactsDir}/matched-skills.md`)}`,
    ...skillContextCommands,
    ...(spec.targetContext ? [renderTargetContextCommand(spec.targetContext, `${artifactsDir}/target-context.txt`)] : []),
    'echo GENERATED_WORKFLOW_CONTEXT_READY',
  ];

  return renderDeterministicStep('prepare-context', [], commands.join(' && '), true);
}

function renderTargetContextCommand(targetContext: string, outputPath: string): string {
  const quotedContext = shellQuote(targetContext);
  const quotedOutput = shellQuote(outputPath);
  return `if test -f ${quotedContext}; then cat ${quotedContext} > ${quotedOutput}; else printf '%s\\n' ${quotedContext} > ${quotedOutput}; fi`;
}

function renderLeadPlanStep(spec: NormalizedWorkflowSpec, artifactsDir: string): string {
  return `    .step('lead-plan', {
      agent: 'lead-claude',
      dependsOn: ['skill-boundary-metadata-gate'],
      task: ${templateLiteral(`Plan the workflow execution from the normalized spec.

Generation-time skill boundary:
- Read ${artifactsDir}/skill-application-boundary.json and treat it as generator metadata only.
- Skills are applied by Ricky during selection, loading, and template rendering.
- Do not claim generated agents load, retain, or embody skill files at runtime unless a future runtime test proves that path.

Description:
${spec.description}

Deliverables:
${formatList(spec.targetFiles.length > 0 ? spec.targetFiles : ['A generated workflow artifact and any requested output files'])}

Non-goals:
${formatList(spec.constraints.filter((constraint) => constraint.category === 'scope').map((constraint) => constraint.constraint))}

Verification commands:
${formatList(['file_exists gate for declared targets', 'grep sanity gate', 'npx tsc --noEmit', deriveTestCommand(spec), 'git diff --name-only gate'])}

Write ${artifactsDir}/lead-plan.md ending with GENERATION_LEAD_PLAN_READY.`)},
      verification: { type: 'file_exists', value: ${literal(`${artifactsDir}/lead-plan.md`)} },
    })`;
}

function renderImplementationStep(
  spec: NormalizedWorkflowSpec,
  isCodeWorkflow: boolean,
  artifactsDir: string,
  selection?: ToolSelection,
): string {
  const agent = isCodeWorkflow ? 'impl-primary-codex' : 'author-codex';
  const selectionLines = renderSelectionFields(selection);
  const noTargetInstructions = `No explicit file targets were supplied. Write all created file paths (one per line) to ${artifactsDir}/output-manifest.txt. Keep changes bounded.`;
  return `    .step('implement-artifact', {
      agent: ${literal(agent)},
      dependsOn: ['lead-plan'],
${selectionLines}
      task: ${templateLiteral(`${isCodeWorkflow ? 'Implement the requested code-writing workflow slice.' : 'Author the requested workflow artifact.'}

Scope:
${spec.description}

Own only declared targets unless review feedback explicitly narrows a required fix:
${formatList(spec.targetFiles.length > 0 ? spec.targetFiles : [noTargetInstructions])}

Acceptance gates:
${formatList(spec.acceptanceGates.map((gate) => gate.gate))}
${renderToolSelectionSummary(selection)}

Before editing, read ${artifactsDir}/matched-skills.md when it exists and use it only as generation-time context for this task.

Keep execution routing explicit for local, cloud, and MCP callers. Materialize outputs to disk, then stop for deterministic gates.`)},
    })`;
}

function renderReviewStep(
  stepName: string,
  agent: string,
  dependsOn: string[],
  spec: NormalizedWorkflowSpec,
  artifactsDir: string,
  selection?: ToolSelection,
  final = false,
): string {
  const marker = final ? (agent.includes('claude') ? 'FINAL_REVIEW_CLAUDE_PASS' : 'FINAL_REVIEW_CODEX_PASS') : 'REVIEW_COMPLETE';
  const reviewPath = `${artifactsDir}/${stepName}.md`;
  const selectionLines = renderSelectionFields(selection);
  return `    .step(${literal(stepName)}, {
      agent: ${literal(agent)},
      dependsOn: ${arrayLiteral(dependsOn)},
${selectionLines}
      task: ${templateLiteral(`${final ? 'Re-review the fixed state only.' : 'Review the generated work.'}

Assess:
- declared file targets and non-goals
- deterministic gates and evidence quality
- review/fix/final-review 80-to-100 loop shape
- local/cloud/MCP routing clarity

Spec:
${spec.description}
${renderToolSelectionSummary(selection)}

Write ${reviewPath} ending with ${marker}.`)},
      verification: { type: 'file_exists', value: ${literal(reviewPath)} },
    })`;
}

function renderReadReviewStep(artifactsDir: string): string {
  return renderDeterministicStep(
    'read-review-feedback',
    ['review-claude', 'review-codex'],
    [
      `test -f ${shellQuote(`${artifactsDir}/review-claude.md`)}`,
      `test -f ${shellQuote(`${artifactsDir}/review-codex.md`)}`,
      `cat ${shellQuote(`${artifactsDir}/review-claude.md`)} ${shellQuote(`${artifactsDir}/review-codex.md`)} > ${shellQuote(`${artifactsDir}/review-feedback.md`)}`,
    ].join(' && '),
    true,
  );
}

function renderFixLoopStep(
  spec: NormalizedWorkflowSpec,
  isCodeWorkflow: boolean,
  artifactsDir: string,
  selection?: ToolSelection,
): string {
  const selectionLines = renderSelectionFields(selection);
  return `    .step('fix-loop', {
      agent: 'validator-claude',
      dependsOn: ['read-review-feedback'],
${selectionLines}
      task: ${templateLiteral(`Run the 80-to-100 fix loop.

Inputs:
- ${artifactsDir}/review-feedback.md
- initial validation output from the previous deterministic step

Fix only concrete review or validation findings. Preserve the declared target boundary:
${formatList(spec.targetFiles.length > 0 ? spec.targetFiles : ['No explicit targets supplied'])}
${renderToolSelectionSummary(selection)}

Re-run ${isCodeWorkflow ? 'typecheck and tests' : 'document sanity checks'} before handing off to post-fix validation.`)},
    })`;
}

function renderFinalSignoffStep(artifactsDir: string, selection?: ToolSelection): string {
  const selectionLines = renderSelectionFields(selection);
  return `    .step('final-signoff', {
      agent: 'validator-claude',
      dependsOn: ['regression-gate'],
${selectionLines}
      task: ${templateLiteral(`Write ${artifactsDir}/signoff.md.

Include:
- files changed
- dry-run command to execute before runtime launch
- deterministic validation commands
- review verdicts
- skill application boundary from ${artifactsDir}/skill-application-boundary.json
- remaining risks or environmental blockers
${renderToolSelectionSummary(selection)}

End with GENERATED_WORKFLOW_READY.`)},
      verification: { type: 'file_exists', value: ${literal(`${artifactsDir}/signoff.md`)} },
    })`;
}

function renderGateStep(gateToRender: DeterministicGate): string {
  return renderDeterministicStep(gateToRender.name, gateToRender.dependsOn, gateToRender.command, gateToRender.failOnError);
}

function renderDeterministicStep(name: string, dependsOn: string[], command: string, failOnError: boolean): string {
  const depends = dependsOn.length > 0 ? `\n      dependsOn: ${arrayLiteral(dependsOn)},` : '';
  return `    .step(${literal(name)}, {
      type: 'deterministic',${depends}
      command: ${literal(command)},
      captureOutput: true,
      failOnError: ${failOnError},
    })`;
}

function task(id: string, name: string, agentRole: string, description: string, dependsOn: string[]): WorkflowTask {
  return { id, name, agentRole, description, dependsOn };
}

function gate(
  name: string,
  command: string,
  verificationType: DeterministicGate['verificationType'],
  failOnError: boolean,
  dependsOn: string[],
  stage: DeterministicGate['stage'],
): DeterministicGate {
  return { name, command, verificationType, failOnError, dependsOn, stage };
}

function buildRenderingSkillEvidence(
  skills: SkillContext,
  tasks: WorkflowTask[],
  gates: DeterministicGate[],
): SkillApplicationEvidence[] {
  const loaded = new Set(skills.applicableSkillNames);
  const evidence: SkillApplicationEvidence[] = [...skills.applicationEvidence];

  if (loaded.has('writing-agent-relay-workflows')) {
    evidence.push({
      skillName: 'writing-agent-relay-workflows',
      stage: 'generation_rendering',
      effect: 'workflow_contract',
      behavior: 'generation_time_only',
      runtimeEmbodiment: false,
      evidence: `Rendered ${tasks.length} workflow tasks with dedicated channel setup, explicit agents, step dependencies, review stages, and final signoff.`,
    });
  }

  if (loaded.has('relay-80-100-workflow')) {
    evidence.push({
      skillName: 'relay-80-100-workflow',
      stage: 'generation_rendering',
      effect: 'validation_gates',
      behavior: 'generation_time_only',
      runtimeEmbodiment: false,
      evidence: `Rendered ${gates.length} deterministic gates including initial soft validation, fix-loop checks, final hard validation, git diff, and regression gates.`,
    });
  }

  return evidence;
}

function maxConcurrency(pattern: SwarmPattern): number {
  if (pattern === 'pipeline') return 1;
  if (pattern === 'supervisor') return Math.min(3, DEFAULT_MAX_CONCURRENCY);
  return DEFAULT_MAX_CONCURRENCY;
}

function describeImplementation(spec: NormalizedWorkflowSpec): string {
  if (spec.targetFiles.length === 0) return 'Materialize the requested workflow artifact and record created files.';
  return `Edit declared targets: ${spec.targetFiles.join(', ')}`;
}

function deriveTestCommand(spec: NormalizedWorkflowSpec): string {
  const explicitTestGate = spec.acceptanceGates.find((gate) => /\b(vitest|npm test)\b/i.test(gate.gate));
  if (explicitTestGate) return mapAcceptanceGateToCommand(explicitTestGate.gate);

  const testTargets = spec.targetFiles.filter((file) => /\.(test|spec)\.(ts|tsx|js|jsx)$/i.test(file));
  if (testTargets.length > 0) return `npx vitest run ${testTargets.map(shellQuote).join(' ')}`;
  return 'npx vitest run';
}

function mapAcceptanceGateToCommand(gateText: string): string {
  const inlineCommand = extractInlineShellCommand(gateText);
  if (inlineCommand) return inlineCommand;

  if (/\btsc|typecheck\b/i.test(gateText)) return 'npx tsc --noEmit';
  if (/\bvitest\b/i.test(gateText)) return gateText.trim();
  if (/\bnpm test\b/i.test(gateText)) return 'npm test';
  if (/\bfile exists|file_exists\b/i.test(gateText)) return `test -f ${shellQuote(gateText.replace(/.*(?:file exists|file_exists)\s*:?\s*/i, '').trim() || '.')}`;
  if (/^\s*(?:grep|node|npx|npm|test)\b/i.test(gateText)) return gateText.trim();
  return `printf '%s\\n' ${shellQuote(`Manual acceptance gate: ${gateText}`)}`;
}

function extractInlineShellCommand(text: string): string | null {
  const candidates = [...text.matchAll(/`([^`\n]+)`/g)].map((match) => match[1].trim());
  return candidates.find((candidate) => /^(?:node|npx|npm|grep|test)\b/i.test(candidate)) ?? null;
}

function isCodeWritingWorkflow(spec: NormalizedWorkflowSpec): boolean {
  const text = [spec.description, ...spec.constraints.map((constraint) => constraint.constraint)].join('\n').toLowerCase();
  if (/\b(implement|code|typescript|test|api|runtime|fix|refactor|build)\b/.test(text)) return true;
  if (spec.targetFiles.length === 0) return false;
  return spec.targetFiles.some((file) => !/\.(md|mdx|txt|adoc)$/i.test(file));
}

function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/g, '');
  return slug || 'generated-workflow';
}

function formatList(items: string[]): string {
  const cleanItems = items.filter((item) => item.trim().length > 0);
  if (cleanItems.length === 0) return '- None declared';
  return cleanItems.map((item) => `- ${item}`).join('\n');
}

function literal(value: string): string {
  return JSON.stringify(value);
}

function arrayLiteral(values: string[]): string {
  return `[${values.map(literal).join(', ')}]`;
}

function templateLiteral(value: string): string {
  return `\`${value.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${')}\``;
}

function normalizeSkillMatchesForArtifact(
  matches: { id: string; name: string; confidence: number; reason: string; evidence: { trigger: string; source: string; detail: string }[] }[],
): { id: string; name: string; confidence: number; reason: string; evidence: { trigger: string; source: string; detail: string }[] }[] {
  return matches.map(({ id, name, confidence, reason, evidence }) => ({
    id,
    name,
    confidence,
    reason,
    evidence,
  }));
}

function normalizeSkillApplicationEvidenceForArtifact(evidence: SkillApplicationEvidence[]): SkillApplicationEvidence[] {
  return evidence.map((entry) => ({
    ...entry,
    evidence: entry.evidence.replace(/ from \/[^.\s][^\s]*/g, ' from SKILL_DESCRIPTOR_PATH'),
  }));
}

function safeReadText(path: string): string {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return 'UNAVAILABLE_SKILL_CONTENT';
  }
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}
