import { stringify } from 'yaml';
import type { Concept } from '../types';

/** The canonical single group title in the W3C open.yml. */
const GROUP_TITLE = 'Open Concepts';

/**
 * Modeled fields are authoritative: set when present, deleted when empty/absent (so a cleared field is
 * removed). Fields we don't model (`notation*`, `comments`) are left untouched via the `raw` spread.
 */
function setOrDelete(e: Record<string, unknown>, key: string, value: unknown): void {
  if (value === undefined || value === null || (Array.isArray(value) && value.length === 0)) {
    delete e[key];
  } else {
    e[key] = value;
  }
}

/**
 * Serialize concepts back to the **W3C `open.yml` shape** — a single `concepts:` group of `intents:`
 * entries. We start from each concept's preserved `raw` so unmodeled fields (`property`, `arity`,
 * `notation*`, `comments`, key order) round-trip untouched, then overlay the modeled fields.
 *
 * Note: the editor-only `tex` is intentionally NOT written — adding a field to the shared file is a
 * W3C-format change (needs a group decision); `tex` lives only in the local edit cache.
 */
/**
 * Deterministic canonical order, fully determined by `(concept, arity)`: ASCII (code-unit) by slug,
 * then ascending arity. Reproducible across machines, closest to the W3C file's order, and gives the
 * overloaded names (e.g. disjoint-union 1 then 2) a stable position — minimizing PR churn.
 */
export function byConcept(a: Concept, b: Concept): number {
  if (a.slug !== b.slug) return a.slug < b.slug ? -1 : 1;
  return (a.arity ?? 0) - (b.arity ?? 0);
}

export function serializeConcepts(concepts: Concept[]): string {
  const intents = [...concepts].sort(byConcept).map((c) => {
    const e: Record<string, unknown> = { ...(c.raw ?? {}) };
    e.concept = c.slug;
    setOrDelete(e, 'arity', c.arity);
    setOrDelete(e, 'en', c.en);
    setOrDelete(e, 'property', c.property);
    setOrDelete(e, 'area', c.area);
    setOrDelete(e, 'mathml', c.mathml);
    setOrDelete(e, 'urls', c.links);
    setOrDelete(e, 'alias', c.alias);
    delete e.tex; // never persist the editor-only TeX to the shared file
    return e;
  });
  // lineWidth: 0 disables line wrapping — long URLs/MathML stay on one line, so editing one entry
  // never rewraps a neighbour. Deterministic output is what makes the canonical lint + minimal diffs work.
  return stringify({ concepts: [{ title: GROUP_TITLE, intents }] }, { lineWidth: 0 });
}
