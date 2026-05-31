import { Fragment, useMemo } from 'react';

type Tok = { cls: string; text: string };

const ANNOTATION = new Set(['intent', 'arg']);

/** Tokenize the attribute body of a tag (everything after the tag name, including the closing `>`). */
function tokenizeAttrs(body: string): Tok[] {
  const toks: Tok[] = [];
  const re = /([a-zA-Z][\w:-]*)\s*=\s*("[^"]*"|'[^']*')|(\/?>)|(\s+)|([^])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    if (m[0] === '') {
      re.lastIndex++;
      continue;
    }
    if (m[1] != null) {
      // intent=/arg= annotations get a single highlighted span; other attributes are split by colour.
      if (ANNOTATION.has(m[1])) toks.push({ cls: 'tok-annot', text: `${m[1]}=${m[2]}` });
      else {
        toks.push({ cls: 'tok-attr', text: m[1] });
        toks.push({ cls: 'tok-punct', text: '=' });
        toks.push({ cls: 'tok-string', text: m[2] });
      }
    } else if (m[3] != null) toks.push({ cls: 'tok-punct', text: m[3] });
    else toks.push({ cls: '', text: m[4] ?? m[5] }); // whitespace / stray char → plain
  }
  return toks;
}

/**
 * Pretty-print serialized (single-line) MathML: one element per line, indented by depth. Leaf
 * elements (an opening tag whose only child is text) stay inline as `<mi>n</mi>`. Tag text is
 * preserved verbatim — quote style and content are untouched — so this is purely cosmetic.
 */
function formatMathml(src: string): string {
  const parts = src.match(/<\/?[a-zA-Z][^>]*>|[^<]+/g) ?? [src];
  const lines: string[] = [];
  let depth = 0;
  const pad = (d: number) => '  '.repeat(Math.max(0, d));
  for (let i = 0; i < parts.length; i++) {
    const tok = parts[i].trim();
    if (tok === '') continue;
    if (tok.startsWith('</')) {
      depth -= 1;
      lines.push(pad(depth) + tok);
    } else if (tok.endsWith('/>')) {
      lines.push(pad(depth) + tok); // self-closing
    } else if (tok.startsWith('<')) {
      const next = parts[i + 1];
      const after = parts[i + 2];
      const isLeaf = next != null && next[0] !== '<' && (after?.trim().startsWith('</') ?? false);
      if (isLeaf) {
        lines.push(pad(depth) + tok + next + after!.trim()); // open + text + close on one line
        i += 2;
      } else {
        lines.push(pad(depth) + tok);
        depth += 1;
      }
    } else {
      lines.push(pad(depth) + tok); // stray text between elements
    }
  }
  return lines.join('\n');
}

function tokenize(src: string): Tok[] {
  const toks: Tok[] = [];
  for (const seg of src.match(/<\/?[a-zA-Z][^>]*>|[^<]+/g) ?? []) {
    if (seg[0] !== '<') {
      toks.push({ cls: 'tok-text', text: seg });
      continue;
    }
    const open = /^<\/?/.exec(seg)![0];
    toks.push({ cls: 'tok-punct', text: open });
    let i = open.length;
    const name = /^[a-zA-Z][\w:-]*/.exec(seg.slice(i));
    if (name) {
      toks.push({ cls: 'tok-tag', text: name[0] });
      i += name[0].length;
    }
    toks.push(...tokenizeAttrs(seg.slice(i)));
  }
  return toks;
}

/**
 * The literal MathML source, lightly syntax-highlighted, with the `intent=`/`arg=` annotations
 * emphasized — complements the rendered preview by showing exactly what will be written.
 */
export function MathMLSource({ markup }: { markup: string }) {
  const toks = useMemo(() => tokenize(formatMathml(markup)), [markup]);
  return (
    <pre className="mathml-source" data-testid="mathml-source">
      <code>
        {toks.map((t, i) =>
          t.cls ? (
            <span key={i} className={t.cls}>
              {t.text}
            </span>
          ) : (
            <Fragment key={i}>{t.text}</Fragment>
          ),
        )}
      </code>
    </pre>
  );
}
