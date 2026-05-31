import { conceptId } from './conceptId';
import { contentKey } from './reconcile';
import { serializeConcepts } from './serialize';
import type { EditCache } from './editCache';
import type { Concept } from '../types';

/**
 * Local change tracking for the batch-edit session. The editor compares its working set against the
 * GitHub baseline (the `intent/<handle>` branch if a PR is open, else `main`): each row is unchanged,
 * `added`, `changed`, or pending `deleted`. Pending deletions stay visible (rendered red) until a Save
 * enacts the whole batch. "Dirty" is purely content-based — an edit-then-revert or an add-then-delete
 * nets back to clean — so Save only activates when a submit would actually change the file.
 */
export type ChangeKind = 'added' | 'changed' | 'deleted';

export type BaseMap = ReadonlyMap<string, Concept>;

/** How a concept differs from the baseline (`null` = identical to what's already on GitHub). */
export function classifyChange(
  concept: Concept,
  baseMap: BaseMap,
  deletedIds: ReadonlySet<string>,
): ChangeKind | null {
  const id = conceptId(concept);
  if (deletedIds.has(id)) return 'deleted';
  const base = baseMap.get(id);
  if (!base) return 'added';
  return contentKey(concept) !== contentKey(base) ? 'changed' : null;
}

/** The content that would be submitted: every concept except the pending deletions, canonical YAML. */
export function effectiveYaml(all: readonly Concept[], deletedIds: ReadonlySet<string>): string {
  return serializeConcepts(all.filter((c) => !deletedIds.has(conceptId(c))));
}

/**
 * Rebuild the persisted edit cache from the current working set. Idempotent and net-zero-aware: rows
 * identical to the baseline (incl. edit-then-revert) produce no entry, and an added-then-deleted row
 * (no baseline) drops out entirely. `baseAtEdit` is the baseline value — the fork point for the reload
 * three-way reconcile.
 */
export function computeEdits(
  all: readonly Concept[],
  deletedIds: ReadonlySet<string>,
  baseMap: BaseMap,
): EditCache {
  const edits: EditCache = {};
  for (const c of all) {
    const id = conceptId(c);
    if (deletedIds.has(id)) continue; // a held-for-display deleted row: recorded as a tombstone below
    const base = baseMap.get(id);
    if (!base) edits[id] = { value: c, baseAtEdit: null }; // added
    else if (contentKey(c) !== contentKey(base)) edits[id] = { value: c, baseAtEdit: base }; // changed
  }
  for (const id of deletedIds) {
    const base = baseMap.get(id);
    if (base) edits[id] = { value: null, baseAtEdit: base }; // delete of a baseline row
    // a purely-local addition that was deleted has no baseline → net nothing
  }
  return edits;
}

/** Reconstruct the pending-delete set from a loaded edit cache (tombstones of baseline rows). */
export function deletedIdsFromEdits(edits: EditCache, baseMap: BaseMap): Set<string> {
  return new Set(Object.keys(edits).filter((id) => edits[id].value === null && baseMap.has(id)));
}
