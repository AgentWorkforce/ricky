/**
 * Auto-salvage hook.
 *
 * Background: ricky's `--run` mode spawns a workflow subprocess that does
 * real implementation work in a worktree (writes files, runs tests) but
 * sometimes hangs at a review / fix / final-review step before reaching
 * `createGitHubStep`. The outer `gtimeout` then SIGTERMs the whole tree
 * and no PR opens — even though the worktree contains a perfectly good
 * implementation. The user has been manually salvaging these for days:
 *
 *   git -C <worktree> add . && git commit -m "<spec>" && git push && gh pr create
 *
 * This module automates that recovery. On every `--run` exit (success or
 * failure), if the spec carries `Target repo`, `Target branch`, and
 * `Worktree` metadata and the worktree has uncommitted work, we:
 *
 *   1. `git add .` (after resetting the workflow artifacts dir so internal
 *      bookkeeping files aren't committed).
 *   2. `git commit -m "<inferred title>" -m "<provenance + status>"`.
 *   3. `git push -u origin <branch>` — never `--force`.
 *   4. `gh pr create --repo AgentWorkforce/<repo>` with a body derived from
 *      the spec's `## Spec acceptance` / `## Test plan` sections (or the
 *      first 1500 chars of the spec body as a fallback).
 *
 * Salvage is additive: it never swallows the original exit code. The
 * caller still exits with whatever code ricky was about to exit with.
 *
 */

import { fromMarkdown } from 'mdast-util-from-markdown';
import type { Heading, Node, Parent, Root } from 'mdast';

import {
  inferPrTitle,
  isSalvageableSpec,
  parseSpecMetadata,
  type SpecMetadata,
} from './spec-metadata.js';

export type SalvageOutcome = 'salvaged' | 'skipped' | 'failed';

export interface SalvageResult {
  outcome: SalvageOutcome;
  reason: string;
  prUrl?: string;
  worktree?: string;
  branch?: string;
  probeError?: string;
}

export interface SalvageExitContext {
  /** The exit code ricky is about to return to the caller. */
  exitCode: number;
  /**
   * Optional human label for why ricky exited (e.g. "sigterm",
   * "workflow-failure"). Included in the commit body for provenance.
   */
  reason?: string;
}

export interface SalvageOptions {
  /** Disable salvage entirely (mirrors CLI `--no-auto-salvage`). */
  disabled?: boolean;
  /**
   * Environment to read `RICKY_DISABLE_AUTO_SALVAGE` from. Override for
   * tests; defaults to `process.env`.
   */
  env?: NodeJS.ProcessEnv;
}

export interface SalvageRuntime {
  git: GitClient;
  gh: GhClient;
  fs: FsProbe;
  logger: SalvageLogger;
  /** Owner used when opening GitHub PRs. Defaults to AgentWorkforce. */
  owner?: string;
}

export interface GitClient {
  /** Returns true when the path is the top of a git work tree. */
  isGitWorkTree(path: string): Promise<boolean>;
  /** `git -C <path> status --porcelain`. */
  status(path: string): Promise<string>;
  /** `git -C <path> rev-parse --abbrev-ref HEAD`. */
  currentBranch(path: string): Promise<string>;
  /** `git -C <path> reset <pathspec>` — unstage only. */
  reset(path: string, pathspec: string): Promise<void>;
  /** `git -C <path> add <pathspec>`. */
  add(path: string, pathspec: string): Promise<void>;
  /** Returns true when there is at least one staged change ready to commit. */
  hasStagedChanges(path: string): Promise<boolean>;
  /** `git -C <path> commit -m <subject> -m <body>`. */
  commit(path: string, subject: string, body: string): Promise<void>;
  /** `git -C <path> push -u origin <branch>` — must NOT pass --force. */
  push(path: string, branch: string): Promise<void>;
  /** `git -C <path> ls-remote --heads origin <branch>` — returns true when the branch exists on the remote. */
  remoteBranchExists(path: string, branch: string): Promise<boolean>;
}

export interface GhClient {
  /** `gh pr list --repo <owner>/<repo> --head <branch>`. */
  listPrs(repo: string, branch: string, owner: string): Promise<readonly { url: string }[]>;
  /** `gh pr create --repo <owner>/<repo> --title <t> --body <b>`. */
  createPr(repo: string, branch: string, title: string, body: string, owner: string): Promise<{ url: string }>;
}

