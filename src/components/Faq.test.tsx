import { fireEvent, render, screen } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { Faq } from './Faq';

beforeAll(() => {
  // jsdom's <dialog> may lack showModal/close; no-op polyfills keep the dialog effect from throwing.
  HTMLDialogElement.prototype.showModal ||= function (this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close ||= function (this: HTMLDialogElement) {
    this.open = false;
  };
});

describe('Faq', () => {
  it('renders the sign-in permission reassurances when open', () => {
    render(<Faq open onClose={vi.fn()} />);
    const dialog = screen.getByTestId('faq');
    expect(dialog).toHaveTextContent(/why sign in/i);
    expect(dialog).toHaveTextContent(/@handle/);
    expect(dialog).toHaveTextContent(/no repository access/i);
    expect(dialog).toHaveTextContent(/authored as you/i);
    expect(dialog).toHaveTextContent(/localStorage/);
    expect(dialog).toHaveTextContent(/pull request/i);
    expect(dialog).toHaveTextContent(/revoke/i);
  });

  it('leads with the About section: what the editor does and how (round-3 documentation ask)', () => {
    render(<Faq open onClose={vi.fn()} />);
    const dialog = screen.getByTestId('faq');
    expect(dialog).toHaveTextContent(/what is this editor/i);
    expect(dialog).toHaveTextContent(/how does it work/i);
    expect(dialog).toHaveTextContent(/how do i edit a concept/i);
    expect(dialog).toHaveTextContent(/nothing reaches github until/i); // Done ≠ Save, the key confusion
    expect(dialog).toHaveTextContent(/accessible readouts/i); // the "what" in one breath
    // …and the deep dive: a real link to the MathML Intent spec.
    const spec = screen.getByRole('link', { name: /mathml intent/i });
    expect(spec.getAttribute('href')).toContain('w3c.github.io');
    // The closing provenance entry: W3C charter origin + a reachable maintainer.
    expect(dialog).toHaveTextContent(/how did this project start/i);
    expect(screen.getByRole('link', { name: 'deyan@arxiv.org' })).toHaveAttribute(
      'href',
      'mailto:deyan@arxiv.org',
    );
  });

  it('legends the Added/Edited/Deleted row highlights with swatches tied to the theme variables', () => {
    render(<Faq open onClose={vi.fn()} />);
    const dialog = screen.getByTestId('faq');
    // The words carry the meaning (color is never the only carrier, per WCAG 1.4.1)…
    expect(dialog).toHaveTextContent(/added/i);
    expect(dialog).toHaveTextContent(/edited/i);
    expect(dialog).toHaveTextContent(/deleted/i);
    // …each row kind shows its live swatch (colored by the --diff-* variables in CSS, so the
    // legend follows any theme/palette change automatically), and each swatch carries an
    // accessible name describing its color.
    expect(screen.getByRole('img', { name: /green/i })).toHaveClass('swatch-added');
    expect(screen.getByRole('img', { name: /purple/i })).toHaveClass('swatch-edited');
    expect(screen.getByRole('img', { name: /red/i })).toHaveClass('swatch-deleted');
    // The status glyphs are named by what they look like (the visible word carries the meaning):
    // a raw "✎" may be skipped or mangled by screen readers.
    expect(screen.getByRole('img', { name: 'plus icon' })).toHaveTextContent('+');
    expect(screen.getByRole('img', { name: 'pencil icon' })).toHaveTextContent('✎');
    expect(screen.getByRole('img', { name: 'minus icon' })).toHaveTextContent('−');
  });

  it('focuses the title on open so reading starts at the top, not the bottom Close button', () => {
    render(<Faq open onClose={vi.fn()} />);
    const title = screen.getByRole('heading', { level: 2 });
    expect(document.activeElement).toBe(title);
    // The dialog takes its accessible name from the visible title.
    expect(screen.getByTestId('faq')).toHaveAttribute('aria-labelledby', title.id);
  });

  it('closes via its Close button', () => {
    const onClose = vi.fn();
    render(<Faq open onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Close FAQ' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('renders nothing visible while closed', () => {
    render(<Faq open={false} onClose={vi.fn()} />);
    expect((screen.getByTestId('faq') as HTMLDialogElement).open).toBe(false);
  });
});
