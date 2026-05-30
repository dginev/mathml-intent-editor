/**
 * Anonymous, branch-tracked editing session.
 *
 * A session owns a working branch in the backing GitHub repo. The first edit opens a pull request
 * against that branch; further edits push more commits onto the same branch (auto-updating the PR).
 * Once the PR merges, the session rotates to a fresh branch (`rotateAfterMerge`) and the cycle repeats.
 * Sessions are anonymous — identified only by a locally-generated id, persisted in `localStorage`.
 */
export type Session = {
  /** Anonymous, locally-generated identifier. */
  id: string;
  /** Which branch this session is on; increments each time we rotate after a merge. */
  branchSeq: number;
  /** The open PR for the current branch, once created. */
  prNumber: number | null;
};

const STORAGE_KEY = 'intent-editor.session';

export function createSession(id: string): Session {
  return { id, branchSeq: 1, prNumber: null };
}

/** Deterministic branch name for a session's current sequence. */
export function branchName(s: Session): string {
  return s.branchSeq === 1 ? `intent/${s.id}` : `intent/${s.id}-${s.branchSeq}`;
}

export function withPullRequest(s: Session, prNumber: number): Session {
  return { ...s, prNumber };
}

/** After the tracked PR merges, move to a fresh branch with no PR. */
export function rotateAfterMerge(s: Session): Session {
  return { ...s, branchSeq: s.branchSeq + 1, prNumber: null };
}

export function saveSession(storage: Storage, s: Session): void {
  storage.setItem(STORAGE_KEY, JSON.stringify(s));
}

/**
 * Load the persisted session, or create+persist a new anonymous one using `newId` (e.g.
 * `crypto.randomUUID`) when none exists or the stored value is unreadable.
 */
export function loadSession(storage: Storage, newId: () => string): Session {
  const raw = storage.getItem(STORAGE_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Session;
      if (parsed && typeof parsed.id === 'string') return parsed;
    } catch {
      // fall through to create a fresh session
    }
  }
  const fresh = createSession(newId());
  saveSession(storage, fresh);
  return fresh;
}
