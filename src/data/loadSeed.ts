import { parseDictionary } from './parse';
import type { Concept } from './../types';

/**
 * Fetch and parse the seed dictionary from `/open.yml` (served from `public/`).
 *
 * `multiplier` clones every concept N times with a `-{i}` suffix so we can exercise the table at
 * the 10k+ row scale the spec targets while the real seed is only ~1k. Use 1 for real data.
 */
export async function loadSeed(multiplier = 1): Promise<Concept[]> {
  const res = await fetch(`${import.meta.env.BASE_URL}open.yml`);
  if (!res.ok) throw new Error(`Failed to load open.yml: ${res.status}`);
  const base = parseDictionary(await res.text());

  if (multiplier <= 1) return base;

  const grown: Concept[] = [];
  for (let i = 1; i <= multiplier; i++) {
    for (const c of base) {
      grown.push(i === 1 ? c : { ...c, slug: `${c.slug}-${i}` });
    }
  }
  return grown;
}
