import { describe, expect, it, vi } from 'vitest';

import {
  runAutoSalvage,
  type FsProbe,
  type GhClient,
  type GitClient,
  type SalvageLogger,
  type SalvageResult,
  type SalvageRuntime,
} from './run-auto-salvage.js';

const FULL_SPEC = [
  '# Spec: ship the thing',
  '',
  'Target repo: `cloud`',
  'Target branch: `feat/ship-the-thing`',
  'Worktree: `/private/tmp/cloud-ship`',
  '',
  '## Spec acceptance',
  '',
  '- the thing ships',
  '',
  '## Test plan',
  '',
  '- run the tests',
].join('\n');

interface StubRuntime extends SalvageRuntime {
  git: GitClient & {
    addCalls: string[];
    commitCalls: { subject: string; body: string }[];
    pushCalls: string[];
    resetCalls: string[];
  };
  gh: GhClient & {
    createCalls: { repo: string; branch: string; title: string; body: string }[];
  };
  loggerLines: string[];
}

interface StubOverrides {
  status?: string;
  isGitWorkTree?: boolean;
  worktreeExists?: boolean;
  remoteBranchExists?: boolean;
  hasStagedChanges?: boolean;
  currentBranch?: string;
  existingPrs?: readonly { url: string }[];
  listPrsError?: Error;
  createPr?: () => Promise<{ url: string }>;
}

function createStubRuntime(overrides: StubOverrides = {}): StubRuntime {
  const lines: string[] = [];
  const addCalls: string[] = [];
  const commitCalls: { subject: string; body: string }[] = [];
  const pushCalls: string[] = [];
  const resetCalls: string[] = [];
  const createCalls: { repo: string; branch: string; title: string; body: string }[] = [];

  const fs: FsProbe = {
    exists: vi.fn().mockResolvedValue(overrides.worktreeExists ?? true),
  };

  const git: StubRuntime['git'] = {
    addCalls,
    commitCalls,
    pushCalls,
    resetCalls,
    isGitWorkTree: vi.fn().mockResolvedValue(overrides.isGitWorkTree ?? true),
    status: vi.fn().mockResolvedValue(overrides.status ?? ''),
    currentBranch: vi.fn().mockResolvedValue(overrides.currentBranch ?? 'feat/ship-the-thing'),
    reset: vi.fn().mockImplementation(async (_path: string, pathspec: string) => {
      resetCalls.push(pathspec);
    }),
    add: vi.fn().mockImplementation(async (_path: string, pathspec: string) => {
      addCalls.push(pathspec);
    }),
    hasStagedChanges: vi.fn().mockResolvedValue(overrides.hasStagedChanges ?? true),
    commit: vi.fn().mockImplementation(async (_path: string, subject: string, body: string) => {
      commitCalls.push({ subject, body });
    }),
    push: vi.fn().mockImplementation(async (_path: string, branch: string) => {
      pushCalls.push(branch);
    }),
    remoteBranchExists: vi.fn().mockResolvedValue(overrides.remoteBranchExists ?? false),
  };

  const gh: StubRuntime['gh'] = {
    createCalls,
    listPrs: overrides.listPrsError
      ? vi.fn().mockRejectedValue(overrides.listPrsError)
      : vi.fn().mockResolvedValue(overrides.existingPrs ?? []),
    createPr: vi.fn().mockImplementation(async (repo: string, branch: string, title: string, body: string) => {
      createCalls.push({ repo, branch, title, body });
      if (overrides.createPr) {
        return overrides.createPr();
      }
      return { url: 'https://github.com/AgentWorkforce/cloud/pull/9999' };
    }),
  };

  const logger: SalvageLogger = {
    log: (line: string) => {
      lines.push(line);
    },
  };

  return { git, gh, fs, logger, loggerLines: lines };
}

