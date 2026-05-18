#!/usr/bin/env node

import { runRickyCli } from '../../../sdk/index.js';

const result = await runRickyCli();

if (result.output.length > 0) {
  process.stdout.write(`${result.output.join('\n')}\n`);
}

process.exitCode = result.exitCode;
