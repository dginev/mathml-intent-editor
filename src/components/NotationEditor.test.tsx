import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// The component loads Temml via `?url` + dynamic import, which only works in the browser bundle.
// In jsdom we mock the loader with the Node-native Temml (where registration works correctly).
vi.mock('../render/temmlEngine', async () => {
  const temml = (await import('temml')).default;
  return { loadTemml: () => Promise.resolve(temml) };
});

import { NotationEditor } from './NotationEditor';
import type { Concept } from '../types';

const base: Concept = {
  slug: 'additive-inverse',
  en: 'additive inverse of $x',
  area: 'algebra',
  arity: 1,
  property: 'prefix',
  mathml: ['<math><mi>old</mi></math>'],
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
    await waitFor(() => expect(screen.getByTestId('save')).toBeEnabled());
    fireEvent.click(screen.getByTestId('save'));

    expect(onSave).toHaveBeenCalledTimes(1);
    const c = onSave.mock.calls[0][0] as Concept;
    expect(c.mathml[0]).toContain('intent="additive-inverse($x)"');
    expect(c.tex).toBe('-\\arg{x}{n}');
    expect(c.arity).toBe(1); // other fields carried through
  });

  it('saves edits to other fields while keeping the existing notation when TeX is blank', async () => {
    const onSave = vi.fn();
    render(<NotationEditor concept={base} onSave={onSave} />);
    fireEvent.change(screen.getByDisplayValue('additive inverse of $x'), {
      target: { value: 'the additive inverse of $x' },
    });
    fireEvent.click(screen.getByTestId('save'));

    const c = onSave.mock.calls[0][0] as Concept;
    expect(c.en).toBe('the additive inverse of $x');
    expect(c.mathml).toEqual(base.mathml); // notation untouched (TeX left blank)
  });

  it('shows an error and disables saving for invalid TeX', async () => {
    render(<NotationEditor concept={base} onSave={vi.fn()} />);
    typeTex('\\frac{1}');
    expect(await screen.findByTestId('error')).toBeInTheDocument();
    expect(screen.getByTestId('save')).toBeDisabled();
  });

  it('disables saving when the concept name is cleared', () => {
    render(<NotationEditor concept={base} onSave={vi.fn()} />);
    fireEvent.change(screen.getByTestId('slug-input'), { target: { value: '' } });
    expect(screen.getByTestId('save')).toBeDisabled();
  });

  it('deletes after confirmation', () => {
    vi.stubGlobal('confirm', () => true);
    const onDelete = vi.fn();
    render(<NotationEditor concept={base} onSave={vi.fn()} onDelete={onDelete} />);
    fireEvent.click(screen.getByTestId('delete'));
    expect(onDelete).toHaveBeenCalledTimes(1);
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
    expect(c.mathml[0]).toBe('<math><mi intent="x">Z</mi></math>');
    expect(c.tex).toBeUndefined();
  });

  it('toggles the macro legend with the info button (hidden by default)', () => {
    render(<NotationEditor concept={base} onSave={vi.fn()} />);
    expect(screen.queryByTestId('legend')).toBeNull();
    fireEvent.click(screen.getByLabelText('Macro help'));
    expect(screen.getByTestId('legend')).toBeInTheDocument();
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
});
