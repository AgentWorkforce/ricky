import { workflow } from '@agent-relay/sdk/workflows';

async function main() {
  const result = await workflow('ricky-wave1-local-run-coordinator')
    .description('Implement the Wave 1 local run coordinator that wraps agent-relay invocation, captures run state, and exposes a programmatic launch/monitor/report interface.')
    .pattern('dag')
    .channel('wf-ricky-wave1-local-run-coordinator')
    .maxConcurrency(3)
    .timeout(3_600_000)
    .onError('retry', { maxRetries: 1, retryDelayMs: 10_000 })

    .agent('lead-claude', {
      cli: 'claude',
      role: 'Runtime lead responsible for scope control, product alignment, and final implementation signoff.',
      retries: 1,
    })
    .agent('impl-primary-codex', {
      cli: 'codex',
      role: 'Primary implementer for src/runtime/local-coordinator.ts and src/runtime/types.ts.',
      retries: 2,
    })
    .agent('impl-tests-codex', {
      cli: 'codex',
      role: 'Test implementer for src/runtime/local-coordinator.test.ts and targeted test coverage.',
      retries: 2,
    })
    .agent('reviewer-claude', {
      cli: 'claude',
      preset: 'reviewer',
      role: 'Reviews runtime behavior, workflow abstraction boundaries, and evidence/reporting contracts.',
      retries: 1,
    })
    .agent('reviewer-codex', {
      cli: 'codex',
      preset: 'reviewer',
      role: 'Reviews implementation practicality, TypeScript contracts, tests, and deterministic validation coverage.',
      retries: 1,
    })
    .agent('validator-claude', {
      cli: 'claude',
      preset: 'worker',
      role: 'Runs validation, diagnoses failures, and applies bounded fixes until the coordinator meets the 80-to-100 bar.',
      retries: 2,
    })

    .step('prepare-context', {
      type: 'deterministic',
      command: [
        'mkdir -p .workflow-artifacts/wave1-runtime/local-run-coordinator src/runtime',
        'cat docs/workflows/WORKFLOW_STANDARDS.md > .workflow-artifacts/wave1-runtime/local-run-coordinator/workflow-standards.md',
        'cat workflows/shared/WORKFLOW_AUTHORING_RULES.md > .workflow-artifacts/wave1-runtime/local-run-coordinator/authoring-rules.md',
        'cat workflows/meta/spec/generated-workflow-template.md > .workflow-artifacts/wave1-runtime/local-run-coordinator/generated-template.md',
        'cat .workflow-artifacts/ricky-meta/application-wave-plan.md > .workflow-artifacts/wave1-runtime/local-run-coordinator/application-wave-plan.md',
        'cat SPEC.md > .workflow-artifacts/wave1-runtime/local-run-coordinator/product-spec.md',
        'echo LOCAL_COORDINATOR_CONTEXT_READY',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('lead-plan', {
      agent: 'lead-claude',
      dependsOn: ['prepare-context'],
      task: `Plan the local run coordinator implementation.

Read:
- .workflow-artifacts/wave1-runtime/local-run-coordinator/workflow-standards.md
- .workflow-artifacts/wave1-runtime/local-run-coordinator/authoring-rules.md
- .workflow-artifacts/wave1-runtime/local-run-coordinator/generated-template.md
- .workflow-artifacts/wave1-runtime/local-run-coordinator/application-wave-plan.md
- .workflow-artifacts/wave1-runtime/local-run-coordinator/product-spec.md

Deliverables:
- src/runtime/types.ts defines run request, run status, lifecycle event, command invocation, and coordinator result types.
- src/runtime/local-coordinator.ts exports a coordinator class or function that wraps local agent-relay execution behind Ricky-specific launch, monitor, and report methods.
- src/runtime/local-coordinator.test.ts covers successful launch, non-zero exit, timeout/cancellation, log capture, and state transitions.

Non-goals:
- Do not implement Cloud APIs, spec parsing, generation, debugger logic, or UI behavior.
- Do not require users to hand-author workflows; this runtime receives generated or selected workflow artifacts from Ricky product layers.
- Do not shell out from tests to real long-running agent-relay processes; use injectable command runners.

Verification:
- npx tsc --noEmit
- npx vitest run src/runtime/local-coordinator.test.ts
- grep for exported coordinator surface in src/runtime/local-coordinator.ts
- git diff must be limited to the target runtime files unless a tiny index export is explicitly justified.

Write .workflow-artifacts/wave1-runtime/local-run-coordinator/implementation-plan.md with the contract, interfaces, risks, and exact test cases. End with LOCAL_COORDINATOR_PLAN_READY.`,
      verification: {
        type: 'file_exists',
        value: '.workflow-artifacts/wave1-runtime/local-run-coordinator/implementation-plan.md',
      },
    })

    .step('implement-runtime-surface', {
      agent: 'impl-primary-codex',
      dependsOn: ['lead-plan'],
      task: `Implement the local run coordinator according to .workflow-artifacts/wave1-runtime/local-run-coordinator/implementation-plan.md.

Own only:
- src/runtime/types.ts
- src/runtime/local-coordinator.ts

Requirements:
- Model the coordinator as Ricky's local execution substrate, not a thin prompt wrapper.
- Provide an injectable command runner so tests can simulate agent-relay output, errors, and timeouts.
- Capture run id, workflow path, cwd, started/ended timestamps, status, exit code, stdout/stderr snippets, lifecycle events, and retry metadata.
- Expose a programmatic API suitable for later spec intake, generation, debugger, and local/BYOH entrypoint workflows.
- Keep execution routing abstract enough that later Cloud and local surfaces can call it without knowing shell details.
- Add succinct comments only where lifecycle behavior would otherwise be unclear.

After editing, stop. Do not modify tests in this step.`,
      verification: { type: 'file_exists', value: 'src/runtime/local-coordinator.ts' },
    })

    .step('verify-runtime-surface-after-edit', {
      type: 'deterministic',
      dependsOn: ['implement-runtime-surface'],
      command: [
        'test -f src/runtime/types.ts',
        'test -f src/runtime/local-coordinator.ts',
        'grep -Eq "export .*LocalRun|export .*Coordinator|class .*Coordinator|function .*Coordinator|create.*Coordinator" src/runtime/local-coordinator.ts',
        'grep -Eq "RunStatus|RunResult|RunRequest|Lifecycle|Evidence|Invocation" src/runtime/types.ts',
        'changed="$(git diff --name-only; git ls-files --others --exclude-standard)" && printf "%s\\n" "$changed" | grep -Eq "^src/runtime/(types|local-coordinator)\\.ts"',
        'echo LOCAL_COORDINATOR_RUNTIME_SURFACE_VERIFIED',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('implement-tests', {
      agent: 'impl-tests-codex',
      dependsOn: ['verify-runtime-surface-after-edit'],
      task: `Add focused tests for the local run coordinator.

Own only:
- src/runtime/local-coordinator.test.ts

Required coverage:
- successful workflow launch records running then completed status
- failed command records failed status, exit code, and stderr
- timeout or abort path records timeout/cancelled state without hanging the test suite
- stdout/stderr and lifecycle events are captured in returned evidence
- command runner injection prevents real agent-relay invocation in unit tests

Review checklist:
- Tests assert behavior, not implementation details.
- Tests are deterministic and do not depend on wall-clock sleeps longer than a tiny fake timer or injected clock.
- The API remains suitable for generated workflow execution and later debugger analysis.

Do not broaden scope beyond the coordinator files.`,
      verification: { type: 'file_exists', value: 'src/runtime/local-coordinator.test.ts' },
    })

    .step('verify-tests-after-edit', {
      type: 'deterministic',
      dependsOn: ['implement-tests'],
      command: [
        'test -f src/runtime/local-coordinator.test.ts',
        'grep -Eq "describe|it\\(" src/runtime/local-coordinator.test.ts',
        'grep -Eq "failed|timeout|stderr|stdout|completed|cancel" src/runtime/local-coordinator.test.ts',
        'changed="$(git diff --name-only; git ls-files --others --exclude-standard)" && printf "%s\\n" "$changed" | grep -Eq "^src/runtime/local-coordinator\\.test\\.ts"',
        'echo LOCAL_COORDINATOR_TESTS_VERIFIED',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('initial-soft-validation', {
      type: 'deterministic',
      dependsOn: ['verify-tests-after-edit'],
      command: 'npx tsc --noEmit && npx vitest run src/runtime/local-coordinator.test.ts',
      captureOutput: true,
      failOnError: false,
    })

    .step('review-claude', {
      agent: 'reviewer-claude',
      dependsOn: ['initial-soft-validation'],
      task: `Review the local coordinator implementation.

Read the implementation plan, src/runtime/types.ts, src/runtime/local-coordinator.ts, src/runtime/local-coordinator.test.ts, and initial validation output:
{{steps.initial-soft-validation.output}}

Focus on:
- Ricky product truth: generated workflows and product surfaces call this coordinator; users are not expected to hand-author workflow runs.
- Correct workflow abstraction and execution routing boundaries.
- Whether evidence captured here is sufficient for later debugger and validator specialists.
- Scope control and commit boundary.

Write .workflow-artifacts/wave1-runtime/local-run-coordinator/review-claude.md ending with REVIEW_CLAUDE_PASS or REVIEW_CLAUDE_FAIL.`,
      verification: {
        type: 'file_exists',
        value: '.workflow-artifacts/wave1-runtime/local-run-coordinator/review-claude.md',
      },
    })

    .step('review-codex', {
      agent: 'reviewer-codex',
      dependsOn: ['initial-soft-validation'],
      task: `Review the local coordinator for TypeScript, test, and deterministic validation quality.

Read the target files and initial validation output:
{{steps.initial-soft-validation.output}}

Focus on:
- API clarity and injectable command runner design.
- Missing or brittle tests.
- Type errors, race risks, timeout handling, and weak assertions.
- Whether the implementation can be consumed by future spec-intake, generation, and local entrypoint workflows.

Write .workflow-artifacts/wave1-runtime/local-run-coordinator/review-codex.md ending with REVIEW_CODEX_PASS or REVIEW_CODEX_FAIL.`,
      verification: {
        type: 'file_exists',
        value: '.workflow-artifacts/wave1-runtime/local-run-coordinator/review-codex.md',
      },
    })

    .step('fix-loop', {
      agent: 'validator-claude',
      dependsOn: ['review-claude', 'review-codex'],
      task: `Run the 80-to-100 fix loop for the local run coordinator.

Inputs:
- .workflow-artifacts/wave1-runtime/local-run-coordinator/review-claude.md
- .workflow-artifacts/wave1-runtime/local-run-coordinator/review-codex.md
- Initial validation output:
{{steps.initial-soft-validation.output}}

Rules:
- Fix only concrete review findings and validation failures.
- Stay within src/runtime/types.ts, src/runtime/local-coordinator.ts, and src/runtime/local-coordinator.test.ts unless an index export is strictly necessary and documented.
- Preserve the command runner injection and workflow abstraction boundary.
- Re-run npx tsc --noEmit and npx vitest run src/runtime/local-coordinator.test.ts before declaring the loop complete.

Write .workflow-artifacts/wave1-runtime/local-run-coordinator/fix-loop.md with changes made, commands run, and remaining risks. End with LOCAL_COORDINATOR_FIX_LOOP_COMPLETE.`,
      verification: {
        type: 'file_exists',
        value: '.workflow-artifacts/wave1-runtime/local-run-coordinator/fix-loop.md',
      },
    })

    .step('post-fix-file-gate', {
      type: 'deterministic',
      dependsOn: ['fix-loop'],
      command: [
        'test -f src/runtime/types.ts',
        'test -f src/runtime/local-coordinator.ts',
        'test -f src/runtime/local-coordinator.test.ts',
        'grep -Eq "export .*LocalRun|export .*Coordinator|class .*Coordinator|function .*Coordinator|create.*Coordinator" src/runtime/local-coordinator.ts',
        'grep -Eq "describe|it\\(" src/runtime/local-coordinator.test.ts',
        'echo LOCAL_COORDINATOR_POST_FIX_FILES_PASS',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('post-fix-validation', {
      type: 'deterministic',
      dependsOn: ['post-fix-file-gate'],
      command: 'npx tsc --noEmit && npx vitest run src/runtime/local-coordinator.test.ts',
      captureOutput: true,
      failOnError: false,
    })

    .step('final-review-claude', {
      agent: 'reviewer-claude',
      dependsOn: ['post-fix-validation'],
      task: `Re-review the fixed local coordinator after the fix loop.

Read the implementation, tests, fix-loop artifact, and post-fix validation output:
{{steps.post-fix-validation.output}}

Confirm all previous review findings are either fixed or explicitly non-blocking, and that the coordinator still preserves Ricky's generated-workflow execution boundary.

Write .workflow-artifacts/wave1-runtime/local-run-coordinator/final-review-claude.md ending with FINAL_REVIEW_CLAUDE_PASS or FINAL_REVIEW_CLAUDE_FAIL.`,
      verification: {
        type: 'file_exists',
        value: '.workflow-artifacts/wave1-runtime/local-run-coordinator/final-review-claude.md',
      },
    })

    .step('final-review-codex', {
      agent: 'reviewer-codex',
      dependsOn: ['post-fix-validation'],
      task: `Re-review the fixed local coordinator for TypeScript, tests, and validation quality.

Read the target files, fix-loop artifact, and post-fix validation output:
{{steps.post-fix-validation.output}}

Confirm the implementation is ready for the final hard gates and that no new scope drift was introduced by fixes.

Write .workflow-artifacts/wave1-runtime/local-run-coordinator/final-review-codex.md ending with FINAL_REVIEW_CODEX_PASS or FINAL_REVIEW_CODEX_FAIL.`,
      verification: {
        type: 'file_exists',
        value: '.workflow-artifacts/wave1-runtime/local-run-coordinator/final-review-codex.md',
      },
    })

    .step('final-review-pass-gate', {
      type: 'deterministic',
      dependsOn: ['final-review-claude', 'final-review-codex'],
      command: [
        'tail -n 1 .workflow-artifacts/wave1-runtime/local-run-coordinator/final-review-claude.md | grep -Eq "^FINAL_REVIEW_CLAUDE_PASS$"',
        'tail -n 1 .workflow-artifacts/wave1-runtime/local-run-coordinator/final-review-codex.md | grep -Eq "^FINAL_REVIEW_CODEX_PASS$"',
        'echo LOCAL_COORDINATOR_FINAL_REVIEW_PASS',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('final-hard-gate', {
      type: 'deterministic',
      dependsOn: ['final-review-pass-gate'],
      command: 'npx vitest run src/runtime/local-coordinator.test.ts',
      captureOutput: true,
      failOnError: true,
    })

    .step('build-typecheck-gate', {
      type: 'deterministic',
      dependsOn: ['final-hard-gate'],
      command: 'npx tsc --noEmit',
      captureOutput: true,
      failOnError: true,
    })

    .step('regression-gate', {
      type: 'deterministic',
      dependsOn: ['build-typecheck-gate'],
      command: [
        'npx vitest run',
        'changed="$(git diff --name-only; git ls-files --others --exclude-standard)" && printf "%s\\n" "$changed" | grep -Eq "^(src/runtime/(types|local-coordinator|local-coordinator\\.test)\\.ts|src/runtime/index\\.ts)$"',
        '! printf "%s\\n" "$changed" | grep -Ev "^(src/runtime/(types|local-coordinator|local-coordinator\\.test)\\.ts|src/runtime/index\\.ts|\\.workflow-artifacts/)"',
        'echo LOCAL_COORDINATOR_REGRESSION_PASS',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })
    .step('final-signoff', {
      agent: 'validator-claude',
      dependsOn: ['regression-gate'],
      task: `Write .workflow-artifacts/wave1-runtime/local-run-coordinator/signoff.md.

Include files changed, validation commands run, review verdicts, and remaining risks.
End with LOCAL_COORDINATOR_WORKFLOW_COMPLETE.`,
      verification: { type: 'file_exists', value: '.workflow-artifacts/wave1-runtime/local-run-coordinator/signoff.md' },
    })

    .run({ cwd: process.cwd() });

  console.log(result.status);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
