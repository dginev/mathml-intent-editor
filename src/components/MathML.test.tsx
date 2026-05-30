import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MathML } from './MathML';

describe('MathML', () => {
  it('injects MathML markup into the DOM', () => {
    const { container } = render(<MathML markup="<math><mi>x</mi></math>" />);
    expect(container.querySelector('math')).not.toBeNull();
    expect(container.querySelector('mi')?.textContent).toBe('x');
  });

  it('wraps a bare fragment (dictionary/intent style) in <math> so it renders', () => {
    const { container } = render(
      <MathML markup="<mrow intent='additive-inverse($_1)'><mo>-</mo><mi arg='_1'>n</mi></mrow>" />,
    );
    const math = container.querySelector('math');
    expect(math).not.toBeNull();
    expect(math?.querySelector('mrow')).not.toBeNull();
  });

  it('does not double-wrap markup that already has a <math> root', () => {
    const { container } = render(<MathML markup="<math><mi>x</mi></math>" />);
    expect(container.querySelectorAll('math')).toHaveLength(1);
  });

  it('renders nothing problematic for empty markup', () => {
    const { container } = render(<MathML markup="" />);
    expect(container.querySelector('math')).toBeNull();
  });
});
