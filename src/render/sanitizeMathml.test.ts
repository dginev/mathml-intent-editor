import { describe, expect, it } from 'vitest';
import { sanitizeMathml } from './sanitizeMathml';

describe('sanitizeMathml', () => {
  it('keeps presentation MathML and the intent/arg annotations', () => {
    const out = sanitizeMathml("<math><mrow intent='neg($x)'><mo>-</mo><mi arg='x'>n</mi></mrow></math>");
    expect(out).toContain('<math');
    expect(out).toContain('<mrow');
    expect(out).toContain('<mi');
    expect(out).toContain('intent="neg($x)"'); // annotations preserved (quotes normalized)
    expect(out).toContain('arg="x"');
  });

  it('strips event handlers from a malicious notation', () => {
    const out = sanitizeMathml('<math><mtext><img src=x onerror="alert(document.domain)"></mtext></math>');
    expect(out.toLowerCase()).not.toContain('onerror');
    expect(out.toLowerCase()).not.toContain('<img');
    expect(out).toContain('<math'); // the safe wrapper survives
  });

  it('strips scripts and foreign HTML smuggled via annotation-xml (text/html)', () => {
    const out = sanitizeMathml(
      '<math><semantics><annotation-xml encoding="text/html"><script>alert(1)</script><a href="javascript:alert(2)">x</a></annotation-xml></semantics></math>',
    );
    expect(out.toLowerCase()).not.toContain('<script');
    expect(out.toLowerCase()).not.toContain('javascript:');
  });
});
