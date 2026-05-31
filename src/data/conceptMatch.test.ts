import { describe, expect, it } from 'vitest';
import { conceptMatches } from './conceptMatch';
import type { Concept } from '../types';

const c = (o: Partial<Concept>): Concept => ({ slug: '', mathml: [], links: [], alias: [], ...o });

describe('conceptMatches', () => {
  it('matches slug, en, area, alias, and speech (case-insensitive)', () => {
    expect(conceptMatches(c({ slug: 'additive-inverse' }), 'INVERSE')).toBe(true);
    expect(conceptMatches(c({ en: 'additive inverse of $1' }), 'inverse of')).toBe(true);
    expect(conceptMatches(c({ area: 'abstract algebra' }), 'algebra')).toBe(true);
    expect(conceptMatches(c({ alias: ['opposite'] }), 'oppos')).toBe(true);
    expect(conceptMatches(c({ speech: [{ lang: 'de', text: 'additives Inverses' }] }), 'inverses')).toBe(true);
  });

  it('returns false when nothing matches, true for an empty query', () => {
    expect(conceptMatches(c({ slug: 'power' }), 'zzz')).toBe(false);
    expect(conceptMatches(c({ slug: 'power' }), '   ')).toBe(true);
  });
});
