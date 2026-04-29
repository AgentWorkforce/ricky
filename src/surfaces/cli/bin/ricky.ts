#!/usr/bin/env node

import { cliMain } from '../commands/cli-main.js';

const result = await cliMain();

if (result.output.length > 0) {
  process.stdout.write(`${result.output.join('\n')}\n`);
}

process.exitCode = result.exitCode;
