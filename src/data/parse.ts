import { parse } from 'yaml';
import type { Concept } from '../types';

/**
 * Raw shape of a single `open.yml` entry. Every field is optional/loose because the source is
 * hand-authored and inconsistent (e.g. `area:` is sometimes empty, `alias` is sometimes a string).
 */
type RawEntry = {
  en?: string;
  area?: string | null;
  mathml?: string | string[];
  tex?: string;
  links?: string | string[];
  alias?: string | string[];
};

const asArray = (v: string | string[] | null | undefined): string[] =>
  v == null ? [] : Array.isArray(v) ? v : [v];

function normalize(slug: string, raw: RawEntry): Concept {
  return {
    slug,
    en: raw.en ?? undefined,
    area: raw.area?.trim() || undefined,
    mathml: asArray(raw.mathml),
    tex: raw.tex || undefined,
    links: asArray(raw.links),
    alias: asArray(raw.alias),
  };
}

/** Parse an `open.yml` document (slug-keyed map) into a normalized `Concept[]`. */
export function parseDictionary(text: string): Concept[] {
  const map = parse(text) as Record<string, RawEntry | null>;
  return Object.entries(map)
    .filter(([, raw]) => raw != null)
    .map(([slug, raw]) => normalize(slug, raw as RawEntry));
}
