import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadSeed } from './loadSeed';
import { w3cYaml } from '../test/dictFixture';

const SAMPLE_YAML = w3cYaml([
  {
    concept: 'power',
    en: '$1 to the $2',
    area: 'arithmetic',
    mathml: ["<math><msup><mi arg='1'>x</mi><mi arg='2'>n</mi></msup></math>"],
    urls: ['https://en.wikipedia.org/wiki/Exponentiation'],
    alias: ['exponentiation'],
  },
  {
    concept: 'abelian-category',
    en: 'abelian category',
    area: '',
    mathml: "<math><mi intent='abelian-category'>Ab</mi></math>", // scalar → one-element array
  },
]);

function mockFetch(body: string, ok = true) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok, status: ok ? 200 : 500, text: async () => body })),
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('loadSeed', () => {
  it('normalizes the loose seed shape into Concept[]', async () => {
    mockFetch(SAMPLE_YAML);
    const concepts = await loadSeed();

    expect(concepts).toHaveLength(2);
    const power = concepts.find((c) => c.slug === 'power')!;
    expect(power.en).toBe('$1 to the $2');
    expect(power.area).toBe('arithmetic');
    expect(power.alias).toEqual(['exponentiation']);
    expect(power.links).toEqual(['https://en.wikipedia.org/wiki/Exponentiation']); // from `urls`

    // A scalar `mathml` becomes a one-element array; empty `area` becomes undefined.
    const ab = concepts.find((c) => c.slug === 'abelian-category')!;
    expect(ab.notations).toEqual([{ mathml: "<math><mi intent='abelian-category'>Ab</mi></math>" }]);
    expect(ab.area).toBeUndefined();
    expect(ab.links).toEqual([]);
  });

  it('clones concepts with a -N suffix when multiplied', async () => {
    mockFetch(SAMPLE_YAML);
    const concepts = await loadSeed(3);

    expect(concepts).toHaveLength(6);
    expect(concepts.filter((c) => c.slug === 'power')).toHaveLength(1);
    expect(concepts.some((c) => c.slug === 'power-2')).toBe(true);
    expect(concepts.some((c) => c.slug === 'power-3')).toBe(true);
    // A clone's raw.concept tracks its suffixed slug, so it maps to itself in the change-classifier
    // (otherwise every clone reads as a slug edit of the original and paints "changed").
    expect(concepts.find((c) => c.slug === 'power-2')!.raw?.concept).toBe('power-2');
  });

  it('throws on a failed fetch', async () => {
    mockFetch('', false);
    await expect(loadSeed()).rejects.toThrow(/Failed to load/);
  });
});
