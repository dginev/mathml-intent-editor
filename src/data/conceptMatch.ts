import type { Concept } from '../types';

/**
 * Case-insensitive substring match used by the Filter: across the slug, the English template, other
 * languages' speech, the area, and aliases. An empty query matches everything.
 */
export function conceptMatches(c: Concept, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (q === '') return true;
  return (
    c.slug.toLowerCase().includes(q) ||
    (c.en?.toLowerCase().includes(q) ?? false) ||
    (c.area?.toLowerCase().includes(q) ?? false) ||
    c.alias.some((a) => a.toLowerCase().includes(q)) ||
    (c.speech?.some((s) => s.text.toLowerCase().includes(q)) ?? false)
  );
}
