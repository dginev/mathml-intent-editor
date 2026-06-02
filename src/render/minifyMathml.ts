/**
 * Strip Temml's auxiliary "tuning" markup from a MathML string, leaving a minimal, load-bearing tree —
 * the form we store in `open.yml`.
 *
 * Temml (KaTeX lineage) emits presentation tuning that's great for *typesetting* but is noise in a
 * *synthetic* dictionary sample: cosmetic spacing struts (`<mspace>`), CSS-hook classes (`tml-…`),
 * `<mrow>` wrappers that exist only to host those, and "overly careful" no-op `<mpadded lspace="0">`
 * wraps (e.g. from `\mathrm`). This removes that layer while preserving structure and semantic markers
 * like the invisible function-apply operator (U+2061). Crucially, it **never loses an `intent`/`arg`
 * annotation** — those are load-bearing. When it unwraps a wrapper that carries one, it copies the
 * annotation **down onto the single child** — but only when that's safe (the wrapper has exactly one
 * child and that child has neither `intent` nor `arg`); otherwise (an already-annotated or multi-child
 * inner) the wrapper is kept, since the move could rebind/collide. So `\mathrm{Ab}` lands as the
 * canonical `<mi intent='…'>Ab</mi>`. Display is unaffected: the web still re-renders the *rich* Temml
 * output from the stored TeX (see `intent.ts` + the table's notation cell); only the file gets the lean
 * form. Kept conservative on purpose — `mathvariant` (e.g. upright `d`) and operator-dictionary
 * attributes are load-bearing and left alone.
 *
 * Idempotent: a second pass finds nothing to remove (so save→reload→save never churns the diff, and the
 * canonical round-trip test stays stable). Malformed input is returned untouched.
 */
const ANNOT = ['intent', 'arg'] as const;

/** A zero / absent length — an `<mpadded lspace="0">` adds no actual spacing. */
const isZeroLength = (v: string | null) => v == null || /^0(\.0+)?(em|pt|px|mu|ex)?$/.test(v.trim());

/** Does the element carry a load-bearing MathML-Intent annotation (`intent` or `arg`)? */
const isAnnotated = (el: Element) => ANNOT.some((n) => el.hasAttribute(n));

/** A pure grouping `<mrow>`: no attributes except (possibly) the movable `intent`/`arg`. */
const isPlainMrow = (el: Element) =>
  el.localName.toLowerCase() === 'mrow' &&
  Array.from(el.attributes).every((a) => (ANNOT as readonly string[]).includes(a.name.toLowerCase()));

/**
 * A no-op `<mpadded>` wrapper: does nothing layout-wise — its only attributes are a zero `lspace`
 * (Temml's "overly careful" wrap, e.g. from `\mathrm`) and (possibly) the movable `intent`/`arg`. Any
 * layout attribute (`width`/`height`/`depth`/`voffset`) or a real (non-zero) `lspace` means it's doing
 * something → keep it. (`class`/`style` are already stripped before this runs.)
 */
const isNoopPadded = (el: Element) =>
  el.localName.toLowerCase() === 'mpadded' &&
  Array.from(el.attributes).every((a) => {
    const n = a.name.toLowerCase();
    return (ANNOT as readonly string[]).includes(n) || (n === 'lspace' && isZeroLength(a.value));
  });

/**
 * Unwrap a structural wrapper (`child`) into `el`, replacing it with its single child. If the wrapper
 * itself carries `intent`/`arg`, that move is only safe when the inner element has **neither** (then we
 * copy them down onto it); if the inner is already annotated, removing the wrapper could rebind/collide,
 * so we keep it. Returns whether it unwrapped. A multi-child or empty wrapper is never unwrapped.
 */
function unwrapInto(el: Element, child: Element): boolean {
  const inner = child.firstElementChild;
  if (!inner || child.childNodes.length !== 1) return false;
  if (isAnnotated(child)) {
    if (isAnnotated(inner)) return false; // can't move onto an already-annotated node → keep the wrapper
    for (const n of ANNOT) {
      const v = child.getAttribute(n);
      if (v != null) inner.setAttribute(n, v);
    }
  }
  el.replaceChild(inner, child);
  return true;
}

function minifyElement(el: Element): void {
  // Depth-first: fully minify each child before deciding whether to collapse it into `el`.
  for (const child of Array.from(el.children)) minifyElement(child);

  // Cosmetic attributes — never semantic. (intent/arg are different attributes and are preserved; this
  // only cleans attributes, it doesn't discard the element, so it's safe even on annotated elements.)
  el.removeAttribute('class');
  el.removeAttribute('style');

  // Repeatedly drop the tuning layer until stable, so cascades resolve in a single pass (e.g. unwrapping
  // an <mpadded> can expose a now-collapsible <mrow>). Every step only removes a node/wrapper, so this
  // terminates — and reaching a fixed point is what makes minify idempotent.
  for (let changed = true; changed; ) {
    changed = false;
    for (const child of Array.from(el.children)) {
      const tag = child.localName.toLowerCase();

      // Presentation-only spacing (never an annotated <mspace> — it has no child to carry intent onto).
      if (tag === 'mspace' && !isAnnotated(child)) {
        child.remove();
        changed = true;
        continue;
      }

      // Structural wrappers — a plain <mrow> or a no-op <mpadded>. Unwrapping carries intent/arg down onto
      // the single child when that's safe (see unwrapInto); otherwise the wrapper is kept.
      if ((isPlainMrow(child) || isNoopPadded(child)) && unwrapInto(el, child)) {
        changed = true;
        continue;
      }
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
