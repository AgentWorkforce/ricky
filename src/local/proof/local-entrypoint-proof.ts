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
import type { CommandInvocation, CommandRunner, CommandRunnerOptions } from '../../runtime/types';

// ---------------------------------------------------------------------------
// Proof types
// ---------------------------------------------------------------------------

export type ProofCaseName =
  | 'cli-spec-handoff'
  | 'mcp-spec-handoff'
  | 'claude-structured-handoff'
  | 'workflow-artifact-handoff'
  | 'artifact-response-behavior'
  | 'log-response-behavior'
  | 'warning-response-behavior'
  | 'next-action-response-behavior'
  | 'local-runtime-coordination'
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

// ---------------------------------------------------------------------------
// Proof cases
// ---------------------------------------------------------------------------

export function getLocalProofCases(): LocalProofCase[] {
  return [
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
      description: 'Executor warnings and entrypoint-level warnings are both surfaced.',
      async evaluate() {
        const executor = mockExecutor({ warnings: ['check permissions'] });
        const response = await runLocal({ source: 'cli', spec: 'build' }, { executor });

        // Also test entrypoint-level warning injection for cloud mode
        const cloudExecutor = mockExecutor({ warnings: ['executor warning'] });
        const cloudResponse = await runLocal(
          { source: 'cli', spec: 'test', mode: 'cloud' },
          { executor: cloudExecutor },
        );

        const checks = [
          response.warnings.length === 1,
          response.warnings[0] === 'check permissions',
          cloudResponse.warnings.some((w) => w.includes('local/BYOH entrypoint')),
          cloudResponse.warnings.some((w) => w === 'executor warning'),
        ];

        return result('warning-response-behavior', checks, [
          `local warning count: ${response.warnings.length}`,
          `local warning: ${response.warnings[0]}`,
          `cloud warning count: ${cloudResponse.warnings.length}`,
          `cloud warnings include entrypoint warning: ${cloudResponse.warnings.some((w) => w.includes('local/BYOH'))}`,
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
      name: 'cloud-mode-rejection',
      description: 'Cloud mode on the local entrypoint surfaces a warning and the default executor rejects it.',
      async evaluate() {
        // Default executor path — rejects cloud mode with ok=false
        const defaultResponse = await runLocal({ source: 'cli', spec: 'test', mode: 'cloud' });

        // Injected executor path — entrypoint still warns
        const executor = mockExecutor();
        const injectedResponse = await runLocal(
          { source: 'cli', spec: 'test', mode: 'cloud' },
          { executor },
        );

        const checks = [
          defaultResponse.ok === false,
          defaultResponse.warnings.some((w) => w.includes('local/BYOH entrypoint')),
          defaultResponse.nextActions.some((a) => a.includes('Cloud API') || a.includes('re-invoke')),
          injectedResponse.warnings.some((w) => w.includes('local/BYOH entrypoint')),
        ];

        return result('cloud-mode-rejection', checks, [
          `default executor ok: ${defaultResponse.ok}`,
          `default warns about local entrypoint: ${defaultResponse.warnings.some((w) => w.includes('local/BYOH'))}`,
          `default next-actions suggest Cloud API: ${defaultResponse.nextActions.some((a) => a.includes('Cloud API') || a.includes('re-invoke'))}`,
          `injected executor warns about local entrypoint: ${injectedResponse.warnings.some((w) => w.includes('local/BYOH'))}`,
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
