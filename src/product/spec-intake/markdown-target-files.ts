// Extract target file paths from a markdown spec via mdast.
//
// Why an AST instead of regex: backticks are markdown's native syntax for
// "this token is code/path-like". Walking the parsed tree and collecting
// `inlineCode` nodes is exact — no boundary char-class to keep growing, no
// false matches from prose fragments like `base/head`. Fenced code blocks
// (```...```) are excluded by construction since they're `code` nodes, not
// `inlineCode`, so example paths in code blocks aren't mistaken for edits.

import { fromMarkdown } from 'mdast-util-from-markdown';
import type {
  Heading,
  InlineCode,
  List,
  ListItem,
  Node,
  Paragraph,
  Parent,
  Root,
} from 'mdast';

const RECOGNIZED_PATH_PREFIXES = [
  'packages/',
  'src/',
  'tests/',
  'test/',
  'lib/',
  'app/',
  'apps/',
  'bin/',
  'scripts/',
  'infra/',
  'docs/',
  'workflows/',
  'migrations/',
  'examples/',
  'e2e/',
  'public/',
  'static/',
  'assets/',
  'config/',
  'cmd/',
  'internal/',
  'pkg/',
  '.github/',
  '.claude/',
  '.agents/',
];

export function extractTargetFilesFromMarkdown(text: string): string[] {
  let tree: Root;
  try {
    tree = fromMarkdown(text);
  } catch {
    return [];
  }
  const fromBlock = extractFromTargetFilesSection(tree);
  if (fromBlock.length > 0) return fromBlock;
  return extractFromInlineCode(tree);
}

export function looksLikeRealPath(candidate: string): boolean {
  if (!candidate || candidate.includes(' ')) return false;
  if (candidate.startsWith('http')) return false;
  if (!candidate.includes('/')) return false;
  if (/\.[A-Za-z0-9]+$/.test(candidate)) return true;
  const slashes = (candidate.match(/\//g) ?? []).length;
  if (slashes >= 2) return true;
  return RECOGNIZED_PATH_PREFIXES.some((prefix) => candidate.startsWith(prefix));
}

function extractFromTargetFilesSection(tree: Root): string[] {
  const out: string[] = [];
  let inSection = false;
  let sectionDepth = 0;
  for (const child of tree.children) {
    if (child.type === 'heading') {
      const heading = child as Heading;
      const headingText = collectText(heading).trim();
      if (inSection && heading.depth <= sectionDepth) {
        break;
      }
      if (/^target\s+files\s*$/i.test(headingText)) {
        inSection = true;
        sectionDepth = heading.depth;
      }
      continue;
    }
    if (!inSection) continue;
    if (child.type === 'list') {
      for (const item of (child as List).children) {
        const path = pathFromListItem(item);
        if (!path) continue;
        const cleaned = path.replace(/[`'")\],.;:]+$/, '').trim();
        if (looksLikeRealPath(cleaned)) out.push(cleaned);
      }
    }
  }
  return dedupe(out);
}

function pathFromListItem(item: ListItem): string | null {
  for (const child of item.children) {
    if (child.type === 'paragraph') {
      const para = child as Paragraph;
      const inline = para.children.find(
        (c): c is InlineCode => c.type === 'inlineCode',
      );
      if (inline) return inline.value.trim();
      const txt = collectText(para).trim();
      if (txt) return stripWrappers(txt);
    }
  }
  return null;
}

function extractFromInlineCode(tree: Root): string[] {
  const out: string[] = [];
  walk(tree, (node) => {
    if (node.type !== 'inlineCode') return;
    const value = (node as InlineCode).value.trim();
    if (looksLikeRealPath(value)) out.push(value);
  });
  return dedupe(out);
}

function walk(node: Node, visit: (node: Node) => void): void {
  visit(node);
  if (isParent(node)) {
    for (const child of node.children) walk(child, visit);
  }
}

function isParent(node: Node): node is Parent {
  return Array.isArray((node as Parent).children);
}

function collectText(node: Node): string {
  if (node.type === 'code') return '';
  const candidate = (node as unknown as { value?: unknown }).value;
  if (typeof candidate === 'string') return candidate;
  if (isParent(node)) {
    return node.children.map(collectText).join('');
  }
  return '';
}

function stripWrappers(value: string): string {
  return value.replace(/^[`'"]|[`'"]$/g, '').trim();
}

function dedupe(values: string[]): string[] {
  return Array.from(new Set(values));
}
