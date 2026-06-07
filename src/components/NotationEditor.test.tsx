import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// The component loads Temml via `?url` + dynamic import, which only works in the browser bundle.
// In jsdom we mock the loader with the Node-native Temml (where registration works correctly).
vi.mock('../render/temmlEngine', async () => {
  const temml = (await import('temml')).default;
  return { loadTemml: () => Promise.resolve(temml) };
});

import { NotationEditor } from './NotationEditor';
import { buildConceptIndex } from '../data/conceptIndex';
import type { Concept } from '../types';

const index = buildConceptIndex([
  { slug: 'union', arity: 2, area: 'set theory', alias: ['cup'], notations: [], links: [] },
  { slug: 'disjoint-union', arity: 2, area: 'set theory', notations: [], links: [], alias: [] },
  { slug: 'power', arity: 2, alias: ['exponentiation'], notations: [], links: [] },
]);

const blank: Concept = { slug: '', notations: [], links: [], alias: [] };

const base: Concept = {
  slug: 'additive-inverse',
  en: 'additive inverse of $x',
  area: 'algebra',
  arity: 1,
  property: 'prefix',
  notations: [{ mathml: '<math><mi>old</mi></math>' }],
  links: ['https://example.org/a'],
  alias: [],
};

const typeTex = (value: string) =>
  fireEvent.change(screen.getByTestId('tex-input'), { target: { value } });

afterEach(() => vi.unstubAllGlobals());

