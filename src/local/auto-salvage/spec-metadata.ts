import { fromMarkdown } from 'mdast-util-from-markdown';
import type { Heading, Node, Parent, Root } from 'mdast';

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
  const tree = parseMarkdown(markdown);
  return {
    title: extractTitle(tree),
    repo: extractHeaderValue(markdown, tree, 'Target repo'),
    branch: extractHeaderValue(markdown, tree, 'Target branch'),
    worktree: extractHeaderValue(markdown, tree, 'Worktree'),
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
  const repo = typeof metadata.repo === 'string' ? metadata.repo.trim() : '';
  const branch = typeof metadata.branch === 'string' ? metadata.branch.trim() : '';
  const worktree = typeof metadata.worktree === 'string' ? metadata.worktree.trim() : '';
  return (
    repo.length > 0 &&
    branch.length > 0 &&
    worktree.length > 0
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
  const head = collectSemanticIntroText(markdown, 500).toLowerCase();
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

function extractTitle(tree: Root): string | null {
  for (const node of tree.children) {
    if (node.type !== 'heading' || node.depth !== 1) continue;
    const title = collectInlineMarkdown(node).trim();
    if (title.length > 0) return title;
  }
  return null;
}

/**
 * Extracts a `Header: value` line from semantic markdown nodes. We walk
 * headings / paragraphs and ignore fenced code blocks entirely so example
 * snippets cannot become live salvage metadata.
 */
function extractHeaderValue(markdown: string, tree: Root, header: string): string | null {
  const headerPattern = escapeRegex(header);
  const headerRegex = new RegExp(`^\\s*${headerPattern}\\s*:\\s*(.+?)\\s*$`, 'i');
  let matchValue: string | null = null;
  visitMetadataBlocks(tree, markdown, (rawBlock) => {
    for (const line of rawBlock.split(/\r?\n/)) {
      const normalized = normalizeHeaderLine(line);
      const match = headerRegex.exec(normalized);
      if (match && match[1] !== undefined) {
        matchValue = unwrapValue(match[1]);
        return true;
      }
    }
    return false;
  });
  return matchValue;
}

function normalizeHeaderLine(line: string): string {
  let normalized = line.trim();
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

function parseMarkdown(markdown: string): Root {
  return fromMarkdown(markdown);
}

function collectSemanticIntroText(markdown: string, limit: number): string {
  const tree = parseMarkdown(markdown);
  let collected = '';
  visitMetadataBlocks(tree, markdown, (blockText) => {
    const normalized = blockText.replace(/\s+/g, ' ').trim();
    if (normalized.length === 0) return false;
    collected = collected.length > 0 ? `${collected} ${normalized}` : normalized;
    return collected.length >= limit;
  });
  return collected.slice(0, limit);
}

function visitMetadataBlocks(node: Node, markdown: string, visit: (text: string) => boolean): boolean {
  if (node.type === 'code') return false;
  if (node.type === 'heading' || node.type === 'paragraph') {
    const rawBlock = sliceMarkdown(markdown, node) ?? collectInlineMarkdown(node as Heading | Parent);
    return visit(rawBlock);
  }
  if (!('children' in node) || !Array.isArray(node.children)) return false;
  for (const child of node.children) {
    if (visitMetadataBlocks(child, markdown, visit)) return true;
  }
  return false;
}

function collectInlineMarkdown(node: Heading | Parent): string {
  return node.children.map((child) => renderInlineNode(child)).join('');
}

function renderInlineNode(node: Node): string {
  if (node.type === 'text' && 'value' in node && typeof node.value === 'string') return node.value;
  if (node.type === 'inlineCode' && 'value' in node && typeof node.value === 'string') return `\`${node.value}\``;
  if (!('children' in node) || !Array.isArray(node.children)) return '';
  const parent = node as Parent;
  const inner = parent.children.map((child) => renderInlineNode(child)).join('');
  if (node.type === 'strong') return `**${inner}**`;
  if (node.type === 'emphasis') return `*${inner}*`;
  if (node.type === 'delete') return `~~${inner}~~`;
  return inner;
}

function sliceMarkdown(markdown: string, node: Node): string | null {
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  if (typeof start !== 'number' || typeof end !== 'number' || end <= start) return null;
  return markdown.slice(start, end);
}
