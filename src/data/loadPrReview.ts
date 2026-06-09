import { fetchDictionary, rawUrl } from './githubRaw';
import { byConcept } from './serialize';
import { conceptId } from './conceptId';
import { fetchMergeBase, type PullRequest } from '../github/pulls';
import type { Concept } from '../types';

export type PrReviewArgs = {
  owner: string;
  repo: string;
  baseBranch: string;
  filePath: string;
  /** The PR to review. `state` selects the comparison point; `head*`/SHAs locate the two `open.yml`s. */
  pr: Pick<PullRequest, 'headOwner' | 'headRepo' | 'headRef' | 'state' | 'headSha' | 'baseSha'>;
  fetchImpl?: typeof fetch;
};

/**
 * The PR-review diff as the same `{concepts, base, deletedIds}` triple the edit-session reducer's
 * `'loaded'` action consumes — so the table renders a PR's changes through the *existing* change-marking
 * machinery (`classifyChange` → row tints + status icons), no new rendering needed.
 */
export type PrReview = {
  /** Proposed concepts + held-for-display deletions (rows removed by the PR), canonical order. */
  concepts: Concept[];
  /** The base (`main`) snapshot — the baseline each row is classified against. */
  base: Concept[];
  /** conceptIds present in the base but absent from the PR head — the PR's deletions. */
  deletedIds: Set<string>;
};

const toIds = (concepts: Concept[]): Set<string> => new Set(concepts.map((c) => conceptId(c)));

/**
 * Read the two `open.yml`s straight from raw (backend-free, `ACAO: *`) and reduce them to a review diff:
 * the baseline is "theirs", the PR head is "ours"; a concept in the baseline but not the head is a
 * deletion, re-inserted from the baseline so it stays visible (rendered red). Mirrors the load
 * reconstruction in `useDictionary`.
 *
 * The comparison point depends on the PR's state:
 * - **open** → live `main` (`baseBranch`) ↔ the PR's branch (`headRef`): the change vs the present day.
 * - **closed/merged** → the commit the PR branched from (its merge base) ↔ the PR head commit (by SHA):
 *   the PR's *historical* contribution, undisturbed by changes merged since.
 *
 * Throws if a side has no readable `open.yml` (a branch/commit gone, or the PR didn't touch the file).
 */
export async function loadPrReview(args: PrReviewArgs): Promise<PrReview> {
  const { owner, repo, baseBranch, filePath, pr, fetchImpl } = args;

  // Resolve the (base ref, head ref) pair for the comparison.
  let baseRef = baseBranch;
  let headRef = pr.headRef;
  if (pr.state === 'closed') {
    baseRef = await fetchMergeBase(owner, repo, pr.baseSha, pr.headSha, fetchImpl);
    headRef = pr.headSha; // the branch is often deleted post-close — read the commit by SHA
  }

  const base = (await fetchDictionary(rawUrl(owner, repo, baseRef, filePath), fetchImpl)) ?? [];
  const head = await fetchDictionary(rawUrl(pr.headOwner, pr.headRepo, headRef, filePath), fetchImpl);
  if (head === null) {
    throw new Error(`Could not read ${filePath} from ${pr.headOwner}/${pr.headRepo}@${headRef}`);
  }

  const baseMap = new Map(base.map((c) => [conceptId(c), c]));
  const headIds = toIds(head);
  const deletedIds = new Set([...baseMap.keys()].filter((id) => !headIds.has(id)));

  // Proposed rows + the deleted baseline rows, re-inserted so they render (red) instead of vanishing.
  const concepts = [...head, ...[...deletedIds].map((id) => baseMap.get(id)!)].sort(byConcept);
  return { concepts, base, deletedIds };
}
