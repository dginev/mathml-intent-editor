/**
 * List a repo's open pull requests from the public GitHub REST API (no token — the backing repo is
 * public; this is the same backend-free read path as `fetchPullState` in `prSession.ts`). Used by the
 * PR-review picker so a reviewer can pull any open PR's `open.yml` changes into the table.
 */

/** The slice of a GitHub pull request the reviewer UI needs, normalized + fork-aware. */
export type PullRequest = {
  number: number;
  title: string;
  /** `html_url` — the PR page on github.com. */
  url: string;
  /** `user.login` — the contributor who opened the PR. */
  author: string;
  /** `updated_at` — ISO timestamp, for sorting most-recent-first. */
  updatedAt: string;
  /** `head.repo.owner.login` — the head repo's owner (differs from `owner` for a fork PR). */
  headOwner: string;
  /** `head.repo.name` — the head repo's name. */
  headRepo: string;
  /** `head.ref` — the PR's source branch, used to read its `open.yml` from raw. */
  headRef: string;
};

/** The (partial) GitHub pulls API shape we read. */
type ApiPull = {
  number?: number;
  title?: string;
  html_url?: string;
  updated_at?: string;
  user?: { login?: string } | null;
  head?: { ref?: string; repo?: { name?: string; owner?: { login?: string } | null } | null } | null;
};

/**
 * Fetch the repo's open PRs (newest update first). A PR whose `head.repo` is null — the source fork was
 * deleted, so its branch is unfetchable — is dropped (it can't be reviewed). Throws on a non-OK
 * response so the picker can surface the failure (e.g. the 60/hr unauthenticated rate limit).
 */
export async function listOpenPullRequests(
  owner: string,
  repo: string,
  fetchImpl: typeof fetch = fetch,
): Promise<PullRequest[]> {
  const res = await fetchImpl(
    `https://api.github.com/repos/${owner}/${repo}/pulls?state=open&per_page=100`,
    { headers: { accept: 'application/vnd.github+json' } },
  );
  if (!res.ok) throw new Error(`Failed to list pull requests: ${res.status}`);
  const data = (await res.json()) as ApiPull[];

  return data
    .map((p): PullRequest | null => {
      const headRepo = p.head?.repo;
      if (!headRepo?.name || !headRepo.owner?.login || !p.head?.ref || typeof p.number !== 'number') {
        return null; // deleted-fork head (or malformed) — unfetchable, so not reviewable
      }
      return {
        number: p.number,
        title: p.title ?? '',
        url: p.html_url ?? '',
        author: p.user?.login ?? '',
        updatedAt: p.updated_at ?? '',
        headOwner: headRepo.owner.login,
        headRepo: headRepo.name,
        headRef: p.head.ref,
      };
    })
    .filter((p): p is PullRequest => p !== null)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
