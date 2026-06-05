import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { ConceptTable } from './ConceptTable';
import type { Concept } from '../types';
import type { ChangeKind } from '../data/pendingChanges';

beforeAll(() => {
  // jsdom does no layout, so TanStack Virtual sees a 0-height scroll container (it reads
  // offsetWidth/offsetHeight) and renders no rows. Give every element a viewport-sized box so the
  // virtualizer materializes the (few) test rows.
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(600);
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(800);
});

const concept = (slug: string, extra: Partial<Concept> = {}): Concept => ({
  slug,
  en: `speech for ${slug}`,
  notations: [],
  links: [],
  alias: [],
  ...extra,
});

const data = [concept('alpha'), concept('beta'), concept('gamma'), concept('delta')];
const kinds: Record<string, ChangeKind> = { alpha: 'added', beta: 'changed', gamma: 'deleted' };
const changeKind = (c: Concept) => kinds[c.slug] ?? null;

const renderTable = () => render(<ConceptTable data={data} total={data.length} changeKind={changeKind} />);

const rowBySlug = (slug: string): HTMLElement => {
  const el = document.querySelector(`[data-slug="${slug}"]`);
  if (!el) throw new Error(`row for ${slug} not rendered`);
  return el as HTMLElement;
};

describe('ConceptTable status column', () => {
  it('marks added / edited / deleted rows with an icon naming the state', () => {
    renderTable();
    expect(within(rowBySlug('alpha')).getByRole('img', { name: 'added' })).toBeInTheDocument();
    expect(within(rowBySlug('beta')).getByRole('img', { name: 'edited' })).toBeInTheDocument();
    expect(within(rowBySlug('gamma')).getByRole('img', { name: 'pending deletion' })).toBeInTheDocument();
  });

  it('renders no status icon on unchanged rows', () => {
    renderTable();
    expect(within(rowBySlug('delta')).queryByRole('img')).toBeNull();
  });
});

describe('ConceptTable speech-language dropdown', () => {
  const bgData = [
    concept('power', { speech: [{ lang: 'bg', text: 'степен' }] }),
    concept('ratio'), // no bg template → falls back to English
  ];

  it('renders a language select listing the languages present in the data', () => {
    render(
      <ConceptTable data={bgData} total={2} languages={['en', 'bg']} speechLang="en" onSpeechLangChange={() => {}} />,
    );
    const select = screen.getByRole('combobox', { name: 'Speech language' });
    const options = within(select).getAllByRole('option');
    expect(options.map((o) => (o as HTMLOptionElement).value)).toEqual(['en', 'bg']);
    expect(options[1]).toHaveTextContent('bg — Bulgarian');
  });

  it('reports a language switch through the callback', () => {
    const onChange = vi.fn();
    render(
      <ConceptTable data={bgData} total={2} languages={['en', 'bg']} speechLang="en" onSpeechLangChange={onChange} />,
    );
    fireEvent.change(screen.getByRole('combobox', { name: 'Speech language' }), { target: { value: 'bg' } });
    expect(onChange).toHaveBeenCalledWith('bg');
  });

  it('shows the selected language template with its lang attribute; no template → empty cell', () => {
    render(
      <ConceptTable data={bgData} total={2} languages={['en', 'bg']} speechLang="bg" onSpeechLangChange={() => {}} />,
    );
    const bgCell = within(rowBySlug('power')).getByText('степен');
    expect(bgCell).toHaveAttribute('lang', 'bg');
    // A row without a Bulgarian template shows NOTHING in the Speech column (no English fallback) —
    // untranslated entries are visible at a glance.
    expect(within(rowBySlug('ratio')).queryByText('speech for ratio')).toBeNull();
  });

  it('renders a plain header when the data holds a single language', () => {
    render(<ConceptTable data={data} total={data.length} languages={['en']} speechLang="en" onSpeechLangChange={() => {}} />);
    expect(screen.queryByRole('combobox', { name: 'Speech language' })).toBeNull();
    expect(screen.getByText('Speech (en)')).toBeInTheDocument();
  });
});

describe('ConceptTable ARIA grid semantics', () => {
  it('exposes the div grid as a table with rows, headers, and cells', () => {
    renderTable();
    const table = screen.getByRole('table');
    // +1: aria-rowcount includes the header row (ARIA counts all rows in the table).
    expect(table).toHaveAttribute('aria-rowcount', String(data.length + 1));
    const rows = screen.getAllByRole('row');
    expect(rows.length).toBe(data.length + 1); // header + the 4 (virtualized) data rows
    expect(within(rows[0]).getAllByRole('columnheader').length).toBeGreaterThan(0);
    expect(within(rowBySlug('alpha')).getAllByRole('cell').length).toBeGreaterThan(0);
  });

  it('numbers virtualized rows with aria-rowindex (header = 1, data rows follow)', () => {
    renderTable();
    const rows = screen.getAllByRole('row');
    expect(rows[0]).toHaveAttribute('aria-rowindex', '1');
    expect(rowBySlug('alpha')).toHaveAttribute('aria-rowindex', '2');
    expect(rowBySlug('delta')).toHaveAttribute('aria-rowindex', '5');
  });
});
