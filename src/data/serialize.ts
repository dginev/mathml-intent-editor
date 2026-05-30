import { stringify } from 'yaml';
import type { Concept } from '../types';

/** The canonical single group title in the W3C open.yml. */
const GROUP_TITLE = 'Open Concepts';

/** Overwrite a scalar field only when the model has a value — never delete what `raw` already had. */
function overlay(e: Record<string, unknown>, key: string, value: unknown): void {
  if (value !== undefined && value !== null) e[key] = value;
}

/** Arrays are fully owned by the model: set when non-empty, otherwise drop the key. */
function overlayArray(e: Record<string, unknown>, key: string, arr: string[]): void {
  if (arr.length) e[key] = arr;
  else delete e[key];
}

/**
 * Serialize concepts back to the **W3C `open.yml` shape** — a single `concepts:` group of `intents:`
 * entries. We start from each concept's preserved `raw` so unmodeled fields (`property`, `arity`,
 * `notation*`, `comments`, key order) round-trip untouched, then overlay the modeled fields.
 *
 * Note: the editor-only `tex` is intentionally NOT written — adding a field to the shared file is a
 * W3C-format change (needs a group decision); `tex` lives only in the local edit cache.
 */
/** Deterministic canonical order: ASCII (code-unit) by concept slug — matches `LC_ALL=C sort`,
 *  reproducible across machines, and closest to the W3C file's existing order. Minimizes PR churn. */
export function byConcept(a: Concept, b: Concept): number {
  return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
}

export function serializeConcepts(concepts: Concept[]): string {
  const intents = [...concepts].sort(byConcept).map((c) => {
    const e: Record<string, unknown> = { ...(c.raw ?? {}) };
    e.concept = c.slug;
    overlay(e, 'arity', c.arity);
    overlay(e, 'en', c.en);
    overlay(e, 'property', c.property);
    overlay(e, 'area', c.area);
    overlayArray(e, 'mathml', c.mathml);
    overlayArray(e, 'urls', c.links);
    overlayArray(e, 'alias', c.alias);
    delete e.tex; // never persist the editor-only TeX to the shared file
    return e;
  });
  // lineWidth: 0 disables line wrapping — long URLs/MathML stay on one line, so editing one entry
  // never rewraps a neighbour. Deterministic output is what makes the canonical lint + minimal diffs work.
  return stringify({ concepts: [{ title: GROUP_TITLE, intents }] }, { lineWidth: 0 });
}
