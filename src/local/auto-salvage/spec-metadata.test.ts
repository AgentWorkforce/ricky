import { describe, expect, it } from 'vitest';

import { inferPrTitle, isSalvageableSpec, parseSpecMetadata } from './spec-metadata.js';

describe('parseSpecMetadata', () => {
  it('extracts every field from a complete spec header', () => {
    const spec = [
      '# Spec: `agent-relay cloud login` flow (CLI side)',
      '',
      'Parent spec: `specs/mcp-cloud-spawn-and-slack-bridge.md`',
      'Owner: Khaliq',
      'Target repo: `relay`',
      'Target branch: `feat/agent-relay-cloud-login`',
      'Worktree: `/private/tmp/relay-cloud-login`',
      'Outcome: one PR.',
      '',
      '## Context',
      'Body.',
    ].join('\n');

    expect(parseSpecMetadata(spec)).toEqual({
      title: 'Spec: `agent-relay cloud login` flow (CLI side)',
      repo: 'relay',
      branch: 'feat/agent-relay-cloud-login',
      worktree: '/private/tmp/relay-cloud-login',
    });
  });

  it('returns null for missing fields rather than throwing', () => {
    const spec = [
      '# Spec: minimal',
      '',
      'Target repo: `cloud`',
      // no Target branch
      // no Worktree
    ].join('\n');

    expect(parseSpecMetadata(spec)).toEqual({
      title: 'Spec: minimal',
      repo: 'cloud',
      branch: null,
      worktree: null,
    });
  });

  it('tolerates alternate header capitalization', () => {
    const spec = [
      '# Spec: alt caps',
      'TARGET REPO: cloud',
      'target Branch: feat/something',
      'WORKTREE: /private/tmp/cloud-something',
    ].join('\n');

    expect(parseSpecMetadata(spec)).toMatchObject({
      repo: 'cloud',
      branch: 'feat/something',
      worktree: '/private/tmp/cloud-something',
    });
  });

  it('trims trailing whitespace and strips backtick/quote wrappers', () => {
    const spec = [
      '# Spec: trim',
      'Target repo: `cloud`   ',
      'Target branch:   "feat/spaced"   ',
      "Worktree:   '/private/tmp/cloud-spaced'",
    ].join('\n');

    expect(parseSpecMetadata(spec)).toMatchObject({
      repo: 'cloud',
      branch: 'feat/spaced',
      worktree: '/private/tmp/cloud-spaced',
    });
  });

  it('handles list-marker prefixed header lines', () => {
    const spec = [
      '# Spec: bulleted',
      '',
      '- **Target repo:** `relay`',
      '- **Target branch:** `feat/foo`',
      '- **Worktree:** `/private/tmp/relay-foo`',
    ].join('\n');

    expect(parseSpecMetadata(spec)).toMatchObject({
      repo: 'relay',
      branch: 'feat/foo',
      worktree: '/private/tmp/relay-foo',
    });
  });

  it('returns null title when no H1 header is present', () => {
    const spec = [
      '## Subsection',
      'Target repo: cloud',
    ].join('\n');

    expect(parseSpecMetadata(spec).title).toBeNull();
  });
});

describe('isSalvageableSpec', () => {
  it('is true when repo + branch + worktree are present', () => {
    expect(
      isSalvageableSpec({
        title: 'whatever',
        repo: 'cloud',
        branch: 'feat/x',
        worktree: '/tmp/x',
      }),
    ).toBe(true);
  });

  it('is false when any required field is missing', () => {
    expect(
      isSalvageableSpec({
        title: 'whatever',
        repo: 'cloud',
        branch: null,
        worktree: '/tmp/x',
      }),
    ).toBe(false);
    expect(
      isSalvageableSpec({
        title: 'whatever',
        repo: null,
        branch: 'feat/x',
        worktree: '/tmp/x',
      }),
    ).toBe(false);
    expect(
      isSalvageableSpec({
        title: 'whatever',
        repo: 'cloud',
        branch: 'feat/x',
        worktree: null,
      }),
    ).toBe(false);
  });

  it('is false when any required field is the empty string', () => {
    expect(
      isSalvageableSpec({
        title: 'whatever',
        repo: '',
        branch: 'feat/x',
        worktree: '/tmp/x',
      }),
    ).toBe(false);
  });
});

describe('inferPrTitle', () => {
  it('uses feat(repo) for forward-looking specs', () => {
    const metadata = {
      title: 'Spec: add dev stack skeleton',
      repo: 'cloud',
      branch: 'feat/dev-stack',
      worktree: '/tmp/x',
    };
    expect(inferPrTitle(metadata, '# Spec: add dev stack skeleton\nadd a new dev stack folder')).toBe(
      'feat(cloud): add dev stack skeleton',
    );
  });

  it('switches to fix(repo) when fix language appears near the top of the spec', () => {
    const metadata = {
      title: 'Spec: repair the broken Slack bridge',
      repo: 'cloud',
      branch: 'fix/slack-bridge',
      worktree: '/tmp/x',
    };
    const body = '# Spec: repair the broken Slack bridge\nfix the bug where slack hangs';
    expect(inferPrTitle(metadata, body)).toBe('fix(cloud): repair the broken Slack bridge');
  });

  it('omits the scope when the repo is unknown', () => {
    const metadata = {
      title: 'Spec: untitled',
      repo: null,
      branch: 'feat/x',
      worktree: '/tmp/x',
    };
    expect(inferPrTitle(metadata, '# Spec: untitled\nbody')).toBe('untitled');
  });
});
