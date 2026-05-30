import temml from 'temml';

/**
 * Result of a TeX→MathML conversion. Non-throwing: callers render untrusted user input (live edit
 * preview, table cells), so failures come back as data rather than exceptions.
 */
export type RenderResult = { ok: true; mathml: string } | { ok: false; error: string };

/**
 * Temml decorates output with cosmetic CSS classes (e.g. `tml-sml-pad`) for its stylesheet. The
 * Intent dictionary stores clean, class-free MathML, so we strip them to keep generated notation
 * consistent with the seed.
 */
function clean(mathml: string): string {
  return mathml.replace(/\s+class="[^"]*"/g, '');
}

/**
 * Convert a TeX string to a MathML string using Temml. This is the single seam over the conversion
 * engine — swap engines here without touching callers.
 *
 * Argument/intent annotation (`arg='_1'`, `intent='…'`) is layered on top of this elsewhere; this
 * function is the raw TeX→MathML step.
 */
export function texToMathML(tex: string): RenderResult {
  if (tex.trim() === '') return { ok: true, mathml: '<math></math>' };
  try {
    const raw = temml.renderToString(tex, { throwOnError: true });
    return { ok: true, mathml: clean(raw) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
