import { parseDictionary } from './parse';
import type { Concept } from '../types';

/**
 * Read `open.yml` straight from `raw.githubusercontent.com` (no backend). raw serves
 * `Access-Control-Allow-Origin: *`, so this works cross-origin from GitHub Pages. raw is CDN-cached
 * (~5 min) and the browser may cache too, so `fetchDictionary` always reads fresh (see below) — a load
 * or refresh after a merge tracks the latest `main`.
 */
export function rawUrl(owner: string, repo: string, ref: string, path: string): string {
  return `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${path}`;
}

/**
 * Fetch and parse a dictionary file, bypassing caches so we always track the latest content: a unique
 * query is a fresh Fastly (raw CDN) cache key, and `cache: 'no-store'` skips the browser cache. Returns
 * `null` if it doesn't exist (404 — e.g. no branch yet); throws on other HTTP errors.
 */
export async function fetchDictionary(
  url: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Concept[] | null> {
  const fresh = `${url}${url.includes('?') ? '&' : '?'}_=${Date.now()}`;
  const res = await fetchImpl(fresh, { cache: 'no-store' });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
  return parseDictionary(await res.text());
}
