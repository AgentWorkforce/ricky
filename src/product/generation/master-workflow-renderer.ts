import type { NormalizedWorkflowSpec } from '../spec-intake/types.js';
import type { Nodes } from 'mdast';
import { fromMarkdown } from 'mdast-util-from-markdown';
import {
  DEFAULT_REPAIR_RETRY_ATTEMPTS,
  DEFAULT_RETRY_BACKOFF_MS,
  DEFAULT_RETRY_MAX_ATTEMPTS,
} from '../../shared/constants.js';
import { planMasterExecution, type ChildWorkflowPlan, type MasterExecutionPlan } from '../orchestration/index.js';
import {
  deriveTestCommand,
  executableAcceptanceCommandsForSpec,
  usesOnlyListedValidationCommands,
} from './template-renderer.js';
import { buildFinalReviewPassGateCommand } from './final-review-gate.js';
import { markdownLabelFields } from './workforce-persona-writer.js';
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

// Workspace-aware typecheck: prefer the project's own `npm run typecheck`
// script when one exists (the right thing for monorepos like
// `npm run typecheck -ws` or custom build pipelines), and fall back to
// `npx tsc --noEmit` when the project is a flat single-tsconfig repo.
//
// Without this guard, `npx tsc --noEmit` invoked from a monorepo root with
// no top-level tsconfig.json (npm workspaces, packages/*/tsconfig.json
// layout — common in MSD-style repos) finds neither input files nor a
// config and dumps the full `tsc --help` text on stdout while exiting 1.
// The auto-fix loop then "repairs" the workflow 7×, all failing identically
// because the workflow command is correct in general — just wrong for this
// repo shape.
//
// `npm pkg get scripts.typecheck` returns `"<command>"` when the script
// exists and `{}` when it does not (npm v7.20.0+, shipped with Node 16+).
// We compare against the literal `{}` so the snippet is portable across
// any package layout. The substring `npx tsc --noEmit` is preserved so
// downstream tools and human readers still recognize the intent.
const TYPECHECK_COMMAND =
  'if [ "$(npm pkg get scripts.typecheck 2>/dev/null)" != "{}" ]; then npm run typecheck; else npx tsc --noEmit; fi';

const MASTER_EXPLICIT_PATTERN =
  /\b(master executor|master orchestration|smaller workflows|child workflows|several workflows|multiple workflows|break(?:ing)? (?:it )?(?:out|up)|divvy|decompos(?:e|ition)|workflow waves?)\b/i;

const IMPLEMENTATION_PATTERN =
  /\b(implement|wire|add|build|ship|migrate|refactor|replace|runtime|policy|telemetry|evals?|insights?|runner|api|cli|tests?)\b/i;

// File-count fallback for the master-executor router. Bumped from 4 to 12
// after a multi-week regression: most real implementation specs (esp.
// per-PR sub-specs split out of a larger plan) touch 5–8 files and were
// being unconditionally routed through the canned master template even
// when the spec text never asked to be decomposed. That bypassed the LLM
// writer, emitted a template whose `lead-plan` step depends on a headless
// claude subprocess writing a marker file, and consistently blocked at
// `INVALID_ARTIFACT at lead-plan` when that subprocess failed to spawn —
// leaving zero impl on disk and nothing to salvage. 12 matches the
// `maxChildren` cap of `planMasterExecution` below: specs beyond that
// genuinely need decomposition anyway, and the LLM writer can't
// realistically author a coherent single workflow at that scope. Specs
// that genuinely want master-executor still opt in via MASTER_EXPLICIT_PATTERN.
const MASTER_FILE_COUNT_THRESHOLD = 12;

export function shouldUseMasterExecutionWorkflow(spec: NormalizedWorkflowSpec): boolean {
  const text = workflowText(spec);
  if (!IMPLEMENTATION_PATTERN.test(text)) return false;
  if (hasSingleWorkflowVeto(text)) return false;
  if (MASTER_EXPLICIT_PATTERN.test(text)) return true;
  if (hasSinglePrWorktreeContract(text)) return false;
  if (spec.targetFiles.length >= MASTER_FILE_COUNT_THRESHOLD) return true;
  return false;
}

