import { describe, expect, it } from 'vitest';

import type { WorkforcePersonaExecution, WorkforcePersonaResolver } from './workforce-persona-writer.js';
import {
  buildWorkflowRepairPersonaTask,
  detectWorkflowIntentRegressions,
  repairWorkflowWithWorkforcePersona,
} from './workforce-persona-repairer.js';

describe('workforce persona workflow repairer', () => {
  it('builds a repair task with artifact content, failure evidence, resume details, and response contract', () => {
    const task = buildWorkflowRepairPersonaTask({
      repoRoot: '/repo',
      artifactPath: 'workflows/generated/failing.ts',
      artifactContent: workflowSource('before'),
      evidence: { runId: 'relay-run-1', status: 'failed' },
      classification: { failureClass: 'environment_error' },
      debuggerResult: { repairMode: 'guided', summary: 'missing setup' },
      blocker: { code: 'MISSING_ENV_VAR' },
      failedStep: 'install-deps',
      previousRunId: 'relay-run-1',
      attempt: 1,
      maxAttempts: 3,
      previousAttempts: [{
        attempt: 1,
        repairedArtifactPath: 'workflows/generated/failing.ts',
        repairSummary: 'added env loader',
        repairMode: 'workforce-persona',
        retryAttempt: 2,
        outcome: {
          status: 'blocker',
          failedStep: 'install-deps',
          blockerCode: 'MISSING_ENV_VAR',
          runId: 'relay-run-2',
          debuggerSummary: 'same env assertion still failed',
        },
      }],
    });

    expect(task).toContain('Repair an Agent Relay workflow artifact for Ricky');
    expect(task).toContain('workflows/generated/failing.ts');
    expect(task).toContain('workflow("before")');
    expect(task).toContain('"failedStep": "install-deps"');
    expect(task).toContain('"previousRunId": "relay-run-1"');
    expect(task).toContain('--start-from');
    expect(task).toContain('Structured response contract');
    expect(task).toContain('Do not echo the schema, do not return a patch');
    expect(task).toContain('Previous repair attempts that did not resolve the workflow');
    expect(task).toContain('added env loader');
    expect(task).toContain('same repair strategy');
  });

  it('invokes the workflow persona and returns a full repaired artifact', async () => {
    const sendMessageOptions: Array<Record<string, unknown>> = [];
    const resolverOptions: Array<Record<string, unknown>> = [];
    const resolver: WorkforcePersonaResolver = async (_intents, options) => {
      resolverOptions.push(options);
      return {
        source: 'package',
        intent: 'agent-relay-workflow',
        warnings: ['resolver warning'],
        context: {
          selection: {
            personaId: 'agent-relay-workflow',
            tier: 'best',
            runtime: { harness: 'codex', model: 'codex/test' },
          },
          sendMessage(_task, options) {
            sendMessageOptions.push((options ?? {}) as Record<string, unknown>);
            return execution(JSON.stringify({
              artifact: {
                path: 'workflows/generated/failing.ts',
                content: workflowSource('after'),
              },
              metadata: {
                summary: 'patched failing setup step',
                failedStep: 'install-deps',
              },
            }));
          },
        },
      };
    };

    const result = await repairWorkflowWithWorkforcePersona({
      repoRoot: '/repo',
      artifactPath: 'workflows/generated/failing.ts',
      artifactContent: workflowSource('before'),
      evidence: { runId: 'relay-run-1', status: 'failed' },
      classification: { failureClass: 'environment_error' },
      debuggerResult: { repairMode: 'guided', summary: 'missing setup' },
      failedStep: 'install-deps',
      previousRunId: 'relay-run-1',
      attempt: 1,
      maxAttempts: 3,
      installSkills: false,
      installRoot: '/state/ricky/persona-repair-skills',
      resolver,
    });

    expect(result.artifact.content).toContain('workflow("after")');
    expect(result.artifact.metadata).toMatchObject({ summary: 'patched failing setup step' });
    expect(result.metadata).toMatchObject({
      personaId: 'agent-relay-workflow',
      selectedIntent: 'agent-relay-workflow',
      runId: 'persona-repair-run-1',
      warnings: ['resolver warning'],
    });
    expect(sendMessageOptions[0]).toMatchObject({
      workingDirectory: '/repo',
      installSkills: false,
      inputs: {
        outputPath: 'workflows/generated/failing.ts',
        failedStep: 'install-deps',
        previousRunId: 'relay-run-1',
        attempt: 1,
        maxAttempts: 3,
      },
    });
    expect(resolverOptions).toEqual([{ tier: 'best-value', installRoot: '/state/ricky/persona-repair-skills' }]);
  });

  it('rejects repaired artifacts that do not run with explicit cwd', async () => {
    const resolver: WorkforcePersonaResolver = async () => ({
      source: 'package',
      intent: 'agent-relay-workflow',
      warnings: [],
      context: {
        selection: {
          personaId: 'agent-relay-workflow',
          tier: 'best',
          runtime: { harness: 'codex', model: 'codex/test' },
        },
        sendMessage() {
          return execution(JSON.stringify({
            artifact: {
              path: 'workflows/generated/failing.ts',
              content: workflowSource('after').replace('.run({ cwd: process.cwd() });', '.run();'),
            },
            metadata: { summary: 'repaired without cwd' },
          }));
        },
      },
    });

    await expect(repairWorkflowWithWorkforcePersona({
      repoRoot: '/repo',
      artifactPath: 'workflows/generated/failing.ts',
      artifactContent: workflowSource('before'),
      evidence: { runId: 'relay-run-1', status: 'failed' },
      classification: { failureClass: 'environment_error' },
      debuggerResult: { repairMode: 'guided', summary: 'missing setup' },
      attempt: 1,
      maxAttempts: 3,
      resolver,
    })).rejects.toMatchObject({
      name: 'WorkforcePersonaWriterError',
      message: expect.stringContaining('explicit cwd'),
    });
  });

  it('upgrades repair persona resolution to best after the third failed retry', async () => {
    const resolverOptions: Array<Record<string, unknown>> = [];
    const resolver: WorkforcePersonaResolver = async (_intents, options) => {
      resolverOptions.push(options);
      return {
        source: 'package',
        intent: 'agent-relay-workflow',
        warnings: [],
        context: {
          selection: {
            personaId: 'agent-relay-workflow',
            tier: options?.tier ?? 'minimum',
            runtime: { harness: 'codex', model: 'codex/test' },
          },
          sendMessage() {
            return execution(JSON.stringify({
              artifact: {
                path: 'workflows/generated/failing.ts',
                content: workflowSource('after'),
              },
              metadata: { summary: 'patched after escalation' },
            }));
          },
        },
      };
    };

    await repairWorkflowWithWorkforcePersona({
      repoRoot: '/repo',
      artifactPath: 'workflows/generated/failing.ts',
      artifactContent: workflowSource('before'),
      evidence: { runId: 'relay-run-4', status: 'failed' },
      classification: { failureClass: 'retry_exhaustion' },
      debuggerResult: { repairMode: 'guided', summary: 'still failing after repairs' },
      attempt: 4,
      maxAttempts: 5,
      tier: 'minimum',
      resolver,
    });

    expect(resolverOptions).toEqual([{ tier: 'best' }]);
  });
});

