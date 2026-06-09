import { describe, expect, it, vi } from 'vitest';
import { fetchMergeBase, listClosedPullRequests, listOpenPullRequests } from './pulls';

const res = (body: unknown, ok = true, status = ok ? 200 : 500) =>
  ({ ok, status, json: async () => body }) as Response;

const apiPull = (over: Record<string, unknown> = {}) => ({
  number: 13,
  title: 'Curate the Open dictionary',
  html_url: 'https://github.com/dginev/mathml-intent-open/pull/13',
  updated_at: '2026-06-08T10:00:00Z',
  state: 'open',
  merged_at: null,
  user: { login: 'dginev' },
  head: {
    ref: 'dginev-20260608-open-curation',
    sha: 'head1111',
    repo: { name: 'mathml-intent-open', owner: { login: 'dginev' } },
  },
  base: { sha: 'base2222' },
  ...over,
});

describe('listOpenPullRequests', () => {
  it('maps the GitHub pulls shape to the normalized, fork-aware PullRequest (with state + SHAs)', async () => {
    const fetchImpl = vi.fn(async () => res([apiPull()])) as unknown as typeof fetch;
    const [pr] = await listOpenPullRequests('dginev', 'mathml-intent-open', fetchImpl);
    expect(pr).toEqual({
      number: 13,
      title: 'Curate the Open dictionary',
      url: 'https://github.com/dginev/mathml-intent-open/pull/13',
      author: 'dginev',
      updatedAt: '2026-06-08T10:00:00Z',
      state: 'open',
      merged: false,
      headOwner: 'dginev',
      headRepo: 'mathml-intent-open',
      headRef: 'dginev-20260608-open-curation',
      headSha: 'head1111',
      baseSha: 'base2222',
    });
    expect((fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0][0]).toContain(
      'api.github.com/repos/dginev/mathml-intent-open/pulls?state=open',
    );
  });

  it('is fork-aware — reads head owner/repo/sha from head.repo, not the base repo', async () => {
    const fork = apiPull({
      number: 21,
      head: { ref: 'feature', sha: 'forkSha', repo: { name: 'mathml-intent-open', owner: { login: 'contributor' } } },
    });
    const [pr] = await listOpenPullRequests('dginev', 'mathml-intent-open', vi.fn(async () => res([fork])) as unknown as typeof fetch);
    expect(pr.headOwner).toBe('contributor');
    expect(pr.headSha).toBe('forkSha');
  });

  it('drops a PR whose source fork was deleted (head.repo is null — unfetchable)', async () => {
    const deletedFork = apiPull({ number: 7, head: { ref: 'gone', sha: 'x', repo: null } });
    const out = await listOpenPullRequests('o', 'r', vi.fn(async () => res([deletedFork, apiPull()])) as unknown as typeof fetch);
    expect(out.map((p) => p.number)).toEqual([13]);
  });

  it('sorts most-recently-updated first', async () => {
    const older = apiPull({ number: 1, updated_at: '2026-01-01T00:00:00Z' });
    const newer = apiPull({ number: 2, updated_at: '2026-06-08T10:00:00Z' });
    const out = await listOpenPullRequests('o', 'r', vi.fn(async () => res([older, newer])) as unknown as typeof fetch);
    expect(out.map((p) => p.number)).toEqual([2, 1]);
  });

  it('throws on a non-OK response (so the picker can surface it)', async () => {
    await expect(
      listOpenPullRequests('o', 'r', vi.fn(async () => res({ message: 'rate limited' }, false, 403)) as unknown as typeof fetch),
    ).rejects.toThrow('403');
  });
});

describe('listClosedPullRequests', () => {
  it('requests state=closed and reports merged vs closed-without-merge', async () => {
    const merged = apiPull({ number: 12, state: 'closed', merged_at: '2026-06-01T00:00:00Z' });
    const closed = apiPull({ number: 11, state: 'closed', merged_at: null });
    const fetchImpl = vi.fn(async () => res([merged, closed])) as unknown as typeof fetch;
    const out = await listClosedPullRequests('dginev', 'mathml-intent-open', fetchImpl);
    expect((fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0][0]).toContain('pulls?state=closed');
    expect(out.map((p) => [p.number, p.state, p.merged])).toEqual([
      [12, 'closed', true],
      [11, 'closed', false],
    ]);
  });
});

describe('fetchMergeBase', () => {
  it('returns the compare API merge_base_commit sha (the branch point)', async () => {
    const fetchImpl = vi.fn(async () => res({ merge_base_commit: { sha: 'mergebase42' } })) as unknown as typeof fetch;
    const sha = await fetchMergeBase('o', 'r', 'baseSha', 'headSha', fetchImpl);
    expect(sha).toBe('mergebase42');
    expect((fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0][0]).toContain('/compare/baseSha...headSha');
  });

  it('throws when the compare response carries no merge base', async () => {
    await expect(fetchMergeBase('o', 'r', 'a', 'b', vi.fn(async () => res({})) as unknown as typeof fetch)).rejects.toThrow(
      /merge base/i,
    );
  });
});
