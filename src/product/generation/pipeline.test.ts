import { describe, expect, it } from 'vitest';
import ts from 'typescript';

import { intake } from '../spec-intake/index.js';
import type { NormalizedWorkflowSpec, RawSpecPayload } from '../spec-intake/types.js';
import { generate, validateGeneratedArtifact } from './pipeline.js';
import { childWorkflowSource } from './master-workflow-renderer.js';

interface StepConfig {
  command?: string;
  task?: string;
  agent?: string;
  type?: string;
  dependsOn?: string[];
  position: number;
}

interface OnErrorConfig {
  strategy?: string;
  maxRetries?: number;
  retryDelayMs?: number;
  repairAgent?: string;
  repairRetries?: number;
}

/**
 * Parse a generated child workflow's TypeScript source and return each
 * `.step("<id>", { ... })` config's `command` / `task` string values keyed
 * by step id. AST-based (per AGENTS.md "Source-Text Analysis: Use
 * Grammar-Aware Parsers, Not Regex") so assertions check the contract is
 * attached to the right step rather than that text appears anywhere in the
 * rendered blob.
 */
function extractStepConfigs(source: string): Map<string, StepConfig> {
  const sourceFile = ts.createSourceFile('child.ts', source, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS);
  const steps = new Map<string, StepConfig>();
  const literalText = (node: ts.Expression): string | undefined => {
    if (ts.isStringLiteralLike(node)) return node.text;
    if (ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
    if (ts.isTemplateExpression(node)) {
      return [node.head.text, ...node.templateSpans.map((s) => s.literal.text)].join('');
    }
    return undefined;
  };
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node)
      && ts.isPropertyAccessExpression(node.expression)
      && node.expression.name.text === 'step'
      && node.arguments.length >= 2
      && ts.isStringLiteralLike(node.arguments[0])
      && ts.isObjectLiteralExpression(node.arguments[1])
    ) {
      const id = node.arguments[0].text;
      const cfg: StepConfig = { position: node.getStart(sourceFile) };
      for (const prop of node.arguments[1].properties) {
        if (!ts.isPropertyAssignment(prop) || !prop.name) continue;
        const key = ts.isIdentifier(prop.name) || ts.isStringLiteralLike(prop.name) ? prop.name.text : undefined;
        if (key === 'command') cfg.command = literalText(prop.initializer);
        if (key === 'task') cfg.task = literalText(prop.initializer);
        if (key === 'agent') cfg.agent = literalText(prop.initializer);
        if (key === 'type') cfg.type = literalText(prop.initializer);
        if (key === 'dependsOn' && ts.isArrayLiteralExpression(prop.initializer)) {
          cfg.dependsOn = prop.initializer.elements
            .map((el) => literalText(el as ts.Expression))
            .filter((v): v is string => typeof v === 'string');
        }
      }
      steps.set(id, cfg);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return steps;
}

function extractOnErrorConfigs(source: string): OnErrorConfig[] {
  const sourceFile = ts.createSourceFile('workflow.ts', source, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS);
  const configs: OnErrorConfig[] = [];

  const literalText = (node: ts.Expression): string | undefined => {
    if (ts.isStringLiteralLike(node)) return node.text;
    if (ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
    return undefined;
  };
  const literalNumber = (node: ts.Expression): number | undefined => {
    if (ts.isNumericLiteral(node)) return Number(node.text);
    if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.MinusToken && ts.isNumericLiteral(node.operand)) {
      return -Number(node.operand.text);
    }
    return undefined;
  };
  const objectValue = (node: ts.Expression): Partial<OnErrorConfig> => {
    if (!ts.isObjectLiteralExpression(node)) return {};
    const cfg: Partial<OnErrorConfig> = {};
    for (const prop of node.properties) {
      if (!ts.isPropertyAssignment(prop) || !prop.name) continue;
      const key = ts.isIdentifier(prop.name) || ts.isStringLiteralLike(prop.name) ? prop.name.text : undefined;
      if (key === 'repairAgent') cfg.repairAgent = literalText(prop.initializer);
      if (key === 'maxRetries') cfg.maxRetries = literalNumber(prop.initializer);
      if (key === 'retryDelayMs') cfg.retryDelayMs = literalNumber(prop.initializer);
      if (key === 'repairRetries') cfg.repairRetries = literalNumber(prop.initializer);
    }
    return cfg;
  };
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node)
      && ts.isPropertyAccessExpression(node.expression)
      && node.expression.name.text === 'onError'
    ) {
      configs.push({
        strategy: node.arguments[0] && ts.isExpression(node.arguments[0]) ? literalText(node.arguments[0]) : undefined,
        ...(node.arguments[1] && ts.isExpression(node.arguments[1]) ? objectValue(node.arguments[1]) : {}),
      });
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return configs;
}

const RECEIVED_AT = '2026-04-26T00:00:00.000Z';

interface SpecFixtureOverrides {
  description?: string;
  targetContext?: string;
  targetFiles?: string[];
  constraints?: string[];
  evidenceRequirements?: string[];
  acceptanceGates?: string[];
  executionPreference?: NormalizedWorkflowSpec['executionPreference'];
}

