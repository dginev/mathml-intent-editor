import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MathMLSource, MathMLSourceDiff } from './MathMLSource';

describe('MathMLSource', () => {
  it('renders the literal markup as text (no HTML injection)', () => {
    render(<MathMLSource markup={"<mi arg='a1'>A</mi>"} />);
    const pre = screen.getByTestId('mathml-source');
    expect(pre.textContent).toBe("<mi arg='a1'>A</mi>");
    expect(pre.querySelector('mi')).toBeNull(); // shown as source, not parsed into elements
  });

  it('highlights tag names and intent/arg annotations', () => {
    render(<MathMLSource markup={"<mrow intent='neg($x)'><mi arg='x'>n</mi></mrow>"} />);
    const pre = screen.getByTestId('mathml-source');
    expect([...pre.querySelectorAll('.tok-tag')].map((e) => e.textContent)).toContain('mrow');
    const annots = [...pre.querySelectorAll('.tok-annot')].map((e) => e.textContent);
    expect(annots).toContain("intent='neg($x)'");
    expect(annots).toContain("arg='x'");
  });

  it('pretty-prints nested elements with indentation, keeping leaves inline', () => {
    render(
      <MathMLSource markup={"<math><mrow intent='neg($x)'><mo>-</mo><mi arg='x'>n</mi></mrow></math>"} />,
    );
    expect(screen.getByTestId('mathml-source').textContent).toBe(
      "<math>\n  <mrow intent='neg($x)'>\n    <mo>-</mo>\n    <mi arg='x'>n</mi>\n  </mrow>\n</math>",
    );
  });
});

describe('MathMLSourceDiff — unified line-by-line MathML diff (the "abundance" change)', () => {
  // The real abundance#1 notation as PR #13 rewrites it: positional `a1`→named `number`, x→n, and the
  // parens gain fence/form/stretchy attributes.
  const before =
    "<math><mrow intent='abundance($a1)'><mi>A</mi><mrow><mo>(</mo><mi arg='a1'>x</mi><mo>)</mo></mrow></mrow></math>";
  const after =
    '<math><mrow intent="abundance($number)"><mi>A</mi><mrow><mo fence="true" form="prefix" stretchy="false">(</mo><mi arg="number">n</mi><mo fence="true" form="postfix" stretchy="false">)</mo></mrow></mrow></math>';

  it('marks removed lines red and added lines green, keeping unchanged lines as context', () => {
    render(<MathMLSourceDiff before={before} after={after} />);
    const pre = screen.getByTestId('mathml-source-diff');
    const linesOf = (sel: string) => [...pre.querySelectorAll(sel)].map((e) => e.textContent ?? '');
    const dels = linesOf('.diff-line-del');
    const adds = linesOf('.diff-line-add');
    const sames = linesOf('.diff-line-same');

    // the old arg/intent only ever appear on removed lines; the new ones only on added lines
    expect(dels.some((l) => l.includes("arg='a1'"))).toBe(true);
    expect(dels.some((l) => l.includes("intent='abundance($a1)'"))).toBe(true);
    expect(adds.some((l) => l.includes('arg="number"'))).toBe(true);
    expect(adds.some((l) => l.includes('intent="abundance($number)"'))).toBe(true);
    expect(adds.some((l) => l.includes('fence="true"'))).toBe(true);

    // the unchanged <mi>A</mi> leaf is context — present once, never marked added/removed
    expect(sames.some((l) => l.includes('<mi>A</mi>'))).toBe(true);
    expect([...dels, ...adds].some((l) => l.includes('<mi>A</mi>'))).toBe(false);
  });
});
