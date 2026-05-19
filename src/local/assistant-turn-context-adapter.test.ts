import { createTurnContextAssembler, toExecutionRequest } from '@agent-assistant/turn-context';
import { describe, expect, it } from 'vitest';

import type { LocalInvocationRequest, RawHandoff } from './index.js';
import { assembleRickyTurnContext, normalizeRequest, toRickyTurnContextInput } from './index.js';

function artifactReader(content: string) {
  return {
    async readArtifact(_path: string): Promise<string> {
      return content;
    },
  };
}

function contextBlockContent(blocks: Array<{ id: string; content: string }>, id: string): string {
  const block = blocks.find((candidate) => candidate.id === id);
  expect(block, id).toBeDefined();
  return block!.content;
}

function parseJsonBlock(blocks: Array<{ id: string; content: string }>, id: string): unknown {
  return JSON.parse(contextBlockContent(blocks, id));
}

interface PreservationCase {
  name: string;
  raw: RawHandoff;
  artifactContent?: string;
  expected: {
    requestId: string;
    source: LocalInvocationRequest['source'];
    spec: string;
    structuredSpec?: Record<string, unknown>;
    sourceMetadata?: Record<string, unknown>;
    invocationRoot: string;
    mode: LocalInvocationRequest['mode'];
    stageMode: NonNullable<LocalInvocationRequest['stageMode']>;
    specPath?: string;
    metadata: Record<string, unknown>;
  };
}