describe('workflow generation pipeline', () => {
  it('routes broad implementation specs through a master workflow without changing the CLI artifact contract', () => {
    const result = generate({
      spec: spec({
        description:
          'Implement nested runner, runtime policy, telemetry, evals, and insights as smaller workflows run by a master executor.',
        constraints: ['Use independent child workflows with deterministic 80-to-100 validation.'],
        acceptanceGates: ['npm test'],
      }),
      artifactPath: 'workflows/generated/runtime-master.ts',
    });

    expect(result.success).toBe(true);
    expect(result.masterExecutionPlan).toBeDefined();
    expect(result.masterExecutionPlan?.children.map((child) => child.id)).toEqual([
      'nested-runner',
      'runtime-policy',
      'telemetry',
      'evals',
      'insights',
    ]);
    expect(result.executionRoute).toMatchObject({
      artifactDelivery: 'write_local_file',
      runnerCommand: 'npx agent-relay run --dry-run workflows/generated/runtime-master.ts',
    });

    const rendered = artifact(result);
    expect(rendered.artifactPath).toBe('workflows/generated/runtime-master.ts');
    expect(rendered.content).toContain('RICKY_MASTER_EXECUTOR_WORKFLOW');
    expect(rendered.content).toContain('Master plan: 5 child workflows');
    expect(rendered.content).toContain('ricky run \'workflows/generated/runtime-master-children/01-nested-runner.ts\' --foreground');
    expect(rendered.content).not.toMatch(/^\s*command: "set -e\\nricky run .*--no-auto-fix/m);
    expect(rendered.content).toContain('MASTER_EXECUTOR_RESULT_READY');
    expect(rendered.content).toContain('RICKY_CHILD_WORKFLOW_COMPLETE');
    // Child workflow sources live in the .children.json sidecar so the
    // master content stays under ARG_MAX. Assert child-only strings are in
    // the sidecar payload rather than inlined into the master TS.
    const childrenSidecarPath = 'workflows/generated/runtime-master.children.json';
    expect(rendered.sidecarFiles?.[childrenSidecarPath], 'children sidecar attached').toBeDefined();
    const childrenSidecar = rendered.sidecarFiles![childrenSidecarPath];
    const childSources = JSON.parse(childrenSidecar) as Record<string, string>;
    expect(Object.keys(childSources), 'child sidecar contains child workflow sources').not.toHaveLength(0);
    const expectedChildStepOrder = [
      'review-claude',
      'fix-loop',
      'final-review-claude',
      'final-fix-claude',
      'review-codex',
      'fix-loop-codex',
      'final-review-codex',
      'final-fix-codex',
      'final-review-pass-gate',
      'final-hard-validation',
    ];
    for (const [childPath, childSource] of Object.entries(childSources)) {
      const childStepConfigs = extractStepConfigs(childSource);
      expect(extractOnErrorConfigs(childSource), `${childPath} child workflow retry policy`).toContainEqual({
        strategy: 'retry',
        maxRetries: 2,
        retryDelayMs: 10000,
        repairAgent: 'validator-claude',
        repairRetries: 2,
      });
      const childStepPositions = expectedChildStepOrder.map((step) => childStepConfigs.get(step)?.position);
      expect(childStepPositions, `${childPath} declares every fresh-eyes step`).not.toContain(undefined);
      expect(childStepPositions, `${childPath} fresh-eyes step order`)
        .toEqual([...childStepPositions].sort((a, b) => a! - b!));
      expect(childStepConfigs.get('final-review-pass-gate')?.command, `${childPath} child fresh-eyes marker`).toContain('RICKY_CHILD_FRESH_EYES_LOOP_READY');
    }
    expect(extractOnErrorConfigs(rendered.content), 'master workflow retry policy').toContainEqual({
      strategy: 'retry',
      maxRetries: 2,
      retryDelayMs: 10000,
      repairAgent: 'master-lead',
      repairRetries: 2,
    });
    expect(rendered.content.replace(/\\+"/g, '"')).toMatch(
      /\.step\("final-hard-validation"[\s\S]*?failOnError: true,[\s\S]*?\.step\("final-signoff"/,
    );
    expect(rendered.content).toContain('.run({ cwd: process.cwd() })');
  });

  // Regression: the master template historically declared `lead-plan` as
  // an LLM agent step that asked headless claude to read the
  // already-deterministic master-plan.json and write a marker file.
  // The model had nothing to actually decide, but any failure to spawn
  // claude (a frequent runtime failure mode in cloud sandboxes) blocked
  // the workflow at `INVALID_ARTIFACT at lead-plan` before
  // `materialize-child-workflows` could create any source — leaving
  // zero salvageable impl on disk. `lead-plan` must now be a
  // deterministic step that templates the plan summary directly. The
  // separate `lead-plan-gate` step was collapsed into the body of
  // `lead-plan` once the LLM dependency was removed.
  it('renders master `lead-plan` as a deterministic step that never depends on an LLM agent', () => {
    const result = generate({
      spec: spec({
        description:
          'Implement nested runner, runtime policy, telemetry, evals, and insights as smaller workflows run by a master executor.',
        constraints: ['Use independent child workflows with deterministic 80-to-100 validation.'],
        acceptanceGates: ['npm test'],
      }),
      artifactPath: 'workflows/generated/runtime-master.ts',
    });
    expect(result.masterExecutionPlan).toBeDefined();
    const rendered = artifact(result);
    const stepConfigs = extractStepConfigs(rendered.content);
    const leadPlan = stepConfigs.get('lead-plan');
    expect(leadPlan, 'lead-plan step exists').toBeDefined();
    // No agent assignment — the step body must drive the marker
    // entirely via a deterministic command.
    expect(leadPlan!.agent, 'lead-plan has no agent assignment').toBeUndefined();
    expect(leadPlan!.type, 'lead-plan is deterministic').toBe('deterministic');
    expect(leadPlan!.command, 'lead-plan writes the marker into lead-plan.md').toContain('RICKY_MASTER_LEAD_PLAN_READY');
    expect(leadPlan!.command, 'lead-plan self-verifies the marker after writing').toContain('grep -F RICKY_MASTER_LEAD_PLAN_READY');
    expect(leadPlan!.command, 'lead-plan echoes the downstream verification marker').toContain('RICKY_MASTER_LEAD_PLAN_VERIFIED');
    // `materialize-child-workflows` formerly depended on the separate
    // `lead-plan-gate`; with the gate folded into `lead-plan`, the
    // dependency must move directly to `lead-plan`.
    const materialize = stepConfigs.get('materialize-child-workflows');
    expect(materialize, 'materialize-child-workflows step exists').toBeDefined();
    expect(materialize!.dependsOn, 'materialize depends on lead-plan').toContain('lead-plan');
    // The historical separate gate step is no longer rendered.
    expect(stepConfigs.has('lead-plan-gate'), 'master template no longer declares a separate lead-plan-gate').toBe(false);

    expect(rendered.tasks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'lead-plan', agentRole: 'deterministic', dependsOn: ['prepare-context'] }),
      expect.objectContaining({ id: 'materialize-child-workflows', dependsOn: ['lead-plan'] }),
    ]));
    expect(rendered.gates.some((gate) => gate.name === 'lead-plan-gate')).toBe(false);
    expect(rendered.toolSelections).toEqual(expect.arrayContaining([
      expect.objectContaining({
        stepId: 'lead-plan',
        agent: 'deterministic',
        runner: '@agent-relay/sdk',
      }),
    ]));
  });

  // Regression: the master executor runs every child slice in the SAME
  // checkout (.run({ cwd: process.cwd() })), so later children see earlier
  // siblings' dirty files. Reviewers were assigning BLOCKED and fix-loops
  // were writing BLOCKED_NO_COMMIT.md purely because `git status` showed
  // out-of-scope sibling files — a false block that stalled the whole
  // master plan for hours. Each child must snapshot the pre-existing dirty
  // set and judge scope only on its own delta.
  it('makes master child slices baseline-aware so shared-worktree sibling dirt is not a false BLOCK', () => {
    const fixtureSpec = spec({
      description:
        'Implement nested runner, runtime policy, telemetry, evals, and insights as smaller workflows run by a master executor.',
      constraints: ['Use independent child workflows with deterministic 80-to-100 validation.'],
      acceptanceGates: ['npm test'],
    });
    const result = generate({ spec: fixtureSpec, artifactPath: 'workflows/generated/runtime-master.ts' });
    expect(result.masterExecutionPlan).toBeDefined();

    const child = result.masterExecutionPlan!.children[0];
    const childSrc = childWorkflowSource(child, fixtureSpec);

    // Parse the generated child workflow with the TypeScript AST and extract
    // each `.step("<id>", { ... })` config object so assertions verify the
    // contract is attached to the right steps — not that a literal string
    // appears anywhere in the blob (AGENTS.md: parser-based, not substring).
    const stepConfigs = extractStepConfigs(childSrc);

    const prepare = stepConfigs.get('prepare-context');
    expect(prepare, 'prepare-context step exists').toBeDefined();
    expect(prepare!.command, 'prepare-context snapshots the pre-child dirty set')
      .toMatch(/git status --porcelain >\s*'[^']*\/scope-baseline\.txt'/);

    // Every review/fix stage that assigns BLOCKED or writes
    // BLOCKED_NO_COMMIT.md must carry the shared-worktree scope rule.
    const scopedStages = [
      'review-claude', 'fix-loop',
      'final-review-claude', 'final-fix-claude',
      'review-codex', 'fix-loop-codex',
      'final-review-codex', 'final-fix-codex',
    ];
    for (const stage of scopedStages) {
      const cfg = stepConfigs.get(stage);
      expect(cfg, `${stage} step exists`).toBeDefined();
      expect(cfg!.task, `${stage} task carries the shared-worktree scope rule`)
        .toContain('Shared-worktree scope rule');
      expect(cfg!.task, `${stage} forbids blocking on sibling dirt`)
        .toContain('Do not BLOCK or write BLOCKED_NO_COMMIT.md solely because unrelated sibling files are dirty');
      expect(cfg!.task, `${stage} defines scope as the delta over the baseline`)
        .toContain("current 'git status --porcelain' minus scope-baseline.txt");
    }
  });

  // Regression: master-rendered final-hard-validation used to hardcode
  // `npm test`, which walks the entire repo's test suite from the cwd.
  // For monorepo specs that scope work to a few `packages/<pkg>/` files,
  // any pre-existing or transient failure in an *unrelated* workspace
  // package then blocks the workflow's final gate — work no agent in the
  // generated workflow can sensibly repair because it isn't in the spec's
  // declared scope. The renderer now derives the test command from the
  // spec's targetFiles: when those targets share workspace prefixes
  // (`packages/<pkg>/`, `apps/<pkg>/`, `services/<pkg>/`), emit
  // `npm test --workspace=<pkg>` for each unique workspace; otherwise fall
  // back to the previous unscoped behavior.
  it('scopes master-rendered final-hard-validation tests to workspaces touched by the spec', () => {
    const result = generate({
      spec: spec({
        description:
          'Implement nested runner, runtime policy, telemetry, evals, and insights as smaller workflows run by a master executor.',
        constraints: ['Use independent child workflows with deterministic 80-to-100 validation.'],
        acceptanceGates: ['Tests pass.'],
        targetFiles: [
          'packages/backend/src/services/autofix/index.ts',
          'packages/backend/src/services/remediation-service.ts',
          'packages/shared/src/autofix.ts',
        ],
      }),
      artifactPath: 'workflows/generated/runtime-master.ts',
    });
    expect(result.masterExecutionPlan).toBeDefined();
    const rendered = artifact(result);

    // Assert against the structured gate command + parsed step body, not
    // raw rendered text — semantics over formatting. (CodeRabbit feedback
    // on PR #91.)
    const gateCommand = gate(rendered, 'final-hard-validation').command;
    const stepBody = renderedStepCommand(rendered.content, 'final-hard-validation');

    for (const target of [gateCommand, stepBody]) {
      // Each unique workspace touched by the spec gets its own scoped run.
      expect(target).toContain("npm test --workspace='packages/backend'");
      expect(target).toContain("npm test --workspace='packages/shared'");
      // Unrelated packages are not validated by this workflow's gate.
      expect(target).not.toContain("npm test --workspace='packages/webapp'");
      expect(target).not.toContain("npm test --workspace='packages/mobile'");
      // The unscoped `npm test` whole-suite invocation must not survive
      // anywhere in the validation surface — that's the exact pattern that
      // produced the original cross-package failure. (`npm test
      // --workspace=…` is fine; the negative lookahead allows it.)
      expect(target).not.toMatch(/(?:^|[\s&|;])npm test(?!\s*--workspace)/);
    }
  });

  // Regression: a spec that names test files in a *sibling repo* (e.g.
  // `relayfile-adapters/packages/core/src/digest-contract.test.ts` while
  // the workflow ships in the `relayfile` repo) used to render that path
  // straight into the final-hard-validation vitest invocation. The
  // generated workflow runs in a single repo's cwd, so vitest's include
  // glob `packages/**/*.test.ts` cannot reach a path under another
  // repo's directory, and the file doesn't exist locally anyway → vitest
  // exits 1 with "No test files found". The auto-fix loop then burns
  // its full budget (INVALID_ARTIFACT × maxAttempts) chasing a phantom
  // artifact path it cannot reach because it operates on the workflow
  // cwd only. The renderer now filters cross-repo paths out of the test
  // target list before constructing the vitest command, falling through
  // to the workspace-aware path for any local source targets that
  // remain.
  it('drops cross-repo paths from master-rendered final-hard-validation test invocation', () => {
    const result = generate({
      spec: spec({
        description: 'Implement workspace primitives across relayfile and relayfile-adapters.',
        constraints: ['Use independent child workflows with deterministic 80-to-100 validation.'],
        acceptanceGates: ['Tests pass.'],
        targetFiles: [
          // Local — should drive the workspace-aware command.
          'packages/core/src/digest.ts',
          'packages/core/src/digest.test.ts',
          // Cross-repo — must be filtered out before deriveTestCommand
          // builds the vitest invocation.
          'relayfile-adapters/packages/core/src/digest-contract.ts',
          'relayfile-adapters/packages/core/src/digest-contract.test.ts',
          '../relayfile-adapters/packages/core/src/digest-contract.test.ts',
        ],
      }),
      artifactPath: 'workflows/generated/workspace-primitives-master.ts',
    });
    expect(result.masterExecutionPlan).toBeDefined();
    const rendered = artifact(result);
    const gateCommand = gate(rendered, 'final-hard-validation').command;
    const stepBody = renderedStepCommand(rendered.content, 'final-hard-validation');

    for (const target of [gateCommand, stepBody]) {
      // The local test path is still validated.
      expect(target).toContain("npx vitest run 'packages/core/src/digest.test.ts'");
      // The sibling-repo path must NOT survive into the vitest call —
      // otherwise vitest exits 1 with "No test files found".
      expect(target).not.toContain('relayfile-adapters/packages/core/src/digest-contract.test.ts');
      expect(target).not.toContain('../relayfile-adapters');
    }
  });

  it('uniqueWorkspacesFromTargetFiles handles npm-scoped workspace paths', () => {
    // CodeRabbit flagged that the previous regex
    //   /^((?:packages|apps|services)\/[^\/]+)\//
    // mis-parsed `packages/@scope/pkg/...` (matched only the `@scope`
    // segment). The corrected regex allows an optional `@scope/` segment
    // so scoped workspaces are recognised end-to-end.
    const result = generate({
      spec: spec({
        description: 'Implement small slices across npm-scoped workspaces.',
        constraints: ['Use independent child workflows.'],
        acceptanceGates: ['Tests pass.'],
        targetFiles: [
          'packages/@agentworkforce/runtime/src/index.ts',
          'packages/@agentworkforce/runtime/src/policy.ts',
          'apps/@msd/web/src/index.ts',
          'services/billing/src/index.ts',
        ],
      }),
      artifactPath: 'workflows/generated/scoped-master.ts',
    });
    expect(result.masterExecutionPlan).toBeDefined();
    const command = gate(artifact(result), 'final-hard-validation').command;

    expect(command).toContain("npm test --workspace='packages/@agentworkforce/runtime'");
    expect(command).toContain("npm test --workspace='apps/@msd/web'");
    expect(command).toContain("npm test --workspace='services/billing'");
    // The previous bug surfaced as `--workspace='packages/@agentworkforce'`
    // (truncated at the scope segment) — guard against regression.
    expect(command).not.toContain("npm test --workspace='packages/@agentworkforce'");
    expect(command).not.toContain("npm test --workspace='apps/@msd'");
  });

  // Regression: master-rendered final-hard-validation used to hardcode
  // `npx tsc --noEmit`, which dumps the full `tsc --help` text and exits 1
  // when invoked from a monorepo root with no top-level tsconfig.json
  // (npm workspaces with `packages/*/tsconfig.json` layout — common in
  // MSD-style repos). The auto-fix loop then "repaired" the workflow 7×,
  // all failing identically because the workflow command was correct in
  // general — just wrong for that repo shape. The renderer now emits a
  // workspace-aware shell snippet that prefers `npm run typecheck` when the
  // project defines that script and falls back to `npx tsc --noEmit`
  // otherwise. The fallback path keeps `npx tsc --noEmit` as a literal
  // substring so downstream tests, evidence capture, and human readers
  // still recognize the intent.
  it('emits a workspace-aware typecheck command in master-rendered final-hard-validation', () => {
    const result = generate({
      spec: spec({
        description:
          'Implement nested runner, runtime policy, telemetry, evals, and insights as smaller workflows run by a master executor.',
        constraints: ['Use independent child workflows with deterministic 80-to-100 validation.'],
        acceptanceGates: ['npm test'],
      }),
      artifactPath: 'workflows/generated/runtime-master.ts',
    });
    expect(result.masterExecutionPlan).toBeDefined();
    const rendered = artifact(result).content;

    // The final-hard-validation step body must include both branches of the
    // workspace-aware fallback so monorepos and flat repos both succeed.
    expect(rendered).toContain('npm pkg get scripts.typecheck');
    expect(rendered).toContain('npm run typecheck');
    expect(rendered).toContain('npx tsc --noEmit');

    // The bare `npx tsc --noEmit` (without the conditional guard) must not
    // appear as the first command after `set -e` in any rendered .step body.
    // That pattern is what would dump the tsc help text in monorepo roots.
    expect(rendered).not.toMatch(/command: "set -e\\nnpx tsc --noEmit\\n/);
  });

  it('uses a master workflow for very broad target-file specs and leaves narrow specs on the existing renderer', () => {
    // The router's file-count fallback is intentionally conservative (12)
    // so that medium-sized specs (4–11 target files) without explicit
    // master/decomposition vocabulary route through the LLM writer
    // instead of the canned master template. See the regression test
    // below for the case that previously tripped at the old `>= 4`
    // threshold.
    const broad = generate({
      spec: spec({
        description: 'Implement a broad runtime update with deterministic validation.',
        targetFiles: [
          'src/runtime/nested-runner.ts',
          'src/runtime/policy.ts',
          'src/runtime/telemetry.ts',
          'src/product/evals.ts',
          'src/product/insights.ts',
          'src/product/observability.ts',
          'src/product/generation/template-renderer.ts',
          'src/product/generation/pipeline.ts',
          'src/product/orchestration/planner.ts',
          'src/product/orchestration/master-executor.ts',
          'src/local/auto-fix-loop.ts',
          'src/local/runner.ts',
        ],
      }),
      artifactPath: 'workflows/generated/broad-runtime.ts',
    });
    const narrow = generate({
      spec: spec({
        description: 'Implement one focused runtime policy update.',
        targetFiles: ['src/runtime/policy.ts'],
      }),
      artifactPath: 'workflows/generated/narrow-runtime.ts',
    });

    expect(broad.masterExecutionPlan?.children.length).toBeGreaterThanOrEqual(4);
    expect(broad.masterExecutionPlan?.children.map((child) => child.workflowFilePath)).toEqual(
      expect.arrayContaining([
        'workflows/generated/broad-runtime-children/01-update-nested-runner.ts',
        'workflows/generated/broad-runtime-children/02-update-policy.ts',
        'workflows/generated/broad-runtime-children/03-update-telemetry.ts',
        'workflows/generated/broad-runtime-children/04-update-evals.ts',
      ]),
    );
    expect(narrow.masterExecutionPlan).toBeUndefined();
    expect(artifact(narrow).content).not.toContain('RICKY_MASTER_EXECUTOR_WORKFLOW');
  });

  // Regression: at the old `targetFiles.length >= 4` threshold, every
  // medium-sized implementation spec (5–8 declared files) was routed
  // unconditionally through the canned master template — even when the
  // spec text never asked to be decomposed into child workflows. The
  // canned template's lead-plan step (previously an LLM agent step)
  // failed at runtime when headless claude couldn't spawn, blocking
  // `materialize-child-workflows` and leaving zero salvageable impl
  // on disk. Specs with no explicit decomposition vocabulary and a
  // file count below the conservative threshold must route through
  // the LLM writer path (handled by `renderWorkflow` + persona writer)
  // so the writer can author a single coherent workflow.
  it('leaves medium specs (no explicit master vocab, fewer than 12 files) on the regular renderer', () => {
    const medium = generate({
      spec: spec({
        description: 'Implement the cli-login flow: callback page, token-store endpoint, scope constants, and tests.',
        targetFiles: [
          'app/cli/callback/page.tsx',
          'app/api/cli/auth/store-token/route.ts',
          'lib/auth/scopes.ts',
          'lib/auth/api-token-store.ts',
          'lib/auth/request-auth.ts',
          'lib/auth/request-auth.test.ts',
        ],
      }),
      artifactPath: 'workflows/generated/cli-login.ts',
    });

    expect(medium.masterExecutionPlan).toBeUndefined();
    expect(artifact(medium).content).not.toContain('RICKY_MASTER_EXECUTOR_WORKFLOW');
  });

  it('keeps large single-PR worktree specs on the regular renderer instead of file-count master fallback', () => {
    const singlePr = generate({
      spec: spec({
        description: [
          'Implement PR 11 hardening, quotas, audit, docs, demo.',
          'Outcome: exactly one pull request in cloud opened against origin/main.',
          'Worktree: /private/tmp/cloud-mcp-cloud-spawn-hardening',
          'Target branch: chore/mcp-cloud-spawn-hardening',
          'The workflow must use createGitHubStep from @agent-relay/github-primitive.',
        ].join('\n'),
        targetFiles: [
          'specs/mcp-cloud-spawn-and-slack-bridge.md',
          '/private/tmp/cloud-mcp-cloud-spawn-hardening',
          '/Users/khaliqgant/Projects/AgentWorkforce/cloud',
          '/api/v1/*',
          '/Users/khaliqgant/Projects/AgentWorkforce/relaycast',
          '/Users/khaliqgant/Projects/AgentWorkforce/relay',
          '/Users/khaliqgant/Projects/AgentWorkforce/relayfile',
          'packages/web/drizzle/meta/_journal.json',
          'packages/web/lib/integrations/nango-service.ts',
          'dev-stack/README.md',
          '/api/v1/auth/cli-login/*',
          'packages/web/lib/boot/resource-check.ts',
          '.relay/conflicts/',
          '.relay/conflicts/<path>.<ts>',
          'cloud/dev-stack/',
        ],
      }),
      artifactPath: 'workflows/generated/pr-11-hardening.ts',
    });

    expect(singlePr.masterExecutionPlan).toBeUndefined();
    expect(artifact(singlePr).content).not.toContain('RICKY_MASTER_EXECUTOR_WORKFLOW');
  });

  it('honors explicit single-workflow constraints before file-count master fallback', () => {
    const result = generate({
      spec: spec({
        description: [
          'Implement cloud issue 311 per-service deploy workflows with a single local workflow and static validation only.',
          'Generate a single local implementation workflow.',
          'Do not decompose this into child workflows.',
          'Do not materialize child workflow files.',
          'Do not invoke ricky run recursively.',
          'Do not require an Agent Relay broker for implementation.',
        ].join('\n'),
        constraints: [
          'Do not generate child workflows.',
          'Use only listed validation commands and no generic root gates.',
        ],
        targetFiles: [
          '.github/workflows/deploy-sage.yml',
          '.github/workflows/deploy-relayauth.yml',
          '.github/workflows/deploy-relayfile.yml',
          '.github/workflows/deploy-sage-production-worker.yml',
          '.github/workflows/_deploy-cloud-stage.yml',
          '.github/actions/run-cloudflare-d1-migrations/action.yml',
          '.github/actions/run-cloudflare-d1-migrations/run.sh',
          '.github/workflows/bump-sage-worker.yml',
          'infra/sage.ts',
          'infra/relayauth.ts',
          'infra/relayfile.ts',
          'README.md',
          'docs/deploy.md',
        ],
        acceptanceGates: [
          'git diff --check',
          'bash -n .github/actions/run-cloudflare-d1-migrations/run.sh',
          'actionlint .github/workflows/deploy-sage.yml .github/workflows/deploy-relayauth.yml .github/workflows/deploy-relayfile.yml',
          "ruby -e \"require 'yaml'; YAML.load_file('.github/workflows/deploy-sage.yml')\"",
        ],
      }),
      artifactPath: 'workflows/generated/cloud-issue-311.ts',
    });

    expect(result.success).toBe(true);
    expect(result.masterExecutionPlan).toBeUndefined();
    const rendered = artifact(result);
    expect(rendered.content).not.toContain('RICKY_MASTER_EXECUTOR_WORKFLOW');
    expect(rendered.content).not.toContain('Master plan:');
    expect(rendered.content).not.toContain("ricky run 'workflows/generated");

    for (const gateName of ['initial-soft-validation', 'post-fix-validation', 'post-codex-fix-validation', 'final-hard-validation']) {
      const command = gate(rendered, gateName).command;
      expect(command).toContain('git diff --check');
      expect(command).toContain('bash -n .github/actions/run-cloudflare-d1-migrations/run.sh');
      expect(command).toContain('actionlint .github/workflows/deploy-sage.yml');
      expect(command).toContain("ruby -e \"require 'yaml'; YAML.load_file('.github/workflows/deploy-sage.yml')\"");
      expect(command).not.toContain('npx tsc --noEmit');
      expect(command).not.toContain('npx vitest run');
    }

    expect(gate(rendered, 'regression-gate').command).toBe('git diff --check');
  });

  it('ignores inert fenced worktree labels when deciding single-PR master fallback routing', () => {
    const fencedLabelsOnly = generate({
      spec: spec({
        description: [
          'Implement PR 11 hardening, quotas, audit, docs, demo.',
          'Outcome: exactly one pull request in cloud opened against origin/main.',
          'The following historical example is not the requested worktree contract:',
          '```md',
          'Worktree: /private/tmp/cloud-mcp-cloud-spawn-hardening',
          'Target branch: chore/mcp-cloud-spawn-hardening',
          '```',
          'The workflow must use createGitHubStep from @agent-relay/github-primitive.',
        ].join('\n'),
        targetFiles: [
          'specs/mcp-cloud-spawn-and-slack-bridge.md',
          '/private/tmp/cloud-mcp-cloud-spawn-hardening',
          '/Users/khaliqgant/Projects/AgentWorkforce/cloud',
          '/api/v1/*',
          '/Users/khaliqgant/Projects/AgentWorkforce/relaycast',
          '/Users/khaliqgant/Projects/AgentWorkforce/relay',
          '/Users/khaliqgant/Projects/AgentWorkforce/relayfile',
          'packages/web/drizzle/meta/_journal.json',
          'packages/web/lib/integrations/nango-service.ts',
          'dev-stack/README.md',
          '/api/v1/auth/cli-login/*',
          'packages/web/lib/boot/resource-check.ts',
          '.relay/conflicts/',
          '.relay/conflicts/<path>.<ts>',
          'cloud/dev-stack/',
        ],
      }),
      artifactPath: 'workflows/generated/pr-11-hardening.ts',
    });

    expect(fencedLabelsOnly.masterExecutionPlan).toBeDefined();
    expect(artifact(fencedLabelsOnly).content).toContain('RICKY_MASTER_EXECUTOR_WORKFLOW');
  });

  it('turns a code-writing spec into an implementation team workflow with 80-to-100 validation', () => {
    const result = generate({
      spec: spec({
        description: 'Implement a TypeScript API endpoint with parallel independent file slices and deterministic proof.',
        targetFiles: [
          'src/cloud/api/generate-endpoint.ts',
          'src/cloud/api/proof/cloud-generate-proof.test.ts',
          'src/product/generation/pipeline.test.ts',
        ],
        constraints: ['Must use parallel implementation where files are independent.'],
        evidenceRequirements: ['Record deterministic proof for typecheck and tests.'],
        acceptanceGates: ['npx tsc --noEmit', 'npx vitest run src/cloud/api/proof/cloud-generate-proof.test.ts'],
      }),
      artifactPath: 'workflows/generated/code-generation.ts',
    });

    expect(result.success).toBe(true);
    expect(result.artifact).not.toBeNull();
    const artifact = result.artifact!;

    expect(result.patternDecision).toMatchObject({
      pattern: 'dag',
      riskLevel: 'high',
      overrideUsed: false,
    });
    expect(result.patternDecision.specSignals).toContain('choosing-swarm-patterns skill loaded');
    expect(result.patternDecision.reason).toMatch(/parallel implementation, review, and validation gates/i);
    expect(result.patternDecision.reason).toMatch(/choosing-swarm-patterns/i);
    expect(result.executionRoute).toMatchObject({
      artifactDelivery: 'write_local_file',
      resolvedTarget: 'local',
      runnerCommand: 'npx agent-relay run --dry-run workflows/generated/code-generation.ts',
    });
    expect(artifact).toMatchObject({
      artifactPath: 'workflows/generated/code-generation.ts',
      pattern: 'dag',
      channel: expect.stringMatching(/^wf-ricky-/),
    });
    expect(artifact.tasks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'lead-plan', agentRole: 'lead-claude' }),
        expect.objectContaining({ id: 'implement-artifact', agentRole: 'impl-primary-codex' }),
        expect.objectContaining({ id: 'review-claude', agentRole: 'reviewer-claude', dependsOn: ['initial-soft-validation'] }),
        expect.objectContaining({ id: 'fix-loop', agentRole: 'validator-claude', dependsOn: ['review-claude', 'initial-soft-validation'] }),
        expect.objectContaining({ id: 'final-review-claude', agentRole: 'reviewer-claude', dependsOn: ['post-fix-validation'] }),
        expect.objectContaining({ id: 'final-fix-claude', agentRole: 'validator-claude', dependsOn: ['final-review-claude'] }),
        expect.objectContaining({ id: 'review-codex', agentRole: 'reviewer-codex', dependsOn: ['final-fix-claude'] }),
        expect.objectContaining({ id: 'fix-loop-codex', agentRole: 'validator-codex', dependsOn: ['review-codex'] }),
        expect.objectContaining({ id: 'final-review-codex', agentRole: 'reviewer-codex', dependsOn: ['post-codex-fix-validation'] }),
        expect.objectContaining({ id: 'final-fix-codex', agentRole: 'validator-codex', dependsOn: ['final-review-codex'] }),
        expect.objectContaining({ id: 'final-signoff', dependsOn: ['regression-gate'] }),
      ]),
    );
    expect(artifact.content).toContain('.agent("lead-claude", { cli: "claude", interactive: false');
    expect(artifact.content).toContain('.agent("impl-primary-codex"');
    expect(artifact.content).toContain('.agent("impl-tests-codex"');
    expect(artifact.content).toContain('.agent("validator-claude"');
    expect(artifact.content).toContain('.agent("validator-codex"');
    expect(artifact.content).toContain(".onError('retry', { maxRetries: 2, retryDelayMs: 10000, repairAgent: \"validator-claude\", repairRetries: 2 })");
    expect(artifact.content).not.toMatch(/^\s*\.onError\('fail-fast'\)/m);
    expect(artifact.content).toContain('80-to-100 review-fix loop');
    expect(artifact.content).toContain('deterministic sanity gate using POSIX grep, git grep, or an equivalent assertion');
    expect(artifact.content).toContain('If using rg, guard it with command -v rg');
    expect(artifact.content).toContain('Generated workflow quality');
    expect(artifact.content).toContain('Keep each agent step bounded to one coherent slice');
    expect(result.toolSelection.selections).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          stepId: 'implement-artifact',
          agent: 'impl-primary-codex',
          concurrency: 2,
        }),
        expect.objectContaining({
          stepId: 'fix-loop',
          agent: 'validator-claude',
          concurrency: 1,
        }),
      ]),
    );
    expect(gate(artifact, 'initial-soft-validation')).toMatchObject({
      stage: 'pre_review',
      failOnError: false,
      dependsOn: ['post-implementation-file-gate'],
    });
    expect(gate(artifact, 'post-fix-validation')).toMatchObject({
      stage: 'post_fix',
      failOnError: false,
      dependsOn: ['active-reference-gate'],
    });
    expect(gate(artifact, 'active-reference-gate')).toMatchObject({
      stage: 'post_fix',
      failOnError: true,
      dependsOn: ['post-fix-verification-gate'],
    });
    expect(gate(artifact, 'final-review-pass-gate')).toMatchObject({
      stage: 'final',
      failOnError: true,
      dependsOn: ['final-fix-codex'],
    });
    expect(result.validation).toMatchObject({
      valid: true,
      hasReviewStage: true,
      hasDeterministicGates: true,
    });
    expect(result.deterministicValidationCommands).toEqual(
      expect.arrayContaining([
        expect.stringContaining('npx tsc --noEmit'),
        expect.stringContaining('npx vitest run src/cloud/api/proof/cloud-generate-proof.test.ts'),
        expect.stringContaining("'diff', '--name-status'"),
      ]),
    );
    expect(result.validation.issues).toEqual([]);
    expect(artifact.content).toMatch(/80-to-100 review-fix loop/i);
    expect(artifact.content).toContain('final-review');
  });

  it('proves required generation skills are loaded and applied only during generation', () => {
    const result = generate({
      spec: spec({
        description: 'Implement strict TypeScript workflow proof with deterministic tests and 80-to-100 validation.',
        targetFiles: ['src/product/generation/template-renderer.ts', 'src/product/generation/pipeline.test.ts'],
        acceptanceGates: ['npx vitest run packages/product/src/generation/pipeline.test.ts'],
      }),
      artifactPath: 'workflows/generated/skill-boundary.ts',
    });

    expect(result.success).toBe(true);
    const artifact = result.artifact!;

    expect(result.skillContext.applicableSkillNames).toEqual(
      expect.arrayContaining(['choosing-swarm-patterns', 'writing-agent-relay-workflows', 'relay-80-100-workflow', 'review-fix-signoff-loop']),
    );
    expect(result.skillContext.applicationEvidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          skillName: 'choosing-swarm-patterns',
          stage: 'generation_selection',
          behavior: 'generation_time_only',
          runtimeEmbodiment: false,
        }),
        expect.objectContaining({
          skillName: 'choosing-swarm-patterns',
          stage: 'generation_loading',
          effect: 'metadata',
          behavior: 'generation_time_only',
          runtimeEmbodiment: false,
        }),
        expect.objectContaining({
          skillName: 'writing-agent-relay-workflows',
          stage: 'generation_selection',
          behavior: 'generation_time_only',
          runtimeEmbodiment: false,
        }),
        expect.objectContaining({
          skillName: 'writing-agent-relay-workflows',
          stage: 'generation_loading',
          effect: 'metadata',
          behavior: 'generation_time_only',
          runtimeEmbodiment: false,
        }),
        expect.objectContaining({
          skillName: 'relay-80-100-workflow',
          stage: 'generation_selection',
          behavior: 'generation_time_only',
          runtimeEmbodiment: false,
        }),
        expect.objectContaining({
          skillName: 'relay-80-100-workflow',
          stage: 'generation_loading',
          effect: 'metadata',
          behavior: 'generation_time_only',
          runtimeEmbodiment: false,
        }),
      ]),
    );
    expect(artifact.skillApplicationEvidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          skillName: 'choosing-swarm-patterns',
          stage: 'generation_rendering',
          effect: 'pattern_selection',
          behavior: 'generation_time_only',
          runtimeEmbodiment: false,
          evidence: expect.stringContaining('coordination shape'),
        }),
        expect.objectContaining({
          skillName: 'writing-agent-relay-workflows',
          stage: 'generation_rendering',
          effect: 'workflow_contract',
          behavior: 'generation_time_only',
          runtimeEmbodiment: false,
          evidence: expect.stringContaining('dedicated channel'),
        }),
        expect.objectContaining({
          skillName: 'relay-80-100-workflow',
          stage: 'generation_rendering',
          effect: 'validation_gates',
          behavior: 'generation_time_only',
          runtimeEmbodiment: false,
          evidence: expect.stringContaining('deterministic gates'),
        }),
        expect.objectContaining({
          skillName: 'review-fix-signoff-loop',
          stage: 'generation_rendering',
          effect: 'workflow_contract',
          behavior: 'generation_time_only',
          runtimeEmbodiment: false,
          evidence: expect.stringContaining('review-fix-signoff loop'),
        }),
      ]),
    );
    expect(artifact.content).toContain('loaded-skills.txt');
    expect(artifact.content).toContain('skill-application-boundary.json');
    expect(artifact.content).toContain('choosing-swarm-patterns');
    expect(artifact.content).toContain('writing-agent-relay-workflows');
    expect(artifact.content).toContain('relay-80-100-workflow');
    expect(artifact.content).toContain('review-fix-signoff-loop');
    expect(artifact.content).toContain('generation_time_only');
    expect(artifact.content).toContain('runtimeEmbodiment');
    expect(artifact.content).toContain('Skills are applied by Ricky during selection, loading, and template rendering.');
    expect(artifact.content).toContain('Do not claim generated agents load, retain, or embody skill files at runtime');
    const skillBoundaryGate = artifact.gates.find((gate) => gate.name === 'skill-boundary-metadata-gate')!;
    expect(skillBoundaryGate.command).toContain('choosing-swarm-patterns');
    expect(skillBoundaryGate.command).toContain('writing-agent-relay-workflows');
    expect(skillBoundaryGate.command).toContain('relay-80-100-workflow');
    expect(skillBoundaryGate.command).toContain('review-fix-signoff-loop');
    expect(skillBoundaryGate.command).toContain('"stage":"generation_selection"');
    expect(skillBoundaryGate.command).toContain('"stage":"generation_loading"');
    expect(skillBoundaryGate.command).toContain('"stage":"generation_rendering"');
    expect(skillBoundaryGate.command).toContain('"effect":"pattern_selection"');
    expect(skillBoundaryGate.command).toContain('"effect":"workflow_contract"');
    expect(skillBoundaryGate.command).toContain('"effect":"validation_gates"');
    expect(artifact.gates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'skill-boundary-metadata-gate',
          command: expect.stringContaining('skill-application-boundary.json'),
          failOnError: true,
          stage: 'pre_review',
        }),
      ]),
    );
  });

  it('accepts a natural doc/spec request and selects a lighter workflow with deterministic review gates', () => {
    const payload: RawSpecPayload = {
      kind: 'natural_language',
      surface: 'cli',
      receivedAt: RECEIVED_AT,
      requestId: 'doc-spec-request',
      text: [
        'Create a workflow spec document for release readiness.',
        'Only modify docs/release-readiness.md.',
        'Acceptance: reviewer signoff is recorded.',
      ].join('\n'),
    };
    const intakeResult = intake(payload);
    const normalizedSpec = intakeResult.routing?.normalizedSpec;

    expect(intakeResult.success).toBe(true);
    expect(intakeResult.routing?.target).toBe('generate');
    expect(normalizedSpec?.intent).toBe('generate');
    expect(normalizedSpec?.desiredAction.kind).toBe('generate');
    expect(normalizedSpec?.desiredAction.workflowFileHint).toBeUndefined();
    expect(normalizedSpec?.desiredAction.specText).toContain('workflow spec document');
    expect(normalizedSpec?.targetFiles).toEqual(['docs/release-readiness.md']);

    const result = generate({
      spec: normalizedSpec!,
      artifactPath: 'workflows/generated/doc-spec.ts',
    });

    expect(result.success).toBe(true);
    expect(result.validation).toMatchObject({
      valid: true,
      errors: [],
      issues: [],
      hasReviewStage: true,
      hasDeterministicGates: true,
    });
    expect(result.artifact).not.toBeNull();
    const artifact = result.artifact!;

    expect(result.executionRoute).toMatchObject({
      invocationSurface: 'cli',
      artifactDelivery: 'write_local_file',
      runnerCommand: 'npx agent-relay run --dry-run workflows/generated/doc-spec.ts',
    });
    expect(result.patternDecision).toMatchObject({
      pattern: 'supervisor',
      riskLevel: 'medium',
    });
    expect(result.patternDecision.specSignals).toContain('choosing-swarm-patterns skill loaded');
    expect(result.patternDecision.reason).toMatch(/choosing-swarm-patterns/i);
    expect(artifact.tasks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'lead-plan', agentRole: 'lead-codex' }),
        expect.objectContaining({ id: 'implement-artifact', agentRole: 'author-codex' }),
        expect.objectContaining({ id: 'review-claude', agentRole: 'reviewer-claude', dependsOn: ['initial-soft-validation'] }),
        expect.objectContaining({ id: 'fix-loop', agentRole: 'validator-claude', dependsOn: ['review-claude', 'initial-soft-validation'] }),
        expect.objectContaining({ id: 'final-fix-claude', agentRole: 'validator-claude', dependsOn: ['final-review-claude'] }),
        expect.objectContaining({ id: 'review-codex', agentRole: 'reviewer-codex', dependsOn: ['final-fix-claude'] }),
        expect.objectContaining({ id: 'final-fix-codex', agentRole: 'validator-codex', dependsOn: ['final-review-codex'] }),
      ]),
    );
    expect(artifact.content).toContain('.agent("lead-codex", { cli: "codex", interactive: false');
    expect(artifact.content).toContain('.agent("reviewer-codex", { cli: "codex", preset: "reviewer"');
    expect(artifact.content).toContain('.agent("reviewer-claude", { cli: "claude", preset: "reviewer"');
    expect(artifact.content).toContain('.agent("validator-codex", { cli: "codex", preset: "worker"');
    expect(artifact.content).toContain('.agent("validator-claude", { cli: "claude", preset: "worker"');
    expect(artifact.content).toContain('.agent("author-codex"');
    expect(artifact.content).not.toContain('.agent("impl-primary-codex"');
    expect(artifact.content).toContain(".onError('retry', { maxRetries: 2, retryDelayMs: 10000, repairAgent: \"validator-codex\", repairRetries: 2 })");
    expect(artifact.content).not.toMatch(/^\s*\.onError\('fail-fast'\)/m);
    expect(artifact.content).toContain('verdict: FINDINGS | NO_ISSUES_FOUND | BLOCKED');
    expect(artifact.content).toContain('review-codex.md');
    expect(artifact.content).toContain('docs/release-readiness.md');
    expect(result.toolSelection.selections).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          stepId: 'implement-artifact',
          agent: 'author-codex',
          concurrency: 1,
        }),
        expect.objectContaining({
          stepId: 'review-claude',
          agent: 'reviewer-claude',
          concurrency: 1,
        }),
      ]),
    );
    expect(result.toolSelection.selections).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          stepId: 'review-codex',
          agent: 'reviewer-codex',
        }),
      ]),
    );
    expect(artifact.gates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'initial-soft-validation',
          failOnError: false,
          stage: 'pre_review',
        }),
        expect.objectContaining({
          name: 'final-review-pass-gate',
          failOnError: true,
          stage: 'final',
        }),
        expect.objectContaining({
          name: 'final-hard-validation',
          failOnError: true,
          stage: 'final',
        }),
      ]),
    );
  });

  it('reports a missing optional skill as a structured validation issue without crashing', () => {
    const result = generate({
      spec: spec({
        description: 'Draft a workflow plan for docs handoff.',
        targetFiles: ['docs/generated-handoff.md'],
      }),
      skillOverrides: ['missing-optional-skill'],
      artifactPath: 'workflows/generated/missing-skill.ts',
    });

    expect(result.success).toBe(true);
    expect(result.skillContext.skills).toEqual([
      expect.objectContaining({
        name: 'missing-optional-skill',
        loaded: false,
        applicable: true,
        prerequisitesMet: false,
      }),
    ]);
    expect(result.skillContext.loadWarnings).toEqual([
      expect.stringContaining('missing-optional-skill'),
    ]);
    expect(result.skillContext.applicableSkillNames).not.toContain('missing-optional-skill');
    expect(result.validation.issues).toEqual([
      expect.objectContaining({
        severity: 'warning',
        stage: 'skill_loading',
        code: 'SKILL_UNKNOWN',
        field: 'skillOverrides',
        blocking: false,
        message: expect.stringContaining('missing-optional-skill'),
      }),
    ]);
    expect(result.validation.errors).toEqual([]);
  });

  it('uses the explicit artifact path basename for workflow identity', () => {
    const result = generate({
      spec: spec({
        description: 'Goal: I want to clean up the codebase to remove outdated and unused files.',
      }),
      artifactPath: 'workflows/generated/repo-tidying.ts',
    });

    expect(result.artifact).toMatchObject({
      artifactPath: 'workflows/generated/repo-tidying.ts',
      workflowId: 'ricky-repo-tidying',
      channel: 'wf-ricky-repo-tidying',
    });
  });

  it('renders the required workflow structure and deterministic gates', () => {
    const result = generate({
      spec: spec({
        description: 'Implement workflow generation tests with deterministic validation.',
        targetFiles: ['src/product/generation/pipeline.test.ts'],
        acceptanceGates: ['npx vitest run src/product/generation/pipeline.test.ts'],
      }),
      artifactPath: 'workflows/generated/pipeline-tests.ts',
    });

    expect(result.success).toBe(true);
    expect(result.artifact).not.toBeNull();
    const artifact = result.artifact!;

    expect(result.validation).toMatchObject({
      valid: true,
      errors: [],
      issues: [],
      hasReviewStage: true,
      hasDeterministicGates: true,
    });
    expect(artifact).toMatchObject({
      workflowId: expect.stringMatching(/^ricky-/),
      channel: expect.stringMatching(/^wf-ricky-/),
    });
    expect(artifact.channel).not.toBe('general');
    expect(artifact.content).toMatch(/\bworkflow\(/);
    expect(artifact.content).toContain(`.channel("${artifact.channel}")`);
    expect(artifact.content).toContain('RICKY_WORKFLOW_ENV_LOADER');
    expect(artifact.content).toContain('loadRickyWorkflowEnv();');
    expect(artifact.content).toContain("['.env.local', '.env']");
    expect(artifact.content).toContain('.run({ cwd: process.cwd() })');
    expect(artifact.content).toContain('.step("lead-plan-gate"');
    expect(artifact.content).toContain('.step("fix-loop-report-gate"');
    expect(artifact.content).toContain('review-claude');
    expect(artifact.content).toContain('review-codex');
    expect(gate(artifact, 'initial-soft-validation')).toMatchObject({
      failOnError: false,
      stage: 'pre_review',
      verificationType: 'exit_code',
    });
    expect(gate(artifact, 'final-hard-validation')).toMatchObject({
      failOnError: true,
      stage: 'final',
      verificationType: 'deterministic_gate',
      dependsOn: ['final-review-pass-gate'],
    });
    expect(gate(artifact, 'git-diff-gate')).toMatchObject({
      command: expect.stringContaining("'diff', '--name-status'"),
      failOnError: true,
      stage: 'final',
      dependsOn: ['final-hard-validation'],
    });
    expect(gate(artifact, 'git-diff-gate').command).toContain("'ls-files', '--others', '--exclude-standard'");
    expect(gate(artifact, 'git-diff-gate').command).toContain('git ls-files --others --exclude-standard');
    expect(result.validation.issues).toEqual([]);
  });

  it('requires the mandatory Claude-then-Codex fresh-eyes review/fix loop', () => {
    const loopSpec = spec({
      description: 'Implement one helper change and add a focused Vitest unit test.',
      targetFiles: ['src/product/generation/template-renderer.ts', 'src/product/generation/pipeline.test.ts'],
      acceptanceGates: ['npx vitest run src/product/generation/pipeline.test.ts'],
    });
    const result = generate({
      spec: loopSpec,
      artifactPath: 'workflows/generated/fresh-eyes-loop.ts',
    });
    const base = artifact(result);

    const loopOrder = [
      '.step("review-claude"',
      '.step("fix-loop"',
      '.step("final-review-claude"',
      '.step("final-fix-claude"',
      '.step("review-codex"',
      '.step("fix-loop-codex"',
      '.step("final-review-codex"',
      '.step("final-fix-codex"',
      '.step("final-review-pass-gate"',
      '.step("final-hard-validation"',
    ].map((needle) => base.content.indexOf(needle));
    expect(loopOrder.every((index) => index >= 0)).toBe(true);
    expect(loopOrder.every((index, position) => position === 0 || index > loopOrder[position - 1])).toBe(true);
    expect(base.content).toContain('verdict: FINDINGS | NO_ISSUES_FOUND | BLOCKED');
    expect(base.content).toContain('add or update appropriate tests, fixtures, assertions, or deterministic proofs');
    expect(gate(base, 'post-codex-fix-validation')).toMatchObject({
      dependsOn: ['codex-fix-loop-report-gate'],
      failOnError: false,
      stage: 'post_fix',
    });
    expect(gate(base, 'final-review-pass-gate')).toMatchObject({
      dependsOn: ['final-fix-codex'],
      stage: 'final',
    });

    const oldParallelShape = {
      ...base,
      tasks: base.tasks.map((task) =>
        task.id === 'review-codex'
          ? { ...task, dependsOn: ['initial-soft-validation'] }
          : task.id === 'final-review-codex'
            ? { ...task, dependsOn: ['post-fix-validation'] }
            : task,
      ),
      gates: base.gates.map((candidate) =>
        candidate.name === 'final-review-pass-gate'
          ? { ...candidate, dependsOn: ['final-review-claude', 'final-review-codex'] }
          : candidate,
      ),
    };
    const validation = validateGeneratedArtifact(oldParallelShape, result.patternDecision, result.skillContext, loopSpec);

    expect(validation.valid).toBe(false);
    expect(validation.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'MANDATORY_FRESH_EYES_LOOP_MISSING' }),
      ]),
    );
  });

  it('requires the runtime run call itself to pass explicit cwd, ignoring embedded examples', () => {
    const result = generate({
      spec: spec({
        description: 'Implement workflow generation tests with deterministic validation.',
        targetFiles: ['src/product/generation/pipeline.test.ts'],
        acceptanceGates: ['npx vitest run src/product/generation/pipeline.test.ts'],
      }),
      artifactPath: 'workflows/generated/pipeline-cwd.ts',
    });
    const baseArtifact = artifact(result);
    const weakArtifact = {
      ...baseArtifact,
      content: replaceLast(baseArtifact.content, '.run({ cwd: process.cwd() });', '.run();'),
    };

    const validation = validateGeneratedArtifact(weakArtifact, result.patternDecision, result.skillContext);

    expect(validation.valid).toBe(false);
    expect(validation.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'RUN_CWD_MISSING' }),
      ]),
    );
  });

  it('marks implementation workflows with source-change and result evidence contracts', () => {
    const result = generate({
      spec: spec({
        description: 'Implement durable backend review orchestration with tests and a pull request.',
        targetFiles: ['packages/backend/src/services/deep-review-orchestrator.ts'],
        acceptanceGates: ['npx vitest run packages/backend/src/services/deep-review-orchestrator.test.ts'],
      }),
      artifactPath: 'workflows/generated/deep-review-orchestration.ts',
    });

    expect(result.success).toBe(true);
    const content = artifact(result).content;
    expect(content).toContain('IMPLEMENTATION_WORKFLOW_CONTRACT');
    expect(content).toMatch(/source changes|code changes/i);
    expect(content).toMatch(/non-empty diff/i);
    expect(content).toMatch(/PR URL|pull request/i);
  });

  it('rejects planning-only artifacts for implementation specs', () => {
    const implementationSpec = spec({
      description: [
        'Implement webapp-triggered deep reviews with backend services, runtime election, Slack and Telegram retriggers, GitHub writeback, tests, and a pull request.',
        'The workflow must update backend and webapp source files.',
      ].join(' '),
      targetFiles: ['packages/backend/src/routes/review-workspace.ts'],
    });
    const result = generate({
      spec: implementationSpec,
      artifactPath: 'workflows/generated/webapp-review.ts',
    });

    const weakArtifact = {
      ...artifact(result),
      content: [
        "import { workflow } from '@agent-relay/sdk/workflows';",
        'async function main() {',
        '  const result = await workflow("ricky-webapp-review")',
        '    .description("Scaffold a model-agnostic deep-review relay workflow plan.")',
        '    .pattern("dag")',
        '    .channel("wf-ricky-webapp-review")',
        '    .agent("reviewer", { cli: "claude", role: "review stage" })',
        '    .step("prepare-context", { type: "deterministic", command: "echo skill-application-boundary.json generation_time_only runtimeEmbodiment", captureOutput: true, failOnError: true })',
        '    .step("plan-minimal", { agent: "reviewer", task: "Write the plan to plan.md and create mapping.json for the orchestration plan." })',
        '    .step("post-implementation-file-gate", { type: "deterministic", command: "test -f plan.md && grep -Eq \'ReviewReadinessResult\' plan.md", captureOutput: true, failOnError: true })',
        '    .step("fix-loop", { agent: "reviewer", task: "fix-loop" })',
        '    .step("final-review", { agent: "reviewer", task: "final-review" })',
        '    .step("final-hard-validation", { type: "deterministic", command: "npx tsc --noEmit && npm test", captureOutput: true, failOnError: true })',
        '    .step("git-diff-gate", { type: "deterministic", command: "git diff --name-only > git-diff.txt", captureOutput: true, failOnError: true })',
        '    .run({ cwd: process.cwd() });',
        '  console.log(result.status);',
        '}',
        'main().catch((error) => { console.error(error); process.exit(1); });',
      ].join('\n'),
    };

    const validation = validateGeneratedArtifact(weakArtifact, result.patternDecision, result.skillContext, implementationSpec);

    expect(validation.valid).toBe(false);
    expect(validation.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'IMPLEMENTATION_CONTRACT_MISSING' }),
        expect.objectContaining({ code: 'SOURCE_CHANGE_CONTRACT_MISSING' }),
        expect.objectContaining({ code: 'RESULT_PR_REPORTING_MISSING' }),
        expect.objectContaining({ code: 'PLANNING_ONLY_WORKFLOW_FOR_IMPLEMENTATION' }),
      ]),
    );
  });

  it('treats write-a-plan-then-implement requests as implementation workflows', () => {
    const implementationSpec = spec({
      description: [
        'Write a plan, then implement webapp-triggered deep reviews with backend services, runtime election, tests, and result evidence.',
        'The workflow must update backend source files.',
      ].join(' '),
      targetFiles: ['packages/backend/src/services/deep-review-orchestrator.ts'],
    });
    const result = generate({
      spec: implementationSpec,
      artifactPath: 'workflows/generated/mixed-plan-implement.ts',
    });

    const weakArtifact = {
      ...artifact(result),
      content: [
        "import { workflow } from '@agent-relay/sdk/workflows';",
        'async function main() {',
        '  const result = await workflow("ricky-mixed")',
        '    .description("Write a plan for the implementation.")',
        '    .pattern("dag")',
        '    .channel("wf-ricky-mixed")',
        '    .agent("reviewer", { cli: "claude", role: "review stage" })',
        '    .step("prepare-context", { type: "deterministic", command: "echo skill-application-boundary.json generation_time_only runtimeEmbodiment", captureOutput: true, failOnError: true })',
        '    .step("plan-minimal", { agent: "reviewer", task: "Write the plan to plan.md and create mapping.json." })',
        '    .step("post-implementation-file-gate", { type: "deterministic", command: "test -f plan.md && grep -Eq \'ReviewReadinessResult\' plan.md", captureOutput: true, failOnError: true })',
        '    .step("fix-loop", { agent: "reviewer", task: "fix-loop" })',
        '    .step("final-review", { agent: "reviewer", task: "final-review" })',
        '    .step("final-hard-validation", { type: "deterministic", command: "npx tsc --noEmit && npm test", captureOutput: true, failOnError: true })',
        '    .step("git-diff-gate", { type: "deterministic", command: "git diff --name-only > git-diff.txt", captureOutput: true, failOnError: true })',
        '    .run({ cwd: process.cwd() });',
        '  console.log(result.status);',
        '}',
        'main().catch((error) => { console.error(error); process.exit(1); });',
      ].join('\n'),
    };

    const validation = validateGeneratedArtifact(weakArtifact, result.patternDecision, result.skillContext, implementationSpec);

    expect(validation.valid).toBe(false);
    expect(validation.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'IMPLEMENTATION_CONTRACT_MISSING' }),
        expect.objectContaining({ code: 'PLANNING_ONLY_WORKFLOW_FOR_IMPLEMENTATION' }),
      ]),
    );
  });

  it('accepts explicit non-PR result status evidence for implementation workflows', () => {
    const implementationSpec = spec({
      description: 'Implement local-only workflow generation checks with tests and a result summary.',
      targetFiles: ['src/product/generation/pipeline.ts'],
    });
    const result = generate({
      spec: implementationSpec,
      artifactPath: 'workflows/generated/local-result-evidence.ts',
    });
    const content = artifact(result).content
      .replace(/PR\/result reporting/g, 'result reporting')
      .replace(/PR URL or /g, '')
      .replace(/pull request/g, 'result status')
      .replace(/Pull request/g, 'Result status');
    const validation = validateGeneratedArtifact(
      { ...artifact(result), content },
      result.patternDecision,
      result.skillContext,
      implementationSpec,
    );

    expect(validation.issues).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'RESULT_PR_REPORTING_MISSING' }),
      ]),
    );
  });

  it('rejects ripgrep gates without real fallback control flow because rg may be absent', () => {
    const implementationSpec = spec({
      description: 'Implement local workflow generation checks with resilient sanity validation.',
      targetFiles: ['src/product/generation/pipeline.ts'],
    });
    const result = generate({
      spec: implementationSpec,
      artifactPath: 'workflows/generated/resilient-sanity.ts',
    });
    const base = artifact(result);
    const gatesWithoutGrep = base.gates.map((gate) => ({
      ...gate,
      command: gate.command
        .replace(/\bgit\s+grep\b/g, 'printf')
        .replace(/\bgrep\b/g, 'printf'),
    }));
    const rgArtifact = {
      ...base,
      gates: gatesWithoutGrep.map((gate) => gate.name === 'post-implementation-file-gate'
        ? {
            ...gate,
            command: "command -v rg >/dev/null 2>&1 && rg -e 'export|function|class' src/product/generation/pipeline.ts && grep -Eq 'pipeline' README.md",
          }
        : gate),
    };

    const validation = validateGeneratedArtifact(
      rgArtifact,
      result.patternDecision,
      result.skillContext,
      implementationSpec,
    );

    expect(validation.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'RIPGREP_REQUIRES_FALLBACK' }),
      ]),
    );
  });

  it('accepts ripgrep sanity gates when they include a grep fallback', () => {
    const implementationSpec = spec({
      description: 'Implement local workflow generation checks with resilient sanity validation.',
      targetFiles: ['src/product/generation/pipeline.ts'],
    });
    const result = generate({
      spec: implementationSpec,
      artifactPath: 'workflows/generated/resilient-sanity.ts',
    });
    const base = artifact(result);
    const gatesWithoutGrep = base.gates.map((gate) => ({
      ...gate,
      command: gate.command
        .replace(/\bgit\s+grep\b/g, 'printf')
        .replace(/\bgrep\b/g, 'printf'),
    }));
    const rgArtifact = {
      ...base,
      gates: gatesWithoutGrep.map((gate) => gate.name === 'post-implementation-file-gate'
        ? {
            ...gate,
            command: "test -f src/product/generation/pipeline.ts && { if command -v rg >/dev/null 2>&1; then rg -e 'export|function|class' src/product/generation/pipeline.ts; else grep -Eq 'export|function|class' src/product/generation/pipeline.ts; fi; }",
          }
        : gate),
    };

    const validation = validateGeneratedArtifact(
      rgArtifact,
      result.patternDecision,
      result.skillContext,
      implementationSpec,
    );

    expect(validation.issues).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'RIPGREP_REQUIRES_FALLBACK' }),
      ]),
    );
    expect(validation.issues).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'GREP_GATE_MISSING' }),
      ]),
    );
  });

  it('requires inline runtime sanity gates to read evidence and fail on mismatch', () => {
    const implementationSpec = spec({
      description: 'Implement local workflow generation checks with inline sanity validation.',
      targetFiles: ['src/product/generation/pipeline.ts'],
    });
    const result = generate({
      spec: implementationSpec,
      artifactPath: 'workflows/generated/inline-sanity.ts',
    });
    const base = artifact(result);
    const gatesWithoutGrep = base.gates.map((gate) => ({
      ...gate,
      command: gate.command
        .replace(/\bgit\s+grep\b/g, 'printf')
        .replace(/\bgrep\b/g, 'printf'),
    }));
    const withPostImplementationCommand = (command: string) => ({
      ...base,
      gates: gatesWithoutGrep.map((gate) => gate.name === 'post-implementation-file-gate'
        ? { ...gate, command }
        : gate),
    });

    const noOpNodeValidation = validateGeneratedArtifact(
      withPostImplementationCommand('node -e "console.log(\'ok\')"'),
      result.patternDecision,
      result.skillContext,
      implementationSpec,
    );
    expect(noOpNodeValidation.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'GREP_GATE_MISSING' }),
      ]),
    );

    const assertingNodeValidation = validateGeneratedArtifact(
      withPostImplementationCommand(
        'node -e "const { readFileSync } = require(\'fs\'); if (!readFileSync(\'src/product/generation/pipeline.ts\', \'utf8\').includes(\'validateGeneratedArtifact\')) process.exit(1)"',
      ),
      result.patternDecision,
      result.skillContext,
      implementationSpec,
    );
    expect(assertingNodeValidation.issues).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'GREP_GATE_MISSING' }),
      ]),
    );
  });

  it('accepts ruby and perl inline assertions invoked with -e', () => {
    const implementationSpec = spec({
      description: 'Implement local workflow generation checks with ruby and perl sanity validation.',
      targetFiles: ['src/product/generation/pipeline.ts'],
    });
    const result = generate({
      spec: implementationSpec,
      artifactPath: 'workflows/generated/ruby-perl-sanity.ts',
    });
    const base = artifact(result);
    const gatesWithoutGrep = base.gates.map((gate) => ({
      ...gate,
      command: gate.command
        .replace(/\bgit\s+grep\b/g, 'printf')
        .replace(/\bgrep\b/g, 'printf'),
    }));
    const validations = [
      'ruby -e "raise unless File.read(\'src/product/generation/pipeline.ts\').include?(\'validateGeneratedArtifact\')"',
      'perl -e "open my $fh, \'<\', \'src/product/generation/pipeline.ts\' or die $!; local $/; my $s = <$fh>; die unless $s =~ /validateGeneratedArtifact/"',
    ].map((command) => validateGeneratedArtifact(
      {
        ...base,
        gates: gatesWithoutGrep.map((gate) => gate.name === 'post-implementation-file-gate'
          ? { ...gate, command }
          : gate),
      },
      result.patternDecision,
      result.skillContext,
      implementationSpec,
    ));

    for (const validation of validations) {
      expect(validation.issues).not.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: 'GREP_GATE_MISSING' }),
        ]),
      );
    }
  });

  it('does not count prose mentioning grep as a rendered sanity gate', () => {
    const implementationSpec = spec({
      description: 'Implement local workflow generation checks with strict gate validation.',
      targetFiles: ['src/product/generation/pipeline.ts'],
    });
    const result = generate({
      spec: implementationSpec,
      artifactPath: 'workflows/generated/missing-sanity.ts',
    });
    const base = artifact(result);
    const noSanityArtifact = {
      ...base,
      gates: base.gates.map((gate) => ({
        ...gate,
        command: gate.command
          .replace(/\bgit\s+grep\b/g, 'printf')
          .replace(/\bgrep\b/g, 'printf'),
      })),
    };

    expect(noSanityArtifact.content).toContain('deterministic sanity gate');
    const validation = validateGeneratedArtifact(
      noSanityArtifact,
      result.patternDecision,
      result.skillContext,
      implementationSpec,
    );

    expect(validation.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'GREP_GATE_MISSING' }),
      ]),
    );
  });

  it('returns dry-run and deterministic validation commands without executing agent-relay', () => {
    const result = generate({
      spec: spec({
        description: 'Implement workflow generation command evidence.',
        targetFiles: ['src/product/generation/pipeline.ts'],
        acceptanceGates: ['npx vitest run src/product/generation/pipeline.test.ts'],
      }),
      artifactPath: 'workflows/generated/command-evidence.ts',
    });

    expect(result.artifact).not.toBeNull();
    const renderedArtifact = result.artifact!;

    expect(result.dryRunCommand).toBe('npx agent-relay run --dry-run workflows/generated/command-evidence.ts');
    expect(renderedArtifact.content).not.toContain(result.dryRunCommand);
    expect(result.validation).toMatchObject({
      valid: true,
      errors: [],
      issues: [],
      hasDeterministicGates: true,
      hasReviewStage: true,
    });
    expect(result.executionRoute).toMatchObject({
      runnerCommand: result.dryRunCommand,
      artifactDelivery: 'write_local_file',
      resolvedTarget: 'local',
    });
    expect(result.plannedChecks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'dry-run',
          command: result.dryRunCommand,
          stage: 'dry_run',
          failOnError: true,
          verificationType: 'exit_code',
        }),
        expect.objectContaining({ name: 'final-hard-validation', command: expect.stringContaining('npx tsc --noEmit') }),
        expect.objectContaining({ name: 'regression-gate', command: 'npx vitest run' }),
      ]),
    );
    expect(result.plannedChecks.map((check) => check.name)).toEqual(
      expect.arrayContaining([
        'dry-run',
        'initial-soft-validation',
        'final-review-pass-gate',
        'final-hard-validation',
        'git-diff-gate',
      ]),
    );
    expect(result.plannedChecks.find((check) => check.name === 'dry-run')).toMatchObject({
      command: result.dryRunCommand,
      environmentalPrerequisite: expect.stringContaining('@agent-relay/cli'),
    });
    expect(result.deterministicValidationCommands).not.toContain(result.dryRunCommand);
    expect(result.deterministicValidationCommands).toEqual(
      expect.arrayContaining([
        expect.stringContaining('npx tsc --noEmit'),
        expect.stringContaining('npx vitest run'),
        expect.stringContaining("'diff', '--name-status'"),
      ]),
    );
    expect(result.deterministicValidationCommands).toEqual(
      expect.arrayContaining([
        expect.stringContaining("'ls-files', '--others', '--exclude-standard'"),
      ]),
    );
    expect(result.plannedChecks.map((check) => check.command)).toContain(result.dryRunCommand);
    expect(result.plannedChecks.find((check) => check.name === 'dry-run')?.stage).toBe('dry_run');
    expect(result.plannedChecks.find((check) => check.name === 'dry-run')?.command).toContain('--dry-run');
    expect(result.plannedChecks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: expect.any(String),
          command: expect.any(String),
          stage: expect.any(String),
          failOnError: expect.any(Boolean),
          verificationType: expect.any(String),
        }),
      ]),
    );
    expect(result.plannedChecks.every((check) => check.command.length > 0)).toBe(true);
  });

  it('final review output paths match the final-review-pass-gate check paths', () => {
    const result = generate({
      spec: spec({
        description: 'Implement path-consistency validation for review artifacts.',
        targetFiles: ['src/product/generation/template-renderer.ts'],
      }),
      artifactPath: 'workflows/generated/path-consistency.ts',
    });

    expect(result.success).toBe(true);
    const artifact = result.artifact!;
    const passGate = artifact.gates.find((g) => g.name === 'final-review-pass-gate')!;

    const claudePathMatch = artifact.content.match(/write\s+(\S+\/claude-final-fix\.md)/i);
    const codexPathMatch = artifact.content.match(/write\s+(\S+\/codex-final-fix\.md)/i);
    expect(claudePathMatch).not.toBeNull();
    expect(codexPathMatch).not.toBeNull();

    expect(passGate.command).toContain(claudePathMatch![1]);
    expect(passGate.command).toContain(codexPathMatch![1]);
    expect(passGate.command).toContain("tr -d '[:space:]*'");
  });

  it('no-target spec uses output manifest instead of artifact path in file gates', () => {
    const result = generate({
      spec: spec({
        description: 'Implement a code change without explicit target files.',
        targetFiles: [],
      }),
      artifactPath: 'workflows/generated/no-target.ts',
    });

    expect(result.success).toBe(true);
    const artifact = result.artifact!;
    const fileGate = artifact.gates.find((g) => g.name === 'post-implementation-file-gate')!;

    expect(fileGate.command).toContain('output-manifest.txt');
    expect(fileGate.command).not.toContain('workflows/generated/no-target.ts');
    expect(artifact.content).toContain('output-manifest.txt');
    expect(artifact.content).toContain('cleanup-candidate-prescan.txt');
    expect(artifact.content).toContain('cite that exact path in');
    expect(gate(artifact, 'final-artifact-consistency-gate')).toMatchObject({
      stage: 'final',
      failOnError: true,
      dependsOn: ['final-signoff'],
    });
    const consistencyGate = gate(artifact, 'final-artifact-consistency-gate');
    expect(consistencyGate.command).toContain("['review-claude.md', read('review-claude.md')]");
    expect(consistencyGate.command).toContain("['fix-loop-report.md', read('fix-loop-report.md')]");
    expect(consistencyGate.command).toContain("['final-review-claude.md', read('final-review-claude.md')]");
    expect(consistencyGate.command).toContain("['claude-final-fix.md', read('claude-final-fix.md')]");
    expect(consistencyGate.command).toContain("['review-codex.md', read('review-codex.md')]");
    expect(consistencyGate.command).toContain("['codex-fix-loop-report.md', read('codex-fix-loop-report.md')]");
    expect(consistencyGate.command).toContain("['final-review-codex.md', read('final-review-codex.md')]");
    expect(consistencyGate.command).toContain("['codex-final-fix.md', read('codex-final-fix.md')]");
    expect(consistencyGate.command).toContain("['signoff.md', read('signoff.md')]");
    expect(consistencyGate.command).toContain('CODEX_FINAL_FIX_COMPLETE');
  });

  it('no-target code workflow file gate validates manifest contents, not source-shape grep', () => {
    const result = generate({
      spec: spec({
        description: 'Implement a code change without explicit target files.',
        targetFiles: [],
      }),
      artifactPath: 'workflows/generated/no-target-gate.ts',
    });

    expect(result.success).toBe(true);
    const artifact = result.artifact!;
    const fileGate = artifact.gates.find((g) => g.name === 'post-implementation-file-gate')!;

    // Gate must NOT grep manifest for source-shape tokens (export|function|class|workflow)
    expect(fileGate.command).not.toMatch(/grep.*export\|function\|class/);
    // Gate must validate manifest is non-empty and support status-prefixed cleanup entries.
    expect(fileGate.command).toContain('output manifest is empty');
    expect(fileGate.command).toContain('deleted manifest path still exists');
    expect(fileGate.command).toContain('manifest path does not exist');
    expect(fileGate.command).toContain('MANIFEST_FILE_GATE_OK');
  });

  it('targeted code workflow file gate uses repository diff evidence instead of test-f on every declared target', () => {
    const result = generate({
      spec: spec({
        description: 'Implement Slack relay bridge with mixed context targets.',
        targetFiles: [
          'specs/mcp-cloud-spawn-and-slack-bridge.md',
          '/private/tmp/cloud-slack-relay-bridge-inbound',
          '/Users/khaliqgant/Projects/AgentWorkforce/cloud',
          '/api/v1/*',
          'packages/web/lib/integrations/slack-relay-bridge/',
          'packages/web/drizzle/meta/_journal.json',
        ],
      }),
      artifactPath: 'workflows/generated/mixed-targets.ts',
    });

    expect(result.success).toBe(true);
    const artifact = result.artifact!;
    const fileGate = artifact.gates.find((g) => g.name === 'post-implementation-file-gate')!;
    const gitDiffGate = artifact.gates.find((g) => g.name === 'git-diff-gate')!;

    expect(fileGate.command).toContain('IMPLEMENTATION_FILE_GATE_OK');
    expect(fileGate.command).toContain("'diff', '--name-only', '--diff-filter=ACMRT'");
    expect(fileGate.command).not.toContain('test -f');
    expect(fileGate.command).not.toContain("test -f '/private/tmp/cloud-slack-relay-bridge-inbound'");
    expect(fileGate.command).not.toContain("test -f '/api/v1/*'");
    expect(gitDiffGate.command).toContain('GIT_DIFF_GATE_OK');
    expect(gitDiffGate.command).not.toContain('/api/v1/*');
  });

  it('renders deterministic artifact content for the same spec with controlled registry', () => {
    const inputSpec = spec({
      description: 'Deterministic rendering proof for controlled registry.',
      targetFiles: ['src/product/generation/pipeline.ts'],
      acceptanceGates: ['npx vitest run src/product/generation/pipeline.test.ts'],
    });

    const result1 = generate({ spec: inputSpec, artifactPath: 'workflows/generated/deterministic-a.ts' });
    const result2 = generate({ spec: inputSpec, artifactPath: 'workflows/generated/deterministic-a.ts' });

    expect(result1.success).toBe(true);
    expect(result2.success).toBe(true);
    expect(result1.artifact!.content).toBe(result2.artifact!.content);
  });

  it('rendered skill metadata and embedded context avoid absolute paths and updatedAt timestamps', () => {
    const result = generate({
      spec: spec({
        description: 'Implement strict TypeScript workflow proof with deterministic tests.',
        targetFiles: ['src/product/generation/template-renderer.ts'],
      }),
      artifactPath: 'workflows/generated/no-env-data.ts',
    });

    expect(result.success).toBe(true);
    const content = result.artifact!.content;
    const skillMatchesLine = content.split('\n').find((line) => line.includes('skill-matches.json'));
    expect(skillMatchesLine).toBeDefined();
    expect(skillMatchesLine).not.toMatch(/"updatedAt"/);
    expect(skillMatchesLine).not.toMatch(/"path"/);
    expect(content).not.toContain('/Users/');
    expect(content).not.toMatch(/source=/);
    expect(content).not.toMatch(/descriptor from \/|descriptor from [A-Za-z]:\\/);
  });

  it('no-target git diff gate validates manifest entries including untracked files', () => {
    const result = generate({
      spec: spec({
        description: 'Implement a code change without explicit target files.',
        targetFiles: [],
      }),
      artifactPath: 'workflows/generated/no-target-git-diff.ts',
    });

    expect(result.success).toBe(true);
    const artifact = result.artifact!;
    const gitDiffGate = artifact.gates.find((g) => g.name === 'git-diff-gate')!;

    expect(gitDiffGate.command).toContain('output-manifest.txt');
    expect(gitDiffGate.command).toContain("'diff', '--name-status'");
    expect(gitDiffGate.command).toContain("'ls-files', '--others', '--exclude-standard'");
    expect(gitDiffGate.command).toContain('missing expected diff entry');
    expect(gitDiffGate.command).toContain('unexpected changed paths');
  });

  it('no-target active reference gate skips missing tracked paths before reading files', () => {
    const result = generate({
      spec: spec({
        description: 'Remove an unused file without explicit target files.',
        targetFiles: [],
      }),
      artifactPath: 'workflows/generated/no-target-active-reference.ts',
    });

    expect(result.success).toBe(true);
    const artifact = result.artifact!;
    const activeReferenceGate = artifact.gates.find((g) => g.name === 'active-reference-gate')!;

    expect(activeReferenceGate.command).toContain('fs.existsSync(file)');
    expect(activeReferenceGate.command).toContain('fs.statSync(file).isFile()');
    expect(activeReferenceGate.command).toContain('basename referenced by');
    expect(activeReferenceGate.command).toContain('active references remain');
  });

  it('no-target lead plan and manifest gates require the declared evidence artifacts', () => {
    const result = generate({
      spec: spec({
        description: 'Remove an unused file without explicit target files.',
        targetFiles: [],
      }),
      artifactPath: 'workflows/generated/no-target-evidence-gates.ts',
    });

    expect(result.success).toBe(true);
    const artifact = result.artifact!;
    const leadPlanGate = artifact.gates.find((g) => g.name === 'lead-plan-gate')!;
    const fixLoopReportGate = artifact.gates.find((g) => g.name === 'fix-loop-report-gate')!;
    const postFixGate = artifact.gates.find((g) => g.name === 'post-fix-verification-gate')!;
    const postImplementationGate = artifact.gates.find((g) => g.name === 'post-implementation-file-gate')!;

    expect(leadPlanGate.command).toContain('GENERATION_LEAD_PLAN_READY');
    expect(leadPlanGate.command).toContain('out[- ]of[- ]scope');
    expect(leadPlanGate.command).toContain('Routing contract');
    expect(artifact.content).toContain('write .workflow-artifacts/generated/no-target-evidence-gates/fix-loop-report.md');
    expect(fixLoopReportGate.command).toContain('FIX_LOOP_COMPLETE');
    expect(fixLoopReportGate.dependsOn).toEqual(['fix-loop']);
    expect(postFixGate.dependsOn).toEqual(['fix-loop-report-gate']);
    expect(postImplementationGate.command).toContain('cleanup-report.md');
    expect(postImplementationGate.command).toContain('cleanup-diff-inventory.txt');
    expect(postImplementationGate.command).toContain('validation-evidence.md');
  });

  it('renders out-of-scope constraints as lead-plan non-goals', () => {
    const result = generate({
      spec: spec({
        description: 'Implement Linear integration surface.',
        targetFiles: ['src/surfaces/linear/index.ts'],
        constraints: ['Non-goal: Passive Linear comment monitoring', 'Non-goal: Custom per-repo workflow templates'],
      }),
      artifactPath: 'workflows/generated/linear-scope.ts',
    });

    expect(result.success).toBe(true);
    expect(result.artifact?.content).toContain('.workflow-artifacts/generated/linear-scope/non-goals.md');
    expect(result.artifact?.content).toContain('# Non-goals');
    expect(result.artifact?.content).toContain('- Non-goal: Passive Linear comment monitoring');
    expect(result.artifact?.content).toContain('Use this exact section heading in the lead plan.');
  });

  it('explicit target git diff gate includes untracked files for newly created outputs', () => {
    const result = generate({
      spec: spec({
        description: 'Implement a new generated artifact file.',
        targetFiles: ['src/product/generation/new-file.ts'],
      }),
      artifactPath: 'workflows/generated/explicit-target-git-diff.ts',
    });

    expect(result.success).toBe(true);
    const artifact = result.artifact!;
    const gitDiffGate = artifact.gates.find((g) => g.name === 'git-diff-gate')!;

    expect(gitDiffGate.command).toContain("'diff', '--name-status'");
    expect(gitDiffGate.command).toContain("'ls-files', '--others', '--exclude-standard'");
    expect(gitDiffGate.command).toContain('GIT_DIFF_GATE_OK');
  });

  it('maps prose acceptance gates with inline shell commands without emitting prose as shell', () => {
    const result = generate({
      spec: spec({
        description: 'Improve generated workflow quality for version gates.',
        targetFiles: ['src/product/generation/template-renderer.ts'],
        acceptanceGates: [
          "test for this layer: the version workflow verifies `node dist/bin/ricky.js --version | grep -Eq '^ricky [0-9]+\\.[0-9]+\\.[0-9]+$'` instead of a generic source-shape grep.",
        ],
      }),
      artifactPath: 'workflows/generated/inline-command-gate.ts',
    });

    expect(result.success).toBe(true);
    const initialValidation = result.artifact!.gates.find((gate) => gate.name === 'initial-soft-validation')!;
    expect(initialValidation.command).toContain("node dist/bin/ricky.js --version | grep -Eq '^ricky [0-9]+\\.[0-9]+\\.[0-9]+$'");
    expect(initialValidation.command).not.toContain('test for this layer');
  });

  it('treats static shell tools in acceptance gates as executable validation commands', () => {
    const result = generate({
      spec: spec({
        description: 'Implement workflow static validation gates.',
        targetFiles: ['src/product/generation/template-renderer.ts'],
        constraints: ['Use only listed validation commands.'],
        acceptanceGates: [
          'git diff --check',
          'bash -n scripts/check.sh',
          'actionlint .github/workflows/deploy.yml',
          "ruby -e \"require 'yaml'\"",
        ],
      }),
      artifactPath: 'workflows/generated/static-tool-gates.ts',
    });

    expect(result.success).toBe(true);
    const command = gate(artifact(result), 'final-hard-validation').command;
    expect(command).toContain('git diff --check');
    expect(command).toContain('bash -n scripts/check.sh');
    expect(command).toContain('actionlint .github/workflows/deploy.yml');
    expect(command).toContain("ruby -e \"require 'yaml'\"");
    expect(command).not.toContain('npx tsc --noEmit');
    expect(command).not.toContain('npx vitest run');
  });

  it('enforces executable acceptance gates in post-fix and final-hard validation stages', () => {
    const result = generate({
      spec: spec({
        description: 'Implement version gate enforcement across all validation stages.',
        targetFiles: ['src/product/generation/template-renderer.ts'],
        acceptanceGates: [
          "version gate: `node dist/bin/ricky.js --version | grep -Eq '^ricky [0-9]+\\.[0-9]+\\.[0-9]+$'`",
        ],
      }),
      artifactPath: 'workflows/generated/acceptance-enforcement.ts',
    });

    expect(result.success).toBe(true);
    const artifact = result.artifact!;
    const versionCommand = "node dist/bin/ricky.js --version | grep -Eq '^ricky [0-9]+\\.[0-9]+\\.[0-9]+$'";

    const initialValidation = gate(artifact, 'initial-soft-validation');
    const postFixValidation = gate(artifact, 'post-fix-validation');
    const finalHardValidation = gate(artifact, 'final-hard-validation');

    expect(initialValidation.command).toContain(versionCommand);
    expect(postFixValidation.command).toContain(versionCommand);
    expect(finalHardValidation.command).toContain(versionCommand);

    expect(initialValidation.failOnError).toBe(false);
    expect(postFixValidation.failOnError).toBe(false);
    expect(finalHardValidation.failOnError).toBe(true);
  });

  it('uses only listed validation commands when the spec forbids generic root gates', () => {
    const result = generate({
      spec: spec({
        description: 'Implement workflow-only deploy plumbing.',
        targetFiles: [
          '.github/workflows/deploy-sage.yml',
          '.github/actions/run-cloudflare-d1-migrations/run.sh',
        ],
        constraints: [
          'Use only the validation commands listed in this spec.',
          'Do not add generic root gates such as npm run typecheck, npx tsc, or npx vitest.',
        ],
        acceptanceGates: [
          'git diff --check',
          'bash -n .github/actions/run-cloudflare-d1-migrations/run.sh',
          'actionlint .github/workflows/deploy-sage.yml',
        ],
      }),
      artifactPath: 'workflows/generated/static-validation-only.ts',
    });

    const artifactResult = artifact(result);
    const initialValidation = gate(artifactResult, 'initial-soft-validation');
    const postFixValidation = gate(artifactResult, 'post-fix-validation');
    const finalHardValidation = gate(artifactResult, 'final-hard-validation');
    const regressionGate = gate(artifactResult, 'regression-gate');

    for (const validationGate of [initialValidation, postFixValidation, finalHardValidation]) {
      expect(validationGate.command).toContain('git diff --check');
      expect(validationGate.command).toContain('bash -n .github/actions/run-cloudflare-d1-migrations/run.sh');
      expect(validationGate.command).toContain('actionlint .github/workflows/deploy-sage.yml');
      expect(validationGate.command).not.toContain('npx tsc --noEmit');
      expect(validationGate.command).not.toContain('npx vitest run');
    }
    expect(regressionGate.command).toBe('git diff --check');
    expect(artifactResult.gates.map((gate) => gate.command).join('\n')).not.toContain('npx tsc --noEmit');
    expect(artifactResult.gates.map((gate) => gate.command).join('\n')).not.toContain('npx vitest run');
  });

  it('excludes prose-only acceptance gates from post-fix and final-hard validation', () => {
    const result = generate({
      spec: spec({
        description: 'Implement a workflow with prose-only acceptance gates.',
        targetFiles: ['src/product/generation/template-renderer.ts'],
        acceptanceGates: ['Reviewer must confirm the output is production-ready.'],
      }),
      artifactPath: 'workflows/generated/prose-only-gate.ts',
    });

    expect(result.success).toBe(true);
    const artifact = result.artifact!;

    const initialValidation = gate(artifact, 'initial-soft-validation');
    const postFixValidation = gate(artifact, 'post-fix-validation');
    const finalHardValidation = gate(artifact, 'final-hard-validation');

    expect(initialValidation.command).toContain('Manual acceptance gate:');
    expect(postFixValidation.command).not.toContain('Manual acceptance gate:');
    expect(finalHardValidation.command).not.toContain('Manual acceptance gate:');
  });

  it('selects pipeline pattern for low-risk simple spec', () => {
    const result = generate({
      spec: spec({
        description: 'Update a readme file.',
        targetFiles: ['README.md'],
      }),
    });

    expect(result.success).toBe(true);
    expect(result.patternDecision).toMatchObject({
      pattern: 'pipeline',
      riskLevel: 'low',
      overrideUsed: false,
    });
    expect(result.patternDecision.specSignals).toContain('choosing-swarm-patterns skill loaded');
    expect(result.patternDecision.reason).toMatch(/choosing-swarm-patterns/i);
    expect(artifact(result).content).toContain(".onError('retry', { maxRetries: 2, retryDelayMs: 10000, repairAgent: \"validator-codex\", repairRetries: 2 })");
    expect(artifact(result).content).not.toMatch(/^\s*\.onError\('fail-fast'\)/m);
  });

  it('rejects generated workflows that can still fail fast without a repair agent', () => {
    const implementationSpec = spec({
      description: 'Implement workflow retry policy validation.',
      targetFiles: ['src/product/generation/pipeline.ts'],
    });
    const result = generate({
      spec: implementationSpec,
      artifactPath: 'workflows/generated/repair-policy.ts',
    });
    const baseArtifact = artifact(result);
    const weakArtifact = {
      ...baseArtifact,
      content: baseArtifact.content.replace(
        ".onError('retry', { maxRetries: 2, retryDelayMs: 10000, repairAgent: \"validator-claude\", repairRetries: 2 })",
        ".onError('retry', { maxRetries: 2, retryDelayMs: 10000 })",
      ),
    };

    const validation = validateGeneratedArtifact(weakArtifact, result.patternDecision, result.skillContext, implementationSpec);

    expect(validation.valid).toBe(false);
    expect(validation.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'REPAIR_AWARE_RETRY_MISSING' }),
      ]),
    );
  });

  it('respects pattern override', () => {
    const result = generate({
      spec: spec({
        description: 'Simple change to one file.',
        targetFiles: ['README.md'],
      }),
      patternOverride: 'dag',
    });

    expect(result.success).toBe(true);
    expect(result.patternDecision).toMatchObject({
      pattern: 'dag',
      overrideUsed: true,
    });
    expect(artifact(result).content).toContain('.pattern("dag")');
  });

  it('dry-run planned check exposes environmental prerequisite for agent-relay binary', () => {
    const result = generate({
      spec: spec({
        description: 'Implement workflow with dry-run prerequisite.',
        targetFiles: ['src/product/generation/pipeline.ts'],
      }),
      artifactPath: 'workflows/generated/dry-run-prereq.ts',
    });

    expect(result.success).toBe(true);
    const dryRunCheck = result.plannedChecks.find((c) => c.name === 'dry-run');
    expect(dryRunCheck).toBeDefined();
    expect(dryRunCheck!.environmentalPrerequisite).toBeDefined();
    expect(dryRunCheck!.environmentalPrerequisite).toContain('@agent-relay/cli');
  });

  it('returns null dryRunCommand when dryRunEnabled is false', () => {
    const result = generate({
      spec: spec({
        description: 'Implement workflow with dry run disabled.',
        targetFiles: ['src/product/generation/pipeline.ts'],
      }),
      dryRunEnabled: false,
    });

    expect(result.success).toBe(true);
    expect(result.dryRunCommand).toBeNull();
    expect(result.plannedChecks.find((c) => c.stage === 'dry_run')).toBeUndefined();
  });

  it('reports blocking error for unknown template override', () => {
    const result = generate({
      spec: spec({
        description: 'Generate with a bad template.',
        targetFiles: ['src/something.ts'],
      }),
      templateOverride: 'nonexistent-template',
    });

    expect(result.success).toBe(false);
    expect(result.validation.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: 'error',
          stage: 'template_resolution',
          code: 'TEMPLATE_MISSING',
          blocking: true,
        }),
      ]),
    );
  });

  it('routes cloud execution correctly', () => {
    const result = generate({
      spec: spec({
        description: 'Implement a cloud-routed workflow.',
        targetFiles: ['src/cloud/handler.ts'],
        executionPreference: 'cloud',
      }),
    });

    expect(result.success).toBe(true);
    expect(result.executionRoute).toMatchObject({
      requestedPreference: 'cloud',
      resolvedTarget: 'cloud',
      artifactDelivery: 'cloud_artifact',
    });
  });

  it('routes local non-CLI surface to return_artifact', () => {
    const mcpSpec = spec({
      description: 'Generate via MCP surface.',
      targetFiles: ['src/api/endpoint.ts'],
    });
    mcpSpec.providerContext.surface = 'mcp';

    const result = generate({ spec: mcpSpec });

    expect(result.success).toBe(true);
    expect(result.executionRoute).toMatchObject({
      resolvedTarget: 'local',
      invocationSurface: 'mcp',
      artifactDelivery: 'return_artifact',
    });
  });

  it('reports non-blocking warning when an unknown skill is force-loaded via override', () => {
    const result = generate({
      spec: spec({
        description: 'Generate with an unknown skill override.',
        targetFiles: ['src/something.ts'],
      }),
      skillOverrides: ['unknown-optional-skill'],
    });

    expect(result.success).toBe(true);
    expect(result.validation.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: 'warning',
          code: 'SKILL_UNKNOWN',
          blocking: false,
        }),
      ]),
    );
  });

  it('all rendered artifact paths are scoped under the workflow-specific artifacts directory', () => {
    const result = generate({
      spec: spec({
        description: 'Verify artifact directory scoping for generated paths.',
        targetFiles: ['src/product/generation/pipeline.ts'],
      }),
      artifactPath: 'workflows/generated/scoped-paths.ts',
    });

    expect(result.success).toBe(true);
    const content = artifact(result).content;

    const slug = 'scoped-paths';
    const artifactsDir = `.workflow-artifacts/generated/${slug}`;
    expect(content).toContain(`${artifactsDir}/lead-plan.md`);
    expect(content).toContain(`${artifactsDir}/review-claude.md`);
    expect(content).toContain(`${artifactsDir}/review-codex.md`);
    expect(content).toContain(`${artifactsDir}/final-review-claude.md`);
    expect(content).toContain(`${artifactsDir}/final-review-codex.md`);
    expect(content).not.toContain('timeoutMs: 300_000');
    expect(content).toContain(`${artifactsDir}/skill-application-boundary.json`);
    expect(content).toContain(`${artifactsDir}/skill-runtime-boundary.txt`);
    expect(content).toContain(`${artifactsDir}/signoff.md`);
    expect(content).toContain(`${artifactsDir}/normalized-spec.md`);
    expect(content).toContain(`${artifactsDir}/acceptance-contract.json`);
    expect(content).toContain(`${artifactsDir}/lead-plan-instructions.md`);
    expect(content).toContain(`${artifactsDir}/implementation-instructions.md`);
    expect(content).toContain(`${artifactsDir}/review-checklist.md`);
  });

  it('packages long spec context into sidecar files instead of agent task bodies', () => {
    const longSpecSentinel = 'VERY_LONG_INLINE_SENTINEL_SHOULD_ONLY_LIVE_IN_CONTEXT_PACKAGE';
    const longDescription = [
      'Implement prompt packaging for generated workflow context.',
      longSpecSentinel,
      'This paragraph is intentionally repeated so generated agent tasks must point at sidecar files instead of carrying the entire normalized spec.',
    ].join(' ').repeat(80);
    const result = generate({
      spec: spec({
        description: longDescription,
        targetFiles: ['src/product/generation/template-renderer.ts'],
        acceptanceGates: ['npx vitest run src/product/generation/pipeline.test.ts'],
      }),
      artifactPath: 'workflows/generated/packaged-context.ts',
    });

    expect(result.success).toBe(true);
    const content = artifact(result).content;
    expect(content).toContain('.workflow-artifacts/generated/packaged-context/normalized-spec.md');
    expect(content).toContain('.workflow-artifacts/generated/packaged-context/acceptance-contract.json');

    const prepareContextCommand = renderedStepCommand(content, 'prepare-context');
    expect(prepareContextCommand).not.toContain(longSpecSentinel);
    expect(prepareContextCommand).not.toContain('printf');
    expect(prepareContextCommand.length).toBeLessThan(2000);
    expect(renderedStepCommands(content).join('\n')).not.toContain(longSpecSentinel);

    const taskBodies = renderedTaskBodies(content);
    expect(taskBodies.length).toBeGreaterThan(0);
    expect(taskBodies.join('\n')).not.toContain(longSpecSentinel);
    expect(Math.max(...taskBodies.map((body) => body.length))).toBeLessThan(2500);
  });

  it('threads target context sidecars into planning and review prompts', () => {
    const result = generate({
      spec: spec({
        description: 'Implement a workflow using the supplied target context.',
        targetContext: 'docs/product/ricky-simplified-workflow-cli-spec.md',
        targetFiles: ['src/product/generation/template-renderer.ts'],
      }),
      artifactPath: 'workflows/generated/target-context-aware.ts',
    });

    expect(result.success).toBe(true);
    const content = artifact(result).content;
    const taskBodies = renderedTaskBodies(content);

    expect(taskBodies.some((body) => body.includes('lead-plan-instructions.md') && body.includes('target-context.txt'))).toBe(true);
    expect(taskBodies.some((body) => body.includes('review-checklist.md') && body.includes('target-context.txt'))).toBe(true);
  });

  it('restricts generated target context file reads to repo-relative workspace paths', () => {
    const result = generate({
      spec: spec({
        description: 'Implement a workflow using a target context path.',
        targetContext: '../outside-workspace.md',
        targetFiles: ['src/product/generation/template-renderer.ts'],
      }),
      artifactPath: 'workflows/generated/target-context-path-guard.ts',
    });

    expect(result.success).toBe(true);
    const content = artifact(result).content;

    expect(content).toContain('function resolveRickyGeneratedTargetContextPath(value: string): string | null');
    expect(content).toContain('if (rickyWorkflowPath.isAbsolute(value)) return null;');
    expect(content).toContain('const workspaceRoot = rickyWorkflowFs.realpathSync(process.cwd());');
    expect(content).toContain('const candidatePath = rickyWorkflowPath.resolve(workspaceRoot, value);');
    expect(content).toContain('realCandidatePath.startsWith(`${workspaceRoot}${rickyWorkflowPath.sep}`)');
    expect(content).toContain('rickyWorkflowFs.writeFileSync(targetContext.outputPath, ensureTrailingNewline(targetContext.value));');
    expect(content).not.toContain('existsSync(targetContext.value)');
    expect(content).not.toContain('copyFileSync(targetContext.value');
  });
});

