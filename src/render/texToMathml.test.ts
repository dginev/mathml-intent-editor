import { describe, expect, it } from 'vitest';
import { texToMathML } from './texToMathml';

describe('texToMathML', () => {
  it('renders a superscript to <msup>', () => {
    const r = texToMathML('x^2');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.mathml).toContain('<msup>');
      expect(r.mathml).toContain('<mi>x</mi>');
      expect(r.mathml).toContain('<mn');
    }
  });

  it('renders a fraction to <mfrac>', () => {
    const r = texToMathML('\\frac{1}{2}');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.mathml).toContain('<mfrac>');
  });

  it('strips Temml cosmetic class attributes so output matches the dictionary style', () => {
    const r = texToMathML('x^2');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.mathml).not.toContain('class=');
      expect(r.mathml).not.toContain('tml-');
    }
  });

  it('returns an error result for invalid TeX instead of throwing', () => {
    const r = texToMathML('\\frac{1}'); // missing second argument
    expect(r.ok).toBe(false);
    if (!r.ok) expect(typeof r.error).toBe('string');
  });

  it('treats empty input as an empty (ok) render', () => {
    const r = texToMathML('   ');
    expect(r.ok).toBe(true);
  });
});
