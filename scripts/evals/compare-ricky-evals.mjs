#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const RUNS_DIR = path.join(ROOT, '.ricky', 'evals', 'runs');

const runs = loadRuns();
if (runs.length < 2) {
  console.log('Need at least two Ricky eval runs to compare.');
  process.exit(0);
}

const [after, before] = runs;
const beforeById = new Map(before.tests.map((test) => [`${test.id}#${test.trial}`, test]));
const seenBeforeKeys = new Set();

console.log('');
console.log('Ricky Eval Compare');
console.log('='.repeat(80));
console.log(`Before: ${before.timestamp} ${before.branch} ${before.mode}`);
console.log(`After:  ${after.timestamp} ${after.branch} ${after.mode}`);
console.log('-'.repeat(80));

let improved = 0;
let regressed = 0;
let unchanged = 0;
let disappeared = 0;

for (const afterTest of after.tests) {
  const key = `${afterTest.id}#${afterTest.trial}`;
  const beforeTest = beforeById.get(key);
  if (!beforeTest) {
    console.log(`NEW       ${afterTest.status.padEnd(11)} ${afterTest.id}`);
    continue;
  }
  seenBeforeKeys.add(key);
  const status = compareStatus(beforeTest.status, afterTest.status);
  if (status === 'improved') improved += 1;
  else if (status === 'regressed') regressed += 1;
  else unchanged += 1;
  const marker = status === 'improved' ? 'UP' : status === 'regressed' ? 'DOWN' : '=';
  console.log(`${marker.padEnd(9)} ${beforeTest.status.padEnd(11)} -> ${afterTest.status.padEnd(11)} ${afterTest.id}`);
}

for (const [key, beforeTest] of beforeById.entries()) {
  if (seenBeforeKeys.has(key)) continue;
  disappeared += 1;
  regressed += 1;
  console.log(`MISSING   ${beforeTest.status.padEnd(11)} -> disappeared ${beforeTest.id}`);
}

console.log('-'.repeat(80));
console.log(`Improved: ${improved} | Regressed: ${regressed} | Unchanged: ${unchanged} | Disappeared: ${disappeared}`);

function loadRuns() {
  if (!existsSync(RUNS_DIR)) return [];
  return readdirSync(RUNS_DIR)
    .map((dir) => path.join(RUNS_DIR, dir, 'result.json'))
    .filter((file) => existsSync(file))
    .map((file) => JSON.parse(readFileSync(file, 'utf8')))
    .sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)));
}

function compareStatus(beforeStatus, afterStatus) {
  const rank = { failed: 0, skipped: 1, 'needs-human': 2, passed: 3 };
  const beforeRank = rank[beforeStatus] ?? 0;
  const afterRank = rank[afterStatus] ?? 0;
  if (afterRank > beforeRank) return 'improved';
  if (afterRank < beforeRank) return 'regressed';
  return 'unchanged';
}
