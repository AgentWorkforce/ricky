import { workflow } from '@agent-relay/sdk/workflows';

const artifactDir = '.workflow-artifacts/generated/goal-i-want-a-documentation-pass-to-make-sure-al';
const workflowPath = 'workflows/generated/ricky-documentation-reality-check.ts';

async function main() {
  const result = await workflow('ricky-documentation-reality-check')
    .description('Audit Ricky documentation against the current repository, apply only bounded non-destructive documentation fixes, and persist reviewable evidence.')
    .pattern('dag')
    .channel('wf-ricky-docs-reality-check')
    .maxConcurrency(4)
    .timeout(3_600_000)
    .onError('fail-fast')

    .agent('root-doc-auditor', {
      cli: 'codex',
      preset: 'worker',
      role: 'Audits README, SPEC, and repo-level agent instructions against package metadata and CLI reality.',
      retries: 1,
    })
    .agent('spec-doc-auditor', {
      cli: 'codex',
      preset: 'worker',
      role: 'Audits specs against implemented source files and behavior.',
      retries: 1,
    })
    .agent('architecture-doc-auditor', {
      cli: 'codex',
      preset: 'worker',
      role: 'Audits architecture documentation against the current src layout and runtime types.',
      retries: 1,
    })
    .agent('product-workflow-doc-auditor', {
      cli: 'codex',
      preset: 'worker',
      role: 'Audits product and workflow documentation against current workflow and product surfaces.',
      retries: 1,
    })
    .agent('documentation-lead', {
      cli: 'claude',
      preset: 'worker',
      role: 'Consolidates audit findings into a prioritized documentation fix plan.',
      retries: 1,
    })
    .agent('documentation-fixer', {
      cli: 'codex',
      preset: 'worker',
      role: 'Applies only safe documentation fixes and records every changed file.',
      retries: 2,
    })
    .agent('documentation-repair-agent', {
      cli: 'codex',
      preset: 'worker',
      role: 'Repairs documentation-only issues surfaced by typecheck or test failures.',
      retries: 2,
    })
    .agent('documentation-reviewer', {
      cli: 'claude',
      preset: 'reviewer',
      role: 'Reviews final documentation evidence and residual risks.',
      retries: 1,
    })

    .step('worktree-baseline', {
      type: 'deterministic',
      command: [
        `mkdir -p '${artifactDir}'`,
        `{ git diff --name-only; git ls-files --others --exclude-standard; } | sort -u > '${artifactDir}/worktree-baseline.txt'`,
        `printf '%s\\n' 'WORKTREE_BASELINE_CAPTURED'`,
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('prepare-context', {
      type: 'deterministic',
      dependsOn: ['worktree-baseline'],
      command: [
        `mkdir -p '${artifactDir}'`,
        `printf '%s\\n' 'Local: npx tsx ${workflowPath}' 'Cloud: ricky cloud --workflow ${workflowPath} --run' 'MCP: invoke workflow ricky-documentation-reality-check through the Relay broker' > '${artifactDir}/routing.txt'`,
        `find . -path './node_modules' -prune -o -path './dist' -prune -o -path './.git' -prune -o -path './.workflow-artifacts' -prune -o -name '*.md' -print | sort > '${artifactDir}/documentation-inventory.txt'`,
        `node --input-type=module -e "import { readFileSync, writeFileSync } from 'node:fs'; const pkg = JSON.parse(readFileSync('package.json', 'utf8')); writeFileSync('${artifactDir}/package-scripts.json', JSON.stringify({ name: pkg.name, version: pkg.version, description: pkg.description, bin: pkg.bin, scripts: pkg.scripts, dependencies: pkg.dependencies, devDependencies: pkg.devDependencies }, null, 2) + '\\n');"`,
        `printf '%s\\n' 'DOCUMENTATION_CONTEXT_READY'`,
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('audit-root-docs', {
      agent: 'root-doc-auditor',
      dependsOn: ['prepare-context'],
      task: `Audit root documentation against the current Ricky repo.

Inputs:
- README.md, SPEC.md, CLAUDE.md, AGENTS.md when present
- package.json and ${artifactDir}/package-scripts.json
- src/surfaces/cli/ for real CLI commands

Write ${artifactDir}/audit-root-findings.md with findings grouped as Broken, Stale, Missing, or OK.
For each finding include file, line or search term, observed reality, and suggested fix.
Do not edit files. End with ROOT_DOC_AUDIT_COMPLETE.`,
      verification: { type: 'file_exists', value: `${artifactDir}/audit-root-findings.md` },
    })

    .step('audit-specs', {
      agent: 'spec-doc-auditor',
      dependsOn: ['prepare-context'],
      task: `Audit specs/*.md against the implemented source.

Inputs:
- specs/*.md
- src/**
- ${artifactDir}/documentation-inventory.txt

Write ${artifactDir}/audit-specs-findings.md with discrepancies per spec file.
Flag missing referenced files, implemented-differently behavior, and stale milestone language.
Do not edit files. End with SPECS_DOC_AUDIT_COMPLETE.`,
      verification: { type: 'file_exists', value: `${artifactDir}/audit-specs-findings.md` },
    })

    .step('audit-architecture', {
      agent: 'architecture-doc-auditor',
      dependsOn: ['prepare-context'],
      task: `Audit docs/architecture/*.md against current source structure.

Inputs:
- docs/architecture/*.md
- src/**
- package.json

Write ${artifactDir}/audit-architecture-findings.md.
Verify referenced modules, types, runtime flows, and failure taxonomy names exist or document drift.
Do not edit files. End with ARCHITECTURE_DOC_AUDIT_COMPLETE.`,
      verification: { type: 'file_exists', value: `${artifactDir}/audit-architecture-findings.md` },
    })

    .step('audit-product-and-workflows', {
      agent: 'product-workflow-doc-auditor',
      dependsOn: ['prepare-context'],
      task: `Audit product and workflow documentation against repo reality.

Inputs:
- docs/product/*.md
- docs/workflows/*.md
- workflows/README.md
- workflows/shared/WORKFLOW_AUTHORING_RULES.md
- workflows/meta/**/*.md
- workflows/**/*.ts

Write ${artifactDir}/audit-product-findings.md.
Check workflow standards, generated workflow conventions, product feature claims, and obsolete path references.
Do not edit files. End with PRODUCT_WORKFLOW_DOC_AUDIT_COMPLETE.`,
      verification: { type: 'file_exists', value: `${artifactDir}/audit-product-findings.md` },
    })

    .step('audit-findings-gate', {
      type: 'deterministic',
      dependsOn: ['audit-root-docs', 'audit-specs', 'audit-architecture', 'audit-product-and-workflows'],
      command: [
        `grep -Fq 'ROOT_DOC_AUDIT_COMPLETE' '${artifactDir}/audit-root-findings.md'`,
        `grep -Fq 'SPECS_DOC_AUDIT_COMPLETE' '${artifactDir}/audit-specs-findings.md'`,
        `grep -Fq 'ARCHITECTURE_DOC_AUDIT_COMPLETE' '${artifactDir}/audit-architecture-findings.md'`,
        `grep -Fq 'PRODUCT_WORKFLOW_DOC_AUDIT_COMPLETE' '${artifactDir}/audit-product-findings.md'`,
        `printf '%s\\n' 'AUDIT_FINDINGS_GATE_PASSED'`,
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('consolidate-findings', {
      agent: 'documentation-lead',
      dependsOn: ['audit-findings-gate'],
      task: `Consolidate the documentation audit into a safe fix plan.

Inputs:
- ${artifactDir}/audit-root-findings.md
- ${artifactDir}/audit-specs-findings.md
- ${artifactDir}/audit-architecture-findings.md
- ${artifactDir}/audit-product-findings.md

Write ${artifactDir}/doc-fix-plan.md.
Deduplicate findings and rank them: broken instructions, stale references, missing coverage, cosmetic.
Classify each item as SAFE_TO_FIX or NEEDS_HUMAN_REVIEW.
Only propose automatic fixes for documentation files. End with DOC_FIX_PLAN_READY.`,
      verification: { type: 'file_exists', value: `${artifactDir}/doc-fix-plan.md` },
    })

    .step('fix-plan-gate', {
      type: 'deterministic',
      dependsOn: ['consolidate-findings'],
      command: `grep -Fq 'DOC_FIX_PLAN_READY' '${artifactDir}/doc-fix-plan.md' && grep -Eq 'SAFE_TO_FIX|NEEDS_HUMAN_REVIEW' '${artifactDir}/doc-fix-plan.md' && printf '%s\\n' 'FIX_PLAN_GATE_PASSED'`,
      captureOutput: true,
      failOnError: true,
    })

    .step('apply-safe-fixes', {
      agent: 'documentation-fixer',
      dependsOn: ['fix-plan-gate'],
      task: `Apply the safe documentation fixes from ${artifactDir}/doc-fix-plan.md.

Strict boundaries:
- Edit only Markdown documentation files outside ${artifactDir}.
- Do not edit source code, package metadata, lockfiles, generated TypeScript workflows, credentials, or config.
- Do not delete documentation files.
- Skip any ambiguous item and list it under "Needs human review".

Write ${artifactDir}/doc-fixes-applied.md with every changed file and every skipped item.
End with DOC_FIXES_APPLIED.`,
      verification: { type: 'file_exists', value: `${artifactDir}/doc-fixes-applied.md` },
    })

    .step('doc-only-diff-gate', {
      type: 'deterministic',
      dependsOn: ['apply-safe-fixes'],
      command: [
        `bash -lc 'set -euo pipefail`,
        `grep -Fq "DOC_FIXES_APPLIED" "${artifactDir}/doc-fixes-applied.md"`,
        `: > "${artifactDir}/changed-files.txt"`,
        `{ git diff --name-only; git ls-files --others --exclude-standard; } | sort -u > "${artifactDir}/changed-files.txt"`,
        `while IFS= read -r f; do`,
        `  test -z "$f" && continue`,
        `  case "$f" in ${artifactDir}/*|${workflowPath}|*.md) ;; *) echo "NON_DOCUMENTATION_CHANGE: $f"; exit 1 ;; esac`,
        `done < "${artifactDir}/changed-files.txt"`,
        `echo DOC_ONLY_DIFF_GATE_PASSED'`,
      ].join('; '),
      captureOutput: true,
      failOnError: true,
    })

    .step('typecheck-initial', {
      type: 'deterministic',
      dependsOn: ['doc-only-diff-gate'],
      command: `bash -lc 'set -o pipefail; npx tsc --noEmit 2>&1 | tee "${artifactDir}/typecheck.log"; status=$?; printf "exit_code=%s\\n" "$status" > "${artifactDir}/typecheck.status"; exit 0'`,
      captureOutput: true,
      failOnError: true,
    })

    .step('test-suite-initial', {
      type: 'deterministic',
      dependsOn: ['typecheck-initial'],
      command: `bash -lc 'set -o pipefail; npx vitest run 2>&1 | tee "${artifactDir}/test.log"; status=$?; printf "exit_code=%s\\n" "$status" > "${artifactDir}/test.status"; exit 0'`,
      captureOutput: true,
      failOnError: true,
    })

    .step('validation-triage', {
      type: 'deterministic',
      dependsOn: ['test-suite-initial'],
      command: [
        `bash -lc 'set -euo pipefail`,
        `tc_ok=$(grep -c "exit_code=0" "${artifactDir}/typecheck.status" 2>/dev/null || echo 0)`,
        `ts_ok=$(grep -c "exit_code=0" "${artifactDir}/test.status" 2>/dev/null || echo 0)`,
        `if [ "$tc_ok" = "1" ] && [ "$ts_ok" = "1" ]; then printf "VALIDATION_CLEAN\\n" > "${artifactDir}/validation-triage.txt"; else printf "VALIDATION_NEEDS_REPAIR\\n" > "${artifactDir}/validation-triage.txt"; fi`,
        `cat "${artifactDir}/validation-triage.txt"'`,
      ].join('; '),
      captureOutput: true,
      failOnError: true,
    })

    .step('fix-validation-failures', {
      agent: 'documentation-repair-agent',
      dependsOn: ['validation-triage'],
      task: `Repair documentation-only issues that caused typecheck or test failures.

Check ${artifactDir}/validation-triage.txt — if it says VALIDATION_CLEAN, write "${artifactDir}/repair-report.md" with "No repairs needed. REPAIR_STEP_COMPLETE" and stop.

Otherwise, read ${artifactDir}/typecheck.log and ${artifactDir}/test.log to identify failures.

Strict boundaries:
- Edit ONLY Markdown documentation files (*.md) outside ${artifactDir}.
- Do NOT edit source code, TypeScript files, package.json, lockfiles, config, or anything that is not a Markdown doc.
- Do NOT delete documentation files.
- Revert any documentation change that introduced the failure.

Write ${artifactDir}/repair-report.md listing each repair made.
End with REPAIR_STEP_COMPLETE.`,
      verification: { type: 'file_exists', value: `${artifactDir}/repair-report.md` },
    })

    .step('doc-only-diff-gate-post-repair', {
      type: 'deterministic',
      dependsOn: ['fix-validation-failures'],
      command: [
        `bash -lc 'set -euo pipefail`,
        `grep -Fq "REPAIR_STEP_COMPLETE" "${artifactDir}/repair-report.md"`,
        `{ git diff --name-only; git ls-files --others --exclude-standard; } | sort -u > "${artifactDir}/changed-files-post-repair.txt"`,
        `while IFS= read -r f; do`,
        `  test -z "$f" && continue`,
        `  case "$f" in ${artifactDir}/*|${workflowPath}|*.md) ;; *) echo "NON_DOCUMENTATION_CHANGE: $f"; exit 1 ;; esac`,
        `done < "${artifactDir}/changed-files-post-repair.txt"`,
        `echo DOC_ONLY_DIFF_GATE_POST_REPAIR_PASSED'`,
      ].join('; '),
      captureOutput: true,
      failOnError: true,
    })

    .step('typecheck-final', {
      type: 'deterministic',
      dependsOn: ['doc-only-diff-gate-post-repair'],
      command: `bash -lc 'set -o pipefail; npx tsc --noEmit 2>&1 | tee "${artifactDir}/typecheck-final.log"; status=$?; printf "exit_code=%s\\n" "$status" > "${artifactDir}/typecheck.status"; exit "$status"'`,
      captureOutput: true,
      failOnError: true,
    })

    .step('test-suite-final', {
      type: 'deterministic',
      dependsOn: ['typecheck-final'],
      command: `bash -lc 'set -o pipefail; npx vitest run 2>&1 | tee "${artifactDir}/test-final.log"; status=$?; printf "exit_code=%s\\n" "$status" > "${artifactDir}/test.status"; exit "$status"'`,
      captureOutput: true,
      failOnError: true,
    })

    .step('regression-sanity', {
      type: 'deterministic',
      dependsOn: ['test-suite-final'],
      command: [
        `grep -Fq 'exit_code=0' '${artifactDir}/typecheck.status'`,
        `grep -Fq 'exit_code=0' '${artifactDir}/test.status'`,
        `git diff --check`,
        `printf '%s\\n' 'REGRESSION_SANITY_PASSED'`,
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('final-review', {
      agent: 'documentation-reviewer',
      dependsOn: ['regression-sanity'],
      task: `Write the final documentation reality-check summary.

Inputs:
- ${artifactDir}/doc-fix-plan.md
- ${artifactDir}/doc-fixes-applied.md
- ${artifactDir}/repair-report.md
- ${artifactDir}/changed-files.txt
- ${artifactDir}/changed-files-post-repair.txt (if exists)
- ${artifactDir}/typecheck.status and ${artifactDir}/test.status
- ${artifactDir}/worktree-baseline.txt
- ${artifactDir}/routing.txt

Write ${artifactDir}/outcome-summary.md with:
- total audit findings found, fixed, repaired, and left for human review
- changed files (distinguishing pre-existing from workflow-introduced)
- validation evidence (initial and final typecheck/test results)
- local, cloud, and MCP routing
- residual risks

End with DOCUMENTATION_REALITY_CHECK_READY.`,
      verification: { type: 'file_exists', value: `${artifactDir}/outcome-summary.md` },
    })

    .step('outcome-gate', {
      type: 'deterministic',
      dependsOn: ['final-review'],
      command: `grep -Fq 'DOCUMENTATION_REALITY_CHECK_READY' '${artifactDir}/outcome-summary.md' && printf '%s\\n' 'DOCUMENTATION_REALITY_CHECK_WORKFLOW_READY'`,
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
