/**
 * Strip Temml's auxiliary "tuning" markup from a MathML string, leaving a minimal, load-bearing tree —
 * the form we store in `open.yml`.
 *
 * Temml (KaTeX lineage) emits presentation tuning that's great for *typesetting* but is noise in a
 * *synthetic* dictionary sample: cosmetic spacing struts (`<mspace>`), CSS-hook classes (`tml-…`), and
 * `<mrow>` wrappers that exist only to host those. This removes that layer while preserving structure
 * and — critically — the `intent=`/`arg=` annotations and semantic markers like the invisible
 * function-apply operator (U+2061). Display is unaffected: the web still re-renders the *rich* Temml
 * output from the stored TeX (see `intent.ts` + the table's notation cell); only the file gets the lean
 * form. Kept conservative on purpose — `mathvariant` (e.g. upright `d`) and operator-dictionary
 * attributes are load-bearing and left alone.
 *
 * Idempotent: a second pass finds nothing to remove (so save→reload→save never churns the diff, and the
 * canonical round-trip test stays stable). Malformed input is returned untouched.
 */
function minifyElement(el: Element): void {
  // Depth-first: fully minify each child before deciding whether to flatten it into `el`.
  for (const child of Array.from(el.children)) minifyElement(child);

  // Cosmetic attributes — never semantic. (intent/arg are different attributes and are preserved.)
  el.removeAttribute('class');
  el.removeAttribute('style');

  // Drop presentation-only spacing.
  for (const child of Array.from(el.children)) {
    if (child.localName.toLowerCase() === 'mspace') child.remove();
  }

  // Collapse a wrapper `<mrow>` that has no attributes and a single element child (often what's left
  // after a strut is removed). An annotated mrow (intent/arg) has an attribute, so it's never flattened.
  for (const child of Array.from(el.children)) {
    if (
      child.localName.toLowerCase() === 'mrow' &&
      child.attributes.length === 0 &&
      child.childNodes.length === 1 &&
      child.firstElementChild
    ) {
      el.replaceChild(child.firstElementChild, child);
    }
  }
}

export function minifyMathml(markup: string): string {
  if (markup.trim() === '') return markup;
  const isWrapped = markup.trimStart().startsWith('<math');
  const wrapped = isWrapped ? markup : `<math>${markup}</math>`;
  const doc = new DOMParser().parseFromString(wrapped, 'application/xml');
  if (doc.querySelector('parsererror')) return markup; // leave malformed input alone
  const math = doc.documentElement;
  minifyElement(math);
  const xml = new XMLSerializer();
  if (isWrapped) return xml.serializeToString(math);
  return Array.from(math.childNodes)
    .map((n) => xml.serializeToString(n))
    .join('');
}
