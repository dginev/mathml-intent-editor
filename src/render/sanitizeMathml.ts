import DOMPurify from 'dompurify';

/**
 * Sanitize a MathML string before it's rendered with `innerHTML`. Notations are user-authored (raw
 * MathML mode + the additional-notations editor) and end up in the shared `open.yml`, so a malicious
 * one would otherwise run as **stored XSS** in every reader's session. We allow presentation MathML
 * plus our `intent`/`arg` annotations, and strip foreign HTML, scripts, and event handlers — including
 * the MathML HTML-integration-point vectors (`<mtext><img onerror>`, `<annotation-xml encoding="text/html">`).
 */
export function sanitizeMathml(markup: string): string {
  return DOMPurify.sanitize(markup, {
    USE_PROFILES: { mathMl: true }, // MathML elements only — no HTML/SVG, no <script>/<img>
    ADD_ATTR: ['intent', 'arg'], // keep the MathML-Intent annotations the profile doesn't know yet
  });
}
