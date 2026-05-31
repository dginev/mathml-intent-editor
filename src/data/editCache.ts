import type { Concept } from '../types';

/**
 * Local record of the user's edits, persisted in `localStorage` so a browser reload restores their
 * in-progress changes (and covers raw-CDN lag). Each edit keeps `baseAtEdit` — the base value the
 * concept had when first edited — which serves as the per-concept ancestor for the three-way reconcile.
 */
/** `value: null` marks the row as deleted. `baseAtEdit` is the fork ancestor for the reconcile. */
export type EditRecord = { value: Concept | null; baseAtEdit: Concept | null };
export type EditCache = Record<string, EditRecord>;

const KEY = 'intent-editor.edits';

export function loadEdits(storage: Storage): EditCache {
  const raw = storage.getItem(KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as EditCache;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function saveEdits(storage: Storage, edits: EditCache): void {
  storage.setItem(KEY, JSON.stringify(edits));
}

/** Drop all in-progress edits (e.g. a full session reset when the working PR is closed/merged). */
export function clearEdits(storage: Storage): void {
  storage.removeItem(KEY);
}

/**
 * Record (or update) the user's edit of a concept. `baseValue` is the concept's current base value,
 * captured as the ancestor on the FIRST edit only — re-edits keep the original fork point.
 */
/**
 * Record an edit (or, with `value: null`, a deletion) of the row identified by `id` (the conceptId it
 * had when opened — stable even if the edit renames/re-arities it). `baseValue` is captured as the fork
 * ancestor on the first edit of that row; re-edits keep the original.
 */
export function recordEdit(
  storage: Storage,
  id: string,
  value: Concept | null,
  baseValue: Concept | null,
): EditCache {
  const edits = loadEdits(storage);
  const existing = edits[id];
  edits[id] = { value, baseAtEdit: existing ? existing.baseAtEdit : baseValue };
  saveEdits(storage, edits);
  return edits;
}
