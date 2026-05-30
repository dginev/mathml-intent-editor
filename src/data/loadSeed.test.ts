import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadSeed } from './loadSeed';

const SAMPLE_YAML = `
power:
  en: $_1 to the $_2
  area: arithmetic
  mathml:
   - "<msup><mi arg='_1'>x</mi><mi arg='_2'>n</mi></msup>"
  links:
   - "https://en.wikipedia.org/wiki/Exponentiation"
  alias:
   - exponentiation
abelian-category:
  en: abelian category
  area:
  mathml: "<mi intent='abelian-category'>Ab</mi>"
`;

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
    expect(power.en).toBe('$_1 to the $_2');
    expect(power.area).toBe('arithmetic');
    expect(power.alias).toEqual(['exponentiation']);

    // A scalar `mathml` becomes a one-element array; empty `area` becomes undefined.
    const ab = concepts.find((c) => c.slug === 'abelian-category')!;
    expect(ab.mathml).toEqual(["<mi intent='abelian-category'>Ab</mi>"]);
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
  });

  it('throws on a failed fetch', async () => {
    mockFetch('', false);
    await expect(loadSeed()).rejects.toThrow(/Failed to load/);
  });
});
