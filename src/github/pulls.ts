/**
 * List a repo's pull requests from the public GitHub REST API (no token — the backing repo is public;
 * this is the same backend-free read path as `fetchPullState` in `prSession.ts`). Used by the PR-review
 * picker so a reviewer can pull a PR's `open.yml` changes into the table — open PRs (diffed against the
 * live `main`) and closed/merged PRs (diffed against the commit they branched from — see `fetchMergeBase`).
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
  /** Open PRs diff against live `main`; closed PRs diff against their historical branch point. */
  state: 'open' | 'closed';
  /** Closed *and* merged (vs closed-without-merge) — purely informational in the UI. */
  merged: boolean;
  /** `head.repo.owner.login` — the head repo's owner (differs from `owner` for a fork PR). */
  headOwner: string;
  /** `head.repo.name` — the head repo's name. */
  headRepo: string;
  /** `head.ref` — the PR's source branch; the live read path for an open PR. */
  headRef: string;
  /** `head.sha` — the PR head commit; read by SHA for a closed PR (its branch may be gone). */
  headSha: string;
  /** `base.sha` — the base-branch commit the PR targeted; one side of the merge-base lookup. */
  baseSha: string;
};

/** The (partial) GitHub pulls API shape we read. */
type ApiPull = {
  number?: number;
  title?: string;
  html_url?: string;
  updated_at?: string;
  state?: string;
  merged_at?: string | null;
  user?: { login?: string } | null;
  head?: { ref?: string; sha?: string; repo?: { name?: string; owner?: { login?: string } | null } | null } | null;
  base?: { sha?: string } | null;
};

/** Normalize one API PR; `null` if its head is unfetchable (deleted fork) or the payload is malformed. */
function mapPull(p: ApiPull): PullRequest | null {
  const headRepo = p.head?.repo;
  if (
    !headRepo?.name ||
    !headRepo.owner?.login ||
    !p.head?.ref ||
    !p.head?.sha ||
    typeof p.number !== 'number'
  ) {
    return null;
  }
  return {
    number: p.number,
    title: p.title ?? '',
    url: p.html_url ?? '',
    author: p.user?.login ?? '',
    updatedAt: p.updated_at ?? '',
    state: p.state === 'closed' ? 'closed' : 'open',
    merged: p.merged_at != null,
    headOwner: headRepo.owner.login,
    headRepo: headRepo.name,
    headRef: p.head.ref,
    headSha: p.head.sha,
    baseSha: p.base?.sha ?? '',
  };
}

/** Fetch the repo's PRs in a given state (newest update first). Throws on a non-OK response. */
async function listPullRequests(
  owner: string,
  repo: string,
  state: 'open' | 'closed',
  fetchImpl: typeof fetch,
): Promise<PullRequest[]> {
  const res = await fetchImpl(
    `https://api.github.com/repos/${owner}/${repo}/pulls?state=${state}&per_page=100&sort=updated&direction=desc`,
    { headers: { accept: 'application/vnd.github+json' } },
  );
  if (!res.ok) throw new Error(`Failed to list ${state} pull requests: ${res.status}`);
  const data = (await res.json()) as ApiPull[];
  return data
    .map(mapPull)
    .filter((p): p is PullRequest => p !== null)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export const listOpenPullRequests = (owner: string, repo: string, fetchImpl: typeof fetch = fetch) =>
  listPullRequests(owner, repo, 'open', fetchImpl);

export const listClosedPullRequests = (owner: string, repo: string, fetchImpl: typeof fetch = fetch) =>
  listPullRequests(owner, repo, 'closed', fetchImpl);

/**
 * The merge base (common ancestor) of two commits — the commit a closed PR branched from, so its
 * historical contribution can be read as `merge-base → head` (GitHub's own PR-diff semantics) rather
 * than against present-day `main`. Uses the public compare API (`base...head`).
 */
export async function fetchMergeBase(
  owner: string,
  repo: string,
  baseSha: string,
  headSha: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const res = await fetchImpl(
    `https://api.github.com/repos/${owner}/${repo}/compare/${baseSha}...${headSha}`,
    { headers: { accept: 'application/vnd.github+json' } },
  );
  if (!res.ok) throw new Error(`Failed to find merge base: ${res.status}`);
  const data = (await res.json()) as { merge_base_commit?: { sha?: string } };
  const sha = data.merge_base_commit?.sha;
  if (!sha) throw new Error('No merge base in compare response');
  return sha;
}
