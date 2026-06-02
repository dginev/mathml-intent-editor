import { describe, it, expect } from 'vitest';
import { minifyMathml } from './minifyMathml';

const FN = '⁡'; // U+2061 invisible function application

describe('minifyMathml', () => {
  it('drops cosmetic <mspace> spacing but keeps the invisible function-apply operator', () => {
    const rich =
      `<math><mrow><mrow><mi>sin</mi><mo>${FN}</mo><mspace width="0.1667em"></mspace></mrow><mi>x</mi></mrow></math>`;
    const out = minifyMathml(rich);
    expect(out).not.toContain('mspace');
    expect(out).toContain(FN);
  });

  it('removes tml-* cosmetic class hooks', () => {
    const rich = '<math><msup><mi>x</mi><mn class="tml-sml-pad">2</mn></msup></math>';
    expect(minifyMathml(rich)).toBe('<math><msup><mi>x</mi><mn>2</mn></msup></math>');
  });

  it('flattens a single-child <mrow> left behind after stripping a strut', () => {
    const rich =
      '<math><msqrt><mrow><mi>x</mi><mspace width="0pt" height="0.5em"></mspace></mrow></msqrt></math>';
    expect(minifyMathml(rich)).toBe('<math><msqrt><mi>x</mi></msqrt></math>');
  });

  it('preserves intent and arg annotations (and never flattens an annotated mrow)', () => {
    const rich = '<math><mrow intent="f($x)"><mi arg="x" class="tml-foo">n</mi></mrow></math>';
    const out = minifyMathml(rich);
    expect(out).toContain('intent="f($x)"');
    expect(out).toContain('arg="x"');
    expect(out).not.toContain('class');
  });

  it('is idempotent', () => {
    const rich =
      `<math><mrow><mrow><mi>sin</mi><mo>${FN}</mo><mspace width="0.1667em"></mspace></mrow><mi>x</mi></mrow></math>`;
    const once = minifyMathml(rich);
    expect(minifyMathml(once)).toBe(once);
  });

  it('leaves an already-clean tree unchanged', () => {
    const clean = '<math><mfrac><mi>a</mi><mi>b</mi></mfrac></math>';
    expect(minifyMathml(clean)).toBe(clean);
  });

  it('leaves malformed input untouched', () => {
    const bad = '<math><mfrac><mi>a</mi></math>';
    expect(minifyMathml(bad)).toBe(bad);
  });
});