describe('detectWorkflowIntentRegressions (PR-shipping preservation guard)', () => {
  it('flags a repair that removed `@agent-relay/github-primitive` from an originally PR-shipping workflow', () => {
    const original = workflowWithGithubShipping();
    const repaired = repairStubFromObservedAutoFixFailure();
    const regressions = detectWorkflowIntentRegressions(original, repaired);
    expect(regressions.some((r) => r.includes('@agent-relay/github-primitive'))).toBe(true);
  });

  it('flags a repair that removed `GitHubStepExecutor` or `createGitHubStep` symbols', () => {
    const original = workflowWithGithubShipping();
    const repaired = original.replaceAll('createGitHubStep', 'noopShellStep').replaceAll('GitHubStepExecutor', 'NoopExecutor');
    const regressions = detectWorkflowIntentRegressions(original, repaired);
    expect(regressions.some((r) => r.includes('createGitHubStep'))).toBe(true);
    expect(regressions.some((r) => r.includes('GitHubStepExecutor'))).toBe(true);
  });

  it('flags a repair that collapses step count below ceil(N/2) when the original had at least 4 steps', () => {
    const original = workflowWithManySteps(12);
    const repaired = repairStubFromObservedAutoFixFailure();
    const regressions = detectWorkflowIntentRegressions(original, repaired);
    expect(regressions.some((r) => r.includes('step count collapsed'))).toBe(true);
  });

  it('does NOT flag a repair that preserves PR-shipping, builder usage, and most of the steps', () => {
    const original = workflowWithGithubShipping();
    const healthyRepair = original
      .replace('echo ok', 'echo "validated"')
      .replace('"verify"', '"verify-renamed"');
    expect(detectWorkflowIntentRegressions(original, healthyRepair)).toEqual([]);
  });

  it('does NOT trigger the step-count guard when the original is small (<4 steps)', () => {
    const tinyOriginal = workflowSource('small');
    const stubRepair = repairStubFromObservedAutoFixFailure();
    const regressions = detectWorkflowIntentRegressions(tinyOriginal, stubRepair);
    // Step count guard intentionally skipped for small workflows; only the
    // builder check applies, and both keep `workflow(`, so no regression.
    expect(regressions.some((r) => r.includes('step count collapsed'))).toBe(false);
  });

  it('flags a repair that dropped the `workflow(...)` builder entirely', () => {
    const original = workflowSource('original');
    const repaired = 'export const noop = () => null;';
    const regressions = detectWorkflowIntentRegressions(original, repaired);
    expect(regressions.some((r) => r.includes('builder'))).toBe(true);
  });

  it('does NOT count `.step(` matches inside HEREDOCs / string literals / comments when measuring step count', () => {
    // A repair that genuinely shrinks the workflow but quotes ".step(\"x\")"
    // inside one step's command body would falsely inflate the count under
    // raw regex. With the masking helper the count reflects real chain calls
    // only, so the regression guard fires as expected.
    const original = workflowWithManySteps(12);
    const repairedWithStringNoise = [
      'import { workflow } from "@agent-relay/sdk/workflows";',
      '',
      'async function main() {',
      '  await workflow("collapsed-with-noise")',
      '    .description("Repair: minimal placeholder masquerading as a real workflow.")',
      '    .pattern("dag")',
      '    .channel("wf-ricky-noisy")',
      '    .step("only-real-step", {',
      '      type: "deterministic",',
      // Twelve .step("...") references buried inside a command HEREDOC,
      // designed to fool a naive regex into thinking the workflow has many
      // chain calls. The masking helper neutralizes them.
      '      command: `echo "this command mentions .step(\\"s1\\"), .step(\\"s2\\"), .step(\\"s3\\"), .step(\\"s4\\"), .step(\\"s5\\"), .step(\\"s6\\"), .step(\\"s7\\"), .step(\\"s8\\"), .step(\\"s9\\"), .step(\\"s10\\"), .step(\\"s11\\"), .step(\\"s12\\") but only one real chain call"`,',
      '    })',
      '    .run({ cwd: process.cwd() });',
      '}',
      '',
      'main().catch((error) => { console.error(error); process.exitCode = 1; });',
    ].join('\n');
    const regressions = detectWorkflowIntentRegressions(original, repairedWithStringNoise);
    expect(regressions.some((r) => r.includes('step count collapsed'))).toBe(true);
    expect(regressions.some((r) => /to\s+1\b/.test(r))).toBe(true);
  });

  it('does NOT pass when a repair smuggles createGitHubStep past the check via a // comment or string literal', () => {
    // A repair that removes the real `createGitHubStep` invocation but adds
    // a comment like "// Removed createGitHubStep" would fool a naive
    // includes() check. The masking helper strips comments so the regression
    // still fires.
    const original = workflowWithGithubShipping();
    const repairedWithCommentDecoy = [
      'import { workflow } from "@agent-relay/sdk/workflows";',
      '// Removed import of @agent-relay/github-primitive — see commit notes',
      '// createGitHubStep and GitHubStepExecutor no longer needed for this repair',
      '',
      'async function main() {',
      '  await workflow("decoy")',
      '    .description("Repair note mentions createGitHubStep in `command: \\"echo createGitHubStep\\"` but never invokes it.")',
      '    .pattern("dag")',
      '    .channel("wf-ricky-decoy")',
      '    .step("placeholder", { type: "deterministic", command: "echo \\"workflow without createGitHubStep\\"" })',
      '    .run({ cwd: process.cwd() });',
      '}',
      '',
      'main().catch((error) => { console.error(error); process.exitCode = 1; });',
    ].join('\n');
    const regressions = detectWorkflowIntentRegressions(original, repairedWithCommentDecoy);
    expect(regressions.some((r) => r.includes('@agent-relay/github-primitive'))).toBe(true);
    expect(regressions.some((r) => r.includes('GitHubStepExecutor'))).toBe(true);
    expect(regressions.some((r) => r.includes('createGitHubStep'))).toBe(true);
  });

  it('does NOT trip the github-primitive check when the original only mentions it inside a comment / string', () => {
    // The original never actually imports github-primitive — it just talks
    // about it in a comment. A repair that removes the comment is fine; the
    // mask layer means the guard never thought the import was there.
    const originalWithCommentOnly = [
      'import { workflow } from "@agent-relay/sdk/workflows";',
      '// Note: a future revision may want @agent-relay/github-primitive for shipping PRs.',
      '',
      'async function main() {',
      '  await workflow("commenty")',
      '    .description("createGitHubStep is mentioned here as a string literal only")',
      '    .step("just-one", { type: "deterministic", command: "echo ok" })',
      '    .run({ cwd: process.cwd() });',
      '}',
      'main().catch((e) => { console.error(e); process.exitCode = 1; });',
    ].join('\n');
    const repairedDropsComment = originalWithCommentOnly
      .replace('// Note: a future revision may want @agent-relay/github-primitive for shipping PRs.\n', '')
      .replace('createGitHubStep is mentioned here as a string literal only', 'no mentions anywhere');
    expect(detectWorkflowIntentRegressions(originalWithCommentOnly, repairedDropsComment)).toEqual([]);
  });

  it('reproduces the regression observed on 2026-05-15: parent spec with createGitHubStep gets replaced by 3-step placeholder stub', () => {
    // Reproduction case from the failing local run. The "repair" the LLM
    // emitted was a minimal master scaffold with prepare-context →
    // runtime-precheck: true → final-signoff: echo placeholder. The guard
    // must fire on this exact pattern.
    const original = workflowWithGithubShipping(/* steps */ 20);
    const repaired = repairStubFromObservedAutoFixFailure();
    const regressions = detectWorkflowIntentRegressions(original, repaired);
    expect(regressions.length).toBeGreaterThanOrEqual(2);
    expect(regressions.some((r) => /github-primitive|GitHubStepExecutor|createGitHubStep/.test(r))).toBe(true);
    expect(regressions.some((r) => r.includes('step count collapsed'))).toBe(true);
  });
});

