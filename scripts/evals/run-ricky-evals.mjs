#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createDefaultHumanEvalExecutors,
  createSkippedEvalError,
  defaultRedactActual,
  runHumanEvalCli,
} from '@agent-assistant/telemetry/evals';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DEFAULT_OPENCODE_MODEL = 'opencode/minimax-m2.5-free';
const { argv: evalArgv, executorOverride } = parseRickyEvalArgs(process.argv.slice(2));
const defaultExecutors = createDefaultHumanEvalExecutors(ROOT);

const exitCode = await runHumanEvalCli({
  argv: evalArgv,
  rootDir: ROOT,
  productName: 'Ricky Evals',
  runsDir: path.join(ROOT, '.ricky', 'evals', 'runs'),
  executors: {
    manual: executeManual,
    opencode: executeOpenCode,
    'ricky-cli': executeRickyCli,
  },
  defaultExecutor: 'manual',
  redactActual(actual) {
    const redacted = defaultRedactActual(actual);
    if (typeof redacted.content === 'string' && redacted.content.length > 4000) {
      redacted.content = `${redacted.content.slice(0, 4000)}\n...[truncated]`;
    }
    return redacted;
  },
});

process.exitCode = exitCode;

function executeManual(testCase, context) {
  if (context.providerMode && executorOverride === 'opencode') {
    return executeOpenCode(testCase, context);
  }
  return defaultExecutors.manual(testCase, context);
}

function executeOpenCode(testCase, context) {
  if (!context.providerMode) {
    throw createSkippedEvalError('opencode executor skipped; rerun with --provider or HUMAN_EVAL_PROVIDER=1');
  }

  const command = process.env.RICKY_EVAL_OPENCODE_BIN ?? 'opencode';
  const model = process.env.RICKY_EVAL_OPENCODE_MODEL ?? DEFAULT_OPENCODE_MODEL;
  const timeoutMs = readPositiveInt(process.env.RICKY_EVAL_OPENCODE_TIMEOUT_MS, 120_000);
  const prompt = buildOpenCodePrompt(testCase);
  const args = ['run'];
  if (model) args.push('-m', model);
  args.push(prompt);

  const startedAt = Date.now();
  const result = spawnSync(command, args, {
    cwd: context.rootDir,
    encoding: 'utf8',
    timeout: timeoutMs,
    env: {
      ...process.env,
      CI: '1',
      FORCE_COLOR: '0',
      NO_COLOR: '1',
    },
  });
  const durationMs = Date.now() - startedAt;

  if (result.error) {
    if (result.error.code === 'ENOENT') {
      throw createSkippedEvalError(`opencode executor skipped; '${command}' was not found in PATH`);
    }
    throw result.error;
  }

  const stdout = result.stdout?.trimEnd() ?? '';
  const stderr = result.stderr?.trimEnd() ?? '';
  const content = stdout || stderr || '';

  return {
    ok: result.status === 0,
    status: result.status === 0 ? 'completed' : `exit_${result.status ?? 'signal'}`,
    stopReason: result.signal ?? undefined,
    content,
    model,
    toolCalls: [],
    notes: `Ran local opencode one-shot with model ${model}; exit=${result.status ?? result.signal ?? 'unknown'}; durationMs=${durationMs}.`,
  };
}

