import { describe, expect, it } from 'vitest';
import { loadEdits, recordEdit } from './editCache';
import type { Concept } from '../types';

const fakeStorage = (): Storage => {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, v),
  };
};

const c = (slug: string, mathml: string): Concept => ({
  slug,
  en: undefined,
  area: undefined,
  mathml: [mathml],
  links: [],
  alias: [],
});

describe('editCache', () => {
  it('records an edit with the base value it started from', () => {
    const s = fakeStorage();
    recordEdit(s, c('power', 'v2'), c('power', 'v1'));
    const edits = loadEdits(s);
    expect(edits['power'].value.mathml).toEqual(['v2']);
    expect(edits['power'].baseAtEdit?.mathml).toEqual(['v1']);
  });

  it('keeps the ORIGINAL baseAtEdit when the same concept is edited again', () => {
    const s = fakeStorage();
    recordEdit(s, c('power', 'v2'), c('power', 'v1'));
    recordEdit(s, c('power', 'v3'), c('power', 'v2-upstream')); // later base differs
    const edits = loadEdits(s);
    expect(edits['power'].value.mathml).toEqual(['v3']); // latest user value
    expect(edits['power'].baseAtEdit?.mathml).toEqual(['v1']); // original fork point preserved
  });

  it('records a brand-new concept with no base ancestor', () => {
    const s = fakeStorage();
    recordEdit(s, c('brand-new', 'x'), null);
    expect(loadEdits(s)['brand-new'].baseAtEdit).toBeNull();
  });

  it('returns an empty cache when nothing is stored or data is corrupt', () => {
    const s = fakeStorage();
    expect(loadEdits(s)).toEqual({});
    s.setItem('intent-editor.edits', 'not json');
    expect(loadEdits(s)).toEqual({});
  });
});
