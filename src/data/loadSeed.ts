import { parse } from 'yaml';
import type { Concept } from '../types';

/**
 * Raw shape of a single entry in the seed `open.yml`. Every field is optional/loose because the
 * seed is hand-authored and inconsistent (e.g. `area:` is sometimes empty, `alias` is sometimes
 * a string). Normalization happens in `normalize()`.
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

/**
 * Fetch and parse the seed dictionary from `/open.yml` (served from `public/`).
 *
 * `multiplier` clones every concept N times with a `-{i}` suffix so we can exercise the table at
 * the 10k+ row scale the spec targets while the real seed is only ~1k. Use 1 for real data.
 */
export async function loadSeed(multiplier = 1): Promise<Concept[]> {
  const res = await fetch(`${import.meta.env.BASE_URL}open.yml`);
  if (!res.ok) throw new Error(`Failed to load open.yml: ${res.status}`);
  const map = parse(await res.text()) as Record<string, RawEntry | null>;

  const base: Concept[] = Object.entries(map)
    .filter(([, raw]) => raw != null)
    .map(([slug, raw]) => normalize(slug, raw as RawEntry));

  if (multiplier <= 1) return base;

  const grown: Concept[] = [];
  for (let i = 1; i <= multiplier; i++) {
    for (const c of base) {
      grown.push(i === 1 ? c : { ...c, slug: `${c.slug}-${i}` });
    }
  }
  return grown;
}
