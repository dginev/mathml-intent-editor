import type { TemmlEngine } from './temmlEngine';

/**
 * Convert curator-authored TeX into a dictionary-style MathML *fragment* annotated with MathML Intent.
 *
 * Annotation is done natively by our Temml fork (see ../../../Temml): the curator writes
 *   - `\arg{name}{tex}` — sets `arg="name"` (official `\MathMLarg` / `\MMLarg` are aliases)
 *   - `\intent{expr}{tex}` — sets `intent="expr"` (official `\MathMLintent` / `\MMLintent` aliases)
 * so there is no DOM attribute-injection here — we only unwrap `<math>`, default the root `intent`
 * to the concept slug when the author didn't supply one, and strip Temml's cosmetic classes so the
 * output matches the seed's clean MathML.
 */
export type IntentResult = { ok: true; mathml: string; arity: number } | { ok: false; error: string };

function stripClasses(el: Element): void {
  el.removeAttribute('class');
  for (const c of Array.from(el.querySelectorAll('*'))) c.removeAttribute('class');
}

/** The fragment's root: the single child of `<math>`, or a fresh `<mrow>` wrapping several. */
function rootOf(doc: Document, math: Element): Element {
  const children = Array.from(math.children);
  if (children.length === 1) return children[0];
  const mrow = doc.createElement('mrow');
  for (const c of children) mrow.appendChild(c);
  return mrow;
}

/**
 * Validate that every argument referenced in a speech `en` template is actually marked in the notation.
 * Speech uses `$N` (positional) or `$name`; the notation marks args with `arg="aN"` (the W3C file's
 * convention) or `arg="name"`. A `$1` is satisfied by `arg="a1"` or `arg="1"`; `$name` by `arg="name"`.
 * Returns the unsatisfied refs (as `$ref` strings) — empty means the speech and notation agree.
 */
export function missingSpeechRefs(speech: string, mathml: string): string[] {
  const args = new Set<string>();
  for (const m of mathml.matchAll(/\barg=["']([^"']+)["']/g)) args.add(m[1]);
  const missing: string[] = [];
  for (const m of speech.matchAll(/\$([A-Za-z0-9_]+)/g)) {
    const ref = m[1];
    const numeric = /^\d+$/.test(ref);
    const ok = args.has(ref) || (numeric && (args.has(`a${ref}`) || args.has(`_${ref}`)));
    if (!ok && !missing.includes(`$${ref}`)) missing.push(`$${ref}`);
  }
  return missing;
}

/**
 * The inverse of {@link missingSpeechRefs}: arguments marked in the notation (`arg="…"`) that no speech
 * `$ref` ever uses. A positional `arg="aN"`/`arg="_N"` is considered spoken by `$N` (the W3C convention),
 * any `arg="name"` by `$name`. Returns the unused arg names — empty means every marked argument is spoken.
 */
export function unusedArgRefs(speech: string, mathml: string): string[] {
  const refs = new Set<string>();
  for (const m of speech.matchAll(/\$([A-Za-z0-9_]+)/g)) refs.add(m[1]);
  const unused: string[] = [];
  for (const m of mathml.matchAll(/\barg=["']([^"']+)["']/g)) {
    const arg = m[1];
    const positional = /^[a_](\d+)$/.exec(arg); // aN / _N → spoken as $N
    const used = refs.has(arg) || (positional ? refs.has(positional[1]) : false);
    if (!used && !unused.includes(arg)) unused.push(arg);
  }
  return unused;
}

export function texToIntent(temml: TemmlEngine, tex: string, concept: string): IntentResult {
  if (tex.trim() === '') return { ok: true, mathml: '', arity: 0 };

  let raw: string;
  try {
    raw = temml.renderToString(tex, { throwOnError: true });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }

  const doc = new DOMParser().parseFromString(raw, 'application/xml');
  if (doc.querySelector('parsererror')) return { ok: false, error: 'Produced malformed MathML' };
  const root = rootOf(doc, doc.documentElement);

  // Distinct argument names, in document order (root first, then descendants).
  const argNames: string[] = [];
  const seen = new Set<string>();
  const consider = (el: Element) => {
    const a = el.getAttribute('arg');
    if (a && !seen.has(a)) {
      seen.add(a);
      argNames.push(a);
    }
  };
  consider(root);
  for (const el of Array.from(root.querySelectorAll('[arg]'))) consider(el);

  // Default the concept intent on the root when the author didn't write an explicit \intent.
  if (!root.hasAttribute('intent')) {
    const refs = argNames.map((n) => `$${n}`).join(',');
    root.setAttribute('intent', refs ? `${concept}(${refs})` : concept);
  }

  stripClasses(root);
  return { ok: true, mathml: new XMLSerializer().serializeToString(root), arity: argNames.length };
}
