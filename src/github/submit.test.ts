import { describe, expect, it } from 'vitest';
import { createSession, withPullRequest } from './session';
import { refreshSession, submitEdit } from './submit';
import type { RepoBackend } from './repo';

function mockBackend(overrides: Partial<RepoBackend> = {}) {
  const calls = { commits: [] as Array<{ branch: string; message: string }>, prs: [] as string[] };
  const backend: RepoBackend = {
    commitFile: async (branch, _content, message) => {
      calls.commits.push({ branch, message });
    },
    openPullRequest: async (branch) => {
      calls.prs.push(branch);
      return 99;
    },
    isPullRequestMerged: async () => false,
    ...overrides,
  };
  return { backend, calls };
}

describe('submitEdit', () => {
  it('commits to the session branch and opens a PR on the first edit', async () => {
    const { backend, calls } = mockBackend();
    const next = await submitEdit(backend, createSession('abc'), 'data', 'Edit power');

    expect(calls.commits).toEqual([{ branch: 'intent/abc', message: 'Edit power' }]);
    expect(calls.prs).toEqual(['intent/abc']);
    expect(next.prNumber).toBe(99);
  });

  it('commits onto the existing branch without opening a second PR', async () => {
    const { backend, calls } = mockBackend();
    const session = withPullRequest(createSession('abc'), 42);
    const next = await submitEdit(backend, session, 'data', 'Another edit');

    expect(calls.commits).toHaveLength(1);
    expect(calls.prs).toEqual([]); // no new PR — commit auto-updates the open one
    expect(next.prNumber).toBe(42);
  });
});

describe('refreshSession', () => {
  it('rotates to a fresh branch once the tracked PR has merged', async () => {
    const { backend } = mockBackend({ isPullRequestMerged: async () => true });
    const next = await refreshSession(backend, withPullRequest(createSession('abc'), 42));
    expect(next.branchSeq).toBe(2);
    expect(next.prNumber).toBeNull();
  });

  it('leaves the session untouched while the PR is still open', async () => {
    const { backend } = mockBackend({ isPullRequestMerged: async () => false });
    const session = withPullRequest(createSession('abc'), 42);
    expect(await refreshSession(backend, session)).toEqual(session);
  });

  it('does nothing when there is no PR yet', async () => {
    const { backend } = mockBackend();
    const session = createSession('abc');
    expect(await refreshSession(backend, session)).toEqual(session);
  });
});
