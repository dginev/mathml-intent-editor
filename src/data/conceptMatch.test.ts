import { describe, expect, it } from 'vitest';
import { conceptMatches, matchRank } from './conceptMatch';
import type { Concept } from '../types';

const c = (o: Partial<Concept>): Concept => ({ slug: '', mathml: [], links: [], alias: [], ...o });

describe('matchRank', () => {
  it('ranks by the matched cell: concept(0) < speech(1) < area(2) < alias(3); -1 = no match', () => {
    expect(matchRank(c({ slug: 'power' }), 'pow')).toBe(0);
    expect(matchRank(c({ en: 'power of two' }), 'two')).toBe(1);
    expect(matchRank(c({ speech: [{ lang: 'de', text: 'Potenz' }] }), 'potenz')).toBe(1);
    expect(matchRank(c({ area: 'arithmetic' }), 'arith')).toBe(2);
    expect(matchRank(c({ alias: ['exponent'] }), 'expo')).toBe(3);
    expect(matchRank(c({ slug: 'power' }), 'zzz')).toBe(-1);
  });

  it('returns the highest-priority field when several match', () => {
    expect(matchRank(c({ slug: 'ratio', area: 'ratio theory' }), 'ratio')).toBe(0); // slug beats area
  });
});

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
