/**
 * Default `SalvageRuntime` — wires the salvage hook to the real `git` and
 * `gh` binaries on PATH. Tests inject a custom runtime instead.
 *
 * All commands are run with explicit `cwd` and a fixed argv list (no shell
 * interpolation) so worktree paths with spaces or other shell metacharacters
 * are safe. We never pass `--force` to `git push`.
 */

import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';

import type {
  FsProbe,
  GhClient,
  GitClient,
  SalvageLogger,
  SalvageRuntime,
} from './run-auto-salvage.js';

export interface DefaultRuntimeOptions {
  /** Where structured `[ricky auto-salvage]` lines are written. Defaults to stderr. */
  logger?: SalvageLogger;
  /** Override the `git` binary path (useful for tests). */
  gitBin?: string;
  /** Override the `gh` binary path (useful for tests). */
  ghBin?: string;
}

export function createDefaultSalvageRuntime(options: DefaultRuntimeOptions = {}): SalvageRuntime {
  const gitBin = options.gitBin ?? 'git';
  const ghBin = options.ghBin ?? 'gh';
  return {
    git: createGitClient(gitBin),
    gh: createGhClient(ghBin),
    fs: createFsProbe(),
    logger: options.logger ?? createStderrLogger(),
  };
}

function createGitClient(gitBin: string): GitClient {
  return {
    async isGitWorkTree(path) {
      const result = await runCommand(gitBin, ['-C', path, 'rev-parse', '--is-inside-work-tree'], {
        allowNonZero: true,
      });
      return result.code === 0 && result.stdout.trim() === 'true';
    },
    async status(path) {
      const result = await runCommand(gitBin, ['-C', path, 'status', '--porcelain']);
      return result.stdout;
    },
    async currentBranch(path) {
      const result = await runCommand(gitBin, ['-C', path, 'rev-parse', '--abbrev-ref', 'HEAD']);
      return result.stdout.trim();
    },
    async reset(path, pathspec) {
      // Use --quiet so a no-op (pathspec not in index) doesn't print noise.
      // We pass -- before the pathspec to disambiguate from refs.
      await runCommand(gitBin, ['-C', path, 'reset', '--quiet', '--', pathspec], {
        allowNonZero: true,
      });
    },
    async add(path, pathspec) {
      await runCommand(gitBin, ['-C', path, 'add', pathspec]);
    },
    async hasStagedChanges(path) {
      const result = await runCommand(gitBin, ['-C', path, 'diff', '--cached', '--name-only', '--']);
      return result.stdout.trim().length > 0;
    },
    async commit(path, subject, body) {
      await runCommand(gitBin, ['-C', path, 'commit', '-m', subject, '-m', body]);
    },
    async push(path, branch) {
      // Never --force. If origin/<branch> exists and diverges, this fails
      // and the salvage caller surfaces the conflict in the structured log.
      await runCommand(gitBin, ['-C', path, 'push', '-u', 'origin', branch]);
    },
    async remoteBranchExists(path, branch) {
      const result = await runCommand(
        gitBin,
        ['-C', path, 'ls-remote', '--heads', 'origin', branch],
        { allowNonZero: true },
      );
      if (result.code !== 0) {
        throw new Error(`git ls-remote exited with ${result.code}: ${result.stderr.trim()}`);
      }
      return result.stdout.trim().length > 0;
    },
  };
}

function createGhClient(ghBin: string): GhClient {
  return {
    async listPrs(repo, branch, owner) {
      const result = await runCommand(ghBin, [
        'pr',
        'list',
        '--repo',
        `${owner}/${repo}`,
        '--head',
        branch,
        '--state',
        'open',
        '--json',
        'url',
      ]);
      try {
        const parsed: unknown = JSON.parse(result.stdout || '[]');
        if (!Array.isArray(parsed)) return [];
        return parsed.filter((entry): entry is { url: string } => (
          typeof entry === 'object' && entry !== null && typeof (entry as { url?: unknown }).url === 'string'
        ));
      } catch {
        return [];
      }
    },
    async createPr(repo, branch, title, body, owner) {
      const result = await runCommand(ghBin, [
        'pr',
        'create',
        '--repo',
        `${owner}/${repo}`,
        '--head',
        branch,
        '--title',
        title,
        '--body',
        body,
      ]);
      const url = result.stdout.trim().split(/\s+/).pop() ?? '';
      return { url };
    },
  };
}

function createFsProbe(): FsProbe {
  return {
    async exists(path) {
      try {
        await access(path);
        return true;
      } catch {
        return false;
      }
    },
  };
}

function createStderrLogger(): SalvageLogger {
  return {
    log(line) {
      process.stderr.write(`${line}\n`);
    },
  };
}

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

interface RunOptions {
  /** When true, a non-zero exit is returned instead of thrown. */
  allowNonZero?: boolean;
  /** Hard timeout for a single subprocess invocation. Defaults to 60s. */
  timeoutMillis?: number;
}

const DEFAULT_COMMAND_TIMEOUT_MS = 60_000;

function runCommand(bin: string, args: readonly string[], options: RunOptions = {}): Promise<RunResult> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timeoutMillis = options.timeoutMillis ?? DEFAULT_COMMAND_TIMEOUT_MS;
    const timer = timeoutMillis > 0 ? setTimeout(() => {
      child.kill();
      rejectOnce(new Error(`${bin} timed out after ${timeoutMillis}ms`));
    }, timeoutMillis) : undefined;
    timer?.unref?.();

    const clearTimer = (): void => {
      if (timer !== undefined) {
        clearTimeout(timer);
      }
    };

    const rejectOnce = (error: Error): void => {
      if (settled) return;
      settled = true;
      clearTimer();
      rejectPromise(error);
    };

    const resolveOnce = (result: RunResult): void => {
      if (settled) return;
      settled = true;
      clearTimer();
      resolvePromise(result);
    };

    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr?.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.on('error', (err) => rejectOnce(err instanceof Error ? err : new Error(String(err))));
    child.on('close', (code) => {
      if (settled) return;
      const exitCode = code ?? 1;
      if (exitCode !== 0 && !options.allowNonZero) {
        const suffix = stderr.trim().length > 0 ? `: ${stderr.trim()}` : '';
        rejectOnce(new Error(`${bin} exited with code ${exitCode}${suffix}`));
        return;
      }
      resolveOnce({ code: exitCode, stdout, stderr });
    });
  });
}