export interface FsProbe {
  /** Returns true when the path exists on disk. */
  exists(path: string): Promise<boolean>;
}

export interface SalvageLogger {
  /** Receives a single structured `[ricky auto-salvage] ...` line on stderr. */
  log(line: string): void;
}

/**
 * Reads the runtime config from env + options.
 *
 * `--no-auto-salvage` and `RICKY_DISABLE_AUTO_SALVAGE=1` are equally
 * authoritative — either one disables the hook.
 */
function isDisabled(options: SalvageOptions): boolean {
  if (options.disabled === true) return true;
  const env = options.env ?? process.env;
  const flag = env.RICKY_DISABLE_AUTO_SALVAGE;
  if (typeof flag !== 'string') return false;
  const normalized = flag.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes';
}

/**
 * Main entry point. Always returns a structured result and emits a single
 * structured `[ricky auto-salvage] ...` line on the runtime logger. Never
 * throws — internal failures are surfaced as `outcome: 'failed'`.
 */
export async function runAutoSalvage(
  specMarkdown: string,
  exitContext: SalvageExitContext,
  runtime: SalvageRuntime,
  options: SalvageOptions = {},
): Promise<SalvageResult> {
  const result = await tryRunAutoSalvage(specMarkdown, exitContext, runtime, options);
  emit(runtime.logger, result);
  return result;
}

