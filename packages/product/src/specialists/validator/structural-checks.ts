import type { FindingLocation, FindingSeverity, StructuralCheckName, StructuralFinding } from './types.js';

type Check = (text: string, context: StructuralContext) => StructuralFinding;

interface StructuralContext {
  lines: string[];
  declaredTargets: string[];
  regressionBlock: string;
}

const CHECKS: Check[] = [
  checkRelayShape,
  checkWorkflowFactory,
  checkDedicatedChannel,
  checkExplicitPattern,
  checkMaxConcurrency,
  checkTimeout,
  checkDeterministicSteps,
  checkDeterministicGates,
  checkReviewStage,
  checkDeliverables,
  checkNonGoals,
  checkVerificationLanguage,
  checkInitialSoftGate,
  checkFinalHardGate,
  checkEightyToHundredLoop,
  checkBuildTypecheckTestGate,
  checkRegressionGate,
  checkRunCwd,
  checkStalePrefixReviewGate,
  checkRegressionAllowlistScope,
];

export function runStructuralChecks(workflowText: string, workflowPath?: string): StructuralFinding[] {
  const context: StructuralContext = {
    lines: workflowText.split(/\r?\n/),
    declaredTargets: extractDeclaredTargets(workflowText),
    regressionBlock: extractNamedBlock(workflowText, 'regression'),
  };

  return CHECKS.map((check) => withWorkflowPath(check(workflowText, context), workflowPath));
}

