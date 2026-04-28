import { describe, expect, it } from 'vitest';

import { intake } from './index.js';
import type { RawSpecPayload } from './types.js';

const RECEIVED_AT = '2026-04-26T00:00:00.000Z';

function natural(text: string, surface: RawSpecPayload['surface'] = 'cli'): RawSpecPayload {
  return {
    kind: 'natural_language',
    surface,
    receivedAt: RECEIVED_AT,
    requestId: `${surface}-request`,
    text,
  };
}

describe('spec intake parser, normalizer, and router', () => {
  it('routes Claude handoff text with workflow intent to generate without requiring a hand-authored workflow file', () => {
    const result = intake(
      natural(
        [
          'Claude handoff: create a new workflow spec for release readiness.',
          'Goal: generate coordinated validation for package, typecheck, and tests.',
          'Do not assume the user has already authored a workflow file.',
        ].join('\n'),
        'claude_handoff',
      ),
    );

    expect(result.success).toBe(true);
    expect(result.routing?.target).toBe('generate');
    expect(result.routing?.normalizedSpec.intent).toBe('generate');
    expect(result.routing?.normalizedSpec.desiredAction.specText).toContain('create a new workflow spec');
    expect(result.routing?.normalizedSpec.desiredAction.workflowFileHint).toBeUndefined();
    expect(result.routing?.normalizedSpec.targetFiles).toEqual([]);
  });

  it('normalizes CLI natural-language constraints and acceptance gates', () => {
    const result = intake(
      natural(
        [
          'Build a workflow for repo AgentWorkforce/ricky to verify the local runtime.',
          'Must only modify src/runtime/local-coordinator.ts.',
          'Do not call external services.',
          'Acceptance: npm test exits 0.',
          'Gate: deterministic routing proof is recorded.',
        ].join('\n'),
      ),
    );

    expect(result.success).toBe(true);
    expect(result.routing?.target).toBe('generate');
    expect(result.routing?.normalizedSpec.targetRepo).toBe('AgentWorkforce/ricky');
    expect(result.routing?.normalizedSpec.constraints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          constraint: 'Must only modify src/runtime/local-coordinator.ts.',
          category: 'scope',
        }),
        expect.objectContaining({
          constraint: 'Do not call external services.',
        }),
      ]),
    );
    expect(result.routing?.normalizedSpec.acceptanceGates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ gate: 'npm test exits 0.', kind: 'deterministic' }),
        expect.objectContaining({ gate: 'deterministic routing proof is recorded.', kind: 'deterministic' }),
      ]),
    );
  });

  it('preserves MCP-style structured payload source and provider context', () => {
    const payload: RawSpecPayload = {
      kind: 'mcp',
      surface: 'mcp',
      receivedAt: RECEIVED_AT,
      requestId: 'mcp-request',
      toolName: 'ricky.workflow.generate',
      metadata: { origin: 'relaycast' },
      arguments: {
        provider: 'claude',
        channel: 'wf-ricky-wave2',
        threadId: 'thread-1',
        userId: 'user-1',
        workspaceId: 'workspace-1',
        spec: {
          description: 'Generate a workflow that triages flaky test evidence.',
          targetRepo: 'AgentWorkforce/ricky',
          context: 'product spec intake',
          constraints: ['Only use deterministic local checks.'],
          acceptanceGates: ['vitest parser tests pass'],
        },
      },
    };

    const result = intake(payload);
    const normalized = result.routing?.normalizedSpec;

    expect(result.success).toBe(true);
    expect(result.routing?.target).toBe('generate');
    expect(normalized?.providerContext).toMatchObject({
      surface: 'mcp',
      toolName: 'ricky.workflow.generate',
      provider: 'claude',
      channel: 'wf-ricky-wave2',
      threadId: 'thread-1',
      userId: 'user-1',
      workspaceId: 'workspace-1',
      requestId: 'mcp-request',
      metadata: { origin: 'relaycast' },
    });
    expect(normalized?.sourceSpec.rawPayload).toBe(payload);
    expect(normalized?.targetContext).toBe('product spec intake');
  });

  it('routes failed-run evidence to debug', () => {
    const result = intake(
      natural(
        [
          'Debug the failed workflow run id run-123 for workflows/release.workflow.ts.',
          'Evidence: stdout contains a stack trace stored at artifacts/run-123.log.',
          'Verification: explain the failure and identify the failing step.',
        ].join('\n'),
      ),
    );

    expect(result.success).toBe(true);
    expect(result.routing?.target).toBe('debug');
    expect(result.routing?.normalizedSpec.intent).toBe('debug');
    expect(result.routing?.normalizedSpec.targetFiles).toEqual(
      expect.arrayContaining(['workflows/release.workflow.ts', 'artifacts/run-123.log']),
    );
    expect(result.routing?.normalizedSpec.evidenceRequirements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          requirement: expect.stringContaining('stdout contains a stack trace'),
          verificationType: 'output_contains',
        }),
      ]),
    );
  });

  it('routes ready artifact requests to execute', () => {
    const result = intake(
      natural('Run the ready artifact workflows/release.workflow.ts for the current repository.'),
    );

    expect(result.success).toBe(true);
    expect(result.routing?.target).toBe('execute');
    expect(result.routing?.normalizedSpec.intent).toBe('execute');
    expect(result.routing?.normalizedSpec.desiredAction.workflowFileHint).toBe('workflows/release.workflow.ts');
    expect(result.routing?.reason).toContain('executable workflow artifact');
  });

  it('excludes repository slugs from targetFiles', () => {
    const result = intake(
      natural('Build a workflow for repo AgentWorkforce/ricky to verify the local runtime.'),
    );

    expect(result.routing?.normalizedSpec.targetRepo).toBe('AgentWorkforce/ricky');
    expect(result.routing?.normalizedSpec.targetFiles).not.toContain('AgentWorkforce/ricky');
  });

  it('does not treat arbitrary .ts files as workflow file hints', () => {
    const result = intake(
      natural('Run src/runtime/local-coordinator.ts for the current repository.'),
    );

    expect(result.routing?.normalizedSpec.desiredAction.workflowFileHint).toBeUndefined();
    // Without a recognized workflow artifact, execute degrades to clarify
    expect(result.routing?.target).toBe('clarify');
  });

  it('surfaces route-blocking clarify reason in validationIssues for debug without evidence', () => {
    const result = intake(natural('Debug this workflow'));

    expect(result.success).toBe(false);
    expect(result.routing?.target).toBe('clarify');
    expect(result.validationIssues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: 'warning',
          field: 'routing',
          message: expect.stringContaining('failed-run evidence'),
        }),
      ]),
    );
  });

  it('maps ricky.workflow.coordinate MCP tool to coordinate intent', () => {
    const result = intake({
      kind: 'mcp',
      surface: 'mcp',
      receivedAt: RECEIVED_AT,
      requestId: 'mcp-coord',
      toolName: 'ricky.workflow.coordinate',
      arguments: { description: 'Orchestrate agents across repos' },
    });

    expect(result.routing?.target).toBe('coordinate');
    expect(result.routing?.normalizedSpec.intent).toBe('coordinate');
  });

  it('returns clarify for ambiguous input with actionable missing fields', () => {
    const result = intake(natural('Can you help me figure out the next thing?'));

    expect(result.success).toBe(false);
    expect(result.routing?.target).toBe('clarify');
    expect(result.validationIssues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: 'warning',
          field: 'intent',
          suggestion: expect.stringContaining('workflow goal or target artifact'),
        }),
      ]),
    );
    expect(result.routing?.suggestedFollowUp).toContain('generate, debug, coordinate, or execute');
    expect(result.routing?.suggestedFollowUp).toContain('target context');
  });
});