async function tryRunAutoSalvage(
  specMarkdown: string,
  exitContext: SalvageExitContext,
  runtime: SalvageRuntime,
  options: SalvageOptions,
): Promise<SalvageResult> {
  if (isDisabled(options)) {
    return { outcome: 'skipped', reason: 'disabled-by-flag-or-env' };
  }

  const metadata = parseSpecMetadata(specMarkdown);
  if (!isSalvageableSpec(metadata)) {
    return { outcome: 'skipped', reason: 'spec-missing-required-fields' };
  }

  const { repo, branch, worktree } = metadata;

  if (!(await runtime.fs.exists(worktree))) {
    return { outcome: 'skipped', reason: 'worktree-path-missing', worktree, branch };
  }
  if (!(await runtime.git.isGitWorkTree(worktree))) {
    return { outcome: 'skipped', reason: 'worktree-not-a-git-dir', worktree, branch };
  }

  let status: string;
  try {
    status = await runtime.git.status(worktree);
  } catch (err) {
    return { outcome: 'failed', reason: `git-status-failed:${describeError(err)}`, worktree, branch };
  }

  if (status.trim().length === 0) {
    // Clean worktree. Skip — but if a PR is already open for this branch,
    // note that for observability.
    const owner = runtime.owner ?? DEFAULT_PR_OWNER;
    try {
      const existing = await runtime.gh.listPrs(repo, branch, owner);
      if (existing.length > 0) {
        return {
          outcome: 'skipped',
          reason: 'already-shipped',
          worktree,
          branch,
          ...(existing[0]?.url ? { prUrl: existing[0].url } : {}),
        };
      }
    } catch {
      // gh failure on a clean worktree is non-actionable — fall through.
    }
    return { outcome: 'skipped', reason: 'worktree-clean', worktree, branch };
  }

  // Worktree dirty. Confirm we aren't double-shipping.
  const owner = runtime.owner ?? DEFAULT_PR_OWNER;
  let probeError: string | undefined;
  try {
    const existing = await runtime.gh.listPrs(repo, branch, owner);
    if (existing.length > 0) {
      return withProbeError({
        outcome: 'skipped',
        reason: 'pr-already-open-for-branch',
        worktree,
        branch,
        ...(existing[0]?.url ? { prUrl: existing[0].url } : {}),
      }, probeError);
    }
  } catch (err) {
    // gh probe failure is not fatal — we'll discover the conflict at push
    // time if a remote branch with the same name exists. Continue, but keep
    // the probe error attached to the final structured line.
    probeError = describeError(err);
  }

  // Hard rule: refuse to force-push. If a remote branch already exists,
  // surface the conflict instead of clobbering it.
  try {
    if (await runtime.git.remoteBranchExists(worktree, branch)) {
      return withProbeError({
        outcome: 'skipped',
        reason: 'remote-branch-exists-no-force-push',
        worktree,
        branch,
      }, probeError);
    }
  } catch (err) {
    return withProbeError({
      outcome: 'failed',
      reason: `git-ls-remote-failed:${describeError(err)}`,
      worktree,
      branch,
    }, probeError);
  }

  // Stage everything except the workflow artifacts dir. Reset is a no-op
  // when the path doesn't exist or wasn't staged, so we don't need to
  // probe first.
  try {
    await runtime.git.add(worktree, '.');
    await runtime.git.reset(worktree, ARTIFACT_PATHSPEC);
  } catch (err) {
    return withProbeError(
      { outcome: 'failed', reason: `git-add-failed:${describeError(err)}`, worktree, branch },
      probeError,
    );
  }

  let currentBranch: string;
  try {
    currentBranch = await runtime.git.currentBranch(worktree);
  } catch (err) {
    return withProbeError(
      { outcome: 'failed', reason: `git-current-branch-failed:${describeError(err)}`, worktree, branch },
      probeError,
    );
  }
  if (currentBranch !== branch) {
    return withProbeError(
      { outcome: 'failed', reason: `worktree-not-on-target-branch:${currentBranch}`, worktree, branch },
      probeError,
    );
  }

  try {
    if (!(await runtime.git.hasStagedChanges(worktree))) {
      return withProbeError(
        { outcome: 'skipped', reason: 'no-salvageable-staged-changes', worktree, branch },
        probeError,
      );
    }
  } catch (err) {
    return withProbeError(
      { outcome: 'failed', reason: `git-staged-status-failed:${describeError(err)}`, worktree, branch },
      probeError,
    );
  }

  const title = inferPrTitle(metadata, specMarkdown);
  const commitBody = buildCommitBody(metadata, exitContext, status);
  try {
    await runtime.git.commit(worktree, title, commitBody);
  } catch (err) {
    return withProbeError(
      { outcome: 'failed', reason: `git-commit-failed:${describeError(err)}`, worktree, branch },
      probeError,
    );
  }

  try {
    currentBranch = await runtime.git.currentBranch(worktree);
  } catch (err) {
    return withProbeError(
      { outcome: 'failed', reason: `git-current-branch-failed:${describeError(err)}`, worktree, branch },
      probeError,
    );
  }
  if (currentBranch !== branch) {
    return withProbeError(
      { outcome: 'failed', reason: `worktree-not-on-target-branch:${currentBranch}`, worktree, branch },
      probeError,
    );
  }

  try {
    await runtime.git.push(worktree, branch);
  } catch (err) {
    return withProbeError(
      { outcome: 'failed', reason: `git-push-failed:${describeError(err)}`, worktree, branch },
      probeError,
    );
  }

  const prBody = buildPrBody(metadata, specMarkdown, exitContext);
  let prUrl = '';
  try {
    const pr = await runtime.gh.createPr(repo, branch, title, prBody, owner);
    prUrl = pr.url;
  } catch (err) {
    return withProbeError({
      outcome: 'failed',
      reason: `gh-pr-create-failed:${describeError(err)}`,
      worktree,
      branch,
    }, probeError);
  }

  return withProbeError({ outcome: 'salvaged', reason: 'commit-and-pr-opened', worktree, branch, prUrl }, probeError);
}

function emit(logger: SalvageLogger, result: SalvageResult): void {
  const fields = [
    `worktree=${result.worktree ?? ''}`,
    `branch=${result.branch ?? ''}`,
    `outcome=${result.outcome}`,
    `reason=${result.reason}`,
    `pr-url=${result.prUrl ?? ''}`,
    ...(result.probeError ? [`probe-error=${sanitizeLogField(result.probeError)}`] : []),
  ];
  logger.log(`[ricky auto-salvage] ${fields.join(' ')}`);
}

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message.replace(/\s+/g, ' ').slice(0, 240);
  return String(err);
}

function sanitizeLogField(value: string): string {
  return value.replace(/\s+/g, '_');
}

function withProbeError(result: SalvageResult, probeError: string | undefined): SalvageResult {
  return probeError ? { ...result, probeError } : result;
}

