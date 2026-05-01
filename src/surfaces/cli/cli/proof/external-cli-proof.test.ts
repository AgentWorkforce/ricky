import { access, readFile, rm } from 'node:fs/promises';

import { afterEach, describe, expect, it } from 'vitest';

import { runExternalCliProof } from './external-cli-proof.js';

const reposToCleanup = new Set<string>();

afterEach(async () => {
  await Promise.all(
    [...reposToCleanup].map(async (repoDir) => {
      await rm(repoDir, { recursive: true, force: true });
      reposToCleanup.delete(repoDir);
    }),
  );
});

describe('Ricky external CLI proof', () => {
  it(
    'invokes the linked Ricky CLI from a separate repo and proves the printed artifact path and next command',
    { timeout: 30000 },
    async () => {
    const result = await runExternalCliProof();
    reposToCleanup.add(result.repoDir);

    expect(result.linkedCliPath).toMatch(/node_modules\/\.bin\/ricky$/);
    expect(result.artifactPath).toMatch(/^workflows\/generated\/.+\.ts$/);
    expect(result.artifactPath).not.toMatch(/^\//);
    await expect(access(result.artifactFullPath)).resolves.toBeUndefined();

    const artifactContent = await readFile(result.artifactFullPath, 'utf8');
    expect(artifactContent).toContain('workflow(');

    expect(result.cliOutput).toContain(`Generation: ok — ${result.artifactPath}`);
    expect(result.cliOutput).toContain(`Run: ${result.nextCommand}`);
    expect(result.nextCommand).toBe(`ricky run ${result.artifactPath}`);
    expect(result.nextCommandOutput).toContain('Execution: success');
    },
  );
});
