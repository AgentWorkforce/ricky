import { describe, expect, it, vi } from 'vitest';

import { generate, validateGeneratedArtifact } from '../src/product/generation/pipeline.js';
import type { NormalizedWorkflowSpec, RawSpecPayload } from '../src/product/spec-intake/types.js';
import { repairWorkflowDeterministically, runWithAutoFix } from '../src/local/auto-fix-loop.js';
import type { LocalClassifiedBlocker, LocalResponse } from '../src/local/entrypoint.js';
import type { LocalInvocationRequest } from '../src/local/request-normalizer.js';
import type { FailureClassification } from '../src/runtime/failure/types.js';
import type { DebuggerResult } from '../src/product/specialists/debugger/types.js';
import type { WorkflowRunEvidence } from '../src/shared/models/workflow-evidence.js';

const RECEIVED_AT = '2026-05-08T00:00:00.000Z';

describe('generated workflow reliability contract', () => {
  it.each([
    {
      name: 'pipeline',
      input: {
        spec: spec({
          description: 'Update a README workflow with deterministic review and validation.',
          targetFiles: ['README.md'],
        }),
        artifactPath: 'workflows/generated/reliability-pipeline.ts',
      },
    },
    {
      name: 'dag',
      input: {
        spec: spec({
          description: 'Implement workflow reliability validation across SDK generation code and tests.',
          targetFiles: ['src/product/generation/pipeline.ts', 'src/product/generation/pipeline.test.ts'],
          acceptanceGates: ['npx tsc --noEmit', 'npx vitest run src/product/generation/pipeline.test.ts'],
        }),
        artifactPath: 'workflows/generated/reliability-dag.ts',
      },
    },
    {
      name: 'supervisor override',
      input: {
        spec: spec({
          description: 'Review independent docs, CLI, and tests slices with parallel validation.',
          targetFiles: ['README.md', 'src/local/entrypoint.ts', 'src/local/entrypoint.test.ts'],
        }),
        artifactPath: 'workflows/generated/reliability-supervisor.ts',
        patternOverride: 'supervisor' as const,
      },
    },
  ])('renders $name workflows with repair-aware retry and repair evidence', ({ input }) => {
    const result = generate(input);

    expect(result.success, result.validation.errors.join('\n')).toBe(true);
    expect(result.artifact).not.toBeNull();
    const content = result.artifact!.content;

    expect(content).toContain(".onError('retry',");
    expect(content).toContain('repairAgent:');
    expect(content).toContain('repairRetries:');
    expect(content).not.toMatch(/^\s*\.onError\(\s*['"]fail-fast['"]/m);
    expect(content).toContain('.run({ cwd: process.cwd() });');
    expect(content).toMatch(/80-to-100 (?:review-)?fix loop/);
    expect(content).toContain('fix-loop-report.md');
    expect(content).toContain('captureOutput: true');
    expect(result.artifact!.gates.some((gate) => gate.name === 'initial-soft-validation' && gate.failOnError === false)).toBe(true);
    expect(result.artifact!.gates.some((gate) => gate.name === 'post-fix-validation' && gate.failOnError === false)).toBe(true);
    expect(result.artifact!.gates.some((gate) => gate.name === 'final-hard-validation' && gate.failOnError === true)).toBe(true);
  });

  it('renders master and child workflows so child failures repair before the master hard gate', () => {
    const result = generate({
      spec: spec({
        description: 'Implement provider contract status, config, backend, writeback, delete, and connection slices as child workflows.',
        targetFiles: [
          'src/provider/backend.ts',
          'src/provider/config.ts',
          'src/provider/writeback.ts',
          'src/provider/delete.ts',
          'src/provider/connection.ts',
        ],
        constraints: ['Use child workflows and keep sibling validation non-terminal until integrated by the master.'],
      }),
      artifactPath: 'workflows/generated/reliability-master.ts',
    });

    expect(result.success, result.validation.errors.join('\n')).toBe(true);
    const content = result.artifact!.content;
    const unescaped = content.replace(/\\+"/g, '"');

    expect(content).toContain('RICKY_MASTER_EXECUTOR_WORKFLOW');
    expect(content).toContain(".onError('retry', { maxRetries: 2, retryDelayMs: 10000, repairAgent: \"master-lead\", repairRetries: 2 })");
    expect(content).toContain('ricky run');
    expect(content).not.toContain('--no-auto-fix');
    expect(unescaped).toContain(".onError('retry', { maxRetries: 2, retryDelayMs: 10000, repairAgent: \"validator-claude\", repairRetries: 2 })");
    expect(unescaped).toMatch(/\.step\("final-hard-validation"[\s\S]*?failOnError: false,[\s\S]*?\.step\("final-signoff"/);
    expect(content).toMatch(/\.step\("final-hard-validation"[\s\S]*?failOnError: true,[\s\S]*?\.step\("final-signoff"/);
    expect(content).toContain('RICKY_CHILD_WORKFLOW_COMPLETE');
    expect(content).toContain('RICKY_MASTER_FINAL_VALIDATION_READY');
  });

  it('rejects generated artifacts that can still fail fast without a repair agent', () => {
    const implementationSpec = spec({
      description: 'Implement generated workflow repair policy validation.',
      targetFiles: ['src/product/generation/pipeline.ts'],
    });
    const result = generate({
      spec: implementationSpec,
      artifactPath: 'workflows/generated/reliability-policy.ts',
    });
    const artifact = result.artifact!;
    const weakArtifact = {
      ...artifact,
      content: artifact.content.replace(
        ".onError('retry', { maxRetries: 2, retryDelayMs: 10000, repairAgent: \"validator-claude\", repairRetries: 2 })",
        ".onError('retry', { maxRetries: 2, retryDelayMs: 10000 })",
      ),
    };

    const validation = validateGeneratedArtifact(weakArtifact, result.patternDecision, result.skillContext, implementationSpec);

    expect(validation.valid).toBe(false);
    expect(validation.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'REPAIR_AWARE_RETRY_MISSING' }),
    ]));
  });
});

describe('generated workflow reliability incident fixtures', () => {
  it('repairs and resumes the run-update-config-2 master child failure instead of stopping at attempt one', async () => {
    const runSingleAttempt = vi
      .fn()
      .mockResolvedValueOnce(blockerResponse({
        artifactPath: 'workflows/generated/reliability-master.ts',
        artifactContent: legacyMasterWorkflowContent(),
        runId: 'master-run-1',
        failedStep: 'run-update-config-2',
        code: 'INVALID_ARTIFACT',
      }))
      .mockResolvedValueOnce(successResponse('master-run-2'));
    const artifactWriter = vi.fn().mockResolvedValue(undefined);

    const result = await runWithAutoFix(localArtifactRequest(
      'workflows/generated/reliability-master.ts',
      legacyMasterWorkflowContent(),
    ), {
      maxAttempts: 7,
      runSingleAttempt,
      artifactWriter,
      classifyFailure: fakeClassification,
      debugWorkflowRun: guidedDebugger,
    });

    expect(result.ok).toBe(true);
    expect(artifactWriter).toHaveBeenCalledTimes(1);
    const repaired = String(artifactWriter.mock.calls[0][1]);
    expect(repaired).toContain("ricky run 'workflows/generated/child.ts' --foreground");
    expect(repaired).not.toContain('--no-auto-fix');
    expect(repaired).toContain("repairAgent: \"master-lead\"");
    expect(runSingleAttempt.mock.calls[1][0].retry).toMatchObject({
      attempt: 2,
      maxAttempts: 7,
      previousRunId: 'master-run-1',
      retryOfRunId: 'master-run-1',
      startFromStep: 'run-update-config-2',
    });
    expect(result.auto_fix?.attempts[0]).toMatchObject({
      blocker_code: 'INVALID_ARTIFACT',
      failed_step: 'run-update-config-2',
      applied_fix: expect.objectContaining({
        mode: 'deterministic',
        summary: expect.stringContaining('allowed nested child workflows to use Ricky auto-fix'),
      }),
    });
  });

  it('repairs legacy child final validation so parallel siblings do not poison each other', () => {
    const repair = repairWorkflowDeterministically({
      artifactPath: 'workflows/generated/reliability-master-children/06-update-config-2.ts',
      artifactContent: legacyChildWorkflowContent(),
      evidence: sdkRuntimeBlockerEvidence('final-hard-validation'),
    });

    expect(repair).toMatchObject({
      applied: true,
      mode: 'deterministic',
      summary: expect.stringContaining('generated child final validation non-terminal'),
    });
    expect(repair?.content).toContain('.step("final-hard-validation"');
    expect(repair?.content).toContain('failOnError: false');
  });

  it('retries when Workforce persona repair returns malformed output instead of failing immediately', async () => {
    const runSingleAttempt = vi
      .fn()
      .mockResolvedValueOnce(blockerResponse({
        artifactPath: 'workflows/generated/reliability-malformed.ts',
        artifactContent: workflowContent(),
        runId: 'malformed-run-1',
        failedStep: 'final-hard-validation',
        code: 'INVALID_ARTIFACT',
      }))
      .mockResolvedValueOnce(successResponse('malformed-run-2'));

    const result = await runWithAutoFix(localArtifactRequest(
      'workflows/generated/reliability-malformed.ts',
      workflowContent(),
    ), {
      maxAttempts: 7,
      runSingleAttempt,
      workflowRepairer: vi.fn().mockRejectedValue(new Error(
        'Workforce persona response must be structured JSON or include fenced TypeScript artifact and JSON metadata blocks.',
      )),
      classifyFailure: fakeClassification,
      debugWorkflowRun: guidedDebugger,
    });

    expect(result.ok).toBe(true);
    expect(runSingleAttempt).toHaveBeenCalledTimes(2);
    expect(result.auto_fix?.attempts[0]).toMatchObject({
      blocker_code: 'INVALID_ARTIFACT',
      failed_step: 'final-hard-validation',
      fix_error: expect.stringContaining('Workforce persona response must be structured JSON'),
      warning: expect.stringContaining('retrying without an artifact rewrite'),
    });
    expect(runSingleAttempt.mock.calls[1][0].retry).toMatchObject({
      previousRunId: 'malformed-run-1',
      retryOfRunId: 'malformed-run-1',
      startFromStep: 'final-hard-validation',
    });
  });
});

function localArtifactRequest(artifactPath: string, artifactContent: string): LocalInvocationRequest {
  return {
    _normalized: true,
    source: 'workflow-artifact',
    spec: artifactContent,
    specPath: artifactPath,
    mode: 'local',
    stageMode: 'run',
    invocationRoot: '/repo',
    metadata: {},
  };
}

function successResponse(runId: string): LocalResponse {
  return {
    ok: true,
    artifacts: [{ path: 'workflows/generated/foo.ts', content: workflowContent() }],
    logs: [],
    warnings: [],
    nextActions: [],
    generation: {
      stage: 'generate',
      status: 'ok',
      artifact: { path: 'workflows/generated/foo.ts', workflow_id: 'wf-1', spec_digest: 'abc' },
    },
    execution: {
      stage: 'execute',
      status: 'success',
      execution: execution(runId, 'workflows/generated/foo.ts'),
    },
    exitCode: 0,
  };
}

function blockerResponse(input: {
  artifactPath: string;
  artifactContent: string;
  runId: string;
  failedStep: string;
  code: LocalClassifiedBlocker['code'];
}): LocalResponse {
  const blocker: LocalClassifiedBlocker = {
    code: input.code,
    category: 'workflow_invalid',
    message: `${input.code} at ${input.failedStep}`,
    detected_at: '2026-05-08T00:00:00.000Z',
    detected_during: 'launch',
    recovery: {
      actionable: true,
      steps: ['Inspect the captured workflow logs.'],
    },
    context: { missing: [], found: [] },
  };

  return {
    ok: false,
    artifacts: [{ path: input.artifactPath, content: input.artifactContent }],
    logs: [],
    warnings: [blocker.message],
    nextActions: [...blocker.recovery.steps],
    generation: {
      stage: 'generate',
      status: 'ok',
      artifact: { path: input.artifactPath, workflow_id: 'wf-1', spec_digest: 'abc' },
    },
    execution: {
      stage: 'execute',
      status: 'blocker',
      execution: execution(input.runId, input.artifactPath),
      blocker,
      evidence: {
        outcome_summary: blocker.message,
        failed_step: { id: input.failedStep, name: input.failedStep },
        exit_code: 2,
        logs: {
          tail: [
            `Generation: ok - ${input.artifactPath}`,
            `Execution: blocked - ${input.code} at ${input.failedStep}`,
            `✗ ${input.failedStep} - FAILED: Command failed with exit code 2`,
          ],
          truncated: false,
        },
        side_effects: { files_written: [], commands_invoked: [] },
        assertions: [{ name: 'runtime_exit_code', status: 'fail', detail: blocker.message }],
      },
    },
    exitCode: 2,
  };
}

function execution(runId: string, artifactPath: string): NonNullable<LocalResponse['execution']>['execution'] {
  return {
    workflow_id: 'wf-1',
    artifact_path: artifactPath,
    command: `@agent-relay/sdk/workflows runScriptWorkflow ${artifactPath}`,
    workflow_file: artifactPath,
    cwd: '/repo',
    started_at: '2026-05-08T00:00:00.000Z',
    finished_at: '2026-05-08T00:00:01.000Z',
    duration_ms: 1000,
    steps_completed: 0,
    steps_total: 1,
    run_id: runId,
  };
}

function fakeClassification(_evidence: WorkflowRunEvidence): FailureClassification {
  return {
    category: 'verification_failure',
    failureClass: 'verification_failure',
    severity: 'medium',
    confidence: 'high',
    nextAction: 'fix_and_retry',
    summary: 'Generated workflow failed a repairable deterministic gate.',
    signals: [],
    secondaryClasses: [],
  };
}

function guidedDebugger(): DebuggerResult {
  const classification = fakeClassification({} as WorkflowRunEvidence);
  const scope = {
    targetStepIds: [],
    filesLikelyTouched: ['workflows/generated/reliability-master.ts'],
    maxFilesToTouch: 1,
    bounded: true,
    rationale: 'Generated workflow artifact repair is bounded to the artifact under test.',
  };

  return {
    repairMode: 'guided',
    summary: 'Repair the generated workflow artifact and resume from the failed step.',
    analyzedAt: '2026-05-08T00:00:00.000Z',
    diagnosis: {
      primaryCause: {
        category: 'workflow_structure',
        summary: 'Generated workflow contract failed.',
        affectedStepIds: [],
        supportingSignals: [],
        confidence: 'high',
        filesLikelyTouched: ['workflows/generated/reliability-master.ts'],
        ambiguousProductIntent: false,
      },
      secondaryCauses: [],
      runtimeClassification: classification,
      explanation: 'Generated workflow artifact needs a bounded repair before retry.',
    },
    recommendation: {
      directRepairEligible: false,
      confidence: 'high',
      scope,
      summary: 'Ask a repair agent to patch the generated workflow artifact.',
      steps: [
        {
          action: 'restructure_workflow',
          description: 'Ask a repair agent to patch the generated workflow artifact.',
          targetStepId: null,
          filesToTouch: ['workflows/generated/reliability-master.ts'],
          scope,
          confidence: 'high',
          verificationPlan: {
            commands: ['ricky run workflows/generated/reliability-master.ts --foreground'],
            expectations: ['Workflow resumes from the failed step and completes.'],
            deterministic: true,
          },
        },
      ],
    },
  };
}

function workflowContent(): string {
  return [
    "import { workflow } from '@agent-relay/sdk/workflows';",
    '',
    'async function main() {',
    '  await workflow("reliability-malformed")',
    '    .onError(\'retry\', { maxRetries: 2, retryDelayMs: 1000, repairAgent: "validator-claude", repairRetries: 2 })',
    '    .run({ cwd: process.cwd() });',
    '}',
  ].join('\n');
}

function legacyMasterWorkflowContent(): string {
  return [
    "import { workflow } from '@agent-relay/sdk/workflows';",
    '',
    '// RICKY_MASTER_EXECUTOR_WORKFLOW',
    'async function main() {',
    '  await workflow("ricky-master")',
    '    .onError(\'fail-fast\')',
    '    .step("run-update-config-2", {',
    '      type: "deterministic",',
    '      command: "set -e\\nricky run \'workflows/generated/child.ts\' --foreground --no-auto-fix\\ntest -f \'.workflow-artifacts/child/signoff.md\'",',
    '      captureOutput: true,',
    '      failOnError: true,',
    '    })',
    '    .run({ cwd: process.cwd() });',
    '}',
  ].join('\n');
}

function legacyChildWorkflowContent(): string {
  return [
    "import { workflow } from '@agent-relay/sdk/workflows';",
    '',
    'async function main() {',
    '  await workflow("ricky-child-update-config-2")',
    '    .step("final-hard-validation", {',
    '      type: "deterministic",',
    '      dependsOn: ["fix-loop"],',
    '      command: "set -e\\nnpm run typecheck\\ngit diff --name-only",',
    '      captureOutput: true,',
    '      failOnError: true,',
    '    })',
    '    .step("final-signoff", {',
    '      type: "deterministic",',
    '      dependsOn: ["final-hard-validation"],',
    '      command: "echo RICKY_CHILD_WORKFLOW_COMPLETE",',
    '      captureOutput: true,',
    '      failOnError: true,',
    '    })',
    '    .run({ cwd: process.cwd() });',
    '}',
  ].join('\n');
}

function sdkRuntimeBlockerEvidence(failedStep: string): WorkflowRunEvidence {
  return {
    runId: 'run-1',
    workflowId: 'wf-1',
    workflowName: 'ricky-master',
    status: 'failed',
    startedAt: '2026-05-08T00:00:00.000Z',
    completedAt: '2026-05-08T00:00:01.000Z',
    steps: [
      {
        stepId: failedStep,
        stepName: failedStep,
        status: 'failed',
        startedAt: '2026-05-08T00:00:00.000Z',
        completedAt: '2026-05-08T00:00:01.000Z',
        error: `Step "${failedStep}" failed: Command failed with exit code 2`,
        verifications: [],
        deterministicGates: [],
        logs: [{ stream: 'stdout', excerpt: `INVALID_ARTIFACT at ${failedStep}` }],
        artifacts: [],
        retries: [],
        narrative: [],
        history: [],
      },
    ],
    deterministicGates: [],
    logs: [{ stream: 'stdout', excerpt: `INVALID_ARTIFACT at ${failedStep}` }],
    artifacts: [],
    narrative: [],
    routing: [],
  };
}

interface SpecFixtureOverrides {
  description?: string;
  targetContext?: string;
  targetFiles?: string[];
  constraints?: string[];
  evidenceRequirements?: string[];
  acceptanceGates?: string[];
  executionPreference?: NormalizedWorkflowSpec['executionPreference'];
}

function spec(overrides: SpecFixtureOverrides = {}): NormalizedWorkflowSpec {
  const description = overrides.description ?? 'Generate a workflow for deterministic product work.';
  const rawPayload: RawSpecPayload = {
    kind: 'natural_language',
    surface: 'cli',
    receivedAt: RECEIVED_AT,
    requestId: 'generation-reliability-contract-test',
    text: description,
  };
  const providerContext = {
    surface: 'cli' as const,
    requestId: rawPayload.requestId,
    metadata: {},
  };
  const targetContext = overrides.targetContext ?? null;
  const targetFiles = overrides.targetFiles ?? [];
  const constraints = overrides.constraints ?? [];
  const evidenceRequirements = overrides.evidenceRequirements ?? [];
  const acceptanceGates = overrides.acceptanceGates ?? [];

  return {
    intent: 'generate',
    description,
    targetRepo: null,
    targetContext,
    targetFiles,
    desiredAction: {
      kind: 'generate',
      summary: description,
      specText: description,
      targetFiles,
    },
    constraints: constraints.map((constraint) => ({
      constraint,
      category: /\b(only|must|non[- ]?goal|out[- ]of[- ]scope)\b/i.test(constraint) ? 'scope' : 'quality',
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
      targetContext: targetContext ?? undefined,
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