function execution(output: string): WorkforcePersonaExecution {
  const promise = Promise.resolve({
    status: 'completed' as const,
    output,
    stderr: '',
    exitCode: 0,
    durationMs: 42,
    workflowRunId: 'persona-repair-run-1',
    stepName: 'agent-relay-workflow',
  }) as WorkforcePersonaExecution;
  Object.defineProperty(promise, 'runId', { value: Promise.resolve('persona-repair-run-1') });
  promise.cancel = () => {};
  return promise;
}

function workflowSource(name: string): string {
  return [
    'import { workflow } from "@agent-relay/sdk/workflows";',
    '',
    'async function main() {',
    `  await workflow("${name}")`,
    '    .description("Persona repaired workflow")',
    '    .pattern("pipeline")',
    '    .channel("wf-ricky-repair")',
    '    .step("verify", { type: "deterministic", command: "echo ok", verification: { type: "exit_code" } })',
    '    .run({ cwd: process.cwd() });',
    '}',
    '',
    'main().catch((error) => {',
    '  console.error(error);',
    '  process.exitCode = 1;',
    '});',
    '',
  ].join('\n');
}

function workflowWithGithubShipping(stepCount: number = 8): string {
  const steps = Array.from({ length: stepCount }, (_, idx) =>
    `    .step("impl-${idx + 1}", { type: "deterministic", command: "echo step-${idx + 1}" })`,
  ).join('\n');
  return [
    'import { workflow } from "@agent-relay/sdk/workflows";',
    'import { GitHubStepExecutor, createGitHubStep } from "@agent-relay/github-primitive";',
    '',
    'async function main() {',
    '  await workflow("ship-it")',
    '    .description("Ship a PR via the GitHub primitive")',
    '    .pattern("dag")',
    '    .channel("wf-ricky-ship")',
    steps,
    '    .step("open-pr", createGitHubStep({ name: "open-pr", action: "createPR", params: { head: "feat/foo", base: "main", title: "Ship fix" } }))',
    '    .step("verify", { type: "deterministic", command: "echo ok" })',
    '    .run({ cwd: process.cwd() });',
    '}',
    '',
    'main().catch((error) => { console.error(error); process.exitCode = 1; });',
  ].join('\n');
}

