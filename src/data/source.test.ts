import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import { createSource } from './source';
import type { Concept } from '../types';

const make = (n: number): Concept[] =>
  Array.from({ length: n }, (_, i) => ({
    slug: `c${i}`,
    en: undefined,
    area: undefined,
    mathml: [`<mi>${i}</mi>`],
    links: [],
    alias: [],
  }));

describe('createSource', () => {
  it('exposes the total and serves ranges on demand', async () => {
    const src = createSource(make(100));
    expect(src.total).toBe(100);
    const first = await src.fetchRange(0, 10);
    expect(first.map((c) => c.slug)).toEqual(Array.from({ length: 10 }, (_, i) => `c${i}`));
    const mid = await src.fetchRange(50, 53);
    expect(mid.map((c) => c.slug)).toEqual(['c50', 'c51', 'c52']);
  });

  it('clamps ranges past the end', async () => {
    const src = createSource(make(5));
    expect(await src.fetchRange(3, 99)).toHaveLength(2);
  });

  it('replaces a row by id (reflected in fetched ranges and serialization)', async () => {
    const src = createSource(make(3));
    const updated = { ...make(1)[0], slug: 'c1', mathml: ['<mi intent="x">z</mi>'], tex: '\\arg{x}{z}' };
    src.applyEdit('c1#', updated); // id = conceptId (slug#arity); make() has no arity → '#'

    const [, c1] = await src.fetchRange(0, 3);
    expect(c1.mathml).toEqual(['<mi intent="x">z</mi>']);
    expect(c1.tex).toBe('\\arg{x}{z}'); // tex kept in-memory

    const doc = parse(src.serialize()) as {
      concepts: Array<{ intents: Array<{ concept: string; mathml?: string[] }> }>;
    };
    const e = doc.concepts[0].intents.find((x) => x.concept === 'c1')!;
    expect(e.mathml).toEqual(['<mi intent="x">z</mi>']);
    expect('tex' in e).toBe(false); // tex stays local, never written to open.yml
  });

  it('removes a row by id and decrements total', async () => {
    const src = createSource(make(3));
    src.remove('c1#');
    expect(src.total).toBe(2);
    const slugs = (await src.fetchRange(0, 9)).map((c) => c.slug);
    expect(slugs).toEqual(['c0', 'c2']);
  });
});
