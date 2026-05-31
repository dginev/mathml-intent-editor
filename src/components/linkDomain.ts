/**
 * Recognized reference sites → the short label shown on the chip. Matched by hostname (exact or as a
 * subdomain), most-specific first (so `mathworld.wolfram.com` wins over `wolfram.com`).
 */
const KNOWN_SITES: ReadonlyArray<readonly [host: string, label: string]> = [
  ['mathworld.wolfram.com', 'mathworld'],
  ['wikipedia.org', 'wikipedia'],
  ['wikidata.org', 'wikidata'],
  ['ncatlab.org', 'ncatlab'],
  ['oeis.org', 'oeis'],
  ['britannica.com', 'britannica'],
  ['planetmath.org', 'planetmath'],
  ['encyclopediaofmath.org', 'encyclopediaofmath'],
  ['proofwiki.org', 'proofwiki'],
  ['dlmf.nist.gov', 'dlmf'],
  ['arxiv.org', 'arxiv'],
  ['wolfram.com', 'wolfram'],
];

/** Split a URL into its hostname and pathname, tolerating a missing protocol. */
function hostAndPath(url: string): { host: string; path: string } {
  try {
    const u = new URL(url);
    return { host: u.hostname, path: u.pathname };
  } catch {
    const rest = url.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '');
    const slash = rest.indexOf('/');
    return slash === -1 ? { host: rest, path: '' } : { host: rest.slice(0, slash), path: rest.slice(slash) };
  }
}

/**
 * A short chip label for a reference URL. If the host is a recognized encyclopedia (whitelist above),
 * use its name (`en.wikipedia.org` → `wikipedia`); otherwise the site is irrelevant, so fall back to the
 * URL's filename — its last path segment (`…/thesis_abhay.pdf` → `thesis_abhay.pdf`), or the bare host.
 */
export function linkDomain(url: string): string {
  const { host, path } = hostAndPath(url);
  const h = host.toLowerCase();
  for (const [needle, label] of KNOWN_SITES) {
    if (h === needle || h.endsWith(`.${needle}`)) return label;
  }
  const segments = path.split('/').filter(Boolean);
  const last = segments[segments.length - 1];
  if (last) {
    try {
      return decodeURIComponent(last);
    } catch {
      return last;
    }
  }
  return host.replace(/^www\./i, '') || url;
}
