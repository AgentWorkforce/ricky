import { describe, expect, it } from 'vitest';

import type {
  CliHandoff,
  ClaudeHandoff,
  LocalExecutorOptions,
  LocalExecutor,
  LocalInvocationRequest,
  LocalResponse,
  McpHandoff,
  RawHandoff,
  StructuredSpecHandoff,
  WorkflowArtifactHandoff,
} from './index';
import { DEFAULT_LOCAL_ROUTE, normalizeRequest, runLocal } from './index';
import type {
  CommandInvocation,
  CommandRunner,
  CommandRunnerOptions,
  CoordinatorResult,
  RunRequest,
} from '@ricky/runtime/types';

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
  runnerOptions?: { exitCode?: number; stdout?: string[]; stderr?: string[] },
): LocalExecutorOptions & {
  writes: Array<{ path: string; content: string; cwd: string }>;
  runner: CommandRunner & { invocations: RecordedInvocation[] };
} {
  const writes: Array<{ path: string; content: string; cwd: string }> = [];
  const runner = immediateCommandRunner(runnerOptions);
  return {
    cwd: '/repo',
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

// ---------------------------------------------------------------------------
// normalizeRequest
// ---------------------------------------------------------------------------

describe('normalizeRequest', () => {
  it('normalizes a CLI handoff with inline spec', async () => {
    const raw: CliHandoff = { source: 'cli', spec: 'build a pipeline' };
    const result = await normalizeRequest(raw);

    expect(result.source).toBe('cli');
    expect(result.spec).toBe('build a pipeline');
    expect(result.mode).toBe('local');
    expect(result.metadata).toEqual({});
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

  it('respects explicit mode override instead of defaulting to local', async () => {
    const raw: CliHandoff = { source: 'cli', spec: 'test', mode: 'both' };
    const result = await normalizeRequest(raw);

    expect(result.mode).toBe('both');
    expect(result.executionPreference).toBe('both');
  });

  it('accepts executionPreference as an explicit alias for mode', async () => {
    const raw: CliHandoff = { source: 'cli', spec: 'test', executionPreference: 'both' };
    const result = await normalizeRequest(raw);

    expect(result.mode).toBe('both');
    expect(result.executionPreference).toBe('both');
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
    expect(result.executionPreference).toBe('both');
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
      expect(result.executionPreference).toBe('local');
    }
  });
});

// ---------------------------------------------------------------------------
// runLocal
// ---------------------------------------------------------------------------

describe('runLocal', () => {
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
    expect(result.nextActions[0]).toContain('retry');
    expect(executor.calls).toHaveLength(0);
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

  it('defaults BYOH generation requests to the injected local runtime without Cloud fallback', async () => {
    const localExecutor = memoryLocalExecutorOptions({ stdout: ['local run completed'] });
    const result = await runLocal(
      { source: 'cli', spec: 'generate a local workflow for packages/local/src/entrypoint.ts' },
      { localExecutor },
    );

    expect(result.ok).toBe(true);
    expect(localExecutor.writes).toHaveLength(1);
    expect(localExecutor.runner.invocations).toHaveLength(1);
    expect(localExecutor.runner.invocations[0]).toMatchObject({
      command: DEFAULT_LOCAL_ROUTE.command,
      cwd: '/repo',
    });
    expect(localExecutor.runner.invocations[0].args.slice(0, 3)).toEqual(DEFAULT_LOCAL_ROUTE.baseArgs);
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
      { source: 'cli', spec: 'generate a local workflow for src/local/entrypoint.ts with tests' },
      { localExecutor },
    );

    expect(result.ok).toBe(true);
    expect(result.logs.some((l) => l.includes('[local] received spec from cli'))).toBe(true);
    expect(result.logs.some((l) => l.includes('[local] spec intake route: generate'))).toBe(true);
    expect(result.logs.some((l) => l.includes('[local] workflow generation: passed'))).toBe(true);
    expect(result.logs.some((l) => l.includes('[local] runtime status: passed'))).toBe(true);
    expect(localExecutor.writes).toHaveLength(1);
    expect(result.artifacts[0].content).toContain('workflow(');
  });

  it('coordinates an existing local workflow artifact without generating a replacement', async () => {
    const localExecutor = memoryLocalExecutorOptions();
    const result = await runLocal(
      { source: 'cli', spec: 'run workflows/wave4-local-byoh/02-local-invocation-entrypoint.ts' },
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

  it('returns local artifact and runtime log shape for an injected runtime adapter', async () => {
    const localExecutor = memoryLocalExecutorOptions({
      stdout: ['local workflow completed'],
      stderr: ['local warning from runtime'],
    });
    const result = await runLocal(
      { source: 'cli', spec: 'run workflows/wave4-local-byoh/02-local-invocation-entrypoint.ts' },
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
        '[local] runtime command: npx --no-install agent-relay run workflows/wave4-local-byoh/ready-local.workflow.ts',
        '[stdout] coordinator accepted local artifact',
        '[stderr] coordinator emitted local warning',
      ]),
    );
    expect(result.logs.some((l) => l.includes('[local] workflow generation'))).toBe(false);
    expect(result.warnings.some((w) => w.includes('Cloud API surface'))).toBe(false);
  });

  it('surfaces injected local coordinator environment failures without Cloud fallback', async () => {
    const launches: RunRequest[] = [];
    const result = await runLocal(
      { source: 'cli', spec: 'run workflows/wave4-local-byoh/missing-runtime.workflow.ts' },
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
    expect(result.warnings).toContain('local runtime environment missing agent-relay');
    expect(result.warnings.some((w) => w.includes('Cloud API surface'))).toBe(false);
    expect(result.nextActions.some((a) => a.includes('environment blocker'))).toBe(true);
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
      },
      { localExecutor: memoryLocalExecutorOptions() },
    );

    expect(result.ok).toBe(true);
    expect(result.nextActions.some((a) => a.includes('promote to Cloud'))).toBe(true);
  });

  it('uses the local executor path by default for BYOH requests without Cloud warnings', async () => {
    const localExecutor = memoryLocalExecutorOptions();
    const result = await runLocal(
      { source: 'mcp', arguments: { goal: 'generate a local workflow for packages/local/src/entrypoint.ts' } },
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
      { source: 'cli', spec: 'generate a local workflow for src/local/entrypoint.ts with tests' },
      { localExecutor },
    );

    expect(localExecutor.writes).toHaveLength(1);
    expect(localExecutor.writes[0].cwd).toBe('/repo');
  });

  it('uses DEFAULT_LOCAL_ROUTE with npx --no-install by default', async () => {
    const localExecutor = memoryLocalExecutorOptions();
    await runLocal(
      { source: 'cli', spec: 'generate a local workflow for src/local/entrypoint.ts with tests' },
      { localExecutor },
    );

    const invocation = localExecutor.runner.invocations[0];
    expect(invocation).toBeDefined();
    expect(invocation.command).toBe('npx');
    expect(invocation.args[0]).toBe('--no-install');
    expect(invocation.args[1]).toBe('agent-relay');
    expect(invocation.args[2]).toBe('run');
    expect(invocation.cwd).toBe('/repo');
  });

  it('accepts a custom route override via LocalExecutorOptions', async () => {
    const localExecutor = memoryLocalExecutorOptions();
    localExecutor.route = { command: 'custom-relay', baseArgs: ['execute'] };
    await runLocal(
      { source: 'cli', spec: 'generate a local workflow for src/local/entrypoint.ts with tests' },
      { localExecutor },
    );

    const invocation = localExecutor.runner.invocations[0];
    expect(invocation.command).toBe('custom-relay');
    expect(invocation.args[0]).toBe('execute');
  });

  it('exports DEFAULT_LOCAL_ROUTE with deterministic shape', () => {
    expect(DEFAULT_LOCAL_ROUTE).toEqual({
      command: 'npx',
      baseArgs: ['--no-install', 'agent-relay', 'run'],
    });
  });

  it('returns runtime blockers instead of hiding local execution failures', async () => {
    const result = await runLocal(
      { source: 'cli', spec: 'generate a local workflow for src/local/entrypoint.ts with tests' },
      {
        localExecutor: memoryLocalExecutorOptions({
          exitCode: 127,
          stderr: ['agent-relay: command not found'],
        }),
      },
    );

    expect(result.ok).toBe(false);
    expect(result.logs.some((l) => l.includes('[stderr] agent-relay: command not found'))).toBe(true);
    expect(result.warnings.some((w) => w.includes('exited with code 127'))).toBe(true);
    expect(result.nextActions.some((a) => a.includes('environment blocker'))).toBe(true);
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

  it('surfaces local runtime launch environment warnings without rerouting through Cloud', async () => {
    const runner = throwingCommandRunner('spawn agent-relay ENOENT');
    const result = await runLocal(
      { source: 'cli', spec: 'run workflows/wave4-local-byoh/02-local-invocation-entrypoint.ts' },
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
        '[local] runtime command: npx --no-install agent-relay run workflows/wave4-local-byoh/02-local-invocation-entrypoint.ts',
      ]),
    );
    expect(result.warnings).toContain('spawn agent-relay ENOENT');
    expect(result.warnings.some((w) => w.includes('Cloud API surface'))).toBe(false);
    expect(result.nextActions.some((a) => a.includes('environment blocker'))).toBe(true);
  });
});
