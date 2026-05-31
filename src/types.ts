/**
 * The editor's data model — a normalized view of one entry in the W3C MathML Intent `open.yml`
 * (w3c/mathml-docs `_data/open.yml`; the backing repo mirrors it). The on-disk schema is a single
 * `concepts:` group of `intents:` entries with keys `concept`/`arity`/`en`/`property`/`area`/
 * `mathml`/`urls`/`alias` (+ legacy `notation*`/`comments`). We keep that format unchanged — schema
 * changes require a W3C group decision — and round-trip unknown fields via `raw`.
 */
/** A localized speech template, keyed by an ISO 639-1 language code (e.g. `de`, `fr`). */
export type SpeechEntry = { lang: string; text: string };

export type Concept = {
  /** kebab-case identifier (the `concept:` key). Unique per dictionary. */
  slug: string;
  /** English speech template (the `en:` key). Positional argument refs are written `$1`, `$2`, … */
  en?: string;
  /**
   * Speech templates in languages other than English — each serialized as its own ISO 639-1 key
   * (`de:`, `fr:`, …) alongside `en`. English lives in `en`; this holds the rest.
   */
  speech?: SpeechEntry[];
  /** Subject area, e.g. "number theory". */
  area?: string;
  /** Argument count of the concept. */
  arity?: number;
  /** Notation form, e.g. "symbol", "indexed", "prefix", "function". */
  property?: string;
  /** Example renderings as full `<math>…</math>` strings, carrying `intent=`/`arg=` annotations. */
  mathml: string[];
  /** Reference URLs (the `urls:` key). */
  links: string[];
  /** Alternate names/slugs. */
  alias: string[];
  /**
   * Editor-authored TeX source — kept **locally only** (edit cache), so re-editing reopens the
   * original source. NOT written to `open.yml` (that would change the W3C format). Absent for entries
   * loaded from the file.
   */
  tex?: string;
  /** The original YAML entry, preserved so serialization round-trips fields we don't model. */
  raw?: Record<string, unknown>;
};
