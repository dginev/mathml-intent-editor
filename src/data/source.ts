import { conceptId } from './conceptId';
import { loadSeed } from './loadSeed';
import { byConcept, serializeConcepts } from './serialize';
import type { Concept } from '../types';

/**
 * A paged, on-demand source of concepts. The UI knows the `total` up front (to size the list) but
 * pulls rows in ranges as the user pages down — only a couple of viewports are loaded initially.
 *
 * `createSource` is backed by an in-memory array (the parsed seed); a future implementation can fetch
 * ranges from a paged GitHub-backed API without changing the UI. `applyEdit`/`serialize` keep the
 * canonical full dataset for building PR content, independent of what the UI has paged in.
 */
export type ConceptSource = {
  /** Current row count (decreases on `remove`). */
  readonly total: number;
  /** Concepts in `[start, end)`, clamped to the available range. */
  fetchRange(start: number, end: number): Promise<Concept[]>;
  /** Replace the row identified by `id` (`conceptId` it had when opened) with `updated`. */
  applyEdit(id: string, updated: Concept): void;
  /** Insert a brand-new concept in canonical position. */
  add(concept: Concept): void;
  /** Delete the row identified by `id`. */
  remove(id: string): void;
  /** Full backing-file content (W3C `open.yml` shape) for committing to GitHub. */
  serialize(): string;
  /** All concept names currently in the dataset — used to flag alias references to known concepts. */
  slugSet(): Set<string>;
  /** A snapshot of every concept currently held (includes local adds/edits) — for change diffing. */
  all(): Concept[];
};

export function createSource(concepts: Concept[]): ConceptSource {
  const items = concepts.slice();
  // Edits/deletes are rare, so a linear find by conceptId is fine and avoids stale-index bookkeeping.
  const indexOf = (id: string) => items.findIndex((c) => conceptId(c) === id);
  return {
    get total() {
      return items.length;
    },
    fetchRange: async (start, end) => items.slice(Math.max(0, start), Math.min(end, items.length)),
    applyEdit: (id, updated) => {
      const i = indexOf(id);
      if (i >= 0) items[i] = updated;
    },
    add: (concept) => {
      const i = items.findIndex((c) => byConcept(concept, c) < 0); // first row that sorts after it
      if (i < 0) items.push(concept);
      else items.splice(i, 0, concept);
    },
    remove: (id) => {
      const i = indexOf(id);
      if (i >= 0) items.splice(i, 1);
    },
    serialize: () => serializeConcepts(items),
    slugSet: () => new Set(items.map((c) => c.slug)),
    all: () => items.slice(),
  };
}

/** Seed-backed source: fetches/parses `open.yml` once, then serves ranges on demand. */
export async function createSeedSource(multiplier = 1): Promise<ConceptSource> {
  return createSource(await loadSeed(multiplier));
}
