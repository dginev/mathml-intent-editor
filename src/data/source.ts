import { conceptId } from './conceptId';
import { loadSeed } from './loadSeed';
import { serializeConcepts } from './serialize';
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
  total: number;
  /** Concepts in `[start, end)`, clamped to the available range. */
  fetchRange(start: number, end: number): Promise<Concept[]>;
  /** Update a row's primary notation (MathML + the TeX it came from). `id` is `conceptId` (name#arity). */
  applyEdit(id: string, mathml: string[], tex?: string): void;
  /** Full backing-file content (W3C `open.yml` shape) for committing to GitHub. */
  serialize(): string;
};

export function createSource(concepts: Concept[]): ConceptSource {
  const all = concepts.slice();
  const indexOf = new Map(all.map((c, i) => [conceptId(c), i]));
  return {
    total: all.length,
    fetchRange: async (start, end) => all.slice(Math.max(0, start), Math.min(end, all.length)),
    applyEdit: (id, mathml, tex) => {
      const i = indexOf.get(id);
      if (i != null) all[i] = { ...all[i], mathml, tex };
    },
    serialize: () => serializeConcepts(all),
  };
}

/** Seed-backed source: fetches/parses `open.yml` once, then serves ranges on demand. */
export async function createSeedSource(multiplier = 1): Promise<ConceptSource> {
  return createSource(await loadSeed(multiplier));
}
