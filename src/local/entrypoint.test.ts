import { describe, expect, it, vi } from 'vitest';

import type {
  CliHandoff,
  ClaudeHandoff,
  LocalExecutorOptions,
  LocalEntrypointInput,
  LocalExecutionStageResult,
  LocalGenerationStageResult,
  LocalExecutor,
  LocalInvocationRequest,
  LocalResponse,
  LocalStageMode,
  McpHandoff,
  RawHandoff,
  StructuredSpecHandoff,
  WorkflowArtifactHandoff,
} from './index.js';
import { DEFAULT_LOCAL_ROUTE, normalizeRequest, runLocal } from './index.js';
import { appendCoordinatorLogs } from './entrypoint.js';
import type {
  CommandInvocation,
  CommandRunner,
  CommandRunnerOptions,
  CoordinatorResult,
  RunRequest,
} from '../runtime/types.js';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** A deterministic executor that records calls and returns a canned response. */
function mockExecutor(
  response?: Partial<LocalResponse>,
): LocalExecutor & { calls: LocalInvocationRequest[] } {
  const calls: LocalInvocationRequest[] = [];
  return {
    calls,
    async execute(request: LocalInvocationRequest): Promise<LocalResponse> {
      calls.push(request);
      return {
        ok: true,
        artifacts: response?.artifacts ?? [],
        logs: response?.logs ?? [`[mock] executed for ${request.source}`],
        warnings: response?.warnings ?? [],
        nextActions: response?.nextActions ?? [],
      };
    },
  };
}

/** A deterministic artifact reader that returns a canned spec. */
function mockArtifactReader(content = '# Mock Workflow Spec') {
  return {
    async readArtifact(_path: string): Promise<string> {
      return content;
    },
  };
}

/** A deterministic artifact reader that records which path was consumed. */
function recordingArtifactReader(content = '# Mock Workflow Spec') {
  const reads: string[] = [];
  return {
    reads,
    async readArtifact(path: string): Promise<string> {
      reads.push(path);
      return content;
    },
  };
}

/** A failing artifact reader for error-path tests. */
function failingArtifactReader(message = 'file not found') {
  return {
    async readArtifact(_path: string): Promise<string> {
      throw new Error(message);
    },
  };
}

interface RecordedInvocation {
  command: string;
  args: string[];
  cwd: string;
}

interface RecordedWrite {
  path: string;
  content: string;
  cwd: string;
}

function workflowArtifactWrites<T extends RecordedWrite>(writes: T[]): T[] {
  return writes.filter((write) => /^workflows\/generated\/.+\.ts$/.test(write.path));
}

function pidIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForPidFile(path: string, timeoutMs = 2_000): Promise<number> {
  const { readFile } = await import('node:fs/promises');
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const pid = Number((await readFile(path, 'utf8')).trim());
      if (Number.isFinite(pid)) return pid;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw lastError instanceof Error ? lastError : new Error(`Timed out waiting for pid file: ${path}`);
}

function generationMetadataWrites<T extends RecordedWrite>(writes: T[]): T[] {
  return writes.filter((write) => write.path.startsWith('.workflow-artifacts/generated/'));
}

