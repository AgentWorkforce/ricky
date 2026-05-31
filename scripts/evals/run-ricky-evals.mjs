#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
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
const DEFAULT_OPENROUTER_MODEL = 'openai/gpt-oss-120b:free';
const OPENROUTER_CHAT_COMPLETIONS_ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';
const OPENROUTER_PROVIDER_INFRA_SKIP_PREFIX = 'openrouter executor skipped; transient provider infrastructure unavailable';
const { argv: evalArgv, executorOverride } = parseRickyEvalArgs(process.argv.slice(2));
const defaultExecutors = createDefaultHumanEvalExecutors(ROOT);

const exitCode = await runHumanEvalCli({
  argv: evalArgv,
  rootDir: ROOT,
  productName: 'Ricky Evals',
  runsDir: path.join(ROOT, '.ricky', 'evals', 'runs'),
  executors: {
    manual: executeManual,
    openrouter: executeOpenRouter,
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
  if (executorOverride === 'openrouter') {
    return executeOpenRouter(testCase, context);
  }
  if (executorOverride === 'opencode') {
    return executeOpenCode(testCase, context);
  }
  return defaultExecutors.manual(testCase, context);
}

async function executeOpenRouter(testCase, context) {
  if (!context.providerMode) {
    throw createSkippedEvalError('openrouter executor skipped; rerun with --provider or HUMAN_EVAL_PROVIDER=1');
  }

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw createSkippedEvalError('openrouter executor skipped; OPENROUTER_API_KEY is missing');
  }

  const model = process.env.RICKY_EVAL_OPENROUTER_MODEL ?? DEFAULT_OPENROUTER_MODEL;
  const timeoutMs = readPositiveInt(process.env.RICKY_EVAL_OPENROUTER_TIMEOUT_MS, 120_000);
  const maxAttempts = readPositiveInt(process.env.RICKY_EVAL_OPENROUTER_MAX_ATTEMPTS, 3);
  const maxTokens = readPositiveInt(process.env.RICKY_EVAL_OPENROUTER_MAX_TOKENS, 1200);
  const startedAt = Date.now();
  const emptyAttempts = [];

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const { content, note } = await runOpenRouterAttempt({
        apiKey,
        model,
        timeoutMs,
        maxTokens,
        testCase,
      });
      if (content) {
        const durationMs = Date.now() - startedAt;
        return {
          ok: true,
          status: 'completed',
          content,
          model,
          toolCalls: [],
          notes: `Ran OpenRouter eval with model ${model}; attempts=${attempt}; durationMs=${durationMs}.${note ? ` ${note}` : ''}`,
        };
      }
      emptyAttempts.push(`attempt ${attempt}: ${note || 'empty content'}`);
    } catch (error) {
      if (attempt >= maxAttempts || !isRetryableOpenRouterError(error)) {
        if (isRetryableOpenRouterError(error)) {
          const message = error instanceof Error ? error.message : String(error);
          throw createSkippedEvalError(
            `${OPENROUTER_PROVIDER_INFRA_SKIP_PREFIX} after ${maxAttempts} attempts for ${testCase.id}: ${message}`,
          );
        }
        throw error;
      }
      emptyAttempts.push(`attempt ${attempt}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return {
    ok: false,
    status: 'completed',
    content: [
      `OpenRouter returned an empty response after ${maxAttempts} attempts for ${testCase.id}.`,
      'This provider response is reviewable as an infrastructure-quality signal, but it is not a Ricky product answer.',
      '',
      'Attempts:',
      ...emptyAttempts.map((attempt) => `- ${attempt}`),
    ].join('\n'),
    model,
    toolCalls: [],
    notes: `OpenRouter empty response fallback after ${maxAttempts} attempts; durationMs=${Date.now() - startedAt}.`,
  };
}

async function runOpenRouterAttempt({ apiKey, model, timeoutMs, maxTokens, testCase }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(OPENROUTER_CHAT_COMPLETIONS_ENDPOINT, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
        'http-referer': process.env.GITHUB_SERVER_URL
          ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY ?? ''}`
          : 'https://github.com/AgentWorkforce/ricky',
        'x-title': 'Ricky Evals',
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        max_tokens: maxTokens,
        messages: [
          {
            role: 'system',
            content: [
              'You are Ricky, the AgentWorkforce workflow reliability, coordination, and authoring assistant.',
              'Follow Ricky repository conventions from AGENTS.md, workflow standards, shared authoring rules, and product specs.',
              'Answer the user request directly. Keep the answer concise and under 700 words.',
              'Do not mention this eval harness or hidden rubric.',
            ].join(' '),
          },
          {
            role: 'user',
            content: buildProviderPrompt(testCase),
          },
        ],
      }),
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const detail = typeof payload?.error?.message === 'string' ? payload.error.message : JSON.stringify(payload);
      const error = new Error(`OpenRouter eval failed: ${response.status} ${detail}`);
      error.status = response.status;
      throw error;
    }

    const choice = payload?.choices?.[0];
    const content = contentFromOpenRouterChoice(choice);
    const finishReason = typeof choice?.finish_reason === 'string' ? choice.finish_reason : undefined;
    return {
      content,
      note: finishReason ? `finish_reason=${finishReason}` : undefined,
    };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      const timeoutError = new Error(`OpenRouter eval timed out after ${timeoutMs}ms.`);
      timeoutError.retryable = true;
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function contentFromOpenRouterChoice(choice) {
  const message = choice?.message;
  const direct = typeof message?.content === 'string' ? message.content.trim() : '';
  if (direct) return direct;

  const contentParts = Array.isArray(message?.content) ? message.content : [];
  const fromParts = contentParts
    .map((part) => {
      if (typeof part === 'string') return part;
      if (typeof part?.text === 'string') return part.text;
      if (typeof part?.content === 'string') return part.content;
      return '';
    })
    .join('\n')
    .trim();
  if (fromParts) return fromParts;

  return '';
}

