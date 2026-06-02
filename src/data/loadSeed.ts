import { parseDictionary } from './parse';
import type { Concept } from './../types';

/**
 * Fetch and parse the synthetic dev/e2e seed fixture from `/seed.fixture.yml` (served from `public/`).
 * This is NOT the real Intent Open list — the editor reads that from GitHub; the fixture only exists so
 * the no-backend dev path and the 10k-row perf e2e have offline, deterministic data.
 *
 * `multiplier` clones every concept N times with a `-{i}` suffix so a handful of fixture entries can
 * exercise the table at the 10k+ row scale the spec targets. Use 1 for the unmultiplied fixture.
 *
 * A clone's `raw.concept` is updated to the suffixed slug too: the change-classifier recovers a row's
 * baseline identity from `raw.concept` (so a rename still maps to its original), so a clone that kept the
 * original's `raw.concept` would be compared against the original, read as a slug edit, and paint itself
 * "changed". Keeping `raw` in sync makes each clone map to itself → no spurious diff highlighting.
 */
export async function loadSeed(multiplier = 1): Promise<Concept[]> {
  const res = await fetch(`${import.meta.env.BASE_URL}seed.fixture.yml`);
  if (!res.ok) throw new Error(`Failed to load seed.fixture.yml: ${res.status}`);
  const base = parseDictionary(await res.text());

  if (multiplier <= 1) return base;

  const grown: Concept[] = [];
  for (let i = 1; i <= multiplier; i++) {
    for (const c of base) {
      if (i === 1) {
        grown.push(c);
        continue;
      }
      const slug = `${c.slug}-${i}`;
      grown.push({ ...c, slug, ...(c.raw ? { raw: { ...c.raw, concept: slug } } : {}) });
    }
  }
  return grown;
}
