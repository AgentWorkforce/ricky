/**
 * Ricky local/BYOH entrypoint proof surface.
 *
 * Proves the user-visible contract of the local entrypoint:
 * - Spec handoff from CLI, MCP, Claude-style structured handoff, and workflow artifact path
 * - Artifact, log, warning, and next-action response behavior
 * - Local runtime coordination through injectable command execution
 *
 * Each proof case is deterministic and bounded — no network, no filesystem,
 * no non-determinism. Evidence is user-visible text, not implementation trivia.
 */

import type {
  CliHandoff,
  ClaudeHandoff,
  LocalExecutor,
  LocalExecutorOptions,
  LocalInvocationRequest,
  LocalResponse,
  LocalResponseArtifact,
  McpHandoff,
  WorkflowArtifactHandoff,
} from '../index';
import { normalizeRequest, runLocal } from '../index';
import { generate } from '@ricky/product/generation/index';
import { intake } from '@ricky/product/spec-intake/index';
import type { CommandInvocation, CommandRunner, CommandRunnerOptions } from '@ricky/runtime/types';

// ---------------------------------------------------------------------------
// Proof types
// ---------------------------------------------------------------------------

export type ProofCaseName =
  | 'cli-spec-loop-proof'
  | 'cli-spec-handoff'
  | 'mcp-spec-handoff'
  | 'claude-structured-handoff'
  | 'workflow-artifact-handoff'
  | 'artifact-response-behavior'
  | 'log-response-behavior'
  | 'warning-response-behavior'
  | 'next-action-response-behavior'
  | 'local-runtime-coordination'
  | 'stubbed-runtime-seam-honesty'
  | 'cli-missing-spec-material'
  | 'error-path-normalization-failure'
  | 'cloud-mode-rejection';

export interface LocalProofCase {
  name: ProofCaseName;
  description: string;
  evaluate: () => Promise<LocalProofResult>;
}

export interface LocalProofResult {
  name: string;
  passed: boolean;
  evidence: string[];
  gaps: string[];
  failures: string[];
}

export interface LocalProofSummary {
  passed: boolean;
  failures: string[];
  gaps: string[];
}

interface ProofAssertion {
  label: string;
  passed: boolean;
}

// ---------------------------------------------------------------------------
// Test helpers — deterministic fakes
// ---------------------------------------------------------------------------

function mockExecutor(
  response?: Partial<LocalResponse>,
): LocalExecutor & { calls: LocalInvocationRequest[] } {
  const calls: LocalInvocationRequest[] = [];
  return {
    calls,
    async execute(request: LocalInvocationRequest): Promise<LocalResponse> {
      calls.push(request);
      return {
        ok: response?.ok ?? true,
        artifacts: response?.artifacts ?? [],
        logs: response?.logs ?? [`[mock] executed for ${request.source}`],
        warnings: response?.warnings ?? [],
        nextActions: response?.nextActions ?? [],
      };
    },
  };
}

function mockArtifactReader(content = '# Mock Workflow Spec') {
  return {
    async readArtifact(_path: string): Promise<string> {
      return content;
    },
  };
}

function failingArtifactReader(message = 'file not found') {
  return {
    async readArtifact(_path: string): Promise<string> {
      throw new Error(message);
    },
  };
}

function immediateCommandRunner(options: { exitCode?: number; stdout?: string[]; stderr?: string[] } = {}): CommandRunner {
  return {
    run(_command: string, _args: string[], _options: CommandRunnerOptions): CommandInvocation {
      const stdoutHandlers: Array<(line: string) => void> = [];
      const stderrHandlers: Array<(line: string) => void> = [];
      return {
        exitPromise: Promise.resolve().then(() => {
          for (const line of options.stdout ?? ['relay ok']) {
            stdoutHandlers.forEach((handler) => handler(line));
          }
          for (const line of options.stderr ?? []) {
            stderrHandlers.forEach((handler) => handler(line));
          }
          return options.exitCode ?? 0;
        }),
        onStdout(cb: (line: string) => void): void {
          stdoutHandlers.push(cb);
        },
        onStderr(cb: (line: string) => void): void {
          stderrHandlers.push(cb);
        },
        kill(): void {},
      };
    },
  };
}

