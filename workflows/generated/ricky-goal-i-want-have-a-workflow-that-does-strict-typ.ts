import { workflow } from '@agent-relay/sdk/workflows';

const artifactDir = '.workflow-artifacts/generated/goal-i-want-have-a-workflow-that-does-strict-typ';
const workflowPath = 'workflows/generated/ricky-goal-i-want-have-a-workflow-that-does-strict-typ.ts';

async function main() {
  const result = await workflow('ricky-goal-i-want-have-a-workflow-that-does-strict-typ')
    .description('Run strict TypeScript checks for the Ricky codebase, including tsconfig strict mode, no explicit any annotations, and tsc --noEmit evidence.')
    .pattern('pipeline')
    .channel('wf-ricky-goal-i-want-have-a-workflow-that-does-strict-typ')
    .maxConcurrency(1)
    .timeout(900_000)
    .onError('fail-fast')

    .step('prepare-evidence', {
      type: 'deterministic',
      command: [
        `DIR=${artifactDir}`,
        'mkdir -p "$DIR"',
        `printf '%s\\n' '${workflowPath}' > "$DIR/runtime-deliverable.txt"`,
        "cat > \"$DIR/routing.md\" <<'EOF'",
        '# Strict typecheck workflow routing',
        '',
        'Local caller:',
        `- Run: npx tsx ${workflowPath}`,
        '- The workflow executes deterministic checks in the current checkout.',
        '',
        'Cloud caller:',
        '- Submit this TypeScript workflow artifact to Agent Relay Cloud with the target repository mounted as the working directory.',
        '- Cloud execution uses the same deterministic commands and does not require credentials beyond the caller-managed cloud runner setup.',
        '',
        'MCP caller:',
        '- Return this artifact path and command to the MCP host.',
        '- The MCP host owns cancellation and response delivery; this artifact only performs deterministic repository checks.',
        'EOF',
        "cat > \"$DIR/strict-typecheck-contract.md\" <<'EOF'",
        '# Strict typecheck contract',
        '',
        '- `tsconfig.json` must keep `compilerOptions.strict` set to `true`.',
        '- The codebase must not use explicit TypeScript `any` annotations or casts in source, tests, scripts, or workflows.',
        '- `npm run typecheck` and `npx tsc --noEmit` must pass.',
        '- Evidence is written under this artifact directory for local, cloud, and MCP callers to return.',
        '',
        'STRICT_TYPECHECK_CONTRACT_READY',
        'EOF',
        'echo STRICT_TYPECHECK_EVIDENCE_READY',
      ].join('\n'),
      captureOutput: true,
      failOnError: true,
    })
    .step('verify-routing-contract', {
      type: 'deterministic',
      dependsOn: ['prepare-evidence'],
      command: [
        `DIR=${artifactDir}`,
        'grep -F "Local caller:" "$DIR/routing.md"',
        'grep -F "Cloud caller:" "$DIR/routing.md"',
        'grep -F "MCP caller:" "$DIR/routing.md"',
        'grep -F "npx tsx workflows/generated/ricky-goal-i-want-have-a-workflow-that-does-strict-typ.ts" "$DIR/routing.md"',
        'echo STRICT_TYPECHECK_ROUTING_OK',
      ].join(' && '),
      captureOutput: true,
      failOnError: true,
    })
    .step('verify-tsconfig-strict', {
      type: 'deterministic',
      dependsOn: ['verify-routing-contract'],
      command: [
        `DIR=${artifactDir}`,
        "node --input-type=module <<'NODE' > \"$DIR/tsconfig-strict-check.log\"",
        "import { readFileSync } from 'node:fs';",
        "const rawConfig = readFileSync('tsconfig.json', 'utf8');",
        'const parsedConfig = JSON.parse(rawConfig);',
        'const compilerOptions = parsedConfig.compilerOptions;',
        "if (typeof compilerOptions !== 'object' || compilerOptions === null) {",
        "  console.error('compilerOptions missing');",
        '  process.exit(1);',
        '}',
        'if (compilerOptions.strict !== true) {',
        "  console.error('compilerOptions.strict must be true');",
        '  process.exit(1);',
        '}',
        'if (compilerOptions.noEmit !== true) {',
        "  console.error('compilerOptions.noEmit must be true');",
        '  process.exit(1);',
        '}',
        "console.log('STRICT_TSCONFIG_OK');",
        'NODE',
        'cat "$DIR/tsconfig-strict-check.log"',
      ].join('\n'),
      captureOutput: true,
      failOnError: true,
    })
    .step('scan-explicit-any', {
      type: 'deterministic',
      dependsOn: ['verify-tsconfig-strict'],
      command: [
        `DIR=${artifactDir}`,
        'set +e',
        'rg -n --glob "*.ts" --glob "!*.d.ts" \'(:\\s*any\\b|as\\s+any\\b|<\\s*any\\s*>|\\bArray\\s*<\\s*any\\s*>|\\bPromise\\s*<\\s*any\\s*>|\\bRecord\\s*<[^>]*\\bany\\b)\' src test workflows scripts > "$DIR/explicit-any-scan.log"',
        'STATUS=$?',
        'set -e',
        'if [ "$STATUS" -eq 0 ]; then',
        '  echo "Explicit TypeScript any usage found:"',
        '  cat "$DIR/explicit-any-scan.log"',
        '  exit 1',
        'fi',
        'if [ "$STATUS" -gt 1 ]; then',
        '  echo "rg scan failed with status $STATUS"',
        '  cat "$DIR/explicit-any-scan.log"',
        '  exit "$STATUS"',
        'fi',
        "printf '%s\\n' 'NO_EXPLICIT_ANY_FOUND' > \"$DIR/explicit-any-scan.log\"",
        'cat "$DIR/explicit-any-scan.log"',
      ].join('\n'),
      captureOutput: true,
      failOnError: true,
    })
    .step('run-package-typecheck', {
      type: 'deterministic',
      dependsOn: ['scan-explicit-any'],
      command: [
        `DIR=${artifactDir}`,
        'set +e',
        'npm run typecheck > "$DIR/npm-typecheck.log" 2>&1',
        'STATUS=$?',
        'set -e',
        'cat "$DIR/npm-typecheck.log"',
        'exit "$STATUS"',
      ].join('\n'),
      captureOutput: true,
      failOnError: true,
    })
    .step('run-tsc-noemit', {
      type: 'deterministic',
      dependsOn: ['run-package-typecheck'],
      command: [
        `DIR=${artifactDir}`,
        'set +e',
        'npx tsc --noEmit > "$DIR/tsc-noemit.log" 2>&1',
        'STATUS=$?',
        'set -e',
        'cat "$DIR/tsc-noemit.log"',
        'exit "$STATUS"',
      ].join('\n'),
      captureOutput: true,
      failOnError: true,
    })
    .step('record-strictness-opportunities', {
      type: 'deterministic',
      dependsOn: ['run-tsc-noemit'],
      command: [
        `DIR=${artifactDir}`,
        "node --input-type=module <<'NODE' > \"$DIR/strictness-opportunities.md\"",
        "import { readFileSync } from 'node:fs';",
        "const config = JSON.parse(readFileSync('tsconfig.json', 'utf8'));",
        'const options = config.compilerOptions;',
        "const optionalFlags = ['noUncheckedIndexedAccess', 'exactOptionalPropertyTypes', 'noImplicitOverride', 'noPropertyAccessFromIndexSignature'];",
        "console.log('# Strictness opportunities');",
        "console.log('');",
        'for (const flag of optionalFlags) {',
        "  const state = options[flag] === true ? 'enabled' : 'not enabled';",
        '  console.log(`- ${flag}: ${state}`);',
        '}',
        "console.log('');",
        "console.log('These optional flags are reported for future hardening only. This workflow fails on the current strict contract: strict mode, no explicit any annotations, and tsc --noEmit.');",
        'NODE',
        'cat "$DIR/strictness-opportunities.md"',
      ].join('\n'),
      captureOutput: true,
      failOnError: true,
    })
    .step('write-final-summary', {
      type: 'deterministic',
      dependsOn: ['record-strictness-opportunities'],
      command: [
        `DIR=${artifactDir}`,
        "cat > \"$DIR/strict-typecheck-summary.md\" <<'EOF'",
        '# Strict typecheck outcome',
        '',
        'Completed gates:',
        '- Routing contract covers local, cloud, and MCP callers.',
        '- `tsconfig.json` has `strict: true` and `noEmit: true`.',
        '- Explicit TypeScript `any` annotations and casts were not found in source, tests, workflows, or scripts.',
        '- `npm run typecheck` passed.',
        '- `npx tsc --noEmit` passed.',
        '',
        'Evidence files:',
        '- routing.md',
        '- strict-typecheck-contract.md',
        '- tsconfig-strict-check.log',
        '- explicit-any-scan.log',
        '- npm-typecheck.log',
        '- tsc-noemit.log',
        '- strictness-opportunities.md',
        '',
        'STRICT_TYPECHECK_WORKFLOW_PASS',
        'EOF',
        'cat "$DIR/strict-typecheck-summary.md"',
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
