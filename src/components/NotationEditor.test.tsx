import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

// The component loads Temml via `?url` + dynamic import, which only works in the browser bundle.
// In jsdom we mock the loader with the Node-native Temml (where registration works correctly).
vi.mock('../render/temmlEngine', async () => {
  const temml = (await import('temml')).default;
  return { loadTemml: () => Promise.resolve(temml) };
});

import { NotationEditor } from './NotationEditor';

function typeTex(value: string) {
  fireEvent.change(screen.getByTestId('tex-input'), { target: { value } });
}

describe('NotationEditor', () => {
  it('renders an annotated MathML preview for valid TeX', async () => {
    render(<NotationEditor concept="additive-inverse" onSave={vi.fn()} />);
    typeTex('-\\arg{x}{n}');

    const preview = await screen.findByTestId('preview');
    expect(preview.querySelector('math')).not.toBeNull();
    expect(preview.querySelector('[arg="x"]')).not.toBeNull();
    expect(preview.querySelector('[intent="additive-inverse($x)"]')).not.toBeNull();
  });

  it('saves the generated fragment and arity', async () => {
    const onSave = vi.fn();
    render(<NotationEditor concept="additive-inverse" onSave={onSave} />);
    typeTex('-\\arg{x}{n}');
    await screen.findByTestId('preview');
    fireEvent.click(screen.getByTestId('save'));

    expect(onSave).toHaveBeenCalledTimes(1);
    const arg = onSave.mock.calls[0][0];
    expect(arg.arity).toBe(1);
    expect(arg.mathml).toContain('intent="additive-inverse($x)"');
    expect(arg.tex).toBe('-\\arg{x}{n}');
  });

  it('shows an error and disables saving for invalid TeX', async () => {
    const onSave = vi.fn();
    render(<NotationEditor concept="broken" onSave={onSave} />);
    typeTex('\\frac{1}');

    expect(await screen.findByTestId('error')).toBeInTheDocument();
    expect(screen.getByTestId('save')).toBeDisabled();
    fireEvent.click(screen.getByTestId('save'));
    expect(onSave).not.toHaveBeenCalled();
  });

  it('disables saving when the input is empty', async () => {
    render(<NotationEditor concept="additive-inverse" onSave={vi.fn()} />);
    // wait for the engine to load, then confirm Save is still disabled with empty input
    await waitFor(() => expect(screen.getByTestId('save')).toBeDisabled());
  });
});
