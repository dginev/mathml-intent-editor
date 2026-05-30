/**
 * The editor's own data model. `open.yml` (the seed) is only a starting shape — we own this type
 * and extend it as the curation workflow needs (see CLAUDE.md "Data model"). Seed import lives in
 * `data/loadSeed.ts`; anything not in the seed is optional here so imported rows stay valid.
 */
export type Concept = {
  /** kebab-case identifier; the YAML map key in the seed. Unique per dictionary. */
  slug: string;
  /** English speech template. Positional argument refs are written `$_1`, `$_2`, … */
  en?: string;
  /** Subject area, e.g. "number theory". May be empty in the seed. */
  area?: string;
  /** One or more example renderings as MathML strings, carrying `intent=`/`arg=` annotations. */
  mathml: string[];
  /**
   * TeX source for the primary notation, when authored in this editor. MathML (above) stays the
   * canonical artifact; `tex` is kept so re-editing reopens the original source. Absent for seed
   * entries (which only ship MathML) — those re-author from blank.
   */
  tex?: string;
  /** Reference URLs. */
  links: string[];
  /** Alternate names/slugs for the concept. */
  alias: string[];
};