function immediateCommandRunner(
  options: { exitCode?: number; stdout?: string[]; stderr?: string[] } = {},
): CommandRunner & { invocations: RecordedInvocation[] } {
  const invocations: RecordedInvocation[] = [];
  return {
    invocations,
    run(command: string, args: string[], runOptions: CommandRunnerOptions): CommandInvocation {
      invocations.push({ command, args: [...args], cwd: runOptions.cwd });
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
  runnerOptions?: { exitCode?: number; stdout?: string[]; stderr?: string[]; cwd?: string },
): LocalExecutorOptions & {
  writes: RecordedWrite[];
  runner: CommandRunner & { invocations: RecordedInvocation[] };
} {
  const writes: RecordedWrite[] = [];
  const runner = immediateCommandRunner(runnerOptions);
  return {
    cwd: runnerOptions?.cwd ?? '/repo',
    commandRunner: runner,
    runner,
    writes,
    artifactWriter: {
      async writeArtifact(path: string, content: string, cwd: string): Promise<void> {
        writes.push({ path, content, cwd });
      },
    },
  };
}

function throwingCommandRunner(message: string): CommandRunner & { invocations: RecordedInvocation[] } {
  const invocations: RecordedInvocation[] = [];
  return {
    invocations,
    run(command: string, args: string[], runOptions: CommandRunnerOptions): CommandInvocation {
      invocations.push({ command, args: [...args], cwd: runOptions.cwd });
      throw new Error(message);
    },
  };
}

function coordinatorResult(request: RunRequest, overrides: Partial<CoordinatorResult> = {}): CoordinatorResult {
  const stdout = overrides.stdout ?? ['coordinator ok'];
  const stderr = overrides.stderr ?? [];
  const baseArgs = request.route?.baseArgs ?? ['run'];
  const status = overrides.status ?? 'passed';
  const startedAt = '2026-01-01T00:00:00.000Z';
  const completedAt = '2026-01-01T00:00:01.000Z';

  return {
    runId: overrides.runId ?? 'run-local-test',
    workflowFile: request.workflowFile,
    cwd: request.cwd,
    status,
    exitCode: overrides.exitCode ?? (status === 'passed' ? 0 : 1),
    startedAt,
    completedAt,
    endedAt: completedAt,
    durationMs: 1000,
    stdout,
    stderr,
    stdoutSnippet: {
      lines: stdout,
      totalLines: stdout.length,
      maxLines: stdout.length,
      truncated: false,
    },
    stderrSnippet: {
      lines: stderr,
      totalLines: stderr.length,
      maxLines: stderr.length,
      truncated: false,
    },
    events: [],
    retry: { attempt: 1 },
    invocation: {
      command: request.route?.command ?? 'agent-relay',
      args: [...baseArgs, request.workflowFile, ...(request.extraArgs ?? [])],
      cwd: request.cwd,
    },
    metadata: request.metadata,
    error: overrides.error,
  };
}

function expectNoTurnContextFallback(logs: string[]): void {
  expect(logs.some((line) => line.startsWith('[local] turn context adapter skipped:'))).toBe(false);
}

// ---------------------------------------------------------------------------
// normalizeRequest
// ---------------------------------------------------------------------------

describe('normalizeRequest', () => {
  it('normalizes a CLI handoff with inline spec', async () => {
    const raw: CliHandoff = { source: 'cli', spec: 'build a pipeline', invocationRoot: '/repo-root' };
    const result = await normalizeRequest(raw);

    expect(result.source).toBe('cli');
    expect(result.spec).toBe('build a pipeline');
    expect(result.mode).toBe('local');
    expect(result.invocationRoot).toBe('/repo-root');
    expect(result.metadata).toEqual({});
  });

  it('normalizes a relative invocationRoot to an absolute local request root', async () => {
    const { isAbsolute } = await import('node:path');
    const raw: CliHandoff = {
      source: 'cli',
      spec: 'build a pipeline',
      invocationRoot: './relative-repo-root',
    };
    const result = await normalizeRequest(raw);

    expect(result.invocationRoot).toMatch(/relative-repo-root$/);
    expect(result.invocationRoot).not.toBe('./relative-repo-root');
    expect(isAbsolute(result.invocationRoot!)).toBe(true);
  });

  it('normalizes a CLI handoff with spec file path', async () => {
    const raw: CliHandoff = {
      source: 'cli',
      spec: 'inline content',
      specFile: '/tmp/spec.md',
    };
    const result = await normalizeRequest(raw);

    expect(result.specPath).toBe('/tmp/spec.md');
  });

  it('normalizes a CLI structured handoff with request metadata and explicit local mode', async () => {
    const raw: CliHandoff = {
      source: 'cli',
      spec: {
        goal: 'generate a local workflow',
        workflowFile: 'workflows/local-entrypoint.workflow.ts',
      },
      cliMetadata: { argv: ['ricky', 'run'] },
      requestId: 'req-cli-1',
    };
    const result = await normalizeRequest(raw);

    expect(result.source).toBe('cli');
    expect(result.spec).toBe('generate a local workflow');
    expect(result.structuredSpec).toEqual(raw.spec);
    expect(result.mode).toBe('local');
    expect(result.metadata).toEqual({ argv: ['ricky', 'run'] });
    expect(result.sourceMetadata).toEqual({
      cli: {
        argv: ['ricky', 'run'],
      },
    });
    expect(result.requestId).toBe('req-cli-1');
  });

  it('normalizes an MCP handoff with metadata', async () => {
    const raw: McpHandoff = {
      source: 'mcp',
      spec: 'deploy service',
      mcpMetadata: { toolCallId: 'abc-123' },
    };
    const result = await normalizeRequest(raw);

    expect(result.source).toBe('mcp');
    expect(result.spec).toBe('deploy service');
    expect(result.mode).toBe('local');
    expect(result.metadata).toEqual({ toolCallId: 'abc-123' });
  });

  it('normalizes an MCP handoff from tool arguments when no spec is provided', async () => {
    const raw: McpHandoff = {
      source: 'mcp',
      toolName: 'ricky.generate',
      arguments: {
        goal: 'generate a local workflow',
        workflowFile: 'workflows/local.workflow.ts',
      },
      mcpMetadata: { toolCallId: 'tool-1' },
    };
    const result = await normalizeRequest(raw);

    expect(result.source).toBe('mcp');
    expect(result.spec).toBe('generate a local workflow');
    expect(result.structuredSpec).toEqual(raw.arguments);
    expect(result.mode).toBe('local');
    expect(result.metadata).toEqual({ toolCallId: 'tool-1', toolName: 'ricky.generate' });
    expect(result.sourceMetadata).toEqual({
      mcp: {
        toolCallId: 'tool-1',
        toolName: 'ricky.generate',
      },
    });
  });

  it('normalizes a free-form spec handoff', async () => {
    const result = await normalizeRequest({
      source: 'free-form',
      spec: 'generate a workflow',
      metadata: { caller: 'test' },
    });

    expect(result.source).toBe('free-form');
    expect(result.spec).toBe('generate a workflow');
    expect(result.metadata).toEqual({ caller: 'test' });
  });

  it('normalizes a structured spec handoff without losing the object payload', async () => {
    const raw: StructuredSpecHandoff = {
      source: 'structured',
      spec: {
        intent: 'generate',
        description: 'generate a workflow for local runtime',
        targetFiles: ['src/local/entrypoint.ts'],
      },
    };
    const result = await normalizeRequest(raw);

    expect(result.source).toBe('structured');
    expect(result.spec).toBe('generate a workflow for local runtime');
    expect(result.structuredSpec).toEqual(raw.spec);
  });

  it('normalizes a Claude handoff with conversation context', async () => {
    const raw: ClaudeHandoff = {
      source: 'claude',
      spec: 'run tests',
      conversationId: 'conv-1',
      turnId: 'turn-5',
    };
    const result = await normalizeRequest(raw);

    expect(result.source).toBe('claude');
    expect(result.spec).toBe('run tests');
    expect(result.mode).toBe('local');
    expect(result.metadata).toEqual({ conversationId: 'conv-1', turnId: 'turn-5' });
    expect(result.sourceMetadata).toEqual({
      claude: {
        conversationId: 'conv-1',
        turnId: 'turn-5',
      },
    });
  });

  it('normalizes a Claude handoff without optional fields', async () => {
    const raw: ClaudeHandoff = { source: 'claude', spec: 'generate workflow' };
    const result = await normalizeRequest(raw);

    expect(result.metadata).toEqual({});
  });

  it('normalizes a Claude structured spec handoff for downstream generation', async () => {
    const raw: ClaudeHandoff = {
      source: 'claude',
      spec: {
        description: 'generate a local proof workflow',
        targetFiles: ['packages/local/src/entrypoint.ts'],
      },
      conversationId: 'conv-2',
      turnId: 'turn-9',
    };
    const result = await normalizeRequest(raw);

    expect(result.source).toBe('claude');
    expect(result.spec).toBe('generate a local proof workflow');
    expect(result.structuredSpec).toEqual(raw.spec);
    expect(result.mode).toBe('local');
    expect(result.metadata).toEqual({ conversationId: 'conv-2', turnId: 'turn-9' });
  });

  it('normalizes a workflow artifact handoff by reading the artifact', async () => {
    const raw: WorkflowArtifactHandoff = {
      source: 'workflow-artifact',
      artifactPath: '/artifacts/wf.md',
    };
    const reader = mockArtifactReader('# Real Workflow');
    const result = await normalizeRequest(raw, reader);

    expect(result.source).toBe('workflow-artifact');
    expect(result.spec).toBe('# Real Workflow');
    expect(result.specPath).toBe('/artifacts/wf.md');
    expect(result.mode).toBe('local');
  });

  it('reads relative workflow artifacts from invocationRoot while preserving the relative run target', async () => {
    const raw: WorkflowArtifactHandoff = {
      source: 'workflow-artifact',
      artifactPath: 'workflows/generated/example.ts',
      invocationRoot: '/repo-root',
    };
    const reader = recordingArtifactReader('import { workflow } from "@agent-relay/sdk/workflows";');
    const result = await normalizeRequest(raw, reader);

    expect(reader.reads).toEqual(['/repo-root/workflows/generated/example.ts']);
    expect(result.specPath).toBe('workflows/generated/example.ts');
    expect(result.invocationRoot).toBe('/repo-root');
  });

  it('respects explicit mode override instead of defaulting to local', async () => {
    const raw: CliHandoff = { source: 'cli', spec: 'test', mode: 'both' };
    const result = await normalizeRequest(raw);

    expect(result.mode).toBe('both');
  });

  it('accepts executionPreference as an explicit alias for mode on the handoff input', async () => {
    const raw: CliHandoff = { source: 'cli', spec: 'test', executionPreference: 'both' };
    const result = await normalizeRequest(raw);

    expect(result.mode).toBe('both');
    expect(result.executionPreference).toBe('both');
  });

  it('maps top-level auto execution preference to local-first both mode', async () => {
    const raw: CliHandoff = { source: 'cli', spec: 'test', executionPreference: 'auto' };
    const result = await normalizeRequest(raw);

    expect(result.mode).toBe('both');
    expect(result.executionPreference).toBe('auto');
  });

  it('reads execution preference from structured spec payloads when top-level mode is absent', async () => {
    const result = await normalizeRequest({
      source: 'structured',
      spec: {
        description: 'generate a local workflow',
        executionPreference: 'both',
      },
    });

    expect(result.mode).toBe('both');
    expect(result.executionPreference).toBe('both');
  });

  it('lets top-level mode override nested structured execution preference', async () => {
    const result = await normalizeRequest({
      source: 'cli',
      mode: 'local',
      spec: {
        description: 'generate a hosted workflow',
        executionPreference: 'cloud',
      },
    });

    expect(result.mode).toBe('local');
    expect(result.executionPreference).toBe('local');
  });

  it('maps MCP auto execution preference to both for the local contract', async () => {
    const result = await normalizeRequest({
      source: 'mcp',
      arguments: {
        goal: 'generate a workflow',
        executionPreference: 'auto',
      },
    });

    expect(result.mode).toBe('both');
    expect(result.executionPreference).toBe('auto');
  });

  it('accepts generate-and-run as a stageMode alias for run behavior', async () => {
    const result = await normalizeRequest({
      source: 'cli',
      spec: 'generate a local workflow',
      stageMode: 'generate-and-run',
    });

    expect(result.stageMode).toBe('generate-and-run');
  });

  it('defaults mode to local when not specified', async () => {
    const sources: RawHandoff[] = [
      { source: 'free-form', spec: 'x' },
      { source: 'structured', spec: { description: 'x' } },
      { source: 'cli', spec: 'x' },
      { source: 'mcp', spec: 'x' },
      { source: 'claude', spec: 'x' },
      { source: 'workflow-artifact', artifactPath: '/a' },
    ];

    for (const raw of sources) {
      const result = await normalizeRequest(raw, mockArtifactReader());
      expect(result.mode).toBe('local');
    }
  });

  it('normalizes supported local handoff surfaces without machine-specific paths', async () => {
    const relativeArtifactPath = 'workflows/wave4-local-byoh/ready-local.workflow.ts';
    const artifactReader = recordingArtifactReader('import { workflow } from "@agent-relay/sdk/workflows";');

    const cases: Array<{
      name: string;
      handoff: RawHandoff;
      expected: Partial<LocalInvocationRequest>;
    }> = [
      {
        name: 'cli',
        handoff: {
          source: 'cli',
          spec: {
            description: 'generate a local workflow from CLI',
            workflowFile: 'workflows/cli.workflow.ts',
          },
          cliMetadata: { argv: ['ricky', 'run', '--local'] },
          requestId: 'req-cli-local',
        },
        expected: {
          source: 'cli',
          spec: 'generate a local workflow from CLI',
          structuredSpec: {
            description: 'generate a local workflow from CLI',
            workflowFile: 'workflows/cli.workflow.ts',
          },
          metadata: { argv: ['ricky', 'run', '--local'] },
          requestId: 'req-cli-local',
        },
      },
      {
        name: 'mcp',
        handoff: {
          source: 'mcp',
          toolName: 'ricky.generate',
          arguments: {
            prompt: 'generate a local workflow from MCP',
            workflowFile: 'workflows/mcp.workflow.ts',
          },
          mcpMetadata: { toolCallId: 'tool-local' },
          requestId: 'req-mcp-local',
        },
        expected: {
          source: 'mcp',
          spec: 'generate a local workflow from MCP',
          structuredSpec: {
            prompt: 'generate a local workflow from MCP',
            workflowFile: 'workflows/mcp.workflow.ts',
          },
          metadata: { toolCallId: 'tool-local', toolName: 'ricky.generate' },
          requestId: 'req-mcp-local',
        },
      },
      {
        name: 'claude',
        handoff: {
          source: 'claude',
          spec: {
            request: 'generate a local workflow from Claude',
            workflowFile: 'workflows/claude.workflow.ts',
          },
          conversationId: 'conv-local',
          turnId: 'turn-local',
        },
        expected: {
          source: 'claude',
          spec: 'generate a local workflow from Claude',
          structuredSpec: {
            request: 'generate a local workflow from Claude',
            workflowFile: 'workflows/claude.workflow.ts',
          },
          metadata: { conversationId: 'conv-local', turnId: 'turn-local' },
        },
      },
      {
        name: 'workflow-artifact',
        handoff: {
          source: 'workflow-artifact',
          artifactPath: relativeArtifactPath,
          requestId: 'req-artifact-local',
        },
        expected: {
          source: 'workflow-artifact',
          spec: 'import { workflow } from "@agent-relay/sdk/workflows";',
          specPath: relativeArtifactPath,
          metadata: {},
          requestId: 'req-artifact-local',
        },
      },
    ];

    for (const testCase of cases) {
      const result = await normalizeRequest(testCase.handoff, artifactReader);

      expect(result, testCase.name).toMatchObject({
        _normalized: true,
        mode: 'local',
        ...testCase.expected,
      });
    }
    expect(artifactReader.reads).toEqual([relativeArtifactPath]);
  });
});

// ---------------------------------------------------------------------------
// runLocal
// ---------------------------------------------------------------------------

describe('runLocal', () => {
  it('exports public local invocation contracts from the local barrel', () => {
    const stageMode: LocalStageMode = 'generate-and-run';
    const input: LocalEntrypointInput = {
      _normalized: true,
      source: 'cli',
      spec: 'generate a local workflow',
      mode: 'local',
      executionPreference: 'local',
      stageMode,
      metadata: {},
    };
    const generation: LocalGenerationStageResult = {
      stage: 'generate',
      status: 'ok',
    };
    const execution: LocalExecutionStageResult = {
      stage: 'execute',
      status: 'success',
      execution: {
        workflow_id: 'wf-public-contract',
        artifact_path: 'workflows/generated/public-contract.ts',
        command: '@agent-relay/sdk/workflows runScriptWorkflow workflows/generated/public-contract.ts',
        workflow_file: 'workflows/generated/public-contract.ts',
        cwd: '/repo',
        started_at: '2026-01-01T00:00:00.000Z',
        finished_at: '2026-01-01T00:00:01.000Z',
        duration_ms: 1000,
        steps_completed: 1,
        steps_total: 1,
      },
    };

    expect(input.stageMode).toBe('generate-and-run');
    expect(input.executionPreference).toBe('local');
    expect(generation.status).toBe('ok');
    expect(execution.status).toBe('success');
  });

  it('normalizes and executes a CLI handoff through the injected executor', async () => {
    const executor = mockExecutor();
    const result = await runLocal(
      { source: 'cli', spec: 'build pipeline' },
      { executor },
    );

    expect(result.ok).toBe(true);
    expect(executor.calls).toHaveLength(1);
    expect(executor.calls[0].source).toBe('cli');
    expect(executor.calls[0].spec).toBe('build pipeline');
    expect(executor.calls[0].mode).toBe('local');
  });

  it('normalizes and executes an MCP handoff', async () => {
    const executor = mockExecutor();
    const result = await runLocal(
      { source: 'mcp', spec: 'deploy', mcpMetadata: { id: '1' } },
      { executor },
    );

    expect(result.ok).toBe(true);
    expect(executor.calls[0].source).toBe('mcp');
    expect(executor.calls[0].metadata).toEqual({ id: '1' });
  });

  it('normalizes and executes a Claude handoff', async () => {
    const executor = mockExecutor();
    const result = await runLocal(
      { source: 'claude', spec: 'run tests', conversationId: 'c1' },
      { executor },
    );

    expect(result.ok).toBe(true);
    expect(executor.calls[0].source).toBe('claude');
    expect(executor.calls[0].metadata).toEqual({ conversationId: 'c1' });
  });

  it('passes the captured invocation root through normalization to the executor seam', async () => {
    const executor = mockExecutor();

    await runLocal(
      { source: 'cli', spec: 'build pipeline', invocationRoot: '/repo-root' },
      { executor },
    );

    expect(executor.calls[0].invocationRoot).toBe('/repo-root');
  });

  it('hands CLI, MCP, and Claude specs to the injected executor in explicit local mode', async () => {
    const cases: Array<{
      name: string;
      handoff: RawHandoff;
      expectedSource: LocalInvocationRequest['source'];
      expectedSpec: string;
      expectedStructuredSpec?: Record<string, unknown>;
      expectedMetadata?: Record<string, unknown>;
    }> = [
      {
        name: 'cli',
        handoff: {
          source: 'cli',
          spec: {
            goal: 'generate a local workflow',
            workflowFile: 'workflows/cli.workflow.ts',
          },
          cliMetadata: { flag: '--local' },
        },
        expectedSource: 'cli',
        expectedSpec: 'generate a local workflow',
        expectedStructuredSpec: {
          goal: 'generate a local workflow',
          workflowFile: 'workflows/cli.workflow.ts',
        },
        expectedMetadata: { flag: '--local' },
      },
      {
        name: 'mcp',
        handoff: {
          source: 'mcp',
          toolName: 'ricky.generate',
          arguments: {
            goal: 'generate a local workflow',
            workflowFile: 'workflows/mcp.workflow.ts',
          },
          mcpMetadata: { toolCallId: 'tool-2' },
        },
        expectedSource: 'mcp',
        expectedSpec: 'generate a local workflow',
        expectedStructuredSpec: {
          goal: 'generate a local workflow',
          workflowFile: 'workflows/mcp.workflow.ts',
        },
        expectedMetadata: { toolCallId: 'tool-2', toolName: 'ricky.generate' },
      },
      {
        name: 'claude',
        handoff: {
          source: 'claude',
          spec: {
            description: 'generate a local workflow',
            workflowFile: 'workflows/claude.workflow.ts',
          },
          conversationId: 'conv-3',
          turnId: 'turn-10',
        },
        expectedSource: 'claude',
        expectedSpec: 'generate a local workflow',
        expectedStructuredSpec: {
          description: 'generate a local workflow',
          workflowFile: 'workflows/claude.workflow.ts',
        },
        expectedMetadata: { conversationId: 'conv-3', turnId: 'turn-10' },
      },
    ];

    for (const testCase of cases) {
      const executor = mockExecutor();
      const result = await runLocal(testCase.handoff, { executor });

      expect(result.ok, testCase.name).toBe(true);
      expect(result.warnings.some((w) => w.includes('Cloud API surface')), testCase.name).toBe(false);
      expect(executor.calls).toHaveLength(1);
      expect(executor.calls[0]).toMatchObject({
        source: testCase.expectedSource,
        spec: testCase.expectedSpec,
        mode: 'local',
        metadata: testCase.expectedMetadata,
      });
      expect(executor.calls[0].structuredSpec).toEqual(testCase.expectedStructuredSpec);
    }
  });

  it('routes CLI, MCP, and Claude ready-workflow handoffs to the local runtime without Cloud or generation', async () => {
    const handoffs: Array<{
      name: string;
      handoff: RawHandoff;
      expectedSource: LocalInvocationRequest['source'];
      expectedWorkflow: string;
    }> = [
      {
        name: 'cli',
        handoff: {
          source: 'cli',
          spec: 'run workflows/wave4-local-byoh/cli-ready.workflow.ts',
          stageMode: 'run',
          cliMetadata: { argv: ['ricky', 'run', '--local'] },
        },
        expectedSource: 'cli',
        expectedWorkflow: 'workflows/wave4-local-byoh/cli-ready.workflow.ts',
      },
      {
        name: 'mcp',
        handoff: {
          source: 'mcp',
          toolName: 'ricky.runLocal',
          stageMode: 'run',
          arguments: {
            goal: 'run local workflow',
            workflowFile: 'workflows/wave4-local-byoh/mcp-ready.workflow.ts',
          },
          mcpMetadata: { toolCallId: 'tool-local-1' },
        },
        expectedSource: 'mcp',
        expectedWorkflow: 'workflows/wave4-local-byoh/mcp-ready.workflow.ts',
      },
      {
        name: 'claude',
        handoff: {
          source: 'claude',
          stageMode: 'run',
          spec: {
            description: 'run local workflow',
            workflowFile: 'workflows/wave4-local-byoh/claude-ready.workflow.ts',
          },
          conversationId: 'conv-local-1',
          turnId: 'turn-local-1',
        },
        expectedSource: 'claude',
        expectedWorkflow: 'workflows/wave4-local-byoh/claude-ready.workflow.ts',
      },
    ];

    for (const testCase of handoffs) {
      const launches: RunRequest[] = [];
      const result = await runLocal(testCase.handoff, {
        localExecutor: {
          cwd: '/workspace/ricky',
          coordinator: {
            async launch(request: RunRequest): Promise<CoordinatorResult> {
              launches.push(request);
              return coordinatorResult(request, { stdout: [`${testCase.name} local runtime accepted`] });
            },
          },
          artifactWriter: {
            async writeArtifact(): Promise<void> {
              throw new Error(`${testCase.name} should not generate a workflow artifact`);
            },
          },
        },
      });

      expect(result.ok, testCase.name).toBe(true);
      expect(launches, testCase.name).toHaveLength(1);
      expect(launches[0], testCase.name).toMatchObject({
        workflowFile: testCase.expectedWorkflow,
        cwd: '/workspace/ricky',
        route: DEFAULT_LOCAL_ROUTE,
        metadata: {
          source: testCase.expectedSource,
          route: 'execute',
        },
      });
      expect(result.artifacts, testCase.name).toEqual([
        { path: testCase.expectedWorkflow, type: 'text/typescript' },
      ]);
      expect(result.logs, testCase.name).toEqual(
        expect.arrayContaining([
          `[local] received spec from ${testCase.expectedSource}`,
          '[local] mode: local',
          '[local] spec intake route: execute',
          '[local] runtime status: passed',
          `[stdout] ${testCase.name} local runtime accepted`,
        ]),
      );
      expect(result.logs.some((line) => line.includes('[local] workflow generation')), testCase.name).toBe(false);
      expect(result.warnings.some((warning) => warning.includes('Cloud API surface')), testCase.name).toBe(false);
    }
  });

  it('normalizes and executes a workflow artifact handoff', async () => {
    const executor = mockExecutor();
    const reader = mockArtifactReader('# WF Spec');
    const result = await runLocal(
      { source: 'workflow-artifact', artifactPath: '/wf.md' },
      { executor, artifactReader: reader },
    );

    expect(result.ok).toBe(true);
    expect(executor.calls[0].source).toBe('workflow-artifact');
    expect(executor.calls[0].spec).toBe('# WF Spec');
    expect(executor.calls[0].specPath).toBe('/wf.md');
  });

  it('accepts an already-normalized local invocation request without re-reading artifacts', async () => {
    const localExecutor = memoryLocalExecutorOptions();
    const result = await runLocal(
      {
        _normalized: true,
        source: 'workflow-artifact',
        spec: 'import { workflow } from "@agent-relay/sdk/workflows";',
        mode: 'local',
        stageMode: 'run',
        specPath: 'workflows/wave4-local-byoh/02-local-invocation-entrypoint.ts',
        metadata: { caller: 'direct-local' },
      },
      {
        localExecutor,
        artifactReader: failingArtifactReader('should not read a normalized request'),
      },
    );

    expect(result.ok).toBe(true);
    expect(localExecutor.writes).toHaveLength(0);
    expect(localExecutor.runner.invocations[0].args).toContain('workflows/wave4-local-byoh/02-local-invocation-entrypoint.ts');
    expect(result.logs.some((l) => l.includes('[local] spec intake route: execute'))).toBe(true);
  });

  it('does not skip normalization for raw cli handoffs that include mode and metadata', async () => {
    const executor = mockExecutor();
    const result = await runLocal(
      {
        source: 'cli',
        spec: 'build workflow',
        mode: 'local',
        metadata: { caller: 'cli' },
        specFile: '/tmp/spec.md',
        cliMetadata: { argv: ['ricky', 'run'] },
      },
      { executor },
    );

    expect(result.ok).toBe(true);
    expect(executor.calls).toHaveLength(1);
    expect(executor.calls[0].specPath).toBe('/tmp/spec.md');
    expect(executor.calls[0].sourceMetadata).toEqual({
      cli: {
        argv: ['ricky', 'run'],
        specFile: '/tmp/spec.md',
      },
    });
    expect(executor.calls[0].metadata).toMatchObject({
      caller: 'cli',
      argv: ['ricky', 'run'],
    });
  });

  it('returns error response when artifact read fails', async () => {
    const executor = mockExecutor();
    const reader = failingArtifactReader('ENOENT: no such file');
    const result = await runLocal(
      { source: 'workflow-artifact', artifactPath: '/missing.md' },
      { executor, artifactReader: reader },
    );

    expect(result.ok).toBe(false);
    expect(result.logs[0]).toContain('normalization failed');
    expect(result.logs[0]).toContain('ENOENT');
    expect(result.warnings[0]).toContain("source 'workflow-artifact'");
    expect(result.warnings[0]).toContain('ENOENT');
    expect(result.nextActions[0]).toContain('artifact path exists');
    expect(executor.calls).toHaveLength(0);
  });

  it('returns actionable failure when CLI handoff has no spec material', async () => {
    const executor = mockExecutor();
    const result = await runLocal(
      { source: 'cli' } as unknown as CliHandoff,
      { executor },
    );

    expect(result.ok).toBe(false);
    expect(executor.calls).toHaveLength(0);
    expect(result.logs[0]).toContain('normalization failed');
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatch(/^Failed to normalize handoff from source 'cli': /);
    expect(result.nextActions).toEqual(['Check the spec content or artifact path and retry.']);
  });

  it('surfaces warning when cloud mode is used on the local entrypoint', async () => {
    const executor = mockExecutor();
    const result = await runLocal(
      { source: 'cli', spec: 'test', mode: 'cloud' },
      { executor },
    );

    expect(result.ok).toBe(false);
    expect(executor.calls).toHaveLength(0);
    expect(result.warnings.some((w) => w.includes('local/BYOH entrypoint'))).toBe(true);
    expect(result.warnings.some((w) => w.includes('Cloud API surface'))).toBe(true);
    expect(result.nextActions.some((a) => a.includes('Cloud API surface'))).toBe(true);
  });

  it('rejects nested cloud execution preferences from structured MCP handoffs before execution', async () => {
    const executor = mockExecutor();
    const result = await runLocal(
      {
        source: 'mcp',
        toolName: 'ricky.generate',
        arguments: {
          goal: 'generate a hosted workflow',
          executionPreference: 'cloud',
        },
      },
      { executor },
    );

    expect(result.ok).toBe(false);
    expect(executor.calls).toHaveLength(0);
    expect(result.logs).toEqual(['[local] rejected cloud-only request from mcp']);
    expect(result.warnings).toEqual([
      'This is the local/BYOH entrypoint. Cloud-only requests should use the Cloud API surface.',
    ]);
    expect(result.nextActions).toEqual(['Use the Cloud API surface or re-invoke with mode=local.']);
  });

  it('does not route through Cloud by default', async () => {
    const executor = mockExecutor();
    await runLocal({ source: 'cli', spec: 'test' }, { executor });

    expect(executor.calls[0].mode).toBe('local');
  });

  it('keeps CLI, MCP, and Claude handoffs BYOH-first without Cloud credentials', async () => {
    const handoffs: RawHandoff[] = [
      {
        source: 'cli',
        spec: {
          description: 'generate a local workflow from CLI without hosted credentials',
          targetFiles: ['packages/local/src/entrypoint.ts'],
        },
        cliMetadata: { argv: ['ricky', 'generate'] },
      },
      {
        source: 'mcp',
        toolName: 'ricky.generate',
        arguments: {
          prompt: 'generate a local workflow from MCP without hosted credentials',
          targetFiles: ['packages/local/src/entrypoint.ts'],
        },
        mcpMetadata: { toolCallId: 'tool-byoh-first' },
      },
      {
        source: 'claude',
        spec: {
          request: 'generate a local workflow from Claude without hosted credentials',
          targetFiles: ['packages/local/src/entrypoint.ts'],
        },
        conversationId: 'conv-byoh-first',
        turnId: 'turn-byoh-first',
      },
    ];

    for (const handoff of handoffs) {
      const executor = mockExecutor();
      const result = await runLocal(handoff, { executor });

      expect(result.ok, handoff.source).toBe(true);
      expect(executor.calls, handoff.source).toHaveLength(1);
      expect(executor.calls[0], handoff.source).toMatchObject({
        source: handoff.source,
        mode: 'local',
      });
      expect(executor.calls[0].metadata, handoff.source).not.toHaveProperty('auth');
      expect(executor.calls[0].metadata, handoff.source).not.toHaveProperty('workspace');
      expect(result.warnings.some((warning) => warning.includes('Cloud API surface')), handoff.source).toBe(false);
    }
  });

  it('runs both-mode handoffs through the local entrypoint while preserving optional Cloud promotion', async () => {
    const cases: RawHandoff[] = [
      { source: 'cli', spec: 'generate a local workflow for packages/local/src/entrypoint.ts', mode: 'both', stageMode: 'run' },
      {
        source: 'mcp',
        arguments: {
          goal: 'generate a local workflow for packages/local/src/entrypoint.ts',
          executionPreference: 'auto',
          stageMode: 'run',
        },
      },
      {
        source: 'claude',
        spec: {
          request: 'generate a local workflow for packages/local/src/entrypoint.ts',
          executionPreference: 'both',
          stageMode: 'run',
        },
      },
    ];

    for (const handoff of cases) {
      const localExecutor = memoryLocalExecutorOptions({ stdout: [`${handoff.source} both-mode local run`] });
      const result = await runLocal(handoff, { localExecutor });

      expect(result.ok, handoff.source).toBe(true);
      expect(localExecutor.runner.invocations, handoff.source).toHaveLength(1);
      expect(localExecutor.runner.invocations[0].command, handoff.source).toBe(DEFAULT_LOCAL_ROUTE.command);
      expect(result.logs, handoff.source).toEqual(
        expect.arrayContaining([
          `[local] received spec from ${handoff.source}`,
          '[local] mode: both',
          '[local] runtime status: passed',
          `[stdout] ${handoff.source} both-mode local run`,
        ]),
      );
      expect(result.nextActions.some((action) => action.includes('promote to Cloud')), handoff.source).toBe(true);
      expect(result.warnings.some((warning) => warning.includes('Cloud API surface')), handoff.source).toBe(false);
    }
  });

  it('rejects explicit cloud-only preferences from CLI, MCP, and Claude before local execution', async () => {
    const handoffs: RawHandoff[] = [
      {
        source: 'cli',
        spec: {
          description: 'generate a hosted workflow',
          executionPreference: 'cloud',
        },
      },
      {
        source: 'mcp',
        toolName: 'ricky.generate',
        arguments: {
          goal: 'generate a hosted workflow',
          executionPreference: 'cloud',
        },
      },
      {
        source: 'claude',
        spec: {
          request: 'generate a hosted workflow',
          mode: 'cloud',
        },
      },
    ];

    for (const handoff of handoffs) {
      const executor = mockExecutor();
      const result = await runLocal(handoff, { executor });

      expect(result.ok, handoff.source).toBe(false);
      expect(executor.calls, handoff.source).toHaveLength(0);
      expect(result.logs, handoff.source).toEqual([`[local] rejected cloud-only request from ${handoff.source}`]);
      expect(result.warnings, handoff.source).toEqual([
        'This is the local/BYOH entrypoint. Cloud-only requests should use the Cloud API surface.',
      ]);
      expect(result.nextActions, handoff.source).toEqual(['Use the Cloud API surface or re-invoke with mode=local.']);
    }
  });

  it('defaults every raw handoff surface to explicit local execution before adapter handoff', async () => {
    const handoffs: RawHandoff[] = [
      { source: 'free-form', spec: 'generate a local workflow' },
      { source: 'structured', spec: { description: 'generate a structured local workflow' } },
      { source: 'cli', spec: 'generate a CLI local workflow' },
      { source: 'mcp', arguments: { goal: 'generate an MCP local workflow' } },
      { source: 'claude', spec: { request: 'generate a Claude local workflow' } },
      { source: 'workflow-artifact', artifactPath: 'workflows/wave4-local-byoh/default-local.workflow.ts' },
    ];

    for (const handoff of handoffs) {
      const executor = mockExecutor();
      const result = await runLocal(handoff, {
        executor,
        artifactReader: mockArtifactReader('import { workflow } from "@agent-relay/sdk/workflows";'),
      });

      expect(result.ok, handoff.source).toBe(true);
      expect(result.warnings.some((warning) => warning.includes('Cloud API surface')), handoff.source).toBe(false);
      expect(executor.calls, handoff.source).toHaveLength(1);
      expect(executor.calls[0], handoff.source).toMatchObject({
        source: handoff.source,
        mode: 'local',
      });
    }
  });

  it('defaults BYOH generation requests to the injected local runtime without Cloud fallback', async () => {
    const localExecutor = memoryLocalExecutorOptions({ stdout: ['local run completed'] });
    const result = await runLocal(
      { source: 'cli', spec: 'generate a local workflow for packages/local/src/entrypoint.ts', stageMode: 'run' },
      { localExecutor },
    );

    expect(result.ok).toBe(true);
    const generatedArtifacts = workflowArtifactWrites(localExecutor.writes);
    expect(generatedArtifacts).toHaveLength(1);
    expect(generatedArtifacts[0].content).toContain('\\"executionPreference\\": \\"local\\"');
    expect(generatedArtifacts[0].content).not.toContain('\\"executionPreference\\": \\"cloud\\"');
    expect(localExecutor.runner.invocations).toHaveLength(1);
    expect(localExecutor.runner.invocations[0]).toMatchObject({
      command: DEFAULT_LOCAL_ROUTE.command,
      cwd: '/repo',
    });
    expect(localExecutor.runner.invocations[0].args.slice(0, DEFAULT_LOCAL_ROUTE.baseArgs?.length)).toEqual(DEFAULT_LOCAL_ROUTE.baseArgs);
    expect(result.logs).toEqual(
      expect.arrayContaining([
        '[local] received spec from cli',
        '[local] mode: local',
        '[local] spec intake route: generate',
        '[local] runtime status: passed',
        '[stdout] local run completed',
      ]),
    );
    expect(result.warnings.some((w) => w.includes('Cloud API surface'))).toBe(false);
  });

  it('emits concise progress while generating and running locally', async () => {
    const progress: string[] = [];
    const localExecutor = memoryLocalExecutorOptions({ stdout: ['local run completed'] });

    const result = await runLocal(
      { source: 'cli', spec: 'generate a local workflow for packages/local/src/entrypoint.ts', stageMode: 'run' },
      {
        localExecutor,
        onProgress: (message) => progress.push(message),
      },
    );

    expect(result.ok).toBe(true);
    expect(progress).toEqual([
      'Reading spec and preparing local context...',
      'Spec intake routed to generate...',
      'Selecting workflow pattern, agents, and validation gates...',
      'Rendering workflow artifact...',
      expect.stringMatching(/^Writing workflow artifact to workflows\/generated\/.+\.ts\.\.\.$/),
      'Running workflow...',
    ]);
  });

  it('can return a generated artifact without launching the local runtime', async () => {
    const localExecutor = memoryLocalExecutorOptions({ stdout: ['local run completed'] });
    const result = await runLocal(
      { source: 'cli', spec: 'generate a local workflow for packages/local/src/entrypoint.ts' },
      {
        localExecutor: {
          ...localExecutor,
          returnGeneratedArtifactOnly: true,
        },
      },
    );

    expect(result.ok).toBe(true);
    expect(workflowArtifactWrites(localExecutor.writes)).toHaveLength(1);
    expect(localExecutor.runner.invocations).toHaveLength(0);
    expect(result.logs).toEqual(
      expect.arrayContaining([
        '[local] received spec from cli',
        '[local] mode: local',
        '[local] spec intake route: generate',
        '[local] workflow generation: passed',
        '[local] runtime launch skipped: returning generated artifact only',
      ]),
    );
    expect(result.nextActions[0]).toMatch(/^Run the generated workflow locally: ricky run workflows\/generated\/.+\.ts$/);
    expect(result.nextActions).toContain('Inspect the generated workflow artifact and choose whether to run it locally.');
  });

  it('defaults stage mode to generation-only when no run behavior is requested', async () => {
    const localExecutor = memoryLocalExecutorOptions({ stdout: ['should not launch by default'] });
    const result = await runLocal(
      { source: 'cli', spec: 'generate a local workflow for packages/local/src/entrypoint.ts' },
      { localExecutor },
    );

    expect(result.ok).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.generation).toMatchObject({ stage: 'generate', status: 'ok' });
    expect(result.execution).toBeUndefined();
    expect(workflowArtifactWrites(localExecutor.writes)).toHaveLength(1);
    expect(localExecutor.runner.invocations).toHaveLength(0);
  });

  it('returns structured clarification questions instead of generating from unresolved specs', async () => {
    const localExecutor = memoryLocalExecutorOptions({ stdout: ['should not launch'] });
    const result = await runLocal(
      {
        source: 'cli',
        spec: [
          'Generate a workflow for package validation.',
          'Open questions:',
          '- Should it validate package A or package B?',
        ].join('\n'),
      },
      { localExecutor },
    );

    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(1);
    expect(result.generation).toMatchObject({
      stage: 'generate',
      status: 'needs_clarification',
      decisions: {
        clarification_questions: [
          expect.objectContaining({
            id: 'open-question-1',
            question: 'Should it validate package A or package B?',
            blocking: true,
          }),
        ],
      },
    });
    expect(result.clarificationQuestions).toEqual(result.generation?.decisions?.clarification_questions);
    expect(result.nextActions).toContain('Clarify: Should it validate package A or package B?');
    expect(workflowArtifactWrites(localExecutor.writes)).toHaveLength(0);
    expect(localExecutor.runner.invocations).toHaveLength(0);
  });

  it('does not ask execution-mode clarification when CLI mode already chose local', async () => {
    const localExecutor = memoryLocalExecutorOptions({ stdout: ['should not launch'] });
    const result = await runLocal(
      {
        source: 'cli',
        mode: 'local',
        spec: 'Generate a workflow for a primitive that supports local BYOH and Cloud hosted execution.',
      },
      { localExecutor },
    );

    expect(result.ok).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.clarificationQuestions).toBeUndefined();
    expect(result.logs).toEqual(expect.arrayContaining([
      '[local] mode: local',
      '[local] spec intake route: generate',
    ]));
    expect(result.nextActions.some((action) => action.includes('Should this workflow run locally/BYOH'))).toBe(false);
    expect(workflowArtifactWrites(localExecutor.writes)).toHaveLength(1);
    expect(localExecutor.runner.invocations).toHaveLength(0);
  });

  it('uses --best-judgement to answer unresolved spec questions before generation', async () => {
    const localExecutor = memoryLocalExecutorOptions({ stdout: ['should not launch'] });
    const result = await runLocal(
      {
        source: 'cli',
        spec: [
          'Generate a workflow for package validation.',
          'Open questions:',
          '- Who owns final rollout signoff?',
        ].join('\n'),
        bestJudgement: true,
      },
      { localExecutor },
    );

    expect(result.ok).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.clarificationQuestions).toBeUndefined();
    expect(result.generation).toMatchObject({
      stage: 'generate',
      status: 'ok',
      decisions: {
        best_judgement_clarifications: [
          expect.objectContaining({
            question: 'Who owns final rollout signoff?',
            answered_by: 'impl-primary-codex',
            mode: '--best-judgement',
          }),
        ],
      },
    });
    expect(result.logs).toContain('[local] --best-judgement answered 1 clarification question(s) as impl-primary-codex');
    expect(result.warnings).toContain('--best-judgement resolved blocking clarifications with implementer assumptions; review them in the generated workflow context.');

    const writes = workflowArtifactWrites(localExecutor.writes);
    expect(writes).toHaveLength(1);
    expect(writes[0].content).toContain('Best-judgement clarifications:');
    expect(writes[0].content).toContain('Who owns final rollout signoff?');
    expect(writes[0].content).toContain('Answered by implementing agent impl-primary-codex using --best-judgement');
    expect(localExecutor.runner.invocations).toHaveLength(0);
  });

  it('emits the generation stage contract when generation mode is explicit', async () => {
    const localExecutor = memoryLocalExecutorOptions({ stdout: ['should not launch'] });
    const result = await runLocal(
      {
        source: 'cli',
        spec: 'generate a local workflow for packages/local/src/entrypoint.ts',
        stageMode: 'generate',
      },
      {
        localExecutor: {
          ...localExecutor,
          returnGeneratedArtifactOnly: true,
        },
      },
    );

    expect(result.ok).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.generation).toMatchObject({
      stage: 'generate',
      status: 'ok',
      artifact: {
        path: expect.stringMatching(/^workflows\/generated\/.+\.ts$/),
        workflow_id: expect.any(String),
        spec_digest: expect.any(String),
      },
      next: {
        run_command: expect.stringMatching(/^ricky run workflows\/generated\/.+\.ts$/),
        run_mode_hint: expect.stringMatching(/^ricky run workflows\/generated\/.+\.ts$/),
      },
    });
    expect(result.execution).toBeUndefined();
    expect(localExecutor.runner.invocations).toHaveLength(0);
  });

  it('continues from generated artifact into execution evidence when run mode is explicit', async () => {
    const { mkdtemp, rm } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const tempCwd = await mkdtemp(`${tmpdir()}/ricky-local-evidence-`);
    const stateHome = join(tempCwd, '.ricky-state');
    vi.stubEnv('RICKY_STATE_HOME', stateHome);
    const localExecutor = memoryLocalExecutorOptions({
      stdout: ['local run completed'],
      stderr: ['runtime note'],
      cwd: tempCwd,
    });
    try {
      const result = await runLocal(
        {
          source: 'cli',
          spec: 'generate a local workflow for packages/local/src/entrypoint.ts',
          stageMode: 'run',
        },
        {
          localExecutor,
        },
      );

      expect(result.ok).toBe(true);
      expect(result.exitCode).toBe(0);
      expect(result.generation).toMatchObject({ stage: 'generate', status: 'ok' });
      expect(result.execution).toMatchObject({
        stage: 'execute',
        status: 'success',
        execution: {
          command: expect.stringContaining('@agent-relay/sdk/workflows runScriptWorkflow'),
          workflow_file: expect.stringMatching(/^workflows\/generated\/.+\.ts$/),
          cwd: tempCwd,
        },
        evidence: {
          outcome_summary: expect.stringContaining('completed successfully'),
          logs: {
            stdout_path: expect.stringContaining(`${stateHome}/ricky/local-runs/`),
            stderr_path: expect.stringContaining(`${stateHome}/ricky/local-runs/`),
            truncated: false,
          },
          side_effects: {
            commands_invoked: [expect.stringContaining('@agent-relay/sdk/workflows runScriptWorkflow')],
          },
        },
      });
      expect(result.execution?.blocker).toBeUndefined();
      expect(localExecutor.runner.invocations).toHaveLength(1);
    } finally {
      vi.unstubAllEnvs();
      await rm(tempCwd, { recursive: true, force: true });
    }
  });

  it('treats generate-and-run stage mode as explicit run behavior', async () => {
    const localExecutor = memoryLocalExecutorOptions({ stdout: ['alias run completed'] });
    const result = await runLocal(
      {
        source: 'cli',
        spec: 'generate a local workflow for packages/local/src/entrypoint.ts',
        stageMode: 'generate-and-run',
      },
      { localExecutor },
    );

    expect(result.ok).toBe(true);
    expect(result.execution).toMatchObject({
      stage: 'execute',
      status: 'success',
      evidence: {
        logs: {
          tail: ['alias run completed'],
          truncated: false,
        },
      },
    });
    expect(localExecutor.runner.invocations).toHaveLength(1);
  });

  describe('regression: issue #3 local generation and execution stages', () => {
    it('returns concrete execution outcome and evidence after generated artifact execution succeeds', async () => {
      const { mkdtemp, rm } = await import('node:fs/promises');
      const { tmpdir } = await import('node:os');
      const { join } = await import('node:path');
      const tempCwd = await mkdtemp(`${tmpdir()}/ricky-local-evidence-`);
      const stateHome = join(tempCwd, '.ricky-state');
      vi.stubEnv('RICKY_STATE_HOME', stateHome);
      const localExecutor = memoryLocalExecutorOptions({
        stdout: ['package checks passed'],
        stderr: ['runtime note'],
        cwd: tempCwd,
      });
      try {
        const result = await runLocal(
          {
            source: 'cli',
            spec: 'generate a local workflow for packages/local/src/entrypoint.ts',
            stageMode: 'run',
          },
          { localExecutor },
        );

        const generatedPath = result.generation?.artifact?.path;

        expect(result.ok).toBe(true);
        expect(result.exitCode).toBe(0);
        expect(result.generation).toMatchObject({
          stage: 'generate',
          status: 'ok',
          artifact: {
            path: expect.stringMatching(/^workflows\/generated\/.+\.ts$/),
            workflow_id: expect.any(String),
            spec_digest: expect.any(String),
          },
        });
        expect(result.execution).toMatchObject({
          stage: 'execute',
          status: 'success',
          execution: {
            artifact_path: generatedPath,
            workflow_file: generatedPath,
            command: `@agent-relay/sdk/workflows runScriptWorkflow ${generatedPath}`,
            steps_completed: 1,
            steps_total: 1,
          },
          evidence: {
            outcome_summary: expect.stringContaining('completed successfully'),
            artifacts_produced: [
              {
                path: generatedPath,
                kind: 'workflow',
                bytes: expect.any(Number),
              },
            ],
            logs: {
              stdout_path: expect.stringContaining(`${stateHome}/ricky/local-runs/`),
              stderr_path: expect.stringContaining(`${stateHome}/ricky/local-runs/`),
              truncated: false,
            },
            side_effects: {
              commands_invoked: [`@agent-relay/sdk/workflows runScriptWorkflow ${generatedPath}`],
            },
            assertions: [
              {
                name: 'runtime_exit_code',
                status: 'pass',
                detail: 'Runtime exited with code 0.',
              },
            ],
          },
        });
        expect(result.execution?.evidence?.side_effects.files_written).toEqual(
          expect.arrayContaining([generatedPath!]),
        );
        expect(result.execution?.blocker).toBeUndefined();
      } finally {
        vi.unstubAllEnvs();
        await rm(tempCwd, { recursive: true, force: true });
      }
    });

    it('blocks package-check generated workflow execution before launching agents when package.json is missing', async () => {
      const { access, mkdtemp, rm } = await import('node:fs/promises');
      const { tmpdir } = await import('node:os');
      const tempCwd = await mkdtemp(`${tmpdir()}/ricky-package-precheck-`);

      try {
        const result = await runLocal(
          {
            source: 'cli',
            spec: 'generate a workflow for package checks with typecheck and tests',
            stageMode: 'run',
            invocationRoot: tempCwd,
          },
          { localExecutor: { workforcePersonaWriter: false } },
        );

        const generatedPath = result.generation?.artifact?.path;
        expect(result.ok).toBe(false);
        expect(result.exitCode).toBe(2);
        expect(generatedPath).toMatch(/^workflows\/generated\/.+\.ts$/);
        await expect(access(`${tempCwd}/${generatedPath}`)).resolves.toBeUndefined();
        expect(result.execution).toMatchObject({
          stage: 'execute',
          status: 'blocker',
          execution: {
            workflow_file: generatedPath,
            command: `@agent-relay/sdk/workflows runScriptWorkflow ${generatedPath}`,
            cwd: tempCwd,
            steps_completed: 0,
            steps_total: 1,
          },
          blocker: {
            code: 'UNSUPPORTED_RUNTIME',
            category: 'unsupported',
            detected_during: 'precheck',
            context: {
              missing: [`${tempCwd}/package.json`],
              found: [`cwd=${tempCwd}`],
            },
          },
          evidence: {
            failed_step: { id: 'runtime-precheck', name: 'Local runtime precheck' },
            side_effects: {
              commands_invoked: [`@agent-relay/sdk/workflows runScriptWorkflow ${generatedPath}`],
            },
          },
        });
      } finally {
        await rm(tempCwd, { recursive: true, force: true });
      }
    });

    it('writes runtime log evidence under result.cwd, not process.cwd()', async () => {
      const { mkdtemp, rm, access } = await import('node:fs/promises');
      const { tmpdir } = await import('node:os');
      const { join } = await import('node:path');
      const callerRepo = await mkdtemp(`${tmpdir()}/ricky-caller-cwd-`);
      const stateHome = join(callerRepo, '.ricky-state');
      vi.stubEnv('RICKY_STATE_HOME', stateHome);
      const localExecutor = memoryLocalExecutorOptions({
        stdout: ['caller cwd run ok'],
        stderr: [],
        cwd: callerRepo,
      });
      try {
        expect(callerRepo).not.toBe(process.cwd());
        const result = await runLocal(
          {
            source: 'cli',
            spec: 'generate a local workflow for packages/local/src/entrypoint.ts',
            stageMode: 'run',
            invocationRoot: callerRepo,
          },
          { localExecutor },
        );

        const stdoutPath = result.execution?.evidence?.logs.stdout_path;
        const stderrPath = result.execution?.evidence?.logs.stderr_path;
        expect(stdoutPath).toBeDefined();
        expect(stderrPath).toBeDefined();
        expect(stdoutPath!.startsWith(`${stateHome}/ricky/local-runs/`)).toBe(true);
        expect(stderrPath!.startsWith(`${stateHome}/ricky/local-runs/`)).toBe(true);
        await expect(access(stdoutPath!)).resolves.toBeUndefined();
        await expect(access(stderrPath!)).resolves.toBeUndefined();
      } finally {
        vi.unstubAllEnvs();
        await rm(callerRepo, { recursive: true, force: true });
      }
    });

    it('returns a classified blocker when generated artifact execution fails at runtime', async () => {
      const localExecutor = memoryLocalExecutorOptions({
        exitCode: 127,
        stdout: [],
        stderr: ['agent-relay: command not found'],
      });
      const result = await runLocal(
        {
          source: 'cli',
          spec: 'generate a local workflow for packages/local/src/entrypoint.ts',
          stageMode: 'run',
        },
        { localExecutor },
      );

      expect(result.ok).toBe(false);
      expect(result.exitCode).toBe(2);
      expect(result.generation).toMatchObject({ stage: 'generate', status: 'ok' });
      expect(result.execution).toMatchObject({
        stage: 'execute',
        status: 'blocker',
        blocker: {
          code: 'MISSING_BINARY',
          category: 'dependency',
          detected_during: 'launch',
          message: expect.stringContaining('Runtime dependency is unavailable'),
          recovery: {
            actionable: true,
            steps: expect.arrayContaining([
              'npm install',
              expect.stringMatching(/^ricky run workflows\/generated\/.+\.ts$/),
            ]),
          },
          context: {
            missing: ['@agent-relay/sdk/workflows runtime'],
          },
        },
        evidence: {
          outcome_summary: expect.stringContaining('blocked during local runtime execution'),
          failed_step: { id: 'runtime-launch', name: 'Local runtime execution' },
          exit_code: 127,
          logs: {
            tail: ['agent-relay: command not found'],
            truncated: false,
          },
          assertions: [
            {
              name: 'runtime_exit_code',
              status: 'fail',
              detail: 'Runtime exit code: 127.',
            },
          ],
        },
      });
      expect(result.nextActions).toEqual(result.execution?.blocker?.recovery.steps);
      expect(result.nextActions.join('\n')).not.toMatch(/rerun.*later|vague/i);
    });

    it('extracts env recovery steps only from explicit missing-env messages', async () => {
      const localExecutor = memoryLocalExecutorOptions({
        exitCode: 1,
        stdout: ['Spec context mentions API, MSD, and GENERATED_WORKFLOW_READY.'],
        stderr: ['missing env var GITHUB_TOKEN before calling API for MSD workflows'],
      });
      const result = await runLocal(
        {
          source: 'cli',
          spec: 'generate a local workflow for packages/local/src/entrypoint.ts',
          stageMode: 'run',
        },
        { localExecutor },
      );

      expect(result.ok).toBe(false);
      expect(result.execution?.blocker?.code).toBe('MISSING_ENV_VAR');
      expect(result.execution?.blocker?.context.missing).toEqual(['GITHUB_TOKEN']);
      expect(result.nextActions).toEqual(['export GITHUB_TOKEN=...']);
      expect(result.nextActions.join('\n')).not.toContain('export API=');
      expect(result.nextActions.join('\n')).not.toContain('export MSD=');
    });

    it('does not turn prose acronyms near missing-env text into export commands', async () => {
      const localExecutor = memoryLocalExecutorOptions({
        exitCode: 1,
        stderr: ['Required runtime environment is missing: Owner: MSD backend; Relaycast API key resolved.'],
      });
      const result = await runLocal(
        {
          source: 'cli',
          spec: 'generate a local workflow for packages/local/src/entrypoint.ts',
          stageMode: 'run',
        },
        { localExecutor },
      );

      expect(result.ok).toBe(false);
      expect(result.execution?.blocker?.code).toBe('MISSING_ENV_VAR');
      expect(result.execution?.blocker?.context.missing).toEqual(['required environment variable']);
      expect(result.nextActions.join('\n')).not.toContain('export API=');
      expect(result.nextActions.join('\n')).not.toContain('export MSD=');
    });

    it('does not classify incidental "auth"/"token" mentions in agent output as CREDENTIALS_REJECTED', async () => {
      // Codex/claude TUIs print the words "auth" and "token" constantly during normal operation.
      // The classifier must not bucket every failure that captured those bytes into a credentials blocker.
      const localExecutor = memoryLocalExecutorOptions({
        exitCode: 1,
        stdout: [
          'Codex CLI banner — context window 80% remaining.',
          'tool: read_file path=src/auth/middleware.ts',
          'token usage: 12345 / 200000',
        ],
        stderr: ['some unrelated runtime failure'],
      });
      const result = await runLocal(
        { source: 'cli', spec: 'generate a local workflow', stageMode: 'run' },
        { localExecutor },
      );

      expect(result.ok).toBe(false);
      expect(result.execution?.blocker?.code).not.toBe('CREDENTIALS_REJECTED');
      expect(result.execution?.blocker?.category).not.toBe('credentials');
    });

    it('still classifies real credential failures (401/unauthorized/invalid token) as CREDENTIALS_REJECTED', async () => {
      const localExecutor = memoryLocalExecutorOptions({
        exitCode: 1,
        stderr: ['HTTP 401 Unauthorized: invalid api key'],
      });
      const result = await runLocal(
        { source: 'cli', spec: 'generate a local workflow', stageMode: 'run' },
        { localExecutor },
      );

      expect(result.ok).toBe(false);
      expect(result.execution?.blocker?.code).toBe('CREDENTIALS_REJECTED');
      expect(result.execution?.blocker?.category).toBe('credentials');
    });

    it('keeps stop-after-generation artifact-only output without launching runtime', async () => {
      const localExecutor = memoryLocalExecutorOptions({
        exitCode: 127,
        stderr: ['this runtime should not be invoked'],
      });
      const result = await runLocal(
        {
          source: 'cli',
          spec: 'generate a local workflow for packages/local/src/entrypoint.ts',
          stageMode: 'generate',
        },
        { localExecutor },
      );

      expect(result.ok).toBe(true);
      expect(result.exitCode).toBe(0);
      expect(result.generation).toMatchObject({ stage: 'generate', status: 'ok' });
      expect(result.execution).toBeUndefined();
      expect(result.artifacts).toHaveLength(1);
      expect(result.artifacts[0]).toMatchObject({
        path: result.generation?.artifact?.path,
        type: 'text/typescript',
        content: expect.stringContaining('workflow('),
      });
      expect(localExecutor.runner.invocations).toHaveLength(0);
    });
  });

  it('writes generated workflows relative to the captured invocation root and keeps the suggested run path aligned', async () => {
    const localExecutor = memoryLocalExecutorOptions({ stdout: ['local run completed'] });
    const result = await runLocal(
      {
        source: 'cli',
        spec: 'generate a local workflow for packages/local/src/entrypoint.ts',
        invocationRoot: '/caller-repo',
      },
      {
        localExecutor: {
          ...localExecutor,
          cwd: '/packages/cli',
          returnGeneratedArtifactOnly: true,
        },
      },
    );

    const artifactPath = result.artifacts[0]?.path;

    expect(result.ok).toBe(true);
    expect(artifactPath).toMatch(/^workflows\/generated\/.+\.ts$/);
    expect(localExecutor.writes[0]).toMatchObject({
      path: artifactPath,
      cwd: '/caller-repo',
    });
    expect(result.nextActions).toContain(
      `Run the generated workflow locally: ricky run ${artifactPath}`,
    );
    expect(localExecutor.runner.invocations).toHaveLength(0);
  });

  it('does not persist generation metadata sidecars in the repo by default', async () => {
    const localExecutor = memoryLocalExecutorOptions({ stdout: ['should not launch'] });
    const result = await runLocal(
      {
        source: 'cli',
        spec: 'generate a local workflow for packages/local/src/entrypoint.ts',
        stageMode: 'generate',
      },
      { localExecutor },
    );

    expect(result.ok).toBe(true);
    expect(workflowArtifactWrites(localExecutor.writes)).toHaveLength(1);
    expect(generationMetadataWrites(localExecutor.writes)).toHaveLength(0);
    expect(result.generation?.decisions?.skill_matches).toBeDefined();
    expect(result.generation?.decisions?.tool_selection).toBeDefined();
  });

  it('can persist generation metadata sidecars when explicitly requested', async () => {
    const localExecutor = memoryLocalExecutorOptions({ stdout: ['should not launch'] });
    const result = await runLocal(
      {
        source: 'cli',
        spec: 'generate a local workflow for packages/local/src/entrypoint.ts',
        stageMode: 'generate',
      },
      {
        localExecutor: {
          ...localExecutor,
          persistGenerationMetadataArtifacts: true,
        },
      },
    );

    expect(result.ok).toBe(true);
    expect(workflowArtifactWrites(localExecutor.writes)).toHaveLength(1);
    expect(generationMetadataWrites(localExecutor.writes).map((write) => write.path)).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/\/skill-matches\.json$/),
        expect.stringMatching(/\/tool-selection\.json$/),
      ]),
    );
  });

  it('turns a structured local CLI spec into generated artifact metadata and user-facing response', async () => {
    const localExecutor = memoryLocalExecutorOptions({ stdout: ['should not launch'] });
    const result = await runLocal(
      {
        source: 'cli',
        requestId: 'req-local-cli-loop',
        spec: {
          description:
            'generate a local workflow for packages/local/src/proof/local-entrypoint-proof.ts with deterministic validation evidence',
          targetFiles: [
            'packages/local/src/proof/local-entrypoint-proof.ts',
            'packages/local/src/proof/local-entrypoint-proof.test.ts',
          ],
          acceptanceGates: ['npx vitest run packages/local/src/proof/local-entrypoint-proof.test.ts'],
        },
        cliMetadata: { argv: ['ricky', 'run', '--mode', 'local', '--spec'] },
      },
      {
        localExecutor: {
          ...localExecutor,
          returnGeneratedArtifactOnly: true,
        },
      },
    );

    const artifact = result.artifacts[0];
    const written = localExecutor.writes[0];

    expect(result.ok).toBe(true);
    expect(localExecutor.runner.invocations).toHaveLength(0);
    expect(workflowArtifactWrites(localExecutor.writes)).toHaveLength(1);
    expect(written.path).toMatch(/^workflows\/generated\/.+\.ts$/);
    expect(written.content).toContain('workflow(');
    expect(written.content).toContain('.channel("wf-ricky-');
    expect(written.content).toContain('initial-soft-validation');
    expect(written.content).toContain('final-hard-validation');
    expect(artifact).toEqual({
      path: written.path,
      type: 'text/typescript',
      content: written.content,
    });
    expect(result.logs).toEqual(
      expect.arrayContaining([
        '[local] received spec from cli',
        '[local] mode: local',
        '[local] spec intake route: generate',
        '[local] workflow generation: passed',
        '[local] runtime launch skipped: returning generated artifact only',
      ]),
    );
    expect(result.nextActions[0]).toBe(`Run the generated workflow locally: ricky run ${written.path}`);
    expect(result.warnings.some((warning) => warning.includes('Cloud API surface'))).toBe(false);
  });

  it('keeps CLI, MCP, and Claude generation handoffs on the explicit local/BYOH path', async () => {
    const cases: Array<{
      name: string;
      handoff: RawHandoff;
      expectedSource: LocalInvocationRequest['source'];
    }> = [
      {
        name: 'cli',
        handoff: {
          source: 'cli',
          stageMode: 'run',
          spec: {
            description: 'generate a local workflow for packages/local/src/entrypoint.ts',
            workflowFile: 'workflows/local-cli.workflow.ts',
          },
          cliMetadata: { argv: ['ricky', 'generate', '--local'] },
        },
        expectedSource: 'cli',
      },
      {
        name: 'mcp',
        handoff: {
          source: 'mcp',
          toolName: 'ricky.generate',
          stageMode: 'run',
          arguments: {
            prompt: 'generate a local workflow for packages/local/src/entrypoint.ts',
            workflowFile: 'workflows/local-mcp.workflow.ts',
          },
          mcpMetadata: { toolCallId: 'tool-local-generation' },
        },
        expectedSource: 'mcp',
      },
      {
        name: 'claude',
        handoff: {
          source: 'claude',
          stageMode: 'run',
          spec: {
            request: 'generate a local workflow for packages/local/src/entrypoint.ts',
            workflowFile: 'workflows/local-claude.workflow.ts',
          },
          conversationId: 'conversation-local-generation',
          turnId: 'turn-local-generation',
        },
        expectedSource: 'claude',
      },
    ];

    for (const testCase of cases) {
      const writes: Array<{ path: string; content: string; cwd: string }> = [];
      const launches: RunRequest[] = [];
      const result = await runLocal(testCase.handoff, {
        localExecutor: {
          cwd: '/workspace/ricky',
          artifactWriter: {
            async writeArtifact(path: string, content: string, cwd: string): Promise<void> {
              writes.push({ path, content, cwd });
            },
          },
          coordinator: {
            async launch(request: RunRequest): Promise<CoordinatorResult> {
              launches.push(request);
              return coordinatorResult(request, { stdout: [`${testCase.name} local generation ran`] });
            },
          },
        },
      });

      expect(result.ok, testCase.name).toBe(true);
      expect(workflowArtifactWrites(writes), testCase.name).toHaveLength(1);
      expect(writes[0].cwd, testCase.name).toBe('/workspace/ricky');
      expect(writes[0].content, testCase.name).toContain('workflow(');
      expect(launches, testCase.name).toHaveLength(1);
      expect(launches[0], testCase.name).toMatchObject({
        cwd: '/workspace/ricky',
        route: DEFAULT_LOCAL_ROUTE,
        metadata: {
          source: testCase.expectedSource,
          route: 'generate',
        },
      });
      expect(result.artifacts, testCase.name).toEqual([
        {
          path: writes[0].path,
          type: 'text/typescript',
          content: writes[0].content,
        },
      ]);
      expect(result.logs, testCase.name).toEqual(
        expect.arrayContaining([
          `[local] received spec from ${testCase.expectedSource}`,
          '[local] mode: local',
          '[local] spec intake route: generate',
          '[local] workflow generation: passed',
          '[local] runtime status: passed',
          `[stdout] ${testCase.name} local generation ran`,
        ]),
      );
      expect(result.warnings.some((warning) => warning.includes('Cloud API surface')), testCase.name).toBe(false);
    }
  });

  it('routes workflow artifact input paths directly to the injected local runtime', async () => {
    const artifactPath = 'workflows/wave4-local-byoh/contract-entrypoint.workflow.ts';
    const artifactReader = recordingArtifactReader('import { workflow } from "@agent-relay/sdk/workflows";');
    const launches: RunRequest[] = [];
    const result = await runLocal(
      { source: 'workflow-artifact', artifactPath, requestId: 'req-artifact-routing' },
      {
        artifactReader,
        localExecutor: {
          cwd: '/workspace/ricky',
          coordinator: {
            async launch(request: RunRequest): Promise<CoordinatorResult> {
              launches.push(request);
              return coordinatorResult(request, { stdout: ['artifact routed locally'] });
            },
          },
        },
      },
    );

    expect(result.ok).toBe(true);
    expect(artifactReader.reads).toEqual([artifactPath]);
    expect(launches).toHaveLength(1);
    expect(launches[0]).toMatchObject({
      workflowFile: artifactPath,
      cwd: '/workspace/ricky',
      route: DEFAULT_LOCAL_ROUTE,
      metadata: {
        requestId: 'req-artifact-routing',
        source: 'workflow-artifact',
        route: 'execute',
      },
    });
    expect(result.artifacts).toEqual([{ path: artifactPath, type: 'text/typescript' }]);
    expect(result.logs).toEqual(
      expect.arrayContaining([
        '[local] received spec from workflow-artifact',
        '[local] mode: local',
        `[local] spec path: ${artifactPath}`,
        '[local] spec intake route: execute',
        `[local] runtime command: @agent-relay/sdk/workflows runScriptWorkflow ${artifactPath}`,
        '[stdout] artifact routed locally',
      ]),
    );
    expect(result.logs.some((line) => line.includes('[local] workflow generation'))).toBe(false);
    expect(result.warnings.some((warning) => warning.includes('Cloud API surface'))).toBe(false);
  });

  it('uses injected workflow artifact adapters without live process execution or machine-specific paths', async () => {
    const artifactPath = 'workflows/wave4-local-byoh/injected-ready.workflow.ts';
    const artifactReader = recordingArtifactReader('import { workflow } from "@agent-relay/sdk/workflows";');
    const liveRunner = throwingCommandRunner('live workflow process should not be used');
    const launches: RunRequest[] = [];

    const result = await runLocal(
      {
        source: 'workflow-artifact',
        artifactPath,
        metadata: { origin: 'artifact-gate' },
        requestId: 'req-injected-artifact',
      },
      {
        artifactReader,
        localExecutor: {
          cwd: 'workspace-under-test',
          commandRunner: liveRunner,
          coordinator: {
            async launch(request: RunRequest): Promise<CoordinatorResult> {
              launches.push(request);
              return coordinatorResult(request, {
                stdout: ['injected local coordinator accepted artifact'],
                stderr: ['injected local runtime warning'],
              });
            },
          },
        },
      },
    );

    expect(result.ok).toBe(true);
    expect(artifactReader.reads).toEqual([artifactPath]);
    expect(liveRunner.invocations).toHaveLength(0);
    expect(launches).toHaveLength(1);
    expect(launches[0]).toMatchObject({
      workflowFile: artifactPath,
      cwd: 'workspace-under-test',
      route: DEFAULT_LOCAL_ROUTE,
      metadata: {
        requestId: 'req-injected-artifact',
        source: 'workflow-artifact',
        route: 'execute',
      },
    });
    expect(result.artifacts).toEqual([{ path: artifactPath, type: 'text/typescript' }]);
    expect(result.logs).toEqual(
      expect.arrayContaining([
        '[local] received spec from workflow-artifact',
        '[local] mode: local',
        `[local] spec path: ${artifactPath}`,
        '[local] spec intake route: execute',
        '[local] runtime status: passed',
        `[local] runtime command: @agent-relay/sdk/workflows runScriptWorkflow ${artifactPath}`,
        '[stdout] injected local coordinator accepted artifact',
        '[stderr] injected local runtime warning',
      ]),
    );
    expect(result.nextActions).toEqual(['Inspect generated artifacts and local run evidence.']);
    expect(result.logs.some((line) => line.includes('[local] workflow generation'))).toBe(false);
    expect(result.warnings.some((warning) => warning.includes('Cloud API surface'))).toBe(false);
  });

  it('surfaces local runtime environment warnings as local failures without Cloud fallback', async () => {
    const workflowFile = 'workflows/wave4-local-byoh/missing-environment.workflow.ts';
    const launches: RunRequest[] = [];
    const result = await runLocal(
      {
        source: 'cli',
        spec: {
          description: 'run the local workflow artifact',
          targetRepo: 'ricky',
          workflowFile,
          stageMode: 'run',
        },
      },
      {
        localExecutor: {
          cwd: '/workspace/ricky',
          coordinator: {
            async launch(request: RunRequest): Promise<CoordinatorResult> {
              launches.push(request);
              return coordinatorResult(request, {
                status: 'failed',
                exitCode: 127,
                stderr: ['agent-relay: command not found'],
                error: 'local runtime environment missing agent-relay',
              });
            },
          },
        },
      },
    );

    expect(result.ok).toBe(false);
    expect(launches).toHaveLength(1);
    expect(launches[0].workflowFile).toBe(workflowFile);
    expect(result.artifacts).toEqual([{ path: workflowFile, type: 'text/typescript' }]);
    expect(result.logs).toEqual(
      expect.arrayContaining([
        '[local] received spec from cli',
        '[local] mode: local',
        '[local] spec intake route: execute',
        '[local] runtime status: failed',
        '[stderr] agent-relay: command not found',
      ]),
    );
    expect(result.warnings).toEqual([
      'Runtime dependency is unavailable: local runtime environment missing agent-relay.',
    ]);
    expect(result.nextActions).toEqual([
      'npm install',
      `ricky run ${workflowFile}`,
    ]);
    expect(result.warnings.some((warning) => warning.includes('Cloud API surface'))).toBe(false);
  });

  it('returns artifacts, logs, warnings, and nextActions in the response', async () => {
    const executor = mockExecutor({
      artifacts: [{ path: 'out/wf.ts', type: 'text/typescript', content: 'code' }],
      logs: ['[gen] done'],
      warnings: ['check permissions'],
      nextActions: ['run the workflow'],
    });

    const result = await runLocal(
      { source: 'cli', spec: 'build' },
      { executor },
    );

    expect(result.ok).toBe(true);
    expect(result.artifacts).toEqual([{ path: 'out/wf.ts', type: 'text/typescript', content: 'code' }]);
    expect(result.logs).toEqual(['[gen] done']);
    expect(result.warnings).toEqual(['check permissions']);
    expect(result.nextActions).toEqual(['run the workflow']);
  });

  it('runs intake, generation, artifact writing, and local runtime with injectable adapters', async () => {
    const localExecutor = memoryLocalExecutorOptions();
    const result = await runLocal(
      { source: 'cli', spec: 'generate a local workflow for src/local/entrypoint.ts with tests', stageMode: 'run' },
      { localExecutor },
    );

    expect(result.ok).toBe(true);
    expect(result.logs.some((l) => l.includes('[local] received spec from cli'))).toBe(true);
    expect(result.logs.some((l) => l.includes('[local] spec intake route: generate'))).toBe(true);
    expect(result.logs.some((l) => l.includes('[local] workflow generation: passed'))).toBe(true);
    expect(result.logs.some((l) => l.includes('[local] runtime status: passed'))).toBe(true);
    expect(workflowArtifactWrites(localExecutor.writes)).toHaveLength(1);
    expect(result.artifacts[0].content).toContain('workflow(');
  });

  it('returns generated local artifacts and runtime logs without invoking Cloud adapters', async () => {
    const launches: RunRequest[] = [];
    const writes: Array<{ path: string; content: string; cwd: string }> = [];
    const result = await runLocal(
      {
        source: 'mcp',
        toolName: 'ricky.generate',
        arguments: {
          goal: 'generate a local BYOH workflow for packages/local/src/entrypoint.ts',
          executionPreference: 'local',
          stageMode: 'run',
        },
        requestId: 'req-generated-local-contract',
      },
      {
        localExecutor: {
          cwd: '/workspace/ricky',
          artifactWriter: {
            async writeArtifact(path: string, content: string, cwd: string): Promise<void> {
              writes.push({ path, content, cwd });
            },
          },
          coordinator: {
            async launch(request: RunRequest): Promise<CoordinatorResult> {
              launches.push(request);
              return coordinatorResult(request, {
                stdout: ['generated workflow ran locally'],
                stderr: ['local runtime warning'],
              });
            },
          },
        },
      },
    );

    expect(result.ok).toBe(true);
    expect(workflowArtifactWrites(writes)).toHaveLength(1);
    expect(writes[0].cwd).toBe('/workspace/ricky');
    expect(writes[0].content).toContain('workflow(');
    expect(launches).toHaveLength(1);
    expect(launches[0]).toMatchObject({
      cwd: '/workspace/ricky',
      route: DEFAULT_LOCAL_ROUTE,
      metadata: {
        requestId: 'req-generated-local-contract',
        source: 'mcp',
        route: 'generate',
      },
    });
    expect(result.artifacts).toEqual([
      {
        path: writes[0].path,
        type: 'text/typescript',
        content: writes[0].content,
      },
    ]);
    expect(result.logs).toEqual(
      expect.arrayContaining([
        '[local] received spec from mcp',
        '[local] mode: local',
        '[local] spec intake route: generate',
        '[local] workflow generation: passed',
        '[local] runtime status: passed',
        '[stdout] generated workflow ran locally',
        '[stderr] local runtime warning',
      ]),
    );
    expect(result.warnings.some((warning) => warning.includes('Cloud API surface'))).toBe(false);
  });

  it('coordinates an existing local workflow artifact without generating a replacement', async () => {
    const localExecutor = memoryLocalExecutorOptions();
    const result = await runLocal(
      { source: 'cli', spec: 'run workflows/wave4-local-byoh/02-local-invocation-entrypoint.ts', stageMode: 'run' },
      { localExecutor },
    );

    expect(result.ok).toBe(true);
    expect(localExecutor.writes).toHaveLength(0);
    expect(result.artifacts).toEqual([
      { path: 'workflows/wave4-local-byoh/02-local-invocation-entrypoint.ts', type: 'text/typescript' },
    ]);
    expect(result.logs.some((l) => l.includes('[local] spec intake route: execute'))).toBe(true);
    expect(result.logs.some((l) => l.includes('[local] runtime status: passed'))).toBe(true);
  });

  it('routes an executable CLI specFile as a ready workflow artifact without generation', async () => {
    const localExecutor = memoryLocalExecutorOptions({ stdout: ['cli specFile run ok'] });
    const workflowFile = 'workflows/wave4-local-byoh/spec-file-ready.workflow.ts';
    const result = await runLocal(
      {
        source: 'cli',
        spec: 'run this local workflow',
        specFile: workflowFile,
        stageMode: 'run',
        cliMetadata: { argv: ['ricky', 'run', workflowFile] },
      },
      { localExecutor },
    );

    expect(result.ok).toBe(true);
    expect(localExecutor.writes).toHaveLength(0);
    expect(localExecutor.runner.invocations).toHaveLength(1);
    expect(localExecutor.runner.invocations[0].args).toEqual([...(DEFAULT_LOCAL_ROUTE.baseArgs ?? []), workflowFile]);
    expect(result.artifacts).toEqual([{ path: workflowFile, type: 'text/typescript' }]);
    expect(result.logs).toEqual(
      expect.arrayContaining([
        '[local] received spec from cli',
        '[local] mode: local',
        `[local] spec path: ${workflowFile}`,
        '[local] spec intake route: execute',
        '[stdout] cli specFile run ok',
      ]),
    );
    expect(result.logs.some((l) => l.includes('[local] workflow generation'))).toBe(false);
  });

  it('routes a non-executable CLI specFile to generate even when the spec body mentions a workflow path', async () => {
    const localExecutor = memoryLocalExecutorOptions();
    const designDoc = [
      '# Relay-backed review runtime',
      '',
      'The durable deep-review path in `workflows/runtime/deep-review-pr.ts` is the foundation we want to extend.',
      'Run, launch, and start references are scattered through the runtime narrative below.',
      'Author a workflow that wires the new runtime end-to-end.',
    ].join('\n');
    const result = await runLocal(
      {
        source: 'cli',
        spec: designDoc,
        specFile: '/specs/relay-backed-review-runtime-spec.md',
        stageMode: 'generate',
        cliMetadata: { argv: ['ricky', '--mode', 'local', '--spec-file', '/specs/relay-backed-review-runtime-spec.md'] },
      },
      { localExecutor },
    );

    expect(result.ok).toBe(true);
    expect(result.logs.some((l) => l.includes('[local] spec intake route: generate'))).toBe(true);
    expect(result.logs.some((l) => l.includes('[local] spec intake route: clarify'))).toBe(false);
    expect(result.logs.some((l) => l.includes('[local] workflow generation: passed'))).toBe(true);
  });

  it('returns local artifact and runtime log shape for an injected runtime adapter', async () => {
    const localExecutor = memoryLocalExecutorOptions({
      stdout: ['local workflow completed'],
      stderr: ['local warning from runtime'],
    });
    const result = await runLocal(
      { source: 'cli', spec: 'run workflows/wave4-local-byoh/02-local-invocation-entrypoint.ts', stageMode: 'run' },
      { localExecutor },
    );

    expect(result).toMatchObject({
      ok: true,
      artifacts: [
        {
          path: 'workflows/wave4-local-byoh/02-local-invocation-entrypoint.ts',
          type: 'text/typescript',
        },
      ],
      nextActions: ['Inspect generated artifacts and local run evidence.'],
    });
    expect(result.logs).toEqual(
      expect.arrayContaining([
        '[local] received spec from cli',
        '[local] mode: local',
        '[local] spec intake route: execute',
        '[local] runtime status: passed',
        '[stdout] local workflow completed',
        '[stderr] local warning from runtime',
      ]),
    );
    expect(result.warnings.some((w) => w.includes('Cloud API surface'))).toBe(false);
  });

  it('coordinates a workflow artifact handoff as a ready local workflow', async () => {
    const localExecutor = memoryLocalExecutorOptions();
    const result = await runLocal(
      { source: 'workflow-artifact', artifactPath: 'workflows/wave4-local-byoh/02-local-invocation-entrypoint.ts' },
      { localExecutor, artifactReader: mockArtifactReader('import { workflow } from "@agent-relay/sdk/workflows";') },
    );

    expect(result.ok).toBe(true);
    expect(localExecutor.writes).toHaveLength(0);
    expect(localExecutor.runner.invocations).toHaveLength(1);
    expect(localExecutor.runner.invocations[0].args).toContain('workflows/wave4-local-byoh/02-local-invocation-entrypoint.ts');
    expect(result.artifacts[0].path).toBe('workflows/wave4-local-byoh/02-local-invocation-entrypoint.ts');
    expect(result.logs.some((l) => l.includes('[local] spec intake route: execute'))).toBe(true);
    expect(result.logs.some((l) => l.includes('[local] workflow generation'))).toBe(false);
  });

  it('reads workflow artifact input and routes the artifact path to the local runtime without Cloud fallback', async () => {
    const localExecutor = memoryLocalExecutorOptions({ stdout: ['artifact run ok'] });
    const artifactReader = recordingArtifactReader('import { workflow } from "@agent-relay/sdk/workflows";');
    const artifactPath = 'workflows/wave4-local-byoh/local-artifact.workflow.ts';
    const result = await runLocal(
      { source: 'workflow-artifact', artifactPath, metadata: { handoff: 'file-gate' } },
      { localExecutor, artifactReader },
    );

    expect(result.ok).toBe(true);
    expect(artifactReader.reads).toEqual([artifactPath]);
    expect(localExecutor.writes).toHaveLength(0);
    expect(localExecutor.runner.invocations).toHaveLength(1);
    expect(localExecutor.runner.invocations[0].args).toEqual([...(DEFAULT_LOCAL_ROUTE.baseArgs ?? []), artifactPath]);
    expect(result.artifacts).toEqual([{ path: artifactPath, type: 'text/typescript' }]);
    expect(result.logs).toEqual(
      expect.arrayContaining([
        '[local] received spec from workflow-artifact',
        '[local] mode: local',
        '[local] spec path: workflows/wave4-local-byoh/local-artifact.workflow.ts',
        '[local] spec intake route: execute',
        '[stdout] artifact run ok',
      ]),
    );
    expect(result.logs.some((l) => l.includes('[local] workflow generation'))).toBe(false);
    expect(result.warnings.some((w) => w.includes('Cloud API surface'))).toBe(false);
  });

  it('routes workflow artifact inputs to an injected local coordinator with normalized metadata', async () => {
    const artifactPath = 'workflows/wave4-local-byoh/ready-local.workflow.ts';
    const artifactReader = recordingArtifactReader('import { workflow } from "@agent-relay/sdk/workflows";');
    const launches: RunRequest[] = [];
    const result = await runLocal(
      {
        source: 'workflow-artifact',
        artifactPath,
        metadata: { gate: 'post-implementation-file-gate' },
        requestId: 'req-local-artifact',
      },
      {
        artifactReader,
        localExecutor: {
          cwd: '/workspace/ricky',
          coordinator: {
            async launch(request: RunRequest): Promise<CoordinatorResult> {
              launches.push(request);
              return coordinatorResult(request, {
                stdout: ['coordinator accepted local artifact'],
                stderr: ['coordinator emitted local warning'],
              });
            },
          },
        },
      },
    );

    expect(result.ok).toBe(true);
    expect(artifactReader.reads).toEqual([artifactPath]);
    expect(launches).toHaveLength(1);
    expect(launches[0]).toMatchObject({
      workflowFile: artifactPath,
      cwd: '/workspace/ricky',
      route: DEFAULT_LOCAL_ROUTE,
      metadata: {
        source: 'workflow-artifact',
        route: 'execute',
      },
    });
    expect(result.artifacts).toEqual([{ path: artifactPath, type: 'text/typescript' }]);
    expect(result.logs).toEqual(
      expect.arrayContaining([
        '[local] received spec from workflow-artifact',
        '[local] mode: local',
        '[local] spec intake route: execute',
        '[local] runtime status: passed',
        '[local] runtime command: @agent-relay/sdk/workflows runScriptWorkflow workflows/wave4-local-byoh/ready-local.workflow.ts',
        '[stdout] coordinator accepted local artifact',
        '[stderr] coordinator emitted local warning',
      ]),
    );
    expect(result.logs.some((l) => l.includes('[local] workflow generation'))).toBe(false);
    expect(result.warnings.some((w) => w.includes('Cloud API surface'))).toBe(false);
  });

  it('returns the local/BYOH artifact and log contract from an injected coordinator', async () => {
    const workflowFile = 'workflows/wave4-local-byoh/contract.workflow.ts';
    const launches: RunRequest[] = [];
    const result = await runLocal(
      {
        source: 'mcp',
        toolName: 'ricky.runLocal',
        arguments: {
          goal: 'run the local workflow artifact',
          targetRepo: 'ricky',
          workflowFile,
          stageMode: 'run',
        },
        mcpMetadata: { toolCallId: 'tool-contract' },
        requestId: 'req-contract',
      },
      {
        localExecutor: {
          cwd: '/workspace/ricky',
          coordinator: {
            async launch(request: RunRequest): Promise<CoordinatorResult> {
              launches.push(request);
              return coordinatorResult(request, {
                stdout: ['local artifact executed'],
                stderr: ['local environment warning'],
              });
            },
          },
        },
      },
    );

    expect(result).toMatchObject({
      ok: true,
      artifacts: [{ path: workflowFile, type: 'text/typescript' }],
      logs: expect.arrayContaining([
        '[local] received spec from mcp',
        '[local] mode: local',
        '[local] spec intake route: execute',
        '[local] runtime status: passed',
        `[local] runtime command: @agent-relay/sdk/workflows runScriptWorkflow ${workflowFile}`,
        '[stdout] local artifact executed',
        '[stderr] local environment warning',
      ]),
      warnings: [],
      nextActions: ['Inspect generated artifacts and local run evidence.'],
    });
    expect(launches).toHaveLength(1);
    expect(launches[0]).toMatchObject({
      workflowFile,
      cwd: '/workspace/ricky',
      route: DEFAULT_LOCAL_ROUTE,
      metadata: {
        requestId: 'req-contract',
        source: 'mcp',
        route: 'execute',
      },
    });
    expect(result.warnings.some((warning) => warning.includes('Cloud API surface'))).toBe(false);
  });

  it('normalizes CLI, MCP, and Claude specs into explicit local adapter requests', async () => {
    const handoffs: Array<{
      name: string;
      handoff: RawHandoff;
      expected: Partial<LocalInvocationRequest>;
    }> = [
      {
        name: 'cli',
        handoff: {
          source: 'cli',
          spec: {
            description: 'generate a local CLI workflow',
            workflowFile: 'workflows/local-cli.workflow.ts',
          },
          cliMetadata: { argv: ['ricky', 'generate', '--local'] },
          requestId: 'req-cli-contract',
        },
        expected: {
          source: 'cli',
          spec: 'generate a local CLI workflow',
          metadata: { argv: ['ricky', 'generate', '--local'] },
          requestId: 'req-cli-contract',
        },
      },
      {
        name: 'mcp',
        handoff: {
          source: 'mcp',
          toolName: 'ricky.generate',
          arguments: {
            prompt: 'generate a local MCP workflow',
            workflowFile: 'workflows/local-mcp.workflow.ts',
          },
          mcpMetadata: { toolCallId: 'tool-contract' },
        },
        expected: {
          source: 'mcp',
          spec: 'generate a local MCP workflow',
          metadata: { toolCallId: 'tool-contract', toolName: 'ricky.generate' },
        },
      },
      {
        name: 'claude',
        handoff: {
          source: 'claude',
          spec: {
            request: 'generate a local Claude workflow',
            workflowFile: 'workflows/local-claude.workflow.ts',
          },
          conversationId: 'conv-contract',
          turnId: 'turn-contract',
        },
        expected: {
          source: 'claude',
          spec: 'generate a local Claude workflow',
          metadata: { conversationId: 'conv-contract', turnId: 'turn-contract' },
        },
      },
    ];

    for (const { name, handoff, expected } of handoffs) {
      const executor = mockExecutor({
        logs: [`[mock] accepted ${name} handoff locally`],
      });
      const result = await runLocal(handoff, { executor });

      expect(result.ok, name).toBe(true);
      expect(executor.calls, name).toHaveLength(1);
      expect(executor.calls[0], name).toMatchObject({
        _normalized: true,
        mode: 'local',
        ...expected,
      });
      expect(result.logs, name).toEqual([`[mock] accepted ${name} handoff locally`]);
      expect(result.warnings.some((warning) => warning.includes('Cloud API surface')), name).toBe(false);
    }
  });

  it('reads workflow artifact inputs from invocationRoot and routes the relative artifact path locally', async () => {
    const artifactPath = 'workflows/wave4-local-byoh/relative-entrypoint.workflow.ts';
    const artifactReader = recordingArtifactReader('import { workflow } from "@agent-relay/sdk/workflows";');
    const launches: RunRequest[] = [];
    const result = await runLocal(
      {
        source: 'workflow-artifact',
        artifactPath,
        invocationRoot: '/caller/repo',
        requestId: 'req-artifact-invocation-root',
      },
      {
        artifactReader,
        localExecutor: {
          cwd: '/ignored/package/root',
          coordinator: {
            async launch(request: RunRequest): Promise<CoordinatorResult> {
              launches.push(request);
              return coordinatorResult(request, {
                stdout: ['artifact executed from captured caller root'],
              });
            },
          },
          artifactWriter: {
            async writeArtifact(): Promise<void> {
              throw new Error('workflow artifact handoff must not generate a replacement artifact');
            },
          },
        },
      },
    );

    expect(result.ok).toBe(true);
    expect(artifactReader.reads).toEqual([`/caller/repo/${artifactPath}`]);
    expect(launches).toHaveLength(1);
    expect(launches[0]).toMatchObject({
      workflowFile: artifactPath,
      cwd: '/caller/repo',
      route: DEFAULT_LOCAL_ROUTE,
      metadata: {
        requestId: 'req-artifact-invocation-root',
        source: 'workflow-artifact',
        route: 'execute',
      },
    });
    expect(result.artifacts).toEqual([{ path: artifactPath, type: 'text/typescript' }]);
    expect(result.logs).toEqual(
      expect.arrayContaining([
        '[local] received spec from workflow-artifact',
        '[local] mode: local',
        `[local] spec path: ${artifactPath}`,
        '[local] spec intake route: execute',
        `[local] runtime command: @agent-relay/sdk/workflows runScriptWorkflow ${artifactPath}`,
        '[stdout] artifact executed from captured caller root',
      ]),
    );
    expect(result.logs.some((line) => line.includes('[local] workflow generation'))).toBe(false);
    expect(result.warnings.some((warning) => warning.includes('Cloud API surface'))).toBe(false);
  });

  it('returns local artifact, logs, and environment recovery warnings without Cloud fallback', async () => {
    const workflowFile = 'workflows/wave4-local-byoh/env-warning.workflow.ts';
    const launches: RunRequest[] = [];
    const result = await runLocal(
      {
        source: 'cli',
        spec: {
          description: 'run the local workflow artifact',
          targetRepo: 'ricky',
          workflowFile,
        },
        stageMode: 'run',
      },
      {
        localExecutor: {
          cwd: '/workspace/ricky',
          coordinator: {
            async launch(request: RunRequest): Promise<CoordinatorResult> {
              launches.push(request);
              return coordinatorResult(request, {
                status: 'failed',
                exitCode: 1,
                stdout: ['local runtime started'],
                stderr: ['MISSING_ENV_VAR: AGENT_RELAY_API_KEY, GITHUB_TOKEN'],
              });
            },
          },
        },
      },
    );

    expect(result.ok).toBe(false);
    expect(result.artifacts).toEqual([{ path: workflowFile, type: 'text/typescript' }]);
    expect(launches).toHaveLength(1);
    expect(launches[0]).toMatchObject({
      workflowFile,
      cwd: '/workspace/ricky',
      route: DEFAULT_LOCAL_ROUTE,
      metadata: {
        source: 'cli',
        route: 'execute',
      },
    });
    expect(result.logs).toEqual(
      expect.arrayContaining([
        '[local] received spec from cli',
        '[local] mode: local',
        '[local] spec intake route: execute',
        '[local] runtime status: failed',
        '[stdout] local runtime started',
        '[stderr] MISSING_ENV_VAR: AGENT_RELAY_API_KEY, GITHUB_TOKEN',
      ]),
    );
    expect(result.execution).toMatchObject({
      stage: 'execute',
      status: 'blocker',
      blocker: {
        code: 'MISSING_ENV_VAR',
        category: 'environment',
        context: {
          missing: ['AGENT_RELAY_API_KEY', 'GITHUB_TOKEN'],
        },
      },
      evidence: {
        logs: {
          tail: ['local runtime started', 'MISSING_ENV_VAR: AGENT_RELAY_API_KEY, GITHUB_TOKEN'],
          truncated: false,
        },
      },
    });
    expect(result.warnings).toEqual([
      'Required runtime environment is missing: MISSING_ENV_VAR: AGENT_RELAY_API_KEY, GITHUB_TOKEN.',
    ]);
    expect(result.nextActions).toEqual([
      'export AGENT_RELAY_API_KEY=...',
      'export GITHUB_TOKEN=...',
    ]);
    expect(result.warnings.some((warning) => warning.includes('Cloud API surface'))).toBe(false);
    expect(result.nextActions.some((action) => action.includes('promote to Cloud'))).toBe(false);
  });

  it('surfaces injected local coordinator environment failures without Cloud fallback', async () => {
    const launches: RunRequest[] = [];
    const result = await runLocal(
      { source: 'cli', spec: 'run workflows/wave4-local-byoh/missing-runtime.workflow.ts', stageMode: 'run' },
      {
        localExecutor: {
          cwd: '/workspace/ricky',
          coordinator: {
            async launch(request: RunRequest): Promise<CoordinatorResult> {
              launches.push(request);
              return coordinatorResult(request, {
                status: 'failed',
                exitCode: 127,
                stderr: ['agent-relay: command not found'],
                error: 'local runtime environment missing agent-relay',
              });
            },
          },
        },
      },
    );

    expect(result.ok).toBe(false);
    expect(launches).toHaveLength(1);
    expect(launches[0].workflowFile).toBe('workflows/wave4-local-byoh/missing-runtime.workflow.ts');
    expect(launches[0].route).toEqual(DEFAULT_LOCAL_ROUTE);
    expect(result.logs).toEqual(
      expect.arrayContaining([
        '[local] received spec from cli',
        '[local] mode: local',
        '[local] spec intake route: execute',
        '[local] runtime status: failed',
        '[stderr] agent-relay: command not found',
      ]),
    );
    expect(result.warnings).toContain('Runtime dependency is unavailable: local runtime environment missing agent-relay.');
    expect(result.warnings.some((w) => w.includes('Cloud API surface'))).toBe(false);
    expect(result.nextActions).toEqual([
      'npm install',
      'ricky run workflows/wave4-local-byoh/missing-runtime.workflow.ts',
    ]);
  });

  it('default executor warns on cloud mode', async () => {
    const result = await runLocal({ source: 'cli', spec: 'hello', mode: 'cloud' });

    expect(result.ok).toBe(false);
    expect(result.warnings.some((w) => w.includes('local/BYOH entrypoint'))).toBe(true);
  });

  it('default executor suggests promotion for both mode', async () => {
    const result = await runLocal(
      {
        source: 'cli',
        spec: 'generate a local workflow for src/local/entrypoint.ts with tests',
        mode: 'both',
        stageMode: 'run',
      },
      { localExecutor: memoryLocalExecutorOptions() },
    );

    expect(result.ok).toBe(true);
    expect(result.nextActions.some((a) => a.includes('promote to Cloud'))).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // Regression proof coverage for issue #1 and #2: artifact paths and cwd
  // ---------------------------------------------------------------------------

  describe('regression: createLocalExecutor writes artifacts under supplied cwd', () => {
    it('writes artifact content under localExecutor.cwd', async () => {
      const writes: Array<{ path: string; content: string; cwd: string }> = [];
      const result = await runLocal(
        { source: 'cli', spec: 'generate a workflow for cwd test' },
        {
          localExecutor: {
            cwd: '/custom-cwd',
            artifactWriter: {
              async writeArtifact(path: string, content: string, cwd: string): Promise<void> {
                writes.push({ path, content, cwd });
              },
            },
            returnGeneratedArtifactOnly: true,
          },
        },
      );

      expect(result.ok).toBe(true);
      expect(workflowArtifactWrites(writes)).toHaveLength(1);
      expect(writes[0].cwd).toBe('/custom-cwd');
      expect(writes[0].path).toMatch(/^workflows\/generated\//);
      expect(writes[0].content).toContain('workflow(');
    });

    it('writes artifact content under request.invocationRoot when provided', async () => {
      const writes: Array<{ path: string; content: string; cwd: string }> = [];
      const result = await runLocal(
        {
          source: 'cli',
          spec: 'generate a workflow for invocationRoot test',
          invocationRoot: '/caller-repo',
        },
        {
          localExecutor: {
            cwd: '/should-be-overridden',
            artifactWriter: {
              async writeArtifact(path: string, content: string, cwd: string): Promise<void> {
                writes.push({ path, content, cwd });
              },
            },
            returnGeneratedArtifactOnly: true,
          },
        },
      );

      expect(result.ok).toBe(true);
      expect(workflowArtifactWrites(writes)).toHaveLength(1);
      expect(writes[0].cwd).toBe('/caller-repo');
      expect(writes[0].path).toMatch(/^workflows\/generated\//);
    });

    it('printed artifact path exists relative to the same cwd', async () => {
      const { mkdtemp, rm, access, readFile } = await import('node:fs/promises');
      const { tmpdir } = await import('node:os');
      const { join } = await import('node:path');
      const tempDir = await mkdtemp(join(tmpdir(), 'ricky-local-artifact-'));

      try {
        const result = await runLocal(
          { source: 'cli', spec: 'generate a workflow for path test' },
          {
            localExecutor: {
              cwd: tempDir,
              returnGeneratedArtifactOnly: true,
            },
          },
        );

        expect(result.ok).toBe(true);
        const artifactPath = result.artifacts[0].path;

        // Artifact physically exists at the cwd-relative path
        const fullPath = join(tempDir, artifactPath);
        await expect(access(fullPath)).resolves.toBeUndefined();

        // Content matches
        const content = await readFile(fullPath, 'utf8');
        expect(content).toBe(result.artifacts[0].content);
      } finally {
        await rm(tempDir, { recursive: true, force: true });
      }
    });

    it('printed next command points to the same existing artifact path', async () => {
      const { mkdtemp, rm, access } = await import('node:fs/promises');
      const { tmpdir } = await import('node:os');
      const { join } = await import('node:path');
      const tempDir = await mkdtemp(join(tmpdir(), 'ricky-next-cmd-'));

      try {
        const result = await runLocal(
          { source: 'cli', spec: 'generate a workflow for next command test' },
          {
            localExecutor: {
              cwd: tempDir,
              returnGeneratedArtifactOnly: true,
            },
          },
        );

        expect(result.ok).toBe(true);
        const artifactPath = result.artifacts[0].path;

        // Next action uses the exact same path
        expect(result.nextActions).toContain(
          `Run the generated workflow locally: ricky run ${artifactPath}`,
        );

        // And that path exists
        await expect(access(join(tempDir, artifactPath))).resolves.toBeUndefined();
      } finally {
        await rm(tempDir, { recursive: true, force: true });
      }
    });

    it('no packages/cli/workflows/generated artifact appears when using temp cwd', async () => {
      const { mkdtemp, rm, access } = await import('node:fs/promises');
      const { tmpdir } = await import('node:os');
      const { join } = await import('node:path');
      const tempDir = await mkdtemp(join(tmpdir(), 'ricky-no-cli-'));

      try {
        const result = await runLocal(
          { source: 'cli', spec: 'generate a workflow for no cli artifact test' },
          {
            localExecutor: {
              cwd: tempDir,
              returnGeneratedArtifactOnly: true,
            },
          },
        );

        expect(result.ok).toBe(true);
        const artifactPath = result.artifacts[0].path;
        const artifactName = artifactPath.split('/').pop()!;

        // Artifact exists in temp dir
        await expect(access(join(tempDir, artifactPath))).resolves.toBeUndefined();

        // Artifact does NOT exist in packages/cli/workflows/generated
        const cliPath = join(process.cwd(), 'packages/cli/workflows/generated', artifactName);
        await expect(access(cliPath)).rejects.toThrow();
      } finally {
        await rm(tempDir, { recursive: true, force: true });
      }
    });

    it('writes artifact to request.invocationRoot with real filesystem and generation stage path matches', async () => {
      const { mkdtemp, rm, access, readFile } = await import('node:fs/promises');
      const { tmpdir } = await import('node:os');
      const { join } = await import('node:path');
      const tempDir = await mkdtemp(join(tmpdir(), 'ricky-invroot-fs-'));

      try {
        const result = await runLocal(
          { source: 'cli', spec: 'generate a workflow for invocationRoot fs test', invocationRoot: tempDir },
          {
            localExecutor: {
              cwd: '/should-not-be-used',
              returnGeneratedArtifactOnly: true,
            },
          },
        );

        expect(result.ok).toBe(true);
        const artifactPath = result.artifacts[0].path;
        expect(artifactPath).toMatch(/^workflows\/generated\//);

        // Artifact physically exists under invocationRoot, not under options.cwd
        const fullPath = join(tempDir, artifactPath);
        await expect(access(fullPath)).resolves.toBeUndefined();

        // Content was actually written
        const content = await readFile(fullPath, 'utf8');
        expect(content).toContain('workflow(');
        expect(content).toBe(result.artifacts[0].content);

        // Generation stage artifact.path matches the real artifact
        expect(result.generation).toBeDefined();
        expect(result.generation!.artifact!.path).toBe(artifactPath);

        // Generation stage next.run_command points to same artifact
        expect(result.generation!.next!.run_command).toBe(
          `ricky run ${artifactPath}`,
        );

        // Next action also points to same artifact
        expect(result.nextActions).toContain(
          `Run the generated workflow locally: ricky run ${artifactPath}`,
        );

        // Artifact does NOT exist in packages/cli/workflows/generated
        const artifactName = artifactPath.split('/').pop()!;
        const cliPath = join(process.cwd(), 'packages/cli/workflows/generated', artifactName);
        await expect(access(cliPath)).rejects.toThrow();
      } finally {
        await rm(tempDir, { recursive: true, force: true });
      }
    });

    it('invocationRoot takes precedence over options.cwd with real filesystem proof', async () => {
      const { mkdtemp, rm, access } = await import('node:fs/promises');
      const { tmpdir } = await import('node:os');
      const { join } = await import('node:path');
      const invocationDir = await mkdtemp(join(tmpdir(), 'ricky-invroot-wins-'));
      const cwdDir = await mkdtemp(join(tmpdir(), 'ricky-cwd-loses-'));

      try {
        const result = await runLocal(
          { source: 'cli', spec: 'generate a workflow for precedence test', invocationRoot: invocationDir },
          {
            localExecutor: {
              cwd: cwdDir,
              returnGeneratedArtifactOnly: true,
            },
          },
        );

        expect(result.ok).toBe(true);
        const artifactPath = result.artifacts[0].path;

        // Artifact exists under invocationRoot
        await expect(access(join(invocationDir, artifactPath))).resolves.toBeUndefined();

        // Artifact does NOT exist under options.cwd
        await expect(access(join(cwdDir, artifactPath))).rejects.toThrow();
      } finally {
        await rm(invocationDir, { recursive: true, force: true });
        await rm(cwdDir, { recursive: true, force: true });
      }
    });
  });

  it('uses the local executor path by default for BYOH requests without Cloud warnings', async () => {
    const localExecutor = memoryLocalExecutorOptions();
    const result = await runLocal(
      { source: 'mcp', stageMode: 'run', arguments: { goal: 'generate a local workflow for packages/local/src/entrypoint.ts' } },
      { localExecutor },
    );

    expect(result.ok).toBe(true);
    expect(localExecutor.runner.invocations).toHaveLength(1);
    expect(result.logs.some((l) => l.includes('[local] mode: local'))).toBe(true);
    expect(result.warnings.some((w) => w.includes('Cloud API surface'))).toBe(false);
  });

  it('passes configured cwd to artifact writer so artifacts are placed in execution directory', async () => {
    const localExecutor = memoryLocalExecutorOptions();
    await runLocal(
      { source: 'cli', spec: 'generate a local workflow for src/local/entrypoint.ts with tests', stageMode: 'run' },
      { localExecutor },
    );

    expect(workflowArtifactWrites(localExecutor.writes)).toHaveLength(1);
    expect(localExecutor.writes[0].cwd).toBe('/repo');
  });

  it('uses DEFAULT_LOCAL_ROUTE with the SDK script workflow runner by default', async () => {
    const localExecutor = memoryLocalExecutorOptions();
    await runLocal(
      { source: 'cli', spec: 'generate a local workflow for src/local/entrypoint.ts with tests', stageMode: 'run' },
      { localExecutor },
    );

    const invocation = localExecutor.runner.invocations[0];
    expect(invocation).toBeDefined();
    expect(invocation.command).toBe('@agent-relay/sdk/workflows');
    expect(invocation.args[0]).toBe('runScriptWorkflow');
    expect(invocation.cwd).toBe('/repo');
  });

  it('accepts a custom route override via LocalExecutorOptions', async () => {
    const localExecutor = memoryLocalExecutorOptions();
    localExecutor.route = { command: 'custom-relay', baseArgs: ['execute'] };
    await runLocal(
      { source: 'cli', spec: 'generate a local workflow for src/local/entrypoint.ts with tests', stageMode: 'run' },
      { localExecutor },
    );

    const invocation = localExecutor.runner.invocations[0];
    expect(invocation.command).toBe('custom-relay');
    expect(invocation.args[0]).toBe('execute');
  });

  it('exports DEFAULT_LOCAL_ROUTE with deterministic shape', () => {
    expect(DEFAULT_LOCAL_ROUTE).toEqual({
      command: '@agent-relay/sdk/workflows',
      baseArgs: ['runScriptWorkflow'],
    });
  });

  it('uses the injected SDK script workflow runner without requiring the agent-relay binary', async () => {
    const { mkdir, mkdtemp, rm, writeFile } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const repo = await mkdtemp(join(tmpdir(), 'ricky-sdk-runner-repo-'));
    const artifactPath = 'workflows/generated/sdk-runtime.workflow.ts';
    const calls: Array<{ workflowFile: string; cwd: string; env?: Record<string, string> }> = [];

    try {
      await mkdir(join(repo, 'workflows/generated'), { recursive: true });
      await writeFile(join(repo, artifactPath), 'import { workflow } from "@agent-relay/sdk/workflows";\n', 'utf8');

      const result = await runLocal(
        { source: 'workflow-artifact', artifactPath, stageMode: 'run' },
        {
          artifactReader: mockArtifactReader('import { workflow } from "@agent-relay/sdk/workflows";'),
          onRuntimeOutput: (stream, line) => {
            calls.push({ workflowFile: `${stream}:${line}`, cwd: 'streamed' });
          },
          localExecutor: {
            cwd: repo,
            scriptWorkflowRunner: async (workflowFile, options) => {
              calls.push({ workflowFile, cwd: options.cwd, env: options.env });
              options.onStdout?.('sdk runner accepted workflow');
              options.onStderr?.('sdk runner warning');
              if (options.env?.AGENT_RELAY_RUN_ID_FILE) {
                await writeFile(options.env.AGENT_RELAY_RUN_ID_FILE, 'runtime-from-sdk\n', 'utf8');
              }
            },
          },
        },
      );

      expect(result.ok).toBe(true);
      expect(calls).toEqual([
        expect.objectContaining({ workflowFile: artifactPath, cwd: repo }),
        { workflowFile: 'stdout:sdk runner accepted workflow', cwd: 'streamed' },
        { workflowFile: 'stderr:sdk runner warning', cwd: 'streamed' },
      ]);
      expect(result.execution).toMatchObject({
        stage: 'execute',
        status: 'success',
        execution: {
          command: `@agent-relay/sdk/workflows runScriptWorkflow ${artifactPath}`,
          run_id: 'runtime-from-sdk',
        },
      });
      expect(result.logs).toContain(`[local] runtime command: @agent-relay/sdk/workflows runScriptWorkflow ${artifactPath}`);
      expect(result.warnings).not.toContain('Runtime package "agent-relay" is not installed in this workspace.');
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });

  it('treats SDK runner workflow failure output as a runtime blocker even when the process exits zero', async () => {
    const { mkdir, mkdtemp, rm, writeFile } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const repo = await mkdtemp(join(tmpdir(), 'ricky-sdk-failed-output-repo-'));
    const artifactPath = 'workflows/generated/review-findings.workflow.ts';

    try {
      await mkdir(join(repo, 'workflows/generated'), { recursive: true });
      await writeFile(join(repo, artifactPath), 'import { workflow } from "@agent-relay/sdk/workflows";\n', 'utf8');

      const result = await runLocal(
        { source: 'workflow-artifact', artifactPath, stageMode: 'run' },
        {
          artifactReader: mockArtifactReader('import { workflow } from "@agent-relay/sdk/workflows";'),
          localExecutor: {
            cwd: repo,
            scriptWorkflowRunner: async (_workflowFile, options) => {
              options.onStdout?.('[workflow] FAILED: Step "peer-review-pass-gate" failed');
              options.onStderr?.('[agent-relay] runScriptWorkflow: runner node --experimental-strip-types completed exit=0');
            },
          },
        },
      );

      expect(result.ok).toBe(false);
      expect(result.execution).toMatchObject({
        stage: 'execute',
        status: 'blocker',
        blocker: {
          code: 'INVALID_ARTIFACT',
          category: 'workflow_invalid',
        },
      });
      expect(result.execution?.evidence?.outcome_summary).toContain('Workflow runtime reported failure despite a zero process exit');
      expect(result.logs).toContain('[stdout] [workflow] FAILED: Step "peer-review-pass-gate" failed');
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });

  it('treats structured SDK runner failure results as runtime blockers', async () => {
    const { mkdir, mkdtemp, rm, writeFile } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const repo = await mkdtemp(join(tmpdir(), 'ricky-sdk-failed-result-repo-'));
    const artifactPath = 'workflows/generated/failed-result.workflow.ts';

    try {
      await mkdir(join(repo, 'workflows/generated'), { recursive: true });
      await writeFile(join(repo, artifactPath), 'import { workflow } from "@agent-relay/sdk/workflows";\n', 'utf8');

      const result = await runLocal(
        { source: 'workflow-artifact', artifactPath, stageMode: 'run' },
        {
          artifactReader: mockArtifactReader('import { workflow } from "@agent-relay/sdk/workflows";'),
          localExecutor: {
            cwd: repo,
            scriptWorkflowRunner: async () => ({ status: 'failed', error: 'review gate failed' }),
          },
        },
      );

      expect(result.ok).toBe(false);
      expect(result.execution?.evidence?.outcome_summary).toContain('Workflow runtime reported failed: review gate failed');
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });

  it('uses Ricky SDK runtime resolution without creating repo-local node_modules', async () => {
    const { access, mkdir, mkdtemp, rm, writeFile } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const repo = await mkdtemp(join(tmpdir(), 'ricky-sdk-readonly-repo-'));
    const stateHome = await mkdtemp(join(tmpdir(), 'ricky-sdk-readonly-state-'));
    const artifactPath = 'workflows/generated/sdk-runtime.workflow.ts';
    const previousStateHome = process.env.RICKY_STATE_HOME;

    try {
      process.env.RICKY_STATE_HOME = stateHome;
      await mkdir(join(repo, 'workflows/generated'), { recursive: true });
      await writeFile(
        join(repo, artifactPath),
        'import { workflow } from "@agent-relay/sdk/workflows";\nconsole.log(typeof workflow);\n',
        'utf8',
      );

      const result = await runLocal(
        { source: 'workflow-artifact', artifactPath, stageMode: 'run' },
        {
          artifactReader: mockArtifactReader('import { workflow } from "@agent-relay/sdk/workflows";'),
          localExecutor: {
            cwd: repo,
            timeoutMs: 10_000,
          },
        },
      );

      expect(result.ok).toBe(true);
      expect(result.execution?.status).toBe('success');
      await expect(access(join(repo, 'node_modules'))).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(access(join(stateHome, 'ricky'))).resolves.toBeUndefined();
    } finally {
      if (previousStateHome === undefined) {
        delete process.env.RICKY_STATE_HOME;
      } else {
        process.env.RICKY_STATE_HOME = previousStateHome;
      }
      await rm(repo, { recursive: true, force: true });
      await rm(stateHome, { recursive: true, force: true });
    }
  });

  it('resolves @agent-relay/sdk subpaths and @agent-relay/config via the bundled package', async () => {
    // Regression test for the loader bug fixed in PR #92: previously the
    // generated sdk-runtime-loader only redirected `@agent-relay/sdk/workflows`,
    // so workflow files importing other SDK subpaths (e.g. `/github`) or any
    // `@agent-relay/config` subpath failed in consumer repos that hadn't
    // `npm install`ed the SDK locally — defeating the point of bundling.
    //
    // This test imports a non-`workflows` SDK subpath AND an `@agent-relay/config`
    // subpath, and asserts the workflow runs successfully without the consumer
    // repo having any node_modules.
    const { access, mkdir, mkdtemp, rm, writeFile } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const repo = await mkdtemp(join(tmpdir(), 'ricky-sdk-subpaths-repo-'));
    const stateHome = await mkdtemp(join(tmpdir(), 'ricky-sdk-subpaths-state-'));
    const artifactPath = 'workflows/generated/sdk-subpaths.workflow.ts';
    const previousStateHome = process.env.RICKY_STATE_HOME;

    try {
      process.env.RICKY_STATE_HOME = stateHome;
      await mkdir(join(repo, 'workflows/generated'), { recursive: true });
      await writeFile(
        join(repo, artifactPath),
        [
          'import { workflow } from "@agent-relay/sdk/workflows";',
          'import * as github from "@agent-relay/sdk/github";',
          'import * as relayConfig from "@agent-relay/config/relay-config";',
          'import * as agentConfig from "@agent-relay/config/agent-config";',
          'console.log("workflow=" + typeof workflow);',
          'console.log("sdk-subpath=" + typeof github);',
          'console.log("config-subpath-relay=" + typeof relayConfig);',
          'console.log("config-subpath-agent=" + typeof agentConfig);',
          '',
        ].join('\n'),
        'utf8',
      );

      const result = await runLocal(
        { source: 'workflow-artifact', artifactPath, stageMode: 'run' },
        {
          artifactReader: mockArtifactReader('import { workflow } from "@agent-relay/sdk/workflows";'),
          localExecutor: {
            cwd: repo,
            timeoutMs: 10_000,
          },
        },
      );

      expect(result.ok).toBe(true);
      expect(result.execution?.status).toBe('success');
      // No consumer-repo node_modules needed.
      await expect(access(join(repo, 'node_modules'))).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      if (previousStateHome === undefined) {
        delete process.env.RICKY_STATE_HOME;
      } else {
        process.env.RICKY_STATE_HOME = previousStateHome;
      }
      await rm(repo, { recursive: true, force: true });
      await rm(stateHome, { recursive: true, force: true });
    }
  });

  it('drains broker stdout after SDK startup so event floods cannot wedge the workflow node', async () => {
    const { chmod, mkdir, mkdtemp, rm, writeFile } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const repo = await mkdtemp(join(tmpdir(), 'ricky-sdk-broker-drain-repo-'));
    const stateHome = await mkdtemp(join(tmpdir(), 'ricky-sdk-broker-drain-state-'));
    const brokerDir = await mkdtemp(join(tmpdir(), 'ricky-sdk-broker-drain-bin-'));
    const brokerPath = join(brokerDir, process.platform === 'win32' ? 'agent-relay-broker.exe' : 'agent-relay-broker');
    const artifactPath = 'workflows/generated/broker-drain.workflow.ts';
    const previousStateHome = process.env.RICKY_STATE_HOME;
    const previousFakeBrokerPath = process.env.FAKE_BROKER_PATH;

    try {
      process.env.RICKY_STATE_HOME = stateHome;
      process.env.FAKE_BROKER_PATH = brokerPath;
      await mkdir(join(repo, 'workflows/generated'), { recursive: true });
      // Give the SDK a portable executable named like the broker while keeping
      // the broker body in the repo-local `init` script that Node receives as
      // argv[1]. Copying `process.execPath` is not portable on macOS because the
      // binary depends on sibling dylibs that are not copied with it.
      if (process.platform === 'win32') {
        await writeFile(
          brokerPath,
          `@echo off\r\n"${process.execPath}" "%CD%\\init" %*\r\n`,
          'utf8',
        );
      } else {
        await writeFile(
          brokerPath,
          `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} "$PWD/init" "$@"\n`,
          'utf8',
        );
        await chmod(brokerPath, 0o755);
      }
      await writeFile(
        join(repo, 'init'),
        [
          "const http = require('node:http');",
          'const server = http.createServer((req, res) => {',
          "  if (req.url === '/api/session') {",
          "    res.writeHead(200, { 'content-type': 'application/json' });",
          "    res.end(JSON.stringify({ workspace_key: 'wk_fake' }));",
          '    return;',
          '  }',
          "  if (req.url === '/health' || req.url === '/api/session/renew' || req.url === '/api/shutdown') {",
          "    res.writeHead(200, { 'content-type': 'application/json' });",
          '    res.end(JSON.stringify({ ok: true }));',
          '    return;',
          '  }',
          "  res.writeHead(404, { 'content-type': 'application/json' });",
          "  res.end(JSON.stringify({ error: 'not found' }));",
          '});',
          "server.listen(0, '127.0.0.1', () => {",
          '  const address = server.address();',
          '  console.log(`[agent-relay] API listening on http://127.0.0.1:${address.port}`);',
          '  let index = 0;',
          "  const chunk = 'x'.repeat(1024);",
          '  const writeMore = () => {',
          '    let ok = true;',
          '    while (index < 20000 && ok) {',
          '      ok = process.stdout.write(`event-${index}:${chunk}\\n`);',
          '      index += 1;',
          '    }',
          '    if (index >= 20000) {',
          "      console.error('FAKE_BROKER_FLOOD_DONE');",
          '      setTimeout(() => process.exit(0), 25);',
          '      return;',
          '    }',
          "    process.stdout.once('drain', writeMore);",
          '  };',
          '  writeMore();',
          '});',
          '',
        ].join('\n'),
        'utf8',
      );
      await writeFile(
        join(repo, artifactPath),
        [
          'import { AgentRelayClient } from "@agent-relay/sdk";',
          'const client = await AgentRelayClient.spawn({',
          '  binaryPath: process.env.FAKE_BROKER_PATH,',
          '  cwd: process.cwd(),',
          '  startupTimeoutMs: 3000,',
          '  requestTimeoutMs: 3000,',
          '});',
          'const outcome = await Promise.race([',
          '  new Promise((resolve) => client.child?.once("exit", () => resolve("exited"))),',
          '  new Promise((resolve) => setTimeout(() => resolve("blocked"), 1500)),',
          ']);',
          'client.disconnect();',
          'if (outcome !== "exited") {',
          '  client.child?.kill("SIGKILL");',
          '  throw new Error(`broker stdout flood ${outcome}`);',
          '}',
          'console.log("BROKER_STDOUT_DRAINED");',
          '',
        ].join('\n'),
        'utf8',
      );

      const result = await runLocal(
        { source: 'workflow-artifact', artifactPath, stageMode: 'run' },
        {
          artifactReader: mockArtifactReader('import { AgentRelayClient } from "@agent-relay/sdk";'),
          localExecutor: {
            cwd: repo,
            timeoutMs: 10_000,
          },
        },
      );

      expect(result.ok).toBe(true);
      expect(result.execution?.status).toBe('success');
      expect(result.logs).toContain('[stdout] BROKER_STDOUT_DRAINED');
    } finally {
      if (previousStateHome === undefined) {
        delete process.env.RICKY_STATE_HOME;
      } else {
        process.env.RICKY_STATE_HOME = previousStateHome;
      }
      if (previousFakeBrokerPath === undefined) {
        delete process.env.FAKE_BROKER_PATH;
      } else {
        process.env.FAKE_BROKER_PATH = previousFakeBrokerPath;
      }
      await rm(repo, { recursive: true, force: true });
      await rm(stateHome, { recursive: true, force: true });
      await rm(brokerDir, { recursive: true, force: true });
    }
  }, 10_000);

  it('kills the SDK workflow process tree when the local timeout fires', async () => {
    const { mkdir, mkdtemp, readFile, rm, writeFile } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const repo = await mkdtemp(join(tmpdir(), 'ricky-sdk-timeout-repo-'));
    const stateHome = await mkdtemp(join(tmpdir(), 'ricky-sdk-timeout-state-'));
    const artifactPath = 'workflows/generated/hanging.workflow.js';
    const pidFile = join(repo, 'child.pid');
    const previousStateHome = process.env.RICKY_STATE_HOME;
    let childPid: number | undefined;

    try {
      process.env.RICKY_STATE_HOME = stateHome;
      await mkdir(join(repo, 'workflows/generated'), { recursive: true });
      await writeFile(
        join(repo, artifactPath),
        [
          "import { spawn } from 'node:child_process';",
          "import { writeFileSync } from 'node:fs';",
          "console.log('Runtime banner mentions API, MSD, and GENERATED_WORKFLOW_READY but not missing env.');",
          "const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });",
          `writeFileSync(${JSON.stringify(pidFile)}, String(child.pid));`,
          'console.log(`spawned-child=${child.pid}`);',
          'setInterval(() => {}, 1000);',
          '',
        ].join('\n'),
        'utf8',
      );

      const result = await runLocal(
        { source: 'workflow-artifact', artifactPath, stageMode: 'run' },
        {
          artifactReader: mockArtifactReader('console.log("hanging workflow");'),
          localExecutor: {
            cwd: repo,
            timeoutMs: 500,
          },
        },
      );

      expect(result.ok).toBe(false);
      expect(result.execution?.evidence?.outcome_summary).toContain('timed out after 500ms');
      expect(result.execution?.blocker?.code).toBe('STEP_TIMEOUT');
      expect(result.execution?.blocker?.category).toBe('timeout');
      expect(result.nextActions.join('\n')).not.toContain('export API=');
      expect(result.nextActions.join('\n')).not.toContain('export MSD=');

      childPid = Number((await readFile(pidFile, 'utf8')).trim());
      expect(Number.isFinite(childPid)).toBe(true);
      await new Promise((resolve) => setTimeout(resolve, 2_500));
      expect(pidIsAlive(childPid)).toBe(false);
    } finally {
      if (childPid && pidIsAlive(childPid)) {
        try {
          process.kill(childPid, 'SIGKILL');
        } catch {
          // Best-effort cleanup for a failed regression assertion.
        }
      }
      if (previousStateHome === undefined) {
        delete process.env.RICKY_STATE_HOME;
      } else {
        process.env.RICKY_STATE_HOME = previousStateHome;
      }
      await rm(repo, { recursive: true, force: true });
      await rm(stateHome, { recursive: true, force: true });
    }
  });

  it('forwards parent termination signals to detached SDK workflow process trees', async () => {
    const { mkdir, mkdtemp, rm, writeFile } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const repo = await mkdtemp(join(tmpdir(), 'ricky-sdk-signal-repo-'));
    const stateHome = await mkdtemp(join(tmpdir(), 'ricky-sdk-signal-state-'));
    const artifactPath = 'workflows/generated/signaled.workflow.js';
    const pidFile = join(repo, 'child.pid');
    const previousStateHome = process.env.RICKY_STATE_HOME;
    let childPid: number | undefined;

    try {
      process.env.RICKY_STATE_HOME = stateHome;
      await mkdir(join(repo, 'workflows/generated'), { recursive: true });
      await writeFile(
        join(repo, artifactPath),
        [
          "import { spawn } from 'node:child_process';",
          "import { writeFileSync } from 'node:fs';",
          "const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });",
          `writeFileSync(${JSON.stringify(pidFile)}, String(child.pid));`,
          'console.log(`spawned-child=${child.pid}`);',
          'setInterval(() => {}, 1000);',
          '',
        ].join('\n'),
        'utf8',
      );

      const resultPromise = runLocal(
        { source: 'workflow-artifact', artifactPath, stageMode: 'run' },
        {
          artifactReader: mockArtifactReader('console.log("signaled workflow");'),
          localExecutor: {
            cwd: repo,
            timeoutMs: 5_000,
          },
        },
      );

      childPid = await waitForPidFile(pidFile);
      process.emit('SIGTERM', 'SIGTERM');
      const result = await resultPromise;

      expect(result.ok).toBe(false);
      expect(result.execution?.evidence?.outcome_summary).toContain('script workflow run interrupted by SIGTERM');
      await new Promise((resolve) => setTimeout(resolve, 2_500));
      expect(pidIsAlive(childPid)).toBe(false);
    } finally {
      if (childPid && pidIsAlive(childPid)) {
        try {
          process.kill(childPid, 'SIGKILL');
        } catch {
          // Best-effort cleanup for a failed regression assertion.
        }
      }
      if (previousStateHome === undefined) {
        delete process.env.RICKY_STATE_HOME;
      } else {
        process.env.RICKY_STATE_HOME = previousStateHome;
      }
      await rm(repo, { recursive: true, force: true });
      await rm(stateHome, { recursive: true, force: true });
    }
  });

  it('returns runtime blockers instead of hiding local execution failures', async () => {
    const result = await runLocal(
      { source: 'cli', spec: 'generate a local workflow for src/local/entrypoint.ts with tests', stageMode: 'run' },
      {
        localExecutor: memoryLocalExecutorOptions({
          exitCode: 127,
          stdout: [],
          stderr: ['agent-relay: command not found'],
        }),
      },
    );

    expect(result.ok).toBe(false);
    expect(result.logs.some((l) => l.includes('[stderr] agent-relay: command not found'))).toBe(true);
    expect(result.warnings).toContain('Runtime dependency is unavailable: exited with code 127.');
    expect(result.nextActions).toEqual([
      'npm install',
      expect.stringMatching(/^ricky run workflows\/generated\/.+\.ts$/),
    ]);
  });

  it('deduplicates artifacts by path without dropping content from earlier entries', async () => {
    const localExecutor = memoryLocalExecutorOptions();
    const result = await runLocal(
      { source: 'cli', spec: 'generate a local workflow for src/local/entrypoint.ts with tests' },
      { localExecutor },
    );

    // The executor adds the generated artifact (with content) during generation,
    // then adds a run-target artifact (without content) after coordination.
    // dedupeArtifacts should preserve the content from the first entry.
    expect(result.ok).toBe(true);
    expect(result.artifacts.length).toBeGreaterThanOrEqual(1);
    const artifact = result.artifacts[0];
    expect(artifact.content).toBeDefined();
    expect(artifact.type).toBe('text/typescript');
  });

  // ---------------------------------------------------------------------------
  // Regression proof: issues #1 and #2 — createLocalExecutor via runLocal
  // with localExecutor options ensures artifact content under supplied cwd
  // ---------------------------------------------------------------------------

  describe('regression: issues #1 and #2 — runLocal localExecutor cwd forwarding', () => {
    it('runLocal with localExecutor.cwd creates the executor with that cwd for artifact writing', async () => {
      const { mkdtemp, rm, access, readFile } = await import('node:fs/promises');
      const { tmpdir } = await import('node:os');
      const { join } = await import('node:path');
      const tempDir = await mkdtemp(join(tmpdir(), 'ricky-runlocal-cwd-'));

      try {
        const result = await runLocal(
          { source: 'cli', spec: 'generate a workflow for runLocal cwd forwarding test' },
          {
            localExecutor: {
              cwd: tempDir,
              returnGeneratedArtifactOnly: true,
            },
          },
        );

        expect(result.ok).toBe(true);
        const artifactPath = result.artifacts[0].path;
        expect(artifactPath).toMatch(/^workflows\/generated\//);

        // Artifact physically exists under the supplied cwd
        const fullPath = join(tempDir, artifactPath);
        await expect(access(fullPath)).resolves.toBeUndefined();

        // Content was written with workflow boilerplate
        const content = await readFile(fullPath, 'utf8');
        expect(content).toContain('workflow(');
        expect(content).toBe(result.artifacts[0].content);

        // Generation stage artifact.path matches
        expect(result.generation).toBeDefined();
        expect(result.generation!.artifact!.path).toBe(artifactPath);

        // Generation stage next.run_command uses the same relative path
        expect(result.generation!.next!.run_command).toBe(
          `ricky run ${artifactPath}`,
        );

        // Next action also uses the same relative path
        expect(result.nextActions).toContain(
          `Run the generated workflow locally: ricky run ${artifactPath}`,
        );

        // Artifact is NOT in packages/cli/workflows/generated
        const artifactName = artifactPath.split('/').pop()!;
        const cliPath = join(process.cwd(), 'packages/cli/workflows/generated', artifactName);
        await expect(access(cliPath)).rejects.toThrow();
      } finally {
        await rm(tempDir, { recursive: true, force: true });
      }
    });

    it('runLocal with handoff.invocationRoot overrides localExecutor.cwd for artifact location', async () => {
      const { mkdtemp, rm, access } = await import('node:fs/promises');
      const { tmpdir } = await import('node:os');
      const { join } = await import('node:path');
      const invRoot = await mkdtemp(join(tmpdir(), 'ricky-invroot-override-'));
      const optionsCwd = await mkdtemp(join(tmpdir(), 'ricky-opts-cwd-'));

      try {
        const result = await runLocal(
          {
            source: 'cli',
            spec: 'generate a workflow for invocationRoot override test',
            invocationRoot: invRoot,
          },
          {
            localExecutor: {
              cwd: optionsCwd,
              returnGeneratedArtifactOnly: true,
            },
          },
        );

        expect(result.ok).toBe(true);
        const artifactPath = result.artifacts[0].path;

        // Artifact exists under invocationRoot, not under options.cwd
        await expect(access(join(invRoot, artifactPath))).resolves.toBeUndefined();
        await expect(access(join(optionsCwd, artifactPath))).rejects.toThrow();

        // No artifact in packages/cli/workflows/generated
        const artifactName = artifactPath.split('/').pop()!;
        const cliPath = join(process.cwd(), 'packages/cli/workflows/generated', artifactName);
        await expect(access(cliPath)).rejects.toThrow();
      } finally {
        await rm(invRoot, { recursive: true, force: true });
        await rm(optionsCwd, { recursive: true, force: true });
      }
    });

    it('createLocalExecutor writes artifact content into cwd with injected writer proving the path', async () => {
      const writes: Array<{ path: string; content: string; cwd: string }> = [];
      const result = await runLocal(
        {
          source: 'cli',
          spec: 'generate a workflow for writer cwd proof',
        },
        {
          localExecutor: {
            cwd: '/deterministic-temp-root',
            artifactWriter: {
              async writeArtifact(path: string, content: string, cwd: string): Promise<void> {
                writes.push({ path, content, cwd });
              },
            },
            returnGeneratedArtifactOnly: true,
          },
        },
      );

      expect(result.ok).toBe(true);
      expect(workflowArtifactWrites(writes)).toHaveLength(1);

      // Writer was called with the supplied cwd
      expect(writes[0].cwd).toBe('/deterministic-temp-root');

      // Artifact path is relative (workflows/generated/...)
      expect(writes[0].path).toMatch(/^workflows\/generated\//);
      expect(writes[0].content).toContain('workflow(');

      // The returned artifact path matches the written path
      expect(result.artifacts[0].path).toBe(writes[0].path);

      // The next command references the same path
      expect(result.nextActions).toContain(
        `Run the generated workflow locally: ricky run ${writes[0].path}`,
      );
    });
  });

  it('surfaces local runtime launch environment warnings without rerouting through Cloud', async () => {
    const runner = throwingCommandRunner('spawn agent-relay ENOENT');
    const result = await runLocal(
      { source: 'cli', spec: 'run workflows/wave4-local-byoh/02-local-invocation-entrypoint.ts', stageMode: 'run' },
      {
        localExecutor: {
          cwd: '/repo',
          commandRunner: runner,
        },
      },
    );

    expect(result.ok).toBe(false);
    expect(runner.invocations).toHaveLength(1);
    expect(runner.invocations[0].command).toBe(DEFAULT_LOCAL_ROUTE.command);
    expect(runner.invocations[0].args).toEqual([
      ...(DEFAULT_LOCAL_ROUTE.baseArgs ?? []),
      'workflows/wave4-local-byoh/02-local-invocation-entrypoint.ts',
    ]);
    expect(result.logs).toEqual(
      expect.arrayContaining([
        '[local] received spec from cli',
        '[local] mode: local',
        '[local] spec intake route: execute',
        '[local] runtime status: failed',
        '[local] runtime command: @agent-relay/sdk/workflows runScriptWorkflow workflows/wave4-local-byoh/02-local-invocation-entrypoint.ts',
      ]),
    );
    expect(result.warnings.some((w) => w.includes('spawn agent-relay ENOENT'))).toBe(true);
    expect(result.warnings.some((w) => w.includes('Cloud API surface'))).toBe(false);
    expect(result.nextActions).toEqual([
      'npm install',
      'ricky run workflows/wave4-local-byoh/02-local-invocation-entrypoint.ts',
    ]);
  });

  describe('regression: issue #11 adapter-backed local path', () => {
    it('assembles the real turn-context-backed adapter in the live local path with normalized metadata intact', async () => {
      const assembledInputs: Array<Record<string, unknown>> = [];
      const structuredSpec = {
        description: 'generate a local workflow for packages/local/src/entrypoint.ts',
        targetRepo: 'AgentWorkforce/ricky',
        targetFiles: ['packages/local/src/entrypoint.ts'],
      };

      vi.resetModules();
      vi.doMock('@agent-assistant/turn-context', async (importOriginal) => {
        const actual = await importOriginal<typeof import('@agent-assistant/turn-context')>();
        return {
          ...actual,
          createTurnContextAssembler: () => {
            const assembler = actual.createTurnContextAssembler();
            return {
              assemble(input: Parameters<typeof assembler.assemble>[0]) {
                assembledInputs.push(input as unknown as Record<string, unknown>);
                return assembler.assemble(input);
              },
            };
          },
        };
      });

      try {
        const { runLocal: runLocalWithObservedAdapter } = await import('./entrypoint.js');
        const localExecutor = memoryLocalExecutorOptions({ stdout: ['runtime should stay idle'] });
        const result = await runLocalWithObservedAdapter(
          {
            source: 'cli',
            spec: structuredSpec,
            specFile: 'specs/issue-11.live-path.json',
            stageMode: 'generate',
            requestId: 'req-issue-11-live-adapter',
            invocationRoot: '/workspace/issue-11-live',
            metadata: { issue: 11, proof: 'live-adapter' },
            cliMetadata: { argv: ['ricky', 'run', '--spec-file', 'specs/issue-11.live-path.json'] },
          },
          { localExecutor },
        );

        expect(result.ok).toBe(true);
        expectNoTurnContextFallback(result.logs);
        expect(result.generation?.decisions?.assistant_turn_context).toMatchObject({
          assistant_id: 'ricky',
          turn_id: 'req-issue-11-live-adapter',
          adapter: 'ricky-local-turn-context-adapter',
          package: '@agent-assistant/turn-context',
          context_blocks: expect.arrayContaining([
            'enrichment-ricky-request-summary',
            'enrichment-ricky-spec-text',
          ]),
          enrichment_ids: expect.arrayContaining([
            'ricky-request-summary',
            'ricky-spec-text',
            'ricky-request-metadata',
          ]),
        });
        expect(localExecutor.runner.invocations).toHaveLength(0);
        expect(assembledInputs).toHaveLength(1);

        const adapterInput = assembledInputs[0];
        const metadata = adapterInput.metadata as { adapter?: Record<string, unknown>; ricky?: Record<string, unknown> };
        expect(adapterInput).toMatchObject({
          assistantId: 'ricky',
          turnId: 'req-issue-11-live-adapter',
        });
        expect(metadata.adapter).toMatchObject({
          name: 'ricky-local-turn-context-adapter',
          package: '@agent-assistant/turn-context',
        });
        expect(metadata.ricky).toMatchObject({
          requestId: 'req-issue-11-live-adapter',
          source: 'cli',
          invocationRoot: '/workspace/issue-11-live',
          mode: 'local',
          stageMode: 'generate',
          specPath: 'specs/issue-11.live-path.json',
          metadata: {
            issue: 11,
            proof: 'live-adapter',
            argv: ['ricky', 'run', '--spec-file', 'specs/issue-11.live-path.json'],
          },
        });
        expect(metadata.ricky?.structuredSpec).toEqual(structuredSpec);
        expect(metadata.ricky?.sourceMetadata).toEqual({
          cli: {
            argv: ['ricky', 'run', '--spec-file', 'specs/issue-11.live-path.json'],
            specFile: 'specs/issue-11.live-path.json',
          },
        });
      } finally {
        vi.doUnmock('@agent-assistant/turn-context');
        vi.resetModules();
      }
    });

    it('feeds every handoff surface through the live normalizeRequest-to-adapter boundary with Ricky metadata intact', async () => {
      const assembledInputs: Array<Record<string, unknown>> = [];
      const cases: Array<{
        name: string;
        handoff: RawHandoff;
        artifactContent?: string;
        expected: {
          requestId: string;
          source: LocalInvocationRequest['source'];
          invocationRoot?: string;
          mode: LocalInvocationRequest['mode'];
          stageMode: LocalStageMode;
          specPath?: string;
          metadata: Record<string, unknown>;
          structuredSpec?: Record<string, unknown>;
          sourceMetadata?: Record<string, unknown>;
        };
      }> = [
        {
          name: 'cli',
          handoff: {
            source: 'cli',
            spec: {
              description: 'generate a local workflow for packages/local/src/entrypoint.ts',
              targetFiles: ['packages/local/src/entrypoint.ts'],
            },
            specFile: 'specs/issue-11.cli-live.json',
            stageMode: 'generate',
            requestId: 'req-issue-11-cli-boundary',
            invocationRoot: '/workspace/issue-11-cli',
            metadata: { issue: 11, surface: 'cli' },
            cliMetadata: { argv: ['ricky', 'generate', '--spec-file', 'specs/issue-11.cli-live.json'] },
          },
          expected: {
            requestId: 'req-issue-11-cli-boundary',
            source: 'cli',
            invocationRoot: '/workspace/issue-11-cli',
            mode: 'local',
            stageMode: 'generate',
            specPath: 'specs/issue-11.cli-live.json',
            metadata: {
              issue: 11,
              surface: 'cli',
              argv: ['ricky', 'generate', '--spec-file', 'specs/issue-11.cli-live.json'],
            },
            structuredSpec: {
              description: 'generate a local workflow for packages/local/src/entrypoint.ts',
              targetFiles: ['packages/local/src/entrypoint.ts'],
            },
            sourceMetadata: {
              cli: {
                argv: ['ricky', 'generate', '--spec-file', 'specs/issue-11.cli-live.json'],
                specFile: 'specs/issue-11.cli-live.json',
              },
            },
          },
        },
        {
          name: 'mcp',
          handoff: {
            source: 'mcp',
            toolName: 'ricky.generate',
            arguments: {
              prompt: 'generate a local workflow for packages/local/src/entrypoint.ts',
              targetFiles: ['packages/local/src/entrypoint.ts'],
              stageMode: 'generate',
            },
            requestId: 'req-issue-11-mcp-boundary',
            invocationRoot: '/workspace/issue-11-mcp',
            metadata: { issue: 11, surface: 'mcp' },
            mcpMetadata: { toolCallId: 'tool-issue-11-boundary' },
          },
          expected: {
            requestId: 'req-issue-11-mcp-boundary',
            source: 'mcp',
            invocationRoot: '/workspace/issue-11-mcp',
            mode: 'local',
            stageMode: 'generate',
            metadata: {
              issue: 11,
              surface: 'mcp',
              toolCallId: 'tool-issue-11-boundary',
              toolName: 'ricky.generate',
            },
            structuredSpec: {
              prompt: 'generate a local workflow for packages/local/src/entrypoint.ts',
              targetFiles: ['packages/local/src/entrypoint.ts'],
              stageMode: 'generate',
            },
            sourceMetadata: {
              mcp: {
                toolCallId: 'tool-issue-11-boundary',
                toolName: 'ricky.generate',
              },
            },
          },
        },
        {
          name: 'claude',
          handoff: {
            source: 'claude',
            spec: {
              request: 'generate a local workflow for packages/local/src/entrypoint.ts',
              targetFiles: ['packages/local/src/entrypoint.ts'],
              stage_mode: 'generate',
            },
            requestId: 'req-issue-11-claude-boundary',
            invocationRoot: '/workspace/issue-11-claude',
            metadata: { issue: 11, surface: 'claude' },
            conversationId: 'conv-issue-11-boundary',
            turnId: 'turn-issue-11-boundary',
          },
          expected: {
            requestId: 'req-issue-11-claude-boundary',
            source: 'claude',
            invocationRoot: '/workspace/issue-11-claude',
            mode: 'local',
            stageMode: 'generate',
            metadata: {
              issue: 11,
              surface: 'claude',
              conversationId: 'conv-issue-11-boundary',
              turnId: 'turn-issue-11-boundary',
            },
            structuredSpec: {
              request: 'generate a local workflow for packages/local/src/entrypoint.ts',
              targetFiles: ['packages/local/src/entrypoint.ts'],
              stage_mode: 'generate',
            },
            sourceMetadata: {
              claude: {
                conversationId: 'conv-issue-11-boundary',
                turnId: 'turn-issue-11-boundary',
              },
            },
          },
        },
        {
          name: 'structured',
          handoff: {
            source: 'structured',
            spec: {
              description: 'generate a local workflow for packages/local/src/entrypoint.ts',
              targetFiles: ['packages/local/src/entrypoint.ts'],
              stageMode: 'generate',
            },
            requestId: 'req-issue-11-structured-boundary',
            invocationRoot: '/workspace/issue-11-structured',
            metadata: { issue: 11, surface: 'structured' },
          },
          expected: {
            requestId: 'req-issue-11-structured-boundary',
            source: 'structured',
            invocationRoot: '/workspace/issue-11-structured',
            mode: 'local',
            stageMode: 'generate',
            metadata: { issue: 11, surface: 'structured' },
            structuredSpec: {
              description: 'generate a local workflow for packages/local/src/entrypoint.ts',
              targetFiles: ['packages/local/src/entrypoint.ts'],
              stageMode: 'generate',
            },
          },
        },
        {
          name: 'free-form',
          handoff: {
            source: 'free-form',
            spec: 'generate a local workflow for packages/local/src/entrypoint.ts',
            stageMode: 'generate',
            requestId: 'req-issue-11-free-form-boundary',
            invocationRoot: '/workspace/issue-11-free-form',
            metadata: { issue: 11, surface: 'free-form' },
          },
          expected: {
            requestId: 'req-issue-11-free-form-boundary',
            source: 'free-form',
            invocationRoot: '/workspace/issue-11-free-form',
            mode: 'local',
            stageMode: 'generate',
            metadata: { issue: 11, surface: 'free-form' },
          },
        },
        {
          name: 'workflow-artifact',
          handoff: {
            source: 'workflow-artifact',
            artifactPath: 'workflows/issue-11/boundary.workflow.ts',
            stageMode: 'generate',
            requestId: 'req-issue-11-artifact-boundary',
            invocationRoot: '/workspace/issue-11-artifact',
            metadata: { issue: 11, surface: 'workflow-artifact' },
          },
          artifactContent: 'import { workflow } from "@agent-relay/sdk/workflows";',
          expected: {
            requestId: 'req-issue-11-artifact-boundary',
            source: 'workflow-artifact',
            invocationRoot: '/workspace/issue-11-artifact',
            mode: 'local',
            stageMode: 'generate',
            specPath: 'workflows/issue-11/boundary.workflow.ts',
            metadata: { issue: 11, surface: 'workflow-artifact' },
          },
        },
      ];

      vi.resetModules();
      vi.doMock('@agent-assistant/turn-context', async (importOriginal) => {
        const actual = await importOriginal<typeof import('@agent-assistant/turn-context')>();
        return {
          ...actual,
          createTurnContextAssembler: () => {
            const assembler = actual.createTurnContextAssembler();
            return {
              assemble(input: Parameters<typeof assembler.assemble>[0]) {
                assembledInputs.push(input as unknown as Record<string, unknown>);
                return assembler.assemble(input);
              },
            };
          },
        };
      });

      try {
        const { runLocal: runLocalWithObservedAdapter } = await import('./entrypoint.js');

        for (const testCase of cases) {
          const result = await runLocalWithObservedAdapter(testCase.handoff, {
            artifactReader: mockArtifactReader(testCase.artifactContent ?? 'unused artifact'),
            localExecutor: memoryLocalExecutorOptions({ stdout: [`${testCase.name} runtime should stay idle`] }),
          });

          expect(result.ok, testCase.name).toBe(true);
          expectNoTurnContextFallback(result.logs);
          expect(result.generation?.decisions?.assistant_turn_context, testCase.name).toMatchObject({
            assistant_id: 'ricky',
            turn_id: testCase.expected.requestId,
            adapter: 'ricky-local-turn-context-adapter',
            package: '@agent-assistant/turn-context',
            context_blocks: expect.arrayContaining([
              'enrichment-ricky-request-summary',
              'enrichment-ricky-spec-text',
              'enrichment-ricky-request-metadata',
              ...(testCase.expected.structuredSpec ? ['enrichment-ricky-structured-spec'] : []),
              ...(testCase.expected.sourceMetadata ? ['enrichment-ricky-source-metadata'] : []),
            ]),
            enrichment_ids: expect.arrayContaining([
              'ricky-request-summary',
              'ricky-spec-text',
              'ricky-request-metadata',
              ...(testCase.expected.structuredSpec ? ['ricky-structured-spec'] : []),
              ...(testCase.expected.sourceMetadata ? ['ricky-source-metadata'] : []),
            ]),
          });
          expect(result.execution, testCase.name).toBeUndefined();
        }

        expect(assembledInputs).toHaveLength(cases.length);
        for (const [index, testCase] of cases.entries()) {
          const adapterInput = assembledInputs[index];
          const metadata = adapterInput.metadata as { adapter?: Record<string, unknown>; ricky?: Record<string, unknown> };

          expect(adapterInput, testCase.name).toMatchObject({
            assistantId: 'ricky',
            turnId: testCase.expected.requestId,
            shaping: {
              mode: `ricky-local:${testCase.expected.mode}:${testCase.expected.stageMode}`,
            },
          });
          expect(metadata.adapter, testCase.name).toMatchObject({
            name: 'ricky-local-turn-context-adapter',
            package: '@agent-assistant/turn-context',
          });
          expect(metadata.ricky, testCase.name).toMatchObject({
            requestId: testCase.expected.requestId,
            source: testCase.expected.source,
            invocationRoot: testCase.expected.invocationRoot,
            mode: testCase.expected.mode,
            stageMode: testCase.expected.stageMode,
            specPath: testCase.expected.specPath,
            metadata: testCase.expected.metadata,
          });
          expect(metadata.ricky?.structuredSpec, testCase.name).toEqual(testCase.expected.structuredSpec);
          expect(metadata.ricky?.sourceMetadata, testCase.name).toEqual(testCase.expected.sourceMetadata);
        }
      } finally {
        vi.doUnmock('@agent-assistant/turn-context');
        vi.resetModules();
      }
    });

    it('keeps generation-only LocalResponse fields while the real local executor assembles turn context', async () => {
      const localExecutor = memoryLocalExecutorOptions({ stdout: ['runtime should stay idle'] });
      const result = await runLocal(
        {
          source: 'cli',
          spec: {
            description: 'generate a local workflow for packages/local/src/entrypoint.ts',
            targetRepo: 'AgentWorkforce/ricky',
            targetFiles: ['packages/local/src/entrypoint.ts'],
          },
          stageMode: 'generate',
          requestId: 'req-issue-11-generate',
          metadata: { issue: 11 },
        },
        { localExecutor },
      );

      expect(result.ok).toBe(true);
      expectNoTurnContextFallback(result.logs);
      expect(result.exitCode).toBe(0);
      expect(result.artifacts).toHaveLength(1);
      expect(result.artifacts[0]).toMatchObject({
        path: result.generation?.artifact?.path,
        type: 'text/typescript',
        content: expect.stringContaining('workflow('),
      });
      expect(result.logs).toEqual(
        expect.arrayContaining([
          '[local] received spec from cli',
          '[local] mode: local',
          '[local] stage mode: generate',
          '[local] spec intake route: generate',
          '[local] workflow generation: passed',
          '[local] runtime launch skipped: returning generated artifact only',
        ]),
      );
      expect(result.warnings).toEqual([]);
      expect(result.nextActions).toEqual([
        `Run the generated workflow locally: ricky run ${result.generation?.artifact?.path}`,
        'Inspect the generated workflow artifact and choose whether to run it locally.',
      ]);
      expect(result.generation).toMatchObject({
        stage: 'generate',
        status: 'ok',
        artifact: {
          path: expect.stringMatching(/^workflows\/generated\/.+\.ts$/),
          workflow_id: expect.any(String),
          spec_digest: expect.any(String),
        },
        next: {
          run_command: `ricky run ${result.generation?.artifact?.path}`,
          run_mode_hint: `ricky run ${result.generation?.artifact?.path}`,
        },
        decisions: {
          assistant_turn_context: {
            assistant_id: 'ricky',
            turn_id: 'req-issue-11-generate',
            adapter: 'ricky-local-turn-context-adapter',
            package: '@agent-assistant/turn-context',
          },
        },
      });
      expect(result.execution).toBeUndefined();
      expect(workflowArtifactWrites(localExecutor.writes)).toHaveLength(1);
      expect(localExecutor.runner.invocations).toHaveLength(0);
    });

    it('keeps the generation-only response on the existing LocalResponse surface', async () => {
      const localExecutor = memoryLocalExecutorOptions({ stdout: ['runtime should stay idle'] });
      const result = await runLocal(
        {
          source: 'free-form',
          spec: 'generate a local workflow for packages/local/src/entrypoint.ts',
          stageMode: 'generate',
          requestId: 'req-issue-11-response-surface',
          metadata: { issue: 11, response: 'generation-only' },
        },
        { localExecutor },
      );

      expect(result.ok).toBe(true);
      expectNoTurnContextFallback(result.logs);
      expect(result).toMatchObject({
        ok: true,
        artifacts: [
          {
            path: result.generation?.artifact?.path,
            type: 'text/typescript',
            content: expect.stringContaining('workflow('),
          },
        ],
        logs: expect.arrayContaining([
          '[local] received spec from free-form',
          '[local] mode: local',
          '[local] stage mode: generate',
          '[local] spec intake route: generate',
          '[local] workflow generation: passed',
          '[local] runtime launch skipped: returning generated artifact only',
        ]),
        warnings: expect.any(Array),
        nextActions: [
          `Run the generated workflow locally: ricky run ${result.generation?.artifact?.path}`,
          'Inspect the generated workflow artifact and choose whether to run it locally.',
        ],
        generation: {
          stage: 'generate',
          status: 'ok',
          artifact: {
            path: expect.stringMatching(/^workflows\/generated\/.+\.ts$/),
            workflow_id: expect.any(String),
            spec_digest: expect.any(String),
          },
          next: {
            run_command: `ricky run ${result.generation?.artifact?.path}`,
            run_mode_hint: `ricky run ${result.generation?.artifact?.path}`,
          },
        },
        exitCode: 0,
      });
      expect(result.warnings.some((warning) => warning.includes('Cloud API surface'))).toBe(false);
      expect(result.execution).toBeUndefined();
      expect(workflowArtifactWrites(localExecutor.writes)).toHaveLength(1);
      expect(localExecutor.runner.invocations).toHaveLength(0);
    });

    it('surfaces real adapter decisions for generator handoff surfaces without changing generation-only behavior', async () => {
      const handoffs: Array<{
        name: string;
        handoff: RawHandoff;
        expectedSource: LocalInvocationRequest['source'];
        expectedTurnId: string;
      }> = [
        {
          name: 'cli',
          handoff: {
            source: 'cli',
            spec: {
              description: 'generate a local workflow for packages/local/src/entrypoint.ts',
              targetFiles: ['packages/local/src/entrypoint.ts'],
            },
            stageMode: 'generate',
            requestId: 'req-issue-11-cli-live',
            cliMetadata: { argv: ['ricky', 'generate', '--local'] },
          },
          expectedSource: 'cli',
          expectedTurnId: 'req-issue-11-cli-live',
        },
        {
          name: 'mcp',
          handoff: {
            source: 'mcp',
            toolName: 'ricky.generate',
            arguments: {
              prompt: 'generate a local workflow for packages/local/src/entrypoint.ts',
              targetFiles: ['packages/local/src/entrypoint.ts'],
              stageMode: 'generate',
            },
            requestId: 'req-issue-11-mcp-live',
            mcpMetadata: { toolCallId: 'tool-issue-11-live' },
          },
          expectedSource: 'mcp',
          expectedTurnId: 'req-issue-11-mcp-live',
        },
        {
          name: 'claude',
          handoff: {
            source: 'claude',
            spec: {
              request: 'generate a local workflow for packages/local/src/entrypoint.ts',
              targetFiles: ['packages/local/src/entrypoint.ts'],
              stage_mode: 'generate',
            },
            requestId: 'req-issue-11-claude-live',
            conversationId: 'conv-issue-11-live',
            turnId: 'turn-issue-11-live',
          },
          expectedSource: 'claude',
          expectedTurnId: 'req-issue-11-claude-live',
        },
        {
          name: 'structured',
          handoff: {
            source: 'structured',
            spec: {
              description: 'generate a local workflow for packages/local/src/entrypoint.ts',
              targetFiles: ['packages/local/src/entrypoint.ts'],
              stageMode: 'generate',
            },
            requestId: 'req-issue-11-structured-live',
            metadata: { issue: 11, surface: 'structured' },
          },
          expectedSource: 'structured',
          expectedTurnId: 'req-issue-11-structured-live',
        },
        {
          name: 'free-form',
          handoff: {
            source: 'free-form',
            spec: 'generate a local workflow for packages/local/src/entrypoint.ts',
            stageMode: 'generate',
            requestId: 'req-issue-11-free-form-live',
            metadata: { issue: 11, surface: 'free-form' },
          },
          expectedSource: 'free-form',
          expectedTurnId: 'req-issue-11-free-form-live',
        },
      ];

      for (const testCase of handoffs) {
        const localExecutor = memoryLocalExecutorOptions({ stdout: [`${testCase.name} runtime should stay idle`] });
        const result = await runLocal(testCase.handoff, { localExecutor });

        expect(result.ok, testCase.name).toBe(true);
        expectNoTurnContextFallback(result.logs);
        expect(result.exitCode, testCase.name).toBe(0);
        expect(result.logs, testCase.name).toEqual(
          expect.arrayContaining([
            `[local] received spec from ${testCase.expectedSource}`,
            '[local] stage mode: generate',
            '[local] spec intake route: generate',
            '[local] runtime launch skipped: returning generated artifact only',
          ]),
        );
        expect(result.generation, testCase.name).toMatchObject({
          stage: 'generate',
          status: 'ok',
          decisions: {
            assistant_turn_context: {
              assistant_id: 'ricky',
              turn_id: testCase.expectedTurnId,
              adapter: 'ricky-local-turn-context-adapter',
              package: '@agent-assistant/turn-context',
              context_blocks: expect.arrayContaining([
                'enrichment-ricky-request-summary',
                'enrichment-ricky-spec-text',
                'enrichment-ricky-request-metadata',
              ]),
              enrichment_ids: expect.arrayContaining([
                'ricky-request-summary',
                'ricky-spec-text',
                'ricky-request-metadata',
              ]),
            },
          },
        });
        expect(result.execution, testCase.name).toBeUndefined();
        expect(workflowArtifactWrites(localExecutor.writes), testCase.name).toHaveLength(1);
        expect(localExecutor.runner.invocations, testCase.name).toHaveLength(0);
        expect(result.nextActions[0], testCase.name).toBe(
          `Run the generated workflow locally: ricky run ${result.generation?.artifact?.path}`,
        );
      }
    });

    it('preserves artifact-run stage semantics through the adapter-backed live local path', async () => {
      const artifactPath = 'workflows/issue-11/ready.workflow.ts';
      const launches: RunRequest[] = [];
      const result = await runLocal(
        {
          source: 'workflow-artifact',
          artifactPath,
          requestId: 'req-issue-11-artifact',
          invocationRoot: '/workspace/issue-11',
          metadata: { issue: 11, path: 'artifact-run' },
        },
        {
          artifactReader: mockArtifactReader('import { workflow } from "@agent-relay/sdk/workflows";'),
          localExecutor: {
            cwd: '/fallback-cwd',
            artifactWriter: {
              async writeArtifact(): Promise<void> {
                throw new Error('artifact-run should not generate a replacement workflow');
              },
            },
            coordinator: {
              async launch(request: RunRequest): Promise<CoordinatorResult> {
                launches.push(request);
                return coordinatorResult(request, { stdout: ['artifact stage executed'] });
              },
            },
          },
        },
      );

      expect(result.ok).toBe(true);
      expectNoTurnContextFallback(result.logs);
      expect(result.exitCode).toBe(0);
      expect(launches).toHaveLength(1);
      expect(launches[0]).toMatchObject({
        workflowFile: artifactPath,
        cwd: '/workspace/issue-11',
        metadata: {
          requestId: 'req-issue-11-artifact',
          source: 'workflow-artifact',
          route: 'execute',
          assistantTurnContext: {
            assistant_id: 'ricky',
            turn_id: 'req-issue-11-artifact',
            adapter: 'ricky-local-turn-context-adapter',
            package: '@agent-assistant/turn-context',
          },
        },
      });
      expect(result.logs).toEqual(
        expect.arrayContaining([
          '[local] received spec from workflow-artifact',
          '[local] mode: local',
          '[local] stage mode: run',
          `[local] spec path: ${artifactPath}`,
          '[local] spec intake route: execute',
          '[local] runtime status: passed',
          '[stdout] artifact stage executed',
        ]),
      );
      expect(result.artifacts).toEqual([{ path: artifactPath, type: 'text/typescript' }]);
      expect(result.generation).toMatchObject({
        stage: 'generate',
        status: 'ok',
        artifact: {
          path: artifactPath,
          workflow_id: 'req-issue-11-artifact',
          spec_digest: expect.any(String),
        },
        decisions: {
          assistant_turn_context: {
            assistant_id: 'ricky',
            turn_id: 'req-issue-11-artifact',
            adapter: 'ricky-local-turn-context-adapter',
            package: '@agent-assistant/turn-context',
          },
        },
      });
      expect(result.execution).toMatchObject({
        stage: 'execute',
        status: 'success',
        execution: {
          workflow_id: 'req-issue-11-artifact',
          artifact_path: artifactPath,
          workflow_file: artifactPath,
          cwd: '/workspace/issue-11',
          steps_completed: 1,
          steps_total: 1,
        },
        evidence: {
          outcome_summary: expect.stringContaining('completed successfully'),
          side_effects: {
            commands_invoked: [`@agent-relay/sdk/workflows runScriptWorkflow ${artifactPath}`],
          },
          assertions: [
            {
              name: 'runtime_exit_code',
              status: 'pass',
              detail: 'Runtime exited with code 0.',
            },
          ],
        },
      });
    });

    it('preserves generate-and-run stage semantics and Ricky blocker evidence fields', async () => {
      const generateAndRunLaunches: RunRequest[] = [];
      const generateAndRunWrites: RecordedWrite[] = [];
      const success = await runLocal(
        {
          source: 'mcp',
          arguments: {
            goal: 'generate a local workflow for packages/local/src/entrypoint.ts',
            stageMode: 'generate-and-run',
          },
          requestId: 'req-issue-11-generate-and-run',
        },
        {
          localExecutor: {
            cwd: '/repo',
            artifactWriter: {
              async writeArtifact(path: string, content: string, cwd: string): Promise<void> {
                generateAndRunWrites.push({ path, content, cwd });
              },
            },
            coordinator: {
              async launch(request: RunRequest): Promise<CoordinatorResult> {
                generateAndRunLaunches.push(request);
                return coordinatorResult(request, { stdout: ['generate-and-run completed'] });
              },
            },
          },
        },
      );

      expect(success.ok).toBe(true);
      expectNoTurnContextFallback(success.logs);
      expect(success.exitCode).toBe(0);
      expect(success.generation).toMatchObject({ stage: 'generate', status: 'ok' });
      expect(success.generation?.decisions?.assistant_turn_context).toMatchObject({
        assistant_id: 'ricky',
        turn_id: 'req-issue-11-generate-and-run',
        adapter: 'ricky-local-turn-context-adapter',
        package: '@agent-assistant/turn-context',
        context_blocks: expect.arrayContaining([
          'enrichment-ricky-request-summary',
          'enrichment-ricky-spec-text',
          'enrichment-ricky-structured-spec',
          'enrichment-ricky-request-metadata',
        ]),
        enrichment_ids: expect.arrayContaining([
          'ricky-request-summary',
          'ricky-spec-text',
          'ricky-structured-spec',
          'ricky-request-metadata',
        ]),
      });
      expect(success.execution).toMatchObject({
        stage: 'execute',
        status: 'success',
        execution: {
          workflow_id: success.generation?.artifact?.workflow_id,
          artifact_path: success.generation?.artifact?.path,
          workflow_file: success.generation?.artifact?.path,
          command: `@agent-relay/sdk/workflows runScriptWorkflow ${success.generation?.artifact?.path}`,
          cwd: '/repo',
          steps_completed: 1,
          steps_total: 1,
        },
        evidence: {
          outcome_summary: expect.stringContaining('completed successfully'),
          artifacts_produced: [
            {
              path: success.generation?.artifact?.path,
              kind: 'workflow',
              bytes: expect.any(Number),
            },
          ],
          logs: {
            tail: ['generate-and-run completed'],
            truncated: false,
          },
          side_effects: {
            files_written: expect.arrayContaining([success.generation?.artifact?.path]),
            commands_invoked: [`@agent-relay/sdk/workflows runScriptWorkflow ${success.generation?.artifact?.path}`],
            network_calls: [],
          },
          assertions: [
            {
              name: 'runtime_exit_code',
              status: 'pass',
              detail: 'Runtime exited with code 0.',
            },
          ],
          workflow_steps: [
            {
              id: 'runtime-launch',
              name: 'Local runtime execution',
              status: 'pass',
              duration_ms: expect.any(Number),
            },
          ],
        },
      });
      expect(success.logs).toEqual(
        expect.arrayContaining([
          '[local] received spec from mcp',
          '[local] stage mode: run',
          '[local] spec intake route: generate',
          '[local] runtime status: passed',
        ]),
      );
      expect(workflowArtifactWrites(generateAndRunWrites)).toHaveLength(1);
      expect(generateAndRunLaunches).toHaveLength(1);
      expect(generateAndRunLaunches[0]).toMatchObject({
        workflowFile: success.generation?.artifact?.path,
        cwd: '/repo',
        metadata: {
          requestId: 'req-issue-11-generate-and-run',
          source: 'mcp',
          route: 'generate',
          generatedWorkflowId: success.generation?.artifact?.workflow_id,
          assistantTurnContext: {
            assistant_id: 'ricky',
            turn_id: 'req-issue-11-generate-and-run',
            adapter: 'ricky-local-turn-context-adapter',
            package: '@agent-assistant/turn-context',
            context_blocks: expect.arrayContaining([
              'enrichment-ricky-request-summary',
              'enrichment-ricky-spec-text',
              'enrichment-ricky-structured-spec',
              'enrichment-ricky-request-metadata',
            ]),
            enrichment_ids: expect.arrayContaining([
              'ricky-request-summary',
              'ricky-spec-text',
              'ricky-structured-spec',
              'ricky-request-metadata',
            ]),
          },
        },
      });
      expect(success.artifacts).toEqual([
        {
          path: success.generation?.artifact?.path,
          type: 'text/typescript',
          content: expect.stringContaining('workflow('),
        },
      ]);
      expect(success.nextActions).toEqual(['Inspect generated artifacts and local run evidence.']);

      const blocked = await runLocal(
        {
          source: 'cli',
          spec: 'run workflows/issue-11/missing-runtime.workflow.ts',
          stageMode: 'run',
          requestId: 'req-issue-11-blocker',
        },
        {
          localExecutor: memoryLocalExecutorOptions({
            exitCode: 127,
            stdout: [],
            stderr: ['agent-relay: command not found'],
          }),
        },
      );

      expect(blocked.ok).toBe(false);
      expectNoTurnContextFallback(blocked.logs);
      expect(blocked.exitCode).toBe(2);
      expect(blocked.generation).toMatchObject({
        stage: 'generate',
        status: 'ok',
        artifact: {
          path: 'workflows/issue-11/missing-runtime.workflow.ts',
          workflow_id: 'req-issue-11-blocker',
          spec_digest: expect.any(String),
        },
        decisions: {
          assistant_turn_context: {
            assistant_id: 'ricky',
            turn_id: 'req-issue-11-blocker',
            adapter: 'ricky-local-turn-context-adapter',
            package: '@agent-assistant/turn-context',
            context_blocks: expect.arrayContaining([
              'enrichment-ricky-request-summary',
              'enrichment-ricky-spec-text',
              'enrichment-ricky-request-metadata',
            ]),
            enrichment_ids: expect.arrayContaining([
              'ricky-request-summary',
              'ricky-spec-text',
              'ricky-request-metadata',
            ]),
          },
        },
      });
      expect(blocked.execution).toMatchObject({
        stage: 'execute',
        status: 'blocker',
        blocker: {
          code: 'MISSING_BINARY',
          category: 'dependency',
          detected_during: 'launch',
          recovery: {
            actionable: true,
            steps: [
              'npm install',
              'ricky run workflows/issue-11/missing-runtime.workflow.ts',
            ],
          },
          context: {
            missing: ['@agent-relay/sdk/workflows runtime'],
            found: ['cwd=/repo'],
          },
        },
        evidence: {
          outcome_summary: expect.stringContaining('blocked during local runtime execution'),
          failed_step: { id: 'runtime-launch', name: 'Local runtime execution' },
          exit_code: 127,
          logs: {
            tail: ['agent-relay: command not found'],
            truncated: false,
          },
          side_effects: {
            commands_invoked: ['@agent-relay/sdk/workflows runScriptWorkflow workflows/issue-11/missing-runtime.workflow.ts'],
          },
          assertions: [
            {
              name: 'runtime_exit_code',
              status: 'fail',
              detail: 'Runtime exit code: 127.',
            },
          ],
        },
      });
      expect(blocked.nextActions).toEqual(blocked.execution?.blocker?.recovery.steps);
    });

    it('preserves completed workflow steps from full runtime output on failed runs', async () => {
      const localExecutor = memoryLocalExecutorOptions({
        exitCode: 1,
        stdout: [
          '[workflow 00:00] Executing 4 steps (pattern: pipeline)',
          '  ● prepare — started',
          '  ✓ prepare — completed',
          '  ● implement — started',
          '  ✓ implement — completed',
          '  ● verify — started',
          '  ✗ verify — FAILED: Command failed with exit code 1',
        ],
        stderr: ['verification failed'],
      });

      const result = await runLocal(
        {
          source: 'cli',
          spec: 'run workflows/issue-11/failing-after-work.workflow.ts',
          stageMode: 'run',
          requestId: 'req-issue-11-failed-steps',
        },
        { localExecutor },
      );

      expect(result.ok).toBe(false);
      expect(result.execution).toMatchObject({
        stage: 'execute',
        status: 'blocker',
        execution: {
          steps_completed: 2,
          steps_total: 3,
        },
        evidence: {
          workflow_steps: [
            { id: 'prepare', name: 'prepare', status: 'pass' },
            { id: 'implement', name: 'implement', status: 'pass' },
            { id: 'verify', name: 'verify', status: 'fail' },
          ],
        },
      });
    });
  });

  describe('CLI sane defaults — explicit description handoff', () => {
    it('routes a CLI description spec to generate even when the body is dense with run/execute words', async () => {
      const localExecutor = memoryLocalExecutorOptions();
      const result = await runLocal(
        {
          source: 'cli',
          spec: [
            'Add a feature so the CLI version flag reads from package.json.',
            'Currently `ricky --version` prints 0.0.0 instead of the installed version.',
            'When users run the CLI it should reflect the package version they installed.',
            'Cover three contexts: installed from npm, local dev via npm start, and tests.',
          ].join('\n'),
          stageMode: 'generate',
        },
        { localExecutor },
      );

      expect(result.ok).toBe(true);
      expect(result.logs).toContain('[local] spec intake route: generate');
      expect(result.artifacts.length).toBeGreaterThan(0);
      expect(result.warnings).not.toContain(
        expect.stringContaining('Execution requires a recognized workflow artifact'),
      );
    });

    it('does not override intent when the CLI spec text references a workflow file', async () => {
      const localExecutor = memoryLocalExecutorOptions({ stdout: ['ran'] });
      const result = await runLocal(
        {
          source: 'cli',
          spec: 'run workflows/foo.workflow.ts',
          stageMode: 'run',
        },
        { localExecutor },
      );

      expect(result.logs).toContain('[local] spec intake route: execute');
    });

    it('does not override intent when the CLI spec text references a .js workflow file', async () => {
      const localExecutor = memoryLocalExecutorOptions({ stdout: ['ran'] });
      const result = await runLocal(
        {
          source: 'cli',
          spec: 'run workflows/deploy.js',
          stageMode: 'run',
        },
        { localExecutor },
      );

      expect(result.logs).toContain('[local] spec intake route: execute');
    });

    it('does not override intent when the CLI spec text references a .workflow.yaml file', async () => {
      const localExecutor = memoryLocalExecutorOptions({ stdout: ['ran'] });
      const result = await runLocal(
        {
          source: 'cli',
          spec: 'run ops/release.workflow.yaml',
          stageMode: 'run',
        },
        { localExecutor },
      );

      expect(result.logs).toContain('[local] spec intake route: execute');
    });
  });
});

describe('appendCoordinatorLogs', () => {
  function buildResult(overrides: Partial<CoordinatorResult> = {}): CoordinatorResult {
    return {
      runId: 'run-1',
      workflowFile: '/tmp/workflow.ts',
      cwd: '/tmp',
      status: 'failed',
      exitCode: 1,
      startedAt: '2026-01-01T00:00:00.000Z',
      completedAt: '2026-01-01T00:00:01.000Z',
      endedAt: '2026-01-01T00:00:01.000Z',
      durationMs: 1000,
      stdout: [],
      stderr: [],
      stdoutSnippet: { lines: [], totalLines: 0, maxLines: 0, truncated: false },
      stderrSnippet: { lines: [], totalLines: 0, maxLines: 0, truncated: false },
      events: [],
      retry: { attempt: 0, maxAttempts: 1, attempts: [] },
      invocation: { command: 'node', args: ['workflow.ts'], cwd: '/tmp' },
      ...overrides,
    } as CoordinatorResult;
  }

  it('emits header lines plus prefixed stdout/stderr entries', () => {
    const logs: string[] = ['preexisting'];
    appendCoordinatorLogs(
      logs,
      buildResult({ stdout: ['hello', 'world'], stderr: ['warn'] }),
    );
    expect(logs).toEqual([
      'preexisting',
      '[local] runtime status: failed',
      '[local] runtime command: node workflow.ts',
      '[stdout] hello',
      '[stdout] world',
      '[stderr] warn',
    ]);
  });

  // Regression: `arr.push(...big)` and `[...big]` both pass each element as a
  // function argument, which overflows V8's argument-stack limit (~100k) on
  // noisy failed runs. A multi-agent failure easily produces > 200k log lines.
  it('handles 200k stdout/stderr entries without overflowing the call stack', () => {
    const stdout = Array.from({ length: 200_000 }, (_, i) => `out-${i}`);
    const stderr = Array.from({ length: 200_000 }, (_, i) => `err-${i}`);
    const logs: string[] = [];

    expect(() =>
      appendCoordinatorLogs(logs, buildResult({ stdout, stderr })),
    ).not.toThrow();

    expect(logs.length).toBe(2 + stdout.length + stderr.length);
    expect(logs[2]).toBe('[stdout] out-0');
    expect(logs[logs.length - 1]).toBe('[stderr] err-199999');
  });
});