function isRetryableOpenRouterError(error) {
  if (!(error instanceof Error)) return false;
  const status = typeof error.status === 'number' ? error.status : undefined;
  return error.retryable === true || error.name === 'AbortError' || status === 408 || status === 409 || status === 429 || (status !== undefined && status >= 500);
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
  if (result.error) {
    if (cleanupDir) {
      rmSync(cleanupDir, { recursive: true, force: true });
    }
    throw result.error;
  }

  const stdout = result.stdout ?? '';
  const stderr = result.stderr ?? '';
  const artifactContent = testCase.mock?.includeGeneratedArtifacts === true
    ? readGeneratedArtifactContent(stdout, workingDir)
    : '';
  const content = [stdout.trimEnd(), stderr.trimEnd(), artifactContent].filter(Boolean).join('\n');
  if (cleanupDir) {
    rmSync(cleanupDir, { recursive: true, force: true });
  }

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

function readGeneratedArtifactContent(stdout, workingDir) {
  const artifactPaths = generatedArtifactPathsFromStdout(stdout);
  const sections = [];
  const realWorkingDir = safeRealpath(workingDir);
  if (!realWorkingDir) return '';
  for (const artifactPath of artifactPaths) {
    for (const generatedPath of generatedArtifactAndSidecarPaths(artifactPath)) {
      const fullPath = path.resolve(workingDir, generatedPath);
      if (!existsSync(fullPath)) continue;
      const realFullPath = safeRealpath(fullPath);
      if (!realFullPath) continue;
      if (realFullPath !== realWorkingDir && !realFullPath.startsWith(`${realWorkingDir}${path.sep}`)) {
        continue;
      }
      try {
        if (!statSync(realFullPath).isFile()) continue;
      } catch {
        continue;
      }
      sections.push([
        `\n--- GENERATED ARTIFACT: ${generatedPath} ---`,
        readFileSync(realFullPath, 'utf8'),
      ].join('\n'));
    }
  }
  return sections.join('\n');
}

function generatedArtifactAndSidecarPaths(artifactPath) {
  const paths = [artifactPath];
  if (artifactPath.startsWith('workflows/generated/') && artifactPath.endsWith('.ts')) {
    const stem = artifactPath.slice(0, -'.ts'.length);
    paths.push(`${stem}.spec.md`, `${stem}.children.json`);
  }
  return paths;
}

function safeRealpath(value) {
  try {
    return realpathSync(value);
  } catch {
    return null;
  }
}

function generatedArtifactPathsFromStdout(stdout) {
  const paths = new Set();
  const parsed = parseJson(stdout);
  const records = Array.isArray(parsed) ? parsed : parsed ? [parsed] : [];
  for (const record of records) {
    const artifactPath = stringValue(record?.artifact?.path);
    if (artifactPath) paths.add(artifactPath);
    for (const artifact of Array.isArray(record?.artifacts) ? record.artifacts : []) {
      const pathValue = stringValue(artifact?.path);
      if (pathValue) paths.add(pathValue);
    }
  }
  return [...paths].filter((artifactPath) => artifactPath.startsWith('workflows/generated/') && artifactPath.endsWith('.ts'));
}

function parseJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
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
  return buildProviderPrompt(testCase);
}

function buildProviderPrompt(testCase) {
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
