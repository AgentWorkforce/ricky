import type { NormalizedWorkflowSpec } from '../spec-intake/types.js';
import {
  DEFAULT_REPAIR_RETRY_ATTEMPTS,
  DEFAULT_RETRY_BACKOFF_MS,
  DEFAULT_RETRY_MAX_ATTEMPTS,
} from '../../shared/constants.js';
import { planMasterExecution, type ChildWorkflowPlan, type MasterExecutionPlan } from '../orchestration/index.js';
import type {
  DeterministicGate,
  PatternDecision,
  RenderedArtifact,
  SkillApplicationEvidence,
  SkillContext,
  ToolSelection,
  WorkflowTask,
} from './types.js';

interface RenderMasterWorkflowInput {
  spec: NormalizedWorkflowSpec;
  pattern: PatternDecision;
  skills: SkillContext;
  artifactPath?: string;
}

interface RenderedMasterWorkflow {
  artifact: RenderedArtifact;
  plan: MasterExecutionPlan;
}

const MASTER_EXPLICIT_PATTERN =
  /\b(master executor|master orchestration|smaller workflows|child workflows|several workflows|multiple workflows|break(?:ing)? (?:it )?(?:out|up)|divvy|decompos(?:e|ition)|workflow waves?)\b/i;

const IMPLEMENTATION_PATTERN =
  /\b(implement|wire|add|build|ship|migrate|refactor|replace|runtime|policy|telemetry|evals?|insights?|runner|api|cli|tests?)\b/i;

export function shouldUseMasterExecutionWorkflow(spec: NormalizedWorkflowSpec): boolean {
  const text = workflowText(spec);
  if (!IMPLEMENTATION_PATTERN.test(text)) return false;
  if (MASTER_EXPLICIT_PATTERN.test(text)) return true;
  if (spec.targetFiles.length >= 4) return true;
  return false;
}

export function renderMasterExecutionWorkflow(input: RenderMasterWorkflowInput): RenderedMasterWorkflow {
  const slug = slugify(workflowNameFromArtifactPath(input.artifactPath) || input.spec.description || 'master-workflow');
  const artifactPath = input.artifactPath ?? `workflows/generated/ricky-${slug}.ts`;
  const workflowId = `ricky-${slug}`;
  const artifactsDir = `.workflow-artifacts/generated/${slug}`;
  const wavePrefix = `generated/${slug}-children`;
  const plan = planMasterExecution({
    title: input.spec.description,
    description: input.spec.description,
    targetFiles: input.spec.targetFiles,
    workflowSlug: slug,
    wavePrefix,
    desiredSlices: desiredSlicesFor(input.spec),
    constraints: {
      maxChildren: 12,
      requiredGateMarkers: ['RICKY_CHILD_WORKFLOW_COMPLETE'],
    },
  });
  const channel = `wf-ricky-${slug}`;
  const tasks = buildMasterTasks(plan);
  const gates = buildMasterGates(artifactsDir, plan);
  const skillApplicationEvidence = buildMasterSkillEvidence(input.skills);
  const toolSelections = buildMasterToolSelections(plan);
  const content = renderMasterSource({
    spec: input.spec,
    pattern: input.pattern,
    workflowId,
    channel,
    artifactsDir,
    plan,
    skills: input.skills,
    skillApplicationEvidence,
  });

  return {
    plan,
    artifact: {
      fileName: artifactPath.split('/').at(-1) ?? `${workflowId}.ts`,
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
      toolSelections,
      artifactsDir,
    },
  };
}

function desiredSlicesFor(spec: NormalizedWorkflowSpec): NonNullable<Parameters<typeof planMasterExecution>[0]['desiredSlices']> {
  if (spec.targetFiles.length >= 2) {
    return spec.targetFiles.map((targetFile) => ({
      title: titleForTargetFile(targetFile),
      summary: `Own changes and validation for ${targetFile}.`,
      targetFiles: [targetFile],
    }));
  }

  const titles = extractSliceTitles(sliceSourceText(spec));
  return titles.map((title) => ({
    title,
    summary: `Own the ${title.toLowerCase()} child workflow slice.`,
    targetFiles: [],
  }));
}

