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

  it('preserves intent/arg and strips cosmetic class even on a kept (annotated-child) wrapper', () => {
    const rich = '<math><mrow intent="f($x)"><mi arg="x" class="tml-foo">n</mi></mrow></math>';
    const out = minifyMathml(rich);
    expect(out).toContain('intent="f($x)"');
    expect(out).toContain('arg="x"');
    expect(out).not.toContain('class');
  });

  it('unwraps a no-op <mpadded lspace="0"> wrapper (e.g. from \\mathrm)', () => {
    const rich = '<math><mpadded lspace="0"><mi>Ab</mi></mpadded></math>';
    expect(minifyMathml(rich)).toBe('<math><mi>Ab</mi></math>');
  });

  it('copies intent/arg down onto an unannotated single child, then unwraps the annotated wrapper', () => {
    expect(minifyMathml('<math><mpadded lspace="0" intent="abelian-category"><mi>Ab</mi></mpadded></math>')).toBe(
      '<math><mi intent="abelian-category">Ab</mi></math>',
    );
    expect(minifyMathml('<math><mrow arg="x"><mi>n</mi></mrow></math>')).toBe('<math><mi arg="x">n</mi></math>');
  });

  it('keeps an annotated wrapper when the move is unsafe (child already annotated, or many children)', () => {
    // inner already carries arg → moving intent down could collide/rebind → keep the wrapper
    const collide = '<math><mrow intent="f($x)"><mi arg="x">n</mi></mrow></math>';
    expect(minifyMathml(collide)).toBe(collide);
    // more than one child → not a single-child unwrap → keep
    const multi = '<math><mrow intent="s($a,$b)"><mi arg="a">x</mi><mo>+</mo><mi arg="b">y</mi></mrow></math>';
    expect(minifyMathml(multi)).toBe(multi);
  });

  it('keeps an <mpadded> that carries real spacing (non-zero lspace)', () => {
    const rich = '<math><mpadded lspace="0.2222em"><mi>x</mi></mpadded></math>';
    expect(minifyMathml(rich)).toBe(rich);
  });

  it('keeps an <mpadded> with a layout attribute (width), even at lspace 0', () => {
    const rich = '<math><mpadded width="0" lspace="0"><mi>x</mi></mpadded></math>';
    expect(minifyMathml(rich)).toBe(rich);
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
