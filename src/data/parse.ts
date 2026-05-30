import { parse } from 'yaml';
import type { Concept } from '../types';

/** A raw `intents:` entry. Loose because the file is hand-authored; unknown keys are kept in `raw`. */
type RawEntry = Record<string, unknown> & {
  concept?: string;
  en?: string;
  area?: string | null;
  arity?: number;
  property?: string;
  mathml?: string | string[];
  urls?: string | string[];
  alias?: string | string[];
};

type Doc = { concepts?: Array<{ title?: string; intents?: RawEntry[] }> };

const asArray = (v: unknown): string[] =>
  v == null ? [] : Array.isArray(v) ? (v as string[]) : [String(v)];

function normalize(e: RawEntry): Concept {
  return {
    slug: String(e.concept),
    en: typeof e.en === 'string' ? e.en : undefined,
    area: typeof e.area === 'string' ? e.area.trim() || undefined : undefined,
    arity: typeof e.arity === 'number' ? e.arity : undefined,
    property: typeof e.property === 'string' ? e.property : undefined,
    mathml: asArray(e.mathml),
    links: asArray(e.urls),
    alias: asArray(e.alias),
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