function renderMasterSource(input: {
  spec: NormalizedWorkflowSpec;
  pattern: PatternDecision;
  workflowId: string;
  channel: string;
  artifactsDir: string;
  plan: MasterExecutionPlan;
  skills: SkillContext;
  skillApplicationEvidence: SkillApplicationEvidence[];
}): string {
  const childSources = Object.fromEntries(
    input.plan.children.map((child) => [child.workflowFilePath, childWorkflowSource(child, input.spec)]),
  );
  const planJson = JSON.stringify(input.plan, null, 2);
  const skillMatchesJson = JSON.stringify(input.skills.matches, null, 2);
  const skillBoundaryJson = JSON.stringify({
    behavior: 'generation_time_only',
    runtimeEmbodiment: false,
    boundary: 'Skills shape this master workflow during Ricky generation. Runtime child agents receive rendered workflow instructions only.',
    loadedSkills: input.skills.applicableSkillNames,
    applicationEvidence: input.skillApplicationEvidence,
  }, null, 2);
  const materializeCommand = [
    'node --input-type=module <<\'NODE\'',
    'import { mkdirSync, writeFileSync } from \'node:fs\';',
    'import { dirname } from \'node:path\';',
    `const childSources = ${JSON.stringify(childSources, null, 2)};`,
    'for (const [filePath, source] of Object.entries(childSources)) {',
    '  mkdirSync(dirname(filePath), { recursive: true });',
    '  writeFileSync(filePath, source, \'utf8\');',
    '  console.log(`materialized_child_workflow=${filePath}`);',
    '}',
    'NODE',
  ].join('\n');
  const verifyChildrenCommand = [
    'set -e',
    ...input.plan.children.map((child) => `test -f ${shellQuote(child.workflowFilePath)}`),
    'if command -v rg >/dev/null 2>&1; then rg "RICKY_CHILD_WORKFLOW_COMPLETE" workflows/generated >/dev/null; else grep -R "RICKY_CHILD_WORKFLOW_COMPLETE" workflows/generated >/dev/null; fi',
    'echo RICKY_MASTER_CHILD_WORKFLOWS_READY',
  ].join('\n');
  const finalSignoffCommand = [
    'set -e',
    `mkdir -p ${shellQuote(input.artifactsDir)}`,
    `cat > ${shellQuote(`${input.artifactsDir}/signoff.md`)} <<'EOF'`,
    '# Ricky master executor signoff',
    '',
    `Master plan: ${input.plan.children.length} child workflows across ${waveCount(input.plan)} waves.`,
    'The master executor ran child workflows through ricky run and checked deterministic signoff markers.',
    'Source changes, code changes, tests, git diff evidence, and PR URL or explicit result reporting are required from child workflows.',
    '',
    'MASTER_EXECUTOR_RESULT_READY',
    'EOF',
    'echo MASTER_EXECUTOR_RESULT_READY',
  ].join('\n');

  return `${[
    "import { workflow } from '@agent-relay/sdk/workflows';",
    '',
    '// IMPLEMENTATION_WORKFLOW_CONTRACT: broad implementation specs run as child workflows with source changes, tests, non-empty diff evidence, and PR/result reporting.',
    '// RICKY_MASTER_EXECUTOR_WORKFLOW: Ricky kept the CLI interface stable and decomposed this spec internally.',
    '// 80-to-100 master contract: child workflows perform fix-loop work, then the master performs final-review evidence checks before signoff.',
    '',
    'async function main() {',
    `  const result = await workflow(${literal(input.workflowId)})`,
    `    .description(${literal(input.spec.description)})`,
    `    .pattern(${literal(input.pattern.pattern)})`,
    `    .channel(${literal(input.channel)})`,
    '    .maxConcurrency(4)',
    '    .timeout(7200000)',
    `    .onError(${repairAwareOnError('master-lead')})`,
    '',
    '    .agent("master-lead", { cli: "claude", interactive: false, role: "Plans child workflow boundaries, dependency waves, and final integration evidence.", retries: 1 })',
    '    .agent("master-reviewer", { cli: "codex", preset: "reviewer", role: "Reviews child signoff evidence and master executor readiness.", retries: 1 })',
    '',
    '    .step("prepare-context", {',
    '      type: "deterministic",',
    `      command: ${literal([
      'set -e',
      `mkdir -p ${shellQuote(input.artifactsDir)}`,
      `cat > ${shellQuote(`${input.artifactsDir}/master-plan.json`)} <<'EOF'`,
      planJson,
      'EOF',
      `cat > ${shellQuote(`${input.artifactsDir}/skill-matches.json`)} <<'EOF'`,
      skillMatchesJson,
      'EOF',
      `cat > ${shellQuote(`${input.artifactsDir}/skill-application-boundary.json`)} <<'EOF'`,
      skillBoundaryJson,
      'EOF',
      `printf '%s\\n' 'generation_time_only' 'runtimeEmbodiment=false' > ${shellQuote(`${input.artifactsDir}/skill-runtime-boundary.txt`)}`,
      'echo RICKY_MASTER_CONTEXT_READY',
    ].join('\n'))},`,
    '      captureOutput: true,',
    '      failOnError: true,',
    '    })',
    '',
    '    .step("lead-plan", {',
    '      agent: "master-lead",',
    '      dependsOn: ["prepare-context"],',
    `      task: ${templateLiteral([
      'Review the master execution plan at ' + `${input.artifactsDir}/master-plan.json` + '.',
      'Confirm child workflow ownership, dependencies, non-goals, and 80-to-100 gates.',
      'Do not edit source files in this step.',
      `Write ${input.artifactsDir}/lead-plan.md ending with RICKY_MASTER_LEAD_PLAN_READY.`,
    ].join('\n'))},`,
    `      verification: { type: "file_exists", value: ${literal(`${input.artifactsDir}/lead-plan.md`)} },`,
    '    })',
    '',
    '    .step("lead-plan-gate", {',
    '      type: "deterministic",',
    '      dependsOn: ["lead-plan"],',
    `      command: ${literal(`set -e\nif command -v rg >/dev/null 2>&1; then rg "RICKY_MASTER_LEAD_PLAN_READY" ${shellQuote(`${input.artifactsDir}/lead-plan.md`)}; else grep -F "RICKY_MASTER_LEAD_PLAN_READY" ${shellQuote(`${input.artifactsDir}/lead-plan.md`)}; fi\necho RICKY_MASTER_LEAD_PLAN_VERIFIED`)},`,
    '      captureOutput: true,',
    '      failOnError: true,',
    '    })',
    '',
    '    .step("materialize-child-workflows", {',
    '      type: "deterministic",',
    '      dependsOn: ["lead-plan-gate"],',
    `      command: ${literal(materializeCommand)},`,
    '      captureOutput: true,',
    '      failOnError: true,',
    '    })',
    '',
    '    .step("verify-child-workflows", {',
    '      type: "deterministic",',
    '      dependsOn: ["materialize-child-workflows"],',
    `      command: ${literal(verifyChildrenCommand)},`,
    '      captureOutput: true,',
    '      failOnError: true,',
    '    })',
    '',
    ...input.plan.children.flatMap((child) => renderChildRunStep(child)),
    '    .step("review-child-evidence", {',
    '      agent: "master-reviewer",',
    `      dependsOn: ${literal(input.plan.children.map((child) => `run-${child.id}`))},`,
    `      task: ${templateLiteral([
      'Review child workflow signoffs and deterministic gates for the master executor run.',
      `Read ${input.artifactsDir}/master-plan.json and each child signoff path.`,
      `Write ${input.artifactsDir}/review-codex.md ending with RICKY_MASTER_REVIEW_READY.`,
    ].join('\n'))},`,
    `      verification: { type: "file_exists", value: ${literal(`${input.artifactsDir}/review-codex.md`)} },`,
    '    })',
    '',
    '    .step("final-hard-validation", {',
    '      type: "deterministic",',
    '      dependsOn: ["review-child-evidence"],',
    `      command: ${literal([
      'set -e',
      'npx tsc --noEmit',
      'npm test',
      'git diff --name-only',
      `grep -F RICKY_MASTER_REVIEW_READY ${shellQuote(`${input.artifactsDir}/review-codex.md`)}`,
      'echo RICKY_MASTER_FINAL_VALIDATION_READY',
    ].join('\n'))},`,
    '      captureOutput: true,',
    '      failOnError: true,',
    '    })',
    '',
    '    .step("final-signoff", {',
    '      type: "deterministic",',
    '      dependsOn: ["final-hard-validation"],',
    `      command: ${literal(finalSignoffCommand)},`,
    '      captureOutput: true,',
    '      failOnError: true,',
    '    })',
    '    .run({ cwd: process.cwd() });',
    '',
    '  console.log(result.status);',
    '}',
    '',
    'main().catch((error) => {',
    '  console.error(error);',
    '  process.exit(1);',
    '});',
    '',
  ].join('\n')}`;
}

