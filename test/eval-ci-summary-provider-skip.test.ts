import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

const runsDir = join(process.cwd(), '.ricky', 'evals', 'runs');
const createdDirs: string[] = [];

describe('Ricky eval CI summary provider skips', () => {
  afterEach(() => {
    for (const dir of createdDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('does not fail CI for retry-exhausted OpenRouter infrastructure skips', () => {
    writeRun('9999-01-01T00-00-00-000Z-provider-infra-skip', {
      skipped: 1,
      tests: [
        {
          id: 'runtime-recovery.in-process-local-runner',
          suite: 'runtime-recovery',
          executor: 'manual',
          status: 'skipped',
          error: 'openrouter executor skipped; transient provider infrastructure unavailable after 3 attempts for runtime-recovery.in-process-local-runner: OpenRouter eval failed: 503 Provider returned error',
        },
      ],
    });

    const result = runSummary();

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('- Provider infrastructure skipped: 1');
    expect(result.stdout).toContain('- Blocking skipped: 0');
  });

  it('still fails CI for ordinary skipped evals', () => {
    writeRun('9999-01-01T00-00-00-001Z-blocking-skip', {
      skipped: 1,
      tests: [
        {
          id: 'workflow-authoring.example',
          suite: 'workflow-authoring',
          executor: 'openrouter',
          status: 'skipped',
          error: 'openrouter executor skipped; OPENROUTER_API_KEY is missing',
        },
      ],
    });

    const result = runSummary();

    expect(result.status).toBe(1);
    expect(result.stdout).toContain('- Provider infrastructure skipped: 0');
    expect(result.stdout).toContain('- Blocking skipped: 1');
  });
});

function writeRun(name: string, overrides: Record<string, unknown>): void {
  const runDir = join(runsDir, name);
  mkdirSync(runDir, { recursive: true });
  createdDirs.push(runDir);
  writeFileSync(
    join(runDir, 'result.json'),
    JSON.stringify({
      timestamp: name,
      mode: 'provider',
      git_sha: 'test-sha',
      passed: 0,
      needs_human: 0,
      failed: 0,
      skipped: 0,
      tests: [],
      ...overrides,
    }, null, 2),
  );
}

function runSummary(): ReturnType<typeof spawnSync> {
  return spawnSync(process.execPath, ['scripts/evals/ci-summary.mjs'], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });
}
