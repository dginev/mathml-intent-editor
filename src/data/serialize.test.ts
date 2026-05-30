import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import { serializeConcepts } from './serialize';
import type { Concept } from '../types';

const concepts: Concept[] = [
  {
    slug: 'additive-inverse',
    en: 'additive inverse of $x',
    area: 'abstract algebra',
    mathml: ['<mrow intent="additive-inverse($x)"><mo>-</mo><mi arg="x">n</mi></mrow>'],
    links: ['https://en.wikipedia.org/wiki/Additive_inverse'],
    alias: ['negation'],
  },
  { slug: 'lonely', en: undefined, area: undefined, mathml: [], links: [], alias: [] },
];

describe('serializeConcepts', () => {
  it('round-trips through the seed YAML shape keyed by slug', () => {
    const map = parse(serializeConcepts(concepts)) as Record<string, Record<string, unknown>>;

    expect(Object.keys(map)).toEqual(['additive-inverse', 'lonely']);
    expect(map['additive-inverse'].en).toBe('additive inverse of $x');
    expect(map['additive-inverse'].area).toBe('abstract algebra');
    expect(map['additive-inverse'].mathml).toHaveLength(1);
    expect(map['additive-inverse'].alias).toEqual(['negation']);
  });

  it('omits empty/absent fields rather than emitting null', () => {
    const map = parse(serializeConcepts(concepts)) as Record<string, Record<string, unknown>>;
    expect(map['lonely']).toEqual({});
    expect('en' in map['lonely']).toBe(false);
    expect('mathml' in map['lonely']).toBe(false);
  });
});
