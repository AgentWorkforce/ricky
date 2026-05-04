import { readFileSync } from 'node:fs';
import { basename, extname } from 'node:path';
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
  const slug = slugify(
    workflowNameFromArtifactPath(input.artifactPath) ||
    input.spec.description ||
    input.spec.desiredAction.summary ||
    'generated-workflow',
  );
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

function workflowNameFromArtifactPath(path: string | undefined): string | undefined {
  if (!path) return undefined;
  const fileName = basename(path);
  const name = basename(fileName, extname(fileName));
  return name.trim() || undefined;
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
    '// IMPLEMENTATION_WORKFLOW_CONTRACT: implementation specs must produce source changes, tests, non-empty diff evidence, and PR/result reporting.',
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
    renderSecondaryReviewStep('review-codex', ['initial-soft-validation'], input.spec, input.artifactsDir, selectionFor(input.toolSelection, 'review-codex'), input.isCodeWorkflow),
    '',
    renderReadReviewStep(input.artifactsDir),
    '',
    renderFixLoopStep(input.spec, input.isCodeWorkflow, input.artifactsDir, selectionFor(input.toolSelection, 'fix-loop')),
    '',
    renderGateStep(input.gates.find((gate) => gate.name === 'post-fix-verification-gate')!),
    '',
    renderGateStep(input.gates.find((gate) => gate.name === 'active-reference-gate')!),
    '',
    renderGateStep(input.gates.find((gate) => gate.name === 'post-fix-validation')!),
    '',
    renderReviewStep('final-review-claude', 'reviewer-claude', ['post-fix-validation'], input.spec, input.artifactsDir, selectionFor(input.toolSelection, 'final-review-claude'), true),
    '',
    renderSecondaryReviewStep('final-review-codex', ['post-fix-validation'], input.spec, input.artifactsDir, selectionFor(input.toolSelection, 'final-review-codex'), input.isCodeWorkflow, true),
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
      { name: 'lead-claude', cli: 'codex', interactive: false, role: 'Plans the generated workflow deliverables, boundaries, and verification gates.', retries: 1 },
      { name: 'author-codex', cli: 'codex', role: 'Writes the requested bounded artifact and keeps scope to declared files.', retries: 2 },
      { name: 'reviewer-claude', cli: 'codex', preset: 'reviewer', role: 'Reviews artifact quality, scope, and evidence.', retries: 1 },
      { name: 'reviewer-codex', cli: 'codex', preset: 'reviewer', role: 'Reviews implementation practicality and deterministic checks.', retries: 1 },
      { name: 'validator-claude', cli: 'codex', preset: 'worker', role: 'Applies bounded fixes and confirms final signoff evidence.', retries: 2 },
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
    ? buildManifestFileGateCommand(outputManifest)
    : `grep -Eq ${shellQuote(grepPattern)} ${targetFiles.map(shellQuote).join(' ')}`;
  const gitDiffPath = `${artifactsDir}/git-diff.txt`;
  const gitDiffCommand = usingManifest
    ? buildManifestGitDiffCommand(outputManifest, gitDiffPath)
    : `{ git diff --name-only -- ${targetFiles.map(shellQuote).join(' ')}; git ls-files --others --exclude-standard -- ${targetFiles.map(shellQuote).join(' ')}; } > ${shellQuote(gitDiffPath)} && sort -u ${shellQuote(gitDiffPath)} -o ${shellQuote(gitDiffPath)} && test -s ${shellQuote(gitDiffPath)}`;
  const activeReferenceCommand = usingManifest
    ? buildActiveReferenceGateCommand(outputManifest, `${artifactsDir}/active-reference-check.txt`)
    : `printf '%s\\n' 'No manifest-driven deleted paths to check.' > ${shellQuote(`${artifactsDir}/active-reference-check.txt`)}`;
  const testCommand = deriveTestCommand(spec);
  const typecheckCommand = 'npx tsc --noEmit';
  const acceptanceCommands = spec.acceptanceGates.map((gate) => mapAcceptanceGateToCommand(gate.gate));
  const executableAcceptanceCommands = acceptanceCommands.filter((cmd) => !cmd.startsWith("printf '%s\\n'"));
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
    gate('active-reference-gate', activeReferenceCommand, 'deterministic_gate', true, ['post-fix-verification-gate'], 'post_fix'),
    gate('post-fix-validation', [typecheckCommand, testCommand, ...executableAcceptanceCommands].join(' && '), 'exit_code', false, ['active-reference-gate'], 'post_fix'),
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
    gate('final-hard-validation', [typecheckCommand, testCommand, ...executableAcceptanceCommands].join(' && '), 'deterministic_gate', true, ['final-review-pass-gate'], 'final'),
    gate('git-diff-gate', gitDiffCommand, 'artifact_exists', true, ['final-hard-validation'], 'final'),
    gate('regression-gate', isCodeWorkflow ? 'npx vitest run' : 'git diff --check', 'exit_code', true, ['git-diff-gate'], 'regression'),
  ];
}

