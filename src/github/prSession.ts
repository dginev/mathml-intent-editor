/**
 * The user's active pull request — the one their `intent/<handle>` branch terminates in. Persisted in
 * `localStorage` so a reload can tell whether that PR is still open. When it's closed or merged the app
 * resets the session (deletes the branch via the service, clears edits, reloads from the base branch).
 */
export type ActivePr = { number: number; url: string };

const KEY = 'intent-editor.pr';

export function savePr(storage: Storage, pr: ActivePr): void {
  storage.setItem(KEY, JSON.stringify(pr));
}

export function loadPr(storage: Storage): ActivePr | null {
  const raw = storage.getItem(KEY);
  if (!raw) return null;
  try {
    const p = JSON.parse(raw) as ActivePr;
    return p && typeof p.number === 'number' ? p : null;
  } catch {
    return null;
  }
}

export function clearPr(storage: Storage): void {
  storage.removeItem(KEY);
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
