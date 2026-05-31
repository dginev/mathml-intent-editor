import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MathMLSource } from './MathMLSource';

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
