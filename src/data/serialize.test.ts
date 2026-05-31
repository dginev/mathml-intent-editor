import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import { serializeConcepts } from './serialize';
import { parseDictionary } from './parse';
import type { Concept } from '../types';

const concept = (over: Partial<Concept> & { slug: string }): Concept => ({
  en: undefined,
  area: undefined,
  mathml: [],
  links: [],
  alias: [],
  ...over,
});

describe('serializeConcepts', () => {
  it('writes the W3C shape: a single concepts group of intents', () => {
    const out = serializeConcepts([
      concept({ slug: 'power', arity: 2, en: 'power', area: 'arithmetic', mathml: ['<math/>'], links: ['u'] }),
    ]);
    const doc = parse(out) as { concepts: Array<{ title: string; intents: Array<Record<string, unknown>> }> };
    expect(doc.concepts).toHaveLength(1);
    expect(doc.concepts[0].title).toBe('Open Concepts');
    const e = doc.concepts[0].intents[0];
    expect(e.concept).toBe('power');
    expect(e.arity).toBe(2);
    expect(e.urls).toEqual(['u']); // links → urls
    expect('links' in e).toBe(false);
  });

  it('emits concepts in canonical ASCII order regardless of input order', () => {
    const out = serializeConcepts([concept({ slug: 'beta' }), concept({ slug: 'alpha' })]);
    const doc = parse(out) as { concepts: Array<{ intents: Array<{ concept: string }> }> };
    expect(doc.concepts[0].intents.map((e) => e.concept)).toEqual(['alpha', 'beta']);
  });

  it('preserves truly-unmodeled fields via raw, and never writes tex', () => {
    const out = serializeConcepts([
      concept({ slug: 'x', property: 'symbol', tex: '\\arg{a}{x}', raw: { concept: 'x', notation: 'legacy' } }),
    ]);
    const e = (parse(out) as { concepts: Array<{ intents: Array<Record<string, unknown>> }> }).concepts[0]
      .intents[0];
    expect(e.notation).toBe('legacy'); // unmodeled — preserved from raw
    expect(e.property).toBe('symbol'); // modeled — from the concept
    expect('tex' in e).toBe(false); // editor-only, never persisted to the shared file
  });

  it('deletes a modeled field that was cleared (set to empty)', () => {
    const out = serializeConcepts([concept({ slug: 'x', area: undefined, raw: { concept: 'x', area: 'old' } })]);
    const e = (parse(out) as { concepts: Array<{ intents: Array<Record<string, unknown>> }> }).concepts[0]
      .intents[0];
    expect('area' in e).toBe(false); // cleared in the model → removed on write
  });

  it('writes each speech language as its own ISO 639-1 key and drops removed ones', () => {
    const out = serializeConcepts([
      concept({
        slug: 'x',
        en: 'ex',
        speech: [{ lang: 'fr', text: 'ixe' }], // kept
        raw: { concept: 'x', en: 'ex', de: 'Iks', fr: 'old' }, // `de` was removed in the editor
      }),
    ]);
    const e = (parse(out) as { concepts: Array<{ intents: Array<Record<string, unknown>> }> }).concepts[0]
      .intents[0];
    expect(e.en).toBe('ex');
    expect(e.fr).toBe('ixe'); // overwritten from speech
    expect('de' in e).toBe(false); // language dropped in the editor → removed on write
    // and it round-trips back into speech
    const [back] = parseDictionary(out);
    expect(back.speech).toEqual([{ lang: 'fr', text: 'ixe' }]);
  });

  it('round-trips parse → serialize → parse without losing concepts', () => {
    const yaml = serializeConcepts([
      concept({ slug: 'a', arity: 0, property: 'symbol', mathml: ['<math><mi>A</mi></math>'] }),
      concept({ slug: 'b', arity: 1, mathml: ['<math><mi>B</mi></math>'] }),
    ]);
    const back = parseDictionary(yaml);
    expect(back.map((c) => c.slug)).toEqual(['a', 'b']);
    expect(back[0].arity).toBe(0);
    expect(back[0].property).toBe('symbol');
  });
});
