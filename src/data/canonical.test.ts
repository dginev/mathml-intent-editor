import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import { parseDictionary } from './parse';
import { serializeConcepts } from './serialize';

// Guard the canonicalization invariants the minimal-diff PR strategy depends on, against a small
// SYNTHETIC fixture (the editor doesn't own the real open list). The fixture deliberately includes the
// tricky cases: an overloaded concept (disjoint-union arity 1 & 2), unmodeled legacy fields
// (notationa/comments), multilingual speech (de/fr), quoting, and list values. (vitest runs from root.)
const fixture = readFileSync(join(process.cwd(), 'public/seed.fixture.yml'), 'utf8');
const first = parseDictionary(fixture);
const fields = (c: ReturnType<typeof parseDictionary>[number]) => ({
  en: c.en,
  speech: c.speech,
  area: c.area,
  arity: c.arity,
  property: c.property,
  notations: c.notations,
  links: c.links,
  alias: c.alias,
});

describe('canonical round-trip on the seed fixture', () => {
  it('parses the fixture', () => {
    expect(first.length).toBeGreaterThan(5);
  });

  it('is lossless: parse → serialize → parse preserves every entry (duplicate-safe multiset)', () => {
    const round = parseDictionary(serializeConcepts(first));
    expect(round.length).toBe(first.length);
    // disjoint-union appears at two arities, so compare as a multiset of (slug + fields), not by slug.
    const tuple = (c: (typeof first)[number]) => c.slug + ' ' + JSON.stringify(fields(c));
    expect(round.map(tuple).sort()).toEqual(first.map(tuple).sort());
  });

  it('preserves legacy unmodeled fields (e.g. notationa) through serialization', () => {
    expect(serializeConcepts(first)).toContain('notationa');
  });

  it('round-trips multilingual speech keys', () => {
    const out = serializeConcepts(first);
    expect(out).toMatch(/^\s*de:/m);
    expect(out).toMatch(/^\s*fr:/m);
  });

  it('emits entries in canonical (concept, arity) order regardless of input order', () => {
    const keys = parseDictionary(serializeConcepts(first)).map((c) => `${c.slug}#${c.arity ?? ''}`);
    expect(keys).toEqual([...keys].sort());
    // the overloaded concept stays grouped with ascending arity
    expect(keys.indexOf('disjoint-union#1')).toBeLessThan(keys.indexOf('disjoint-union#2'));
  });

  it('serialize is idempotent — the canonical form is byte-stable', () => {
    const once = serializeConcepts(first);
    const twice = serializeConcepts(parseDictionary(once));
    expect(twice).toBe(once);
  });
});

describe('old-shape → notations: migration', () => {
  // A pre-migration document: `mathml:` list + scalar `tex:` + a legacy free-text `notation:` sketch.
  const oldShape = [
    'concepts:',
    '  - title: Open Concepts',
    '    intents:',
    '      - concept: additive-inverse',
    '        arity: 1',
    '        en: additive inverse of $x',
    '        tex: "-\\\\arg{x}{n}"',
    '        mathml:',
    '          - "<math><mo>−</mo><mi arg=\'x\' intent=\'additive-inverse($x)\'>n</mi></math>"',
    '      - concept: average',
    '        arity: 1',
    '        notation: sigma (n) / n', // legacy free-text key — NOT a rendering; must survive untouched
    '        mathml:',
    '          - "<math><mi>avg</mi></math>"',
    '          - "<math><mover><mi>x</mi><mo>‾</mo></mover></math>"',
    '',
  ].join('\n');

  it('parse → serialize converts to the notations: shape, preserving legacy keys', () => {
    const migrated = serializeConcepts(parseDictionary(oldShape));
    const doc = parse(migrated) as {
      concepts: Array<{ intents: Array<Record<string, unknown>> }>;
    };
    const [inv, avg] = doc.concepts[0].intents;
    expect(inv.notations).toEqual([
      { tex: '-\\arg{x}{n}', mathml: "<math><mo>−</mo><mi arg='x' intent='additive-inverse($x)'>n</mi></math>" },
    ]);
    expect('mathml' in inv).toBe(false);
    expect('tex' in inv).toBe(false);
    expect(avg.notations).toEqual([
      { mathml: '<math><mi>avg</mi></math>' },
      { mathml: '<math><mover><mi>x</mi><mo>‾</mo></mover></math>' },
    ]);
    expect(avg.notation).toBe('sigma (n) / n'); // the legacy sketch round-trips via raw
  });

  it('the migrated output is byte-stable (the one-time migration is idempotent)', () => {
    const once = serializeConcepts(parseDictionary(oldShape));
    const twice = serializeConcepts(parseDictionary(once));
    expect(twice).toBe(once);
  });
});