function buildCommitBody(metadata: SpecMetadata, ctx: SalvageExitContext, status: string): string {
  const lines: string[] = [];
  lines.push(
    `Auto-salvaged from \`${metadata.worktree ?? ''}\` after ricky's runtime-launch ` +
      `exited with status \`${ctx.exitCode}\`${ctx.reason ? ` (${ctx.reason})` : ''} ` +
      `before reaching the workflow's PR-shipping step.`,
  );
  lines.push('');
  lines.push('Worktree state at salvage time captured by `git status --porcelain`:');
  lines.push('');
  lines.push('```');
  lines.push(status.trimEnd());
  lines.push('```');
  lines.push('');
  lines.push('Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>');
  return lines.join('\n');
}

function buildPrBody(metadata: SpecMetadata, specMarkdown: string, ctx: SalvageExitContext): string {
  const lines: string[] = [];
  lines.push('## Summary');
  lines.push('');
  lines.push(
    `Auto-salvaged PR opened by ricky's auto-salvage hook because the local ` +
      `\`--run\` exited (status \`${ctx.exitCode}\`${ctx.reason ? `, reason \`${ctx.reason}\`` : ''}) ` +
      `before the workflow could reach \`createGitHubStep\`. The worktree at ` +
      `\`${metadata.worktree ?? ''}\` contained a complete implementation on ` +
      `branch \`${metadata.branch ?? ''}\`, so the salvage hook committed it, ` +
      `pushed it, and opened this PR.`,
  );
  lines.push('');
  const acceptance = extractSection(specMarkdown, ['Spec acceptance', 'Acceptance criteria', 'Acceptance']);
  const testPlan = extractSection(specMarkdown, ['Test plan', 'Tests']);
  if (acceptance) {
    lines.push('## Spec acceptance');
    lines.push('');
    lines.push(acceptance.trim());
    lines.push('');
  }
  if (testPlan) {
    lines.push('## Test plan');
    lines.push('');
    lines.push(testPlan.trim());
    lines.push('');
  }
  if (!acceptance && !testPlan) {
    lines.push('## Spec excerpt');
    lines.push('');
    lines.push(specMarkdown.slice(0, 1500).trim());
    lines.push('');
  }
  lines.push('---');
  lines.push('');
  lines.push(
    'This PR was created by ricky\'s auto-salvage hook. Review the diff and the ' +
      'spec for full context before merging.',
  );
  return lines.join('\n');
}

function extractSection(markdown: string, headers: readonly string[]): string | null {
  const tree = fromMarkdown(markdown);
  const lowered = headers.map((header) => header.toLowerCase());
  for (let index = 0; index < tree.children.length; index += 1) {
    const node = tree.children[index];
    if (node?.type !== 'heading') continue;
    const heading = collectPlainText(node).toLowerCase();
    if (!lowered.some((needle) => heading.includes(needle))) continue;
    const endIndex = findSectionEnd(tree, index, node.depth);
    const contentNodes = tree.children.slice(index + 1, endIndex).filter(hasOffsets);
    if (contentNodes.length === 0) return null;
    const start = contentNodes[0]?.position?.start.offset;
    const end = contentNodes.at(-1)?.position?.end.offset;
    if (typeof start !== 'number' || typeof end !== 'number' || end <= start) return null;
    const section = markdown.slice(start, end).trim();
    return section.length > 0 ? section : null;
  }
  return null;
}

const ARTIFACT_PATHSPEC = '.workflow-artifacts/';
const DEFAULT_PR_OWNER = 'AgentWorkforce';

function findSectionEnd(tree: Root, startIndex: number, depth: number): number {
  for (let index = startIndex + 1; index < tree.children.length; index += 1) {
    const node = tree.children[index];
    if (node?.type === 'heading' && node.depth <= depth) return index;
  }
  return tree.children.length;
}

function hasOffsets(node: Node): boolean {
  return (
    typeof node.position?.start.offset === 'number' &&
    typeof node.position?.end.offset === 'number'
  );
}

function collectPlainText(node: Heading | Parent): string {
  return node.children.map((child) => renderPlainText(child)).join('');
}

function renderPlainText(node: Node): string {
  if ((node.type === 'text' || node.type === 'inlineCode') && 'value' in node && typeof node.value === 'string') {
    return node.value;
  }
  if (!('children' in node) || !Array.isArray(node.children)) return '';
  return node.children.map((child) => renderPlainText(child)).join('');
}
