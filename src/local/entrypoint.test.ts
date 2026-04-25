import { describe, expect, it } from 'vitest';

import type {
  CliHandoff,
  ClaudeHandoff,
  LocalExecutor,
  LocalInvocationRequest,
  LocalResponse,
  McpHandoff,
  RawHandoff,
  WorkflowArtifactHandoff,
} from './index';
import { normalizeRequest, runLocal } from './index';

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

  it('works with the default executor (no options)', async () => {
    const result = await runLocal({ source: 'cli', spec: 'hello' });

    expect(result.ok).toBe(true);
    expect(result.logs.some((l) => l.includes('[local] received spec from cli'))).toBe(true);
    expect(result.logs.some((l) => l.includes('[local] mode: local'))).toBe(true);
  });

  it('default executor warns on cloud mode', async () => {
    const result = await runLocal({ source: 'cli', spec: 'hello', mode: 'cloud' });

    expect(result.ok).toBe(false);
    expect(result.warnings.some((w) => w.includes('local/BYOH entrypoint'))).toBe(true);
  });

  it('default executor suggests promotion for both mode', async () => {
    const result = await runLocal({ source: 'cli', spec: 'hello', mode: 'both' });

    expect(result.ok).toBe(true);
    expect(result.nextActions.some((a) => a.includes('promote to Cloud'))).toBe(true);
  });
});
