import { render, screen, within } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { EntryDetail } from './EntryDetail';
import type { Concept } from '../types';

beforeAll(() => {
  // jsdom's <dialog> may lack showModal/close; no-op polyfills keep the dialog effect from throwing.
  HTMLDialogElement.prototype.showModal ||= function (this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close ||= function (this: HTMLDialogElement) {
    this.open = false;
  };
});

const base: Concept = {
  slug: 'power',
  arity: 2,
  en: 'power of $1 to $2',
  area: 'arithmetic',
  property: 'indexed',
  notations: [{ mathml: '<math><msup><mi>x</mi><mi>n</mi></msup></math>' }],
  links: ['https://w3.org/'],
  alias: ['exponentiation'],
  speech: [{ lang: 'de', text: 'alte deutsche Vorlage' }],
  raw: { concept: 'power', arity: 2, comments: 'legacy authoring note' },
};

const proposed: Concept = {
  ...base,
  en: 'power of $base to $exponent',
  property: 'function',
  notations: [
    { tex: 'x^{n}', mathml: '<math><msup><mi>x</mi><mi>n</mi></msup></math>' },
    { mathml: '<math><mi>secondary</mi></math>' },
  ],
  alias: ['exponentiation', 'pow'],
  speech: [{ lang: 'de', text: 'neue deutsche Vorlage' }],
};

describe('EntryDetail — full-entry preview', () => {
  it('shows current vs proposed side by side for a changed entry, surfacing the hidden secondary fields', () => {
    render(<EntryDetail concept={proposed} base={base} kind="changed" onClose={vi.fn()} />);
    const dialog = screen.getByRole('dialog', { hidden: true });

    // Both sides, and an "Edited" badge.
    expect(within(dialog).getByText('Current — on main')).toBeInTheDocument();
    expect(within(dialog).getByText('Edited')).toBeInTheDocument();

    // Scope the secondary-field assertions to the proposed card (the de hint + raw note live on both).
    const proposedCard = within(dialog).getByText('Proposed — in this PR').closest('.entry-card') as HTMLElement;

    // Secondary info the main table hides: ALL notations, additional speech hints, aliases, links.
    expect(within(proposedCard).getByText('Notations (2)')).toBeInTheDocument(); // proposed has two
    expect(proposedCard).toHaveTextContent('secondary'); // the additional notation (rendered MathML node)
    expect(within(proposedCard).getByText('x^{n}')).toBeInTheDocument(); // its TeX source
    expect(within(proposedCard).getByText(/Speech \(de/)).toBeInTheDocument(); // a non-English hint
    expect(within(proposedCard).getByText('neue deutsche Vorlage')).toBeInTheDocument();
    expect(within(proposedCard).getByText('pow')).toBeInTheDocument(); // an added alias
    expect(within(proposedCard).getByText('legacy authoring note')).toBeInTheDocument(); // an unmodeled raw key

    // Fields that differ from main are flagged (en, property, notations, alias, speech:de) on both cards.
    expect(within(dialog).getAllByLabelText('changed field').length).toBeGreaterThan(0);
  });

  it('shows a single card for an added entry', () => {
    render(<EntryDetail concept={proposed} base={undefined} kind="added" onClose={vi.fn()} />);
    const dialog = screen.getByRole('dialog', { hidden: true });
    expect(within(dialog).getByText('Added by this PR')).toBeInTheDocument();
    expect(within(dialog).queryByText('Current — on main')).not.toBeInTheDocument();
  });

  it('shows a single "being removed" card for a deleted entry', () => {
    render(<EntryDetail concept={base} base={base} kind="deleted" onClose={vi.fn()} />);
    const dialog = screen.getByRole('dialog', { hidden: true });
    expect(within(dialog).getByText('Being removed by this PR')).toBeInTheDocument();
    expect(within(dialog).queryByText('Proposed — in this PR')).not.toBeInTheDocument();
  });

  it('renders nothing in the dialog when no concept is selected (closed)', () => {
    render(<EntryDetail concept={null} base={undefined} kind={null} onClose={vi.fn()} />);
    expect(screen.queryByText(/in this PR/)).not.toBeInTheDocument();
  });
});
