#!/usr/bin/env node

import { spawn } from 'node:child_process';

const steps = [
  { label: 'typecheck', command: './node_modules/.bin/tsc', args: ['--noEmit'] },
  { label: 'full-test-suite', command: './node_modules/.bin/vitest', args: ['run'] },
  {
    label: 'local-auto-fix-ladder-e2e',
    command: './node_modules/.bin/vitest',
    args: ['run', 'test/local-auto-fix-workflow-failures.e2e.test.ts'],
  },
];

function runStep(step) {
  return new Promise((resolve, reject) => {
    const child = spawn(step.command, step.args, {
      cwd: process.cwd(),
      env: process.env,
      stdio: 'inherit',
      shell: false,
    });

    child.on('error', (error) => {
      reject(new Error(`${step.label} failed to start: ${error.message}`));
    });

    child.on('exit', (code, signal) => {
      if (signal) {
        reject(new Error(`${step.label} exited from signal ${signal}`));
        return;
      }
      if (code !== 0) {
        reject(new Error(`${step.label} exited with code ${code ?? 'unknown'}`));
        return;
      }
      resolve();
    });
  });
}

for (const step of steps) {
  console.log(`[premerge] starting ${step.label}`);
  await runStep(step);
  console.log(`[premerge] completed ${step.label}`);
}
