/**
 * Spec metadata parser for the auto-salvage hook.
 *
 * Specs authored by the user's MCP-cloud-spawn workflow follow a consistent
 * header format (see `specs/mcp-cloud-spawn/pr-*.md`):
 *
 *   # Spec: <title>
 *   Target repo: `cloud`
 *   Target branch: `feat/foo`
 *   Worktree: `/private/tmp/cloud-foo`
 *
 * The salvage hook needs these fields to know which repo / branch / worktree
 * to commit + push + open a PR against. This parser extracts each field
 * independently — a missing field returns `null` for that field, the caller
 * decides whether the overall spec is salvageable.
 *
 * Per the AGENTS.md source-text-analysis rule: spec markdown is documented
 * prose, not TypeScript source, so plain regex / line-based parsing is the
 * right tool here (the rule applies only to TS/JS source).
 */

export interface SpecMetadata {
  title: string | null;
  repo: string | null;
  branch: string | null;
  worktree: string | null;
}

/**
 * Parses spec metadata from the markdown body.
 *
 * Header lines are matched case-insensitively (so `Target Repo:` and
 * `target repo:` both work) and the value may be wrapped in backticks,
 * quotes, or bare text. Trailing whitespace is trimmed.
 *
 * Returns a partial record with each field independently nullable. The
 * caller checks `isSalvageableSpec` to decide whether to proceed.
 */
export function parseSpecMetadata(markdown: string): SpecMetadata {
  return {
    title: extractTitle(markdown),
    repo: extractHeaderValue(markdown, 'Target repo'),
    branch: extractHeaderValue(markdown, 'Target branch'),
    worktree: extractHeaderValue(markdown, 'Worktree'),
  };
}

/**
 * True when every required field for salvage is present and non-empty.
 *
 * We require repo + branch + worktree (the operational triple). Title is
 * recovered separately — when absent we fall back to a synthetic title in
 * the commit / PR builder.
 */
export function isSalvageableSpec(metadata: SpecMetadata): metadata is SpecMetadata & {
  repo: string;
  branch: string;
  worktree: string;
} {
  return (
    typeof metadata.repo === 'string' && metadata.repo.length > 0 &&
    typeof metadata.branch === 'string' && metadata.branch.length > 0 &&
    typeof metadata.worktree === 'string' && metadata.worktree.length > 0
  );
}

/**
 * Picks a sensible "feat(...): title" / "fix(...): title" PR title from the
 * spec H1 line. Heuristic: if the spec mentions "fix" / "bug" in the first
 * 500 chars we infer fix(...), otherwise feat(...). The scope is the repo
 * name. Falls back to the raw title if no scope can be inferred.
 */
export function inferPrTitle(metadata: SpecMetadata, markdown: string): string {
  const rawTitle = metadata.title ?? 'Untitled spec';
  const stripped = stripSpecPrefix(rawTitle);
  const scope = metadata.repo ? `(${metadata.repo})` : '';
  const head = markdown.slice(0, 500).toLowerCase();
  const looksLikeFix = /\b(fix|bug|regression|hotfix)\b/.test(head);
  const kind = looksLikeFix ? 'fix' : 'feat';
  if (!metadata.repo) {
    return stripped;
  }
  return `${kind}${scope}: ${stripped}`;
}

function stripSpecPrefix(title: string): string {
  return title.replace(/^Spec:\s*/i, '').trim();
}

function extractTitle(markdown: string): string | null {
  const lines = markdown.split(/\r?\n/);
  for (const line of lines) {
    const match = /^\s*#\s+(.+?)\s*$/.exec(line);
    if (match && match[1] !== undefined) {
      return match[1].trim();
    }
  }
  return null;
}

/**
 * Extracts a `Header: value` line from markdown. Case-insensitive header
 * match, tolerant of bullet prefixes (`- Header:` or `* Header:`), and
 * unwraps backticks/quotes around the value.
 */
function extractHeaderValue(markdown: string, header: string): string | null {
  const headerPattern = escapeRegex(header);
  // Walk line by line so we don't accidentally match a header mention inside
  // a code fence or table. For each line: strip the leading bullet marker
  // and any markdown emphasis runs around `Header:`, then capture the value
  // to end of line. We normalize the leading portion by removing emphasis
  // tokens before/after the header rather than trying to match every
  // permutation in one regex (e.g. `- **Target repo:** \`relay\``).
  const lines = markdown.split(/\r?\n/);
  const headerRegex = new RegExp(`^\\s*${headerPattern}\\s*:\\s*(.+?)\\s*$`, 'i');
  for (const rawLine of lines) {
    const normalized = normalizeHeaderLine(rawLine);
    const match = headerRegex.exec(normalized);
    if (match && match[1] !== undefined) {
      return unwrapValue(match[1]);
    }
  }
  return null;
}

function normalizeHeaderLine(line: string): string {
  // Strip a leading list marker.
  let normalized = line.replace(/^\s*[-*]\s+/, '');
  // Remove markdown emphasis runs (* _ pairs of length 1 or 2). We only
  // strip them around the header portion before the first colon — the
  // value portion is unwrapped separately in unwrapValue.
  const colonIndex = normalized.indexOf(':');
  if (colonIndex === -1) {
    return normalized;
  }
  const head = normalized.slice(0, colonIndex);
  const tail = normalized.slice(colonIndex);
  const strippedHead = head.replace(/[*_]+/g, '').trim();
  // The tail starts with `:`. If the very next chars after the colon are
  // emphasis tokens (e.g. `:** \`relay\``), strip them.
  const tailMatch = /^:\s*[*_]+\s*(.*)$/.exec(tail);
  const strippedTail = tailMatch ? `: ${tailMatch[1] ?? ''}` : tail;
  return `${strippedHead}${strippedTail}`;
}

function unwrapValue(raw: string): string | null {
  let value = raw.trim();
  // Strip surrounding markdown emphasis / backticks / quotes (one layer).
  const wrappers: ReadonlyArray<readonly [string, string]> = [
    ['`', '`'],
    ['"', '"'],
    ["'", "'"],
    ['**', '**'],
    ['*', '*'],
    ['_', '_'],
  ];
  for (const [open, close] of wrappers) {
    if (value.startsWith(open) && value.endsWith(close) && value.length >= open.length + close.length) {
      value = value.slice(open.length, value.length - close.length).trim();
    }
  }
  return value.length > 0 ? value : null;
}

function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
