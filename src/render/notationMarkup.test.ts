import { describe, it, expect } from 'vitest';
import temml from 'temml';
import { notationMarkup } from './notationMarkup';
import type { TemmlEngine } from './temmlEngine';
import type { Concept } from '../types';

const engine = temml as unknown as TemmlEngine;
const make = (over: Partial<Concept>): Concept => ({ slug: 's', mathml: [], links: [], alias: [], ...over });

describe('notationMarkup', () => {
  it('re-renders the rich MathML from tex when present (cosmetic classes restored)', () => {
    const c = make({ slug: 'power', tex: 'x^2', mathml: ['<math><msup><mi>x</mi><mn>2</mn></msup></math>'] });
    expect(notationMarkup(c, engine)).toContain('class=');
  });

  it('uses the stored mathml directly when there is no tex', () => {
    const stored = '<math><mi intent="abelian-category">Ab</mi></math>';
    const c = make({ slug: 'ab', mathml: [stored] });
    expect(notationMarkup(c, engine)).toBe(stored);
  });

  it('uses the stored mathml until the engine has loaded', () => {
    const stored = '<math><msup><mi>x</mi><mn>2</mn></msup></math>';
    const c = make({ slug: 'power-not-loaded', tex: 'x^2', mathml: [stored] });
    expect(notationMarkup(c, null)).toBe(stored);
  });

  it('falls back to the stored mathml when the tex fails to render', () => {
    const stored = '<math><mi>fallback</mi></math>';
    const c = make({ slug: 'broken', tex: '\\frac{1}', mathml: [stored] });
    expect(notationMarkup(c, engine)).toBe(stored);
  });
});
