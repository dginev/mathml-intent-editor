import { describe, expect, it, vi } from 'vitest';
import { clearPr, fetchPullState, loadPr, newBranchName, savePr } from './prSession';

function memStorage(): Storage {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
    clear: () => m.clear(),
    key: (i) => [...m.keys()][i] ?? null,
    get length() {
      return m.size;
    },
  } as Storage;
}

describe('prSession storage', () => {
  it('round-trips and clears the active PR (with its branch)', () => {
    const s = memStorage();
    const pr = { number: 12, url: 'https://github.com/o/r/pull/12', branch: 'dginev-20260531-power', headOwner: 'dginev' };
    expect(loadPr(s)).toBeNull();
    savePr(s, pr);
    expect(loadPr(s)).toEqual(pr);
    clearPr(s);
    expect(loadPr(s)).toBeNull();
  });

  it('ignores a legacy stored PR that has no branch', () => {
    const s = memStorage();
    s.setItem('intent-editor.pr', JSON.stringify({ number: 9, url: 'u' }));
    expect(loadPr(s)).toBeNull();
  });
});

describe('newBranchName', () => {
  it('is <handle>-<YYYYMMDD>-<first-concept>', () => {
    expect(newBranchName('dginev', 'additive-inverse', new Date(2026, 4, 31))).toBe(
      'dginev-20260531-additive-inverse',
    );
  });

  it('sanitizes and caps the concept, with fallbacks', () => {
    expect(newBranchName('dginev', 'A Weird/Name!', new Date(2026, 0, 9))).toBe('dginev-20260109-a-weird-name');
    expect(newBranchName('dginev', '', new Date(2026, 0, 9))).toBe('dginev-20260109-update');
  });
});

describe('fetchPullState', () => {
  const res = (body: unknown, ok = true) =>
    ({ ok, status: ok ? 200 : 500, json: async () => body }) as Response;

  it('reports an open PR as open', async () => {
    const out = await fetchPullState('o', 'r', 3, vi.fn(async () => res({ state: 'open' })) as typeof fetch);
    expect(out).toBe('open');
  });

  it('reports a closed (or merged) PR as closed', async () => {
    const out = await fetchPullState('o', 'r', 3, vi.fn(async () => res({ state: 'closed', merged: true })) as typeof fetch);
    expect(out).toBe('closed');
  });

  it('returns null on a failed request (so a transient error never resets the session)', async () => {
    const out = await fetchPullState('o', 'r', 3, vi.fn(async () => res({}, false)) as typeof fetch);
    expect(out).toBeNull();
  });

  it('hits the public GitHub pulls endpoint', async () => {
    const f = vi.fn(async () => res({ state: 'open' })) as unknown as typeof fetch;
    await fetchPullState('dginev', 'mathml-intent-open', 5, f);
    const [url] = (f as unknown as { mock: { calls: [string][] } }).mock.calls[0];
    expect(url).toBe('https://api.github.com/repos/dginev/mathml-intent-open/pulls/5');
  });
});
