import type { Concept } from '../types';

/**
 * Stable per-row identity. A concept *name* can be overloaded across arities (e.g. `disjoint-union`
 * with arity 1 and 2 are distinct rows), and `(concept, arity)` is unique in the W3C dictionary — so
 * that pair, not the name alone, is the key used for reconcile maps, the edit cache, and edits.
 */
export function conceptId(c: Pick<Concept, 'slug' | 'arity'>): string {
  return `${c.slug}#${c.arity ?? ''}`;
}