function checkRelayShape(text: string, context: StructuralContext): StructuralFinding {
  const hasMain = /async\s+function\s+main\s*\(|const\s+main\s*=\s*async\s*\(/.test(text);
  const hasImport = /from\s+['"]@agent-relay\/sdk\/workflows['"]/.test(text);
  const hasRun = /\.run\s*\(/.test(text);
  const passed = hasMain && hasImport && hasRun;
  return finding({
    check: 'relay_shape',
    passed,
    severity: 'error',
    message: passed
      ? 'Workflow has the expected Relay import, async main, and run invocation.'
      : 'Workflow must have a Relay workflow import, async main, and run invocation.',
    location: firstLocation(context.lines, /async\s+function\s+main|@agent-relay\/sdk\/workflows|\.run\s*\(/),
    fixHint: "Use the standard Relay wrapper: import workflow, async function main(), await workflow(...), and .run({ cwd: process.cwd() }).",
  });
}

function checkWorkflowFactory(text: string, context: StructuralContext): StructuralFinding {
  const hasWorkflowFactory = /\bworkflow\s*\(\s*['"`][^'"`]+['"`]\s*\)/.test(text);
  const hasImport = /from\s+['"]@agent-relay\/sdk\/workflows['"]/.test(text);
  return finding({
    check: 'workflow_factory',
    passed: hasWorkflowFactory && hasImport,
    severity: 'error',
    message: hasWorkflowFactory && hasImport
      ? 'Workflow uses the Agent Relay workflow() factory.'
      : 'Workflow must import and use workflow() from @agent-relay/sdk/workflows.',
    location: firstLocation(context.lines, /workflow\s*\(|@agent-relay\/sdk\/workflows/),
    fixHint: "Import { workflow } from '@agent-relay/sdk/workflows' and construct the workflow with workflow('ricky-...').",
  });
}

function checkDedicatedChannel(text: string, context: StructuralContext): StructuralFinding {
  const channelMatch = text.match(/\.channel\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/);
  const channel = channelMatch?.[1];
  const passed = typeof channel === 'string' && /^wf-ricky-[a-z0-9-]+$/.test(channel);
  return finding({
    check: 'dedicated_channel',
    passed,
    severity: 'error',
    message: passed
      ? `Workflow uses dedicated Ricky channel ${channel}.`
      : 'Workflow must use a dedicated wf-ricky-* channel, not general or an implicit default.',
    location: firstLocation(context.lines, /\.channel\s*\(/),
    fixHint: "Add .channel('wf-ricky-<wave-or-feature>') to isolate workflow coordination traffic.",
  });
}

function checkExplicitPattern(text: string, context: StructuralContext): StructuralFinding {
  return regexCheck({
    text,
    context,
    check: 'explicit_pattern',
    pattern: /\.pattern\s*\(\s*['"`](dag|pipeline|parallel|swarm|sequential)['"`]\s*\)/,
    messagePass: 'Workflow declares an explicit execution pattern.',
    messageFail: 'Workflow must declare an explicit pattern so orchestration tradeoffs are reviewable.',
    fixHint: "Add .pattern('dag') or another deliberate Relay pattern.",
  });
}

function checkMaxConcurrency(text: string, context: StructuralContext): StructuralFinding {
  return regexCheck({
    text,
    context,
    check: 'max_concurrency',
    pattern: /\.maxConcurrency\s*\(\s*\d+\s*\)/,
    messagePass: 'Workflow declares maxConcurrency.',
    messageFail: 'Workflow must set maxConcurrency explicitly.',
    fixHint: 'Add .maxConcurrency(<bounded number>) near the workflow builder setup.',
  });
}

function checkTimeout(text: string, context: StructuralContext): StructuralFinding {
  return regexCheck({
    text,
    context,
    check: 'timeout',
    pattern: /\.timeout\s*\(\s*[\d_]+\s*\)/,
    messagePass: 'Workflow declares a timeout.',
    messageFail: 'Workflow must set an explicit timeout.',
    fixHint: 'Add .timeout(<milliseconds>) to bound long-running validation loops.',
  });
}

function checkDeterministicSteps(text: string, context: StructuralContext): StructuralFinding {
  const passed = /type\s*:\s*['"`]deterministic['"`]/.test(text);
  return finding({
    check: 'deterministic_steps',
    passed,
    severity: 'error',
    message: passed
      ? 'Workflow includes deterministic verification steps.'
      : 'Workflow must include type: deterministic steps for gates and validation, not only agent tasks or named gates.',
    location: firstLocation(context.lines, /type\s*:\s*['"`]deterministic['"`]|gate|verify|validation|typecheck|test|regression/i),
    fixHint: "Add deterministic .step(...) gates with commands and failOnError settings.",
  });
}

function checkDeterministicGates(text: string, context: StructuralContext): StructuralFinding {
  const passed = /verification\s*:|failOnError\s*:\s*(true|false)|type\s*:\s*['"`](file_exists|exit_code|output_contains|deterministic)['"`]/.test(text);
  return finding({
    check: 'deterministic_gates',
    passed,
    severity: 'error',
    message: passed
      ? 'Workflow includes deterministic gate semantics.'
      : 'Workflow must include deterministic verification gates with explicit pass/fail semantics.',
    location: firstLocation(context.lines, /verification\s*:|failOnError\s*:|type\s*:\s*['"`](file_exists|exit_code|output_contains|deterministic)['"`]/),
    fixHint: 'Add file_exists, exit_code, output_contains, or deterministic command gates with failOnError settings.',
  });
}

function checkReviewStage(text: string, context: StructuralContext): StructuralFinding {
  return regexCheck({
    text,
    context,
    check: 'review_stage',
    pattern: /review(?:er|-claude|-codex|-pass| stage| checklist)/i,
    messagePass: 'Workflow includes a review stage.',
    messageFail: 'Workflow must include reviewer stages before final signoff.',
    fixHint: 'Add review steps and gate their pass markers before final hard validation.',
  });
}

function checkDeliverables(text: string, context: StructuralContext): StructuralFinding {
  return regexCheck({
    text,
    context,
    check: 'deliverables',
    pattern: /deliverables?/i,
    severity: 'warning',
    messagePass: 'Workflow states deliverables.',
    messageFail: 'Workflow should state deliverables explicitly.',
    fixHint: 'Add a Deliverables section to the implementation task prompt.',
  });
}

function checkNonGoals(text: string, context: StructuralContext): StructuralFinding {
  return regexCheck({
    text,
    context,
    check: 'non_goals',
    pattern: /non[-_\s]?goals?/i,
    severity: 'warning',
    messagePass: 'Workflow states non-goals.',
    messageFail: 'Workflow should state non-goals explicitly.',
    fixHint: 'Add a Non-goals section so implementers avoid broadening scope.',
  });
}

function checkVerificationLanguage(text: string, context: StructuralContext): StructuralFinding {
  return regexCheck({
    text,
    context,
    check: 'verification_language',
    pattern: /verification\s*:|type\s*:\s*['"`](file_exists|exit_code|output_contains|deterministic)['"`]|captureOutput|failOnError|grep|test\s+-f|npx\s+(tsc|vitest)/i,
    messagePass: 'Workflow includes deterministic verification language.',
    messageFail: 'Workflow must use explicit verification language and command expectations.',
    fixHint: 'Add verification objects or deterministic shell gates with concrete expected outcomes.',
  });
}

function checkInitialSoftGate(text: string, context: StructuralContext): StructuralFinding {
  const softLine = indexOfLine(context.lines, /failOnError\s*:\s*false|initial-soft|soft-validation|soft run|dry-run/i);
  const hardLine = indexOfLine(context.lines, /failOnError\s*:\s*true|final-hard|hard-gate/i);
  const passed = softLine >= 0 && (hardLine < 0 || softLine <= hardLine);
  return finding({
    check: 'initial_soft_gate',
    passed,
    severity: 'error',
    message: passed
      ? 'Workflow has an initial soft gate before hard signoff gates.'
      : 'Workflow must include an initial failOnError: false soft gate before final hard gates.',
    location: lineLocation(context.lines, softLine),
    fixHint: 'Add an initial validation/dry-run step with captureOutput: true and failOnError: false.',
  });
}

function checkFinalHardGate(text: string, context: StructuralContext): StructuralFinding {
  const finalGateLine = indexOfLine(context.lines, /\.step\s*\(\s*['"`][^'"`]*(final-hard|hard-gate|final[- ]validation|final[- ]validate|final-gate)[^'"`]*['"`]/i);
  const finalPassLine = indexOfLine(context.lines, /\.step\s*\(\s*['"`]final-review-pass-gate['"`]|FINAL_REVIEW_[A-Z_]+_PASS/i);
  const hardFailLine = indexOfLineAfter(context.lines, Math.max(finalGateLine, finalPassLine), /failOnError\s*:\s*true/);
  const hasFinalHardName = finalGateLine >= 0;
  const hasHardFailureSemantics = hardFailLine >= 0 || (finalGateLine >= 0 && context.lines.slice(finalGateLine, finalGateLine + 12).some((line) => /failOnError\s*:\s*true/.test(line)));
  const passed = hasFinalHardName && hasHardFailureSemantics && (finalPassLine < 0 || finalGateLine > finalPassLine);
  return finding({
    check: 'final_hard_gate',
    passed,
    severity: 'error',
    message: passed
      ? 'Workflow has a final hard gate after final review signoff.'
      : 'Workflow must include a final failOnError: true hard gate after the final-review-pass-gate.',
    location: firstLocation(context.lines, /final-hard|hard-gate|failOnError\s*:\s*true/i),
    fixHint: 'Add a final deterministic validation step with failOnError: true after final review-pass-gate.',
  });
}

function checkEightyToHundredLoop(text: string, context: StructuralContext): StructuralFinding {
  const hasSoft = /failOnError\s*:\s*false|initial-soft|soft-validation|dry-run/i.test(text);
  const hasFix = /fix-loop|post-fix|fixes|bounded fixes/i.test(text);
  const hasFinalReview = /final-review|re-review|final re-review/i.test(text);
  const hasHard = /failOnError\s*:\s*true|final-hard|hard-gate/i.test(text);
  const passed = hasSoft && hasFix && hasFinalReview && hasHard;
  return finding({
    check: 'eighty_to_hundred_loop',
    passed,
    severity: 'error',
    message: passed
      ? 'Workflow models the 80-to-100 soft-run, fix-loop, final-review, hard-gate sequence.'
      : 'Workflow must model initial soft validation, fix loop, post-fix/final review, and final hard gate.',
    location: firstLocation(context.lines, /initial-soft|soft-validation|fix-loop|final-review|final-hard|failOnError/i),
    fixHint: 'Use the sequence: initial soft validation -> review -> fix-loop -> post-fix validation -> final-review -> final-review-pass-gate -> final-hard-gate.',
  });
}

function checkBuildTypecheckTestGate(text: string, context: StructuralContext): StructuralFinding {
  return regexCheck({
    text,
    context,
    check: 'build_typecheck_test_gate',
    pattern: /build-typecheck-gate|typecheck|npx\s+tsc\s+--noEmit|npm\s+run\s+(typecheck|build|test)|npx\s+vitest\s+run/i,
    messagePass: 'Workflow includes build/typecheck/test gate language.',
    messageFail: 'Workflow must include a build, typecheck, or test gate before signoff.',
    fixHint: 'Add a deterministic gate that runs npx tsc --noEmit, npx vitest run, or the project build/test command.',
  });
}

function checkRegressionGate(text: string, context: StructuralContext): StructuralFinding {
  const hasRegressionGate = /regression-gate|regression-scope-gate|regression gate|changed="\$\(git diff --name-only; git ls-files --others --exclude-standard\)"/i.test(text);
  if (!hasRegressionGate) {
    return finding({
      check: 'regression_gate',
      passed: false,
      severity: 'error',
      message: 'Workflow must include a scoped regression gate before final signoff.',
      location: firstLocation(context.lines, /regression/i),
      fixHint: 'Add a regression gate that rejects unrelated tracked and untracked file changes.',
    });
  }

  const regressionBlock = context.regressionBlock;
  const hasFailClosedLogic = /!\s*grep\s+-Ev|if\s+.*grep\s+-Ev.*;\s*then\s+exit\s+1|grep\s+-Ev[^|]*\|\s*(?:xargs\s+test\s+-z|wc\s+-l.*-eq\s+0)/.test(regressionBlock);
  const passed = hasRegressionGate && hasFailClosedLogic;
  return finding({
    check: 'regression_gate',
    passed,
    severity: 'error',
    message: passed
      ? 'Workflow includes a regression gate with fail-closed shell logic.'
      : 'Regression gate must use fail-closed shell logic so out-of-scope files cause the gate to fail (e.g., pipe grep -Ev output to a failOnError: true step, or use "! grep -Ev ...").',
    location: firstLocation(context.lines, /regression-gate|regression-scope-gate|grep -Ev/i),
    fixHint: 'Ensure the regression gate exits non-zero when out-of-scope files exist. With grep -Ev in a failOnError: true step, matching lines (out-of-scope paths) cause exit 0, which passes the gate incorrectly. Use "! grep -Ev" or "if grep -Ev ...; then exit 1; fi" instead.',
  });
}

function checkRunCwd(text: string, context: StructuralContext): StructuralFinding {
  return regexCheck({
    text,
    context,
    check: 'run_cwd',
    pattern: /\.run\s*\(\s*\{\s*cwd\s*:\s*process\.cwd\s*\(\s*\)\s*\}\s*\)/,
    messagePass: 'Workflow runs with cwd: process.cwd().',
    messageFail: 'Workflow must end with .run({ cwd: process.cwd() }).',
    fixHint: 'Call .run({ cwd: process.cwd() }) on the workflow builder.',
  });
}

function checkStalePrefixReviewGate(text: string, context: StructuralContext): StructuralFinding {
  const fixLine = indexOfLine(context.lines, /\.step\s*\(\s*['"`]fix-loop['"`]/i);
  const postFixLine = indexOfLineAfter(context.lines, fixLine, /\.step\s*\(\s*['"`][^'"`]*post-fix[^'"`]*(validation|gate)[^'"`]*['"`]/i);
  const finalReviewLine = indexOfLine(context.lines, /\.step\s*\(\s*['"`]final-review[^'"`]*['"`]/i);
  const finalPassLine = indexOfLine(context.lines, /\.step\s*\(\s*['"`]final-review-pass-gate['"`]|FINAL_REVIEW_[A-Z_]+_PASS/i);
  const tailAfterFixValidation = postFixLine >= 0 ? context.lines.slice(postFixLine).join('\n') : '';
  const checksInitialReviewAfterFix = hasInitialReviewEvidence(tailAfterFixValidation);
  const orderedFinalReview =
    fixLine >= 0 &&
    postFixLine > fixLine &&
    finalReviewLine > postFixLine &&
    finalPassLine > finalReviewLine;
  const passed = fixLine < 0 || (orderedFinalReview && !checksInitialReviewAfterFix);
  return finding({
    check: 'stale_prefix_review_gate',
    passed,
    severity: 'error',
    message: passed
      ? 'Workflow gates final signoff on post-fix final re-review.'
      : 'Workflow must use fix -> post-fix validation -> final-review -> final-review-pass-gate and must not reuse pre-fix review verdicts after the fix loop.',
    location: lineLocation(context.lines, checksInitialReviewAfterFix ? fixLine : Math.max(fixLine, postFixLine, finalReviewLine, finalPassLine)),
    fixHint: 'Use fix-loop -> post-fix validation -> final-review -> final-review-pass-gate, and check FINAL_REVIEW_*_PASS markers after fixes.',
  });
}

function checkRegressionAllowlistScope(_text: string, context: StructuralContext): StructuralFinding {
  if (!context.regressionBlock) {
    return finding({
      check: 'regression_allowlist_scope',
      passed: true,
      severity: 'warning',
      message: 'No regression block found for allowlist scope analysis.',
      blocking: false,
      fixHint: 'Add a scoped regression gate if this workflow changes files.',
    });
  }

  const allowedPaths = extractAllowedPathPrefixes(context.regressionBlock);
  const outOfScope = allowedPaths.filter((path) => !isAllowedRegressionPath(path, context.declaredTargets));
  const passed = outOfScope.length === 0;
  return finding({
    check: 'regression_allowlist_scope',
    passed,
    severity: 'warning',
    blocking: false,
    message: passed
      ? 'Regression allowlist is limited to declared targets and .workflow-artifacts/.'
      : `Regression allowlist includes broad or undeclared paths: ${outOfScope.join(', ')}.`,
    location: firstLocation(context.lines, /regression-gate|regression-scope-gate|grep -Ev|grep -Eq/i),
    fixHint: 'Restrict regression allowlists to exact declared target paths plus .workflow-artifacts/, or validate an explicit dependency-change manifest.',
  });
}

function regexCheck(input: {
  text: string;
  context: StructuralContext;
  check: StructuralCheckName;
  pattern: RegExp;
  severity?: FindingSeverity;
  messagePass: string;
  messageFail: string;
  fixHint: string;
}): StructuralFinding {
  const passed = input.pattern.test(input.text);
  return finding({
    check: input.check,
    passed,
    severity: input.severity ?? 'error',
    message: passed ? input.messagePass : input.messageFail,
    location: firstLocation(input.context.lines, input.pattern),
    fixHint: input.fixHint,
  });
}

function finding(input: {
  check: StructuralCheckName;
  passed: boolean;
  severity: FindingSeverity;
  message: string;
  blocking?: boolean;
  location?: FindingLocation;
  fixHint: string;
}): StructuralFinding {
  return {
    check: input.check,
    passed: input.passed,
    severity: input.severity,
    message: input.message,
    blocking: input.blocking ?? (!input.passed && input.severity === 'error'),
    location: input.location,
    path: input.location?.path,
    fixHint: input.fixHint,
  };
}

function withWorkflowPath(finding: StructuralFinding, workflowPath: string | undefined): StructuralFinding {
  if (!workflowPath) return finding;
  return {
    ...finding,
    path: finding.path ?? workflowPath,
    location: finding.location
      ? {
          ...finding.location,
          path: finding.location.path ?? workflowPath,
        }
      : undefined,
  };
}

function firstLocation(lines: string[], pattern: RegExp): FindingLocation | undefined {
  const lineIndex = indexOfLine(lines, pattern);
  return lineLocation(lines, lineIndex);
}

function indexOfLine(lines: string[], pattern: RegExp): number {
  return lines.findIndex((line) => pattern.test(line));
}

function indexOfLineAfter(lines: string[], lineIndex: number, pattern: RegExp): number {
  if (lineIndex < 0) return -1;
  const offset = lineIndex + 1;
  const relativeIndex = lines.slice(offset).findIndex((line) => pattern.test(line));
  return relativeIndex < 0 ? -1 : offset + relativeIndex;
}

function lineLocation(lines: string[], lineIndex: number): FindingLocation | undefined {
  if (lineIndex < 0) return undefined;
  return {
    line: lineIndex + 1,
    column: 1,
    snippet: lines[lineIndex]?.trim(),
  };
}

function hasInitialReviewEvidence(text: string): boolean {
  return text
    .split(/\r?\n/)
    .some((line) => {
      const withoutFinalReviewMarkers = line
        .replace(/FINAL_REVIEW_(?:CLAUDE|CODEX)_PASS/g, '')
        .replace(/final-review-(?:claude|codex)\.md/g, '');
      return /REVIEW_(?:CLAUDE|CODEX)_PASS|review-(?:claude|codex)\.md/.test(withoutFinalReviewMarkers);
    });
}

function extractNamedBlock(text: string, name: string): string {
  const lines = text.split(/\r?\n/);
  const stepPattern = new RegExp(`\\.step\\s*\\(\\s*['"\`][^'"\`]*${name}[^'"\`]*['"\`]`, 'i');
  const start = lines.findIndex((line) => stepPattern.test(line));
  if (start >= 0) {
    return lines.slice(start, Math.min(lines.length, start + 35)).join('\n');
  }

  const fallbackStart = lines.findIndex((line) => new RegExp(`${name}[^'"\n]*gate|${name}`, 'i').test(line));
  if (fallbackStart < 0) return '';
  return lines.slice(fallbackStart, Math.min(lines.length, fallbackStart + 35)).join('\n');
}

function extractDeclaredTargets(text: string): string[] {
  const targets = new Set<string>();
  const ownOnlyBlock = text.match(/Own only:\s*([\s\S]*?)(?:\n\s*\n|Requirements:|Review checklist:|After editing|Verification:|Non-goals:|$)/i)?.[1] ?? '';
  for (const path of extractPaths(ownOnlyBlock)) {
    targets.add(normalizePath(path));
  }

  const fileTargetsBlocks = text.match(/(?:fileTargets|targetFiles|filesLikelyTouched|allowed scope|declared file targets)[\s\S]{0,500}/gi) ?? [];
  for (const block of fileTargetsBlocks) {
    for (const path of extractPaths(block)) {
      targets.add(normalizePath(path));
    }
  }

  return [...targets].filter(Boolean);
}

function extractPaths(text: string): string[] {
  const matches = text.match(/(?:\.?[A-Za-z0-9_.-]+\/)+(?:[A-Za-z0-9_.-]+|\*)/g) ?? [];
  return matches
    .map((path) => path.replace(/^['"`-]+|['"`,]+$/g, ''))
    .filter((path) => !path.startsWith('http') && !path.includes('{{') && !path.includes('dry-run') && !path.includes('typecheck'));
}

function extractAllowedPathPrefixes(regressionBlock: string): string[] {
  const regexBodies = [...regressionBlock.matchAll(/grep\s+-E[vq]?\s+["']([^"']+)["']/g)].map((match) => match[1] ?? '');
  const source = regexBodies.length > 0 ? regexBodies.join('|') : regressionBlock;
  const paths = extractPaths(source.replace(/\\\./g, '.').replace(/\\\//g, '/'));
  return [...new Set(paths.map(normalizePath))];
}

function normalizePath(path: string): string {
  return path
    .trim()
    .replace(/\\\./g, '.')
    .replace(/\\\//g, '/')
    .replace(/^\^/, '')
    .replace(/\$$/, '')
    .replace(/\/\.\*$/, '/')
    .replace(/\/\.$/, '')
    .replace(/\.\*$/, '')
    .replace(/\(\?:?/g, '')
    .replace(/[()|]+$/g, '')
    .replace(/^['"`]+|['"`]+$/g, '');
}

function isAllowedRegressionPath(path: string, declaredTargets: string[]): boolean {
  if (path === '.workflow-artifacts' || path.startsWith('.workflow-artifacts/')) return true;
  if (declaredTargets.length === 0) return false;
  return declaredTargets.some((target) => {
    if (target.endsWith('/')) {
      return path === target || path.startsWith(target);
    }
    return path === target;
  });
}
