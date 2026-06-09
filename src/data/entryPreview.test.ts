import { describe, expect, it } from 'vitest';
import { changedFields, hasHiddenInfo } from './entryPreview';
import type { Concept } from '../types';

const c = (over: Partial<Concept> = {}): Concept => ({
  slug: 'power',
  arity: 2,
  en: 'power of $1 to $2',
  area: 'arithmetic',
  property: 'indexed',
  notations: [{ mathml: '<math><msup/></math>' }],
  links: ['https://w3.org/'],
  alias: [],
  speech: [],
  ...over,
});

describe('changedFields — which fields an edit touched (for the View dialog highlight)', () => {
  it('empty when nothing changed', () => {
    expect([...changedFields(c(), c())]).toEqual([]);
  });

  it('keys each differing field, matching the editor field names', () => {
    expect([...changedFields(c(), c({ area: 'algebra' }))]).toEqual(['area']);
    expect([...changedFields(c(), c({ property: 'function' }))]).toEqual(['property']);
    expect([...changedFields(c(), c({ links: ['https://x/'] }))]).toEqual(['links']);
    expect([...changedFields(c(), c({ alias: ['exp'] }))]).toEqual(['alias']);
    expect([...changedFields(c(), c({ notations: [{ mathml: '<m/>' }] }))]).toEqual(['notations']);
  });

  it('keys English as speech:en and other languages as speech:<lang>', () => {
    expect([...changedFields(c(), c({ en: 'new speech' }))]).toEqual(['speech:en']);
    const base = c({ speech: [{ lang: 'de', text: 'alt' }] });
    expect([...changedFields(base, c({ speech: [{ lang: 'de', text: 'neu' }] }))]).toEqual(['speech:de']);
  });
});

describe('hasHiddenInfo — the general "more to see here" signal', () => {
  it('true for extra notations / other-language speech / aliases / raw extras', () => {
    expect(hasHiddenInfo(c(), 'en')).toBe(false); // a plain entry the row fully shows
    expect(hasHiddenInfo(c({ notations: [{ mathml: '<a/>' }, { mathml: '<b/>' }] }), 'en')).toBe(true);
    expect(hasHiddenInfo(c({ speech: [{ lang: 'fr', text: 'opposé' }] }), 'en')).toBe(true);
    expect(hasHiddenInfo(c({ alias: ['exponentiation'] }), 'en')).toBe(true);
    expect(hasHiddenInfo(c({ raw: { concept: 'power', comments: 'a note' } }), 'en')).toBe(true);
  });

  it('ignores property/arity — near-universal, so not a "more to see" signal', () => {
    expect(hasHiddenInfo(c({ property: 'symbol', arity: 3 }), 'en')).toBe(false);
  });

  it('only languages OTHER than the displayed one count as hidden', () => {
    const bilingual = c({ speech: [{ lang: 'fr', text: 'opposé' }] }); // has en + fr
    expect(hasHiddenInfo(bilingual, 'en')).toBe(true); // fr hidden while showing en
    expect(hasHiddenInfo(bilingual, 'fr')).toBe(true); // en hidden while showing fr
    const onlyFr = c({ en: undefined, speech: [{ lang: 'fr', text: 'opposé' }] });
    expect(hasHiddenInfo(onlyFr, 'fr')).toBe(false); // fr is the only language and it's displayed
  });
});
