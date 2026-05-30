import { fetchDictionary, rawUrl } from './githubRaw';
import { threeWayMerge, type ConceptMap } from './reconcile';
import type { EditCache } from './editCache';
import type { Concept } from '../types';

export type LoadArgs = {
  owner: string;
  repo: string;
  baseBranch: string;
  filePath: string;
  /** Signed-in handle; when present, the user's `intent/<handle>` branch is read too. */
  handle?: string | null;
  /** Local edit cache (the user's in-progress changes) to overlay and reconcile. */
  edits?: EditCache;
  fetchImpl?: typeof fetch;
};

const toMap = (concepts: Concept[]): ConceptMap =>
  Object.fromEntries(concepts.map((c) => [c.slug, c]));

/**
 * Load the working dictionary, reconciled client-side:
 * - `theirs` = current base (`main`), the latest upstream;
 * - `ours` = the user's branch (if any) with their local edits overlaid;
 * - `ancestor` = base, with each edited concept's recorded fork value (`baseAtEdit`).
 *
 * `threeWayMerge` then adopts upstream changes to concepts the user didn't touch, keeps the user's
 * edits, and reports concepts that changed on both sides as conflicts. Concepts are returned sorted
 * by slug (the seed's order).
 */
export async function loadDictionary(
  args: LoadArgs,
): Promise<{ concepts: Concept[]; conflicts: string[] }> {
  const { owner, repo, baseBranch, filePath, handle, edits = {}, fetchImpl } = args;

  const base = (await fetchDictionary(rawUrl(owner, repo, baseBranch, filePath), fetchImpl)) ?? [];
  const baseMap = toMap(base);

  const branch = handle
    ? ((await fetchDictionary(rawUrl(owner, repo, `intent/${handle}`, filePath), fetchImpl)) ?? null)
    : null;

  const ours: ConceptMap = { ...(branch ? toMap(branch) : baseMap) };
  const ancestor: ConceptMap = { ...baseMap };

  for (const [slug, rec] of Object.entries(edits)) {
    ours[slug] = rec.value;
    if (rec.baseAtEdit) ancestor[slug] = rec.baseAtEdit;
    else delete ancestor[slug]; // brand-new concept: absent in the ancestor
  }

  const { merged, conflicts } = threeWayMerge(ancestor, ours, baseMap);
  const concepts = Object.values(merged).sort((a, b) => a.slug.localeCompare(b.slug));
  return { concepts, conflicts };
}
