import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('generated workflow hygiene', () => {
  it('keeps generated workflow artifacts out of source control', () => {
    const checkedOutTrackedGeneratedWorkflows = execFileSync('git', ['ls-files', 'workflows/generated/*.ts'], {
      encoding: 'utf8',
    })
      .split(/\r?\n/)
      .filter(Boolean)
      .filter((entry) => existsSync(join(process.cwd(), entry)))
      .sort();

    expect(checkedOutTrackedGeneratedWorkflows).toEqual([]);
  });

  it('keeps the checked-out generated workflow directory free of stale artifacts', () => {
    const generatedDir = join(process.cwd(), 'workflows', 'generated');

    const generatedWorkflows = existsSync(generatedDir)
      ? readdirSync(generatedDir)
        .filter((entry) => entry.endsWith('.ts'))
        .sort()
      : [];

    expect(generatedWorkflows).toEqual([]);
  });
});
