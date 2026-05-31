import { useMemo } from 'react';
import { sanitizeMathml } from '../render/sanitizeMathml';

/**
 * Renders a MathML string natively. Both the dictionary's stored `mathml` notations and freshly
 * converted TeX (via `render/texToMathml`) flow through here, so the table and the live edit preview
 * display identically.
 *
 * MathML is injected as markup because it's a tree of namespaced elements, not React nodes. Notations
 * can be user-authored (raw-MathML editing) and travel through the shared file, so the markup is
 * **sanitized** here (`sanitizeMathml`) before it reaches `innerHTML` — stored XSS otherwise.
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
  const html = useMemo(() => {
    if (!markup) return '';
    // Dictionary notations and `texToIntent` output are <math>-less fragments; a <math> root is
    // required for the browser to render them as math.
    const wrapped = markup.trimStart().startsWith('<math') ? markup : `<math>${markup}</math>`;
    return sanitizeMathml(wrapped);
  }, [markup]);
  if (!html) return null;
  return (
    <span className={className} data-testid={testId} dangerouslySetInnerHTML={{ __html: html }} />
  );
}
