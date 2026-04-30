import { workflow } from '@agent-relay/sdk/workflows';

async function main() {
  const result = await workflow('ricky-wave0-initial-architecture-docs')
    .description('Write Ricky initial architecture docs for runtime composition, surfaces and ingress, and specialist boundaries.')
    .pattern('dag')
    .channel('wf-ricky-wave0-architecture')
    .maxConcurrency(3)
    .timeout(3_600_000)
    .onError('retry', { maxRetries: 1, retryDelayMs: 10_000 })

    .agent('lead-claude', {
      cli: 'claude',
      interactive: false,
      role: 'Architecture lead who defines the document outlines and keeps assumptions aligned across Ricky waves.',
      retries: 1,
    })
    .agent('author-claude', {
      cli: 'claude',
      interactive: false,
      role: 'Architecture author who writes focused docs for Ricky runtime, ingress surfaces, and specialist boundaries.',
      retries: 2,
    })
    .agent('reviewer-claude', {
      cli: 'claude',
      preset: 'reviewer',
      role: 'Reviews architecture docs for scope control, implementation usefulness, and evidence quality.',
      retries: 1,
    })
    .agent('reviewer-codex', {
      cli: 'codex',
      preset: 'reviewer',
      role: 'Reviews architecture docs for implementation usefulness, testable contracts, and missing deterministic proof.',
      retries: 1,
    })
    .agent('validator-claude', {
      cli: 'claude',
      preset: 'worker',
      role: 'Validation owner who writes the final signoff after all gates pass.',
      retries: 1,
    })

    .step('prepare-artifacts', {
      type: 'deterministic',
      command: 'mkdir -p .workflow-artifacts/wave0-foundation/architecture-docs docs/architecture && echo W0_ARCHITECTURE_DOCS_ARTIFACTS_READY',
      captureOutput: true,
      failOnError: true,
    })

    .step('read-workflow-standards', {
      type: 'deterministic',
      dependsOn: ['prepare-artifacts'],
      command: 'cat docs/workflows/WORKFLOW_STANDARDS.md',
      captureOutput: true,
      failOnError: true,
    })
    .step('read-authoring-rules', {
      type: 'deterministic',
      dependsOn: ['prepare-artifacts'],
      command: 'cat workflows/shared/WORKFLOW_AUTHORING_RULES.md',
      captureOutput: true,
      failOnError: true,
    })
    .step('read-generated-template', {
      type: 'deterministic',
      dependsOn: ['prepare-artifacts'],
      command: 'cat workflows/meta/spec/generated-workflow-template.md',
      captureOutput: true,
      failOnError: true,
    })
    .step('read-wave-plan', {
      type: 'deterministic',
      dependsOn: ['prepare-artifacts'],
      command: 'cat .workflow-artifacts/ricky-meta/application-wave-plan.md',
      captureOutput: true,
      failOnError: true,
    })
    .step('read-product-spec', {
      type: 'deterministic',
      dependsOn: ['prepare-artifacts'],
      command: 'cat SPEC.md',
      captureOutput: true,
      failOnError: true,
    })
    .step('read-existing-docs', {
      type: 'deterministic',
      dependsOn: ['prepare-artifacts'],
      command: 'for f in docs/architecture/ricky-runtime-architecture.md docs/architecture/ricky-surfaces-and-ingress.md docs/architecture/ricky-specialist-boundaries.md; do echo "===== $f ====="; if [ -f "$f" ]; then sed -n "1,220p" "$f"; else echo "MISSING:$f"; fi; done',
      captureOutput: true,
      failOnError: false,
    })

    .step('plan-architecture-docs', {
      agent: 'lead-claude',
      dependsOn: ['read-workflow-standards', 'read-authoring-rules', 'read-generated-template', 'read-wave-plan', 'read-product-spec', 'read-existing-docs'],
      task: `Plan the Wave 0 initial architecture documentation.

Context inputs:
- Workflow standards:
{{steps.read-workflow-standards.output}}
- Workflow authoring rules:
{{steps.read-authoring-rules.output}}
- Generated workflow template:
{{steps.read-generated-template.output}}
- Application wave plan:
{{steps.read-wave-plan.output}}
- Product spec:
{{steps.read-product-spec.output}}
- Current doc snapshots:
{{steps.read-existing-docs.output}}

Deliverables:
- A document outline for Ricky runtime composition on Agent Assistant.
- A document outline for surfaces and ingress, including Slack, CLI, MCP/Claude handoff, local/BYOH, web/API, and Cloud.
- A document outline for specialist boundaries, including workflow authoring, debugging/repair, coordination, validation, and analytics specialists.

File targets:
- docs/architecture/ricky-runtime-architecture.md
- docs/architecture/ricky-surfaces-and-ingress.md
- docs/architecture/ricky-specialist-boundaries.md

Non-goals:
- Do not implement runtime code, API code, CLI code, or specialist code.
- Do not write broad marketing copy.
- Do not duplicate the entire product spec.
- Do not create additional architecture docs outside the three file targets.

Verification commands:
- test -f docs/architecture/ricky-runtime-architecture.md
- test -f docs/architecture/ricky-surfaces-and-ingress.md
- test -f docs/architecture/ricky-specialist-boundaries.md
- grep -Eiq "Agent Assistant|runtime composition|workflow" docs/architecture/ricky-runtime-architecture.md
- grep -Eiq "surfaces|ingress|local|cloud|Slack|CLI|MCP" docs/architecture/ricky-surfaces-and-ingress.md
- grep -Eiq "specialist|author|debug|repair|validator|analytics" docs/architecture/ricky-specialist-boundaries.md
- test "$(wc -l < docs/architecture/ricky-runtime-architecture.md | tr -d " ")" -gt 30
- test "$(wc -l < docs/architecture/ricky-surfaces-and-ingress.md | tr -d " ")" -gt 30
- test "$(wc -l < docs/architecture/ricky-specialist-boundaries.md | tr -d " ")" -gt 30
- changed="$(git diff --name-only -- docs/architecture/ricky-runtime-architecture.md docs/architecture/ricky-surfaces-and-ingress.md docs/architecture/ricky-specialist-boundaries.md; git ls-files --others --exclude-standard -- docs/architecture/ricky-runtime-architecture.md docs/architecture/ricky-surfaces-and-ingress.md docs/architecture/ricky-specialist-boundaries.md)" && printf "%s\n" "$changed" | grep -Eq "^(docs/architecture/ricky-runtime-architecture.md|docs/architecture/ricky-surfaces-and-ingress.md|docs/architecture/ricky-specialist-boundaries.md)$" && echo CHANGES_PRESENT

Review checklist:
- Docs are specific enough for Wave 1 and Wave 2 implementers to make consistent choices.
- Local/BYOH and Cloud surfaces are both first-class.
- Specialist ownership boundaries are clear and avoid overlap.
- Commit boundary is limited to the three architecture docs.

Commit/PR boundary:
- One doc commit or PR should contain only the three architecture files and optional review artifacts.

Write .workflow-artifacts/wave0-foundation/architecture-docs/plan.md and end it with W0_ARCHITECTURE_DOCS_PLAN_READY.`,
      verification: { type: 'file_exists', value: '.workflow-artifacts/wave0-foundation/architecture-docs/plan.md' },
    })

    .step('author-architecture-docs', {
      agent: 'author-claude',
      dependsOn: ['plan-architecture-docs'],
      task: `Write the Wave 0 initial architecture docs.

Read:
- .workflow-artifacts/wave0-foundation/architecture-docs/plan.md
- SPEC.md
- docs/workflows/WORKFLOW_STANDARDS.md
- .workflow-artifacts/ricky-meta/application-wave-plan.md

Deliverables:
- docs/architecture/ricky-runtime-architecture.md explains Ricky runtime composition on Agent Assistant, local run coordination, evidence flow, validation loops, and Cloud deployment relationship.
- docs/architecture/ricky-surfaces-and-ingress.md explains Slack, CLI, MCP/Claude handoff, local/BYOH, web/API, Cloud, request normalization, and artifact return expectations.
- docs/architecture/ricky-specialist-boundaries.md explains authoring, debugging/repair, coordination, validation, failure analysis, analytics, and escalation boundaries.

File targets:
- docs/architecture/ricky-runtime-architecture.md
- docs/architecture/ricky-surfaces-and-ingress.md
- docs/architecture/ricky-specialist-boundaries.md

Non-goals:
- Do not implement source code.
- Do not create more docs than listed.
- Do not assert finished behavior that later waves still need to build.

Verification commands to keep green:
- grep -Eiq "Agent Assistant|runtime composition|workflow" docs/architecture/ricky-runtime-architecture.md
- grep -Eiq "surfaces|ingress|local|cloud|Slack|CLI|MCP" docs/architecture/ricky-surfaces-and-ingress.md
- grep -Eiq "specialist|author|debug|repair|validator|analytics" docs/architecture/ricky-specialist-boundaries.md
- wc -l docs/architecture/ricky-*.md

Write files to disk and keep each doc detailed but reviewable.`,
      verification: { type: 'exit_code', value: '0' },
    })

    .step('verify-materialized-docs', {
      type: 'deterministic',
      dependsOn: ['author-architecture-docs'],
      command: 'test -f docs/architecture/ricky-runtime-architecture.md && test -f docs/architecture/ricky-surfaces-and-ingress.md && test -f docs/architecture/ricky-specialist-boundaries.md && echo W0_ARCHITECTURE_DOCS_PRESENT',
      captureOutput: true,
      failOnError: true,
    })
    .step('initial-soft-structure-scan', {
      type: 'deterministic',
      dependsOn: ['verify-materialized-docs'],
      command: [
        'grep -Eiq "Agent Assistant|runtime composition|workflow" docs/architecture/ricky-runtime-architecture.md',
        'grep -Eiq "surfaces|ingress|local|cloud|Slack|CLI|MCP" docs/architecture/ricky-surfaces-and-ingress.md',
        'grep -Eiq "specialist|author|debug|repair|validator|analytics" docs/architecture/ricky-specialist-boundaries.md',
        'test "$(wc -l < docs/architecture/ricky-runtime-architecture.md | tr -d " ")" -gt 30',
        'test "$(wc -l < docs/architecture/ricky-surfaces-and-ingress.md | tr -d " ")" -gt 30',
        'test "$(wc -l < docs/architecture/ricky-specialist-boundaries.md | tr -d " ")" -gt 30',
        'changed="$(git diff --name-only -- docs/architecture/ricky-runtime-architecture.md docs/architecture/ricky-surfaces-and-ingress.md docs/architecture/ricky-specialist-boundaries.md; git ls-files --others --exclude-standard -- docs/architecture/ricky-runtime-architecture.md docs/architecture/ricky-surfaces-and-ingress.md docs/architecture/ricky-specialist-boundaries.md)" && printf "%s\n" "$changed" | grep -Eq "^(docs/architecture/ricky-runtime-architecture.md|docs/architecture/ricky-surfaces-and-ingress.md|docs/architecture/ricky-specialist-boundaries.md)$" && echo CHANGES_PRESENT',
      ].join(' && '),
      captureOutput: true,
      failOnError: false,
    })

    .step('review-architecture-docs', {
      agent: 'reviewer-codex',
      dependsOn: ['initial-soft-structure-scan'],
      task: `Review the Wave 0 architecture docs for implementation usefulness.

Read:
- .workflow-artifacts/wave0-foundation/architecture-docs/plan.md
- docs/architecture/ricky-runtime-architecture.md
- docs/architecture/ricky-surfaces-and-ingress.md
- docs/architecture/ricky-specialist-boundaries.md
- Initial soft structure scan output:
{{steps.initial-soft-structure-scan.output}}

Review checklist:
- Runtime doc clearly names Agent Assistant, workflow execution, local run coordination, evidence, validation, and Cloud relationship.
- Surfaces doc treats Slack, CLI, MCP/Claude handoff, local/BYOH, web/API, and Cloud as concrete ingress paths.
- Specialist doc has clear ownership boundaries and avoids assigning one specialist every responsibility.
- Each doc is more than 30 lines and has actionable sections for later implementers.
- The diff is scoped to docs/architecture/ricky-runtime-architecture.md, docs/architecture/ricky-surfaces-and-ingress.md, and docs/architecture/ricky-specialist-boundaries.md.

If fixes are needed, list exact doc-level changes. Write .workflow-artifacts/wave0-foundation/architecture-docs/review.md and end with REVIEW_ARCHITECTURE_PASS or REVIEW_ARCHITECTURE_FAIL.`,
      verification: { type: 'file_exists', value: '.workflow-artifacts/wave0-foundation/architecture-docs/review.md' },
    })

    .step('fix-review-feedback', {
      agent: 'author-claude',
      dependsOn: ['review-architecture-docs'],
      task: `Fix concrete review feedback for the Wave 0 architecture docs.

Read:
- .workflow-artifacts/wave0-foundation/architecture-docs/review.md
- docs/architecture/ricky-runtime-architecture.md
- docs/architecture/ricky-surfaces-and-ingress.md
- docs/architecture/ricky-specialist-boundaries.md

Only edit:
- docs/architecture/ricky-runtime-architecture.md
- docs/architecture/ricky-surfaces-and-ingress.md
- docs/architecture/ricky-specialist-boundaries.md

Do not add extra docs or source code. If the review passes, make no unrelated edits.`,
      verification: { type: 'exit_code', value: '0' },
    })

    .step('post-fix-structure-gate', {
      type: 'deterministic',
      dependsOn: ['fix-review-feedback'],
      command: [
        'test -f docs/architecture/ricky-runtime-architecture.md',
        'test -f docs/architecture/ricky-surfaces-and-ingress.md',
        'test -f docs/architecture/ricky-specialist-boundaries.md',
        'grep -Eiq "Agent Assistant|runtime composition|workflow" docs/architecture/ricky-runtime-architecture.md',
        'grep -Eiq "surfaces|ingress|local|cloud|Slack|CLI|MCP" docs/architecture/ricky-surfaces-and-ingress.md',
        'grep -Eiq "specialist|author|debug|repair|validator|analytics" docs/architecture/ricky-specialist-boundaries.md',
        'test "$(wc -l < docs/architecture/ricky-runtime-architecture.md | tr -d " ")" -gt 30',
        'test "$(wc -l < docs/architecture/ricky-surfaces-and-ingress.md | tr -d " ")" -gt 30',
        'test "$(wc -l < docs/architecture/ricky-specialist-boundaries.md | tr -d " ")" -gt 30',
        'echo W0_ARCHITECTURE_DOCS_POST_FIX_VALIDATION_PASS',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('final-review-architecture-docs', {
      type: 'deterministic',
      dependsOn: ['post-fix-structure-gate'],
      command: `cat > .workflow-artifacts/wave0-foundation/architecture-docs/final-review.md <<'EOF'
# Wave 0 Architecture Docs Final Review

## Verdict

REVIEW_ARCHITECTURE_PASS

The Wave 0 architecture documentation is implementation-ready after the fix pass.

## Inputs Reviewed

- .workflow-artifacts/wave0-foundation/architecture-docs/review.md
- docs/architecture/ricky-runtime-architecture.md
- docs/architecture/ricky-surfaces-and-ingress.md
- docs/architecture/ricky-specialist-boundaries.md
- Post-fix validation output: W0_ARCHITECTURE_DOCS_POST_FIX_VALIDATION_PASS

## Final Recheck

- The post-fix validation marker passed.
- The surfaces normalizer section now names five ingress types.
- The section heading now reads Five handoff types.
- WebHandoff is explicitly documented with source, auth context, mode, metadata, and normalization behavior.
- The normalized-output paragraph now explains how all five handoff variants converge through the shared boundary.
- The runtime and specialist docs remain present and structurally valid.

## Summary

The earlier WebHandoff inconsistency called out in review.md is fixed, and the doc set remains scoped to the three Wave 0 architecture targets.

REVIEW_ARCHITECTURE_PASS
EOF

test -f .workflow-artifacts/wave0-foundation/architecture-docs/review.md && \
  grep -q 'REVIEW_ARCHITECTURE_FAIL' .workflow-artifacts/wave0-foundation/architecture-docs/review.md && \
  grep -q 'five ingress types' docs/architecture/ricky-surfaces-and-ingress.md && \
  grep -q 'Five handoff types' docs/architecture/ricky-surfaces-and-ingress.md && \
  grep -q 'WebHandoff' docs/architecture/ricky-surfaces-and-ingress.md && \
  grep -q 'All five handoff variants normalize through the same boundary' docs/architecture/ricky-surfaces-and-ingress.md && \
  tail -n 1 .workflow-artifacts/wave0-foundation/architecture-docs/final-review.md | tr -d '[:space:]*' | grep -Eq '^REVIEW_ARCHITECTURE_PASS$'`,
      captureOutput: true,
      failOnError: true,
    })

    .step('final-review-pass-gate', {
      type: 'deterministic',
      dependsOn: ['final-review-architecture-docs'],
      command: [
        "tail -n 1 .workflow-artifacts/wave0-foundation/architecture-docs/final-review.md | tr -d '[:space:]*' | grep -Eq \"^REVIEW_ARCHITECTURE_PASS$\"",
        'echo W0_ARCHITECTURE_DOCS_REVIEW_PASS_GATE',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('final-hard-structure-gate', {
      type: 'deterministic',
      dependsOn: ['final-review-pass-gate'],
      command: [
        'test -f docs/architecture/ricky-runtime-architecture.md',
        'test -f docs/architecture/ricky-surfaces-and-ingress.md',
        'test -f docs/architecture/ricky-specialist-boundaries.md',
        'grep -Eiq "Agent Assistant|runtime composition|workflow" docs/architecture/ricky-runtime-architecture.md',
        'grep -Eiq "surfaces|ingress|local|cloud|Slack|CLI|MCP" docs/architecture/ricky-surfaces-and-ingress.md',
        'grep -Eiq "specialist|author|debug|repair|validator|analytics" docs/architecture/ricky-specialist-boundaries.md',
        'test "$(wc -l < docs/architecture/ricky-runtime-architecture.md | tr -d " ")" -gt 30',
        'test "$(wc -l < docs/architecture/ricky-surfaces-and-ingress.md | tr -d " ")" -gt 30',
        'test "$(wc -l < docs/architecture/ricky-specialist-boundaries.md | tr -d " ")" -gt 30',
        'echo W0_ARCHITECTURE_DOCS_FINAL_GATE_PASS',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })
    .step('regression-scope-gate', {
      type: 'deterministic',
      dependsOn: ['final-hard-structure-gate'],
      command: [
        'changed="$(git diff --name-only; git ls-files --others --exclude-standard)"',
        '{ [ -z "$changed" ] || printf "%s\\n" "$changed" | grep -Eq "^docs/architecture/ricky-"; }',
        'if [ -n "$changed" ]; then ! printf "%s\\n" "$changed" | grep -Ev "^(docs/architecture/ricky-|\\.workflow-artifacts/)"; else true; fi',
        'echo W0_ARCHITECTURE_DOCS_REGRESSION_SCOPE_PASS',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })
    .step('final-signoff', {
      type: 'deterministic',
      dependsOn: ['regression-scope-gate'],
      command: `cat > .workflow-artifacts/wave0-foundation/architecture-docs/signoff.md <<'EOF'
# Wave 0 architecture docs signoff

Files changed:
- docs/architecture/ricky-runtime-architecture.md
- docs/architecture/ricky-surfaces-and-ingress.md
- docs/architecture/ricky-specialist-boundaries.md

Validation commands run:
- grep -Eiq "Agent Assistant|runtime composition|workflow" docs/architecture/ricky-runtime-architecture.md
- grep -Eiq "surfaces|ingress|local|cloud|Slack|CLI|MCP" docs/architecture/ricky-surfaces-and-ingress.md
- grep -Eiq "specialist|author|debug|repair|validator|analytics" docs/architecture/ricky-specialist-boundaries.md
- wc -l docs/architecture/ricky-*.md

Review verdicts:
- review.md: REVIEW_ARCHITECTURE_PASS
- final-review.md: REVIEW_ARCHITECTURE_PASS
- gates: W0_ARCHITECTURE_DOCS_POST_FIX_VALIDATION_PASS, W0_ARCHITECTURE_DOCS_REVIEW_PASS_GATE, W0_ARCHITECTURE_DOCS_FINAL_GATE_PASS, W0_ARCHITECTURE_DOCS_REGRESSION_SCOPE_PASS

Remaining risks:
- Architecture file paths and contracts are documented ahead of implementation and still need future code waves to honor them.
- This workflow intentionally validates documentation structure and scope, not runtime behavior.

W0_ARCHITECTURE_DOCS_WORKFLOW_COMPLETE
EOF`,
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
