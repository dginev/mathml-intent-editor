import { fetchDictionary, rawUrl } from './githubRaw';
import { byConcept } from './serialize';
import { conceptId } from './conceptId';
import type { PullRequest } from '../github/pulls';
import type { Concept } from '../types';

export type PrReviewArgs = {
  owner: string;
  repo: string;
  baseBranch: string;
  filePath: string;
  /** The PR to review — its `head*` fields locate the proposed `open.yml` on raw (fork-aware). */
  pr: Pick<PullRequest, 'headOwner' | 'headRepo' | 'headRef'>;
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
 * Read `main` and a PR head's `open.yml` straight from raw (backend-free, `ACAO: *`) and reduce them to
 * a review diff. `main` is the baseline; the PR head is "ours"; a concept in the baseline but not the head
 * is a deletion, re-inserted from the baseline so it stays visible (rendered red) in the table. Mirrors
 * the load reconstruction in `useDictionary`. Throws if the PR head has no readable `open.yml` (branch
 * gone, or the PR doesn't touch the file in a fetchable way).
 */
export async function loadPrReview(args: PrReviewArgs): Promise<PrReview> {
  const { owner, repo, baseBranch, filePath, pr, fetchImpl } = args;

  const base = (await fetchDictionary(rawUrl(owner, repo, baseBranch, filePath), fetchImpl)) ?? [];
  const head = await fetchDictionary(rawUrl(pr.headOwner, pr.headRepo, pr.headRef, filePath), fetchImpl);
  if (head === null) {
    throw new Error(`Could not read ${filePath} from ${pr.headOwner}/${pr.headRepo}@${pr.headRef}`);
  }

  const baseMap = new Map(base.map((c) => [conceptId(c), c]));
  const headIds = toIds(head);
  const deletedIds = new Set([...baseMap.keys()].filter((id) => !headIds.has(id)));

  // Proposed rows + the deleted baseline rows, re-inserted so they render (red) instead of vanishing.
  const concepts = [...head, ...[...deletedIds].map((id) => baseMap.get(id)!)].sort(byConcept);
  return { concepts, base, deletedIds };
}