function hasSingleWorkflowVeto(text: string): boolean {
  const parsedSignals = parseConstraintTextCandidates(text);
  if (parsedSignals.length > 0 && parsedSignals.some(hasSingleWorkflowSignal)) return true;
  return hasSingleWorkflowSignal(text);
}

function parseConstraintTextCandidates(text: string): string[] {
  const jsonSignals = parseJsonTextCandidates(text);
  if (jsonSignals.length > 0) return jsonSignals;

  try {
    const root = fromMarkdown(text);
    return collectMarkdownText(root);
  } catch {
    return [];
  }
}

function parseJsonTextCandidates(text: string): string[] {
  try {
    const parsed = JSON.parse(text) as unknown;
    const values: string[] = [];
    collectJsonStrings(parsed, values);
    return values;
  } catch {
    return [];
  }
}

function collectJsonStrings(value: unknown, values: string[]): void {
  if (typeof value === 'string') {
    values.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectJsonStrings(item, values);
    return;
  }
  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) collectJsonStrings(item, values);
  }
}

function collectMarkdownText(node: Nodes): string[] {
  const ownText = 'value' in node && typeof node.value === 'string' ? [node.value] : [];
  if (!('children' in node)) return ownText;
  const childText = node.children.flatMap((child) => collectMarkdownText(child));
  const combined = childText.join(' ').replace(/\s+/g, ' ').trim();
  return combined ? [...ownText, combined] : ownText;
}

