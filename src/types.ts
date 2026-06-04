/**
 * The editor's data model — a normalized view of one entry in the W3C MathML Intent `open.yml`
 * (w3c/mathml-docs `_data/open.yml`; the backing repo mirrors it). The on-disk schema is a single
 * `concepts:` group of `intents:` entries with keys `concept`/`arity`/`en`/`property`/`area`/
 * `mathml`/`urls`/`alias` (+ legacy `notation*`/`comments`). We keep that format unchanged — schema
 * changes require a W3C group decision — and round-trip unknown fields via `raw`.
 */
/** A localized speech template, keyed by an ISO 639-1 language code (e.g. `de`, `fr`). */
export type SpeechEntry = { lang: string; text: string };

/**
 * One example rendering of a concept (an item of the `notations:` list). `mathml` is the stored,
 * canonical form — a full `<math>…</math>` carrying `intent=`/`arg=` annotations. `tex` is present
 * only when the rendering was authored in TeX (the editor re-renders the rich display from it and
 * reopens it on re-edit); a raw-MathML-authored rendering has no `tex`. The author writes one *or*
 * the other — we always store the MathML.
 */
export type Notation = { mathml: string; tex?: string };

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
  /**
   * Example renderings (the `notations:` list; `notations[0]` is the primary one shown in the table).
   * Replaces the older `mathml:` list + scalar `tex:` pair — the parser still reads that shape, the
   * serializer emits only this one.
   */
  notations: Notation[];
  /** Reference URLs (the `urls:` key). */
  links: string[];
  /** Alternate names/slugs. */
  alias: string[];
  /** The original YAML entry, preserved so serialization round-trips fields we don't model. */
  raw?: Record<string, unknown>;
};