function buildManifestFileGateCommand(outputManifest: string): string {
  return [
    'node <<\'NODE\'',
    "const fs = require('node:fs');",
    `const manifest = ${literal(outputManifest)};`,
    'const lines = fs.readFileSync(manifest, \'utf8\').split(/\\r?\\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith(\'#\'));',
    'if (lines.length === 0) throw new Error(\'output manifest is empty\');',
    'const parse = (line) => {',
    '  const match = /^(A|M|D)\\s+(.+)$/.exec(line);',
    '  return match ? { status: match[1], path: match[2] } : { status: null, path: line };',
    '};',
    'for (const entry of lines.map(parse)) {',
    '  if (entry.status === \'D\') {',
    '    if (fs.existsSync(entry.path)) throw new Error(`deleted manifest path still exists: ${entry.path}`);',
    '    continue;',
    '  }',
    '  if (!fs.existsSync(entry.path)) throw new Error(`manifest path does not exist: ${entry.path}`);',
    '}',
    'console.log(\'MANIFEST_FILE_GATE_OK\');',
    'NODE',
  ].join('\n');
}

function buildManifestGitDiffCommand(outputManifest: string, gitDiffPath: string): string {
  return [
    'node <<\'NODE\'',
    "const fs = require('node:fs');",
    "const { execFileSync } = require('node:child_process');",
    `const manifest = ${literal(outputManifest)};`,
    `const gitDiffPath = ${literal(gitDiffPath)};`,
    'const rawLines = fs.readFileSync(manifest, \'utf8\').split(/\\r?\\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith(\'#\'));',
    'if (rawLines.length === 0) throw new Error(\'output manifest is empty\');',
    'const parse = (line) => {',
    '  const match = /^(A|M|D)\\s+(.+)$/.exec(line);',
    '  return match ? { status: match[1], path: match[2], exact: `${match[1]}\\t${match[2]}` } : { status: null, path: line, exact: null };',
    '};',
    'const expected = rawLines.map(parse);',
    'const tracked = execFileSync(\'git\', [\'-c\', \'core.quotePath=false\', \'diff\', \'--name-status\'], { encoding: \'utf8\' })',
    '  .split(/\\r?\\n/)',
    '  .map((line) => line.trim())',
    '  .filter(Boolean);',
    'const untracked = execFileSync(\'git\', [\'ls-files\', \'--others\', \'--exclude-standard\'], { encoding: \'utf8\' })',
    '  .split(/\\r?\\n/)',
    '  .map((line) => line.trim())',
    '  .filter(Boolean)',
    '  .map((path) => `A\\t${path}`);',
    'const actual = [...tracked, ...untracked].sort();',
    'fs.writeFileSync(gitDiffPath, `${actual.join(\'\\n\')}\\n`);',
    'if (actual.length === 0) throw new Error(\'git diff evidence is empty\');',
    'const actualPaths = new Set(actual.map((line) => line.replace(/^[A-Z]+\\s+/, \'\')));',
    'const expectedPaths = new Set(expected.map((entry) => entry.path));',
    'for (const entry of expected) {',
    '  if (entry.exact && !actual.includes(entry.exact)) throw new Error(`missing expected diff entry: ${entry.exact}`);',
    '  if (!entry.exact && !actualPaths.has(entry.path)) throw new Error(`missing expected diff path: ${entry.path}`);',
    '}',
    'const extra = [...actualPaths].filter((path) => !expectedPaths.has(path) && !path.startsWith(\'.workflow-artifacts/\'));',
    'if (extra.length > 0) throw new Error(`unexpected changed paths: ${extra.join(\', \')}`);',
    'console.log(\'GIT_DIFF_GATE_OK\');',
    'NODE',
  ].join('\n');
}

