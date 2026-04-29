import { execSync } from 'node:child_process';

export interface RepoDetector {
  detect(cwd: string): string | undefined;
}

type ExecRunner = (command: string, options: { cwd: string }) => string;

const defaultExec: ExecRunner = (command, options) =>
  execSync(command, { cwd: options.cwd, stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8' });

/**
 * Resolve `<owner>/<name>` from a git remote URL such as:
 *   git@github.com:AgentWorkforce/ricky.git
 *   https://github.com/AgentWorkforce/ricky.git
 *   https://github.com/AgentWorkforce/ricky
 *   ssh://git@github.com/AgentWorkforce/ricky.git
 */
export function parseRepoSlugFromGitUrl(url: string): string | undefined {
  const trimmed = url.trim();
  if (!trimmed) return undefined;

  const match = trimmed.match(/[:/]([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/);
  if (!match) return undefined;

  const owner = match[1];
  const name = match[2];
  if (!owner || !name) return undefined;
  return `${owner}/${name}`;
}

/**
 * Detect the current git repo as `<owner>/<name>` from `cwd`.
 *
 * Returns `undefined` when `cwd` is not a git repo, has no `origin` remote,
 * or the remote URL cannot be parsed. Never throws — the caller treats this
 * as "no detected repo" and falls back to whatever the spec text declared.
 */
export function detectCurrentRepo(cwd: string, exec: ExecRunner = defaultExec): string | undefined {
  try {
    const url = exec('git config --get remote.origin.url', { cwd });
    return parseRepoSlugFromGitUrl(url);
  } catch {
    return undefined;
  }
}

export const defaultRepoDetector: RepoDetector = {
  detect: (cwd) => detectCurrentRepo(cwd),
};