function memoryLocalExecutorOptions(
  runnerOptions?: { exitCode?: number; stdout?: string[]; stderr?: string[] },
): LocalExecutorOptions & { writes: Array<{ path: string; content: string; cwd: string }> } {
  const writes: Array<{ path: string; content: string; cwd: string }> = [];
  return {
    cwd: '/repo',
    commandRunner: immediateCommandRunner(runnerOptions),
    writes,
    artifactWriter: {
      async writeArtifact(path: string, content: string, cwd: string): Promise<void> {
        writes.push({ path, content, cwd });
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Evidence helpers
// ---------------------------------------------------------------------------

function result(
  name: ProofCaseName,
  checks: boolean[],
  evidence: string[],
  gaps: string[] = [],
  failures: string[] = [],
): LocalProofResult {
  return {
    name,
    passed: checks.every(Boolean) && failures.length === 0,
    evidence,
    gaps,
    failures,
  };
}

function containsAll(output: string, expected: string[]): boolean {
  return expected.every((text) => output.includes(text));
}

function assertionFailures(assertions: ProofAssertion[]): string[] {
  return assertions.filter((assertion) => !assertion.passed).map((assertion) => assertion.label);
}

function cliSpecLoopHandoff(): CliHandoff {
  return {
    source: 'cli',
    requestId: 'req-local-cli-proof',
    cliMetadata: { argv: ['ricky', 'run', '--mode', 'local', '--spec'] },
    spec: {
      description:
        'generate a local workflow for packages/local/src/proof/local-entrypoint-proof.ts with deterministic validation evidence',
      targetFiles: [
        'packages/local/src/proof/local-entrypoint-proof.ts',
        'packages/local/src/proof/local-entrypoint-proof.test.ts',
        'packages/local/src/entrypoint.test.ts',
        'packages/cli/src/entrypoint/interactive-cli.test.ts',
      ],
      acceptanceGates: [
        'npx vitest run packages/local/src/proof/local-entrypoint-proof.test.ts packages/local/src/entrypoint.test.ts packages/cli/src/entrypoint/interactive-cli.test.ts',
      ],
      evidenceRequirements: [
        'normalized request',
        'generated artifact metadata',
        'validator result',
        'user-facing response',
      ],
    },
  };
}

// ---------------------------------------------------------------------------
// Proof cases
// ---------------------------------------------------------------------------

export function getLocalProofCases(): LocalProofCase[] {
  return [
    {
      name: 'cli-spec-loop-proof',
      description:
        'A local CLI spec becomes a normalized request, generated artifact metadata, validation result, and user response.',
      async evaluate() {
        const handoff = cliSpecLoopHandoff();
        const normalized = await normalizeRequest(handoff);

        const intakeResult = intake({
          kind: 'structured_json',
          surface: 'cli',
          receivedAt: '2026-04-27T00:00:00.000Z',
          requestId: normalized.requestId,
          data: normalized.structuredSpec ?? { description: normalized.spec },
          metadata: {
            ...normalized.metadata,
            mode: normalized.mode,
          },
        });

        const generationResult = intakeResult.routing
          ? generate({
              spec: {
                ...intakeResult.routing.normalizedSpec,
                executionPreference: 'local',
              },
              dryRunEnabled: true,
            })
          : null;

        const localExecutor = memoryLocalExecutorOptions();
        localExecutor.returnGeneratedArtifactOnly = true;
        const response = await runLocal(handoff, { localExecutor });

        const artifact = generationResult?.artifact;
        const validator = generationResult?.validation;
        const responseArtifact = response.artifacts[0];
        const logsText = response.logs.join('\n');
        const nextActionsText = response.nextActions.join(' | ');

        const assertions: ProofAssertion[] = [
          {
            label: 'normalized request keeps CLI source, local mode, request id, and structured spec',
            passed:
              normalized.source === 'cli' &&
              normalized.mode === 'local' &&
              normalized.requestId === 'req-local-cli-proof' &&
              normalized.structuredSpec !== undefined &&
              normalized.spec.includes('local workflow'),
          },
          {
            label: 'generation produces artifact metadata with local workflow identity and gates',
            passed:
              intakeResult.routing?.target === 'generate' &&
              generationResult?.success === true &&
              artifact?.workflowId.startsWith('ricky-') === true &&
              artifact?.channel.startsWith('wf-ricky-') === true &&
              (artifact?.taskCount ?? 0) > 0 &&
              (artifact?.gateCount ?? 0) > 0,
          },
          {
            label: 'validator result approves the generated artifact with deterministic gates and review stage',
            passed:
              validator?.valid === true &&
              validator.errors.length === 0 &&
              validator.hasDeterministicGates === true &&
              validator.hasReviewStage === true,
          },
          {
            label: 'user-facing response returns generated artifact metadata and next actions',
            passed:
              response.ok === true &&
              responseArtifact?.path === artifact?.artifactPath &&
              responseArtifact?.type === 'text/typescript' &&
              responseArtifact?.content?.includes('workflow(') === true &&
              localExecutor.writes.length === 1 &&
              nextActionsText.includes('Run the generated workflow locally'),
          },
          {
            label: 'proof stays local and deterministic without Cloud credentials or live runtime',
            passed:
              !logsText.includes('Cloud API surface') &&
              logsText.includes('[local] runtime launch skipped') &&
              localExecutor.writes[0]?.cwd === '/repo',
          },
        ];

        return result(
          'cli-spec-loop-proof',
          assertions.map((assertion) => assertion.passed),
          [
            `normalized request: source=${normalized.source} mode=${normalized.mode} requestId=${normalized.requestId}`,
            `normalized spec: ${normalized.spec}`,
            `generated artifact metadata: path=${artifact?.artifactPath} workflowId=${artifact?.workflowId} channel=${artifact?.channel} pattern=${artifact?.pattern} tasks=${artifact?.taskCount} gates=${artifact?.gateCount}`,
            `validator result: valid=${validator?.valid} errors=${validator?.errors.length} warnings=${validator?.warnings.length} deterministicGates=${validator?.hasDeterministicGates} reviewStage=${validator?.hasReviewStage}`,
            `user response: ok=${response.ok} artifactCount=${response.artifacts.length} writeCount=${localExecutor.writes.length}`,
            `user response artifact: path=${responseArtifact?.path} type=${responseArtifact?.type} contentIncludesWorkflow=${responseArtifact?.content?.includes('workflow(') === true}`,
            `user next actions: ${nextActionsText}`,
            `no Cloud credentials required: ${!logsText.includes('Cloud API surface')}`,
          ],
          [],
          assertionFailures(assertions),
        );
      },
    },
    {
      name: 'cli-spec-handoff',
      description: 'CLI handoff normalizes and reaches the executor with source, spec, and local mode.',
      async evaluate() {
        const executor = mockExecutor();
        const handoff: CliHandoff = { source: 'cli', spec: 'build a pipeline', specFile: '/tmp/spec.md' };
        const response = await runLocal(handoff, { executor });

        const req = executor.calls[0];
        const checks = [
          response.ok === true,
          req !== undefined,
          req?.source === 'cli',
          req?.spec === 'build a pipeline',
          req?.mode === 'local',
          req?.specPath === '/tmp/spec.md',
        ];

        return result('cli-spec-handoff', checks, [
          `source: ${req?.source}`,
          `spec: ${req?.spec}`,
          `mode: ${req?.mode}`,
          `specPath: ${req?.specPath}`,
          `ok: ${response.ok}`,
        ]);
      },
    },
    {
      name: 'mcp-spec-handoff',
      description: 'MCP handoff normalizes with metadata and reaches the executor.',
      async evaluate() {
        const executor = mockExecutor();
        const handoff: McpHandoff = {
          source: 'mcp',
          spec: 'deploy service',
          mcpMetadata: { toolCallId: 'abc-123' },
        };
        const response = await runLocal(handoff, { executor });

        const req = executor.calls[0];
        const checks = [
          response.ok === true,
          req?.source === 'mcp',
          req?.spec === 'deploy service',
          req?.mode === 'local',
          JSON.stringify(req?.metadata) === JSON.stringify({ toolCallId: 'abc-123' }),
        ];

        return result('mcp-spec-handoff', checks, [
          `source: ${req?.source}`,
          `spec: ${req?.spec}`,
          `metadata: ${JSON.stringify(req?.metadata)}`,
          `ok: ${response.ok}`,
        ]);
      },
    },
    {
      name: 'claude-structured-handoff',
      description: 'Claude-style structured handoff carries conversation context through to the executor.',
      async evaluate() {
        const executor = mockExecutor();
        const handoff: ClaudeHandoff = {
          source: 'claude',
          spec: 'run tests',
          conversationId: 'conv-1',
          turnId: 'turn-5',
        };
        const response = await runLocal(handoff, { executor });

        const req = executor.calls[0];
        const checks = [
          response.ok === true,
          req?.source === 'claude',
          req?.spec === 'run tests',
          req?.mode === 'local',
          req?.metadata?.conversationId === 'conv-1',
          req?.metadata?.turnId === 'turn-5',
        ];

        return result('claude-structured-handoff', checks, [
          `source: ${req?.source}`,
          `spec: ${req?.spec}`,
          `metadata: ${JSON.stringify(req?.metadata)}`,
          `ok: ${response.ok}`,
        ]);
      },
    },
    {
      name: 'workflow-artifact-handoff',
      description: 'Workflow artifact handoff resolves the spec from disk and passes it to the executor.',
      async evaluate() {
        const executor = mockExecutor();
        const reader = mockArtifactReader('# Real Workflow Spec');
        const handoff: WorkflowArtifactHandoff = {
          source: 'workflow-artifact',
          artifactPath: '/artifacts/wf.md',
        };
        const response = await runLocal(handoff, { executor, artifactReader: reader });

        const req = executor.calls[0];
        const checks = [
          response.ok === true,
          req?.source === 'workflow-artifact',
          req?.spec === '# Real Workflow Spec',
          req?.specPath === '/artifacts/wf.md',
          req?.mode === 'local',
        ];

        return result('workflow-artifact-handoff', checks, [
          `source: ${req?.source}`,
          `spec: ${req?.spec}`,
          `specPath: ${req?.specPath}`,
          `ok: ${response.ok}`,
        ]);
      },
    },
    {
      name: 'artifact-response-behavior',
      description: 'Executor artifacts are returned verbatim in the local response contract.',
      async evaluate() {
        const artifact: LocalResponseArtifact = {
          path: 'out/workflow.ts',
          type: 'text/typescript',
          content: 'export const wf = {};',
        };
        const executor = mockExecutor({ artifacts: [artifact] });
        const response = await runLocal({ source: 'cli', spec: 'build' }, { executor });

        const a = response.artifacts[0];
        const checks = [
          response.artifacts.length === 1,
          a?.path === 'out/workflow.ts',
          a?.type === 'text/typescript',
          a?.content === 'export const wf = {};',
        ];

        return result('artifact-response-behavior', checks, [
          `artifact count: ${response.artifacts.length}`,
          `path: ${a?.path}`,
          `type: ${a?.type}`,
          `content present: ${a?.content !== undefined}`,
        ]);
      },
    },
    {
      name: 'log-response-behavior',
      description: 'Executor logs are returned in the local response contract.',
      async evaluate() {
        const executor = mockExecutor({ logs: ['[gen] started', '[gen] complete'] });
        const response = await runLocal({ source: 'cli', spec: 'build' }, { executor });

        const checks = [
          response.logs.length === 2,
          response.logs[0] === '[gen] started',
          response.logs[1] === '[gen] complete',
        ];

        return result('log-response-behavior', checks, [
          `log count: ${response.logs.length}`,
          `logs: ${response.logs.join(' | ')}`,
        ]);
      },
    },
    {
      name: 'warning-response-behavior',
      description: 'Executor warnings are surfaced, and Cloud-only local requests return entrypoint warnings.',
      async evaluate() {
        const executor = mockExecutor({ warnings: ['check permissions'] });
        const response = await runLocal({ source: 'cli', spec: 'build' }, { executor });

        // Also test entrypoint-level warning for cloud mode before runtime execution.
        const cloudExecutor = mockExecutor({ warnings: ['executor warning'] });
        const cloudResponse = await runLocal(
          { source: 'cli', spec: 'test', mode: 'cloud' },
          { executor: cloudExecutor },
        );

        const checks = [
          response.warnings.length === 1,
          response.warnings[0] === 'check permissions',
          cloudResponse.ok === false,
          cloudResponse.warnings.some((w) => w.includes('local/BYOH entrypoint')),
          cloudExecutor.calls.length === 0,
        ];

        return result('warning-response-behavior', checks, [
          `local warning count: ${response.warnings.length}`,
          `local warning: ${response.warnings[0]}`,
          `cloud warning count: ${cloudResponse.warnings.length}`,
          `cloud warnings include entrypoint warning: ${cloudResponse.warnings.some((w) => w.includes('local/BYOH'))}`,
          `cloud executor reached: ${cloudExecutor.calls.length > 0}`,
        ]);
      },
    },
    {
      name: 'next-action-response-behavior',
      description: 'Executor next-actions are returned in the local response contract.',
      async evaluate() {
        const executor = mockExecutor({ nextActions: ['run the workflow', 'check output'] });
        const response = await runLocal({ source: 'cli', spec: 'build' }, { executor });

        const checks = [
          response.nextActions.length === 2,
          response.nextActions[0] === 'run the workflow',
          response.nextActions[1] === 'check output',
        ];

        return result('next-action-response-behavior', checks, [
          `next-action count: ${response.nextActions.length}`,
          `next-actions: ${response.nextActions.join(' | ')}`,
        ]);
      },
    },
    {
      name: 'local-runtime-coordination',
      description:
        'The default local executor performs intake, generation, artifact writing, and local runtime coordination.',
      async evaluate() {
        const localExecutor = memoryLocalExecutorOptions();
        const response = await runLocal(
          { source: 'cli', spec: 'generate a local workflow for src/local/entrypoint.ts with tests' },
          { localExecutor },
        );

        const logsText = response.logs.join('\n');
        const artifact = response.artifacts[0];
        const checks = [
          response.ok === true,
          containsAll(logsText, [
            '[local] received spec from cli',
            '[local] spec intake route: generate',
            '[local] workflow generation: passed',
            '[local] runtime status: passed',
          ]),
          localExecutor.writes.length === 1,
          artifact?.content?.includes('workflow(') === true,
        ];

        return result('local-runtime-coordination', checks, [
          `ok: ${response.ok}`,
          `artifact writes: ${localExecutor.writes.length}`,
          `artifact path: ${artifact?.path}`,
          `artifact content has workflow(): ${artifact?.content?.includes('workflow(') === true}`,
          `logs: ${response.logs.join(' | ')}`,
        ]);
      },
    },
    {
      name: 'stubbed-runtime-seam-honesty',
      description:
        'The local executor is an injectable seam. The proof surface exercises the contract through ' +
        'deterministic fakes — not a real agent-relay process. This case explicitly documents what ' +
        'is proven (normalization, response shape, pipeline wiring) and what is not (real subprocess ' +
        'lifecycle, actual npx resolution, network I/O).',
      async evaluate() {
        // The executor seam is the interface boundary — prove it is injectable and
        // that the default executor uses the same injectable adapters.
        const executor = mockExecutor({ logs: ['[seam] stubbed'] });
        const response = await runLocal({ source: 'cli', spec: 'test seam' }, { executor });

        // The real executor path goes through intake → generation → coordinator,
        // but every external side-effect (artifact writes, command spawns) is
        // behind an injectable adapter — prove that adapters are what get called.
        const localExecutor = memoryLocalExecutorOptions();
        const realPathResponse = await runLocal(
          { source: 'cli', spec: 'generate a local workflow for src/local/entrypoint.ts with tests' },
          { localExecutor },
        );

        const gaps = [
          'Real agent-relay subprocess lifecycle is not exercised — commandRunner is a deterministic fake.',
          'npx --no-install resolution against a real node_modules tree is not proven.',
          'Filesystem artifact writes use an in-memory writer, not real disk I/O.',
        ];

        const checks = [
          // Injectable executor seam works
          response.ok === true,
          response.logs[0] === '[seam] stubbed',
          executor.calls.length === 1,
          // Real executor path uses injectable adapters, not real side-effects
          realPathResponse.ok === true,
          localExecutor.writes.length === 1,
          // The contract is proven; the runtime is not
        ];

        return result('stubbed-runtime-seam-honesty', checks, [
          `injectable executor seam: ${executor.calls.length === 1}`,
          `stubbed executor log: ${response.logs[0]}`,
          `real path through injectable adapters: ${realPathResponse.ok}`,
          `artifact writes via adapter: ${localExecutor.writes.length}`,
          `HONEST GAP: ${gaps[0]}`,
          `HONEST GAP: ${gaps[1]}`,
          `HONEST GAP: ${gaps[2]}`,
        ], gaps);
      },
    },
    {
      name: 'error-path-normalization-failure',
      description: 'When artifact read fails, the response is ok=false with actionable logs, warnings, and next-actions.',
      async evaluate() {
        const executor = mockExecutor();
        const reader = failingArtifactReader('ENOENT: no such file');
        const response = await runLocal(
          { source: 'workflow-artifact', artifactPath: '/missing.md' },
          { executor, artifactReader: reader },
        );

        const checks = [
          response.ok === false,
          response.logs.length > 0,
          response.logs[0].includes('normalization failed'),
          response.logs[0].includes('ENOENT'),
          response.warnings[0].includes("source 'workflow-artifact'"),
          response.nextActions[0].includes('retry'),
          executor.calls.length === 0,
        ];

        return result('error-path-normalization-failure', checks, [
          `ok: ${response.ok}`,
          `log: ${response.logs[0]}`,
          `warning: ${response.warnings[0]}`,
          `next-action: ${response.nextActions[0]}`,
          `executor reached: ${executor.calls.length > 0}`,
        ]);
      },
    },
    {
      name: 'cli-missing-spec-material',
      description: 'A malformed CLI handoff without spec material fails before local execution with actionable guidance.',
      async evaluate() {
        const executor = mockExecutor();
        const response = await runLocal(
          { source: 'cli' } as unknown as CliHandoff,
          { executor },
        );

        const assertions: ProofAssertion[] = [
          { label: 'missing CLI spec returns ok=false', passed: response.ok === false },
          {
            label: 'normalization failure is surfaced in logs',
            passed: response.logs[0]?.includes('normalization failed') === true,
          },
          {
            label: 'warning identifies CLI handoff source',
            passed: response.warnings[0]?.includes("source 'cli'") === true,
          },
          {
            label: 'next action tells user to check spec content or artifact path',
            passed: response.nextActions[0]?.includes('Check the spec content or artifact path') === true,
          },
          { label: 'executor is not reached after missing spec material', passed: executor.calls.length === 0 },
        ];

        return result(
          'cli-missing-spec-material',
          assertions.map((assertion) => assertion.passed),
          [
            `ok: ${response.ok}`,
            `log: ${response.logs[0]}`,
            `warning: ${response.warnings[0]}`,
            `next-action: ${response.nextActions[0]}`,
            `executor reached: ${executor.calls.length > 0}`,
          ],
          [],
          assertionFailures(assertions),
        );
      },
    },
    {
      name: 'cloud-mode-rejection',
      description: 'Cloud mode on the local entrypoint is rejected before runtime execution.',
      async evaluate() {
        // Default executor path — rejects cloud mode with ok=false
        const defaultResponse = await runLocal({ source: 'cli', spec: 'test', mode: 'cloud' });

        // Injected executor path — entrypoint rejects before reaching runtime seam
        const executor = mockExecutor();
        const injectedResponse = await runLocal(
          { source: 'cli', spec: 'test', mode: 'cloud' },
          { executor },
        );

        const checks = [
          defaultResponse.ok === false,
          defaultResponse.warnings.some((w) => w.includes('local/BYOH entrypoint')),
          defaultResponse.nextActions.some((a) => a.includes('Cloud API') || a.includes('re-invoke')),
          injectedResponse.ok === false,
          injectedResponse.warnings.some((w) => w.includes('local/BYOH entrypoint')),
          executor.calls.length === 0,
        ];

        return result('cloud-mode-rejection', checks, [
          `default executor ok: ${defaultResponse.ok}`,
          `default warns about local entrypoint: ${defaultResponse.warnings.some((w) => w.includes('local/BYOH'))}`,
          `default next-actions suggest Cloud API: ${defaultResponse.nextActions.some((a) => a.includes('Cloud API') || a.includes('re-invoke'))}`,
          `injected executor ok: ${injectedResponse.ok}`,
          `injected executor warns about local entrypoint: ${injectedResponse.warnings.some((w) => w.includes('local/BYOH'))}`,
          `injected executor reached: ${executor.calls.length > 0}`,
        ]);
      },
    },
  ];
}

// ---------------------------------------------------------------------------
// Evaluation API
// ---------------------------------------------------------------------------

export async function evaluateLocalProof(): Promise<LocalProofResult[]> {
  const cases = getLocalProofCases();
  const results: LocalProofResult[] = [];
  for (const proofCase of cases) {
    results.push(await proofCase.evaluate());
  }
  return results;
}

export async function evaluateLocalProofCase(name: ProofCaseName): Promise<LocalProofResult> {
  const proofCase = getLocalProofCases().find((candidate) => candidate.name === name);
  if (!proofCase) {
    throw new Error(`Unknown local proof case: ${name}`);
  }
  return proofCase.evaluate();
}

export async function summarizeLocalProof(): Promise<LocalProofSummary> {
  const results = await evaluateLocalProof();
  const failures = results.flatMap((r) =>
    r.passed ? [] : [`${r.name}: ${r.failures.join('; ') || 'contract assertion failed'}`],
  );
  const gaps = results.flatMap((r) => r.gaps.map((gap) => `${r.name}: ${gap}`));

  return {
    passed: failures.length === 0,
    failures,
    gaps,
  };
}