function workflowWithManySteps(stepCount: number): string {
  const steps = Array.from({ length: stepCount }, (_, idx) =>
    `    .step("s-${idx + 1}", { type: "deterministic", command: "echo ${idx + 1}" })`,
  ).join('\n');
  return [
    'import { workflow } from "@agent-relay/sdk/workflows";',
    '',
    'async function main() {',
    '  await workflow("many-steps")',
    '    .description("Original 12-step workflow")',
    '    .pattern("dag")',
    '    .channel("wf-ricky-many")',
    steps,
    '    .run({ cwd: process.cwd() });',
    '}',
    '',
    'main().catch((error) => { console.error(error); process.exitCode = 1; });',
  ].join('\n');
}

/**
 * Verbatim shape of the dummy stub the persona-driven repair returned on the
 * 2026-05-15 reproduction run (three deterministic placeholder steps,
 * `prepare-context` / `runtime-precheck: true` / `final-signoff: echo placeholder`).
 * Used as input to assert the regression guard fires.
 */
function repairStubFromObservedAutoFixFailure(): string {
  return [
    'import { workflow } from "@agent-relay/sdk/workflows";',
    '',
    '// Repair: simplified Ricky master workflow.',
    'async function main() {',
    '  await workflow("ricky-spec-cloud-dev-stack-skeleton")',
    '    .description("Repair master flow: minimal, bounded steps to re-enable precheck.")',
    '    .pattern("dag")',
    '    .channel("wf-ricky-repair")',
    '    .step("prepare-context", { type: "deterministic", command: "mkdir -p .workflow-artifacts" })',
    '    .step("runtime-precheck", { type: "deterministic", command: "true" })',
    '    .step("final-signoff", { type: "deterministic", command: "echo Ricky master signoff placeholder" })',
    '    .run({ cwd: process.cwd() });',
    '}',
    '',
    'main().catch((error) => { console.error(error); process.exitCode = 1; });',
  ].join('\n');
}
