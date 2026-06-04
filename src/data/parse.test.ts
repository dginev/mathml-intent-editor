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
    // The old `mathml:` list reads into the notations model (one entry per rendering).
    expect(ab.notations).toEqual([{ mathml: "<math><mi intent='abelian-category'>Ab</mi></math>" }]);
    expect(ab.links).toEqual(['https://example.org/a']); // urls → links
    expect(concepts[1].alias).toEqual(['exponentiation']);
  });

  it('reads the new notations: shape — a list of {tex?, mathml} hashes', () => {
    const yaml = w3cYaml([
      {
        concept: 'power',
        arity: 2,
        notations: [
          { tex: '\\arg{b}{x}^{\\arg{e}{n}}', mathml: "<msup intent='power($b,$e)'><mi>x</mi><mi>n</mi></msup>" },
          { mathml: '<mrow><mi>pow</mi></mrow>' }, // raw-MathML-authored extra: no tex
        ],
      },
    ]);
    const [c] = parseDictionary(yaml);
    expect(c.notations).toEqual([
      { tex: '\\arg{b}{x}^{\\arg{e}{n}}', mathml: "<msup intent='power($b,$e)'><mi>x</mi><mi>n</mi></msup>" },
      { mathml: '<mrow><mi>pow</mi></mrow>' },
    ]);
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

  it('de-duplicates urls and aliases into sets, preserving first-seen order', () => {
    const yaml = w3cYaml([
      {
        concept: 'x',
        urls: ['https://a', 'https://b', 'https://a'],
        alias: ['ex', 'eks', 'ex'],
      },
    ]);
    const [c] = parseDictionary(yaml);
    expect(c.links).toEqual(['https://a', 'https://b']);
    expect(c.alias).toEqual(['ex', 'eks']);
  });

  it('pairs an old-shape scalar tex: onto the first notation', () => {
    const yaml = w3cYaml([
      { concept: 'additive-inverse', arity: 1, tex: '-\\arg{x}{n}', mathml: ['<math><mi>-n</mi></math>'] },
    ]);
    const [c] = parseDictionary(yaml);
    expect(c.notations).toEqual([{ tex: '-\\arg{x}{n}', mathml: '<math><mi>-n</mi></math>' }]);
    // …and a (degenerate) tex with no mathml still survives the read.
    const [bare] = parseDictionary(w3cYaml([{ concept: 'x', tex: '\\mathrm{x}' }]));
    expect(bare.notations).toEqual([{ tex: '\\mathrm{x}', mathml: '' }]);
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
