import { access, readFile, rm } from 'node:fs/promises';

import { afterEach, describe, expect, it } from 'vitest';

import { runExternalCliProof } from './external-cli-proof';

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
  it('invokes the linked Ricky CLI from a separate repo and proves the printed artifact path and next command', async () => {
    const result = await runExternalCliProof();
    reposToCleanup.add(result.repoDir);

    expect(result.linkedCliPath).toMatch(/node_modules\/\.bin\/ricky$/);
    expect(result.artifactPath).toMatch(/^workflows\/generated\/.+\.ts$/);
    await expect(access(result.artifactFullPath)).resolves.toBeUndefined();

    const artifactContent = await readFile(result.artifactFullPath, 'utf8');
    expect(artifactContent).toContain('workflow(');

    expect(result.cliOutput).toContain('Local handoff completed.');
    expect(result.cliOutput).toContain(`Artifact: ${result.artifactPath}`);
    expect(result.cliOutput).toContain(`Next: Run the generated workflow locally: ${result.nextCommand}`);
    expect(result.nextCommand).toBe(`npx --no-install agent-relay run ${result.artifactPath}`);
    expect(result.nextCommandOutput).toContain(`[fixture-agent-relay] ran ${result.artifactPath}`);
  });
});
