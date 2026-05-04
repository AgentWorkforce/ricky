import { describe, expect, it } from 'vitest';

import { intake } from '../spec-intake/index.js';
import type { NormalizedWorkflowSpec, RawSpecPayload } from '../spec-intake/types.js';
import { generate, validateGeneratedArtifact } from './pipeline.js';

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
    expect(result.patternDecision.specSignals).toContain('choosing-swarm-patterns skill loaded');
    expect(result.patternDecision.reason).toMatch(/parallel implementation, review, and validation gates/i);
    expect(result.patternDecision.reason).toMatch(/choosing-swarm-patterns/i);
    expect(result.executionRoute).toMatchObject({
      artifactDelivery: 'write_local_file',
      resolvedTarget: 'local',
      runnerCommand: 'npx agent-relay run --dry-run workflows/generated/code-generation.ts',
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
    expect(artifact.content).toContain('.agent("lead-claude", { cli: "claude", interactive: false');
    expect(artifact.content).toContain('.agent("impl-primary-codex"');
    expect(artifact.content).toContain('.agent("impl-tests-codex"');
    expect(artifact.content).toContain('.agent("validator-claude"');
    expect(artifact.content).toContain('80-to-100 fix loop');
    expect(artifact.content).toContain('deterministic sanity gate using grep, rg, or an equivalent assertion');
    expect(artifact.content).toContain('Generated workflow quality');
    expect(artifact.content).toContain('Keep each agent step bounded to one coherent slice');
    expect(result.toolSelection.selections).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          stepId: 'implement-artifact',
          agent: 'impl-primary-codex',
          concurrency: 2,
        }),
        expect.objectContaining({
          stepId: 'fix-loop',
          agent: 'validator-claude',
          concurrency: 1,
        }),
      ]),
    );
    expect(gate(artifact, 'initial-soft-validation')).toMatchObject({
      stage: 'pre_review',
      failOnError: false,
      dependsOn: ['post-implementation-file-gate'],
    });
    expect(gate(artifact, 'post-fix-validation')).toMatchObject({
      stage: 'post_fix',
      failOnError: false,
      dependsOn: ['active-reference-gate'],
    });
    expect(gate(artifact, 'active-reference-gate')).toMatchObject({
      stage: 'post_fix',
      failOnError: true,
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
    expect(result.deterministicValidationCommands).toEqual(
      expect.arrayContaining([
        expect.stringContaining('npx tsc --noEmit'),
        expect.stringContaining('npx vitest run src/cloud/api/proof/cloud-generate-proof.test.ts'),
        expect.stringContaining('git diff --name-only'),
      ]),
    );
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
      expect.arrayContaining(['choosing-swarm-patterns', 'writing-agent-relay-workflows', 'relay-80-100-workflow']),
    );
    expect(result.skillContext.applicationEvidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          skillName: 'choosing-swarm-patterns',
          stage: 'generation_selection',
          behavior: 'generation_time_only',
          runtimeEmbodiment: false,
        }),
        expect.objectContaining({
          skillName: 'choosing-swarm-patterns',
          stage: 'generation_loading',
          effect: 'metadata',
          behavior: 'generation_time_only',
          runtimeEmbodiment: false,
        }),
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
          skillName: 'choosing-swarm-patterns',
          stage: 'generation_rendering',
          effect: 'pattern_selection',
          behavior: 'generation_time_only',
          runtimeEmbodiment: false,
          evidence: expect.stringContaining('coordination shape'),
        }),
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
    expect(artifact.content).toContain('choosing-swarm-patterns');
    expect(artifact.content).toContain('writing-agent-relay-workflows');
    expect(artifact.content).toContain('relay-80-100-workflow');
    expect(artifact.content).toContain('generation_time_only');
    expect(artifact.content).toContain('runtimeEmbodiment');
    expect(artifact.content).toContain('Skills are applied by Ricky during selection, loading, and template rendering.');
    expect(artifact.content).toContain('Do not claim generated agents load, retain, or embody skill files at runtime');
    const skillBoundaryGate = artifact.gates.find((gate) => gate.name === 'skill-boundary-metadata-gate')!;
    expect(skillBoundaryGate.command).toContain('choosing-swarm-patterns');
    expect(skillBoundaryGate.command).toContain('writing-agent-relay-workflows');
    expect(skillBoundaryGate.command).toContain('relay-80-100-workflow');
    expect(skillBoundaryGate.command).toContain('"stage":"generation_selection"');
    expect(skillBoundaryGate.command).toContain('"stage":"generation_loading"');
    expect(skillBoundaryGate.command).toContain('"stage":"generation_rendering"');
    expect(skillBoundaryGate.command).toContain('"effect":"pattern_selection"');
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
    expect(result.validation).toMatchObject({
      valid: true,
      errors: [],
      issues: [],
      hasReviewStage: true,
      hasDeterministicGates: true,
    });
    expect(result.artifact).not.toBeNull();
    const artifact = result.artifact!;

    expect(result.executionRoute).toMatchObject({
      invocationSurface: 'cli',
      artifactDelivery: 'write_local_file',
      runnerCommand: 'npx agent-relay run --dry-run workflows/generated/doc-spec.ts',
    });
    expect(result.patternDecision).toMatchObject({
      pattern: 'supervisor',
      riskLevel: 'medium',
    });
    expect(result.patternDecision.specSignals).toContain('choosing-swarm-patterns skill loaded');
    expect(result.patternDecision.reason).toMatch(/choosing-swarm-patterns/i);
    expect(artifact.tasks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'lead-plan', agentRole: 'lead-claude' }),
        expect.objectContaining({ id: 'implement-artifact', agentRole: 'author-codex' }),
        expect.objectContaining({ id: 'review-claude', dependsOn: ['initial-soft-validation'] }),
        expect.objectContaining({ id: 'review-codex', dependsOn: ['initial-soft-validation'] }),
      ]),
    );
    expect(artifact.content).toContain('.agent("lead-claude", { cli: "codex", interactive: false');
    expect(artifact.content).toContain('.agent("reviewer-claude", { cli: "codex", preset: "reviewer"');
    expect(artifact.content).toContain('.agent("validator-claude", { cli: "codex", preset: "worker"');
    expect(artifact.content).toContain('.agent("author-codex"');
    expect(artifact.content).not.toContain('.agent("impl-primary-codex"');
    expect(artifact.content).toContain('docs/release-readiness.md');
    expect(result.toolSelection.selections).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          stepId: 'implement-artifact',
          agent: 'author-codex',
          concurrency: 1,
        }),
        expect.objectContaining({
          stepId: 'review-claude',
          agent: 'reviewer-claude',
          concurrency: 1,
        }),
        expect.objectContaining({
          stepId: 'review-codex',
          agent: 'reviewer-codex',
          concurrency: 1,
        }),
      ]),
    );
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
    expect(result.skillContext.loadWarnings).toEqual([
      expect.stringContaining('missing-optional-skill'),
    ]);
    expect(result.skillContext.applicableSkillNames).not.toContain('missing-optional-skill');
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

  it('uses the explicit artifact path basename for workflow identity', () => {
    const result = generate({
      spec: spec({
        description: 'Goal: I want to clean up the codebase to remove outdated and unused files.',
      }),
      artifactPath: 'workflows/generated/repo-tidying.ts',
    });

    expect(result.artifact).toMatchObject({
      artifactPath: 'workflows/generated/repo-tidying.ts',
      workflowId: 'ricky-repo-tidying',
      channel: 'wf-ricky-repo-tidying',
    });
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

    expect(result.validation).toMatchObject({
      valid: true,
      errors: [],
      issues: [],
      hasReviewStage: true,
      hasDeterministicGates: true,
    });
    expect(artifact).toMatchObject({
      workflowId: expect.stringMatching(/^ricky-/),
      channel: expect.stringMatching(/^wf-ricky-/),
    });
    expect(artifact.channel).not.toBe('general');
    expect(artifact.content).toMatch(/\bworkflow\(/);
    expect(artifact.content).toContain(`.channel("${artifact.channel}")`);
    expect(artifact.content).toContain('.run({ cwd: process.cwd() })');
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
    expect(gate(artifact, 'git-diff-gate').command).toContain('git ls-files --others --exclude-standard');
    expect(result.validation.issues).toEqual([]);
  });

  it('marks implementation workflows with source-change and result evidence contracts', () => {
    const result = generate({
      spec: spec({
        description: 'Implement durable backend review orchestration with tests and a pull request.',
        targetFiles: ['packages/backend/src/services/deep-review-orchestrator.ts'],
        acceptanceGates: ['npx vitest run packages/backend/src/services/deep-review-orchestrator.test.ts'],
      }),
      artifactPath: 'workflows/generated/deep-review-orchestration.ts',
    });

    expect(result.success).toBe(true);
    const content = artifact(result).content;
    expect(content).toContain('IMPLEMENTATION_WORKFLOW_CONTRACT');
    expect(content).toMatch(/source changes|code changes/i);
    expect(content).toMatch(/non-empty diff/i);
    expect(content).toMatch(/PR URL|pull request/i);
  });

  it('rejects planning-only artifacts for implementation specs', () => {
    const implementationSpec = spec({
      description: [
        'Implement webapp-triggered deep reviews with backend services, runtime election, Slack and Telegram retriggers, GitHub writeback, tests, and a pull request.',
        'The workflow must update backend and webapp source files.',
      ].join(' '),
      targetFiles: ['packages/backend/src/routes/review-workspace.ts'],
    });
    const result = generate({
      spec: implementationSpec,
      artifactPath: 'workflows/generated/webapp-review.ts',
    });

    const weakArtifact = {
      ...artifact(result),
      content: [
        "import { workflow } from '@agent-relay/sdk/workflows';",
        'async function main() {',
        '  const result = await workflow("ricky-webapp-review")',
        '    .description("Scaffold a model-agnostic deep-review relay workflow plan.")',
        '    .pattern("dag")',
        '    .channel("wf-ricky-webapp-review")',
        '    .agent("reviewer", { cli: "claude", role: "review stage" })',
        '    .step("prepare-context", { type: "deterministic", command: "echo skill-application-boundary.json generation_time_only runtimeEmbodiment", captureOutput: true, failOnError: true })',
        '    .step("plan-minimal", { agent: "reviewer", task: "Write the plan to plan.md and create mapping.json for the orchestration plan." })',
        '    .step("post-implementation-file-gate", { type: "deterministic", command: "test -f plan.md && grep -Eq \'ReviewReadinessResult\' plan.md", captureOutput: true, failOnError: true })',
        '    .step("fix-loop", { agent: "reviewer", task: "fix-loop" })',
        '    .step("final-review", { agent: "reviewer", task: "final-review" })',
        '    .step("final-hard-validation", { type: "deterministic", command: "npx tsc --noEmit && npm test", captureOutput: true, failOnError: true })',
        '    .step("git-diff-gate", { type: "deterministic", command: "git diff --name-only > git-diff.txt", captureOutput: true, failOnError: true })',
        '    .run({ cwd: process.cwd() });',
        '  console.log(result.status);',
        '}',
        'main().catch((error) => { console.error(error); process.exit(1); });',
      ].join('\n'),
    };

    const validation = validateGeneratedArtifact(weakArtifact, result.patternDecision, result.skillContext, implementationSpec);

    expect(validation.valid).toBe(false);
    expect(validation.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'IMPLEMENTATION_CONTRACT_MISSING' }),
        expect.objectContaining({ code: 'SOURCE_CHANGE_CONTRACT_MISSING' }),
        expect.objectContaining({ code: 'RESULT_PR_REPORTING_MISSING' }),
        expect.objectContaining({ code: 'PLANNING_ONLY_WORKFLOW_FOR_IMPLEMENTATION' }),
      ]),
    );
  });

  it('treats write-a-plan-then-implement requests as implementation workflows', () => {
    const implementationSpec = spec({
      description: [
        'Write a plan, then implement webapp-triggered deep reviews with backend services, runtime election, tests, and result evidence.',
        'The workflow must update backend source files.',
      ].join(' '),
      targetFiles: ['packages/backend/src/services/deep-review-orchestrator.ts'],
    });
    const result = generate({
      spec: implementationSpec,
      artifactPath: 'workflows/generated/mixed-plan-implement.ts',
    });

    const weakArtifact = {
      ...artifact(result),
      content: [
        "import { workflow } from '@agent-relay/sdk/workflows';",
        'async function main() {',
        '  const result = await workflow("ricky-mixed")',
        '    .description("Write a plan for the implementation.")',
        '    .pattern("dag")',
        '    .channel("wf-ricky-mixed")',
        '    .agent("reviewer", { cli: "claude", role: "review stage" })',
        '    .step("prepare-context", { type: "deterministic", command: "echo skill-application-boundary.json generation_time_only runtimeEmbodiment", captureOutput: true, failOnError: true })',
        '    .step("plan-minimal", { agent: "reviewer", task: "Write the plan to plan.md and create mapping.json." })',
        '    .step("post-implementation-file-gate", { type: "deterministic", command: "test -f plan.md && grep -Eq \'ReviewReadinessResult\' plan.md", captureOutput: true, failOnError: true })',
        '    .step("fix-loop", { agent: "reviewer", task: "fix-loop" })',
        '    .step("final-review", { agent: "reviewer", task: "final-review" })',
        '    .step("final-hard-validation", { type: "deterministic", command: "npx tsc --noEmit && npm test", captureOutput: true, failOnError: true })',
        '    .step("git-diff-gate", { type: "deterministic", command: "git diff --name-only > git-diff.txt", captureOutput: true, failOnError: true })',
        '    .run({ cwd: process.cwd() });',
        '  console.log(result.status);',
        '}',
        'main().catch((error) => { console.error(error); process.exit(1); });',
      ].join('\n'),
    };

    const validation = validateGeneratedArtifact(weakArtifact, result.patternDecision, result.skillContext, implementationSpec);

    expect(validation.valid).toBe(false);
    expect(validation.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'IMPLEMENTATION_CONTRACT_MISSING' }),
        expect.objectContaining({ code: 'PLANNING_ONLY_WORKFLOW_FOR_IMPLEMENTATION' }),
      ]),
    );
  });

  it('accepts explicit non-PR result status evidence for implementation workflows', () => {
    const implementationSpec = spec({
      description: 'Implement local-only workflow generation checks with tests and a result summary.',
      targetFiles: ['src/product/generation/pipeline.ts'],
    });
    const result = generate({
      spec: implementationSpec,
      artifactPath: 'workflows/generated/local-result-evidence.ts',
    });
    const content = artifact(result).content
      .replace(/PR\/result reporting/g, 'result reporting')
      .replace(/PR URL or /g, '')
      .replace(/pull request/g, 'result status')
      .replace(/Pull request/g, 'Result status');
    const validation = validateGeneratedArtifact(
      { ...artifact(result), content },
      result.patternDecision,
      result.skillContext,
      implementationSpec,
    );

    expect(validation.issues).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'RESULT_PR_REPORTING_MISSING' }),
      ]),
    );
  });

  it('accepts ripgrep as an equivalent deterministic sanity gate', () => {
    const implementationSpec = spec({
      description: 'Implement local workflow generation checks with resilient sanity validation.',
      targetFiles: ['src/product/generation/pipeline.ts'],
    });
    const result = generate({
      spec: implementationSpec,
      artifactPath: 'workflows/generated/resilient-sanity.ts',
    });
    const base = artifact(result);
    const gatesWithoutGrep = base.gates.map((gate) => ({
      ...gate,
      command: gate.command
        .replace(/\bgit\s+grep\b/g, 'printf')
        .replace(/\bgrep\b/g, 'printf'),
    }));
    const rgArtifact = {
      ...base,
      gates: gatesWithoutGrep.map((gate) => gate.name === 'post-implementation-file-gate'
        ? {
            ...gate,
            command: "test -f src/product/generation/pipeline.ts && rg -e 'export|function|class' src/product/generation/pipeline.ts",
          }
        : gate),
    };

    const validation = validateGeneratedArtifact(
      rgArtifact,
      result.patternDecision,
      result.skillContext,
      implementationSpec,
    );

    expect(validation.issues).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'GREP_GATE_MISSING' }),
      ]),
    );
  });

  it('requires inline runtime sanity gates to read evidence and fail on mismatch', () => {
    const implementationSpec = spec({
      description: 'Implement local workflow generation checks with inline sanity validation.',
      targetFiles: ['src/product/generation/pipeline.ts'],
    });
    const result = generate({
      spec: implementationSpec,
      artifactPath: 'workflows/generated/inline-sanity.ts',
    });
    const base = artifact(result);
    const gatesWithoutGrep = base.gates.map((gate) => ({
      ...gate,
      command: gate.command
        .replace(/\bgit\s+grep\b/g, 'printf')
        .replace(/\bgrep\b/g, 'printf'),
    }));
    const withPostImplementationCommand = (command: string) => ({
      ...base,
      gates: gatesWithoutGrep.map((gate) => gate.name === 'post-implementation-file-gate'
        ? { ...gate, command }
        : gate),
    });

    const noOpNodeValidation = validateGeneratedArtifact(
      withPostImplementationCommand('node -e "console.log(\'ok\')"'),
      result.patternDecision,
      result.skillContext,
      implementationSpec,
    );
    expect(noOpNodeValidation.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'GREP_GATE_MISSING' }),
      ]),
    );

    const assertingNodeValidation = validateGeneratedArtifact(
      withPostImplementationCommand(
        'node -e "const { readFileSync } = require(\'fs\'); if (!readFileSync(\'src/product/generation/pipeline.ts\', \'utf8\').includes(\'validateGeneratedArtifact\')) process.exit(1)"',
      ),
      result.patternDecision,
      result.skillContext,
      implementationSpec,
    );
    expect(assertingNodeValidation.issues).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'GREP_GATE_MISSING' }),
      ]),
    );
  });

  it('accepts ruby and perl inline assertions invoked with -e', () => {
    const implementationSpec = spec({
      description: 'Implement local workflow generation checks with ruby and perl sanity validation.',
      targetFiles: ['src/product/generation/pipeline.ts'],
    });
    const result = generate({
      spec: implementationSpec,
      artifactPath: 'workflows/generated/ruby-perl-sanity.ts',
    });
    const base = artifact(result);
    const gatesWithoutGrep = base.gates.map((gate) => ({
      ...gate,
      command: gate.command
        .replace(/\bgit\s+grep\b/g, 'printf')
        .replace(/\bgrep\b/g, 'printf'),
    }));
    const validations = [
      'ruby -e "raise unless File.read(\'src/product/generation/pipeline.ts\').include?(\'validateGeneratedArtifact\')"',
      'perl -e "open my $fh, \'<\', \'src/product/generation/pipeline.ts\' or die $!; local $/; my $s = <$fh>; die unless $s =~ /validateGeneratedArtifact/"',
    ].map((command) => validateGeneratedArtifact(
      {
        ...base,
        gates: gatesWithoutGrep.map((gate) => gate.name === 'post-implementation-file-gate'
          ? { ...gate, command }
          : gate),
      },
      result.patternDecision,
      result.skillContext,
      implementationSpec,
    ));

    for (const validation of validations) {
      expect(validation.issues).not.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: 'GREP_GATE_MISSING' }),
        ]),
      );
    }
  });

  it('does not count prose mentioning grep as a rendered sanity gate', () => {
    const implementationSpec = spec({
      description: 'Implement local workflow generation checks with strict gate validation.',
      targetFiles: ['src/product/generation/pipeline.ts'],
    });
    const result = generate({
      spec: implementationSpec,
      artifactPath: 'workflows/generated/missing-sanity.ts',
    });
    const base = artifact(result);
    const noSanityArtifact = {
      ...base,
      gates: base.gates.map((gate) => ({
        ...gate,
        command: gate.command
          .replace(/\bgit\s+grep\b/g, 'printf')
          .replace(/\bgrep\b/g, 'printf'),
      })),
    };

    expect(noSanityArtifact.content).toContain('deterministic sanity gate');
    const validation = validateGeneratedArtifact(
      noSanityArtifact,
      result.patternDecision,
      result.skillContext,
      implementationSpec,
    );

    expect(validation.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'GREP_GATE_MISSING' }),
      ]),
    );
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

    expect(result.artifact).not.toBeNull();
    const renderedArtifact = result.artifact!;

    expect(result.dryRunCommand).toBe('npx agent-relay run --dry-run workflows/generated/command-evidence.ts');
    expect(renderedArtifact.content).not.toContain(result.dryRunCommand);
    expect(result.validation).toMatchObject({
      valid: true,
      errors: [],
      issues: [],
      hasDeterministicGates: true,
      hasReviewStage: true,
    });
    expect(result.executionRoute).toMatchObject({
      runnerCommand: result.dryRunCommand,
      artifactDelivery: 'write_local_file',
      resolvedTarget: 'local',
    });
    expect(result.plannedChecks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'dry-run',
          command: result.dryRunCommand,
          stage: 'dry_run',
          failOnError: true,
          verificationType: 'exit_code',
        }),
        expect.objectContaining({ name: 'final-hard-validation', command: expect.stringContaining('npx tsc --noEmit') }),
        expect.objectContaining({ name: 'regression-gate', command: 'npx vitest run' }),
      ]),
    );
    expect(result.plannedChecks.map((check) => check.name)).toEqual(
      expect.arrayContaining([
        'dry-run',
        'initial-soft-validation',
        'final-review-pass-gate',
        'final-hard-validation',
        'git-diff-gate',
      ]),
    );
    expect(result.plannedChecks.find((check) => check.name === 'dry-run')).toMatchObject({
      command: result.dryRunCommand,
      environmentalPrerequisite: expect.stringContaining('@agent-relay/cli'),
    });
    expect(result.deterministicValidationCommands).not.toContain(result.dryRunCommand);
    expect(result.deterministicValidationCommands).toEqual(
      expect.arrayContaining([
        expect.stringContaining('npx tsc --noEmit'),
        expect.stringContaining('npx vitest run'),
        expect.stringContaining('git diff --name-only'),
      ]),
    );
    expect(result.deterministicValidationCommands).toEqual(
      expect.arrayContaining([
        expect.stringContaining('git ls-files --others --exclude-standard'),
      ]),
    );
    expect(result.plannedChecks.map((check) => check.command)).toContain(result.dryRunCommand);
    expect(result.plannedChecks.find((check) => check.name === 'dry-run')?.stage).toBe('dry_run');
    expect(result.plannedChecks.find((check) => check.name === 'dry-run')?.command).toContain('--dry-run');
    expect(result.plannedChecks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: expect.any(String),
          command: expect.any(String),
          stage: expect.any(String),
          failOnError: expect.any(Boolean),
          verificationType: expect.any(String),
        }),
      ]),
    );
    expect(result.plannedChecks.every((check) => check.command.length > 0)).toBe(true);
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

  it('no-target code workflow file gate validates manifest contents, not source-shape grep', () => {
    const result = generate({
      spec: spec({
        description: 'Implement a code change without explicit target files.',
        targetFiles: [],
      }),
      artifactPath: 'workflows/generated/no-target-gate.ts',
    });

    expect(result.success).toBe(true);
    const artifact = result.artifact!;
    const fileGate = artifact.gates.find((g) => g.name === 'post-implementation-file-gate')!;

    // Gate must NOT grep manifest for source-shape tokens (export|function|class|workflow)
    expect(fileGate.command).not.toMatch(/grep.*export\|function\|class/);
    // Gate must validate manifest is non-empty and support status-prefixed cleanup entries.
    expect(fileGate.command).toContain('output manifest is empty');
    expect(fileGate.command).toContain('deleted manifest path still exists');
    expect(fileGate.command).toContain('manifest path does not exist');
    expect(fileGate.command).toContain('MANIFEST_FILE_GATE_OK');
  });

  it('renders deterministic artifact content for the same spec with controlled registry', () => {
    const inputSpec = spec({
      description: 'Deterministic rendering proof for controlled registry.',
      targetFiles: ['src/product/generation/pipeline.ts'],
      acceptanceGates: ['npx vitest run src/product/generation/pipeline.test.ts'],
    });

    const result1 = generate({ spec: inputSpec, artifactPath: 'workflows/generated/deterministic-a.ts' });
    const result2 = generate({ spec: inputSpec, artifactPath: 'workflows/generated/deterministic-a.ts' });

    expect(result1.success).toBe(true);
    expect(result2.success).toBe(true);
    expect(result1.artifact!.content).toBe(result2.artifact!.content);
  });

  it('rendered skill metadata and embedded context avoid absolute paths and updatedAt timestamps', () => {
    const result = generate({
      spec: spec({
        description: 'Implement strict TypeScript workflow proof with deterministic tests.',
        targetFiles: ['src/product/generation/template-renderer.ts'],
      }),
      artifactPath: 'workflows/generated/no-env-data.ts',
    });

    expect(result.success).toBe(true);
    const content = result.artifact!.content;
    const skillMatchesLine = content.split('\n').find((line) => line.includes('skill-matches.json'));
    expect(skillMatchesLine).toBeDefined();
    expect(skillMatchesLine).not.toMatch(/"updatedAt"/);
    expect(skillMatchesLine).not.toMatch(/"path"/);
    expect(content).not.toContain('/Users/');
    expect(content).not.toMatch(/source=/);
    expect(content).not.toMatch(/descriptor from \/|descriptor from [A-Za-z]:\\/);
  });

  it('no-target git diff gate validates manifest entries including untracked files', () => {
    const result = generate({
      spec: spec({
        description: 'Implement a code change without explicit target files.',
        targetFiles: [],
      }),
      artifactPath: 'workflows/generated/no-target-git-diff.ts',
    });

    expect(result.success).toBe(true);
    const artifact = result.artifact!;
    const gitDiffGate = artifact.gates.find((g) => g.name === 'git-diff-gate')!;

    expect(gitDiffGate.command).toContain('output-manifest.txt');
    expect(gitDiffGate.command).toContain("'diff', '--name-status'");
    expect(gitDiffGate.command).toContain("'ls-files', '--others', '--exclude-standard'");
    expect(gitDiffGate.command).toContain('missing expected diff entry');
    expect(gitDiffGate.command).toContain('unexpected changed paths');
  });

  it('no-target active reference gate skips missing tracked paths before reading files', () => {
    const result = generate({
      spec: spec({
        description: 'Remove an unused file without explicit target files.',
        targetFiles: [],
      }),
      artifactPath: 'workflows/generated/no-target-active-reference.ts',
    });

    expect(result.success).toBe(true);
    const artifact = result.artifact!;
    const activeReferenceGate = artifact.gates.find((g) => g.name === 'active-reference-gate')!;

    expect(activeReferenceGate.command).toContain('fs.existsSync(file)');
    expect(activeReferenceGate.command).toContain('fs.statSync(file).isFile()');
    expect(activeReferenceGate.command).toContain('active references remain');
  });

  it('explicit target git diff gate includes untracked files for newly created outputs', () => {
    const result = generate({
      spec: spec({
        description: 'Implement a new generated artifact file.',
        targetFiles: ['src/product/generation/new-file.ts'],
      }),
      artifactPath: 'workflows/generated/explicit-target-git-diff.ts',
    });

    expect(result.success).toBe(true);
    const artifact = result.artifact!;
    const gitDiffGate = artifact.gates.find((g) => g.name === 'git-diff-gate')!;

    expect(gitDiffGate.command).toContain('git diff --name-only');
    expect(gitDiffGate.command).toContain('git ls-files --others --exclude-standard');
    expect(gitDiffGate.command).toContain('src/product/generation/new-file.ts');
    expect(gitDiffGate.command).toContain('sort -u');
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

  it('enforces executable acceptance gates in post-fix and final-hard validation stages', () => {
    const result = generate({
      spec: spec({
        description: 'Implement version gate enforcement across all validation stages.',
        targetFiles: ['src/product/generation/template-renderer.ts'],
        acceptanceGates: [
          "version gate: `node dist/bin/ricky.js --version | grep -Eq '^ricky [0-9]+\\.[0-9]+\\.[0-9]+$'`",
        ],
      }),
      artifactPath: 'workflows/generated/acceptance-enforcement.ts',
    });

    expect(result.success).toBe(true);
    const artifact = result.artifact!;
    const versionCommand = "node dist/bin/ricky.js --version | grep -Eq '^ricky [0-9]+\\.[0-9]+\\.[0-9]+$'";

    const initialValidation = gate(artifact, 'initial-soft-validation');
    const postFixValidation = gate(artifact, 'post-fix-validation');
    const finalHardValidation = gate(artifact, 'final-hard-validation');

    expect(initialValidation.command).toContain(versionCommand);
    expect(postFixValidation.command).toContain(versionCommand);
    expect(finalHardValidation.command).toContain(versionCommand);

    expect(initialValidation.failOnError).toBe(false);
    expect(postFixValidation.failOnError).toBe(false);
    expect(finalHardValidation.failOnError).toBe(true);
  });

  it('excludes prose-only acceptance gates from post-fix and final-hard validation', () => {
    const result = generate({
      spec: spec({
        description: 'Implement a workflow with prose-only acceptance gates.',
        targetFiles: ['src/product/generation/template-renderer.ts'],
        acceptanceGates: ['Reviewer must confirm the output is production-ready.'],
      }),
      artifactPath: 'workflows/generated/prose-only-gate.ts',
    });

    expect(result.success).toBe(true);
    const artifact = result.artifact!;

    const initialValidation = gate(artifact, 'initial-soft-validation');
    const postFixValidation = gate(artifact, 'post-fix-validation');
    const finalHardValidation = gate(artifact, 'final-hard-validation');

    expect(initialValidation.command).toContain('Manual acceptance gate:');
    expect(postFixValidation.command).not.toContain('Manual acceptance gate:');
    expect(finalHardValidation.command).not.toContain('Manual acceptance gate:');
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
    expect(result.patternDecision.specSignals).toContain('choosing-swarm-patterns skill loaded');
    expect(result.patternDecision.reason).toMatch(/choosing-swarm-patterns/i);
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

  it('dry-run planned check exposes environmental prerequisite for agent-relay binary', () => {
    const result = generate({
      spec: spec({
        description: 'Implement workflow with dry-run prerequisite.',
        targetFiles: ['src/product/generation/pipeline.ts'],
      }),
      artifactPath: 'workflows/generated/dry-run-prereq.ts',
    });

    expect(result.success).toBe(true);
    const dryRunCheck = result.plannedChecks.find((c) => c.name === 'dry-run');
    expect(dryRunCheck).toBeDefined();
    expect(dryRunCheck!.environmentalPrerequisite).toBeDefined();
    expect(dryRunCheck!.environmentalPrerequisite).toContain('@agent-relay/cli');
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

    const slug = 'scoped-paths';
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