describe('NotationEditor', () => {
  it('renders an annotated MathML preview for valid TeX', async () => {
    render(<NotationEditor concept={base} onSave={vi.fn()} />);
    typeTex('-\\arg{x}{n}');
    const preview = await screen.findByTestId('preview');
    await waitFor(() => expect(preview.querySelector('[arg="x"]')).not.toBeNull());
    expect(preview.querySelector('[intent="additive-inverse($x)"]')).not.toBeNull();
  });

  it('saves the full concept with the new notation', async () => {
    const onSave = vi.fn();
    render(<NotationEditor concept={base} onSave={onSave} />);
    typeTex('-\\arg{x}{n}');
    await waitFor(() => expect(screen.getByTestId('save')).toHaveAttribute('aria-disabled', 'false'));
    fireEvent.click(screen.getByTestId('save'));

    expect(onSave).toHaveBeenCalledTimes(1);
    const c = onSave.mock.calls[0][0] as Concept;
    expect(c.notations[0].mathml).toContain('intent="additive-inverse($x)"');
    expect(c.notations[0].tex).toBe('-\\arg{x}{n}');
    expect(c.arity).toBe(1); // other fields carried through
  });

  it('saves edits to other fields while keeping the existing notation when TeX is blank', async () => {
    const onSave = vi.fn();
    render(<NotationEditor concept={base} onSave={onSave} />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit speech' }));
    fireEvent.change(screen.getByLabelText('Speech template'), {
      target: { value: 'the additive inverse of $x' },
    });
    fireEvent.click(screen.getByTestId('save'));

    const c = onSave.mock.calls[0][0] as Concept;
    expect(c.en).toBe('the additive inverse of $x');
    expect(c.notations).toEqual(base.notations); // notation untouched (TeX left blank)
  });

  it('adds a second language and splits it into Concept.speech on save', () => {
    const onSave = vi.fn();
    render(<NotationEditor concept={base} onSave={onSave} />);
    fireEvent.click(screen.getByRole('button', { name: '+ Add language' }));
    const langs = screen.getAllByLabelText('Language');
    fireEvent.change(langs[langs.length - 1], { target: { value: 'de' } });
    fireEvent.change(screen.getByLabelText('Speech template'), {
      target: { value: 'additives Inverses von $x' },
    });
    fireEvent.click(screen.getByTestId('save'));

    const c = onSave.mock.calls[0][0] as Concept;
    expect(c.en).toBe('additive inverse of $x'); // English untouched
    expect(c.speech).toEqual([{ lang: 'de', text: 'additives Inverses von $x' }]);
  });

  it('warns about an invalid ISO 639-1 language code', () => {
    render(<NotationEditor concept={base} onSave={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '+ Add language' }));
    const langs = screen.getAllByLabelText('Language');
    fireEvent.change(langs[langs.length - 1], { target: { value: 'xx' } });
    expect(screen.getByTestId('lang-warning')).toHaveTextContent('xx');
  });

  it('warns when a notation argument is never used in the speech', async () => {
    // speech says "$x" but the notation also marks arg="y", which no template references
    const c: Concept = { ...base, notations: [{ mathml: "<math><mi arg='x'>n</mi><mi arg='y'>m</mi></math>" }] };
    render(<NotationEditor concept={c} onSave={vi.fn()} />);
    expect(await screen.findByTestId('unused-warning')).toHaveTextContent('arg="y"');
  });

  it('shows an error and disables saving for invalid TeX', async () => {
    render(<NotationEditor concept={base} onSave={vi.fn()} />);
    typeTex('\\frac{1}');
    expect(await screen.findByTestId('error')).toBeInTheDocument();
    expect(screen.getByTestId('save')).toHaveAttribute('aria-disabled', 'true');
  });

  it('disables saving when the concept name is cleared', () => {
    render(<NotationEditor concept={base} onSave={vi.fn()} />);
    fireEvent.change(screen.getByTestId('slug-input'), { target: { value: '' } });
    expect(screen.getByTestId('save')).toHaveAttribute('aria-disabled', 'true');
  });

  it('keeps a pristine Done perceivable to AT: focusable, announced as unavailable, click inert', () => {
    const onSave = vi.fn();
    const onCancel = vi.fn();
    render(<NotationEditor concept={base} onSave={onSave} onCancel={onCancel} />);
    const done = screen.getByTestId('save');
    // aria-disabled, never native disabled: a disabled button drops out of the tab order, so a
    // screen-reader user tabbing the dialog never finds it ("Done doesn't exist" — round-3 feedback).
    expect(done).not.toBeDisabled();
    expect(done).toHaveAttribute('aria-disabled', 'true'); // nothing changed yet
    done.focus();
    expect(document.activeElement).toBe(done); // reachable by Tab…
    fireEvent.click(done);
    expect(onSave).not.toHaveBeenCalled(); // …but inert until there is something to stage
    // Cancel is always a live exit.
    const cancel = screen.getByRole('button', { name: 'Cancel' });
    expect(cancel).toBeEnabled();
    fireEvent.click(cancel);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('gates Done on having changes: active after an edit, unavailable again on revert', () => {
    render(<NotationEditor concept={base} onSave={vi.fn()} />);
    const done = screen.getByTestId('save');
    fireEvent.change(screen.getByTestId('slug-input'), { target: { value: 'renamed' } });
    expect(done).toHaveAttribute('aria-disabled', 'false');
    fireEvent.change(screen.getByTestId('slug-input'), { target: { value: base.slug } });
    expect(done).toHaveAttribute('aria-disabled', 'true'); // reverted → nothing to stage
  });

  it('requests deletion when the Delete button is clicked', () => {
    const onDelete = vi.fn();
    render(<NotationEditor concept={base} onSave={vi.fn()} onDelete={onDelete} />);
    fireEvent.click(screen.getByTestId('delete'));
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it('edits a raw-MathML extra notation and saves all renderings (verbatim, no tex key)', () => {
    const onSave = vi.fn();
    const c: Concept = {
      ...base,
      notations: [
        { mathml: '<math><mi>p</mi></math>' },
        { mathml: "<math><msub><mi>ad</mi><mi arg='a1'>f</mi></msub></math>" },
      ],
    };
    render(<NotationEditor concept={c} onSave={onSave} />);
    // A tex-less extra opens in Raw MathML mode, seeded with its stored rendering.
    const block = screen.getByTestId('extra-notation');
    const extra = within(block).getByTestId('extra-notation-mathml') as HTMLTextAreaElement;
    expect(extra.value).toBe("<math><msub><mi>ad</mi><mi arg='a1'>f</mi></msub></math>");
    fireEvent.change(extra, {
      target: { value: "<math><msub><mi>ad</mi><mi arg='g'>f</mi></msub></math>" },
    });
    fireEvent.click(screen.getByTestId('save'));
    const saved = onSave.mock.calls[0][0] as Concept;
    expect(saved.notations).toEqual([
      { mathml: '<math><mi>p</mi></math>' },
      { mathml: "<math><msub><mi>ad</mi><mi arg='g'>f</mi></msub></math>" },
    ]);
  });

  it('gives each extra notation its own TeX / Raw MathML toggle', () => {
    render(<NotationEditor concept={base} onSave={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '+ Add notation' }));
    const block = screen.getByTestId('extra-notation');
    expect(within(block).getByRole('tab', { name: 'TeX' })).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(within(block).getByRole('tab', { name: 'Raw MathML' }));
    expect(within(block).getByTestId('extra-notation-mathml')).toBeInTheDocument();
    // …without touching the primary's mode.
    expect(screen.getByTestId('tex-input')).toBeInTheDocument();
  });

  it('authors a TeX extra: saves {tex, mathml} with the minified rendering', async () => {
    const onSave = vi.fn();
    render(<NotationEditor concept={base} onSave={onSave} />);
    fireEvent.click(screen.getByRole('button', { name: '+ Add notation' }));
    const block = screen.getByTestId('extra-notation');
    fireEvent.change(within(block).getByTestId('extra-notation-tex'), {
      target: { value: '-\\arg{x}{n}' },
    });
    await waitFor(() => expect(screen.getByTestId('save')).toHaveAttribute('aria-disabled', 'false'));
    fireEvent.click(screen.getByTestId('save'));
    const saved = onSave.mock.calls[0][0] as Concept;
    expect(saved.notations[1].tex).toBe('-\\arg{x}{n}');
    expect(saved.notations[1].mathml).toContain('intent="additive-inverse($x)"');
    expect(saved.notations[1].mathml).not.toContain('class='); // minified at the storage boundary
  });

  it('reopens a TeX-authored extra in TeX mode with its source', () => {
    const c: Concept = {
      ...base,
      notations: [{ mathml: '<math><mi>p</mi></math>' }, { tex: '-\\arg{x}{n}', mathml: '<math><mi>-n</mi></math>' }],
    };
    render(<NotationEditor concept={c} onSave={vi.fn()} />);
    const block = screen.getByTestId('extra-notation');
    expect(within(block).getByRole('tab', { name: 'TeX' })).toHaveAttribute('aria-selected', 'true');
    expect((within(block).getByTestId('extra-notation-tex') as HTMLTextAreaElement).value).toBe('-\\arg{x}{n}');
  });

  it('shows a broken extra notation error inline on ITS block and disables Done', async () => {
    const onSave = vi.fn();
    render(<NotationEditor concept={base} onSave={onSave} />);
    fireEvent.click(screen.getByRole('button', { name: '+ Add notation' }));
    fireEvent.click(screen.getByRole('button', { name: '+ Add notation' }));
    const blocks = screen.getAllByTestId('extra-notation');
    // Break only the SECOND extra (raw mode, malformed XML).
    fireEvent.click(within(blocks[1]).getByRole('tab', { name: 'Raw MathML' }));
    fireEvent.change(within(blocks[1]).getByTestId('extra-notation-mathml'), {
      target: { value: '<math><mo>+' },
    });
    expect(within(blocks[1]).getByTestId('extra-notation-error')).toBeInTheDocument();
    expect(within(blocks[0]).queryByTestId('extra-notation-error')).toBeNull(); // not the first
    expect(screen.getByTestId('save')).toHaveAttribute('aria-disabled', 'true');
    // Fixing it re-enables Done and the fixed value is saved verbatim.
    fireEvent.change(within(blocks[1]).getByTestId('extra-notation-mathml'), {
      target: { value: '<math><mo>+</mo></math>' },
    });
    await waitFor(() => expect(screen.getByTestId('save')).toHaveAttribute('aria-disabled', 'false'));
    fireEvent.click(screen.getByTestId('save'));
    const saved = onSave.mock.calls[0][0] as Concept;
    expect(saved.notations).toEqual([
      { mathml: '<math><mi>old</mi></math>' },
      { mathml: '<math><mo>+</mo></math>' },
    ]);
  });

  it('reports content dirtiness (and edit-then-revert returns clean)', () => {
    const onDirtyChange = vi.fn();
    render(<NotationEditor concept={base} onSave={vi.fn()} onDirtyChange={onDirtyChange} />);
    expect(onDirtyChange).toHaveBeenLastCalledWith(false); // pristine on open
    fireEvent.change(screen.getByTestId('slug-input'), { target: { value: 'renamed' } });
    expect(onDirtyChange).toHaveBeenLastCalledWith(true);
    fireEvent.change(screen.getByTestId('slug-input'), { target: { value: base.slug } });
    expect(onDirtyChange).toHaveBeenLastCalledWith(false); // reverted → clean again
  });

  it('authors raw MathML (seeded with the current) and clears tex', () => {
    const onSave = vi.fn();
    render(<NotationEditor concept={base} onSave={onSave} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Raw MathML' }));
    const raw = screen.getByTestId('mathml-input') as HTMLTextAreaElement;
    expect(raw.value).toBe('<math><mi>old</mi></math>'); // seeded from the concept
    fireEvent.change(raw, { target: { value: '<math><mi intent="x">Z</mi></math>' } });
    fireEvent.click(screen.getByTestId('save'));
    const c = onSave.mock.calls[0][0] as Concept;
    expect(c.notations[0]).toEqual({ mathml: '<math><mi intent="x">Z</mi></math>' }); // no tex key
  });

  it('toggles the macro legend with the info button (hidden by default)', () => {
    render(<NotationEditor concept={base} onSave={vi.fn()} />);
    expect(screen.queryByTestId('legend')).toBeNull();
    fireEvent.click(screen.getByLabelText('Macro help'));
    expect(screen.getByTestId('legend')).toBeInTheDocument();
  });

  it('dismisses an open legend when clicking outside it', () => {
    render(<NotationEditor concept={base} onSave={vi.fn()} />);
    fireEvent.click(screen.getByLabelText('Macro help'));
    expect(screen.getByTestId('legend')).toBeInTheDocument();
    fireEvent.pointerDown(document.body); // click anywhere outside the popover
    expect(screen.queryByTestId('legend')).toBeNull();
  });

  it('titles the editor "Add concept" for a brand-new (slug-less) row', () => {
    render(<NotationEditor concept={{ slug: '', notations: [], links: [], alias: [] }} onSave={vi.fn()} />);
    expect(screen.getByRole('heading')).toHaveTextContent('Add concept');
  });

  it('shows existing links as clickable anchors and re-aggregates added links on save', () => {
    const onSave = vi.fn();
    render(<NotationEditor concept={base} onSave={onSave} />);
    const link = screen.getByRole('link', { name: 'https://example.org/a' });
    expect(link).toHaveAttribute('href', 'https://example.org/a');

    fireEvent.click(screen.getByRole('button', { name: '+ Add link' }));
    const inputs = screen.getAllByLabelText('Link URL');
    fireEvent.change(inputs[inputs.length - 1], { target: { value: 'https://example.org/b' } });
    fireEvent.click(screen.getByTestId('save'));

    const c = onSave.mock.calls[0][0] as Concept;
    expect(c.links).toEqual(['https://example.org/a', 'https://example.org/b']);
  });

  it('edits an existing link via its pencil icon', () => {
    const onSave = vi.fn();
    render(<NotationEditor concept={base} onSave={onSave} />);
    expect(screen.queryByLabelText('Link URL')).toBeNull(); // shown as a link, not an input
    fireEvent.click(screen.getByRole('button', { name: 'Edit link' }));
    fireEvent.change(screen.getByLabelText('Link URL'), { target: { value: 'https://changed.example' } });
    fireEvent.click(screen.getByTestId('save'));

    const c = onSave.mock.calls[0][0] as Concept;
    expect(c.links).toEqual(['https://changed.example']);
  });

  it('removes a link and drops it from the saved concept', () => {
    const onSave = vi.fn();
    render(<NotationEditor concept={base} onSave={onSave} />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove link' }));
    fireEvent.click(screen.getByTestId('save'));

    const c = onSave.mock.calls[0][0] as Concept;
    expect(c.links).toEqual([]);
  });

  it('renders aliases as chips: highlighted for a known concept, muted otherwise', () => {
    const c: Concept = { ...base, alias: ['known_one', 'unknown_two'] };
    render(<NotationEditor concept={c} onSave={vi.fn()} knownSlugs={new Set(['known_one'])} />);
    const chips = screen.getAllByTestId('alias-chip');
    expect(chips).toHaveLength(2);
    expect(chips.find((el) => el.textContent?.includes('known_one'))).toHaveClass('known');
    expect(chips.find((el) => el.textContent?.includes('unknown_two'))).toHaveClass('unknown');
  });

  it('adds an alias and re-aggregates the list on save', () => {
    const onSave = vi.fn();
    render(<NotationEditor concept={{ ...base, alias: ['first'] }} onSave={onSave} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add alias' }));
    const inputs = screen.getAllByLabelText('Alias');
    fireEvent.change(inputs[inputs.length - 1], { target: { value: 'second' } });
    fireEvent.click(screen.getByTestId('save'));
    expect((onSave.mock.calls[0][0] as Concept).alias).toEqual(['first', 'second']);
  });

  it('edits an existing alias via its pencil icon', () => {
    const onSave = vi.fn();
    render(<NotationEditor concept={{ ...base, alias: ['old_name'] }} onSave={onSave} />);
    expect(screen.queryByLabelText('Alias')).toBeNull(); // shown as a chip, not an input
    fireEvent.click(screen.getByRole('button', { name: 'Edit alias' }));
    fireEvent.change(screen.getByLabelText('Alias'), { target: { value: 'new_name' } });
    fireEvent.click(screen.getByTestId('save'));
    expect((onSave.mock.calls[0][0] as Concept).alias).toEqual(['new_name']);
  });

  it('explains that properties are space-separated via the info button', () => {
    render(<NotationEditor concept={base} onSave={vi.fn()} />);
    expect(screen.queryByTestId('properties-help')).toBeNull();
    fireEvent.click(screen.getByLabelText('Properties help'));
    expect(screen.getByTestId('properties-help')).toHaveTextContent('Space-separated');
  });

  it('warns when a speech $ref is not marked in the notation', () => {
    // base.en references $x, but base.mathml has no arg="x"
    render(<NotationEditor concept={base} onSave={vi.fn()} />);
    expect(screen.getByTestId('ref-warning')).toHaveTextContent('$x');
  });

  it('shows concept-naming guidance via the info button', () => {
    render(<NotationEditor concept={base} onSave={vi.fn()} />);
    expect(screen.queryByTestId('naming-help')).toBeNull();
    fireEvent.click(screen.getByLabelText('Naming help'));
    expect(screen.getByTestId('naming-help')).toBeInTheDocument();
  });

  it('lists related concepts already in the list when the name collides', () => {
    render(<NotationEditor concept={blank} onSave={vi.fn()} index={index} />);
    expect(screen.queryByTestId('related-concepts')).toBeNull(); // nothing typed yet
    fireEvent.change(screen.getByTestId('slug-input'), { target: { value: 'union' } });
    expect(screen.getByTestId('related-concepts')).toHaveTextContent('union');
  });

  it('warns when an alias already names another concept', () => {
    render(<NotationEditor concept={{ ...blank, slug: 'newthing' }} onSave={vi.fn()} index={index} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add alias' }));
    fireEvent.change(screen.getByLabelText('Alias'), { target: { value: 'cup' } });
    expect(screen.getByTestId('alias-warning')).toHaveTextContent('union');
  });
});
