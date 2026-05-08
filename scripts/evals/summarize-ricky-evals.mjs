#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const RUNS_DIR = path.join(ROOT, '.ricky', 'evals', 'runs');

const runs = loadRuns();
if (runs.length === 0) {
  console.log('No Ricky eval runs yet. Run: npm run evals');
  process.exit(0);
}

console.log('');
console.log(`Ricky Eval History (${runs.length} runs)`);
console.log('='.repeat(96));
console.log(`${'Date'.padEnd(20)}${'Branch'.padEnd(24)}${'Mode'.padEnd(10)}${'Pass'.padEnd(10)}${'Human'.padEnd(10)}${'Fail'.padEnd(8)}Duration`);
console.log('-'.repeat(96));

for (const run of runs.slice(0, 20)) {
  const date = String(run.timestamp ?? '').replace('T', ' ').slice(0, 19).padEnd(20);
  const branch = String(run.branch ?? 'unknown').slice(0, 22).padEnd(24);
  const mode = String(run.mode ?? 'unknown').padEnd(10);
  const pass = `${run.passed ?? 0}/${run.total_trials ?? 0}`.padEnd(10);
  const human = String(run.needs_human ?? 0).padEnd(10);
  const fail = String(run.failed ?? 0).padEnd(8);
  const duration = `${Math.round((run.total_duration_ms ?? 0) / 1000)}s`;
  console.log(`${date}${branch}${mode}${pass}${human}${fail}${duration}`);
}

function loadRuns() {
  if (!existsSync(RUNS_DIR)) return [];
  return readdirSync(RUNS_DIR)
    .map((dir) => path.join(RUNS_DIR, dir, 'result.json'))
    .filter((file) => existsSync(file))
    .map((file) => JSON.parse(readFileSync(file, 'utf8')))
    .sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)));
}
