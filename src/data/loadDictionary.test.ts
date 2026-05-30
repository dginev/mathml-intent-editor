import { describe, expect, it } from 'vitest';
import { loadDictionary } from './loadDictionary';
import type { EditCache } from './editCache';
import type { Concept } from '../types';
import { w3cYaml } from '../test/dictFixture';

const doc = (entries: Record<string, string>) =>
  w3cYaml(Object.entries(entries).map(([concept, m]) => ({ concept, mathml: [m] })));

// Mock fetch keyed by URL: base (main) vs the user's branch.
function fetchFor(base: Record<string, string>, branch?: Record<string, string>) {
  return (async (url: string) => {
    if (url.includes('/main/')) return { ok: true, status: 200, text: async () => doc(base) };
    if (url.includes('/intent/')) {
      return branch
        ? { ok: true, status: 200, text: async () => doc(branch) }
        : { ok: false, status: 404, text: async () => '' };
    }
    return { ok: false, status: 404, text: async () => '' };
  }) as unknown as typeof fetch;
}

const args = (extra: Partial<Parameters<typeof loadDictionary>[0]> = {}) => ({
  owner: 'dginev',
  repo: 'mathml-intent-open',
  baseBranch: 'main',
  filePath: 'open.yml',
  ...extra,
});

const editRec = (slug: string, value: string, base: string | null): EditCache[string] => ({
  value: { slug, en: undefined, area: undefined, mathml: [value], links: [], alias: [] } as Concept,
  baseAtEdit: base ? ({ slug, mathml: [base], links: [], alias: [] } as Concept) : null,
});

describe('loadDictionary', () => {
  it('loads the base dictionary when there are no edits and no handle', async () => {
    const { concepts, conflicts } = await loadDictionary(
      args({ fetchImpl: fetchFor({ power: 'p', sum: 's' }) }),
    );
    expect(concepts.map((c) => c.slug)).toEqual(['power', 'sum']); // sorted by slug
    expect(conflicts).toEqual([]);
  });

  it('overlays local edits and conflicts-free when base is unchanged since the edit', async () => {
    const edits: EditCache = { power: editRec('power', 'mine', 'p') };
    const { concepts, conflicts } = await loadDictionary(
      args({ fetchImpl: fetchFor({ power: 'p' }), edits }),
    );
    expect(concepts.find((c) => c.slug === 'power')?.mathml).toEqual(['mine']);
    expect(conflicts).toEqual([]);
  });

  it('flags a conflict when base advanced on a concept the user edited', async () => {
    const edits: EditCache = { power: editRec('power', 'mine', 'p') }; // forked from "p"
    const { conflicts } = await loadDictionary(
      args({ fetchImpl: fetchFor({ power: 'p-upstream' }), edits }), // base moved to "p-upstream"
    );
    expect(conflicts).toEqual(['power']);
  });

  it('reads the user branch when a handle is given', async () => {
    const { concepts } = await loadDictionary(
      args({ handle: 'dginev', fetchImpl: fetchFor({ power: 'p' }, { power: 'p', extra: 'e' }) }),
    );
    expect(concepts.map((c) => c.slug)).toContain('extra');
  });
});
