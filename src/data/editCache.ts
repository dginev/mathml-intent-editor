import { conceptId } from './conceptId';
import type { Concept } from '../types';

/**
 * Local record of the user's edits, persisted in `localStorage` so a browser reload restores their
 * in-progress changes (and covers raw-CDN lag). Each edit keeps `baseAtEdit` — the base value the
 * concept had when first edited — which serves as the per-concept ancestor for the three-way reconcile.
 */
export type EditRecord = { value: Concept; baseAtEdit: Concept | null };
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

/**
 * Record (or update) the user's edit of a concept. `baseValue` is the concept's current base value,
 * captured as the ancestor on the FIRST edit only — re-edits keep the original fork point.
 */
export function recordEdit(storage: Storage, value: Concept, baseValue: Concept | null): EditCache {
  const edits = loadEdits(storage);
  const id = conceptId(value); // keyed by (concept, arity), not name alone
  const existing = edits[id];
  edits[id] = { value, baseAtEdit: existing ? existing.baseAtEdit : baseValue };
  saveEdits(storage, edits);
  return edits;
}
