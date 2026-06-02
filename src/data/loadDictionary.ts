import { fetchDictionary, rawUrl } from './githubRaw';
import { threeWayMerge, type ConceptMap } from './reconcile';
import { byConcept } from './serialize';
import { conceptId } from './conceptId';
import type { EditCache } from './editCache';
import type { Concept } from '../types';

export type LoadArgs = {
  owner: string;
  repo: string;
  baseBranch: string;
  filePath: string;
  /** The user's active PR branch; when set, its `open.yml` is read and reconciled as "ours". */
  branch?: string | null;
  /** Local edit cache (the user's in-progress changes) to overlay and reconcile. */
  edits?: EditCache;
  fetchImpl?: typeof fetch;
};

const toMap = (concepts: Concept[]): ConceptMap =>
  Object.fromEntries(concepts.map((c) => [conceptId(c), c]));

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
): Promise<{ concepts: Concept[]; conflicts: string[]; base: Concept[] }> {
  const { owner, repo, baseBranch, filePath, branch: branchName, edits = {}, fetchImpl } = args;

  const base = (await fetchDictionary(rawUrl(owner, repo, baseBranch, filePath), fetchImpl)) ?? [];
  const baseMap = toMap(base);

  const branch = branchName
    ? ((await fetchDictionary(rawUrl(owner, repo, branchName, filePath), fetchImpl)) ?? null)
    : null;

  // The GitHub working point the user's session forks from — their branch if it exists, else main.
  // This is the baseline the editor compares against: "dirty" = the working set differs from this.
  const workingMap: ConceptMap = branch ? toMap(branch) : baseMap;
  const ours: ConceptMap = { ...workingMap };
  const ancestor: ConceptMap = { ...baseMap };

  for (const [id, rec] of Object.entries(edits)) {
    if (rec.value === null) delete ours[id]; // local deletion
    else ours[id] = rec.value;
    if (rec.baseAtEdit) ancestor[id] = rec.baseAtEdit;
    else delete ancestor[id]; // brand-new concept: absent in the ancestor
  }

  const { merged, conflicts } = threeWayMerge(ancestor, ours, baseMap);
  const concepts = Object.values(merged).sort(byConcept); // canonical ASCII order
  return { concepts, conflicts, base: Object.values(workingMap).sort(byConcept) };
}