function renderChildRunStep(child: ChildWorkflowPlan): string[] {
  const dependsOn = child.dependsOn.length > 0
    ? child.dependsOn.map((dependencyId) => `run-${dependencyId}`)
    : ['verify-child-workflows'];
  const command = [
    'set -e',
    `ricky run ${shellQuote(child.workflowFilePath)} --foreground`,
    `test -f ${shellQuote(child.signoffArtifactPath)}`,
    `grep -F ${shellQuote(child.signoffMarker)} ${shellQuote(child.signoffArtifactPath)}`,
    'echo RICKY_MASTER_CHILD_RUN_VERIFIED',
  ].join('\n');

  return [
    `    .step(${literal(`run-${child.id}`)}, {`,
    '      type: "deterministic",',
    `      dependsOn: ${literal(dependsOn)},`,
    `      command: ${literal(command)},`,
    '      captureOutput: true,',
    '      failOnError: true,',
    '    })',
    '',
  ];
}

function childWorkflowSource(child: ChildWorkflowPlan, spec: NormalizedWorkflowSpec): string {
  const artifactsDir = child.signoffArtifactPath.replace(/\/signoff\.md$/, '');
  const validationCommand = child.validationCommands[0] ?? 'npm run typecheck';
  const targetScope = child.targetFiles.length > 0 ? child.targetFiles.join(' ') : 'NO_TARGET_FILES_DECLARED';
  const marker = child.signoffMarker;

  return `${[
    "import { workflow } from '@agent-relay/sdk/workflows';",
    '',
    '// IMPLEMENTATION_WORKFLOW_CONTRACT: child workflow must produce source changes, tests, non-empty diff evidence, and PR/result reporting when implementation scope applies.',
    '',
    'async function main() {',
    `  const result = await workflow(${literal(`ricky-child-${child.id}`)})`,
    `    .description(${literal(child.summary ?? child.title)})`,
    '    .pattern("dag")',
    `    .channel(${literal(`wf-ricky-child-${child.id}`)})`,
    '    .maxConcurrency(2)',
    '    .timeout(3600000)',
    `    .onError(${repairAwareOnError('validator-claude')})`,
    '    .agent("lead-claude", { cli: "claude", interactive: false, role: "Plans this bounded child workflow slice.", retries: 1 })',
    '    .agent("impl-codex", { cli: "codex", role: "Implements only this child workflow slice and its declared file scope.", retries: 2 })',
    '    .agent("reviewer-codex", { cli: "codex", preset: "reviewer", role: "Reviews code, tests, deterministic gates, and PR/result evidence.", retries: 1 })',
    '    .agent("validator-claude", { cli: "claude", preset: "worker", role: "Runs the 80-to-100 fix loop and writes final signoff.", retries: 2 })',
    '    .step("prepare-context", {',
    '      type: "deterministic",',
    `      command: ${literal([
      'set -e',
      `mkdir -p ${shellQuote(artifactsDir)}`,
      `printf '%s\\n' ${shellQuote(spec.description)} > ${shellQuote(`${artifactsDir}/normalized-spec.txt`)}`,
      `printf '%s\\n' ${shellQuote(targetScope)} > ${shellQuote(`${artifactsDir}/target-files.txt`)}`,
      'echo RICKY_CHILD_CONTEXT_READY',
    ].join('\n'))},`,
    '      captureOutput: true,',
    '      failOnError: true,',
    '    })',
    '    .step("lead-plan", {',
    '      agent: "lead-claude",',
    '      dependsOn: ["prepare-context"],',
    `      task: ${templateLiteral([
      `Plan this child slice: ${child.title}.`,
      `Target files: ${targetScope}.`,
      'State non-goals, ownership, validation, source changes, code changes, tests, git diff evidence, and PR URL or explicit result status.',
      `Write ${artifactsDir}/lead-plan.md ending with RICKY_CHILD_LEAD_PLAN_READY.`,
    ].join('\n'))},`,
    `      verification: { type: "file_exists", value: ${literal(`${artifactsDir}/lead-plan.md`)} },`,
    '    })',
    '    .step("implement-slice", {',
    '      agent: "impl-codex",',
    '      dependsOn: ["lead-plan"],',
    `      task: ${templateLiteral([
      `Implement the bounded child slice: ${child.title}.`,
      `Edit only declared targets when possible: ${targetScope}.`,
      'Produce deterministic evidence, tests, and a concise result or PR URL when applicable.',
    ].join('\n'))},`,
    '      verification: { type: "exit_code", value: "0" },',
    '    })',
    '    .step("initial-soft-validation", {',
    '      type: "deterministic",',
    '      dependsOn: ["implement-slice"],',
    `      command: ${literal(`${validationCommand} 2>&1 | tail -160`)},`,
    '      captureOutput: true,',
    '      failOnError: false,',
    '    })',
    '    .step("review-codex", {',
    '      agent: "reviewer-codex",',
    '      dependsOn: ["initial-soft-validation"],',
    `      task: ${templateLiteral([
      'Review this child slice against the lead plan and validation output.',
      `Write ${artifactsDir}/review-codex.md with PASS or FAIL and end with RICKY_CHILD_REVIEW_READY.`,
    ].join('\n'))},`,
    `      verification: { type: "file_exists", value: ${literal(`${artifactsDir}/review-codex.md`)} },`,
    '    })',
    '    .step("fix-loop", {',
    '      agent: "validator-claude",',
    '      dependsOn: ["review-codex"],',
    `      task: ${templateLiteral([
      'Run the 80-to-100 fix loop for this child slice.',
      'Fix only failures from validation or review within the declared scope.',
      `Write ${artifactsDir}/fix-loop-report.md ending with RICKY_CHILD_FIX_LOOP_READY.`,
    ].join('\n'))},`,
    `      verification: { type: "file_exists", value: ${literal(`${artifactsDir}/fix-loop-report.md`)} },`,
    '    })',
    '    .step("final-hard-validation", {',
    '      type: "deterministic",',
    '      dependsOn: ["fix-loop"],',
    `      command: ${literal([
      'set -e',
      validationCommand,
      'git diff --name-only',
      `grep -F RICKY_CHILD_REVIEW_READY ${shellQuote(`${artifactsDir}/review-codex.md`)}`,
      'echo RICKY_CHILD_FINAL_VALIDATION_READY',
    ].join('\n'))},`,
    '      captureOutput: true,',
    '      failOnError: false,',
    '    })',
    '    .step("final-signoff", {',
    '      type: "deterministic",',
    '      dependsOn: ["final-hard-validation"],',
    `      command: ${literal([
      'set -e',
      `mkdir -p ${shellQuote(artifactsDir)}`,
      `cat > ${shellQuote(child.signoffArtifactPath)} <<'EOF'`,
      `# Child workflow signoff: ${child.title}`,
      '',
      'RICKY_CHILD_WORKFLOW_COMPLETE',
      marker,
      'EOF',
      'echo RICKY_CHILD_WORKFLOW_COMPLETE',
    ].join('\n'))},`,
    '      captureOutput: true,',
    '      failOnError: true,',
    '    })',
    '    .run({ cwd: process.cwd() });',
    '',
    '  console.log(result.status);',
    '}',
    '',
    'main().catch((error) => {',
    '  console.error(error);',
    '  process.exit(1);',
    '});',
    '',
  ].join('\n')}`;
}

