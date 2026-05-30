/**
 * Renders a MathML string natively. Both the dictionary's stored `mathml` notations and freshly
 * converted TeX (via `render/texToMathml`) flow through here, so the table and the live edit preview
 * display identically.
 *
 * MathML is injected as markup because it's a tree of namespaced elements, not React nodes. The
 * source is our own dictionary data; sanitize here if/when user-authored markup can reach it
 * unmediated by the TeX→MathML step.
 */
export function MathML({
  markup,
  className,
  'data-testid': testId,
}: {
  markup: string;
  className?: string;
  'data-testid'?: string;
}) {
  if (!markup) return null;
  // Dictionary notations and `texToIntent` output are <math>-less fragments; a <math> root is
  // required for the browser to render them as math.
  const html = markup.trimStart().startsWith('<math') ? markup : `<math>${markup}</math>`;
  return (
    <span className={className} data-testid={testId} dangerouslySetInnerHTML={{ __html: html }} />
  );
}
