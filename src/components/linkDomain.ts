/** Generic/locale subdomains skipped when labelling a link (so `en.wikipedia.org` → `wikipedia`). */
const GENERIC_SUBDOMAINS = new Set([
  'www', 'm', 'mobile', 'en', 'de', 'fr', 'es', 'it', 'pt', 'ru', 'ja', 'zh', 'nl', 'pl', 'sv', 'ar', 'ko', 'tr',
]);

/**
 * A short, recognizable label for a URL: drop generic/locale prefixes, take the first real label
 * (`en.wikipedia.org` → `wikipedia`, `mathworld.wolfram.com` → `mathworld`, `oeis.org` → `oeis`).
 */
export function linkDomain(url: string): string {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    host = url.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').split('/')[0];
  }
  const labels = host.replace(/^www\./i, '').split('.').filter(Boolean);
  if (labels.length === 0) return url;
  let i = 0;
  while (i < labels.length - 1 && GENERIC_SUBDOMAINS.has(labels[i].toLowerCase())) i++;
  return labels[i] || host;
}