function repairAwareOnError(repairAgent: string): string {
  return `'retry', { maxRetries: ${DEFAULT_RETRY_MAX_ATTEMPTS}, retryDelayMs: ${DEFAULT_RETRY_BACKOFF_MS}, repairAgent: ${literal(repairAgent)}, repairRetries: ${DEFAULT_REPAIR_RETRY_ATTEMPTS} }`;
}

function buildMasterTasks(plan: MasterExecutionPlan): WorkflowTask[] {
  return [
    task('prepare-context', 'Prepare master context', 'deterministic', 'Write master plan and generation-time skill evidence.', []),
    task('lead-plan', 'Plan child execution', 'master-lead', 'Review child ownership, dependencies, and validation gates.', ['prepare-context']),
    task('materialize-child-workflows', 'Materialize child workflows', 'deterministic', 'Write focused child workflow artifacts.', ['lead-plan-gate']),
    ...plan.children.map((child) =>
      task(`run-${child.id}`, `Run ${child.title}`, 'deterministic', `Run child workflow ${child.workflowFilePath} through ricky run.`, child.dependsOn.map((id) => `run-${id}`)),
    ),
    task('review-child-evidence', 'Review child evidence', 'master-reviewer', 'Review child signoffs and master readiness.', plan.children.map((child) => `run-${child.id}`)),
    task('final-signoff', 'Final signoff', 'deterministic', 'Write master signoff after hard validation.', ['final-hard-validation']),
  ];
}

