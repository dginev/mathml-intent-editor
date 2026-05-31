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
});
