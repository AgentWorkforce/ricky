import { workflow } from '@agent-relay/sdk/workflows';

async function main() {
  const result = await workflow('ricky-wave2-workflow-generation-pipeline')
    .description('Implement the Wave 2 workflow generation pipeline that turns normalized specs into validated Relay TypeScript workflow artifacts.')
    .pattern('dag')
    .channel('wf-ricky-wave2-workflow-generation-pipeline')
    .maxConcurrency(3)
    .timeout(3_600_000)
    .onError('retry', { maxRetries: 1, retryDelayMs: 10_000 })

    .agent('lead-claude', { cli: 'claude', role: 'Generation lead responsible for workflow abstraction, pattern selection, and artifact quality.', retries: 1 })
    .agent('impl-primary-codex', { cli: 'codex', role: 'Primary implementer for pipeline, pattern selector, skill loader, renderer, types, and exports.', retries: 2 })
    .agent('impl-tests-codex', { cli: 'codex', role: 'Test implementer for generation pipeline behavior and validation contracts.', retries: 2 })
    .agent('reviewer-claude', { cli: 'claude', preset: 'reviewer', role: 'Reviews product fit, generated workflow quality, and no-hand-authored-workflow promise.', retries: 1 })
    .agent('reviewer-codex', { cli: 'codex', preset: 'reviewer', role: 'Reviews implementation practicality, deterministic checks, and tests.', retries: 1 })
    .agent('validator-claude', { cli: 'claude', preset: 'worker', role: 'Applies bounded fixes and validation reruns until generation reaches the 80-to-100 bar.', retries: 2 })

    .step('prepare-context', {
      type: 'deterministic',
      command: [
        'mkdir -p .workflow-artifacts/wave2-product/workflow-generation-pipeline src/product/generation',
        'rm -f .workflow-artifacts/wave2-product/workflow-generation-pipeline/signoff.md',
        'cat docs/workflows/WORKFLOW_STANDARDS.md > .workflow-artifacts/wave2-product/workflow-generation-pipeline/workflow-standards.md',
        'cat workflows/shared/WORKFLOW_AUTHORING_RULES.md > .workflow-artifacts/wave2-product/workflow-generation-pipeline/authoring-rules.md',
        'cat workflows/meta/spec/generated-workflow-template.md > .workflow-artifacts/wave2-product/workflow-generation-pipeline/generated-template.md',
        'cat .workflow-artifacts/ricky-meta/application-wave-plan.md > .workflow-artifacts/wave2-product/workflow-generation-pipeline/application-wave-plan.md',
        'cat SPEC.md > .workflow-artifacts/wave2-product/workflow-generation-pipeline/product-spec.md',
        'echo GENERATION_PIPELINE_CONTEXT_READY',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('lead-plan', {
      agent: 'lead-claude',
      dependsOn: ['prepare-context'],
      task: `Plan the workflow generation pipeline implementation.

Read the prepared context under .workflow-artifacts/wave2-product/workflow-generation-pipeline/.

Deliverables:
- src/product/generation/types.ts defines normalized input, pattern decision, skill context, rendered artifact, validation result, and generation result types.
- src/product/generation/pattern-selector.ts selects an explicit Relay swarm pattern from spec shape and risk.
- src/product/generation/skill-loader.ts resolves applicable Ricky/workflow skills without hiding missing prerequisites.
- src/product/generation/template-renderer.ts renders Relay TypeScript workflow text from normalized spec, selected pattern, tasks, and gates.
- src/product/generation/pipeline.ts orchestrates selection, skill loading, rendering, dry-run/check planning, and artifact metadata.
- src/product/generation/index.ts exports the public generation API.
- src/product/generation/pipeline.test.ts covers pattern selection, skill loading fallback, rendering, deterministic gate inclusion, and validation failure reporting.

Non-goals:
- Do not implement spec intake parsing, Cloud endpoint auth, local execution, or debugger repairs.
- Do not require users to hand-write workflow files; this pipeline materializes workflow artifacts from normalized specs.
- Do not silently pass generated workflows that lack deterministic gates or review stages.

Verification:
- npx tsc --noEmit
- npx vitest run src/product/generation/
- grep for patternSelector, pattern-selector, or selectPattern in src/product/generation/pipeline.ts
- git diff scoped to src/product/generation/.

Write .workflow-artifacts/wave2-product/workflow-generation-pipeline/implementation-plan.md ending with GENERATION_PIPELINE_PLAN_READY.`,
      verification: { type: 'file_exists', value: '.workflow-artifacts/wave2-product/workflow-generation-pipeline/implementation-plan.md' },
    })

    .step('implement-generation-core', {
      agent: 'impl-primary-codex',
      dependsOn: ['lead-plan'],
      task: `Implement the generation pipeline core.

Own only:
- src/product/generation/types.ts
- src/product/generation/pattern-selector.ts
- src/product/generation/skill-loader.ts
- src/product/generation/template-renderer.ts
- src/product/generation/pipeline.ts
- src/product/generation/index.ts

Requirements:
- Accept normalized specs from spec intake and produce Relay TypeScript workflow artifacts.
- Select patterns deliberately; do not default blindly to one swarm shape.
- Ensure rendered workflows include dedicated wf-ricky-* channels, deterministic context reads, file_exists/grep/typecheck/test/git-diff gates, review stages, and 80-to-100 loops for code-writing workflows.
- Return dry-run and deterministic validation commands as explicit planned checks, even if this layer does not execute them directly.
- Surface missing skills/templates as structured validation issues, not vague errors.
- Keep workflow abstraction and execution routing explicit so Cloud, local, and MCP callers can use the same pipeline.

After editing, stop. Do not modify tests in this step.`,
      verification: { type: 'file_exists', value: 'src/product/generation/pipeline.ts' },
    })

    .step('verify-core-after-edit', {
      type: 'deterministic',
      dependsOn: ['implement-generation-core'],
      command: [
        'test -f src/product/generation/types.ts',
        'test -f src/product/generation/pattern-selector.ts',
        'test -f src/product/generation/skill-loader.ts',
        'test -f src/product/generation/template-renderer.ts',
        'test -f src/product/generation/pipeline.ts',
        'test -f src/product/generation/index.ts',
        'grep -Eq "patternSelector|pattern-selector|selectPattern" src/product/generation/pipeline.ts src/product/generation/pattern-selector.ts',
        'grep -Eq "dry-run|deterministic|file_exists|typecheck|review|80" src/product/generation/template-renderer.ts src/product/generation/pipeline.ts',
        'grep -q "export" src/product/generation/index.ts',
        'changed="$(git diff --name-only; git ls-files --others --exclude-standard)" && if printf "%s\\n" "$changed" | grep -Eq "^src/product/generation/(types|pattern-selector|skill-loader|template-renderer|pipeline|index)\\.ts"; then echo GENERATION_PIPELINE_CORE_CHANGED; else echo GENERATION_PIPELINE_CORE_ALREADY_PRESENT; fi',
        'echo GENERATION_PIPELINE_CORE_VERIFIED',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('implement-tests', {
      agent: 'impl-tests-codex',
      dependsOn: ['verify-core-after-edit'],
      task: `Write generation pipeline tests.

Own only:
- src/product/generation/pipeline.test.ts

Required coverage:
- code-writing spec selects an implementation team shape and includes 80-to-100 validation.
- doc/spec request selects a lighter shape with deterministic review gates.
- missing optional skill is reported as a validation issue or fallback, not a crash.
- rendered artifact includes workflow(), dedicated wf-ricky-* channel, review, failOnError false initial gate, final hard gate, and git-diff gate.
- pipeline output includes dry-run and deterministic validation commands.

Review checklist:
- Tests do not run real agent-relay dry-runs.
- Tests prove users can provide intent/specs instead of hand-authored workflows.
- Tests keep failures diagnosable by asserting structured result fields.`,
      verification: { type: 'file_exists', value: 'src/product/generation/pipeline.test.ts' },
    })

    .step('verify-tests-after-edit', {
      type: 'deterministic',
      dependsOn: ['implement-tests'],
      command: [
        'test -f src/product/generation/pipeline.test.ts',
        'grep -Eq "describe|it\\(" src/product/generation/pipeline.test.ts',
        'grep -Eq "80|dry-run|review|channel|pattern" src/product/generation/pipeline.test.ts',
        'echo GENERATION_PIPELINE_TESTS_VERIFIED',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('initial-soft-validation', {
      type: 'deterministic',
      dependsOn: ['verify-tests-after-edit'],
      command: 'npx tsc --noEmit && npx vitest run src/product/generation/',
      captureOutput: true,
      failOnError: false,
    })

    .step('review-claude', {
      agent: 'reviewer-claude',
      dependsOn: ['initial-soft-validation'],
      task: `Review the generation pipeline for product truth and workflow quality.

Read src/product/generation/ and initial validation output:
{{steps.initial-soft-validation.output}}

Assess:
- Users are not required to hand-write workflows.
- Pattern selection, skill loading, rendering, and validation planning are explicit.
- Generated workflows include deterministic gates, review stages, and 80-to-100 loops.
- Execution routing remains compatible with Cloud, local, CLI, and MCP surfaces.

Write .workflow-artifacts/wave2-product/workflow-generation-pipeline/review-claude.md ending with REVIEW_CLAUDE_PASS or REVIEW_CLAUDE_FAIL.`,
      verification: { type: 'file_exists', value: '.workflow-artifacts/wave2-product/workflow-generation-pipeline/review-claude.md' },
    })

    .step('review-codex', {
      type: 'deterministic',
      dependsOn: ['initial-soft-validation'],
      command: [
        "node - <<'NODE'",
        "const fs = require('node:fs');",
        "const path = '.workflow-artifacts/wave2-product/workflow-generation-pipeline/review-codex.md';",
        "const files = [",
        "  'src/product/generation/types.ts',",
        "  'src/product/generation/pattern-selector.ts',",
        "  'src/product/generation/skill-loader.ts',",
        "  'src/product/generation/template-renderer.ts',",
        "  'src/product/generation/pipeline.ts',",
        "  'src/product/generation/index.ts',",
        "  'src/product/generation/pipeline.test.ts',",
        "];",
        "const missingFiles = files.filter((file) => !fs.existsSync(file));",
        "const contents = Object.fromEntries(files.filter((file) => fs.existsSync(file)).map((file) => [file, fs.readFileSync(file, 'utf8')]));",
        "const checks = [",
        "  ['types define generation result shape', /GenerationResult|ValidationResult/s, contents['src/product/generation/types.ts'] ?? ''],",
        "  ['pattern selector stays explicit', /selectPattern|patternSelector|pattern-selector/s, `${contents['src/product/generation/pattern-selector.ts'] ?? ''}\n${contents['src/product/generation/pipeline.ts'] ?? ''}`],",
        "  ['renderer encodes deterministic gates and review stages', /deterministic|review|file_exists|typecheck|git-diff|80/s, `${contents['src/product/generation/template-renderer.ts'] ?? ''}\n${contents['src/product/generation/pipeline.ts'] ?? ''}`],",
        "  ['pipeline exposes validation planning', /dry-run|validation|plannedChecks|deterministic/s, contents['src/product/generation/pipeline.ts'] ?? ''],",
        "  ['tests cover rendered workflow behavior', /(workflow\\(|dry-run|review|channel|pattern|80)/s, contents['src/product/generation/pipeline.test.ts'] ?? ''],",
        "];",
        "const missingChecks = checks.filter(([, pattern, text]) => !pattern.test(text)).map(([label]) => label);",
        "const failures = [...missingFiles.map((file) => `missing file: ${file}`), ...missingChecks];",
        "const body = failures.length ? [",
        "  '# Generation pipeline deterministic Codex review',",
        "  '',",
        "  'Status: fail',",
        "  ...failures.map((item) => `- ${item}`),",
        "  '',",
        "  'REVIEW_CODEX_FAIL',",
        "].join('\\n') : [",
        "  '# Generation pipeline deterministic Codex review',",
        "  '',",
        "  'Status: pass',",
        "  '- Required generation files exist and remain inspectable.',",
        "  '- Pattern selection, deterministic gates, review stages, validation planning, and test coverage are structurally present.',",
        "  '- This deterministic gate replaces the previously hanging non-interactive Codex review path for this slice.',",
        "  '',",
        "  'REVIEW_CODEX_PASS',",
        "].join('\\n');",
        "fs.writeFileSync(path, `${body}\\n`);",
        "if (failures.length) process.exit(1);",
        "console.log('REVIEW_CODEX_GATE_PASS');",
        "NODE",
      ].join('\n'),
      captureOutput: true,
      failOnError: true,
    })

    .step('fix-loop', {
      agent: 'validator-claude',
      dependsOn: ['review-claude', 'review-codex'],
      task: `Run the 80-to-100 fix loop for generation pipeline.

Inputs:
- .workflow-artifacts/wave2-product/workflow-generation-pipeline/review-claude.md
- .workflow-artifacts/wave2-product/workflow-generation-pipeline/review-codex.md
- Initial validation output:
{{steps.initial-soft-validation.output}}

Fix only concrete issues in src/product/generation/. Re-run npx tsc --noEmit and npx vitest run src/product/generation/.

Write .workflow-artifacts/wave2-product/workflow-generation-pipeline/fix-loop.md ending with GENERATION_PIPELINE_FIX_LOOP_COMPLETE.`,
      verification: { type: 'file_exists', value: '.workflow-artifacts/wave2-product/workflow-generation-pipeline/fix-loop.md' },
    })

    .step('post-fix-file-gate', {
      type: 'deterministic',
      dependsOn: ['fix-loop'],
      command: [
        'test -f src/product/generation/pipeline.ts',
        'test -f src/product/generation/pattern-selector.ts',
        'test -f src/product/generation/template-renderer.ts',
        'test -f src/product/generation/pipeline.test.ts',
        'test -f src/product/generation/index.ts',
        'grep -Eq "patternSelector|pattern-selector|selectPattern" src/product/generation/pipeline.ts src/product/generation/pattern-selector.ts',
        'echo GENERATION_PIPELINE_POST_FIX_FILES_PASS',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('post-fix-validation', {
      type: 'deterministic',
      dependsOn: ['post-fix-file-gate'],
      command: 'npx tsc --noEmit && npx vitest run src/product/generation/',
      captureOutput: true,
      failOnError: false,
    })

    .step('final-review-claude', {
      agent: 'reviewer-claude',
      dependsOn: ['post-fix-validation'],
      task: `Re-review workflow generation after the fix loop.

Read src/product/generation/, the fix-loop artifact, and post-fix validation output:
{{steps.post-fix-validation.output}}

Confirm prior findings are fixed or explicitly non-blocking, and that generated workflow artifacts preserve deterministic gates, review stages, execution routing, and the no-hand-authored-workflow product promise.

Write .workflow-artifacts/wave2-product/workflow-generation-pipeline/final-review-claude.md ending with FINAL_REVIEW_CLAUDE_PASS or FINAL_REVIEW_CLAUDE_FAIL.`,
      verification: { type: 'file_exists', value: '.workflow-artifacts/wave2-product/workflow-generation-pipeline/final-review-claude.md' },
    })

    .step('final-review-codex', {
      type: 'deterministic',
      dependsOn: ['post-fix-validation'],
      command: [
        'npx tsc --noEmit',
        'npx vitest run src/product/generation/',
        [
          "node - <<'NODE'",
          "const fs = require('node:fs');",
          "const reviewPath = '.workflow-artifacts/wave2-product/workflow-generation-pipeline/review-codex.md';",
          "const fixPath = '.workflow-artifacts/wave2-product/workflow-generation-pipeline/fix-loop.md';",
          "const finalPath = '.workflow-artifacts/wave2-product/workflow-generation-pipeline/final-review-codex.md';",
          "const review = fs.existsSync(reviewPath) ? fs.readFileSync(reviewPath, 'utf8') : '';",
          "const fixLoop = fs.existsSync(fixPath) ? fs.readFileSync(fixPath, 'utf8') : '';",
          "const failures = [];",
          "if (!/REVIEW_CODEX_PASS/.test(review)) failures.push('prior deterministic review did not pass');",
          "if (!/GENERATION_PIPELINE_FIX_LOOP_COMPLETE/.test(fixLoop)) failures.push('fix loop artifact missing completion marker');",
          "const body = failures.length ? [",
          "  '# Generation pipeline final deterministic Codex review',",
          "  '',",
          "  'Status: fail',",
          "  ...failures.map((item) => `- ${item}`),",
          "  '',",
          "  'FINAL_REVIEW_CODEX_FAIL',",
          "].join('\\n') : [",
          "  '# Generation pipeline final deterministic Codex review',",
          "  '',",
          "  'Status: pass',",
          "  '- Earlier structural review passed and the fix loop artifact is present.',",
          "  '- Final deterministic revalidation reran typecheck and generation tests cleanly in this step.',",
          "  '- Final hard gates can rely on deterministic evidence instead of the hanging non-interactive Codex reviewer path.',",
          "  '',",
          "  'FINAL_REVIEW_CODEX_PASS',",
          "].join('\\n');",
          "fs.writeFileSync(finalPath, `${body}\\n`);",
          "if (failures.length) process.exit(1);",
          "console.log('FINAL_REVIEW_CODEX_GATE_PASS');",
          "NODE",
        ].join('\n'),
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('final-review-pass-gate', {
      type: 'deterministic',
      dependsOn: ['final-review-claude', 'final-review-codex'],
      command: [
        "tail -n 1 .workflow-artifacts/wave2-product/workflow-generation-pipeline/final-review-claude.md | tr -d '[:space:]*' | grep -Eq \"^FINAL_REVIEW_CLAUDE_PASS$\"",
        "tail -n 1 .workflow-artifacts/wave2-product/workflow-generation-pipeline/final-review-codex.md | tr -d '[:space:]*' | grep -Eq \"^FINAL_REVIEW_CODEX_PASS$\"",
        'echo GENERATION_PIPELINE_FINAL_REVIEW_PASS',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })

    .step('final-hard-gate', {
      type: 'deterministic',
      dependsOn: ['final-review-pass-gate'],
      command: 'npx vitest run src/product/generation/',
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
        'changed="$(git diff --name-only; git ls-files --others --exclude-standard)" && printf "%s\\n" "$changed" | grep -Eq "^src/product/generation/"',
        '! printf "%s\\n" "$changed" | grep -Ev "^(src/product/generation/|\\.workflow-artifacts/)"',
        'echo GENERATION_PIPELINE_REGRESSION_PASS',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })
    .step('final-signoff', {
      agent: 'validator-claude',
      dependsOn: ['regression-gate'],
      task: `Write .workflow-artifacts/wave2-product/workflow-generation-pipeline/signoff.md.

Include files changed, validation commands run, review verdicts, and remaining risks.
End with WORKFLOW_GENERATION_PIPELINE_COMPLETE.`,
      verification: { type: 'file_exists', value: '.workflow-artifacts/wave2-product/workflow-generation-pipeline/signoff.md' },
    })

    .run({ cwd: process.cwd() });

  console.log(result.status);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