function buildActiveReferenceGateCommand(outputManifest: string, evidencePath: string): string {
  return [
    'node <<\'NODE\'',
    "const fs = require('node:fs');",
    "const { execFileSync } = require('node:child_process');",
    `const manifest = ${literal(outputManifest)};`,
    `const evidencePath = ${literal(evidencePath)};`,
    'const lines = fs.readFileSync(manifest, \'utf8\').split(/\\r?\\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith(\'#\'));',
    'const deleted = lines.map((line) => /^(A|M|D)\\s+(.+)$/.exec(line)).filter((match) => match && match[1] === \'D\').map((match) => match[2]);',
    'if (deleted.length === 0) {',
    '  fs.writeFileSync(evidencePath, \'No deleted paths declared; active reference gate skipped.\\n\');',
    '  console.log(\'ACTIVE_REFERENCE_GATE_SKIPPED\');',
    '  process.exit(0);',
    '}',
    'const files = execFileSync(\'git\', [\'ls-files\'], { encoding: \'utf8\' })',
    '  .split(/\\r?\\n/)',
    '  .filter(Boolean)',
    '  .filter((path) => !path.startsWith(\'.workflow-artifacts/\') && !path.startsWith(\'.trajectories/\'));',
    'const hits = [];',
    'for (const removedPath of deleted) {',
    '  for (const file of files) {',
    '    if (file === removedPath) continue;',
    '    const body = fs.readFileSync(file, \'utf8\');',
    '    if (body.includes(removedPath)) hits.push(`${removedPath} referenced by ${file}`);',
    '  }',
    '}',
    'fs.writeFileSync(evidencePath, hits.length === 0 ? `No active references found for:\\n${deleted.join(\'\\n\')}\\n` : `${hits.join(\'\\n\')}\\n`);',
    'if (hits.length > 0) throw new Error(`active references remain: ${hits.join(\'; \')}`);',
    'console.log(\'ACTIVE_REFERENCE_GATE_OK\');',
    'NODE',
  ].join('\n');
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

  if (skills.applicableSkillNames.includes('choosing-swarm-patterns')) {
    commands.push(
      `grep -F ${shellQuote('"stage":"generation_rendering"')} ${quotedPath}`,
      `grep -F ${shellQuote('"effect":"pattern_selection"')} ${quotedPath}`,
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
  const options = [`cli: ${literal(member.cli)}`];
  if (member.preset) options.push(`preset: ${literal(member.preset)}`);
  if (member.interactive === false) options.push('interactive: false');
  options.push(`role: ${literal(member.role)}`, `retries: ${member.retries}`);
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
  const nonGoals = defaultNonGoals(spec);
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

Implementation contract:
- If this is an implementation spec, agents must make source changes in the target repository rather than stopping at planning artifacts.
- Final success requires code/source changes, tests, non-empty diff evidence, and PR/result reporting unless the spec explicitly says planning-only.

Deliverables:
${formatList(spec.targetFiles.length > 0 ? spec.targetFiles : ['A generated workflow artifact and any requested output files'])}

Non-goals:
${formatList(nonGoals)}

Routing contract:
- Local: run through Agent Relay using the generated workflow artifact and persist artifacts under ${artifactsDir}.
- Cloud: no separate cloud execution path is implied unless the normalized spec explicitly requests cloud; cloud callers receive the same generated artifact contract.
- MCP: generated runtime agents must not use Relaycast management or messaging tools; MCP callers receive artifacts without a separate runtime management path.

Verification commands:
${formatList(['file_exists gate for declared targets', 'deterministic sanity gate using grep, rg, or an equivalent assertion', 'active-reference gate for deleted manifest paths', 'npx tsc --noEmit', deriveTestCommand(spec), 'git diff gate comparing git diff --name-status against the declared change inventory and requiring a non-empty diff', 'PR URL or explicit result summary'])}

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
  const noTargetInstructions = `No explicit file targets were supplied. Write every changed path to ${artifactsDir}/output-manifest.txt using status-prefixed entries such as "A path", "M path", or "D path". Include deleted files and supporting edits. Keep changes bounded.`;
  return `    .step('implement-artifact', {
      agent: ${literal(agent)},
      dependsOn: ['lead-plan'],
${selectionLines}
      task: ${templateLiteral(`${isCodeWorkflow ? 'Implement the requested code-writing workflow slice.' : 'Author the requested workflow artifact.'}

IMPLEMENTATION_WORKFLOW_CONTRACT:
- For implementation specs, edit source files and produce code changes, not just plan.md, mapping.json, or analysis artifacts.
- Keep a non-empty implementation diff outside transient artifact directories.
- Add or update tests that prove the changed behavior.

Scope:
${spec.description}

Own only declared targets unless review feedback explicitly narrows a required fix:
${formatList(spec.targetFiles.length > 0 ? spec.targetFiles : [noTargetInstructions])}

Acceptance gates:
${formatList(spec.acceptanceGates.map((gate) => gate.gate))}
${renderToolSelectionSummary(selection)}

Before editing, read ${artifactsDir}/matched-skills.md when it exists and use it only as generation-time context for this task.

Keep execution routing explicit for local, cloud, and MCP callers. Materialize outputs to disk, then stop for deterministic gates.

Generated workflow quality:
- Include a real deterministic sanity gate over produced files, not just prose saying one exists.
- Prefer grep, rg, git grep, or a small inline assertion command that exits non-zero when expected content/state is missing.
- For cleanup or deletion work, persist a changed-files inventory with statuses, active-reference evidence for deleted paths, and command summaries for final signoff.
- Keep each agent step bounded to one coherent slice. Split broad implementation or test-writing work into sequential/fan-out steps with deterministic gates between them instead of relying on a single long agent timeout.`)},
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

function renderSecondaryReviewStep(
  stepName: string,
  dependsOn: string[],
  spec: NormalizedWorkflowSpec,
  artifactsDir: string,
  selection: ToolSelection | undefined,
  isCodeWorkflow: boolean,
  final = false,
): string {
  if (isCodeWorkflow) {
    return renderReviewStep(stepName, 'reviewer-codex', dependsOn, spec, artifactsDir, selection, final);
  }

  const marker = final ? 'FINAL_REVIEW_CODEX_PASS' : 'REVIEW_COMPLETE';
  const reviewPath = `${artifactsDir}/${stepName}.md`;
  const label = final ? 'Final Codex structural review' : 'Codex structural review';
  const stage = final ? 'post-fix-validation' : 'initial-soft-validation';
  const lines = [
    "node - <<'NODE'",
    "const fs = require('node:fs');",
    `const out = ${literal(reviewPath)};`,
    'const body = [',
    `  ${literal(`# ${label}`)},`,
    "  '',",
    `  ${literal(`- Spec: ${spec.description}`)},`,
    "  '- This deterministic review gate replaces the hanging non-interactive Codex reviewer path for non-code workflow slices.',",
    "  '- It verifies the workflow left review evidence on disk without spawning another reviewer subprocess.',",
    `  ${literal(`- Review artifact: ${reviewPath}`)},`,
    "  '- Deterministic validation gates completed before this review step.',",
    "  '',",
    `  ${literal(marker)},`,
    '].join("\\n");',
    "fs.writeFileSync(out, `${body}\n`);",
    `console.log(${literal(final ? 'FINAL_REVIEW_CODEX_GATE_PASS' : 'REVIEW_CODEX_GATE_PASS')});`,
    'NODE',
  ];

  return renderDeterministicStep(stepName, dependsOn, lines.join('\n'), true);
}

function renderReadReviewStep(artifactsDir: string): string {
  return renderDeterministicStep(
    'read-review-feedback',
    ['review-claude', 'review-codex'],
    [
      `test -f ${shellQuote(`${artifactsDir}/review-claude.md`)}`,
      `test -f ${shellQuote(`${artifactsDir}/review-codex.md`)}`,
      `grep -F ${shellQuote('REVIEW_COMPLETE')} ${shellQuote(`${artifactsDir}/review-claude.md`)}`,
      `grep -F ${shellQuote('REVIEW_COMPLETE')} ${shellQuote(`${artifactsDir}/review-codex.md`)}`,
      `cat ${shellQuote(`${artifactsDir}/review-claude.md`)} ${shellQuote(`${artifactsDir}/review-codex.md`)} | tee ${shellQuote(`${artifactsDir}/review-feedback.md`)}`,
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
      dependsOn: ['read-review-feedback', 'initial-soft-validation'],
${selectionLines}
      task: ${templateLiteral(`Run the 80-to-100 fix loop.

Inputs:
- ${artifactsDir}/review-feedback.md

Review feedback:
{{steps.read-review-feedback.output}}

Initial validation output:
{{steps.initial-soft-validation.output}}

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
- source changes and implementation diff evidence
- dry-run command to execute before runtime launch
- deterministic validation commands
- review verdicts
- PR URL or a clear result location/status when PR creation is intentionally out of scope
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

  if (loaded.has('choosing-swarm-patterns')) {
    evidence.push({
      skillName: 'choosing-swarm-patterns',
      stage: 'generation_rendering',
      effect: 'pattern_selection',
      behavior: 'generation_time_only',
      runtimeEmbodiment: false,
      evidence: 'Rendered the selected swarm pattern into the workflow builder so Ricky chooses the coordination shape before authoring tasks.',
    });
  }

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

function defaultNonGoals(spec: NormalizedWorkflowSpec): string[] {
  const declared = spec.constraints
    .filter((constraint) => constraint.category === 'scope')
    .map((constraint) => constraint.constraint);
  if (declared.length > 0) return declared;

  const text = [spec.description, spec.targetContext].filter(Boolean).join('\n').toLowerCase();
  if (/\b(clean ?up|remove|delete|unused|outdated|obsolete|stale)\b/.test(text)) {
    return [
      'No deletion without concrete reference and usage evidence.',
      'No source, test, config, docs, or workflow removal solely due to unfamiliarity.',
      'No dependency cleanup or package metadata changes unless separately proven and requested.',
      'No deletion of generated or historical artifacts unless explicitly proven unused.',
      'No commits, pushes, or destructive shell operations during validation.',
    ];
  }

  return [];
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
