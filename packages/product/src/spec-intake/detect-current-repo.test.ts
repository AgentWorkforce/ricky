import { describe, expect, it, vi } from 'vitest';

import { detectCurrentRepo, parseRepoSlugFromGitUrl } from './detect-current-repo.js';

describe('parseRepoSlugFromGitUrl', () => {
  it.each([
    ['git@github.com:AgentWorkforce/ricky.git', 'AgentWorkforce/ricky'],
    ['https://github.com/AgentWorkforce/ricky.git', 'AgentWorkforce/ricky'],
    ['https://github.com/AgentWorkforce/ricky', 'AgentWorkforce/ricky'],
    ['ssh://git@github.com/AgentWorkforce/ricky.git', 'AgentWorkforce/ricky'],
    ['https://github.com/AgentWorkforce/ricky/', 'AgentWorkforce/ricky'],
  ])('parses %s', (url, expected) => {
    expect(parseRepoSlugFromGitUrl(url)).toBe(expected);
  });

  it.each(['', '   ', 'not-a-url', 'https://example.com/'])('returns undefined for %p', (url) => {
    expect(parseRepoSlugFromGitUrl(url)).toBeUndefined();
  });
});

describe('detectCurrentRepo', () => {
  it('returns the parsed slug when git config succeeds', () => {
    const exec = vi.fn().mockReturnValue('git@github.com:AgentWorkforce/ricky.git\n');
    expect(detectCurrentRepo('/some/cwd', exec)).toBe('AgentWorkforce/ricky');
    expect(exec).toHaveBeenCalledWith('git config --get remote.origin.url', { cwd: '/some/cwd' });
  });

  it('returns undefined when git config throws', () => {
    const exec = vi.fn().mockImplementation(() => {
      throw new Error('not a git repo');
    });
    expect(detectCurrentRepo('/tmp', exec)).toBeUndefined();
  });

  it('returns undefined when remote URL cannot be parsed', () => {
    const exec = vi.fn().mockReturnValue('garbage');
    expect(detectCurrentRepo('/tmp', exec)).toBeUndefined();
  });
});
