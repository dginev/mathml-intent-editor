import { parse } from 'yaml';
import ISO6391 from 'iso-639-1';
import type { Concept, Notation, SpeechEntry } from '../types';
import { uniq } from '../uniq';

/** A raw `intents:` entry. Loose because the file is hand-authored; unknown keys are kept in `raw`. */
type RawEntry = Record<string, unknown> & {
  concept?: string;
  en?: string;
  area?: string | null;
  arity?: number;
  property?: string;
  notations?: Array<Record<string, unknown>>;
  mathml?: string | string[];
  urls?: string | string[];
  alias?: string | string[];
  tex?: string;
};

type Doc = { concepts?: Array<{ title?: string; intents?: RawEntry[] }> };

const asArray = (v: unknown): string[] =>
  v == null ? [] : Array.isArray(v) ? (v as string[]) : [String(v)];

/**
 * Read an entry's renderings, accepting **both** schema generations:
 * - new: `notations:` — a list of `{tex?, mathml}` hashes;
 * - old: a `mathml:` list (+ optional scalar `tex:`, which pairs onto the FIRST rendering — the only
 *   one the old editor could author in TeX). Keeps the W3C upstream file, pre-migration branches, and
 *   old seed fixtures loadable; the serializer emits only the new shape.
 */
function readNotations(e: RawEntry): Notation[] {
  if (Array.isArray(e.notations)) {
    const out: Notation[] = [];
    for (const n of e.notations) {
      if (n == null || typeof n !== 'object' || typeof n.mathml !== 'string') continue;
      out.push(typeof n.tex === 'string' ? { tex: n.tex, mathml: n.mathml } : { mathml: n.mathml });
    }
    return out;
  }
  const list = asArray(e.mathml);
  const tex = typeof e.tex === 'string' ? e.tex : undefined;
  if (list.length === 0) return tex !== undefined ? [{ tex, mathml: '' }] : [];
  return list.map((mathml, i) => (i === 0 && tex !== undefined ? { tex, mathml } : { mathml }));
}

function normalize(e: RawEntry): Concept {
  // Any string-valued key that is a valid ISO 639-1 code (other than `en`) is a localized speech
  // template. `en` stays in its own field; the rest are collected here in file order.
  const speech: SpeechEntry[] = [];
  for (const [k, v] of Object.entries(e)) {
    if (k !== 'en' && typeof v === 'string' && ISO6391.validate(k)) speech.push({ lang: k, text: v });
  }
  return {
    slug: String(e.concept),
    en: typeof e.en === 'string' ? e.en : undefined,
    speech,
    area: typeof e.area === 'string' ? e.area.trim() || undefined : undefined,
    arity: typeof e.arity === 'number' ? e.arity : undefined,
    property: typeof e.property === 'string' ? e.property : undefined,
    notations: readNotations(e),
    // `urls`/`alias` are sets — de-duplicate on read so the model (and the next Save's diff) is clean.
    links: uniq(asArray(e.urls)),
    alias: uniq(asArray(e.alias)),
    raw: e,
  };
}

/**
 * Parse the W3C `open.yml` (`concepts: [{ title, intents: [...] }]`) into a flat `Concept[]`.
 * Tolerates multiple groups, though the canonical file has one ("Open Concepts").
 */
export function parseDictionary(text: string): Concept[] {
  const doc = parse(text) as Doc | null;
  const out: Concept[] = [];
  for (const group of doc?.concepts ?? []) {
    for (const entry of group?.intents ?? []) {
      if (entry && typeof entry.concept === 'string') out.push(normalize(entry));
    }
  }
  return out;
}
