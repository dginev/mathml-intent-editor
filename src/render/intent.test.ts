import { describe, expect, it } from 'vitest';
import temml from 'temml';
import { missingSpeechRefs, texToIntent } from './intent';
import type { TemmlEngine } from './temmlEngine';

// In Node (vitest) Temml's command registration works correctly, so we use the real engine directly.
const engine = temml as unknown as TemmlEngine;

// Argument names are MathML Intent references and must be valid NCNames (cannot start with a digit),
// so we use alphabetic names (e.g. `x`, `n`, `d`) — not positional numbers.

describe('texToIntent', () => {
  it('stamps a zero-argument concept with a bare intent name', () => {
    const r = texToIntent(engine, '\\mathrm{Ab}', 'abelian-category');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.arity).toBe(0);
      expect(r.mathml).toContain('intent="abelian-category"');
      expect(r.mathml).not.toContain('arg=');
      // dictionary fragments are stored without the <math> wrapper
      expect(r.mathml).not.toContain('<math');
    }
  });

  it('auto-composes the intent from \\arg markers when no explicit \\intent is given', () => {
    const r = texToIntent(engine, '-\\arg{x}{n}', 'additive-inverse');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.arity).toBe(1);
      expect(r.mathml).toContain('arg="x"');
      expect(r.mathml).toContain('intent="additive-inverse($x)"');
    }
  });

  it('handles two arguments, composing them in order', () => {
    const r = texToIntent(engine, '\\frac{\\arg{n}{a}}{\\arg{d}{b}}', 'ratio');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.arity).toBe(2);
      expect(r.mathml).toContain('arg="n"');
      expect(r.mathml).toContain('arg="d"');
      expect(r.mathml).toContain('intent="ratio($n,$d)"');
    }
  });

  it('lets an explicit \\intent override the concept default', () => {
    const r = texToIntent(engine, '\\intent{custom-name($a)}{\\arg{a}{x}}', 'ignored-slug');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.mathml).toContain('intent="custom-name($a)"');
      expect(r.mathml).not.toContain('ignored-slug');
    }
  });

  it('accepts the official \\MathMLintent / \\MathMLarg names', () => {
    const r = texToIntent(engine, '\\MathMLintent{f($a)}{\\MathMLarg{a}{x}}', 'slug');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.mathml).toContain('intent="f($a)"');
      expect(r.mathml).toContain('arg="a"');
    }
  });

  it('handles an argument whose content has nested braces', () => {
    const r = texToIntent(engine, '\\sqrt{\\arg{r}{\\frac{a}{b}}}', 'root-of-ratio');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.arity).toBe(1);
      expect(r.mathml).toContain('<mfrac arg="r">');
      expect(r.mathml).toContain('intent="root-of-ratio($r)"');
    }
  });

  it('strips Temml cosmetic classes', () => {
    const r = texToIntent(engine, 'x^2', 'power-example');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.mathml).not.toContain('class=');
  });

  it('returns an error result for invalid TeX', () => {
    const r = texToIntent(engine, '\\frac{1}', 'broken');
    expect(r.ok).toBe(false);
  });
});

describe('missingSpeechRefs', () => {
  it('matches positional $N speech refs to arg="aN" notation (W3C convention)', () => {
    const mathml = "<math><mi arg='a1'>A</mi><mi arg='a2'>B</mi></math>";
    expect(missingSpeechRefs('union of $1 and $2', mathml)).toEqual([]);
  });

  it('matches named $name speech refs directly to arg="name"', () => {
    expect(missingSpeechRefs('$lhs iff $rhs', "<math><mi arg='lhs'/><mi arg='rhs'/></math>")).toEqual([]);
  });

  it('reports refs with no matching argument', () => {
    const mathml = "<math><mi arg='a1'>A</mi></math>";
    expect(missingSpeechRefs('f of $1 and $2', mathml)).toEqual(['$2']);
    expect(missingSpeechRefs('$x', '<math><mi>x</mi></math>')).toEqual(['$x']);
  });
});
