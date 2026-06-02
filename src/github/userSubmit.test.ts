import { describe, expect, it, vi } from 'vitest';
import { deleteBranch, submitViaFork } from './userSubmit';

type Call = { method: string; url: string; body: unknown };

const resp = (status: number, body: unknown = {}) =>
  ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) }) as Response;

/** A fetch stub that records calls and routes by a `match(method, path) -> body|status` table. */
function stub(route: (method: string, url: string) => Response) {
  const calls: Call[] = [];
  const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    calls.push({ method, url: String(url), body: init?.body ? JSON.parse(String(init.body)) : undefined });
    return route(method, String(url));
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

const base = {
  owner: 'dginev',
  repo: 'mathml-intent-open',
  baseBranch: 'main',
  filePath: 'open.yml',
  content: 'concepts: []',
  title: 'edit: power',
  description: '### changes',
  message: 'edit power',
};

describe('submitViaFork — contributor (forks)', () => {
  it('forks, branches off upstream base, commits, and opens the PR from the fork', async () => {
    const branch = 'alice-20260601-power';
    const { fetchImpl, calls } = stub((method, url) => {
      if (method === 'POST' && url.endsWith('/repos/dginev/mathml-intent-open/forks')) return resp(202);
      if (method === 'GET' && url.endsWith('/repos/alice/mathml-intent-open')) return resp(200); // fork ready
      if (method === 'GET' && url.includes('/pulls?head=')) return resp(200, []); // no open PR
      if (method === 'DELETE' && url.includes('/git/refs/heads/')) return resp(404); // nothing to delete
      if (method === 'GET' && url.endsWith('/repos/dginev/mathml-intent-open/git/ref/heads/main'))
        return resp(200, { object: { sha: 'BASESHA' } });
      if (method === 'GET' && url.includes('/repos/alice/mathml-intent-open/git/ref/heads/')) return resp(404);
      if (method === 'POST' && url.endsWith('/repos/alice/mathml-intent-open/git/refs')) return resp(201);
      if (method === 'GET' && url.includes('/contents/open.yml')) return resp(404); // no file yet
      if (method === 'PUT' && url.includes('/contents/open.yml')) return resp(200);
      if (method === 'POST' && url.endsWith('/repos/dginev/mathml-intent-open/pulls'))
        return resp(201, { number: 5, html_url: 'https://github.com/dginev/mathml-intent-open/pull/5' });
      throw new Error(`unrouted ${method} ${url}`);
    });

    const out = await submitViaFork({ ...base, handle: 'alice', token: 'gho_a', branch, fetchImpl });

    expect(out).toEqual({
      prNumber: 5,
      prUrl: 'https://github.com/dginev/mathml-intent-open/pull/5',
      headOwner: 'alice',
    });
    // Branch was cut off the upstream base SHA, in the fork.
    const createRef = calls.find((c) => c.method === 'POST' && c.url.endsWith('/repos/alice/mathml-intent-open/git/refs'));
    expect(createRef?.body).toEqual({ ref: `refs/heads/${branch}`, sha: 'BASESHA' });
    // The PR is opened on upstream with the fork as head.
    const pr = calls.find((c) => c.method === 'POST' && c.url.endsWith('/repos/dginev/mathml-intent-open/pulls'));
    expect(pr?.body).toMatchObject({ head: `alice:${branch}`, base: 'main', title: 'edit: power' });
    // The commit carries base64 content (UTF-8 safe).
    const put = calls.find((c) => c.method === 'PUT');
    expect((put?.body as { content: string }).content).toBe(btoa('concepts: []'));
  });
});

describe('submitViaFork — maintainer (no fork)', () => {
  it('pushes the branch to the canonical repo directly when handle === owner', async () => {
    const branch = 'dginev-20260601-power';
    const { fetchImpl, calls } = stub((method, url) => {
      if (method === 'GET' && url.includes('/pulls?head=')) return resp(200, []);
      if (method === 'DELETE' && url.includes('/git/refs/heads/')) return resp(404);
      if (method === 'GET' && url.endsWith('/git/ref/heads/main')) return resp(200, { object: { sha: 'S' } });
      if (method === 'GET' && url.includes('/git/ref/heads/')) return resp(404);
      if (method === 'POST' && url.endsWith('/git/refs')) return resp(201);
      if (method === 'GET' && url.includes('/contents/open.yml')) return resp(404);
      if (method === 'PUT' && url.includes('/contents/open.yml')) return resp(200);
      if (method === 'POST' && url.endsWith('/pulls'))
        return resp(201, { number: 1, html_url: 'https://github.com/dginev/mathml-intent-open/pull/1' });
      throw new Error(`unrouted ${method} ${url}`);
    });

    const out = await submitViaFork({ ...base, handle: 'dginev', token: 'gho_d', branch, fetchImpl });

    expect(out.headOwner).toBe('dginev');
    expect(calls.some((c) => c.url.endsWith('/forks'))).toBe(false); // never forks its own repo
    const pr = calls.find((c) => c.method === 'POST' && c.url.endsWith('/pulls'));
    expect(pr?.body).toMatchObject({ head: `dginev:${branch}` });
  });
});

describe('submitViaFork — reused open PR', () => {
  it('keeps the existing branch + PR and refreshes it (422 → patch)', async () => {
    const branch = 'alice-20260601-power';
    const existing = { number: 9, html_url: 'https://github.com/dginev/mathml-intent-open/pull/9' };
    const { fetchImpl, calls } = stub((method, url) => {
      if (method === 'POST' && url.endsWith('/forks')) return resp(202);
      if (method === 'GET' && url.endsWith('/repos/alice/mathml-intent-open')) return resp(200);
      if (method === 'GET' && url.includes('/pulls?head=')) return resp(200, [existing]); // PR already open
      if (method === 'GET' && url.endsWith('/git/ref/heads/main')) return resp(200, { object: { sha: 'S' } });
      if (method === 'GET' && url.includes('/git/ref/heads/')) return resp(200); // branch exists
      if (method === 'GET' && url.includes('/contents/open.yml')) return resp(200, { sha: 'OLD' });
      if (method === 'PUT' && url.includes('/contents/open.yml')) return resp(200);
      if (method === 'POST' && url.endsWith('/pulls')) return resp(422, { message: 'already exists' });
      if (method === 'PATCH' && url.includes('/pulls/9')) return resp(200, existing);
      throw new Error(`unrouted ${method} ${url}`);
    });

    const out = await submitViaFork({ ...base, handle: 'alice', token: 'gho_a', branch, fetchImpl });

    expect(out.prNumber).toBe(9);
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false); // open PR → branch kept
    expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/git/refs'))).toBe(false); // branch kept
    const put = calls.find((c) => c.method === 'PUT');
    expect((put?.body as { sha?: string }).sha).toBe('OLD'); // updates the existing file
  });
});

describe('deleteBranch', () => {
  it('returns true on success and false when the branch is already gone', async () => {
    const ok = stub(() => resp(204));
    expect(await deleteBranch({ owner: 'alice', repo: 'r', branch: 'b', token: 't' }, ok.fetchImpl)).toBe(true);
    const gone = stub(() => resp(404));
    expect(await deleteBranch({ owner: 'alice', repo: 'r', branch: 'b', token: 't' }, gone.fetchImpl)).toBe(false);
  });
});