function buildMasterGates(artifactsDir: string, plan: MasterExecutionPlan): DeterministicGate[] {
  return [
    gate('skill-boundary-metadata-gate', `test -f ${artifactsDir}/skill-application-boundary.json`, 'file_exists', true, ['prepare-context'], 'pre_review'),
    gate('lead-plan-gate', `grep -F RICKY_MASTER_LEAD_PLAN_READY ${artifactsDir}/lead-plan.md`, 'output_contains', true, ['lead-plan'], 'pre_review'),
    gate('child-workflow-file-gate', plan.children.map((child) => `test -f ${child.workflowFilePath}`).join(' && '), 'file_exists', true, ['materialize-child-workflows'], 'pre_review'),
    gate('initial-soft-validation', 'npx tsc --noEmit 2>&1 | tail -160', 'output_contains', false, ['child-workflow-file-gate'], 'pre_review'),
    gate('final-review-pass-gate', `grep -F RICKY_MASTER_REVIEW_READY ${artifactsDir}/review-codex.md`, 'output_contains', true, ['review-child-evidence'], 'final'),
    gate('final-hard-validation', 'npx tsc --noEmit && npm test', 'exit_code', true, ['final-review-pass-gate'], 'final'),
    gate('git-diff-gate', 'git diff --name-only', 'output_contains', true, ['final-hard-validation'], 'final'),
    gate('regression-gate', 'npm test', 'exit_code', true, ['git-diff-gate'], 'regression'),
  ];
}