function hasSingleWorkflowSignal(text: string): boolean {
  return [
    /\b(?:single|one)\s+(?:local\s+)?workflow\b/i,
    /\b(?:single|one)\s+(?:local\s+)?implementation\s+workflow\b/i,
    /\bno\s+child\s+workflows?\b/i,
    /\bno\s+(?:nested|multi-child|multi child)\s+workflows?\b/i,
    /\b(?:do\s+not|don't|must\s+not|without)\s+(?:generate|emit|create|use|run)?\s*(?:any\s+)?child\s+workflows?\b/i,
    /\b(?:do\s+not|don't|must\s+not)\s+(?:decompose|materialize\s+child\s+workflows?|invoke\s+`?ricky run`?\s+recursively|require\s+an?\s+Agent Relay broker)\b/i,
    /\b(?:static|deterministic)\s+validation\s+only\b/i,
  ].some((pattern) => pattern.test(text));
}

function hasSinglePrWorktreeContract(text: string): boolean {
  if (!/\b(?:Outcome\s*:\s*)?(?:exactly\s+)?one\s+pull\s+request\b/i.test(text)) return false;
  const fields = markdownLabelFields(text);
  const worktree = fields.get('worktree') ?? fields.get('target worktree');
  const branch = fields.get('target branch') ?? fields.get('branch');
  return Boolean(worktree && branch);
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
  const gates = buildMasterGates(artifactsDir, plan, input.spec);
  const skillApplicationEvidence = buildMasterSkillEvidence(input.skills);
  const toolSelections = buildMasterToolSelections(plan);
  // Sidecars travel with the generated workflow on disk. Embedding the spec
  // and the child-source map inline ballooned the master workflow past
  // ARG_MAX (spawn E2BIG) every time `materialize-child-workflows` ran; the
  // sidecars push that payload off of argv entirely.
  const artifactPathNoExt = artifactPath.replace(/\.ts$/, '');
  const specSidecarPath = `${artifactPathNoExt}.spec.md`;
  const childrenSidecarPath = `${artifactPathNoExt}.children.json`;
  const childSources = Object.fromEntries(
    plan.children.map((child) => [child.workflowFilePath, childWorkflowSource(child, input.spec, specSidecarPath)]),
  );
  const content = renderMasterSource({
    spec: input.spec,
    pattern: input.pattern,
    workflowId,
    channel,
    artifactsDir,
    plan,
    skills: input.skills,
    skillApplicationEvidence,
    childSources,
    specSidecarPath,
    childrenSidecarPath,
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
      sidecarFiles: {
        [specSidecarPath]: input.spec.description,
        [childrenSidecarPath]: `${JSON.stringify(childSources, null, 2)}\n`,
      },
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
  childSources: Record<string, string>;
  specSidecarPath: string;
  childrenSidecarPath: string;
}): string {
  const planJson = JSON.stringify(input.plan, null, 2);
  const skillMatchesJson = JSON.stringify(input.skills.matches, null, 2);
  const skillBoundaryJson = JSON.stringify({
    behavior: 'generation_time_only',
    runtimeEmbodiment: false,
    boundary: 'Skills shape this master workflow during Ricky generation. Runtime child agents receive rendered workflow instructions only.',
    loadedSkills: input.skills.applicableSkillNames,
    applicationEvidence: input.skillApplicationEvidence,
  }, null, 2);
  // Read the child source map from disk at runtime instead of inlining the
  // JSON into this shell command. Inlining once N children deep produced a
  // multi-megabyte argv element and triggered `spawn E2BIG`.
  const materializeCommand = [
    'node --input-type=module <<\'NODE\'',
    'import { mkdirSync, writeFileSync, readFileSync } from \'node:fs\';',
    'import { dirname } from \'node:path\';',
    `const childSources = JSON.parse(readFileSync(${literal(input.childrenSidecarPath)}, 'utf8'));`,
    'for (const [filePath, source] of Object.entries(childSources)) {',
    '  mkdirSync(dirname(filePath), { recursive: true });',
    '  writeFileSync(filePath, source, \'utf8\');',
    '  console.log(`materialized_child_workflow=${filePath}`);',
    '}',
    'NODE',
  ].join('\n');
  const leadPlanSummaryLines = [
    '# Master execution plan',
    '',
    `Plan source: ${input.artifactsDir}/master-plan.json`,
    `Child workflows: ${input.plan.children.length} across ${waveCount(input.plan)} wave(s).`,
    '',
    '## Child ownership',
    '',
    ...input.plan.children.map((child) => {
      const deps = child.dependsOn.length > 0 ? child.dependsOn.join(', ') : '(none)';
      const targets = child.targetFiles.length > 0 ? child.targetFiles.join(', ') : '(no declared target files)';
      return `- ${child.id} — depends on ${deps}; targets ${targets}; signoff marker ${child.signoffMarker}`;
    }),
    '',
    '## Non-goals and gates',
    '',
    '- Each child workflow is independently 80-to-100 gated; the master executor only checks signoff markers afterward.',
    '- Source edits happen inside child workflows, not in this lead-plan step.',
    '',
    'RICKY_MASTER_LEAD_PLAN_READY',
  ];
  const leadPlanCommand = [
    'set -e',
    `mkdir -p ${shellQuote(input.artifactsDir)}`,
    `cat > ${shellQuote(`${input.artifactsDir}/lead-plan.md`)} <<'EOF'`,
    ...leadPlanSummaryLines,
    'EOF',
    // Re-verify the marker landed on disk so the deterministic guarantee
    // is self-checked and any future template edit that drops it fails
    // loudly here instead of silently passing through.
    `grep -F RICKY_MASTER_LEAD_PLAN_READY ${shellQuote(`${input.artifactsDir}/lead-plan.md`)} >/dev/null`,
    'echo RICKY_MASTER_LEAD_PLAN_VERIFIED',
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
  const listedValidationOnly = usesOnlyListedValidationCommands(input.spec);
  const listedValidationCommands = executableAcceptanceCommandsForSpec(input.spec);
  const finalHardValidationCommands = [
    'set -e',
    ...(listedValidationOnly
      ? listedValidationCommands
      : [TYPECHECK_COMMAND, deriveTestCommand(input.spec)]),
    'git diff --name-only',
    `grep -F RICKY_MASTER_REVIEW_READY ${shellQuote(`${input.artifactsDir}/review-codex.md`)}`,
    'echo RICKY_MASTER_FINAL_VALIDATION_READY',
  ];

  // The master workflow's `.description()` is sent to runtime agents as
  // context. Inlining the full spec text here meant every agent invocation
  // carried ~100KB+ of markdown that the agents did not need (the spec lives
  // on disk at specSidecarPath and child slices `cp` it locally). The short
  // ref keeps the description small without losing the pointer.
  const masterDescription = `${firstHeadingOrSummary(input.spec.description)} (full spec on disk at ${input.specSidecarPath}; child workflows read it from there).`;
  return `${[
    "import { workflow } from '@agent-relay/sdk/workflows';",
    '',
    '// IMPLEMENTATION_WORKFLOW_CONTRACT: broad implementation specs run as child workflows with source changes, tests, non-empty diff evidence, and PR/result reporting.',
    '// RICKY_MASTER_EXECUTOR_WORKFLOW: Ricky kept the CLI interface stable and decomposed this spec internally.',
    '// 80-to-100 master contract: child workflows perform fix-loop work, then the master performs final-review evidence checks before signoff.',
    '',
    'async function main() {',
    `  const result = await workflow(${literal(input.workflowId)})`,
    `    .description(${literal(masterDescription)})`,
    `    .pattern(${literal(input.pattern.pattern)})`,
    `    .channel(${literal(input.channel)})`,
    '    .maxConcurrency(4)',
    '    .timeout(7200000)',
    `    .onError(${repairAwareOnError('master-lead')})`,
    '',
    '    .agent("master-lead", { cli: "claude", interactive: false, role: "Repairs master executor failures and final integration evidence.", retries: 1 })',
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
    // `lead-plan` was historically an LLM agent step that asked
    // `master-lead` claude to read master-plan.json and write a marker
    // file confirming the deterministically-generated plan. There was
    // nothing for the model to actually decide (the plan was already
    // shaped by `planMasterExecution`), but every failure to spawn
    // headless claude — a frequent runtime failure mode in cloud
    // sandboxes — produced `INVALID_ARTIFACT at lead-plan`, blocking
    // `materialize-child-workflows` and leaving zero impl on disk to
    // salvage. Replaced with a deterministic node step that templates
    // the plan summary directly. The downstream `lead-plan-gate` is
    // collapsed away in favor of grepping the marker inline (the
    // separate gate step added no value once `lead-plan` itself was
    // deterministic).
    '    .step("lead-plan", {',
    '      type: "deterministic",',
    '      dependsOn: ["prepare-context"],',
    `      command: ${literal(leadPlanCommand)},`,
    '      captureOutput: true,',
    '      failOnError: true,',
    '    })',
    '',
    '    .step("materialize-child-workflows", {',
    '      type: "deterministic",',
    '      dependsOn: ["lead-plan"],',
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
    `      command: ${literal(finalHardValidationCommands.join('\n'))},`,
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

export function childWorkflowSource(child: ChildWorkflowPlan, spec: NormalizedWorkflowSpec, specSidecarPath?: string): string {
  const artifactsDir = child.signoffArtifactPath.replace(/\/signoff\.md$/, '');
  const validationCommand = child.validationCommands[0] ?? 'npm run typecheck';
  const targetScope = child.targetFiles.length > 0 ? child.targetFiles.join(' ') : 'NO_TARGET_FILES_DECLARED';
  const marker = child.signoffMarker;
  // Injected into every review/fix task. The master executor runs all child
  // slices in one shared checkout, so by the time a later child is reviewed
  // the worktree already contains earlier siblings' dirty files. Reviewers
  // were assigning BLOCKED and fix-loops were writing BLOCKED_NO_COMMIT.md
  // purely because `git status` showed sibling files outside this slice's
  // declared scope — a false block that stalls the whole master plan.
  const sharedWorktreeScopeRule =
    `Shared-worktree scope rule: this child runs in the SAME checkout as sibling slices. `
    + `${artifactsDir}/scope-baseline.txt is the dirty set captured before this child started. `
    + `Files in that baseline are pre-existing sibling/parent changes — they are NOT this child's `
    + `responsibility, NOT scope violations, and must NOT be reverted, cleaned, or counted against `
    + `this slice. Judge scope, findings, and BLOCKED only on the delta this child introduces on top `
    + `of the baseline (current 'git status --porcelain' minus scope-baseline.txt). Do not BLOCK or `
    + `write BLOCKED_NO_COMMIT.md solely because unrelated sibling files are dirty.`;

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
    '    .agent("reviewer-claude", { cli: "claude", preset: "reviewer", role: "First-pass fresh-eyes reviewer for scope, evidence, and product fit.", retries: 1 })',
    '    .agent("reviewer-codex", { cli: "codex", preset: "reviewer", role: "Reviews code, tests, deterministic gates, and PR/result evidence.", retries: 1 })',
    '    .agent("validator-claude", { cli: "claude", preset: "worker", role: "Runs the 80-to-100 fix loop and writes final signoff.", retries: 2 })',
    '    .agent("validator-codex", { cli: "codex", preset: "worker", role: "Runs the Codex review-fix loop and verifies final readiness.", retries: 2 })',
    '    .step("prepare-context", {',
    '      type: "deterministic",',
    `      command: ${literal([
      'set -e',
      `mkdir -p ${shellQuote(artifactsDir)}`,
      // Copy the spec from its sidecar file rather than embedding it via
      // `printf '%s\\n' '<huge spec text>'`. The embedded form pushed every
      // child's prepare-context heredoc to ~100KB and made the materialize
      // step's argv multi-megabyte. When the sidecar path isn't known
      // (legacy call sites), fall back to a no-op so this child still runs.
      specSidecarPath
        ? `cp ${shellQuote(specSidecarPath)} ${shellQuote(`${artifactsDir}/normalized-spec.txt`)}`
        : `: > ${shellQuote(`${artifactsDir}/normalized-spec.txt`)}`,
      `printf '%s\\n' ${shellQuote(targetScope)} > ${shellQuote(`${artifactsDir}/target-files.txt`)}`,
      // Snapshot the worktree's dirty set BEFORE this child touches anything.
      // The master executor runs every child in the SAME checkout, so by the
      // time a later child starts, earlier siblings' changes are already
      // dirty here. Files listed in scope-baseline.txt are pre-existing
      // sibling/parent state this child does not own — the scope gate must
      // judge this child only on the delta it introduces, never on this
      // baseline. Without it, every child after the first false-blocks on
      // sibling contamination.
      //
      // Scope/limitation: this fully fixes the dominant failure — sequential
      // accumulation, where siblings completed before this child started
      // (the observed update-last-week stall: 50 dirty entries, all from
      // already-finished siblings). It does NOT fully eliminate the race for
      // siblings running CONCURRENTLY within the same wave (master is
      // .maxConcurrency(4)): a file a sibling dirties AFTER this snapshot is
      // not in the baseline and could still be misattributed. A snapshot
      // can't close that window; the durable fix is per-child git-worktree
      // isolation, deferred as a separate, larger change (see PR
      // "Alternative considered"). Baseline subtraction is the minimal
      // correct fix for the failure that actually occurs in practice.
      `git status --porcelain > ${shellQuote(`${artifactsDir}/scope-baseline.txt`)} 2>/dev/null || : > ${shellQuote(`${artifactsDir}/scope-baseline.txt`)}`,
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
      `This child runs in a SHARED worktree alongside sibling child slices. ${artifactsDir}/scope-baseline.txt lists files already dirty before this child started — those belong to sibling/parent slices, are out of this child's ownership, and must NOT be reverted or counted as scope violations. Define this child's changed-file scope as the delta it introduces on top of that baseline.`,
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
      `Shared worktree: files in ${artifactsDir}/scope-baseline.txt are pre-existing sibling/parent changes. Do not edit, revert, stage, or clean them — leave them exactly as found.`,
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
    '    .step("review-claude", {',
    '      agent: "reviewer-claude",',
    '      dependsOn: ["initial-soft-validation"],',
    `      task: ${templateLiteral([
      'Fresh-eyes review this child slice against the lead plan, actual files, diff, and validation output.',
      sharedWorktreeScopeRule,
      'Use verdict: FINDINGS | NO_ISSUES_FOUND | BLOCKED and include fix_required plus test_required for each finding.',
      `Write ${artifactsDir}/review-claude.md ending with RICKY_CHILD_CLAUDE_REVIEW_READY.`,
    ].join('\n'))},`,
    `      verification: { type: "file_exists", value: ${literal(`${artifactsDir}/review-claude.md`)} },`,
    '    })',
    '    .step("fix-loop", {',
    '      agent: "validator-claude",',
    '      dependsOn: ["review-claude", "initial-soft-validation"],',
    `      task: ${templateLiteral([
      'Run the Claude 80-to-100 review-fix loop for this child slice.',
      `Read ${artifactsDir}/review-claude.md and the initial validation output.`,
      'Fix every valid finding within the declared scope; add or update tests/proofs for testable findings.',
      sharedWorktreeScopeRule,
      `If blocked, write ${artifactsDir}/BLOCKED_NO_COMMIT.md with exact evidence.`,
      `Write ${artifactsDir}/fix-loop-report.md ending with RICKY_CHILD_FIX_LOOP_READY.`,
    ].join('\n'))},`,
    `      verification: { type: "file_exists", value: ${literal(`${artifactsDir}/fix-loop-report.md`)} },`,
    '    })',
    '    .step("post-fix-validation", {',
    '      type: "deterministic",',
    '      dependsOn: ["fix-loop"],',
    `      command: ${literal(`${validationCommand} 2>&1 | tail -160`)},`,
    '      captureOutput: true,',
    '      failOnError: false,',
    '    })',
    '    .step("final-review-claude", {',
    '      agent: "reviewer-claude",',
    '      dependsOn: ["post-fix-validation"],',
    `      task: ${templateLiteral([
      'Re-review the fixed child state from scratch.',
      sharedWorktreeScopeRule,
      'Use verdict: FINDINGS | NO_ISSUES_FOUND | BLOCKED and include fix_required plus test_required for each finding.',
      `Write ${artifactsDir}/final-review-claude.md ending with RICKY_CHILD_CLAUDE_FINAL_REVIEW_READY.`,
    ].join('\n'))},`,
    `      verification: { type: "file_exists", value: ${literal(`${artifactsDir}/final-review-claude.md`)} },`,
    '    })',
    '    .step("final-fix-claude", {',
    '      agent: "validator-claude",',
    '      dependsOn: ["final-review-claude"],',
    `      task: ${templateLiteral([
      `Read ${artifactsDir}/final-review-claude.md.`,
      'If it says NO_ISSUES_FOUND, record that no fix was needed. Otherwise fix every valid finding and harden tests/proofs.',
      sharedWorktreeScopeRule,
      `If blocked, write ${artifactsDir}/BLOCKED_NO_COMMIT.md with exact evidence.`,
      `Write ${artifactsDir}/claude-final-fix.md ending with RICKY_CHILD_CLAUDE_FINAL_FIX_READY.`,
    ].join('\n'))},`,
    `      verification: { type: "file_exists", value: ${literal(`${artifactsDir}/claude-final-fix.md`)} },`,
    '    })',
    '    .step("review-codex", {',
    '      agent: "reviewer-codex",',
    '      dependsOn: ["final-fix-claude"],',
    `      task: ${templateLiteral([
      'Second-pass fresh-eyes review after the Claude loop. Read the actual files, diff, review artifacts, and validation evidence.',
      sharedWorktreeScopeRule,
      'Use verdict: FINDINGS | NO_ISSUES_FOUND | BLOCKED and include fix_required plus test_required for each finding.',
      `Write ${artifactsDir}/review-codex.md ending with RICKY_CHILD_CODEX_REVIEW_READY.`,
    ].join('\n'))},`,
    `      verification: { type: "file_exists", value: ${literal(`${artifactsDir}/review-codex.md`)} },`,
    '    })',
    '    .step("fix-loop-codex", {',
    '      agent: "validator-codex",',
    '      dependsOn: ["review-codex"],',
    `      task: ${templateLiteral([
      `Read ${artifactsDir}/review-codex.md.`,
      'Fix every valid Codex finding and add or update tests/proofs for testable findings.',
      sharedWorktreeScopeRule,
      `If blocked, write ${artifactsDir}/BLOCKED_NO_COMMIT.md with exact evidence.`,
      `Write ${artifactsDir}/codex-fix-loop-report.md ending with RICKY_CHILD_CODEX_FIX_LOOP_READY.`,
    ].join('\n'))},`,
    `      verification: { type: "file_exists", value: ${literal(`${artifactsDir}/codex-fix-loop-report.md`)} },`,
    '    })',
    '    .step("post-codex-fix-validation", {',
    '      type: "deterministic",',
    '      dependsOn: ["fix-loop-codex"],',
    `      command: ${literal(`${validationCommand} 2>&1 | tail -160`)},`,
    '      captureOutput: true,',
    '      failOnError: false,',
    '    })',
    '    .step("final-review-codex", {',
    '      agent: "reviewer-codex",',
    '      dependsOn: ["post-codex-fix-validation"],',
    `      task: ${templateLiteral([
      'Final Codex fresh-eyes review after Codex fixes.',
      sharedWorktreeScopeRule,
      'Use verdict: FINDINGS | NO_ISSUES_FOUND | BLOCKED and include fix_required plus test_required for each finding.',
      `Write ${artifactsDir}/final-review-codex.md ending with RICKY_CHILD_CODEX_FINAL_REVIEW_READY.`,
    ].join('\n'))},`,
    `      verification: { type: "file_exists", value: ${literal(`${artifactsDir}/final-review-codex.md`)} },`,
    '    })',
    '    .step("final-fix-codex", {',
    '      agent: "validator-codex",',
    '      dependsOn: ["final-review-codex"],',
    `      task: ${templateLiteral([
      `Read ${artifactsDir}/final-review-codex.md.`,
      'If it says NO_ISSUES_FOUND, record that no fix was needed. Otherwise fix every valid finding and harden tests/proofs.',
      sharedWorktreeScopeRule,
      `If blocked, write ${artifactsDir}/BLOCKED_NO_COMMIT.md with exact evidence.`,
      `Write ${artifactsDir}/codex-final-fix.md ending with RICKY_CHILD_CODEX_FINAL_FIX_READY.`,
    ].join('\n'))},`,
    `      verification: { type: "file_exists", value: ${literal(`${artifactsDir}/codex-final-fix.md`)} },`,
    '    })',
    '    .step("final-review-pass-gate", {',
    '      type: "deterministic",',
    '      dependsOn: ["final-fix-codex"],',
    `      command: ${literal(buildFinalReviewPassGateCommand({
      artifactsDir,
      checks: [
        {
          presenceTest: `grep -qF RICKY_CHILD_CLAUDE_FINAL_FIX_READY ${shellQuote(`${artifactsDir}/claude-final-fix.md`)}`,
          missingDetail: `${artifactsDir}/claude-final-fix.md is missing RICKY_CHILD_CLAUDE_FINAL_FIX_READY`,
        },
        {
          presenceTest: `grep -qF RICKY_CHILD_CODEX_FINAL_FIX_READY ${shellQuote(`${artifactsDir}/codex-final-fix.md`)}`,
          missingDetail: `${artifactsDir}/codex-final-fix.md is missing RICKY_CHILD_CODEX_FINAL_FIX_READY`,
        },
      ],
      successMarker: 'RICKY_CHILD_FRESH_EYES_LOOP_READY',
    }))},`,
    '      captureOutput: true,',
    '      failOnError: true,',
    '    })',
    '    .step("final-hard-validation", {',
    '      type: "deterministic",',
    '      dependsOn: ["final-review-pass-gate"],',
    `      command: ${literal([
      'set -e',
      validationCommand,
      'git diff --name-only',
      // Quiet greps with explicit diagnostics — a missing marker here must
      // not be hidden behind the previous grep's matched-line output.
      `if ! grep -qF RICKY_CHILD_CLAUDE_FINAL_FIX_READY ${shellQuote(`${artifactsDir}/claude-final-fix.md`)}; then echo ${shellQuote(`RICKY_CHILD_GATE_MISSING_MARKER: ${artifactsDir}/claude-final-fix.md is missing RICKY_CHILD_CLAUDE_FINAL_FIX_READY`)} >&2; exit 1; fi`,
      `if ! grep -qF RICKY_CHILD_CODEX_FINAL_FIX_READY ${shellQuote(`${artifactsDir}/codex-final-fix.md`)}; then echo ${shellQuote(`RICKY_CHILD_GATE_MISSING_MARKER: ${artifactsDir}/codex-final-fix.md is missing RICKY_CHILD_CODEX_FINAL_FIX_READY`)} >&2; exit 1; fi`,
      'echo RICKY_CHILD_FINAL_VALIDATION_READY',
    ].join('\n'))},`,
    '      captureOutput: true,',
    '      failOnError: true,',
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
    task('lead-plan', 'Plan child execution', 'deterministic', 'Write and verify the lead plan summary.', ['prepare-context']),
    task('materialize-child-workflows', 'Materialize child workflows', 'deterministic', 'Write focused child workflow artifacts.', ['lead-plan']),
    ...plan.children.map((child) =>
      task(`run-${child.id}`, `Run ${child.title}`, 'deterministic', `Run child workflow ${child.workflowFilePath} through ricky run.`, child.dependsOn.map((id) => `run-${id}`)),
    ),
    task('review-child-evidence', 'Review child evidence', 'master-reviewer', 'Review child signoffs and master readiness.', plan.children.map((child) => `run-${child.id}`)),
    task('final-signoff', 'Final signoff', 'deterministic', 'Write master signoff after hard validation.', ['final-hard-validation']),
  ];
}

function buildMasterGates(artifactsDir: string, plan: MasterExecutionPlan, spec: NormalizedWorkflowSpec): DeterministicGate[] {
  const testCommand = deriveTestCommand(spec);
  const listedValidationOnly = usesOnlyListedValidationCommands(spec);
  const finalValidationCommand = listedValidationOnly
    ? executableAcceptanceCommandsForSpec(spec).join(' && ')
    : `{ ${TYPECHECK_COMMAND}; } && ${testCommand}`;
  const safeFinalValidationCommand = finalValidationCommand || "printf '%s\\n' 'No executable validation commands listed by spec.'";
  return [
    gate('skill-boundary-metadata-gate', `test -f ${artifactsDir}/skill-application-boundary.json`, 'file_exists', true, ['prepare-context'], 'pre_review'),
    gate('child-workflow-file-gate', plan.children.map((child) => `test -f ${child.workflowFilePath}`).join(' && '), 'file_exists', true, ['materialize-child-workflows'], 'pre_review'),
    gate('initial-soft-validation', listedValidationOnly ? safeFinalValidationCommand : `{ ${TYPECHECK_COMMAND}; } 2>&1 | tail -160`, 'output_contains', false, ['child-workflow-file-gate'], 'pre_review'),
    gate('final-review-pass-gate', `grep -F RICKY_MASTER_REVIEW_READY ${artifactsDir}/review-codex.md`, 'output_contains', true, ['review-child-evidence'], 'final'),
    gate('final-hard-validation', safeFinalValidationCommand, 'exit_code', true, ['final-review-pass-gate'], 'final'),
    gate('git-diff-gate', 'git diff --name-only', 'output_contains', true, ['final-hard-validation'], 'final'),
    gate('regression-gate', listedValidationOnly ? safeFinalValidationCommand : testCommand, 'exit_code', true, ['git-diff-gate'], 'regression'),
  ];
}

function buildMasterSkillEvidence(skills: SkillContext): SkillApplicationEvidence[] {
  const names = skills.applicableSkillNames.length > 0
    ? skills.applicableSkillNames
    : ['choosing-swarm-patterns', 'writing-agent-relay-workflows', 'relay-80-100-workflow', 'review-fix-signoff-loop'];
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
    { stepId: 'lead-plan', agent: 'deterministic', runner: '@agent-relay/sdk', concurrency: 1, rule: 'master executor deterministic lead plan' },
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

function firstHeadingOrSummary(specText: string): string {
  const candidate = firstMarkdownHeadingOrParagraph(specText)
    ?? specText.split('\n').find((line) => line.trim().length > 0)?.trim()
    ?? 'Ricky master workflow';
  return candidate.length > 200 ? `${candidate.slice(0, 197)}...` : candidate;
}

function firstMarkdownHeadingOrParagraph(specText: string): string | undefined {
  let root: Nodes;
  try {
    root = fromMarkdown(specText);
  } catch {
    return undefined;
  }

  let fallback: string | undefined;
  const visit = (node: Nodes): string | undefined => {
    if (node.type === 'heading' && 'depth' in node && (node.depth === 1 || node.depth === 2)) {
      const text = markdownNodeText(node);
      if (text) return text;
    }

    if (!fallback && (node.type === 'paragraph' || node.type === 'text')) {
      fallback = markdownNodeText(node);
    }

    if ('children' in node) {
      for (const child of node.children) {
        const found = visit(child);
        if (found) return found;
      }
    }

    return undefined;
  };

  return visit(root) ?? fallback;
}

function markdownNodeText(node: Nodes): string | undefined {
  if ('value' in node && typeof node.value === 'string') {
    return node.value.replace(/\s+/g, ' ').trim() || undefined;
  }
  if (!('children' in node)) return undefined;
  const text = node.children
    .map((child) => markdownNodeText(child) ?? '')
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text || undefined;
}

function templateLiteral(value: string): string {
  return `\`${value.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${')}\``;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
