#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createSkippedEvalError,
  defaultRedactActual,
  runHumanEvalCli,
} from '@agent-assistant/telemetry/evals';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const exitCode = await runHumanEvalCli({
  argv: process.argv.slice(2),
  rootDir: ROOT,
  productName: 'Ricky Evals',
  runsDir: path.join(ROOT, '.ricky', 'evals', 'runs'),
  executors: {
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
  const argv = splitArgv(argvText);
  const result = spawnSync(tsxBin, ['src/surfaces/cli/commands/cli-main.ts', ...argv], {
    cwd: context.rootDir,
    encoding: 'utf8',
    timeout: 20_000,
    env: {
      ...process.env,
      CI: '1',
      FORCE_COLOR: '0',
      NO_COLOR: '1',
    },
  });
  const durationMs = Date.now() - startedAt;

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
