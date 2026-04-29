import { describe, expect, it } from 'vitest';

import type { NormalizedWorkflowSpec, RawSpecPayload } from '../spec-intake/types.js';
import type { RenderedArtifact } from './types.js';
import { refineWithLlm } from './refine-with-llm.js';

describe('refine with llm', () => {
  it('applies a valid allowlisted edit that passes validation', () => {
    const artifact = artifactFixture();
    const result = refineWithLlm(spec('Generate a workflow.'), artifact, {
      client: {
        refine: () => ({
          text: JSON.stringify({
            edits: [{ region: 'acceptance_gates', find: artifact.gates[0].command, replace: 'npx tsc --noEmit' }],
          }),
        }),
      },
      validate: () => ({ valid: true, errors: [], warnings: [], issues: [], hasDeterministicGates: true, hasReviewStage: true }),
    });

    expect(result.metadata.applied).toBe(true);
    expect(result.artifact.gates[0].command).toBe('npx tsc --noEmit');
  });

  it('rejects edits outside the allowlist', () => {
    const artifact = artifactFixture();
    const result = refineWithLlm(spec('Generate a workflow.'), artifact, {
      client: {
        refine: () => ({
          text: JSON.stringify({
            edits: [{ region: 'step_graph', find: 'old command', replace: 'new command' }],
          }),
        }),
      },
    });

    expect(result.metadata.applied).toBe(false);
    expect(result.metadata.warning).toContain('outside the allowlisted');
    expect(result.artifact).toBe(artifact);
  });

  it('returns the deterministic artifact on timeout', () => {
    const artifact = artifactFixture();
    const result = refineWithLlm(spec('Generate a workflow.'), artifact, {
      timeoutMs: 10,
      client: { refine: () => ({ text: JSON.stringify({ edits: [] }), elapsedMs: 11 }) },
    });

    expect(result.metadata.applied).toBe(false);
    expect(result.metadata.warning).toContain('timed out');
  });

  it('returns the deterministic artifact when token budget is exceeded', () => {
    const artifact = artifactFixture();
    const result = refineWithLlm(spec('Generate a workflow.'), artifact, {
      maxInputTokens: 1,
    });

    expect(result.metadata.applied).toBe(false);
    expect(result.metadata.warning).toContain('exceeded max 1');
  });

  it('returns the deterministic artifact when the model is unavailable', () => {
    const artifact = artifactFixture();
    const result = refineWithLlm(spec('Generate a workflow.'), artifact, {
      client: {
        refine: () => {
          throw new Error('model unavailable');
        },
      },
    });

    expect(result.metadata.applied).toBe(false);
    expect(result.metadata.warning).toContain('model unavailable');
  });

  it('reports validator_passed as false when no validator is supplied', () => {
    const artifact = artifactFixture();
    const result = refineWithLlm(spec('Generate a workflow.'), artifact, {
      client: {
        refine: () => ({
          text: JSON.stringify({
            edits: [{ region: 'acceptance_gates', find: artifact.gates[0].command, replace: 'npx tsc --noEmit' }],
          }),
        }),
      },
    });

    expect(result.metadata.applied).toBe(true);
    expect(result.metadata.validator_passed).toBe(false);
  });

  it('sharpens version acceptance gates to the stated behavior', () => {
    const artifact = artifactFixture({
      command: "test -f 'dist/bin/ricky.js' && grep -Eq 'export|function|class|workflow\\(' 'dist/bin/ricky.js'",
    });
    const result = refineWithLlm(
      spec('Acceptance: node dist/bin/ricky.js --version prints ricky semver.', ['dist/bin/ricky.js']),
      artifact,
      { validate: () => ({ valid: true, errors: [], warnings: [], issues: [], hasDeterministicGates: true, hasReviewStage: true }) },
    );

    expect(result.artifact.gates[0].command).toContain(
      "node dist/bin/ricky.js --version | grep -Eq '^ricky [0-9]+\\.[0-9]+\\.[0-9]+$'",
    );
  });
});

function artifactFixture(overrides: { command?: string } = {}): RenderedArtifact {
  const command = overrides.command ?? "test -f 'src/example.ts' && grep -Eq 'export' 'src/example.ts'";
  return {
    fileName: 'example.ts',
    artifactPath: 'workflows/generated/example.ts',
    workflowId: 'ricky-example',
    content: `workflow('ricky-example').step('post-implementation-file-gate', { command: ${JSON.stringify(command)} })`,
    pattern: 'pipeline',
    channel: 'wf-ricky-example',
    taskCount: 1,
    gateCount: 1,
    tasks: [],
    gates: [{ name: 'post-implementation-file-gate', command, verificationType: 'file_exists', failOnError: true, dependsOn: [], stage: 'pre_review' }],
    skillApplicationEvidence: [],
    skillMatches: [],
    toolSelections: [],
    artifactsDir: '.workflow-artifacts/generated/example',
  };
}

function spec(description: string, targetFiles: string[] = []): NormalizedWorkflowSpec {
  const rawPayload: RawSpecPayload = {
    kind: 'natural_language',
    surface: 'cli',
    receivedAt: '2026-04-26T00:00:00.000Z',
    text: description,
  };
  const providerContext = { surface: 'cli' as const, metadata: {} };
  return {
    intent: 'generate',
    description,
    targetRepo: null,
    targetContext: null,
    targetFiles,
    desiredAction: { kind: 'generate', summary: description, targetFiles },
    constraints: [],
    evidenceRequirements: [],
    requiredEvidence: [],
    acceptanceGates: [{ gate: description, kind: 'deterministic' }],
    acceptanceCriteria: [{ gate: description, kind: 'deterministic' }],
    executionPreference: 'auto',
    providerContext,
    sourceSpec: {
      surface: 'cli',
      intent: { primary: 'generate', signals: [] },
      description,
      targetFiles,
      constraints: [],
      evidenceRequirements: [],
      acceptanceGates: [description],
      providerContext,
      rawPayload,
      parseConfidence: 'high',
      parseWarnings: [],
    },
  };
}
