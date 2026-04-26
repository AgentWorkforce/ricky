import { describe, expect, it } from 'vitest';

import type { CommandResult, StructuralCheckName, ValidatorResult } from './types.js';
import { validateWorkflow } from './validator.js';

const VALIDATED_AT = '2026-04-26T00:00:00.000Z';

describe('validateWorkflow', () => {
  it('approves a complete generated workflow when structural checks and proof-loop evidence pass', () => {
    const workflowText = completeWorkflowText();

    const result = validate(workflowText, {
      dryRunResult: passed('npx agent-relay run --dry-run workflows/generated/validator-specialist.ts'),
      finalDryRunResult: passed('npx tsc --noEmit && npx vitest run src/product/specialists/validator/validator.test.ts'),
      buildResult: passed('npx tsc --noEmit'),
      testResult: passed('npx vitest run src/product/specialists/validator/validator.test.ts'),
      regressionResults: [passed('npx vitest run')],
    });

    expect(result).toMatchObject({
      signoff: 'approved',
      ready: true,
      allStructuralChecksPassed: true,
      allProofLoopStepsPassed: true,
      blockingFindings: [],
      warningFindings: [],
    });
    expect(result.proofLoopSteps.map((step) => [step.phase, step.passed, step.blocking])).toEqual([
      ['initial_soft_run', true, false],
      ['fix_loop', true, false],
      ['final_gate', true, false],
      ['build_typecheck_gate', true, false],
      ['regression_gate', true, false],
    ]);
  });

  it('rejects signoff when the workflow has no review stage', () => {
    const result = validate(completeWorkflowText().replaceAll(/review/gi, 'assessment'));

    expect(result).toMatchObject({ signoff: 'rejected', ready: false });
    expectBlockingFinding(result, 'review_stage', /reviewer stages/i);
  });

  it('rejects signoff when deterministic gate semantics are missing', () => {
    const withoutGateSemantics = completeWorkflowText()
      .replaceAll(/verification\s*:/g, 'evidence:')
      .replaceAll(/failOnError\s*:\s*(true|false)/g, 'continueOnError: false')
      .replaceAll(/type\s*:\s*['"`](deterministic|file_exists|exit_code|output_contains)['"`]/g, "kind: 'automated'");

    const result = validate(withoutGateSemantics);

    expect(result).toMatchObject({ signoff: 'rejected', ready: false });
    expectBlockingFinding(result, 'deterministic_gates', /explicit pass\/fail semantics/i);
  });

  it('rejects 80-to-100 signoff when the initial failOnError false soft gate is missing', () => {
    const withoutSoftGate = completeWorkflowText()
      .replaceAll('initial-soft-validation', 'pre-review-validation')
      .replaceAll('initial validation output', 'preliminary validation output')
      .replaceAll('dry-run', 'preview')
      .replaceAll(/failOnError:\s*false/g, 'failOnError: true');

    const result = validate(withoutSoftGate);

    expect(result).toMatchObject({ signoff: 'rejected', ready: false });
    expectBlockingFinding(result, 'initial_soft_gate', /initial failOnError: false soft gate/i);
  });

  it('reports a failed dry-run command as blocking proof-loop evidence', () => {
    const dryRunFailure = failed(
      'npx agent-relay run --dry-run workflows/generated/validator-specialist.ts',
      'Workflow dry-run failed: missing final signoff dependency.',
    );
    const result = validate(completeWorkflowText(), {
      dryRunResult: dryRunFailure,
      finalDryRunResult: dryRunFailure,
      buildResult: passed('npx tsc --noEmit'),
      testResult: passed('npx vitest run src/product/specialists/validator/validator.test.ts'),
      regressionResults: [passed('npx vitest run')],
    });

    expect(result).toMatchObject({ signoff: 'rejected', ready: false, allProofLoopStepsPassed: false });
    expect(result.proofLoopSteps).toContainEqual(
      expect.objectContaining({
        phase: 'final_gate',
        passed: false,
        blocking: true,
        severity: 'error',
        commandResult: expect.objectContaining({
          command: dryRunFailure.command,
          stderr: expect.stringContaining('missing final signoff dependency'),
        }),
        message: 'Final hard gate failed.',
        fixHint: expect.stringContaining('Fix final hard-gate failures'),
      }),
    );
  });

  it('keeps verdict not ready when the regression gate fails', () => {
    const result = validate(completeWorkflowText(), {
      regressionResults: [failed('npx vitest run', '1 failed test')],
    });

    expect(result).toMatchObject({ signoff: 'rejected', ready: false, allProofLoopStepsPassed: false });
    expect(result.proofLoopSteps).toContainEqual(
      expect.objectContaining({
        phase: 'regression_gate',
        passed: false,
        blocking: true,
        severity: 'error',
        commandResult: expect.objectContaining({ command: 'npx vitest run', exitCode: 1 }),
        message: 'Regression gate failed: npx vitest run.',
      }),
    );
  });

  it('blocks stale pre-fix review verdicts after the fix loop instead of final re-review evidence', () => {
    const staleReviewGate = completeWorkflowText()
      .replaceAll(/\.step\('final-review-(claude|codex)'[\s\S]*?Write [^\n]+final-review-(claude|codex)\.md ending with FINAL_REVIEW_(CLAUDE|CODEX)_PASS\.`\),\n\s+verification: \{ type: 'file_exists', value: '[^']+' \},\n\s+\}\)/g, '')
      .replaceAll('FINAL_REVIEW_CLAUDE_PASS', 'REVIEW_CLAUDE_PASS')
      .replaceAll('FINAL_REVIEW_CODEX_PASS', 'REVIEW_CODEX_PASS')
      .replaceAll('final-review-claude.md', 'review-claude.md')
      .replaceAll('final-review-codex.md', 'review-codex.md');

    const result = validate(staleReviewGate);

    expect(result).toMatchObject({ signoff: 'rejected', ready: false });
    expectBlockingFinding(result, 'stale_prefix_review_gate', /reuse pre-fix review verdicts/i);
  });

  it('rejects when finalDryRunResult is missing and requireDryRun is true', () => {
    const result = validate(completeWorkflowText(), {
      dryRunResult: passed('npx agent-relay run --dry-run workflows/generated/validator-specialist.ts'),
      finalDryRunResult: undefined,
    });

    expect(result).toMatchObject({ signoff: 'rejected', ready: false, allProofLoopStepsPassed: false });
    expect(result.proofLoopSteps).toContainEqual(
      expect.objectContaining({
        phase: 'final_gate',
        passed: false,
        blocking: true,
        severity: 'error',
        message: expect.stringContaining('distinct post-fix evidence'),
      }),
    );
  });

  it('rejects fix-loop when soft run failed but zero fix attempts were made', () => {
    const failedSoftRun = failed(
      'npx agent-relay run --dry-run workflows/generated/validator-specialist.ts',
      'Validation found issues.',
    );
    const result = validate(completeWorkflowText(), {
      dryRunResult: failedSoftRun,
      finalDryRunResult: passed('npx tsc --noEmit && npx vitest run src/product/specialists/validator/validator.test.ts'),
      fixAttempts: 0,
    });

    expect(result).toMatchObject({ signoff: 'rejected', ready: false, allProofLoopStepsPassed: false });
    expect(result.proofLoopSteps).toContainEqual(
      expect.objectContaining({
        phase: 'fix_loop',
        passed: false,
        blocking: true,
        severity: 'error',
        message: expect.stringContaining('no fix attempts were made'),
      }),
    );
  });

  it('rejects regression gate structural check when shell logic is not fail-closed', () => {
    const openGateWorkflow = completeWorkflowText().replace(
      'if printf "%s\\n" "$changed" | grep -Ev',
      'printf "%s\\n" "$changed" | grep -Ev',
    );
    const result = validate(openGateWorkflow);

    expect(result).toMatchObject({ signoff: 'rejected', ready: false });
    expectBlockingFinding(result, 'regression_gate', /fail-closed shell logic/i);
  });

  it('includes proof-loop warnings in the summary warning count', () => {
    const failedSoftRun = failed(
      'npx agent-relay run --dry-run workflows/generated/validator-specialist.ts',
      'Validation found issues.',
    );
    const result = validate(completeWorkflowText(), {
      dryRunResult: failedSoftRun,
      finalDryRunResult: passed('npx tsc --noEmit && npx vitest run src/product/specialists/validator/validator.test.ts'),
      fixAttempts: 1,
    });

    // The initial_soft_run step passes but with severity 'warning' when exitCode !== 0
    // The fix_loop step also has severity 'warning' when modeling from failures
    expect(result.warningProofSteps.length).toBeGreaterThan(0);
    expect(result.warningProofSteps.some((s) => s.phase === 'initial_soft_run')).toBe(true);
    expect(result.summary).toMatch(/warning/i);
  });

  it('flags over-broad regression allowlists outside declared file targets as a warning', () => {
    const result = validate(overBroadRegressionAllowlistWorkflow());

    expect(result).toMatchObject({
      signoff: 'conditional',
      ready: false,
      allStructuralChecksPassed: true,
      allProofLoopStepsPassed: true,
    });
    expect(result.warningFindings).toContainEqual(
      expect.objectContaining({
        check: 'regression_allowlist_scope',
        passed: false,
        severity: 'warning',
        blocking: false,
        message: expect.stringContaining('src/product/generation'),
        fixHint: expect.stringContaining('Restrict regression allowlists'),
      }),
    );
  });
});

function validate(
  workflowText: string,
  overrides: Partial<Parameters<typeof validateWorkflow>[0]> = {},
): ValidatorResult {
  return validateWorkflow({
    workflowText,
    workflowId: 'ricky-validator-specialist',
    workflowName: 'validator specialist workflow',
    workflowPath: 'workflows/generated/validator-specialist.ts',
    dryRunResult: passed('npx agent-relay run --dry-run workflows/generated/validator-specialist.ts'),
    finalDryRunResult: passed('npx tsc --noEmit && npx vitest run src/product/specialists/validator/validator.test.ts'),
    buildResult: passed('npx tsc --noEmit'),
    testResult: passed('npx vitest run src/product/specialists/validator/validator.test.ts'),
    regressionResults: [passed('npx vitest run')],
    fixAttempts: 1,
    validatedAt: VALIDATED_AT,
    ...overrides,
  });
}

function expectBlockingFinding(result: ValidatorResult, check: StructuralCheckName, message: RegExp): void {
  expect(result.blockingFindings).toContainEqual(
    expect.objectContaining({
      check,
      passed: false,
      severity: 'error',
      blocking: true,
      message: expect.stringMatching(message),
      fixHint: expect.any(String),
    }),
  );
}

function completeWorkflowText(): string {
  return `import { workflow } from '@agent-relay/sdk/workflows';

async function main() {
  await workflow('ricky-validator-specialist')
    .channel('wf-ricky-validator-specialist')
    .pattern('dag')
    .maxConcurrency(4)
    .timeout(3600000)
    .agent('lead-claude', { role: 'Plans validator specialist work.' })
    .agent('reviewer-claude', { role: 'Reviews scope and evidence.' })
    .agent('reviewer-codex', { role: 'Reviews deterministic checks.' })
    .agent('validator-claude', { role: 'Runs bounded fixes and signoff.' })
    .step('initial-soft-validation', {
      type: 'deterministic',
      command: 'npx agent-relay run --dry-run workflows/generated/validator-specialist.ts',
      captureOutput: true,
      failOnError: false,
    })
    .step('lead-plan', {
      agent: 'lead-claude',
      dependsOn: ['initial-soft-validation'],
      task: \`Plan validator specialist implementation.

Own only:
- src/product/specialists/validator/validator.test.ts

Deliverables:
- src/product/specialists/validator/validator.test.ts

Non-goals:
- Do not execute agent-relay or shell commands from tests.

Verification commands:
- npx vitest run src/product/specialists/validator/validator.test.ts
\`,
      verification: { type: 'file_exists', value: '.workflow-artifacts/validator/lead-plan.md' },
    })
    .step('review-claude', {
      agent: 'reviewer-claude',
      dependsOn: ['lead-plan'],
      task: 'Review generated work against declared targets, non-goals, deterministic gates, and evidence quality.',
      verification: { type: 'file_exists', value: '.workflow-artifacts/validator/review-claude.md' },
    })
    .step('review-codex', {
      agent: 'reviewer-codex',
      dependsOn: ['lead-plan'],
      task: 'Review generated work for TypeScript correctness, deterministic gates, and tests.',
      verification: { type: 'file_exists', value: '.workflow-artifacts/validator/review-codex.md' },
    })
    .step('read-review-feedback', {
      type: 'deterministic',
      dependsOn: ['review-claude', 'review-codex'],
      command: 'test -f .workflow-artifacts/validator/review-claude.md && test -f .workflow-artifacts/validator/review-codex.md',
      captureOutput: true,
      failOnError: true,
    })
    .step('fix-loop', {
      agent: 'validator-claude',
      dependsOn: ['read-review-feedback'],
      task: 'Run the 80-to-100 fix-loop from initial validation output. Apply bounded fixes only to declared targets.',
    })
    .step('post-fix-validation', {
      type: 'deterministic',
      dependsOn: ['fix-loop'],
      command: 'npx tsc --noEmit && npx vitest run src/product/specialists/validator/validator.test.ts',
      captureOutput: true,
      failOnError: true,
    })
    .step('final-review-claude', {
      agent: 'reviewer-claude',
      dependsOn: ['post-fix-validation'],
      task: 'Re-review the fixed state only. Write .workflow-artifacts/validator/final-review-claude.md ending with FINAL_REVIEW_CLAUDE_PASS.',
      verification: { type: 'file_exists', value: '.workflow-artifacts/validator/final-review-claude.md' },
    })
    .step('final-review-codex', {
      agent: 'reviewer-codex',
      dependsOn: ['post-fix-validation'],
      task: 'Re-review the fixed state only. Write .workflow-artifacts/validator/final-review-codex.md ending with FINAL_REVIEW_CODEX_PASS.',
      verification: { type: 'file_exists', value: '.workflow-artifacts/validator/final-review-codex.md' },
    })
    .step('final-review-pass-gate', {
      type: 'deterministic',
      dependsOn: ['final-review-claude', 'final-review-codex'],
      command: "tail -n 1 .workflow-artifacts/validator/final-review-claude.md | grep -Eq '^FINAL_REVIEW_CLAUDE_PASS$' && tail -n 1 .workflow-artifacts/validator/final-review-codex.md | grep -Eq '^FINAL_REVIEW_CODEX_PASS$'",
      captureOutput: true,
      failOnError: true,
    })
    .step('final-hard-validation', {
      type: 'deterministic',
      dependsOn: ['final-review-pass-gate'],
      command: 'npx tsc --noEmit && npx vitest run src/product/specialists/validator/validator.test.ts',
      captureOutput: true,
      failOnError: true,
    })
    .step('regression-gate', {
      type: 'deterministic',
      dependsOn: ['final-hard-validation'],
      command: "changed=\"$(git diff --name-only; git ls-files --others --exclude-standard)\"; if printf \"%s\\n\" \"$changed\" | grep -Ev '^(src/product/specialists/validator/validator.test.ts|.workflow-artifacts/.*)$'; then exit 1; fi",
      captureOutput: true,
      failOnError: true,
    })
    .step('final-signoff', {
      agent: 'validator-claude',
      dependsOn: ['regression-gate'],
      task: 'Write .workflow-artifacts/validator/signoff.md with deterministic validation commands, review verdicts, and remaining risks. End with GENERATED_WORKFLOW_READY.',
      verification: { type: 'file_exists', value: '.workflow-artifacts/validator/signoff.md' },
    })
    .run({ cwd: process.cwd() });
}

main();`;
}

function overBroadRegressionAllowlistWorkflow(): string {
  return completeWorkflowText().replace(
    "'^(src/product/specialists/validator/validator.test.ts|.workflow-artifacts/.*)$'",
    "'^(src/product/specialists/validator/validator.test.ts|.workflow-artifacts/.*|src/product/generation/.*)$'",
  );
}

function passed(command: string): CommandResult {
  return {
    command,
    exitCode: 0,
    stdout: 'ok',
    durationMs: 25,
  };
}

function failed(command: string, stderr: string): CommandResult {
  return {
    command,
    exitCode: 1,
    stdout: '',
    stderr,
    durationMs: 25,
  };
}
