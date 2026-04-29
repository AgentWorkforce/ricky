import { describe, expect, it } from 'vitest';

import { intake } from '../spec-intake/index.js';
import type { NormalizedWorkflowSpec, RawSpecPayload } from '../spec-intake/types.js';
import { generate } from './pipeline.js';

const RECEIVED_AT = '2026-04-26T00:00:00.000Z';

interface SpecFixtureOverrides {
  description?: string;
  targetFiles?: string[];
  constraints?: string[];
  evidenceRequirements?: string[];
  acceptanceGates?: string[];
  executionPreference?: NormalizedWorkflowSpec['executionPreference'];
}

describe('workflow generation pipeline', () => {
  it('turns a code-writing spec into an implementation team workflow with 80-to-100 validation', () => {
    const result = generate({
      spec: spec({
        description: 'Implement a TypeScript API endpoint with parallel independent file slices and deterministic proof.',
        targetFiles: [
          'src/cloud/api/generate-endpoint.ts',
          'src/cloud/api/proof/cloud-generate-proof.test.ts',
          'src/product/generation/pipeline.test.ts',
        ],
        constraints: ['Must use parallel implementation where files are independent.'],
        evidenceRequirements: ['Record deterministic proof for typecheck and tests.'],
        acceptanceGates: ['npx tsc --noEmit', 'npx vitest run src/cloud/api/proof/cloud-generate-proof.test.ts'],
      }),
      artifactPath: 'workflows/generated/code-generation.ts',
    });

    expect(result.success).toBe(true);
    expect(result.artifact).not.toBeNull();
    const artifact = result.artifact!;

    expect(result.patternDecision).toMatchObject({
      pattern: 'dag',
      riskLevel: 'high',
      overrideUsed: false,
    });
    expect(artifact).toMatchObject({
      artifactPath: 'workflows/generated/code-generation.ts',
      pattern: 'dag',
      channel: expect.stringMatching(/^wf-ricky-/),
    });
    expect(artifact.tasks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'lead-plan', agentRole: 'lead-claude' }),
        expect.objectContaining({ id: 'implement-artifact', agentRole: 'impl-primary-codex' }),
        expect.objectContaining({ id: 'fix-loop', name: '80-to-100 fix loop' }),
        expect.objectContaining({ id: 'final-review-claude' }),
        expect.objectContaining({ id: 'final-review-codex' }),
        expect.objectContaining({ id: 'final-signoff', dependsOn: ['regression-gate'] }),
      ]),
    );
    expect(artifact.content).toContain('.agent("impl-primary-codex"');
    expect(artifact.content).toContain('.agent("impl-tests-codex"');
    expect(artifact.content).toContain('.agent("validator-claude"');
    expect(gate(artifact, 'initial-soft-validation')).toMatchObject({
      stage: 'pre_review',
      failOnError: false,
      dependsOn: ['post-implementation-file-gate'],
    });
    expect(gate(artifact, 'post-fix-validation')).toMatchObject({
      stage: 'post_fix',
      failOnError: false,
      dependsOn: ['post-fix-verification-gate'],
    });
    expect(gate(artifact, 'final-review-pass-gate')).toMatchObject({
      stage: 'final',
      failOnError: true,
      dependsOn: ['final-review-claude', 'final-review-codex'],
    });
    expect(result.validation).toMatchObject({
      valid: true,
      hasReviewStage: true,
      hasDeterministicGates: true,
    });
    expect(result.validation.issues).toEqual([]);
    expect(artifact.content).toMatch(/80-to-100 fix loop/i);
    expect(artifact.content).toContain('final-review');
  });

  it('proves required generation skills are loaded and applied only during generation', () => {
    const result = generate({
      spec: spec({
        description: 'Implement strict TypeScript workflow proof with deterministic tests and 80-to-100 validation.',
        targetFiles: ['src/product/generation/template-renderer.ts', 'src/product/generation/pipeline.test.ts'],
        acceptanceGates: ['npx vitest run packages/product/src/generation/pipeline.test.ts'],
      }),
      artifactPath: 'workflows/generated/skill-boundary.ts',
    });

    expect(result.success).toBe(true);
    const artifact = result.artifact!;

    expect(result.skillContext.applicableSkillNames).toEqual(
      expect.arrayContaining(['writing-agent-relay-workflows', 'relay-80-100-workflow']),
    );
    expect(result.skillContext.applicationEvidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          skillName: 'writing-agent-relay-workflows',
          stage: 'generation_selection',
          behavior: 'generation_time_only',
          runtimeEmbodiment: false,
        }),
        expect.objectContaining({
          skillName: 'writing-agent-relay-workflows',
          stage: 'generation_loading',
          effect: 'metadata',
          behavior: 'generation_time_only',
          runtimeEmbodiment: false,
        }),
        expect.objectContaining({
          skillName: 'relay-80-100-workflow',
          stage: 'generation_selection',
          behavior: 'generation_time_only',
          runtimeEmbodiment: false,
        }),
        expect.objectContaining({
          skillName: 'relay-80-100-workflow',
          stage: 'generation_loading',
          effect: 'metadata',
          behavior: 'generation_time_only',
          runtimeEmbodiment: false,
        }),
      ]),
    );
    expect(artifact.skillApplicationEvidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          skillName: 'writing-agent-relay-workflows',
          stage: 'generation_rendering',
          effect: 'workflow_contract',
          behavior: 'generation_time_only',
          runtimeEmbodiment: false,
          evidence: expect.stringContaining('dedicated channel'),
        }),
        expect.objectContaining({
          skillName: 'relay-80-100-workflow',
          stage: 'generation_rendering',
          effect: 'validation_gates',
          behavior: 'generation_time_only',
          runtimeEmbodiment: false,
          evidence: expect.stringContaining('deterministic gates'),
        }),
      ]),
    );
    expect(artifact.content).toContain('loaded-skills.txt');
    expect(artifact.content).toContain('skill-application-boundary.json');
    expect(artifact.content).toContain('writing-agent-relay-workflows');
    expect(artifact.content).toContain('relay-80-100-workflow');
    expect(artifact.content).toContain('generation_time_only');
    expect(artifact.content).toContain('runtimeEmbodiment');
    expect(artifact.content).toContain('Skills are applied by Ricky during selection, loading, and template rendering.');
    expect(artifact.content).toContain('Do not claim generated agents load, retain, or embody skill files at runtime');
    const skillBoundaryGate = artifact.gates.find((gate) => gate.name === 'skill-boundary-metadata-gate')!;
    expect(skillBoundaryGate.command).toContain('writing-agent-relay-workflows');
    expect(skillBoundaryGate.command).toContain('relay-80-100-workflow');
    expect(skillBoundaryGate.command).toContain('"stage":"generation_selection"');
    expect(skillBoundaryGate.command).toContain('"stage":"generation_loading"');
    expect(skillBoundaryGate.command).toContain('"stage":"generation_rendering"');
    expect(skillBoundaryGate.command).toContain('"effect":"workflow_contract"');
    expect(skillBoundaryGate.command).toContain('"effect":"validation_gates"');
    expect(artifact.gates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'skill-boundary-metadata-gate',
          command: expect.stringContaining('skill-application-boundary.json'),
          failOnError: true,
          stage: 'pre_review',
        }),
      ]),
    );
  });

  it('accepts a natural doc/spec request and selects a lighter workflow with deterministic review gates', () => {
    const payload: RawSpecPayload = {
      kind: 'natural_language',
      surface: 'cli',
      receivedAt: RECEIVED_AT,
      requestId: 'doc-spec-request',
      text: [
        'Create a workflow spec document for release readiness.',
        'Only modify docs/release-readiness.md.',
        'Acceptance: reviewer signoff is recorded.',
      ].join('\n'),
    };
    const intakeResult = intake(payload);
    const normalizedSpec = intakeResult.routing?.normalizedSpec;

    expect(intakeResult.success).toBe(true);
    expect(intakeResult.routing?.target).toBe('generate');
    expect(normalizedSpec?.intent).toBe('generate');
    expect(normalizedSpec?.desiredAction.kind).toBe('generate');
    expect(normalizedSpec?.desiredAction.workflowFileHint).toBeUndefined();
    expect(normalizedSpec?.desiredAction.specText).toContain('workflow spec document');
    expect(normalizedSpec?.targetFiles).toEqual(['docs/release-readiness.md']);

    const result = generate({
      spec: normalizedSpec!,
      artifactPath: 'workflows/generated/doc-spec.ts',
    });

    expect(result.success).toBe(true);
    expect(result.artifact).not.toBeNull();
    const artifact = result.artifact!;

    expect(result.patternDecision).toMatchObject({
      pattern: 'supervisor',
      riskLevel: 'medium',
    });
    expect(artifact.tasks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'lead-plan', agentRole: 'lead-claude' }),
        expect.objectContaining({ id: 'implement-artifact', agentRole: 'author-codex' }),
        expect.objectContaining({ id: 'review-claude', dependsOn: ['initial-soft-validation'] }),
        expect.objectContaining({ id: 'review-codex', dependsOn: ['initial-soft-validation'] }),
      ]),
    );
    expect(artifact.content).toContain('.agent("author-codex"');
    expect(artifact.content).not.toContain('.agent("impl-primary-codex"');
    expect(artifact.gates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'initial-soft-validation',
          failOnError: false,
          stage: 'pre_review',
        }),
        expect.objectContaining({
          name: 'final-review-pass-gate',
          failOnError: true,
          stage: 'final',
        }),
        expect.objectContaining({
          name: 'final-hard-validation',
          failOnError: true,
          stage: 'final',
        }),
      ]),
    );
  });

  it('reports a missing optional skill as a structured validation issue without crashing', () => {
    const result = generate({
      spec: spec({
        description: 'Draft a workflow plan for docs handoff.',
        targetFiles: ['docs/generated-handoff.md'],
      }),
      skillOverrides: ['missing-optional-skill'],
      artifactPath: 'workflows/generated/missing-skill.ts',
    });

    expect(result.success).toBe(true);
    expect(result.skillContext.skills).toEqual([
      expect.objectContaining({
        name: 'missing-optional-skill',
        loaded: false,
        applicable: true,
        prerequisitesMet: false,
      }),
    ]);
    expect(result.validation.issues).toEqual([
      expect.objectContaining({
        severity: 'warning',
        stage: 'skill_loading',
        code: 'SKILL_UNKNOWN',
        field: 'skillOverrides',
        blocking: false,
        message: expect.stringContaining('missing-optional-skill'),
      }),
    ]);
    expect(result.validation.errors).toEqual([]);
  });

  it('renders the required workflow structure and deterministic gates', () => {
    const result = generate({
      spec: spec({
        description: 'Implement workflow generation tests with deterministic validation.',
        targetFiles: ['src/product/generation/pipeline.test.ts'],
        acceptanceGates: ['npx vitest run src/product/generation/pipeline.test.ts'],
      }),
      artifactPath: 'workflows/generated/pipeline-tests.ts',
    });

    expect(result.success).toBe(true);
    expect(result.artifact).not.toBeNull();
    const artifact = result.artifact!;

    expect(artifact).toMatchObject({
      workflowId: expect.stringMatching(/^ricky-/),
      channel: expect.stringMatching(/^wf-ricky-/),
    });
    expect(artifact.channel).not.toBe('general');
    expect(artifact.content).toContain('workflow(');
    expect(artifact.content).toContain(`.channel("${artifact.channel}")`);
    expect(artifact.content).toContain('review-claude');
    expect(artifact.content).toContain('review-codex');
    expect(gate(artifact, 'initial-soft-validation')).toMatchObject({
      failOnError: false,
      stage: 'pre_review',
      verificationType: 'exit_code',
    });
    expect(gate(artifact, 'final-hard-validation')).toMatchObject({
      failOnError: true,
      stage: 'final',
      verificationType: 'deterministic_gate',
      dependsOn: ['final-review-pass-gate'],
    });
    expect(gate(artifact, 'git-diff-gate')).toMatchObject({
      command: expect.stringContaining('git diff --name-only'),
      failOnError: true,
      stage: 'final',
      dependsOn: ['final-hard-validation'],
    });
    expect(result.validation.issues).toEqual([]);
  });

  it('returns dry-run and deterministic validation commands without executing agent-relay', () => {
    const result = generate({
      spec: spec({
        description: 'Implement workflow generation command evidence.',
        targetFiles: ['src/product/generation/pipeline.ts'],
        acceptanceGates: ['npx vitest run src/product/generation/pipeline.test.ts'],
      }),
      artifactPath: 'workflows/generated/command-evidence.ts',
    });

    expect(result.dryRunCommand).toBe('npx agent-relay run --dry-run workflows/generated/command-evidence.ts');
    expect(result.plannedChecks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'dry-run',
          command: result.dryRunCommand,
          stage: 'dry_run',
          failOnError: true,
        }),
        expect.objectContaining({ name: 'final-hard-validation', command: expect.stringContaining('npx tsc --noEmit') }),
        expect.objectContaining({ name: 'regression-gate', command: 'npx vitest run' }),
      ]),
    );
    expect(result.deterministicValidationCommands).not.toContain(result.dryRunCommand);
    expect(result.deterministicValidationCommands).toEqual(
      expect.arrayContaining([
        expect.stringContaining('npx tsc --noEmit'),
        expect.stringContaining('npx vitest run'),
        expect.stringContaining('git diff --name-only'),
      ]),
    );
    expect(result.plannedChecks.map((check) => check.command)).toContain(result.dryRunCommand);
    expect(result.plannedChecks.find((check) => check.name === 'dry-run')?.stage).toBe('dry_run');
    expect(result.plannedChecks.find((check) => check.name === 'dry-run')?.command).toContain('--dry-run');
  });

  it('final review output paths match the final-review-pass-gate check paths', () => {
    const result = generate({
      spec: spec({
        description: 'Implement path-consistency validation for review artifacts.',
        targetFiles: ['src/product/generation/template-renderer.ts'],
      }),
      artifactPath: 'workflows/generated/path-consistency.ts',
    });

    expect(result.success).toBe(true);
    const artifact = result.artifact!;
    const passGate = artifact.gates.find((g) => g.name === 'final-review-pass-gate')!;

    const claudePathMatch = artifact.content.match(/Write\s+(\S+\/final-review-claude\.md)/);
    const codexPathMatch = artifact.content.match(/Write\s+(\S+\/final-review-codex\.md)/);
    expect(claudePathMatch).not.toBeNull();
    expect(codexPathMatch).not.toBeNull();

    expect(passGate.command).toContain(claudePathMatch![1]);
    expect(passGate.command).toContain(codexPathMatch![1]);
    expect(passGate.command).toContain("tr -d '[:space:]*'");
  });

  it('no-target spec uses output manifest instead of artifact path in file gates', () => {
    const result = generate({
      spec: spec({
        description: 'Implement a code change without explicit target files.',
        targetFiles: [],
      }),
      artifactPath: 'workflows/generated/no-target.ts',
    });

    expect(result.success).toBe(true);
    const artifact = result.artifact!;
    const fileGate = artifact.gates.find((g) => g.name === 'post-implementation-file-gate')!;

    expect(fileGate.command).toContain('output-manifest.txt');
    expect(fileGate.command).not.toContain('workflows/generated/no-target.ts');
    expect(artifact.content).toContain('output-manifest.txt');
  });

  it('maps prose acceptance gates with inline shell commands without emitting prose as shell', () => {
    const result = generate({
      spec: spec({
        description: 'Improve generated workflow quality for version gates.',
        targetFiles: ['src/product/generation/template-renderer.ts'],
        acceptanceGates: [
          "test for this layer: the version workflow verifies `node dist/bin/ricky.js --version | grep -Eq '^ricky [0-9]+\\.[0-9]+\\.[0-9]+$'` instead of a generic source-shape grep.",
        ],
      }),
      artifactPath: 'workflows/generated/inline-command-gate.ts',
    });

    expect(result.success).toBe(true);
    const initialValidation = result.artifact!.gates.find((gate) => gate.name === 'initial-soft-validation')!;
    expect(initialValidation.command).toContain("node dist/bin/ricky.js --version | grep -Eq '^ricky [0-9]+\\.[0-9]+\\.[0-9]+$'");
    expect(initialValidation.command).not.toContain('test for this layer');
  });

  it('selects pipeline pattern for low-risk simple spec', () => {
    const result = generate({
      spec: spec({
        description: 'Update a readme file.',
        targetFiles: ['README.md'],
      }),
    });

    expect(result.success).toBe(true);
    expect(result.patternDecision).toMatchObject({
      pattern: 'pipeline',
      riskLevel: 'low',
      overrideUsed: false,
    });
  });

  it('respects pattern override', () => {
    const result = generate({
      spec: spec({
        description: 'Simple change to one file.',
        targetFiles: ['README.md'],
      }),
      patternOverride: 'dag',
    });

    expect(result.success).toBe(true);
    expect(result.patternDecision).toMatchObject({
      pattern: 'dag',
      overrideUsed: true,
    });
    expect(artifact(result).content).toContain('.pattern("dag")');
  });

  it('returns null dryRunCommand when dryRunEnabled is false', () => {
    const result = generate({
      spec: spec({
        description: 'Implement workflow with dry run disabled.',
        targetFiles: ['src/product/generation/pipeline.ts'],
      }),
      dryRunEnabled: false,
    });

    expect(result.success).toBe(true);
    expect(result.dryRunCommand).toBeNull();
    expect(result.plannedChecks.find((c) => c.stage === 'dry_run')).toBeUndefined();
  });

  it('reports blocking error for unknown template override', () => {
    const result = generate({
      spec: spec({
        description: 'Generate with a bad template.',
        targetFiles: ['src/something.ts'],
      }),
      templateOverride: 'nonexistent-template',
    });

    expect(result.success).toBe(false);
    expect(result.validation.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: 'error',
          stage: 'template_resolution',
          code: 'TEMPLATE_MISSING',
          blocking: true,
        }),
      ]),
    );
  });

  it('routes cloud execution correctly', () => {
    const result = generate({
      spec: spec({
        description: 'Implement a cloud-routed workflow.',
        targetFiles: ['src/cloud/handler.ts'],
        executionPreference: 'cloud',
      }),
    });

    expect(result.success).toBe(true);
    expect(result.executionRoute).toMatchObject({
      requestedPreference: 'cloud',
      resolvedTarget: 'cloud',
      artifactDelivery: 'cloud_artifact',
    });
  });

  it('routes local non-CLI surface to return_artifact', () => {
    const mcpSpec = spec({
      description: 'Generate via MCP surface.',
      targetFiles: ['src/api/endpoint.ts'],
    });
    mcpSpec.providerContext.surface = 'mcp';

    const result = generate({ spec: mcpSpec });

    expect(result.success).toBe(true);
    expect(result.executionRoute).toMatchObject({
      resolvedTarget: 'local',
      invocationSurface: 'mcp',
      artifactDelivery: 'return_artifact',
    });
  });

  it('reports non-blocking warning when an unknown skill is force-loaded via override', () => {
    const result = generate({
      spec: spec({
        description: 'Generate with an unknown skill override.',
        targetFiles: ['src/something.ts'],
      }),
      skillOverrides: ['unknown-optional-skill'],
    });

    expect(result.success).toBe(true);
    expect(result.validation.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: 'warning',
          code: 'SKILL_UNKNOWN',
          blocking: false,
        }),
      ]),
    );
  });

  it('all rendered artifact paths are scoped under the workflow-specific artifacts directory', () => {
    const result = generate({
      spec: spec({
        description: 'Verify artifact directory scoping for generated paths.',
        targetFiles: ['src/product/generation/pipeline.ts'],
      }),
      artifactPath: 'workflows/generated/scoped-paths.ts',
    });

    expect(result.success).toBe(true);
    const content = artifact(result).content;

    const slug = 'verify-artifact-directory-scoping-for-generated';
    const artifactsDir = `.workflow-artifacts/generated/${slug}`;
    expect(content).toContain(`${artifactsDir}/lead-plan.md`);
    expect(content).toContain(`${artifactsDir}/review-claude.md`);
    expect(content).toContain(`${artifactsDir}/review-codex.md`);
    expect(content).toContain(`${artifactsDir}/final-review-claude.md`);
    expect(content).toContain(`${artifactsDir}/final-review-codex.md`);
    expect(content).toContain(`${artifactsDir}/skill-application-boundary.json`);
    expect(content).toContain(`${artifactsDir}/skill-runtime-boundary.txt`);
    expect(content).toContain(`${artifactsDir}/signoff.md`);
  });
});

