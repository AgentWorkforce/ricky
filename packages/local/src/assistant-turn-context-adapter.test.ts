import { createTurnContextAssembler } from '@agent-assistant/turn-context';
import { describe, expect, it } from 'vitest';

import type { LocalInvocationRequest, RawHandoff } from './index';
import { assembleRickyTurnContext, normalizeRequest, toRickyTurnContextInput } from './index';

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
      const assemblyMetadata = assembly.metadata as
        | { adapter?: Record<string, unknown>; ricky?: Record<string, unknown> }
        | undefined;
      const rickyMetadata = assemblyMetadata?.ricky;

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
      expect(assembly.provenance.usedEnrichmentIds, testCase.name).toEqual(
        expect.arrayContaining([
          'ricky-request-summary',
          'ricky-spec-text',
          'ricky-request-metadata',
        ]),
      );
      expect(contextBlockContent(assembly.context.blocks, 'enrichment-ricky-request-summary'), testCase.name).toContain(
        `source: ${testCase.expected.source}`,
      );
      expect(contextBlockContent(assembly.context.blocks, 'enrichment-ricky-spec-text'), testCase.name).toBe(
        testCase.expected.spec,
      );
      expect(parseJsonBlock(assembly.context.blocks, 'enrichment-ricky-request-metadata'), testCase.name).toEqual(
        testCase.expected.metadata,
      );

      if (testCase.expected.structuredSpec) {
        expect(parseJsonBlock(assembly.context.blocks, 'enrichment-ricky-structured-spec'), testCase.name).toEqual(
          testCase.expected.structuredSpec,
        );
      }

      if (testCase.expected.sourceMetadata) {
        expect(parseJsonBlock(assembly.context.blocks, 'enrichment-ricky-source-metadata'), testCase.name).toEqual(
          testCase.expected.sourceMetadata,
        );
      }
    }
  });
});
