import { stringify } from 'yaml';
import ISO6391 from 'iso-639-1';
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
 * The editor-authored `tex` IS written (as `tex:`) when present, so the TeX source is preserved in the
 * file and re-edits reopen it. (This adds a field to the shared file — a W3C-format change to socialize.)
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
    // Localized speech: write each ISO 639-1 key (en handled above), then drop any language key that
    // the editor removed. Only ISO codes are touched — other keys (notation*, comments…) are untouched.
    const keepLangs = new Set<string>(['en']);
    for (const s of c.speech ?? []) {
      const lang = s.lang.trim();
      if (!lang || lang === 'en' || !ISO6391.validate(lang)) continue;
      setOrDelete(e, lang, s.text);
      if (typeof s.text === 'string' && s.text.trim() !== '') keepLangs.add(lang);
    }
    for (const k of Object.keys(e)) {
      if (ISO6391.validate(k) && !keepLangs.has(k)) delete e[k];
    }
    setOrDelete(e, 'property', c.property);
    setOrDelete(e, 'area', c.area);
    setOrDelete(e, 'mathml', c.mathml);
    setOrDelete(e, 'urls', c.links);
    setOrDelete(e, 'alias', c.alias);
    setOrDelete(e, 'tex', c.tex); // preserve the editor's TeX source when present
    return e;
  });
  // lineWidth: 0 disables line wrapping — long URLs/MathML stay on one line, so editing one entry
  // never rewraps a neighbour. Deterministic output is what makes the canonical lint + minimal diffs work.
  return stringify({ concepts: [{ title: GROUP_TITLE, intents }] }, { lineWidth: 0 });
}