describe('runAutoSalvage', () => {
  it('skips with disabled-by-flag-or-env when --no-auto-salvage was passed', async () => {
    const runtime = createStubRuntime();
    const result = await runAutoSalvage(FULL_SPEC, { exitCode: 124 }, runtime, { disabled: true });
    expect(result.outcome).toBe('skipped');
    expect(result.reason).toBe('disabled-by-flag-or-env');
    expect(runtime.git.status).not.toHaveBeenCalled();
  });

  it('skips when RICKY_DISABLE_AUTO_SALVAGE=1 is set', async () => {
    const runtime = createStubRuntime();
    const result = await runAutoSalvage(FULL_SPEC, { exitCode: 0 }, runtime, {
      env: { RICKY_DISABLE_AUTO_SALVAGE: '1' },
    });
    expect(result.outcome).toBe('skipped');
    expect(result.reason).toBe('disabled-by-flag-or-env');
  });

  it('refuses to salvage when the spec is missing required fields', async () => {
    const runtime = createStubRuntime();
    const result = await runAutoSalvage('# Spec: incomplete\n', { exitCode: 1 }, runtime);
    expect(result.outcome).toBe('skipped');
    expect(result.reason).toBe('spec-missing-required-fields');
    expect(runtime.git.status).not.toHaveBeenCalled();
  });

  it('skips when the worktree path is missing', async () => {
    const runtime = createStubRuntime({ worktreeExists: false });
    const result = await runAutoSalvage(FULL_SPEC, { exitCode: 1 }, runtime);
    expect(result.outcome).toBe('skipped');
    expect(result.reason).toBe('worktree-path-missing');
  });

  it('reports already-shipped when the worktree path is missing but a PR exists for the branch', async () => {
    const runtime = createStubRuntime({
      worktreeExists: false,
      existingPrs: [{ url: 'https://github.com/AgentWorkforce/cloud/pull/724' }],
    });
    const result = await runAutoSalvage(FULL_SPEC, { exitCode: 1 }, runtime);
    expect(result.outcome).toBe('skipped');
    expect(result.reason).toBe('already-shipped');
    expect(result.prUrl).toBe('https://github.com/AgentWorkforce/cloud/pull/724');
    expect(runtime.git.status).not.toHaveBeenCalled();
  });

  it('skips when the worktree is not a git directory', async () => {
    const runtime = createStubRuntime({ isGitWorkTree: false });
    const result = await runAutoSalvage(FULL_SPEC, { exitCode: 1 }, runtime);
    expect(result.outcome).toBe('skipped');
    expect(result.reason).toBe('worktree-not-a-git-dir');
  });

  it('skips a clean worktree without PR', async () => {
    const runtime = createStubRuntime({ status: '' });
    const result = await runAutoSalvage(FULL_SPEC, { exitCode: 0 }, runtime);
    expect(result.outcome).toBe('skipped');
    expect(result.reason).toBe('worktree-clean');
    expect(runtime.git.commit).not.toHaveBeenCalled();
  });

  it('skips a clean worktree as already-shipped when a PR is open', async () => {
    const runtime = createStubRuntime({
      status: '',
      existingPrs: [{ url: 'https://github.com/AgentWorkforce/cloud/pull/777' }],
    });
    const result = await runAutoSalvage(FULL_SPEC, { exitCode: 0 }, runtime);
    expect(result.outcome).toBe('skipped');
    expect(result.reason).toBe('already-shipped');
    expect(result.prUrl).toBe('https://github.com/AgentWorkforce/cloud/pull/777');
  });

  it('skips when a PR is already open for the dirty branch', async () => {
    const runtime = createStubRuntime({
      status: ' M src/foo.ts\n',
      existingPrs: [{ url: 'https://github.com/AgentWorkforce/cloud/pull/123' }],
    });
    const result = await runAutoSalvage(FULL_SPEC, { exitCode: 124 }, runtime);
    expect(result.outcome).toBe('skipped');
    expect(result.reason).toBe('pr-already-open-for-branch');
    expect(result.prUrl).toBe('https://github.com/AgentWorkforce/cloud/pull/123');
    expect(runtime.git.commit).not.toHaveBeenCalled();
    expect(runtime.git.push).not.toHaveBeenCalled();
  });

  it('refuses to salvage when origin already has the branch (no force push)', async () => {
    const runtime = createStubRuntime({
      status: ' M src/foo.ts\n',
      remoteBranchExists: true,
    });
    const result = await runAutoSalvage(FULL_SPEC, { exitCode: 124 }, runtime);
    expect(result.outcome).toBe('skipped');
    expect(result.reason).toBe('remote-branch-exists-no-force-push');
    expect(runtime.git.push).not.toHaveBeenCalled();
  });

  it('fails fast when the worktree is not on the target branch', async () => {
    const runtime = createStubRuntime({
      status: ' M src/foo.ts\n',
      currentBranch: 'main',
    });
    const result = await runAutoSalvage(FULL_SPEC, { exitCode: 124 }, runtime);
    expect(result.outcome).toBe('failed');
    expect(result.reason).toBe('worktree-not-on-target-branch:main');
    expect(runtime.git.commit).not.toHaveBeenCalled();
  });

  it('skips when excluded artifact-only changes leave nothing staged', async () => {
    const runtime = createStubRuntime({
      status: ' M .workflow-artifacts/signoff.md\n',
      hasStagedChanges: false,
    });
    const result = await runAutoSalvage(FULL_SPEC, { exitCode: 124 }, runtime);
    expect(result.outcome).toBe('skipped');
    expect(result.reason).toBe('no-salvageable-staged-changes');
    expect(runtime.git.commit).not.toHaveBeenCalled();
  });

  it('runs the full salvage path on a dirty worktree with no remote branch', async () => {
    const runtime = createStubRuntime({ status: ' M src/foo.ts\n?? src/new.ts\n' });
    const result = await runAutoSalvage(
      FULL_SPEC,
      { exitCode: 124, reason: 'sigterm' },
      runtime,
    );
    expect(result.outcome).toBe('salvaged');
    expect(result.reason).toBe('commit-and-pr-opened');
    expect(result.prUrl).toBe('https://github.com/AgentWorkforce/cloud/pull/9999');
    expect(runtime.git.addCalls).toEqual(['.']);
    expect(runtime.git.resetCalls).toEqual(['.workflow-artifacts/']);
    expect(runtime.git.pushCalls).toEqual(['feat/ship-the-thing']);
    expect(runtime.git.commitCalls).toHaveLength(1);
    expect(runtime.git.commitCalls[0]?.subject).toBe('feat(cloud): ship the thing');
    expect(runtime.git.commitCalls[0]?.body).toContain('Auto-salvaged from `/private/tmp/cloud-ship`');
    expect(runtime.git.commitCalls[0]?.body).toContain('status `124`');
    expect(runtime.git.commitCalls[0]?.body).toContain('(sigterm)');
    expect(runtime.git.commitCalls[0]?.body).toContain('Co-Authored-By: Claude Opus 4.7 (1M context)');
    expect(runtime.gh.createCalls[0]?.repo).toBe('cloud');
    expect(runtime.gh.createCalls[0]?.branch).toBe('feat/ship-the-thing');
    expect(runtime.gh.createCalls[0]?.body).toContain('## Spec acceptance');
    expect(runtime.gh.createCalls[0]?.body).toContain('## Test plan');
  });

  it('keeps gh probe failures on the final structured log line instead of emitting a second line', async () => {
    const runtime = createStubRuntime({
      status: ' M src/foo.ts\n',
      listPrsError: new Error('gh pr list exploded'),
    });
    const result = await runAutoSalvage(FULL_SPEC, { exitCode: 0 }, runtime);
    expect(result.outcome).toBe('salvaged');
    expect(runtime.loggerLines).toHaveLength(1);
    expect(runtime.loggerLines[0]).toContain('probe-error=gh_pr_list_exploded');
  });

  it('emits a single structured stderr log line regardless of outcome', async () => {
    const runtime = createStubRuntime({ status: ' M src/foo.ts\n' });
    await runAutoSalvage(FULL_SPEC, { exitCode: 0 }, runtime);
    const matching = runtime.loggerLines.filter((line) => line.startsWith('[ricky auto-salvage] worktree='));
    expect(matching).toHaveLength(1);
    expect(matching[0]).toContain('outcome=salvaged');
    expect(matching[0]).toContain('branch=feat/ship-the-thing');
    expect(matching[0]).toContain('pr-url=https://github.com/AgentWorkforce/cloud/pull/9999');
  });

  it('reports outcome=failed when git commit throws', async () => {
    const runtime = createStubRuntime({ status: ' M src/foo.ts\n' });
    (runtime.git.commit as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('git commit blew up'),
    );
    const result: SalvageResult = await runAutoSalvage(FULL_SPEC, { exitCode: 0 }, runtime);
    expect(result.outcome).toBe('failed');
    expect(result.reason).toMatch(/git-commit-failed/);
    expect(runtime.git.push).not.toHaveBeenCalled();
  });

  it('falls back to the spec excerpt when no acceptance / test plan section is present', async () => {
    const minimalSpec = [
      '# Spec: minimalist',
      '',
      'Target repo: `relay`',
      'Target branch: `feat/minimal`',
      'Worktree: `/private/tmp/relay-minimal`',
      '',
      'Just some body text with no acceptance section.',
    ].join('\n');
    const runtime = createStubRuntime({ status: ' M a\n', currentBranch: 'feat/minimal' });
    await runAutoSalvage(minimalSpec, { exitCode: 0 }, runtime);
    const body = runtime.gh.createCalls[0]?.body ?? '';
    expect(body).toContain('## Spec excerpt');
    expect(body).toContain('Just some body text');
  });
});