function artifact(result: ReturnType<typeof generate>): NonNullable<ReturnType<typeof generate>['artifact']> {
  expect(result.artifact).not.toBeNull();
  return result.artifact!;
}

function renderedTaskBodies(content: string): string[] {
  return [...content.matchAll(/task:\s*`((?:[^`\\]|\\[\s\S])*)`/g)].map((match) => match[1].replace(/\\`/g, '`'));
}

function renderedStepCommand(content: string, stepName: string): string {
  const stepIndex = content.search(new RegExp(`\\.step\\(${JSON.stringify(stepName)},`));
  expect(stepIndex).toBeGreaterThanOrEqual(0);
  const commandMatch = /command:\s*("(?:(?:\\[\s\S])|[^"\\])*")/.exec(content.slice(stepIndex));
  expect(commandMatch).not.toBeNull();
  return JSON.parse(commandMatch![1]) as string;
}

function renderedStepCommands(content: string): string[] {
  return [...content.matchAll(/command:\s*("(?:(?:\\[\s\S])|[^"\\])*")/g)].map((match) => JSON.parse(match[1]) as string);
}

function gate(
  artifact: NonNullable<ReturnType<typeof generate>['artifact']>,
  name: string,
): NonNullable<ReturnType<typeof generate>['artifact']>['gates'][number] {
  const match = artifact.gates.find((candidate) => candidate.name === name);
  expect(match).toBeDefined();
  return match!;
}

function replaceLast(value: string, search: string, replacement: string): string {
  const index = value.lastIndexOf(search);
  expect(index).toBeGreaterThanOrEqual(0);
  return `${value.slice(0, index)}${replacement}${value.slice(index + search.length)}`;
}

function spec(overrides: SpecFixtureOverrides = {}): NormalizedWorkflowSpec {
  const description = overrides.description ?? 'Generate a workflow for deterministic product work.';
  const rawPayload: RawSpecPayload = {
    kind: 'natural_language',
    surface: 'cli',
    receivedAt: RECEIVED_AT,
    requestId: 'generation-test-request',
    text: description,
  };
  const providerContext = {
    surface: 'cli' as const,
    requestId: rawPayload.requestId,
    metadata: {},
  };
  const targetContext = overrides.targetContext ?? null;
  const targetFiles = overrides.targetFiles ?? [];
  const constraints = overrides.constraints ?? [];
  const evidenceRequirements = overrides.evidenceRequirements ?? [];
  const acceptanceGates = overrides.acceptanceGates ?? [];

  return {
    intent: 'generate',
    description,
    targetRepo: null,
    targetContext,
    targetFiles,
    desiredAction: {
      kind: 'generate',
      summary: description,
      specText: description,
      targetFiles,
    },
    constraints: constraints.map((constraint) => ({
      constraint,
      category: /\b(only|must|non[- ]?goal|out[- ]of[- ]scope)\b/i.test(constraint) ? 'scope' : 'quality',
    })),
    evidenceRequirements: evidenceRequirements.map((requirement) => ({
      requirement,
      verificationType: 'output_contains',
    })),
    requiredEvidence: evidenceRequirements.map((requirement) => ({
      requirement,
      verificationType: 'output_contains',
    })),
    acceptanceGates: acceptanceGates.map((gate) => ({
      gate,
      kind: /review/i.test(gate) ? 'review' : 'deterministic',
    })),
    acceptanceCriteria: acceptanceGates.map((gate) => ({
      gate,
      kind: /review/i.test(gate) ? 'review' : 'deterministic',
    })),
    providerContext,
    sourceSpec: {
      surface: 'cli',
      intent: { primary: 'generate', signals: ['test fixture'] },
      description,
      targetRepo: undefined,
      targetContext: targetContext ?? undefined,
      targetFiles,
      constraints,
      evidenceRequirements,
      acceptanceGates,
      providerContext,
      rawPayload,
      parseConfidence: 'high',
      parseWarnings: [],
    },
    executionPreference: overrides.executionPreference ?? 'auto',
  };
}
