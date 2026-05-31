import { describe, expect, it } from 'vitest';
import { parseDictionary } from './parse';
import { w3cYaml } from '../test/dictFixture';

describe('parseDictionary (W3C open.yml schema)', () => {
  it('flattens concepts→intents into Concept[] with mapped fields', () => {
    const yaml = w3cYaml([
      {
        concept: 'abelian-category',
        arity: 0,
        en: 'abelian category',
        property: 'symbol',
        area: 'category theory',
        mathml: ["<math><mi intent='abelian-category'>Ab</mi></math>"],
        urls: ['https://example.org/a'],
      },
      { concept: 'power', arity: 2, en: '$1 to the $2', alias: ['exponentiation'] },
    ]);
    const concepts = parseDictionary(yaml);

    expect(concepts.map((c) => c.slug)).toEqual(['abelian-category', 'power']);
    const ab = concepts[0];
    expect(ab.arity).toBe(0);
    expect(ab.property).toBe('symbol');
    expect(ab.area).toBe('category theory');
    expect(ab.mathml).toEqual(["<math><mi intent='abelian-category'>Ab</mi></math>"]);
    expect(ab.links).toEqual(['https://example.org/a']); // urls → links
    expect(concepts[1].alias).toEqual(['exponentiation']);
  });

  it('collects non-en ISO 639-1 keys into speech, leaving en and unmodeled keys alone', () => {
    const yaml = w3cYaml([
      { concept: 'x', en: 'ex', de: 'Iks', fr: 'ixe', notationa: 'mo ′' },
    ]);
    const [c] = parseDictionary(yaml);
    expect(c.en).toBe('ex'); // English stays in its own field
    expect(c.speech).toEqual([
      { lang: 'de', text: 'Iks' },
      { lang: 'fr', text: 'ixe' },
    ]);
    expect(c.raw?.notationa).toBe('mo ′'); // a non-language key is not mistaken for speech
  });

  it('keeps the original entry in raw for lossless round-trip', () => {
    const yaml = w3cYaml([{ concept: 'x', notationa: 'mo ′', comments: 'legacy' }]);
    const [c] = parseDictionary(yaml);
    expect(c.raw?.notationa).toBe('mo ′');
    expect(c.raw?.comments).toBe('legacy');
  });

  it('tolerates an empty / structureless document', () => {
    expect(parseDictionary('')).toEqual([]);
    expect(parseDictionary('concepts: []')).toEqual([]);
  });
});