function buildMasterSkillEvidence(skills: SkillContext): SkillApplicationEvidence[] {
  const names = skills.applicableSkillNames.length > 0
    ? skills.applicableSkillNames
    : ['choosing-swarm-patterns', 'writing-agent-relay-workflows', 'relay-80-100-workflow'];
  return names.map((skillName) => ({
    skillName,
    stage: 'generation_rendering' as const,
    effect: skillName === 'relay-80-100-workflow' ? 'validation_gates' as const : 'workflow_contract' as const,
    behavior: 'generation_time_only' as const,
    runtimeEmbodiment: false as const,
    evidence: `Rendered master executor workflow using ${skillName} generation guidance.`,
  }));
}

function buildMasterToolSelections(plan: MasterExecutionPlan): ToolSelection[] {
  return [
    { stepId: 'lead-plan', agent: 'master-lead', runner: 'claude', concurrency: 1, rule: 'master executor lead planning' },
    ...plan.children.map((child) => ({
      stepId: `run-${child.id}`,
      agent: 'deterministic',
      runner: '@agent-relay/sdk' as const,
      concurrency: child.parallelizable ? 2 : 1,
      rule: 'master executor runs child workflow through ricky run',
    })),
    { stepId: 'review-child-evidence', agent: 'master-reviewer', runner: 'codex', concurrency: 1, rule: 'master executor evidence review' },
  ];
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

function workflowText(spec: NormalizedWorkflowSpec): string {
  return [
    spec.description,
    spec.targetContext,
    spec.desiredAction.summary,
    ...spec.constraints.map((constraint) => constraint.constraint),
    ...spec.evidenceRequirements.map((requirement) => requirement.requirement),
    ...spec.acceptanceGates.map((gate) => gate.gate),
  ].filter(Boolean).join('\n');
}

function sliceSourceText(spec: NormalizedWorkflowSpec): string {
  return [
    spec.description,
    spec.targetContext,
    spec.desiredAction.summary,
    ...spec.constraints.map((constraint) => constraint.constraint),
  ].filter(Boolean).join('\n');
}

function extractSliceTitles(text: string): string[] {
  const cleaned = text
    .replace(/\b(?:implement|wire|add|build|ship|create|support|for|the|a|an)\b/gi, ' ')
    .replace(/\b(?:as|with|using|via|through|by|run|runs|running|master executor|master orchestration|smaller workflows|child workflows|workflows?)\b/gi, ' ')
    .replace(/[.;:]/g, ',');
  const seen = new Set<string>();
  const titles: string[] = [];
  for (const rawPart of cleaned.split(/,|\band\b/gi)) {
    const title = titleCase(rawPart.replace(/\s+/g, ' ').trim());
    if (!title || title.length < 4 || title.length > 48) continue;
    if (/^(deterministic|reliable|parallel|independent|several|multiple)$/i.test(title)) continue;
    const key = slugify(title);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    titles.push(title);
    if (titles.length >= 8) break;
  }
  return titles;
}

function titleForTargetFile(targetFile: string): string {
  const basename = targetFile.split('/').at(-1)?.replace(/\.[^.]+$/, '') ?? targetFile;
  return `Update ${titleCase(basename.replace(/[-_.]+/g, ' '))}`;
}

function waveCount(plan: MasterExecutionPlan): number {
  return new Set(plan.children.map((child) => child.wave)).size;
}

function workflowNameFromArtifactPath(path: string | undefined): string | undefined {
  if (!path) return undefined;
  const fileName = path.split('/').at(-1) ?? path;
  return fileName.replace(/\.[^.]+$/, '').trim() || undefined;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'master-workflow';
}

function titleCase(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1).toLowerCase()}`)
    .join(' ');
}

function literal(value: string | string[]): string {
  return JSON.stringify(value);
}

function templateLiteral(value: string): string {
  return `\`${value.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${')}\``;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
