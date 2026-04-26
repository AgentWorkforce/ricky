import { workflow } from '@agent-relay/sdk/workflows';

async function main() {
  const result = await workflow('ricky-wave5-split-ricky-into-workspace-packages')
    .description(
      'Migrate Ricky from a single-package src layout into a truthful workspace-based packages layout with restored workspace tooling, preserved product behavior, and deterministic review/validation gates.',
    )
    .pattern('dag')
    .channel('wf-ricky-wave5-workspace-package-split')
    .maxConcurrency(4)
    .timeout(21_600_000)
    .onError('retry', { maxRetries: 2, retryDelayMs: 10_000 })

    .agent('lead-claude', {
      cli: 'claude',
      preset: 'worker',
      role: 'Writes the bounded implementation plan for the Ricky workspace package split.',
      retries: 1,
    })
    .agent('impl-primary-codex', {
      cli: 'codex',
      preset: 'worker',
      role: 'Implements the workspace package split in bounded repo-owned files and restores truthful workspace tooling.',
      retries: 2,
    })
    .agent('impl-tests-codex', {
      cli: 'codex',
      preset: 'worker',
      role: 'Repairs or adds the minimum test/config changes needed so the migrated workspace validates truthfully.',
      retries: 2,
    })
    .agent('reviewer-claude', {
      cli: 'claude',
      preset: 'reviewer',
      role: 'Performs semantic review of package boundaries, tooling truth, and product-usage ergonomics.',
      retries: 1,
    })
    .agent('reviewer-codex', {
      cli: 'codex',
      preset: 'reviewer',
      role: 'Performs structural review of workspace configuration, dependency direction, imports, and validation coverage.',
      retries: 1,
    })
    .agent('validator-claude', {
      cli: 'claude',
      preset: 'worker',
      role: 'Consumes review feedback, fixes real issues, reruns validation, and writes the fix-loop artifact.',
      retries: 1,
    })

    .step('prepare-artifacts', {
      type: 'deterministic',
      command: [
        'mkdir -p .workflow-artifacts/wave5-scale-and-ops/workspace-package-split',
        'echo WORKSPACE_PACKAGE_SPLIT_ARTIFACTS_READY',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })
    .step('read-workflow-standards', {
      type: 'deterministic',
      dependsOn: ['prepare-artifacts'],
      command:
        'cat docs/workflows/WORKFLOW_STANDARDS.md && printf "\n\n---\n\n" && cat workflows/shared/WORKFLOW_AUTHORING_RULES.md',
      captureOutput: true,
      failOnError: true,
    })
    .step('read-package-split-spec', {
      type: 'deterministic',
      dependsOn: ['prepare-artifacts'],
      command: 'cat docs/architecture/ricky-package-split-migration-spec.md',
      captureOutput: true,
      failOnError: true,
    })
    .step('read-root-tooling', {
      type: 'deterministic',
      dependsOn: ['prepare-artifacts'],
      command: [
        'printf "===== package.json =====\\n" && cat package.json',
        'printf "\\n\\n===== README.md =====\\n" && cat README.md',
        'printf "\\n\\n===== src tree =====\\n" && find src -maxdepth 3 -type f | sort',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('lead-plan', {
      agent: 'lead-claude',
      dependsOn: ['read-workflow-standards', 'read-package-split-spec', 'read-root-tooling'],
      task: `You are planning a bounded Ricky repo migration.

Write .workflow-artifacts/wave5-scale-and-ops/workspace-package-split/implementation-plan.md.

Your plan must be explicit about:
- target workspace manager / lockfile restoration
- package boundaries for shared/runtime/product/cloud/local/cli
- exact files/directories to create or move
- required root script changes
- tsconfig/test-config migration expectations
- deterministic validation commands
- explicit non-goals

End the file with WORKSPACE_PACKAGE_SPLIT_PLAN_READY.
Do not edit repo code in this step.`,
      verification: {
        type: 'file_exists',
        value: '.workflow-artifacts/wave5-scale-and-ops/workspace-package-split/implementation-plan.md',
      },
    })
    .step('plan-gate', {
      type: 'deterministic',
      dependsOn: ['lead-plan'],
      command: [
        'test -f .workflow-artifacts/wave5-scale-and-ops/workspace-package-split/implementation-plan.md',
        "tail -n 1 .workflow-artifacts/wave5-scale-and-ops/workspace-package-split/implementation-plan.md | grep -Eq '^WORKSPACE_PACKAGE_SPLIT_PLAN_READY$'",
        'echo WORKSPACE_PACKAGE_SPLIT_PLAN_VERIFIED',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('implement-workspace-structure', {
      agent: 'impl-primary-codex',
      dependsOn: ['plan-gate'],
      task: `Implement the Ricky workspace package split described by docs/architecture/ricky-package-split-migration-spec.md and the implementation plan.

Deliverables:
- add workspace config and restore truthful workspace-manager support
- create packages/shared, packages/runtime, packages/product, packages/cloud, packages/local, packages/cli
- move or re-home current src/* code into those packages coherently
- update root package.json and README.md for workspace truth
- repair imports and package manifests
- preserve current product behavior

Required file targets include, at minimum:
- root package/tooling files needed for workspace bootstrapping
- packages/*/package.json
- package source files under packages/*/src
- any required tsconfig/vitest config updates

Non-goals:
- do not add new product features unrelated to packaging
- do not weaken validation or remove proven tests
- do not leave the repo half-single-package / half-workspace

Write files to disk, run the minimum truthful workspace-manager/install step needed for regenerated lock/config state if required, then exit cleanly.`,
      verification: { type: 'exit_code', value: '0' },
    })
    .step('verify-workspace-structure', {
      type: 'deterministic',
      dependsOn: ['implement-workspace-structure'],
      command: [
        'test -d packages/shared',
        'test -d packages/runtime',
        'test -d packages/product',
        'test -d packages/cloud',
        'test -d packages/local',
        'test -d packages/cli',
        'test -f packages/shared/package.json',
        'test -f packages/runtime/package.json',
        'test -f packages/product/package.json',
        'test -f packages/cloud/package.json',
        'test -f packages/local/package.json',
        'test -f packages/cli/package.json',
        'echo WORKSPACE_PACKAGE_LAYOUT_VERIFIED',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })
    .step('implement-tests-and-config', {
      agent: 'impl-tests-codex',
      dependsOn: ['verify-workspace-structure'],
      task: `Audit the migrated Ricky workspace and make the minimum bounded test/config changes required so the workspace validates truthfully.

You may update:
- package-level tests moved with their owned code
- root integration or smoke tests if needed
- tsconfig/vitest/workspace config
- package scripts needed for workspace typecheck/test/start

Do not broaden scope beyond packaging validation and migration proof.
Write files to disk, then exit cleanly.`,
      verification: { type: 'exit_code', value: '0' },
    })
    .step('verify-tests-after-edit', {
      type: 'deterministic',
      dependsOn: ['implement-tests-and-config'],
      command: [
        "grep -Eq 'packages|workspaces|pnpm|prpm' package.json README.md",
        'test -f packages/cli/package.json',
        'echo WORKSPACE_PACKAGE_TEST_PREP_VERIFIED',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })
    .step('initial-soft-validation', {
      type: 'deterministic',
      dependsOn: ['verify-tests-after-edit'],
      command: 'npm run typecheck && npm test',
      captureOutput: true,
      failOnError: false,
    })

    .step('review-claude', {
      agent: 'reviewer-claude',
      dependsOn: ['initial-soft-validation'],
      task: `Review the Ricky workspace package split.

Read:
- docs/architecture/ricky-package-split-migration-spec.md
- .workflow-artifacts/wave5-scale-and-ops/workspace-package-split/implementation-plan.md
- migrated root tooling files
- package manifests and moved source layout

Write .workflow-artifacts/wave5-scale-and-ops/workspace-package-split/review-claude.md.

Review questions:
1. Are package boundaries coherent?
2. Was workspace tooling restored truthfully?
3. Does the root remain convenient for near-term product usage?
4. Were unrelated feature changes avoided?

End the final line with REVIEW_CLAUDE_PASS or REVIEW_CLAUDE_FAIL.`,
      verification: {
        type: 'file_exists',
        value: '.workflow-artifacts/wave5-scale-and-ops/workspace-package-split/review-claude.md',
      },
    })
    .step('review-codex', {
      agent: 'reviewer-codex',
      dependsOn: ['initial-soft-validation'],
      task: `Review the Ricky workspace package split for structural correctness.

Write .workflow-artifacts/wave5-scale-and-ops/workspace-package-split/review-codex.md.

Focus on:
- broken package dependency directions
- leftover single-package assumptions
- missing workspace config or lockfile truth
- import path breakage or hidden old src/* assumptions
- missing validation coverage for package shape

End the final line with REVIEW_CODEX_PASS or REVIEW_CODEX_FAIL.`,
      verification: {
        type: 'file_exists',
        value: '.workflow-artifacts/wave5-scale-and-ops/workspace-package-split/review-codex.md',
      },
    })
    .step('read-review-feedback', {
      type: 'deterministic',
      dependsOn: ['review-claude', 'review-codex'],
      command:
        'cat .workflow-artifacts/wave5-scale-and-ops/workspace-package-split/review-claude.md .workflow-artifacts/wave5-scale-and-ops/workspace-package-split/review-codex.md',
      captureOutput: true,
      failOnError: true,
    })
    .step('fix-loop', {
      agent: 'validator-claude',
      dependsOn: ['read-review-feedback'],
      task: `Read:
- .workflow-artifacts/wave5-scale-and-ops/workspace-package-split/review-claude.md
- .workflow-artifacts/wave5-scale-and-ops/workspace-package-split/review-codex.md
- current validation output

If either review failed or validation exposed real issues, fix them in the repo.
Then rerun the necessary validation commands.
Write .workflow-artifacts/wave5-scale-and-ops/workspace-package-split/fix-loop.md ending with WORKSPACE_PACKAGE_SPLIT_FIX_LOOP_COMPLETE.
If no fixes are needed, say so explicitly and still write the artifact.`,
      verification: {
        type: 'file_exists',
        value: '.workflow-artifacts/wave5-scale-and-ops/workspace-package-split/fix-loop.md',
      },
    })
    .step('post-fix-validation', {
      type: 'deterministic',
      dependsOn: ['fix-loop'],
      command: 'npm run typecheck && npm test',
      captureOutput: true,
      failOnError: true,
    })

    .step('final-review-claude', {
      agent: 'reviewer-claude',
      dependsOn: ['post-fix-validation'],
      task: `Re-review the final migrated workspace state.
Write .workflow-artifacts/wave5-scale-and-ops/workspace-package-split/final-review-claude.md.
End the final line with FINAL_REVIEW_CLAUDE_PASS or FINAL_REVIEW_CLAUDE_FAIL.`,
      verification: {
        type: 'file_exists',
        value: '.workflow-artifacts/wave5-scale-and-ops/workspace-package-split/final-review-claude.md',
      },
    })
    .step('final-review-codex', {
      agent: 'reviewer-codex',
      dependsOn: ['post-fix-validation'],
      task: `Re-review the final migrated workspace state for structural/package correctness.
Write .workflow-artifacts/wave5-scale-and-ops/workspace-package-split/final-review-codex.md.
End the final line with FINAL_REVIEW_CODEX_PASS or FINAL_REVIEW_CODEX_FAIL.`,
      verification: {
        type: 'file_exists',
        value: '.workflow-artifacts/wave5-scale-and-ops/workspace-package-split/final-review-codex.md',
      },
    })
    .step('final-review-pass-gate', {
      type: 'deterministic',
      dependsOn: ['final-review-claude', 'final-review-codex'],
      command: [
        "grep -Eq 'FINAL_REVIEW_CLAUDE_PASS$' .workflow-artifacts/wave5-scale-and-ops/workspace-package-split/final-review-claude.md",
        "grep -Eq 'FINAL_REVIEW_CODEX_PASS$' .workflow-artifacts/wave5-scale-and-ops/workspace-package-split/final-review-codex.md",
        'echo WORKSPACE_PACKAGE_SPLIT_FINAL_REVIEW_PASS',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })
    .step('final-signoff', {
      type: 'deterministic',
      dependsOn: ['final-review-pass-gate'],
      command: [
        "cat <<'EOF' > .workflow-artifacts/wave5-scale-and-ops/workspace-package-split/signoff.md",
        '# Ricky workspace package split signoff',
        '',
        '- validation: passed',
        '- final reviews: passed',
        '- repo shape: workspace packages restored',
        '',
        'WORKSPACE_PACKAGE_SPLIT_SIGNOFF_PASS',
        'EOF',
      ].join('\n'),
      captureOutput: true,
      failOnError: true,
    })

    .run({ cwd: process.cwd() });

  console.log(result.status);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
