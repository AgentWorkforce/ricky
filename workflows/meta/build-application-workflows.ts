import { workflow } from '@agent-relay/sdk/workflows';

async function main() {
  const result = await workflow('ricky-build-application-workflows')
    .description('Generate the first Ricky application wave backlog as reliable, reviewable workflow files with structural checks and dry-run validation.')
    .pattern('dag')
    .channel('wf-ricky-meta-build-application-workflows')
    .maxConcurrency(3)
    .timeout(3_600_000)
    .onError('retry', { maxRetries: 2, retryDelayMs: 10_000 })

    .agent('meta-lead-claude', {
      cli: 'claude',
      role: 'Meta lead who plans the generated workflow backlog, keeps it bounded, and signs off only when all generated workflows pass review and dry-run gates.',
      retries: 1,
    })
    .agent('meta-writer-codex', {
      cli: 'codex',
      role: 'Writes generated Ricky workflow files to disk following the shared template and wave program.',
      retries: 2,
    })
    .agent('meta-reviewer-claude', {
      cli: 'claude',
      preset: 'reviewer',
      role: 'Reviews generated workflows for product alignment, structure, and standards conformance.',
      retries: 1,
    })
    .agent('meta-reviewer-codex', {
      cli: 'codex',
      preset: 'reviewer',
      role: 'Reviews generated workflows for implementation practicality, deterministic gates, and structural consistency.',
      retries: 1,
    })
    .agent('meta-validator-claude', {
      cli: 'claude',
      preset: 'worker',
      role: 'Runs dry-run validation and fixes parse/shape issues until generated workflows are structurally sound.',
      retries: 2,
    })

    .step('prepare-artifacts', {
      type: 'deterministic',
      command: [
        'mkdir -p .workflow-artifacts/ricky-meta',
        'mkdir -p workflows/wave0-foundation workflows/wave1-runtime workflows/wave2-product workflows/wave3-cloud-api workflows/wave4-local-byoh workflows/wave5-scale-and-ops',
        'echo "RICKY_META_READY"',
      ].join(' && '),
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
    .step('read-wave-program', {
      type: 'deterministic',
      dependsOn: ['prepare-artifacts'],
      command: 'cat workflows/meta/spec/ricky-application-wave-program.md',
      captureOutput: true,
      failOnError: true,
    })
    .step('read-meta-design', {
      type: 'deterministic',
      dependsOn: ['prepare-artifacts'],
      command: 'cat workflows/meta/spec/ricky-meta-workflow-design.md',
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

    .step('plan-generated-backlog', {
      type: 'deterministic',
      dependsOn: [
        'read-workflow-standards',
        'read-authoring-rules',
        'read-generated-template',
        'read-wave-program',
        'read-meta-design',
        'read-product-spec',
      ],
      command: `cat > .workflow-artifacts/ricky-meta/application-wave-plan.md <<'EOF'
# Ricky Application Wave Plan — First Generated Batch

## Summary

This plan defines the first bounded batch of generated Ricky application workflows.

**Total workflows: 16**

Distribution:
- Wave 0 (Foundation): 4
- Wave 1 (Runtime): 3
- Wave 2 (Product Core): 4
- Wave 3 (Cloud API): 2
- Wave 4 (Local / BYOH): 2
- Wave 5 (Scale and Ops): 1

### Why this size

16 workflows is large enough to form a real execution layer across all waves while still staying reviewable in one pass. The extra Wave 0 slot is deliberate: Ricky should not claim meaningful typecheck and test gates until the repo has an explicit toolchain and validation foundation. The priority still skews toward Wave 0 to Wave 2 because Ricky cannot serve users without foundation, runtime, and core product logic. Waves 3 to 5 get lighter coverage because they depend on earlier waves being real.

### Product truth constraints applied

1. Users should never need to hand-write workflows, so Wave 2 includes spec intake and generation pipeline workflows early.
2. Spec handoff from Claude, CLI, and MCP is first-class, so Wave 2 includes explicit intake while Wave 4 includes the local invocation entrypoint.
3. CLI onboarding and Cloud connect are first-class, so Wave 3 includes cloud connect and auth while Wave 4 includes CLI onboarding.
4. The repo must have a truthful validation foundation, so Wave 0 includes a dedicated toolchain setup workflow before later waves rely on \`npx tsc --noEmit\` and \`npx vitest run\`.
5. Every implementation workflow in this batch is expected to support tracked and untracked file creation in its deterministic gates.
6. Every serious workflow in this batch must end with a final signoff artifact, not just a passing validation command.
7. Review pass gates must be evaluated on post-fix final review artifacts, not stale pre-fix review files.

---

## Batch summary table

| ID | Filename | Wave | Purpose (short) | Team shape |
|----|----------|------|------------------|------------|
| W0-01 | \`01-repo-standards-and-conventions.ts\` | wave0-foundation | Enforce repo conventions | doc/spec |
| W0-02 | \`02-toolchain-and-validation-foundation.ts\` | wave0-foundation | Toolchain and validation setup | implementation |
| W0-03 | \`03-shared-models-and-config.ts\` | wave0-foundation | Shared types and config | implementation |
| W0-04 | \`04-initial-architecture-docs.ts\` | wave0-foundation | Architecture reference docs | doc/spec |
| W1-01 | \`01-local-run-coordinator.ts\` | wave1-runtime | Local execution coordinator | implementation |
| W1-02 | \`02-workflow-evidence-model.ts\` | wave1-runtime | Evidence capture model | implementation |
| W1-03 | \`03-workflow-failure-classification.ts\` | wave1-runtime | Failure taxonomy | implementation |
| W2-01 | \`01-workflow-spec-intake.ts\` | wave2-product | Spec intake from all surfaces | implementation |
| W2-02 | \`02-workflow-generation-pipeline.ts\` | wave2-product | Core generation engine | implementation |
| W2-03 | \`03-workflow-debugger-specialist.ts\` | wave2-product | Failure diagnosis specialist | implementation |
| W2-04 | \`04-workflow-validator-specialist.ts\` | wave2-product | 80 to 100 validation specialist | implementation |
| W3-01 | \`01-cloud-connect-and-auth.ts\` | wave3-cloud-api | Cloud auth and provider connect | implementation |
| W3-02 | \`02-generate-endpoint.ts\` | wave3-cloud-api | Cloud generation API endpoint | implementation |
| W4-01 | \`01-cli-onboarding-and-welcome.ts\` | wave4-local-byoh | CLI product onboarding | implementation |
| W4-02 | \`02-local-invocation-entrypoint.ts\` | wave4-local-byoh | Local spec to execution path | implementation |
| W5-01 | \`01-workflow-health-analytics.ts\` | wave5-scale-and-ops | Run history analytics and digests | implementation |

## Detailed workflow plan

### Wave 0: Foundation

#### W0-01: \`01-repo-standards-and-conventions.ts\`
- **Target folder:** \`workflows/wave0-foundation/\`
- **Purpose:** Establish and validate repo-level convention files so every later workflow and agent operates under enforced standards.
- **Why first batch:** Nothing else is safe to generate until conventions are enforced at the repo level.
- **Primary files touched:** \`AGENTS.md\`, \`CLAUDE.md\`, \`workflows/README.md\`, \`workflows/shared/WORKFLOW_AUTHORING_RULES.md\`
- **Validation gates:** file_exists for each target, grep for required convention keywords, tracked plus untracked change detection scoped to intended files, final signoff artifact.
- **Recommended team shape:** doc/spec
- **80 to 100 validation shape:** structural checks, review, fix loop, post-fix validation, final re-review, final hard gate, scoped regression gate, final signoff.

#### W0-02: \`02-toolchain-and-validation-foundation.ts\`
- **Target folder:** \`workflows/wave0-foundation/\`
- **Purpose:** Establish the minimal Ricky TypeScript and Vitest foundation so later workflows have truthful validation commands instead of aspirational ones.
- **Why first batch:** Later workflows should not pretend \`npx tsc --noEmit\` and \`npx vitest run\` are meaningful unless Wave 0 first makes them real.
- **Primary files touched:** \`package.json\`, \`tsconfig.json\`, \`vitest.config.ts\`, \`src/test/setup.ts\`
- **Validation gates:** file_exists for each required toolchain file, \`npx tsc --noEmit\`, \`npx vitest run\`, tracked plus untracked scoped change detection, final signoff artifact.
- **Recommended team shape:** implementation
- **80 to 100 validation shape:** toolchain materialization gates, soft validation, reviews, fix loop, post-fix validation, final re-review, final hard validation, scoped regression gate, final signoff.

#### W0-03: \`03-shared-models-and-config.ts\`
- **Target folder:** \`workflows/wave0-foundation/\`
- **Purpose:** Create shared TypeScript model and config foundations that later runtime and product workflows import.
- **Why first batch:** Later runtime and product workflows need shared types instead of inventing ad hoc shapes.
- **Primary files touched:** \`src/shared/models/workflow-evidence.ts\`, \`src/shared/models/workflow-config.ts\`, \`src/shared/models/index.ts\`, \`src/shared/constants.ts\`
- **Validation gates:** file_exists for each file, \`npx tsc --noEmit\`, grep for exports, tracked plus untracked scoped change detection, final signoff artifact.
- **Recommended team shape:** implementation
- **80 to 100 validation shape:** file gates, soft typecheck, validation gap fix loop if needed, reviews, post-fix validation, final re-review, final hard gate, scoped regression gate, final signoff.

#### W0-04: \`04-initial-architecture-docs.ts\`
- **Target folder:** \`workflows/wave0-foundation/\`
- **Purpose:** Write the initial architecture docs for Ricky runtime composition, surfaces, ingress model, and specialist boundaries.
- **Why first batch:** Prevents later waves from drifting into inconsistent architectural assumptions.
- **Primary files touched:** \`docs/architecture/ricky-runtime-architecture.md\`, \`docs/architecture/ricky-surfaces-and-ingress.md\`, \`docs/architecture/ricky-specialist-boundaries.md\`
- **Validation gates:** file_exists, grep for key sections, minimum line count checks, tracked plus untracked scoped change detection, final signoff artifact.
- **Recommended team shape:** doc/spec
- **80 to 100 validation shape:** structural scans, review, fix loop, post-fix validation, final re-review, final hard gate, scoped regression gate, final signoff.

### Wave 1: Runtime

#### W1-01: \`01-local-run-coordinator.ts\`
- **Target folder:** \`workflows/wave1-runtime/\`
- **Purpose:** Implement the local run coordinator that wraps \`agent-relay\` invocation, captures run state, and exposes a programmatic launch, monitor, and report interface.
- **Why first batch:** Ricky cannot debug, fix, or rerun workflows without an execution substrate.
- **Primary files touched:** \`src/runtime/local-coordinator.ts\`, \`src/runtime/local-coordinator.test.ts\`, \`src/runtime/types.ts\`
- **Validation gates:** file_exists, \`npx tsc --noEmit\`, \`npx vitest run src/runtime/local-coordinator.test.ts\`, export grep, tracked plus untracked scoped change detection, final signoff artifact.
- **Recommended team shape:** implementation
- **80 to 100 validation shape:** implementation gates, soft validation, reviews, read feedback, fix loop, post-fix validation, final re-review, final review-pass gate, final hard gate, regression gate, final signoff.

#### W1-02: \`02-workflow-evidence-model.ts\`
- **Target folder:** \`workflows/wave1-runtime/\`
- **Purpose:** Implement the workflow evidence capture model for step status, verification results, logs, artifacts, and retry history.
- **Why first batch:** Ricky cannot analyze failures or prove outcomes without structured evidence.
- **Primary files touched:** \`src/runtime/evidence/capture.ts\`, \`src/runtime/evidence/types.ts\`, \`src/runtime/evidence/capture.test.ts\`, \`src/runtime/evidence/index.ts\`
- **Validation gates:** file_exists, \`npx tsc --noEmit\`, \`npx vitest run src/runtime/evidence/capture.test.ts\`, export grep, tracked plus untracked scoped change detection, final signoff artifact.
- **Recommended team shape:** implementation
- **80 to 100 validation shape:** implementation gates, soft validation, reviews, read feedback, fix loop, post-fix validation, final re-review, final review-pass gate, final hard gate, regression gate, final signoff.

#### W1-03: \`03-workflow-failure-classification.ts\`
- **Target folder:** \`workflows/wave1-runtime/\`
- **Purpose:** Implement the failure classification model that maps raw evidence to actionable failure categories.
- **Why first batch:** Ricky's debugger specialist cannot triage without a reliable taxonomy.
- **Primary files touched:** \`src/runtime/failure/classifier.ts\`, \`src/runtime/failure/types.ts\`, \`src/runtime/failure/classifier.test.ts\`, \`src/runtime/failure/index.ts\`
- **Validation gates:** file_exists, \`npx tsc --noEmit\`, \`npx vitest run src/runtime/failure/classifier.test.ts\`, export grep, tracked plus untracked scoped change detection, final signoff artifact.
- **Recommended team shape:** implementation
- **80 to 100 validation shape:** implementation gates, soft validation, reviews, read feedback, fix loop, post-fix validation, final re-review, final review-pass gate, final hard gate, regression gate, final signoff.

### Wave 2: Product Core

#### W2-01: \`01-workflow-spec-intake.ts\`
- **Target folder:** \`workflows/wave2-product/\`
- **Purpose:** Implement the spec intake pipeline that accepts natural language or structured workflow specs from all Ricky surfaces and normalizes them into Ricky's internal domain model.
- **Why first batch:** This is the entry point for the core promise that users should not need to hand-write workflows.
- **Primary files touched:** \`src/product/spec-intake/parser.ts\`, \`src/product/spec-intake/normalizer.ts\`, \`src/product/spec-intake/router.ts\`, \`src/product/spec-intake/types.ts\`, \`src/product/spec-intake/parser.test.ts\`, \`src/product/spec-intake/index.ts\`
- **Validation gates:** file_exists, \`npx tsc --noEmit\`, \`npx vitest run src/product/spec-intake/\`, export grep, tracked plus untracked scoped change detection, final signoff artifact.
- **Recommended team shape:** implementation
- **80 to 100 validation shape:** implementation gates, soft validation, reviews, read feedback, fix loop, post-fix validation, final re-review, final review-pass gate, final hard gate, regression gate, final signoff.

#### W2-02: \`02-workflow-generation-pipeline.ts\`
- **Target folder:** \`workflows/wave2-product/\`
- **Purpose:** Implement the workflow generation pipeline that takes a normalized spec, selects swarm patterns, applies skills, produces Relay workflows, and validates them.
- **Why first batch:** This is the engine that turns Ricky from a workflow adviser into a workflow product.
- **Primary files touched:** \`src/product/generation/pipeline.ts\`, \`src/product/generation/pattern-selector.ts\`, \`src/product/generation/skill-loader.ts\`, \`src/product/generation/template-renderer.ts\`, \`src/product/generation/types.ts\`, \`src/product/generation/pipeline.test.ts\`, \`src/product/generation/index.ts\`
- **Validation gates:** file_exists, \`npx tsc --noEmit\`, \`npx vitest run src/product/generation/\`, export grep, tracked plus untracked scoped change detection, final signoff artifact.
- **Recommended team shape:** implementation
- **80 to 100 validation shape:** implementation gates, soft validation, reviews, read feedback, fix loop, post-fix validation, final re-review, final review-pass gate, final hard gate, regression gate, final signoff.

#### W2-03: \`03-workflow-debugger-specialist.ts\`
- **Target folder:** \`workflows/wave2-product/\`
- **Purpose:** Implement the debugger specialist that reads evidence, classifies failures, and proposes bounded fixes or rerun strategies.
- **Why first batch:** Ricky must be able to repair broken workflows, not just generate them.
- **Primary files touched:** \`src/product/specialists/debugger/diagnosis.ts\`, \`src/product/specialists/debugger/fix-recommender.ts\`, \`src/product/specialists/debugger/debugger.ts\`, \`src/product/specialists/debugger/types.ts\`, \`src/product/specialists/debugger/debugger.test.ts\`, \`src/product/specialists/debugger/index.ts\`
- **Validation gates:** file_exists, \`npx tsc --noEmit\`, \`npx vitest run src/product/specialists/debugger/\`, export grep, tracked plus untracked scoped change detection, final signoff artifact.
- **Recommended team shape:** implementation
- **80 to 100 validation shape:** implementation gates, soft validation, reviews, read feedback, fix loop, post-fix validation, final re-review, final review-pass gate, final hard gate, regression gate, final signoff.

#### W2-04: \`04-workflow-validator-specialist.ts\`
- **Target folder:** \`workflows/wave2-product/\`
- **Purpose:** Implement the validator specialist that enforces the 80 to 100 workflow proof loop and structural sanity checks.
- **Why first batch:** Ricky needs a dedicated reliability specialist to keep generated workflows honest.
- **Primary files touched:** \`src/product/specialists/validator/structural-checks.ts\`, \`src/product/specialists/validator/proof-loop.ts\`, \`src/product/specialists/validator/validator.ts\`, \`src/product/specialists/validator/types.ts\`, \`src/product/specialists/validator/validator.test.ts\`, \`src/product/specialists/validator/index.ts\`
- **Validation gates:** file_exists, \`npx tsc --noEmit\`, \`npx vitest run src/product/specialists/validator/\`, export grep, tracked plus untracked scoped change detection, final signoff artifact.
- **Recommended team shape:** implementation
- **80 to 100 validation shape:** implementation gates, soft validation, reviews, read feedback, fix loop, post-fix validation, final re-review, final review-pass gate, final hard gate, regression gate, final signoff.

### Wave 3: Cloud API

#### W3-01: \`01-cloud-connect-and-auth.ts\`
- **Target folder:** \`workflows/wave3-cloud-api/\`
- **Purpose:** Implement Ricky Cloud auth, workspace scoping, and provider connect guidance aligned with the product spec.
- **Why first batch:** Users need a real Cloud connect path that stays honest about Google and GitHub setup.
- **Primary files touched:** \`src/cloud/auth/request-validator.ts\`, \`src/cloud/auth/workspace-scoping.ts\`, \`src/cloud/auth/provider-connect.ts\`, \`src/cloud/auth/types.ts\`, \`src/cloud/auth/request-validator.test.ts\`, \`src/cloud/auth/index.ts\`
- **Validation gates:** file_exists, \`npx tsc --noEmit\`, \`npx vitest run src/cloud/auth/\`, grep for Google connect command, grep for GitHub dashboard or Nango guidance, tracked plus untracked scoped change detection, final signoff artifact.
- **Recommended team shape:** implementation
- **80 to 100 validation shape:** implementation gates, soft validation, reviews, read feedback, fix loop, post-fix validation, final re-review, final review-pass gate, final hard gate, regression gate, final signoff.

#### W3-02: \`02-generate-endpoint.ts\`
- **Target folder:** \`workflows/wave3-cloud-api/\`
- **Purpose:** Implement the hosted generation endpoint that receives a normalized request, invokes the Ricky generation pipeline, and returns workflow artifacts or run receipts.
- **Why first batch:** Cloud API is part of Ricky's co-equal product surface and must exist alongside local mode.
- **Primary files touched:** \`src/cloud/api/generate-endpoint.ts\`, \`src/cloud/api/request-types.ts\`, \`src/cloud/api/response-types.ts\`, \`src/cloud/api/generate-endpoint.test.ts\`, \`src/cloud/api/index.ts\`
- **Validation gates:** file_exists, \`npx tsc --noEmit\`, \`npx vitest run src/cloud/api/\`, export grep, tracked plus untracked scoped change detection across Cloud API and declared dependencies, final signoff artifact.
- **Recommended team shape:** implementation
- **80 to 100 validation shape:** implementation gates, soft validation, reviews, read feedback, fix loop, post-fix validation, final re-review, final review-pass gate, final hard gate, regression gate, final signoff.

### Wave 4: Local / BYOH

#### W4-01: \`01-cli-onboarding-and-welcome.ts\`
- **Target folder:** \`workflows/wave4-local-byoh/\`
- **Purpose:** Implement Ricky CLI onboarding with ASCII welcome, local or BYOH versus Cloud mode selection, and provider guidance.
- **Why first batch:** Ricky should feel welcoming and useful on first run, not like an internal tool.
- **Primary files touched:** \`src/cli/welcome.ts\`, \`src/cli/onboarding.ts\`, \`src/cli/mode-selector.ts\`, \`src/cli/ascii-art.ts\`, \`src/cli/onboarding.test.ts\`, \`src/cli/index.ts\`
- **Validation gates:** file_exists, \`npx tsc --noEmit\`, \`npx vitest run src/cli/\`, grep for local or BYOH and Cloud modes, grep for Google connect command, grep for GitHub dashboard or Nango guidance, tracked plus untracked scoped change detection, final signoff artifact.
- **Recommended team shape:** implementation
- **80 to 100 validation shape:** implementation gates, soft validation, reviews, read feedback, fix loop, post-fix validation, final re-review, final review-pass gate, final hard gate, regression gate, final signoff.

#### W4-02: \`02-local-invocation-entrypoint.ts\`
- **Target folder:** \`workflows/wave4-local-byoh/\`
- **Purpose:** Implement the local spec to execution entrypoint that ties intake, generation, and runtime coordination into a user-facing local workflow path.
- **Why first batch:** Ricky needs a real local path that proves spec handoff can become execution without Cloud dependence.
- **Primary files touched:** \`src/local/entrypoint.ts\`, \`src/local/request-normalizer.ts\`, \`src/local/entrypoint.test.ts\`, \`src/local/index.ts\`
- **Validation gates:** file_exists, \`npx tsc --noEmit\`, \`npx vitest run src/local/\`, export grep, tracked plus untracked scoped change detection across local runtime dependencies, final signoff artifact.
- **Recommended team shape:** implementation
- **80 to 100 validation shape:** implementation gates, soft validation, reviews, read feedback, fix loop, post-fix validation, final re-review, final review-pass gate, final hard gate, regression gate, final signoff.

### Wave 5: Scale and Ops

#### W5-01: \`01-workflow-health-analytics.ts\`
- **Target folder:** \`workflows/wave5-scale-and-ops/\`
- **Purpose:** Implement the workflow health analytics module that mines run histories, identifies bad patterns, and generates improvement digests.
- **Why first batch:** Analytics closes the loop so Ricky can learn from failures instead of only reacting to them.
- **Primary files touched:** \`src/analytics/health-analyzer.ts\`, \`src/analytics/digest-generator.ts\`, \`src/analytics/types.ts\`, \`src/analytics/health-analyzer.test.ts\`, \`src/analytics/index.ts\`
- **Validation gates:** file_exists, \`npx tsc --noEmit\`, \`npx vitest run src/analytics/\`, export grep, tracked plus untracked scoped change detection across analytics and declared runtime dependencies, final signoff artifact.
- **Recommended team shape:** implementation
- **80 to 100 validation shape:** implementation gates, soft validation, reviews, read feedback, fix loop, post-fix validation, final re-review, final review-pass gate, final hard gate, regression gate, final signoff.

## Dependencies between workflows

- Wave 0 workflows execute first.
- Wave 1 depends on Wave 0 shared models and architecture clarity.
- Wave 2 depends on Wave 1 runtime coordinator, evidence, and failure classification.
- Wave 3 depends on Wave 2 product generation contracts and Wave 1 runtime evidence where relevant.
- Wave 4 depends on Wave 2 intake and generation plus Wave 1 runtime coordination.
- Wave 5 depends on Wave 1 evidence plus later run artifacts.

## Batch generation rules applied

1. Bounded to 16 workflows so the set stays reviewable while still grounding the toolchain honestly.
2. Priority skews toward Wave 0 to Wave 2 because those create the product core.
3. Product truth is explicit in the first batch: spec intake, generation pipeline, CLI onboarding, Cloud connect, local entrypoint, and validation foundation are all present.
4. Every implementation workflow is expected to support first-run untracked file creation in deterministic gates.
5. Every serious workflow must write final signoff evidence, not just pass tests.
6. Review verdicts must be deterministic artifacts checked by dedicated post-fix gates.
7. Later-wave workflows must not rely on stale pre-fix review artifacts or over-broad regression allowlists.

APPLICATION_WAVE_PLAN_READY
EOF

test -f .workflow-artifacts/ricky-meta/application-wave-plan.md && grep -q 'APPLICATION_WAVE_PLAN_READY' .workflow-artifacts/ricky-meta/application-wave-plan.md` ,
      captureOutput: true,
      failOnError: true,
    })

    .step('generate-wave0-workflows', {
      agent: 'meta-writer-codex',
      dependsOn: ['plan-generated-backlog'],
      task: `Read .workflow-artifacts/ricky-meta/application-wave-plan.md and generate the Wave 0 workflows listed there into workflows/wave0-foundation/.

Also read these requirements again before writing:
- docs/workflows/WORKFLOW_STANDARDS.md
- workflows/shared/WORKFLOW_AUTHORING_RULES.md
- workflows/meta/spec/generated-workflow-template.md

Constraints:
1. Only generate workflows assigned to Wave 0.
2. Write files to disk.
3. Each generated workflow must have a dedicated wf-ricky-* channel, deterministic context reads, deterministic verification gates, and a review phase.
4. The generated workflows should be narrow and reviewable.
5. Prefer doc/spec/scaffold workflows in Wave 0.
6. Every generated workflow must follow the relay 80-to-100 skill where applicable: implement -> verify edit -> run initial validation with failOnError false -> review -> fix loop -> post-fix validation -> final review-pass gate -> final hard gate -> regression/build gate -> final signoff.
7. Change-detection and regression gates must work for both tracked edits and first-run untracked file creation. Never rely on git diff alone. Use a tracked-plus-untracked pattern such as combining git diff --name-only with git ls-files --others --exclude-standard.
8. Review artifacts must be read before fixes run. Do not make the fix loop depend on a pass-only review gate.
9. Add a deterministic review-pass gate after the fix loop and post-fix validation. That gate must require final lines of REVIEW_*_PASS before final signoff can proceed.
10. Final regression gates must gather the full changed set, prove at least one expected path changed, and reject any changed path outside the allowed code paths plus .workflow-artifacts.
11. Include explicit file targets, non-goals, verification commands, review checklist, and commit/PR boundary guidance inside the tasking.
12. Prefer multiple narrow deterministic verify gates over one broad final grep.
13. The generated workflows should be explicit enough that a human can inspect one file and understand exactly what success means.
14. Use import syntax that matches the written standard instead of CommonJS require.
15. Do not declare unused agents. If a validator agent exists, it must own either the fix loop, final signoff, or both.
16. Do not print full workflow contents to stdout.

End by ensuring the planned Wave 0 files exist on disk.`,
      verification: { type: 'exit_code', value: '0' },
    })

    .step('generate-wave1-wave2-workflows', {
      agent: 'meta-writer-codex',
      dependsOn: ['plan-generated-backlog'],
      task: `Read .workflow-artifacts/ricky-meta/application-wave-plan.md and generate the Wave 1 and Wave 2 workflows listed there into:
- workflows/wave1-runtime/
- workflows/wave2-product/

Also read these requirements again before writing:
- docs/workflows/WORKFLOW_STANDARDS.md
- workflows/shared/WORKFLOW_AUTHORING_RULES.md
- workflows/meta/spec/generated-workflow-template.md

Constraints:
1. Only generate workflows assigned to Wave 1 or Wave 2.
2. Write files to disk.
3. Reflect the product truths around:
   - spec intake from Claude/CLI/MCP
   - no hand-authored workflow requirement for users
   - workflow abstraction and execution routing
4. Include deterministic gates and review stages.
5. For testable/code-writing workflows, explicitly encode 80-to-100 validation loops with initial run, review, fix loop, post-fix validation, final review-pass gate, final gate, build/typecheck gate, regression gate, and final signoff artifact.
6. Change-detection gates must handle newly created untracked files as well as tracked edits.
7. Review-pass gates must run after fixes, not before them.
8. Final regression gates must prove expected paths changed and reject any path outside the workflow's allowed scope plus .workflow-artifacts.
9. Prefer detailed tasking over vague prompts. The generated workflows should feel ready for first real use, not like sketches.
10. Require deterministic verification after every meaningful edit phase, not just at the very end.
11. Keep each generated workflow narrow enough that failures are diagnosable quickly.
12. Do not print full workflow contents to stdout.

End by ensuring the planned Wave 1 and Wave 2 files exist on disk.`,
      verification: { type: 'exit_code', value: '0' },
    })

    .step('generate-wave3-plus-workflows', {
      agent: 'meta-writer-codex',
      dependsOn: ['plan-generated-backlog'],
      task: `Read .workflow-artifacts/ricky-meta/application-wave-plan.md and generate the remaining first-batch workflows listed there for:
- workflows/wave3-cloud-api/
- workflows/wave4-local-byoh/
- workflows/wave5-scale-and-ops/

Also read these requirements again before writing:
- docs/workflows/WORKFLOW_STANDARDS.md
- workflows/shared/WORKFLOW_AUTHORING_RULES.md
- workflows/meta/spec/generated-workflow-template.md

Constraints:
1. Only generate workflows assigned to Waves 3, 4, or 5.
2. Write files to disk.
3. Cloud onboarding/connect flows must align with the product spec.
4. Local/BYOH flows must remain first-class.
5. For any implementation-oriented workflow, include 80-to-100 style validation and deterministic post-edit verification gates after every meaningful edit phase.
6. After fixes, require real final reviewer steps and a final review-pass gate over the post-fix final review artifacts.
7. Do not reuse stale pre-fix review files as a post-fix pass gate.
8. Regression gates must either be exact-file scoped or validate against an explicit dependency-change manifest, never a broad hand-wavy allowlist.
9. Include final signoff artifacts for these serious workflows so completion evidence is consistent across the batch.
10. Change-detection gates must handle newly created untracked files as well as tracked edits.
11. Review-pass gates must run after fix loops and post-fix validation, not before them.
12. Final regression gates must prove expected paths changed and reject any path outside the allowed scope plus .workflow-artifacts.
13. If a workflow covers onboarding or connection flows, require explicit user-visible proof or contract checks, not just internal code edits.
14. Add deterministic review verdict gates after review artifacts are written.
12. Do not print full workflow contents to stdout.

End by ensuring the planned files for these waves exist on disk.`,
      verification: { type: 'exit_code', value: '0' },
    })

    .step('verify-generated-files-exist', {
      type: 'deterministic',
      dependsOn: ['generate-wave0-workflows', 'generate-wave1-wave2-workflows', 'generate-wave3-plus-workflows'],
      command: [
        'test -f .workflow-artifacts/ricky-meta/application-wave-plan.md',
        'count=$(find workflows/wave0-foundation workflows/wave1-runtime workflows/wave2-product workflows/wave3-cloud-api workflows/wave4-local-byoh workflows/wave5-scale-and-ops -maxdepth 1 -name "*.ts" | wc -l | tr -d " ")',
        'echo "GENERATED_COUNT:$count"',
        'test "$count" -ge 16',
        'echo "RICKY_GENERATED_FILES_PRESENT"',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('sanity-check-generated-workflows', {
      type: 'deterministic',
      dependsOn: ['verify-generated-files-exist'],
      command: `failed=0
for f in $(find workflows/wave0-foundation workflows/wave1-runtime workflows/wave2-product workflows/wave3-cloud-api workflows/wave4-local-byoh workflows/wave5-scale-and-ops -maxdepth 1 -name '*.ts' | sort); do
  echo "=== $f ==="
  grep -q "workflow(" "$f" || { echo "MISSING_WORKFLOW:$f"; failed=1; }
  grep -q ".channel('wf-ricky-" "$f" || { echo "MISSING_CHANNEL:$f"; failed=1; }
  grep -q ".run({ cwd: process.cwd() })" "$f" || { echo "MISSING_RUN_CWD:$f"; failed=1; }
  grep -q "type: 'deterministic'" "$f" || { echo "MISSING_DETERMINISTIC:$f"; failed=1; }
  grep -q "review" "$f" || { echo "MISSING_REVIEW:$f"; failed=1; }
  grep -Eq "Deliverables|deliverables" "$f" || { echo "MISSING_DELIVERABLES_CONTEXT:$f"; failed=1; }
  grep -Eq "Non-goals|non-goals" "$f" || { echo "MISSING_NON_GOALS:$f"; failed=1; }
  grep -Eq "Verification|verification" "$f" || { echo "MISSING_VERIFICATION_SECTION:$f"; failed=1; }
  if grep -Eq "impl|build|generate|debug|runtime|connect|api" "$f"; then
    grep -q "failOnError: false" "$f" || { echo "MISSING_INITIAL_SOFT_GATE:$f"; failed=1; }
    grep -Eq "fix|validate" "$f" || { echo "MISSING_FIX_LOOP:$f"; failed=1; }
    grep -q "failOnError: true" "$f" || { echo "MISSING_FINAL_HARD_GATE:$f"; failed=1; }
  fi
done
if [ "$failed" -ne 0 ]; then exit 1; fi
echo "RICKY_GENERATED_SANITY_PASS"`,
      captureOutput: true,
      failOnError: true,
    })

    .step('review-generated-workflows-claude', {
      agent: 'meta-reviewer-claude',
      dependsOn: ['sanity-check-generated-workflows'],
      task: `Review the generated Ricky workflows.

Read:
- .workflow-artifacts/ricky-meta/application-wave-plan.md
- docs/workflows/WORKFLOW_STANDARDS.md
- workflows/shared/WORKFLOW_AUTHORING_RULES.md
- workflows/meta/spec/generated-workflow-template.md
- all generated workflow files under the wave folders

Write .workflow-artifacts/ricky-meta/review-claude.md.

Assess:
1. Does the generated batch reflect Ricky's actual product shape?
2. Are CLI onboarding, Cloud connect, and spec handoff represented early enough?
3. Are workflows narrow, staged, and reviewable?
4. Do they appear structurally consistent with the template?
5. Do implementation-oriented workflows follow the 80-to-100 bar closely enough that first real test runs should need few iterations?
6. Are the task bodies detailed enough to avoid ambiguous agent behavior and shallow outputs?
7. Do all serious workflows end with consistent completion evidence, including final signoff artifacts?
8. Is the review, fix, post-fix validation, and final review-pass control flow wired so failures can be fixed and signoff still requires review pass after fixes?

End the file with either REVIEW_CLAUDE_PASS or REVIEW_CLAUDE_FAIL.`,
      verification: { type: 'file_exists', value: '.workflow-artifacts/ricky-meta/review-claude.md' },
    })

    .step('review-generated-workflows-codex', {
      agent: 'meta-reviewer-codex',
      dependsOn: ['sanity-check-generated-workflows'],
      task: `Review the generated Ricky workflows.

Read:
- .workflow-artifacts/ricky-meta/application-wave-plan.md
- docs/workflows/WORKFLOW_STANDARDS.md
- workflows/shared/WORKFLOW_AUTHORING_RULES.md
- workflows/meta/spec/generated-workflow-template.md
- all generated workflow files under the wave folders

Write .workflow-artifacts/ricky-meta/review-codex.md.

Assess:
1. Are the deterministic gates strong enough?
2. Are the workflow scopes practical?
3. Is the generated batch implementation-friendly rather than just aspirational?
4. Are there obvious structural inconsistencies across the generated files?
5. Do the generated workflows include detailed enough validation commands, fix loops, final hard gates, and signoff artifacts to minimize iteration when first tested?
6. Are the generated workflows explicit enough about deliverables, non-goals, and verification that agents are unlikely to wander?
7. Do change-detection gates correctly account for untracked first-run files?
8. Is the review and fix orchestration deterministic, including a final review-pass gate after fixes and a regression gate that rejects unrelated tracked or untracked changes?

End the file with either REVIEW_CODEX_PASS or REVIEW_CODEX_FAIL.`,
      verification: { type: 'file_exists', value: '.workflow-artifacts/ricky-meta/review-codex.md' },
    })

    .step('read-generated-reviews', {
      type: 'deterministic',
      dependsOn: ['review-generated-workflows-claude', 'review-generated-workflows-codex'],
      command: 'cat .workflow-artifacts/ricky-meta/review-claude.md .workflow-artifacts/ricky-meta/review-codex.md',
      captureOutput: true,
      failOnError: true,
    })
    .step('verify-review-verdicts', {
      type: 'deterministic',
      dependsOn: ['read-generated-reviews'],
      command: [
        'grep -Eq "REVIEW_CLAUDE_PASS$|REVIEW_CLAUDE_FAIL$" .workflow-artifacts/ricky-meta/review-claude.md',
        'grep -Eq "REVIEW_CODEX_PASS$|REVIEW_CODEX_FAIL$" .workflow-artifacts/ricky-meta/review-codex.md',
        'echo RICKY_META_REVIEW_VERDICTS_RECORDED',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('fix-generated-workflows', {
      agent: 'meta-validator-claude',
      dependsOn: ['verify-review-verdicts'],
      task: `Read the review output below and fix the generated workflows if needed.

{{steps.read-generated-reviews.output}}

Also re-read:
- docs/workflows/WORKFLOW_STANDARDS.md
- workflows/shared/WORKFLOW_AUTHORING_RULES.md
- workflows/meta/spec/generated-workflow-template.md

Rules:
1. If both reviews are effectively pass-level, only make targeted fixes if they identify real structural problems.
2. Keep the generated batch bounded.
3. Preserve the wave plan unless a workflow is clearly misplaced.
4. Write changes to disk and do not print the full files.
5. Focus on structural correctness and dry-run viability.

Exit only after the generated workflows are ready for final dry-run validation.`,
      verification: { type: 'exit_code', value: '0' },
    })

    .step('dry-run-generated-workflows', {
      type: 'deterministic',
      dependsOn: ['fix-generated-workflows'],
      command: `failed=0
mkdir -p .workflow-artifacts/ricky-meta/dryrun
for f in $(find workflows/wave0-foundation workflows/wave1-runtime workflows/wave2-product workflows/wave3-cloud-api workflows/wave4-local-byoh workflows/wave5-scale-and-ops -maxdepth 1 -name '*.ts' | sort); do
  base=$(basename "$f" .ts)
  echo "=== DRY RUN $f ==="
  if ! agent-relay run --dry-run "$f" > ".workflow-artifacts/ricky-meta/dryrun/$base.txt" 2>&1; then
    echo "DRYRUN_FAIL:$f"
    failed=1
  else
    echo "DRYRUN_PASS:$f"
  fi
done
if [ "$failed" -ne 0 ]; then exit 1; fi
echo "RICKY_GENERATED_DRYRUN_PASS"`,
      captureOutput: true,
      failOnError: false,
    })

    .step('final-signoff', {
      agent: 'meta-lead-claude',
      dependsOn: ['dry-run-generated-workflows'],
      task: `Write the final signoff at .workflow-artifacts/ricky-meta/signoff.md.

Inputs to consider:
- .workflow-artifacts/ricky-meta/application-wave-plan.md
- .workflow-artifacts/ricky-meta/review-claude.md
- .workflow-artifacts/ricky-meta/review-codex.md
- dry-run output summary from the prior step:
{{steps.dry-run-generated-workflows.output}}

Requirements:
1. State whether the generated Ricky application wave backlog is ready for human review.
2. Mention whether dry-run passed fully or where it failed.
3. Call out any workflows that still look under-specified or likely to require extra iteration.
4. Keep the verdict honest.
5. End with either META_SIGNOFF_PASS or META_SIGNOFF_FAIL.

IMPORTANT: write the file to disk.`,
      verification: { type: 'file_exists', value: '.workflow-artifacts/ricky-meta/signoff.md' },
    })

    .step('verify-signoff-artifact', {
      type: 'deterministic',
      dependsOn: ['final-signoff'],
      command: [
        'test -f .workflow-artifacts/ricky-meta/signoff.md',
        'grep -Eq "META_SIGNOFF_PASS|META_SIGNOFF_FAIL" .workflow-artifacts/ricky-meta/signoff.md',
        'echo "RICKY_META_SIGNOFF_RECORDED"',
      ].join(' && '),
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