function executeRickyCli(testCase, context) {
  const argvText = stringValue(testCase.mock?.argv) ?? stringValue(testCase.input.argv) ?? stringValue(testCase.input.message);
  if (!argvText) {
    throw new Error('ricky-cli executor requires Mock argv or Message');
  }

  const tsxBin = path.join(context.rootDir, 'node_modules', '.bin', process.platform === 'win32' ? 'tsx.cmd' : 'tsx');
  if (!existsSync(tsxBin)) {
    throw createSkippedEvalError('ricky-cli executor requires local node_modules/.bin/tsx; run npm install first');
  }

  const startedAt = Date.now();
  let workingDir = context.rootDir;
  let cleanupDir;
  const mockCwd = stringValue(testCase.mock?.cwd);
  if (mockCwd === 'temp') {
    cleanupDir = mkdtempSync(path.join(tmpdir(), 'ricky-cli-eval-'));
    workingDir = cleanupDir;
  } else if (mockCwd) {
    workingDir = path.resolve(context.rootDir, mockCwd);
  }
  const specFileContent = stringValue(testCase.mock?.specFileContent);
  let argv = splitArgv(argvText);
  if (specFileContent) {
    const specDir = path.join(workingDir, 'specs');
    const specPath = path.join(specDir, 'eval-spec.md');
    mkdirSync(specDir, { recursive: true });
    writeFileSync(specPath, `${decodeMockText(specFileContent)}\n`);
    argv = argv.map((arg) => arg.replaceAll('{{specFile}}', specPath));
  }
  const result = spawnSync(tsxBin, ['src/surfaces/cli/commands/cli-main.ts', ...argv], {
    cwd: context.rootDir,
    encoding: 'utf8',
    timeout: 20_000,
    env: {
      ...process.env,
      INIT_CWD: workingDir,
      CI: '1',
      FORCE_COLOR: '0',
      NO_COLOR: '1',
    },
  });
  const durationMs = Date.now() - startedAt;
  if (cleanupDir) {
    rmSync(cleanupDir, { recursive: true, force: true });
  }

  if (result.error) {
    throw result.error;
  }

  const stdout = result.stdout ?? '';
  const stderr = result.stderr ?? '';
  const content = [stdout.trimEnd(), stderr.trimEnd()].filter(Boolean).join('\n');

  return {
    ok: result.status === 0,
    status: `exit_${result.status ?? 'signal'}`,
    stopReason: result.signal ?? undefined,
    content,
    toolCalls: [
      {
        name: 'ricky-cli',
        argv,
        exitCode: result.status,
        signal: result.signal,
        durationMs,
      },
    ],
    notes: `Ran: tsx src/surfaces/cli/commands/cli-main.ts ${argv.join(' ')}`,
  };
}

function splitArgv(value) {
  const tokens = [];
  const pattern = /"([^"]*)"|'([^']*)'|[^\s]+/g;
  let match;
  while ((match = pattern.exec(value)) !== null) {
    tokens.push(match[1] ?? match[2] ?? match[0]);
  }
  return tokens;
}

function stringValue(value) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function decodeMockText(value) {
  return value.replaceAll('\\n', '\n');
}

function buildOpenCodePrompt(testCase) {
  const systemPrompt = stringValue(testCase.input.systemPrompt);
  const threadHistory = Array.isArray(testCase.input.threadHistory)
    ? testCase.input.threadHistory
    : [];
  const sections = [
    'You are Ricky, the AgentWorkforce workflow reliability, coordination, and authoring assistant.',
    [
      'Follow Ricky repository conventions from AGENTS.md, workflow standards, shared authoring rules, and product specs.',
      'Prefer concrete workflow contracts, deterministic verification gates, review artifacts, 80-to-100 validation loops, honest blocker reporting, and scoped branch/PR boundaries when the request involves workflow authoring or repair.',
      'Answer the user request directly. Do not mention this eval harness or hidden rubric.',
    ].join(' '),
  ];

  if (systemPrompt) {
    sections.push(`Additional system context:\n${systemPrompt}`);
  }
  if (threadHistory.length > 0) {
    sections.push(`Thread history:\n${JSON.stringify(threadHistory, null, 2)}`);
  }
  sections.push(`User request:\n${String(testCase.input.message ?? '').trim()}`);
  return sections.join('\n\n');
}

function readPositiveInt(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function parseRickyEvalArgs(argv) {
  const passthrough = [];
  let executorOverride;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--executor') {
      executorOverride = argv[index + 1];
      index += 1;
      continue;
    }
    passthrough.push(arg);
  }
  return { argv: passthrough, executorOverride };
}