function artifact(result: ReturnType<typeof generate>): NonNullable<ReturnType<typeof generate>['artifact']> {
  expect(result.artifact).not.toBeNull();
  return result.artifact!;
}

function gate(
  artifact: NonNullable<ReturnType<typeof generate>['artifact']>,
  name: string,
): NonNullable<ReturnType<typeof generate>['artifact']>['gates'][number] {
  const match = artifact.gates.find((candidate) => candidate.name === name);
  expect(match).toBeDefined();
  return match!;
}

function spec(overrides: SpecFixtureOverrides = {}): NormalizedWorkflowSpec {
  const description = overrides.description ?? 'Generate a workflow for deterministic product work.';
  const rawPayload: RawSpecPayload = {
    kind: 'natural_language',
    surface: 'cli',
    receivedAt: RECEIVED_AT,
    requestId: 'generation-test-request',
    text: description,
  };
  const providerContext = {
    surface: 'cli' as const,
    requestId: rawPayload.requestId,
    metadata: {},
  };
  const targetFiles = overrides.targetFiles ?? [];
  const constraints = overrides.constraints ?? [];
  const evidenceRequirements = overrides.evidenceRequirements ?? [];
  const acceptanceGates = overrides.acceptanceGates ?? [];

  return {
    intent: 'generate',
    description,
    targetRepo: null,
    targetContext: null,
    targetFiles,
    desiredAction: {
      kind: 'generate',
      summary: description,
      specText: description,
      targetFiles,
    },
    constraints: constraints.map((constraint) => ({
      constraint,
      category: /\bonly\b|\bmust\b/i.test(constraint) ? 'scope' : 'quality',
    })),
    evidenceRequirements: evidenceRequirements.map((requirement) => ({
      requirement,
      verificationType: 'output_contains',
    })),
    requiredEvidence: evidenceRequirements.map((requirement) => ({
      requirement,
      verificationType: 'output_contains',
    })),
    acceptanceGates: acceptanceGates.map((gate) => ({
      gate,
      kind: /review/i.test(gate) ? 'review' : 'deterministic',
    })),
    acceptanceCriteria: acceptanceGates.map((gate) => ({
      gate,
      kind: /review/i.test(gate) ? 'review' : 'deterministic',
    })),
    providerContext,
    sourceSpec: {
      surface: 'cli',
      intent: { primary: 'generate', signals: ['test fixture'] },
      description,
      targetRepo: undefined,
      targetContext: undefined,
      targetFiles,
      constraints,
      evidenceRequirements,
      acceptanceGates,
      providerContext,
      rawPayload,
      parseConfidence: 'high',
      parseWarnings: [],
    },
    executionPreference: overrides.executionPreference ?? 'auto',
  };
}