describe('Ricky turn-context adapter', () => {
  it('uses the installed turn-context assembler as the production backing adapter', async () => {
    const normalized = await normalizeRequest({
      source: 'cli',
      spec: {
        description: 'generate a local workflow through the production turn-context adapter',
        stageMode: 'generate',
        targetFiles: ['src/local/assistant-turn-context-adapter.ts'],
      },
      specFile: 'specs/issue-11.production-adapter.json',
      requestId: 'req-production-turn-context-adapter',
      invocationRoot: '/repo/production-adapter',
      metadata: { issue: 11, proof: 'production-adapter' },
      cliMetadata: { argv: ['ricky', 'run', '--spec-file', 'specs/issue-11.production-adapter.json'] },
    });

    const assembly = await assembleRickyTurnContext(normalized);
    const assemblyMetadata = assembly.metadata as
      | { adapter?: Record<string, unknown>; ricky?: Record<string, unknown> }
      | undefined;

    expect(assembly.assistantId).toBe('ricky');
    expect(assembly.turnId).toBe('req-production-turn-context-adapter');
    expect(assemblyMetadata?.adapter).toMatchObject({
      name: 'ricky-local-turn-context-adapter',
      package: '@agent-assistant/turn-context',
    });
    expect(assemblyMetadata?.ricky).toMatchObject({
      requestId: 'req-production-turn-context-adapter',
      source: 'cli',
      invocationRoot: '/repo/production-adapter',
      mode: 'local',
      stageMode: 'generate',
      specPath: 'specs/issue-11.production-adapter.json',
      metadata: {
        issue: 11,
        proof: 'production-adapter',
        argv: ['ricky', 'run', '--spec-file', 'specs/issue-11.production-adapter.json'],
      },
    });
    expect(assembly.context.blocks.map((block) => block.id)).toEqual(
      expect.arrayContaining([
        'enrichment-ricky-request-summary',
        'enrichment-ricky-spec-text',
        'enrichment-ricky-structured-spec',
        'enrichment-ricky-source-metadata',
        'enrichment-ricky-request-metadata',
      ]),
    );
    expect(assembly.context.blocks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'enrichment-ricky-request-summary',
          source: 'ricky-local',
          importance: 'high',
        }),
        expect.objectContaining({
          id: 'enrichment-ricky-source-metadata',
          content: JSON.stringify(
            {
              cli: {
                argv: ['ricky', 'run', '--spec-file', 'specs/issue-11.production-adapter.json'],
                specFile: 'specs/issue-11.production-adapter.json',
              },
            },
            null,
            2,
          ),
        }),
      ]),
    );
    expect(assembly.harnessProjection.instructions.developerPrompt).toContain(
      'Current mode: ricky-local:local:generate',
    );
  });

  it('projects preserved Ricky request metadata through the real turn-context execution request adapter', async () => {
    const structuredSpec = {
      description: 'generate a workflow that proves execution request projection keeps Ricky request context',
      targetFiles: ['src/local/assistant-turn-context-adapter.test.ts'],
      stageMode: 'run',
    };
    const normalized = await normalizeRequest({
      source: 'cli',
      spec: structuredSpec,
      specFile: 'specs/issue-11.execution-request.json',
      requestId: 'req-issue-11-execution-request',
      invocationRoot: '/repo/execution-request',
      executionPreference: 'both',
      metadata: { issue: 11, proof: 'execution-request-projection' },
      cliMetadata: { argv: ['ricky', 'run', '--spec-file', 'specs/issue-11.execution-request.json'] },
    });

    const assembly = await assembleRickyTurnContext(normalized);
    const executionRequest = toExecutionRequest(assembly, {
      id: 'msg-issue-11-execution-request',
      text: normalized.spec,
      receivedAt: '2026-01-01T00:00:00.000Z',
    });
    const metadata = executionRequest.metadata as
      | { adapter?: Record<string, unknown>; ricky?: Record<string, unknown> }
      | undefined;

    expect(executionRequest).toMatchObject({
      assistantId: 'ricky',
      turnId: 'req-issue-11-execution-request',
      message: {
        id: 'msg-issue-11-execution-request',
        text: 'generate a workflow that proves execution request projection keeps Ricky request context',
      },
      instructions: {
        responseStyle: { preferMarkdown: true },
      },
      context: {
        blocks: expect.arrayContaining([
          expect.objectContaining({
            id: 'enrichment-ricky-request-summary',
            text: expect.stringContaining('source: cli'),
            metadata: expect.objectContaining({ source: 'ricky-local', importance: 'high' }),
          }),
          expect.objectContaining({
            id: 'enrichment-ricky-spec-text',
            text: normalized.spec,
          }),
          expect.objectContaining({
            id: 'enrichment-ricky-structured-spec',
            text: JSON.stringify(structuredSpec, null, 2),
          }),
          expect.objectContaining({
            id: 'enrichment-ricky-source-metadata',
            text: JSON.stringify(
              {
                cli: {
                  argv: ['ricky', 'run', '--spec-file', 'specs/issue-11.execution-request.json'],
                  specFile: 'specs/issue-11.execution-request.json',
                },
              },
              null,
              2,
            ),
          }),
        ]),
      },
    });
    expect(metadata?.adapter).toMatchObject({
      name: 'ricky-local-turn-context-adapter',
      package: '@agent-assistant/turn-context',
    });
    expect(metadata?.ricky).toMatchObject({
      requestId: 'req-issue-11-execution-request',
      source: 'cli',
      invocationRoot: '/repo/execution-request',
      mode: 'both',
      stageMode: 'run',
      specPath: 'specs/issue-11.execution-request.json',
      metadata: {
        issue: 11,
        proof: 'execution-request-projection',
        argv: ['ricky', 'run', '--spec-file', 'specs/issue-11.execution-request.json'],
      },
    });
    expect(metadata?.ricky?.structuredSpec).toEqual(structuredSpec);
    expect(metadata?.ricky?.sourceMetadata).toEqual({
      cli: {
        argv: ['ricky', 'run', '--spec-file', 'specs/issue-11.execution-request.json'],
        specFile: 'specs/issue-11.execution-request.json',
      },
    });
  });

  it('round-trips every handoff surface through normalizeRequest and the real turn-context-backed adapter', async () => {
    const cases: PreservationCase[] = [
      {
        name: 'free-form',
        raw: {
          source: 'free-form',
          spec: 'generate a local workflow from free-form text',
          requestId: 'req-free-form-11',
          invocationRoot: '/repo/free-form',
          mode: 'both',
          stageMode: 'generate',
          metadata: { ticket: 'issue-11', surface: 'free-form' },
        },
        expected: {
          requestId: 'req-free-form-11',
          source: 'free-form',
          spec: 'generate a local workflow from free-form text',
          invocationRoot: '/repo/free-form',
          mode: 'both',
          stageMode: 'generate',
          metadata: { ticket: 'issue-11', surface: 'free-form' },
        },
      },
      {
        name: 'structured',
        raw: {
          source: 'structured',
          spec: {
            description: 'generate a workflow from a structured payload',
            targetFiles: ['packages/local/src/assistant-turn-context-adapter.ts'],
            nested: { priority: 'high' },
          },
          requestId: 'req-structured-11',
          invocationRoot: '/repo/structured',
          executionPreference: 'both',
          behavior: 'run',
          metadata: { ticket: 'issue-11', surface: 'structured' },
        },
        expected: {
          requestId: 'req-structured-11',
          source: 'structured',
          spec: 'generate a workflow from a structured payload',
          structuredSpec: {
            description: 'generate a workflow from a structured payload',
            targetFiles: ['packages/local/src/assistant-turn-context-adapter.ts'],
            nested: { priority: 'high' },
          },
          invocationRoot: '/repo/structured',
          mode: 'both',
          stageMode: 'run',
          metadata: { ticket: 'issue-11', surface: 'structured' },
        },
      },
      {
        name: 'cli',
        raw: {
          source: 'cli',
          spec: {
            goal: 'generate a CLI workflow from structured input',
            workflowFile: 'workflows/issue-11/cli.workflow.ts',
          },
          specFile: 'specs/issue-11.cli.json',
          requestId: 'req-cli-11',
          invocationRoot: '/repo/cli',
          mode: 'local',
          stageMode: 'generate-and-run',
          metadata: { ticket: 'issue-11', surface: 'cli' },
          cliMetadata: { argv: ['ricky', 'run', '--spec-file', 'specs/issue-11.cli.json'] },
        },
        expected: {
          requestId: 'req-cli-11',
          source: 'cli',
          spec: 'generate a CLI workflow from structured input',
          structuredSpec: {
            goal: 'generate a CLI workflow from structured input',
            workflowFile: 'workflows/issue-11/cli.workflow.ts',
          },
          sourceMetadata: {
            cli: {
              argv: ['ricky', 'run', '--spec-file', 'specs/issue-11.cli.json'],
              specFile: 'specs/issue-11.cli.json',
            },
          },
          invocationRoot: '/repo/cli',
          mode: 'local',
          stageMode: 'generate-and-run',
          specPath: 'specs/issue-11.cli.json',
          metadata: {
            ticket: 'issue-11',
            surface: 'cli',
            argv: ['ricky', 'run', '--spec-file', 'specs/issue-11.cli.json'],
          },
        },
      },
      {
        name: 'mcp',
        raw: {
          source: 'mcp',
          toolName: 'ricky.generate',
          arguments: {
            prompt: 'generate an MCP workflow from tool arguments',
            workflowFile: 'workflows/issue-11/mcp.workflow.ts',
            stageMode: 'run',
          },
          requestId: 'req-mcp-11',
          invocationRoot: '/repo/mcp',
          executionPreference: 'auto',
          metadata: { ticket: 'issue-11', surface: 'mcp' },
          mcpMetadata: { toolCallId: 'tool-issue-11' },
        },
        expected: {
          requestId: 'req-mcp-11',
          source: 'mcp',
          spec: 'generate an MCP workflow from tool arguments',
          structuredSpec: {
            prompt: 'generate an MCP workflow from tool arguments',
            workflowFile: 'workflows/issue-11/mcp.workflow.ts',
            stageMode: 'run',
          },
          sourceMetadata: {
            mcp: {
              toolCallId: 'tool-issue-11',
              toolName: 'ricky.generate',
            },
          },
          invocationRoot: '/repo/mcp',
          mode: 'both',
          stageMode: 'run',
          metadata: {
            ticket: 'issue-11',
            surface: 'mcp',
            toolCallId: 'tool-issue-11',
            toolName: 'ricky.generate',
          },
        },
      },
      {
        name: 'claude',
        raw: {
          source: 'claude',
          spec: {
            request: 'generate a Claude workflow from handoff context',
            workflowFile: 'workflows/issue-11/claude.workflow.ts',
            stage_mode: 'generate',
          },
          requestId: 'req-claude-11',
          invocationRoot: '/repo/claude',
          mode: 'local',
          metadata: { ticket: 'issue-11', surface: 'claude' },
          conversationId: 'conversation-issue-11',
          turnId: 'turn-issue-11',
        },
        expected: {
          requestId: 'req-claude-11',
          source: 'claude',
          spec: 'generate a Claude workflow from handoff context',
          structuredSpec: {
            request: 'generate a Claude workflow from handoff context',
            workflowFile: 'workflows/issue-11/claude.workflow.ts',
            stage_mode: 'generate',
          },
          sourceMetadata: {
            claude: {
              conversationId: 'conversation-issue-11',
              turnId: 'turn-issue-11',
            },
          },
          invocationRoot: '/repo/claude',
          mode: 'local',
          stageMode: 'generate',
          metadata: {
            ticket: 'issue-11',
            surface: 'claude',
            conversationId: 'conversation-issue-11',
            turnId: 'turn-issue-11',
          },
        },
      },
      {
        name: 'workflow-artifact',
        raw: {
          source: 'workflow-artifact',
          artifactPath: 'workflows/issue-11/artifact.workflow.ts',
          requestId: 'req-artifact-11',
          invocationRoot: '/repo/artifact',
          mode: 'local',
          metadata: { ticket: 'issue-11', surface: 'workflow-artifact' },
        },
        artifactContent: 'import { workflow } from "@agent-relay/sdk/workflows";',
        expected: {
          requestId: 'req-artifact-11',
          source: 'workflow-artifact',
          spec: 'import { workflow } from "@agent-relay/sdk/workflows";',
          invocationRoot: '/repo/artifact',
          mode: 'local',
          stageMode: 'run',
          specPath: 'workflows/issue-11/artifact.workflow.ts',
          metadata: { ticket: 'issue-11', surface: 'workflow-artifact' },
        },
      },
    ];

    for (const testCase of cases) {
      const normalized = await normalizeRequest(
        testCase.raw,
        artifactReader(testCase.artifactContent ?? 'unused artifact content'),
      );
      const adapterInput = toRickyTurnContextInput(normalized);
      const assembly = await assembleRickyTurnContext(normalized, {
        assembler: createTurnContextAssembler(),
      });
      const executionRequest = toExecutionRequest(assembly, {
        id: `msg-${testCase.expected.requestId}`,
        text: normalized.spec,
        receivedAt: '2026-01-01T00:00:00.000Z',
      });
      const assemblyMetadata = assembly.metadata as
        | { adapter?: Record<string, unknown>; ricky?: Record<string, unknown> }
        | undefined;
      const rickyMetadata = assemblyMetadata?.ricky;
      const executionMetadata = executionRequest.metadata as
        | { adapter?: Record<string, unknown>; ricky?: Record<string, unknown> }
        | undefined;

      expect(normalized, testCase.name).toMatchObject({
        _normalized: true,
        requestId: testCase.expected.requestId,
        source: testCase.expected.source,
        spec: testCase.expected.spec,
        invocationRoot: testCase.expected.invocationRoot,
        mode: testCase.expected.mode,
        stageMode: testCase.expected.stageMode,
        metadata: testCase.expected.metadata,
      });
      expect(normalized.structuredSpec, testCase.name).toEqual(testCase.expected.structuredSpec);
      expect(normalized.sourceMetadata, testCase.name).toEqual(testCase.expected.sourceMetadata);
      expect(normalized.specPath, testCase.name).toBe(testCase.expected.specPath);

      expect(adapterInput.metadata?.adapter, testCase.name).toMatchObject({
        name: 'ricky-local-turn-context-adapter',
        package: '@agent-assistant/turn-context',
      });
      expect(adapterInput.enrichment?.candidates, testCase.name).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: 'ricky-request-summary',
            content: expect.stringContaining(`requestId: ${testCase.expected.requestId}`),
          }),
          expect.objectContaining({
            id: 'ricky-spec-text',
            content: testCase.expected.spec,
          }),
          expect.objectContaining({
            id: 'ricky-request-metadata',
            content: JSON.stringify(testCase.expected.metadata, null, 2),
          }),
        ]),
      );
      expect(adapterInput.metadata?.ricky, testCase.name).toMatchObject({
        requestId: testCase.expected.requestId,
        source: testCase.expected.source,
        invocationRoot: testCase.expected.invocationRoot,
        mode: testCase.expected.mode,
        stageMode: testCase.expected.stageMode,
        specPath: testCase.expected.specPath,
        metadata: testCase.expected.metadata,
      });
      expect((adapterInput.metadata?.ricky as Record<string, unknown>).structuredSpec, testCase.name).toEqual(
        testCase.expected.structuredSpec,
      );
      expect((adapterInput.metadata?.ricky as Record<string, unknown>).sourceMetadata, testCase.name).toEqual(
        testCase.expected.sourceMetadata,
      );

      expect(assembly.assistantId, testCase.name).toBe('ricky');
      expect(assembly.turnId, testCase.name).toBe(testCase.expected.requestId);
      expect(assemblyMetadata?.adapter, testCase.name).toMatchObject({
        name: 'ricky-local-turn-context-adapter',
        package: '@agent-assistant/turn-context',
      });
      expect(rickyMetadata, testCase.name).toMatchObject({
        requestId: testCase.expected.requestId,
        source: testCase.expected.source,
        invocationRoot: testCase.expected.invocationRoot,
        mode: testCase.expected.mode,
        stageMode: testCase.expected.stageMode,
        specPath: testCase.expected.specPath,
        metadata: testCase.expected.metadata,
      });
      expect(rickyMetadata?.structuredSpec, testCase.name).toEqual(testCase.expected.structuredSpec);
      expect(rickyMetadata?.sourceMetadata, testCase.name).toEqual(testCase.expected.sourceMetadata);
      expect(assembly.instructions.developerSegments, testCase.name).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: 'shaping-mode',
            source: 'shaping',
            text: `Current mode: ricky-local:${testCase.expected.mode}:${testCase.expected.stageMode}`,
          }),
        ]),
      );
      expect(assembly.harnessProjection.instructions.developerPrompt, testCase.name).toContain(
        `Current mode: ricky-local:${testCase.expected.mode}:${testCase.expected.stageMode}`,
      );
      expect(assembly.harnessProjection.context.blocks, testCase.name).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: 'enrichment-ricky-request-summary',
            content: expect.stringContaining(`source: ${testCase.expected.source}`),
          }),
          expect.objectContaining({
            id: 'enrichment-ricky-spec-text',
            content: testCase.expected.spec,
          }),
        ]),
      );
      expect(assembly.provenance.usedEnrichmentIds, testCase.name).toEqual(
        expect.arrayContaining([
          'ricky-request-summary',
          'ricky-spec-text',
          'ricky-request-metadata',
        ]),
      );
      const requestSummary = contextBlockContent(assembly.context.blocks, 'enrichment-ricky-request-summary');
      expect(requestSummary, testCase.name).toContain(`source: ${testCase.expected.source}`);
      expect(requestSummary, testCase.name).toContain(`requestId: ${testCase.expected.requestId}`);
      expect(requestSummary, testCase.name).toContain(`mode: ${testCase.expected.mode}`);
      expect(requestSummary, testCase.name).toContain(`stageMode: ${testCase.expected.stageMode}`);
      expect(requestSummary, testCase.name).toContain(`invocationRoot: ${testCase.expected.invocationRoot}`);
      expect(requestSummary, testCase.name).toContain(
        `specPath: ${testCase.expected.specPath ?? '(not supplied)'}`,
      );
      expect(contextBlockContent(assembly.context.blocks, 'enrichment-ricky-spec-text'), testCase.name).toBe(
        testCase.expected.spec,
      );
      expect(parseJsonBlock(assembly.context.blocks, 'enrichment-ricky-request-metadata'), testCase.name).toEqual(
        testCase.expected.metadata,
      );
      expect(executionRequest.context?.blocks, testCase.name).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: 'enrichment-ricky-request-metadata',
            text: JSON.stringify(testCase.expected.metadata, null, 2),
            metadata: expect.objectContaining({
              source: 'ricky-local',
              importance: 'medium',
            }),
          }),
        ]),
      );
      expect(executionRequest, testCase.name).toMatchObject({
        assistantId: 'ricky',
        turnId: testCase.expected.requestId,
        message: {
          id: `msg-${testCase.expected.requestId}`,
          text: testCase.expected.spec,
        },
        context: {
          blocks: expect.arrayContaining([
            expect.objectContaining({
              id: 'enrichment-ricky-request-summary',
              text: expect.stringContaining(`source: ${testCase.expected.source}`),
              metadata: expect.objectContaining({
                source: 'ricky-local',
                importance: 'high',
              }),
            }),
            expect.objectContaining({
              id: 'enrichment-ricky-spec-text',
              text: testCase.expected.spec,
              metadata: expect.objectContaining({
                source: 'ricky-local',
                importance: 'high',
              }),
            }),
          ]),
        },
      });
      const executionSummary = executionRequest.context?.blocks.find(
        (block) => block.id === 'enrichment-ricky-request-summary',
      )?.text;
      expect(executionSummary, testCase.name).toContain(`requestId: ${testCase.expected.requestId}`);
      expect(executionSummary, testCase.name).toContain(`mode: ${testCase.expected.mode}`);
      expect(executionSummary, testCase.name).toContain(`stageMode: ${testCase.expected.stageMode}`);
      expect(executionSummary, testCase.name).toContain(`invocationRoot: ${testCase.expected.invocationRoot}`);
      expect(executionSummary, testCase.name).toContain(
        `specPath: ${testCase.expected.specPath ?? '(not supplied)'}`,
      );
      expect(executionMetadata?.adapter, testCase.name).toMatchObject({
        name: 'ricky-local-turn-context-adapter',
        package: '@agent-assistant/turn-context',
      });
      expect(executionMetadata?.ricky, testCase.name).toMatchObject({
        requestId: testCase.expected.requestId,
        source: testCase.expected.source,
        invocationRoot: testCase.expected.invocationRoot,
        mode: testCase.expected.mode,
        stageMode: testCase.expected.stageMode,
        specPath: testCase.expected.specPath,
        metadata: testCase.expected.metadata,
      });
      expect(executionMetadata?.ricky?.structuredSpec, testCase.name).toEqual(
        testCase.expected.structuredSpec,
      );
      expect(executionMetadata?.ricky?.sourceMetadata, testCase.name).toEqual(
        testCase.expected.sourceMetadata,
      );

      if (testCase.expected.structuredSpec) {
        expect(adapterInput.enrichment?.candidates, testCase.name).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              id: 'ricky-structured-spec',
              content: JSON.stringify(testCase.expected.structuredSpec, null, 2),
            }),
          ]),
        );
        expect(parseJsonBlock(assembly.context.blocks, 'enrichment-ricky-structured-spec'), testCase.name).toEqual(
          testCase.expected.structuredSpec,
        );
        expect(executionRequest.context?.blocks, testCase.name).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              id: 'enrichment-ricky-structured-spec',
              text: JSON.stringify(testCase.expected.structuredSpec, null, 2),
              metadata: expect.objectContaining({
                source: 'ricky-local',
                importance: 'high',
              }),
            }),
          ]),
        );
      }

      if (testCase.expected.sourceMetadata) {
        expect(adapterInput.enrichment?.candidates, testCase.name).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              id: 'ricky-source-metadata',
              content: JSON.stringify(testCase.expected.sourceMetadata, null, 2),
            }),
          ]),
        );
        expect(parseJsonBlock(assembly.context.blocks, 'enrichment-ricky-source-metadata'), testCase.name).toEqual(
          testCase.expected.sourceMetadata,
        );
        expect(executionRequest.context?.blocks, testCase.name).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              id: 'enrichment-ricky-source-metadata',
              text: JSON.stringify(testCase.expected.sourceMetadata, null, 2),
              metadata: expect.objectContaining({
                source: 'ricky-local',
                importance: 'medium',
              }),
            }),
          ]),
        );
      }
    }
  });
});
