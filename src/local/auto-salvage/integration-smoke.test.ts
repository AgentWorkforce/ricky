/**
 * Integration smoke test for the auto-salvage hook against a real local
 * git worktree. Gated behind RICKY_AUTO_SALVAGE_INTEGRATION=1 because it
 * shells out to the real `git` binary and writes to a temp dir; CI keeps
 * this skipped by default. Run locally with:
 *
 *   RICKY_AUTO_SALVAGE_INTEGRATION=1 npx vitest run \
 *     src/local/auto-salvage/integration-smoke.test.ts
 *
 * The `gh pr create` call is always stubbed — we never want this test to
 * actually open a PR.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { describe, expect, it } from 'vitest';

import { createDefaultSalvageRuntime } from './default-runtime.js';
import { runAutoSalvage } from './run-auto-salvage.js';

const execFileP = promisify(execFile);
const integrationEnabled = process.env.RICKY_AUTO_SALVAGE_INTEGRATION === '1';

describe.skipIf(!integrationEnabled)('runAutoSalvage (integration)', () => {
  it('commits worktree changes and stops short of remote operations when gh is stubbed', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ricky-salvage-integration-'));
    const worktree = join(root, 'worktree');
    try {
      await execFileP('git', ['init', '--initial-branch=main', worktree]);
      await execFileP('git', ['-C', worktree, 'config', 'user.email', 'test@example.com']);
      await execFileP('git', ['-C', worktree, 'config', 'user.name', 'Test']);
      await writeFile(join(worktree, 'README.md'), '# initial\n');
      await execFileP('git', ['-C', worktree, 'add', '.']);
      await execFileP('git', ['-C', worktree, 'commit', '-m', 'initial']);
      // Branch off main and stay on it
      await execFileP('git', ['-C', worktree, 'checkout', '-b', 'feat/integration-smoke']);
      // Make a dirty change
      await writeFile(join(worktree, 'new.txt'), 'work product\n');

      const spec = [
        '# Spec: integration smoke',
        '',
        `Target repo: \`integration\``,
        `Target branch: \`feat/integration-smoke\``,
        `Worktree: \`${worktree}\``,
      ].join('\n');

      const runtime = createDefaultSalvageRuntime();
      // Stub gh: don't open a real PR.
      runtime.gh = {
        listPrs: async () => [],
        createPr: async () => ({ url: 'https://example.invalid/stub/1' }),
      };
      // Stub push: don't push to a real remote (none exists anyway, but
      // this keeps the test fully hermetic even if the user has a global
      // git config that auto-creates an origin).
      const originalPush = runtime.git.push;
      let pushCalled = false;
      runtime.git.push = async () => {
        pushCalled = true;
      };
      // Stub remoteBranchExists since there's no origin.
      runtime.git.remoteBranchExists = async () => false;

      const result = await runAutoSalvage(spec, { exitCode: 124, reason: 'sigterm' }, runtime);
      expect(result.outcome).toBe('salvaged');
      expect(pushCalled).toBe(true);
      expect(result.prUrl).toBe('https://example.invalid/stub/1');

      // The commit landed.
      const { stdout: log } = await execFileP('git', ['-C', worktree, 'log', '--oneline', '-1']);
      expect(log).toContain('feat(integration): integration smoke');

      // The commit body has the provenance note.
      const { stdout: body } = await execFileP('git', ['-C', worktree, 'log', '-1', '--format=%B']);
      expect(body).toContain('Auto-salvaged from');
      expect(body).toContain('Co-Authored-By: Claude Opus 4.7 (1M context)');

      // originalPush variable exists to assert we wired through the real
      // runtime — it just isn't called for the test.
      expect(typeof originalPush).toBe('function');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 30_000);
});
