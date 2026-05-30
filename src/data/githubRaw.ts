import { parseDictionary } from './parse';
import type { Concept } from '../types';

/**
 * Read `open.yml` straight from `raw.githubusercontent.com` (no backend). raw serves
 * `Access-Control-Allow-Origin: *`, so this works cross-origin from GitHub Pages. Note raw is
 * CDN-cached (~5 min), so a just-pushed commit can lag — the client's local cache covers that.
 */
export function rawUrl(owner: string, repo: string, ref: string, path: string): string {
  return `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${path}`;
}

/**
 * Fetch and parse a dictionary file. Returns `null` if it doesn't exist (404 — e.g. the user has no
 * `intent/<handle>` branch yet); throws on other HTTP errors.
 */
export async function fetchDictionary(
  url: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Concept[] | null> {
  const res = await fetchImpl(url);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
  return parseDictionary(await res.text());
}
