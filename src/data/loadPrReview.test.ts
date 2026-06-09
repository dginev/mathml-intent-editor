import { describe, expect, it, vi } from 'vitest';
import { loadPrReview } from './loadPrReview';
import { classifyChange } from './pendingChanges';
import { conceptId } from './conceptId';
import type { Concept } from '../types';

/** A minimal `open.yml` from `(concept, en)` pairs — enough to exercise the parser + diff. */
const yaml = (entries: Array<[string, string]>) =>
  `concepts:\n  - title: Open Concepts\n    intents:\n` +
  entries.map(([concept, en]) => `    - concept: ${concept}\n      arity: 0\n      en: ${en}\n`).join('');

const MAIN = yaml([
  ['alpha', 'alpha'],
  ['beta', 'beta'],
  ['gamma', 'gamma'],
]);
// The PR: alpha untouched, beta edited, gamma deleted, delta added.
const HEAD = yaml([
  ['alpha', 'alpha'],
  ['beta', 'beta modified'],
  ['delta', 'delta'],
]);

const textRes = (body: string) => ({ status: 200, ok: true, text: async () => body }) as Response;

const pr = { headOwner: 'dginev', headRepo: 'mathml-intent-open', headRef: 'pr-branch' };

/** Serve MAIN for the base ref, HEAD for the PR branch (URL-branched, like the real raw reads). */
const fetchImpl = vi.fn(async (url: string) =>
  textRes(url.includes('/pr-branch/') ? HEAD : MAIN),
) as unknown as typeof fetch;

const args = { owner: 'dginev', repo: 'mathml-intent-open', baseBranch: 'main', filePath: 'open.yml', pr, fetchImpl };

describe('loadPrReview', () => {
  it('reduces main vs the PR head to a diff classified by the existing change-marking', async () => {
    const { concepts, base, deletedIds } = await loadPrReview(args);

    // gamma (in main, gone from the PR) is the only deletion.
    expect([...deletedIds]).toEqual([conceptId({ slug: 'gamma', arity: 0 })]);
    // Display set = proposed rows + the held-for-display deleted row, canonical order.
    expect(concepts.map((c) => c.slug)).toEqual(['alpha', 'beta', 'delta', 'gamma']);
    expect(base.map((c) => c.slug)).toEqual(['alpha', 'beta', 'gamma']);

    const baseMap = new Map(base.map((c: Concept) => [conceptId(c), c]));
    const kind = (slug: string) =>
      classifyChange(concepts.find((c) => c.slug === slug)!, baseMap, deletedIds);
    expect(kind('alpha')).toBeNull(); // unchanged
    expect(kind('beta')).toBe('changed'); // edited en
    expect(kind('delta')).toBe('added'); // new in the PR
    expect(kind('gamma')).toBe('deleted'); // removed by the PR
  });

  it('throws when the PR head has no readable open.yml (branch gone / 404)', async () => {
    const notFound = vi.fn(async (url: string) =>
      url.includes('/pr-branch/') ? ({ status: 404, ok: false } as Response) : textRes(MAIN),
    ) as unknown as typeof fetch;
    await expect(loadPrReview({ ...args, fetchImpl: notFound })).rejects.toThrow(/pr-branch/);
  });
});
