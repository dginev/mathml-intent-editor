/**
 * The user's active pull request and the unique branch it lives on. Persisted in `localStorage` so a
 * reload can tell whether that PR is still open: while it is, more Saves push onto the same `branch`
 * (the PR updates); once it's closed/merged the app resets and the next Save mints a fresh branch.
 */
export type ActivePr = { number: number; url: string; branch: string; headOwner: string };

const KEY = 'intent-editor.pr';

export function savePr(storage: Storage, pr: ActivePr): void {
  storage.setItem(KEY, JSON.stringify(pr));
}

export function loadPr(storage: Storage): ActivePr | null {
  const raw = storage.getItem(KEY);
  if (!raw) return null;
  try {
    const p = JSON.parse(raw) as ActivePr;
    return p && typeof p.number === 'number' && typeof p.branch === 'string' ? p : null;
  } catch {
    return null;
  }
}

export function clearPr(storage: Storage): void {
  storage.removeItem(KEY);
}

/**
 * A unique working-branch name so a user can have several PRs over time (one open at a time, but new
 * ones after each closes/merges): `<handle>-<YYYYMMDD>-<first-concept>`, e.g.
 * `dginev-20260531-additive-inverse`. Sanitized to a valid git ref; the concept part is capped.
 */
export function newBranchName(handle: string, firstConcept: string, now: Date): string {
  const date = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(
    now.getDate(),
  ).padStart(2, '0')}`;
  const safe = (s: string) => s.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  const concept = safe(firstConcept).slice(0, 40) || 'update';
  return `${safe(handle) || 'user'}-${date}-${concept}`;
}

/**
 * Read a PR's open/closed state from the public GitHub REST API (no token — the repo is public; raw
 * doesn't carry PR state). A merged PR reports `state: "closed"`, which is what we want (the session is
 * over either way). Returns `'open' | 'closed'`, or `null` on a network/parse error so a transient
 * failure never triggers a spurious reset.
 */
export async function fetchPullState(
  owner: string,
  repo: string,
  number: number,
  fetchImpl: typeof fetch = fetch,
): Promise<'open' | 'closed' | null> {
  try {
    const res = await fetchImpl(`https://api.github.com/repos/${owner}/${repo}/pulls/${number}`, {
      headers: { accept: 'application/vnd.github+json' },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { state?: string };
    return data.state === 'open' ? 'open' : data.state === 'closed' ? 'closed' : null;
  } catch {
    return null;
  }
}
