import { describe, expect, it } from 'vitest';

import { extractTargetFilesFromMarkdown, looksLikeRealPath } from './markdown-target-files.js';

describe('extractTargetFilesFromMarkdown', () => {
  it('returns inline-code paths from prose', () => {
    expect(
      extractTargetFilesFromMarkdown(
        'Edit `packages/web/foo.ts` and `src/lib/bar.ts` to fix the bug.',
      ),
    ).toEqual(['packages/web/foo.ts', 'src/lib/bar.ts']);
  });

  it('skips inline-code tokens that fail the path filter', () => {
    expect(
      extractTargetFilesFromMarkdown(
        'Run `npm install` then rebase onto `git/main`. Edit `packages/web/foo.ts`.',
      ),
    ).toEqual(['packages/web/foo.ts']);
  });

  it('does not capture paths inside fenced code blocks', () => {
    const text = [
      'Edit `packages/web/foo.ts`.',
      '',
      '```ts',
      'const x = "packages/legacy/old.ts";',
      '```',
    ].join('\n');
    expect(extractTargetFilesFromMarkdown(text)).toEqual(['packages/web/foo.ts']);
  });

  it('honors a `## Target Files` block over inline code', () => {
    const text = [
      'Some prose with `tests/scratch.ts`.',
      '',
      '## Target Files',
      '',
      '- `packages/web/route.ts`',
      '- packages/core/launcher.ts',
      '',
      '## Acceptance',
    ].join('\n');
    expect(extractTargetFilesFromMarkdown(text)).toEqual([
      'packages/web/route.ts',
      'packages/core/launcher.ts',
    ]);
  });

  it('matches the Target Files heading at any depth', () => {
    const text = [
      '## Plan',
      '',
      '### Target Files',
      '',
      '- `packages/web/route.ts`',
    ].join('\n');
    expect(extractTargetFilesFromMarkdown(text)).toEqual(['packages/web/route.ts']);
  });

  it('returns an empty array when given non-markdown plain text with no inline code', () => {
    expect(extractTargetFilesFromMarkdown('Plain text. No paths anywhere.')).toEqual([]);
  });

  it('deduplicates repeated mentions of the same path', () => {
    expect(
      extractTargetFilesFromMarkdown(
        'Edit `packages/web/foo.ts` and again `packages/web/foo.ts` for emphasis.',
      ),
    ).toEqual(['packages/web/foo.ts']);
  });

  it('rejects http(s) URLs that happen to live in inline code', () => {
    expect(
      extractTargetFilesFromMarkdown('See `https://example.com/api/v1/foo` for context.'),
    ).toEqual([]);
  });

  it('rejects URLs and prose noise inside a `## Target Files` block', () => {
    const text = [
      '## Target Files',
      '',
      '- `packages/web/route.ts`',
      '- https://example.com/api/v1/foo',
      '- base/head',
      '- `packages/core/launcher.ts`,',
      '',
      '## Acceptance',
    ].join('\n');
    expect(extractTargetFilesFromMarkdown(text)).toEqual([
      'packages/web/route.ts',
      'packages/core/launcher.ts',
    ]);
  });
});

describe('looksLikeRealPath', () => {
  it('accepts paths with extensions', () => {
    expect(looksLikeRealPath('packages/web/foo.ts')).toBe(true);
    expect(looksLikeRealPath('src/index.tsx')).toBe(true);
  });

  it('accepts deeply-nested paths without extensions', () => {
    expect(looksLikeRealPath('packages/web/lib/nango-bridge')).toBe(true);
  });

  it('accepts two-segment paths only when they have a recognized prefix', () => {
    expect(looksLikeRealPath('workflows/wave2-product')).toBe(true);
    expect(looksLikeRealPath('packages/web')).toBe(true);
    expect(looksLikeRealPath('base/head')).toBe(false);
    expect(looksLikeRealPath('git/main')).toBe(false);
    expect(looksLikeRealPath('my-org/my-repo')).toBe(false);
  });

  it('rejects empty, whitespace-bearing, or http(s) tokens', () => {
    expect(looksLikeRealPath('')).toBe(false);
    expect(looksLikeRealPath('foo bar/baz.ts')).toBe(false);
    expect(looksLikeRealPath('http://example.com/foo.ts')).toBe(false);
    expect(looksLikeRealPath('https://example.com/foo.ts')).toBe(false);
  });

  it('rejects single-segment tokens (no slash)', () => {
    expect(looksLikeRealPath('foo.ts')).toBe(false);
    expect(looksLikeRealPath('parseSpec')).toBe(false);
  });
});
