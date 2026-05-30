import { stringify } from 'yaml';
import type { Concept } from '../types';

/**
 * Serialize concepts back to the seed `open.yml` shape — a YAML map keyed by slug, with empty/absent
 * fields omitted (so untouched concepts round-trip cleanly and diffs stay minimal). Inverse of
 * `loadSeed`'s normalization.
 */
export function serializeConcepts(concepts: Concept[]): string {
  const map: Record<string, Record<string, unknown>> = {};
  for (const c of concepts) {
    const entry: Record<string, unknown> = {};
    if (c.en) entry.en = c.en;
    if (c.area) entry.area = c.area;
    if (c.mathml.length) entry.mathml = c.mathml;
    if (c.tex) entry.tex = c.tex;
    if (c.links.length) entry.links = c.links;
    if (c.alias.length) entry.alias = c.alias;
    map[c.slug] = entry;
  }
  return stringify(map);
}
