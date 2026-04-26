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
import type { CommandInvocation, CommandRunner, CommandRunnerOptions } from '../runtime/types';

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
  });

  it('defaults mode to local when not specified', async () => {
    const sources: RawHandoff[] = [
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

    expect(result.warnings.some((w) => w.includes('local/BYOH entrypoint'))).toBe(true);
    expect(result.warnings.some((w) => w.includes('Cloud API surface'))).toBe(true);
  });

  it('does not route through Cloud by default', async () => {
    const executor = mockExecutor();
    await runLocal({ source: 'cli', spec: 'test' }, { executor });

    expect(executor.calls[0].mode).toBe('local');
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

  it('coordinates a workflow artifact handoff as a ready local workflow', async () => {
    const localExecutor = memoryLocalExecutorOptions();
    const result = await runLocal(
      { source: 'workflow-artifact', artifactPath: 'workflows/wave4-local-byoh/02-local-invocation-entrypoint.ts' },
      { localExecutor, artifactReader: mockArtifactReader('import { workflow } from "@agent-relay/sdk/workflows";') },
    );

    expect(result.ok).toBe(true);
    expect(localExecutor.writes).toHaveLength(0);
    expect(result.artifacts[0].path).toBe('workflows/wave4-local-byoh/02-local-invocation-entrypoint.ts');
    expect(result.logs.some((l) => l.includes('[local] spec intake route: execute'))).toBe(true);
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
});
