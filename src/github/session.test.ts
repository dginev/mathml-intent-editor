import { describe, expect, it } from 'vitest';
import {
  branchName,
  createSession,
  loadSession,
  rotateAfterMerge,
  saveSession,
  withPullRequest,
  type Session,
} from './session';

const fakeStorage = (): Storage => {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k) => map.get(k) ?? null,
    key: (i) => [...map.keys()][i] ?? null,
    removeItem: (k) => void map.delete(k),
    setItem: (k, v) => void map.set(k, v),
  };
};

describe('session lifecycle', () => {
  it('starts on the first branch with no PR', () => {
    const s = createSession('abc123');
    expect(s.branchSeq).toBe(1);
    expect(s.prNumber).toBeNull();
    expect(branchName(s)).toBe('intent/abc123');
  });

  it('records an opened PR without changing the branch', () => {
    const s = withPullRequest(createSession('abc123'), 42);
    expect(s.prNumber).toBe(42);
    expect(branchName(s)).toBe('intent/abc123');
  });

  it('rotates to a fresh branch and clears the PR after a merge', () => {
    const merged = withPullRequest(createSession('abc123'), 42);
    const next = rotateAfterMerge(merged);
    expect(next.branchSeq).toBe(2);
    expect(next.prNumber).toBeNull();
    expect(branchName(next)).toBe('intent/abc123-2');
  });

  it('persists and reloads the same session', () => {
    const storage = fakeStorage();
    const s = withPullRequest(createSession('abc123'), 7);
    saveSession(storage, s);

    const reloaded = loadSession(storage, () => 'SHOULD-NOT-BE-USED');
    expect(reloaded).toEqual<Session>(s);
  });

  it('creates and stores a new anonymous session when none exists', () => {
    const storage = fakeStorage();
    const s = loadSession(storage, () => 'fresh-id');
    expect(s.id).toBe('fresh-id');
    expect(s.branchSeq).toBe(1);
    // and it was persisted
    expect(loadSession(storage, () => 'other').id).toBe('fresh-id');
  });
});
